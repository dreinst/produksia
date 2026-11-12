"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHakAksi } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { perusahaanDokumenBaru } from "@/lib/perusahaan";
import { bacaProyekId } from "@/lib/proyek";
import { sinkronProyekLampiran } from "@/lib/berkas";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { URUTAN_STATUS_DESAIN } from "@/lib/labelPemasaran";
import { enumWajib, teksOpsional, urlKembali } from "@/lib/pemasaran";
import {
  PESAN_CATATAN_REVISI_WAJIB,
  PESAN_KONTEN_SUDAH_ADA_TUGAS,
  PESAN_TUGAS_BERUBAH,
  PESAN_TUGAS_TIDAK_ADA,
  SYARAT_TUGAS_AKTIF,
  ajukanTinjauanInternal,
  bacaIsianTugas,
  bacaRujukanTugas,
  galatUnikKunciKonten,
  catatLogTugas,
  catatPenugasanDesainer,
  cekStatusDesain,
  kunciTugasAktif,
  mintaRevisiInternal,
  naikkanKontenKeDesain,
  pastikanDesainerTugas,
  setujuiDesainInternal,
  terapkanStatusDesain,
} from "@/lib/desain";
import type { TugasDesain } from "@/prisma-klien/client";
import type { StatusTugasDesain } from "@/prisma-klien/enums";

/*
 * Aksi Tugas Desain (D6 §6.3). Setiap aksi memanggil wajibHakAksi lebih dulu, membaca isian di luar transaksi, lalu
 * menulis tugas, riwayat revisi, log, dan notifikasi N5 sampai N10 di satu transaksi. Urutan kunci sama dengan aksi
 * konten: konten yang ditaut lebih dulu, baru baris tugas. Modul ini tidak membuat jurnal (D6 §4).
 */

const RUTE_DESAIN = "/pemasaran/desain";
const PESAN_KOSONGKAN_DESAINER = "Kosongkan desainer untuk mengembalikan ke Permintaan";
const PANJANG_CATATAN_REVISI = 3000;

function revalidasiDesain(kampanyeId?: string | null) {
  revalidatePath(RUTE_DESAIN);
  revalidatePath("/pemasaran/konten");
  if (kampanyeId) revalidatePath(`/pemasaran/iklan/${kampanyeId}`);
  revalidatePath("/");
}

/** Galat unik kunciKontenAktif (dua penautan serentak) menjadi pesan yang sama dengan pemeriksaan biasa. */
function terjemahkanUnikTugas(galat: unknown): never {
  if (galatUnikKunciKonten(galat)) throw new Error(PESAN_KONTEN_SUDAH_ADA_TUGAS);
  throw galat;
}

function bidangBerubah(lama: TugasDesain, baru: Partial<Record<keyof TugasDesain, unknown>>): string[] {
  const sama = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);
  return Object.entries(baru)
    .filter(([k, v]) => !sama(lama[k as keyof TugasDesain], v))
    .map(([k]) => k);
}

// ---------- Buat dan ubah ----------

/**
 * Buat tugas desain manual (D6 §6.3): perusahaan dan proyek kosong diwarisi dari konten lalu kampanye terkait, desainer
 * yang diisi menjadikan status Permintaan sebagai Ditugaskan, konten yang ditaut naik ke Desain, dan peninjau yang
 * membuat langsung Disetujui mencatat revisi #0 beserta N8 dan N10.
 */
