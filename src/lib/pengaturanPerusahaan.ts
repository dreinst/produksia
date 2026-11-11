import { cache } from "react";
import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import { db } from "@/lib/db";
import { D, uang, type Desimal } from "@/lib/uang";

type Klien = PrismaClient | Prisma.TransactionClient;

export type PengaturanPajak = {
  /** Perusahaan pemilik pengaturan ini (D1 §3.6) */
  perusahaanId: string;
  nama: string;
  pkp: boolean;
  tarifPpnPersen: Desimal;
  terminHari: number;
  /** Tahun buku yang dibuka (sudah diselesaikan: bila tidak diatur = tahun kalender) */
  tahunBuku: number;
  akunPpnKeluaranId: string | null;
  akunPpnMasukanId: string | null;
  akunPph23DimukaId: string | null;
  akunPph23DipotongId: string | null;
  /** PPh Final UMKM: tarif % dari omzet bulanan + akun beban & hutangnya */
  pphFinalPersen: Desimal;
  akunBebanPphFinalId: string | null;
  akunHutangPphFinalId: string | null;
};

/** id perusahaan utama; sama dengan PERUSAHAAN_UTAMA di perusahaan.ts (tidak diimpor supaya berkas ini tidak memuat sesi) */
const UTAMA = "utama";

export const PENGATURAN_BAWAAN: PengaturanPajak = {
  perusahaanId: UTAMA,
  nama: "Produksia",
  pkp: false,
  tarifPpnPersen: D(11),
  terminHari: 14,
  tahunBuku: new Date().getFullYear(),
  akunPpnKeluaranId: null,
  akunPpnMasukanId: null,
  akunPph23DimukaId: null,
  akunPph23DipotongId: null,
  pphFinalPersen: D("0.5"),
  akunBebanPphFinalId: null,
  akunHutangPphFinalId: null,
};

/**
 * id baris PengaturanPerusahaan milik perusahaan: utama selalu "default" (kompatibel dengan kode dan uji lama yang
 * memakai where: { id: "default" }), perusahaan lain ber-id sama dengan perusahaanId. Semua tulisan baru memakai
 * upsert({ where: { id: idPengaturan(p) }, create: { id: idPengaturan(p), perusahaanId: p, ... } }).
 */
export function idPengaturan(perusahaanId: string): string {
  return perusahaanId === UTAMA ? "default" : perusahaanId;
}

/**
 * Pengaturan pajak satu perusahaan (D1 §3.6), bawaan perusahaan utama (baris "default").
 * - Utama tanpa baris: PENGATURAN_BAWAAN (perilaku lama).
 * - Perusahaan lain tanpa baris: bawaan non-PKP dengan nama perusahaan, dan enam akun pajak milik baris "default".
 * - tahunBuku selalu dari baris "default" (global).
 */
// React cache(): layout dan halaman yang sama-sama memanggilnya dalam satu permintaan cukup satu kueri
export const ambilPengaturanPerusahaan = cache(async (klien: Klien = db, perusahaanId: string = UTAMA): Promise<PengaturanPajak> => {
  const utama = perusahaanId === UTAMA;
  const [p, global] = await Promise.all([
    // utama dibaca lewat id "default" persis seperti sebelumnya
    klien.pengaturanPerusahaan.findUnique({ where: utama ? { id: "default" } : { perusahaanId } }),
    utama ? null : klien.pengaturanPerusahaan.findUnique({ where: { id: "default" } }),
  ]);
  const tahunGlobal = (utama ? p : global)?.tahunBuku ?? new Date().getFullYear();
  if (!p) {
    if (utama) return PENGATURAN_BAWAAN;
    const perusahaan = await klien.perusahaan.findUnique({ where: { id: perusahaanId }, select: { nama: true } });
    if (!perusahaan) throw new Error("Perusahaan tidak ditemukan");
    return {
      ...PENGATURAN_BAWAAN,
      perusahaanId,
      nama: perusahaan.nama,
      tahunBuku: tahunGlobal,
      akunPpnKeluaranId: global?.akunPpnKeluaranId ?? null,
      akunPpnMasukanId: global?.akunPpnMasukanId ?? null,
      akunPph23DimukaId: global?.akunPph23DimukaId ?? null,
      akunPph23DipotongId: global?.akunPph23DipotongId ?? null,
      akunBebanPphFinalId: global?.akunBebanPphFinalId ?? null,
      akunHutangPphFinalId: global?.akunHutangPphFinalId ?? null,
    };
  }
  return {
    perusahaanId,
    nama: p.nama,
    pkp: p.pkp,
    tarifPpnPersen: D(p.tarifPpnPersen),
    terminHari: p.terminHari,
    tahunBuku: tahunGlobal,
    akunPpnKeluaranId: p.akunPpnKeluaranId,
    akunPpnMasukanId: p.akunPpnMasukanId,
    akunPph23DimukaId: p.akunPph23DimukaId,
    akunPph23DipotongId: p.akunPph23DipotongId,
    pphFinalPersen: D(p.pphFinalPersen),
    akunBebanPphFinalId: p.akunBebanPphFinalId,
    akunHutangPphFinalId: p.akunHutangPphFinalId,
  };
});

/** Membaca tarif PPN yang diminta formulir dan memastikannya sah untuk status PKP perusahaan. */
export function bacaTarifPpn(nilai: FormDataEntryValue | null, pengaturan: PengaturanPajak): Desimal {
  const teks = typeof nilai === "string" ? nilai.trim() : "";
  const tarif = teks === "" ? (pengaturan.pkp ? pengaturan.tarifPpnPersen : D(0)) : uang(teks);
  if (tarif.isNegative() || tarif.gt(100)) throw new Error("Tarif PPN harus antara 0 dan 100 persen");
  if (tarif.gt(0) && !pengaturan.pkp) throw new Error("Perusahaan belum PKP. Aktifkan di Pengaturan, Perusahaan & Pajak");
  return tarif;
}

export function hitungPpn(dpp: Desimal, tarifPersen: Desimal): Desimal {
  return uang(dpp.mul(tarifPersen).div(100));
}

export function tanggalJatuhTempo(terminHari: number, dari: Date = new Date()): Date {
  return new Date(dari.getTime() + terminHari * 24 * 60 * 60 * 1000);
}
