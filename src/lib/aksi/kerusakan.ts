"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHakAksi } from "@/lib/otentikasi";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { uang, type Desimal } from "@/lib/uang";
import { bacaFotoDariFormulir } from "@/lib/foto";
import { kurangiStok, labelBarang } from "@/lib/stok";
import { bacaProyekId } from "@/lib/proyek";
import { dataLangsungDisetujui, idPenggunaTersimpan, persetujuanWajib } from "@/lib/persetujuan";
import type { PenggunaSesi } from "@/lib/hakAkses";
import type { Prisma, PrismaClient } from "@/prisma-klien/client";

/*
 * Laporan Kerusakan Barang: pola sama dengan Peminjaman Barang (src/lib/aksi/peminjaman.ts) TAPI tanpa
 * alur "kembali" -- begitu disetujui Gudang, StokBarang berkurang PERMANEN saat itu juga (lihat
 * src/lib/persetujuan.ts, berkas "kerusakan"). Tidak menjurnal; kerugian yang perlu jejak akuntansi
 * ditautkan manual ke Penyesuaian Stok yang sudah disetujui (opsional, pola sama seperti peminjaman).
 */

type KlienDb = PrismaClient | Prisma.TransactionClient;
type BarisRusak = { barangId: string; jumlah: Desimal };

function bacaBaris(raw: FormDataEntryValue | null): BarisRusak[] {
  if (typeof raw !== "string" || !raw) throw new Error("Minimal 1 baris barang wajib diisi");
  let hasil: unknown;
  try {
    hasil = JSON.parse(raw);
  } catch {
    throw new Error("Format baris tidak valid");
  }
  if (!Array.isArray(hasil)) throw new Error("Minimal 1 baris barang wajib diisi");
  const daftar = (hasil as { barangId?: string; jumlah?: string | number }[])
    .filter((b) => b.barangId)
    .map((b) => ({ barangId: String(b.barangId), jumlah: uang(b.jumlah) }));
  if (daftar.length === 0) throw new Error("Minimal 1 baris barang wajib diisi");
  if (daftar.some((b) => b.jumlah.lte(0))) throw new Error("Jumlah tiap baris harus lebih dari 0");
  const ganda = daftar.map((b) => b.barangId).filter((id, i, arr) => arr.indexOf(id) !== i);
  if (ganda.length) throw new Error("Satu barang hanya boleh muncul sekali per dokumen");
  return daftar;
}

function bacaNamaPelapor(raw: FormDataEntryValue | null): string {
  const nama = String(raw ?? "").trim();
  if (!nama) throw new Error("Nama pelapor wajib diisi");
  return nama;
}

async function catatLog(klien: KlienDb, pengguna: PenggunaSesi, aksi: string, nomor: string, keterangan: string) {
  await klien.logAktivitas.create({
    data: { penggunaId: idPenggunaTersimpan(pengguna), penggunaNama: pengguna.nama, aksi, jenis: "Laporan Kerusakan Barang", nomor, keterangan },
  });
}

async function simpanFotoBukti(tx: Prisma.TransactionClient, kerusakanId: string, daftarFoto: Awaited<ReturnType<typeof bacaFotoDariFormulir>>) {
  const mulai = await tx.foto.count({ where: { kerusakanId } });
  await tx.foto.createMany({ data: daftarFoto.map((f, i) => ({ kerusakanId, urutan: mulai + i, tipe: f.tipe, ukuran: f.ukuran, isi: f.isi })) });
}

function revalidasi() {
  revalidatePath("/persediaan");
  revalidatePath("/persediaan/kerusakan");
  revalidatePath("/persetujuan");
  revalidatePath("/");
}

// ---------- Lapor barang rusak ----------

export async function buatLaporanKerusakan(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("kerusakan.buat");
  const gudangId = String(dataFormulir.get("gudangId") ?? "");
  if (!gudangId) throw new Error("Gudang wajib dipilih");
  const namaPelapor = bacaNamaPelapor(dataFormulir.get("namaPelapor"));
  const keterangan = String(dataFormulir.get("keterangan") ?? "").trim();
  const daftarBaris = bacaBaris(dataFormulir.get("baris"));
  const proyekId = await bacaProyekId(dataFormulir);
  const daftarFoto = await bacaFotoDariFormulir(dataFormulir, "foto", { wajib: true });
  const gudang = await db.gudang.findUnique({ where: { id: gudangId }, select: { nama: true } });
  if (!gudang) throw new Error("Gudang tidak ditemukan");

  // Sama seperti Peminjaman Barang/Penyesuaian Stok: mutasi stoknya ditahan sampai disetujui. Bila
  // alur persetujuan dimatikan, langsung DISETUJUI dan stok dikurangi di sini juga.
  const perluPersetujuan = await persetujuanWajib(db);

  await db.$transaction(async (tx) => {
    const idBarang = daftarBaris.map((b) => b.barangId);
    const daftarBarang = await tx.barang.findMany({ where: { id: { in: idBarang } }, select: { id: true, kode: true, nama: true, jenis: true } });
    const petaBarang = new Map(daftarBarang.map((b) => [b.id, b]));
    for (const b of daftarBaris) {
      const barang = petaBarang.get(b.barangId);
      if (!barang) throw new Error("Barang tidak ditemukan");
      if (barang.jenis !== "BARANG") throw new Error(`${barang.kode} - ${barang.nama} adalah JASA, tidak punya stok`);
    }
    const nomor = await nomorDokumenBerikutnya(tx.laporanKerusakanBarang, "BR");
    const dokumen = await tx.laporanKerusakanBarang.create({
      data: {
        nomor,
        gudangId,
        proyekId,
        namaPelapor,
        keterangan: keterangan || null,
        dicatatOlehId: idPenggunaTersimpan(pengguna),
        dicatatOlehNama: pengguna.nama,
        ...(perluPersetujuan ? { statusPersetujuan: "DRAFT" as const } : dataLangsungDisetujui(pengguna)),
        baris: { create: daftarBaris },
      },
    });
    await simpanFotoBukti(tx, dokumen.id, daftarFoto);
    if (!perluPersetujuan) {
      const label = await labelBarang(tx, idBarang);
      for (const b of daftarBaris) await kurangiStok(tx, b.barangId, gudangId, b.jumlah, label.get(b.barangId) ?? b.barangId);
    }
  });

  revalidasi();
  redirect("/persediaan/kerusakan");
}

