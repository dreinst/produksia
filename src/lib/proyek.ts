import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import { db } from "@/lib/db";
import { D, jumlahkan, type Desimal } from "@/lib/uang";

/*
 * Proyek/event sebagai dimensi transaksi: pesanan (penjualan & pembelian) menyimpan proyekId dan
 * mewariskannya ke semua jurnal otomatisnya; jurnal manual/kas bisa memilih proyek. Dari situ dihitung
 * Laba Rugi per event dan Rekonsiliasi Event (LPJ): proposal/kontrak → pesanan → faktur/DP → kas masuk,
 * anggaran biaya → pembelian/beban → kas keluar, laba/rugi event.
 */
type Klien = PrismaClient | Prisma.TransactionClient;

/**
 * Membaca proyekId opsional dari formulir dan memastikan proyeknya ada. `perusahaanId` diisi (dokumen akar
 * berperusahaan): proyek harus milik perusahaan itu (D1 §3.4). Tanpa argumen ketiga = perilaku lama (dipakai PJ/BR).
 */
export async function bacaProyekId(dataFormulir: FormData, klien: Klien = db, perusahaanId?: string): Promise<string | null> {
  const proyekId = String(dataFormulir.get("proyekId") ?? "").trim();
  if (!proyekId) return null;
  const ada = await klien.proyek.findUnique({ where: { id: proyekId }, select: { id: true, kode: true, perusahaanId: true } });
  if (!ada) throw new Error("Proyek/event tidak ditemukan");
  if (perusahaanId && ada.perusahaanId !== perusahaanId) {
    const nama = new Map((await klien.perusahaan.findMany({ where: { id: { in: [ada.perusahaanId, perusahaanId] } }, select: { id: true, nama: true } })).map((p) => [p.id, p.nama]));
    throw new Error(`Proyek ${ada.kode} milik ${nama.get(ada.perusahaanId) ?? ada.perusahaanId}; pilih proyek ${nama.get(perusahaanId) ?? perusahaanId}`);
  }
  return proyekId;
}

/**
 * Daftar proyek untuk pilihan formulir: yang batal dan diarsipkan disembunyikan (D5 §3.1). `perusahaanId` diisi:
 * hanya proyek perusahaan itu. Kosong: semua perusahaan (perilaku lama).
 */
export async function daftarProyekAktif(klien: Klien = db, perusahaanId?: string | null) {
  return klien.proyek.findMany({
    where: { status: { notIn: ["BATAL", "DIARSIP"] }, ...(perusahaanId ? { perusahaanId } : {}) },
    orderBy: { kode: "asc" },
    select: { id: true, kode: true, nama: true, status: true },
  });
}

export type RingkasanProyek = {
  proyek: { id: string; kode: string; nama: string; status: string; pelanggan: string | null; nilaiKontrak: Desimal | null; anggaranBiaya: Desimal | null; tanggalMulai: Date | null; tanggalSelesai: Date | null; keterangan: string | null };
  pemasukan: {
    penawaran: { id: string; nomor: string; tanggal: Date; total: Desimal; status: string }[];
    pesanan: { id: string; nomor: string; tanggal: Date; total: Desimal; status: string; uangMuka: Desimal; faktur: Desimal; diterima: Desimal; sisaPiutang: Desimal }[];
    faktur: { id: string; nomor: string; tanggal: Date; jatuhTempo: Date | null; total: Desimal; uangMuka: Desimal; diterima: Desimal; retur: Desimal; sisa: Desimal; status: string; lewatTempo: boolean }[];
    totalPesanan: Desimal;
    totalUangMuka: Desimal;
    totalFaktur: Desimal;
    totalDiterima: Desimal;
    sisaPiutang: Desimal;
  };
  pengeluaran: {
    pesananPembelian: { id: string; nomor: string; tanggal: Date; pemasok: string; total: Desimal; status: string; faktur: Desimal; dibayar: Desimal; sisaHutang: Desimal }[];
    bebanLain: { id: string; nomor: string; tanggal: Date; keterangan: string | null; sumber: string; jumlah: Desimal }[];
    totalPesananPembelian: Desimal;
    totalFakturPembelian: Desimal;
    totalDibayar: Desimal;
    sisaHutang: Desimal;
    totalBebanLain: Desimal;
  };
  labaRugi: { pendapatan: { kode: string; nama: string; jumlah: Desimal }[]; beban: { kode: string; nama: string; jumlah: Desimal }[]; totalPendapatan: Desimal; totalBeban: Desimal; laba: Desimal };
  kas: { masuk: Desimal; keluar: Desimal; bersih: Desimal; jumlahJurnal: number };
};

