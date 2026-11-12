"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHakAksi } from "@/lib/otentikasi";
import { catatAktivitas } from "@/lib/log";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { pastikanTahunTerbuka } from "@/lib/tutupBuku";
import { pastikanAkunMilik } from "@/lib/baganAkun";
import { pastikanPerusahaanAktif } from "@/lib/perusahaan";
import { dataLangsungDisetujui, idPenggunaTersimpan, persetujuanWajib } from "@/lib/persetujuan";
import { akunKeuanganProyek, BATAS_UANG_D5, kunciBarisProyek } from "@/lib/keuanganProyek";
import { akunPeranMitra, kunciBarisMitra, pesanModalMelebihi, postingPembayaranMitra, postingTalanganMitra, sisaModalMitra } from "@/lib/jurnalMitra";
import { bacaUang, D, format, uang, type Desimal } from "@/lib/uang";
import type { Prisma } from "@/prisma-klien/client";

/*
 * Aksi mitra proyek, Talangan Mitra, dan Pembayaran ke Mitra (D5 §3.9 sampai §3.11, §6.2). Jurnalnya dicatat
 * src/lib/jurnalMitra.ts: langsung di transaksi buat bila persetujuan mati, atau saat disetujui lewat BERKAS.
 *
 * Urutan kunci keuangan proyek (KONTRAK-TAMBAHAN, tinjauan P33 S1): baris dokumen, lalu Proyek (kunciBarisProyek,
 * FOR NO KEY UPDATE), lalu MitraProyek (kunciBarisMitra). Ubah daftar mitra mengunci proyek (total persen, urutan)
 * lalu mitra. Buat dokumen mitra hanya mengunci mitra (dokumennya belum ada, total persen tidak tersentuh). Tidak ada
 * jalur di sini yang menyisipkan baris ber-FK ke penawaran atau pesanan, jadi kunci dokumen sumber tidak diperlukan.
 *
 * Rute /proyek/{id}/keuangan dan halaman dokumen mitra dibuat paket halaman keuangan proyek. Sampai halaman Persetujuan
 * memuat dokumen mitra, aksi buat dokumen mitra tidak dipasang di UI (kontrak P35).
 */

const MODUL = "bagi-hasil" as const;
const PANJANG_NAMA_MITRA = 120;
const PANJANG_URAIAN = 200;
const PANJANG_VENDOR = 120;
const PANJANG_CATATAN = 1000;

type Tx = Prisma.TransactionClient;

const ruteKeuangan = (proyekId: string) => `/proyek/${proyekId}/keuangan`;
function revalidasiMitra(proyekId: string) {
  revalidatePath(ruteKeuangan(proyekId));
  revalidatePath("/proyek/keuangan");
}
function revalidasiDokumen(proyekId: string) {
  revalidasiMitra(proyekId);
  revalidatePath("/persetujuan");
  revalidatePath("/buku-besar/jurnal");
  revalidatePath("/");
}

const teks = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const panjang = (s: string) => [...s].length;

async function ambilProyek(proyekId: string) {
  const p = await db.proyek.findUnique({ where: { id: String(proyekId ?? "") }, select: { id: true, kode: true, perusahaanId: true } });
  if (!p) throw new Error("Proyek tidak ditemukan");
  return p;
}

function bacaCatatan(fd: FormData): string | null {
  const catatan = teks(fd, "catatan") || null;
  if (catatan && panjang(catatan) > PANJANG_CATATAN) throw new Error(`Catatan maksimal ${PANJANG_CATATAN} karakter`);
  return catatan;
}

// ---------- Mitra proyek (D5 §3.9) ----------

type IsianMitra = { nama: string; mode: "PERSEN" | "NOMINAL"; nilai: Desimal; catatan: string | null };

