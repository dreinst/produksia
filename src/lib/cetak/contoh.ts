import { Prisma } from "@/prisma-klien/browser";
import type { GayaEntitas } from "@/prisma-klien/enums";
import { dariDataPenjualan } from "@/lib/cetak/dariDataPenjualan";
import type { DokumenCetak, DokumenCetakPenjualan, IdentitasCetak, TemaCetak } from "@/lib/cetak/tipe";

/*
 * Data contoh cetak (D3 §1.6): angka uji generator D'Pro (spec/10 §4.3, contoh/*.json milik pengguna) dan angka HKA
 * (spec/02 §4). Dipakai pratinjau template dan uji tata letak. Bentuknya data D2 (uang string toFixed(2)) supaya
 * melewati dariDataPenjualan yang sama dengan dokumen nyata. Murni data, tanpa basis data dan tanpa berkas.
 *
 * Data rekaan ditandai di komentarnya: kwitansi dan invoice tulisan Nawasena, kwitansi SMARA, rincian baris HKA
 * "Nawasena" dan "Evoked" (arsip HKA hanya memuat subtotalnya), serta rincian baris invoice tulisan DPRO 8.261.539.
 */

type Uang = number | string;
const s2 = (v: Uang) => new Prisma.Decimal(v).toFixed(2);
/** Siang WIB supaya tanggal kalender sama di zona mana pun. */
const tgl = (iso: string) => new Date(`${iso}T05:00:00Z`);

type BarisContoh = { nama: string; jumlah?: Uang; satuan?: string; frekuensi?: Uang; satuanFrekuensi?: string | null; harga: Uang; keterangan?: string | null; deskripsi?: string | null; bagian?: string | null };

function baris(daftar: BarisContoh[]): DokumenCetakPenjualan["baris"] {
  return daftar.map((b, i) => {
    const jumlah = new Prisma.Decimal(b.jumlah ?? 1);
    const frekuensi = new Prisma.Decimal(b.frekuensi ?? 1);
    const harga = new Prisma.Decimal(b.harga);
    return {
      no: i + 1,
      bagian: b.bagian ?? null,
      nama: b.nama,
      deskripsi: b.deskripsi ?? null,
      jumlah: jumlah.toFixed(2),
      satuan: b.satuan ?? "paket",
      frekuensi: frekuensi.toFixed(2),
      satuanFrekuensi: b.satuanFrekuensi ?? null,
      harga: harga.toFixed(2),
      subtotal: jumlah.mul(frekuensi).mul(harga).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
      keterangan: b.keterangan ?? null,
    };
  });
}

type IsianRingkasan = {
  subtotal: Uang;
  diskon?: { jenis: "NOMINAL" | "PERSEN"; nilai: Uang; jumlah: Uang };
  fee?: { jenis: "NOMINAL" | "PERSEN"; nilai: Uang; jumlah: Uang };
  ppnPersen?: Uang;
  ppn?: Uang;
  uangMuka?: Uang;
  terbayar?: Uang;
  retur?: Uang;
  addOn?: { nilai: Uang; keterangan: string | null };
};

/** dpp = subtotal - diskon + fee, total = dpp + ppn, sisa = total - terbayar - retur (rumus D2). */
function ringkasan(r: IsianRingkasan): DokumenCetakPenjualan["ringkasan"] {
  const D = (v: Uang | undefined) => new Prisma.Decimal(v ?? 0);
  const dpp = D(r.subtotal).minus(D(r.diskon?.jumlah)).plus(D(r.fee?.jumlah));
  const total = dpp.plus(D(r.ppn));
  return {
    subtotal: s2(r.subtotal),
    jenisDiskon: r.diskon?.jenis ?? "NOMINAL",
    nilaiDiskon: s2(r.diskon?.nilai ?? 0),
    diskon: s2(r.diskon?.jumlah ?? 0),
    jenisFee: r.fee?.jenis ?? "NOMINAL",
    nilaiFee: s2(r.fee?.nilai ?? 0),
    fee: s2(r.fee?.jumlah ?? 0),
    dpp: dpp.toFixed(2),
    ppnPersen: s2(r.ppnPersen ?? 0),
    ppn: s2(r.ppn ?? 0),
    total: total.toFixed(2),
    uangMuka: s2(r.uangMuka ?? 0),
    terbayar: s2(r.terbayar ?? 0),
    retur: s2(r.retur ?? 0),
    sisa: total.minus(D(r.terbayar)).minus(D(r.retur)).toFixed(2),
    addOn: r.addOn ? { nilai: s2(r.addOn.nilai), keterangan: r.addOn.keterangan } : null,
  };
}

