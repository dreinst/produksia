import type { KopSurat, Perusahaan, Prisma, PrismaClient } from "@/prisma-klien/client";
import type { GayaAngka, GayaEntitas, JenisAsetKop, JenisDokumenCetak, TataLetakCetak, UkuranKertas } from "@/prisma-klien/enums";
import { bacaIsiBerkas } from "@/lib/berkas";
import { asetBawaan, periksaGambar, type InfoGambar } from "@/lib/cetak/aset";
import type { Perekam } from "@/lib/cetak/mesin/kanvas";
import type { DokumenCetak, IdentitasCetak, JenisCetak, OpsiCetak, TampilanEventCetak, TemaCetak } from "@/lib/cetak/tipe";

/*
 * Kop surat dan template cetak (D3 §3.1, §3.5): pemilihan kop, template, tata letak, ukuran, gaya angka, judul, dan
 * tampilan event; identitas cetak (kop menimpa Perusahaan); pemuatan aset gambar (unggahan privat Berkas dulu, lalu
 * aset bawaan repo); preset kop D'Pro; dan batas unggahan aset kop. Hanya untuk server (membaca basis data dan
 * berkas). Tata letak tidak pernah memanggil berkas ini; penyaji (src/lib/cetak/index.ts) yang menyiapkan masukannya.
 */

type KlienDb = PrismaClient | Prisma.TransactionClient;

// ---------- Tabel aturan (D3 §3.1) ----------

/** Jenis data D2 ke enum template. */
export const JENIS_DOKUMEN_CETAK: Record<JenisCetak, JenisDokumenCetak> = {
  penawaran: "PENAWARAN",
  "tagihan-termin": "TAGIHAN_TERMIN",
  faktur: "FAKTUR",
  kwitansi: "KWITANSI",
  "kwitansi-dp": "KWITANSI_DP",
};

const HKA: TataLetakCetak[] = ["HKA_STANDAR", "HKA_BERMEREK", "HKA_SURAT", "HKA_MINIMAL"];

export const TATA_LETAK_SAH: Record<JenisDokumenCetak, readonly TataLetakCetak[]> = {
  PENAWARAN: [...HKA, "DPRO_PROPOSAL"],
  TAGIHAN_TERMIN: [...HKA, "DPRO_INVOICE", "KWITANSI_ENTITAS"],
  FAKTUR: [...HKA, "DPRO_INVOICE", "KWITANSI_ENTITAS"],
  KWITANSI: [...HKA, "KWITANSI_ENTITAS", "KWITANSI_POLOS"],
  KWITANSI_DP: [...HKA, "KWITANSI_ENTITAS", "KWITANSI_POLOS"],
};

/** Ukuran sah per tata letak; elemen pertama = bawaan. */
export const UKURAN_SAH: Record<TataLetakCetak, readonly UkuranKertas[]> = {
  HKA_STANDAR: ["A4"],
  HKA_BERMEREK: ["A4"],
  HKA_SURAT: ["A4"],
  HKA_MINIMAL: ["A4"],
  DPRO_INVOICE: ["A4", "A5", "A5_LANDSCAPE"],
  DPRO_PROPOSAL: ["A4"],
  KWITANSI_ENTITAS: ["A5_LANDSCAPE", "A4"],
  KWITANSI_POLOS: ["A4"],
};

/** Semua tata letak memakai titik ("Rp 80.483.260") sesuai keputusan P-29; koma tetap bisa dipilih per template. */
export const GAYA_ANGKA_BAWAAN: Record<TataLetakCetak, GayaAngka> = {
  HKA_STANDAR: "TITIK",
  HKA_BERMEREK: "TITIK",
  HKA_SURAT: "TITIK",
  HKA_MINIMAL: "TITIK",
  DPRO_INVOICE: "TITIK",
  DPRO_PROPOSAL: "TITIK",
  KWITANSI_ENTITAS: "TITIK",
  KWITANSI_POLOS: "TITIK",
};

