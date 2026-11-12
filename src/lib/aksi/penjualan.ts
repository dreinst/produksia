"use server";

import { pastikanHak, wajibHakAksi } from "@/lib/otentikasi";
import type { PenggunaSesi } from "@/lib/hakAkses";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { D, format, uang, kali, bacaUang, jumlahkan, terkecil, terbesar, type Desimal } from "@/lib/uang";
import { kunciStokUrut, kurangiStok, tambahStok, labelBarang, jenisBarang } from "@/lib/stok";
import { catatJurnalPengiriman, catatJurnalFakturPenjualan, catatJurnalPenerimaanPenjualan, catatJurnalReturPenjualan, catatJurnalUangMuka, tandaiProyek } from "@/lib/akuntansi";
import { bacaProyekId } from "@/lib/proyek";
import { dataLangsungDisetujui, persetujuanWajib } from "@/lib/persetujuan";
import { bacaMataUangDokumen, nilaiDalamMataUang } from "@/lib/mataUang";
import { ambilPengaturanPerusahaan, bacaTarifPpn, hitungPpn, pesanAkunPajakBelumDiatur } from "@/lib/pengaturanPerusahaan";
import { PERUSAHAAN_UTAMA, pastikanAkunMilik, pastikanBarangMilik, pastikanGudangMilik, perusahaanDariInduk, perusahaanDokumenBaru } from "@/lib/perusahaan";
import {
  KOLOM_SALIN_BARIS,
  KOLOM_SALIN_PENAWARAN_KE_PESANAN,
  KOLOM_TEKS_FAKTUR,
  KOLOM_TEKS_PENAWARAN,
  KOLOM_TEKS_PENERIMAAN,
  KOLOM_TEKS_PESANAN,
  KOLOM_TEKS_UANG_MUKA,
  KOLOM_WARISAN_FAKTUR,
  adaBarisBebas,
  bacaBarisDokumen,
  bacaBarisFaktur,
  bacaBarisRetur,
  bacaBerlakuSampai,
  bacaDiskonFaktur,
  bacaJatuhTempo,
  bacaKopSuratId,
  bacaModeDokumen,
  bacaNilaiAddOn,
  bacaRingkasanDokumen,
  bacaTampilanEvent,
  bacaTeksDokumen,
  dataBarisDokumen,
  dataBarisFaktur,
  feeFaktur,
  konteksProrata,
  nilaiRetur,
  barisBerbarang,
  periksaHakBarisBebas,
  periksaHargaNego,
  pastikanKopSuratDokumen,
  returMenutup,
  rapikanTeks,
  ringkasanFaktur,
  salinKolom,
  bacaTerkirimBelumDifaktur,
  kunciBarisPesananPenjualan,
  kunciBarisSuratJalanPesanan,
  siapkanBarisFaktur,
  siapkanBarisJalurLama,
  siapkanBarisRetur,
  subtotalBaris,
  type BarisDokumen as BarisDokumenPenjualan,
} from "@/lib/dokumenPenjualan";
import { bacaRencanaTermin, dataButirTermin, nilaiBrutoKontrak, pastikanPembayaranTermin, periksaBrutoRencana, salinButirKePesanan, selesaikanRencana } from "@/lib/rencanaTermin";
import { alokasiNomorCetak, bacaNomorCetakManual, simpanNomorCetak, type JenisNomorCetak, type KlienTransaksi } from "@/lib/nomorCetak";
import { isiBarangLainLain, pastikanBarangLainLain } from "@/lib/barangLainLain";
import { catatAktivitasLead, pastikanLeadUntukPenawaran, tautanLeadNotifikasi } from "@/lib/crm";
import type { ModeDokumen, StatusKomersial } from "@/prisma-klien/enums";
import type { Prisma } from "@/prisma-klien/client";

/*
 * Aksi dokumen penjualan. Perusahaan (D1 §3.3): penawaran dan pesanan adalah dokumen akar (isian perusahaanId, kalau
 * kosong lingkup), dokumen lain mewarisi induknya, dan jurnal selalu mengikuti dokumennya. Pengaturan pajak dan termin
 * dibaca dari perusahaan dokumen. Perluasan D2 §6.1: mode event, baris bebas, diskon dan management fee, rencana
 * termin, teks surat, kop, nomor cetak; faktur dan retur memakai baris per id (jalur lama dipertahankan untuk pemanggil
 * lama). Penawaran dari lead CRM (D4 §3.8). Pembantu murni ada di dokumenPenjualan.ts, rencanaTermin.ts, nomorCetak.ts,
 * dan barangLainLain.ts supaya tidak menjadi endpoint publik.
 */

const NOL = D(0);

const LABEL_STATUS_KOMERSIAL: Record<StatusKomersial, string> = {
  DRAF: "Draf",
  TERKIRIM: "Terkirim",
  DITERIMA: "Diterima",
  DITOLAK: "Ditolak",
  KEDALUWARSA: "Kedaluwarsa",
};

function bacaJson(raw: FormDataEntryValue | null, pesanKosong: string): unknown[] {
  if (typeof raw !== "string" || !raw) throw new Error(pesanKosong);
  let hasilBaca: unknown;
  try {
    hasilBaca = JSON.parse(raw);
  } catch {
    throw new Error("Format baris barang tidak valid");
  }
  if (!Array.isArray(hasilBaca)) throw new Error(pesanKosong);
  return hasilBaca;
}

/** Baris jumlah saja (pengiriman). */
function bacaBarisJumlah<T extends { barangId?: string; jumlah?: string | number }>(
  dataFormulir: FormData,
  pesanKosong: string,
): (T & { jumlah: Desimal })[] {
  const hasilBaca = bacaJson(dataFormulir.get("baris"), pesanKosong) as T[];
  const daftarBaris = hasilBaca.filter((l) => l.barangId).map((l) => ({ ...l, jumlah: uang(l.jumlah) })).filter((l) => l.jumlah.gt(0));
  if (daftarBaris.length === 0) throw new Error(pesanKosong);
  return daftarBaris;
}

/** Status faktur dari total, penerimaan, dan retur: LUNAS bila (dibayar + retur) ≥ total. */
function statusFaktur(total: Desimal, dibayar: Desimal, retur: Desimal): "DRAF" | "SEBAGIAN" | "LUNAS" {
  if (dibayar.plus(retur).gte(total)) return "LUNAS";
  return dibayar.gt(0) || retur.gt(0) ? "SEBAGIAN" : "DRAF";
}

/** Management fee hasil hitung wajib >= 0 di semua dokumen (KONTRAK-TAMBAHAN P23); fee negatif membuat jurnal tidak seimbang. */
function pastikanFeeTidakNegatif(fee: Desimal) {
  if (fee.isNegative()) throw new Error("Management fee tidak boleh negatif");
}

/**
 * Isian nomor cetak manual (dipangkas, unik per perusahaan di tabel jenisnya); kosong = null, sehingga nomor otomatis
 * dialokasikan di transaksi dokumen bila format jenis itu aktif.
 */
function bacaNomorCetakIsian(dataFormulir: FormData, jenis: JenisNomorCetak, perusahaanId: string) {
  return bacaNomorCetakManual(db, { jenis, perusahaanId, isian: dataFormulir.get("nomorCetak") });
}

/** Nomor manual, atau nomor otomatis dari FormatNomor perusahaan dokumen (null bila format belum ada atau nonaktif). */
async function nomorCetakDokumen(tx: KlienTransaksi, manual: string | null, p: { perusahaanId: string; jenis: JenisNomorCetak; tanggal: Date }) {
  return manual ?? (await alokasiNomorCetak(tx, p));
}

/** Penulisan dokumen bernomor cetak: P2002 pada unik nomor cetak menjadi "Nomor cetak ... sudah dipakai dokumen lain." */
function tulisBernomor<T>(nomorCetak: string | null, kerja: () => Promise<T>): Promise<T> {
  return nomorCetak ? simpanNomorCetak(nomorCetak, kerja) : kerja();
}

