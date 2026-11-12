import { createHash, randomBytes } from "node:crypto";
import type { PeranPengguna, Prisma, TagBerkas } from "@/prisma-klien/client";
import { PERAN_DAPAT_DIATUR, peranEfektif, punyaHak, type Hak, type PenggunaSesi } from "@/lib/hakAkses";
import { catatAktivitas, type KlienDb, type RuangTersembunyi } from "@/lib/log";
import { perusahaanDokumenBaru } from "@/lib/perusahaan";
import { bersihkanNamaBerkas, deteksiTipe, disajikanInline, kepalaDisposisi } from "@/lib/tipeBerkas";
import { loloskanWildcard, normalkanKataCari } from "@/lib/daftar";

/*
 * Pustaka berkas (D7 §3.3, §6.1). Isi berkas disimpan di PostgreSQL (IsiBerkas), metadatanya di Berkas.
 * Bukan "use server": dipakai route handler, aksi server, halaman, domain lain, dan skrip uji. Semua fungsi
 * menerima klien (db atau tx) dari pemanggil; tidak ada yang mengimpor db langsung.
 */

export { bersihkanNamaBerkas, deteksiTipe, kepalaDisposisi, ekstensiNama, keluargaDariMime, disajikanInline, type KeluargaBerkas } from "@/lib/tipeBerkas";
export type { RuangTersembunyi } from "@/lib/log";

// ---------- Konstanta (D7 §3.3.1) ----------

/** 25 MB, sama dengan batas unggah HKA. */
export const BATAS_UKURAN_BERKAS = 26_214_400;
/** Batas badan permintaan unggah: berkas + 1 MiB kepala multipart. */
export const BATAS_PERMINTAAN_UNGGAH = 27_262_976;
export const MAKS_TAUTAN_AKTIF = 10;
export const MASA_BERLAKU_TAUTAN = [1, 7, 30] as const;
export const MASA_BERLAKU_BAWAAN = 7;
export const FOLDER_BAWAAN = "LAINNYA";
export const PESAN_BERKAS_TIDAK_ADA = "Berkas tidak ditemukan";
export const PESAN_TAUTAN_TIDAK_BERLAKU = "Tautan tidak berlaku atau sudah kedaluwarsa";
const TAG_BERKAS: readonly TagBerkas[] = ["REFERENSI", "HASIL", "DOKUMEN"];

/** Pengguna semu skrip uji tidak ada di tabel Pengguna, jadi tidak boleh ditulis sebagai kunci asing. */
const idTersimpan = (pengguna: { id: string }) => (pengguna.id === "skrip-uji" ? null : pengguna.id);

/** Jalankan fn dalam transaksi bila klien masih db; bila klien sudah tx, langsung di tx itu. */
async function dalamTransaksi<T>(klien: KlienDb, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  // unggahan 25 MB bisa lebih lama dari batas bawaan transaksi interaktif (5 detik)
  if ("$transaction" in klien) return klien.$transaction((tx) => fn(tx), { timeout: 60_000 });
  return fn(klien);
}

// ---------- Registri jenis lampiran (D7 §3.3.4, DESAIN §3.3) ----------

export type InfoEntitas = { perusahaanId: string; proyekId: string | null; label: string };

export type JenisLampiran = {
  label: string;
  /** syarat mutlak melihat berkas jenis ini */
  hakLihat: Hak;
  /** salah satu cukup, untuk unggah tanpa berkas.buat */
  hakUnggah: readonly Hak[];
  /** ganti nama/pindah folder tanpa berkas.ubah */
  hakUbah: readonly Hak[];
  /** buang/pulihkan tanpa berkas.hapus */
  hakHapus: readonly Hak[];
  folderBawaan: string;
  /** berkas tetap tersembunyi bila folder ini tersembunyi, walau dipindah ke folder lain */
  folderKunci?: string;
  /** pembaca entitas; null bila tidak ada, terarsip, atau terhapus */
  baca: (klien: KlienDb, id: string) => Promise<InfoEntitas | null>;
  /** halaman entitas; info dipakai jenis yang tautannya butuh proyek */
  tautan: (id: string, info?: InfoEntitas | null) => string;
};

const dokumen = (kode: "penawaran" | "pesanan" | "uang-muka" | "faktur" | "penerimaan") => ({
  hakLihat: `${kode}.lihat` as Hak,
  hakUnggah: [`${kode}.buat`, `${kode}.ubah`] as Hak[],
  hakUbah: [`${kode}.buat`, `${kode}.ubah`] as Hak[],
  hakHapus: [`${kode}.hapus`] as Hak[],
});
const dokumenLama = (kode: "faktur-pembelian" | "pembayaran" | "kas-masuk" | "kas-keluar" | "jurnal" | "aset") => ({
  hakLihat: `${kode}.lihat` as Hak,
  hakUnggah: [`${kode}.buat`] as Hak[],
  hakUbah: [`${kode}.buat`] as Hak[],
  hakHapus: [`${kode}.hapus`] as Hak[],
});

async function bacaDokumenKas(klien: KlienDb, id: string, jenis: "MASUK" | "KELUAR"): Promise<InfoEntitas | null> {
  const d = await klien.dokumenKas.findUnique({ where: { id }, select: { perusahaanId: true, proyekId: true, nomor: true, jenis: true } });
  return d && d.jenis === jenis ? { perusahaanId: d.perusahaanId, proyekId: d.proyekId, label: d.nomor } : null;
}

async function bacaTugasDesain(klien: KlienDb, id: string): Promise<InfoEntitas | null> {
  const t = await klien.tugasDesain.findUnique({ where: { id }, select: { perusahaanId: true, proyekId: true, judul: true, diarsipkanPada: true } });
  return t && !t.diarsipkanPada ? { perusahaanId: t.perusahaanId, proyekId: t.proyekId, label: t.judul } : null;
}

async function bacaProyek(klien: KlienDb, id: string): Promise<InfoEntitas | null> {
  const p = await klien.proyek.findUnique({ where: { id }, select: { perusahaanId: true, kode: true } });
  return p ? { perusahaanId: p.perusahaanId, proyekId: id, label: p.kode } : null;
}

