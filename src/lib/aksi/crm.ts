"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { punyaHak } from "@/lib/hakAkses";
import { pastikanHak, wajibHakAksi } from "@/lib/otentikasi";
import { perusahaanDokumenBaru } from "@/lib/perusahaan";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { formatWaktu } from "@/lib/waktu";
import type { JenisTahapLead, StatusTindakLanjut } from "@/prisma-klien/enums";
import {
  LABEL_JENIS_TAHAP,
  MAKS_SUMBER,
  MAKS_TAHAP,
  PANJANG_ALASAN,
  PANJANG_CATATAN_LEAD,
  PANJANG_CATATAN_TINDAK_LANJUT,
  PANJANG_JUDUL_TINDAK_LANJUT,
  PESAN_KODE_POLA_OTOMATIS,
  POLA_KODE_PELANGGAN_MANUAL,
  POLA_KODE_PELANGGAN_OTOMATIS,
  STATUS_TINDAK_LANJUT,
  bacaIsianLead,
  bacaJatuhTempoTindakLanjut,
  bacaJenisTahap,
  bacaNamaPengaturan,
  bedaLead,
  beritahu,
  cariPelangganMirip,
  catatAktivitasLead,
  catatLogCrm,
  kodePelangganBerikutnya,
  kunciLeadAktif,
  kunciNama,
  kunciPengaturanCrm,
  pastikanBawaanCrm,
  pastikanPenggunaCrm,
  periksaInvarianTahap,
  rapikanUrutanTahap,
  tautanLeadNotifikasi,
  tautanTindakLanjutNotifikasi,
  validasiRujukanLead,
} from "@/lib/crm";

/*
 * Aksi CRM (D4 §6.2): lead, pindah tahap, catatan, arsip dan pulihkan, konversi ke pelanggan, tindak lanjut, serta
 * pengaturan tahap pipeline dan sumber lead per perusahaan. Setiap aksi memanggil wajibHakAksi lebih dulu; versi
 * ...Formulir membungkus versi lempar dengan jalankanFormulir. Argumen hasil .bind bisa diubah klien, jadi setiap
 * aksi ber-id memeriksa ulang keberadaan, arsip, dan perusahaan barisnya. CRM tidak pernah membuat jurnal (D4 §4).
 */

const RUTE_LEAD = "/crm/lead";
const RUTE_PIPELINE = "/crm/pipeline";
const RUTE_DASBOR = "/crm/dasbor";
const RUTE_TINDAK_LANJUT = "/crm/tindak-lanjut";
const RUTE_PENGATURAN = "/crm/pengaturan";
const ruteLead = (id: string) => `/crm/lead/${id}`;

const PESAN_SUDAH_DIUBAH = "Lead ini baru saja diubah orang lain. Muat ulang halaman lalu coba lagi";
const PESAN_TERARSIP = "Lead sudah diarsipkan; pulihkan dulu";

function revalidasi(...rute: string[]) {
  for (const r of rute) revalidatePath(r);
}

/** Teks isian dipangkas (kosong = ""). */
const isian = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

// ---------- Lead ----------

export async function buatLead(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("lead.buat");
  const perusahaanId = await perusahaanDokumenBaru(dataFormulir);
  const data = bacaIsianLead(dataFormulir, "buat");
  const id = await db.$transaction(async (tx) => {
    // kunci bersama lebih dulu, baru bawaan: urutan sama dengan aksi pengaturan (kunci eksklusif lalu bawaan), jadi
    // sisipan tahap bawaan pertama kali tidak bisa saling menunggu dengan tambah tahap atau sumber (tinjauan P22 R1)
    await kunciPengaturanCrm(tx, perusahaanId, false);
    await pastikanBawaanCrm(tx, perusahaanId);
    const rujukan = await validasiRujukanLead(tx, data, { perusahaanId, pengguna });
    const tahap = rujukan.tahap!;
    const lead = await tx.lead.create({
      data: {
        perusahaanId,
        nama: data.nama,
        namaUsaha: data.namaUsaha,
        telepon: data.telepon,
        whatsapp: data.whatsapp,
        email: data.email,
        instagram: data.instagram,
        website: data.website,
        industri: data.industri,
        lokasi: data.lokasi,
        sumber: rujukan.sumber,
        picId: rujukan.picId,
        nilaiEstimasi: data.nilaiEstimasi,
        catatan: data.catatan,
        tag: data.tag,
        fieldTambahan: data.fieldTambahan,
        tahapId: tahap.id,
        dibuatOlehId: pengguna.id === "skrip-uji" ? null : pengguna.id,
        dibuatOlehNama: pengguna.nama,
      },
    });
    await catatAktivitasLead(tx, { leadId: lead.id, jenis: "DIBUAT", meta: { tahapId: tahap.id, tahapNama: tahap.nama }, pengguna });
    await beritahu(tx, pengguna, { penerima: [lead.picId], judul: "Lead baru untuk Anda", isi: `${lead.nama} · ${lead.namaUsaha}`, tautan: tautanLeadNotifikasi(lead.id), jenis: "PENUGASAN", perusahaanId });
    return lead.id;
  });
  revalidasi(RUTE_LEAD, RUTE_PIPELINE, RUTE_DASBOR);
  redirect(ruteLead(id));
}

export async function buatLeadFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatLead(dataFormulir));
}

