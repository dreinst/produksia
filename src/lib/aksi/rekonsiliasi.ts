"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { wajibHakAksi } from "@/lib/otentikasi";
import { bacaMutasi, sidikMutasi, type PetaKolom, type SudutPandang } from "@/lib/mutasiBank";

function bacaSudutPandang(dataFormulir: FormData): SudutPandang {
  const v = String(dataFormulir.get("sudutPandang") ?? "otomatis");
  return v === "bank" || v === "buku" ? v : "otomatis";
}
import { D } from "@/lib/uang";

const HALAMAN = "/rekonsiliasi/kas-bank";

async function catat(pengguna: { id: string; nama: string }, aksi: string, nomor: string, keterangan: string) {
  await db.logAktivitas.create({ data: { penggunaId: pengguna.id === "skrip-uji" ? null : pengguna.id, penggunaNama: pengguna.nama, aksi, jenis: "Rekonsiliasi", nomor, keterangan } });
}

/** Tahap 1 impor: baca berkas → hasil baca (dipakai halaman pratinjau). */
export async function pratinjauMutasi(dataFormulir: FormData) {
  await wajibHakAksi("rekonsiliasi.tulis");
  const berkas = dataFormulir.get("berkas");
  const isiTeks = String(dataFormulir.get("isi") ?? "");
  let isi = isiTeks, nama = "tempel.csv";
  if (berkas instanceof File && berkas.size > 0) {
    if (berkas.size > 2 * 1024 * 1024) throw new Error("Berkas maksimal 2 MB");
    isi = await berkas.text();
    nama = berkas.name;
  }
  if (!isi.trim()) throw new Error("Unggah berkas CSV/HTML atau tempel isi mutasinya");
  const manual: Partial<Record<keyof PetaKolom, number | null>> = {};
  for (const k of ["tanggal", "keterangan", "referensi", "masuk", "keluar", "jumlah", "saldo"] as const) {
    const v = dataFormulir.get(`kolom_${k}`);
    if (typeof v === "string" && v !== "") manual[k] = v === "-" ? null : Number(v);
  }
  return { nama, hasil: bacaMutasi(isi, nama, manual, bacaSudutPandang(dataFormulir)), isi };
}

/** Tahap 2 impor: simpan baris terbaca ke MutasiBank; baris yang sidiknya sudah ada dilewati. */
export async function imporMutasi(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("rekonsiliasi.tulis");
  const akunId = String(dataFormulir.get("akunId") ?? "");
  const nama = String(dataFormulir.get("namaBerkas") ?? "mutasi.csv");
  const isi = String(dataFormulir.get("isi") ?? "");
  if (!akunId) throw new Error("Akun kas/bank wajib dipilih");
  const akun = await db.akun.findUnique({ where: { id: akunId } });
  if (!akun || !akun.kasBank) throw new Error("Akun harus akun kas/bank");
  const manual: Partial<Record<keyof PetaKolom, number | null>> = {};
  for (const k of ["tanggal", "keterangan", "referensi", "masuk", "keluar", "jumlah", "saldo"] as const) {
    const v = dataFormulir.get(`kolom_${k}`);
    if (typeof v === "string" && v !== "") manual[k] = v === "-" ? null : Number(v);
  }
  const hasil = bacaMutasi(isi, nama, manual, bacaSudutPandang(dataFormulir));
  if (hasil.baris.length === 0) throw new Error("Tidak ada baris mutasi yang bisa dibaca");
  let baru = 0, ganda = 0;
  for (const b of hasil.baris) {
    const sidik = sidikMutasi(akunId, b);
    const ada = await db.mutasiBank.findUnique({ where: { sidik } });
    if (ada) { ganda++; continue; }
    await db.mutasiBank.create({ data: { akunId, tanggal: b.tanggal, keterangan: b.keterangan, referensi: b.referensi, masuk: b.masuk, keluar: b.keluar, saldo: b.saldo, sidik, berkas: nama, penggunaNama: pengguna.nama } });
    baru++;
  }
  await catat(pengguna, "IMPOR", akun.kode, `${baru} mutasi baru dari ${nama} (${ganda} ganda dilewati, ${hasil.diabaikan.length} baris diabaikan; sudut ${hasil.sudutPandang === "bank" ? "rekening koran" : "buku"})`);
  revalidatePath(HALAMAN);
  revalidatePath("/rekonsiliasi/mutasi");
  return { baru, ganda, diabaikan: hasil.diabaikan.length };
}

/**
 * Pencocokan otomatis: mutasi yang belum dicocokkan dipasangkan dengan baris jurnal akun yang sama,
 * nominal & arah sama (masuk = debit kas, keluar = kredit kas), tanggal selisih ≤ toleransi hari, belum dipakai.
 */