export const JUDUL_BAWAAN: Record<JenisDokumenCetak, string> = {
  PENAWARAN: "PENAWARAN",
  TAGIHAN_TERMIN: "TAGIHAN TERMIN",
  FAKTUR: "INVOICE",
  KWITANSI: "KWITANSI",
  KWITANSI_DP: "KWITANSI",
};

export const LABEL_TATA_LETAK: Record<TataLetakCetak, string> = {
  HKA_STANDAR: "Standar",
  HKA_BERMEREK: "Bermerek",
  HKA_SURAT: "Surat / SPH",
  HKA_MINIMAL: "Minimal",
  DPRO_INVOICE: "Invoice D'Pro",
  DPRO_PROPOSAL: "Proposal D'Pro",
  KWITANSI_ENTITAS: "Kwitansi entitas",
  KWITANSI_POLOS: "Kwitansi polos",
};

export const LABEL_JENIS_DOKUMEN: Record<JenisDokumenCetak, string> = {
  PENAWARAN: "Penawaran",
  TAGIHAN_TERMIN: "Tagihan termin",
  FAKTUR: "Faktur",
  KWITANSI: "Kwitansi",
  KWITANSI_DP: "Kwitansi uang muka",
};

export const LABEL_UKURAN: Record<UkuranKertas, string> = { A4: "A4", A5: "A5", A5_LANDSCAPE: "A5 landscape" };

/** Judul berkas unduhan per jenis (D3 §3.1 tabel judul). */
export function judulBerkasCetak(jenis: JenisDokumenCetak, tataLetak: TataLetakCetak): string {
  if (jenis === "PENAWARAN") return tataLetak === "DPRO_PROPOSAL" ? "Proposal" : "Penawaran";
  if (jenis === "TAGIHAN_TERMIN") return "Tagihan Termin";
  if (jenis === "FAKTUR") return "Invoice";
  return "Kwitansi";
}

/** Tata letak HKA (dokumen mode event bertata letak ini memakai tampilan event bertema kop). */
export const tataLetakHka = (t: TataLetakCetak) => (HKA as readonly string[]).includes(t);

/**
 * Pesan galat untuk satu baris template (D3 §3.5), atau null bila sah. Dipakai aksi simpan template (P31) dan
 * pengaman pemilihan template.
 */
export function galatTemplate(jenis: JenisDokumenCetak, tataLetak: TataLetakCetak, ukuran: UkuranKertas, gayaEntitas: GayaEntitas | null): string | null {
  if (!TATA_LETAK_SAH[jenis].includes(tataLetak)) return `Tata letak ${LABEL_TATA_LETAK[tataLetak]} tidak bisa dipakai untuk ${LABEL_JENIS_DOKUMEN[jenis].toLocaleLowerCase("id-ID")}`;
  if (tataLetak === "KWITANSI_ENTITAS" && !gayaEntitas) return "Kwitansi entitas butuh gaya entitas di kop ini";
  if (!UKURAN_SAH[tataLetak].includes(ukuran)) return `Ukuran ${LABEL_UKURAN[ukuran]} tidak tersedia untuk tata letak ${LABEL_TATA_LETAK[tataLetak]}`;
  return null;
}

// ---------- Preset kop (D3 §3.1) ----------

type IsianTemplate = { tataLetak: TataLetakCetak; ukuran: UkuranKertas; judul?: string; tandaTanganBawaan?: boolean };
export type PresetKop = {
  gayaEntitas: GayaEntitas | null;
  isian: Partial<Pick<KopSurat, "judulMerek" | "singkatanBank" | "namaBank" | "namaKontak" | "teleponKontak" | "warnaAksen" | "warnaUtama" | "warnaSekunder" | "warnaLembut" | "warnaTinta" | "tataLetakUmum">>;
  template: Partial<Record<JenisDokumenCetak, IsianTemplate>>;
};
/** Kwitansi: tanda tangan hanya bila dicentang (perilaku bot, spec/10 §9.1 no. 11). */
const KW = (tataLetak: TataLetakCetak, ukuran: UkuranKertas): IsianTemplate => ({ tataLetak, ukuran, tandaTanganBawaan: false });
const A5L = "A5_LANDSCAPE" as const;