export const JENIS_LAMPIRAN = {
  penawaran: {
    label: "Penawaran Penjualan",
    ...dokumen("penawaran"),
    folderBawaan: "PENAWARAN",
    folderKunci: "PENAWARAN",
    baca: async (klien, id) => {
      const d = await klien.penawaranPenjualan.findUnique({ where: { id }, select: { perusahaanId: true, proyekId: true, nomor: true } });
      return d ? { perusahaanId: d.perusahaanId, proyekId: d.proyekId, label: d.nomor } : null;
    },
    tautan: () => "/penjualan/penawaran",
  },
  pesanan: {
    label: "Pesanan Penjualan",
    ...dokumen("pesanan"),
    folderBawaan: "DOKUMEN",
    baca: async (klien, id) => {
      const d = await klien.pesananPenjualan.findUnique({ where: { id }, select: { perusahaanId: true, proyekId: true, nomor: true } });
      return d ? { perusahaanId: d.perusahaanId, proyekId: d.proyekId, label: d.nomor } : null;
    },
    tautan: () => "/penjualan/pesanan",
  },
  "uang-muka": {
    label: "Uang Muka Pelanggan",
    ...dokumen("uang-muka"),
    folderBawaan: "KUITANSI",
    folderKunci: "KUITANSI",
    baca: async (klien, id) => {
      const d = await klien.uangMukaPelanggan.findUnique({ where: { id }, select: { perusahaanId: true, nomor: true, pesanan: { select: { proyekId: true } } } });
      return d ? { perusahaanId: d.perusahaanId, proyekId: d.pesanan.proyekId, label: d.nomor } : null;
    },
    tautan: () => "/penjualan/uang-muka",
  },
  faktur: {
    label: "Faktur Penjualan",
    ...dokumen("faktur"),
    folderBawaan: "FAKTUR",
    folderKunci: "FAKTUR",
    baca: async (klien, id) => {
      const d = await klien.fakturPenjualan.findUnique({ where: { id }, select: { perusahaanId: true, nomor: true, pesanan: { select: { proyekId: true } } } });
      return d ? { perusahaanId: d.perusahaanId, proyekId: d.pesanan?.proyekId ?? null, label: d.nomor } : null;
    },
    tautan: () => "/penjualan/faktur",
  },
  penerimaan: {
    label: "Penerimaan Penjualan",
    ...dokumen("penerimaan"),
    folderBawaan: "KUITANSI",
    folderKunci: "KUITANSI",
    baca: async (klien, id) => {
      const d = await klien.penerimaanPenjualan.findUnique({ where: { id }, select: { perusahaanId: true, nomor: true, faktur: { select: { pesanan: { select: { proyekId: true } } } } } });
      return d ? { perusahaanId: d.perusahaanId, proyekId: d.faktur.pesanan?.proyekId ?? null, label: d.nomor } : null;
    },
    tautan: () => "/penjualan/penerimaan",
  },
  "faktur-pembelian": {
    label: "Faktur Pembelian",
    ...dokumenLama("faktur-pembelian"),
    folderBawaan: "KEUANGAN",
    baca: async (klien, id) => {
      const d = await klien.fakturPembelian.findUnique({ where: { id }, select: { perusahaanId: true, nomor: true, pesanan: { select: { proyekId: true } } } });
      return d ? { perusahaanId: d.perusahaanId, proyekId: d.pesanan?.proyekId ?? null, label: d.nomor } : null;
    },
    tautan: () => "/pembelian/faktur",
  },
  pembayaran: {
    label: "Pembayaran Pembelian",
    ...dokumenLama("pembayaran"),
    folderBawaan: "KEUANGAN",
    baca: async (klien, id) => {
      const d = await klien.pembayaranPembelian.findUnique({ where: { id }, select: { perusahaanId: true, nomor: true, faktur: { select: { pesanan: { select: { proyekId: true } } } } } });
      return d ? { perusahaanId: d.perusahaanId, proyekId: d.faktur.pesanan?.proyekId ?? null, label: d.nomor } : null;
    },
    tautan: () => "/pembelian/pembayaran",
  },
  "kas-masuk": {
    label: "Kas Masuk",
    ...dokumenLama("kas-masuk"),
    folderBawaan: "KEUANGAN",
    baca: (klien, id) => bacaDokumenKas(klien, id, "MASUK"),
    tautan: () => "/kas-bank/masuk",
  },
  "kas-keluar": {
    label: "Kas Keluar",
    ...dokumenLama("kas-keluar"),
    folderBawaan: "KEUANGAN",
    baca: (klien, id) => bacaDokumenKas(klien, id, "KELUAR"),
    tautan: () => "/kas-bank/keluar",
  },
  jurnal: {
    label: "Jurnal Umum",
    ...dokumenLama("jurnal"),
    folderBawaan: "KEUANGAN",
    baca: async (klien, id) => {
      const d = await klien.jurnal.findUnique({ where: { id }, select: { perusahaanId: true, proyekId: true, nomor: true } });
      return d ? { perusahaanId: d.perusahaanId, proyekId: d.proyekId, label: d.nomor } : null;
    },
    tautan: () => "/buku-besar/jurnal",
  },
  aset: {
    label: "Aset Tetap",
    ...dokumenLama("aset"),
    folderBawaan: "DOKUMEN",
    baca: async (klien, id) => {
      const d = await klien.asetTetap.findUnique({ where: { id }, select: { perusahaanId: true, kode: true } });
      return d ? { perusahaanId: d.perusahaanId, proyekId: null, label: d.kode } : null;
    },
    tautan: () => "/aset-tetap",
  },
  proyek: {
    // HAK.md §7 no. 13: lihat lewat proyek.lihat (peran pemasaran ikut), ubah tetap data-induk.tulis
    label: "Proyek/Event",
    hakLihat: "proyek.lihat",
    hakUnggah: ["data-induk.tulis"],
    hakUbah: ["data-induk.tulis"],
    hakHapus: ["data-induk.tulis"],
    folderBawaan: "DOKUMEN",
    baca: bacaProyek,
    // halaman detail proyek memakai hak yang sama dengan hakLihat jenis ini (P46)
    tautan: (id) => `/proyek/${id}`,
  },
  "rencana-termin": {
    // PDF tagihan termin (D2); pesanan.ubah ikut karena tagihan termin diterbitkan lewat hak itu
    label: "Tagihan Termin",
    hakLihat: "pesanan.lihat",
    hakUnggah: ["pesanan.buat", "pesanan.ubah"],
    hakUbah: ["pesanan.buat", "pesanan.ubah"],
    hakHapus: ["pesanan.hapus"],
    folderBawaan: "DOKUMEN",
    baca: async (klien, id) => {
      const t = await klien.rencanaTermin.findUnique({
        where: { id },
        select: { perusahaanId: true, no: true, label: true, pesanan: { select: { nomor: true, proyekId: true } }, penawaran: { select: { nomor: true, proyekId: true } } },
      });
      if (!t) return null;
      const induk = t.pesanan ?? t.penawaran;
      return { perusahaanId: t.perusahaanId, proyekId: induk?.proyekId ?? null, label: `${induk?.nomor ?? "Termin"} termin ${t.no}` };
    },
    tautan: () => "/penjualan/pesanan",
  },
  konten: {
    label: "Konten Media Sosial",
    hakLihat: "konten.lihat",
    hakUnggah: ["konten.ubah"],
    hakUbah: ["konten.ubah"],
    hakHapus: ["konten.hapus"],
    folderBawaan: "SOSMED",
    baca: async (klien, id) => {
      const k = await klien.konten.findUnique({ where: { id }, select: { perusahaanId: true, proyekId: true, judul: true, diarsipkanPada: true } });
      return k && !k.diarsipkanPada ? { perusahaanId: k.perusahaanId, proyekId: k.proyekId, label: k.judul } : null;
    },
    tautan: (id) => `/pemasaran/konten?konten=${id}`,
  },
  "tugas-desain": {
    label: "Tugas Desain (referensi)",
    hakLihat: "tugas-desain.lihat",
    hakUnggah: ["tugas-desain.ubah", "tugas-desain.buat"],
    hakUbah: ["tugas-desain.ubah"],
    hakHapus: ["tugas-desain.hapus"],
    folderBawaan: "DESAIN",
    baca: bacaTugasDesain,
    tautan: (id) => `/pemasaran/desain?tugas=${id}`,
  },
  "hasil-desain": {
    label: "Hasil Desain",
    hakLihat: "tugas-desain.lihat",
    hakUnggah: ["tugas-desain.ubah"],
    hakUbah: ["tugas-desain.ubah"],
    hakHapus: ["tugas-desain.hapus"],
    folderBawaan: "DESAIN",
    baca: bacaTugasDesain,
    tautan: (id) => `/pemasaran/desain?tugas=${id}`,
  },
  kampanye: {
    label: "Kampanye Iklan",
    hakLihat: "kampanye.lihat",
    hakUnggah: ["kampanye.ubah"],
    hakUbah: ["kampanye.ubah"],
    hakHapus: ["kampanye.hapus"],
    folderBawaan: "IKLAN",
    baca: async (klien, id) => {
      const k = await klien.kampanye.findUnique({ where: { id }, select: { perusahaanId: true, proyekId: true, nama: true, diarsipkanPada: true } });
      return k && !k.diarsipkanPada ? { perusahaanId: k.perusahaanId, proyekId: k.proyekId, label: k.nama } : null;
    },
    tautan: (id) => `/pemasaran/iklan/${id}`,
  },
  "kop-surat": {
    label: "Kop Surat",
    hakLihat: "pengaturan.tulis",
    hakUnggah: ["pengaturan.tulis"],
    hakUbah: ["pengaturan.tulis"],
    hakHapus: ["pengaturan.tulis"],
    folderBawaan: "KOP",
    baca: async (klien, id) => {
      const k = await klien.kopSurat.findUnique({ where: { id }, select: { perusahaanId: true, nama: true, dihapusPada: true } });
      return k && !k.dihapusPada ? { perusahaanId: k.perusahaanId, proyekId: null, label: `Kop ${k.nama}` } : null;
    },
    tautan: (id) => `/pengaturan/perusahaan/kop/${id}`,
  },
  "talangan-mitra": {
    label: "Talangan Mitra",
    hakLihat: "talangan-mitra.lihat",
    hakUnggah: ["talangan-mitra.buat"],
    hakUbah: ["talangan-mitra.buat"],
    hakHapus: ["talangan-mitra.hapus"],
    folderBawaan: "KEUANGAN",
    baca: async (klien, id) => {
      const d = await klien.talanganMitra.findUnique({ where: { id }, select: { perusahaanId: true, proyekId: true, nomor: true } });
      return d ? { perusahaanId: d.perusahaanId, proyekId: d.proyekId, label: d.nomor } : null;
    },
    tautan: (id, info) => (info?.proyekId ? `/proyek/${info.proyekId}/keuangan/talangan/${id}` : "/proyek"),
  },
  "pembayaran-mitra": {
    label: "Pembayaran ke Mitra",
    hakLihat: "pembayaran-mitra.lihat",
    hakUnggah: ["pembayaran-mitra.buat"],
    hakUbah: ["pembayaran-mitra.buat"],
    hakHapus: ["pembayaran-mitra.hapus"],
    folderBawaan: "KEUANGAN",
    baca: async (klien, id) => {
      const d = await klien.pembayaranMitra.findUnique({ where: { id }, select: { perusahaanId: true, proyekId: true, nomor: true } });
      return d ? { perusahaanId: d.perusahaanId, proyekId: d.proyekId, label: d.nomor } : null;
    },
    tautan: (id, info) => (info?.proyekId ? `/proyek/${info.proyekId}/keuangan/bayar/${id}` : "/proyek"),
  },
  "laporan-keuangan-proyek": {
    // terpisah dari jenis proyek supaya PDF berisi margin dan bagi hasil tidak terbuka bagi pemegang proyek.lihat saja (D5 §5.3)
    label: "Laporan Keuangan Proyek",
    hakLihat: "anggaran-proyek.lihat",
    hakUnggah: ["anggaran-proyek.ubah"],
    hakUbah: ["anggaran-proyek.ubah"],
    hakHapus: ["anggaran-proyek.hapus"],
    folderBawaan: "KEUANGAN",
    baca: bacaProyek,
    tautan: (id) => `/proyek/${id}/keuangan`,
  },
} satisfies Record<string, JenisLampiran>;

