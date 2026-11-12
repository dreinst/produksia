"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHakAksi } from "@/lib/otentikasi";
import type { PenggunaSesi } from "@/lib/hakAkses";
import { perusahaanDokumenBaru } from "@/lib/perusahaan";
import { catatAktivitas } from "@/lib/log";
import { buangSatuBerkas } from "@/lib/berkas";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { LABEL_SLOT_ASET, PRESET_KOP, UKURAN_SAH, galatTemplate, tataLetakHka } from "@/lib/cetak/kop";
import type { Prisma } from "@/prisma-klien/client";
import type { GayaAngka, GayaEntitas, JenisAsetKop, JenisDokumenCetak, TataLetakCetak, UkuranKertas } from "@/prisma-klien/enums";

/*
 * Aksi kop surat dan template cetak (D3 §6.1). Semua aksi memegang pengaturan.tulis. Isian dibaca dan divalidasi di luar
 * transaksi, lalu satu transaksi untuk perubahan dan log (modul pengaturan, jenis "Kop Surat" atau "Template Cetak").
 * Baris Perusahaan pemilik kop dikunci FOR NO KEY UPDATE di awal transaksi, jadi buat, jadikan bawaan, dan hapus kop di
 * satu perusahaan berjalan bergiliran: nama unik dan satu kop bawaan per perusahaan tetap terjaga, dan sisipan dokumen
 * yang merujuk perusahaan itu (KEY SHARE) tidak tertahan. Unggah gambar kop lewat POST /api/cetak/kop/[kopId]/aset.
 */

type Tx = Prisma.TransactionClient;

const GAYA_ENTITAS: readonly GayaEntitas[] = ["DPRO", "TAPUSSA", "BONANOVA", "SAHARA", "NAWASENA"];
const JENIS_DOKUMEN: readonly JenisDokumenCetak[] = ["PENAWARAN", "TAGIHAN_TERMIN", "FAKTUR", "KWITANSI", "KWITANSI_DP"];
const JENIS_ASET: readonly JenisAsetKop[] = ["KOP", "KAKI", "WATERMARK", "LOGO", "JUDUL_INVOICE", "JUDUL_KWITANSI", "LABEL_PEMBAYARAN", "LABEL_SALAM", "TANDA_TANGAN", "STEMPEL"];
const SEMUA_UKURAN: readonly UkuranKertas[] = ["A4", "A5", "A5_LANDSCAPE"];
const PESAN_KOP_TIDAK_ADA = "Kop surat tidak ditemukan";

/** Kolom teks kop (D3 §3.5): batas khusus kop dari komentar skema, penimpa identitas dari batas Perusahaan (D1 §3.7). */
const KOLOM_TEKS = {
  judulMerek: { label: "Judul merek", maks: 60 },
  teksKepala: { label: "Tagline kepala", maks: 120 },
  facebook: { label: "Facebook", maks: 60 },
  alamatKaki: { label: "Alamat di pita kaki", maks: 200 },
  teksKaki: { label: "Teks kaki", maks: 150 },
  singkatanBank: { label: "Singkatan bank", maks: 20 },
  catatanBank: { label: "Catatan rekening", maks: 120 },
  namaKontak: { label: "Nama kontak", maks: 80 },
  teleponKontak: { label: "Telepon kontak", maks: 40 },
  namaLegal: { label: "Nama legal", maks: 200 },
  alamat: { label: "Alamat", maks: 1000 },
  kota: { label: "Kota", maks: 200 },
  telepon: { label: "Telepon", maks: 40 },
  email: { label: "Email", maks: 200 },
  website: { label: "Website", maks: 200 },
  instagram: { label: "Instagram", maks: 200 },
  npwp: { label: "NPWP", maks: 40 },
  namaBank: { label: "Nama bank", maks: 200 },
  cabangBank: { label: "Cabang", maks: 200 },
  nomorRekening: { label: "Nomor rekening", maks: 40 },
  atasNamaRekening: { label: "Atas nama", maks: 200 },
  penandaTangan: { label: "Penanda tangan", maks: 200 },
  jabatanPenandaTangan: { label: "Jabatan", maks: 200 },
} as const;
type KolomTeks = keyof typeof KOLOM_TEKS;

