"use server";

import { redirect } from "next/navigation";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { bacaEmailOpsional, bacaNamaPengguna } from "@/lib/identitasPengguna";
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
  const namaPengguna = bacaTeks(dataFormulir, "namaPengguna").toLowerCase();
  const kataSandi = bacaTeks(dataFormulir, "kataSandi");
  if (!namaPengguna || !kataSandi) throw new Error("Nama pengguna dan kata sandi wajib diisi");

  const pengguna = await db.pengguna.findUnique({ where: { namaPengguna } });
  // Tetap hitung hash walau akun tidak ada, supaya lama respons tidak membocorkan keberadaan akun
  const cocok = pengguna
    ? await verifikasiKataSandi(kataSandi, pengguna.kataSandiHash)
    : (await hashKataSandi(kataSandi), false);
  if (!pengguna || !cocok) throw new Error("Nama pengguna atau kata sandi salah");
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
/** Bandingkan dua string dengan waktu tetap (cegah timing attack pada kunci pemasangan). */
function samaAman(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function buatPemilikPertama(dataFormulir: FormData) {
  if ((await db.pengguna.count()) > 0) throw new Error("Akun pemilik sudah ada. Silakan masuk.");

  // Cegah perebutan akun: di produksi, membuat Pemilik pertama wajib memakai KUNCI_PEMASANGAN dari server.
  // Basis data kosong yang terekspos internet tidak bisa direbut anonim. Setel env di server, buat akun, lalu hapus env-nya.
  if (process.env.NODE_ENV === "production") {
    const kunciServer = process.env.KUNCI_PEMASANGAN ?? "";
    if (!kunciServer) throw new Error("Pemasangan awal dinonaktifkan. Minta admin server menyetel KUNCI_PEMASANGAN, lalu muat ulang.");
    const kunciKirim = String(dataFormulir.get("kunciPemasangan") ?? "");
    if (!samaAman(kunciKirim, kunciServer)) throw new Error("Kunci pemasangan salah.");
  }

  const nama = bacaTeks(dataFormulir, "nama");
  const namaPengguna = bacaNamaPengguna(bacaTeks(dataFormulir, "namaPengguna"));
  const email = bacaEmailOpsional(bacaTeks(dataFormulir, "email"));
  const kataSandi = bacaTeks(dataFormulir, "kataSandi");
  const ulangi = bacaTeks(dataFormulir, "ulangiKataSandi");
  if (!nama) throw new Error("Nama wajib diisi");
  const galatKekuatan = periksaKekuatanKataSandi(kataSandi);
  if (galatKekuatan) throw new Error(galatKekuatan);
  if (kataSandi !== ulangi) throw new Error("Ulangi kata sandi tidak sama");

  const pengguna = await db.pengguna.create({
    data: { nama, namaPengguna, email, kataSandiHash: await hashKataSandi(kataSandi), peran: "PEMILIK" },
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

// ---------- Lupa kata sandi (tanpa email: ditangani Superadmin/Pemilik/Admin lewat tautan sekali pakai) ----------

/**
 * Pengguna yang lupa kata sandi mengirim permintaan dari halaman masuk. Pesan yang tampil selalu sama
 * (tidak membocorkan apakah nama pengguna ada). Permintaan yang masih terbuka tidak digandakan.
 */
export async function mintaAturUlang(dataFormulir: FormData) {
  const namaPengguna = bacaTeks(dataFormulir, "namaPengguna").toLowerCase();
  if (!namaPengguna) throw new Error("Nama pengguna wajib diisi");
  const pengguna = await db.pengguna.findUnique({ where: { namaPengguna }, select: { id: true, aktif: true } });
  if (!pengguna || !pengguna.aktif) return;
  const terbuka = await db.permintaanAturUlang.findFirst({ where: { penggunaId: pengguna.id, status: { in: ["MENUNGGU", "TAUTAN"] } } });
  if (terbuka) return;
  await db.permintaanAturUlang.create({ data: { penggunaId: pengguna.id } });
}

export async function mintaAturUlangFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => mintaAturUlang(dataFormulir));
}

/** Membaca tautan: sah bila status TAUTAN dan belum kedaluwarsa. */
export async function periksaTautanAturUlang(token: string) {
  if (!token) return null;
  const p = await db.permintaanAturUlang.findUnique({ where: { token }, include: { pengguna: { select: { id: true, nama: true, namaPengguna: true, aktif: true } } } });
  if (!p || p.status !== "TAUTAN" || !p.kedaluwarsa || p.kedaluwarsa < new Date() || !p.pengguna.aktif) return null;
  return p;
}

/** Pengguna memakai tautan: kata sandi baru disimpan, semua sesi lama dicabut, langsung masuk. */
export async function pakaiTautanAturUlang(token: string, dataFormulir: FormData) {
  const p = await periksaTautanAturUlang(token);
  if (!p) throw new Error("Tautan atur ulang tidak berlaku, sudah dipakai, atau kedaluwarsa. Minta tautan baru ke Superadmin/Pemilik.");
  const baru = bacaTeks(dataFormulir, "kataSandiBaru");
  const ulangi = bacaTeks(dataFormulir, "ulangiKataSandi");
  const galatKekuatan = periksaKekuatanKataSandi(baru);
  if (galatKekuatan) throw new Error(galatKekuatan);
  if (baru !== ulangi) throw new Error("Ulangi kata sandi tidak sama");

  await db.$transaction([
    db.pengguna.update({ where: { id: p.penggunaId }, data: { kataSandiHash: await hashKataSandi(baru) } }),
    db.permintaanAturUlang.update({ where: { id: p.id }, data: { status: "SELESAI", selesaiPada: new Date(), token: null } }),
    db.sesi.deleteMany({ where: { penggunaId: p.penggunaId } }),
    db.logAktivitas.create({ data: { penggunaId: p.penggunaId, penggunaNama: p.pengguna.nama, aksi: "ATUR ULANG", jenis: "Kata Sandi", nomor: p.pengguna.namaPengguna, keterangan: "Kata sandi diganti lewat tautan atur ulang; semua sesi lama dicabut" } }),
  ]);
  await buatSesi(p.penggunaId);
  redirect("/");
}

export async function pakaiTautanAturUlangFormulir(token: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => pakaiTautanAturUlang(token, dataFormulir));
}