/**
 * Sumber jurnal yang bebannya tampil sebagai "beban lain" di LPJ: jurnal manual dan kas, ditambah biaya event yang
 * ditagihkan perusahaan lain (ANTAR_PERUSAHAAN, D1 §8.2) dan jurnal dokumen mitra (MITRA_PROYEK, D5 §8 no. 9).
 */
const SUMBER_BEBAN_LAIN: readonly string[] = ["MANUAL", "KAS_KELUAR", "KAS_MASUK", "ANTAR_PERUSAHAAN", "MITRA_PROYEK"];

/** Semua angka LPJ satu proyek, langsung dari dokumen & jurnal yang bertanda proyek itu. */
export async function ringkasanProyek(klien: Klien, proyekId: string): Promise<RingkasanProyek | null> {
  const p = await klien.proyek.findUnique({ where: { id: proyekId }, include: { pelanggan: { select: { nama: true } } } });
  if (!p) return null;
  const nol = D(0);
  const [penawaran, pesanan, psb, jurnal] = await Promise.all([
    klien.penawaranPenjualan.findMany({ where: { proyekId }, orderBy: { tanggal: "asc" } }),
    klien.pesananPenjualan.findMany({
      where: { proyekId },
      orderBy: { tanggal: "asc" },
      include: { uangMuka: true, faktur: { include: { penerimaan: true, retur: { select: { total: true } } } } },
    }),
    klien.pesananPembelian.findMany({ where: { proyekId }, orderBy: { tanggal: "asc" }, include: { pemasok: { select: { nama: true } }, faktur: { include: { pembayaran: true, retur: { select: { total: true } } } } } }),
    klien.jurnal.findMany({ where: { proyekId, sumber: { not: "PENUTUP" } }, include: { baris: { include: { akun: { select: { kode: true, nama: true, jenis: true, kasBank: true } } } } } }),
  ]);
  const sekarang = new Date();
  const faktur = pesanan.flatMap((ps) =>
    ps.faktur.map((f) => {
      const diterima = jumlahkan(f.penerimaan.map((t) => D(t.jumlah).plus(t.potonganPajak)));
      const retur = jumlahkan(f.retur.map((r) => r.total));
      const sisa = D(f.total).minus(f.uangMuka).minus(diterima).minus(retur);
      return { id: f.id, nomor: f.nomor, tanggal: f.tanggal, jatuhTempo: f.jatuhTempo, total: D(f.total), uangMuka: D(f.uangMuka), diterima, retur, sisa, status: f.status, lewatTempo: sisa.gt(0) && !!f.jatuhTempo && f.jatuhTempo < sekarang };
    }),
  );
  const pesananRingkas = pesanan.map((ps) => {
    const um = jumlahkan(ps.uangMuka.map((u) => u.jumlah));
    const fj = ps.faktur.map((f) => faktur.find((x) => x.id === f.id)!);
    return { id: ps.id, nomor: ps.nomor, tanggal: ps.tanggal, total: D(ps.total), status: ps.status, uangMuka: um, faktur: jumlahkan(fj.map((f) => f.total)), diterima: jumlahkan(fj.map((f) => f.diterima)), sisaPiutang: jumlahkan(fj.map((f) => f.sisa)) };
  });
  const psbRingkas = psb.map((b) => {
    const fb = jumlahkan(b.faktur.map((f) => f.total));
    const dibayar = jumlahkan(b.faktur.flatMap((f) => f.pembayaran.map((x) => D(x.jumlah).plus(x.potonganPajak))));
    const retur = jumlahkan(b.faktur.flatMap((f) => f.retur.map((r) => r.total)));
    return { id: b.id, nomor: b.nomor, tanggal: b.tanggal, pemasok: b.pemasok.nama, total: D(b.total), status: b.status, faktur: fb, dibayar, sisaHutang: fb.minus(dibayar).minus(retur) };
  });
  // Laba rugi event dari jurnal bertanda proyek
  const kumpul = new Map<string, { kode: string; nama: string; jenis: string; jumlah: Desimal }>();
  let kasMasuk = nol, kasKeluar = nol;
  const bebanLain: RingkasanProyek["pengeluaran"]["bebanLain"] = [];
  for (const j of jurnal) {
    let bebanJurnalIni = nol;
    for (const b of j.baris) {
      if (b.akun.kasBank) {
        kasMasuk = kasMasuk.plus(b.debit);
        kasKeluar = kasKeluar.plus(b.kredit);
      }
      if (b.akun.jenis === "PENDAPATAN" || b.akun.jenis === "BEBAN") {
        const nilai = b.akun.jenis === "PENDAPATAN" ? D(b.kredit).minus(b.debit) : D(b.debit).minus(b.kredit);
        const ada = kumpul.get(b.akun.kode) ?? { kode: b.akun.kode, nama: b.akun.nama, jenis: b.akun.jenis, jumlah: nol };
        kumpul.set(b.akun.kode, { ...ada, jumlah: ada.jumlah.plus(nilai) });
        if (b.akun.jenis === "BEBAN" && SUMBER_BEBAN_LAIN.includes(j.sumber)) bebanJurnalIni = bebanJurnalIni.plus(nilai);
      }
    }
    if (!bebanJurnalIni.isZero()) bebanLain.push({ id: j.id, nomor: j.nomor, tanggal: j.tanggal, keterangan: j.keterangan, sumber: j.sumber, jumlah: bebanJurnalIni });
  }
  const pendapatan = [...kumpul.values()].filter((x) => x.jenis === "PENDAPATAN" && !x.jumlah.isZero()).sort((a, b) => a.kode.localeCompare(b.kode));
  const beban = [...kumpul.values()].filter((x) => x.jenis === "BEBAN" && !x.jumlah.isZero()).sort((a, b) => a.kode.localeCompare(b.kode));
  const totalPendapatan = jumlahkan(pendapatan.map((x) => x.jumlah));
  const totalBeban = jumlahkan(beban.map((x) => x.jumlah));
  return {
    proyek: { id: p.id, kode: p.kode, nama: p.nama, status: p.status, pelanggan: p.pelanggan?.nama ?? null, nilaiKontrak: p.nilaiKontrak ? D(p.nilaiKontrak) : null, anggaranBiaya: p.anggaranBiaya ? D(p.anggaranBiaya) : null, tanggalMulai: p.tanggalMulai, tanggalSelesai: p.tanggalSelesai, keterangan: p.keterangan },
    pemasukan: {
      penawaran: penawaran.map((q) => ({ id: q.id, nomor: q.nomor, tanggal: q.tanggal, total: D(q.total), status: q.status })),
      pesanan: pesananRingkas,
      faktur,
      totalPesanan: jumlahkan(pesananRingkas.map((x) => x.total)),
      totalUangMuka: jumlahkan(pesananRingkas.map((x) => x.uangMuka)),
      totalFaktur: jumlahkan(faktur.map((x) => x.total)),
      totalDiterima: jumlahkan(faktur.map((x) => x.diterima)),
      sisaPiutang: jumlahkan(faktur.map((x) => x.sisa)),
    },
    pengeluaran: {
      pesananPembelian: psbRingkas,
      bebanLain: bebanLain.sort((a, b) => a.tanggal.getTime() - b.tanggal.getTime()),
      totalPesananPembelian: jumlahkan(psbRingkas.map((x) => x.total)),
      totalFakturPembelian: jumlahkan(psbRingkas.map((x) => x.faktur)),
      totalDibayar: jumlahkan(psbRingkas.map((x) => x.dibayar)),
      sisaHutang: jumlahkan(psbRingkas.map((x) => x.sisaHutang)),
      totalBebanLain: jumlahkan(bebanLain.map((x) => x.jumlah)),
    },
    labaRugi: { pendapatan: pendapatan.map(({ kode, nama, jumlah }) => ({ kode, nama, jumlah })), beban: beban.map(({ kode, nama, jumlah }) => ({ kode, nama, jumlah })), totalPendapatan, totalBeban, laba: totalPendapatan.minus(totalBeban) },
    kas: { masuk: kasMasuk, keluar: kasKeluar, bersih: kasMasuk.minus(kasKeluar), jumlahJurnal: jurnal.length },
  };
}

