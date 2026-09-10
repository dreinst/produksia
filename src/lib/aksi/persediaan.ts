"use server";

import { wajibHakAksi } from "@/lib/otentikasi";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { pastikanAkunRinci } from "@/lib/baganAkun";
import { D, uang, type Desimal } from "@/lib/uang";
import { kurangiStok, perbaruiHargaRata, tambahStok } from "@/lib/stok";
import { catatJurnalPenyesuaianPersediaan } from "@/lib/akuntansi";

type BarisPenyesuaian = { barangId: string; jumlahSesudah: Desimal; hargaSatuan: Desimal | null };

function bacaBaris(raw: FormDataEntryValue | null): BarisPenyesuaian[] {
  if (typeof raw !== "string" || !raw) throw new Error("Minimal 1 baris barang wajib diisi");
  let hasil: unknown;
  try {
    hasil = JSON.parse(raw);
  } catch {
    throw new Error("Format baris tidak valid");
  }
  if (!Array.isArray(hasil)) throw new Error("Minimal 1 baris barang wajib diisi");
  const daftar = (hasil as { barangId?: string; jumlahSesudah?: string | number; hargaSatuan?: string | number }[])
    .filter((b) => b.barangId)
    .map((b) => ({
      barangId: String(b.barangId),
      jumlahSesudah: uang(b.jumlahSesudah),
      hargaSatuan: b.hargaSatuan === undefined || b.hargaSatuan === null || b.hargaSatuan === "" ? null : uang(b.hargaSatuan),
    }));
  if (daftar.length === 0) throw new Error("Minimal 1 baris barang wajib diisi");
  if (daftar.some((b) => b.jumlahSesudah.isNegative())) throw new Error("Jumlah sesudah tidak boleh negatif");
  if (daftar.some((b) => b.hargaSatuan && b.hargaSatuan.isNegative())) throw new Error("Harga satuan tidak boleh negatif");
  const ganda = daftar.map((b) => b.barangId).filter((id, i, arr) => arr.indexOf(id) !== i);
  if (ganda.length) throw new Error("Satu barang hanya boleh muncul sekali per penyesuaian");
  return daftar;
}

/**
 * Penyesuaian persediaan (saldo awal, hasil opname, koreksi): stok fisik di gudang diset ke jumlah baru,
 * selisihnya dinilai dengan harga pokok dan dijurnal ke akun lawan (Modal untuk saldo awal, Selisih
 * Persediaan untuk opname). Dengan ini nilai stok dan saldo akun Persediaan tetap sama.
 */
export async function buatPenyesuaianPersediaan(dataFormulir: FormData) {
  await wajibHakAksi("persediaan.tulis");
  const gudangId = String(dataFormulir.get("gudangId") ?? "");
  const akunLawanId = String(dataFormulir.get("akunLawanId") ?? "");
  const keterangan = String(dataFormulir.get("keterangan") ?? "").trim();
  if (!gudangId) throw new Error("Gudang wajib dipilih");
  if (!akunLawanId) throw new Error("Akun lawan wajib dipilih (Modal untuk saldo awal, Selisih Persediaan untuk opname)");
  const daftarBaris = bacaBaris(dataFormulir.get("baris"));
  await pastikanAkunRinci(db, [akunLawanId]);

  const nomor = await nomorDokumenBerikutnya(db.penyesuaianPersediaan, "PS");

  await db.$transaction(async (tx) => {
    const daftarBarang = await tx.barang.findMany({
      where: { id: { in: daftarBaris.map((b) => b.barangId) } },
      select: { id: true, kode: true, nama: true, jenis: true, hargaBeli: true },
    });
    const petaBarang = new Map(daftarBarang.map((b) => [b.id, b]));
    const barisTersimpan: { barangId: string; jumlahSebelum: Desimal; jumlahSesudah: Desimal; hargaSatuan: Desimal }[] = [];

    for (const b of daftarBaris) {
      const barang = petaBarang.get(b.barangId);
      if (!barang) throw new Error("Barang tidak ditemukan");
      if (barang.jenis !== "BARANG") throw new Error(`${barang.kode} - ${barang.nama} adalah JASA, tidak punya stok`);
      const stok = await tx.stokBarang.findUnique({ where: { barangId_gudangId: { barangId: b.barangId, gudangId } } });
      const jumlahSebelum = D(stok?.jumlah ?? 0);
      const selisih = b.jumlahSesudah.minus(jumlahSebelum);
      if (selisih.isZero()) continue;
      // barang bertambah: boleh memberi harga pokok sendiri (saldo awal); berkurang: selalu harga pokok saat ini
      const hargaSatuan = selisih.gt(0) && b.hargaSatuan && b.hargaSatuan.gt(0) ? b.hargaSatuan : D(barang.hargaBeli);
      if (selisih.gt(0) && hargaSatuan.lte(0)) {
        throw new Error(`Harga pokok ${barang.kode} - ${barang.nama} belum ada; isi harga satuan pada baris penyesuaian`);
      }

      await tx.stokBarang.upsert({
        where: { barangId_gudangId: { barangId: b.barangId, gudangId } },
        create: { barangId: b.barangId, gudangId, jumlah: b.jumlahSesudah },
        update: { jumlah: b.jumlahSesudah },
      });
      if (selisih.gt(0)) await perbaruiHargaRata(tx, b.barangId, selisih, hargaSatuan, true);
      barisTersimpan.push({ barangId: b.barangId, jumlahSebelum, jumlahSesudah: b.jumlahSesudah, hargaSatuan });
    }
    if (barisTersimpan.length === 0) throw new Error("Tidak ada perubahan jumlah — semua baris sama dengan stok saat ini");

    const penyesuaian = await tx.penyesuaianPersediaan.create({
      data: { nomor, gudangId, akunLawanId, keterangan: keterangan || null, baris: { create: barisTersimpan } },
    });
    const jurnal = await catatJurnalPenyesuaianPersediaan(
      tx,
      { nomor, akunLawanId, keterangan: keterangan || null },
      barisTersimpan.map((b) => ({ barangId: b.barangId, selisih: b.jumlahSesudah.minus(b.jumlahSebelum), hargaSatuan: b.hargaSatuan })),
    );
    if (jurnal) await tx.penyesuaianPersediaan.update({ where: { id: penyesuaian.id }, data: { jurnalId: jurnal.id } });
  });

  revalidatePath("/persediaan");
  revalidatePath("/persediaan/penyesuaian");
  redirect("/persediaan/penyesuaian");
}

export async function buatPenyesuaianPersediaanFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatPenyesuaianPersediaan(dataFormulir));
}

// ---------- Pindah Barang antar gudang ----------

type BarisPindah = { barangId: string; jumlah: Desimal };

function bacaBarisPindah(raw: FormDataEntryValue | null): BarisPindah[] {
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
    .map((b) => ({ barangId: String(b.barangId), jumlah: uang(b.jumlah) }))
    .filter((b) => !b.jumlah.isZero());
  if (daftar.length === 0) throw new Error("Minimal 1 baris barang dengan jumlah > 0 wajib diisi");
  if (daftar.some((b) => b.jumlah.isNegative())) throw new Error("Jumlah pindah tidak boleh negatif");
  const ganda = daftar.map((b) => b.barangId).filter((id, i, arr) => arr.indexOf(id) !== i);
  if (ganda.length) throw new Error("Satu barang hanya boleh muncul sekali per pindah barang");
  return daftar;
}

/**
 * Pindah barang antar gudang: stok fisik berkurang di gudang asal dan bertambah di gudang tujuan.
 * Nilai persediaan tidak berubah (harga pokok rata-rata per barang berlaku di semua gudang), jadi tanpa jurnal.
 */
export async function buatPindahBarang(dataFormulir: FormData) {
  await wajibHakAksi("persediaan.tulis");
  const gudangAsalId = String(dataFormulir.get("gudangAsalId") ?? "");
  const gudangTujuanId = String(dataFormulir.get("gudangTujuanId") ?? "");
  const keterangan = String(dataFormulir.get("keterangan") ?? "").trim();
  if (!gudangAsalId) throw new Error("Gudang asal wajib dipilih");
  if (!gudangTujuanId) throw new Error("Gudang tujuan wajib dipilih");
  if (gudangAsalId === gudangTujuanId) throw new Error("Gudang asal dan tujuan harus berbeda");
  const daftarBaris = bacaBarisPindah(dataFormulir.get("baris"));
  const jumlahGudang = await db.gudang.count({ where: { id: { in: [gudangAsalId, gudangTujuanId] } } });
  if (jumlahGudang !== 2) throw new Error("Gudang tidak ditemukan");

  const nomor = await nomorDokumenBerikutnya(db.pindahBarang, "PB");

  await db.$transaction(async (tx) => {
    const daftarBarang = await tx.barang.findMany({ where: { id: { in: daftarBaris.map((b) => b.barangId) } }, select: { id: true, kode: true, nama: true, jenis: true } });
    const petaBarang = new Map(daftarBarang.map((b) => [b.id, b]));
    for (const b of daftarBaris) {
      const barang = petaBarang.get(b.barangId);
      if (!barang) throw new Error("Barang tidak ditemukan");
      if (barang.jenis !== "BARANG") throw new Error(`${barang.kode} - ${barang.nama} adalah JASA, tidak punya stok`);
      await kurangiStok(tx, b.barangId, gudangAsalId, b.jumlah, `${barang.kode} - ${barang.nama}`);
      await tambahStok(tx, b.barangId, gudangTujuanId, b.jumlah);
    }
    await tx.pindahBarang.create({
      data: { nomor, gudangAsalId, gudangTujuanId, keterangan: keterangan || null, baris: { create: daftarBaris.map((b) => ({ barangId: b.barangId, jumlah: b.jumlah })) } },
    });
  });

  revalidatePath("/persediaan");
  revalidatePath("/persediaan/pindah");
  redirect("/persediaan/pindah");
}

export async function buatPindahBarangFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatPindahBarang(dataFormulir));
}
