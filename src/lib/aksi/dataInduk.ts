"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@/prisma-klien/client";
import { db } from "@/lib/db";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { ambilKonfigurasiEntitas, type KonfigurasiEntitas } from "@/lib/konfigurasiDataInduk";
import { wajibHakAksi } from "@/lib/otentikasi";
import { hakDataInduk, type PenggunaSesi } from "@/lib/hakAkses";
import { D, bacaUang, uang, type Desimal } from "@/lib/uang";
import { pastikanAkunRinci } from "@/lib/baganAkun";
import { catatJurnalPenyesuaianPersediaan } from "@/lib/akuntansi";
import { perbaruiHargaRata } from "@/lib/stok";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { dataLangsungDisetujui, persetujuanWajib } from "@/lib/persetujuan";
import { bacaFotoDariFormulir } from "@/lib/foto";

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
  const pengguna = await wajibHakAksi(hakDataInduk(slug).tulis);
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
    if (bidang.virtual) continue; // ditangani terpisah oleh aksi server, bukan kolom Prisma sungguhan
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

/**
 * Jumlah Awal di formulir Barang (bidang virtual, lihat konfigurasiDataInduk.ts): kalau diisi,
 * barang dibuat SEKALIGUS dengan satu Penyesuaian Stok berjurnal, di transaksi yang sama, jadi
 * barang baru langsung punya stok tanpa membuka formulir Penyesuaian Stok terpisah — TANPA
 * memutus jejak audit (tetap berjurnal, tetap ikut alur persetujuan bila alur itu menyala).
 * Mengembalikan true kalau ditangani di sini (barang sudah dibuat, pemanggil tidak perlu apa-apa lagi).
 */
async function buatBarangDenganJumlahAwal(pengguna: PenggunaSesi, data: Record<string, unknown>, dataFormulir: FormData): Promise<boolean> {
  const jumlahAwalMentah = dataFormulir.get("jumlahAwal");
  if (typeof jumlahAwalMentah !== "string" || !jumlahAwalMentah.trim()) return false;
  const jumlahAwal = bacaUang(jumlahAwalMentah, "Jumlah Awal", { allowZero: true });
  if (jumlahAwal.isZero()) return false;
  if (data.jenis === "JASA") throw new Error("Jasa tidak punya stok; kosongkan Jumlah Awal");

  const gudangAwalId = String(dataFormulir.get("gudangAwalId") ?? "");
  const akunLawanAwalId = String(dataFormulir.get("akunLawanAwalId") ?? "");
  if (!gudangAwalId) throw new Error("Gudang untuk Jumlah Awal wajib dipilih");
  if (!akunLawanAwalId) throw new Error("Akun Lawan Jumlah Awal wajib dipilih (mis. Modal)");
  await pastikanAkunRinci(db, [akunLawanAwalId]);

  const hargaSatuan = (data.hargaBeli as Desimal | undefined) ?? D(0);
  if (hargaSatuan.lte(0)) throw new Error("Isi Harga Beli lebih dulu untuk menghitung nilai Jumlah Awal");

  const perluPersetujuan = await persetujuanWajib(db);
  const nomor = await nomorDokumenBerikutnya(db.penyesuaianPersediaan, "PS");

  await db.$transaction(async (tx) => {
    const barang = await tx.barang.create({ data: data as Prisma.BarangCreateInput });
    if (!perluPersetujuan) {
      await tx.stokBarang.upsert({
        where: { barangId_gudangId: { barangId: barang.id, gudangId: gudangAwalId } },
        create: { barangId: barang.id, gudangId: gudangAwalId, jumlah: jumlahAwal },
        update: { jumlah: jumlahAwal },
      });
      await perbaruiHargaRata(tx, barang.id, jumlahAwal, hargaSatuan, true);
    }
    const keterangan = `Jumlah awal saat barang ${barang.kode} dibuat`;
    const penyesuaian = await tx.penyesuaianPersediaan.create({
      data: {
        nomor,
        gudangId: gudangAwalId,
        akunLawanId: akunLawanAwalId,
        keterangan,
        ...(perluPersetujuan ? { statusPersetujuan: "DRAFT" } : dataLangsungDisetujui(pengguna)),
        baris: { create: [{ barangId: barang.id, jumlahSebelum: D(0), jumlahSesudah: jumlahAwal, hargaSatuan }] },
      },
    });
    if (perluPersetujuan) return;
    const jurnal = await catatJurnalPenyesuaianPersediaan(tx, { nomor, akunLawanId: akunLawanAwalId, keterangan }, [{ barangId: barang.id, selisih: jumlahAwal, hargaSatuan }]);
    if (jurnal) await tx.penyesuaianPersediaan.update({ where: { id: penyesuaian.id }, data: { jurnalId: jurnal.id } });
  });

  revalidatePath("/persediaan");
  revalidatePath("/persediaan/penyesuaian");
  if (perluPersetujuan) revalidatePath("/persetujuan");
  return true;
}