type IsianDokumen = Pick<DokumenCetakPenjualan, "jenis" | "nomorTampil" | "tanggal"> &
  Partial<Omit<DokumenCetakPenjualan, "jenis" | "nomorTampil" | "tanggal" | "kepada" | "surat" | "event">> & {
    kepada: string;
    perusahaanId: string;
    surat?: Partial<DokumenCetakPenjualan["surat"]>;
    event?: Partial<DokumenCetakPenjualan["event"]>;
  };

function dokumen(d: IsianDokumen): DokumenCetakPenjualan {
  const b = d.baris ?? [];
  const subtotal = b.reduce((n, x) => n.plus(x.subtotal), new Prisma.Decimal(0));
  return {
    jenis: d.jenis,
    id: d.id ?? `contoh-${d.jenis}-${d.perusahaanId}`,
    perusahaanId: d.perusahaanId,
    kopSuratId: d.kopSuratId ?? null,
    nomorTampil: d.nomorTampil,
    nomorInternal: d.nomorInternal ?? d.nomorTampil,
    draf: d.draf ?? false,
    judul: d.judul ?? null,
    tanggal: d.tanggal,
    tanggalKedua: d.tanggalKedua ?? null,
    referensi: d.referensi ?? null,
    kepada: { nama: d.kepada, up: null, alamat: null, telepon: null, email: null, npwp: null },
    surat: { perihal: null, lampiran: null, teksPembuka: null, teksPenutup: null, ...d.surat },
    event: { mode: "STANDAR", tampilan: "RINCI", namaEvent: null, venue: null, tanggalEvent: null, ...d.event },
    baris: b,
    ringkasan: d.ringkasan ?? ringkasan({ subtotal: subtotal.toFixed(2) }),
    uangMukaDipakai: d.uangMukaDipakai ?? [],
    termin: d.termin ?? [],
    konteksTermin: d.konteksTermin ?? null,
    kwitansi: d.kwitansi ?? null,
    catatan: d.catatan ?? null,
    catatanKanan: d.catatanKanan ?? null,
    syaratPembayaran: d.syaratPembayaran ?? null,
    infoBank: d.infoBank ?? null,
  };
}

const kwitansi = (terimaDari: string, jumlah: Uang, keperluan: string): DokumenCetakPenjualan["kwitansi"] => ({
  terimaDari,
  jumlah: s2(jumlah),
  potonganPajak: s2(0),
  keperluan,
  metodeBayar: "TRANSFER",
  untukDokumen: null,
});

// ---------- D'Pro (spec/10 §4.3) ----------

/** contoh/invoice.json: total 73.166.600, management fee 10% 7.316.660, grand total 80.483.260. */
const INVOICE_DPRO = dokumen({
  jenis: "faktur",
  perusahaanId: "utama",
  nomorTampil: "071/DPRO-INV2/IX/2026",
  tanggal: tgl("2026-09-21"),
  kepada: "Kantor Perwakilan Bank Indonesia Malang",
  baris: baris([
    { nama: "Pembayaran Penginapan dan Paket Meeting QJI 2026 di Hotel Manis Ae", harga: 29_990_900 },
    { nama: "Pembelian Racepack Peserta QJI 2026", harga: 5_850_000 },
    { nama: "Pembelian Perlengkapan panitia (Cartenz)", harga: 7_815_000 },
    { nama: "Pembelian Perlengkapan peserta (voucher MAP Tim QJI)", harga: 5_400_000 },
    { nama: "Pembelian Konsumsi Edukasi QJI 2026 di Merchant Kuliner", harga: 24_110_700 },
  ]),
  ringkasan: ringkasan({ subtotal: 73_166_600, fee: { jenis: "PERSEN", nilai: 10, jumlah: 7_316_660 } }),
});

