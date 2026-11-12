"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { pastikanHak, wajibHakAksi } from "@/lib/otentikasi";
import { catatAktivitas } from "@/lib/log";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { BATAS_UANG_D5, kunciBarisProyek } from "@/lib/keuanganProyek";
import { cariAtauBuatKategori, terapkanKategoriAnggaranBawaan } from "@/lib/kategoriAnggaran";
import { muatBarisSumber, terapkanSinkronAnggaran, type JenisSumberAnggaran } from "@/lib/sinkronAnggaran";
import { bacaUang, D, format, uang, type Desimal } from "@/lib/uang";

/*
 * Aksi anggaran proyek (D5 §3.5, §3.6, §6.2): baris anggaran, sinkron dari penawaran atau pesanan, dan samakan
 * anggaran biaya LPJ. Baris anggaran adalah anak proyek tanpa jurnal; perusahaan log = perusahaan proyek. Rute
 * /proyek/{id}/keuangan dibuat paket halaman keuangan proyek; sampai itu ada, belum ada UI yang memanggil aksi ini.
 */

const MODUL = "anggaran-proyek" as const;
const JENIS = "Anggaran Proyek";
const PANJANG_URAIAN = 200;
const PANJANG_VENDOR = 120;
const PANJANG_CATATAN = 1000;

const ruteKeuangan = (proyekId: string) => `/proyek/${proyekId}/keuangan`;
function revalidasi(proyekId: string) {
  revalidatePath(ruteKeuangan(proyekId));
  revalidatePath("/proyek/keuangan");
}

const teks = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const panjang = (s: string) => [...s].length;

type IsianBaris = { kategoriId: string; kategoriBaru: string; deskripsi: string; vendor: string | null; rencana: Desimal; catatan: string | null };

/** Isian baris anggaran (D5 §3.5); kategori diselesaikan di dalam transaksi. */
function bacaIsianBaris(fd: FormData): IsianBaris {
  const kategoriId = teks(fd, "kategoriId");
  const kategoriBaru = teks(fd, "kategoriBaru");
  if (!kategoriId && !kategoriBaru) throw new Error("Kategori wajib dipilih");
  const deskripsi = teks(fd, "deskripsi");
  if (!deskripsi) throw new Error("Uraian wajib diisi");
  if (panjang(deskripsi) > PANJANG_URAIAN) throw new Error(`Uraian maksimal ${PANJANG_URAIAN} karakter`);
  const vendor = teks(fd, "vendor") || null;
  if (vendor && panjang(vendor) > PANJANG_VENDOR) throw new Error(`Vendor maksimal ${PANJANG_VENDOR} karakter`);
  const mentah = teks(fd, "rencana");
  const rencana = mentah ? bacaUang(mentah, "Rencana biaya", { allowZero: true }) : D(0);
  if (rencana.gt(BATAS_UANG_D5)) throw new Error("Rencana biaya melebihi batas Rp 10 triliun");
  const catatan = teks(fd, "catatan") || null;
  if (catatan && panjang(catatan) > PANJANG_CATATAN) throw new Error(`Catatan maksimal ${PANJANG_CATATAN} karakter`);
  return { kategoriId, kategoriBaru, deskripsi, vendor, rencana, catatan };
}

/** kategoriBaru terisi = cari atau buat kategori itu; selain itu kategoriId wajib ada. */
async function selesaikanKategori(tx: Parameters<typeof cariAtauBuatKategori>[0], isian: IsianBaris): Promise<{ id: string; nama: string }> {
  if (isian.kategoriBaru) return cariAtauBuatKategori(tx, isian.kategoriBaru);
  const k = await tx.kategoriAnggaran.findUnique({ where: { id: isian.kategoriId }, select: { id: true, nama: true } });
  if (!k) throw new Error("Kategori tidak ditemukan");
  return k;
}

async function ambilProyek(proyekId: string) {
  const p = await db.proyek.findUnique({ where: { id: String(proyekId ?? "") }, select: { id: true, kode: true, perusahaanId: true } });
  if (!p) throw new Error("Proyek tidak ditemukan");
  return p;
}

/** Kategori bawaan diterapkan malas bila tabel kategori masih kosong (D5 §3.4). */
async function pastikanAdaKategori() {
  if ((await db.kategoriAnggaran.count()) === 0) await terapkanKategoriAnggaranBawaan(db);
}

export async function tambahBarisAnggaran(proyekId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("anggaran-proyek.buat");
  const isian = bacaIsianBaris(dataFormulir);
  const proyek = await ambilProyek(proyekId);
  await pastikanAdaKategori();
  await db.$transaction(async (tx) => {
    const kategori = await selesaikanKategori(tx, isian);
    const baris = await tx.barisAnggaranProyek.create({
      data: { proyekId: proyek.id, kategoriId: kategori.id, deskripsi: isian.deskripsi, vendor: isian.vendor, rencana: isian.rencana, catatan: isian.catatan },
    });
    await catatAktivitas(tx, pengguna, {
      aksi: "BUAT",
      jenis: JENIS,
      nomor: proyek.kode,
      keterangan: `Baris anggaran ${isian.deskripsi} (${kategori.nama}) Rp ${format(isian.rencana)}`,
      modul: MODUL,
      entitasId: proyek.id,
      meta: { barisId: baris.id, rencana: isian.rencana.toFixed(2) },
      perusahaanId: proyek.perusahaanId,
    });
  });
  revalidasi(proyek.id);
}

