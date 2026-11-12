import type { Prisma } from "@/prisma-klien/client";
import { peranTertinggi, type PenggunaSesi } from "@/lib/hakAkses";
import { BERKAS, hakSetujui, type AksiPersetujuan, type JenisPersetujuan } from "@/lib/persetujuan";
import { kirimNotifikasi, penggunaDenganHak, tanpaSuperadminKecualiKosong } from "@/lib/notifikasi";

/*
 * Notifikasi alur persetujuan dokumen akuntansi lama (D7 §3.4.4). Dipanggil aksi ajukan, setujui, dan tolak
 * di dalam transaksinya, tepat setelah log persetujuan. Tidak menulis LogAktivitas. Galat di sini tidak boleh
 * menggagalkan persetujuan (DESAIN G14): beritahuPersetujuan memakai SAVEPOINT, jadi kegagalan notifikasi
 * dibatalkan sendiri, dicatat ke log server, dan transaksi dokumen tetap berjalan.
 */

type Tx = Prisma.TransactionClient;

export type MasukanBeritahuPersetujuan = {
  aksi: AksiPersetujuan;
  jenis: JenisPersetujuan;
  id: string;
  pelaku: PenggunaSesi;
  nomor: string;
  /** Pengaju dokumen (dok.diajukanOlehId); penerima hasil setujui dan tolak. */
  pengajuId: string | null;
  /** Alasan penolakan (aksi TOLAK). */
  catatan?: string | null;
};

/** Perusahaan dokumen per jenis persetujuan (kolom D1); dipakai untuk mengganti lingkup saat notifikasi dibuka. */
const PERUSAHAAN_DOKUMEN: Record<JenisPersetujuan, (tx: Tx, id: string) => Promise<{ perusahaanId: string } | null>> = {
  faktur: (tx, id) => tx.fakturPenjualan.findUnique({ where: { id }, select: { perusahaanId: true } }),
  fakturPembelian: (tx, id) => tx.fakturPembelian.findUnique({ where: { id }, select: { perusahaanId: true } }),
  dokumenKas: (tx, id) => tx.dokumenKas.findUnique({ where: { id }, select: { perusahaanId: true } }),
  penyesuaian: (tx, id) => tx.penyesuaianPersediaan.findUnique({ where: { id }, select: { perusahaanId: true } }),
  peminjaman: (tx, id) => tx.peminjamanBarang.findUnique({ where: { id }, select: { perusahaanId: true } }),
  kerusakan: (tx, id) => tx.laporanKerusakanBarang.findUnique({ where: { id }, select: { perusahaanId: true } }),
  aset: (tx, id) => tx.asetTetap.findUnique({ where: { id }, select: { perusahaanId: true } }),
  penggajian: (tx, id) => tx.penggajian.findUnique({ where: { id }, select: { perusahaanId: true } }),
  talanganMitra: (tx, id) => tx.talanganMitra.findUnique({ where: { id }, select: { perusahaanId: true } }),
  pembayaranMitra: (tx, id) => tx.pembayaranMitra.findUnique({ where: { id }, select: { perusahaanId: true } }),
};

/**
 * Jenis yang halaman dokumennya belum ada (dokumen mitra proyek, D5 §7.1; dibuat paket Keuangan Proyek). Notifikasi
 * hasil persetujuannya tanpa tautan sampai halaman itu ada, karena aplikasi tidak menaut ke halaman yang belum ada.
 */
const TANPA_HALAMAN_DOKUMEN: ReadonlySet<JenisPersetujuan> = new Set(["talanganMitra", "pembayaranMitra"]);

/** Label dokumen untuk teks notifikasi; Kas Masuk dan Kas Keluar dibedakan menurut kode haknya. */
function labelDokumen(jenis: JenisPersetujuan, kode: string): string {
  if (jenis === "dokumenKas") return kode === "kas-masuk" ? "Kas Masuk" : "Kas Keluar";
  return BERKAS[jenis].label;
}

/**
 * Halaman tempat pengaju melihat dokumennya. Kas memakai kode hasil hakSetujui karena jalur[0] selalu Kas Masuk.
 * null untuk jenis yang halaman dokumennya belum ada (TANPA_HALAMAN_DOKUMEN).
 */