/** contoh/proposal.json: 12 baris, total biaya langsung 159.515.000, diskon 890.000, grand total 158.625.000, add on 3.625.000. */
const PROPOSAL_DPRO = dokumen({
  jenis: "penawaran",
  perusahaanId: "utama",
  nomorTampil: "064/DPRO/P1/VIII/2026",
  tanggal: tgl("2026-08-26"),
  kepada: "PPK Balai BPHL Wilayah IX Mataram",
  event: { mode: "EVENT", namaEvent: "Kunjungan Lapangan BPHL Wilayah IX Mataram", tanggalEvent: "27-30 Agustus 2026" },
  baris: baris([
    { nama: "Akomodasi Hotel - Twin Room (utk 2 org)", jumlah: 25, satuan: "kamar", frekuensi: 3, satuanFrekuensi: "malam", harga: 650_000, keterangan: "25 kamar x 3 malam (27-30 Agu). Estimasi hotel bintang 4, sudah termasuk sarapan" },
    { nama: "Akomodasi Hotel - Single Room", jumlah: 3, satuan: "kamar", frekuensi: 3, satuanFrekuensi: "malam", harga: 550_000, keterangan: "3 kamar x 3 malam. Estimasi hotel bintang 4, sudah termasuk sarapan" },
    // data asli: keterangan menulis 6 kali makan, freq 5 (jangan diperbaiki, spec/10 §4.3)
    { nama: "Konsumsi tambahan (makan siang & malam di luar hotel)", jumlah: 53, satuan: "orang", frekuensi: 5, satuanFrekuensi: "kali", harga: 60_000, keterangan: "53 pax x 6 kali makan (H1 malam; H2 siang & malam; H3 siang & malam; H4 siang)" },
    { nama: "Snackbox", jumlah: 55, satuan: "orang", frekuensi: 6, satuanFrekuensi: "kali", harga: 15_000, keterangan: "Snack Pagi Sore" },
    { nama: "Sewa Bus Pariwisata AC (Big Bus 50 seat, all include)", jumlah: 1, satuan: "unit", frekuensi: 4, satuanFrekuensi: "hari", harga: 3_500_000, keterangan: "1 unit x 4 hari, termasuk BBM, tol, parkir, sopir & co-driver, Surabaya-Malang PP + mobilisasi lokal" },
    { nama: "Sewa Innova Reborn (all include)", jumlah: 1, satuan: "unit", frekuensi: 4, satuanFrekuensi: "hari", harga: 1_300_000, keterangan: "1 unit x 4 hari, termasuk BBM, tol, parkir, sopir & co-driver, Surabaya-Malang PP + mobilisasi lokal" },
    { nama: "Tiket Masuk + Paket Fungames/Outbound Poncokusumo & River Tubing", jumlah: 53, satuan: "pax", frekuensi: 1, satuanFrekuensi: "event", harga: 250_000, keterangan: "Tiket masuk kawasan wisata + fasilitator & perlengkapan outbound & Tubing" },
    { nama: "Dokumentasi (Foto & Video Kegiatan)", jumlah: 1, satuan: "paket", frekuensi: 1, satuanFrekuensi: "event", harga: 7_000_000, keterangan: "Fotografer + videografer selama kegiatan, termasuk hasil edit" },
    { nama: "Mini Gala Dinner & Entertainment", jumlah: 1, satuan: "paket", frekuensi: 1, satuanFrekuensi: "event", harga: 12_000_000, keterangan: "gala dinner & live music" },
    { nama: "Tiket Museum Angkut", jumlah: 53, satuan: "pax", frekuensi: 1, satuanFrekuensi: "event", harga: 130_000, keterangan: "Tiket masuk per orang" },
    { nama: "Kaos Kegiatan Outbound", jumlah: 53, satuan: "pax", frekuensi: 1, satuanFrekuensi: "event", harga: 125_000, keterangan: "Souvenir kaos" },
    { nama: "Management & Operasional EO", jumlah: 1, satuan: "paket", frekuensi: 1, satuanFrekuensi: "event", harga: 20_000_000, keterangan: "Biaya Kru & Management" },
  ]),
  ringkasan: ringkasan({ subtotal: 159_515_000, diskon: { jenis: "NOMINAL", nilai: 890_000, jumlah: 890_000 }, addOn: { nilai: 3_625_000, keterangan: null } }),
});