export async function tambahBarisAnggaranFormulir(proyekId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => tambahBarisAnggaran(proyekId, dataFormulir));
}

/** Baris harus milik proyek dari argumen terikat (padanan _item HKA). */
async function ambilBaris(proyekId: string, barisId: string) {
  const b = await db.barisAnggaranProyek.findUnique({ where: { id: String(barisId ?? "") }, select: { id: true, proyekId: true, deskripsi: true, rencana: true } });
  if (!b || b.proyekId !== proyekId) throw new Error("Baris anggaran tidak ditemukan di proyek ini");
  return b;
}

/** Ubah lima isian baris; kolom sumber (acuan, sumber, kunci, tanda, tanda hilang) tidak disentuh. */
export async function ubahBarisAnggaran(proyekId: string, barisId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("anggaran-proyek.ubah");
  const isian = bacaIsianBaris(dataFormulir);
  const proyek = await ambilProyek(proyekId);
  const lama = await ambilBaris(proyek.id, barisId);
  await db.$transaction(async (tx) => {
    const kategori = await selesaikanKategori(tx, isian);
    const { count } = await tx.barisAnggaranProyek.updateMany({
      where: { id: lama.id, proyekId: proyek.id },
      data: { kategoriId: kategori.id, deskripsi: isian.deskripsi, vendor: isian.vendor, rencana: isian.rencana, catatan: isian.catatan },
    });
    if (count !== 1) throw new Error("Baris anggaran tidak ditemukan di proyek ini");
    await catatAktivitas(tx, pengguna, {
      aksi: "UBAH",
      jenis: JENIS,
      nomor: proyek.kode,
      keterangan: `Baris anggaran ${isian.deskripsi} (${kategori.nama}) diubah`,
      modul: MODUL,
      entitasId: proyek.id,
      meta: { barisId: lama.id, rencana: { dari: D(lama.rencana).toFixed(2), ke: isian.rencana.toFixed(2) } },
      perusahaanId: proyek.perusahaanId,
    });
  });
  revalidasi(proyek.id);
  redirect(`${ruteKeuangan(proyek.id)}?tab=anggaran`);
}

export async function ubahBarisAnggaranFormulir(proyekId: string, barisId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahBarisAnggaran(proyekId, barisId, dataFormulir));
}

/** Hapus fisik; sinkron berikutnya membuat ulang baris impor yang dihapus (D5 §3.5). */
export async function hapusBarisAnggaran(proyekId: string, barisId: string) {
  const pengguna = await wajibHakAksi("anggaran-proyek.hapus");
  const proyek = await ambilProyek(proyekId);
  const lama = await ambilBaris(proyek.id, barisId);
  await db.$transaction(async (tx) => {
    const { count } = await tx.barisAnggaranProyek.deleteMany({ where: { id: lama.id, proyekId: proyek.id } });
    if (count !== 1) throw new Error("Baris anggaran tidak ditemukan di proyek ini");
    await catatAktivitas(tx, pengguna, {
      aksi: "HAPUS",
      jenis: JENIS,
      nomor: proyek.kode,
      keterangan: `Baris anggaran ${lama.deskripsi} dihapus`,
      modul: MODUL,
      entitasId: proyek.id,
      meta: { barisId: lama.id, rencana: D(lama.rencana).toFixed(2) },
      perusahaanId: proyek.perusahaanId,
    });
  });
  revalidasi(proyek.id);
}

export async function hapusBarisAnggaranFormulir(proyekId: string, barisId: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => hapusBarisAnggaran(proyekId, barisId));
}

/** Isian `sumber` = "penawaran:{id}" atau "pesanan:{id}". */
function bacaSumber(v: string): { jenis: JenisSumberAnggaran; id: string } {
  const m = /^(penawaran|pesanan):(.+)$/.exec(v);
  if (!m) throw new Error("Pilih penawaran atau pesanan sumber anggaran");
  return { jenis: m[1] as JenisSumberAnggaran, id: m[2] };
}

/**
 * Impor (panggilan pertama untuk dokumen itu) atau sinkron anggaran dari penawaran atau pesanan proyek yang sama
 * (D5 §3.6). Baris dokumen dibaca di dalam transaksi sesudah kunci baris proyek (FOR NO KEY UPDATE), sehingga dua
 * sinkron serentak berjalan bergiliran dan tidak menggandakan baris.
 */
