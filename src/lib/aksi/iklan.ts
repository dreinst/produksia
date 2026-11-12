"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHakAksi } from "@/lib/otentikasi";
import { perusahaanDokumenBaru } from "@/lib/perusahaan";
import { bacaProyekId } from "@/lib/proyek";
import { berkasTersembunyi, bolehAksesBerkas, ruangTersembunyi, sinkronProyekLampiran } from "@/lib/berkas";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { STATUS_KAMPANYE } from "@/lib/labelPemasaran";
import { JENIS_LOG_KAMPANYE, catatLogPemasaran } from "@/lib/pemasaran";
import { bacaIsianIklan, bacaIsianKampanye, bacaIsianMetrik, bacaIsianSetIklan, kunciKampanyeAktif, rentangHariLaporan } from "@/lib/iklan";
import { formatTanggal, tanggalIso } from "@/lib/waktu";
import type { PenggunaSesi } from "@/lib/hakAkses";
import type { Kampanye, Prisma } from "@/prisma-klien/client";

/*
 * Aksi Perencana Iklan Meta (D6 §6.4): kampanye, set iklan, iklan, dan laporan harian. Setiap aksi memanggil wajibHakAksi
 * lebih dulu. Aksi anak memastikan kampanye induknya aktif dan, untuk aksi ber-id anak, membaca kampanyeId dari basis
 * data (argumen .bind bisa diubah klien, S06 §7.3). Data iklan diketik manual tanpa integrasi API Meta, tidak menjurnal,
 * dan tidak mengirim notifikasi (D6 §3.3 no. 9).
 */

type Klien = Prisma.TransactionClient;

const RUTE_IKLAN = "/pemasaran/iklan";
const ruteKampanye = (id: string) => `${RUTE_IKLAN}/${id}`;

function revalidasiIklan(kampanyeId?: string | null) {
  revalidatePath(RUTE_IKLAN);
  if (kampanyeId) revalidatePath(ruteKampanye(kampanyeId));
  revalidatePath("/");
}

type JenisLogIklan = typeof JENIS_LOG_KAMPANYE | "Set Iklan" | "Iklan" | "Laporan Iklan";

function logIklan(tx: Klien, pengguna: PenggunaSesi, kampanye: Pick<Kampanye, "id" | "perusahaanId">, l: { aksi: string; jenis: JenisLogIklan; label: string; entitasId: string; keterangan: string; meta?: Prisma.InputJsonValue }) {
  return catatLogPemasaran(tx, pengguna, { modul: "kampanye", aksi: l.aksi, jenis: l.jenis, label: l.label, entitasId: l.entitasId, keterangan: l.keterangan, meta: l.meta ?? (l.jenis === JENIS_LOG_KAMPANYE ? undefined : { kampanyeId: kampanye.id }), perusahaanId: kampanye.perusahaanId });
}

function bidangBerubah<T extends object>(lama: T, baru: Partial<Record<keyof T, unknown>>): string[] {
  const sama = (a: unknown, b: unknown) => {
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (a && b && typeof a === "object" && typeof b === "object" && "equals" in a && typeof (a as { equals: unknown }).equals === "function") return (a as { equals: (x: unknown) => boolean }).equals(b);
    return a === b;
  };
  return Object.entries(baru)
    .filter(([k, v]) => !sama(lama[k as keyof T], v))
    .map(([k]) => k);
}

const P2002 = (e: unknown) => (e as { code?: string })?.code === "P2002";

// ---------- Kampanye ----------

export async function buatKampanye(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("kampanye.buat");
  const perusahaanId = await perusahaanDokumenBaru(dataFormulir);
  const isian = bacaIsianKampanye(dataFormulir);
  const id = await db.$transaction(async (tx) => {
    const proyekId = await bacaProyekId(dataFormulir, tx, perusahaanId);
    const k = await tx.kampanye.create({ data: { ...isian, perusahaanId, proyekId, dibuatOlehNama: pengguna.nama } });
    await logIklan(tx, pengguna, k, { aksi: "BUAT", jenis: JENIS_LOG_KAMPANYE, label: k.nama, entitasId: k.id, keterangan: `Kampanye dibuat berstatus ${STATUS_KAMPANYE[k.status].label}` });
    return k.id;
  });
  revalidasiIklan();
  redirect(ruteKampanye(id));
}