/** Invoice tulisan DPRO (contoh Azalia): 8.261.539. Rincian satu baris rekaan; angka dan pelanggan dari spec/10 §4.3. */
const INVOICE_TULISAN_DPRO = dokumen({
  jenis: "faktur",
  perusahaanId: "utama",
  nomorTampil: "080/DPRO-INV/IX/2026",
  tanggal: tgl("2026-09-30"),
  kepada: "Baam Entertainment",
  baris: baris([{ nama: "Pembayaran Talent Azalia", harga: 8_261_539 }]),
});

/** contoh/kw-dpro.json */
const KWITANSI_DPRO = dokumen({
  jenis: "kwitansi-dp",
  perusahaanId: "utama",
  nomorTampil: "069/DPRO-INV2/IX/2026",
  tanggal: tgl("2026-09-26"),
  kepada: "Hendy Pratama, PT. Tamapro",
  kwitansi: kwitansi("Hendy Pratama, PT. Tamapro", 44_340_000, "Pembayaran Termin 2 Event BamBimBoom Fest, Utama Raya, 27 September 2026"),
});

/** contoh/kw-tapussa.json */
const KWITANSI_TAPUSSA = dokumen({
  jenis: "kwitansi",
  perusahaanId: "tapussa",
  nomorTampil: "014/TB/INV3/VII/2026",
  tanggal: tgl("2026-08-20"),
  kepada: "KPw Bank Indonesia Malang",
  kwitansi: kwitansi("KPw Bank Indonesia Malang", 12_650_000, "Pembayaran Talent Pada Kegiatan QRIS Jelajah Indonesia 2026"),
});

/** contoh/kw-bonanova.json: digunakan_untuk_2 menjadi baris baru di keperluan. */
const KWITANSI_BONANOVA = dokumen({
  jenis: "kwitansi-dp",
  perusahaanId: "bonanova",
  nomorTampil: "055/BONA-INV2/VIII/2026",
  tanggal: tgl("2026-08-31"),
  kepada: "Cansa",
  kwitansi: kwitansi("Cansa", 500_000, "DP Pembayaran Bonanova Ruby (Keyboard dan Vocal)\n11 Oktober 2026"),
});

/** contoh/kw-sahara.json: dua item lampiran, total 531.000. */
const KWITANSI_SAHARA = dokumen({
  jenis: "kwitansi",
  perusahaanId: "sahara",
  nomorTampil: "311/KWI-SHR/IX/2026",
  tanggal: tgl("2026-09-04"),
  kepada: "PT. Bentoel Prima Tbk., Karanglo",
  baris: baris([
    { nama: "Nasi Kotak Spesial", jumlah: 6, satuan: "Pax", harga: 50_000 },
    { nama: "Snack Box dan Minum", jumlah: 6, satuan: "Pax", harga: 38_500 },
  ]),
  kwitansi: kwitansi("PT. Bentoel Prima Tbk., Karanglo", 531_000, "Paket Konsumsi BAT Karanglo"),
});

/** Rekaan: kuitansi Nawasena (arsip hanya memuat contoh buatan admin dengan salah ketik nominal). */
const KWITANSI_NAWASENA = dokumen({
  jenis: "kwitansi",
  perusahaanId: "nawasena",
  nomorTampil: "012/NAWA-KWI/X/2026",
  tanggal: tgl("2026-10-24"),
  kepada: "Baam Entertainment",
  kwitansi: kwitansi("Baam Entertainment", 2_500_000, "Pembayaran Talent Azalia, 24 Oktober 2026"),
});