/** Kop isian formulir untuk dokumen; null = kop bawaan perusahaan. Kop harus milik perusahaan dokumen dan belum dihapus. */
function kopIsian(dataFormulir: FormData): string | null {
  return bacaKopSuratId(dataFormulir);
}

/**
 * Isian bersama penawaran dan pesanan (D2 §3.1-§3.4, §3.8). Urutan pemeriksaan lama tetap: pelanggan, baris, harga,
 * proyek; perusahaan (akar) dan kepemilikan barang di antaranya (D1 §8.3). PPN hanya untuk tampilan dan nilai termin.
 */
async function bacaDokumenAkar(pengguna: PenggunaSesi, dataFormulir: FormData, dokumen: "penawaran" | "pesanan") {
  const pelangganId = String(dataFormulir.get("pelangganId") ?? "");
  if (!pelangganId) throw new Error("Pelanggan wajib dipilih");
  const mode = bacaModeDokumen(dataFormulir.get("mode"));
  const daftarBaris = bacaBarisDokumen(dataFormulir, { mode });
  // baris bebas, baris JASA-LAIN, dan nama barang katalog yang diganti butuh harga.nego (tinjauan P23 S2)
  await periksaHakBarisBebas(db, pengguna, daftarBaris);
  const berbarang = barisBerbarang(daftarBaris);
  await periksaHargaNego(db, pengguna, berbarang);
  // dokumen akar (D1 §3.3): perusahaan dari isian atau lingkup; barang dan proyek harus milik perusahaan itu
  const perusahaanId = await perusahaanDokumenBaru(dataFormulir);
  await pastikanBarangMilik(db, berbarang.map((l) => l.barangId), perusahaanId);
  const proyekId = await bacaProyekId(dataFormulir, db, perusahaanId);

  const ringkasan = bacaRingkasanDokumen(dataFormulir, daftarBaris, dokumen);
  pastikanFeeTidakNegatif(ringkasan.fee);
  const [pengaturan, pengaturanDokumen] = await Promise.all([
    ambilPengaturanPerusahaan(db, perusahaanId),
    db.pengaturanDokumenPenjualan.findUnique({ where: { perusahaanId }, select: { tampilanEvent: true } }),
  ]);
  const ppnPersen = bacaTarifPpn(dataFormulir.get("ppnPersen"), pengaturan);
  const tampilanEvent = bacaTampilanEvent(dataFormulir.get("tampilanEvent"), pengaturanDokumen?.tampilanEvent ?? "RINCI");
  const rencana = selesaikanRencana(bacaRencanaTermin(dataFormulir), ringkasan.total);
  periksaBrutoRencana(rencana, ppnPersen);
  const kopSuratId = kopIsian(dataFormulir);
  return { pelangganId, mode, daftarBaris, perusahaanId, proyekId, ringkasan, ppnPersen, tampilanEvent, rencana, kopSuratId };
}

/** Kolom kepala bersama penawaran dan pesanan hasil bacaDokumenAkar. */
function dataKepalaAkar(a: Awaited<ReturnType<typeof bacaDokumenAkar>>) {
  const r = a.ringkasan;
  return {
    perusahaanId: a.perusahaanId,
    pelangganId: a.pelangganId,
    proyekId: a.proyekId,
    total: r.total,
    mode: a.mode,
    tampilanEvent: a.tampilanEvent,
    jenisDiskon: r.jenisDiskon,
    nilaiDiskon: r.nilaiDiskon,
    diskon: r.diskon,
    jenisFee: r.jenisFee,
    nilaiFee: r.nilaiFee,
    fee: r.fee,
    ppnPersen: a.ppnPersen,
  };
}

/** Baris bebas diselesaikan ke Barang JASA-LAIN di dalam transaksi dokumen (D2 §3.3 langkah 7). */
async function selesaikanBaris(tx: KlienTransaksi, baris: readonly BarisDokumenPenjualan[]) {
  if (!adaBarisBebas(baris)) return baris as (BarisDokumenPenjualan & { barangId: string })[];
  return isiBarangLainLain(baris, await pastikanBarangLainLain(tx));
}

/** Baris pesanan (nested create): seperti dataBarisDokumen, tanpa kolom subtotal (BarisPesananPenjualan tidak punya). */
function dataBarisPesanan(baris: readonly (BarisDokumenPenjualan & { barangId: string })[]) {
  return dataBarisDokumen(baris).map((l) => ({
    barangId: l.barangId,
    jumlah: l.jumlah,
    harga: l.harga,
    frekuensi: l.frekuensi,
    satuanFrekuensi: l.satuanFrekuensi,
    bagian: l.bagian,
    urutan: l.urutan,
    nama: l.nama,
    deskripsi: l.deskripsi,
    satuan: l.satuan,
    keterangan: l.keterangan,
  }));
}

// ---------- Penawaran Penjualan ----------

export async function buatPenawaran(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("penawaran.buat");
  const akar = await bacaDokumenAkar(pengguna, dataFormulir, "penawaran");
  // penawaran dari lead CRM (D4 §3.8): butuh hak lihat lead; lead dan perusahaannya diperiksa di dalam transaksi
  const leadId = rapikanTeks(dataFormulir.get("leadId"));
  if (leadId) pastikanHak(pengguna, "lead.lihat");
  const teks = bacaTeksDokumen(dataFormulir, KOLOM_TEKS_PENAWARAN);
  const nilaiAddOn = bacaNilaiAddOn(dataFormulir.get("nilaiAddOn"));
  const berlakuSampai = bacaBerlakuSampai(dataFormulir.get("berlakuSampai"), { saatBuat: true });
  const nomorCetakManual = await bacaNomorCetakIsian(dataFormulir, "penawaran", akar.perusahaanId);
  const tanggal = new Date();

  await db.$transaction(async (tx) => {
    const nomor = await nomorDokumenBerikutnya(tx.penawaranPenjualan, "PNW");
    if (leadId) await pastikanLeadUntukPenawaran(tx, leadId, akar.perusahaanId);
    const kopSuratId = await pastikanKopSuratDokumen(tx, akar.kopSuratId, akar.perusahaanId);
    const baris = await selesaikanBaris(tx, akar.daftarBaris);
    const nomorCetak = await nomorCetakDokumen(tx, nomorCetakManual, { perusahaanId: akar.perusahaanId, jenis: "penawaran", tanggal });
    const penawaran = await tulisBernomor(nomorCetak, () =>
      tx.penawaranPenjualan.create({
        data: {
          nomor,
          tanggal,
          ...dataKepalaAkar(akar),
          ...teks,
          nilaiAddOn,
          berlakuSampai,
          kopSuratId,
          leadId,
          nomorCetak,
          // Penawaran belum ikut alur persetujuan (tidak menghasilkan jurnal); lihat DOKUMENTASI-PERSETUJUAN-KURS-BACKUP.md
          ...dataLangsungDisetujui(pengguna),
          baris: { create: dataBarisDokumen(baris) },
          rencanaTermin: { create: dataButirTermin(akar.rencana, akar.perusahaanId) },
        },
        select: { id: true },
      }),
    );
    if (leadId) await catatAktivitasLead(tx, { leadId, jenis: "PENAWARAN_DIBUAT", meta: { penawaranId: penawaran.id, nomor }, pengguna });
  });

  revalidatePath("/penjualan/penawaran");
  // detail lead bila halaman CRM sudah ada (P32 mengisi tautanLeadNotifikasi), bila belum daftar penawaran
  const tautanLead = leadId ? tautanLeadNotifikasi(leadId) : null;
  if (tautanLead) revalidatePath(tautanLead);
  redirect(tautanLead ?? "/penjualan/penawaran");
}