/** Ringkasan singkat semua proyek untuk daftar LPJ. `perusahaanId` diisi: hanya proyek perusahaan itu. */
export async function daftarRingkasanProyek(klien: Klien = db, perusahaanId?: string | null) {
  const daftar = await klien.proyek.findMany({ where: perusahaanId ? { perusahaanId } : {}, orderBy: { kode: "asc" }, include: { pelanggan: { select: { nama: true } }, pesanan: { select: { total: true } }, jurnal: { where: { sumber: { not: "PENUTUP" } }, include: { baris: { include: { akun: { select: { jenis: true } } } } } } } });
  return daftar.map((p) => {
    let pendapatan = D(0), beban = D(0);
    for (const j of p.jurnal) for (const b of j.baris) {
      if (b.akun.jenis === "PENDAPATAN") pendapatan = pendapatan.plus(b.kredit).minus(b.debit);
      if (b.akun.jenis === "BEBAN") beban = beban.plus(b.debit).minus(b.kredit);
    }
    return { id: p.id, kode: p.kode, nama: p.nama, status: p.status, pelanggan: p.pelanggan?.nama ?? null, nilaiKontrak: p.nilaiKontrak ? D(p.nilaiKontrak) : null, anggaranBiaya: p.anggaranBiaya ? D(p.anggaranBiaya) : null, totalPesanan: jumlahkan(p.pesanan.map((x) => x.total)), pendapatan, beban, laba: pendapatan.minus(beban) };
  });
}