export async function buatKampanyeFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatKampanye(dataFormulir));
}

/** Ubah kampanye (perusahaan tidak bisa diubah). Status berubah dicatat STATUS; proyek berubah memindah lampiran. */
export async function ubahKampanye(id: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("kampanye.ubah");
  const isian = bacaIsianKampanye(dataFormulir);
  await db.$transaction(async (tx) => {
    const lama = await kunciKampanyeAktif(tx, id, true);
    const proyekId = await bacaProyekId(dataFormulir, tx, lama.perusahaanId);
    const data = { ...isian, proyekId };
    const bidang = bidangBerubah(lama, data);
    if (bidang.length === 0) return;
    const k = await tx.kampanye.update({ where: { id }, data });
    if (proyekId !== lama.proyekId) await sinkronProyekLampiran(tx, "kampanye", id, proyekId);
    const lainnya = bidang.filter((b) => b !== "status");
    if (lama.status !== k.status) {
      await logIklan(tx, pengguna, k, { aksi: "STATUS", jenis: JENIS_LOG_KAMPANYE, label: k.nama, entitasId: id, keterangan: `Status ${STATUS_KAMPANYE[lama.status].label} ke ${STATUS_KAMPANYE[k.status].label}`, meta: { dari: lama.status, ke: k.status } });
    }
    if (lainnya.length > 0) await logIklan(tx, pengguna, k, { aksi: "UBAH", jenis: JENIS_LOG_KAMPANYE, label: k.nama, entitasId: id, keterangan: `Diubah: ${lainnya.join(", ")}`, meta: { bidang: lainnya } });
  });
  revalidasiIklan(id);
  redirect(ruteKampanye(id));
}

export async function ubahKampanyeFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahKampanye(id, dataFormulir));
}

/** Arsip lunak (D6 §3.3 no. 8): set iklan, iklan, dan laporan tidak diubah tetapi ikut tersembunyi. */
export async function arsipkanKampanye(id: string) {
  const pengguna = await wajibHakAksi("kampanye.hapus");
  await db.$transaction(async (tx) => {
    const k = await kunciKampanyeAktif(tx, id, true);
    await tx.kampanye.update({ where: { id }, data: { diarsipkanPada: new Date(), diarsipkanOlehNama: pengguna.nama } });
    await logIklan(tx, pengguna, k, { aksi: "ARSIP", jenis: JENIS_LOG_KAMPANYE, label: k.nama, entitasId: id, keterangan: "Kampanye diarsipkan" });
  });
  revalidasiIklan(id);
  redirect(RUTE_IKLAN);
}

export async function arsipkanKampanyeFormulir(id: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => arsipkanKampanye(id));
}

// ---------- Set iklan ----------

/** Set iklan beserta kampanye aktifnya; kampanyeId dibaca dari basis data. */
async function setIklanAktif(tx: Klien, id: string) {
  const s = await tx.setIklan.findUnique({ where: { id } });
  if (!s) throw new Error("Set iklan tidak ditemukan");
  const kampanye = await kunciKampanyeAktif(tx, s.kampanyeId);
  return { s, kampanye };
}

export async function buatSetIklan(kampanyeId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("kampanye.buat");
  const isian = bacaIsianSetIklan(dataFormulir);
  await db.$transaction(async (tx) => {
    const kampanye = await kunciKampanyeAktif(tx, kampanyeId);
    const s = await tx.setIklan.create({ data: { ...isian, kampanyeId: kampanye.id } });
    await logIklan(tx, pengguna, kampanye, { aksi: "BUAT", jenis: "Set Iklan", label: s.nama, entitasId: s.id, keterangan: `Set iklan ditambahkan ke kampanye ${kampanye.nama}` });
  });
  revalidasiIklan(kampanyeId);
}

