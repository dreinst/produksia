"use server";

import { wajibHakAksi } from "@/lib/otentikasi";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { pastikanAkunRinci, terapkanBaganAkunStandar } from "@/lib/baganAkun";
import { terapkanDataFlagship } from "@/lib/flagshipStandar";
import { terapkanKategoriAnggaranBawaan } from "@/lib/kategoriAnggaran";

/**
 * Pemetaan akun (standar dan tambahan) berlaku untuk semua perusahaan, jadi hanya akun bersama yang boleh dipilih.
 * Akun milik satu perusahaan akan ditolak catatJurnal saat dipakai dokumen perusahaan lain (KONTRAK-TAMBAHAN P19,
 * pasangan aturan ganti pemilik akun di dataInduk.ts).
 */
async function pastikanAkunPemetaanBersama(daftarAkunId: string[]): Promise<void> {
  const ids = [...new Set(daftarAkunId.filter(Boolean))];
  if (ids.length === 0) return;
  const milik = await db.akun.findFirst({ where: { id: { in: ids }, perusahaanId: { not: null } }, select: { kode: true, nama: true, perusahaan: { select: { nama: true } } }, orderBy: { kode: "asc" } });
  if (milik) throw new Error(`Akun ${milik.kode} ${milik.nama} milik ${milik.perusahaan?.nama ?? "perusahaan lain"}; pemetaan akun berlaku untuk semua perusahaan, jadi pilih akun bersama (tanpa pemilik)`);
}

export async function simpanPemetaanAkun(dataFormulir: FormData) {
  await wajibHakAksi("pemetaan.tulis");
  const piutangUsahaId = String(dataFormulir.get("piutangUsahaId") ?? "");
  const persediaanId = String(dataFormulir.get("persediaanId") ?? "");
  const hppId = String(dataFormulir.get("hppId") ?? "");
  const pendapatanPenjualanId = String(dataFormulir.get("pendapatanPenjualanId") ?? "");
  const utangUsahaId = String(dataFormulir.get("utangUsahaId") ?? "");
  const bebanJasaId = String(dataFormulir.get("bebanJasaId") ?? "") || null;
  const barangBelumDitagihId = String(dataFormulir.get("barangBelumDitagihId") ?? "") || null;
  const selisihPersediaanId = String(dataFormulir.get("selisihPersediaanId") ?? "") || null;
  const barangTerkirimId = String(dataFormulir.get("barangTerkirimId") ?? "") || null;
  const uangMukaPelangganId = String(dataFormulir.get("uangMukaPelangganId") ?? "") || null;
  const labaDitahanId = String(dataFormulir.get("labaDitahanId") ?? "") || null;
  const diskonPenjualanId = String(dataFormulir.get("diskonPenjualanId") ?? "") || null;
  const pendapatanLainId = String(dataFormulir.get("pendapatanLainId") ?? "") || null;
  const selisihKursId = String(dataFormulir.get("selisihKursId") ?? "") || null;

  if (!piutangUsahaId || !persediaanId || !hppId || !pendapatanPenjualanId || !utangUsahaId) {
    throw new Error("Semua pemetaan akun wajib diisi");
  }
  const opsional = { bebanJasaId, barangBelumDitagihId, selisihPersediaanId, barangTerkirimId, uangMukaPelangganId, labaDitahanId, diskonPenjualanId, selisihKursId };
  await pastikanAkunRinci(db, [piutangUsahaId, persediaanId, hppId, pendapatanPenjualanId, utangUsahaId, ...Object.values(opsional).filter((v): v is string => Boolean(v))]);
  // Pendapatan Lain-lain adalah KELOMPOK akun pendapatan (seluruh keturunannya dikecualikan dari omzet)
  if (pendapatanLainId) {
    const a = await db.akun.findUnique({ where: { id: pendapatanLainId } });
    if (!a || a.jenis !== "PENDAPATAN") throw new Error("Pendapatan Lain-lain harus akun jenis Pendapatan");
  }
  await pastikanAkunPemetaanBersama([piutangUsahaId, persediaanId, hppId, pendapatanPenjualanId, utangUsahaId, ...Object.values(opsional).filter((v): v is string => Boolean(v)), ...(pendapatanLainId ? [pendapatanLainId] : [])]);

  await db.pemetaanAkun.upsert({
    where: { id: "default" },
    create: { id: "default", piutangUsahaId, persediaanId, hppId, pendapatanPenjualanId, utangUsahaId, ...opsional, pendapatanLainId },
    update: { piutangUsahaId, persediaanId, hppId, pendapatanPenjualanId, utangUsahaId, ...opsional, pendapatanLainId },
  });

  revalidatePath("/pengaturan/pemetaan-akun");
}

// ---------- Varian untuk <FormulirAksi> (mengembalikan pesan error, bukan throw) ----------

export async function simpanPemetaanAkunFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => simpanPemetaanAkun(dataFormulir));
}

// ---------- Bagan Akun Standar EO/WO ----------

/**
 * Membuat akun standar yang belum ada (idempoten), pemetaan akun bila belum diatur, plus data induk flagship (jasa
 * tiket/sponsor/booth, Pelanggan Umum), lalu kategori anggaran proyek bawaan dan pemetaan akunnya (D5 §8 no. 23).
 */