export type JenisEntitas = keyof typeof JENIS_LAMPIRAN;
export const DAFTAR_JENIS = Object.keys(JENIS_LAMPIRAN) as JenisEntitas[];

export function jenisLampiranSah(nilai: string | null | undefined): nilai is JenisEntitas {
  return !!nilai && Object.prototype.hasOwnProperty.call(JENIS_LAMPIRAN, nilai);
}

/** Entri registri untuk jenis tersimpan; undefined untuk null atau jenis tak dikenal. */
export function jenisLampiran(nilai: string | null | undefined): JenisLampiran | undefined {
  return jenisLampiranSah(nilai) ? JENIS_LAMPIRAN[nilai] : undefined;
}

/** Pemetaan jenis cetak penjualan ke jenis lampiran (DESAIN §3.3). */
export const JENIS_CETAK_KE_LAMPIRAN = {
  penawaran: "penawaran",
  faktur: "faktur",
  kwitansi: "penerimaan",
  "kwitansi-dp": "uang-muka",
  "tagihan-termin": "rencana-termin",
} as const satisfies Record<string, JenisEntitas>;

// ---------- Hak per berkas (D7 §3.3.5) ----------

export type AksiBerkas = "lihat" | "unduh" | "unggah" | "ubah" | "hapus" | "bagikan";
const HAK_BERKAS: Record<AksiBerkas, Hak> = {
  lihat: "berkas.lihat",
  unduh: "berkas.lihat",
  unggah: "berkas.buat",
  ubah: "berkas.ubah",
  hapus: "berkas.hapus",
  bagikan: "berkas.bagikan",
};

/** Hak aksi atas berkas menurut jenis lampirannya. Pembatasan folder/proyek dinilai terpisah (berkasTersembunyi). */
export function bolehAksesBerkas(pengguna: PenggunaSesi, berkas: { jenisEntitas: string | null }, aksi: AksiBerkas): boolean {
  const j = jenisLampiran(berkas.jenisEntitas);
  if (berkas.jenisEntitas && !j) return punyaHak(pengguna, "berkas.akses-penuh"); // jenis tak dikenal
  if (j && !punyaHak(pengguna, j.hakLihat)) return false; // 1. modul tidak boleh dilihat
  if (punyaHak(pengguna, HAK_BERKAS[aksi])) return true; // 2. hak berkas umum
  if (aksi === "bagikan" || !j) return false; // 3. bagikan selalu butuh berkas.bagikan
  if (aksi === "lihat" || aksi === "unduh") return true; // 4. lewat hak lihat modul
  const daftar = aksi === "unggah" ? j.hakUnggah : aksi === "ubah" ? j.hakUbah : j.hakHapus;
  return daftar.some((h) => punyaHak(pengguna, h));
}

// ---------- Ruang tersembunyi dan syarat kueri (D7 §3.3.8) ----------

/** Jenis lampiran yang hak lihatnya tidak dimiliki pengguna: berkasnya dan catatan log-nya tersembunyi. */
export function jenisLampiranTanpaHakLihat(pengguna: PenggunaSesi): JenisEntitas[] {
  return DAFTAR_JENIS.filter((k) => !punyaHak(pengguna, JENIS_LAMPIRAN[k].hakLihat));
}

/** Folder terbatas dan proyek terbatas yang tidak boleh dibuka pengguna. null = akses penuh. */
export async function ruangTersembunyi(klien: KlienDb, pengguna: PenggunaSesi): Promise<RuangTersembunyi> {
  if (punyaHak(pengguna, "berkas.akses-penuh")) return null;
  const peran = peranEfektif(pengguna);
  const id = idTersimpan(pengguna);
  const [folder, proyek] = await Promise.all([
    klien.folderBerkas.findMany({ where: { terbatas: true }, select: { kode: true, peranBoleh: true } }),
    klien.aksesBerkasProyek.findMany({ select: { proyekId: true, peranBoleh: true, pengguna: { where: { penggunaId: id ?? "" }, select: { penggunaId: true } } } }),
  ]);
  return {
    folder: folder.filter((f) => !f.peranBoleh.some((p) => peran.includes(p))).map((f) => f.kode),
    proyek: proyek.filter((a) => !a.peranBoleh.some((p) => peran.includes(p)) && a.pengguna.length === 0).map((a) => a.proyekId),
  };
}