function bacaIsianMitra(fd: FormData): IsianMitra {
  const nama = teks(fd, "nama");
  if (!nama) throw new Error("Nama mitra wajib diisi");
  if (panjang(nama) > PANJANG_NAMA_MITRA) throw new Error(`Nama mitra maksimal ${PANJANG_NAMA_MITRA} karakter`);
  const mode = teks(fd, "mode");
  if (mode !== "PERSEN" && mode !== "NOMINAL") throw new Error("Jenis bagian tidak dikenal");
  const nilai = bacaUang(fd.get("nilai"), "Nilai");
  if (nilai.gt(BATAS_UANG_D5)) throw new Error("Nilai melebihi batas Rp 10 triliun");
  if (mode === "PERSEN" && nilai.gt(100)) throw new Error("Satu mitra persen tidak boleh lebih dari 100%");
  return { nama, mode, nilai, catatan: bacaCatatan(fd) };
}

/** Total persen mitra proyek ini (tanpa `kecuali`) ditambah nilai baru tidak boleh lebih dari 100%. Di bawah kunci proyek. */
async function pastikanTotalPersen(tx: Tx, proyekId: string, isian: IsianMitra, kecuali?: string) {
  if (isian.mode !== "PERSEN") return;
  const lain = await tx.mitraProyek.aggregate({ where: { proyekId, mode: "PERSEN", ...(kecuali ? { id: { not: kecuali } } : {}) }, _sum: { nilai: true } });
  const total = uang(D(lain._sum.nilai).plus(isian.nilai));
  if (total.gt(100)) throw new Error(`Total persen mitra proyek ini menjadi ${format(total)}%. Maksimal 100%`);
}

const metaMitra = (id: string, m: { nama: string; mode: string; nilai: Desimal | Prisma.Decimal }) => ({ mitraId: id, nama: m.nama, mode: m.mode, nilai: D(m.nilai).toFixed(2) });
const teksBagian = (m: { mode: string; nilai: Desimal | Prisma.Decimal }) => (m.mode === "PERSEN" ? `${format(m.nilai)}%` : `Rp ${format(m.nilai)}`);

export async function tambahMitraProyek(proyekId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("bagi-hasil.buat");
  const isian = bacaIsianMitra(dataFormulir);
  const proyek = await ambilProyek(proyekId);
  await db.$transaction(async (tx) => {
    await kunciBarisProyek(tx, proyek.id);
    await pastikanTotalPersen(tx, proyek.id, isian);
    const terakhir = await tx.mitraProyek.aggregate({ where: { proyekId: proyek.id }, _max: { urutan: true } });
    const mitra = await tx.mitraProyek.create({
      data: { proyekId: proyek.id, nama: isian.nama, mode: isian.mode, nilai: isian.nilai, catatan: isian.catatan, urutan: (terakhir._max.urutan ?? 0) + 1 },
    });
    await catatAktivitas(tx, pengguna, {
      aksi: "BUAT",
      jenis: "Mitra Proyek",
      nomor: proyek.kode,
      keterangan: `Mitra ${isian.nama} ditambahkan, bagian ${teksBagian(isian)}`,
      modul: MODUL,
      entitasId: proyek.id,
      meta: metaMitra(mitra.id, isian),
      perusahaanId: proyek.perusahaanId,
    });
  });
  revalidasiMitra(proyek.id);
}

export async function tambahMitraProyekFormulir(proyekId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => tambahMitraProyek(proyekId, dataFormulir));
}

/** Mitra dibaca ulang di dalam transaksi sesudah kunci; harus milik proyek dari argumen terikat. */
async function mitraDiProyek(tx: Tx, proyekId: string, mitraId: string) {
  const m = await tx.mitraProyek.findUnique({ where: { id: String(mitraId ?? "") }, select: { id: true, proyekId: true, nama: true, mode: true, nilai: true, urutan: true, catatan: true } });
  if (!m || m.proyekId !== proyekId) throw new Error("Mitra tidak ditemukan di proyek ini");
  return m;
}