export async function buatSetIklanFormulir(kampanyeId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatSetIklan(kampanyeId, dataFormulir));
}

/** Ubah set iklan; kampanyenya tidak bisa diganti (menutup S04 §11.1 no. 7). */
export async function ubahSetIklan(id: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("kampanye.ubah");
  const isian = bacaIsianSetIklan(dataFormulir);
  let kampanyeId = "";
  await db.$transaction(async (tx) => {
    const { s, kampanye } = await setIklanAktif(tx, id);
    kampanyeId = kampanye.id;
    const bidang = bidangBerubah(s, isian);
    if (bidang.length === 0) return;
    await tx.setIklan.update({ where: { id }, data: isian });
    await logIklan(tx, pengguna, kampanye, { aksi: "UBAH", jenis: "Set Iklan", label: isian.nama, entitasId: id, keterangan: `Diubah: ${bidang.join(", ")}` });
  });
  revalidasiIklan(kampanyeId);
}

export async function ubahSetIklanFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahSetIklan(id, dataFormulir));
}

const PESAN_SET_MASIH_BERISI = "Hapus atau pindahkan iklan di set iklan ini dulu";

/** Hapus fisik set iklan; ditolak bila masih berisi iklan (FK Restrict sebagai pengaman). */
export async function hapusSetIklan(id: string) {
  const pengguna = await wajibHakAksi("kampanye.hapus");
  let kampanyeId = "";
  try {
    await db.$transaction(async (tx) => {
      const { s, kampanye } = await setIklanAktif(tx, id);
      kampanyeId = kampanye.id;
      if ((await tx.iklan.count({ where: { setIklanId: id } })) > 0) throw new Error(PESAN_SET_MASIH_BERISI);
      await tx.setIklan.delete({ where: { id } });
      await logIklan(tx, pengguna, kampanye, { aksi: "HAPUS", jenis: "Set Iklan", label: s.nama, entitasId: id, keterangan: `Set iklan dihapus dari kampanye ${kampanye.nama}` });
    });
  } catch (galat) {
    const kode = (galat as { code?: string })?.code;
    if (kode === "P2003") throw new Error(PESAN_SET_MASIH_BERISI);
    throw galat;
  }
  revalidasiIklan(kampanyeId);
}

export async function hapusSetIklanFormulir(id: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => hapusSetIklan(id));
}

// ---------- Iklan ----------

const PESAN_KREATIF_TIDAK_ADA = "Berkas kreatif tidak ditemukan";

/**
 * Berkas kreatif (D6 §3.3 no. 3): berkas ada, belum dibuang, milik perusahaan kampanye, dan terlihat bagi pelaku
 * (bolehAksesBerkas lihat serta tidak di folder atau proyek yang tersembunyi baginya). Semua kegagalan memakai pesan
 * yang sama supaya keberadaan berkas lain tidak terbaca.
 */
async function pastikanKreatif(tx: Klien, pengguna: PenggunaSesi, berkasId: string, kampanye: Pick<Kampanye, "perusahaanId">): Promise<void> {
  const b = await tx.berkas.findUnique({ where: { id: berkasId }, select: { id: true, perusahaanId: true, jenisEntitas: true, folderKode: true, proyekId: true, dihapusPada: true, isiDihapusPada: true } });
  if (!b || b.dihapusPada || b.isiDihapusPada || b.perusahaanId !== kampanye.perusahaanId) throw new Error(PESAN_KREATIF_TIDAK_ADA);
  if (!bolehAksesBerkas(pengguna, b, "lihat") || berkasTersembunyi(b, await ruangTersembunyi(tx, pengguna))) throw new Error(PESAN_KREATIF_TIDAK_ADA);
}

