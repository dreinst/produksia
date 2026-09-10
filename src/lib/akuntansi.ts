import type { Prisma } from "@/prisma-klien/client";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { pastikanAkunRinci } from "@/lib/baganAkun";
import { pastikanTahunTerbuka } from "@/lib/tutupBuku";
import { D, kali, jumlahkan, type Desimal } from "@/lib/uang";

/*
 * Aturan posting jurnal otomatis. Semua fungsi dipanggil DI DALAM transaksi dokumen,
 * sehingga dokumen, mutasi stok, dan jurnal selalu tersimpan bersama atau batal bersama.
 *
 * Akun dipilih per baris: akun khusus di Barang (akunPendapatan/akunHpp/akunPersediaan/akunBeban)
 * bila diisi, kalau tidak memakai PemetaanAkun. Baris JASA tidak menyentuh persediaan/HPP.
 * Keterangan jurnal selalu memuat nomor dokumen agar jejaknya bisa ditelusuri dua arah.
 */

type Tx = Prisma.TransactionClient;
type InputBarisJurnal = { akunId: string; debit: Desimal; kredit: Desimal; keterangan: string };
export type BarisDokumen = { barangId: string; jumlah: Desimal; harga: Desimal };
export type SumberOtomatis = "PENJUALAN" | "PEMBELIAN" | "PERSEDIAAN" | "ASET_TETAP" | "PENYUSUTAN";

const NOL = D(0);

export async function ambilPemetaanAkun(tx: Tx) {
  const pemetaan = await tx.pemetaanAkun.findUnique({ where: { id: "default" } });
  if (!pemetaan) {
    throw new Error(
      "Pemetaan akun belum diatur. Buka menu Pengaturan > Bagan Akun Standar (terapkan) atau Pemetaan Akun sebelum membuat transaksi ini.",
    );
  }
  return pemetaan;
}

type InfoBarang = {
  id: string;
  kode: string;
  nama: string;
  jenis: "BARANG" | "JASA";
  hargaBeli: Desimal;
  akunPendapatanId: string | null;
  akunHppId: string | null;
  akunPersediaanId: string | null;
  akunBebanId: string | null;
};

async function infoBarang(tx: Tx, daftarId: string[]): Promise<Map<string, InfoBarang>> {
  const daftar = await tx.barang.findMany({
    where: { id: { in: [...new Set(daftarId)] } },
    select: { id: true, kode: true, nama: true, jenis: true, hargaBeli: true, akunPendapatanId: true, akunHppId: true, akunPersediaanId: true, akunBebanId: true },
  });
  return new Map(daftar.map((b) => [b.id, { ...b, hargaBeli: D(b.hargaBeli) }]));
}

function ambilInfo(peta: Map<string, InfoBarang>, barangId: string): InfoBarang {
  const info = peta.get(barangId);
  if (!info) throw new Error("Barang tidak ditemukan");
  return info;
}

/** Penjumlahan per akun (urutan sisip dipertahankan agar jurnal mudah dibaca). */
function pengumpul() {
  const peta = new Map<string, Desimal>();
  return {
    tambah(akunId: string, jumlah: Desimal) {
      if (jumlah.isZero()) return;
      peta.set(akunId, (peta.get(akunId) ?? NOL).plus(jumlah));
    },
    daftar(): [string, Desimal][] {
      return [...peta.entries()].filter(([, v]) => !v.isZero());
    },
  };
}

/** Membuat satu jurnal seimbang; baris bernilai nol dibuang; akun kelompok ditolak. */
export async function catatJurnal(tx: Tx, prefix: string, keterangan: string, sumber: SumberOtomatis, daftarBaris: InputBarisJurnal[]) {
  const baris = daftarBaris.filter((b) => !b.debit.isZero() || !b.kredit.isZero());
  if (baris.length === 0) return null;
  const totalDebit = jumlahkan(baris.map((b) => b.debit));
  const totalKredit = jumlahkan(baris.map((b) => b.kredit));
  if (!totalDebit.equals(totalKredit)) {
    throw new Error(`Jurnal otomatis ${prefix} tidak seimbang (debit ${totalDebit.toFixed(2)} vs kredit ${totalKredit.toFixed(2)}) — laporkan ke pengembang`);
  }
  await pastikanAkunRinci(tx, baris.map((b) => b.akunId));
  await pastikanTahunTerbuka(tx, new Date());
  const nomor = await nomorDokumenBerikutnya(tx.jurnal, prefix);
  return tx.jurnal.create({ data: { nomor, keterangan, sumber, baris: { create: baris } } });
}