/**
 * Preset kop per entitas D'Pro. Identitas, rekening, dan penanda tangan TIDAK disalin (sudah di Perusahaan, D1 §2.5);
 * preset hanya mengisi gaya, warna, kolom khusus kop, dan template. DPRO mengisi penimpa namaBank supaya invoice
 * mencetak nama bank panjang seperti Figma tanpa mengubah data perusahaan.
 */
export const PRESET_KOP: Record<"DPRO" | "TAPUSSA" | "BONANOVA" | "SAHARA" | "SMARA" | "NAWASENA" | "GENERIK", PresetKop> = {
  DPRO: {
    gayaEntitas: "DPRO",
    isian: { warnaAksen: "#CA1E1E", warnaUtama: "#0B2144", warnaSekunder: "#003E9F", warnaLembut: "#DBE4F0", warnaTinta: "#1A1A1F", singkatanBank: "BCA", namaBank: "BANK CENTRAL ASIA", namaKontak: "Donny", teleponKontak: "081.938.938.800" },
    template: {
      PENAWARAN: { tataLetak: "DPRO_PROPOSAL", ukuran: "A4" },
      TAGIHAN_TERMIN: { tataLetak: "DPRO_INVOICE", ukuran: "A4", judul: "INVOICE" },
      FAKTUR: { tataLetak: "DPRO_INVOICE", ukuran: "A4" },
      KWITANSI: KW("KWITANSI_ENTITAS", A5L),
      KWITANSI_DP: KW("KWITANSI_ENTITAS", A5L),
    },
  },
  TAPUSSA: {
    gayaEntitas: "TAPUSSA",
    isian: { warnaAksen: "#F05B21", warnaUtama: "#3F3F97", warnaSekunder: "#C9302C", warnaTinta: "#000000", singkatanBank: "BCA" },
    template: {
      PENAWARAN: { tataLetak: "HKA_SURAT", ukuran: "A4" },
      TAGIHAN_TERMIN: { tataLetak: "KWITANSI_ENTITAS", ukuran: A5L, judul: "INVOICE" },
      FAKTUR: { tataLetak: "KWITANSI_ENTITAS", ukuran: A5L },
      KWITANSI: KW("KWITANSI_ENTITAS", A5L),
      KWITANSI_DP: KW("KWITANSI_ENTITAS", A5L),
    },
  },
  BONANOVA: {
    gayaEntitas: "BONANOVA",
    isian: { warnaAksen: "#AE0317", warnaUtama: "#0E95B4", warnaTinta: "#000000", singkatanBank: "BCA" },
    template: {
      PENAWARAN: { tataLetak: "HKA_SURAT", ukuran: "A4" },
      TAGIHAN_TERMIN: { tataLetak: "KWITANSI_ENTITAS", ukuran: A5L, judul: "INVOICE" },
      FAKTUR: { tataLetak: "KWITANSI_ENTITAS", ukuran: A5L },
      KWITANSI: KW("KWITANSI_ENTITAS", A5L),
      KWITANSI_DP: KW("KWITANSI_ENTITAS", A5L),
    },
  },
  SAHARA: {
    gayaEntitas: "SAHARA",
    isian: { warnaAksen: "#A80503", warnaUtama: "#A80503", warnaSekunder: "#F08A2B", warnaTinta: "#000000", singkatanBank: "BCA" },
    template: {
      TAGIHAN_TERMIN: { tataLetak: "KWITANSI_ENTITAS", ukuran: A5L, judul: "INVOICE" },
      FAKTUR: { tataLetak: "KWITANSI_ENTITAS", ukuran: A5L },
      KWITANSI: KW("KWITANSI_ENTITAS", A5L),
      KWITANSI_DP: KW("KWITANSI_ENTITAS", A5L),
    },
  },
  SMARA: { gayaEntitas: null, isian: { judulMerek: "SMARA" }, template: { KWITANSI: KW("KWITANSI_POLOS", "A4"), KWITANSI_DP: KW("KWITANSI_POLOS", "A4") } },
  NAWASENA: {
    gayaEntitas: "NAWASENA",
    isian: { warnaAksen: "#006699", warnaUtama: "#006699", warnaSekunder: "#FF6600", warnaTinta: "#000000", judulMerek: "Nawasena Production", singkatanBank: "BCA" },
    template: {
      TAGIHAN_TERMIN: { tataLetak: "KWITANSI_ENTITAS", ukuran: A5L, judul: "INVOICE" },
      FAKTUR: { tataLetak: "KWITANSI_ENTITAS", ukuran: A5L },
      KWITANSI: KW("KWITANSI_ENTITAS", A5L),
      KWITANSI_DP: KW("KWITANSI_ENTITAS", A5L),
    },
  },
  GENERIK: { gayaEntitas: null, isian: {}, template: {} },
};

