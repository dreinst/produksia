"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHakAksi } from "@/lib/otentikasi";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { D, format, uang, type Desimal } from "@/lib/uang";
import { bacaFotoDariFormulir } from "@/lib/foto";
import { petaSedangDiLuar, sisaBaris } from "@/lib/peminjaman";
import { bacaProyekId } from "@/lib/proyek";
import { idPenggunaTersimpan } from "@/lib/persetujuan";
import type { PenggunaSesi } from "@/lib/hakAkses";
import type { Prisma, PrismaClient } from "@/prisma-klien/client";

/*
 * Peminjaman Barang (loading out / loading in) untuk kru event. Dokumen ini TIDAK menyentuh StokBarang,
 * harga pokok, maupun jurnal: barang tetap milik gudang, hanya sedang di luar. Yang dijaga adalah
 * tersedia = StokBarang.jumlah - sedang di luar (lihat src/lib/peminjaman.ts). Barang yang hilang tetap
 * dihitung di luar sampai Admin menautkan dokumen ke Penyesuaian Stok yang sudah disetujui.
 */

type KlienDb = PrismaClient | Prisma.TransactionClient;
type TahapFoto = "KELUAR" | "KEMBALI";
type BarisKeluar = { barangId: string; jumlah: Desimal };
type BarisKembali = { barangId: string; jumlahKembali: Desimal };

function bacaJson(raw: FormDataEntryValue | null): unknown[] {
  if (typeof raw !== "string" || !raw) throw new Error("Minimal 1 baris barang wajib diisi");
  let hasil: unknown;
  try {
    hasil = JSON.parse(raw);
  } catch {
    throw new Error("Format baris tidak valid");
  }
  if (!Array.isArray(hasil)) throw new Error("Minimal 1 baris barang wajib diisi");
  return hasil;
}

function pastikanTidakGanda(daftar: { barangId: string }[]) {
  const ganda = daftar.map((b) => b.barangId).filter((id, i, arr) => arr.indexOf(id) !== i);
  if (ganda.length) throw new Error("Satu barang hanya boleh muncul sekali per dokumen");
}

function bacaBarisKeluar(raw: FormDataEntryValue | null): BarisKeluar[] {
  const daftar = (bacaJson(raw) as { barangId?: string; jumlah?: string | number }[])
    .filter((b) => b.barangId)
    .map((b) => ({ barangId: String(b.barangId), jumlah: uang(b.jumlah) }));
  if (daftar.length === 0) throw new Error("Minimal 1 baris barang wajib diisi");
  if (daftar.some((b) => b.jumlah.lte(0))) throw new Error("Jumlah tiap baris harus lebih dari 0");
  pastikanTidakGanda(daftar);
  return daftar;
}

function bacaBarisKembali(raw: FormDataEntryValue | null): BarisKembali[] {
  const daftar = (bacaJson(raw) as { barangId?: string; jumlahKembali?: string | number }[])
    .filter((b) => b.barangId)
    .map((b) => ({ barangId: String(b.barangId), jumlahKembali: uang(b.jumlahKembali) }));
  if (daftar.some((b) => b.jumlahKembali.isNegative())) throw new Error("Jumlah kembali tidak boleh negatif");
  pastikanTidakGanda(daftar);
  return daftar;
}

function bacaRencanaKembali(raw: FormDataEntryValue | null): Date | null {
  const teks = typeof raw === "string" ? raw.trim() : "";
  if (!teks) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(teks)) throw new Error("Rencana kembali harus berformat tanggal (YYYY-MM-DD)");
  return new Date(`${teks}T00:00:00Z`);
}

function bacaNamaPengambil(raw: FormDataEntryValue | null): string {
  const nama = String(raw ?? "").trim();
  if (!nama) throw new Error("Nama pengambil wajib diisi");
  return nama;
}

async function catatLog(klien: KlienDb, pengguna: PenggunaSesi, aksi: string, nomor: string, keterangan: string) {
  await klien.logAktivitas.create({
    data: { penggunaId: idPenggunaTersimpan(pengguna), penggunaNama: pengguna.nama, aksi, jenis: "Peminjaman Barang", nomor, keterangan },
  });
}