/** Ubah nama, jenis bagian, nilai, dan catatan. Tetap boleh walau mitra sudah punya pembayaran (HKA). */
export async function ubahMitraProyek(proyekId: string, mitraId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("bagi-hasil.ubah");
  const isian = bacaIsianMitra(dataFormulir);
  const proyek = await ambilProyek(proyekId);
  await db.$transaction(async (tx) => {
    await kunciBarisProyek(tx, proyek.id);
    await kunciBarisMitra(tx, String(mitraId ?? ""));
    const lama = await mitraDiProyek(tx, proyek.id, mitraId);
    await pastikanTotalPersen(tx, proyek.id, isian, lama.id);
    await tx.mitraProyek.update({ where: { id: lama.id }, data: { nama: isian.nama, mode: isian.mode, nilai: isian.nilai, catatan: isian.catatan } });
    await catatAktivitas(tx, pengguna, {
      aksi: "UBAH",
      jenis: "Mitra Proyek",
      nomor: proyek.kode,
      keterangan: `Mitra ${lama.nama} diubah: bagian ${teksBagian(lama)} menjadi ${teksBagian(isian)}`,
      modul: MODUL,
      entitasId: proyek.id,
      meta: { ...metaMitra(lama.id, isian), dari: metaMitra(lama.id, lama) },
      perusahaanId: proyek.perusahaanId,
    });
  });
  revalidasiMitra(proyek.id);
  redirect(`${ruteKeuangan(proyek.id)}?tab=bagi-hasil`);
}

export async function ubahMitraProyekFormulir(proyekId: string, mitraId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahMitraProyek(proyekId, mitraId, dataFormulir));
}

/**
 * Pindah urutan mitra satu langkah (naik/turun). Urutan nominal tetap menentukan siapa dibayar lebih dulu. Daftar
 * diurut ulang 1..n supaya urutan kembar (data lama) tetap bisa ditukar; baris mitra ditulis urut id.
 */
export async function pindahUrutanMitra(proyekId: string, mitraId: string, arah: "naik" | "turun") {
  const pengguna = await wajibHakAksi("bagi-hasil.ubah");
  if (arah !== "naik" && arah !== "turun") throw new Error("Arah urutan tidak dikenal");
  const proyek = await ambilProyek(proyekId);
  await db.$transaction(async (tx) => {
    await kunciBarisProyek(tx, proyek.id);
    const mitra = await mitraDiProyek(tx, proyek.id, mitraId);
    const daftar = await tx.mitraProyek.findMany({ where: { proyekId: proyek.id }, orderBy: [{ urutan: "asc" }, { dibuatPada: "asc" }, { id: "asc" }], select: { id: true, urutan: true } });
    const i = daftar.findIndex((m) => m.id === mitra.id);
    const j = arah === "naik" ? i - 1 : i + 1;
    if (j < 0) throw new Error("Mitra sudah di urutan teratas");
    if (j >= daftar.length) throw new Error("Mitra sudah di urutan terbawah");
    const baru = daftar.map((m) => m.id);
    [baru[i], baru[j]] = [baru[j], baru[i]];
    const target = new Map(baru.map((id, k) => [id, k + 1]));
    for (const m of [...daftar].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      const ke = target.get(m.id)!;
      if (m.urutan !== ke) await tx.mitraProyek.update({ where: { id: m.id }, data: { urutan: ke } });
    }
    await catatAktivitas(tx, pengguna, {
      aksi: "URUTAN",
      jenis: "Mitra Proyek",
      nomor: proyek.kode,
      keterangan: `Mitra ${mitra.nama} dipindah ${arah} ke urutan ${j + 1}`,
      modul: MODUL,
      entitasId: proyek.id,
      meta: { ...metaMitra(mitra.id, mitra), urutan: { dari: i + 1, ke: j + 1 } },
      perusahaanId: proyek.perusahaanId,
    });
  });
  revalidasiMitra(proyek.id);
}