export async function konversiPenawaranKePesanan(penawaranId: string) {
  const pengguna = await wajibHakAksi("pesanan.buat");
  // pemeriksaan awal saja; isi yang disalin dibaca ulang di dalam transaksi sesudah klaim (perbaikan P25)
  const penawaran = await db.penawaranPenjualan.findUniqueOrThrow({
    where: { id: penawaranId },
    select: { id: true, nomor: true, status: true, statusKomersial: true },
  });
  if (penawaran.status === "DIKONVERSI") throw new Error("Penawaran sudah dikonversi");
  if (penawaran.statusKomersial === "DITOLAK" || penawaran.statusKomersial === "KEDALUWARSA") {
    throw new Error(`Penawaran ${penawaran.nomor} berstatus ${LABEL_STATUS_KOMERSIAL[penawaran.statusKomersial]}; ubah statusnya dulu bila klien jadi setuju`);
  }

  const nomor = await nomorDokumenBerikutnya(db.pesananPenjualan, "PSJ");

  await db.$transaction(async (tx) => {
    // klaim penawaran lebih dulu, supaya dua konversi bersamaan tidak sama-sama lolos; status komersial ikut disyaratkan
    // supaya penawaran yang baru saja ditolak atau kedaluwarsa tidak ikut dikonversi (tinjauan P23 R5)
    const { count } = await tx.penawaranPenjualan.updateMany({
      where: { id: penawaran.id, status: { not: "DIKONVERSI" }, statusKomersial: { notIn: ["DITOLAK", "KEDALUWARSA"] } },
      data: { status: "DIKONVERSI", statusKomersial: "DITERIMA", statusKomersialPada: new Date() },
    });
    if (count !== 1) {
      const kini = await tx.penawaranPenjualan.findUnique({ where: { id: penawaran.id }, select: { status: true, statusKomersial: true } });
      if (kini && kini.status !== "DIKONVERSI" && (kini.statusKomersial === "DITOLAK" || kini.statusKomersial === "KEDALUWARSA")) {
        throw new Error(`Penawaran ${penawaran.nomor} berstatus ${LABEL_STATUS_KOMERSIAL[kini.statusKomersial]}; ubah statusnya dulu bila klien jadi setuju`);
      }
      throw new Error("Penawaran sudah dikonversi");
    }
    // klaim sudah memegang kunci baris penawaran, jadi ubahPenawaran yang selesai sebelum klaim sudah terlihat di sini
    // dan ubahPenawaran sesudahnya ditolak (penawaran tidak lagi DRAF). Kepala, baris, dan rencana termin dibaca di
    // sini, bukan dari bacaan di luar transaksi (perbaikan P25).
    const isi = await tx.penawaranPenjualan.findUniqueOrThrow({
      where: { id: penawaran.id },
      include: { baris: { orderBy: [{ urutan: "asc" }, { id: "asc" }] }, rencanaTermin: true },
    });
    // pesanan mewarisi perusahaan penawaran (dokumen anak, D1 §3.3), juga bila perusahaannya sudah diarsipkan
    await tx.pesananPenjualan.create({
      data: {
        nomor,
        penawaranId: isi.id,
        ...salinKolom(isi, KOLOM_SALIN_PENAWARAN_KE_PESANAN),
        ...dataLangsungDisetujui(pengguna),
        baris: { create: isi.baris.map((l) => salinKolom(l, KOLOM_SALIN_BARIS)) },
        rencanaTermin: { create: salinButirKePesanan(isi.rencanaTermin) },
      },
    });
  });

  revalidatePath("/penjualan/penawaran");
  revalidatePath("/penjualan/pesanan");
  redirect("/penjualan/pesanan");
}

// ---------- Pesanan Penjualan ----------

export async function buatPesanan(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("pesanan.buat");
  const akar = await bacaDokumenAkar(pengguna, dataFormulir, "pesanan");
  const teks = bacaTeksDokumen(dataFormulir, KOLOM_TEKS_PESANAN);
  const nomor = await nomorDokumenBerikutnya(db.pesananPenjualan, "PSJ");

  const pesanan = await db.$transaction(async (tx) => {
    const kopSuratId = await pastikanKopSuratDokumen(tx, akar.kopSuratId, akar.perusahaanId);
    const baris = await selesaikanBaris(tx, akar.daftarBaris);
    return tx.pesananPenjualan.create({
      data: {
        nomor,
        ...dataKepalaAkar(akar),
        ...teks,
        kopSuratId,
        ...dataLangsungDisetujui(pengguna),
        baris: { create: dataBarisPesanan(baris) },
        rencanaTermin: { create: dataButirTermin(akar.rencana, akar.perusahaanId) },
      },
      select: { id: true },
    });
  });

  revalidatePath("/penjualan/pesanan");
  // Jalan pintas "Simpan & Buat Faktur": pesanan tetap tercatat (kontrak), langsung ke komposer faktur pesanan ini
  if (String(dataFormulir.get("lanjut") ?? "") === "faktur") redirect(`/penjualan/faktur/baru?pesananId=${pesanan.id}`);
  redirect("/penjualan/pesanan");
}

// ---------- Pengiriman Pesanan ----------

