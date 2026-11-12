"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { pastikanHak, wajibHakAksi } from "@/lib/otentikasi";
import { perusahaanDokumenBaru } from "@/lib/perusahaan";
import { bacaProyekId } from "@/lib/proyek";
import { sinkronProyekLampiran } from "@/lib/berkas";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { URUTAN_STATUS_KONTEN } from "@/lib/labelPemasaran";
import { JENIS_LOG_KONTEN, catatLogPemasaran, enumWajib, idTersimpan, teksOpsional, urlKembali } from "@/lib/pemasaran";
import {
  PESAN_SUDAH_ADA_TUGAS,
  ajukanKontenInternal,
  bacaIsianKirimDesain,
  bacaIsianKonten,
  beritahuPenugasanKonten,
  buatTugasDariKonten,
  catatKontenBaru,
  catatUbahKonten,
  cekStatusKonten,
  kunciKontenAktif,
  pastikanPenanggungJawabKonten,
  terapkanStatusKonten,
  tinjauKontenInternal,
  type IsianKirimDesain,
} from "@/lib/konten";
import type { Konten } from "@/prisma-klien/client";
import type { StatusKonten } from "@/prisma-klien/enums";

/*
 * Aksi Perencana Konten (D6 §6.2). Setiap aksi memanggil wajibHakAksi lebih dulu, membaca isian di luar transaksi,
 * lalu menulis data, riwayat persetujuan, log, dan notifikasi di satu transaksi yang diawali kunci baris konten.
 * Argumen hasil .bind bisa diubah klien, jadi setiap aksi ber-id membaca ulang konten dan menolak yang sudah
 * diarsipkan. Modul ini tidak membuat jurnal (D6 §4).
 */

const RUTE_KONTEN = "/pemasaran/konten";
const RUTE_DESAIN = "/pemasaran/desain";

function revalidasiKonten(denganDesain = false) {
  revalidatePath(RUTE_KONTEN);
  if (denganDesain) revalidatePath(RUTE_DESAIN);
  revalidatePath("/");
}

/** Galat unik kunciKontenAktif (dua klik serentak) menjadi pesan yang sama dengan pemeriksaan biasa (D6 §3.1.5 no. 4). */
function terjemahkanUnikTugas(galat: unknown): never {
  const e = galat as { code?: string; meta?: { target?: unknown } };
  if (e?.code === "P2002" && JSON.stringify(e.meta?.target ?? "").includes("kunciKontenAktif")) throw new Error(PESAN_SUDAH_ADA_TUGAS);
  throw galat;
}

/** Nama bidang yang berubah antara konten lama dan data baru (untuk log UBAH; kosong = tidak ada perubahan). */
function bidangBerubah(lama: Konten, baru: Partial<Record<keyof Konten, unknown>>): string[] {
  const sama = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);
  return Object.entries(baru)
    .filter(([k, v]) => !sama(lama[k as keyof Konten], v))
    .map(([k]) => k);
}

// ---------- Buat dan ubah ----------

export async function buatKonten(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("konten.buat");
  const perusahaanId = await perusahaanDokumenBaru(dataFormulir);
  const isian = bacaIsianKonten(dataFormulir);
  const status = isian.status ?? "IDE";
  cekStatusKonten(pengguna, status, null, "formulir");
  const id = await db.$transaction(async (tx) => {
    const proyekId = await bacaProyekId(dataFormulir, tx, perusahaanId);
    const { smmId, desainerId } = await pastikanPenanggungJawabKonten(tx, isian, null);
    const konten = await tx.konten.create({
      data: {
        perusahaanId,
        judul: isian.judul,
        platform: isian.platform,
        jenisKonten: isian.jenisKonten,
        pilar: isian.pilar,
        caption: isian.caption,
        cta: isian.cta,
        tagar: isian.tagar,
        tanggalTerbit: isian.tanggalTerbit,
        jamTerbit: isian.jamTerbit,
        status,
        statusPersetujuan: status === "DISETUJUI" ? "DISETUJUI" : "TIDAK_ADA",
        smmId,
        desainerId,
        proyekId,
        briefDesain: isian.briefDesain,
        catatan: isian.catatan,
        dibuatOlehId: idTersimpan(pengguna),
        dibuatOlehNama: pengguna.nama,
      },
    });
    await catatKontenBaru(tx, konten, pengguna);
    return konten.id;
  });
  revalidasiKonten();
  redirect(urlKembali(dataFormulir, RUTE_KONTEN, { konten: id }));
}