export async function pindahUrutanMitraFormulir(proyekId: string, mitraId: string, arah: "naik" | "turun"): Promise<StatusFormulir> {
  return jalankanFormulir(() => pindahUrutanMitra(proyekId, mitraId, arah));
}

/** Hapus mitra yang belum punya dokumen (status apa pun). Pembayaran dicek lebih dulu, lalu talangan (D5 §3.9). */
export async function hapusMitraProyek(proyekId: string, mitraId: string) {
  const pengguna = await wajibHakAksi("bagi-hasil.hapus");
  const proyek = await ambilProyek(proyekId);
  await db.$transaction(async (tx) => {
    await kunciBarisProyek(tx, proyek.id);
    // DELETE butuh FOR UPDATE; diambil langsung supaya sisipan dokumen baru (KEY SHARE) menunggu sampai hapus selesai
    await tx.$queryRaw`SELECT 1 FROM "MitraProyek" WHERE "id" = ${String(mitraId ?? "")} FOR UPDATE`;
    const mitra = await mitraDiProyek(tx, proyek.id, mitraId);
    const bayar = await tx.pembayaranMitra.findMany({ where: { mitraId: mitra.id }, select: { nomor: true }, orderBy: { nomor: "asc" } });
    if (bayar.length) throw new Error(`Mitra ${mitra.nama} sudah punya pembayaran (${bayar.map((b) => b.nomor).join(", ")}). Hapus pembayarannya dulu`);
    const talangan = await tx.talanganMitra.findMany({ where: { mitraId: mitra.id }, select: { nomor: true }, orderBy: { nomor: "asc" } });
    if (talangan.length) throw new Error(`Mitra ${mitra.nama} sudah menalangi biaya proyek (${talangan.map((t) => t.nomor).join(", ")}). Hapus talangannya dulu`);
    await tx.mitraProyek.delete({ where: { id: mitra.id } });
    await catatAktivitas(tx, pengguna, {
      aksi: "HAPUS",
      jenis: "Mitra Proyek",
      nomor: proyek.kode,
      keterangan: `Mitra ${mitra.nama} dihapus`,
      modul: MODUL,
      entitasId: proyek.id,
      meta: metaMitra(mitra.id, mitra),
      perusahaanId: proyek.perusahaanId,
    });
  });
  revalidasiMitra(proyek.id);
}

export async function hapusMitraProyekFormulir(proyekId: string, mitraId: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => hapusMitraProyek(proyekId, mitraId));
}

// ---------- Dokumen mitra (D5 §3.10, §3.11) ----------

/** Tanggal formulir: kosong = hari ini, siang hari supaya tidak bergeser hari, tidak boleh di masa depan. */
function bacaTanggal(fd: FormData): Date {
  const t = teks(fd, "tanggal");
  const tanggal = t ? new Date(`${t}T12:00:00`) : new Date();
  if (Number.isNaN(tanggal.getTime())) throw new Error("Tanggal tidak valid");
  const akhirHariIni = new Date();
  akhirHariIni.setHours(23, 59, 59, 999);
  if (tanggal > akhirHariIni) throw new Error("Tanggal tidak boleh di masa depan");
  return tanggal;
}

function bacaJumlah(fd: FormData): Desimal {
  const jumlah = bacaUang(fd.get("jumlah"), "Jumlah");
  if (jumlah.gt(BATAS_UANG_D5)) throw new Error("Jumlah melebihi batas Rp 10 triliun");
  return jumlah;
}

/** Mitra wajib dipilih dan milik proyek ini (pemeriksaan awal, diulang di transaksi sesudah kunci). */
async function pastikanMitraAwal(proyekId: string, fd: FormData) {
  const mitraId = teks(fd, "mitraId");
  if (!mitraId) throw new Error("Mitra wajib dipilih");
  const m = await db.mitraProyek.findUnique({ where: { id: mitraId }, select: { id: true, proyekId: true } });
  if (!m || m.proyekId !== proyekId) throw new Error("Mitra tidak ditemukan di proyek ini");
  return mitraId;
}