/** Ubah isian lead tanpa tahap dan perusahaan (D4 §3.4). Tidak ada perubahan = tidak menulis apa pun. */
export async function ubahLead(leadId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("lead.ubah");
  const data = bacaIsianLead(dataFormulir, "ubah");
  await db.$transaction(async (tx) => {
    const lama = await tx.lead.findUnique({ where: { id: leadId } });
    if (!lama) throw new Error("Lead tidak ditemukan");
    if (lama.dihapusPada) throw new Error(PESAN_TERARSIP);
    const rujukan = await validasiRujukanLead(tx, data, { perusahaanId: lama.perusahaanId, leadLama: lama, pengguna });
    const baru = { ...data, sumber: rujukan.sumber, picId: rujukan.picId };
    const bidang = bedaLead(lama, baru);
    if (bidang.length === 0) return;
    const { count } = await tx.lead.updateMany({
      where: { id: leadId, dihapusPada: null, diubahPada: lama.diubahPada },
      data: {
        nama: baru.nama,
        namaUsaha: baru.namaUsaha,
        telepon: baru.telepon,
        whatsapp: baru.whatsapp,
        email: baru.email,
        instagram: baru.instagram,
        website: baru.website,
        industri: baru.industri,
        lokasi: baru.lokasi,
        sumber: baru.sumber,
        picId: baru.picId,
        nilaiEstimasi: baru.nilaiEstimasi,
        catatan: baru.catatan,
        tag: baru.tag,
        fieldTambahan: baru.fieldTambahan,
      },
    });
    if (count !== 1) throw new Error(PESAN_SUDAH_DIUBAH);
    await catatAktivitasLead(tx, { leadId, jenis: "DIUBAH", meta: { bidang }, pengguna });
    if (bidang.includes("picId") && baru.picId) {
      await beritahu(tx, pengguna, { penerima: [baru.picId], judul: "Lead dialihkan ke Anda", isi: `${baru.nama} · ${baru.namaUsaha}`, tautan: tautanLeadNotifikasi(leadId), jenis: "PENUGASAN", perusahaanId: lama.perusahaanId });
    }
  });
  revalidasi(RUTE_LEAD, ruteLead(leadId), RUTE_PIPELINE);
  redirect(ruteLead(leadId));
}

export async function ubahLeadFormulir(leadId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahLead(leadId, dataFormulir));
}

/**
 * Pindah tahap (D4 §3.3): tahap tujuan milik perusahaan lead; Kalah wajib alasan; tahap sama = tanpa menulis apa pun.
 * Update bersyarat tahap lama mencegah meta "dari" yang salah saat dua orang memindah bersamaan.
 */
export async function pindahTahapLead(leadId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("lead.ubah");
  const tahapId = isian(dataFormulir, "tahapId");
  const alasan = isian(dataFormulir, "alasan") || null;
  if (alasan && Array.from(alasan).length > PANJANG_ALASAN) throw new Error(`Alasan maksimal ${PANJANG_ALASAN} karakter`);
  const lead = await db.lead.findUnique({ where: { id: leadId }, select: { perusahaanId: true } });
  if (!lead) throw new Error("Lead tidak ditemukan");
  await db.$transaction(async (tx) => {
    await kunciPengaturanCrm(tx, lead.perusahaanId, false);
    const l = await tx.lead.findUnique({ where: { id: leadId }, include: { tahap: { select: { id: true, nama: true, jenis: true } } } });
    if (!l) throw new Error("Lead tidak ditemukan");
    if (l.dihapusPada) throw new Error(PESAN_TERARSIP);
    const ke = tahapId ? await tx.tahapLead.findFirst({ where: { id: tahapId, perusahaanId: l.perusahaanId }, select: { id: true, nama: true, jenis: true } }) : null;
    if (!ke) throw new Error("Tahap tidak ditemukan di pipeline perusahaan ini");
    if (ke.id === l.tahapId) return;
    if (ke.jenis === "KALAH" && !alasan) throw new Error("Isi alasan deal ini kalah");
    const ditutup = ke.jenis !== "BERJALAN";
    const { count } = await tx.lead.updateMany({
      where: { id: leadId, tahapId: l.tahapId, dihapusPada: null },
      data: { tahapId: ke.id, alasanMenangKalah: ditutup ? alasan : null, ditutupPada: ditutup ? new Date() : null },
    });
    if (count !== 1) throw new Error(PESAN_SUDAH_DIUBAH);
    const jenis = ke.jenis === "MENANG" ? "MENANG" : ke.jenis === "KALAH" ? "KALAH" : "TAHAP_DIUBAH";
    const meta = { dariId: l.tahap.id, dariNama: l.tahap.nama, dariJenis: l.tahap.jenis, keId: ke.id, keNama: ke.nama, keJenis: ke.jenis, alasan };
    await catatAktivitasLead(tx, { leadId, jenis, meta, pengguna });
    if (ditutup) {
      const isi = `${l.tahap.nama} → ${ke.nama}${alasan ? ` (alasan: ${alasan})` : ""}`;
      // PIC bisa kehilangan lead.lihat atau dinonaktifkan sesudah ditetapkan: periksa ulang sebelum memberi tahu (tinjauan P22 R3)
      const pic = l.picId ? await pastikanPenggunaCrm(tx, l.picId, "PIC").catch(() => null) : null;
      await beritahu(tx, pengguna, { penerima: [pic?.id], judul: `${ke.jenis === "MENANG" ? "Deal menang" : "Deal kalah"}: ${l.nama}`, isi, tautan: tautanLeadNotifikasi(leadId), jenis: "STATUS", perusahaanId: l.perusahaanId });
    }
  });
  revalidasi(ruteLead(leadId), RUTE_LEAD, RUTE_PIPELINE, RUTE_DASBOR);
}

export async function pindahTahapLeadFormulir(leadId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => pindahTahapLead(leadId, dataFormulir));
}

