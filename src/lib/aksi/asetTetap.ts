"use server";

import { wajibHakAksi } from "@/lib/otentikasi";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { pastikanAkunRinci } from "@/lib/baganAkun";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { D, uang, bacaUang, jumlahkan, type Desimal } from "@/lib/uang";

export async function buatAsetTetap(dataFormulir: FormData) {
  await wajibHakAksi("aset-tetap.tulis");
  const kode = String(dataFormulir.get("kode") ?? "").trim();
  const nama = String(dataFormulir.get("nama") ?? "").trim();
  const tanggalPerolehan = String(dataFormulir.get("tanggalPerolehan") ?? "");
  const umurBulan = Number(dataFormulir.get("umurBulan") ?? 0);
  const akunAsetId = String(dataFormulir.get("akunAsetId") ?? "");
  const akunBebanPenyusutanId = String(dataFormulir.get("akunBebanPenyusutanId") ?? "");
  const akunAkumulasiPenyusutanId = String(dataFormulir.get("akunAkumulasiPenyusutanId") ?? "");

  if (!kode || !nama) throw new Error("Kode dan nama aset wajib diisi");
  const hargaPerolehan = bacaUang(dataFormulir.get("hargaPerolehan"), "Harga perolehan");
  const nilaiSisa = bacaUang(dataFormulir.get("nilaiSisa"), "Nilai sisa", { allowZero: true });
  if (nilaiSisa.gte(hargaPerolehan)) throw new Error("Nilai sisa harus lebih kecil dari harga perolehan");
  if (!Number.isInteger(umurBulan) || umurBulan <= 0) {
    throw new Error("Umur ekonomis harus bilangan bulat > 0 (bulan)");
  }
  if (!akunAsetId || !akunBebanPenyusutanId || !akunAkumulasiPenyusutanId) {
    throw new Error("Semua akun (Aset, Beban Penyusutan, Akumulasi Penyusutan) wajib dipilih");
  }
  if (new Set([akunAsetId, akunBebanPenyusutanId, akunAkumulasiPenyusutanId]).size !== 3) {
    throw new Error("Ketiga akun harus berbeda satu sama lain");
  }

  await pastikanAkunRinci(db, [akunAsetId, akunBebanPenyusutanId, akunAkumulasiPenyusutanId]);

  await db.asetTetap.create({
    data: {
      kode,
      nama,
      tanggalPerolehan: tanggalPerolehan ? new Date(tanggalPerolehan) : new Date(),
      hargaPerolehan,
      nilaiSisa,
      umurBulan,
      akunAsetId,
      akunBebanPenyusutanId,
      akunAkumulasiPenyusutanId,
    },
  });

  revalidatePath("/aset-tetap");
  redirect("/aset-tetap");
}

export async function jalankanPenyusutanBulanan(dataFormulir: FormData) {
  await wajibHakAksi("aset-tetap.tulis");
  const teksPeriode = String(dataFormulir.get("periode") ?? "");
  if (!/^\d{4}-\d{2}$/.test(teksPeriode)) throw new Error("Periode wajib dipilih (format YYYY-MM)");
  const periode = new Date(`${teksPeriode}-01T00:00:00.000Z`);

  const daftarAset = await db.asetTetap.findMany({
    where: { status: "AKTIF" },
    include: { penyusutan: true },
  });

  const akanDiproses = daftarAset.filter((a) => !a.penyusutan.some((d) => d.periode.getTime() === periode.getTime()));
  if (akanDiproses.length === 0) {
    throw new Error("Semua aset aktif sudah punya jurnal penyusutan untuk periode ini");
  }

  const zero = D(0);
  const daftarBaris: { akunId: string; debit: Desimal; kredit: Desimal; keterangan: string }[] = [];
  const catatanPenyusutan: { asetId: string; jumlah: Desimal }[] = [];

  for (const aset of akanDiproses) {
    // garis lurus: (harga perolehan - nilai sisa) / umur; bulan terakhir mengambil sisa agar total pas
    const dasarPenyusutan = D(aset.hargaPerolehan).minus(aset.nilaiSisa);
    const jumlahBulanan = uang(dasarPenyusutan.div(aset.umurBulan));
    const sudahDisusutkan = jumlahkan(aset.penyusutan.map((d) => d.jumlah));
    const sisa = dasarPenyusutan.minus(sudahDisusutkan);
    if (sisa.lte(0)) continue;
    const jumlah = jumlahBulanan.lte(sisa) ? jumlahBulanan : uang(sisa);
    if (jumlah.lte(0)) continue;

    daftarBaris.push(
      { akunId: aset.akunBebanPenyusutanId, debit: jumlah, kredit: zero, keterangan: `Penyusutan ${aset.nama}` },
      { akunId: aset.akunAkumulasiPenyusutanId, debit: zero, kredit: jumlah, keterangan: `Akumulasi penyusutan ${aset.nama}` },
    );
    catatanPenyusutan.push({ asetId: aset.id, jumlah });
  }

  if (daftarBaris.length === 0) {
    throw new Error("Tidak ada aset yang perlu disusutkan (semua sudah mencapai nilai sisa)");
  }

  await db.$transaction(async (tx) => {
    const nomor = await nomorDokumenBerikutnya(tx.jurnal, "JU-PNY");
    await pastikanAkunRinci(tx, daftarBaris.map((b) => b.akunId));
    const jurnal = await tx.jurnal.create({
      data: { nomor, keterangan: `Penyusutan aset periode ${teksPeriode}`, sumber: "PENYUSUTAN", baris: { create: daftarBaris } },
    });

    for (const rec of catatanPenyusutan) {
      await tx.penyusutanAset.create({
        data: { asetId: rec.asetId, periode, jumlah: rec.jumlah, jurnalId: jurnal.id },
      });
    }
  });

  revalidatePath("/aset-tetap");
  revalidatePath("/aset-tetap/penyusutan");
  redirect("/aset-tetap/penyusutan");
}

// ---------- Varian untuk <FormulirAksi> (mengembalikan pesan error, bukan throw) ----------

export async function buatAsetTetapFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatAsetTetap(dataFormulir));
}
export async function jalankanPenyusutanBulananFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => jalankanPenyusutanBulanan(dataFormulir));
}
