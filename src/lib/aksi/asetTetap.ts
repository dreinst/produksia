"use server";

import { wajibHakAksi } from "@/lib/otentikasi";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { pastikanAkunRinci } from "@/lib/baganAkun";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { D, uang, bacaUang, jumlahkan, format, type Desimal } from "@/lib/uang";
import { catatJurnalPerolehanAset } from "@/lib/akuntansi";
import { pastikanTahunTerbuka } from "@/lib/tutupBuku";

export async function buatAsetTetap(dataFormulir: FormData) {
  await wajibHakAksi("aset.buat");
  const kode = String(dataFormulir.get("kode") ?? "").trim();
  const nama = String(dataFormulir.get("nama") ?? "").trim();
  const tanggalPerolehan = String(dataFormulir.get("tanggalPerolehan") ?? "");
  const umurBulan = Number(dataFormulir.get("umurBulan") ?? 0);
  const akunAsetId = String(dataFormulir.get("akunAsetId") ?? "");
  const akunBebanPenyusutanId = String(dataFormulir.get("akunBebanPenyusutanId") ?? "");
  const akunAkumulasiPenyusutanId = String(dataFormulir.get("akunAkumulasiPenyusutanId") ?? "");
  // opsional: Kas/Bank atau Hutang yang dikredit — kosong berarti aset sudah tercatat, tidak dijurnal lagi
  const akunPembayaranId = String(dataFormulir.get("akunPembayaranId") ?? "") || null;

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

  if (akunPembayaranId && akunPembayaranId === akunAsetId) throw new Error("Akun pembayaran tidak boleh sama dengan akun aset");
  await pastikanAkunRinci(db, [akunAsetId, akunBebanPenyusutanId, akunAkumulasiPenyusutanId, ...(akunPembayaranId ? [akunPembayaranId] : [])]);

  await db.$transaction(async (tx) => {
    const jurnal = akunPembayaranId
      ? await catatJurnalPerolehanAset(tx, { kode, nama, hargaPerolehan, akunAsetId, akunPembayaranId })
      : null;
    await tx.asetTetap.create({
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
        akunPembayaranId,
        jurnalPerolehanId: jurnal?.id ?? null,
      },
    });
  });

  revalidatePath("/aset-tetap");
  redirect("/aset-tetap");
}

