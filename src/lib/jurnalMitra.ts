import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import { D, format, jumlahkan, uang, type Desimal } from "@/lib/uang";
import { catatJurnal } from "@/lib/akuntansi";
import { akunKeuanganProyek } from "@/lib/keuanganProyek";
import type { KlienTransaksi } from "@/lib/nomorCetak";

/*
 * Jurnal dokumen mitra proyek (D5 §3.10, §3.11, §4.1, §4.2). Bukan "use server".
 *
 * Talangan Mitra (TLM): biaya proyek yang dibayar mitra dengan uangnya sendiri, Dr akun beban / Cr Hutang Mitra Proyek.
 * Pembayaran ke Mitra (BYM): jenis MODAL = Dr Hutang Mitra Proyek / Cr Kas, jenis LABA = Dr Bagi Hasil Mitra Proyek /
 * Cr Kas. Jurnal dicatat oleh postingTalanganMitra / postingPembayaranMitra, yang dipanggil BERKAS.posting saat dokumen
 * disetujui dan oleh aksi buat (paket Mitra dan bagi hasil) saat persetujuan mati, jadi logikanya satu.
 *
 * Perusahaan jurnal = perusahaan proyek. Dokumen yang perusahaannya berbeda dari proyeknya ditolak, bukan dipindah
 * diam-diam. Akun peran dibaca lewat akunKeuanganProyek (pemetaan tambahan dulu, lalu kode 2-1700 / 5-1700).
 *
 * Urutan kunci: baris dokumen (BERKAS.kunci) lebih dulu, lalu baris mitra (kunciBarisMitra). Kunci mitra memakai
 * FOR NO KEY UPDATE: sesamanya saling menunggu, jadi pengembalian modal, hapus talangan, dan persetujuan atas mitra
 * yang sama berjalan bergiliran, tetapi sisipan dokumen baru (FOR KEY SHARE lewat kunci asing) tidak terhalang dan
 * tidak membentuk siklus bila transaksi yang sama lalu mengunci mitranya.
 */

type Klien = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;