export async function buatPengiriman(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("pengiriman.buat");
  const pesananId = String(dataFormulir.get("pesananId") ?? "");
  const gudangId = String(dataFormulir.get("gudangId") ?? "");
  if (!pesananId) throw new Error("Pesanan wajib dipilih");
  if (!gudangId) throw new Error("Gudang wajib dipilih");

  const daftarBaris = bacaBarisJumlah<{ barisPesananId: string; barangId: string; jumlah: string | number }>(
    dataFormulir,
    "Minimal 1 baris barang wajib dikirim",
  );

  const pesanan = await db.pesananPenjualan.findUniqueOrThrow({ where: { id: pesananId }, include: { baris: true } });

  // tidak boleh mengirim lebih dari sisa pesanan; barang harus sama dengan baris pesanannya (pola TB, tinjauan P13)
  for (const l of daftarBaris) {
    const barisPesanan = pesanan.baris.find((ol) => ol.id === l.barisPesananId);
    if (!barisPesanan) throw new Error("Baris pesanan tidak ditemukan");
    if (barisPesanan.barangId !== l.barangId) throw new Error("Barang tidak sesuai baris pesanan");
    const sisa = D(barisPesanan.jumlah).minus(barisPesanan.jumlahTerkirim);
    if (l.jumlah.gt(sisa)) {
      throw new Error(`Kuantitas kirim melebihi sisa pesanan (sisa ${format(sisa)}, diminta ${format(l.jumlah)})`);
    }
  }
  // dokumen anak mewarisi perusahaan pesanan; gudang harus milik perusahaan itu atau bersama
  const perusahaanId = perusahaanDariInduk(pesanan, dataFormulir);
  await pastikanGudangMilik(db, [gudangId], perusahaanId);

  const nomor = await nomorDokumenBerikutnya(db.pengirimanPesanan, "SJ");

  await db.$transaction(async (tx) => {
    const [daftarLabel, daftarJenis] = await Promise.all([labelBarang(tx, daftarBaris.map((l) => l.barangId)), jenisBarang(tx, daftarBaris.map((l) => l.barangId))]);

    // Kunci dulu (stok lalu baris pesanan, urut id), baru baris pesanan dibaca ulang dan surat jalan ditulis (tinjauan
    // perbaikan P27 S1). Faktur atau surat jalan lain atas baris yang sama yang selesai lebih dulu ikut terhitung: sisa
    // kirim diperiksa ulang, dan porsi "sudah difaktur" dihitung dari jumlahDifaktur yang segar.
    await kunciStokUrut(tx, daftarBaris.filter((l) => daftarJenis.get(l.barangId) === "BARANG").map((l) => ({ barangId: l.barangId, gudangId })));
    await kunciBarisPesananPenjualan(tx, pesananId, daftarBaris.map((l) => l.barisPesananId));
    const [segar, daftarBarang] = await Promise.all([
      tx.barisPesananPenjualan.findMany({ where: { pesananId, id: { in: daftarBaris.map((l) => l.barisPesananId) } }, select: { id: true, jumlah: true, jumlahTerkirim: true, jumlahDifaktur: true } }),
      // harga pokok rata-rata dibaca sesudah kunci stok, jadi sama dengan nilai saat stok dikurangi
      tx.barang.findMany({ where: { id: { in: daftarBaris.map((l) => l.barangId) } }, select: { id: true, hargaBeli: true } }),
    ]);
    const hargaPokokBarang = new Map(daftarBarang.map((b) => [b.id, D(b.hargaBeli)]));
    const terkirim = new Map(segar.map((b) => [b.id, D(b.jumlahTerkirim)]));

    // nilai barang keluar = harga pokok rata-rata saat ini; porsi yang sudah difaktur lebih dulu langsung jadi HPP
    const barisNilai = daftarBaris.map((l) => {
      const bp = segar.find((ol) => ol.id === l.barisPesananId);
      if (!bp) throw new Error("Baris pesanan tidak ditemukan");
      const sudahTerkirim = terkirim.get(bp.id)!;
      const sisa = D(bp.jumlah).minus(sudahTerkirim);
      if (l.jumlah.gt(sisa)) throw new Error(`Kuantitas kirim melebihi sisa pesanan (sisa ${format(terbesar(sisa, NOL))}, diminta ${format(l.jumlah)})`);
      terkirim.set(bp.id, sudahTerkirim.plus(l.jumlah));
      const adalahBarang = daftarJenis.get(l.barangId) === "BARANG";
      const belumTerkirimTapiDifaktur = D(bp.jumlahDifaktur).minus(sudahTerkirim);
      const sudahDifaktur = adalahBarang ? terbesar(terkecil(l.jumlah, belumTerkirimTapiDifaktur), NOL) : NOL;
      return { ...l, hargaPokok: adalahBarang ? (hargaPokokBarang.get(l.barangId) ?? NOL) : NOL, sudahDifaktur };
    });

    const pengiriman = await tx.pengirimanPesanan.create({
      data: {
        nomor,
        // tanggal diambil sesudah kunci, jadi faktur yang selesai lebih dulu selalu bertanggal lebih awal dari surat jalan
        // ini (pemeriksaan "surat jalan sesudah faktur" di hapus faktur, tinjauan perbaikan P27 S2)
        tanggal: new Date(),
        perusahaanId,
        pesananId,
        gudangId,
        status: "DIPROSES",
        ...dataLangsungDisetujui(pengguna),
        baris: {
          create: barisNilai.map((l) => ({
            barisPesananId: l.barisPesananId,
            barangId: l.barangId,
            jumlah: l.jumlah,
            hargaPokok: l.hargaPokok,
            jumlahDifaktur: l.sudahDifaktur,
          })),
        },
      },
    });

    for (const baris of barisNilai) {
      // JASA tidak punya stok: surat jalan hanya mencatat bahwa jasanya sudah diserahkan
      if (daftarJenis.get(baris.barangId) === "BARANG") {
        await kurangiStok(tx, baris.barangId, gudangId, baris.jumlah, daftarLabel.get(baris.barangId) ?? baris.barangId);
      }
      await tx.barisPesananPenjualan.update({ where: { id: baris.barisPesananId }, data: { jumlahTerkirim: { increment: baris.jumlah } } });
    }

    const jurnal = await catatJurnalPengiriman(tx, pengiriman, barisNilai);
    if (jurnal) await tx.pengirimanPesanan.update({ where: { id: pengiriman.id }, data: { jurnalId: jurnal.id } });
    await tandaiProyek(tx, jurnal, pesanan.proyekId);

    const barisTerbaru = await tx.barisPesananPenjualan.findMany({ where: { pesananId } });
    const terkirimSemua = barisTerbaru.every((l) => D(l.jumlahTerkirim).gte(l.jumlah));
    await tx.pesananPenjualan.update({ where: { id: pesananId }, data: { status: terkirimSemua ? "DIPROSES" : "SEBAGIAN" } });
  });

  revalidatePath("/penjualan/pesanan");
  revalidatePath("/penjualan/pengiriman");
  redirect("/penjualan/pengiriman");
}

// ---------- Faktur Penjualan ----------

/**
 * Jalur lama di dalam transaksi (tinjauan P25 R6 dan T1): pembagian diulang dari baris pesanan dan baris SJ yang dibaca
 * sesudah semua baris pesanan dikunci (buatFaktur), jadi faktur lain yang selesai lebih dulu ikut terhitung dan kiriman
 * yang masih muat di baris lain tetap lolos seperti kode lama. Subtotal di luar transaksi sudah dipakai untuk diskon,
 * fee, dan PPN; bila pembagian baru memberi subtotal lain (pembulatan nilai per potongan), kiriman ditolak supaya angka
 * faktur tidak bergeser diam-diam.
 */
function bagiUlangJalurLama(
  pesanan: { mode: ModeDokumen; baris: Parameters<typeof siapkanBarisJalurLama>[0]["baris"] },
  masukan: Parameters<typeof siapkanBarisJalurLama>[1],
  terkirim: Parameters<typeof siapkanBarisJalurLama>[2],
  subtotal: Desimal,
) {
  const hasil = siapkanBarisJalurLama(pesanan, masukan, terkirim);
  if (!subtotalBaris(hasil).equals(subtotal)) throw new Error(PESAN_SISA_BERUBAH);
  return hasil;
}

const PESAN_SISA_BERUBAH = "Sisa pesanan berubah saat faktur disimpan; muat ulang halaman lalu coba lagi";

/** Satu baris SJ yang dikonsumsi satu baris faktur (ditulis ke KonsumsiSuratJalan). */
type Konsumsi = { barisPengirimanId: string; jumlah: Desimal; nilaiTransit: Desimal };

/**
 * Konsumsi baris SJ urut tanggal SJ lalu id sampai `butuh` habis. Baris SJ sudah dikunci (kunciBarisSuratJalanPesanan),
 * jadi sisa yang dibaca di sini tidak bisa diambil faktur lain sebelum transaksi ini selesai (tinjauan P27 S1).
 * Mengembalikan jumlah yang belum terpenuhi.
 */
async function konsumsiSj(tx: KlienTransaksi, where: Prisma.BarisPengirimanWhereInput, butuh: Desimal, catatan: Konsumsi[]) {
  const barisSj = await tx.barisPengiriman.findMany({ where, orderBy: [{ pengiriman: { tanggal: "asc" } }, { id: "asc" }] });
  for (const sj of barisSj) {
    if (butuh.lte(0)) break;
    const sisa = D(sj.jumlah).minus(sj.jumlahDifaktur);
    if (sisa.lte(0)) continue;
    const ambil = terkecil(sisa, butuh);
    await tx.barisPengiriman.update({ where: { id: sj.id }, data: { jumlahDifaktur: { increment: ambil } } });
    catatan.push({ barisPengirimanId: sj.id, jumlah: ambil, nilaiTransit: kali(ambil, D(sj.hargaPokok)) });
    butuh = butuh.minus(ambil);
  }
  return butuh;
}

/**
 * Baris SJ "yatim": barang terkirim yang belum difaktur, padahal baris pesanannya sudah penuh ditagih. Ini terjadi pada
 * data dari kode lama, yang menaikkan jumlahDifaktur di baris pesanan pertama tetapi mengonsumsi SJ per barang. Baris
 * itu tidak akan pernah mengonsumsinya sendiri, jadi potongan faktur berbarang sama yang kekurangan SJ mengambilnya
 * lintas baris (urut tanggal SJ), supaya HPP per barang sama dengan kode lama dan transit tidak tertahan selamanya
 * (tinjauan P25 T1). Data yang dibuat kode baru tidak punya SJ yatim, jadi hasilnya sama dengan konsumsi per baris.
 * Konsumsinya ikut tercatat di KonsumsiSuratJalan, jadi hapus faktur membalik baris SJ yang persis sama (tinjauan P27 T1).
 */
