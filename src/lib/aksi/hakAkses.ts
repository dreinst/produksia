"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { wajibHakAksi } from "@/lib/otentikasi";
import { HAK_BAWAAN, LABEL_PERAN, type Hak } from "@/lib/hakAkses";
import { bacaMatriksFormulir, kotakMatriks } from "@/lib/matriksHakAkses";

const HALAMAN = "/pengaturan/hak-akses";

async function catat(penggunaId: string, penggunaNama: string, keterangan: string) {
  await db.logAktivitas.create({
    data: { penggunaId: penggunaId === "skrip-uji" ? null : penggunaId, penggunaNama, aksi: "UBAH", jenis: "Hak Akses", nomor: "MATRIKS", keterangan },
  });
}

/**
 * Menyimpan matriks hak dari formulir: setiap kotak bernama `<PERAN>|<hak>` yang tercentang = boleh.
 * Hanya selisih terhadap bawaan yang disimpan sebagai penyesuaian; yang sama dengan bawaan dihapus.
 * Yang diproses hanya peran yang dirender di formulir (penanda `peranDirender` atau minimal satu kotak
 * tercentang) dan hanya kotak yang memang dirender halaman (kotakMatriks), jadi kotak yang tidak tampil
 * tidak pernah dianggap dicabut. Superadmin/Pemilik tidak bisa diubah; hak di HAK_TERTINGGI_SAJA
 * (hak-akses.kelola, SDM, berkas.akses-penuh) tidak bisa diberikan ke peran lain, walau kotaknya tercentang.
 */
export async function simpanHakAkses(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("hak-akses.kelola");
  const { peranDiproses, tercentang } = bacaMatriksFormulir(dataFormulir);
  const kotak = kotakMatriks();

  let berubah = 0;
  await db.$transaction(async (tx) => {
    // satu kueri di awal, pengganti findUnique per pasangan (delapan peran × 163 kotak)
    const ada = new Map((await tx.hakAksesPeran.findMany({ where: { peran: { in: [...peranDiproses] } } })).map((r) => [`${r.peran}|${r.hak}`, r]));
    for (const peran of peranDiproses) {
      const bawaan = new Set<Hak>(HAK_BAWAAN[peran]);
      for (const hak of kotak) {
        const kunci = `${peran}|${hak}`;
        const boleh = tercentang.has(kunci);
        const baris = ada.get(kunci);
        if (boleh === bawaan.has(hak)) {
          if (baris) {
            await tx.hakAksesPeran.delete({ where: { peran_hak: { peran, hak } } });
            berubah++;
          }
        } else if (!baris || baris.boleh !== boleh) {
          await tx.hakAksesPeran.upsert({ where: { peran_hak: { peran, hak } }, create: { peran, hak, boleh }, update: { boleh } });
          berubah++;
        }
      }
    }
    if (berubah) await catat(pengguna.id, pengguna.nama, `${berubah} hak diubah untuk peran ${peranDiproses.map((p) => LABEL_PERAN[p]).join(", ")}`);
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
