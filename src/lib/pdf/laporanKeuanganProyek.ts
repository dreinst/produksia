import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import { punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { pastikanHak } from "@/lib/otentikasi";
import { simpanBerkas, type MetaBerkas } from "@/lib/berkas";
import { catatAktivitas } from "@/lib/log";
import { labelStatus } from "@/komponen/ui/Lencana";
import { rincianRealisasi, ringkasanKeuanganProyek, type BagiHasilProyek, type ProyekKeuangan, type RingkasanKeuangan } from "@/lib/keuanganProyek";
import { D, type Desimal } from "@/lib/uang";
import { GalatIsiTerlaluTinggi, KanvasCetak, KERTAS, gambarTabel, formatRupiah, formatTanggalPendek, type BarisTabel, type Perekam, type SelTabel } from "@/lib/cetak";
import { desimalDokumen } from "@/lib/cetak/format";

/*
 * Laporan keuangan satu proyek dalam PDF (D5 §6.4, §6.5; D3 §3.9), padanan pdf_finance.py HKA. Server saja.
 * - dataLaporanKeuanganProyek menyusun angka dari fungsi yang sama dengan halaman /proyek/[id]/keuangan
 *   (ringkasanKeuanganProyek dan rincianRealisasi), jadi PDF tidak pernah berbeda dari layar. Bagian bagi hasil dan
 *   pembayaran ke mitra hanya dimuat untuk pemegang bagi-hasil.lihat; tanpa hak itu baris bagi laba di biaya ikut
 *   dibuang (rincianRealisasi denganBagiHasil false) dan jumlahnya hanya tampil sebagai keterangan. Dokumen pendapatan
 *   disaring hak lihat per jenis, sama dengan tab Pendapatan.
 * - buatPdfLaporanKeuanganProyek hanya menggambar (A4, Carlito, tanpa kop dan tanpa tanda tangan, angka gaya titik).
 * - simpanLaporanKeuanganProyek menyimpan PDF ke jenis lampiran laporan-keuangan-proyek; aksi server di
 *   src/lib/aksi/laporanKeuanganProyek.ts memanggilnya sesudah wajibHakAksi.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

export type BarisPendapatanLaporan = { jenis: string; nomor: string; status: string; tanggal: Date; nilai: Desimal };
export type BarisBiayaLaporan = { tanggal: Date; nomorJurnal: string; kategori: string; uraian: string; didanaiOleh: string; jumlah: Desimal };
export type PembayaranMitraLaporan = { tanggal: Date; mitra: string; jenis: "MODAL" | "LABA"; catatan: string | null; jumlah: Desimal };

export type DataLaporanKeuanganProyek = {
  proyek: ProyekKeuangan;
  dibuatPada: Date;
  dibuatOleh: string;
  ringkasan: RingkasanKeuangan;
  pendapatan: BarisPendapatanLaporan[];
  biaya: {
    /** urut tanggal naik, tanpa baris akun Bagi Hasil Mitra Proyek */
    baris: BarisBiayaLaporan[];
    /** baris jurnal lebih banyak dari batas; tabel hanya memuat baris terbaru */
    terpotong: boolean;
    batas: number;
    /** Σ baris tabel */
    total: Desimal;
    /** biaya aktual dikurangi talangan mitra yang disetujui */
    dibayarPerusahaan: Desimal;
    /** Σ talangan mitra yang disetujui (modal yang dikembalikan) */
    ditalangiMitra: Desimal;
    /** Σ bagi laba mitra yang disembunyikan karena pembaca tanpa bagi-hasil.lihat; null bila pembaca memegangnya */
    bagiLabaTersembunyi: Desimal | null;
  };
  /** null bila pembaca tidak memegang bagi-hasil.lihat (D5 §9.1 B20) */
  bagiHasil: BagiHasilProyek | null;
  /** pembayaran ke mitra yang disetujui, urut tanggal naik; kosong tanpa bagi-hasil.lihat dan pembayaran-mitra.lihat */
  pembayaranMitra: PembayaranMitraLaporan[];
};