async function konsumsiSjYatim(
  tx: KlienTransaksi,
  pesananId: string,
  barisFaktur: readonly { barangId: string; barisPesananId: string | null }[],
  kurangSj: Desimal[],
  konsumsi: Konsumsi[][],
) {
  if (!kurangSj.some((k) => k.gt(0))) return;
  const penuh = new Set(
    (await tx.barisPesananPenjualan.findMany({ where: { pesananId }, select: { id: true, jumlah: true, jumlahDifaktur: true } }))
      .filter((b) => D(b.jumlahDifaktur).gte(D(b.jumlah)))
      .map((b) => b.id),
  );
  if (penuh.size === 0) return;
  for (const [i, l] of barisFaktur.entries()) {
    if (kurangSj[i].lte(0)) continue;
    const lain = [...penuh].filter((id) => id !== l.barisPesananId);
    kurangSj[i] = await konsumsiSj(tx, { barangId: l.barangId, barisPesananId: { in: lain }, pengiriman: { pesananId } }, kurangSj[i], konsumsi[i]);
  }
}

export async function buatFaktur(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("faktur.buat");
  const pesananId = String(dataFormulir.get("pesananId") ?? "");
  const pengirimanId = String(dataFormulir.get("pengirimanId") ?? "") || null;
  if (!pesananId) throw new Error("Pesanan wajib dipilih");
  // jalur ID (komposer, baris per barisPesananId) atau jalur lama ({ barangId, jumlah, harga }), D2 §3.5
  const masukan = bacaBarisFaktur(dataFormulir);
  // catatan A D1 §3.3: pengaturan pajak perusahaan pesanan dibaca di posisi lama supaya urutan pesan galat tetap;
  // pesanan yang tidak ada memakai utama sementara, lalu findUniqueOrThrow di bawah melempar galat lama
  const indukPerusahaan = await db.pesananPenjualan.findUnique({ where: { id: pesananId }, select: { perusahaanId: true } });
  const pengaturan = await ambilPengaturanPerusahaan(db, indukPerusahaan?.perusahaanId ?? PERUSAHAAN_UTAMA);
  const ppnPersen = bacaTarifPpn(dataFormulir.get("ppnPersen"), pengaturan);

  const pesanan = await db.pesananPenjualan.findUniqueOrThrow({
    where: { id: pesananId },
    include: { baris: { orderBy: [{ urutan: "asc" }, { id: "asc" }] }, uangMuka: true, faktur: { select: { fee: true, diskon: true } } },
  });
  const perusahaanId = perusahaanDariInduk(pesanan, dataFormulir);
  // surat jalan rujukan (opsional) harus milik pesanan ini, jadi otomatis milik perusahaan yang sama (tinjauan P23 R4)
  if (pengirimanId) {
    const sj = await db.pengirimanPesanan.findUnique({ where: { id: pengirimanId }, select: { pesananId: true } });
    if (!sj || sj.pesananId !== pesananId) throw new Error("Surat jalan tidak ditemukan di pesanan ini");
  }
  // harga, frekuensi, dan teks baris dari pesanan (jalur ID); jalur lama memeriksa sisa per barang seperti kode lama dan
  // mendahulukan baris pesanan yang barangnya sudah dikirim (tinjauan P25 T1)
  const daftarBaris = siapkanBarisFaktur(pesanan, masukan, masukan.jalur === "LAMA" ? await bacaTerkirimBelumDifaktur(db, pesananId) : undefined);
  const subtotal = subtotalBaris(daftarBaris);
  const ctx = konteksProrata(pesanan, daftarBaris);
  // Diskon faktur: kontra-pendapatan; DPP PPN = subtotal − diskon + fee (UU PPN Pasal 1 angka 18), omzet PPh Final tetap bruto
  const { jenisDiskon, nilaiDiskon, diskon } = bacaDiskonFaktur(dataFormulir, subtotal, pesanan, ctx);
  const fee = feeFaktur(pesanan, subtotal, diskon, ctx);
  pastikanFeeTidakNegatif(fee);
  const { dpp, ppn, total } = ringkasanFaktur({ subtotal, diskon, fee, ppnPersen });
  const uangMukaMentah = dataFormulir.get("uangMuka");
  const uangMuka = typeof uangMukaMentah === "string" && uangMukaMentah.trim() !== "" ? bacaUang(uangMukaMentah, "Uang muka dipakai", { allowZero: true }) : NOL;
  const uangMukaTersedia = jumlahkan(pesanan.uangMuka.map((u) => D(u.jumlah).minus(u.jumlahDipakai)));
  if (uangMuka.gt(uangMukaTersedia)) throw new Error(`Uang muka yang dipakai melebihi sisa uang muka pesanan (tersedia ${format(uangMukaTersedia)})`);
  if (uangMuka.gt(total)) throw new Error(`Uang muka yang dipakai melebihi total faktur (${format(total)})`);

  // Mata uang transaksi: pilihan formulir, kalau kosong mengikuti mata uang bawaan pelanggan.
  // Kolom uang faktur (total/dpp/ppn/diskon) SELALU rupiah; `nilaiAsli` menyimpan total dalam mata uang dokumen.
  const pelanggan = await db.pelanggan.findUniqueOrThrow({ where: { id: pesanan.pelangganId }, select: { mataUangId: true } });
  const { mataUangId, kurs } = await bacaMataUangDokumen(db, dataFormulir, pelanggan.mataUangId, new Date());
  const nilaiAsli = mataUangId ? nilaiDalamMataUang(total, kurs) : null;

  // teks surat, kop, dan kolom event diwarisi pesanan; kunci teks yang ada di formulir menimpa warisan (D2 §3.5)
  const pengaturanDokumen = await db.pengaturanDokumenPenjualan.findUnique({ where: { perusahaanId }, select: { syaratPembayaran: true } });
  const teks = bacaTeksDokumen(dataFormulir, KOLOM_TEKS_FAKTUR, { warisan: pesanan, bawaanSyarat: pengaturanDokumen?.syaratPembayaran ?? null });
  // jatuh tempo isian diperiksa di posisi lama (urutan pesan galat tetap); tanggal faktur dan jatuh tempo yang disimpan
  // dihitung ulang di dalam transaksi sesudah kunci baris pesanan
  bacaJatuhTempo(dataFormulir, pengaturan.terminHari, new Date());
  const kopDariFormulir = dataFormulir.has("kopSuratId");
  const kopSuratIdIsian = kopDariFormulir ? kopIsian(dataFormulir) : pesanan.kopSuratId;
  const nomorCetakManual = await bacaNomorCetakIsian(dataFormulir, "faktur", perusahaanId);

  // Alur persetujuan: kalau dinyalakan, faktur lahir sebagai DRAFT dan jurnalnya baru dicatat saat disetujui
  const perluPersetujuan = await persetujuanWajib(db);
  const nomor = await nomorDokumenBerikutnya(db.fakturPenjualan, "FJ");

  await db.$transaction(async (tx) => {
    // kop isian harus milik perusahaan dokumen; kop warisan pesanan yang sudah dihapus dilepas saja
    const kopSuratId = kopDariFormulir
      ? await pastikanKopSuratDokumen(tx, kopSuratIdIsian, perusahaanId)
      : await pastikanKopSuratDokumen(tx, kopSuratIdIsian, perusahaanId).catch(() => null);
    const daftarJenis = await jenisBarang(tx, daftarBaris.map((l) => l.barangId));
    // Semua baris pesanan dikunci urut id lalu dibaca ulang (tinjauan P25 R6, P27 R1 dan R2). Faktur
    // serentak atas pesanan yang sama berjalan bergiliran, jadi pembagian jalur lama dan konteks prorata dihitung dari
    // keadaan sesudah faktur sebelumnya selesai.
    await kunciBarisPesananPenjualan(tx, pesananId);
    // Tanggal faktur diambil sesudah kunci, seperti surat jalan (tinjauan perbaikan P27 tahap 2 T3): urutan tanggal faktur
    // dan surat jalan satu pesanan sama dengan urutan commit, jadi pemeriksaan "lebih baru" dan "SJ sesudah faktur" di
    // hapus tidak bisa saling menahan. Jatuh tempo bawaan dihitung dari tanggal ini.
    const tanggal = new Date();
    const jatuhTempo = bacaJatuhTempo(dataFormulir, pengaturan.terminHari, tanggal);
    const segar = await tx.pesananPenjualan.findUniqueOrThrow({
      where: { id: pesananId },
      select: { baris: { orderBy: [{ urutan: "asc" }, { id: "asc" }] }, faktur: { select: { fee: true, diskon: true } } },
    });
    const barisFaktur =
      masukan.jalur === "LAMA" ? bagiUlangJalurLama({ mode: pesanan.mode, baris: segar.baris }, masukan.baris, await bacaTerkirimBelumDifaktur(tx, pesananId), subtotal) : daftarBaris;
    const ctxSegar = konteksProrata(segar, barisFaktur);
    // kedua jalur: faktur lain yang dibuat bersamaan tidak boleh membuat baris pesanan tertagih melebihi jumlahnya
    // (tinjauan P23 R1); kiriman sah tidak pernah memicunya karena sisa sudah diperiksa sebelum transaksi. Diperiksa
    // dari baris yang dibaca sesudah kunci SEBELUM ditulis, supaya pesan ini yang muncul, bukan pelanggaran CHECK
    // jumlahDifaktur <= jumlah (tinjauan perbaikan P27 S2).
    const difaktur = new Map(segar.baris.map((b) => [b.id, D(b.jumlahDifaktur)]));
    for (const l of barisFaktur) {
      const bp = segar.baris.find((b) => b.id === l.barisPesananId);
      if (!bp) throw new Error("Baris pesanan tidak ditemukan");
      const sebelum = difaktur.get(bp.id)!;
      if (sebelum.plus(l.jumlah).gt(bp.jumlah)) {
        const sisa = D(bp.jumlah).minus(sebelum);
        throw new Error(`Kuantitas faktur melebihi sisa yang belum ditagih (sisa ${format(terbesar(sisa, NOL))}, diminta ${format(l.jumlah)})`);
      }
      difaktur.set(bp.id, sebelum.plus(l.jumlah));
      await tx.barisPesananPenjualan.update({ where: { id: bp.id }, data: { jumlahDifaktur: { increment: l.jumlah } } });
    }
    // Diskon dan fee warisan (prorata, faktur penutup mengambil sisa) dihitung ulang dari baris dan faktur yang dibaca
    // sesudah kunci. Bila berbeda dengan hitungan di luar transaksi (faktur lain selesai lebih dulu, mis. faktur ini
    // ternyata menutup pesanan), tolak supaya angka faktur tidak bergeser diam-diam (tinjauan P27 R2).
    const diskonSegar = bacaDiskonFaktur(dataFormulir, subtotal, pesanan, ctxSegar).diskon;
    if (!diskonSegar.equals(diskon) || !feeFaktur(pesanan, subtotal, diskonSegar, ctxSegar).equals(fee)) throw new Error(PESAN_SISA_BERUBAH);

    // HPP diakui untuk barang yang sudah dikirim: konsumsi baris SJ baris pesanan ini (urut tanggal) yang belum difaktur.
    // Konsumsinya terjadi SEKARANG (saat draf) karena baris surat jalan tidak boleh dipakai dua faktur; nilainya disimpan
    // per baris faktur supaya jurnal HPP bisa dicatat belakangan saat faktur disetujui, dan setiap baris SJ yang dipakai
    // dicatat di KonsumsiSuratJalan supaya hapus faktur membaliknya persis (tinjauan P27 T1, S2). Baris SJ barang ini
    // dikunci dulu, urut id, sesudah kunci baris pesanan (tinjauan P27 S1).
    // Jalur lama: jumlah per barang sudah dibagi ke baris pesanannya (siapkanBarisJalurLama), jadi selalu per id.
    await kunciBarisSuratJalanPesanan(tx, pesananId, barisFaktur.filter((l) => daftarJenis.get(l.barangId) === "BARANG").map((l) => l.barangId));
    const konsumsi: Konsumsi[][] = barisFaktur.map(() => []);
    const kurangSj = barisFaktur.map(() => NOL);
    for (const [i, l] of barisFaktur.entries()) {
      if (daftarJenis.get(l.barangId) !== "BARANG") continue;
      kurangSj[i] = await konsumsiSj(tx, { barisPesananId: l.barisPesananId!, pengiriman: { pesananId } }, l.jumlah, konsumsi[i]);
    }
    await konsumsiSjYatim(tx, pesananId, barisFaktur, kurangSj, konsumsi);
    const nilaiTransit = konsumsi.map((k) => jumlahkan(k.map((x) => x.nilaiTransit)));

    const faktur = await tulisBernomor(nomorCetakManual, () =>
      tx.fakturPenjualan.create({
        data: {
          nomor,
          tanggal,
          perusahaanId,
          pelangganId: pesanan.pelangganId,
          pesananId,
          pengirimanId,
          total,
          diskon,
          dpp,
          ppnPersen,
          ppn,
          uangMuka,
          mataUangId,
          kurs,
          nilaiAsli,
          status: statusFaktur(total, uangMuka, NOL),
          jatuhTempo,
          ...salinKolom(pesanan, KOLOM_WARISAN_FAKTUR),
          jenisDiskon,
          nilaiDiskon,
          fee,
          ...teks,
          kopSuratId,
          nomorCetak: nomorCetakManual,
          ...(perluPersetujuan ? { statusPersetujuan: "DRAFT" } : dataLangsungDisetujui(pengguna)),
          konsumsiSjTercatat: true,
          baris: { create: dataBarisFaktur(barisFaktur, nilaiTransit).map((b, i) => ({ ...b, konsumsiSj: { create: konsumsi[i] } })) },
        },
      }),
    );

    // Uang muka pesanan dipakai urut tanggal (FIFO); dibaca ulang di dalam transaksi supaya dua faktur bersamaan tidak memakai DP yang sama
    let sisaUangMuka = uangMuka;
    if (sisaUangMuka.gt(0)) {
      const daftarUm = await tx.uangMukaPelanggan.findMany({ where: { pesananId }, orderBy: { tanggal: "asc" } });
      for (const um of daftarUm) {
        if (sisaUangMuka.lte(0)) break;
        const bisa = terkecil(D(um.jumlah).minus(um.jumlahDipakai), sisaUangMuka);
        if (bisa.lte(0)) continue;
        await tx.uangMukaPelanggan.update({ where: { id: um.id }, data: { jumlahDipakai: { increment: bisa } } });
        await tx.pemakaianUangMuka.create({ data: { uangMukaId: um.id, fakturId: faktur.id, jumlah: bisa } });
        sisaUangMuka = sisaUangMuka.minus(bisa);
      }
      if (sisaUangMuka.gt(0)) throw new Error("Sisa uang muka pesanan berubah; muat ulang halaman lalu coba lagi");
    }

    if (perluPersetujuan) return; // jurnal dan nomor cetak otomatis dicatat saat faktur disetujui (src/lib/persetujuan.ts)

    // Nomor cetak faktur dialokasikan saat jurnalnya dicatat (D2 §3.7). Jalur langsung: sekarang, sebelum jurnal; hanya
    // ditulis bila faktur belum bernomor (nomor manual tidak pernah ditimpa).
    if (!nomorCetakManual) {
      const nomorCetak = await alokasiNomorCetak(tx, { perusahaanId, jenis: "faktur", tanggal: faktur.tanggal });
      if (nomorCetak) {
        const { count } = await simpanNomorCetak(nomorCetak, () => tx.fakturPenjualan.updateMany({ where: { id: faktur.id, nomorCetak: null }, data: { nomorCetak } }));
        if (count !== 1) throw new Error(`Faktur Penjualan ${faktur.nomor} sudah diproses orang lain. Muat ulang halaman lalu periksa statusnya`);
      }
    }

    const jurnal = await catatJurnalFakturPenjualan(
      tx,
      faktur,
      barisFaktur,
      pengaturan.akunPpnKeluaranId,
      barisFaktur.map((l, i) => ({ barangId: l.barangId, nilai: nilaiTransit[i] })).filter((k) => k.nilai.gt(0)),
      { asli: mataUangId ? { mataUangId, kurs } : null },
    );
    if (jurnal) await tx.fakturPenjualan.update({ where: { id: faktur.id }, data: { jurnalId: jurnal.id } });
    await tandaiProyek(tx, jurnal, pesanan.proyekId);
  });

  revalidatePath("/penjualan/faktur");
  if (perluPersetujuan) revalidatePath("/persetujuan");
  redirect("/penjualan/faktur");
}

