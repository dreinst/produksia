"use server";

import { wajibHakAksi } from "@/lib/otentikasi";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { pastikanAkunMilik, pastikanAkunRinci } from "@/lib/baganAkun";
import { lingkupPerusahaan, perusahaanDokumenBaru, PERUSAHAAN_UTAMA, saringPerusahaan } from "@/lib/perusahaan";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { D, uang, bacaUang, jumlahkan, format, type Desimal } from "@/lib/uang";
import { catatJurnalPerolehanAset } from "@/lib/akuntansi";
import { pastikanTahunTerbuka } from "@/lib/tutupBuku";
import { dataLangsungDisetujui, persetujuanWajib } from "@/lib/persetujuan";

/**
 * Perusahaan aset baru: isian perusahaanId, kalau kosong lingkup aktif (D1 §8.3). Formulir aset mengirim perusahaan
 * sejak P18 (pilihan wajib di gabungan). Pemanggil tanpa isian di lingkup gabungan (mis. skrip) tetap memakai pemilik
 * akun yang dipilih, dan utama bila semua akunnya bersama (perilaku sebelum multi perusahaan). Akun milik dua
 * perusahaan berbeda ditolak pastikanAkunMilik sesudahnya.
 */
async function perusahaanAsetBaru(dataFormulir: FormData, akunIds: string[]): Promise<string> {
  const isian = String(dataFormulir.get("perusahaanId") ?? "").trim();
  if (isian || (await lingkupPerusahaan()).perusahaanId) return perusahaanDokumenBaru(dataFormulir);
  const milik = await db.akun.findFirst({ where: { id: { in: akunIds }, perusahaanId: { not: null } }, select: { perusahaanId: true }, orderBy: { kode: "asc" } });
  const dariAkun = new FormData();
  dariAkun.set("perusahaanId", milik?.perusahaanId ?? PERUSAHAAN_UTAMA);
  return perusahaanDokumenBaru(dariAkun); // memeriksa perusahaan ada dan aktif
}

export async function buatAsetTetap(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("aset.buat");
  const kode = String(dataFormulir.get("kode") ?? "").trim();
  const nama = String(dataFormulir.get("nama") ?? "").trim();
  const tanggalPerolehan = String(dataFormulir.get("tanggalPerolehan") ?? "");
  const umurBulan = Number(dataFormulir.get("umurBulan") ?? 0);
  const akunAsetId = String(dataFormulir.get("akunAsetId") ?? "");
  const akunBebanPenyusutanId = String(dataFormulir.get("akunBebanPenyusutanId") ?? "");
  const akunAkumulasiPenyusutanId = String(dataFormulir.get("akunAkumulasiPenyusutanId") ?? "");
  // opsional: Kas/Bank atau Hutang yang dikredit, kosong berarti aset sudah tercatat, tidak dijurnal lagi
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
  const semuaAkun = [akunAsetId, akunBebanPenyusutanId, akunAkumulasiPenyusutanId, ...(akunPembayaranId ? [akunPembayaranId] : [])];
  await pastikanAkunRinci(db, semuaAkun);
  // D1 §8.3: aset milik satu perusahaan; keempat akunnya bersama atau milik perusahaan itu
  const perusahaanId = await perusahaanAsetBaru(dataFormulir, semuaAkun);
  await pastikanAkunMilik(db, semuaAkun, perusahaanId);

  // Alur persetujuan: aset dicatat sebagai DRAFT dulu; jurnal perolehannya baru dibuat saat disetujui,
  // dan penyusutan bulanan hanya menghitung aset yang sudah DISETUJUI.
  const perluPersetujuan = await persetujuanWajib(db);
  const tanggal = tanggalPerolehan ? new Date(tanggalPerolehan) : new Date();

  await db.$transaction(async (tx) => {
    const jurnal = akunPembayaranId && !perluPersetujuan
      ? await catatJurnalPerolehanAset(tx, { kode, nama, hargaPerolehan, akunAsetId, akunPembayaranId, perusahaanId }, { tanggal })
      : null;
    await tx.asetTetap.create({
      data: {
        kode,
        nama,
        tanggalPerolehan: tanggal,
        hargaPerolehan,
        nilaiSisa,
        umurBulan,
        akunAsetId,
        akunBebanPenyusutanId,
        akunAkumulasiPenyusutanId,
        akunPembayaranId,
        perusahaanId,
        jurnalPerolehanId: jurnal?.id ?? null,
        ...(perluPersetujuan ? { statusPersetujuan: "DRAFT" } : dataLangsungDisetujui(pengguna)),
      },
    });
  });

  revalidatePath("/aset-tetap");
  if (perluPersetujuan) revalidatePath("/persetujuan");
  redirect("/aset-tetap");
}