/** Usulan preset untuk perusahaan standar D1 (formulir buat kop). */
export const PRESET_PERUSAHAAN: Record<string, keyof typeof PRESET_KOP> = { utama: "DPRO", tapussa: "TAPUSSA", bonanova: "BONANOVA", sahara: "SAHARA", smara: "SMARA", nawasena: "NAWASENA" };

// ---------- Kop terpilih ----------

/** Kop untuk dicetak: baris KopSurat, atau kop polos virtual (id null) bila perusahaan belum punya kop. */
export type KopCetak = Omit<KopSurat, "id" | "dibuatPada" | "diubahPada" | "dihapusPada"> & { id: string | null };

/** Kop polos virtual (D3 §3.1 langkah 1.5): identitas Perusahaan saja, warna bawaan skema, tata letak standar. */
export function kopPolos(perusahaanId: string): KopCetak {
  return {
    id: null,
    perusahaanId,
    nama: "Polos",
    bawaan: false,
    gayaEntitas: null,
    tataLetakUmum: "HKA_STANDAR",
    judulMerek: null,
    teksKepala: null,
    facebook: null,
    alamatKaki: null,
    teksKaki: null,
    singkatanBank: null,
    catatanBank: null,
    teksSalam: "Hormat kami,",
    namaKontak: null,
    teleponKontak: null,
    namaLegal: null,
    alamat: null,
    kota: null,
    telepon: null,
    email: null,
    website: null,
    instagram: null,
    npwp: null,
    namaBank: null,
    cabangBank: null,
    nomorRekening: null,
    atasNamaRekening: null,
    penandaTangan: null,
    jabatanPenandaTangan: null,
    warnaAksen: "#111111",
    warnaUtama: "#1F3550",
    warnaSekunder: "#003E9F",
    warnaLembut: "#DBE4F0",
    warnaTinta: "#111111",
    tampilLogo: true,
    tampilWatermark: false,
  };
}

export const PESAN_KOP_BUKAN_MILIK = "Kop surat tidak ditemukan atau bukan milik perusahaan dokumen ini";

/** Galat cetak yang aman ditampilkan, dengan status HTTP untuk rute cetak (D3 §6.2). Diekspor ulang src/lib/cetak. */
export class GalatCetak extends Error {
  constructor(
    readonly status: 400 | 404,
    pesan: string,
  ) {
    super(pesan);
    this.name = "GalatCetak";
  }
}

/**
 * Kop untuk satu dokumen (D3 §3.1 langkah 1): `kopId` pilihan (wajib milik perusahaan dokumen dan belum dihapus,
 * selain itu GalatCetak 400), kop dokumen (dilewati diam-diam bila dihapus atau beda perusahaan), kop bawaan
 * perusahaan (diubahPada terbaru bila lebih dari satu), kop pertama urut nama, lalu kop polos virtual.
 */