/** Jalur papan kanban (seret atau pilihan "Pindah ke tahap"); validasi sama persis dengan formulir. */
export async function pindahTahapLeadDariPapan(leadId: string, tahapId: string, alasan: string): Promise<StatusFormulir> {
  const fd = new FormData();
  fd.set("tahapId", String(tahapId ?? ""));
  fd.set("alasan", String(alasan ?? ""));
  return jalankanFormulir(() => pindahTahapLead(leadId, fd));
}

export async function tambahCatatanLead(leadId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("lead.ubah");
  const isi = isian(dataFormulir, "isi");
  if (!isi) throw new Error("Catatan tidak boleh kosong");
  if (Array.from(isi).length > PANJANG_CATATAN_LEAD) throw new Error(`Catatan maksimal ${PANJANG_CATATAN_LEAD} karakter`);
  await db.$transaction(async (tx) => {
    await kunciLeadAktif(tx, leadId);
    await catatAktivitasLead(tx, { leadId, jenis: "CATATAN", isi, pengguna });
  });
  revalidasi(ruteLead(leadId));
}

export async function tambahCatatanLeadFormulir(leadId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => tambahCatatanLead(leadId, dataFormulir));
}

async function namaPerusahaanLead(perusahaanId: string) {
  return (await db.perusahaan.findUnique({ where: { id: perusahaanId }, select: { nama: true } }))?.nama ?? perusahaanId;
}

export async function arsipkanLead(leadId: string) {
  const pengguna = await wajibHakAksi("lead.hapus");
  const lead = await db.lead.findUnique({ where: { id: leadId }, select: { nama: true, namaUsaha: true, perusahaanId: true, dihapusPada: true } });
  if (!lead) throw new Error("Lead tidak ditemukan");
  if (lead.dihapusPada) throw new Error("Lead sudah diarsipkan");
  const namaP = await namaPerusahaanLead(lead.perusahaanId);
  await db.$transaction(async (tx) => {
    const { count } = await tx.lead.updateMany({
      where: { id: leadId, dihapusPada: null },
      data: { dihapusPada: new Date(), dihapusOlehId: pengguna.id === "skrip-uji" ? null : pengguna.id, dihapusOlehNama: pengguna.nama },
    });
    if (count !== 1) throw new Error("Lead sudah diarsipkan");
    await catatAktivitasLead(tx, { leadId, jenis: "DIARSIPKAN", pengguna });
    await catatLogCrm(tx, pengguna, { aksi: "ARSIPKAN", jenis: "Lead", nomor: lead.nama, keterangan: `${lead.namaUsaha}; ${namaP}`, entitasId: leadId, perusahaanId: lead.perusahaanId });
  });
  revalidasi(RUTE_LEAD, RUTE_PIPELINE, RUTE_DASBOR, RUTE_TINDAK_LANJUT, ruteLead(leadId));
  redirect(RUTE_LEAD);
}

export async function arsipkanLeadFormulir(leadId: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => arsipkanLead(leadId));
}

export async function pulihkanLead(leadId: string) {
  const pengguna = await wajibHakAksi("lead.hapus");
  const lead = await db.lead.findUnique({ where: { id: leadId }, select: { nama: true, namaUsaha: true, perusahaanId: true, dihapusPada: true } });
  if (!lead) throw new Error("Lead tidak ditemukan");
  if (!lead.dihapusPada) throw new Error("Lead tidak sedang diarsipkan");
  const namaP = await namaPerusahaanLead(lead.perusahaanId);
  await db.$transaction(async (tx) => {
    const { count } = await tx.lead.updateMany({ where: { id: leadId, dihapusPada: { not: null } }, data: { dihapusPada: null, dihapusOlehId: null, dihapusOlehNama: null } });
    if (count !== 1) throw new Error("Lead tidak sedang diarsipkan");
    await catatAktivitasLead(tx, { leadId, jenis: "DIPULIHKAN", pengguna });
    await catatLogCrm(tx, pengguna, { aksi: "PULIHKAN", jenis: "Lead", nomor: lead.nama, keterangan: `${lead.namaUsaha}; ${namaP}`, entitasId: leadId, perusahaanId: lead.perusahaanId });
  });
  revalidasi(RUTE_LEAD, RUTE_PIPELINE, RUTE_DASBOR, RUTE_TINDAK_LANJUT, ruteLead(leadId));
  redirect(ruteLead(leadId));
}

export async function pulihkanLeadFormulir(leadId: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => pulihkanLead(leadId));
}

// ---------- Konversi ke pelanggan (D4 §3.7, §6.5) ----------

/** Penanda internal: lead sudah diklaim transaksi lain. Tidak pernah keluar dari aksi. */
class SudahDikonversi extends Error {}

/** P2002 pada kolom kode Pelanggan (meta adaptor memuat nama indeks atau kolom). */
function kodeBentrok(e: unknown): boolean {
  const g = e as { code?: unknown; meta?: unknown } | null;
  if (g?.code !== "P2002") return false;
  try {
    return JSON.stringify(g.meta ?? {}).includes("kode");
  } catch {
    return false;
  }
}

async function pesanKodeDipakai(kode: string) {
  const ada = await db.pelanggan.findUnique({ where: { kode }, select: { nama: true } });
  return `Kode pelanggan ${kode} sudah dipakai${ada ? ` ${ada.nama}` : ""}`;
}