const KOLOM_WARNA = {
  warnaAksen: "aksen",
  warnaUtama: "utama",
  warnaSekunder: "sekunder",
  warnaLembut: "latar lembut",
  warnaTinta: "teks",
} as const;
type KolomWarna = keyof typeof KOLOM_WARNA;

/** Kolom rekening yang nilainya tidak ditulis ke log (hanya nama kolomnya). */
const KOLOM_TANPA_NILAI_LOG = new Set(["namaBank", "cabangBank", "nomorRekening", "atasNamaRekening", "npwp"]);

const teks = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function bacaNama(fd: FormData): string {
  const nama = teks(fd, "nama");
  if (!nama) throw new Error("Nama kop wajib diisi");
  if (nama.length > 80) throw new Error("Nama kop maksimal 80 karakter");
  return nama;
}

function bacaGaya(nilai: string): GayaEntitas | null {
  if (!nilai) return null;
  if (!(GAYA_ENTITAS as readonly string[]).includes(nilai)) throw new Error("Gaya entitas tidak dikenal");
  return nilai as GayaEntitas;
}

/** Kunci baris Perusahaan pemilik kop (FOR NO KEY UPDATE) supaya aksi kop satu perusahaan berjalan bergiliran. */
async function kunciPerusahaanKop(tx: Tx, perusahaanId: string) {
  await tx.$queryRaw`SELECT 1 FROM "Perusahaan" WHERE "id" = ${perusahaanId} FOR NO KEY UPDATE`;
}

/** Nama kop unik tanpa beda huruf besar di antara kop belum terhapus perusahaan itu (dibaca sesudah kunci). */
async function pastikanNamaUnik(tx: Tx, perusahaanId: string, nama: string, kecualiId: string | null) {
  const sama = await tx.kopSurat.findFirst({
    where: { perusahaanId, dihapusPada: null, nama: { equals: nama, mode: "insensitive" }, ...(kecualiId ? { NOT: { id: kecualiId } } : {}) },
    select: { id: true },
  });
  if (sama) throw new Error("Nama kop sudah dipakai di perusahaan ini");
}

/** Kop aktif (belum dihapus) sesudah perusahaannya dikunci; argumen hasil .bind diperiksa ulang di sini. */
async function kopAktif(tx: Tx, id: string) {
  const awal = await tx.kopSurat.findUnique({ where: { id }, select: { perusahaanId: true } });
  if (!awal) throw new Error(PESAN_KOP_TIDAK_ADA);
  await kunciPerusahaanKop(tx, awal.perusahaanId);
  const kop = await tx.kopSurat.findUnique({ where: { id } });
  if (!kop || kop.dihapusPada) throw new Error(PESAN_KOP_TIDAK_ADA);
  return kop;
}

const logKop = (tx: Tx, pengguna: PenggunaSesi, kop: { id: string; nama: string; perusahaanId: string }, aksi: string, keterangan: string, meta?: Prisma.InputJsonValue, jenis = "Kop Surat") =>
  catatAktivitas(tx, pengguna, { aksi, jenis, nomor: kop.nama, keterangan, modul: "pengaturan", entitasId: kop.id, meta, perusahaanId: kop.perusahaanId });

function segarkan(kopId?: string) {
  revalidatePath("/pengaturan/perusahaan/kop");
  if (kopId) revalidatePath(`/pengaturan/perusahaan/kop/${kopId}`);
}

// ---------- Buat kop ----------

export async function buatKopSurat(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("pengaturan.tulis");
  const nama = bacaNama(dataFormulir);
  const kunciPreset = teks(dataFormulir, "preset") || "GENERIK";
  if (!Object.prototype.hasOwnProperty.call(PRESET_KOP, kunciPreset)) throw new Error("Preset tidak dikenal");
  const preset = PRESET_KOP[kunciPreset as keyof typeof PRESET_KOP];
  const perusahaanId = await perusahaanDokumenBaru(dataFormulir);

  const kop = await db.$transaction(async (tx) => {
    await kunciPerusahaanKop(tx, perusahaanId);
    await pastikanNamaUnik(tx, perusahaanId, nama, null);
    const ada = await tx.kopSurat.count({ where: { perusahaanId, dihapusPada: null } });
    const baru = await tx.kopSurat.create({ data: { perusahaanId, nama, bawaan: ada === 0, gayaEntitas: preset.gayaEntitas, ...preset.isian } });
    const template = Object.entries(preset.template).map(([jenis, t]) => ({
      kopSuratId: baru.id,
      jenis: jenis as JenisDokumenCetak,
      tataLetak: t.tataLetak,
      ukuran: t.ukuran,
      judul: t.judul ?? null,
      tandaTanganBawaan: t.tandaTanganBawaan ?? true,
    }));
    if (template.length) await tx.templateCetak.createMany({ data: template });
    await logKop(tx, pengguna, baru, "BUAT", `Kop surat dibuat dari preset ${kunciPreset}${baru.bawaan ? " sebagai kop bawaan" : ""}`, { preset: kunciPreset });
    return baru;
  });
  segarkan();
  redirect(`/pengaturan/perusahaan/kop/${kop.id}`);
}