export async function buatDataInduk(slug: string, dataFormulir: FormData) {
  const { config, pengguna } = await konfigurasiDenganHak(slug);
  const data = await bacaData(config, dataFormulir, false);
  if (slug !== "barang" || !(await buatBarangDenganJumlahAwal(pengguna, data, dataFormulir))) {
    await delegasi(config.model).create({ data });
  }
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

// ---------- Foto barang (galeri di halaman ubah Barang & Jasa) ----------

function revalidasiFotoBarang(barangId: string) {
  revalidatePath("/data-induk/barang");
  revalidatePath(`/data-induk/barang/${barangId}`);
}

// ---------- Stok barang (kartu "Stok Barang" di halaman Ubah Barang & Jasa) ----------

/**
 * Ubah "Stok saat ini" langsung dari halaman Barang & Jasa: di belakang layar ini membuat satu
 * Penyesuaian Stok berjurnal (jumlahSebelum = stok saat ini di gudang terpilih, jumlahSesudah = nilai
 * yang diisi), pola yang sama dengan Jumlah Awal saat barang baru dibuat (lihat
 * buatBarangDenganJumlahAwal di atas) — supaya koreksi stok cepat TANPA memutus jejak audit.
 */
export async function ubahStokBarang(barangId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("stok-induk.tulis");
  const gudangId = String(dataFormulir.get("gudangId") ?? "");
  if (!gudangId) throw new Error("Gudang wajib dipilih");
  const stokBaru = bacaUang(String(dataFormulir.get("stok") ?? ""), "Stok", { allowZero: true });

  const barang = await db.barang.findUnique({ where: { id: barangId }, select: { kode: true, jenis: true, hargaBeli: true } });
  if (!barang) throw new Error("Barang tidak ditemukan");
  if (barang.jenis !== "BARANG") throw new Error("Jasa tidak punya stok");

  const existing = await db.stokBarang.findUnique({ where: { barangId_gudangId: { barangId, gudangId } } });
  const jumlahSebelum = D(existing?.jumlah ?? 0);
  const selisih = stokBaru.minus(jumlahSebelum);
  if (selisih.isZero()) throw new Error(`Stok ${barang.kode} di gudang ini sudah ${jumlahSebelum}, tidak ada perubahan`);

  const akunLawanId = String(dataFormulir.get("akunLawanId") ?? "");
  if (!akunLawanId) throw new Error("Akun Lawan Penyesuaian wajib dipilih (mis. Selisih Persediaan)");
  await pastikanAkunRinci(db, [akunLawanId]);

  const hargaSatuan = D(barang.hargaBeli);
  if (selisih.gt(0) && hargaSatuan.lte(0)) throw new Error("Isi Harga Beli barang ini lebih dulu untuk menghitung nilai penyesuaian stok");

  const perluPersetujuan = await persetujuanWajib(db);
  const nomor = await nomorDokumenBerikutnya(db.penyesuaianPersediaan, "PS");
  const keterangan = `Koreksi stok ${barang.kode} dari halaman Barang & Jasa`;

  await db.$transaction(async (tx) => {
    if (!perluPersetujuan) {
      await tx.stokBarang.upsert({
        where: { barangId_gudangId: { barangId, gudangId } },
        create: { barangId, gudangId, jumlah: stokBaru },
        update: { jumlah: stokBaru },
      });
      if (selisih.gt(0)) await perbaruiHargaRata(tx, barangId, selisih, hargaSatuan, true);
    }
    const penyesuaian = await tx.penyesuaianPersediaan.create({
      data: {
        nomor,
        gudangId,
        akunLawanId,
        keterangan,
        ...(perluPersetujuan ? { statusPersetujuan: "DRAFT" as const } : dataLangsungDisetujui(pengguna)),
        baris: { create: [{ barangId, jumlahSebelum, jumlahSesudah: stokBaru, hargaSatuan }] },
      },
    });
    if (perluPersetujuan) return;
    const jurnal = await catatJurnalPenyesuaianPersediaan(tx, { nomor, akunLawanId, keterangan }, [{ barangId, selisih, hargaSatuan }]);
    if (jurnal) await tx.penyesuaianPersediaan.update({ where: { id: penyesuaian.id }, data: { jurnalId: jurnal.id } });
  });

  revalidatePath("/persediaan");
  revalidatePath("/persediaan/penyesuaian");
  revalidatePath(`/data-induk/barang/${barangId}`);
  if (perluPersetujuan) revalidatePath("/persetujuan");
}

export async function ubahStokBarangFormulir(barangId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahStokBarang(barangId, dataFormulir));
}

export async function unggahFotoBarangFormulir(barangId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(async () => {
    await wajibHakAksi("stok-induk.tulis");
    const daftarFoto = await bacaFotoDariFormulir(dataFormulir, "foto", { maksimal: 3, wajib: true });
    const barang = await db.barang.findUnique({ where: { id: barangId }, select: { _count: { select: { foto: true } } } });
    if (!barang) throw new Error("Barang tidak ditemukan");
    const mulai = barang._count.foto;
    await db.foto.createMany({ data: daftarFoto.map((f, i) => ({ barangId, urutan: mulai + i, tipe: f.tipe, ukuran: f.ukuran, isi: f.isi })) });
    revalidasiFotoBarang(barangId);
  });
}

// Dipakai lewat .bind(null, fotoId); argumen useActionState diabaikan seperti hapusDataIndukFormulir
export async function hapusFotoBarangFormulir(fotoId: string) {
  return jalankanFormulir(async () => {
    await wajibHakAksi("stok-induk.tulis");
    const foto = await db.foto.findUnique({ where: { id: fotoId }, select: { barangId: true } });
    // Foto bukti peminjaman (barangId null) punya aksi hapus sendiri dengan hak berbeda
    if (!foto?.barangId) throw new Error("Foto barang tidak ditemukan");
    await db.foto.delete({ where: { id: fotoId } });
    revalidasiFotoBarang(foto.barangId);
  });
}