export async function buatTugasDesain(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("tugas-desain.buat");
  const isian = bacaIsianTugas(dataFormulir);
  const statusMasukan = isian.status ?? "PERMINTAAN";
  cekStatusDesain(pengguna, statusMasukan, "formulir");
  let id = "";
  let kampanyeId: string | null = null;
  try {
    id = await db.$transaction(async (tx) => {
      const { konten, kampanye } = await bacaRujukanTugas(tx, pengguna, isian);
      kampanyeId = kampanye?.id ?? null;
      // anak mewarisi perusahaan induknya; isian perusahaan hanya dipakai tugas tanpa konten dan kampanye (D6 §3.0 no. 5)
      const induk = konten ?? kampanye;
      const perusahaanId = induk ? induk.perusahaanId : await perusahaanDokumenBaru(dataFormulir, tx);
      const proyekId = (await bacaProyekId(dataFormulir, tx, perusahaanId)) ?? konten?.proyekId ?? kampanye?.proyekId ?? null;
      const desainerId = await pastikanDesainerTugas(tx, isian.desainerId);
      const statusAwal: StatusTugasDesain = desainerId && (statusMasukan === "PERMINTAAN" || statusMasukan === "DISETUJUI") ? "DITUGASKAN" : statusMasukan === "DISETUJUI" ? "PERMINTAAN" : statusMasukan;
      const tugas = await tx.tugasDesain.create({
        data: {
          perusahaanId,
          judul: isian.judul,
          deskripsi: isian.deskripsi,
          prioritas: isian.prioritas,
          tenggat: isian.tenggat,
          status: statusAwal,
          desainerId,
          kontenId: konten?.id ?? null,
          kunciKontenAktif: konten?.id ?? null,
          kampanyeId,
          proyekId,
          sumber: "MANUAL",
          dibuatOlehNama: pengguna.nama,
        },
      });
      await catatLogTugas(tx, pengguna, tugas, "BUAT", "Permintaan desain dibuat", { kontenId: tugas.kontenId, kampanyeId: tugas.kampanyeId });
      await catatPenugasanDesainer(tx, pengguna, tugas, null);
      if (konten) await naikkanKontenKeDesain(tx, pengguna, konten);
      if (statusMasukan === "DISETUJUI") await setujuiDesainInternal(tx, tugas, pengguna, null);
      return tugas.id;
    });
  } catch (galat) {
    terjemahkanUnikTugas(galat);
  }
  revalidasiDesain(kampanyeId);
  redirect(urlKembali(dataFormulir, RUTE_DESAIN, { tugas: id }));
}

export async function buatTugasDesainFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatTugasDesain(dataFormulir));
}

/**
 * Ubah tugas desain (D6 §6.3): ganti semua isian, status lewat penjaga, desainer berganti dicatat TUGASKAN dengan N5,
 * konten baru ditaut dikunci lalu dinaikkan, proyek berubah memindah lampiran (referensi dan hasil), lalu "Simpan &
 * ajukan untuk ditinjau" (lanjut=tinjau) di transaksi yang sama.
 */