async function pastikanKodePelangganBebas(kode: string) {
  if (!POLA_KODE_PELANGGAN_MANUAL.test(kode)) throw new Error("Kode pelanggan maksimal 30 karakter tanpa spasi");
  if (POLA_KODE_PELANGGAN_OTOMATIS.test(kode)) throw new Error(PESAN_KODE_POLA_OTOMATIS);
  if (await db.pelanggan.findUnique({ where: { kode }, select: { id: true } })) throw new Error(await pesanKodeDipakai(kode));
}

function tujuanSesudahKonversi(leadId: string, lanjut: string, pengguna: Parameters<typeof punyaHak>[0]) {
  return lanjut === "penawaran" && punyaHak(pengguna, "penawaran.buat") ? `/penjualan/penawaran/baru?leadId=${leadId}` : ruteLead(leadId);
}

/**
 * Konversi lead menjadi pelanggan baru. Klaim lead atomik (updateMany bersyarat pelangganId null) di transaksi yang
 * sama dengan pembuatan pelanggan: dua klik bersamaan menghasilkan tepat satu pelanggan. Lead yang sudah
 * berpelanggan dianggap sukses (idempoten).
 */
export async function konversiLeadKePelanggan(leadId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("lead.ubah");
  pastikanHak(pengguna, "data-induk.tulis");
  const kodeIsian = isian(dataFormulir, "kode");
  const abaikanMirip = dataFormulir.get("abaikanMirip") === "1";
  const lanjut = isian(dataFormulir, "lanjut");
  const lead = await db.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new Error("Lead tidak ditemukan");
  if (lead.dihapusPada) throw new Error(PESAN_TERARSIP);
  if (!lead.pelangganId) {
    if (kodeIsian) await pastikanKodePelangganBebas(kodeIsian);
    if (!abaikanMirip) {
      const mirip = await cariPelangganMirip(db, lead);
      if (mirip.length) {
        throw new Error(`Sudah ada pelanggan yang mirip: ${mirip.map((p) => `${p.kode} ${p.nama}`).join(", ")}. Tautkan lead ke pelanggan itu, atau centang "Tetap buat pelanggan baru"`);
      }
    }
    for (let coba = 1; ; coba++) {
      try {
        await db.$transaction(async (tx) => {
          const kode = kodeIsian || (await kodePelangganBerikutnya(tx));
          const penjual = lead.picId ? await tx.karyawan.findUnique({ where: { penggunaId: lead.picId }, select: { id: true } }) : null;
          const pelanggan = await tx.pelanggan.create({
            data: { kode, nama: lead.namaUsaha, namaKontak: lead.nama, email: lead.email, telepon: lead.telepon, alamat: lead.lokasi, penjualId: penjual?.id ?? null },
          });
          const { count } = await tx.lead.updateMany({ where: { id: leadId, pelangganId: null, dihapusPada: null }, data: { pelangganId: pelanggan.id, dikonversiPada: new Date() } });
          if (count !== 1) throw new SudahDikonversi();
          await catatAktivitasLead(tx, { leadId, jenis: "DIKONVERSI", meta: { pelangganId: pelanggan.id, kode, nama: pelanggan.nama, baru: true }, pengguna });
          await catatLogCrm(tx, pengguna, {
            aksi: "KONVERSI",
            jenis: "Lead",
            nomor: lead.nama,
            keterangan: `Pelanggan ${kode} ${pelanggan.nama} dibuat dari lead`,
            entitasId: leadId,
            meta: { pelangganId: pelanggan.id, kode },
            perusahaanId: lead.perusahaanId,
          });
        });
        break;
      } catch (galat) {
        if (galat instanceof SudahDikonversi) break;
        if (kodeBentrok(galat)) {
          if (!kodeIsian && coba < 3) continue;
          if (kodeIsian) throw new Error(await pesanKodeDipakai(kodeIsian));
        }
        throw galat;
      }
    }
  }
  const akhir = await db.lead.findUniqueOrThrow({ where: { id: leadId }, select: { pelangganId: true, dihapusPada: true } });
  if (!akhir.pelangganId) throw new Error(akhir.dihapusPada ? PESAN_TERARSIP : "Konversi gagal. Coba lagi");
  revalidasi(RUTE_LEAD, ruteLead(leadId), "/data-induk/pelanggan");
  redirect(tujuanSesudahKonversi(leadId, lanjut, pengguna));
}

export async function konversiLeadKePelangganFormulir(leadId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => konversiLeadKePelanggan(leadId, dataFormulir));
}

/** Tautkan lead ke pelanggan yang sudah ada; data pelanggan tidak diubah. Lead yang sudah berpelanggan: idempoten. */
export async function tautkanLeadKePelanggan(leadId: string, pelangganId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("lead.ubah");
  pastikanHak(pengguna, "data-induk.lihat");
  const lanjut = isian(dataFormulir, "lanjut");
  const lead = await db.lead.findUnique({ where: { id: leadId }, select: { nama: true, perusahaanId: true, pelangganId: true, dihapusPada: true } });
  if (!lead) throw new Error("Lead tidak ditemukan");
  if (lead.dihapusPada) throw new Error(PESAN_TERARSIP);
  if (!lead.pelangganId) {
    const pelanggan = await db.pelanggan.findUnique({ where: { id: String(pelangganId ?? "") }, select: { id: true, kode: true, nama: true } });
    if (!pelanggan) throw new Error("Pelanggan tidak ditemukan");
    await db.$transaction(async (tx) => {
      const { count } = await tx.lead.updateMany({ where: { id: leadId, pelangganId: null, dihapusPada: null }, data: { pelangganId: pelanggan.id, dikonversiPada: new Date() } });
      if (count !== 1) return;
      await catatAktivitasLead(tx, { leadId, jenis: "DIKONVERSI", meta: { pelangganId: pelanggan.id, kode: pelanggan.kode, nama: pelanggan.nama, baru: false }, pengguna });
      await catatLogCrm(tx, pengguna, {
        aksi: "TAUTKAN",
        jenis: "Lead",
        nomor: lead.nama,
        keterangan: `Ditautkan ke pelanggan ${pelanggan.kode} ${pelanggan.nama}`,
        entitasId: leadId,
        meta: { pelangganId: pelanggan.id, kode: pelanggan.kode },
        perusahaanId: lead.perusahaanId,
      });
    });
  }
  const akhir = await db.lead.findUniqueOrThrow({ where: { id: leadId }, select: { pelangganId: true, dihapusPada: true } });
  if (!akhir.pelangganId) throw new Error(akhir.dihapusPada ? PESAN_TERARSIP : "Penautan gagal. Coba lagi");
  revalidasi(RUTE_LEAD, ruteLead(leadId), "/data-induk/pelanggan");
  redirect(tujuanSesudahKonversi(leadId, lanjut, pengguna));
}