export async function cocokkanOtomatis(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("rekonsiliasi.tulis");
  const akunId = String(dataFormulir.get("akunId") ?? "");
  const toleransi = Math.min(Math.max(Number(dataFormulir.get("toleransiHari") ?? 3), 0), 31);
  if (!akunId) throw new Error("Akun kas/bank wajib dipilih");
  const [mutasi, baris] = await Promise.all([
    db.mutasiBank.findMany({ where: { akunId, barisJurnalId: null }, orderBy: { tanggal: "asc" } }),
    db.barisJurnal.findMany({ where: { akunId, mutasiBank: null }, include: { jurnal: { select: { tanggal: true, nomor: true } } }, orderBy: { jurnal: { tanggal: "asc" } } }),
  ]);
  const terpakai = new Set<string>();
  let cocok = 0, perhatian = 0;
  const hari = 24 * 60 * 60 * 1000;
  for (const m of mutasi) {
    const masuk = D(m.masuk), keluar = D(m.keluar);
    const kandidat = baris
      .filter((b) => !terpakai.has(b.id))
      .filter((b) => (masuk.gt(0) ? D(b.debit).equals(masuk) && D(b.kredit).isZero() : D(b.kredit).equals(keluar) && D(b.debit).isZero()))
      .filter((b) => Math.abs(b.jurnal.tanggal.getTime() - m.tanggal.getTime()) <= toleransi * hari)
      .sort((a, b) => Math.abs(a.jurnal.tanggal.getTime() - m.tanggal.getTime()) - Math.abs(b.jurnal.tanggal.getTime() - m.tanggal.getTime()));
    const pilih = kandidat[0];
    if (!pilih) continue;
    terpakai.add(pilih.id);
    // tanggal buku ≠ tanggal rekening → cocok tapi perlu dicek orang (checkbox "Perlu perhatian")
    const bedaTanggal = pilih.jurnal.tanggal.toDateString() !== m.tanggal.toDateString();
    await db.$transaction([
      db.mutasiBank.update({ where: { id: m.id }, data: { barisJurnalId: pilih.id, perluPerhatian: bedaTanggal, dikonfirmasiPada: null } }),
      db.barisJurnal.update({ where: { id: pilih.id }, data: { rekonsiliasiPada: new Date() } }),
    ]);
    cocok++;
    if (bedaTanggal) perhatian++;
  }
  await catat(pengguna, "COCOK", akunId, `${cocok} mutasi dicocokkan otomatis (${perhatian} perlu perhatian karena beda tanggal; toleransi ${toleransi} hari)`);
  revalidatePath(HALAMAN);
  return { cocok, perhatian, sisa: mutasi.length - cocok };
}

/** Menyimpan centang "sudah dicek" untuk mutasi yang perlu perhatian (cocok otomatis tapi beda tanggal). */
export async function konfirmasiPerhatian(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("rekonsiliasi.tulis");
  const akunId = String(dataFormulir.get("akunId") ?? "");
  const tercentang = new Set<string>();
  for (const [k, v] of dataFormulir.entries()) if (k.startsWith("cek_") && v === "on") tercentang.add(k.slice(4));
  const daftar = await db.mutasiBank.findMany({ where: { akunId, perluPerhatian: true }, select: { id: true, dikonfirmasiPada: true } });
  let berubah = 0;
  for (const m of daftar) {
    const harus = tercentang.has(m.id);
    if (harus && !m.dikonfirmasiPada) { await db.mutasiBank.update({ where: { id: m.id }, data: { dikonfirmasiPada: new Date() } }); berubah++; }
    if (!harus && m.dikonfirmasiPada) { await db.mutasiBank.update({ where: { id: m.id }, data: { dikonfirmasiPada: null } }); berubah++; }
  }
  if (berubah) await catat(pengguna, "CEK", akunId, `${berubah} mutasi beda tanggal ditandai sudah/belum dicek`);
  revalidatePath(HALAMAN);
}

/** Pencocokan manual satu mutasi ↔ satu baris jurnal (nominal & arah harus sama). */
export async function cocokkanManual(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("rekonsiliasi.tulis");
  const mutasiId = String(dataFormulir.get("mutasiId") ?? "");
  const barisId = String(dataFormulir.get("barisId") ?? "");
  if (!mutasiId || !barisId) throw new Error("Pilih satu mutasi rekening dan satu baris jurnal");
  const [m, b] = await Promise.all([db.mutasiBank.findUnique({ where: { id: mutasiId } }), db.barisJurnal.findUnique({ where: { id: barisId }, include: { mutasiBank: true, jurnal: { select: { nomor: true } } } })]);
  if (!m || !b) throw new Error("Mutasi atau baris jurnal tidak ditemukan");
  if (m.barisJurnalId) throw new Error("Mutasi ini sudah dicocokkan");
  if (b.mutasiBank) throw new Error(`Baris jurnal ${b.jurnal.nomor} sudah dicocokkan dengan mutasi lain`);
  if (b.akunId !== m.akunId) throw new Error("Baris jurnal bukan dari akun kas/bank yang sama");
  const masuk = D(m.masuk), keluar = D(m.keluar);
  const sama = masuk.gt(0) ? D(b.debit).equals(masuk) : D(b.kredit).equals(keluar);
  if (!sama) throw new Error(`Nominal tidak sama: mutasi ${masuk.gt(0) ? `masuk ${masuk}` : `keluar ${keluar}`} vs jurnal debit ${b.debit} / kredit ${b.kredit}`);
  await db.$transaction([
    db.mutasiBank.update({ where: { id: m.id }, data: { barisJurnalId: b.id, perluPerhatian: false, dikonfirmasiPada: new Date() } }),
    db.barisJurnal.update({ where: { id: b.id }, data: { rekonsiliasiPada: new Date() } }),
  ]);
  await catat(pengguna, "COCOK", b.jurnal.nomor, `Mutasi ${m.keterangan} dicocokkan manual`);
  revalidatePath(HALAMAN);
}

