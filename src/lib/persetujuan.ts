import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import type { StatusPersetujuan } from "@/prisma-klien/enums";
import type { Hak, KodeDokumen, PenggunaSesi } from "@/lib/hakAkses";
import { D, format, type Desimal } from "@/lib/uang";
import { perbaruiHargaRata } from "@/lib/stok";
import { catatJurnalPenggajian, ringkasanPenggajian } from "@/lib/sdm";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import {
  catatJurnal,
  catatJurnalFakturPembelian,
  catatJurnalFakturPenjualan,
  catatJurnalPenyesuaianPersediaan,
  catatJurnalPerolehanAset,
  type AsliMataUang,
  type KonsumsiTransit,
} from "@/lib/akuntansi";

/*
 * Alur persetujuan maker-checker (pemisahan tugas / segregation of duties).
 *
 * Aturan intinya: dokumen yang baru dibuat TIDAK langsung masuk buku besar. Dokumen lahir sebagai
 * DRAFT, pembuatnya mengajukan (MENUNGGU), lalu ORANG LAIN yang punya hak "<dokumen>.setujui"
 * menyetujui (DISETUJUI, jurnal dicatat saat itu) atau menolak (DITOLAK, dengan catatan alasan).
 * Yang mengajukan tidak boleh menyetujui dokumennya sendiri; itu pengendalian internalnya, dan
 * diperiksa sungguhan di `pastikanBukanPengaju`.
 *
 * DRAFT / MENUNGGU / DITOLAK = belum ada jurnal sama sekali; yang tersimpan baru "niat transaksi".
 * DISETUJUI = jurnalnya ada dan saldo buku besar sudah berubah.
 *
 * Modul ini berisi bagian yang dipakai bersama (penjaga transisi, pemeriksaan pengaju, log aktivitas,
 * dan berkas per jenis dokumen berisi cara mencatat jurnalnya). Aksi servernya ada di
 * src/lib/aksi/persetujuan.ts, satu berkas untuk semua jenis dokumen, seperti pola hapusDokumen.ts.
 */

type Klien = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;

export const LABEL_STATUS_PERSETUJUAN: Record<StatusPersetujuan, string> = {
  DRAFT: "Draf",
  MENUNGGU: "Menunggu persetujuan",
  DISETUJUI: "Disetujui",
  DITOLAK: "Ditolak",
};

/** Kolom persetujuan minimum yang dibutuhkan semua jenis dokumen. */
export type DokumenPersetujuan = {
  id: string;
  nomor: string;
  /** Tanggal dokumen: jurnalnya memakai tanggal ini, jadi ini juga yang diuji terhadap tahun buku tertutup. */
  tanggal: Date;
  statusPersetujuan: StatusPersetujuan;
  diajukanOlehId: string | null;
};

/** Kolom yang ditulis saat status berpindah; bentuknya sama untuk semua model dokumen. */
export type DataTransisi = {
  statusPersetujuan: StatusPersetujuan;
  diajukanOlehId?: string | null;
  diajukanPada?: Date | null;
  disetujuiOlehId?: string | null;
  disetujuiPada?: Date | null;
  ditolakOlehId?: string | null;
  ditolakPada?: Date | null;
  catatanPenolakan?: string | null;
};

/** Status yang sah sebagai asal untuk tiap tujuan transisi. */
const ASAL_SAH: Record<Exclude<StatusPersetujuan, "DRAFT">, readonly StatusPersetujuan[]> = {
  // DITOLAK boleh diajukan ulang setelah pembuatnya memperbaiki dokumen
  MENUNGGU: ["DRAFT", "DITOLAK"],
  DISETUJUI: ["MENUNGGU"],
  // Menolak dokumen yang masih DRAFT dipakai untuk membatalkan draf lama (mis. sisa tahun yang sudah ditutup)
  DITOLAK: ["DRAFT", "MENUNGGU"],
};

