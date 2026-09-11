"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { ambilKonfigurasiEntitas, type KonfigurasiEntitas } from "@/lib/konfigurasiDataInduk";
import { wajibHakAksi } from "@/lib/otentikasi";
import type { PenggunaSesi } from "@/lib/hakAkses";
import { uang } from "@/lib/uang";

// Batas atas kolom uang/kuantitas Decimal(18,2) di skema (16 digit sebelum koma).
// Semua bidang "number" data induk adalah harga/kuantitas yang tidak boleh negatif.
const BATAS_NILAI = uang("9999999999999999.99");

type DelegasiPrisma = {
  create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  delete: (args: { where: { id: string } }) => Promise<unknown>;
};

function delegasi(model: string): DelegasiPrisma {
  return (db as unknown as Record<string, DelegasiPrisma>)[model];
}

type DelegasiValidasi = {
  count: (args: { where: Record<string, unknown> }) => Promise<number>;
};

function delegasiValidasi(model: string): DelegasiValidasi {
  return (db as unknown as Record<string, DelegasiValidasi>)[model];
}

async function konfigurasiDenganHak(slug: string): Promise<{ config: KonfigurasiEntitas; pengguna: PenggunaSesi }> {
  const config = ambilKonfigurasiEntitas(slug);
  if (!config) throw new Error(`Entitas tidak dikenal: ${slug}`);
  // Bagan akun menentukan struktur laporan keuangan → butuh hak buku besar, bukan sekadar data induk
  const pengguna = await wajibHakAksi(slug === "akun" ? "buku-besar.tulis" : "data-induk.tulis");
  return { config, pengguna };
}

// Bagan akun menentukan struktur laporan keuangan, jadi perubahannya (termasuk hapus)
// dicatat ke jejak audit seperti operasi sensitif lain (bandingkan hapusDokumen.ts).
async function catatBaganAkun(pengguna: PenggunaSesi, aksi: string, nomor: string, keterangan: string) {
  await db.logAktivitas.create({
    data: { penggunaId: pengguna.id === "skrip-uji" ? null : pengguna.id, penggunaNama: pengguna.nama, aksi, jenis: "Bagan Akun", nomor, keterangan },
  });
}

/**
 * Membaca isian formulir sesuai konfigurasi entitas.
 * `untukUbah` = true → isian kosong pada bidang opsional ditulis sebagai null (mengosongkan nilai lama),
 * sedangkan saat membuat data baru bidang kosong dilewati saja (pakai default skema).
 */
async function bacaData(config: KonfigurasiEntitas, dataFormulir: FormData, untukUbah: boolean) {
  const data: Record<string, unknown> = {};
  for (const bidang of config.bidang) {
    const mentah = dataFormulir.get(bidang.nama);
    const nilai = typeof mentah === "string" ? mentah.trim() : "";
    if (bidang.jenis === "boolean") {
      data[bidang.nama] = mentah === "on";
      continue;
    }

    if (!nilai) {
      if (bidang.wajib) throw new Error(`${bidang.label} wajib diisi`);
      if (untukUbah) data[bidang.nama] = bidang.nilaiBawaan ?? null;
      continue;
    }
    if (bidang.jenis === "number") {
      if (Number.isNaN(Number(nilai))) throw new Error(`${bidang.label} harus berupa angka`);
      const angka = uang(nilai);
      if (angka.isNegative()) throw new Error(`${bidang.label} tidak boleh negatif`);
      if (angka.gt(BATAS_NILAI)) throw new Error(`${bidang.label} melebihi batas nilai yang wajar`);
      data[bidang.nama] = angka;
      continue;
    }
    if (bidang.jenis === "date") {
      const tanggal = new Date(`${nilai}T00:00:00`);
      if (Number.isNaN(tanggal.getTime())) throw new Error(`${bidang.label} harus berupa tanggal`);
      data[bidang.nama] = tanggal;
      continue;
    }
    // Bidang select relasi (mis. akunPendapatanId, kelompokId): filter opsi.where hanya membatasi
    // pilihan di UI. Di server, pastikan id benar-benar ada dan memenuhi opsi.where
    // (jenis/kelompok/model) supaya akun berjenis salah tidak lolos ke penjurnalan.
    if (bidang.jenis === "select" && bidang.opsi) {
      const { model, bidangNilai, where } = bidang.opsi;
      const cocok = await delegasiValidasi(model).count({ where: { [bidangNilai]: nilai, ...where } });
      if (cocok === 0) throw new Error(`${bidang.label} tidak valid`);
    }
    data[bidang.nama] = nilai;
  }
  return data;
}

export async function buatDataInduk(slug: string, dataFormulir: FormData) {
  const { config, pengguna } = await konfigurasiDenganHak(slug);
  const data = await bacaData(config, dataFormulir, false);
  await delegasi(config.model).create({ data });
  if (slug === "akun") await catatBaganAkun(pengguna, "BUAT", String(data.kode ?? ""), `Akun ${String(data.kode ?? "")} — ${String(data.nama ?? "")} dibuat`);
  revalidatePath(`/data-induk/${slug}`);
}

export async function ubahDataInduk(slug: string, id: string, dataFormulir: FormData) {
  const { config, pengguna } = await konfigurasiDenganHak(slug);
  const data = await bacaData(config, dataFormulir, true);
  if ("indukId" in data && data.indukId === id) throw new Error("Data tidak bisa menjadi induk dirinya sendiri");
  await delegasi(config.model).update({ where: { id }, data });
  if (slug === "akun") await catatBaganAkun(pengguna, "UBAH", String(data.kode ?? ""), `Akun ${String(data.kode ?? "")} — ${String(data.nama ?? "")} diubah`);
  revalidatePath(`/data-induk/${slug}`);
  redirect(`/data-induk/${slug}`);
}

export async function hapusDataInduk(slug: string, id: string) {
  const { config, pengguna } = await konfigurasiDenganHak(slug);
  // Ambil identitas akun sebelum dihapus agar jejak audit tetap bermakna
  const jejakAkun = slug === "akun" ? await db.akun.findUnique({ where: { id }, select: { kode: true, nama: true } }) : null;
  await delegasi(config.model).delete({ where: { id } });
  if (slug === "akun") await catatBaganAkun(pengguna, "HAPUS", jejakAkun?.kode ?? id, jejakAkun ? `Akun ${jejakAkun.kode} — ${jejakAkun.nama} dihapus` : `Akun ${id} dihapus`);
  revalidatePath(`/data-induk/${slug}`);
}

// ---------- Varian untuk <FormulirAksi> (mengembalikan pesan error, bukan throw) ----------

export async function buatDataIndukFormulir(slug: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatDataInduk(slug, dataFormulir));
}
export async function ubahDataIndukFormulir(slug: string, id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahDataInduk(slug, id, dataFormulir));
}
// Dipakai lewat .bind(null, slug, id); argumen (prevState, dataFormulir) dari useActionState sengaja diabaikan
export async function hapusDataIndukFormulir(slug: string, id: string) {
  return jalankanFormulir(() => hapusDataInduk(slug, id));
}