export async function pilihKop(klien: KlienDb, perusahaanId: string, kopDokumen: string | null, kopId: string | null): Promise<KopCetak> {
  const aktif = { perusahaanId, dihapusPada: null };
  if (kopId) {
    const kop = await klien.kopSurat.findFirst({ where: { id: kopId, ...aktif } });
    if (!kop) throw new GalatCetak(400, PESAN_KOP_BUKAN_MILIK);
    return kop;
  }
  if (kopDokumen) {
    const kop = await klien.kopSurat.findFirst({ where: { id: kopDokumen, ...aktif } });
    if (kop) return kop;
  }
  const bawaan = await klien.kopSurat.findFirst({ where: { ...aktif, bawaan: true }, orderBy: [{ diubahPada: "desc" }, { id: "asc" }] });
  if (bawaan) return bawaan;
  const pertama = await klien.kopSurat.findFirst({ where: aktif, orderBy: [{ nama: "asc" }, { id: "asc" }] });
  return pertama ?? kopPolos(perusahaanId);
}

export type TemplateEfektif = { tataLetak: TataLetakCetak; ukuran: UkuranKertas; gayaAngka: GayaAngka | null; judul: string | null; tandaTanganBawaan: boolean };

export type PilihanCetak = {
  kop: KopCetak;
  /** baris TemplateCetak, atau bawaan kop (tata letak umum, A4) bila tidak ada */
  template: TemplateEfektif;
  jenisDokumen: JenisDokumenCetak;
  tataLetak: TataLetakCetak;
  ukuran: UkuranKertas;
  gayaAngka: GayaAngka;
  judul: string;
  judulBerkas: string;
  /** tampilan event HKA (penawaran dan faktur mode event bertata letak HKA_*); null = tata letak biasa */
  tampilanEvent: TampilanEventCetak | null;
};

const UKURAN_OPSI: Record<NonNullable<OpsiCetak["ukuran"]>, UkuranKertas> = { A4: "A4", A5: "A5", A5L: "A5_LANDSCAPE" };

/**
 * Pilih kop, template, tata letak, ukuran, tampilan event, gaya angka, dan judul (D3 §3.1 langkah 1, 3-8). Template
 * yang tidak sah lagi (tata letak tidak cocok jenis, atau kwitansi entitas tanpa gaya entitas) jatuh ke tata letak
 * umum kop dengan peringatan di perekam, bukan galat.
 */
export async function pilihKopDanTemplate(
  klien: KlienDb,
  dok: Pick<DokumenCetak, "jenis" | "perusahaanId" | "kopSuratId" | "judul" | "event">,
  opsi: Partial<OpsiCetak> = {},
  perekam?: Perekam,
): Promise<PilihanCetak> {
  const kop = await pilihKop(klien, dok.perusahaanId, dok.kopSuratId, opsi.kopId ?? null);
  const jenisDokumen = JENIS_DOKUMEN_CETAK[dok.jenis];
  const umum: TataLetakCetak = tataLetakHka(kop.tataLetakUmum) ? kop.tataLetakUmum : "HKA_STANDAR";
  const baris = kop.id ? await klien.templateCetak.findUnique({ where: { kopSuratId_jenis: { kopSuratId: kop.id, jenis: jenisDokumen } } }) : null;
  const template: TemplateEfektif = baris
    ? { tataLetak: baris.tataLetak, ukuran: baris.ukuran, gayaAngka: baris.gayaAngka, judul: baris.judul, tandaTanganBawaan: baris.tandaTanganBawaan }
    : { tataLetak: umum, ukuran: "A4", gayaAngka: null, judul: null, tandaTanganBawaan: true };

  let tataLetak = template.tataLetak;
  if (!TATA_LETAK_SAH[jenisDokumen].includes(tataLetak) || (tataLetak === "KWITANSI_ENTITAS" && !kop.gayaEntitas)) {
    perekam?.peringatan.push(`Template ${LABEL_TATA_LETAK[tataLetak]} tidak bisa dipakai untuk ${LABEL_JENIS_DOKUMEN[jenisDokumen].toLocaleLowerCase("id-ID")}; memakai tata letak umum kop`);
    tataLetak = umum;
  }

  const sah = UKURAN_SAH[tataLetak];
  const diminta = opsi.ukuran ? UKURAN_OPSI[opsi.ukuran] : null;
  const ukuran = diminta && sah.includes(diminta) ? diminta : sah.includes(template.ukuran) ? template.ukuran : sah[0];

  const tampilanEvent = dok.event.mode === "EVENT" && tataLetakHka(tataLetak) && (jenisDokumen === "PENAWARAN" || jenisDokumen === "FAKTUR") ? (opsi.tampilan ?? dok.event.tampilan) : null;
  const gayaAngka = template.gayaAngka ?? GAYA_ANGKA_BAWAAN[tataLetak];
  const bawaanJudul = (jenisDokumen === "KWITANSI" || jenisDokumen === "KWITANSI_DP") && kop.gayaEntitas === "NAWASENA" ? "KUITANSI" : JUDUL_BAWAAN[jenisDokumen];
  const judul = dok.judul?.trim() || template.judul?.trim() || bawaanJudul;
  return { kop, template, jenisDokumen, tataLetak, ukuran, gayaAngka, judul, judulBerkas: judulBerkasCetak(jenisDokumen, tataLetak), tampilanEvent };
}

