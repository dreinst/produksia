"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { wajibHakAksi } from "@/lib/otentikasi";
import { jalankanFormulir, jalankanFormulirHasil, type StatusFormulir } from "@/lib/statusFormulir";
import { D, format } from "@/lib/uang";
import { jalankanRevaluasi } from "@/lib/selisihKurs";

/*
 * Pengaturan › Mata Uang & Kurs: daftar mata uang transaksi dan riwayat kursnya terhadap rupiah,
 * plus tombol menjalankan penilaian kembali piutang/hutang mata uang asing (src/lib/selisihKurs.ts).
 * Semua aksi di sini butuh hak "pengaturan.tulis", sama seperti Perusahaan & Pajak.
 */

const HALAMAN = "/pengaturan/mata-uang";

/** Mata uang standar yang lazim dipakai EO Indonesia; idempoten, yang sudah ada dilewati. */
const MATA_UANG_STANDAR = [
  { kode: "IDR", nama: "Rupiah Indonesia", simbol: "Rp", desimal: 0, fungsional: true },
  { kode: "USD", nama: "Dolar Amerika Serikat", simbol: "$", desimal: 2, fungsional: false },
  { kode: "SGD", nama: "Dolar Singapura", simbol: "S$", desimal: 2, fungsional: false },
  { kode: "EUR", nama: "Euro", simbol: "€", desimal: 2, fungsional: false },
  { kode: "AUD", nama: "Dolar Australia", simbol: "A$", desimal: 2, fungsional: false },
  { kode: "JPY", nama: "Yen Jepang", simbol: "¥", desimal: 0, fungsional: false },
] as const;

export async function terapkanMataUangStandar() {
  await wajibHakAksi("pengaturan.tulis");
  let dibuat = 0;
  for (const mu of MATA_UANG_STANDAR) {
    const ada = await db.mataUang.findUnique({ where: { kode: mu.kode } });
    if (ada) continue;
    await db.mataUang.create({ data: mu });
    dibuat++;
  }
  revalidatePath(HALAMAN);
  return dibuat;
}

function bacaKode(nilai: string): string {
  const kode = nilai.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(kode)) throw new Error("Kode mata uang harus 3 huruf sesuai ISO 4217, misalnya USD");
  return kode;
}

export async function tambahMataUang(dataFormulir: FormData) {
  await wajibHakAksi("pengaturan.tulis");
  const kode = bacaKode(String(dataFormulir.get("kode") ?? ""));
  const nama = String(dataFormulir.get("nama") ?? "").trim();
  const simbol = String(dataFormulir.get("simbol") ?? "").trim();
  const desimal = Number(dataFormulir.get("desimal") ?? 2);
  if (!nama) throw new Error("Nama mata uang wajib diisi");
  if (!Number.isInteger(desimal) || desimal < 0 || desimal > 6) throw new Error("Jumlah desimal harus 0 sampai 6");
  if (await db.mataUang.findUnique({ where: { kode } })) throw new Error(`Mata uang ${kode} sudah ada`);

  // Mata uang fungsional ditetapkan sekali (IDR); mata uang baru selalu mata uang transaksi biasa
  await db.mataUang.create({ data: { kode, nama, simbol, desimal, fungsional: false } });
  revalidatePath(HALAMAN);
}

export async function ubahAktifMataUang(id: string, dataFormulir: FormData) {
  await wajibHakAksi("pengaturan.tulis");
  const aktif = dataFormulir.get("aktif") === "on";
  const mu = await db.mataUang.findUniqueOrThrow({ where: { id } });
  if (mu.fungsional && !aktif) throw new Error(`${mu.kode} adalah mata uang fungsional (mata uang pelaporan), tidak bisa dinonaktifkan`);
  await db.mataUang.update({ where: { id }, data: { aktif } });
  revalidatePath(HALAMAN);
}

export async function hapusMataUang(id: string) {
  await wajibHakAksi("pengaturan.tulis");
  const mu = await db.mataUang.findUniqueOrThrow({ where: { id } });
  if (mu.fungsional) throw new Error(`${mu.kode} adalah mata uang fungsional (mata uang pelaporan), tidak bisa dihapus`);
  const [jual, beli, pel, pem] = await Promise.all([
    db.fakturPenjualan.count({ where: { mataUangId: id } }),
    db.fakturPembelian.count({ where: { mataUangId: id } }),
    db.pelanggan.count({ where: { mataUangId: id } }),
    db.pemasok.count({ where: { mataUangId: id } }),
  ]);
  const dipakai = jual + beli + pel + pem;
  if (dipakai > 0) {
    throw new Error(`${mu.kode} masih dipakai ${dipakai} data (faktur/pelanggan/pemasok); nonaktifkan saja daripada dihapus`);
  }
  await db.kursMataUang.deleteMany({ where: { mataUangId: id } });
  await db.mataUang.delete({ where: { id } });
  revalidatePath(HALAMAN);
}