export async function ubahTugasDesain(id: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("tugas-desain.ubah");
  const lanjut = enumWajib(dataFormulir, "lanjut", ["", "tinjau"] as const, "", "Tindak lanjut");
  const isian = bacaIsianTugas(dataFormulir);
  let kampanyeId: string | null = null;
  try {
    await db.$transaction(async (tx) => {
      const awal = await tx.tugasDesain.findFirst({ where: { id, ...SYARAT_TUGAS_AKTIF }, select: { id: true, kontenId: true, kampanyeId: true, perusahaanId: true } });
      if (!awal) throw new Error(PESAN_TUGAS_TIDAK_ADA);
      // konten yang baru ditaut dikunci di bacaRujukanTugas sebelum baris tugas, urutan kunci sama dengan ubahKonten
      const rujukan = await bacaRujukanTugas(tx, pengguna, isian, { lama: awal });
      const lama = await kunciTugasAktif(tx, id);
      if (lama.kontenId !== awal.kontenId || lama.kampanyeId !== awal.kampanyeId) throw new Error(PESAN_TUGAS_BERUBAH);
      const proyekId = await bacaProyekId(dataFormulir, tx, lama.perusahaanId);
      const desainerId = await pastikanDesainerTugas(tx, isian.desainerId, lama);
      const kontenId = rujukan.konten?.id ?? null;
      // Melepas atau mengganti konten yang kuncinya dipegang tugas ini membuka penjaga "desain harus disetujui dulu" di
      // konten lama, jadi butuh hak yang sama kuatnya dengan arsip tugas atau tinjauan (perbaikan tinjauan P41 S1).
      if (lama.kunciKontenAktif && kontenId !== lama.kontenId && !punyaHak(pengguna, "tugas-desain.hapus") && !punyaHak(pengguna, "tugas-desain.setujui")) {
        throw new Error("Hanya peninjau desain yang boleh melepas atau mengganti konten terkait tugas ini");
      }
      // Tugas yang sudah Disetujui atau Selesai dipindah ke konten lain belum pernah ditinjau untuk konten itu: kembali
      // ke Ditugaskan (Permintaan bila tanpa desainer) lewat terapkanStatusDesain, dengan log STATUS dan N7.
      const tinjauUlang = !!kontenId && kontenId !== lama.kontenId && (lama.status === "DISETUJUI" || lama.status === "SELESAI");
      const statusIsian = tinjauUlang ? (desainerId ? "DITUGASKAN" : "PERMINTAAN") : (isian.status ?? lama.status);
      // desainer diisi pada tugas yang memang masih Permintaan: disimpan Ditugaskan tanpa N7 (N5 penugasan sudah
      // memberi tahu). Status lama selain Permintaan mengikuti jalur biasa (perbaikan tinjauan P41 S2).
      const otomatis = !!desainerId && statusIsian === "PERMINTAAN" && lama.status === "PERMINTAAN";
      // Permintaan dengan desainer terisi tidak boleh tersimpan (D6 §3.2.2), jadi tugas yang sudah lewat Permintaan
      // hanya bisa kembali ke sana sesudah desainernya dikosongkan (perbaikan tinjauan P43 R2)
      if (!!desainerId && statusIsian === "PERMINTAAN" && lama.status !== "PERMINTAAN") throw new Error(PESAN_KOSONGKAN_DESAINER);
      const ke = otomatis ? "DITUGASKAN" : statusIsian;
      if (ke !== lama.status && !otomatis) cekStatusDesain(pengguna, ke, "formulir");
      kampanyeId = rujukan.kampanye?.id ?? null;
      const data = {
        judul: isian.judul,
        deskripsi: isian.deskripsi,
        prioritas: isian.prioritas,
        tenggat: isian.tenggat,
        desainerId,
        kontenId,
        kunciKontenAktif: kontenId,
        kampanyeId,
        proyekId,
        ...(otomatis ? { status: "DITUGASKAN" as const } : {}),
      };
      const bidang = bidangBerubah(lama, data);
      let tugas = lama;
      if (bidang.length > 0) {
        tugas = await tx.tugasDesain.update({ where: { id }, data });
        await catatLogTugas(tx, pengguna, tugas, "UBAH", `Diubah: ${bidang.join(", ")}`, { bidang });
        if (otomatis && lama.status !== "DITUGASKAN") await catatLogTugas(tx, pengguna, tugas, "STATUS", "Status Permintaan ke Ditugaskan karena desainer diisi", { dari: lama.status, ke: "DITUGASKAN" });
      }
      if (proyekId !== lama.proyekId) {
        await sinkronProyekLampiran(tx, "tugas-desain", id, proyekId);
        await sinkronProyekLampiran(tx, "hasil-desain", id, proyekId);
      }
      await catatPenugasanDesainer(tx, pengguna, tugas, lama.desainerId);
      if (rujukan.konten && kontenId !== lama.kontenId) await naikkanKontenKeDesain(tx, pengguna, rujukan.konten);
      if (!otomatis && ke !== tugas.status) {
        await terapkanStatusDesain(tx, tugas, ke as StatusTugasDesain, pengguna);
        tugas = await kunciTugasAktif(tx, id);
      }
      if (lanjut === "tinjau") await ajukanTinjauanInternal(tx, tugas, pengguna);
    });
  } catch (galat) {
    terjemahkanUnikTugas(galat);
  }
  revalidasiDesain(kampanyeId);
}

export async function ubahTugasDesainFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahTugasDesain(id, dataFormulir));
}

// ---------- Status, tinjauan, arsip ----------

/**
 * Pindah status dari papan atau tombol pindah (D6 §3.2.2): Ditinjau lewat ajukan tinjauan, Disetujui lewat setujui
 * langsung, Revisi lewat minta revisi dengan `catatan` dari dialog kolom Revisi.
 */