/** Rekaan: invoice tulisan Nawasena. */
const INVOICE_TULISAN_NAWASENA = dokumen({
  jenis: "faktur",
  perusahaanId: "nawasena",
  nomorTampil: "013/NAWA-INV/X/2026",
  tanggal: tgl("2026-10-24"),
  kepada: "Baam Entertainment",
  surat: { perihal: "Pelunasan Talent Azalia, 24 Oktober 2026" },
  baris: baris([{ nama: "Talent Azalia", harga: 2_500_000 }]),
});

/** Rekaan: kwitansi SMARA (template Kwitansi SMARA.docx tanpa contoh isi) dengan lampiran dua item. */
const KWITANSI_SMARA = dokumen({
  jenis: "kwitansi",
  perusahaanId: "smara",
  nomorTampil: "001/SMARA-KWI/IX/2026",
  tanggal: tgl("2026-09-10"),
  kepada: "Contoh Pelanggan",
  baris: baris([
    { nama: "Sewa Perlengkapan Panggung", jumlah: 1, satuan: "paket", harga: 1_500_000 },
    { nama: "Operator", jumlah: 2, satuan: "orang", harga: 250_000 },
  ]),
  kwitansi: kwitansi("Contoh Pelanggan", 2_000_000, "Sewa perlengkapan dan operator acara"),
});

// ---------- HKA (spec/02 §4) ----------

/** Standar: qty 2 x 1.000.000 dengan diskon baris 10% (Produksia: harga 900.000), diskon dokumen 5%, PPN 11%. */
const HKA_STANDAR = dokumen({
  jenis: "faktur",
  perusahaanId: "utama",
  nomorTampil: "INV-HKA-0001",
  tanggal: tgl("2026-09-21"),
  tanggalKedua: { label: "Jatuh tempo", tanggal: tgl("2026-10-21") },
  kepada: "Contoh Pelanggan HKA",
  baris: baris([{ nama: "Jasa konsultasi", jumlah: 2, satuan: "paket", harga: 900_000 }]),
  ringkasan: ringkasan({ subtotal: 1_800_000, diskon: { jenis: "PERSEN", nilai: 5, jumlah: 90_000 }, ppnPersen: 11, ppn: 188_100 }),
});

/** Event "Nawasena", rinci: subtotal 65.500.000 (empat baris rekaan, sama dengan uji pustaka bersama), fee 10%, PPN 11%. */
const HKA_NAWASENA = dokumen({
  jenis: "faktur",
  perusahaanId: "nawasena",
  nomorTampil: "INV-HKA-0002",
  tanggal: tgl("2026-09-21"),
  kepada: "Contoh Klien Event",
  event: { mode: "EVENT", tampilan: "RINCI", namaEvent: "Nawasena", venue: "Malang", tanggalEvent: "27-30 Agustus 2026" },
  baris: baris([
    { nama: "Produksi panggung", jumlah: 1, frekuensi: 1, satuanFrekuensi: "event", harga: 25_000_000 },
    { nama: "Kru lapangan", jumlah: 10, satuan: "orang", frekuensi: 2, satuanFrekuensi: "hari", harga: 750_000 },
    { nama: "Konsumsi", jumlah: 100, satuan: "pax", frekuensi: 3, satuanFrekuensi: "kali", harga: 50_000 },
    { nama: "Talent", jumlah: 1, frekuensi: 1, satuanFrekuensi: "event", harga: 10_500_000 },
  ]),
  ringkasan: ringkasan({ subtotal: 65_500_000, fee: { jenis: "PERSEN", nilai: 10, jumlah: 6_550_000 }, ppnPersen: 11, ppn: 7_925_500 }),
});