/** Set iklan tujuan harus milik kampanye yang sama. */
async function pastikanSetMilik(tx: Klien, setIklanId: string, kampanyeId: string): Promise<void> {
  const s = await tx.setIklan.findUnique({ where: { id: setIklanId }, select: { kampanyeId: true } });
  if (!s || s.kampanyeId !== kampanyeId) throw new Error("Set iklan ini bukan milik kampanye tersebut");
}

export async function buatIklan(kampanyeId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("kampanye.buat");
  const isian = bacaIsianIklan(dataFormulir);
  await db.$transaction(async (tx) => {
    const kampanye = await kunciKampanyeAktif(tx, kampanyeId);
    await pastikanSetMilik(tx, isian.setIklanId, kampanye.id);
    if (isian.berkasKreatifId) await pastikanKreatif(tx, pengguna, isian.berkasKreatifId, kampanye);
    const i = await tx.iklan.create({ data: isian });
    await logIklan(tx, pengguna, kampanye, { aksi: "BUAT", jenis: "Iklan", label: i.nama, entitasId: i.id, keterangan: `Iklan ditambahkan ke kampanye ${kampanye.nama}` });
  });
  revalidasiIklan(kampanyeId);
}

export async function buatIklanFormulir(kampanyeId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatIklan(kampanyeId, dataFormulir));
}

/** Ubah iklan; boleh pindah ke set iklan lain di kampanye yang sama. Kreatif yang tidak berubah tidak diperiksa ulang. */
export async function ubahIklan(id: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("kampanye.ubah");
  const isian = bacaIsianIklan(dataFormulir);
  let kampanyeId = "";
  await db.$transaction(async (tx) => {
    const lama = await tx.iklan.findUnique({ where: { id }, include: { setIklan: { select: { kampanyeId: true } } } });
    if (!lama) throw new Error("Iklan tidak ditemukan");
    const kampanye = await kunciKampanyeAktif(tx, lama.setIklan.kampanyeId);
    kampanyeId = kampanye.id;
    await pastikanSetMilik(tx, isian.setIklanId, kampanye.id);
    if (isian.berkasKreatifId && isian.berkasKreatifId !== lama.berkasKreatifId) await pastikanKreatif(tx, pengguna, isian.berkasKreatifId, kampanye);
    const bidang = bidangBerubah(lama, isian);
    if (bidang.length === 0) return;
    await tx.iklan.update({ where: { id }, data: isian });
    await logIklan(tx, pengguna, kampanye, { aksi: "UBAH", jenis: "Iklan", label: isian.nama, entitasId: id, keterangan: `Diubah: ${bidang.join(", ")}` });
  });
  revalidasiIklan(kampanyeId);
}

export async function ubahIklanFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahIklan(id, dataFormulir));
}

export async function hapusIklan(id: string) {
  const pengguna = await wajibHakAksi("kampanye.hapus");
  let kampanyeId = "";
  await db.$transaction(async (tx) => {
    const i = await tx.iklan.findUnique({ where: { id }, include: { setIklan: { select: { kampanyeId: true } } } });
    if (!i) throw new Error("Iklan tidak ditemukan");
    const kampanye = await kunciKampanyeAktif(tx, i.setIklan.kampanyeId);
    kampanyeId = kampanye.id;
    await tx.iklan.delete({ where: { id } });
    await logIklan(tx, pengguna, kampanye, { aksi: "HAPUS", jenis: "Iklan", label: i.nama, entitasId: id, keterangan: `Iklan dihapus dari kampanye ${kampanye.nama}` });
  });
  revalidasiIklan(kampanyeId);
}

export async function hapusIklanFormulir(id: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => hapusIklan(id));
}

// ---------- Laporan harian ----------

const pesanLaporanGanda = (tanggal: Date) => `Laporan tanggal ${formatTanggal(tanggal)} untuk kampanye ini sudah ada. Ubah laporan yang ada.`;