const NOL = D(0);
const LABEL_PERSETUJUAN: Record<string, string> = { DRAFT: "Draf", MENUNGGU: "Menunggu", DISETUJUI: "Disetujui", DITOLAK: "Ditolak" };

/** Data laporan; null bila proyek tidak ada. Tidak memeriksa anggaran-proyek.lihat: rute dan aksi memeriksanya lebih dulu. */
export async function dataLaporanKeuanganProyek(klien: Klien, proyekId: string, pengguna: PenggunaSesi): Promise<DataLaporanKeuanganProyek | null> {
  const boleh = (h: Parameters<typeof punyaHak>[1]) => punyaHak(pengguna, h);
  const lihatBagi = boleh("bagi-hasil.lihat");
  const kp = await ringkasanKeuanganProyek(klien, proyekId, { denganBagiHasil: lihatBagi });
  if (!kp) return null;
  const { proyek, ringkasan } = kp;

  // 2. Pendapatan: jenis dan urutan sama dengan tab Pendapatan
  const pendapatan: BarisPendapatanLaporan[] = [];
  const urut = [{ tanggal: "desc" as const }, { nomor: "desc" as const }];
  if (boleh("penawaran.lihat"))
    for (const d of await klien.penawaranPenjualan.findMany({ where: { proyekId }, orderBy: urut, select: { nomor: true, status: true, tanggal: true, total: true } }))
      pendapatan.push({ jenis: "Penawaran", nomor: d.nomor, status: labelStatus(d.status), tanggal: d.tanggal, nilai: D(d.total) });
  if (boleh("pesanan.lihat"))
    for (const d of await klien.pesananPenjualan.findMany({ where: { proyekId }, orderBy: urut, select: { nomor: true, status: true, tanggal: true, total: true } }))
      pendapatan.push({ jenis: "Pesanan", nomor: d.nomor, status: labelStatus(d.status), tanggal: d.tanggal, nilai: D(d.total) });
  if (boleh("faktur.lihat"))
    for (const d of await klien.fakturPenjualan.findMany({ where: { pesanan: { proyekId } }, orderBy: urut, select: { nomor: true, status: true, statusPersetujuan: true, tanggal: true, dpp: true } }))
      pendapatan.push({ jenis: "Faktur", nomor: d.nomor, status: `${labelStatus(d.status)}${d.statusPersetujuan === "DISETUJUI" ? "" : ", tidak dihitung"}`, tanggal: d.tanggal, nilai: D(d.dpp) });
  if (boleh("uang-muka.lihat"))
    for (const d of await klien.uangMukaPelanggan.findMany({ where: { pesanan: { proyekId } }, orderBy: urut, select: { nomor: true, tanggal: true, jumlah: true, statusPersetujuan: true, rencanaTermin: { select: { label: true } } } }))
      pendapatan.push({
        jenis: "Uang muka",
        nomor: d.nomor,
        status: `${LABEL_PERSETUJUAN[d.statusPersetujuan] ?? d.statusPersetujuan}${d.rencanaTermin ? `, termin ${d.rencanaTermin.label}` : ""}, termasuk PPN`,
        tanggal: d.tanggal,
        nilai: D(d.jumlah),
      });

  // 4. Biaya aktual: rincian yang sama dengan tab Biaya, baris bagi laba tidak termasuk biaya aktual
  const rinci = await rincianRealisasi(klien, proyekId, { denganBagiHasil: lihatBagi });
  const barisBiaya = rinci.baris.filter((b) => !b.bagiHasil);
  const talangan = barisBiaya.length
    ? await klien.talanganMitra.findMany({ where: { jurnalId: { in: [...new Set(barisBiaya.map((b) => b.jurnalId))] } }, select: { jurnalId: true, vendor: true } })
    : [];
  const vendor = new Map(talangan.map((t) => [t.jurnalId, t.vendor]));
  const modalMitra = await klien.talanganMitra.aggregate({ where: { proyekId, statusPersetujuan: "DISETUJUI", jurnalId: { not: null } }, _sum: { jumlah: true } });
  const ditalangiMitra = D(modalMitra._sum.jumlah ?? 0);
  const urutBiaya = [...barisBiaya].sort((a, b) => a.tanggal.getTime() - b.tanggal.getTime() || a.nomorJurnal.localeCompare(b.nomorJurnal) || a.barisId.localeCompare(b.barisId));
  const biaya: BarisBiayaLaporan[] = urutBiaya.map((b) => {
    const v = vendor.get(b.jurnalId);
    return { tanggal: b.tanggal, nomorJurnal: b.nomorJurnal, kategori: b.kategori, uraian: `${b.keterangan ?? b.akun.nama}${v ? ` (${v})` : ""}`, didanaiOleh: b.didanaiOleh, jumlah: b.jumlah };
  });

  // 6. Pembayaran ke mitra: hanya yang disetujui (muatBagiHasil), urut tanggal naik
  const bh = kp.bagiHasil;
  const namaMitra = new Map((bh?.mitra ?? []).map((m) => [m.id, m.nama]));
  const pembayaranMitra: PembayaranMitraLaporan[] =
    bh && boleh("pembayaran-mitra.lihat")
      ? [...bh.pembayaran]
          .reverse()
          .map((p) => ({ tanggal: p.tanggal, mitra: namaMitra.get(p.mitraId) ?? "-", jenis: p.jenis, catatan: p.catatan, jumlah: p.jumlah }))
      : [];

  return {
    proyek,
    dibuatPada: new Date(),
    dibuatOleh: pengguna.nama,
    ringkasan,
    pendapatan,
    biaya: {
      baris: biaya,
      terpotong: rinci.terpotong,
      batas: rinci.batas,
      total: biaya.reduce((t, b) => t.plus(b.jumlah), NOL),
      dibayarPerusahaan: ringkasan.aktual.minus(ditalangiMitra),
      ditalangiMitra,
      bagiLabaTersembunyi: rinci.bagiLabaTersembunyi,
    },
    bagiHasil: bh,
    pembayaranMitra,
  };
}