export async function tautkanLeadKePelangganFormulir(leadId: string, pelangganId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => tautkanLeadKePelanggan(leadId, pelangganId, dataFormulir));
}

// ---------- Tindak lanjut (D4 §3.5) ----------

function bacaJudul(fd: FormData) {
  const judul = isian(fd, "judul");
  if (!judul) throw new Error("Judul pengingat wajib diisi");
  if (Array.from(judul).length > PANJANG_JUDUL_TINDAK_LANJUT) throw new Error(`Judul pengingat maksimal ${PANJANG_JUDUL_TINDAK_LANJUT} karakter`);
  return judul;
}

function bacaCatatanTindakLanjut(fd: FormData) {
  const catatan = isian(fd, "catatan") || null;
  if (catatan && Array.from(catatan).length > PANJANG_CATATAN_TINDAK_LANJUT) throw new Error(`Catatan maksimal ${PANJANG_CATATAN_TINDAK_LANJUT} karakter`);
  return catatan;
}

const RUTE_TINDAK_LANJUT_SEMUA = (leadId: string | null) => [RUTE_TINDAK_LANJUT, RUTE_DASBOR, ...(leadId ? [ruteLead(leadId)] : [])];

export async function buatTindakLanjut(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("lead.buat");
  const judul = bacaJudul(dataFormulir);
  const jatuhTempo = bacaJatuhTempoTindakLanjut(dataFormulir.get("jatuhTempo"));
  const catatan = bacaCatatanTindakLanjut(dataFormulir);
  const leadId = isian(dataFormulir, "leadId") || null;
  const penerimaIsian = isian(dataFormulir, "ditugaskanKeId");
  // perusahaan dari lead (isian perusahaanId diabaikan); tanpa lead lewat perusahaanDokumenBaru
  const perusahaanTanpaLead = leadId ? null : await perusahaanDokumenBaru(dataFormulir);
  await db.$transaction(async (tx) => {
    const lead = leadId ? await kunciLeadAktif(tx, leadId) : null;
    const perusahaanId = lead ? lead.perusahaanId : perusahaanTanpaLead!;
    let penerima: string;
    if (penerimaIsian) penerima = (await pastikanPenggunaCrm(tx, penerimaIsian, "Penerima tindak lanjut")).id;
    else {
      const sendiri = pengguna.id === "skrip-uji" ? null : await pastikanPenggunaCrm(tx, pengguna.id, "Penerima tindak lanjut").catch(() => null);
      if (!sendiri) throw new Error("Pilih penerima tindak lanjut");
      penerima = sendiri.id;
    }
    const t = await tx.tindakLanjut.create({
      data: { perusahaanId, leadId, judul, jatuhTempo, catatan, ditugaskanKeId: penerima, dibuatOlehId: pengguna.id === "skrip-uji" ? null : pengguna.id, dibuatOlehNama: pengguna.nama },
    });
    if (leadId) await catatAktivitasLead(tx, { leadId, jenis: "TINDAK_LANJUT_DIJADWALKAN", meta: { tindakLanjutId: t.id, judul, jatuhTempo: jatuhTempo.toISOString() }, pengguna });
    await beritahu(tx, pengguna, {
      penerima: [penerima],
      judul: "Tindak lanjut untuk Anda",
      isi: `${judul} · jatuh tempo ${formatWaktu(jatuhTempo)}`,
      tautan: tautanTindakLanjutNotifikasi(leadId),
      jenis: "PENUGASAN",
      perusahaanId,
    });
  });
  revalidasi(...RUTE_TINDAK_LANJUT_SEMUA(leadId));
}

export async function buatTindakLanjutFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatTindakLanjut(dataFormulir));
}

/**
 * Tindak lanjut di dalam transaksi: ada, dan bila berlead, lead tidak terarsip (lead dikunci FOR SHARE supaya arsip
 * menunggu). Mengembalikan baris tindak lanjut.
 */
async function tindakLanjutTerbuka(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], id: string) {
  const t = await tx.tindakLanjut.findUnique({ where: { id: String(id ?? "") } });
  if (!t) throw new Error("Tindak lanjut tidak ditemukan");
  if (t.leadId) {
    await tx.$queryRaw`SELECT 1 FROM "Lead" WHERE "id" = ${t.leadId} FOR SHARE`;
    const lead = await tx.lead.findUnique({ where: { id: t.leadId }, select: { dihapusPada: true } });
    if (lead?.dihapusPada) throw new Error("Lead tindak lanjut ini sudah diarsipkan");
  }
  return t;
}