/** Menyimpan foto bukti; urutan melanjutkan foto tahap yang sama yang sudah ada. */
async function simpanFotoBukti(tx: Prisma.TransactionClient, peminjamanId: string, tahap: TahapFoto, daftarFoto: Awaited<ReturnType<typeof bacaFotoDariFormulir>>) {
  const mulai = await tx.foto.count({ where: { peminjamanId, tahap } });
  await tx.foto.createMany({ data: daftarFoto.map((f, i) => ({ peminjamanId, tahap, urutan: mulai + i, tipe: f.tipe, ukuran: f.ukuran, isi: f.isi })) });
}

function revalidasi() {
  revalidatePath("/persediaan");
  revalidatePath("/persediaan/peminjaman");
}

// ---------- Catat keluar (loading out) ----------

export async function buatPeminjamanBarang(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("peminjaman.buat");
  const gudangId = String(dataFormulir.get("gudangId") ?? "");
  if (!gudangId) throw new Error("Gudang wajib dipilih");
  const namaPengambil = bacaNamaPengambil(dataFormulir.get("namaPengambil"));
  const keterangan = String(dataFormulir.get("keterangan") ?? "").trim();
  const rencanaKembali = bacaRencanaKembali(dataFormulir.get("rencanaKembali"));
  const daftarBaris = bacaBarisKeluar(dataFormulir.get("baris"));
  const proyekId = await bacaProyekId(dataFormulir);
  const daftarFoto = await bacaFotoDariFormulir(dataFormulir, "foto", { wajib: true });
  const gudang = await db.gudang.findUnique({ where: { id: gudangId }, select: { nama: true } });
  if (!gudang) throw new Error("Gudang tidak ditemukan");

  await db.$transaction(async (tx) => {
    const idBarang = daftarBaris.map((b) => b.barangId);
    const daftarBarang = await tx.barang.findMany({ where: { id: { in: idBarang } }, select: { id: true, kode: true, nama: true, jenis: true } });
    const petaBarang = new Map(daftarBarang.map((b) => [b.id, b]));
    const daftarStok = await tx.stokBarang.findMany({ where: { gudangId, barangId: { in: idBarang } }, select: { barangId: true, jumlah: true } });
    const petaStok = new Map(daftarStok.map((s) => [s.barangId, D(s.jumlah)]));
    const diLuar = await petaSedangDiLuar(tx, gudangId);
    for (const b of daftarBaris) {
      const barang = petaBarang.get(b.barangId);
      if (!barang) throw new Error("Barang tidak ditemukan");
      if (barang.jenis !== "BARANG") throw new Error(`${barang.kode} - ${barang.nama} adalah JASA, tidak punya stok`);
      const stok = petaStok.get(b.barangId) ?? D(0);
      const sedangDiLuar = D(diLuar.get(b.barangId) ?? 0);
      if (stok.minus(sedangDiLuar).lt(b.jumlah)) {
        throw new Error(`${barang.kode} tidak cukup di ${gudang.nama} (stok ${format(stok)}, sedang di luar ${format(sedangDiLuar)}, diminta ${format(b.jumlah)})`);
      }
    }
    const nomor = await nomorDokumenBerikutnya(tx.peminjamanBarang, "PJ");
    const dokumen = await tx.peminjamanBarang.create({
      data: {
        nomor,
        gudangId,
        proyekId,
        namaPengambil,
        keterangan: keterangan || null,
        rencanaKembali,
        dicatatOlehId: idPenggunaTersimpan(pengguna),
        dicatatOlehNama: pengguna.nama,
        baris: { create: daftarBaris },
      },
    });
    await simpanFotoBukti(tx, dokumen.id, "KELUAR", daftarFoto);
  });

  revalidasi();
  redirect("/persediaan/peminjaman");
}

export async function buatPeminjamanBarangFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatPeminjamanBarang(dataFormulir));
}

// ---------- Kembalikan (loading in), boleh sebagian dan bertahap ----------