export async function buatLaporanKerusakanFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatLaporanKerusakan(dataFormulir));
}

// ---------- Ubah data (bukan jumlah barang, tidak menyentuh stok) ----------

export async function ubahLaporanKerusakan(kerusakanId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("kerusakan.buat");
  const namaPelapor = bacaNamaPelapor(dataFormulir.get("namaPelapor"));
  const keterangan = String(dataFormulir.get("keterangan") ?? "").trim();
  const proyekId = await bacaProyekId(dataFormulir);
  const dokumen = await db.laporanKerusakanBarang.findUnique({ where: { id: kerusakanId }, select: { nomor: true } });
  if (!dokumen) throw new Error("Laporan kerusakan tidak ditemukan");
  await db.$transaction(async (tx) => {
    // Sama seperti Peminjaman Barang: boleh diubah kapan saja KECUALI sedang MENUNGGU persetujuan.
    const { count } = await tx.laporanKerusakanBarang.updateMany({
      where: { id: kerusakanId, statusPersetujuan: { not: "MENUNGGU" } },
      data: { namaPelapor, proyekId, keterangan: keterangan || null },
    });
    if (count === 0) throw new Error(`${dokumen.nomor} sedang menunggu persetujuan, tidak bisa diubah`);
    await catatLog(tx, pengguna, "UBAH", dokumen.nomor, `Pelapor ${namaPelapor}${keterangan ? `; ${keterangan}` : ""}`);
  });
  revalidatePath("/persediaan/kerusakan");
}

export async function ubahLaporanKerusakanFormulir(kerusakanId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahLaporanKerusakan(kerusakanId, dataFormulir));
}

// ---------- Tautkan Penyesuaian Stok (jejak akuntansi tambahan opsional) ----------

export async function tautkanPenyesuaianKerusakan(kerusakanId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("penyesuaian.setujui");
  const penyesuaianId = String(dataFormulir.get("penyesuaianId") ?? "").trim();
  if (!penyesuaianId) throw new Error("Penyesuaian Stok wajib dipilih");
  await db.$transaction(async (tx) => {
    const dokumen = await tx.laporanKerusakanBarang.findUnique({ where: { id: kerusakanId } });
    if (!dokumen) throw new Error("Laporan kerusakan tidak ditemukan");
    if (dokumen.statusPersetujuan !== "DISETUJUI") throw new Error(`${dokumen.nomor} belum disetujui`);
    if (dokumen.penyesuaianId) throw new Error(`${dokumen.nomor} sudah ditautkan ke Penyesuaian Stok`);
    const penyesuaian = await tx.penyesuaianPersediaan.findUnique({ where: { id: penyesuaianId }, select: { nomor: true, statusPersetujuan: true, gudangId: true } });
    if (!penyesuaian) throw new Error("Penyesuaian Stok tidak ditemukan");
    if (penyesuaian.statusPersetujuan !== "DISETUJUI") throw new Error(`${penyesuaian.nomor} belum disetujui`);
    if (penyesuaian.gudangId !== dokumen.gudangId) throw new Error(`${penyesuaian.nomor} untuk gudang lain, bukan gudang dokumen ${dokumen.nomor}`);
    await tx.laporanKerusakanBarang.update({ where: { id: kerusakanId }, data: { penyesuaianId } });
    await catatLog(tx, pengguna, "TAUTKAN", dokumen.nomor, `Ditautkan ke ${penyesuaian.nomor} untuk jejak akuntansi tambahan`);
  });
  revalidasi();
}

export async function tautkanPenyesuaianKerusakanFormulir(kerusakanId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => tautkanPenyesuaianKerusakan(kerusakanId, dataFormulir));
}

// ---------- Foto bukti tambahan (hak kerusakan.hapus) ----------

export async function unggahFotoKerusakan(kerusakanId: string, dataFormulir: FormData) {
  await wajibHakAksi("kerusakan.hapus");
  const daftarFoto = await bacaFotoDariFormulir(dataFormulir, "foto", { wajib: true });
  await db.$transaction(async (tx) => {
    const ada = await tx.laporanKerusakanBarang.count({ where: { id: kerusakanId } });
    if (!ada) throw new Error("Laporan kerusakan tidak ditemukan");
    await simpanFotoBukti(tx, kerusakanId, daftarFoto);
  });
  revalidatePath("/persediaan/kerusakan");
}

export async function unggahFotoKerusakanFormulir(kerusakanId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => unggahFotoKerusakan(kerusakanId, dataFormulir));
}

export async function hapusFotoKerusakan(fotoId: string) {
  await wajibHakAksi("kerusakan.hapus");
  const foto = await db.foto.findUnique({ where: { id: fotoId }, select: { kerusakanId: true } });
  if (!foto?.kerusakanId) throw new Error("Foto bukti tidak ditemukan");
  await db.foto.delete({ where: { id: fotoId } });
  revalidatePath("/persediaan/kerusakan");
}

export async function hapusFotoKerusakanFormulir(fotoId: string) {
  return jalankanFormulir(() => hapusFotoKerusakan(fotoId));
}