// ---------- Identitas dan tema ----------

const KOLOM_PENIMPA = [
  "namaLegal",
  "alamat",
  "kota",
  "telepon",
  "email",
  "website",
  "instagram",
  "npwp",
  "namaBank",
  "cabangBank",
  "nomorRekening",
  "atasNamaRekening",
  "penandaTangan",
  "jabatanPenandaTangan",
] as const;

export type PerusahaanCetak = Pick<Perusahaan, "nama" | (typeof KOLOM_PENIMPA)[number]>;

const isi = (s: string | null | undefined) => (s?.trim() ? s.trim() : null);

/**
 * Identitas cetak (D3 §3.1 langkah 2): setiap kolom penimpa kop, bila kosong kolom Perusahaan bernama sama. nama =
 * Perusahaan.nama; namaLegal dan judulMerek kosong = nama. singkatanBank, namaKontak, teleponKontak dibiarkan null
 * bila kosong (tata letak memakai namaBank, penandaTangan, telepon sebagai cadangan).
 */
export function identitasCetak(kop: KopCetak, perusahaan: PerusahaanCetak): IdentitasCetak {
  const nilai = Object.fromEntries(KOLOM_PENIMPA.map((k) => [k, isi(kop[k]) ?? isi(perusahaan[k])])) as Record<(typeof KOLOM_PENIMPA)[number], string | null>;
  return {
    ...nilai,
    nama: perusahaan.nama,
    namaLegal: nilai.namaLegal ?? perusahaan.nama,
    judulMerek: isi(kop.judulMerek) ?? perusahaan.nama,
    teksKepala: isi(kop.teksKepala),
    facebook: isi(kop.facebook),
    alamatKaki: isi(kop.alamatKaki),
    teksKaki: isi(kop.teksKaki),
    singkatanBank: isi(kop.singkatanBank),
    catatanBank: isi(kop.catatanBank),
    teksSalam: isi(kop.teksSalam) ?? "Hormat kami,",
    namaKontak: isi(kop.namaKontak),
    teleponKontak: isi(kop.teleponKontak),
  };
}