export async function buatKontenFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatKonten(dataFormulir));
}

/**
 * Ubah konten (D6 §6.2): ganti semua isian, status lewat penjaga dan efeknya, proyek baru ikut ke tugas desain aktif
 * yang mewarisinya dan ke lampiran, lalu tindak lanjut "Simpan & ajukan persetujuan" (lanjut=ajukan) atau "Simpan &
 * kirim ke desain" (lanjut=desain) di transaksi yang sama, supaya desainer selalu membaca brief yang baru disimpan.
 */
export async function ubahKonten(id: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("konten.ubah");
  const lanjut = enumWajib(dataFormulir, "lanjut", ["", "ajukan", "desain"] as const, "", "Tindak lanjut");
  const catatanPengajuan = lanjut === "ajukan" ? teksOpsional(dataFormulir, "catatanPengajuan", "Catatan pengajuan", 1000) : null;
  let kirim: IsianKirimDesain | null = null;
  if (lanjut === "desain") {
    pastikanHak(pengguna, "tugas-desain.buat");
    kirim = bacaIsianKirimDesain(dataFormulir, "desain");
  }
  const isian = bacaIsianKonten(dataFormulir);
  try {
    await db.$transaction(async (tx) => {
      const lama = await kunciKontenAktif(tx, id);
      const ke = isian.status ?? lama.status;
      if (ke !== lama.status) cekStatusKonten(pengguna, ke, lama, "formulir");
      const proyekId = await bacaProyekId(dataFormulir, tx, lama.perusahaanId);
      const { smmId, desainerId } = await pastikanPenanggungJawabKonten(tx, isian, lama);
      const data = {
        judul: isian.judul,
        platform: isian.platform,
        jenisKonten: isian.jenisKonten,
        pilar: isian.pilar,
        caption: isian.caption,
        cta: isian.cta,
        tagar: isian.tagar,
        tanggalTerbit: isian.tanggalTerbit,
        jamTerbit: isian.jamTerbit,
        smmId,
        desainerId,
        proyekId,
        briefDesain: isian.briefDesain,
        catatan: isian.catatan,
      };
      const bidang = bidangBerubah(lama, data);
      let konten = lama;
      if (bidang.length > 0) {
        konten = await tx.konten.update({ where: { id }, data });
        await catatUbahKonten(tx, konten, pengguna, bidang);
      }
      if (proyekId !== lama.proyekId) {
        // tugas aktif ikut pindah hanya bila proyeknya memang warisan konten (D6 §3.2.5)
        const tugas = await tx.tugasDesain.findUnique({ where: { kunciKontenAktif: id }, select: { id: true, proyekId: true } });
        if (tugas && tugas.proyekId === lama.proyekId) {
          await tx.tugasDesain.update({ where: { id: tugas.id }, data: { proyekId } });
          await sinkronProyekLampiran(tx, "tugas-desain", tugas.id, proyekId);
          await sinkronProyekLampiran(tx, "hasil-desain", tugas.id, proyekId);
        }
        await sinkronProyekLampiran(tx, "konten", id, proyekId);
      }
      if (ke !== konten.status) {
        await terapkanStatusKonten(tx, konten, ke as StatusKonten, pengguna);
        konten = await kunciKontenAktif(tx, id);
      }
      await beritahuPenugasanKonten(tx, pengguna, konten, lama);
      if (lanjut === "ajukan") await ajukanKontenInternal(tx, konten, pengguna, catatanPengajuan);
      if (kirim) await buatTugasDariKonten(tx, konten, pengguna, kirim);
    });
  } catch (galat) {
    terjemahkanUnikTugas(galat);
  }
  revalidasiKonten(lanjut === "desain");
}

export async function ubahKontenFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahKonten(id, dataFormulir));
}

// ---------- Status, persetujuan, arsip ----------