/**
 * Nama berkas `Laporan-Keuangan-{kode}-{nama}.pdf` (D5 §6.4 butir 6, aturan HKA): dari nama proyek hanya huruf, angka,
 * spasi, `-`, `_`, dipangkas, spasi menjadi `-`, paling panjang 60 karakter, kosong menjadi `proyek`.
 */
export function namaBerkasLaporanKeuangan(p: { kode: string; nama: string }): string {
  const nama = [...p.nama.normalize("NFC").replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/\s+/g, "-")].slice(0, 60).join("") || "proyek";
  const kode = p.kode.normalize("NFC").replace(/[^\p{L}\p{N}_-]/gu, "-") || "proyek";
  return `Laporan-Keuangan-${kode}-${nama}.pdf`;
}

// ---------- Gambar ----------

const HITAM = "#111111";
const TEKS = "#18181B";
const ABU = "#71717A";
const AMBER = "#B45309";
const GARIS = { warna: "#D4D4D8", tebal: 0.4 };
const ZEBRA = "#F4F4F5";
const TOTAL = { latar: "#E4E4E7", garisAtas: 0.8 };
const UKURAN_ISI = 8.5;

const LABEL_PENDAPATAN: Record<RingkasanKeuangan["sumberPendapatan"], string> = {
  KONTRAK: "Nilai kontrak (pesanan)",
  FAKTUR: "Ditagih (belum ada kontrak)",
  PENAWARAN: "Penawaran (belum disetujui)",
  MANUAL: "Nilai kontrak (isian manual)",
  TIDAK_ADA: "Pendapatan",
};