/**
 * Talangan Mitra: biaya proyek yang dibayar mitra dengan uangnya sendiri (D5 §3.10). Perusahaan = perusahaan proyek.
 * Persetujuan mati: langsung DISETUJUI dan jurnal JU-TLM di transaksi yang sama. Menyala: DRAFT tanpa jurnal.
 */
export async function buatTalanganMitra(proyekId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("talangan-mitra.buat");
  const proyek = await ambilProyek(proyekId);
  const mitraId = await pastikanMitraAwal(proyek.id, dataFormulir);
  const tanggal = bacaTanggal(dataFormulir);
  const akunBebanId = teks(dataFormulir, "akunBebanId");
  if (!akunBebanId) throw new Error("Akun beban wajib dipilih");
  const jumlah = bacaJumlah(dataFormulir);
  const deskripsi = teks(dataFormulir, "deskripsi");
  if (!deskripsi) throw new Error("Uraian wajib diisi");
  if (panjang(deskripsi) > PANJANG_URAIAN) throw new Error(`Uraian maksimal ${PANJANG_URAIAN} karakter`);
  const vendor = teks(dataFormulir, "vendor") || null;
  if (vendor && panjang(vendor) > PANJANG_VENDOR) throw new Error(`Vendor maksimal ${PANJANG_VENDOR} karakter`);
  const catatan = bacaCatatan(dataFormulir);
  const akun = await db.akun.findUnique({ where: { id: akunBebanId }, select: { id: true, jenis: true, kelompok: true } });
  if (!akun || akun.jenis !== "BEBAN" || akun.kelompok) throw new Error("Akun beban harus akun Beban rinci (bukan kelompok)");
  if ((await akunKeuanganProyek(db)).bebanBagiHasil?.id === akun.id) throw new Error("Akun Bagi Hasil Mitra Proyek tidak boleh dipakai untuk talangan");
  await akunPeranMitra(db, "hutangMitra");
  await pastikanAkunMilik(db, [akun.id], proyek.perusahaanId);
  await pastikanPerusahaanAktif(db, proyek.perusahaanId);
  const perluPersetujuan = await persetujuanWajib(db);

  const dok = await db.$transaction(async (tx) => {
    await kunciBarisMitra(tx, mitraId);
    const mitra = await mitraDiProyek(tx, proyek.id, mitraId);
    await pastikanTahunTerbuka(tx, tanggal);
    const nomor = await nomorDokumenBerikutnya(tx.talanganMitra, "TLM");
    const d = await tx.talanganMitra.create({
      data: {
        nomor, tanggal, perusahaanId: proyek.perusahaanId, proyekId: proyek.id, mitraId: mitra.id, akunBebanId: akun.id, jumlah, deskripsi, vendor, catatan,
        dicatatOlehId: idPenggunaTersimpan(pengguna), dicatatOlehNama: pengguna.nama,
        ...(perluPersetujuan ? { statusPersetujuan: "DRAFT" as const } : dataLangsungDisetujui(pengguna)),
      },
    });
    if (!perluPersetujuan) await postingTalanganMitra(tx, d.id);
    await catatAktivitas(tx, pengguna, {
      aksi: "BUAT",
      jenis: "Talangan Mitra",
      nomor,
      keterangan: `${mitra.nama} menalangi ${format(jumlah)} untuk ${deskripsi} (${proyek.kode})`,
      modul: MODUL,
      entitasId: d.id,
      meta: { proyekId: proyek.id, mitraId: mitra.id, jumlah: jumlah.toFixed(2) },
      perusahaanId: proyek.perusahaanId,
    });
    return d;
  });
  revalidasiDokumen(proyek.id);
  redirect(`${ruteKeuangan(proyek.id)}/talangan/${dok.id}`);
}

export async function buatTalanganMitraFormulir(proyekId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatTalanganMitra(proyekId, dataFormulir));
}