export async function buatKopSuratFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatKopSurat(dataFormulir));
}

// ---------- Ubah kop ----------

/**
 * Ubah kop (D3 §6.1): daftar putih kolom gaya, kepala dan kaki, kontak, penimpa identitas, warna, dan tampilan.
 * perusahaanId tidak bisa diubah. Kolom teks yang tidak dikirim tetap; yang dikirim kosong menjadi null (teksSalam
 * kembali ke "Hormat kami,"). Kotak tampilLogo dan tampilWatermark dibaca bila formulir mengirim penanda kotakTampil.
 */
export async function ubahKopSurat(id: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("pengaturan.tulis");
  const data: Prisma.KopSuratUpdateInput = {};
  if (dataFormulir.has("nama")) data.nama = bacaNama(dataFormulir);
  if (dataFormulir.has("gayaEntitas")) data.gayaEntitas = bacaGaya(teks(dataFormulir, "gayaEntitas"));
  if (dataFormulir.has("tataLetakUmum")) {
    const t = teks(dataFormulir, "tataLetakUmum");
    if (!tataLetakHka(t as TataLetakCetak)) throw new Error("Tata letak umum hanya boleh salah satu tata letak HKA");
    data.tataLetakUmum = t as TataLetakCetak;
  }
  for (const [k, { label, maks }] of Object.entries(KOLOM_TEKS) as [KolomTeks, { label: string; maks: number }][]) {
    if (!dataFormulir.has(k)) continue;
    const v = teks(dataFormulir, k);
    if (v.length > maks) throw new Error(`${label} maksimal ${maks} karakter`);
    data[k] = v || null;
  }
  if (typeof data.email === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new Error("Email kop tidak valid");
  if (dataFormulir.has("teksSalam")) {
    const v = teks(dataFormulir, "teksSalam");
    if (v.length > 120) throw new Error("Salam penutup maksimal 120 karakter");
    data.teksSalam = v || "Hormat kami,";
  }
  for (const [k, label] of Object.entries(KOLOM_WARNA) as [KolomWarna, string][]) {
    if (!dataFormulir.has(k)) continue;
    const v = teks(dataFormulir, k);
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error(`Warna ${label} harus kode HEX 6 digit, mis. #0B2144`);
    data[k] = v.toUpperCase();
  }
  if (dataFormulir.has("kotakTampil")) {
    data.tampilLogo = dataFormulir.get("tampilLogo") === "on";
    data.tampilWatermark = dataFormulir.get("tampilWatermark") === "on";
  }

  const kop = await db.$transaction(async (tx) => {
    const lama = await kopAktif(tx, id);
    if (typeof data.nama === "string") await pastikanNamaUnik(tx, lama.perusahaanId, data.nama, id);
    const berubah = (Object.keys(data) as (keyof typeof lama)[]).filter((k) => lama[k] !== data[k as keyof typeof data]);
    if (berubah.length === 0) return lama;
    const baru = await tx.kopSurat.update({ where: { id }, data });
    await logKop(tx, pengguna, baru, "UBAH", `Kop surat diubah: ${berubah.join(", ")}`, {
      kolom: berubah,
      nilai: Object.fromEntries(berubah.filter((k) => !KOLOM_TANPA_NILAI_LOG.has(k)).map((k) => [k, String(baru[k] ?? "")])),
    });
    return baru;
  });
  segarkan(kop.id);
}

export async function ubahKopSuratFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahKopSurat(id, dataFormulir));
}

// ---------- Kop bawaan dan hapus ----------