/** Nilai pokok satu baris: hanya BARANG (jasa tidak punya persediaan). */
export function hargaPokokBaris(info: InfoBarang, jumlah: Desimal): Desimal {
  return info.jenis === "BARANG" ? kali(jumlah, info.hargaBeli) : NOL;
}

// ---------- Penjualan ----------

/** Baris surat jalan yang dinilai: harga pokok saat kirim dan porsi yang sudah lebih dulu difaktur. */
export type BarisKirim = { barangId: string; jumlah: Desimal; hargaPokok: Desimal; sudahDifaktur: Desimal };

/**
 * Surat Jalan: Cr Persediaan (qty × harga pokok saat kirim) — nilai stok turun bersamaan dengan fisiknya.
 * Debitnya: HPP untuk porsi yang sudah difaktur lebih dulu, Barang Terkirim Belum Ditagih untuk sisanya
 * (diakui sebagai HPP nanti saat Faktur Penjualan mengonsumsinya).
 */
export async function catatJurnalPengiriman(tx: Tx, pengiriman: { nomor: string }, daftarBaris: BarisKirim[]) {
  const m = await ambilPemetaanAkun(tx);
  const peta = await infoBarang(tx, daftarBaris.map((b) => b.barangId));
  const persediaan = pengumpul(), hpp = pengumpul();
  let transit = NOL;
  for (const b of daftarBaris) {
    const info = ambilInfo(peta, b.barangId);
    if (info.jenis !== "BARANG") continue;
    const nilai = kali(b.jumlah, b.hargaPokok);
    const nilaiHpp = kali(b.sudahDifaktur, b.hargaPokok);
    persediaan.tambah(info.akunPersediaanId ?? m.persediaanId, nilai);
    hpp.tambah(info.akunHppId ?? m.hppId, nilaiHpp);
    transit = transit.plus(nilai.minus(nilaiHpp));
  }
  if (persediaan.daftar().length === 0) return null;
  if (transit.gt(0) && !m.barangTerkirimId) {
    throw new Error("Pemetaan akun 'Barang Terkirim Belum Ditagih' belum diatur (Pengaturan > Pemetaan Akun)");
  }
  const baris: InputBarisJurnal[] = [
    ...hpp.daftar().map(([akunId, v]) => ({ akunId, debit: v, kredit: NOL, keterangan: `HPP (sudah difaktur) ${pengiriman.nomor}` })),
    ...(transit.gt(0) && m.barangTerkirimId ? [{ akunId: m.barangTerkirimId, debit: transit, kredit: NOL, keterangan: `Barang terkirim ${pengiriman.nomor}` }] : []),
    ...persediaan.daftar().map(([akunId, v]) => ({ akunId, debit: NOL, kredit: v, keterangan: `Persediaan keluar ${pengiriman.nomor}` })),
  ];
  return catatJurnal(tx, "JU-SJ", `Surat Jalan ${pengiriman.nomor}`, "PENJUALAN", baris);
}

/**
 * Faktur Penjualan: Dr Piutang (DPP + PPN) / Cr Pendapatan per akun (+ PPN Keluaran).
 * HPP diakui untuk barang yang sudah dikirim: Dr HPP / Cr Barang Terkirim Belum Ditagih (nilai dari baris SJ).
 * Barang yang difaktur sebelum dikirim: HPP-nya diakui nanti saat Surat Jalan.
 */