export async function sinkronAnggaranDariDokumen(proyekId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("anggaran-proyek.buat");
  const sumber = bacaSumber(teks(dataFormulir, "sumber"));
  pastikanHak(pengguna, sumber.jenis === "penawaran" ? "penawaran.lihat" : "pesanan.lihat");
  const proyek = await ambilProyek(proyekId);
  const awal = await muatBarisSumber(db, sumber.jenis, sumber.id);
  if (!awal) throw new Error("Dokumen tidak ditemukan");
  if (awal.proyekId !== proyek.id) throw new Error(`Dokumen ${awal.nomor} bukan milik proyek ${proyek.kode}`);
  if (awal.perusahaanId !== proyek.perusahaanId) throw new Error(`Dokumen ${awal.nomor} berbeda perusahaan dengan proyek ${proyek.kode}`);
  if (awal.baris.length === 0) throw new Error(`Dokumen ${awal.nomor} tidak punya baris`);
  await pastikanAdaKategori();

  const hasil = await db.$transaction(async (tx) => {
    await kunciBarisProyek(tx, proyek.id);
    // dibaca ulang sesudah kunci: isi dan pemilik dokumen bisa berubah sejak pemeriksaan di atas
    const dok = await muatBarisSumber(tx, sumber.jenis, sumber.id);
    if (!dok) throw new Error("Dokumen tidak ditemukan");
    if (dok.proyekId !== proyek.id) throw new Error(`Dokumen ${dok.nomor} bukan milik proyek ${proyek.kode}`);
    if (dok.baris.length === 0) throw new Error(`Dokumen ${dok.nomor} tidak punya baris`);
    const h = await terapkanSinkronAnggaran(tx, proyek.id, dok, new Date());
    const keterangan = h.pertama
      ? `Impor anggaran dari ${dok.nomor}: ${h.ditambah} baris`
      : `Sinkron dengan ${dok.nomor}: ${h.diperbarui} harga berubah, ${h.ditambah} ditambah, ${h.dihapus} tidak ada lagi di dokumen`;
    await catatAktivitas(tx, pengguna, {
      aksi: h.pertama ? "IMPOR" : "SINKRON",
      jenis: JENIS,
      nomor: proyek.kode,
      keterangan,
      modul: MODUL,
      entitasId: proyek.id,
      meta: { sumber: `${dok.jenis}:${dok.id}`, ditambah: h.ditambah, diperbarui: h.diperbarui, dihapus: h.dihapus, kategoriBaru: h.kategoriBaru },
      perusahaanId: proyek.perusahaanId,
    });
    return { ...h, nomor: dok.nomor };
  });
  revalidasi(proyek.id);
  const q = new URLSearchParams({
    tab: "anggaran",
    sinkron: hasil.nomor,
    pertama: hasil.pertama ? "1" : "0",
    tambah: String(hasil.ditambah),
    ubah: String(hasil.diperbarui),
    hapus: String(hasil.dihapus),
    kategoriBaru: String(hasil.kategoriBaru.length),
  });
  redirect(`${ruteKeuangan(proyek.id)}?${q}`);
}

export async function sinkronAnggaranDariDokumenFormulir(proyekId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => sinkronAnggaranDariDokumen(proyekId, dataFormulir));
}

/**
 * Samakan anggaran biaya event (kolom lama yang dibaca LPJ) dengan total rencana anggaran (D5 §3.5). Hanya lewat
 * tombol, tidak pernah otomatis. Hak anggaran-proyek.ubah DAN data-induk.tulis.
 */
export async function samakanAnggaranBiayaProyek(proyekId: string) {
  const pengguna = await wajibHakAksi("anggaran-proyek.ubah");
  pastikanHak(pengguna, "data-induk.tulis");
  const proyek = await ambilProyek(proyekId);
  await db.$transaction(async (tx) => {
    await kunciBarisProyek(tx, proyek.id);
    const p = await tx.proyek.findUniqueOrThrow({ where: { id: proyek.id }, select: { anggaranBiaya: true } });
    const total = await tx.barisAnggaranProyek.aggregate({ where: { proyekId: proyek.id }, _sum: { rencana: true } });
    const ke = uang(total._sum.rencana);
    const dari = p.anggaranBiaya === null ? null : uang(p.anggaranBiaya);
    if (dari !== null && dari.equals(ke)) throw new Error("Anggaran biaya event sudah sama dengan total anggaran");
    await tx.proyek.update({ where: { id: proyek.id }, data: { anggaranBiaya: ke } });
    await catatAktivitas(tx, pengguna, {
      aksi: "UBAH",
      jenis: "Proyek",
      nomor: proyek.kode,
      keterangan: `Anggaran biaya event disamakan dengan total anggaran Rp ${format(ke)}`,
      modul: MODUL,
      entitasId: proyek.id,
      meta: { anggaranBiaya: { dari: dari?.toFixed(2) ?? null, ke: ke.toFixed(2) } },
      perusahaanId: proyek.perusahaanId,
    });
  });
  revalidatePath(ruteKeuangan(proyek.id));
  revalidatePath("/rekonsiliasi");
  revalidatePath(`/rekonsiliasi/event/${proyek.id}`);
}

export async function samakanAnggaranBiayaProyekFormulir(proyekId: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => samakanAnggaranBiayaProyek(proyekId));
}