export function pastikanTransisi(dok: DokumenPersetujuan, ke: Exclude<StatusPersetujuan, "DRAFT">, label: string) {
  if (ASAL_SAH[ke].includes(dok.statusPersetujuan)) return;
  const sekarang = LABEL_STATUS_PERSETUJUAN[dok.statusPersetujuan];
  const tujuan = LABEL_STATUS_PERSETUJUAN[ke];
  if (dok.statusPersetujuan === "DISETUJUI") {
    throw new Error(`${label} ${dok.nomor} sudah disetujui dan jurnalnya sudah masuk buku besar; koreksi dilakukan dengan menghapus dokumen, bukan mengubah statusnya`);
  }
  throw new Error(`${label} ${dok.nomor} berstatus "${sekarang}", tidak bisa diubah menjadi "${tujuan}"`);
}

/**
 * Pemisahan tugas: yang mengajukan dokumen tidak boleh menyetujuinya sendiri.
 * Ini pengendalian internal utama alur maker-checker, jadi diperiksa di server, bukan disembunyikan di UI.
 */
export function pastikanBukanPengaju(dok: DokumenPersetujuan, pengguna: PenggunaSesi, label: string) {
  if (dok.diajukanOlehId && dok.diajukanOlehId === pengguna.id) {
    throw new Error(
      `${label} ${dok.nomor} diajukan oleh Anda sendiri. Pemisahan tugas: pembuat dokumen tidak boleh menyetujui dokumennya sendiri, minta pengguna lain yang berhak menyetujui`,
    );
  }
}

/** Pengguna semu skrip regresi tidak ada di tabel Pengguna, jadi tidak boleh ditulis sebagai kunci asing. */
export function idPenggunaTersimpan(pengguna: PenggunaSesi): string | null {
  return pengguna.id === "skrip-uji" ? null : pengguna.id;
}

export function dataAjukan(pengguna: PenggunaSesi): DataTransisi {
  return {
    statusPersetujuan: "MENUNGGU",
    diajukanOlehId: idPenggunaTersimpan(pengguna),
    diajukanPada: new Date(),
    ditolakOlehId: null,
    ditolakPada: null,
    catatanPenolakan: null,
  };
}
export function dataSetujui(pengguna: PenggunaSesi): DataTransisi {
  return { statusPersetujuan: "DISETUJUI", disetujuiOlehId: idPenggunaTersimpan(pengguna), disetujuiPada: new Date() };
}
export function dataTolak(pengguna: PenggunaSesi, catatan: string): DataTransisi {
  return { statusPersetujuan: "DITOLAK", ditolakOlehId: idPenggunaTersimpan(pengguna), ditolakPada: new Date(), catatanPenolakan: catatan };
}

/**
 * Dokumen yang dibuat TANPA melewati alur persetujuan (pengaturan `wajibPersetujuan` mati, atau jenis
 * dokumen yang belum disambungkan ke alur ini) langsung berstatus DISETUJUI karena jurnalnya memang
 * langsung dicatat. Pembuatnya sekaligus tercatat sebagai penyetuju supaya jejaknya tidak kosong.
 */
export function dataLangsungDisetujui(pengguna: PenggunaSesi): DataTransisi {
  const waktu = new Date();
  const id = idPenggunaTersimpan(pengguna);
  return { statusPersetujuan: "DISETUJUI", diajukanOlehId: id, diajukanPada: waktu, disetujuiOlehId: id, disetujuiPada: waktu };
}

/**
 * Apakah alur persetujuan sedang dinyalakan (Pengaturan › Perusahaan & Pajak). Bawaan: menyala.
 *
 * Pintu uji: skrip regresi lama (skrip/uji-*.ts) memeriksa "buat dokumen → jurnalnya langsung ada",
 * jadi di dalam skrip uji alur persetujuan MATI kecuali skripnya memintanya dengan UJI_PERSETUJUAN=1
 * (dipakai skrip/uji-persetujuan.ts). Pintu ini hanya terbuka di luar produksi DAN bila
 * UJI_TANPA_SESI=1, sama seperti pintu uji di src/lib/otentikasi.ts.
 */