const TEKS_URUTAN_PEMBAGIAN =
  "Urutan pembagian: modal setiap pemodal dikembalikan lebih dulu (pro rata bila uang yang diterima belum menutup biaya); mitra nominal tetap dibayar sesuai urutan, masing-masing paling banyak sebesar sisa; mitra persen mendapat persennya dari sisa setelah nominal tetap; sisanya bagian perusahaan. Rugi tidak dibagi.";

const teksPersen = (v: Desimal | null) => (v === null ? "-" : `${Number(v.toString()).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`);

/** Semua nilai uang laporan, untuk satu jumlah desimal per dokumen (pola desimalDokumen D3 §3.4). */
function nilaiUang(d: DataLaporanKeuanganProyek): Desimal[] {
  const r = d.ringkasan;
  const bh = d.bagiHasil;
  return [
    r.pendapatanRencana, r.ditagih, r.diterima, r.piutang, r.anggaran, r.aktual, r.marginRencana, r.marginKas, r.bagiHasilDibayar,
    ...r.kategori.flatMap((k) => [k.rencana, k.aktual, k.sisa]),
    ...d.pendapatan.map((p) => p.nilai),
    ...d.biaya.baris.map((b) => b.jumlah),
    d.biaya.dibayarPerusahaan, d.biaya.ditalangiMitra, ...(d.biaya.bagiLabaTersembunyi ? [d.biaya.bagiLabaTersembunyi] : []),
    ...(bh ? [...bh.mitra.flatMap((m) => [m.nilai, m.modalMasuk, m.modalKembali, m.realisasi, m.totalHak, m.dibayar, m.terutang]), bh.perusahaan.modalMasuk, bh.perusahaan.modalKembali, bh.perusahaan.realisasi, bh.perusahaan.total, bh.penyelesaian.totalTerdistribusi] : []),
    ...d.pembayaranMitra.map((p) => p.jumlah),
  ];
}

