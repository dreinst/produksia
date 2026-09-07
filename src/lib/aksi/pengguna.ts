"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { DAFTAR_PERAN, type PenggunaSesi } from "@/lib/hakAkses";
import { hapusSemuaSesiPengguna, hashKataSandi, periksaKekuatanKataSandi, wajibHakAksi } from "@/lib/otentikasi";
import type { PeranPengguna } from "@/prisma-klien/enums";

const HALAMAN = "/pengaturan/pengguna";

function bacaTeks(dataFormulir: FormData, nama: string): string {
  const nilai = dataFormulir.get(nama);
  return typeof nilai === "string" ? nilai.trim() : "";
}

function bacaPeran(dataFormulir: FormData): PeranPengguna {
  const nilai = bacaTeks(dataFormulir, "peran") as PeranPengguna;
  if (!DAFTAR_PERAN.includes(nilai)) throw new Error("Peran tidak dikenal");
  return nilai;
}

/** Aturan siapa boleh menyentuh akun siapa. */
async function ambilSasaran(pelaku: PenggunaSesi, id: string) {
  const sasaran = await db.pengguna.findUnique({ where: { id } });
  if (!sasaran) throw new Error("Pengguna tidak ditemukan");
  if (sasaran.peran === "PEMILIK" && pelaku.peran !== "PEMILIK") {
    throw new Error("Hanya Pemilik yang bisa mengubah akun berperan Pemilik");
  }
  return sasaran;
}

async function pastikanMasihAdaPemilikAktif(kecualiId: string) {
  const sisa = await db.pengguna.count({ where: { peran: "PEMILIK", aktif: true, id: { not: kecualiId } } });
  if (sisa === 0) throw new Error("Harus tersisa minimal satu akun Pemilik yang aktif");
}

export async function buatPengguna(dataFormulir: FormData) {
  const pelaku = await wajibHakAksi("pengguna.kelola");
  const nama = bacaTeks(dataFormulir, "nama");
  const email = bacaTeks(dataFormulir, "email").toLowerCase();
  const kataSandi = bacaTeks(dataFormulir, "kataSandi");
  const peran = bacaPeran(dataFormulir);

  if (!nama || !email) throw new Error("Nama dan email wajib diisi");
  if (!email.includes("@")) throw new Error("Format email tidak valid");
  const galatKekuatan = periksaKekuatanKataSandi(kataSandi);
  if (galatKekuatan) throw new Error(galatKekuatan);
  if (peran === "PEMILIK" && pelaku.peran !== "PEMILIK") throw new Error("Hanya Pemilik yang bisa membuat akun Pemilik");

  await db.pengguna.create({ data: { nama, email, kataSandiHash: await hashKataSandi(kataSandi), peran } });
  revalidatePath(HALAMAN);
}

export async function ubahPengguna(id: string, dataFormulir: FormData) {
  const pelaku = await wajibHakAksi("pengguna.kelola");
  const sasaran = await ambilSasaran(pelaku, id);
  const nama = bacaTeks(dataFormulir, "nama");
  const peran = bacaPeran(dataFormulir);
  const aktif = dataFormulir.get("aktif") === "on";
  if (!nama) throw new Error("Nama wajib diisi");

  if (sasaran.id === pelaku.id && (peran !== sasaran.peran || !aktif)) {
    throw new Error("Peran atau status akun sendiri tidak bisa diubah; minta Pemilik lain melakukannya");
  }
  if (peran === "PEMILIK" && pelaku.peran !== "PEMILIK") throw new Error("Hanya Pemilik yang bisa memberi peran Pemilik");
  if (sasaran.peran === "PEMILIK" && (peran !== "PEMILIK" || !aktif)) await pastikanMasihAdaPemilikAktif(sasaran.id);

  await db.pengguna.update({ where: { id }, data: { nama, peran, aktif } });
  if (!aktif || peran !== sasaran.peran) await hapusSemuaSesiPengguna(id); // paksa masuk ulang dengan hak baru
  revalidatePath(HALAMAN);
}

export async function aturUlangKataSandi(id: string, dataFormulir: FormData) {
  const pelaku = await wajibHakAksi("pengguna.kelola");
  await ambilSasaran(pelaku, id);
  const kataSandi = bacaTeks(dataFormulir, "kataSandiBaru");
  const galatKekuatan = periksaKekuatanKataSandi(kataSandi);
  if (galatKekuatan) throw new Error(galatKekuatan);

  await db.pengguna.update({ where: { id }, data: { kataSandiHash: await hashKataSandi(kataSandi) } });
  if (id !== pelaku.id) await hapusSemuaSesiPengguna(id);
  revalidatePath(HALAMAN);
}

export async function hapusPengguna(id: string) {
  const pelaku = await wajibHakAksi("pengguna.kelola");
  const sasaran = await ambilSasaran(pelaku, id);
  if (sasaran.id === pelaku.id) throw new Error("Akun sendiri tidak bisa dihapus");
  if (sasaran.peran === "PEMILIK") await pastikanMasihAdaPemilikAktif(sasaran.id);

  await db.$transaction([
    db.karyawan.updateMany({ where: { penggunaId: id }, data: { penggunaId: null } }),
    db.pengguna.delete({ where: { id } }), // sesi ikut terhapus (onDelete: Cascade)
  ]);
  revalidatePath(HALAMAN);
}

// ---------- Varian untuk <FormulirAksi> ----------

export async function buatPenggunaFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatPengguna(dataFormulir));
}
export async function ubahPenggunaFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahPengguna(id, dataFormulir));
}
export async function aturUlangKataSandiFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => aturUlangKataSandi(id, dataFormulir));
}
// Dipakai lewat .bind(null, id); argumen (prevState, dataFormulir) dari useActionState sengaja diabaikan
export async function hapusPenggunaFormulir(id: string) {
  return jalankanFormulir(() => hapusPengguna(id));
}