export async function catatJurnalFakturPenjualan(
  tx: Tx,
  faktur: { nomor: string; total: Desimal | number | string; ppn?: Desimal | number | string; uangMuka?: Desimal | number | string },
  daftarBaris: BarisDokumen[],
  akunPpnKeluaranId?: string | null,
  konsumsiTransit: { barangId: string; jumlah: Desimal; hargaPokok: Desimal }[] = [],
) {
  const m = await ambilPemetaanAkun(tx);
  const ppn = D(faktur.ppn ?? 0);
  if (ppn.gt(0) && !akunPpnKeluaranId) throw new Error("Akun PPN Keluaran belum diatur (Pengaturan > Perusahaan & Pajak)");
  // Uang muka pesanan yang dipakai: mengurangi piutang, membalik kewajiban Uang Muka Pelanggan
  const uangMuka = D(faktur.uangMuka ?? 0);
  if (uangMuka.gt(0) && !m.uangMukaPelangganId) throw new Error("Pemetaan akun 'Uang Muka Pelanggan' belum diatur (Pengaturan > Pemetaan Akun)");
  const peta = await infoBarang(tx, [...daftarBaris.map((b) => b.barangId), ...konsumsiTransit.map((k) => k.barangId)]);
  const pendapatan = pengumpul(), hpp = pengumpul();
  for (const b of daftarBaris) {
    const info = ambilInfo(peta, b.barangId);
    pendapatan.tambah(info.akunPendapatanId ?? m.pendapatanPenjualanId, kali(b.jumlah, b.harga));
  }
  let transit = NOL;
  for (const k of konsumsiTransit) {
    const info = ambilInfo(peta, k.barangId);
    const nilai = kali(k.jumlah, k.hargaPokok);
    hpp.tambah(info.akunHppId ?? m.hppId, nilai);
    transit = transit.plus(nilai);
  }
  if (transit.gt(0) && !m.barangTerkirimId) {
    throw new Error("Pemetaan akun 'Barang Terkirim Belum Ditagih' belum diatur (Pengaturan > Pemetaan Akun)");
  }
  const baris: InputBarisJurnal[] = [
    { akunId: m.piutangUsahaId, debit: D(faktur.total).minus(uangMuka), kredit: NOL, keterangan: `Piutang ${faktur.nomor}` },
    ...(uangMuka.gt(0) && m.uangMukaPelangganId ? [{ akunId: m.uangMukaPelangganId, debit: uangMuka, kredit: NOL, keterangan: `Uang muka dipakai ${faktur.nomor}` }] : []),
    ...pendapatan.daftar().map(([akunId, v]) => ({ akunId, debit: NOL, kredit: v, keterangan: `Pendapatan ${faktur.nomor}` })),
    ...(ppn.gt(0) && akunPpnKeluaranId ? [{ akunId: akunPpnKeluaranId, debit: NOL, kredit: ppn, keterangan: `PPN keluaran ${faktur.nomor}` }] : []),
    ...hpp.daftar().map(([akunId, v]) => ({ akunId, debit: v, kredit: NOL, keterangan: `HPP ${faktur.nomor}` })),
    ...(transit.gt(0) && m.barangTerkirimId ? [{ akunId: m.barangTerkirimId, debit: NOL, kredit: transit, keterangan: `Barang terkirim ditagih ${faktur.nomor}` }] : []),
  ];
  return catatJurnal(tx, "JU-FJ", `Faktur Penjualan ${faktur.nomor}`, "PENJUALAN", baris);
}

/** Penerimaan Penjualan: Dr Kas/Bank pilihan / Cr Piutang. */
export async function catatJurnalPenerimaanPenjualan(
  tx: Tx,
  penerimaan: { nomor: string; akunId: string; jumlah: Desimal | number | string; potonganPajak?: Desimal | number | string },
  nomorFaktur?: string,
  akunPph23DimukaId?: string | null,
) {
  const m = await ambilPemetaanAkun(tx);
  const jumlah = D(penerimaan.jumlah);
  const potongan = D(penerimaan.potonganPajak ?? 0);
  if (potongan.gt(0) && !akunPph23DimukaId) throw new Error("Akun Pajak Dibayar Dimuka (PPh 23) belum diatur (Pengaturan > Perusahaan & Pajak)");
  return catatJurnal(tx, "JU-TRM", `Penerimaan ${penerimaan.nomor}${nomorFaktur ? ` untuk ${nomorFaktur}` : ""}`, "PENJUALAN", [
    { akunId: penerimaan.akunId, debit: jumlah, kredit: NOL, keterangan: `Terima ${penerimaan.nomor}` },
    ...(potongan.gt(0) && akunPph23DimukaId ? [{ akunId: akunPph23DimukaId, debit: potongan, kredit: NOL, keterangan: `PPh 23 dipotong pelanggan ${penerimaan.nomor}` }] : []),
    { akunId: m.piutangUsahaId, debit: NOL, kredit: jumlah.plus(potongan), keterangan: `Pelunasan piutang ${nomorFaktur ?? penerimaan.nomor}` },
  ]);
}