/** Event "Evoked", ringkas: subtotal 18.135.000 (enam baris rekaan), fee 10%, PPN 0, terbayar 13.300.000, sisa 6.648.500. */
const HKA_EVOKED = dokumen({
  jenis: "faktur",
  perusahaanId: "utama",
  nomorTampil: "01.EVO-ISA/INV/VIII/2026",
  tanggal: tgl("2026-08-15"),
  kepada: "Contoh Klien Evoked",
  event: { mode: "EVENT", tampilan: "RINGKAS", namaEvent: "Evoked", venue: "Surabaya", tanggalEvent: "15 Agustus 2026" },
  baris: baris([
    { nama: "Sound system", jumlah: 1, frekuensi: 1, satuanFrekuensi: "event", harga: 7_500_000, bagian: "Produksi" },
    { nama: "Lighting", jumlah: 1, frekuensi: 1, satuanFrekuensi: "event", harga: 4_250_000, bagian: "Produksi" },
    { nama: "Panggung", jumlah: 1, frekuensi: 1, satuanFrekuensi: "event", harga: 3_500_000, bagian: "Produksi" },
    { nama: "Kru", jumlah: 8, satuan: "orang", frekuensi: 2, satuanFrekuensi: "hari", harga: 150_000, bagian: "Tim" },
    { nama: "Konsumsi kru", jumlah: 9, satuan: "pax", frekuensi: 3, satuanFrekuensi: "kali", harga: 15_000, bagian: "Tim" },
    { nama: "Air mineral", jumlah: 4, satuan: "dus", frekuensi: 1, satuanFrekuensi: "event", harga: 20_000, bagian: "Tim" },
  ]),
  ringkasan: ringkasan({ subtotal: 18_135_000, fee: { jenis: "PERSEN", nilai: 10, jumlah: 1_813_500 }, terbayar: 13_300_000 }),
});

/** Data D2 contoh (uang string), urut menurut kegunaan. */
export const DATA_CONTOH = {
  invoiceDpro: INVOICE_DPRO,
  proposalDpro: PROPOSAL_DPRO,
  invoiceTulisanDpro: INVOICE_TULISAN_DPRO,
  invoiceTulisanNawasena: INVOICE_TULISAN_NAWASENA,
  kwitansiDpro: KWITANSI_DPRO,
  kwitansiTapussa: KWITANSI_TAPUSSA,
  kwitansiBonanova: KWITANSI_BONANOVA,
  kwitansiSahara: KWITANSI_SAHARA,
  kwitansiNawasena: KWITANSI_NAWASENA,
  kwitansiSmara: KWITANSI_SMARA,
  hkaStandar: HKA_STANDAR,
  hkaNawasena: HKA_NAWASENA,
  hkaEvoked: HKA_EVOKED,
} satisfies Record<string, DokumenCetakPenjualan>;

export type NamaContoh = keyof typeof DATA_CONTOH;

/** Dokumen contoh dalam model cetak netral (salinan baru tiap panggilan). */
export function dokumenContoh(nama: NamaContoh): DokumenCetak {
  return dariDataPenjualan(DATA_CONTOH[nama]);
}

/** Kwitansi contoh per gaya entitas (dan SMARA untuk kwitansi polos). */
export const KWITANSI_CONTOH: Record<GayaEntitas | "SMARA", NamaContoh> = {
  DPRO: "kwitansiDpro",
  TAPUSSA: "kwitansiTapussa",
  BONANOVA: "kwitansiBonanova",
  SAHARA: "kwitansiSahara",
  NAWASENA: "kwitansiNawasena",
  SMARA: "kwitansiSmara",
};

// ---------- Identitas dan warna per entitas (spec/10 §1.1, §1.2, §6.2; preset kop D3 §3.1) ----------

type EntitasContoh = GayaEntitas | "SMARA" | "POLOS";

const identitas = (i: Partial<IdentitasCetak> & { nama: string }): IdentitasCetak => ({
  namaLegal: i.nama,
  judulMerek: i.nama,
  alamat: null,
  kota: "Malang",
  telepon: null,
  email: null,
  website: null,
  instagram: null,
  npwp: null,
  namaBank: "BCA",
  cabangBank: null,
  nomorRekening: null,
  atasNamaRekening: null,
  penandaTangan: null,
  jabatanPenandaTangan: null,
  teksKepala: null,
  facebook: null,
  alamatKaki: null,
  teksKaki: null,
  singkatanBank: "BCA",
  catatanBank: null,
  teksSalam: "Hormat kami,",
  namaKontak: null,
  teleponKontak: null,
  ...i,
});