export async function jadikanKopBawaan(id: string) {
  const pengguna = await wajibHakAksi("pengaturan.tulis");
  await db.$transaction(async (tx) => {
    const kop = await kopAktif(tx, id);
    if (kop.bawaan) return;
    await tx.kopSurat.updateMany({ where: { perusahaanId: kop.perusahaanId, bawaan: true, NOT: { id } }, data: { bawaan: false } });
    await tx.kopSurat.update({ where: { id }, data: { bawaan: true } });
    await logKop(tx, pengguna, kop, "UBAH", "Dijadikan kop bawaan");
  });
  segarkan(id);
}

// Dipakai lewat .bind(null, id); argumen (prevState, dataFormulir) dari useActionState sengaja diabaikan
export async function jadikanKopBawaanFormulir(id: string) {
  return jalankanFormulir(() => jadikanKopBawaan(id));
}

/**
 * Hapus lunak (D3 §3.5): dihapusPada diisi dan bawaan dilepas. Bila kop bawaan yang dihapus dan perusahaan masih punya
 * kop lain, kop dengan diubahPada terbaru dijadikan bawaan di transaksi yang sama. Gambar dan berkasnya dibiarkan.
 * Dokumen yang merujuk kop ini dicetak dengan kop bawaan perusahaan (pilihKop melewati kop terhapus).
 */
export async function hapusKopSurat(id: string) {
  const pengguna = await wajibHakAksi("pengaturan.tulis");
  const perusahaanId = await db.$transaction(async (tx) => {
    const kop = await kopAktif(tx, id);
    await tx.kopSurat.update({ where: { id }, data: { dihapusPada: new Date(), bawaan: false } });
    let ganti: { id: string; nama: string } | null = null;
    if (kop.bawaan) {
      ganti = await tx.kopSurat.findFirst({ where: { perusahaanId: kop.perusahaanId, dihapusPada: null }, orderBy: [{ diubahPada: "desc" }, { id: "asc" }], select: { id: true, nama: true } });
      if (ganti) await tx.kopSurat.update({ where: { id: ganti.id }, data: { bawaan: true } });
    }
    await logKop(tx, pengguna, kop, "HAPUS", ganti ? `Kop surat dihapus; ${ganti.nama} menjadi kop bawaan` : "Kop surat dihapus", ganti ? { bawaanBaru: ganti.id } : undefined);
    return kop.perusahaanId;
  });
  segarkan(id);
  redirect(`/pengaturan/perusahaan/kop?perusahaan=${encodeURIComponent(perusahaanId)}`);
}

// Dipakai lewat .bind(null, id); argumen (prevState, dataFormulir) dari useActionState sengaja diabaikan
export async function hapusKopSuratFormulir(id: string) {
  return jalankanFormulir(() => hapusKopSurat(id));
}

// ---------- Template per jenis dokumen ----------

type IsianTemplateBaris = { tataLetak: TataLetakCetak; ukuran: UkuranKertas; gayaAngka: GayaAngka | null; judul: string | null; tandaTanganBawaan: boolean } | null;