/**
 * Ubah judul, jatuh tempo, catatan, penerima. Jatuh tempo atau penerima berubah = pengingat dikirim lagi
 * (diingatkanPada null), supaya penerima baru tetap diingatkan walau penerima lama sudah (tinjauan P22 S1).
 */
export async function ubahTindakLanjut(id: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("lead.ubah");
  const judul = bacaJudul(dataFormulir);
  const jatuhTempo = bacaJatuhTempoTindakLanjut(dataFormulir.get("jatuhTempo"));
  const catatan = bacaCatatanTindakLanjut(dataFormulir);
  const penerimaIsian = isian(dataFormulir, "ditugaskanKeId");
  const leadId = await db.$transaction(async (tx) => {
    const t = await tindakLanjutTerbuka(tx, id);
    const penerima = penerimaIsian ? (await pastikanPenggunaCrm(tx, penerimaIsian, "Penerima tindak lanjut")).id : t.ditugaskanKeId;
    const jatuhTempoBerubah = t.jatuhTempo.getTime() !== jatuhTempo.getTime();
    const penerimaBerubah = penerima !== t.ditugaskanKeId;
    await tx.tindakLanjut.update({
      where: { id: t.id },
      data: { judul, jatuhTempo, catatan, ditugaskanKeId: penerima, ...(jatuhTempoBerubah || penerimaBerubah ? { diingatkanPada: null } : {}) },
    });
    if (penerima && penerima !== t.ditugaskanKeId) {
      await beritahu(tx, pengguna, {
        penerima: [penerima],
        judul: "Tindak lanjut dialihkan ke Anda",
        isi: `${judul} · jatuh tempo ${formatWaktu(jatuhTempo)}`,
        tautan: tautanTindakLanjutNotifikasi(t.leadId),
        jenis: "PENUGASAN",
        perusahaanId: t.perusahaanId,
      });
    }
    return t.leadId;
  });
  revalidasi(...RUTE_TINDAK_LANJUT_SEMUA(leadId));
}

export async function ubahTindakLanjutFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahTindakLanjut(id, dataFormulir));
}

/** Status MENUNGGU, SELESAI, DIBATALKAN ke segala arah; sama = tanpa menulis apa pun. */
export async function ubahStatusTindakLanjut(id: string, status: string) {
  const pengguna = await wajibHakAksi("lead.ubah");
  if (!(STATUS_TINDAK_LANJUT as readonly string[]).includes(String(status))) throw new Error("Status tindak lanjut tidak dikenal");
  const ke = status as StatusTindakLanjut;
  const leadId = await db.$transaction(async (tx) => {
    const t = await tindakLanjutTerbuka(tx, id);
    if (t.status === ke) return t.leadId;
    const { count } = await tx.tindakLanjut.updateMany({ where: { id: t.id, status: t.status }, data: { status: ke, selesaiPada: ke === "SELESAI" ? new Date() : null } });
    if (count !== 1) throw new Error("Tindak lanjut ini baru saja diubah orang lain. Muat ulang halaman lalu coba lagi");
    if (t.leadId) await catatAktivitasLead(tx, { leadId: t.leadId, jenis: "TINDAK_LANJUT_STATUS", meta: { tindakLanjutId: t.id, judul: t.judul, dari: t.status, ke }, pengguna });
    return t.leadId;
  });
  revalidasi(...RUTE_TINDAK_LANJUT_SEMUA(leadId));
}

export async function ubahStatusTindakLanjutFormulir(id: string, status: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => ubahStatusTindakLanjut(id, status));
}

export async function hapusTindakLanjut(id: string) {
  const pengguna = await wajibHakAksi("lead.hapus");
  const leadId = await db.$transaction(async (tx) => {
    const t = await tindakLanjutTerbuka(tx, id);
    const lead = t.leadId ? await tx.lead.findUnique({ where: { id: t.leadId }, select: { nama: true } }) : null;
    await tx.tindakLanjut.delete({ where: { id: t.id } });
    await catatLogCrm(tx, pengguna, {
      aksi: "HAPUS",
      jenis: "Tindak Lanjut",
      nomor: t.judul,
      keterangan: `Jatuh tempo ${formatWaktu(t.jatuhTempo)}; ${lead ? `lead ${lead.nama}` : "tanpa lead"}`,
      entitasId: t.id,
      perusahaanId: t.perusahaanId,
    });
    return t.leadId;
  });
  revalidasi(...RUTE_TINDAK_LANJUT_SEMUA(leadId));
}

export async function hapusTindakLanjutFormulir(id: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => hapusTindakLanjut(id));
}

// ---------- Pengaturan tahap pipeline dan sumber lead (D4 §3.2) ----------

const RUTE_PENGATURAN_TAHAP = [RUTE_PENGATURAN, RUTE_PIPELINE, RUTE_LEAD, RUTE_DASBOR];

async function kodePerusahaan(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], perusahaanId: string) {
  return (await tx.perusahaan.findUnique({ where: { id: perusahaanId }, select: { kode: true } }))?.kode ?? perusahaanId;
}

/** Nama tahap belum dipakai tahap lain perusahaan itu (tanpa beda huruf besar). */
async function pastikanNamaTahapBebas(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], perusahaanId: string, nama: string, kecualiId?: string) {
  const daftar = await tx.tahapLead.findMany({ where: { perusahaanId, ...(kecualiId ? { id: { not: kecualiId } } : {}) }, select: { nama: true } });
  if (daftar.some((t) => kunciNama(t.nama) === kunciNama(nama))) throw new Error(`Nama tahap "${nama}" sudah dipakai`);
}