export async function kembalikanPeminjamanBarang(peminjamanId: string, dataFormulir: FormData) {
  await wajibHakAksi("peminjaman.buat");
  const tutupDenganSelisih = dataFormulir.get("tutupDenganSelisih") === "1";
  const catatan = String(dataFormulir.get("catatan") ?? "").trim();
  const daftarKembali = bacaBarisKembali(dataFormulir.get("baris"));
  if (!tutupDenganSelisih && !daftarKembali.some((b) => b.jumlahKembali.gt(0))) throw new Error("Isi jumlah yang kembali minimal pada satu barang");
  const daftarFoto = await bacaFotoDariFormulir(dataFormulir, "foto", { wajib: true });

  await db.$transaction(async (tx) => {
    const dokumen = await tx.peminjamanBarang.findUnique({
      where: { id: peminjamanId },
      include: { baris: { include: { barang: { select: { kode: true } } } } },
    });
    if (!dokumen) throw new Error("Dokumen peminjaman tidak ditemukan");
    if (dokumen.ditutupPada) throw new Error(`${dokumen.nomor} sudah ditutup`);
    const petaBaris = new Map(dokumen.baris.map((b) => [b.barangId, b]));
    const sisaSetelah = new Map(dokumen.baris.map((b) => [b.barangId, D(sisaBaris(b))]));
    for (const k of daftarKembali) {
      const baris = petaBaris.get(k.barangId);
      if (!baris) throw new Error("Barang tidak ada di dokumen ini");
      if (k.jumlahKembali.isZero()) continue;
      const sisa = sisaSetelah.get(k.barangId)!;
      if (k.jumlahKembali.gt(sisa)) throw new Error(`${baris.barang.kode} kembali ${format(k.jumlahKembali)} melebihi sisa di luar (${format(sisa)})`);
      await tx.barisPeminjamanBarang.update({ where: { id: baris.id }, data: { jumlahKembali: { increment: k.jumlahKembali } } });
      sisaSetelah.set(k.barangId, sisa.minus(k.jumlahKembali));
    }
    const masihAdaSisa = [...sisaSetelah.values()].some((s) => s.gt(0));
    if (tutupDenganSelisih && masihAdaSisa && !catatan) throw new Error("Catatan wajib diisi bila menutup dokumen dengan selisih");
    const ditutup = !masihAdaSisa || tutupDenganSelisih;
    await tx.peminjamanBarang.update({
      where: { id: peminjamanId },
      data: { ...(ditutup ? { ditutupPada: new Date() } : {}), ...(catatan ? { catatanKembali: catatan } : {}) },
    });
    await simpanFotoBukti(tx, peminjamanId, "KEMBALI", daftarFoto);
  });

  revalidasi();
}

export async function kembalikanPeminjamanBarangFormulir(peminjamanId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => kembalikanPeminjamanBarang(peminjamanId, dataFormulir));
}

// ---------- Ubah terbatas selama TERBUKA ----------

export async function ubahPeminjamanBarang(peminjamanId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("peminjaman.buat");
  const namaPengambil = bacaNamaPengambil(dataFormulir.get("namaPengambil"));
  const keterangan = String(dataFormulir.get("keterangan") ?? "").trim();
  const rencanaKembali = bacaRencanaKembali(dataFormulir.get("rencanaKembali"));
  const proyekId = await bacaProyekId(dataFormulir);
  const dokumen = await db.peminjamanBarang.findUnique({ where: { id: peminjamanId }, select: { nomor: true } });
  if (!dokumen) throw new Error("Dokumen peminjaman tidak ditemukan");
  await db.$transaction(async (tx) => {
    // Syarat ditutupPada null ikut di update supaya Kembalikan yang menutup dokumen di sela-sela tidak tertimpa.
    const { count } = await tx.peminjamanBarang.updateMany({
      where: { id: peminjamanId, ditutupPada: null },
      data: { namaPengambil, proyekId, keterangan: keterangan || null, rencanaKembali },
    });
    if (count === 0) throw new Error(`${dokumen.nomor} sudah ditutup, tidak bisa diubah`);
    await catatLog(tx, pengguna, "UBAH", dokumen.nomor, `Pengambil ${namaPengambil}${keterangan ? `; ${keterangan}` : ""}`);
  });
  revalidatePath("/persediaan/peminjaman");
}

