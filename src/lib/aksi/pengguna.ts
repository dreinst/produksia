"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { DAFTAR_PERAN, PERAN_TERTINGGI, peranTertinggi, type PenggunaSesi } from "@/lib/hakAkses";
import { bacaEmailOpsional, bacaNamaPengguna } from "@/lib/identitasPengguna";
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

/** Aturan siapa boleh menyentuh akun siapa: akun Superadmin/Pemilik hanya oleh Superadmin/Pemilik. */
async function ambilSasaran(pelaku: PenggunaSesi, id: string) {
  const sasaran = await db.pengguna.findUnique({ where: { id } });
  if (!sasaran) throw new Error("Pengguna tidak ditemukan");
  if (peranTertinggi(sasaran.peran) && !peranTertinggi(pelaku.peran)) {
    throw new Error("Hanya Superadmin atau Pemilik yang bisa mengubah akun berperan Superadmin/Pemilik");
  }
  return sasaran;
}

async function pastikanMasihAdaPemilikAktif(kecualiId: string) {
  const sisa = await db.pengguna.count({ where: { peran: { in: [...PERAN_TERTINGGI] }, aktif: true, id: { not: kecualiId } } });
  if (sisa === 0) throw new Error("Harus tersisa minimal satu akun Superadmin/Pemilik yang aktif");
}

async function pastikanNamaPenggunaBebas(namaPengguna: string, kecualiId?: string) {
  const ada = await db.pengguna.findUnique({ where: { namaPengguna }, select: { id: true } });
  if (ada && ada.id !== kecualiId) throw new Error(`Nama pengguna "${namaPengguna}" sudah dipakai`);
}

export async function buatPengguna(dataFormulir: FormData) {
  const pelaku = await wajibHakAksi("pengguna.kelola");
  const nama = bacaTeks(dataFormulir, "nama");
  const namaPengguna = bacaNamaPengguna(bacaTeks(dataFormulir, "namaPengguna"));
  const email = bacaEmailOpsional(bacaTeks(dataFormulir, "email"));
  const kataSandi = bacaTeks(dataFormulir, "kataSandi");
  const peran = bacaPeran(dataFormulir);

  if (!nama) throw new Error("Nama wajib diisi");
  const galatKekuatan = periksaKekuatanKataSandi(kataSandi);
  if (galatKekuatan) throw new Error(galatKekuatan);
  if (peranTertinggi(peran) && !peranTertinggi(pelaku.peran)) throw new Error("Hanya Superadmin atau Pemilik yang bisa membuat akun Superadmin/Pemilik");
  await pastikanNamaPenggunaBebas(namaPengguna);

  await db.pengguna.create({ data: { nama, namaPengguna, email, kataSandiHash: await hashKataSandi(kataSandi), peran } });
  revalidatePath(HALAMAN);
}

export async function ubahPengguna(id: string, dataFormulir: FormData) {
  const pelaku = await wajibHakAksi("pengguna.kelola");
  const sasaran = await ambilSasaran(pelaku, id);
  const nama = bacaTeks(dataFormulir, "nama");
  const namaPengguna = bacaNamaPengguna(bacaTeks(dataFormulir, "namaPengguna"));
  const email = bacaEmailOpsional(bacaTeks(dataFormulir, "email"));
  const peran = bacaPeran(dataFormulir);
  const aktif = dataFormulir.get("aktif") === "on";
  if (!nama) throw new Error("Nama wajib diisi");
  await pastikanNamaPenggunaBebas(namaPengguna, id);

  if (sasaran.id === pelaku.id && (peran !== sasaran.peran || !aktif)) {
    throw new Error("Peran atau status akun sendiri tidak bisa diubah; minta Superadmin/Pemilik lain melakukannya");
  }
  if (peranTertinggi(peran) && !peranTertinggi(pelaku.peran)) throw new Error("Hanya Superadmin atau Pemilik yang bisa memberi peran Superadmin/Pemilik");
  if (peranTertinggi(sasaran.peran) && (!peranTertinggi(peran) || !aktif)) await pastikanMasihAdaPemilikAktif(sasaran.id);

  await db.pengguna.update({ where: { id }, data: { nama, namaPengguna, email, peran, aktif } });
  if (!aktif || peran !== sasaran.peran) await hapusSemuaSesiPengguna(id); // paksa masuk ulang dengan hak baru
  revalidatePath(HALAMAN);
  revalidatePath(`${HALAMAN}/${id}`);
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
  if (peranTertinggi(sasaran.peran)) await pastikanMasihAdaPemilikAktif(sasaran.id);

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
