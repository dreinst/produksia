"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
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
  // permintaan "lupa kata sandi" yang masih terbuka otomatis selesai
  await db.permintaanAturUlang.updateMany({ where: { penggunaId: id, status: { in: ["MENUNGGU", "TAUTAN"] } }, data: { status: "SELESAI", token: null, selesaiPada: new Date(), ditanganiOleh: pelaku.nama, ditanganiPada: new Date() } });
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

// ---------- Permintaan atur ulang kata sandi (lupa kata sandi) ----------

const UMUR_TAUTAN_MS = 24 * 60 * 60 * 1000;

async function ambilPermintaan(pelaku: PenggunaSesi, id: string) {
  const p = await db.permintaanAturUlang.findUnique({ where: { id }, include: { pengguna: true } });
  if (!p) throw new Error("Permintaan tidak ditemukan");
  if (peranTertinggi(p.pengguna.peran) && !peranTertinggi(pelaku.peran)) {
    throw new Error("Hanya Superadmin atau Pemilik yang bisa menangani permintaan akun Superadmin/Pemilik");
  }
  return p;
}

/** Membuat tautan sekali pakai (berlaku 24 jam) untuk diberikan langsung ke pengguna (WhatsApp/telepon/lisan). */
export async function buatTautanAturUlang(id: string) {
  const pelaku = await wajibHakAksi("pengguna.kelola");
  const p = await ambilPermintaan(pelaku, id);
  if (!["MENUNGGU", "TAUTAN"].includes(p.status)) throw new Error("Permintaan ini sudah selesai atau ditolak");
  const token = randomBytes(24).toString("base64url");
  await db.permintaanAturUlang.update({
    where: { id },
    data: { status: "TAUTAN", token, kedaluwarsa: new Date(Date.now() + UMUR_TAUTAN_MS), ditanganiOleh: pelaku.nama, ditanganiPada: new Date() },
  });
  await db.logAktivitas.create({
    data: { penggunaId: pelaku.id === "skrip-uji" ? null : pelaku.id, penggunaNama: pelaku.nama, aksi: "TAUTAN", jenis: "Kata Sandi", nomor: p.pengguna.namaPengguna, keterangan: "Tautan atur ulang kata sandi dibuat (berlaku 24 jam)" },
  });
  revalidatePath(HALAMAN);
}

/** Menolak/menutup permintaan tanpa mengubah kata sandi. */
export async function tolakPermintaanAturUlang(id: string) {
  const pelaku = await wajibHakAksi("pengguna.kelola");
  const p = await ambilPermintaan(pelaku, id);
  if (!["MENUNGGU", "TAUTAN"].includes(p.status)) throw new Error("Permintaan ini sudah selesai atau ditolak");
  await db.permintaanAturUlang.update({ where: { id }, data: { status: "DITOLAK", token: null, ditanganiOleh: pelaku.nama, ditanganiPada: new Date() } });
  await db.logAktivitas.create({
    data: { penggunaId: pelaku.id === "skrip-uji" ? null : pelaku.id, penggunaNama: pelaku.nama, aksi: "TOLAK", jenis: "Kata Sandi", nomor: p.pengguna.namaPengguna, keterangan: "Permintaan atur ulang kata sandi ditolak" },
  });
  revalidatePath(HALAMAN);
}

export async function buatTautanAturUlangFormulir(id: string) {
  return jalankanFormulir(() => buatTautanAturUlang(id));
}
export async function tolakPermintaanAturUlangFormulir(id: string) {
  return jalankanFormulir(() => tolakPermintaanAturUlang(id));
}
