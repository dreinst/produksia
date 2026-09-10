"use server";

import { wajibHakAksi } from "@/lib/otentikasi";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
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

  if (!piutangUsahaId || !persediaanId || !hppId || !pendapatanPenjualanId || !utangUsahaId) {
    throw new Error("Semua pemetaan akun wajib diisi");
  }
  const opsional = { bebanJasaId, barangBelumDitagihId, selisihPersediaanId };
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