export function tautanDokumenPersetujuan(jenis: JenisPersetujuan, kode: string): string | null {
  if (TANPA_HALAMAN_DOKUMEN.has(jenis)) return null;
  if (jenis === "dokumenKas") return kode === "kas-masuk" ? "/kas-bank/masuk" : "/kas-bank/keluar";
  return BERKAS[jenis].jalur[0];
}

/** Halaman tempat pemeriksa menyetujui. Gudang dialihkan dari /persetujuan, jadi dokumen persediaannya ke halamannya sendiri. */
function tautanAntrean(jenis: JenisPersetujuan): string {
  if (jenis === "peminjaman") return "/persediaan/peminjaman";
  if (jenis === "kerusakan") return "/persediaan/kerusakan";
  return "/persetujuan";
}

async function kirim(tx: Tx, m: MasukanBeritahuPersetujuan): Promise<number> {
  const kodeHak = await hakSetujui(m.jenis, tx, m.id);
  const kode = kodeHak.slice(0, kodeHak.lastIndexOf("."));
  const label = labelDokumen(m.jenis, kode);
  const perusahaanId = (await PERUSAHAAN_DOKUMEN[m.jenis](tx, m.id))?.perusahaanId ?? null;

  if (m.aksi === "AJUKAN") {
    // Pelaku dibuang lebih dulu, baru aturan tanpa Superadmin, supaya pengajuan tidak pernah tanpa penerima.
    let calon = (await penggunaDenganHak(tx, kodeHak)).filter((p) => p.id !== m.pelaku.id);
    // Peminjaman yang diajukan Gudang hanya boleh disetujui Pemilik/Superadmin (BERKAS.peminjaman.pastikanBolehSetujui)
    if (m.jenis === "peminjaman" && m.pelaku.peran === "GUDANG") calon = calon.filter((p) => peranTertinggi(p.peran));
    const penerima = tanpaSuperadminKecualiKosong(calon);
    return kirimNotifikasi(tx, {
      penggunaIds: penerima.map((p) => p.id),
      kecuali: m.pelaku.id,
      judul: `Persetujuan diminta: ${label} ${m.nomor}`,
      isi: `Diajukan oleh ${m.pelaku.nama}`,
      tautan: tautanAntrean(m.jenis),
      jenis: "PERSETUJUAN",
      perusahaanId,
    });
  }

  const disetujui = m.aksi === "SETUJUI";
  return kirimNotifikasi(tx, {
    penggunaIds: [m.pengajuId],
    kecuali: m.pelaku.id,
    judul: `${label} ${m.nomor} ${disetujui ? "disetujui" : "ditolak"}`,
    isi: disetujui ? `Disetujui oleh ${m.pelaku.nama}` : `Alasan: ${(m.catatan ?? "").trim()}`,
    tautan: tautanDokumenPersetujuan(m.jenis, kode),
    jenis: "HASIL_PERSETUJUAN",
    perusahaanId,
  });
}

/**
 * Memberi tahu pemeriksa (ajukan) atau pengaju (setujui, tolak). Selalu dipanggil di dalam transaksi persetujuan.
 * Mengembalikan jumlah notifikasi tersimpan; bila gagal, perubahan notifikasi dibatalkan ke SAVEPOINT, galat
 * dicatat, dan kembaliannya 0 sehingga persetujuan dokumen tetap tersimpan.
 */
export async function beritahuPersetujuan(tx: Tx, m: MasukanBeritahuPersetujuan): Promise<number> {
  await tx.$executeRawUnsafe("SAVEPOINT notifikasi_persetujuan");
  try {
    const jumlah = await kirim(tx, m);
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT notifikasi_persetujuan");
    return jumlah;
  } catch (galat) {
    console.error("[notifikasi persetujuan]", galat);
    try {
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT notifikasi_persetujuan");
    } catch {
      // Transaksi sudah tertutup (mis. lewat batas waktu): galat notifikasi aslinya yang dilempar, bukan galat ROLLBACK
      throw galat;
    }
    return 0;
  }
}