/** Pindah status dari papan kanban atau tombol pindah (D6 §6.2). Tujuan Ditinjau dialihkan ke ajukan persetujuan. */
export async function pindahStatusKonten(id: string, ke: string) {
  const pengguna = await wajibHakAksi("konten.ubah");
  if (!(URUTAN_STATUS_KONTEN as readonly string[]).includes(ke)) throw new Error("Status tidak dikenal");
  await db.$transaction(async (tx) => {
    const konten = await kunciKontenAktif(tx, id);
    if (konten.status === ke) return;
    if (ke === "DITINJAU") return ajukanKontenInternal(tx, konten, pengguna, null);
    cekStatusKonten(pengguna, ke, konten, "papan");
    await terapkanStatusKonten(tx, konten, ke, pengguna);
  });
  revalidasiKonten();
}

/**
 * Prop `pindah` komponen Kanban (D4 §7.4, parameter ketiga alasan diabaikan karena konten tidak memakai dialog alasan;
 * fungsi dengan parameter lebih sedikit tetap cocok dengan tipe prop itu).
 */
export async function pindahStatusKontenDariPapan(id: string, ke: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => pindahStatusKonten(id, ke));
}

export async function ajukanKonten(id: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("konten.ubah");
  const catatan = teksOpsional(dataFormulir, "catatan", "Catatan pengajuan", 1000);
  await db.$transaction(async (tx) => {
    const konten = await kunciKontenAktif(tx, id);
    await ajukanKontenInternal(tx, konten, pengguna, catatan);
  });
  revalidasiKonten();
}

export async function ajukanKontenFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ajukanKonten(id, dataFormulir));
}

export async function tinjauKonten(id: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("konten.setujui");
  const keputusan = String(dataFormulir.get("keputusan") ?? "").trim();
  if (keputusan !== "SETUJUI" && keputusan !== "TOLAK") throw new Error("Keputusan tidak dikenal");
  const masukan = teksOpsional(dataFormulir, "masukan", "Masukan", 3000);
  if (keputusan === "TOLAK" && !masukan) throw new Error("Isi masukan atau catatan revisi saat menolak");
  await db.$transaction(async (tx) => {
    const konten = await kunciKontenAktif(tx, id);
    await tinjauKontenInternal(tx, konten, pengguna, keputusan, masukan);
  });
  revalidasiKonten();
}

export async function tinjauKontenFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => tinjauKonten(id, dataFormulir));
}

/** Arsip lunak (D6 §3.1.6): riwayat, lampiran, dan tugas desain yang tertaut tidak diubah. */
export async function arsipkanKonten(id: string) {
  const pengguna = await wajibHakAksi("konten.hapus");
  await db.$transaction(async (tx) => {
    const konten = await kunciKontenAktif(tx, id);
    await tx.konten.update({ where: { id }, data: { diarsipkanPada: new Date(), diarsipkanOlehNama: pengguna.nama } });
    await catatLogPemasaran(tx, pengguna, { modul: "konten", aksi: "ARSIP", jenis: JENIS_LOG_KONTEN, label: konten.judul, entitasId: id, keterangan: "Konten diarsipkan", perusahaanId: konten.perusahaanId });
  });
  revalidasiKonten();
  redirect(RUTE_KONTEN);
}

export async function arsipkanKontenFormulir(id: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => arsipkanKonten(id));
}

// ---------- Kirim ke desain ----------

/**
 * Kirim ke desain lewat formulir kecil (D6 §3.1.5), untuk pemegang tugas-desain.buat yang mungkin tidak punya
 * konten.ubah (mis. peran IKLAN). Hak kedua konten.lihat diperiksa sesudah hak aksi, urutan sama dengan HKA.
 */
export async function kirimKeDesain(kontenId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("tugas-desain.buat");
  pastikanHak(pengguna, "konten.lihat");
  const isian = bacaIsianKirimDesain(dataFormulir);
  try {
    await db.$transaction(async (tx) => {
      const konten = await kunciKontenAktif(tx, kontenId);
      await buatTugasDariKonten(tx, konten, pengguna, isian);
    });
  } catch (galat) {
    terjemahkanUnikTugas(galat);
  }
  revalidasiKonten(true);
}

export async function kirimKeDesainFormulir(kontenId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => kirimKeDesain(kontenId, dataFormulir));
}
