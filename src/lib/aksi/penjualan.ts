"use server";

import { pastikanHak, wajibHakAksi } from "@/lib/otentikasi";
import { punyaHak, PERAN_TERTINGGI, type PenggunaSesi } from "@/lib/hakAkses";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { D, format, uang, kali, bacaUang, jumlahkan, terkecil, terbesar, type Desimal } from "@/lib/uang";
import { kurangiStok, tambahStok, labelBarang, jenisBarang } from "@/lib/stok";
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
  pastikanHakBarisBebas,
  pastikanKopSuratDokumen,
  rapikanTeks,
  ringkasanFaktur,
  salinKolom,
  siapkanBarisFaktur,
  siapkanBarisRetur,
  subtotalBaris,
  type BarisDokumen as BarisDokumenPenjualan,
} from "@/lib/dokumenPenjualan";
import { bacaRencanaTermin, dataButirTermin, nilaiBrutoKontrak, pastikanPembayaranTermin, periksaBrutoRencana, salinButirKePesanan, selesaikanRencana } from "@/lib/rencanaTermin";
import { alokasiNomorCetak, bacaNomorCetakManual, simpanNomorCetak, type JenisNomorCetak, type KlienTransaksi } from "@/lib/nomorCetak";
import { isiBarangLainLain, pastikanBarangLainLain } from "@/lib/barangLainLain";
import { catatAktivitasLead, pastikanLeadUntukPenawaran, tautanLeadNotifikasi } from "@/lib/crm";
import type { StatusKomersial } from "@/prisma-klien/enums";

/*
 * Aksi dokumen penjualan. Perusahaan (D1 §3.3): penawaran dan pesanan adalah dokumen akar (isian perusahaanId, kalau
 * kosong lingkup), dokumen lain mewarisi induknya, dan jurnal selalu mengikuti dokumennya. Pengaturan pajak dan termin
 * dibaca dari perusahaan dokumen. Perluasan D2 §6.1: mode event, baris bebas, diskon dan management fee, rencana
 * termin, teks surat, kop, nomor cetak; faktur dan retur memakai baris per id (jalur lama dipertahankan untuk pemanggil
 * lama). Penawaran dari lead CRM (D4 §3.8). Pembantu murni ada di dokumenPenjualan.ts, rencanaTermin.ts, nomorCetak.ts,
 * dan barangLainLain.ts supaya tidak menjadi endpoint publik.
 */

const NOL = D(0);

type BarisInput = { barangId: string; jumlah: Desimal; harga: Desimal };

const LABEL_STATUS_KOMERSIAL: Record<StatusKomersial, string> = {
  DRAF: "Draf",
  TERKIRIM: "Terkirim",
  DITERIMA: "Diterima",
  DITOLAK: "Ditolak",
  KEDALUWARSA: "Kedaluwarsa",
};

/**
 * Aturan harga jual di penawaran/pesanan:
 * - di bawah harga jual barang → hanya pemegang hak "harga.nego" (nego dengan klien)
 * - di bawah harga minimum barang (bila diisi) → hanya Pemilik/Superadmin
 */
async function periksaHargaNego(pengguna: PenggunaSesi, daftarBaris: BarisInput[]) {
  const daftarBarang = await db.barang.findMany({
    where: { id: { in: daftarBaris.map((l) => l.barangId) } },
    select: { id: true, nama: true, hargaJual: true, hargaMinimum: true },
  });
  const peta = new Map(daftarBarang.map((b) => [b.id, b]));
  const bolehNego = punyaHak(pengguna, "harga.nego");
  const bolehBawahMinimum = PERAN_TERTINGGI.includes(pengguna.peran);
  for (const l of daftarBaris) {
    const b = peta.get(l.barangId);
    if (!b) continue;
    const hargaJual = D(b.hargaJual);
    const minimum = D(b.hargaMinimum);
    if (l.harga.lt(hargaJual) && !bolehNego) {
      throw new Error(`Harga ${b.nama} di bawah harga jual (${format(hargaJual)}). Nego harga perlu hak "Harga jual · boleh nego".`);
    }
    if (minimum.gt(0) && l.harga.lt(minimum) && !bolehBawahMinimum) {
      throw new Error(`Harga ${b.nama} di bawah harga minimum (${format(minimum)}). Hanya Pemilik atau Superadmin yang boleh.`);
    }
  }
}

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