export async function persetujuanWajib(klien: Klien): Promise<boolean> {
  if (process.env.NODE_ENV !== "production" && process.env.UJI_TANPA_SESI === "1") {
    return process.env.UJI_PERSETUJUAN === "1";
  }
  const p = await klien.pengaturanPerusahaan.findUnique({ where: { id: "default" }, select: { wajibPersetujuan: true } });
  return p?.wajibPersetujuan ?? true;
}

export type AksiPersetujuan = "AJUKAN" | "SETUJUI" | "TOLAK";

export async function catatLogPersetujuan(
  tx: Tx,
  pengguna: PenggunaSesi,
  aksi: AksiPersetujuan,
  label: string,
  nomor: string,
  keterangan: string,
) {
  await tx.logAktivitas.create({
    data: { penggunaId: idPenggunaTersimpan(pengguna), penggunaNama: pengguna.nama, aksi, jenis: label, nomor, keterangan },
  });
}

// ---------- Berkas per jenis dokumen ----------

/**
 * Satu berkas = cara sistem menangani persetujuan sebuah jenis dokumen:
 * membaca statusnya, menulis status barunya, dan mencatat jurnalnya saat disetujui.
 * Penutup (closure) dipakai supaya tiap model tetap bertipe ketat di sisi Prisma.
 */
type Berkas = {
  label: string;
  /** Dasar hak akses: `${kode}.setujui` */
  kode: KodeDokumen;
  jalur: readonly string[];
  baca: (tx: Tx, id: string) => Promise<DokumenPersetujuan | null>;
  simpan: (tx: Tx, id: string, data: DataTransisi) => Promise<void>;
  /** Mencatat jurnal (dan efek lain yang memang menunggu persetujuan) saat dokumen disetujui. */
  posting: (tx: Tx, id: string) => Promise<void>;
  /** Keterangan tambahan untuk log aktivitas. */
  ringkas?: (tx: Tx, id: string) => Promise<string>;
};

export type JenisPersetujuan =
  | "faktur"
  | "fakturPembelian"
  | "dokumenKas"
  | "penyesuaian"
  | "aset"
  | "penggajian";

const pilihPersetujuan = { id: true, nomor: true, tanggal: true, statusPersetujuan: true, diajukanOlehId: true } as const;

/** Mata uang & kurs dokumen untuk jejak di baris jurnal (buku besar tetap IDR). */
function asliDari(dok: { mataUangId: string | null; kurs: Desimal | number | string }): AsliMataUang | null {
  if (!dok.mataUangId) return null;
  const kurs = D(dok.kurs);
  return kurs.gt(0) ? { mataUangId: dok.mataUangId, kurs } : null;
}