// ---------- Status dan tampilan proyek (D5 §3.1) ----------

export const STATUS_PROYEK = ["BERJALAN", "DITUNDA", "SELESAI", "DIARSIP", "BATAL"] as const;
export type StatusProyek = (typeof STATUS_PROYEK)[number];

export const LABEL_STATUS_PROYEK: Record<StatusProyek, string> = {
  BERJALAN: "Berjalan",
  DITUNDA: "Ditunda",
  SELESAI: "Selesai",
  DIARSIP: "Diarsipkan",
  BATAL: "Batal",
};

/** Delapan warna proyek HKA (PROJECT_COLORS); kosong = abu-abu bawaan #71717a. */
export const WARNA_PROYEK = ["#18181b", "#2563eb", "#0891b2", "#059669", "#d97706", "#dc2626", "#db2777", "#7c3aed"] as const;

export const PANJANG_NAMA_KLIEN_PROYEK = 160;

export function statusProyekSah(nilai: unknown): nilai is StatusProyek {
  return typeof nilai === "string" && (STATUS_PROYEK as readonly string[]).includes(nilai);
}

/**
 * Validasi khusus proyek untuk data hasil bacaData data induk (D5 §3.1). Bidang yang tidak ada (undefined) tidak
 * diperiksa, jadi pembuatan tanpa status tetap memakai bawaan skema BERJALAN.
 */
export function validasiProyek(data: Record<string, unknown>): void {
  if (data.status !== undefined && data.status !== null && !statusProyekSah(data.status)) throw new Error("Status proyek tidak dikenal");
  const mulai = data.tanggalMulai, selesai = data.tanggalSelesai;
  if (mulai instanceof Date && selesai instanceof Date && selesai.getTime() < mulai.getTime()) throw new Error("Tanggal selesai tidak boleh sebelum tanggal mulai");
  if (typeof data.namaKlien === "string" && data.namaKlien.length > PANJANG_NAMA_KLIEN_PROYEK) throw new Error(`Nama klien maksimal ${PANJANG_NAMA_KLIEN_PROYEK} karakter`);
}

/** Klien yang ditampilkan: pelanggan terdaftar, kalau tidak ada nama klien bebas proyek. */
export function labelKlienProyek(p: { pelanggan?: { nama: string } | null; namaKlien: string | null }): string | null {
  return p.pelanggan?.nama ?? p.namaKlien ?? null;
}