export async function jalankanPenyusutanBulanan(dataFormulir: FormData) {
  await wajibHakAksi("penyusutan.buat");
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
    await pastikanTahunTerbuka(tx, new Date());
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

// ---------- Pelepasan aset (dijual / dihapusbukukan) ----------

/**
 * Mengeluarkan aset dari pembukuan: Dr Kas/Bank (harga jual) · Dr Akumulasi Penyusutan (yang sudah disusutkan)
 * · Dr/Cr akun laba-rugi pelepasan (selisih harga jual vs nilai buku) · Cr akun Aset (harga perolehan).
 * Status aset menjadi DIJUAL/DIHAPUS sehingga tidak ikut penyusutan berikutnya.
 */
export async function lepasAset(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("pelepasan-aset.buat");
  const asetId = String(dataFormulir.get("asetId") ?? "");
  const jenis = String(dataFormulir.get("jenis") ?? "DIJUAL");
  const tanggalTeks = String(dataFormulir.get("tanggal") ?? "");
  const akunPenerimaanId = String(dataFormulir.get("akunPenerimaanId") ?? "") || null;
  const akunLabaRugiId = String(dataFormulir.get("akunLabaRugiId") ?? "");
  const keterangan = String(dataFormulir.get("keterangan") ?? "").trim() || null;
  if (!asetId) throw new Error("Aset wajib dipilih");
  if (jenis !== "DIJUAL" && jenis !== "DIHAPUS") throw new Error("Jenis pelepasan harus DIJUAL atau DIHAPUS");
  if (!akunLabaRugiId) throw new Error("Akun laba/rugi pelepasan wajib dipilih");
  const hargaJual = jenis === "DIJUAL" ? bacaUang(dataFormulir.get("hargaJual"), "Harga jual", { allowZero: true }) : D(0);
  if (jenis === "DIJUAL" && hargaJual.gt(0) && !akunPenerimaanId) throw new Error("Akun Kas/Bank penerima hasil penjualan wajib dipilih");
  const tanggal = tanggalTeks ? new Date(`${tanggalTeks}T12:00:00`) : new Date();
  if (Number.isNaN(tanggal.getTime())) throw new Error("Tanggal pelepasan tidak valid");
  if (tanggal > new Date()) throw new Error("Tanggal pelepasan tidak boleh di masa depan");
  await pastikanAkunRinci(db, [akunLabaRugiId, ...(akunPenerimaanId ? [akunPenerimaanId] : [])]);

  await db.$transaction(async (tx) => {
    const aset = await tx.asetTetap.findUniqueOrThrow({ where: { id: asetId }, include: { penyusutan: true, pelepasan: true } });
    if (aset.status !== "AKTIF" || aset.pelepasan) throw new Error(`${aset.kode} sudah dilepas (${aset.status})`);
    if (tanggal < aset.tanggalPerolehan) throw new Error("Tanggal pelepasan tidak boleh sebelum tanggal perolehan");
    await pastikanTahunTerbuka(tx, tanggal);
    const akumulasi = jumlahkan(aset.penyusutan.map((p) => p.jumlah));
    const nilaiBuku = D(aset.hargaPerolehan).minus(akumulasi);
    const labaRugi = hargaJual.minus(nilaiBuku);
    const zero = D(0);
    const baris = [
      ...(hargaJual.gt(0) && akunPenerimaanId ? [{ akunId: akunPenerimaanId, debit: hargaJual, kredit: zero, keterangan: `Hasil penjualan ${aset.kode}` }] : []),
      ...(akumulasi.gt(0) ? [{ akunId: aset.akunAkumulasiPenyusutanId, debit: akumulasi, kredit: zero, keterangan: `Akumulasi penyusutan ${aset.kode} dikeluarkan` }] : []),
      ...(labaRugi.lt(0) ? [{ akunId: akunLabaRugiId, debit: labaRugi.neg(), kredit: zero, keterangan: `Rugi pelepasan ${aset.kode}` }] : []),
      { akunId: aset.akunAsetId, debit: zero, kredit: D(aset.hargaPerolehan), keterangan: `Pelepasan ${aset.kode} ${aset.nama}` },
      ...(labaRugi.gt(0) ? [{ akunId: akunLabaRugiId, debit: zero, kredit: labaRugi, keterangan: `Laba pelepasan ${aset.kode}` }] : []),
    ];
    await pastikanAkunRinci(tx, baris.map((b) => b.akunId));
    const nomor = await nomorDokumenBerikutnya(tx.jurnal, "JU-LPS");
    const jurnal = await tx.jurnal.create({
      data: { nomor, tanggal, keterangan: `${jenis === "DIJUAL" ? "Penjualan" : "Penghapusbukuan"} aset ${aset.kode} ${aset.nama} (nilai buku ${format(nilaiBuku)}, ${labaRugi.gte(0) ? "laba" : "rugi"} ${format(labaRugi.abs())})`, sumber: "ASET_TETAP", baris: { create: baris } },
    });
    await tx.pelepasanAset.create({
      data: { asetId, tanggal, jenis, hargaJual, akunPenerimaanId: hargaJual.gt(0) ? akunPenerimaanId : null, akunLabaRugiId, nilaiBuku, labaRugi, keterangan, jurnalId: jurnal.id, penggunaNama: pengguna.nama },
    });
    await tx.asetTetap.update({ where: { id: asetId }, data: { status: jenis } });
    await tx.logAktivitas.create({
      data: { penggunaId: pengguna.id === "skrip-uji" ? null : pengguna.id, penggunaNama: pengguna.nama, aksi: "LEPAS", jenis: "Pelepasan Aset", nomor: jurnal.nomor, keterangan: `${aset.kode} ${jenis === "DIJUAL" ? `dijual ${format(hargaJual)}` : "dihapusbukukan"}; nilai buku ${format(nilaiBuku)}, ${labaRugi.gte(0) ? "laba" : "rugi"} ${format(labaRugi.abs())}` },
    });
  });

  revalidatePath("/aset-tetap");
  revalidatePath("/buku-besar/jurnal");
  redirect("/aset-tetap");
}

export async function lepasAsetFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => lepasAset(dataFormulir));
}
