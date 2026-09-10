"use server";

import { wajibHakAksi } from "@/lib/otentikasi";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { D, format } from "@/lib/uang";
import { pastikanAkunRinci } from "@/lib/baganAkun";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { pastikanTahunTerbuka } from "@/lib/tutupBuku";
import { batasBulan, ringkasanPajak } from "@/lib/pajak";

const HALAMAN = "/buku-besar/pajak";

/** PPh Final UMKM satu bulan: omzet bulan itu × tarif → jurnal JU-PPHF (Dr Beban PPh Final / Cr Hutang PPh Final) bertanggal akhir bulan. */
export async function catatPphFinal(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("buku-besar.tulis");
  const periode = String(dataFormulir.get("periode") ?? "").trim();
  const cocok = /^(\d{4})-(\d{2})$/.exec(periode);
  if (!cocok) throw new Error("Periode harus berformat YYYY-MM");
  const tahun = Number(cocok[1]), bulan = Number(cocok[2]);
  if (bulan < 1 || bulan > 12 || tahun < 2000 || tahun > 2100) throw new Error("Periode tidak valid");
  const { dari, sampai } = batasBulan(tahun, bulan);
  if (dari > new Date()) throw new Error(`Periode ${periode} belum berjalan`);
  if (await db.pphFinalBulanan.findUnique({ where: { periode } })) throw new Error(`PPh Final periode ${periode} sudah dicatat`);
  const pengaturan = await ambilPengaturanPerusahaan(db);
  if (!pengaturan.akunBebanPphFinalId || !pengaturan.akunHutangPphFinalId) {
    throw new Error("Akun Beban PPh Final dan Hutang PPh Final belum diatur di Pengaturan > Perusahaan & Pajak");
  }
  await pastikanAkunRinci(db, [pengaturan.akunBebanPphFinalId, pengaturan.akunHutangPphFinalId]);

  await db.$transaction(async (tx) => {
    const ringkasan = await ringkasanPajak(tx, tahun, pengaturan.pphFinalPersen);
    const data = ringkasan.bulan[bulan - 1];
    if (data.omzet.lte(0)) throw new Error(`Tidak ada omzet pada periode ${periode} (DPP faktur − retur = ${format(data.omzet)})`);
    if (data.pphFinal.lte(0)) throw new Error(`PPh Final periode ${periode} nol (tarif ${format(pengaturan.pphFinalPersen)}%)`);
    const tanggal = sampai < new Date() ? sampai : new Date();
    await pastikanTahunTerbuka(tx, tanggal);
    const nomor = await nomorDokumenBerikutnya(tx.jurnal, "JU-PPHF");
    const jurnal = await tx.jurnal.create({
      data: {
        nomor,
        tanggal,
        keterangan: `PPh Final UMKM ${format(pengaturan.pphFinalPersen)}% periode ${periode} atas omzet ${format(data.omzet)}`,
        sumber: "PAJAK",
        baris: {
          create: [
            { akunId: pengaturan.akunBebanPphFinalId!, debit: data.pphFinal, kredit: D(0), keterangan: `Beban PPh Final ${periode}` },
            { akunId: pengaturan.akunHutangPphFinalId!, debit: D(0), kredit: data.pphFinal, keterangan: `Hutang PPh Final ${periode}` },
          ],
        },
      },
    });
    await tx.pphFinalBulanan.create({ data: { periode, omzet: data.omzet, tarifPersen: pengaturan.pphFinalPersen, jumlah: data.pphFinal, jurnalId: jurnal.id } });
    await tx.logAktivitas.create({
      data: { penggunaId: pengguna.id === "skrip-uji" ? null : pengguna.id, penggunaNama: pengguna.nama, aksi: "CATAT", jenis: "PPh Final Bulanan", nomor: jurnal.nomor, keterangan: `Periode ${periode}: omzet ${format(data.omzet)} × ${format(pengaturan.pphFinalPersen)}% = ${format(data.pphFinal)}` },
    });
  });

  revalidatePath(HALAMAN);
  revalidatePath("/buku-besar/jurnal");
}

export async function catatPphFinalFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => catatPphFinal(dataFormulir));
}