export async function ubahPeminjamanBarangFormulir(peminjamanId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahPeminjamanBarang(peminjamanId, dataFormulir));
}

// ---------- Tautkan Penyesuaian Stok untuk dokumen SELISIH ----------

export async function tautkanPenyesuaianPeminjaman(peminjamanId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("penyesuaian.setujui");
  const penyesuaianId = String(dataFormulir.get("penyesuaianId") ?? "").trim();
  if (!penyesuaianId) throw new Error("Penyesuaian Stok wajib dipilih");
  await db.$transaction(async (tx) => {
    const dokumen = await tx.peminjamanBarang.findUnique({ where: { id: peminjamanId }, include: { baris: true } });
    if (!dokumen) throw new Error("Dokumen peminjaman tidak ditemukan");
    if (!dokumen.ditutupPada) throw new Error(`${dokumen.nomor} masih terbuka; tutup dulu dengan selisih`);
    if (dokumen.penyesuaianId) throw new Error(`${dokumen.nomor} sudah ditautkan ke Penyesuaian Stok`);
    if (!dokumen.baris.some((b) => sisaBaris(b) > 0)) throw new Error(`${dokumen.nomor} tidak punya selisih; semua barang sudah kembali`);
    const penyesuaian = await tx.penyesuaianPersediaan.findUnique({ where: { id: penyesuaianId }, select: { nomor: true, statusPersetujuan: true, gudangId: true } });
    if (!penyesuaian) throw new Error("Penyesuaian Stok tidak ditemukan");
    if (penyesuaian.statusPersetujuan !== "DISETUJUI") throw new Error(`${penyesuaian.nomor} belum disetujui`);
    if (penyesuaian.gudangId !== dokumen.gudangId) throw new Error(`${penyesuaian.nomor} untuk gudang lain, bukan gudang dokumen ${dokumen.nomor}`);
    await tx.peminjamanBarang.update({ where: { id: peminjamanId }, data: { penyesuaianId } });
    await catatLog(tx, pengguna, "TAUTKAN", dokumen.nomor, `Selisih ditautkan ke ${penyesuaian.nomor}; barang tidak lagi dihitung di luar`);
  });
  revalidasi();
}

export async function tautkanPenyesuaianPeminjamanFormulir(peminjamanId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => tautkanPenyesuaianPeminjaman(peminjamanId, dataFormulir));
}

// ---------- Foto bukti tambahan (hak peminjaman.hapus) ----------

export async function unggahFotoPeminjaman(peminjamanId: string, tahap: TahapFoto, dataFormulir: FormData) {
  await wajibHakAksi("peminjaman.hapus");
  const daftarFoto = await bacaFotoDariFormulir(dataFormulir, "foto", { wajib: true });
  await db.$transaction(async (tx) => {
    const ada = await tx.peminjamanBarang.count({ where: { id: peminjamanId } });
    if (!ada) throw new Error("Dokumen peminjaman tidak ditemukan");
    await simpanFotoBukti(tx, peminjamanId, tahap, daftarFoto);
  });
  revalidatePath("/persediaan/peminjaman");
}

export async function unggahFotoPeminjamanFormulir(peminjamanId: string, tahap: TahapFoto, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => unggahFotoPeminjaman(peminjamanId, tahap, dataFormulir));
}

export async function hapusFotoPeminjaman(fotoId: string) {
  await wajibHakAksi("peminjaman.hapus");
  const foto = await db.foto.findUnique({ where: { id: fotoId }, select: { peminjamanId: true } });
  // Foto barang (peminjamanId null) dihapus lewat aksi data induk dengan hak stok-induk.tulis
  if (!foto?.peminjamanId) throw new Error("Foto bukti tidak ditemukan");
  await db.foto.delete({ where: { id: fotoId } });
  revalidatePath("/persediaan/peminjaman");
}

// Dipakai lewat .bind(null, fotoId); argumen useActionState diabaikan seperti hapusFotoBarangFormulir
export async function hapusFotoPeminjamanFormulir(fotoId: string) {
  return jalankanFormulir(() => hapusFotoPeminjaman(fotoId));
}