export function berkasTersembunyi(b: { folderKode: string; jenisEntitas: string | null; proyekId: string | null }, ruang: RuangTersembunyi): boolean {
  if (!ruang) return false;
  const kunci = jenisLampiran(b.jenisEntitas)?.folderKunci;
  return ruang.folder.includes(b.folderKode) || (!!kunci && ruang.folder.includes(kunci)) || (!!b.proyekId && ruang.proyek.includes(b.proyekId));
}

/** Slot kop bernilai hukum (D3): gambarnya butuh pengaturan.tulis DAN tanda-tangan-cetak.buat (tinjauan P31 R4). */
export const SLOT_KOP_TANDA_TANGAN = ["TANDA_TANGAN", "STEMPEL"] as const;
export const slotTandaTangan = (jenis: string): boolean => (SLOT_KOP_TANDA_TANGAN as readonly string[]).includes(jenis);

/**
 * Syarat Prisma berkas terlihat (daftar, pencarian, lampiran, hitungan). Cabang null ditulis eksplisit karena di SQL
 * NOT IN bernilai NULL untuk kolom NULL, sehingga berkas umum dan berkas tanpa proyek ikut hilang tanpa cabang itu.
 * Berkas kop surat mengikuti ambilBerkasTerlihat: tanpa tanda-tangan-cetak.buat hanya gambar yang terpasang di slot
 * selain tanda tangan dan stempel yang terlihat (tinjauan P33 R4).
 */
export function syaratBerkasTerlihat(pengguna: PenggunaSesi, ruang: RuangTersembunyi, opsi: { sampah?: boolean } = {}): Prisma.BerkasWhereInput {
  const jenisBoleh = DAFTAR_JENIS.filter((k) => punyaHak(pengguna, JENIS_LAMPIRAN[k].hakLihat));
  const jenisKunciTersembunyi = ruang
    ? DAFTAR_JENIS.filter((k) => {
        const f = (JENIS_LAMPIRAN[k] as JenisLampiran).folderKunci;
        return !!f && ruang.folder.includes(f);
      })
    : [];
  return {
    AND: [
      opsi.sampah ? { dihapusPada: { not: null }, isiDihapusPada: null } : { dihapusPada: null },
      punyaHak(pengguna, "berkas.lihat") ? { OR: [{ jenisEntitas: null }, { jenisEntitas: { in: jenisBoleh } }] } : { jenisEntitas: { in: jenisBoleh } },
      ...(ruang
        ? [
            { folderKode: { notIn: ruang.folder } },
            { OR: [{ jenisEntitas: null }, { jenisEntitas: { notIn: jenisKunciTersembunyi } }] },
            { OR: [{ proyekId: null }, { proyekId: { notIn: ruang.proyek } }] },
          ]
        : []),
      ...(punyaHak(pengguna, "tanda-tangan-cetak.buat")
        ? []
        : [{ OR: [{ jenisEntitas: null }, { jenisEntitas: { not: "kop-surat" } }, { asetKopSurat: { is: { jenis: { notIn: [...SLOT_KOP_TANDA_TANGAN] } } } }] }]),
    ],
  };
}

// ---------- Metadata ----------

const PILIH_META = {
  id: true,
  perusahaanId: true,
  folderKode: true,
  namaBerkas: true,
  tipeMime: true,
  ukuran: true,
  sha256: true,
  jenisEntitas: true,
  entitasId: true,
  tag: true,
  proyekId: true,
  diunggahOlehId: true,
  diunggahOlehNama: true,
  dibuatPada: true,
  diubahPada: true,
  dihapusPada: true,
  dihapusOlehNama: true,
  isiDihapusPada: true,
} as const satisfies Prisma.BerkasSelect;

/** Metadata berkas tanpa isi biner. */
export type MetaBerkas = Prisma.BerkasGetPayload<{ select: typeof PILIH_META }>;

/**
 * Metadata berkas yang boleh dilihat pengguna, atau null bila tidak ada, sudah dibuang (kecuali opsi.sampah), isinya
 * sudah dihapus permanen, tersembunyi oleh ruang, atau tidak lolos hak lihat. Tidak pernah membaca isi.
 */
export async function ambilBerkasTerlihat(klien: KlienDb, pengguna: PenggunaSesi, id: string, opsi: { sampah?: boolean } = {}): Promise<MetaBerkas | null> {
  if (!id) return null;
  const b = await klien.berkas.findUnique({ where: { id }, select: PILIH_META });
  if (!b || b.isiDihapusPada) return null;
  if (opsi.sampah ? !b.dihapusPada : !!b.dihapusPada) return null;
  if (!bolehAksesBerkas(pengguna, b, "lihat")) return null;
  if (berkasTersembunyi(b, await ruangTersembunyi(klien, pengguna))) return null;
  // Gambar kop tanpa tanda-tangan-cetak.buat: hanya yang sedang terpasang di slot selain tanda tangan dan stempel.
  // Berkas kop yang sudah dilepas dari slotnya (di Sampah) tidak lagi diketahui slotnya, jadi ikut tertutup.
  if (b.jenisEntitas === "kop-surat" && !punyaHak(pengguna, "tanda-tangan-cetak.buat")) {
    const aset = await klien.asetKopSurat.findUnique({ where: { berkasId: b.id }, select: { jenis: true } });
    if (!aset || slotTandaTangan(aset.jenis)) return null;
  }
  return b;
}

// ---------- Log berkas (D7 §3.3.16) ----------

/**
 * Catatan log modul berkas. meta selalu memuat folder, folderKunci, jenisEntitas, dan proyekId (null ditulis sebagai
 * JSON null, bukan dihilangkan) karena syaratLogTerlihat membandingkan keempat path itu.
 */
export async function catatLogBerkas(
  klien: KlienDb,
  pelaku: PenggunaSesi,
  b: { id: string; namaBerkas: string; folderKode: string; proyekId: string | null; perusahaanId: string; jenisEntitas: string | null },
  aksi: string,
  tambahan: { keterangan?: string | null; meta?: Record<string, Prisma.InputJsonValue | null> } = {},
): Promise<void> {
  await catatAktivitas(klien, pelaku, {
    aksi,
    jenis: "Berkas",
    nomor: b.namaBerkas,
    keterangan: tambahan.keterangan ?? null,
    modul: "berkas",
    entitasId: b.id,
    perusahaanId: b.perusahaanId,
    meta: { ...(tambahan.meta ?? {}), ...metaRuangLog(b.folderKode, b.jenisEntitas, b.proyekId) },
  });
}

/** Empat kunci meta yang disaring syaratLogTerlihat. Dipakai juga pencatat log berkas di luar catatLogBerkas. */
export function metaRuangLog(folder: string | null, jenisEntitas: string | null, proyekId: string | null): { folder: string | null; folderKunci: string | null; jenisEntitas: string | null; proyekId: string | null } {
  return { folder, folderKunci: jenisLampiran(jenisEntitas)?.folderKunci ?? null, jenisEntitas: jenisEntitas ?? null, proyekId };
}

// ---------- Unggah (D7 §3.3.9) ----------

export type HasilBerkas<T> = { ok: true; nilai: T } | { ok: false; status: 400 | 401 | 403 | 404 | 411 | 413 | 415; galat: string };

export type MasukanBerkas = {
  berkas: FormDataEntryValue | null;
  folderKode?: string | null;
  jenisEntitas?: string | null;
  entitasId?: string | null;
  tag?: string | null;
  proyekId?: string | null;
  /** perusahaan unggahan umum; kosong = isian perusahaanId di dataFormulir, lalu lingkup aktif */
  perusahaanId?: string | null;
  dataFormulir?: FormData;
};