/** Satu laporan per kampanye per tanggal (P-65): diperiksa dengan rentang hari, @@unique sebagai pengaman. */
async function pastikanTanggalBebas(tx: Klien, kampanyeId: string, tanggal: Date, kecualiId?: string): Promise<void> {
  const ada = await tx.metrikIklan.findFirst({ where: { kampanyeId, tanggal: rentangHariLaporan(tanggal), ...(kecualiId ? { id: { not: kecualiId } } : {}) }, select: { id: true } });
  if (ada) throw new Error(pesanLaporanGanda(tanggal));
}

export async function catatMetrikIklan(kampanyeId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("kampanye.buat");
  const isian = bacaIsianMetrik(dataFormulir);
  try {
    await db.$transaction(async (tx) => {
      // kunci eksklusif kampanye: dua laporan bertanggal sama yang dikirim serentak diperiksa bergiliran
      const kampanye = await kunciKampanyeAktif(tx, kampanyeId, true);
      await pastikanTanggalBebas(tx, kampanye.id, isian.tanggal);
      const m = await tx.metrikIklan.create({ data: { ...isian, kampanyeId: kampanye.id, dicatatOlehNama: pengguna.nama } });
      await logIklan(tx, pengguna, kampanye, { aksi: "BUAT", jenis: "Laporan Iklan", label: tanggalIso(m.tanggal), entitasId: m.id, keterangan: `Laporan harian kampanye ${kampanye.nama} dicatat` });
    });
  } catch (galat) {
    if (P2002(galat)) throw new Error(pesanLaporanGanda(isian.tanggal));
    throw galat;
  }
  revalidasiIklan(kampanyeId);
}

export async function catatMetrikIklanFormulir(kampanyeId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => catatMetrikIklan(kampanyeId, dataFormulir));
}

/** Ubah laporan: semua isian diganti, termasuk nilai manual yang dikosongkan (kembali dihitung otomatis). */
export async function ubahMetrikIklan(id: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("kampanye.ubah");
  const isian = bacaIsianMetrik(dataFormulir);
  let kampanyeId = "";
  try {
    await db.$transaction(async (tx) => {
      const lama = await tx.metrikIklan.findUnique({ where: { id } });
      if (!lama) throw new Error("Laporan iklan tidak ditemukan");
      const kampanye = await kunciKampanyeAktif(tx, lama.kampanyeId, true);
      kampanyeId = kampanye.id;
      await pastikanTanggalBebas(tx, kampanye.id, isian.tanggal, id);
      const bidang = bidangBerubah(lama, isian);
      if (bidang.length === 0) return;
      await tx.metrikIklan.update({ where: { id }, data: isian });
      await logIklan(tx, pengguna, kampanye, { aksi: "UBAH", jenis: "Laporan Iklan", label: tanggalIso(isian.tanggal), entitasId: id, keterangan: `Diubah: ${bidang.join(", ")}` });
    });
  } catch (galat) {
    if (P2002(galat)) throw new Error(pesanLaporanGanda(isian.tanggal));
    throw galat;
  }
  revalidasiIklan(kampanyeId);
}

export async function ubahMetrikIklanFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahMetrikIklan(id, dataFormulir));
}

export async function hapusMetrikIklan(id: string) {
  const pengguna = await wajibHakAksi("kampanye.hapus");
  let kampanyeId = "";
  await db.$transaction(async (tx) => {
    const m = await tx.metrikIklan.findUnique({ where: { id } });
    if (!m) throw new Error("Laporan iklan tidak ditemukan");
    const kampanye = await kunciKampanyeAktif(tx, m.kampanyeId, true);
    kampanyeId = kampanye.id;
    await tx.metrikIklan.delete({ where: { id } });
    await logIklan(tx, pengguna, kampanye, { aksi: "HAPUS", jenis: "Laporan Iklan", label: tanggalIso(m.tanggal), entitasId: id, keterangan: `Laporan harian kampanye ${kampanye.nama} dihapus` });
  });
  revalidasiIklan(kampanyeId);
}

export async function hapusMetrikIklanFormulir(id: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => hapusMetrikIklan(id));
}