// ---------- Penerimaan Penjualan ----------

export async function buatPenerimaan(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("penerimaan.buat");
  const fakturId = String(dataFormulir.get("fakturId") ?? "");
  const akunId = String(dataFormulir.get("akunId") ?? "");
  const metodeBayar = String(dataFormulir.get("metodeBayar") ?? "TUNAI");
  if (!fakturId) throw new Error("Faktur wajib dipilih");
  if (!akunId) throw new Error("Akun Kas/Bank penerima wajib dipilih");
  const jumlah = bacaUang(dataFormulir.get("jumlah"), "Jumlah bayar");
  const potonganMentah = dataFormulir.get("potonganPajak");
  const potonganPajak = typeof potonganMentah === "string" && potonganMentah.trim() !== "" ? bacaUang(potonganMentah, "Potongan PPh 23", { allowZero: true }) : D(0);
  // catatan A D1 §3.3: akun PPh 23 dibayar dimuka dari pengaturan perusahaan faktur, di posisi pemeriksaan lama
  const indukPerusahaan = await db.fakturPenjualan.findUnique({ where: { id: fakturId }, select: { perusahaanId: true } });
  const pengaturan = await ambilPengaturanPerusahaan(db, indukPerusahaan?.perusahaanId ?? PERUSAHAAN_UTAMA);
  if (potonganPajak.gt(0) && !pengaturan.akunPph23DimukaId) throw new Error(pesanAkunPajakBelumDiatur("Akun Pajak Dibayar Dimuka (PPh 23)", pengaturan.nama));

  const faktur = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fakturId }, include: { penerimaan: true, retur: true, pesanan: { select: { proyekId: true } } } });
  if (faktur.status === "LUNAS") throw new Error("Faktur ini sudah lunas");
  // dokumen anak mewarisi perusahaan faktur; akun kas harus milik perusahaan itu atau bersama
  const perusahaanId = perusahaanDariInduk(faktur, dataFormulir);
  await pastikanAkunMilik(db, [akunId], perusahaanId);

  const sudahDibayar = jumlahkan(faktur.penerimaan.map((r) => D(r.jumlah).plus(r.potonganPajak)));
  const sudahDiretur = jumlahkan(faktur.retur.map((r) => r.total));
  const sisa = D(faktur.total).minus(faktur.uangMuka).minus(sudahDibayar).minus(sudahDiretur);
  const bayarBruto = jumlah.plus(potonganPajak);
  if (bayarBruto.gt(sisa)) {
    throw new Error(`Jumlah bayar + potongan pajak melebihi sisa tagihan (sisa ${format(sisa)})`);
  }
  const status = statusFaktur(D(faktur.total), D(faktur.uangMuka).plus(sudahDibayar).plus(bayarBruto), sudahDiretur);
  // kuitansi (D2 §3.1): judul, terima dari, keperluan, catatan, kop, nomor cetak
  const teks = bacaTeksDokumen(dataFormulir, KOLOM_TEKS_PENERIMAAN);
  const kopSuratIdIsian = kopIsian(dataFormulir);
  const nomorCetakManual = await bacaNomorCetakIsian(dataFormulir, "kwitansi", perusahaanId);
  const tanggal = new Date();

  const nomor = await nomorDokumenBerikutnya(db.penerimaanPenjualan, "TRM");

  await db.$transaction(async (tx) => {
    const kopSuratId = await pastikanKopSuratDokumen(tx, kopSuratIdIsian, perusahaanId);
    const nomorCetak = await nomorCetakDokumen(tx, nomorCetakManual, { perusahaanId, jenis: "kwitansi", tanggal });
    const penerimaan = await tulisBernomor(nomorCetak, () =>
      tx.penerimaanPenjualan.create({
        data: { nomor, tanggal, perusahaanId, pelangganId: faktur.pelangganId, fakturId, akunId, jumlah, potonganPajak, metodeBayar, ...teks, kopSuratId, nomorCetak, ...dataLangsungDisetujui(pengguna) },
      }),
    );
    await tx.fakturPenjualan.update({ where: { id: fakturId }, data: { status } });
    const jurnal = await catatJurnalPenerimaanPenjualan(tx, penerimaan, faktur.nomor, pengaturan.akunPph23DimukaId);
    if (jurnal) await tx.penerimaanPenjualan.update({ where: { id: penerimaan.id }, data: { jurnalId: jurnal.id } });
    await tandaiProyek(tx, jurnal, faktur.pesanan?.proyekId);
  });

  revalidatePath("/penjualan/penerimaan");
  revalidatePath("/penjualan/faktur");
  redirect("/penjualan/penerimaan");
}

