import type { GayaAngka, GayaEntitas, JenisAsetKop, TataLetakCetak, UkuranKertas } from "@/prisma-klien/enums";
import type { Hak } from "@/lib/hakAkses";
import type { Desimal } from "@/lib/uang";

/*
 * Tipe murni cetak (D3 §1.6, §3.2, §6.2) dan kontrak data cetak penjualan (D2 §6.3). Tanpa impor nilai dari
 * basis data atau Prisma, jadi aman dipakai tata letak, komponen klien, dan dataCetakPenjualan.ts (P25) yang
 * mengekspor ulang tipe D2 dari sini.
 */

// ---------- Kontrak data cetak penjualan (D2 §6.3) ----------

/** Jenis dokumen penjualan yang bisa dicetak; sama dengan FormatNomor.jenis dan segmen rute /cetak/[jenis]/[id]. */
export type JenisCetakPenjualan = "penawaran" | "faktur" | "kwitansi" | "kwitansi-dp" | "tagihan-termin";

export const JENIS_CETAK_PENJUALAN: readonly JenisCetakPenjualan[] = ["penawaran", "faktur", "kwitansi", "kwitansi-dp", "tagihan-termin"];

/** Hak lihat untuk melihat atau mengunduh PDF tiap jenis (rute cetak dan aksi simpan PDF memeriksanya lebih dulu). */
export const HAK_CETAK_PENJUALAN: Record<JenisCetakPenjualan, Hak> = {
  penawaran: "penawaran.lihat",
  faktur: "faktur.lihat",
  kwitansi: "penerimaan.lihat",
  "kwitansi-dp": "uang-muka.lihat",
  "tagihan-termin": "pesanan.lihat",
};

export function jenisCetakPenjualanSah(nilai: string | null | undefined): nilai is JenisCetakPenjualan {
  return (JENIS_CETAK_PENJUALAN as readonly string[]).includes(nilai ?? "");
}

export type ModeDokumenCetak = "STANDAR" | "EVENT";
export type TampilanEventCetak = "RINCI" | "RINGKAS";
export type JenisPotongan = "NOMINAL" | "PERSEN";

export type KepadaCetak = { nama: string; up: string | null; alamat: string | null; telepon: string | null; email: string | null; npwp: string | null };
export type EventCetak = { mode: ModeDokumenCetak; tampilan: TampilanEventCetak; namaEvent: string | null; venue: string | null; tanggalEvent: string | null };

/**
 * Data bisnis satu dokumen penjualan untuk dicetak, disusun dataCetakPenjualan (D2). Semua uang berupa string
 * toFixed(2) supaya pembulatan tetap milik server.
 */
export type DokumenCetakPenjualan = {
  jenis: JenisCetakPenjualan;
  id: string;
  /** identitas penerbit, rekening bawaan, kop bawaan */
  perusahaanId: string;
  /** null = kop bawaan perusahaan */
  kopSuratId: string | null;
  /** nomorCetak ?? nomor internal */
  nomorTampil: string;
  nomorInternal: string;
  /** faktur belum DISETUJUI atau tagihan termin belum diterbitkan: cetakan bertanda DRAF */
  draf: boolean;
  /** judulCetak; null = judul bawaan template */
  judul: string | null;
  tanggal: Date;
  tanggalKedua: { label: "Berlaku sampai" | "Jatuh tempo"; tanggal: Date } | null;
  /** referensi ?? nomor dokumen asal */
  referensi: string | null;
  kepada: KepadaCetak;
  surat: { perihal: string | null; lampiran: string | null; teksPembuka: string | null; teksPenutup: string | null };
  /** tanggalEvent ?? rentang tanggal proyek ("27-30 Agustus 2026") */
  event: EventCetak;
  baris: {
    no: number;
    bagian: string | null;
    nama: string;
    deskripsi: string | null;
    jumlah: string;
    satuan: string;
    frekuensi: string;
    satuanFrekuensi: string | null;
    harga: string;
    subtotal: string;
    keterangan: string | null;
  }[];
  ringkasan: {
    subtotal: string;
    jenisDiskon: JenisPotongan;
    nilaiDiskon: string;
    diskon: string;
    jenisFee: JenisPotongan;
    nilaiFee: string;
    fee: string;
    dpp: string;
    ppnPersen: string;
    ppn: string;
    total: string;
    uangMuka: string;
    terbayar: string;
    retur: string;
    sisa: string;
    addOn: { nilai: string; keterangan: string | null } | null;
  };
  /** faktur: dari PemakaianUangMuka ke UangMukaPelanggan.rencanaTermin */
  uangMukaDipakai: { nomor: string; labelTermin: string | null; jumlah: string }[];
  /** penawaran: skema pembayaran */
  /** `ditagih` (opsional): tagihan butir sudah diterbitkan; dipakai untuk status netral tanpa hak lihat bayar */
  termin: { no: number; label: string; persen: string; jumlah: string; jumlahBruto: string; jatuhTempo: Date | null; status: string; ditagih?: boolean }[];
  /** tagihan termin */
  konteksTermin: {
    no: number;
    jumlahButir: number;
    label: string;
    persen: string;
    jumlah: string;
    jumlahBruto: string;
    nilaiKontrakBruto: string;
    /** null: disembunyikan untuk pengguna tanpa uang-muka.lihat dan penerimaan.lihat (baris "Sudah dibayar" tidak dicetak) */
    dibayarSebelumnya: string | null;
    sisaSetelahTermin: string;
    nomorPesanan: string;
  } | null;
  kwitansi: { terimaDari: string; jumlah: string; potonganPajak: string; keperluan: string; metodeBayar: string; untukDokumen: string | null } | null;
  catatan: string | null;
  catatanKanan: string | null;
  syaratPembayaran: string | null;
  infoBank: string | null;
};