/**
 * Pembayaran ke Mitra (D5 §3.11). MODAL dibatasi sisa modal mitra: dicek di transaksi buat di bawah kunci baris mitra
 * (draf yang belum ditolak ikut memesan sisa), lalu dicek ulang saat posting. LABA tidak dibatasi.
 */
export async function buatPembayaranMitra(proyekId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("pembayaran-mitra.buat");
  const proyek = await ambilProyek(proyekId);
  const mitraId = await pastikanMitraAwal(proyek.id, dataFormulir);
  const jenis = teks(dataFormulir, "jenis");
  if (jenis !== "MODAL" && jenis !== "LABA") throw new Error("Jenis pembayaran tidak dikenal");
  const jumlah = bacaJumlah(dataFormulir);
  const tanggal = bacaTanggal(dataFormulir);
  const akunKasId = teks(dataFormulir, "akunKasId");
  if (!akunKasId) throw new Error("Akun kas/bank wajib dipilih");
  const catatan = bacaCatatan(dataFormulir);
  const akunKas = await db.akun.findUnique({ where: { id: akunKasId }, select: { id: true, kode: true, nama: true, kasBank: true, kelompok: true } });
  if (!akunKas || !akunKas.kasBank || akunKas.kelompok) throw new Error("Akun sumber harus akun kas/bank");
  await akunPeranMitra(db, jenis === "MODAL" ? "hutangMitra" : "bebanBagiHasil");
  await pastikanAkunMilik(db, [akunKas.id], proyek.perusahaanId);
  await pastikanPerusahaanAktif(db, proyek.perusahaanId);
  const perluPersetujuan = await persetujuanWajib(db);

  const dok = await db.$transaction(async (tx) => {
    // sisaModalMitra dengan kunci mengunci baris mitra; LABA cukup kunciBarisMitra (urutan kunci sama)
    if (jenis === "MODAL") {
      const sisa = await sisaModalMitra(tx, mitraId, { hanyaDisetujui: false, kunci: true });
      const mitraCek = await mitraDiProyek(tx, proyek.id, mitraId);
      if (jumlah.gt(sisa)) throw new Error(pesanModalMelebihi(mitraCek.nama, sisa));
    } else {
      await kunciBarisMitra(tx, mitraId);
    }
    const mitra = await mitraDiProyek(tx, proyek.id, mitraId);
    await pastikanTahunTerbuka(tx, tanggal);
    const nomor = await nomorDokumenBerikutnya(tx.pembayaranMitra, "BYM");
    const d = await tx.pembayaranMitra.create({
      data: {
        nomor, tanggal, perusahaanId: proyek.perusahaanId, proyekId: proyek.id, mitraId: mitra.id, jenis, jumlah, akunKasId: akunKas.id, catatan,
        dicatatOlehId: idPenggunaTersimpan(pengguna), dicatatOlehNama: pengguna.nama,
        ...(perluPersetujuan ? { statusPersetujuan: "DRAFT" as const } : dataLangsungDisetujui(pengguna)),
      },
    });
    if (!perluPersetujuan) await postingPembayaranMitra(tx, d.id);
    await catatAktivitas(tx, pengguna, {
      aksi: "BUAT",
      jenis: "Pembayaran ke Mitra",
      nomor,
      keterangan: `${jenis === "MODAL" ? "Pengembalian modal" : "Bagi laba"} ${format(jumlah)} ke ${mitra.nama} (${proyek.kode}) dari ${akunKas.kode} ${akunKas.nama}`,
      modul: MODUL,
      entitasId: d.id,
      meta: { proyekId: proyek.id, mitraId: mitra.id, jumlah: jumlah.toFixed(2), jenis },
      perusahaanId: proyek.perusahaanId,
    });
    return d;
  });
  revalidasiDokumen(proyek.id);
  redirect(`${ruteKeuangan(proyek.id)}/bayar/${dok.id}`);
}

export async function buatPembayaranMitraFormulir(proyekId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatPembayaranMitra(proyekId, dataFormulir));
}