/** Tambah tahap: Berjalan disisipkan setelah tahap Berjalan terakhir; Menang dan Kalah di akhir. */
export async function tambahTahapLead(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("pengaturan-crm.ubah");
  const perusahaanId = await perusahaanDokumenBaru(dataFormulir);
  const nama = bacaNamaPengaturan(dataFormulir.get("nama"), "tahap");
  const jenis = bacaJenisTahap(dataFormulir.get("jenis"));
  await db.$transaction(async (tx) => {
    await kunciPengaturanCrm(tx, perusahaanId, true);
    await pastikanBawaanCrm(tx, perusahaanId);
    const daftar = await tx.tahapLead.findMany({ where: { perusahaanId }, orderBy: [{ urutan: "asc" }, { id: "asc" }], select: { id: true, jenis: true, urutan: true } });
    if (daftar.length >= MAKS_TAHAP) throw new Error(`Pipeline maksimal ${MAKS_TAHAP} tahap`);
    await pastikanNamaTahapBebas(tx, perusahaanId, nama);
    const berjalanTerakhir = daftar.filter((t) => t.jenis === "BERJALAN").at(-1);
    const urutan = jenis === "BERJALAN" ? (berjalanTerakhir ? berjalanTerakhir.urutan + 1 : 1) : daftar.length + 1;
    await tx.tahapLead.updateMany({ where: { perusahaanId, urutan: { gte: urutan } }, data: { urutan: { increment: 1 } } });
    const t = await tx.tahapLead.create({ data: { perusahaanId, nama, jenis, urutan } });
    await rapikanUrutanTahap(tx, perusahaanId);
    await periksaInvarianTahap(tx, perusahaanId);
    const akhir = await tx.tahapLead.findUniqueOrThrow({ where: { id: t.id }, select: { urutan: true } });
    await catatLogCrm(tx, pengguna, {
      aksi: "BUAT",
      jenis: "Tahap Pipeline",
      nomor: nama,
      keterangan: `${await kodePerusahaan(tx, perusahaanId)}: jenis ${LABEL_JENIS_TAHAP[jenis]}, urutan ${akhir.urutan}`,
      entitasId: t.id,
      perusahaanId,
    });
  });
  revalidasi(...RUTE_PENGATURAN_TAHAP);
}

export async function tambahTahapLeadFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => tambahTahapLead(dataFormulir));
}

/** Tahap dibaca dari basis data (perusahaan dari baris tahap, bukan dari klien) lalu dikunci pengaturan perusahaannya. */
async function tahapTerkunci(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], id: string) {
  const awal = await tx.tahapLead.findUnique({ where: { id: String(id ?? "") }, select: { perusahaanId: true } });
  if (!awal) throw new Error("Tahap tidak ditemukan");
  await kunciPengaturanCrm(tx, awal.perusahaanId, true);
  const t = await tx.tahapLead.findUnique({ where: { id: String(id) } });
  if (!t) throw new Error("Tahap tidak ditemukan");
  return t;
}

/** Ubah nama dan jenis. Jenis tahap yang dipakai lead mana pun (termasuk terarsip) tidak bisa diubah. */
export async function ubahTahapLead(id: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("pengaturan-crm.ubah");
  const nama = bacaNamaPengaturan(dataFormulir.get("nama"), "tahap");
  const jenis = bacaJenisTahap(dataFormulir.get("jenis"));
  await db.$transaction(async (tx) => {
    const t = await tahapTerkunci(tx, id);
    if (nama === t.nama && jenis === t.jenis) return;
    if (jenis !== t.jenis) {
      const dipakai = await tx.lead.count({ where: { tahapId: t.id } });
      if (dipakai > 0) throw new Error(`Jenis tahap ${t.nama} tidak bisa diubah karena masih dipakai ${dipakai} lead. Pindahkan lead itu ke tahap lain dulu`);
    }
    if (nama !== t.nama) await pastikanNamaTahapBebas(tx, t.perusahaanId, nama, t.id);
    await tx.tahapLead.update({ where: { id: t.id }, data: { nama, jenis } });
    await periksaInvarianTahap(tx, t.perusahaanId);
    const rincian = [nama !== t.nama ? `nama "${t.nama}" → "${nama}"` : null, `jenis ${jenis !== t.jenis ? `${LABEL_JENIS_TAHAP[t.jenis]} → ` : ""}${LABEL_JENIS_TAHAP[jenis]}`].filter(Boolean).join("; ");
    await catatLogCrm(tx, pengguna, { aksi: "UBAH", jenis: "Tahap Pipeline", nomor: nama, keterangan: `${await kodePerusahaan(tx, t.perusahaanId)}: ${rincian}`, entitasId: t.id, perusahaanId: t.perusahaanId });
  });
  revalidasi(...RUTE_PENGATURAN_TAHAP);
}

export async function ubahTahapLeadFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahTahapLead(id, dataFormulir));
}