/** Uang Muka Pelanggan (JU-UM): Dr Kas/Bank / Cr Uang Muka Pelanggan — kewajiban sampai dipakai faktur. */
export async function catatJurnalUangMuka(tx: Tx, uangMuka: { nomor: string; akunId: string; jumlah: Desimal | number | string }, nomorPesanan?: string) {
  const m = await ambilPemetaanAkun(tx);
  if (!m.uangMukaPelangganId) throw new Error("Pemetaan akun 'Uang Muka Pelanggan' belum diatur (Pengaturan > Pemetaan Akun)");
  const jumlah = D(uangMuka.jumlah);
  return catatJurnal(tx, "JU-UM", `Uang Muka ${uangMuka.nomor}${nomorPesanan ? ` untuk ${nomorPesanan}` : ""}`, "PENJUALAN", [
    { akunId: uangMuka.akunId, debit: jumlah, kredit: NOL, keterangan: `Terima DP ${uangMuka.nomor}` },
    { akunId: m.uangMukaPelangganId, debit: NOL, kredit: jumlah, keterangan: `Uang muka pelanggan ${uangMuka.nomor}` },
  ]);
}

/** Retur Penjualan: kebalikan faktur — Dr Pendapatan per akun / Cr Piutang; Dr Persediaan / Cr HPP untuk BARANG (nilai pokok saat ini). */
export async function catatJurnalReturPenjualan(
  tx: Tx,
  retur: { nomor: string; total: Desimal; ppn?: Desimal },
  daftarBaris: BarisDokumen[],
  akunPpnKeluaranId?: string | null,
) {
  const m = await ambilPemetaanAkun(tx);
  const ppn = retur.ppn ?? NOL;
  if (ppn.gt(0) && !akunPpnKeluaranId) throw new Error("Akun PPN Keluaran belum diatur (Pengaturan > Perusahaan & Pajak)");
  const peta = await infoBarang(tx, daftarBaris.map((b) => b.barangId));
  const pendapatan = pengumpul(), hpp = pengumpul(), persediaan = pengumpul();
  for (const b of daftarBaris) {
    const info = ambilInfo(peta, b.barangId);
    pendapatan.tambah(info.akunPendapatanId ?? m.pendapatanPenjualanId, kali(b.jumlah, b.harga));
    const pokok = hargaPokokBaris(info, b.jumlah);
    persediaan.tambah(info.akunPersediaanId ?? m.persediaanId, pokok);
    hpp.tambah(info.akunHppId ?? m.hppId, pokok);
  }
  const baris: InputBarisJurnal[] = [
    ...pendapatan.daftar().map(([akunId, v]) => ({ akunId, debit: v, kredit: NOL, keterangan: `Retur ${retur.nomor}` })),
    ...(ppn.gt(0) && akunPpnKeluaranId ? [{ akunId: akunPpnKeluaranId, debit: ppn, kredit: NOL, keterangan: `PPN keluaran dibalik ${retur.nomor}` }] : []),
    { akunId: m.piutangUsahaId, debit: NOL, kredit: retur.total, keterangan: `Pengurangan piutang ${retur.nomor}` },
    ...persediaan.daftar().map(([akunId, v]) => ({ akunId, debit: v, kredit: NOL, keterangan: `Barang retur masuk ${retur.nomor}` })),
    ...hpp.daftar().map(([akunId, v]) => ({ akunId, debit: NOL, kredit: v, keterangan: `Koreksi HPP ${retur.nomor}` })),
  ];
  return catatJurnal(tx, "JU-RJ", `Retur Penjualan ${retur.nomor}`, "PENJUALAN", baris);
}