export async function jalankanPenyusutanBulanan(dataFormulir: FormData) {
  await wajibHakAksi("penyusutan.buat");
  const teksPeriode = String(dataFormulir.get("periode") ?? "");
  if (!/^\d{4}-\d{2}$/.test(teksPeriode)) throw new Error("Periode wajib dipilih (format YYYY-MM)");
  const periode = new Date(`${teksPeriode}-01T00:00:00.000Z`);

  // Aset yang masih DRAFT/MENUNGGU/DITOLAK belum masuk buku besar, jadi belum boleh disusutkan.
  // Lingkup satu perusahaan hanya menyusutkan aset perusahaan itu; gabungan semua perusahaan (D1 §4.4).
  const daftarAset = await db.asetTetap.findMany({
    where: { status: "AKTIF", statusPersetujuan: "DISETUJUI", ...saringPerusahaan((await lingkupPerusahaan()).perusahaanId) },
    include: { penyusutan: true, perusahaan: { select: { kode: true, urutan: true, nama: true } } },
  });

  const akanDiproses = daftarAset.filter((a) => !a.penyusutan.some((d) => d.periode.getTime() === periode.getTime()));
  if (akanDiproses.length === 0) {
    throw new Error("Semua aset aktif sudah punya jurnal penyusutan untuk periode ini");
  }

  const zero = D(0);
  // satu jurnal JU-PNY per perusahaan aset (D1 §4.4); urutan kelompok mengikuti urutan perusahaan
  type Kelompok = { kode: string; daftarBaris: { akunId: string; debit: Desimal; kredit: Desimal; keterangan: string }[]; catatanPenyusutan: { asetId: string; jumlah: Desimal }[] };
  const kelompok = new Map<string, Kelompok>();
  const urut = [...akanDiproses].sort((a, b) => a.perusahaan.urutan - b.perusahaan.urutan || a.perusahaan.nama.localeCompare(b.perusahaan.nama));
  for (const a of urut) if (!kelompok.has(a.perusahaanId)) kelompok.set(a.perusahaanId, { kode: a.perusahaan.kode, daftarBaris: [], catatanPenyusutan: [] });

  for (const aset of akanDiproses) {
    // garis lurus: (harga perolehan - nilai sisa) / umur; bulan terakhir mengambil sisa agar total pas
    const dasarPenyusutan = D(aset.hargaPerolehan).minus(aset.nilaiSisa);
    const jumlahBulanan = uang(dasarPenyusutan.div(aset.umurBulan));
    const sudahDisusutkan = jumlahkan(aset.penyusutan.map((d) => d.jumlah));
    const sisa = dasarPenyusutan.minus(sudahDisusutkan);
    if (sisa.lte(0)) continue;
    const jumlah = jumlahBulanan.lte(sisa) ? jumlahBulanan : uang(sisa);
    if (jumlah.lte(0)) continue;

    const { daftarBaris, catatanPenyusutan } = kelompok.get(aset.perusahaanId)!;
    daftarBaris.push(
      { akunId: aset.akunBebanPenyusutanId, debit: jumlah, kredit: zero, keterangan: `Penyusutan ${aset.nama}` },
      { akunId: aset.akunAkumulasiPenyusutanId, debit: zero, kredit: jumlah, keterangan: `Akumulasi penyusutan ${aset.nama}` },
    );
    catatanPenyusutan.push({ asetId: aset.id, jumlah });
  }

  const berisi = [...kelompok].filter(([, k]) => k.daftarBaris.length > 0);
  if (berisi.length === 0) {
    throw new Error("Tidak ada aset yang perlu disusutkan (semua sudah mencapai nilai sisa)");
  }

  await db.$transaction(async (tx) => {
    // urutan pemeriksaan sama dengan sebelumnya: akun rinci dulu, lalu tahun buku
    await pastikanAkunRinci(tx, berisi.flatMap(([, k]) => k.daftarBaris.map((b) => b.akunId)));
    await pastikanTahunTerbuka(tx, new Date());
    for (const [perusahaanId, k] of berisi) {
      const nomor = await nomorDokumenBerikutnya(tx.jurnal, "JU-PNY");
      await pastikanAkunMilik(tx, k.daftarBaris.map((b) => b.akunId), perusahaanId);
      // keterangan utama sama persis dengan sebelum multi perusahaan; perusahaan lain diberi kodenya
      const jurnal = await tx.jurnal.create({
        data: {
          nomor,
          keterangan: `Penyusutan aset periode ${teksPeriode}${perusahaanId === PERUSAHAAN_UTAMA ? "" : ` ${k.kode}`}`,
          sumber: "PENYUSUTAN",
          perusahaanId,
          baris: { create: k.daftarBaris },
        },
      });

      for (const rec of k.catatanPenyusutan) {
        await tx.penyusutanAset.create({
          data: { asetId: rec.asetId, periode, jumlah: rec.jumlah, jurnalId: jurnal.id },
        });
      }
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
  const akhirHariIni = new Date();
  akhirHariIni.setHours(23, 59, 59, 999);
  if (tanggal > akhirHariIni) throw new Error("Tanggal pelepasan tidak boleh di masa depan");
  await pastikanAkunRinci(db, [akunLabaRugiId, ...(akunPenerimaanId ? [akunPenerimaanId] : [])]);

  await db.$transaction(async (tx) => {
    const aset = await tx.asetTetap.findUniqueOrThrow({ where: { id: asetId }, include: { penyusutan: true, pelepasan: true } });
    if (aset.status !== "AKTIF" || aset.pelepasan) throw new Error(`${aset.kode} sudah dilepas (${aset.status})`);
    if (aset.statusPersetujuan !== "DISETUJUI") throw new Error(`${aset.kode} belum disetujui, jadi belum masuk buku besar dan belum bisa dilepas`);
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
    // pelepasan mewarisi perusahaan aset (D1 §8.3)
    await pastikanAkunMilik(tx, baris.map((b) => b.akunId), aset.perusahaanId);
    const nomor = await nomorDokumenBerikutnya(tx.jurnal, "JU-LPS");
    const jurnal = await tx.jurnal.create({
      data: { nomor, tanggal, perusahaanId: aset.perusahaanId, keterangan: `${jenis === "DIJUAL" ? "Penjualan" : "Penghapusbukuan"} aset ${aset.kode} ${aset.nama} (nilai buku ${format(nilaiBuku)}, ${labaRugi.gte(0) ? "laba" : "rugi"} ${format(labaRugi.abs())})`, sumber: "ASET_TETAP", baris: { create: baris } },
    });
    await tx.pelepasanAset.create({
      data: { asetId, tanggal, jenis, hargaJual, akunPenerimaanId: hargaJual.gt(0) ? akunPenerimaanId : null, akunLabaRugiId, nilaiBuku, labaRugi, keterangan, jurnalId: jurnal.id, penggunaNama: pengguna.nama, ...dataLangsungDisetujui(pengguna) },
    });
    await tx.asetTetap.update({ where: { id: asetId }, data: { status: jenis } });
    await tx.logAktivitas.create({
      data: { penggunaId: pengguna.id === "skrip-uji" ? null : pengguna.id, penggunaNama: pengguna.nama, aksi: "LEPAS", jenis: "Pelepasan Aset", nomor: jurnal.nomor, perusahaanId: aset.perusahaanId, keterangan: `${aset.kode} ${jenis === "DIJUAL" ? `dijual ${format(hargaJual)}` : "dihapusbukukan"}; nilai buku ${format(nilaiBuku)}, ${labaRugi.gte(0) ? "laba" : "rugi"} ${format(labaRugi.abs())}` },
    });
  });

  revalidatePath("/aset-tetap");
  revalidatePath("/buku-besar/jurnal");
  redirect("/aset-tetap");
}

export async function lepasAsetFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => lepasAset(dataFormulir));
}
