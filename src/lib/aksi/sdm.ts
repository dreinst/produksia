"use server";

import { wajibHakAksi } from "@/lib/otentikasi";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { D, jumlahkan, format, type Desimal } from "@/lib/uang";
import { pastikanAkunRinci } from "@/lib/baganAkun";
import { pastikanTahunTerbuka } from "@/lib/tutupBuku";
import { bacaProyekId } from "@/lib/proyek";
import { akunGajiBawaan } from "@/lib/sdm";

const NOL = D(0);

/** Penjumlahan per akun (urutan sisip dipertahankan agar jurnal mudah dibaca). */
function pengumpul() {
  const peta = new Map<string, Desimal>();
  return {
    tambah(akunId: string, jumlah: Desimal) {
      if (jumlah.isZero()) return;
      peta.set(akunId, (peta.get(akunId) ?? NOL).plus(jumlah));
    },
    daftar(): [string, Desimal][] {
      return [...peta.entries()].filter(([, v]) => !v.isZero());
    },
  };
}

type BarisInput = { karyawanId: string; gajiPokok: Desimal; tunjangan: Desimal; potongan: Desimal; keteranganPotongan: string | null };

function bacaBaris(dataFormulir: FormData): BarisInput[] {
  const mentah = dataFormulir.get("baris");
  if (typeof mentah !== "string" || !mentah) throw new Error("Minimal 1 karyawan wajib diisi");
  let hasilBaca: unknown;
  try {
    hasilBaca = JSON.parse(mentah);
  } catch {
    throw new Error("Format baris karyawan tidak valid");
  }
  if (!Array.isArray(hasilBaca)) throw new Error("Format baris karyawan tidak valid");
  const daftar = (hasilBaca as { karyawanId?: string; gajiPokok?: string | number; tunjangan?: string | number; potongan?: string | number; keteranganPotongan?: string }[])
    .filter((b) => b.karyawanId)
    .map((b) => ({
      karyawanId: String(b.karyawanId),
      gajiPokok: D(b.gajiPokok ?? 0),
      tunjangan: D(b.tunjangan ?? 0),
      potongan: D(b.potongan ?? 0),
      keteranganPotongan: b.keteranganPotongan ? String(b.keteranganPotongan).trim() || null : null,
    }))
    .filter((b) => b.gajiPokok.gt(0) || b.tunjangan.gt(0));
  if (daftar.length === 0) throw new Error("Minimal 1 karyawan dengan gaji pokok atau tunjangan lebih dari 0 wajib diisi");
  if (daftar.some((b) => b.gajiPokok.isNegative() || b.tunjangan.isNegative() || b.potongan.isNegative())) {
    throw new Error("Gaji pokok, tunjangan, dan potongan tidak boleh negatif");
  }
  return daftar;
}

/**
 * Proses Gaji: satu dokumen per periode (bulan) mencakup semua karyawan yang diikutkan.
 * Jurnal GJ: Dr Beban Gaji Pokok (per akun, karyawan bisa punya akun sendiri, mis. Upah Harian/Honor Volunteer)
 * + Dr Beban Tunjangan (per akun) / Cr Hutang Potongan Gaji (bila ada potongan) / Cr Kas-Bank (gaji bersih).
 * Koreksi = hapus lalu proses ulang periode itu (sama seperti PPh Final Bulanan).
 */