// ---------- Pembelian ----------

/**
 * Terima Barang: Dr Persediaan per akun (harga pesanan) / Cr Barang Diterima Belum Ditagih.
 * Dengan ini nilai persediaan di buku besar naik bersamaan dengan stok fisik, bukan menunggu faktur.
 * Baris JASA tidak dijurnal di sini (bebannya diakui saat Faktur Pembelian).
 */
export async function catatJurnalPenerimaanBarang(tx: Tx, penerimaan: { nomor: string }, daftarBaris: BarisDokumen[]) {
  const m = await ambilPemetaanAkun(tx);
  const peta = await infoBarang(tx, daftarBaris.map((b) => b.barangId));
  const persediaan = pengumpul();
  for (const b of daftarBaris) {
    const info = ambilInfo(peta, b.barangId);
    if (info.jenis !== "BARANG") continue;
    persediaan.tambah(info.akunPersediaanId ?? m.persediaanId, kali(b.jumlah, b.harga));
  }
  const daftar = persediaan.daftar();
  if (daftar.length === 0) return null;
  if (!m.barangBelumDitagihId) {
    throw new Error("Pemetaan akun 'Barang Diterima Belum Ditagih' belum diatur (Pengaturan > Pemetaan Akun)");
  }
  const total = jumlahkan(daftar.map(([, v]) => v));
  return catatJurnal(tx, "JU-TB", `Terima Barang ${penerimaan.nomor}`, "PEMBELIAN", [
    ...daftar.map(([akunId, v]) => ({ akunId, debit: v, kredit: NOL, keterangan: `Persediaan masuk ${penerimaan.nomor}` })),
    { akunId: m.barangBelumDitagihId, debit: NOL, kredit: total, keterangan: `Belum ditagih ${penerimaan.nomor}` },
  ]);
}

/**
 * Faktur Pembelian: BARANG → Dr Barang Diterima Belum Ditagih (harga pesanan) ± selisih harga ke Persediaan;
 * JASA → Dr Beban (akun barang / pemetaan bebanJasa / HPP); Cr Hutang Usaha (total faktur).
 */
export async function catatJurnalFakturPembelian(
  tx: Tx,
  faktur: { nomor: string; total: Desimal | number | string; ppn?: Desimal | number | string },
  daftarBaris: BarisDokumen[],
  hargaPesanan: Map<string, Desimal>,
  akunPpnMasukanId?: string | null,
) {
  const m = await ambilPemetaanAkun(tx);
  const ppn = D(faktur.ppn ?? 0);
  if (ppn.gt(0) && !akunPpnMasukanId) throw new Error("Akun PPN Masukan belum diatur (Pengaturan > Perusahaan & Pajak)");
  const peta = await infoBarang(tx, daftarBaris.map((b) => b.barangId));
  const belumDitagih = pengumpul(), selisihPersediaan = pengumpul(), beban = pengumpul();
  for (const b of daftarBaris) {
    const info = ambilInfo(peta, b.barangId);
    if (info.jenis === "BARANG") {
      const hargaDasar = hargaPesanan.get(b.barangId) ?? b.harga;
      belumDitagih.tambah("_", kali(b.jumlah, hargaDasar));
      selisihPersediaan.tambah(info.akunPersediaanId ?? m.persediaanId, kali(b.jumlah, b.harga.minus(hargaDasar)));
    } else {
      beban.tambah(info.akunBebanId ?? m.bebanJasaId ?? m.hppId, kali(b.jumlah, b.harga));
    }
  }
  const nilaiBelumDitagih = jumlahkan(belumDitagih.daftar().map(([, v]) => v));
  if (nilaiBelumDitagih.gt(0) && !m.barangBelumDitagihId) {
    throw new Error("Pemetaan akun 'Barang Diterima Belum Ditagih' belum diatur (Pengaturan > Pemetaan Akun)");
  }
  const baris: InputBarisJurnal[] = [
    ...(nilaiBelumDitagih.gt(0) && m.barangBelumDitagihId
      ? [{ akunId: m.barangBelumDitagihId, debit: nilaiBelumDitagih, kredit: NOL, keterangan: `Tagihan barang ${faktur.nomor}` }]
      : []),
    ...selisihPersediaan.daftar().map(([akunId, v]) => ({
      akunId,
      debit: v.gt(0) ? v : NOL,
      kredit: v.lt(0) ? v.neg() : NOL,
      keterangan: `Selisih harga faktur vs pesanan ${faktur.nomor}`,
    })),
    ...beban.daftar().map(([akunId, v]) => ({ akunId, debit: v, kredit: NOL, keterangan: `Jasa/beban ${faktur.nomor}` })),
    ...(ppn.gt(0) && akunPpnMasukanId ? [{ akunId: akunPpnMasukanId, debit: ppn, kredit: NOL, keterangan: `PPN masukan ${faktur.nomor}` }] : []),
    { akunId: m.utangUsahaId, debit: NOL, kredit: D(faktur.total), keterangan: `Hutang ${faktur.nomor}` },
  ];
  return catatJurnal(tx, "JU-FB", `Faktur Pembelian ${faktur.nomor}`, "PEMBELIAN", baris);
}