/** Melepas pencocokan satu mutasi. */
export async function lepasCocok(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("rekonsiliasi.tulis");
  const mutasiId = String(dataFormulir.get("mutasiId") ?? "");
  const m = await db.mutasiBank.findUnique({ where: { id: mutasiId } });
  if (!m) throw new Error("Mutasi tidak ditemukan");
  await db.$transaction([
    ...(m.barisJurnalId ? [db.barisJurnal.update({ where: { id: m.barisJurnalId }, data: { rekonsiliasiPada: null } })] : []),
    db.mutasiBank.update({ where: { id: mutasiId }, data: { barisJurnalId: null, perluPerhatian: false, dikonfirmasiPada: null } }),
  ]);
  await catat(pengguna, "LEPAS", m.keterangan.slice(0, 40), "Pencocokan dilepas");
  revalidatePath(HALAMAN);
}

/** Menghapus mutasi impor (mis. salah berkas); pencocokannya ikut dilepas. */
export async function hapusMutasi(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("rekonsiliasi.tulis");
  const akunId = String(dataFormulir.get("akunId") ?? "");
  const berkas = String(dataFormulir.get("berkas") ?? "");
  if (!akunId || !berkas) throw new Error("Akun dan nama berkas wajib");
  const daftar = await db.mutasiBank.findMany({ where: { akunId, berkas }, select: { id: true, barisJurnalId: true } });
  await db.$transaction([
    db.barisJurnal.updateMany({ where: { id: { in: daftar.map((d) => d.barisJurnalId).filter((x): x is string => !!x) } }, data: { rekonsiliasiPada: null } }),
    db.mutasiBank.deleteMany({ where: { akunId, berkas } }),
  ]);
  await catat(pengguna, "HAPUS", berkas, `${daftar.length} mutasi dari berkas ${berkas} dihapus`);
  revalidatePath(HALAMAN);
  revalidatePath("/rekonsiliasi/mutasi");
}


export async function imporMutasiFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(async () => { await imporMutasi(dataFormulir); });
}
export async function cocokkanOtomatisFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(async () => { await cocokkanOtomatis(dataFormulir); });
}
export async function cocokkanManualFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => cocokkanManual(dataFormulir));
}
export async function lepasCocokFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => lepasCocok(dataFormulir));
}
export async function hapusMutasiFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => hapusMutasi(dataFormulir));
}
export async function konfirmasiPerhatianFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => konfirmasiPerhatian(dataFormulir));
}

/** Hasil pratinjau yang aman dikirim ke komponen klien (tanpa Decimal). */
export type StatusPratinjau = StatusFormulir & {
  pratinjau?: {
    nama: string;
    isi: string;
    akunId: string;
    format: "csv" | "html";
    sudutPandang: "bank" | "buku";
    sudutDiminta: SudutPandang;
    keteranganSudut: string;
    tajuk: string[];
    peta: PetaKolom;
    baris: { tanggal: string; keterangan: string; referensi: string | null; masuk: number; keluar: number; saldo: number | null }[];
    diabaikan: { nomor: number; alasan: string; isi: string }[];
    totalMasuk: number;
    totalKeluar: number;
  };
};

export async function pratinjauMutasiFormulir(_sebelumnya: StatusPratinjau, dataFormulir: FormData): Promise<StatusPratinjau> {
  try {
    const { nama, hasil, isi } = await pratinjauMutasi(dataFormulir);
    const baris = hasil.baris.map((b) => ({ tanggal: b.tanggal.toISOString().slice(0, 10), keterangan: b.keterangan, referensi: b.referensi, masuk: Number(b.masuk), keluar: Number(b.keluar), saldo: b.saldo === null ? null : Number(b.saldo) }));
    return {
      galat: null,
      ok: true,
      pratinjau: { nama, isi, akunId: String(dataFormulir.get("akunId") ?? ""), format: hasil.format, sudutPandang: hasil.sudutPandang, sudutDiminta: bacaSudutPandang(dataFormulir), keteranganSudut: hasil.keteranganSudut, tajuk: hasil.tajuk, peta: hasil.peta, baris, diabaikan: hasil.diabaikan, totalMasuk: baris.reduce((s, b) => s + b.masuk, 0), totalKeluar: baris.reduce((s, b) => s + b.keluar, 0) },
    };
  } catch (galat) {
    return { galat: (galat as { message?: string })?.message ?? "Berkas tidak bisa dibaca" };
  }
}