/** Mengunci baris mitra (FOR NO KEY UPDATE) sampai transaksi selesai. Lihat catatan urutan kunci di atas. */
export async function kunciBarisMitra(tx: Tx, mitraId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "MitraProyek" WHERE "id" = ${mitraId} FOR NO KEY UPDATE`;
}

type OpsiSisaModal = { hanyaDisetujui: boolean; kecualiPembayaranId?: string };

/**
 * Sisa modal mitra = Σ talangan DISETUJUI − Σ pembayaran MODAL (D5 §3.11). `hanyaDisetujui`: saat posting hanya
 * pembayaran DISETUJUI yang dihitung; saat dibuat semua yang belum DITOLAK ikut memesan sisa. `kecualiPembayaranId`
 * mengecualikan dokumen yang sedang diposting. `kunci: true` mengunci baris mitra lebih dulu supaya sisa tidak berubah
 * sampai transaksi selesai, jadi hanya menerima `tx` dari db.$transaction (tsc menolak klien db biasa) dan di runtime
 * menolak klien yang punya $connect (klien db biasa; tx Prisma 7 tidak punya): tanpa transaksi kuncinya langsung
 * lepas (tinjauan P33 R2).
 */
export async function sisaModalMitra(klien: KlienTransaksi, mitraId: string, opsi: OpsiSisaModal & { kunci: true }): Promise<Desimal>;
export async function sisaModalMitra(klien: Klien, mitraId: string, opsi: OpsiSisaModal & { kunci?: false }): Promise<Desimal>;
export async function sisaModalMitra(klien: Klien, mitraId: string, opsi: OpsiSisaModal & { kunci?: boolean }): Promise<Desimal> {
  if (opsi.kunci) {
    if (typeof (klien as { $connect?: unknown }).$connect === "function") throw new Error("sisaModalMitra dengan kunci harus dipanggil di dalam db.$transaction");
    await kunciBarisMitra(klien as Tx, mitraId);
  }
  // berurutan, bukan Promise.all: klien biasanya tx interaktif yang menjalankan satu kueri sekali jalan
  const talangan = await klien.talanganMitra.aggregate({ where: { mitraId, statusPersetujuan: "DISETUJUI" }, _sum: { jumlah: true } });
  const modal = await klien.pembayaranMitra.aggregate({
    where: {
      mitraId,
      jenis: "MODAL",
      statusPersetujuan: opsi.hanyaDisetujui ? "DISETUJUI" : { not: "DITOLAK" },
      ...(opsi.kecualiPembayaranId ? { id: { not: opsi.kecualiPembayaranId } } : {}),
    },
    _sum: { jumlah: true },
  });
  return uang(D(talangan._sum.jumlah ?? 0).minus(D(modal._sum.jumlah ?? 0)));
}

type Peran = "hutangMitra" | "bebanBagiHasil";
const PERAN: Record<Peran, { label: string; kunci: string; kode: string; jenis: string; labelJenis: string; pesanKosong: string }> = {
  hutangMitra: {
    label: "Hutang Mitra Proyek",
    kunci: "hutang-mitra-proyek",
    kode: "2-1700",
    jenis: "KEWAJIBAN",
    labelJenis: "Kewajiban",
    pesanKosong: 'Akun Hutang Mitra Proyek belum ada. Terapkan Bagan Akun Standar (akun 2-1700) atau atur Pengaturan › Pemetaan Akun › Pemetaan tambahan "Hutang Mitra Proyek"',
  },
  bebanBagiHasil: {
    label: "Bagi Hasil Mitra Proyek",
    kunci: "beban-bagi-hasil-mitra",
    kode: "5-1700",
    jenis: "BEBAN",
    labelJenis: "Beban",
    pesanKosong: 'Akun Bagi Hasil Mitra Proyek belum ada. Terapkan Bagan Akun Standar (akun 5-1700) atau atur Pengaturan › Pemetaan Akun › Pemetaan tambahan "Beban Bagi Hasil Mitra"',
  },
};

/**
 * Akun peran keuangan proyek untuk jurnal mitra; melempar galat yang menyebut cara memperbaikinya bila belum ada, atau
 * yang menyebut kode akun dan syaratnya bila akun yang dipetakan jenisnya salah atau akun kelompok (D5 §4.2).
 */
export async function akunPeranMitra(klien: Klien, peran: Peran): Promise<{ id: string; kode: string; nama: string }> {
  const akun = (await akunKeuanganProyek(klien))[peran];
  if (akun) return akun;
  const p = PERAN[peran];
  const pilih = { kode: true, jenis: true, kelompok: true } as const;
  const calon =
    (await klien.pemetaanAkunTambahan.findUnique({ where: { kunci: p.kunci }, select: { akun: { select: pilih } } }))?.akun ??
    (await klien.akun.findUnique({ where: { kode: p.kode }, select: pilih }));
  if (calon) throw new Error(`Akun ${calon.kode} tidak bisa dipakai sebagai ${p.label}: harus akun ${p.labelJenis} rinci`);
  throw new Error(p.pesanKosong);
}

/** Dokumen mitra harus milik perusahaan proyeknya, dan mitranya milik proyek itu (data dari luar aplikasi ditolak). */
function pastikanSatuProyek(dok: { nomor: string; perusahaanId: string; proyekId: string; mitra: { proyekId: string; nama: string }; proyek: { kode: string; perusahaanId: string; perusahaan: { nama: string; aktif: boolean } } }) {
  // sama dengan pastikanPerusahaanAktif saat buat (tinjauan P35 R2, pola persetujuan.ts untuk penyesuaian stok): draf
  // yang dibuat sebelum perusahaan proyeknya diarsipkan tidak boleh dijurnal ke buku perusahaan arsip saat disetujui
  if (!dok.proyek.perusahaan.aktif) throw new Error(`Perusahaan ${dok.proyek.perusahaan.nama} sudah diarsipkan; aktifkan dulu`);
  if (dok.mitra.proyekId !== dok.proyekId) throw new Error(`Mitra ${dok.mitra.nama} bukan mitra proyek ${dok.proyek.kode}; ${dok.nomor} tidak bisa dijurnal`);
  if (dok.perusahaanId !== dok.proyek.perusahaanId) throw new Error(`${dok.nomor} tercatat di perusahaan yang berbeda dari proyek ${dok.proyek.kode}; hapus lalu catat ulang dari proyeknya`);
}

const PILIH_PROYEK = { proyek: { select: { kode: true, perusahaanId: true, perusahaan: { select: { nama: true, aktif: true } } } }, mitra: { select: { proyekId: true, nama: true } } } as const;

/** Jurnal Talangan Mitra (JU-TLM, D5 §4.1). Menyimpan jurnalId di dokumen. Dokumen yang sudah dijurnal ditolak. */
export async function postingTalanganMitra(tx: Tx, id: string): Promise<void> {
  const d = await tx.talanganMitra.findUniqueOrThrow({
    where: { id },
    include: { ...PILIH_PROYEK, akunBeban: { select: { kode: true, jenis: true, kelompok: true } } },
  });
  if (d.jurnalId) throw new Error(`Talangan Mitra ${d.nomor} sudah dijurnal`);
  pastikanSatuProyek(d);
  const jumlah = D(d.jumlah);
  if (!jumlah.gt(0)) throw new Error(`Jumlah talangan ${d.nomor} harus lebih dari 0`);
  if (d.akunBeban.jenis !== "BEBAN" || d.akunBeban.kelompok) throw new Error("Akun beban harus akun Beban rinci (bukan kelompok)");
  // berurutan: tx interaktif menjalankan satu kueri sekali jalan
  const hutang = await akunPeranMitra(tx, "hutangMitra");
  const bagiHasil = await akunKeuanganProyek(tx);
  if (bagiHasil.bebanBagiHasil?.id === d.akunBebanId) throw new Error("Akun Bagi Hasil Mitra Proyek tidak boleh dipakai untuk talangan");
  const NOL = D(0);
  const jurnal = await catatJurnal(
    tx,
    "JU-TLM",
    `Talangan Mitra ${d.nomor} ${d.mitra.nama}: ${d.deskripsi}`,
    "MITRA_PROYEK",
    [
      { akunId: d.akunBebanId, debit: jumlah, kredit: NOL, keterangan: `${d.deskripsi}${d.vendor ? ` (${d.vendor})` : ""}` },
      { akunId: hutang.id, debit: NOL, kredit: jumlah, keterangan: `Hutang ke mitra ${d.mitra.nama}` },
    ],
    { tanggal: d.tanggal, proyekId: d.proyekId, perusahaanId: d.proyek.perusahaanId },
  );
  if (jurnal) await tx.talanganMitra.update({ where: { id }, data: { jurnalId: jurnal.id } });
}

/** Pesan pengembalian modal yang melebihi sisa (D5 §3.11), sama saat dibuat dan saat posting. */
export function pesanModalMelebihi(namaMitra: string, sisa: Desimal): string {
  return `Pengembalian modal melebihi sisa modal ${namaMitra} (Rp ${format(sisa)}). Kelebihannya catat sebagai bagi laba`;
}

/**
 * Jurnal Pembayaran ke Mitra (JU-BYM, D5 §4.1). Jenis MODAL mengunci baris mitra lalu memeriksa ulang sisa modal (hanya
 * dokumen DISETUJUI, dokumen ini dikecualikan), karena talangan bisa dihapus atau pengembalian lain disetujui lebih dulu
 * sejak draf dibuat. Menyimpan jurnalId di dokumen.
 */
export async function postingPembayaranMitra(tx: Tx, id: string): Promise<void> {
  const d = await tx.pembayaranMitra.findUniqueOrThrow({
    where: { id },
    include: { ...PILIH_PROYEK, akunKas: { select: { kasBank: true, kelompok: true } } },
  });
  if (d.jurnalId) throw new Error(`Pembayaran ke Mitra ${d.nomor} sudah dijurnal`);
  pastikanSatuProyek(d);
  const jumlah = D(d.jumlah);
  if (!jumlah.gt(0)) throw new Error(`Jumlah pembayaran ${d.nomor} harus lebih dari 0`);
  if (!d.akunKas.kasBank || d.akunKas.kelompok) throw new Error("Akun sumber harus akun kas/bank");
  const modal = d.jenis === "MODAL";
  if (modal) {
    const sisa = await sisaModalMitra(tx, d.mitraId, { hanyaDisetujui: true, kecualiPembayaranId: id, kunci: true });
    if (jumlah.gt(sisa)) throw new Error(pesanModalMelebihi(d.mitra.nama, sisa));
  }
  const akunDebit = await akunPeranMitra(tx, modal ? "hutangMitra" : "bebanBagiHasil");
  const NOL = D(0);
  const jurnal = await catatJurnal(
    tx,
    "JU-BYM",
    `Pembayaran ke Mitra ${d.nomor} ${d.mitra.nama} (${modal ? "pengembalian modal" : "bagi laba"})`,
    "MITRA_PROYEK",
    [
      { akunId: akunDebit.id, debit: jumlah, kredit: NOL, keterangan: `${modal ? "Pengembalian modal" : "Bagi laba"} ${d.mitra.nama}` },
      { akunId: d.akunKasId, debit: NOL, kredit: jumlah, keterangan: `Bayar ${d.mitra.nama}${d.catatan ? `: ${d.catatan}` : ""}` },
    ],
    { tanggal: d.tanggal, proyekId: d.proyekId, perusahaanId: d.proyek.perusahaanId },
  );
  if (jurnal) await tx.pembayaranMitra.update({ where: { id }, data: { jurnalId: jurnal.id } });
}

/**
 * Pemeriksaan hapus Talangan Mitra yang sudah DISETUJUI (D5 §4.6): baris mitra dikunci, lalu Σ talangan DISETUJUI
 * tanpa dokumen ini dikurangi Σ pengembalian modal DISETUJUI tidak boleh negatif.
 */
export async function pastikanTalanganBolehDihapus(tx: Tx, d: { id: string; nomor: string; mitraId: string; mitra: { nama: string } }): Promise<void> {
  await kunciBarisMitra(tx, d.mitraId);
  const talangan = await tx.talanganMitra.findMany({ where: { mitraId: d.mitraId, statusPersetujuan: "DISETUJUI", id: { not: d.id } }, select: { jumlah: true } });
  const modal = await tx.pembayaranMitra.findMany({ where: { mitraId: d.mitraId, jenis: "MODAL", statusPersetujuan: "DISETUJUI" }, select: { nomor: true, jumlah: true }, orderBy: { nomor: "asc" } });
  const sisa = jumlahkan(talangan.map((t) => t.jumlah)).minus(jumlahkan(modal.map((m) => m.jumlah)));
  if (sisa.lt(0)) throw new Error(`${d.nomor} sudah dikembalikan sebagai modal ke ${d.mitra.nama} lewat ${modal.map((m) => m.nomor).join(", ")}. Hapus pengembalian modalnya dulu`);
}
