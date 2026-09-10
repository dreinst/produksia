import { cache } from "react";
import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import { db } from "@/lib/db";
import { D, uang, type Desimal } from "@/lib/uang";

type Klien = PrismaClient | Prisma.TransactionClient;

export type PengaturanPajak = {
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

export const PENGATURAN_BAWAAN: PengaturanPajak = {
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

/** Pengaturan perusahaan (singleton); bila belum pernah disimpan, kembalikan bawaan (non-PKP). */
// React cache(): layout dan halaman yang sama-sama memanggilnya dalam satu permintaan cukup satu kueri
export const ambilPengaturanPerusahaan = cache(async (klien: Klien = db): Promise<PengaturanPajak> => {
  const p = await klien.pengaturanPerusahaan.findUnique({ where: { id: "default" } });
  if (!p) return PENGATURAN_BAWAAN;
  return {
    nama: p.nama,
    pkp: p.pkp,
    tarifPpnPersen: D(p.tarifPpnPersen),
    terminHari: p.terminHari,
    tahunBuku: p.tahunBuku ?? new Date().getFullYear(),
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