export const IDENTITAS_CONTOH: Record<EntitasContoh, IdentitasCetak> = {
  // namaBank "BANK CENTRAL ASIA" = penimpa kop preset DPRO (invoice mencetak nama bank panjang)
  DPRO: identitas({
    nama: "D'Production",
    alamat: "Jl. Raya Pandanlandung No. 16 Malang",
    telepon: "+6281938938800",
    email: "dproductionorganizer@gmail.com",
    instagram: "@dpro.duction",
    namaBank: "BANK CENTRAL ASIA",
    cabangBank: "Malang Cab. Galunggung",
    nomorRekening: "440.008.0033",
    atasNamaRekening: "Donatus Purbandono",
    penandaTangan: "Donatus Purbandono",
    namaKontak: "Donny",
    teleponKontak: "081.938.938.800",
  }),
  TAPUSSA: identitas({
    nama: "CV Tapussa Bhallika",
    alamat: "Jl. Simpang Raya Langsep 26 Malang",
    telepon: "082132370811",
    email: "cv.tapussabhallika@gmail.com",
    cabangBank: "Malang Cab. Kawi",
    nomorRekening: "385.199.9921",
    atasNamaRekening: "TAPUSSA BHALLIKA CV",
    penandaTangan: "Nadia Yuliana",
  }),
  BONANOVA: identitas({
    nama: "Bonanova Music",
    nomorRekening: "3851999921",
    atasNamaRekening: "CV Tapussa Bhallika",
    penandaTangan: "Bintang Wahyu",
    jabatanPenandaTangan: "Manager",
  }),
  SAHARA: identitas({
    nama: "Sahara Food",
    nomorRekening: "3850972931",
    atasNamaRekening: "BINA KARISMA NEGARA",
    penandaTangan: "BINA KARISMA NEGARA",
  }),
  NAWASENA: identitas({
    nama: "Nawasena Production",
    namaLegal: "DPRODUCTION NAWASENA CV",
    cabangBank: "Malang Cab. Galunggung",
    nomorRekening: "816-178-8228",
    atasNamaRekening: "DPRODUCTION NAWASENA CV",
    penandaTangan: "Firdaus Romanda Lumban Toruan",
  }),
  SMARA: identitas({
    nama: "SMARA",
    cabangBank: "Malang Cab. Kawi",
    nomorRekening: "385.199.9921",
    atasNamaRekening: "TAPUSSA BHALLIKA CV",
    penandaTangan: "Nadia Yuliana",
  }),
  POLOS: identitas({ nama: "Perusahaan Contoh", namaBank: null, singkatanBank: null }),
};

type WarnaTema = Pick<TemaCetak, "warnaAksen" | "warnaUtama" | "warnaSekunder" | "warnaLembut" | "warnaTinta">;
const warna = (w: Partial<WarnaTema>): WarnaTema => ({ warnaAksen: "#111111", warnaUtama: "#1F3550", warnaSekunder: "#003E9F", warnaLembut: "#DBE4F0", warnaTinta: "#111111", ...w });

/** Warna preset kop (D3 §3.1 PRESET_KOP); yang tidak disebut preset memakai bawaan skema KopSurat. */
export const WARNA_CONTOH: Record<EntitasContoh, WarnaTema> = {
  DPRO: warna({ warnaAksen: "#CA1E1E", warnaUtama: "#0B2144", warnaSekunder: "#003E9F", warnaLembut: "#DBE4F0", warnaTinta: "#1A1A1F" }),
  TAPUSSA: warna({ warnaAksen: "#F05B21", warnaUtama: "#3F3F97", warnaSekunder: "#C9302C", warnaTinta: "#000000" }),
  BONANOVA: warna({ warnaAksen: "#AE0317", warnaUtama: "#0E95B4", warnaTinta: "#000000" }),
  SAHARA: warna({ warnaAksen: "#A80503", warnaUtama: "#A80503", warnaSekunder: "#F08A2B", warnaTinta: "#000000" }),
  NAWASENA: warna({ warnaAksen: "#006699", warnaUtama: "#006699", warnaSekunder: "#FF6600", warnaTinta: "#000000" }),
  SMARA: warna({}),
  POLOS: warna({}),
};