/** Nilai terakhir sebuah kunci (pola isian tersembunyi "0" lalu kotak centang "1"). */
function terakhir(fd: FormData, k: string): string {
  const semua = fd.getAll(k);
  const v = semua[semua.length - 1];
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Simpan template per jenis dokumen (D3 §6.1): `tataLetak_J` kosong menghapus baris (ikut tata letak umum), selain itu
 * baris di-upsert. Semua baris divalidasi dulu (galatTemplate, judul paling panjang 60), baru ditulis dalam satu
 * transaksi. Jenis yang kuncinya tidak dikirim tidak disentuh.
 */
export async function simpanTemplateCetak(kopId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("pengaturan.tulis");
  const awal = await db.kopSurat.findUnique({ where: { id: kopId }, select: { dihapusPada: true } });
  if (!awal || awal.dihapusPada) throw new Error(PESAN_KOP_TIDAK_ADA);
  const isian = new Map<JenisDokumenCetak, IsianTemplateBaris>();
  for (const j of JENIS_DOKUMEN) {
    if (!dataFormulir.has(`tataLetak_${j}`)) continue;
    const t = teks(dataFormulir, `tataLetak_${j}`);
    if (!t) {
      isian.set(j, null);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(UKURAN_SAH, t)) throw new Error("Tata letak tidak dikenal");
    const tataLetak = t as TataLetakCetak;
    const u = teks(dataFormulir, `ukuran_${j}`);
    if (u && !(SEMUA_UKURAN as readonly string[]).includes(u)) throw new Error("Ukuran kertas tidak dikenal");
    const ukuran = (u || UKURAN_SAH[tataLetak][0]) as UkuranKertas;
    const g = teks(dataFormulir, `gayaAngka_${j}`);
    if (g && g !== "TITIK" && g !== "KOMA") throw new Error("Format angka tidak dikenal");
    const judul = teks(dataFormulir, `judul_${j}`);
    if (judul.length > 60) throw new Error("Judul maksimal 60 karakter");
    const ttd = terakhir(dataFormulir, `ttd_${j}`);
    isian.set(j, { tataLetak, ukuran, gayaAngka: (g || null) as GayaAngka | null, judul: judul || null, tandaTanganBawaan: ttd === "1" || ttd === "on" });
  }

  await db.$transaction(async (tx) => {
    const kop = await kopAktif(tx, kopId);
    for (const [j, b] of isian) {
      if (!b) continue;
      const galat = galatTemplate(j, b.tataLetak, b.ukuran, kop.gayaEntitas);
      if (galat) throw new Error(galat);
    }
    const lama = new Map((await tx.templateCetak.findMany({ where: { kopSuratId: kopId } })).map((t) => [t.jenis, t]));
    const berubah: JenisDokumenCetak[] = [];
    for (const [j, b] of isian) {
      const l = lama.get(j);
      if (!b) {
        if (l) {
          await tx.templateCetak.delete({ where: { id: l.id } });
          berubah.push(j);
        }
        continue;
      }
      if (l && l.tataLetak === b.tataLetak && l.ukuran === b.ukuran && l.gayaAngka === b.gayaAngka && l.judul === b.judul && l.tandaTanganBawaan === b.tandaTanganBawaan) continue;
      await tx.templateCetak.upsert({ where: { kopSuratId_jenis: { kopSuratId: kopId, jenis: j } }, create: { kopSuratId: kopId, jenis: j, ...b }, update: b });
      berubah.push(j);
    }
    if (berubah.length) await logKop(tx, pengguna, kop, "UBAH", `Template cetak diubah: ${berubah.join(", ")}`, { jenis: berubah }, "Template Cetak");
  });
  segarkan(kopId);
}

export async function simpanTemplateCetakFormulir(kopId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => simpanTemplateCetak(kopId, dataFormulir));
}

// ---------- Hapus gambar kop ----------

/** Hapus gambar satu slot: baris AsetKopSurat dihapus dan berkasnya dibuang ke Sampah (buangSatuBerkas D7). */
export async function hapusAsetKop(kopId: string, jenis: string) {
  const pengguna = await wajibHakAksi("pengaturan.tulis");
  if (!(JENIS_ASET as readonly string[]).includes(jenis)) throw new Error("Jenis gambar tidak dikenal");
  const slot = jenis as JenisAsetKop;
  await db.$transaction(async (tx) => {
    const kop = await kopAktif(tx, kopId);
    const aset = await tx.asetKopSurat.findUnique({ where: { kopSuratId_jenis: { kopSuratId: kopId, jenis: slot } } });
    if (!aset) throw new Error(`Gambar ${LABEL_SLOT_ASET[slot].toLocaleLowerCase("id-ID")} kop ini belum diunggah`);
    await tx.asetKopSurat.delete({ where: { id: aset.id } });
    await buangSatuBerkas(tx, aset.berkasId, pengguna, { keterangan: `Gambar ${LABEL_SLOT_ASET[slot]} kop ${kop.nama} dihapus` });
    await logKop(tx, pengguna, kop, "HAPUS", `Gambar ${LABEL_SLOT_ASET[slot]} dihapus`, { jenis: slot, berkasId: aset.berkasId });
  });
  segarkan(kopId);
}

// Dipakai lewat .bind(null, kopId, jenis); argumen (prevState, dataFormulir) dari useActionState sengaja diabaikan
export async function hapusAsetKopFormulir(kopId: string, jenis: string) {
  return jalankanFormulir(() => hapusAsetKop(kopId, jenis));
}