// ---------- Retur Penjualan ----------

export async function buatRetur(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("retur-penjualan.buat");
  const fakturId = String(dataFormulir.get("fakturId") ?? "");
  const gudangId = String(dataFormulir.get("gudangId") ?? "");
  const alasan = String(dataFormulir.get("alasan") ?? "").trim();
  if (!fakturId) throw new Error("Faktur wajib dipilih");
  if (!gudangId) throw new Error("Gudang wajib dipilih");

  // jalur ID (baris per barisFakturId) atau jalur lama ({ barangId, jumlah }), D2 §3.6
  const masukan = bacaBarisRetur(dataFormulir, "Minimal 1 baris barang wajib diretur");

  const faktur = await db.fakturPenjualan.findUniqueOrThrow({
    where: { id: fakturId },
    include: { baris: { orderBy: [{ urutan: "asc" }, { id: "asc" }] }, retur: { include: { baris: true } }, penerimaan: true, pesanan: { select: { proyekId: true } } },
  });
  // dokumen anak mewarisi perusahaan faktur; gudang harus milik perusahaan itu atau bersama
  const perusahaanId = perusahaanDariInduk(faktur, dataFormulir);
  await pastikanGudangMilik(db, [gudangId], perusahaanId);

  // tidak boleh meretur lebih dari jumlah yang pernah difakturkan (dikurangi retur sebelumnya); harga dan frekuensi
  // dari baris faktur yang dicocokkan
  const returSebelumnya = faktur.retur.flatMap((r) => r.baris);
  const barisRetur = siapkanBarisRetur(faktur, returSebelumnya, masukan);
  // diskon dan management fee faktur ikut dibalik prorata nilai baris yang diretur, dibatasi sisa sesudah retur
  // sebelumnya; retur yang menutup semua baris mengambil sisanya (tinjauan P23 R3)
  const { diskon, fee, dpp, ppn, total } = nilaiRetur(faktur, barisRetur, { sebelumnya: faktur.retur, menutup: returMenutup(faktur, returSebelumnya, barisRetur) });
  pastikanFeeTidakNegatif(fee);
  const pengaturan = await ambilPengaturanPerusahaan(db, perusahaanId);
  const sudahDibayar = jumlahkan(faktur.penerimaan.map((r) => D(r.jumlah).plus(r.potonganPajak)));
  const sudahDiretur = jumlahkan(faktur.retur.map((r) => r.total));
  const status = statusFaktur(D(faktur.total), D(faktur.uangMuka).plus(sudahDibayar), sudahDiretur.plus(total));

  const nomor = await nomorDokumenBerikutnya(db.returPenjualan, "RJ");

  await db.$transaction(async (tx) => {
    const idBarang = barisRetur.map((l) => l.barangId);
    const [daftarJenis, daftarBarangRetur] = await Promise.all([
      jenisBarang(tx, idBarang),
      tx.barang.findMany({ where: { id: { in: idBarang } }, select: { id: true, hargaBeli: true } }),
    ]);
    const hargaPokokBarang = new Map(daftarBarangRetur.map((b) => [b.id, D(b.hargaBeli)]));
    const retur = await tx.returPenjualan.create({
      data: {
        nomor,
        perusahaanId,
        fakturId,
        gudangId,
        alasan: alasan || null,
        total,
        diskon,
        fee,
        dpp,
        ppn,
        ...dataLangsungDisetujui(pengguna),
        baris: {
          create: barisRetur.map((l) => ({
            barangId: l.barangId,
            jumlah: l.jumlah,
            hargaPokok: daftarJenis.get(l.barangId) === "BARANG" ? (hargaPokokBarang.get(l.barangId) ?? NOL) : NOL,
            barisFakturId: l.barisFakturId,
          })),
        },
      },
    });

    await kunciStokUrut(tx, barisRetur.filter((l) => daftarJenis.get(l.barangId) === "BARANG").map((l) => ({ barangId: l.barangId, gudangId, buatKosong: true })));
    for (const l of barisRetur) {
      if (daftarJenis.get(l.barangId) === "BARANG") await tambahStok(tx, l.barangId, gudangId, l.jumlah);
    }
    await tx.fakturPenjualan.update({ where: { id: fakturId }, data: { status } });

    // perusahaan dikirim eksplisit (G5), tidak dibaca ulang dari nomor retur
    const jurnal = await catatJurnalReturPenjualan(tx, { nomor: retur.nomor, total, ppn, diskon, fee, perusahaanId }, barisRetur, pengaturan.akunPpnKeluaranId);
    if (jurnal) await tx.returPenjualan.update({ where: { id: retur.id }, data: { jurnalId: jurnal.id } });
    await tandaiProyek(tx, jurnal, faktur.pesanan?.proyekId);
  });

  revalidatePath("/penjualan/retur");
  revalidatePath("/penjualan/faktur");
  redirect("/penjualan/retur");
}

