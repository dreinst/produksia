"use server";

import { wajibHakAksi } from "@/lib/otentikasi";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { D, format } from "@/lib/uang";
import { pastikanAkunRinci } from "@/lib/baganAkun";
import { akhirTahun, ringkasanPenutupan } from "@/lib/tutupBuku";

const HALAMAN = "/buku-besar/tutup-buku";
const NOL = D(0);

function bacaTahun(dataFormulir: FormData): number {
  const tahun = Number(String(dataFormulir.get("tahun") ?? "").trim());
  if (!Number.isInteger(tahun) || tahun < 2000 || tahun > 2100) throw new Error("Tahun buku tidak valid");
  return tahun;
}

async function segarkan() {
  revalidatePath(HALAMAN);
  revalidatePath("/buku-besar/jurnal");
  revalidatePath("/buku-besar/neraca");
  revalidatePath("/buku-besar/neraca-saldo");
  revalidatePath("/", "layout");
}

/**
 * Menutup tahun buku: setiap akun pendapatan/beban rinci dinolkan ke Laba Ditahan lewat satu jurnal JU-TUTUP
 * bertanggal 31 Desember tahun itu. Bila tahun yang ditutup adalah tahun buku aktif, tahun buku maju satu tahun.
 */
export async function tutupTahun(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("tutup-buku.buat");
  const tahun = bacaTahun(dataFormulir);
  if (tahun > new Date().getFullYear()) throw new Error(`Tahun ${tahun} belum berjalan; tutup buku hanya untuk tahun yang sudah/sedang berjalan`);
  if (await db.tutupBuku.findUnique({ where: { tahun } })) throw new Error(`Tahun buku ${tahun} sudah ditutup`);
  const pemetaan = await db.pemetaanAkun.findUnique({ where: { id: "default" }, include: { labaDitahan: true } });
  if (!pemetaan?.labaDitahanId || !pemetaan.labaDitahan) throw new Error("Pemetaan akun 'Laba Ditahan' belum diatur (Pengaturan > Pemetaan Akun)");
  await pastikanAkunRinci(db, [pemetaan.labaDitahanId]);

  await db.$transaction(async (tx) => {
    const ringkasan = await ringkasanPenutupan(tx, tahun);
    const baris = [
      // pendapatan bersaldo kredit → didebit agar nol (saldo negatif = akun kontra, dikredit)
      ...ringkasan.pendapatan.map((b) => ({ akunId: b.akunId, debit: b.saldo.gt(0) ? b.saldo : NOL, kredit: b.saldo.lt(0) ? b.saldo.neg() : NOL, keterangan: `Tutup ${b.kode} ${b.nama} ${tahun}` })),
      // beban bersaldo debit → dikredit agar nol
      ...ringkasan.beban.map((b) => ({ akunId: b.akunId, debit: b.saldo.lt(0) ? b.saldo.neg() : NOL, kredit: b.saldo.gt(0) ? b.saldo : NOL, keterangan: `Tutup ${b.kode} ${b.nama} ${tahun}` })),
    ];
    const laba = ringkasan.labaBersih;
    if (!laba.isZero()) {
      baris.push({ akunId: pemetaan.labaDitahanId!, debit: laba.lt(0) ? laba.neg() : NOL, kredit: laba.gt(0) ? laba : NOL, keterangan: `${laba.gte(0) ? "Laba" : "Rugi"} bersih ${tahun} ke Laba Ditahan` });
    }
    let jurnalId: string | null = null;
    if (baris.length) {
      await pastikanAkunRinci(tx, baris.map((b) => b.akunId));
      const nomor = await nomorDokumenBerikutnya(tx.jurnal, "JU-TUTUP");
      const jurnal = await tx.jurnal.create({
        data: { nomor, tanggal: akhirTahun(tahun), keterangan: `Jurnal penutup tahun buku ${tahun} (laba bersih ${format(laba)})`, sumber: "PENUTUP", baris: { create: baris } },
      });
      jurnalId = jurnal.id;
    }
    await tx.tutupBuku.create({ data: { tahun, labaBersih: laba, penggunaNama: pengguna.nama, jurnalId } });

    // Tahun buku aktif ikut maju bila yang ditutup adalah tahun yang sedang dibuka
    const pengaturan = await tx.pengaturanPerusahaan.findUnique({ where: { id: "default" } });
    const tahunAktif = pengaturan?.tahunBuku ?? new Date().getFullYear();
    if (tahunAktif === tahun) {
      await tx.pengaturanPerusahaan.upsert({ where: { id: "default" }, create: { id: "default", tahunBuku: tahun + 1 }, update: { tahunBuku: tahun + 1 } });
    }
    await tx.logAktivitas.create({
      data: { penggunaId: pengguna.id === "skrip-uji" ? null : pengguna.id, penggunaNama: pengguna.nama, aksi: "TUTUP", jenis: "Tutup Buku", nomor: `TAHUN ${tahun}`, keterangan: `Laba bersih ${format(laba)} dipindahkan ke ${pemetaan.labaDitahan!.kode} ${pemetaan.labaDitahan!.nama}; ${ringkasan.pendapatan.length + ringkasan.beban.length} akun dinolkan` },
    });
  });
  await segarkan();
}

/** Membuka kembali tahun yang sudah ditutup: jurnal penutupnya dihapus, transaksi tahun itu bisa dicatat lagi. */
export async function bukaKembaliTahun(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("tutup-buku.buat");
  const tahun = bacaTahun(dataFormulir);
  const tutup = await db.tutupBuku.findUnique({ where: { tahun } });
  if (!tutup) throw new Error(`Tahun buku ${tahun} tidak dalam keadaan ditutup`);

  await db.$transaction(async (tx) => {
    await tx.tutupBuku.delete({ where: { id: tutup.id } });
    if (tutup.jurnalId) {
      await tx.barisJurnal.deleteMany({ where: { jurnalId: tutup.jurnalId } });
      await tx.jurnal.delete({ where: { id: tutup.jurnalId } });
    }
    const pengaturan = await tx.pengaturanPerusahaan.findUnique({ where: { id: "default" } });
    if (pengaturan?.tahunBuku === tahun + 1) {
      await tx.pengaturanPerusahaan.update({ where: { id: "default" }, data: { tahunBuku: tahun } });
    }
    await tx.logAktivitas.create({
      data: { penggunaId: pengguna.id === "skrip-uji" ? null : pengguna.id, penggunaNama: pengguna.nama, aksi: "BUKA", jenis: "Tutup Buku", nomor: `TAHUN ${tahun}`, keterangan: "Jurnal penutup dihapus; tahun buku dibuka kembali" },
    });
  });
  await segarkan();
}

export async function tutupTahunFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => tutupTahun(dataFormulir));
}
export async function bukaKembaliTahunFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => bukaKembaliTahun(dataFormulir));
}