export const BERKAS: Record<JenisPersetujuan, Berkas> = {
  faktur: {
    label: "Faktur Penjualan",
    kode: "faktur",
    jalur: ["/penjualan/faktur", "/penjualan/pesanan", "/buku-besar/jurnal"],
    baca: (tx, id) => tx.fakturPenjualan.findUnique({ where: { id }, select: pilihPersetujuan }),
    simpan: async (tx, id, data) => void (await tx.fakturPenjualan.update({ where: { id }, data })),
    posting: async (tx, id) => {
      const f = await tx.fakturPenjualan.findUniqueOrThrow({
        where: { id },
        include: { baris: true, pesanan: { select: { proyekId: true } } },
      });
      const pengaturan = await ambilPengaturanPerusahaan(tx);
      // Konsumsi "Barang Terkirim Belum Ditagih" sudah dihitung & disimpan saat draf dibuat
      const konsumsiTransit: KonsumsiTransit[] = f.baris
        .filter((b) => D(b.nilaiTransit).gt(0))
        .map((b) => ({ barangId: b.barangId, nilai: D(b.nilaiTransit) }));
      const jurnal = await catatJurnalFakturPenjualan(
        tx,
        f,
        f.baris.map((b) => ({ barangId: b.barangId, jumlah: D(b.jumlah), harga: D(b.harga) })),
        pengaturan.akunPpnKeluaranId,
        konsumsiTransit,
        { tanggal: f.tanggal, proyekId: f.pesanan?.proyekId ?? null, asli: asliDari(f) },
      );
      if (jurnal) await tx.fakturPenjualan.update({ where: { id }, data: { jurnalId: jurnal.id } });
    },
    ringkas: async (tx, id) => {
      const f = await tx.fakturPenjualan.findUniqueOrThrow({ where: { id }, include: { pelanggan: { select: { nama: true } } } });
      return `${f.pelanggan.nama}, total ${format(f.total)}`;
    },
  },

  fakturPembelian: {
    label: "Faktur Pembelian",
    kode: "faktur-pembelian",
    jalur: ["/pembelian/faktur", "/pembelian/pesanan", "/buku-besar/jurnal"],
    baca: (tx, id) => tx.fakturPembelian.findUnique({ where: { id }, select: pilihPersetujuan }),
    simpan: async (tx, id, data) => void (await tx.fakturPembelian.update({ where: { id }, data })),
    posting: async (tx, id) => {
      const f = await tx.fakturPembelian.findUniqueOrThrow({
        where: { id },
        include: { baris: true, pesanan: { include: { baris: true } } },
      });
      const pengaturan = await ambilPengaturanPerusahaan(tx);
      const hargaPesanan = new Map((f.pesanan?.baris ?? []).map((ol) => [ol.barangId, D(ol.harga)]));
      const jurnal = await catatJurnalFakturPembelian(
        tx,
        f,
        f.baris.map((b) => ({ barangId: b.barangId, jumlah: D(b.jumlah), harga: D(b.harga) })),
        hargaPesanan,
        pengaturan.akunPpnMasukanId,
        { tanggal: f.tanggal, proyekId: f.pesanan?.proyekId ?? null, asli: asliDari(f) },
      );
      if (jurnal) await tx.fakturPembelian.update({ where: { id }, data: { jurnalId: jurnal.id } });
    },
    ringkas: async (tx, id) => {
      const f = await tx.fakturPembelian.findUniqueOrThrow({ where: { id }, include: { pemasok: { select: { nama: true } } } });
      return `${f.pemasok.nama}, total ${format(f.total)}`;
    },
  },

  dokumenKas: {
    label: "Kas Masuk / Kas Keluar",
    // Hak diperiksa per jenis (kas-masuk / kas-keluar) di hakSetujui(); nilai ini hanya cadangan
    kode: "kas-keluar",
    jalur: ["/kas-bank/masuk", "/kas-bank/keluar", "/buku-besar/jurnal"],
    baca: (tx, id) => tx.dokumenKas.findUnique({ where: { id }, select: pilihPersetujuan }),
    simpan: async (tx, id, data) => void (await tx.dokumenKas.update({ where: { id }, data })),
    posting: async (tx, id) => {
      const d = await tx.dokumenKas.findUniqueOrThrow({ where: { id }, include: { akunKas: { select: { kode: true } } } });
      const jumlah = D(d.jumlah);
      const NOL = D(0);
      const ket = d.keterangan || (d.jenis === "MASUK" ? "Kas Masuk" : "Kas Keluar");
      const baris =
        d.jenis === "MASUK"
          ? [
              { akunId: d.akunKasId, debit: jumlah, kredit: NOL, keterangan: ket },
              { akunId: d.akunLawanId, debit: NOL, kredit: jumlah, keterangan: ket },
            ]
          : [
              { akunId: d.akunLawanId, debit: jumlah, kredit: NOL, keterangan: ket },
              { akunId: d.akunKasId, debit: NOL, kredit: jumlah, keterangan: ket },
            ];
      const jurnal = await catatJurnal(tx, d.jenis === "MASUK" ? "KM" : "KK", ket, d.jenis === "MASUK" ? "KAS_MASUK" : "KAS_KELUAR", baris, {
        tanggal: d.tanggal,
        proyekId: d.proyekId,
      });
      if (jurnal) await tx.dokumenKas.update({ where: { id }, data: { jurnalId: jurnal.id } });
    },
    ringkas: async (tx, id) => {
      const d = await tx.dokumenKas.findUniqueOrThrow({ where: { id }, include: { akunKas: true, akunLawan: true } });
      return `${d.jenis === "MASUK" ? "Kas masuk" : "Kas keluar"} ${format(d.jumlah)}, ${d.akunKas.kode} ${d.akunKas.nama} ↔ ${d.akunLawan.kode} ${d.akunLawan.nama}`;
    },
  },

  penyesuaian: {
    label: "Penyesuaian Stok",
    kode: "penyesuaian",
    jalur: ["/persediaan/penyesuaian", "/persediaan", "/buku-besar/jurnal"],
    baca: (tx, id) => tx.penyesuaianPersediaan.findUnique({ where: { id }, select: pilihPersetujuan }),
    simpan: async (tx, id, data) => void (await tx.penyesuaianPersediaan.update({ where: { id }, data })),
    /**
     * Penyesuaian stok adalah satu-satunya jenis yang MUTASI FISIKNYA juga ditahan sampai disetujui:
     * kalau stok sudah dipindah saat draf, jumlah barang di gudang dan saldo akun Persediaan akan
     * berbeda selama dokumen menunggu. Karena jumlahSebelum adalah potret saat draf dibuat, saat
     * disetujui dicek ulang; kalau stok sudah berubah, dokumen harus ditolak lalu dibuat ulang.
     */
    posting: async (tx, id) => {
      const p = await tx.penyesuaianPersediaan.findUniqueOrThrow({
        where: { id },
        include: { baris: { include: { barang: { select: { kode: true, nama: true } } } } },
      });
      for (const b of p.baris) {
        const stok = await tx.stokBarang.findUnique({ where: { barangId_gudangId: { barangId: b.barangId, gudangId: p.gudangId } } });
        const sekarang = D(stok?.jumlah ?? 0);
        if (!sekarang.equals(D(b.jumlahSebelum))) {
          throw new Error(
            `Stok ${b.barang.kode} - ${b.barang.nama} sudah berubah sejak ${p.nomor} diajukan (saat itu ${format(b.jumlahSebelum)}, sekarang ${format(sekarang)}). Tolak dokumen ini lalu buat penyesuaian baru`,
          );
        }
        const selisih = D(b.jumlahSesudah).minus(b.jumlahSebelum);
        if (selisih.isZero()) continue;
        await tx.stokBarang.upsert({
          where: { barangId_gudangId: { barangId: b.barangId, gudangId: p.gudangId } },
          create: { barangId: b.barangId, gudangId: p.gudangId, jumlah: D(b.jumlahSesudah) },
          update: { jumlah: D(b.jumlahSesudah) },
        });
        if (selisih.gt(0)) await perbaruiHargaRata(tx, b.barangId, selisih, D(b.hargaSatuan), true);
      }
      const jurnal = await catatJurnalPenyesuaianPersediaan(
        tx,
        p,
        p.baris.map((b) => ({ barangId: b.barangId, selisih: D(b.jumlahSesudah).minus(b.jumlahSebelum), hargaSatuan: D(b.hargaSatuan) })),
        { tanggal: p.tanggal },
      );
      if (jurnal) await tx.penyesuaianPersediaan.update({ where: { id }, data: { jurnalId: jurnal.id } });
    },
    ringkas: async (tx, id) => {
      const p = await tx.penyesuaianPersediaan.findUniqueOrThrow({ where: { id }, include: { baris: true, gudang: { select: { nama: true } } } });
      return `${p.baris.length} baris di gudang ${p.gudang.nama}`;
    },
  },

  aset: {
    label: "Aset Tetap",
    kode: "aset",
    jalur: ["/aset-tetap", "/buku-besar/jurnal"],
    baca: async (tx, id) => {
      const a = await tx.asetTetap.findUnique({
        where: { id },
        select: { id: true, kode: true, tanggalPerolehan: true, statusPersetujuan: true, diajukanOlehId: true },
      });
      return a ? { id: a.id, nomor: a.kode, tanggal: a.tanggalPerolehan, statusPersetujuan: a.statusPersetujuan, diajukanOlehId: a.diajukanOlehId } : null;
    },
    simpan: async (tx, id, data) => void (await tx.asetTetap.update({ where: { id }, data })),
    posting: async (tx, id) => {
      const a = await tx.asetTetap.findUniqueOrThrow({ where: { id } });
      // Akun pembayaran kosong = aset sudah tercatat di buku besar, perolehannya tidak dijurnal lagi
      if (!a.akunPembayaranId) return;
      const jurnal = await catatJurnalPerolehanAset(
        tx,
        { kode: a.kode, nama: a.nama, hargaPerolehan: D(a.hargaPerolehan), akunAsetId: a.akunAsetId, akunPembayaranId: a.akunPembayaranId },
        { tanggal: a.tanggalPerolehan },
      );
      if (jurnal) await tx.asetTetap.update({ where: { id }, data: { jurnalPerolehanId: jurnal.id } });
    },
    ringkas: async (tx, id) => {
      const a = await tx.asetTetap.findUniqueOrThrow({ where: { id } });
      return `${a.nama}, harga perolehan ${format(a.hargaPerolehan)}, umur ${a.umurBulan} bulan`;
    },
  },

  penggajian: {
    label: "Penggajian",
    kode: "penggajian",
    jalur: ["/sdm/penggajian", "/buku-besar/jurnal"],
    baca: (tx, id) => tx.penggajian.findUnique({ where: { id }, select: pilihPersetujuan }),
    simpan: async (tx, id, data) => void (await tx.penggajian.update({ where: { id }, data })),
    posting: async (tx, id) => {
      await catatJurnalPenggajian(tx, id);
    },
    ringkas: async (tx, id) => {
      const g = await tx.penggajian.findUniqueOrThrow({ where: { id }, include: { baris: true } });
      return ringkasanPenggajian({ ...g, totalGajiPokok: D(g.totalGajiPokok), totalTunjangan: D(g.totalTunjangan), totalPotongan: D(g.totalPotongan), totalDibayar: D(g.totalDibayar) });
    },
  },
};

/** Hak "buat" yang dibutuhkan untuk mengajukan dokumen (yang mengajukan = pembuatnya). */
export async function hakAjukan(jenis: JenisPersetujuan, klien: Klien, id: string): Promise<Hak> {
  return `${await kodeDokumen(jenis, klien, id)}.buat` as Hak;
}
/** Hak "setujui" yang dibutuhkan untuk menyetujui/menolak dokumen. */
export async function hakSetujui(jenis: JenisPersetujuan, klien: Klien, id: string): Promise<Hak> {
  return `${await kodeDokumen(jenis, klien, id)}.setujui` as Hak;
}

/** Kas Masuk dan Kas Keluar berbagi satu model, haknya tetap dipisah per jenis. */
async function kodeDokumen(jenis: JenisPersetujuan, klien: Klien, id: string): Promise<KodeDokumen> {
  if (jenis !== "dokumenKas") return BERKAS[jenis].kode;
  const d = await klien.dokumenKas.findUnique({ where: { id }, select: { jenis: true } });
  return d?.jenis === "MASUK" ? "kas-masuk" : "kas-keluar";
}