// ---------- Uang Muka Pelanggan (DP pesanan) ----------

/** DP diterima di muka atas sebuah pesanan: Dr Kas/Bank / Cr Uang Muka Pelanggan; dipakai mengurangi piutang saat faktur dibuat. */
export async function buatUangMuka(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("uang-muka.buat");
  const pesananId = String(dataFormulir.get("pesananId") ?? "");
  const akunId = String(dataFormulir.get("akunId") ?? "");
  const metodeBayar = String(dataFormulir.get("metodeBayar") ?? "TRANSFER");
  const keterangan = String(dataFormulir.get("keterangan") ?? "").trim() || null;
  const rencanaTerminId = rapikanTeks(dataFormulir.get("rencanaTerminId"));
  if (!pesananId) throw new Error("Pesanan wajib dipilih");
  if (!akunId) throw new Error("Akun Kas/Bank penerima wajib dipilih");
  const jumlah = bacaUang(dataFormulir.get("jumlah"), "Jumlah uang muka");

  const pesanan = await db.pesananPenjualan.findUniqueOrThrow({ where: { id: pesananId }, include: { baris: true, uangMuka: true, rencanaTermin: { select: { id: true } } } });
  // dokumen anak mewarisi perusahaan pesanan; akun kas harus milik perusahaan itu atau bersama
  const perusahaanId = perusahaanDariInduk(pesanan, dataFormulir);
  await pastikanAkunMilik(db, [akunId], perusahaanId);
  if (pesanan.baris.every((b) => D(b.jumlahDifaktur).gte(b.jumlah))) throw new Error(`${pesanan.nomor} sudah difaktur seluruhnya; uang muka tidak lagi bisa ditambahkan`);
  // Batas wajar: seluruh DP ≤ nilai pesanan termasuk PPN. Pesanan bertermin memakai tarif PPN pesanan dan rumus bruto
  // termin (butir terakhir menutup sisa), supaya termin terakhir bisa dibayar penuh (KONTRAK-TAMBAHAN P23). Pesanan
  // tanpa termin memakai rumus lama dari pengaturan perusahaan pesanan.
  let nilaiBruto: Desimal;
  if (pesanan.rencanaTermin.length > 0) nilaiBruto = nilaiBrutoKontrak(pesanan.total, pesanan.ppnPersen);
  else {
    const pengaturan = await ambilPengaturanPerusahaan(db, perusahaanId);
    nilaiBruto = D(pesanan.total).plus(pengaturan.pkp ? hitungPpn(D(pesanan.total), pengaturan.tarifPpnPersen) : NOL);
  }
  const batas = nilaiBruto.minus(jumlahkan(pesanan.uangMuka.map((u) => u.jumlah)));
  if (jumlah.gt(batas)) throw new Error(`Uang muka melebihi nilai pesanan yang belum tertutup DP (maks ${format(terbesar(batas, NOL))})`);
  // kuitansi DP (D2 §3.1): judul, terima dari, keperluan, kop, nomor cetak
  const teks = bacaTeksDokumen(dataFormulir, KOLOM_TEKS_UANG_MUKA);
  const kopSuratIdIsian = kopIsian(dataFormulir);
  const nomorCetakManual = await bacaNomorCetakIsian(dataFormulir, "kwitansi-dp", perusahaanId);
  const tanggal = new Date();

  const nomor = await nomorDokumenBerikutnya(db.uangMukaPelanggan, "UM");
  await db.$transaction(async (tx) => {
    // pembayaran termin: butir milik pesanan ini, dikunci, dan Σ uang muka butir ≤ nilai butir termasuk PPN (D2 §3.8)
    if (rencanaTerminId) await pastikanPembayaranTermin(tx, { rencanaTerminId, pesananId, jumlah });
    const kopSuratId = await pastikanKopSuratDokumen(tx, kopSuratIdIsian, perusahaanId);
    const nomorCetak = await nomorCetakDokumen(tx, nomorCetakManual, { perusahaanId, jenis: "kwitansi-dp", tanggal });
    const uangMuka = await tulisBernomor(nomorCetak, () =>
      tx.uangMukaPelanggan.create({
        data: { nomor, tanggal, perusahaanId, pelangganId: pesanan.pelangganId, pesananId, akunId, jumlah, metodeBayar, keterangan, rencanaTerminId, ...teks, kopSuratId, nomorCetak, ...dataLangsungDisetujui(pengguna) },
      }),
    );
    const jurnal = await catatJurnalUangMuka(tx, uangMuka, pesanan.nomor);
    if (jurnal) await tx.uangMukaPelanggan.update({ where: { id: uangMuka.id }, data: { jurnalId: jurnal.id } });
    await tandaiProyek(tx, jurnal, pesanan.proyekId);
  });

  revalidatePath("/penjualan/uang-muka");
  revalidatePath("/penjualan/pesanan");
  redirect("/penjualan/uang-muka");
}

// ---------- Varian untuk <FormulirAksi> (mengembalikan pesan error, bukan throw) ----------

export async function buatPenawaranFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatPenawaran(dataFormulir));
}
// Dipakai lewat .bind(null, penawaranId); argumen (prevState, dataFormulir) dari useActionState sengaja diabaikan
export async function konversiPenawaranKePesananFormulir(penawaranId: string) {
  return jalankanFormulir(() => konversiPenawaranKePesanan(penawaranId));
}
export async function buatPesananFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatPesanan(dataFormulir));
}
export async function buatPengirimanFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatPengiriman(dataFormulir));
}
export async function buatFakturFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatFaktur(dataFormulir));
}
export async function buatPenerimaanFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatPenerimaan(dataFormulir));
}
export async function buatReturFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatRetur(dataFormulir));
}
export async function buatUangMukaFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatUangMuka(dataFormulir));
}