export async function buatPenggajian(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("penggajian.buat");
  const periode = String(dataFormulir.get("periode") ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(periode)) throw new Error("Periode harus dipilih (bulan dan tahun)");
  const akunKasId = String(dataFormulir.get("akunKasId") ?? "");
  if (!akunKasId) throw new Error("Akun kas/bank wajib dipilih");
  const keterangan = String(dataFormulir.get("keterangan") ?? "").trim() || null;
  const tanggalTeks = String(dataFormulir.get("tanggal") ?? "");
  const tanggal = tanggalTeks ? new Date(`${tanggalTeks}T12:00:00`) : new Date();
  if (Number.isNaN(tanggal.getTime())) throw new Error("Tanggal tidak valid");
  const akhirHariIni = new Date();
  akhirHariIni.setHours(23, 59, 59, 999);
  if (tanggal > akhirHariIni) throw new Error("Tanggal tidak boleh di masa depan");
  const proyekId = await bacaProyekId(dataFormulir);
  const daftarBaris = bacaBaris(dataFormulir);

  if (await db.penggajian.findUnique({ where: { periode } })) throw new Error(`Penggajian periode ${periode} sudah diproses. Hapus dulu bila ingin mengoreksi`);
  const akunKas = await db.akun.findUnique({ where: { id: akunKasId } });
  if (!akunKas?.kasBank) throw new Error("Akun kas/bank tidak valid");
  const gaji = await akunGajiBawaan(db);
  if (!gaji.bebanGaji) throw new Error('Akun Beban Gaji belum ada. Terapkan Bagan Akun Standar (5-2100) atau atur Pemetaan Akun > Pemetaan tambahan "bebanGaji"');
  const totalPotonganDicek = jumlahkan(daftarBaris.map((b) => b.potongan));
  if (totalPotonganDicek.gt(0) && !gaji.hutangPotongan) {
    throw new Error('Ada potongan, tapi akun Hutang Potongan Gaji belum ada. Terapkan Bagan Akun Standar (2-1310) atau atur Pemetaan Akun > Pemetaan tambahan "hutangPotonganGaji"');
  }
  await pastikanAkunRinci(db, [akunKasId, gaji.bebanGaji.id, ...(gaji.bebanTunjangan ? [gaji.bebanTunjangan.id] : []), ...(gaji.hutangPotongan ? [gaji.hutangPotongan.id] : [])]);

  const daftarKaryawan = await db.karyawan.findMany({ where: { id: { in: daftarBaris.map((b) => b.karyawanId) } }, select: { id: true, kode: true, nama: true, akunBebanId: true } });
  const petaKaryawan = new Map(daftarKaryawan.map((k) => [k.id, k]));

  const bebanPokok = pengumpul();
  const bebanTunjangan = pengumpul();
  let totalGajiPokok = NOL, totalTunjangan = NOL, totalPotongan = NOL, totalDibayar = NOL;
  const barisTersimpan: { karyawanId: string; gajiPokok: Desimal; tunjangan: Desimal; potongan: Desimal; keteranganPotongan: string | null; diterima: Desimal }[] = [];
  for (const b of daftarBaris) {
    const k = petaKaryawan.get(b.karyawanId);
    if (!k) throw new Error("Karyawan tidak ditemukan");
    const akunBebanKaryawan = k.akunBebanId ?? gaji.bebanGaji.id;
    bebanPokok.tambah(akunBebanKaryawan, b.gajiPokok);
    if (b.tunjangan.gt(0)) bebanTunjangan.tambah(gaji.bebanTunjangan?.id ?? akunBebanKaryawan, b.tunjangan);
    const diterima = b.gajiPokok.plus(b.tunjangan).minus(b.potongan);
    if (diterima.isNegative()) throw new Error(`${k.kode} - ${k.nama}: potongan melebihi gaji pokok + tunjangan`);
    totalGajiPokok = totalGajiPokok.plus(b.gajiPokok);
    totalTunjangan = totalTunjangan.plus(b.tunjangan);
    totalPotongan = totalPotongan.plus(b.potongan);
    totalDibayar = totalDibayar.plus(diterima);
    barisTersimpan.push({ karyawanId: b.karyawanId, gajiPokok: b.gajiPokok, tunjangan: b.tunjangan, potongan: b.potongan, keteranganPotongan: b.keteranganPotongan, diterima });
  }

  const nomor = await nomorDokumenBerikutnya(db.penggajian, "GJ");

  await db.$transaction(async (tx) => {
    await pastikanTahunTerbuka(tx, tanggal);
    const nomorJurnal = await nomorDokumenBerikutnya(tx.jurnal, "GJ");
    const barisJurnal = [
      ...bebanPokok.daftar().map(([akunId, v]) => ({ akunId, debit: v, kredit: NOL, keterangan: `Beban gaji pokok ${periode}` })),
      ...bebanTunjangan.daftar().map(([akunId, v]) => ({ akunId, debit: v, kredit: NOL, keterangan: `Beban tunjangan ${periode}` })),
      ...(totalPotongan.gt(0) ? [{ akunId: gaji.hutangPotongan!.id, debit: NOL, kredit: totalPotongan, keterangan: `Potongan gaji ${periode}` }] : []),
      { akunId: akunKasId, debit: NOL, kredit: totalDibayar, keterangan: `Pembayaran gaji ${periode}` },
    ];
    const totalDebit = jumlahkan(barisJurnal.map((b) => b.debit));
    const totalKredit = jumlahkan(barisJurnal.map((b) => b.kredit));
    if (!totalDebit.equals(totalKredit)) throw new Error(`Jurnal penggajian tidak seimbang (debit ${format(totalDebit)} vs kredit ${format(totalKredit)}). Laporkan ke pengembang`);

    const jurnal = await tx.jurnal.create({
      data: { nomor: nomorJurnal, tanggal, keterangan: `Penggajian ${periode}${keterangan ? `: ${keterangan}` : ""}`, sumber: "PENGGAJIAN", proyekId, baris: { create: barisJurnal } },
    });
    await tx.penggajian.create({
      data: {
        nomor,
        periode,
        tanggal,
        akunKasId,
        proyekId,
        totalGajiPokok,
        totalTunjangan,
        totalPotongan,
        totalDibayar,
        keterangan,
        jurnalId: jurnal.id,
        penggunaNama: pengguna.nama,
        baris: { create: barisTersimpan },
      },
    });
    await tx.logAktivitas.create({
      data: {
        penggunaId: pengguna.id === "skrip-uji" ? null : pengguna.id,
        penggunaNama: pengguna.nama,
        aksi: "BUAT",
        jenis: "Penggajian",
        nomor,
        keterangan: `Periode ${periode}: ${barisTersimpan.length} karyawan, gaji pokok ${format(totalGajiPokok)}, tunjangan ${format(totalTunjangan)}, potongan ${format(totalPotongan)}, dibayar ${format(totalDibayar)}`,
      },
    });
  });

  revalidatePath("/sdm/penggajian");
  revalidatePath("/buku-besar/jurnal");
  redirect("/sdm/penggajian");
}

export async function buatPenggajianFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatPenggajian(dataFormulir));
}