/** Warna dan tampilan tema dari kop (tanpa gaya angka, desimal, dan aset yang diisi penyaji). */
export function temaKop(kop: KopCetak): Pick<TemaCetak, "warnaAksen" | "warnaUtama" | "warnaSekunder" | "warnaLembut" | "warnaTinta" | "tampilLogo" | "tampilWatermark" | "gayaEntitas"> {
  return {
    warnaAksen: kop.warnaAksen,
    warnaUtama: kop.warnaUtama,
    warnaSekunder: kop.warnaSekunder,
    warnaLembut: kop.warnaLembut,
    warnaTinta: kop.warnaTinta,
    tampilLogo: kop.tampilLogo,
    tampilWatermark: kop.tampilWatermark,
    gayaEntitas: kop.gayaEntitas,
  };
}

// ---------- Aset gambar ----------

/** Slot gambar dekorasi yang dipakai tiap tata letak (tanda tangan dan stempel ditambah penyaji bila boleh). */
export const SLOT_TATA_LETAK: Record<TataLetakCetak, readonly JenisAsetKop[]> = {
  HKA_STANDAR: ["LOGO"],
  HKA_BERMEREK: ["LOGO"],
  HKA_SURAT: ["LOGO"],
  HKA_MINIMAL: ["LOGO"],
  DPRO_INVOICE: ["KOP", "KAKI", "WATERMARK", "JUDUL_INVOICE", "LABEL_PEMBAYARAN", "LABEL_SALAM"],
  DPRO_PROPOSAL: ["KOP", "KAKI", "WATERMARK", "LABEL_SALAM"],
  KWITANSI_ENTITAS: ["KOP", "KAKI", "WATERMARK", "LOGO", "JUDUL_INVOICE", "JUDUL_KWITANSI"],
  KWITANSI_POLOS: [],
};

/** Slot tanpa aset bawaan repo: hanya unggahan privat (tidak pernah disalin dari generator D'Pro). */
const SLOT_PRIVAT: readonly JenisAsetKop[] = ["TANDA_TANGAN", "STEMPEL"];

/**
 * Aset gambar kop untuk slot yang diminta (D3 §3.1 langkah 10): AsetKopSurat yang berkasnya aktif, isinya masih ada,
 * dan terlampir ke kop ini lebih dulu; bila tidak ada atau gagal pemeriksaan, aset bawaan repo menurut gaya entitas
 * (kecuali TANDA_TANGAN dan STEMPEL). Aset unggahan yang gagal diperiksa dilewati dengan peringatan di perekam,
 * jadi gambar rusak tidak pernah sampai ke pdfkit.
 */
export async function muatAsetKop(klien: KlienDb, kop: KopCetak, slot: readonly JenisAsetKop[], perekam?: Perekam): Promise<TemaCetak["aset"]> {
  const peta: TemaCetak["aset"] = {};
  if (!slot.length) return peta;
  if (kop.id) {
    const daftar = await klien.asetKopSurat.findMany({
      where: { kopSuratId: kop.id, jenis: { in: [...slot] }, berkas: { dihapusPada: null, isiDihapusPada: null, jenisEntitas: "kop-surat", entitasId: kop.id, perusahaanId: kop.perusahaanId } },
      select: { jenis: true, berkasId: true },
    });
    for (const a of daftar) {
      const isiBerkas = await bacaIsiBerkas(klien, a.berkasId);
      if (!isiBerkas) continue;
      try {
        periksaAsetKop(isiBerkas);
        peta[a.jenis] = isiBerkas;
      } catch (e) {
        perekam?.peringatan.push(`Gambar ${a.jenis} kop tidak dipakai: ${(e as Error).message}`);
      }
    }
  }
  if (kop.gayaEntitas) {
    for (const s of slot) {
      if (peta[s] || SLOT_PRIVAT.includes(s)) continue;
      const bawaan = asetBawaan(kop.gayaEntitas, s);
      if (bawaan) peta[s] = bawaan;
    }
  }
  return peta;
}