/** PDF laporan keuangan proyek (D5 §6.5). Galat GalatIsiTerlaluTinggi diteruskan ke pemanggil. */
export async function buatPdfLaporanKeuanganProyek(d: DataLaporanKeuanganProyek, opsi: { perekam?: Perekam } = {}): Promise<Uint8Array> {
  const { proyek, ringkasan: r } = d;
  const k = new KanvasCetak({ judul: `Laporan keuangan ${proyek.nama}`, subjek: `Laporan Keuangan Proyek ${proyek.kode}`, penulis: proyek.perusahaan.nama, perekam: opsi.perekam });
  const mm = (v: number) => k.mm(v);
  const desimal = desimalDokumen(nilaiUang(d));
  const rp = (v: Desimal) => formatRupiah(v, "TITIK", desimal);

  k.aturArea({ atas: mm(14), bawah: mm(16), kiri: mm(15), kanan: mm(15) });
  k.halamanBaru(KERTAS.A4, {
    depan: (kk, ke, dari) => {
      const y = kk.tinggiKertas - mm(11);
      const { kiri, lebar } = kk.areaIsi;
      kk.garis(kiri, y - 3, kiri + lebar, y - 3, { warna: GARIS.warna, tebal: 0.4 });
      kk.teks(`${proyek.nama} | Rahasia, untuk internal dan mitra proyek ini`, { x: kiri, y, lebar: lebar - mm(30), ukuran: 7.5, warna: ABU });
      kk.teks(`Halaman ${ke} dari ${dari}`, { x: kiri + lebar - mm(30), y, lebar: mm(30), ukuran: 7.5, warna: ABU, rata: "kanan" });
    },
  });
  const { kiri: x0, lebar: W } = k.areaIsi;
  const jarak = (v: number) => {
    k.y += v;
  };
  const paragraf = (isi: string, opsiTeks: { ukuran?: number; warna?: string; font?: "R" | "B" | "I" } = {}) => {
    const o = { x: x0, lebar: W, ukuran: opsiTeks.ukuran ?? 8.5, warna: opsiTeks.warna ?? TEKS, font: opsiTeks.font };
    k.pastikanRuang(k.ukur(isi, o).tinggi, { ketat: true });
    k.teks(isi, o);
  };
  /** Judul bagian 11 pt dengan jarak 7 mm di atasnya; `ruang` = tinggi yang harus muat bersama judul (mm). */
  const judulBagian = (teks: string, ruang = 16) => {
    if (!k.halamanKosong()) jarak(mm(7));
    k.pastikanRuang(mm(ruang));
    k.teks(teks, { x: x0, lebar: W, ukuran: 11, font: "B", warna: HITAM });
    jarak(mm(2));
  };
  const kepala = (isi: string, rata: SelTabel["rata"] = "kiri"): SelTabel => ({ isi, ukuran: 8, font: "B", warna: "#FFFFFF", latar: HITAM, rata, garis: null, pad: [3, 3, 3, 3] });
  const sel = (isi: string, o: Partial<SelTabel> = {}): SelTabel => ({ isi, ukuran: UKURAN_ISI, warna: TEKS, ...o });
  const uang = (v: Desimal, o: Partial<SelTabel> = {}) => sel(rp(v), { rata: "kanan", ...o });
  const tabel = (kolomMm: number[], kepalaSel: SelTabel[], baris: BarisTabel[], total = false) => {
    const jumlah = kolomMm.reduce((a, b) => a + b, 0);
    gambarTabel(k, {
      x: x0,
      kolom: kolomMm.map((c) => (c / jumlah) * W),
      kepala: { sel: kepalaSel },
      ulangKepala: true,
      baris,
      garisBawaan: GARIS,
      zebra: ZEBRA,
      ...(total ? { barisTotal: TOTAL } : {}),
    });
  };
  /** Kunci-nilai tanpa garis; `kolom` dalam mm, baris berisi pasangan [label, nilai, tebal]. */
  const kunciNilai = (kolomMm: number[], baris: ([string, string, boolean] | null)[][]) => {
    const jumlah = kolomMm.reduce((a, b) => a + b, 0);
    gambarTabel(k, {
      x: x0,
      kolom: kolomMm.map((c) => (c / jumlah) * W),
      baris: baris.map((pasangan) => ({
        sel: pasangan.flatMap((p) => [
          sel(p?.[0] ?? "", { garis: null, warna: ABU, ukuran: 9 }),
          sel(p?.[1] ?? "", { garis: null, rata: "kanan", font: p?.[2] ? "B" : "R", ukuran: 9 }),
        ]),
      })),
    });
  };
  const kosong = (teks: string) => paragraf(teks, { warna: ABU, font: "I" });

  // 1. Kepala
  k.teks("LAPORAN KEUANGAN PROYEK", { x: x0, lebar: W, ukuran: 8, font: "B", warna: ABU, jarakHuruf: 0.8 });
  jarak(mm(1));
  k.teks(proyek.nama, { x: x0, lebar: W, ukuran: 16, font: "B", warna: HITAM });
  jarak(mm(1));
  const meta = [proyek.kode, proyek.klien, proyek.perusahaan.nama, `Dibuat ${formatTanggalPendek(d.dibuatPada)} oleh ${d.dibuatOleh}`].filter((s): s is string => !!s && s.trim() !== "");
  k.teks(meta.join(" | "), { x: x0, lebar: W, ukuran: 9, warna: TEKS });
  jarak(mm(1));
  k.teks("Semua angka pendapatan tanpa PPN. Biaya aktual diambil dari jurnal bertanda proyek ini, di luar bagi hasil mitra.", { x: x0, lebar: W, ukuran: 8, font: "I", warna: ABU });

  // 1. Ringkasan
  judulBagian("1. Ringkasan");
  const piutangNegatif = r.piutang.lt(0);
  kunciNilai(
    [44, 36, 64, 36],
    [
      [[LABEL_PENDAPATAN[r.sumberPendapatan], rp(r.pendapatanRencana), true], ["Anggaran", rp(r.anggaran), false]],
      [["Ditagih", rp(r.ditagih), false], ["Biaya aktual", rp(r.aktual), true]],
      [["Diterima", rp(r.diterima), true], ["Margin rencana (pendapatan dikurangi anggaran)", `${rp(r.marginRencana)} (${teksPersen(r.persenMarginRencana)})`, false]],
      [["Piutang", rp(piutangNegatif ? NOL : r.piutang), false], ["Margin kas (diterima dikurangi biaya aktual)", `${rp(r.marginKas)} (${teksPersen(r.persenMarginKas)})`, true]],
      [piutangNegatif ? ["Uang muka diterima lebih dulu", rp(r.piutang.neg()), false] : null, ["Bagi hasil mitra dibayar", rp(r.bagiHasilDibayar), false]],
    ],
  );

  // 2. Pendapatan
  judulBagian("2. Pendapatan");
  if (d.pendapatan.length === 0) kosong("Belum ada penawaran, pesanan, atau faktur untuk proyek ini.");
  else
    tabel(
      [62, 58, 26, 34],
      [kepala("Dokumen"), kepala("Status"), kepala("Tanggal"), kepala("Nilai (tanpa PPN)", "kanan")],
      d.pendapatan.map((p) => ({ sel: [sel(`${p.jenis} ${p.nomor}`), sel(p.status, { warna: ABU }), sel(formatTanggalPendek(p.tanggal)), uang(p.nilai)] })),
    );

  // 3. Anggaran vs aktual
  judulBagian("3. Anggaran vs aktual");
  if (r.kategori.length === 0) kosong("Belum ada anggaran maupun biaya.");
  else {
    const t = r.kategori.reduce((a, x) => ({ rencana: a.rencana.plus(x.rencana), aktual: a.aktual.plus(x.aktual) }), { rencana: NOL, aktual: NOL });
    tabel(
      [58, 30, 30, 30, 32],
      [kepala("Kategori"), kepala("Anggaran", "kanan"), kepala("Realisasi", "kanan"), kepala("Sisa", "kanan"), kepala("Catatan")],
      [
        ...r.kategori.map((x) => ({
          sel: [sel(x.nama), uang(x.rencana), uang(x.aktual), uang(x.sisa), sel([x.lebih ? "Lebih anggaran" : "", x.tanpaAnggaran ? "Tanpa anggaran" : ""].filter(Boolean).join(", "), { warna: x.lebih ? "#BE123C" : AMBER })],
        })),
        { sel: [sel("Total", { font: "B" }), uang(t.rencana, { font: "B" }), uang(t.aktual, { font: "B" }), uang(t.rencana.minus(t.aktual), { font: "B" }), sel("")] },
      ],
      true,
    );
  }

  // 4. Biaya aktual dan pembayar
  judulBagian("4. Biaya aktual dan pembayar");
  const b = d.biaya;
  if (b.terpotong)
    paragraf(`Menampilkan ${b.batas.toLocaleString("id-ID")} baris jurnal terbaru. Baris yang lebih lama tidak tercetak, tetapi tetap dihitung di biaya aktual ${rp(r.aktual)}.`, { warna: AMBER });
  if (b.terpotong) jarak(mm(1.5));
  if (b.baris.length === 0) kosong("Belum ada biaya yang dijurnal.");
  else
    tabel(
      [20, 30, 70, 32, 28],
      [kepala("Tanggal"), kepala("Kategori"), kepala("Uraian"), kepala("Didanai oleh"), kepala("Jumlah", "kanan")],
      [
        ...b.baris.map((x) => ({ sel: [sel(formatTanggalPendek(x.tanggal)), sel(x.kategori), sel(x.uraian), sel(x.didanaiOleh), uang(x.jumlah)] })),
        { sel: [sel(b.terpotong ? `Total (${b.batas.toLocaleString("id-ID")} baris terbaru)` : "Total", { font: "B", span: 4 }), uang(b.total, { font: "B" })] },
      ],
      true,
    );
  jarak(mm(2));
  paragraf(`Dibayar ${proyek.perusahaan.nama}: ${rp(b.dibayarPerusahaan)} | Ditalangi mitra (modal yang dikembalikan): ${rp(b.ditalangiMitra)}`);
  if (b.bagiLabaTersembunyi && !b.bagiLabaTersembunyi.isZero()) {
    jarak(mm(1));
    paragraf(`Total beban di LPJ termasuk bagi laba mitra ${rp(b.bagiLabaTersembunyi)}. Rincian per mitra hanya terlihat oleh pemegang hak bagi hasil.`, { warna: ABU });
  }

  // 5. Penyelesaian dan bagi hasil (hanya bagi-hasil.lihat)
  const bh = d.bagiHasil;
  if (bh) {
    // padanan CondPageBreak(95 mm) HKA: bagian penyelesaian tidak dimulai di dasar halaman
    judulBagian("5. Penyelesaian dan bagi hasil", 95);
    const ps = bh.penyelesaian;
    kunciNilai(
      [100, 80],
      [[["Uang diterima (tanpa PPN)", rp(ps.diterima), false]], [["Dikurangi biaya aktual", rp(ps.biayaAktual.neg()), false]], [["Margin dibagi (diterima dikurangi biaya aktual)", rp(ps.marginDibagi), true]]],
    );
    jarak(mm(2));
    paragraf(TEKS_URUTAN_PEMBAGIAN, { warna: ABU });
    jarak(mm(2));
    if (bh.mitra.length === 0) kosong("Belum ada mitra untuk proyek ini. Seluruh margin tetap milik perusahaan.");
    else {
      const ketentuan = (m: { mode: string; nilai: Desimal }) => (m.mode === "NOMINAL" ? `${rp(m.nilai)} tetap` : `${Number(m.nilai.toString()).toLocaleString("id-ID")}% dari sisa`);
      const u = (v: Desimal, tebal = false) => uang(v, { ukuran: 7.5, font: tebal ? "B" : "R" });
      const s = (v: string, tebal = false) => sel(v, { ukuran: 7.5, font: tebal ? "B" : "R" });
      const modalMitra = bh.mitra.reduce((t, m) => t.plus(m.modalMasuk), NOL);
      tabel(
        [30, 26, 21, 21, 21, 21, 20, 20],
        [kepala("Pihak"), kepala("Ketentuan"), kepala("Modal masuk", "kanan"), kepala("Modal kembali", "kanan"), kepala("Bagian laba", "kanan"), kepala("Total hak", "kanan"), kepala("Dibayar", "kanan"), kepala("Terutang", "kanan")],
        [
          ...bh.mitra.map((m) => ({ sel: [s(m.nama), s(ketentuan(m)), u(m.modalMasuk), u(m.modalKembali), u(m.realisasi), u(m.totalHak, true), u(m.dibayar), u(m.terutang)] })),
          { sel: [s("Perusahaan (sisa)"), s("sisa"), u(bh.perusahaan.modalMasuk), u(bh.perusahaan.modalKembali), u(bh.perusahaan.realisasi), u(bh.perusahaan.total, true), s(""), s("")] },
          {
            sel: [
              s("Total", true),
              s(""),
              u(modalMitra.plus(bh.perusahaan.modalMasuk), true),
              u(ps.modalKembaliMitra.plus(bh.perusahaan.modalKembali), true),
              u(ps.labaMitra.plus(bh.perusahaan.realisasi), true),
              u(ps.totalTerdistribusi, true),
              u(bh.dibayarTotal, true),
              u(bh.terutangTotal, true),
            ],
          },
        ],
        true,
      );
      jarak(mm(2));
      paragraf(`Total hak = modal kembali + bagian laba. Terdistribusi ${rp(ps.totalTerdistribusi)} dari ${rp(ps.diterima)} yang diterima.${ps.biayaAktual.gt(0) ? ` Modal kembali ${teksPersen(ps.persenModalKembali)}.` : ""}`, { warna: ABU });
    }
    for (const p of bh.peringatan) {
      jarak(mm(1));
      paragraf(`Catatan: ${p}`, { warna: AMBER });
    }

    // 6. Pembayaran ke mitra
    if (d.pembayaranMitra.length > 0) {
      judulBagian("6. Pembayaran ke mitra");
      const total = d.pembayaranMitra.reduce((t, p) => t.plus(p.jumlah), NOL);
      tabel(
        [22, 40, 32, 56, 30],
        [kepala("Tanggal"), kepala("Mitra"), kepala("Jenis"), kepala("Catatan"), kepala("Jumlah", "kanan")],
        [
          ...d.pembayaranMitra.map((p) => ({ sel: [sel(formatTanggalPendek(p.tanggal)), sel(p.mitra), sel(p.jenis === "MODAL" ? "Pengembalian modal" : "Bagi laba"), sel(p.catatan ?? "-", { warna: ABU }), uang(p.jumlah)] })),
          { sel: [sel("Total dibayar", { font: "B", span: 4 }), uang(total, { font: "B" })] },
        ],
        true,
      );
    }
  }

  return k.selesai();
}

