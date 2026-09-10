"use server";

import { wajibHakAksi } from "@/lib/otentikasi";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { bacaUang } from "@/lib/uang";
import { pastikanAkunRinci, terapkanBaganAkunStandar } from "@/lib/baganAkun";

export async function simpanPemetaanAkun(dataFormulir: FormData) {
  await wajibHakAksi("pengaturan.tulis");
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

  if (!piutangUsahaId || !persediaanId || !hppId || !pendapatanPenjualanId || !utangUsahaId) {
    throw new Error("Semua pemetaan akun wajib diisi");
  }
  const opsional = { bebanJasaId, barangBelumDitagihId, selisihPersediaanId, barangTerkirimId, uangMukaPelangganId, labaDitahanId };
  await pastikanAkunRinci(db, [piutangUsahaId, persediaanId, hppId, pendapatanPenjualanId, utangUsahaId, ...Object.values(opsional).filter((v): v is string => Boolean(v))]);

  await db.pemetaanAkun.upsert({
    where: { id: "default" },
    create: { id: "default", piutangUsahaId, persediaanId, hppId, pendapatanPenjualanId, utangUsahaId, ...opsional },
    update: { piutangUsahaId, persediaanId, hppId, pendapatanPenjualanId, utangUsahaId, ...opsional },
  });

  revalidatePath("/pengaturan/pemetaan-akun");
}

// ---------- Varian untuk <FormulirAksi> (mengembalikan pesan error, bukan throw) ----------

export async function simpanPemetaanAkunFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => simpanPemetaanAkun(dataFormulir));
}

// ---------- Bagan Akun Standar EO/WO ----------

/** Membuat akun standar yang belum ada (idempoten) dan pemetaan akun bila belum diatur. */
export async function terapkanBaganAkun() {
  await wajibHakAksi("pengaturan.tulis");
  const hasil = await terapkanBaganAkunStandar(db);
  revalidatePath("/pengaturan/bagan-akun");
  revalidatePath("/pengaturan/pemetaan-akun");
  revalidatePath("/data-induk/akun");
  return hasil;
}

export async function terapkanBaganAkunFormulir(): Promise<StatusFormulir> {
  return jalankanFormulir(async () => {
    await terapkanBaganAkun();
  });
}

// ---------- Perusahaan & pajak ----------

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

export async function simpanPengaturanPerusahaan(dataFormulir: FormData) {
  await wajibHakAksi("pengaturan.tulis");
  const teks = (k: string) => String(dataFormulir.get(k) ?? "").trim();
  const nama = teks("nama");
  if (!nama) throw new Error("Nama perusahaan wajib diisi");
  const pkp = dataFormulir.get("pkp") === "on";
  const tarifPpnPersen = bacaUang(dataFormulir.get("tarifPpnPersen"), "Tarif PPN", { allowZero: true });
  if (tarifPpnPersen.gt(100)) throw new Error("Tarif PPN maksimal 100%");
  const terminHari = Number(teks("terminHari") || "14");
  if (!Number.isInteger(terminHari) || terminHari < 0 || terminHari > 365) throw new Error("Termin jatuh tempo harus 0–365 hari");
  const tahunBuku = bacaTahunBuku(teks("tahunBuku"));
  const pphFinalPersen = bacaUang(dataFormulir.get("pphFinalPersen") ?? "0.5", "Tarif PPh Final", { allowZero: true });
  if (pphFinalPersen.gt(100)) throw new Error("Tarif PPh Final maksimal 100%");
  const akun = {
    akunPpnKeluaranId: teks("akunPpnKeluaranId") || null,
    akunPpnMasukanId: teks("akunPpnMasukanId") || null,
    akunPph23DimukaId: teks("akunPph23DimukaId") || null,
    akunPph23DipotongId: teks("akunPph23DipotongId") || null,
    akunBebanPphFinalId: teks("akunBebanPphFinalId") || null,
    akunHutangPphFinalId: teks("akunHutangPphFinalId") || null,
  };
  if (pkp && (!akun.akunPpnKeluaranId || !akun.akunPpnMasukanId)) {
    throw new Error("Status PKP membutuhkan akun PPN Keluaran dan PPN Masukan");
  }
  await pastikanAkunRinci(db, Object.values(akun).filter((v): v is string => Boolean(v)));

  await db.pengaturanPerusahaan.upsert({
    where: { id: "default" },
    create: { id: "default", nama, pkp, tarifPpnPersen, terminHari, tahunBuku, pphFinalPersen, ...akun },
    update: { nama, pkp, tarifPpnPersen, terminHari, tahunBuku, pphFinalPersen, ...akun },
  });
  revalidatePath("/pengaturan/perusahaan");
  revalidatePath("/", "layout");
}

export async function simpanPengaturanPerusahaanFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => simpanPengaturanPerusahaan(dataFormulir));
}