export async function pindahStatusDesain(id: string, ke: string, catatan?: string | null) {
  const pengguna = await wajibHakAksi("tugas-desain.ubah");
  if (!(URUTAN_STATUS_DESAIN as readonly string[]).includes(ke)) throw new Error("Status tidak dikenal");
  const isiCatatan = catatan?.trim() || null;
  if (isiCatatan && isiCatatan.length > PANJANG_CATATAN_REVISI) throw new Error(`Catatan revisi maksimal ${PANJANG_CATATAN_REVISI} karakter`);
  let kampanyeId: string | null = null;
  await db.$transaction(async (tx) => {
    const tugas = await kunciTugasAktif(tx, id);
    kampanyeId = tugas.kampanyeId;
    if (tugas.status === ke) return;
    if (ke === "DITINJAU") return ajukanTinjauanInternal(tx, tugas, pengguna);
    if (ke === "PERMINTAAN" && tugas.desainerId) throw new Error(PESAN_KOSONGKAN_DESAINER);
    cekStatusDesain(pengguna, ke, "papan", isiCatatan);
    await terapkanStatusDesain(tx, tugas, ke, pengguna, isiCatatan);
  });
  revalidasiDesain(kampanyeId);
}

/** Prop `pindah` komponen Kanban (D4 §7.4): `alasan` = catatan dialog kolom Revisi. */
export async function pindahStatusDesainDariPapan(id: string, ke: string, alasan: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => pindahStatusDesain(id, ke, alasan));
}

export async function ajukanTinjauanDesain(id: string) {
  const pengguna = await wajibHakAksi("tugas-desain.ubah");
  let kampanyeId: string | null = null;
  await db.$transaction(async (tx) => {
    const tugas = await kunciTugasAktif(tx, id);
    kampanyeId = tugas.kampanyeId;
    await ajukanTinjauanInternal(tx, tugas, pengguna);
  });
  revalidasiDesain(kampanyeId);
}

export async function ajukanTinjauanDesainFormulir(id: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => ajukanTinjauanDesain(id));
}

/** Tinjau desain (D6 §3.2.4): hanya dari Ditinjau; SETUJUI atau REVISI dengan catatan wajib. */
export async function tinjauDesain(id: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("tugas-desain.setujui");
  const keputusan = String(dataFormulir.get("keputusan") ?? "").trim();
  if (keputusan !== "SETUJUI" && keputusan !== "REVISI") throw new Error("Keputusan tidak dikenal");
  const catatan = teksOpsional(dataFormulir, "catatan", "Catatan revisi", PANJANG_CATATAN_REVISI);
  let kampanyeId: string | null = null;
  await db.$transaction(async (tx) => {
    const tugas = await kunciTugasAktif(tx, id);
    kampanyeId = tugas.kampanyeId;
    if (tugas.status !== "DITINJAU") throw new Error("Pindahkan tugas ke Ditinjau dulu sebelum menyetujui atau meminta revisi");
    if (keputusan === "REVISI" && !catatan) throw new Error(PESAN_CATATAN_REVISI_WAJIB);
    if (keputusan === "SETUJUI") await setujuiDesainInternal(tx, tugas, pengguna, catatan);
    else await mintaRevisiInternal(tx, tugas, pengguna, catatan);
  });
  revalidasiDesain(kampanyeId);
}

export async function tinjauDesainFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => tinjauDesain(id, dataFormulir));
}

/** Arsip lunak (D6 §3.2.5): kunci konten dilepas, jadi konten boleh dikirim ke desain lagi dan diajukan tanpa syarat. */
export async function arsipkanTugasDesain(id: string) {
  const pengguna = await wajibHakAksi("tugas-desain.hapus");
  let kampanyeId: string | null = null;
  await db.$transaction(async (tx) => {
    const tugas = await kunciTugasAktif(tx, id);
    kampanyeId = tugas.kampanyeId;
    const baru = await tx.tugasDesain.update({ where: { id }, data: { diarsipkanPada: new Date(), diarsipkanOlehNama: pengguna.nama, kunciKontenAktif: null } });
    await catatLogTugas(tx, pengguna, baru, "ARSIP", "Tugas desain diarsipkan");
  });
  revalidasiDesain(kampanyeId);
  redirect(RUTE_DESAIN);
}

export async function arsipkanTugasDesainFormulir(id: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => arsipkanTugasDesain(id));
}