/**
 * Benar bila pengguna boleh mengunggah ke setidaknya satu tujuan (berkas umum atau salah satu jenis lampiran).
 * Dipakai POST /api/berkas untuk menolak 403 sebelum badan permintaan dibaca.
 */
export function bolehUnggahSesuatu(pengguna: PenggunaSesi): boolean {
  return bolehAksesBerkas(pengguna, { jenisEntitas: null }, "unggah") || DAFTAR_JENIS.some((k) => bolehAksesBerkas(pengguna, { jenisEntitas: k }, "unggah"));
}

/**
 * Membaca badan multipart paling banyak `batas` byte. Pengurai formulir berhenti begitu jumlah byte melewati batas,
 * jadi formulir dari badan yang lebih besar dari batas tidak pernah dirakit. 413 bila melewati batas, 400 bila
 * formulirnya tidak valid. Cabang "melewati batas" hanya lapis kedua: rute sudah memeriksa Content-Length dan parser
 * HTTP Node berhenti di Content-Length. Aliran sumber sengaja tidak dibatalkan (cancel): di route handler cancel
 * menghancurkan IncomingMessage beserta soketnya, sehingga jawaban 413 bisa tidak sampai ke klien.
 */
export async function bacaFormulirTerbatas(request: Request, batas: number): Promise<FormData | 400 | 413> {
  if (!request.body) return 400;
  const pembaca = request.body.getReader();
  let terbaca = 0;
  let lewat = false;
  // aliran tarik: potongan berikutnya baru dibaca saat pengurai formulir memintanya, jadi tidak ada yang disangga di depan
  const terbatas = new ReadableStream<Uint8Array>({
    async pull(kendali) {
      const { done, value } = await pembaca.read();
      if (done) return kendali.close();
      terbaca += value.byteLength;
      if (terbaca > batas) {
        lewat = true;
        return kendali.error(new Error("Badan permintaan melewati batas"));
      }
      kendali.enqueue(value);
    },
  });
  try {
    return await new Response(terbatas, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return lewat ? 413 : 400;
  }
}

// dibulatkan ke atas supaya berkas yang sedikit di atas batas tidak tertulis "25 MB"
const MB = (byte: number) => (Math.ceil((byte / 1024 / 1024) * 10) / 10).toLocaleString("id-ID", { maximumFractionDigits: 1 });
const teks = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Menyimpan satu berkas (metadata, isi, dan log UNGGAH dalam satu transaksi). Galat validasi dikembalikan sebagai
 * { ok: false, status, galat }, tidak dilempar; galat tak terduga dilempar.
 */
export async function simpanBerkas(klien: KlienDb, pengguna: PenggunaSesi, masukan: MasukanBerkas): Promise<HasilBerkas<MetaBerkas>> {
  const gagal = (status: 400 | 403 | 404 | 413 | 415, galat: string): HasilBerkas<MetaBerkas> => ({ ok: false, status, galat });
  // 1. berkas sungguhan (peramban mengirim File kosong tanpa nama bila tidak ada yang dipilih)
  const berkas = masukan.berkas;
  if (!(berkas instanceof File) || (berkas.size === 0 && !berkas.name)) return gagal(400, "Pilih berkas yang akan diunggah");
  // 2. ukuran dari kepala File
  if (berkas.size <= 0) return gagal(400, `Berkas ${berkas.name} kosong`);
  if (berkas.size > BATAS_UKURAN_BERKAS) return gagal(413, `Ukuran berkas maksimal 25 MB (${berkas.name} ${MB(berkas.size)} MB)`);

  // 3. tujuan lampiran
  const jenisMasukan = teks(masukan.jenisEntitas);
  let j: JenisLampiran | undefined;
  let info: InfoEntitas | null = null;
  const entitasId = teks(masukan.entitasId);
  if (jenisMasukan) {
    j = jenisLampiran(jenisMasukan);
    if (!j) return gagal(400, "Jenis lampiran tidak dikenal");
    if (!entitasId) return gagal(400, "Data tujuan lampiran wajib diisi");
    info = await j.baca(klien, entitasId);
    if (!info) return gagal(404, "Data tujuan lampiran tidak ditemukan");
  }

  // 4. perusahaan dan proyek: lampiran mewarisi entitas, unggahan umum memilih sendiri
  let perusahaanId: string;
  let proyekId: string | null;
  if (info) {
    perusahaanId = info.perusahaanId;
    proyekId = info.proyekId;
  } else {
    const fd = new FormData();
    const isianPerusahaan = teks(masukan.perusahaanId) || teks(masukan.dataFormulir?.get("perusahaanId"));
    if (isianPerusahaan) fd.set("perusahaanId", isianPerusahaan);
    try {
      perusahaanId = await perusahaanDokumenBaru(fd, klien);
    } catch (galat) {
      // hanya galat validasi (Error biasa dari perusahaanDokumenBaru) yang diteruskan ke klien; galat Prisma, koneksi,
      // dan galat tak terduga lain dilempar supaya dijawab 500 tanpa rincian
      if (galat instanceof Error && Object.getPrototypeOf(galat) === Error.prototype) return gagal(400, galat.message);
      throw galat;
    }
    proyekId = teks(masukan.proyekId) || null;
    if (proyekId) {
      const p = await klien.proyek.findUnique({ where: { id: proyekId }, select: { perusahaanId: true } });
      if (!p || p.perusahaanId !== perusahaanId) return gagal(404, "Proyek tidak ditemukan");
    }
  }

  // 5. folder
  const folderKode = teks(masukan.folderKode) || j?.folderBawaan || FOLDER_BAWAAN;
  if (!(await klien.folderBerkas.findUnique({ where: { kode: folderKode }, select: { kode: true } }))) return gagal(400, "Folder tidak dikenal");

  // 6. tag
  const tagMasukan = teks(masukan.tag);
  if (tagMasukan && !(TAG_BERKAS as readonly string[]).includes(tagMasukan)) return gagal(400, "Tag berkas tidak dikenal");
  const tag: TagBerkas | null = tagMasukan ? (tagMasukan as TagBerkas) : j ? "REFERENSI" : null;

  // 7, 8. hak dan pembatasan
  const jenisEntitas = j ? jenisMasukan : null;
  if (!bolehAksesBerkas(pengguna, { jenisEntitas }, "unggah")) return gagal(403, "Anda tidak punya hak mengunggah berkas di sini");
  if (berkasTersembunyi({ folderKode, jenisEntitas, proyekId }, await ruangTersembunyi(klien, pengguna))) return gagal(403, "Anda tidak punya akses ke folder atau proyek ini");

  // 9, 10, 11. isi, tipe dari magic bytes, nama, sidik
  const isi = new Uint8Array(await berkas.arrayBuffer());
  if (isi.byteLength <= 0) return gagal(400, `Berkas ${berkas.name} kosong`);
  if (isi.byteLength > BATAS_UKURAN_BERKAS) return gagal(413, `Ukuran berkas maksimal 25 MB (${berkas.name} ${MB(isi.byteLength)} MB)`);
  const tipe = deteksiTipe(isi, berkas.name);
  if (!tipe.ok) return gagal(415, tipe.galat);
  const namaBerkas = bersihkanNamaBerkas(berkas.name, tipe.ekstensi);
  const sha256 = createHash("sha256").update(isi).digest("hex");

  // 12. satu transaksi: metadata, isi, log
  const nilai = await dalamTransaksi(klien, async (tx) => {
    const b = await tx.berkas.create({
      data: {
        perusahaanId,
        folderKode,
        namaBerkas,
        tipeMime: tipe.tipeMime,
        ukuran: isi.byteLength,
        sha256,
        jenisEntitas,
        entitasId: j ? entitasId : null,
        tag,
        proyekId,
        diunggahOlehId: idTersimpan(pengguna),
        diunggahOlehNama: pengguna.nama,
      },
      select: PILIH_META,
    });
    await tx.isiBerkas.create({ data: { berkasId: b.id, isi } });
    await catatLogBerkas(tx, pengguna, b, "UNGGAH", {
      keterangan: j && info ? `Lampiran ${j.label} ${info.label}` : null,
      meta: { jenisEntitas: b.jenisEntitas, entitasId: b.entitasId, ukuran: b.ukuran, tipeMime: b.tipeMime },
    });
    return b;
  });
  return { ok: true, nilai };
}

// ---------- Pratinjau, unduh, dan tautan publik (D7 §3.3.10, §3.3.13) ----------

export type HasilKirim = { status: 200 | 304 | 401 | 404; kepala: Record<string, string>; isi?: Uint8Array<ArrayBuffer>; galat?: string };

const cocokEtag = (ifNoneMatch: string | null, etag: string) =>
  !!ifNoneMatch && ifNoneMatch.split(",").some((t) => { const x = t.trim().replace(/^W\//, ""); return x === etag || x === "*"; });

/**
 * Isi berkas untuk GET /api/berkas/[id]. Tidak berhak dijawab 404 (bukan 403) supaya keberadaan berkas tidak bocor.
 * Pratinjau: If-None-Match yang cocok dijawab 304 tanpa membaca isi (private, no-cache + ETag). Unduhan (?unduh=1)
 * tidak pernah 304 dan tidak boleh disimpan cache peramban (private, no-store), jadi setiap unduhan dicatat UNDUH.
 */
export async function bacaUntukDikirim(klien: KlienDb, pengguna: PenggunaSesi | null, id: string, opsi: { unduh: boolean; ifNoneMatch: string | null }): Promise<HasilKirim> {
  if (!pengguna) return { status: 401, kepala: {}, galat: "Belum masuk" };
  const b = await ambilBerkasTerlihat(klien, pengguna, id);
  if (!b) return { status: 404, kepala: {}, galat: PESAN_BERKAS_TIDAK_ADA };
  const etag = `"${b.sha256}"`;
  const kepalaCache: Record<string, string> = opsi.unduh ? { "Cache-Control": "private, no-store" } : { ETag: etag, "Cache-Control": "private, no-cache" };
  if (!opsi.unduh && cocokEtag(opsi.ifNoneMatch, etag)) return { status: 304, kepala: kepalaCache };
  const isi = await klien.isiBerkas.findUnique({ where: { berkasId: b.id } });
  if (!isi) return { status: 404, kepala: {}, galat: PESAN_BERKAS_TIDAK_ADA };
  const inline = !opsi.unduh && disajikanInline(b.tipeMime);
  if (opsi.unduh) {
    try {
      await catatLogBerkas(klien, pengguna, b, "UNDUH");
    } catch (galat) {
      console.error("[berkas] gagal mencatat unduhan", galat);
    }
  }
  return {
    status: 200,
    kepala: {
      ...kepalaCache,
      "Content-Type": inline ? b.tipeMime : "application/octet-stream",
      "Content-Disposition": kepalaDisposisi(inline ? "inline" : "attachment", b.namaBerkas),
      "Content-Length": String(isi.isi.byteLength),
      "X-Content-Type-Options": "nosniff",
    },
    isi: new Uint8Array(isi.isi),
  };
}

/** SHA-256 heksadesimal token tautan bagi (yang tersimpan hanya hash-nya). */
export function hashTokenBagi(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type HasilTautanPublik = { status: 200 | 404; kepala: Record<string, string>; isi?: Uint8Array<ArrayBuffer> };

const kepalaTautanPublik = (namaBerkas: string, ukuran: number): Record<string, string> => ({
  "Content-Type": "application/octet-stream",
  "Content-Disposition": kepalaDisposisi("attachment", namaBerkas),
  "Content-Length": String(ukuran),
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
});

/** Baris tautan yang masih berlaku (belum dicabut, belum kedaluwarsa, berkasnya aktif dan isinya ada), atau null. */
async function tautanPublikBerlaku(klien: KlienDb, token: string, sekarang: Date) {
  if (!token || token.length > 200) return null;
  const t = await klien.tautanBagiBerkas.findUnique({
    where: { tokenHash: hashTokenBagi(token) },
    select: { id: true, kedaluwarsa: true, dicabutPada: true, berkas: { select: { id: true, namaBerkas: true, ukuran: true, dihapusPada: true, isiDihapusPada: true } } },
  });
  if (!t || t.dicabutPada || t.kedaluwarsa <= sekarang || t.berkas.dihapusPada || t.berkas.isiDihapusPada) return null;
  return t;
}

const TAUTAN_TIDAK_BERLAKU = { status: 404 as const, kepala: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" } };

/**
 * Isi berkas untuk GET /b/[token] (tanpa sesi). Pembatasan folder/proyek tidak dinilai: tautan adalah izin eksplisit.
 * Selalu attachment. Tidak menulis LogAktivitas; penghitung unduhan ada di baris tautan.
 */
export async function bacaTautanPublik(klien: KlienDb, token: string): Promise<HasilTautanPublik> {
  const sekarang = new Date();
  const t = await tautanPublikBerlaku(klien, token, sekarang);
  if (!t) return TAUTAN_TIDAK_BERLAKU;
  const isi = await klien.isiBerkas.findUnique({ where: { berkasId: t.berkas.id } });
  if (!isi) return TAUTAN_TIDAK_BERLAKU;
  await klien.tautanBagiBerkas.updateMany({ where: { id: t.id }, data: { jumlahUnduh: { increment: 1 }, terakhirDiunduh: sekarang } });
  return { status: 200, kepala: kepalaTautanPublik(t.berkas.namaBerkas, isi.isi.byteLength), isi: new Uint8Array(isi.isi) };
}

/**
 * Jawaban HEAD /b/[token]: status dan kepala yang sama dengan GET, tanpa membaca isi dan tanpa menaikkan penghitung
 * unduhan (pengambil pratinjau tautan seperti WhatsApp sering mengirim HEAD lebih dulu).
 */
export async function periksaTautanPublik(klien: KlienDb, token: string): Promise<HasilTautanPublik> {
  const t = await tautanPublikBerlaku(klien, token, new Date());
  if (!t) return TAUTAN_TIDAK_BERLAKU;
  return { status: 200, kepala: kepalaTautanPublik(t.berkas.namaBerkas, t.berkas.ukuran) };
}

/**
 * Membuat tautan bagi publik (D7 §3.3.13): berkas aktif terlihat, aksi bagikan boleh, masa berlaku 1/7/30 hari
 * (kosong = 7), tautan aktif kurang dari 10. Yang disimpan hanya hash token; token asli dikembalikan sekali dan
 * tidak pernah masuk log.
 */
export async function buatTautanBagiBerkas(klien: KlienDb, pengguna: PenggunaSesi, berkasId: string, masaBerlaku: string): Promise<{ token: string; kedaluwarsa: Date; tautanId: string }> {
  const b = await ambilBerkasTerlihat(klien, pengguna, berkasId);
  if (!b) throw new Error(PESAN_BERKAS_TIDAK_ADA);
  if (!bolehAksesBerkas(pengguna, b, "bagikan")) throw new Error("Anda tidak punya hak membagikan berkas ini");
  const isian = masaBerlaku.trim();
  const hari = isian ? Number(isian) : MASA_BERLAKU_BAWAAN;
  if (!/^\d*$/.test(isian) || !(MASA_BERLAKU_TAUTAN as readonly number[]).includes(hari)) throw new Error("Masa berlaku tidak dikenal");
  const sekarang = new Date();
  const token = randomBytes(32).toString("base64url");
  const kedaluwarsa = new Date(sekarang.getTime() + hari * 24 * 60 * 60 * 1000);
  const tautanId = await dalamTransaksi(klien, async (tx) => {
    // baris berkas dikunci supaya permintaan serentak dihitung bergantian dan batas 10 tautan aktif tidak terlewati
    // syarat dihapusPada/isiDihapusPada diulang di bawah kunci: berkas yang dibuang sesudah pemeriksaan awal tidak
    // boleh mendapat tautan baru, karena tautan itu akan hidup lagi saat berkas dipulihkan
    const terkunci = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Berkas" WHERE "id" = ${b.id} AND "dihapusPada" IS NULL AND "isiDihapusPada" IS NULL FOR UPDATE`;
    if (terkunci.length === 0) throw new Error(PESAN_BERKAS_TIDAK_ADA);
    const aktif = await tx.tautanBagiBerkas.count({ where: { berkasId: b.id, dicabutPada: null, kedaluwarsa: { gt: sekarang } } });
    if (aktif >= MAKS_TAUTAN_AKTIF) throw new Error(`Berkas ini sudah punya ${MAKS_TAUTAN_AKTIF} tautan aktif; cabut salah satu dulu`);
    const t = await tx.tautanBagiBerkas.create({ data: { berkasId: b.id, tokenHash: hashTokenBagi(token), kedaluwarsa, dibuatOlehId: idTersimpan(pengguna), dibuatOlehNama: pengguna.nama }, select: { id: true } });
    await catatLogBerkas(tx, pengguna, b, "BAGIKAN", { keterangan: `Tautan bagi ${hari} hari`, meta: { kedaluwarsa: kedaluwarsa.toISOString() } });
    return t.id;
  });
  return { token, kedaluwarsa, tautanId };
}

// ---------- Daftar, folder, pencarian (D7 §3.3.14, §3.6, §6.1) ----------

export type SaringBerkas = {
  folderKode?: string | null;
  jenisEntitas?: string | null;
  entitasId?: string | null;
  /** id proyek, atau null untuk berkas tanpa proyek; undefined = semua */
  proyekId?: string | null;
  q?: string | null;
  /** REFERENSI ikut memuat tag null (dibaca REFERENSI) */
  tag?: TagBerkas | null;
  /** lingkup satu perusahaan; null/undefined = gabungan */
  perusahaanId?: string | null;
  sampah?: boolean;
  /** satu berkas saja (?sorot=) */
  id?: string | null;
};

const PILIH_BARIS = { ...PILIH_META, folder: { select: { nama: true } }, proyek: { select: { kode: true, nama: true } } } as const satisfies Prisma.BerkasSelect;
export type BarisBerkas = Prisma.BerkasGetPayload<{ select: typeof PILIH_BARIS }>;

const syaratTag = (tag: TagBerkas): Prisma.BerkasWhereInput => (tag === "REFERENSI" ? { OR: [{ tag: "REFERENSI" }, { tag: null }] } : { tag });

/** Daftar berkas yang terlihat beserta totalnya. */
export async function daftarBerkasTerlihat(
  klien: KlienDb,
  pengguna: PenggunaSesi,
  saring: SaringBerkas = {},
  halaman?: { lewati: number; ambil: number },
): Promise<{ total: number; baris: BarisBerkas[] }> {
  const ruang = await ruangTersembunyi(klien, pengguna);
  const q = teks(saring.q);
  const where: Prisma.BerkasWhereInput = {
    AND: [
      syaratBerkasTerlihat(pengguna, ruang, { sampah: saring.sampah }),
      saring.id ? { id: saring.id } : {},
      saring.folderKode ? { folderKode: saring.folderKode } : {},
      saring.jenisEntitas ? { jenisEntitas: saring.jenisEntitas } : {},
      saring.entitasId ? { entitasId: saring.entitasId } : {},
      saring.proyekId !== undefined ? { proyekId: saring.proyekId } : {},
      q ? { namaBerkas: { contains: q, mode: "insensitive" as const } } : {},
      saring.tag ? syaratTag(saring.tag) : {},
      saring.perusahaanId ? { perusahaanId: saring.perusahaanId } : {},
    ],
  };
  const [total, baris] = await Promise.all([
    klien.berkas.count({ where }),
    klien.berkas.findMany({
      where,
      select: PILIH_BARIS,
      orderBy: saring.sampah ? [{ dihapusPada: "desc" }, { id: "asc" }] : [{ dibuatPada: "desc" }, { id: "asc" }],
      ...(halaman ? { skip: halaman.lewati, take: halaman.ambil } : {}),
    }),
  ]);
  return { total, baris };
}

/** Folder yang terlihat beserta jumlah berkas aktif terlihat di dalamnya. Folder tersembunyi tidak didaftar. */
export async function daftarFolderTerlihat(klien: KlienDb, pengguna: PenggunaSesi, opsi: { perusahaanId?: string | null } = {}): Promise<{ kode: string; nama: string; terbatas: boolean; jumlah: number }[]> {
  const ruang = await ruangTersembunyi(klien, pengguna);
  const [folder, hitungan] = await Promise.all([
    klien.folderBerkas.findMany({ orderBy: [{ urutan: "asc" }, { kode: "asc" }], select: { kode: true, nama: true, terbatas: true } }),
    klien.berkas.groupBy({
      by: ["folderKode"],
      where: { AND: [syaratBerkasTerlihat(pengguna, ruang), opsi.perusahaanId ? { perusahaanId: opsi.perusahaanId } : {}] },
      _count: { _all: true },
    }),
  ]);
  const jumlah = new Map(hitungan.map((h) => [h.folderKode, h._count._all]));
  return folder.filter((f) => !ruang || !ruang.folder.includes(f.kode)).map((f) => ({ kode: f.kode, nama: f.nama, terbatas: f.terbatas, jumlah: jumlah.get(f.kode) ?? 0 }));
}

export type HasilCariBerkas = { id: string; namaBerkas: string; tipeMime: string; folderKode: string; jenisEntitas: string | null; perusahaanId: string; dibuatPada: Date; tautan: string };

/** Pencarian nama berkas untuk /cari (paling banyak 10), memakai syarat terlihat yang sama dengan daftar. */
export async function cariBerkas(klien: KlienDb, pengguna: PenggunaSesi, q: string, perusahaanId?: string | null): Promise<HasilCariBerkas[]> {
  const kata = normalkanKataCari(q);
  if (!kata) return [];
  const ruang = await ruangTersembunyi(klien, pengguna);
  const baris = await klien.berkas.findMany({
    where: { AND: [syaratBerkasTerlihat(pengguna, ruang), { namaBerkas: { contains: loloskanWildcard(kata), mode: "insensitive" as const } }, perusahaanId ? { perusahaanId } : {}] },
    select: { id: true, namaBerkas: true, tipeMime: true, folderKode: true, jenisEntitas: true, perusahaanId: true, dibuatPada: true },
    orderBy: [{ dibuatPada: "desc" }, { id: "asc" }],
    take: 10,
  });
  return baris.map((b) => ({ ...b, tautan: `/berkas?sorot=${b.id}` }));
}

/** Penyimpanan terpakai: berkas yang isinya belum dihapus permanen (termasuk Sampah). */
export async function ringkasPenyimpanan(klien: KlienDb): Promise<{ jumlah: number; totalByte: number }> {
  const r = await klien.berkas.aggregate({ where: { isiDihapusPada: null }, _count: { _all: true }, _sum: { ukuran: true } });
  return { jumlah: r._count._all, totalByte: r._sum.ukuran ?? 0 };
}

// ---------- Pembantu untuk domain (D7 §3.3.14, DESAIN §3.1) ----------

/** Isi biner tanpa cek hak, hanya untuk penyaji cetak (gambar kop privat). null bila isi sudah dihapus permanen. */
export async function bacaIsiBerkas(klien: KlienDb, berkasId: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const isi = await klien.isiBerkas.findUnique({ where: { berkasId } });
  return isi ? new Uint8Array(isi.isi) : null;
}

/** Berkas aktif satu entitas tanpa melihat hak pembaca (mis. syarat "minimal satu berkas HASIL" D6). */
export async function daftarBerkasAktifEntitas(klien: KlienDb, jenisEntitas: JenisEntitas, entitasId: string, opsi: { tag?: TagBerkas } = {}): Promise<MetaBerkas[]> {
  return klien.berkas.findMany({
    where: { AND: [{ jenisEntitas, entitasId, dihapusPada: null, isiDihapusPada: null }, opsi.tag ? syaratTag(opsi.tag) : {}] },
    select: PILIH_META,
    orderBy: [{ dibuatPada: "asc" }, { id: "asc" }],
  });
}

/**
 * Buang satu berkas aktif ke Sampah di transaksi pemanggil, cabut semua tautan aktifnya, dan catat BUANG.
 * Tanpa cek hak (pemanggil yang memeriksa). false bila berkas tidak ada atau sudah tidak aktif.
 */
export async function buangSatuBerkas(tx: KlienDb, berkasId: string, pengguna: PenggunaSesi, opsi: { keterangan?: string | null } = {}): Promise<boolean> {
  const sekarang = new Date();
  const b = await tx.berkas.findUnique({ where: { id: berkasId }, select: PILIH_META });
  if (!b || b.dihapusPada || b.isiDihapusPada) return false;
  const hasil = await tx.berkas.updateMany({ where: { id: berkasId, dihapusPada: null }, data: { dihapusPada: sekarang, dihapusOlehId: idTersimpan(pengguna), dihapusOlehNama: pengguna.nama } });
  if (hasil.count === 0) return false;
  await tx.tautanBagiBerkas.updateMany({ where: { berkasId, dicabutPada: null }, data: { dicabutPada: sekarang, dicabutOlehId: idTersimpan(pengguna) } });
  await catatLogBerkas(tx, pengguna, b, "BUANG", { keterangan: opsi.keterangan ?? null });
  return true;
}

/**
 * Buang semua lampiran aktif satu entitas (opsional satu tag) dan cabut tautannya. Satu log BUANG bila ada yang
 * dibuang. Dipakai domain baru saat entitasnya dihapus fisik; tidak dipakai untuk dokumen akuntansi lama.
 */
export async function buangLampiranEntitas(tx: KlienDb, jenisEntitas: JenisEntitas, entitasId: string, pengguna: PenggunaSesi, opsi: { tag?: TagBerkas } = {}): Promise<number> {
  const j: JenisLampiran = JENIS_LAMPIRAN[jenisEntitas];
  const aktif = await daftarBerkasAktifEntitas(tx, jenisEntitas, entitasId, opsi);
  if (aktif.length === 0) return 0;
  const sekarang = new Date();
  const ids = aktif.map((b) => b.id);
  await tx.berkas.updateMany({ where: { id: { in: ids }, dihapusPada: null }, data: { dihapusPada: sekarang, dihapusOlehId: idTersimpan(pengguna), dihapusOlehNama: pengguna.nama } });
  await tx.tautanBagiBerkas.updateMany({ where: { berkasId: { in: ids }, dicabutPada: null }, data: { dicabutPada: sekarang, dicabutOlehId: idTersimpan(pengguna) } });
  // folder log = folder kunci jenis (atau bawaannya), supaya catatan lampiran folder terbatas ikut tersembunyi
  await catatAktivitas(tx, pengguna, {
    aksi: "BUANG",
    jenis: "Berkas",
    nomor: `${j.label} ${entitasId}`,
    keterangan: `${aktif.length} lampiran ${j.label} dibuang bersama data induknya`,
    modul: "berkas",
    entitasId,
    perusahaanId: aktif[0].perusahaanId,
    meta: { jumlah: aktif.length, berkasIds: ids, ...metaRuangLog(j.folderKunci ?? j.folderBawaan, jenisEntitas, aktif[0].proyekId) },
  });
  return aktif.length;
}

/** Proyek lampiran mengikuti entitasnya (aktif dan Sampah). Dipanggil domain saat proyek entitas berubah. */
export async function sinkronProyekLampiran(tx: KlienDb, jenisEntitas: JenisEntitas, entitasId: string, proyekIdBaru: string | null): Promise<number> {
  const r = await tx.berkas.updateMany({ where: { jenisEntitas, entitasId }, data: { proyekId: proyekIdBaru } });
  return r.count;
}

// ---------- Pembantu aksi pengaturan berkas (dipakai src/lib/aksi/berkas.ts) ----------

/** Peran boleh dari isian: SUPERADMIN/PEMILIK dibuang, selain PERAN_DAPAT_DIATUR ditolak, hasil unik dan terurut. */
export function rapikanPeranBoleh(nilai: readonly unknown[]): PeranPengguna[] {
  const terpilih = new Set<PeranPengguna>();
  for (const v of nilai) {
    const x = teks(v);
    if (!x || x === "SUPERADMIN" || x === "PEMILIK") continue;
    if (!(PERAN_DAPAT_DIATUR as readonly string[]).includes(x)) throw new Error(`Peran tidak dikenal: ${x}`);
    terpilih.add(x as PeranPengguna);
  }
  return PERAN_DAPAT_DIATUR.filter((p) => terpilih.has(p));
}

export const PANJANG_NAMA_FOLDER = 40;
const PANJANG_KODE_FOLDER = 30;

/**
 * Kode folder buatan dari nama (D7 §3.3.17): huruf besar, selain A-Z0-9 jadi _, _ beruntun dirapikan, _ di tepi
 * dibuang, maksimal 30, diawali huruf (selain itu diawali F_). Kode yang terlalu pendek untuk batasan basis data
 * (minimal 2 karakter) juga diawali F_.
 */
export function kodeFolderDariNama(nama: string): string {
  let kode = nama.toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, PANJANG_KODE_FOLDER).replace(/_+$/g, "");
  if (!/^[A-Z]/.test(kode) || kode.length < 2) kode = `F_${kode}`.slice(0, PANJANG_KODE_FOLDER).replace(/_+$/g, "");
  return kode.length < 2 ? "F_" : kode;
}

/** Kode bebas bentrok: akhiran _2, _3, dst., tetap paling panjang 30. */
export function kodeFolderUnik(dasar: string, terpakai: ReadonlySet<string>): string {
  if (!terpakai.has(dasar)) return dasar;
  for (let n = 2; ; n++) {
    const akhir = `_${n}`;
    const calon = `${dasar.slice(0, PANJANG_KODE_FOLDER - akhir.length).replace(/_+$/g, "")}${akhir}`;
    if (!terpakai.has(calon)) return calon;
  }
}

/** Nama folder dari isian: dipangkas, 1-40 karakter. */
export function bacaNamaFolder(nilai: unknown): string {
  const nama = teks(nilai).replace(/\s+/g, " ");
  if (!nama) throw new Error("Nama folder wajib diisi");
  if (nama.length > PANJANG_NAMA_FOLDER) throw new Error(`Nama folder paling panjang ${PANJANG_NAMA_FOLDER} karakter`);
  return nama;
}