/** Batas ukuran berkas aset kop (D3 §3.5). */
export const BATAS_UKURAN_ASET_KOP = 2 * 1024 * 1024;
/** Batas sisi aset kop dari kepala berkas, diperiksa SEBELUM periksaGambar mengurai seluruh piksel (kontrak P30). */
export const SISI_ASET_KOP_MAKS = 6000;
export const SISI_ASET_KOP_MIN = 16;
export const PESAN_ASET_KOSONG = "Pilih satu gambar";
export const PESAN_ASET_TERLALU_BESAR = "Ukuran gambar maksimal 2 MB";
export const PESAN_ASET_FORMAT = "Gambar kop harus PNG atau JPEG";
export const PESAN_ASET_DIMENSI = `Dimensi gambar harus ${SISI_ASET_KOP_MIN} sampai ${SISI_ASET_KOP_MAKS} piksel`;

/** Lebar dan tinggi dari kepala PNG (IHDR) atau JPEG (SOF) tanpa mengurai piksel; null bila tidak terbaca. */
function sisiDariKepala(d: Uint8Array): { lebar: number; tinggi: number } | null {
  const u32 = (i: number) => ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0;
  const u16 = (i: number) => (d[i] << 8) | d[i + 1];
  if (d[0] === 0x89) {
    if (d.length < 24 || String.fromCharCode(d[12], d[13], d[14], d[15]) !== "IHDR") return null;
    return { lebar: u32(16), tinggi: u32(20) };
  }
  let i = 2;
  while (i + 9 < d.length) {
    if (d[i] !== 0xff) return null;
    const penanda = d[i + 1];
    if (penanda === 0xff) {
      i++;
      continue;
    }
    if (penanda === 0xd8 || penanda === 0x01 || (penanda >= 0xd0 && penanda <= 0xd7)) {
      i += 2;
      continue;
    }
    if (penanda === 0xd9 || penanda === 0xda) return null;
    if (penanda >= 0xc0 && penanda <= 0xcf && penanda !== 0xc4 && penanda !== 0xc8 && penanda !== 0xcc) return { tinggi: u16(i + 5), lebar: u16(i + 7) };
    i += 2 + u16(i + 2);
  }
  return null;
}

/**
 * Pemeriksaan aset kop sebelum disimpan atau dipakai: ada isinya, paling besar 2 MB, PNG atau JPEG dari tanda
 * tangannya, sisi 16 sampai 6000 piksel menurut kepala berkas, lalu periksaGambar. Semua galat berupa Error yang
 * pesannya aman ditampilkan (pesan periksaGambar diteruskan apa adanya, kontrak P09).
 */
export function periksaAsetKop(isiGambar: Uint8Array): InfoGambar {
  if (!isiGambar.length) throw new Error(PESAN_ASET_KOSONG);
  if (isiGambar.length > BATAS_UKURAN_ASET_KOP) throw new Error(PESAN_ASET_TERLALU_BESAR);
  const png = isiGambar.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => isiGambar[i] === b);
  const jpeg = isiGambar.length >= 3 && isiGambar[0] === 0xff && isiGambar[1] === 0xd8 && isiGambar[2] === 0xff;
  if (!png && !jpeg) throw new Error(PESAN_ASET_FORMAT);
  const sisi = sisiDariKepala(isiGambar);
  if (sisi && (sisi.lebar > SISI_ASET_KOP_MAKS || sisi.tinggi > SISI_ASET_KOP_MAKS || sisi.lebar < SISI_ASET_KOP_MIN || sisi.tinggi < SISI_ASET_KOP_MIN)) throw new Error(PESAN_ASET_DIMENSI);
  return periksaGambar(isiGambar);
}

/** Label slot gambar kop (halaman Kop & Template dan log). */
export const LABEL_SLOT_ASET: Record<JenisAsetKop, string> = {
  KOP: "Kop",
  KAKI: "Kaki",
  WATERMARK: "Watermark",
  LOGO: "Logo",
  JUDUL_INVOICE: "Judul invoice",
  JUDUL_KWITANSI: "Judul kwitansi",
  LABEL_PEMBAYARAN: "Label pembayaran",
  LABEL_SALAM: "Label salam",
  TANDA_TANGAN: "Tanda tangan",
  STEMPEL: "Stempel",
};
