"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { wajibHakAksi } from "@/lib/otentikasi";
import { HAK_BAWAAN, LABEL_PERAN, PERAN_DAPAT_DIATUR, SEMUA_HAK, type Hak } from "@/lib/hakAkses";

const HALAMAN = "/pengaturan/hak-akses";

async function catat(penggunaId: string, penggunaNama: string, keterangan: string) {
  await db.logAktivitas.create({
    data: { penggunaId: penggunaId === "skrip-uji" ? null : penggunaId, penggunaNama, aksi: "UBAH", jenis: "Hak Akses", nomor: "MATRIKS", keterangan },
  });
}

/**
 * Menyimpan matriks hak dari formulir: setiap kotak bernama `<PERAN>|<hak>` yang tercentang = boleh.
 * Hanya selisih terhadap bawaan yang disimpan sebagai penyesuaian; yang sama dengan bawaan dihapus.
 * Superadmin/Pemilik tidak bisa diubah; `hak-akses.kelola` tidak bisa diberikan ke peran lain.
 */
export async function simpanHakAkses(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("hak-akses.kelola");
  const tercentang = new Set<string>();
  for (const [kunci, nilai] of dataFormulir.entries()) if (kunci.includes("|") && nilai === "on") tercentang.add(kunci);

  let berubah = 0;
  await db.$transaction(async (tx) => {
    for (const peran of PERAN_DAPAT_DIATUR) {
      const bawaan = new Set<Hak>(HAK_BAWAAN[peran]);
      for (const hak of SEMUA_HAK) {
        if (hak === "hak-akses.kelola") continue;
        const boleh = tercentang.has(`${peran}|${hak}`);
        const ada = await tx.hakAksesPeran.findUnique({ where: { peran_hak: { peran, hak } } });
        if (boleh === bawaan.has(hak)) {
          if (ada) {
            await tx.hakAksesPeran.delete({ where: { peran_hak: { peran, hak } } });
            berubah++;
          }
        } else if (!ada || ada.boleh !== boleh) {
          await tx.hakAksesPeran.upsert({ where: { peran_hak: { peran, hak } }, create: { peran, hak, boleh }, update: { boleh } });
          berubah++;
        }
      }
    }
    if (berubah) await catat(pengguna.id, pengguna.nama, `${berubah} hak diubah untuk peran ${PERAN_DAPAT_DIATUR.map((p) => LABEL_PERAN[p]).join(", ")}`);
  });
  revalidatePath(HALAMAN);
  revalidatePath("/", "layout");
}

/** Menghapus semua penyesuaian: setiap peran kembali ke bawaan. */
export async function pulihkanHakBawaan() {
  const pengguna = await wajibHakAksi("hak-akses.kelola");
  const { count } = await db.hakAksesPeran.deleteMany();
  if (count) await catat(pengguna.id, pengguna.nama, `${count} penyesuaian dihapus; semua peran kembali ke bawaan`);
  revalidatePath(HALAMAN);
  revalidatePath("/", "layout");
}

export async function simpanHakAksesFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => simpanHakAkses(dataFormulir));
}
export async function pulihkanHakBawaanFormulir(): Promise<StatusFormulir> {
  return jalankanFormulir(() => pulihkanHakBawaan());
}