/** Pembayaran Pembelian: Dr Hutang / Cr Kas/Bank pilihan. */
export async function catatJurnalPembayaranPembelian(
  tx: Tx,
  pembayaran: { nomor: string; akunId: string; jumlah: Desimal | number | string; potonganPajak?: Desimal | number | string },
  nomorFaktur?: string,
  akunPph23DipotongId?: string | null,
) {
  const m = await ambilPemetaanAkun(tx);
  const jumlah = D(pembayaran.jumlah);
  const potongan = D(pembayaran.potonganPajak ?? 0);
  if (potongan.gt(0) && !akunPph23DipotongId) throw new Error("Akun Hutang PPh 23 belum diatur (Pengaturan > Perusahaan & Pajak)");
  return catatJurnal(tx, "JU-BYR", `Pembayaran ${pembayaran.nomor}${nomorFaktur ? ` untuk ${nomorFaktur}` : ""}`, "PEMBELIAN", [
    { akunId: m.utangUsahaId, debit: jumlah.plus(potongan), kredit: NOL, keterangan: `Pelunasan hutang ${nomorFaktur ?? pembayaran.nomor}` },
    { akunId: pembayaran.akunId, debit: NOL, kredit: jumlah, keterangan: `Bayar ${pembayaran.nomor}` },
    ...(potongan.gt(0) && akunPph23DipotongId ? [{ akunId: akunPph23DipotongId, debit: NOL, kredit: potongan, keterangan: `PPh 23 dipotong ${pembayaran.nomor}` }] : []),
  ]);
}

/**
 * Retur Pembelian: Dr Hutang (harga faktur); BARANG → Cr Persediaan (harga pokok rata-rata saat ini),
 * selisih harga faktur vs pokok → Selisih Persediaan; JASA → Cr Beban.
 */