// ---------- Simpan ke berkas ----------

/**
 * Simpan laporan sebagai lampiran `laporan-keuangan-proyek` proyek itu (D5 §6.2 baris simpanLaporanKeuanganKeBerkas):
 * hak lihat diperiksa di sini, hak unggah dan pembatasan folder diperiksa simpanBerkas (anggaran-proyek.ubah atau
 * berkas.buat). Berkas bertag DOKUMEN; perusahaan, proyek, dan folder KEUANGAN diturunkan dari registri. Log UNGGAH
 * (simpanBerkas) dan CETAK (meta disimpanKeBerkas, berkasId) ditulis dalam satu transaksi. Galat yang aman
 * ditampilkan dilempar sebagai Error biasa.
 */
export async function simpanLaporanKeuanganProyek(klien: PrismaClient, pengguna: PenggunaSesi, proyekId: string): Promise<MetaBerkas> {
  pastikanHak(pengguna, "anggaran-proyek.lihat");
  const data = await dataLaporanKeuanganProyek(klien, String(proyekId ?? ""), pengguna);
  if (!data) throw new Error("Proyek tidak ditemukan");
  let isi: Uint8Array;
  try {
    isi = await buatPdfLaporanKeuanganProyek(data);
  } catch (e) {
    // GalatIsiTerlaluTinggi berpesan aman; galat lain hanya dicatat
    if (e instanceof GalatIsiTerlaluTinggi) throw new Error(e.message);
    console.error("[cetak] laporan keuangan proyek", e);
    throw new Error("PDF gagal dibuat. Coba lagi atau hubungi admin.");
  }
  const namaBerkas = namaBerkasLaporanKeuangan(data.proyek);
  return klien.$transaction(
    async (tx) => {
      const hasil = await simpanBerkas(tx, pengguna, {
        berkas: new File([Buffer.from(isi)], namaBerkas, { type: "application/pdf" }),
        jenisEntitas: "laporan-keuangan-proyek",
        entitasId: data.proyek.id,
        tag: "DOKUMEN",
      });
      if (!hasil.ok) throw new Error(hasil.galat);
      await catatAktivitas(tx, pengguna, {
        aksi: "CETAK",
        jenis: "Laporan Keuangan Proyek",
        nomor: data.proyek.kode,
        keterangan: "Simpan PDF ke berkas",
        modul: "anggaran-proyek",
        entitasId: data.proyek.id,
        meta: { disimpanKeBerkas: true, berkasId: hasil.nilai.id },
        perusahaanId: data.proyek.perusahaan.id,
      });
      return hasil.nilai;
    },
    { timeout: 60_000 },
  );
}