export async function terapkanBaganAkun() {
  await wajibHakAksi("pengaturan.tulis");
  const hasil = await terapkanBaganAkunStandar(db);
  await terapkanDataFlagship(db);
  await terapkanKategoriAnggaranBawaan(db);
  revalidatePath("/pengaturan/kategori-anggaran");
  revalidatePath("/pengaturan/bagan-akun");
  revalidatePath("/pengaturan/pemetaan-akun");
  revalidatePath("/data-induk/akun");
  revalidatePath("/data-induk/barang");
  revalidatePath("/data-induk/pelanggan");
  return hasil;
}

export async function terapkanBaganAkunFormulir(): Promise<StatusFormulir> {
  return jalankanFormulir(async () => {
    await terapkanBaganAkun();
  });
}

// ---------- Pengaturan umum (semua perusahaan) ----------

/** Kosong = mengikuti tahun kalender. */
function bacaTahunBuku(nilai: string): number | null {
  if (!nilai) return null;
  const tahun = Number(nilai);
  if (!Number.isInteger(tahun) || tahun < 2000 || tahun > 2100) throw new Error("Tahun buku harus tahun antara 2000 dan 2100");
  return tahun;
}

/** Ganti tahun buku yang dibuka (dipakai dari kartu perusahaan di sidebar). */
export async function gantiTahunBuku(dataFormulir: FormData) {
  await wajibHakAksi("pengaturan.tulis");
  const tahunBuku = bacaTahunBuku(String(dataFormulir.get("tahunBuku") ?? "").trim());
  await db.pengaturanPerusahaan.upsert({ where: { id: "default" }, create: { id: "default", tahunBuku }, update: { tahunBuku } });
  revalidatePath("/", "layout");
}

export async function gantiTahunBukuFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => gantiTahunBuku(dataFormulir));
}

/**
 * Pengaturan umum yang berlaku untuk semua perusahaan (D1 §6.2): tahun buku dan alur persetujuan, keduanya hanya di
 * baris "default". Menggantikan simpanPengaturanPerusahaan lama; nama, pajak, dan akun pajak tiap perusahaan
 * (termasuk utama, baris "default") disimpan lewat ubahPerusahaan di aksi/perusahaan.ts.
 */
export async function simpanPengaturanUmum(dataFormulir: FormData) {
  await wajibHakAksi("pengaturan.tulis");
  const tahunBuku = bacaTahunBuku(String(dataFormulir.get("tahunBuku") ?? "").trim());
  // Alur persetujuan maker-checker: dimatikan berarti dokumen langsung dibukukan tanpa pemeriksa
  const wajibPersetujuan = dataFormulir.get("wajibPersetujuan") === "on";
  await db.pengaturanPerusahaan.upsert({
    where: { id: "default" },
    create: { id: "default", tahunBuku, wajibPersetujuan },
    update: { tahunBuku, wajibPersetujuan },
  });
  revalidatePath("/pengaturan/perusahaan");
  revalidatePath("/persetujuan");
  revalidatePath("/", "layout");
}

export async function simpanPengaturanUmumFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => simpanPengaturanUmum(dataFormulir));
}

// ---------- Pemetaan akun tambahan (peran buatan pengguna, mis. Prive) ----------

function bacaKunci(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function tambahPemetaanTambahan(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("pemetaan.tulis");
  const label = String(dataFormulir.get("label") ?? "").trim();
  const akunId = String(dataFormulir.get("akunId") ?? "");
  const keterangan = String(dataFormulir.get("keterangan") ?? "").trim() || null;
  if (!label) throw new Error("Nama peran wajib diisi");
  if (!akunId) throw new Error("Akun wajib dipilih");
  const kunci = bacaKunci(label);
  if (!kunci) throw new Error("Nama peran harus memuat huruf atau angka");
  await pastikanAkunRinci(db, [akunId]);
  await pastikanAkunPemetaanBersama([akunId]);
  if (await db.pemetaanAkunTambahan.findUnique({ where: { kunci } })) throw new Error(`Peran "${label}" sudah ada`);
  await db.pemetaanAkunTambahan.create({ data: { kunci, label, akunId, keterangan, dibuatOleh: pengguna.nama } });
  revalidatePath("/pengaturan/pemetaan-akun");
}

export async function ubahPemetaanTambahan(id: string, dataFormulir: FormData) {
  await wajibHakAksi("pemetaan.tulis");
  const akunId = String(dataFormulir.get("akunId") ?? "");
  if (!akunId) throw new Error("Akun wajib dipilih");
  await pastikanAkunRinci(db, [akunId]);
  await pastikanAkunPemetaanBersama([akunId]);
  await db.pemetaanAkunTambahan.update({ where: { id }, data: { akunId } });
  revalidatePath("/pengaturan/pemetaan-akun");
}

export async function hapusPemetaanTambahan(id: string) {
  await wajibHakAksi("pemetaan.tulis");
  await db.pemetaanAkunTambahan.delete({ where: { id } });
  revalidatePath("/pengaturan/pemetaan-akun");
}

export async function tambahPemetaanTambahanFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => tambahPemetaanTambahan(dataFormulir));
}
export async function ubahPemetaanTambahanFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahPemetaanTambahan(id, dataFormulir));
}
export async function hapusPemetaanTambahanFormulir(id: string) {
  return jalankanFormulir(() => hapusPemetaanTambahan(id));
}