/** Baris berbarang (bukan baris bebas) untuk periksaHargaNego dan pastikanBarangMilik. */
function barisBerbarang(baris: readonly BarisDokumenPenjualan[]): BarisInput[] {
  return baris.flatMap((b) => (b.barangId ? [{ barangId: b.barangId, jumlah: b.jumlah, harga: b.harga }] : []));
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
  pastikanHakBarisBebas(pengguna, daftarBaris);
  const berbarang = barisBerbarang(daftarBaris);
  await periksaHargaNego(pengguna, berbarang);
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
  const penawaran = await db.penawaranPenjualan.findUniqueOrThrow({
    where: { id: penawaranId },
    include: { baris: { orderBy: [{ urutan: "asc" }, { id: "asc" }] }, rencanaTermin: true },
  });
  if (penawaran.status === "DIKONVERSI") throw new Error("Penawaran sudah dikonversi");
  if (penawaran.statusKomersial === "DITOLAK" || penawaran.statusKomersial === "KEDALUWARSA") {
    throw new Error(`Penawaran ${penawaran.nomor} berstatus ${LABEL_STATUS_KOMERSIAL[penawaran.statusKomersial]}; ubah statusnya dulu bila klien jadi setuju`);
  }

  const nomor = await nomorDokumenBerikutnya(db.pesananPenjualan, "PSJ");

  await db.$transaction(async (tx) => {
    // klaim penawaran lebih dulu, supaya dua konversi bersamaan tidak sama-sama lolos
    const { count } = await tx.penawaranPenjualan.updateMany({
      where: { id: penawaran.id, status: { not: "DIKONVERSI" } },
      data: { status: "DIKONVERSI", statusKomersial: "DITERIMA", statusKomersialPada: new Date() },
    });
    if (count !== 1) throw new Error("Penawaran sudah dikonversi");
    // pesanan mewarisi perusahaan penawaran (dokumen anak, D1 §3.3), juga bila perusahaannya sudah diarsipkan
    await tx.pesananPenjualan.create({
      data: {
        nomor,
        penawaranId: penawaran.id,
        ...salinKolom(penawaran, KOLOM_SALIN_PENAWARAN_KE_PESANAN),
        ...dataLangsungDisetujui(pengguna),
        baris: { create: penawaran.baris.map((l) => salinKolom(l, KOLOM_SALIN_BARIS)) },
        rencanaTermin: { create: salinButirKePesanan(penawaran.rencanaTermin) },
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
    const [daftarLabel, daftarJenis, daftarBarang] = await Promise.all([
      labelBarang(tx, daftarBaris.map((l) => l.barangId)),
      jenisBarang(tx, daftarBaris.map((l) => l.barangId)),
      tx.barang.findMany({ where: { id: { in: daftarBaris.map((l) => l.barangId) } }, select: { id: true, hargaBeli: true } }),
    ]);
    const hargaPokokBarang = new Map(daftarBarang.map((b) => [b.id, D(b.hargaBeli)]));

    // nilai barang keluar = harga pokok rata-rata saat ini; porsi yang sudah difaktur lebih dulu langsung jadi HPP
    const barisNilai = daftarBaris.map((l) => {
      const bp = pesanan.baris.find((ol) => ol.id === l.barisPesananId)!;
      const adalahBarang = daftarJenis.get(l.barangId) === "BARANG";
      const belumTerkirimTapiDifaktur = D(bp.jumlahDifaktur).minus(bp.jumlahTerkirim);
      const sudahDifaktur = adalahBarang ? terbesar(terkecil(l.jumlah, belumTerkirimTapiDifaktur), NOL) : NOL;
      return { ...l, hargaPokok: adalahBarang ? (hargaPokokBarang.get(l.barangId) ?? NOL) : NOL, sudahDifaktur };
    });

    const pengiriman = await tx.pengirimanPesanan.create({
      data: {
        nomor,
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
  // harga, frekuensi, dan teks baris dari pesanan (jalur ID); jalur lama memeriksa sisa per barang seperti kode lama
  const daftarBaris = siapkanBarisFaktur(pesanan, masukan);
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
  const tanggal = new Date();
  const jatuhTempo = bacaJatuhTempo(dataFormulir, pengaturan.terminHari, tanggal);
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
    // HPP diakui untuk barang yang sudah dikirim: konsumsi baris SJ baris pesanan ini (urut tanggal) yang belum difaktur.
    // Konsumsinya terjadi SEKARANG (saat draf) karena baris surat jalan tidak boleh dipakai dua faktur;
    // nilainya disimpan per baris faktur supaya jurnal HPP bisa dicatat belakangan saat faktur disetujui.
    // Jalur lama: barang tunggal di pesanan (syarat jalurLamaBolehUntuk), jadi per id sama dengan per barang kode lama.
    const nilaiTransit = daftarBaris.map(() => NOL);
    for (const [i, l] of daftarBaris.entries()) {
      const barisPesananId = l.barisPesananId!;
      const bp = await tx.barisPesananPenjualan.update({ where: { id: barisPesananId }, data: { jumlahDifaktur: { increment: l.jumlah } }, select: { jumlah: true, jumlahDifaktur: true } });
      // jalur ID: faktur lain yang dibuat bersamaan tidak boleh membuat baris pesanan tertagih melebihi jumlahnya
      if (masukan.jalur === "ID" && D(bp.jumlahDifaktur).gt(bp.jumlah)) {
        const sisa = D(bp.jumlah).minus(D(bp.jumlahDifaktur).minus(l.jumlah));
        throw new Error(`Kuantitas faktur melebihi sisa yang belum ditagih (sisa ${format(terbesar(sisa, NOL))}, diminta ${format(l.jumlah)})`);
      }
      if (daftarJenis.get(l.barangId) !== "BARANG") continue;
      let butuh = l.jumlah;
      const barisSj = await tx.barisPengiriman.findMany({
        where: { barisPesananId, pengiriman: { pesananId } },
        orderBy: { pengiriman: { tanggal: "asc" } },
      });
      for (const sj of barisSj) {
        if (butuh.lte(0)) break;
        const sisa = D(sj.jumlah).minus(sj.jumlahDifaktur);
        if (sisa.lte(0)) continue;
        const ambil = terkecil(sisa, butuh);
        await tx.barisPengiriman.update({ where: { id: sj.id }, data: { jumlahDifaktur: { increment: ambil } } });
        nilaiTransit[i] = nilaiTransit[i].plus(kali(ambil, D(sj.hargaPokok)));
        butuh = butuh.minus(ambil);
      }
    }

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
          baris: { create: dataBarisFaktur(daftarBaris, nilaiTransit) },
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
      daftarBaris,
      pengaturan.akunPpnKeluaranId,
      daftarBaris.map((l, i) => ({ barangId: l.barangId, nilai: nilaiTransit[i] })).filter((k) => k.nilai.gt(0)),
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
    include: { baris: { orderBy: { id: "asc" } }, retur: { include: { baris: true } }, penerimaan: true, pesanan: { select: { proyekId: true } } },
  });
  // dokumen anak mewarisi perusahaan faktur; gudang harus milik perusahaan itu atau bersama
  const perusahaanId = perusahaanDariInduk(faktur, dataFormulir);
  await pastikanGudangMilik(db, [gudangId], perusahaanId);

  // tidak boleh meretur lebih dari jumlah yang pernah difakturkan (dikurangi retur sebelumnya); harga dan frekuensi
  // dari baris faktur yang dicocokkan
  const barisRetur = siapkanBarisRetur(faktur, faktur.retur.flatMap((r) => r.baris), masukan);
  // diskon dan management fee faktur ikut dibalik prorata nilai baris yang diretur
  const { diskon, fee, dpp, ppn, total } = nilaiRetur(faktur, barisRetur);
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