export async function catatJurnalReturPembelian(
  tx: Tx,
  retur: { nomor: string; total: Desimal; ppn?: Desimal },
  daftarBaris: BarisDokumen[],
  akunPpnMasukanId?: string | null,
) {
  const m = await ambilPemetaanAkun(tx);
  const ppn = retur.ppn ?? NOL;
  if (ppn.gt(0) && !akunPpnMasukanId) throw new Error("Akun PPN Masukan belum diatur (Pengaturan > Perusahaan & Pajak)");
  const peta = await infoBarang(tx, daftarBaris.map((b) => b.barangId));
  const persediaan = pengumpul(), beban = pengumpul();
  let selisih = NOL;
  for (const b of daftarBaris) {
    const info = ambilInfo(peta, b.barangId);
    const nilaiFaktur = kali(b.jumlah, b.harga);
    if (info.jenis === "BARANG") {
      const pokok = hargaPokokBaris(info, b.jumlah);
      persediaan.tambah(info.akunPersediaanId ?? m.persediaanId, pokok);
      selisih = selisih.plus(nilaiFaktur.minus(pokok));
    } else {
      beban.tambah(info.akunBebanId ?? m.bebanJasaId ?? m.hppId, nilaiFaktur);
    }
  }
  if (!selisih.isZero() && !m.selisihPersediaanId) {
    throw new Error("Pemetaan akun 'Selisih Persediaan' belum diatur (Pengaturan > Pemetaan Akun)");
  }
  const baris: InputBarisJurnal[] = [
    { akunId: m.utangUsahaId, debit: retur.total, kredit: NOL, keterangan: `Pengurangan hutang ${retur.nomor}` },
    ...persediaan.daftar().map(([akunId, v]) => ({ akunId, debit: NOL, kredit: v, keterangan: `Barang keluar retur ${retur.nomor}` })),
    ...beban.daftar().map(([akunId, v]) => ({ akunId, debit: NOL, kredit: v, keterangan: `Koreksi beban ${retur.nomor}` })),
    ...(ppn.gt(0) && akunPpnMasukanId ? [{ akunId: akunPpnMasukanId, debit: NOL, kredit: ppn, keterangan: `PPN masukan dibalik ${retur.nomor}` }] : []),
    ...(!selisih.isZero() && m.selisihPersediaanId
      ? [{ akunId: m.selisihPersediaanId, debit: selisih.lt(0) ? selisih.neg() : NOL, kredit: selisih.gt(0) ? selisih : NOL, keterangan: `Selisih harga retur ${retur.nomor}` }]
      : []),
  ];
  return catatJurnal(tx, "JU-RB", `Retur Pembelian ${retur.nomor}`, "PEMBELIAN", baris);
}

// ---------- Persediaan & Aset Tetap ----------

/** Penyesuaian stok: naik → Dr Persediaan / Cr akun lawan; turun → Dr akun lawan / Cr Persediaan (nilai = selisih × harga satuan). */
export async function catatJurnalPenyesuaianPersediaan(
  tx: Tx,
  penyesuaian: { nomor: string; akunLawanId: string; keterangan?: string | null },
  daftarBaris: { barangId: string; selisih: Desimal; hargaSatuan: Desimal }[],
) {
  const m = await ambilPemetaanAkun(tx);
  const peta = await infoBarang(tx, daftarBaris.map((b) => b.barangId));
  const persediaan = pengumpul();
  for (const b of daftarBaris) {
    const info = ambilInfo(peta, b.barangId);
    persediaan.tambah(info.akunPersediaanId ?? m.persediaanId, kali(b.selisih, b.hargaSatuan));
  }
  const daftar = persediaan.daftar();
  const total = jumlahkan(daftar.map(([, v]) => v));
  const baris: InputBarisJurnal[] = [
    ...daftar.map(([akunId, v]) => ({
      akunId,
      debit: v.gt(0) ? v : NOL,
      kredit: v.lt(0) ? v.neg() : NOL,
      keterangan: `Penyesuaian persediaan ${penyesuaian.nomor}`,
    })),
    { akunId: penyesuaian.akunLawanId, debit: total.lt(0) ? total.neg() : NOL, kredit: total.gt(0) ? total : NOL, keterangan: `Lawan penyesuaian ${penyesuaian.nomor}` },
  ];
  return catatJurnal(tx, "JU-PS", `Penyesuaian Persediaan ${penyesuaian.nomor}${penyesuaian.keterangan ? ` — ${penyesuaian.keterangan}` : ""}`, "PERSEDIAAN", baris);
}

/** Perolehan aset tetap: Dr Akun Aset / Cr Kas-Bank atau Hutang. */
export async function catatJurnalPerolehanAset(tx: Tx, aset: { kode: string; nama: string; hargaPerolehan: Desimal; akunAsetId: string; akunPembayaranId: string }) {
  return catatJurnal(tx, "JU-AT", `Perolehan aset ${aset.kode} ${aset.nama}`, "ASET_TETAP", [
    { akunId: aset.akunAsetId, debit: aset.hargaPerolehan, kredit: NOL, keterangan: `Perolehan ${aset.kode}` },
    { akunId: aset.akunPembayaranId, debit: NOL, kredit: aset.hargaPerolehan, keterangan: `Pembayaran aset ${aset.kode}` },
  ]);
}
