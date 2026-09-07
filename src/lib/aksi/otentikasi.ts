"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import {
  buatSesi,
  hapusSemuaSesiPengguna,
  hapusSesi,
  hashKataSandi,
  penggunaSaatIni,
  periksaKekuatanKataSandi,
  verifikasiKataSandi,
} from "@/lib/otentikasi";

function bacaTeks(dataFormulir: FormData, nama: string): string {
  const nilai = dataFormulir.get(nama);
  return typeof nilai === "string" ? nilai.trim() : "";
}

/** Hanya izinkan tujuan di dalam situs ini (cegah open redirect). */
function tujuanAman(nilai: string): string {
  return nilai.startsWith("/") && !nilai.startsWith("//") ? nilai : "/";
}

export async function masuk(dataFormulir: FormData) {
  const email = bacaTeks(dataFormulir, "email").toLowerCase();
  const kataSandi = bacaTeks(dataFormulir, "kataSandi");
  if (!email || !kataSandi) throw new Error("Email dan kata sandi wajib diisi");

  const pengguna = await db.pengguna.findUnique({ where: { email } });
  // Tetap hitung hash walau email tidak ada, supaya lama respons tidak membocorkan keberadaan akun
  const cocok = pengguna
    ? await verifikasiKataSandi(kataSandi, pengguna.kataSandiHash)
    : (await hashKataSandi(kataSandi), false);
  if (!pengguna || !cocok) throw new Error("Email atau kata sandi salah");
  if (!pengguna.aktif) throw new Error("Akun ini dinonaktifkan. Hubungi pemilik atau admin.");

  await buatSesi(pengguna.id);
  redirect(tujuanAman(bacaTeks(dataFormulir, "kembali")));
}

export async function masukFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => masuk(dataFormulir));
}

export async function keluar() {
  await hapusSesi();
  redirect("/masuk");
}

/** Dipakai sekali saat basis data belum punya pengguna sama sekali (pemasangan awal). */
export async function buatPemilikPertama(dataFormulir: FormData) {
  if ((await db.pengguna.count()) > 0) throw new Error("Akun pemilik sudah ada. Silakan masuk.");

  const nama = bacaTeks(dataFormulir, "nama");
  const email = bacaTeks(dataFormulir, "email").toLowerCase();
  const kataSandi = bacaTeks(dataFormulir, "kataSandi");
  const ulangi = bacaTeks(dataFormulir, "ulangiKataSandi");
  if (!nama || !email) throw new Error("Nama dan email wajib diisi");
  if (!email.includes("@")) throw new Error("Format email tidak valid");
  const galatKekuatan = periksaKekuatanKataSandi(kataSandi);
  if (galatKekuatan) throw new Error(galatKekuatan);
  if (kataSandi !== ulangi) throw new Error("Ulangi kata sandi tidak sama");

  const pengguna = await db.pengguna.create({
    data: { nama, email, kataSandiHash: await hashKataSandi(kataSandi), peran: "PEMILIK" },
  });
  await buatSesi(pengguna.id);
  redirect("/");
}

export async function buatPemilikPertamaFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatPemilikPertama(dataFormulir));
}

export async function gantiKataSandi(dataFormulir: FormData) {
  const saya = await penggunaSaatIni();
  if (!saya) throw new Error("Sesi sudah berakhir. Silakan masuk kembali.");

  const lama = bacaTeks(dataFormulir, "kataSandiLama");
  const baru = bacaTeks(dataFormulir, "kataSandiBaru");
  const ulangi = bacaTeks(dataFormulir, "ulangiKataSandi");

  const pengguna = await db.pengguna.findUniqueOrThrow({ where: { id: saya.id } });
  if (!(await verifikasiKataSandi(lama, pengguna.kataSandiHash))) throw new Error("Kata sandi lama salah");
  const galatKekuatan = periksaKekuatanKataSandi(baru);
  if (galatKekuatan) throw new Error(galatKekuatan);
  if (baru !== ulangi) throw new Error("Ulangi kata sandi tidak sama");
  if (baru === lama) throw new Error("Kata sandi baru harus berbeda dari yang lama");

  await db.pengguna.update({ where: { id: saya.id }, data: { kataSandiHash: await hashKataSandi(baru) } });
  // Keluarkan semua perangkat lain, lalu buat sesi baru untuk perangkat ini
  await hapusSemuaSesiPengguna(saya.id);
  await buatSesi(saya.id);
}

export async function gantiKataSandiFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => gantiKataSandi(dataFormulir));
}
