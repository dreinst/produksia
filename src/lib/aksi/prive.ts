"use server";

import { wajibHakAksi } from "@/lib/otentikasi";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { D, bacaUang, format } from "@/lib/uang";
import { pastikanAkunRinci } from "@/lib/baganAkun";
import { pastikanTahunTerbuka } from "@/lib/tutupBuku";

/** Prive: pemilik mengambil uang pribadi dari kas/bank. Jurnal PRV: Dr Prive (modal, saldo debit) / Cr Kas/Bank. */
export async function buatPrive(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("prive.buat");
  const pemilikNama = String(dataFormulir.get("pemilikNama") ?? "").trim();
  const akunKasId = String(dataFormulir.get("akunKasId") ?? "");
  const akunPriveId = String(dataFormulir.get("akunPriveId") ?? "");
  const keterangan = String(dataFormulir.get("keterangan") ?? "").trim() || null;
  const tanggalTeks = String(dataFormulir.get("tanggal") ?? "");
  if (!pemilikNama) throw new Error("Nama pemilik wajib diisi");
  if (!akunKasId) throw new Error("Akun kas/bank wajib dipilih");
  if (!akunPriveId) throw new Error("Akun prive wajib dipilih");
  const jumlah = bacaUang(dataFormulir.get("jumlah"), "Jumlah");
  const tanggal = tanggalTeks ? new Date(`${tanggalTeks}T12:00:00`) : new Date();
  if (Number.isNaN(tanggal.getTime())) throw new Error("Tanggal tidak valid");
  const akhirHariIni = new Date();
  akhirHariIni.setHours(23, 59, 59, 999);
  if (tanggal > akhirHariIni) throw new Error("Tanggal tidak boleh di masa depan");
  const [akunKas, akunPrive] = await Promise.all([db.akun.findUnique({ where: { id: akunKasId } }), db.akun.findUnique({ where: { id: akunPriveId } })]);
  if (!akunKas?.kasBank) throw new Error("Akun sumber harus akun kas/bank");
  if (!akunPrive || akunPrive.jenis !== "MODAL") throw new Error("Akun prive harus akun modal");
  await pastikanAkunRinci(db, [akunKasId, akunPriveId]);

  await db.$transaction(async (tx) => {
    await pastikanTahunTerbuka(tx, tanggal);
    const nomor = await nomorDokumenBerikutnya(tx.prive, "PRV");
    const nomorJurnal = await nomorDokumenBerikutnya(tx.jurnal, "PRV");
    const jurnal = await tx.jurnal.create({
      data: {
        nomor: nomorJurnal,
        tanggal,
        keterangan: `Prive ${nomor} ${pemilikNama}${keterangan ? `: ${keterangan}` : ""}`,
        sumber: "PRIVE",
        baris: {
          create: [
            { akunId: akunPriveId, debit: jumlah, kredit: D(0), keterangan: `Prive ${pemilikNama}` },
            { akunId: akunKasId, debit: D(0), kredit: jumlah, keterangan: `Pengambilan ${pemilikNama}` },
          ],
        },
      },
    });
    await tx.prive.create({ data: { nomor, tanggal, pemilikNama, akunKasId, akunPriveId, jumlah, keterangan, jurnalId: jurnal.id, penggunaNama: pengguna.nama } });
    await tx.logAktivitas.create({
      data: { penggunaId: pengguna.id === "skrip-uji" ? null : pengguna.id, penggunaNama: pengguna.nama, aksi: "BUAT", jenis: "Prive", nomor, keterangan: `${pemilikNama} mengambil ${format(jumlah)} dari ${akunKas.kode}` },
    });
  });

  revalidatePath("/kas-bank/prive");
  revalidatePath("/laporan/prive");
  redirect("/kas-bank/prive");
}

export async function buatPriveFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatPrive(dataFormulir));
}