export async function catatKurs(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("pengaturan.tulis");
  const mataUangId = String(dataFormulir.get("mataUangId") ?? "");
  const tanggalTeks = String(dataFormulir.get("tanggal") ?? "");
  const sumber = String(dataFormulir.get("sumber") ?? "").trim() || null;
  if (!mataUangId) throw new Error("Mata uang wajib dipilih");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggalTeks)) throw new Error("Tanggal kurs wajib diisi");
  const tanggal = new Date(`${tanggalTeks}T00:00:00.000Z`);
  const kurs = D(String(dataFormulir.get("kurs") ?? "")).toDecimalPlaces(6);
  if (kurs.lte(0)) throw new Error("Kurs harus lebih dari 0");

  const mu = await db.mataUang.findUniqueOrThrow({ where: { id: mataUangId } });
  if (mu.fungsional) throw new Error(`${mu.kode} adalah mata uang fungsional; kursnya selalu 1 dan tidak perlu dicatat`);

  // Satu kurs per mata uang per tanggal: mengisi ulang tanggal yang sama = memperbaiki kursnya
  await db.kursMataUang.upsert({
    where: { mataUangId_tanggal: { mataUangId, tanggal } },
    create: { mataUangId, tanggal, kurs, sumber, dicatatOleh: pengguna.nama },
    update: { kurs, sumber, dicatatOleh: pengguna.nama },
  });
  revalidatePath(HALAMAN);
}

export async function hapusKurs(id: string) {
  await wajibHakAksi("pengaturan.tulis");
  await db.kursMataUang.delete({ where: { id } });
  revalidatePath(HALAMAN);
}

/**
 * Penilaian kembali piutang/hutang mata uang asing per tanggal tertentu (biasanya akhir bulan/tahun).
 * Menghasilkan satu jurnal JU-SK yang seimbang, lalu dicatat di log aktivitas.
 */
export async function jalankanPenilaianKurs(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("pengaturan.tulis");
  const tanggalTeks = String(dataFormulir.get("tanggal") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggalTeks)) throw new Error("Tanggal penilaian wajib diisi");
  // Akhir hari: penilaian "per 31 Desember" harus mencakup semua faktur bertanggal 31 Desember itu
  const tanggal = new Date(`${tanggalTeks}T23:59:59.999`);
  const akhirHariIni = new Date();
  akhirHariIni.setHours(23, 59, 59, 999);
  if (tanggal > akhirHariIni) throw new Error("Tanggal penilaian tidak boleh di masa depan");

  const hasil = await db.$transaction(async (tx) => {
    const { ringkasan, nomorJurnal } = await jalankanRevaluasi(tx, tanggal);
    if (nomorJurnal) {
      await tx.logAktivitas.create({
        data: {
          penggunaId: pengguna.id === "skrip-uji" ? null : pengguna.id,
          penggunaNama: pengguna.nama,
          aksi: "REVALUASI",
          jenis: "Selisih Kurs",
          nomor: nomorJurnal,
          keterangan: `${ringkasan.baris.length} faktur dinilai ulang per ${tanggalTeks}; ${ringkasan.labaRugi.gte(0) ? "laba" : "rugi"} kurs ${format(ringkasan.labaRugi.abs())}`,
        },
      });
    }
    return { jumlahBaris: ringkasan.baris.length, labaRugi: ringkasan.labaRugi.toString(), nomorJurnal };
  });

  revalidatePath(HALAMAN);
  revalidatePath("/buku-besar/jurnal");
  return hasil;
}

// ---------- Varian untuk <FormulirAksi> ----------

export async function terapkanMataUangStandarFormulir(): Promise<StatusFormulir> {
  return jalankanFormulir(async () => {
    await terapkanMataUangStandar();
  });
}
export async function tambahMataUangFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => tambahMataUang(dataFormulir));
}
export async function ubahAktifMataUangFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahAktifMataUang(id, dataFormulir));
}
export async function hapusMataUangFormulir(id: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => hapusMataUang(id));
}
export async function catatKursFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => catatKurs(dataFormulir));
}
export async function hapusKursFormulir(id: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => hapusKurs(id));
}
export async function jalankanPenilaianKursFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulirHasil(() => jalankanPenilaianKurs(dataFormulir));
}