// ---------- Model cetak netral (D3 §3.2) ----------

/** Sama dengan JenisCetakPenjualan D2. */
export type JenisCetak = JenisCetakPenjualan;

export type BarisCetak = {
  no: number;
  nama: string;
  deskripsi: string | null;
  bagian: string | null;
  keterangan: string | null;
  jumlah: Desimal;
  satuan: string;
  frekuensi: Desimal;
  satuanFrekuensi: string | null;
  harga: Desimal;
  /** subtotal tersimpan */
  nilai: Desimal;
};

export type RingkasanNilai = {
  subtotal: Desimal;
  diskon: Desimal;
  diskonPersen: Desimal | null;
  fee: Desimal;
  feePersen: Desimal | null;
  dpp: Desimal;
  ppnPersen: Desimal;
  ppn: Desimal;
  total: Desimal;
  uangMuka: Desimal;
  terbayar: Desimal;
  retur: Desimal;
  sisa: Desimal;
  addOn: { nilai: Desimal; keterangan: string | null } | null;
};

/** Satu-satunya masukan tata letak: hasil dariDataPenjualan (uang sudah Desimal, tidak pernah Number). */
export type DokumenCetak = {
  jenis: JenisCetak;
  id: string;
  perusahaanId: string;
  kopSuratId: string | null;
  nomorTampil: string;
  nomorInternal: string;
  draf: boolean;
  judul: string | null;
  tanggal: Date;
  tanggalKedua: { label: "Berlaku sampai" | "Jatuh tempo"; tanggal: Date } | null;
  referensi: string | null;
  kepada: KepadaCetak;
  surat: {
    perihal: string | null;
    lampiran: string | null;
    teksPembuka: string | null;
    teksPenutup: string | null;
    catatan: string | null;
    catatanKanan: string | null;
    syaratPembayaran: string | null;
    infoBank: string | null;
  };
  event: EventCetak;
  baris: BarisCetak[];
  ringkasan: RingkasanNilai;
  skemaTermin: { no: number; label: string; persen: Desimal; jumlahBruto: Desimal; jatuhTempo: Date | null }[];
  konteksTermin: null | {
    no: number;
    jumlahButir: number;
    label: string;
    persen: Desimal;
    jumlah: Desimal;
    jumlahBruto: Desimal;
    nilaiKontrakBruto: Desimal;
    /** null: baris "Sudah dibayar (termin sebelumnya)" tidak dicetak */
    dibayarSebelumnya: Desimal | null;
    sisaSetelahTermin: Desimal;
    nomorPesanan: string;
  };
  uangMukaDipakai: { nomor: string; labelTermin: string | null; jumlah: Desimal }[];
  kwitansi: null | { terimaDari: string; jumlah: Desimal; potonganPajak: Desimal; keperluan: string; metodeBayar: string; untukDokumen: string | null };
  /** rincian untuk kwitansi gaya Sahara dan kwitansi polos (kosong = tanpa halaman lampiran) */
  lampiranItem: BarisCetak[];
};

/**
 * Identitas penerbit di cetakan (D3 §3.1 langkah 2): kolom penimpa kop atau, bila kosong, kolom Perusahaan (D1),
 * ditambah kolom khusus kop. Diisi identitasCetak(kop, perusahaan) di kop.ts.
 */
export type IdentitasCetak = {
  /** Perusahaan.nama */
  nama: string;
  /** kosong = nama */
  namaLegal: string;
  /** kosong = nama */
  judulMerek: string;
  alamat: string | null;
  kota: string | null;
  telepon: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  npwp: string | null;
  namaBank: string | null;
  cabangBank: string | null;
  nomorRekening: string | null;
  atasNamaRekening: string | null;
  penandaTangan: string | null;
  jabatanPenandaTangan: string | null;
  // kolom khusus kop
  teksKepala: string | null;
  facebook: string | null;
  alamatKaki: string | null;
  teksKaki: string | null;
  /** kosong = namaBank */
  singkatanBank: string | null;
  catatanBank: string | null;
  teksSalam: string;
  /** kosong = penandaTangan */
  namaKontak: string | null;
  /** kosong = telepon */
  teleponKontak: string | null;
};

/** Tema satu cetakan (D3 §3.1 langkah 9): warna kop, gaya angka, jumlah desimal dokumen, dan peta aset gambar. */
export type TemaCetak = {
  warnaAksen: string;
  warnaUtama: string;
  warnaSekunder: string;
  warnaLembut: string;
  warnaTinta: string;
  gayaAngka: GayaAngka;
  /** desimalDokumen (format.ts): 2 bila ada nilai uang bersen, selain itu 0 */
  desimal: 0 | 2;
  tampilLogo: boolean;
  tampilWatermark: boolean;
  gayaEntitas: GayaEntitas | null;
  /** isi gambar per slot (unggahan kop lebih dulu, lalu aset bawaan repo); slot tanpa gambar tidak ada */
  aset: Partial<Record<JenisAsetKop, Uint8Array>>;
};

/** Opsi dari query rute GET atau isian formulir aksi simpan PDF (D3 §6.2, dibaca bacaOpsiCetak). */
export type OpsiCetak = { kopId: string | null; ukuran: "A4" | "A5" | "A5L" | null; ttd: boolean | null; tampilan: TampilanEventCetak | null };

/** Hasil render PDF (D3 §6.2). tandaTangan = gambar tanda tangan benar-benar dibubuhkan (dipakai log). */
export type HasilPdf = { isi: Uint8Array; namaBerkas: string; judul: string; ukuran: UkuranKertas; tataLetak: TataLetakCetak; kopSuratId: string | null; tandaTangan: boolean };