/** Geser tahap satu langkah (tukar urutan dengan tetangga). */
export async function geserTahapLead(id: string, arah: string) {
  const pengguna = await wajibHakAksi("pengaturan-crm.ubah");
  if (arah !== "naik" && arah !== "turun") throw new Error("Arah geser tidak dikenal");
  await db.$transaction(async (tx) => {
    const t = await tahapTerkunci(tx, id);
    await rapikanUrutanTahap(tx, t.perusahaanId);
    const daftar = await tx.tahapLead.findMany({ where: { perusahaanId: t.perusahaanId }, orderBy: [{ urutan: "asc" }, { id: "asc" }], select: { id: true, urutan: true } });
    const i = daftar.findIndex((x) => x.id === t.id);
    const j = arah === "naik" ? i - 1 : i + 1;
    if (j < 0) throw new Error("Tahap sudah paling atas");
    if (j >= daftar.length) throw new Error("Tahap sudah paling bawah");
    await tx.tahapLead.update({ where: { id: daftar[i].id }, data: { urutan: daftar[j].urutan } });
    await tx.tahapLead.update({ where: { id: daftar[j].id }, data: { urutan: daftar[i].urutan } });
    await periksaInvarianTahap(tx, t.perusahaanId);
    await catatLogCrm(tx, pengguna, {
      aksi: "GESER",
      jenis: "Tahap Pipeline",
      nomor: t.nama,
      keterangan: `${await kodePerusahaan(tx, t.perusahaanId)}: urutan ${daftar[i].urutan} → ${daftar[j].urutan}`,
      entitasId: t.id,
      perusahaanId: t.perusahaanId,
    });
  });
  revalidasi(...RUTE_PENGATURAN_TAHAP);
}

export async function geserTahapLeadFormulir(id: string, arah: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => geserTahapLead(id, arah));
}

/** Hapus tahap yang tidak dipakai lead mana pun (termasuk terarsip); urutan dirapikan lagi. */
export async function hapusTahapLead(id: string) {
  const pengguna = await wajibHakAksi("pengaturan-crm.ubah");
  await db.$transaction(async (tx) => {
    const t = await tahapTerkunci(tx, id);
    const [aktif, terarsip] = await Promise.all([tx.lead.count({ where: { tahapId: t.id, dihapusPada: null } }), tx.lead.count({ where: { tahapId: t.id, dihapusPada: { not: null } } })]);
    if (aktif + terarsip > 0) {
      throw new Error(`Tahap ${t.nama} masih dipakai ${aktif + terarsip} lead${terarsip > 0 ? ` (${terarsip} terarsip)` : ""}, tidak bisa dihapus. Pindahkan lead itu ke tahap lain dulu`);
    }
    await tx.tahapLead.delete({ where: { id: t.id } });
    await rapikanUrutanTahap(tx, t.perusahaanId);
    await periksaInvarianTahap(tx, t.perusahaanId);
    await catatLogCrm(tx, pengguna, {
      aksi: "HAPUS",
      jenis: "Tahap Pipeline",
      nomor: t.nama,
      keterangan: `${await kodePerusahaan(tx, t.perusahaanId)}: jenis ${LABEL_JENIS_TAHAP[t.jenis as JenisTahapLead]}, urutan ${t.urutan}`,
      entitasId: t.id,
      perusahaanId: t.perusahaanId,
    });
  });
  revalidasi(...RUTE_PENGATURAN_TAHAP);
}

export async function hapusTahapLeadFormulir(id: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => hapusTahapLead(id));
}

export async function tambahSumberLead(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("pengaturan-crm.ubah");
  const perusahaanId = await perusahaanDokumenBaru(dataFormulir);
  const nama = bacaNamaPengaturan(dataFormulir.get("nama"), "sumber");
  await db.$transaction(async (tx) => {
    await kunciPengaturanCrm(tx, perusahaanId, true);
    await pastikanBawaanCrm(tx, perusahaanId);
    const daftar = await tx.sumberLead.findMany({ where: { perusahaanId }, select: { nama: true, urutan: true } });
    if (daftar.some((x) => kunciNama(x.nama) === kunciNama(nama))) throw new Error(`Sumber "${nama}" sudah ada`);
    if (daftar.length >= MAKS_SUMBER) throw new Error(`Maksimal ${MAKS_SUMBER} sumber lead`);
    const s = await tx.sumberLead.create({ data: { perusahaanId, nama, urutan: Math.max(0, ...daftar.map((x) => x.urutan)) + 1 } });
    await catatLogCrm(tx, pengguna, { aksi: "BUAT", jenis: "Sumber Lead", nomor: nama, keterangan: await kodePerusahaan(tx, perusahaanId), entitasId: s.id, perusahaanId });
  });
  revalidasi(RUTE_PENGATURAN);
}

export async function tambahSumberLeadFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => tambahSumberLead(dataFormulir));
}

/** Hapus sumber; lead yang memakainya tetap menyimpan teksnya. Sumber terakhir tidak bisa dihapus. */
export async function hapusSumberLead(id: string) {
  const pengguna = await wajibHakAksi("pengaturan-crm.ubah");
  await db.$transaction(async (tx) => {
    const awal = await tx.sumberLead.findUnique({ where: { id: String(id ?? "") }, select: { perusahaanId: true } });
    if (!awal) throw new Error("Sumber lead tidak ditemukan");
    await kunciPengaturanCrm(tx, awal.perusahaanId, true);
    const s = await tx.sumberLead.findUnique({ where: { id: String(id) } });
    if (!s) throw new Error("Sumber lead tidak ditemukan");
    if ((await tx.sumberLead.count({ where: { perusahaanId: s.perusahaanId } })) <= 1) throw new Error("Minimal satu sumber lead");
    await tx.sumberLead.delete({ where: { id: s.id } });
    await catatLogCrm(tx, pengguna, { aksi: "HAPUS", jenis: "Sumber Lead", nomor: s.nama, keterangan: await kodePerusahaan(tx, s.perusahaanId), entitasId: s.id, perusahaanId: s.perusahaanId });
  });
  revalidasi(RUTE_PENGATURAN);
}

export async function hapusSumberLeadFormulir(id: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => hapusSumberLead(id));
}
