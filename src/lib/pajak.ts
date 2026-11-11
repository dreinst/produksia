import { Prisma, type PrismaClient } from "@/prisma-klien/client";
import { D, jumlahkan, uang, type Desimal } from "@/lib/uang";
import { ZONA_WAKTU, akarDari, keturunanDari, type AkunSaldo } from "@/lib/laporan";
import { ambilPengaturanPerusahaan, type PengaturanPajak } from "@/lib/pengaturanPerusahaan";

/*
 * Ringkasan pajak per bulan. Omzet usaha (dasar PPh Final 0,5%, PP 55/2022 Pasal 60: "sebelum dikurangi potongan penjualan")
 * dibaca dari BUKU BESAR: semua akun jenis PENDAPATAN kecuali kelompok Diskon Penjualan (kontra) dan kelompok
 * Pendapatan Lain-lain (bunga bank, laba pelepasan aset: sudah kena pajak final sendiri / bukan penghasilan usaha).
 * Dengan begitu pendapatan yang dicatat lewat Kas Masuk atau jurnal umum (tanpa faktur) tetap ikut omzet, dan diskon
 * tidak mengurangi omzet. `omzetFaktur` = bagian dari dokumen (Σ bruto faktur − retur), `omzetLain` = sisanya.
 * PPN keluaran/masukan (bila PKP) dan PPh 23 tetap dari dokumen. Dipakai halaman Pajak & SPT dan aksi catatPphFinal.
 */
type Klien = PrismaClient | Prisma.TransactionClient;

export type PajakBulan = {
  periode: string; // YYYY-MM
  bulan: number;
  /** omzet bruto usaha (buku besar), dasar PPh Final */
  omzet: Desimal;
  /** bagian omzet yang berasal dari faktur penjualan − retur (bruto sebelum diskon) */
  omzetFaktur: Desimal;
  /** omzet di luar faktur: kas masuk / jurnal umum langsung ke akun pendapatan usaha */
  omzetLain: Desimal;
  ppnKeluaran: Desimal;
  ppnMasukan: Desimal;
  ppnKurangBayar: Desimal;
  pph23DipotongKlien: Desimal;
  pph23KitaPotong: Desimal;
  pphFinal: Desimal;
  /**
   * PPh Final yang sudah dicatat untuk periode itu. Tanpa perusahaan (gabungan) satu periode bisa punya catatan di
   * beberapa perusahaan: jumlah dan omzet dijumlah, id = catatan pertama, nomorJurnal hanya bila catatannya tunggal.
   */
  tercatat: { id: string; jumlah: Desimal; omzet: Desimal; tarifPersen: Desimal; nomorJurnal: string | null; jumlahCatatan: number } | null;
};
export type RingkasanPajak = {
  tahun: number;
  tarifPphFinal: Desimal;
  bulan: PajakBulan[];
  total: Pick<PajakBulan, "omzet" | "omzetFaktur" | "omzetLain" | "ppnKeluaran" | "ppnMasukan" | "ppnKurangBayar" | "pph23DipotongKlien" | "pph23KitaPotong" | "pphFinal">;
  totalPphFinalTercatat: Desimal;
};

export const periodeBulan = (tahun: number, bulan: number) => `${tahun}-${String(bulan).padStart(2, "0")}`;
export function batasBulan(tahun: number, bulan: number): { dari: Date; sampai: Date } {
  return { dari: new Date(tahun, bulan - 1, 1, 0, 0, 0, 0), sampai: new Date(tahun, bulan, 0, 23, 59, 59, 999) };
}
export function hitungPphFinal(omzet: Desimal, tarifPersen: Desimal): Desimal {
  return omzet.lte(0) ? D(0) : uang(omzet.mul(tarifPersen).div(100));
}

/**
 * `perusahaanId` diisi: dokumen, catatan PPh Final, dan omzet buku besar hanya milik perusahaan itu (D1 §4.7).
 * Kosong: semua perusahaan (perilaku lama).
 */
export async function ringkasanPajak(klien: Klien, tahun: number, tarifPphFinal: Desimal, perusahaanId?: string | null): Promise<RingkasanPajak> {
  const dari = new Date(tahun, 0, 1), sampai = new Date(tahun, 11, 31, 23, 59, 59, 999);
  const milik = perusahaanId ? { perusahaanId } : {};
  const rentang = { tanggal: { gte: dari, lte: sampai }, ...milik };
  // Faktur yang belum disetujui belum menjadi penyerahan di buku besar, jadi PPN & DPP-nya belum dihitung
  const rentangDisetujui = { ...rentang, statusPersetujuan: "DISETUJUI" as const };
  const [fj, rj, fb, rb, trm, byr, tercatat, pemetaan, daftarAkun, agregat] = await Promise.all([
    klien.fakturPenjualan.findMany({ where: rentangDisetujui, select: { tanggal: true, dpp: true, diskon: true, ppn: true } }),
    klien.returPenjualan.findMany({ where: rentang, select: { tanggal: true, dpp: true, diskon: true, ppn: true } }),
    klien.fakturPembelian.findMany({ where: rentangDisetujui, select: { tanggal: true, ppn: true } }),
    klien.returPembelian.findMany({ where: rentang, select: { tanggal: true, ppn: true } }),
    klien.penerimaanPenjualan.findMany({ where: rentang, select: { tanggal: true, potonganPajak: true } }),
    klien.pembayaranPembelian.findMany({ where: rentang, select: { tanggal: true, potonganPajak: true } }),
    klien.pphFinalBulanan.findMany({ where: { periode: { startsWith: `${tahun}-` }, ...milik }, include: { jurnal: { select: { nomor: true } } }, orderBy: { id: "asc" } }),
    klien.pemetaanAkun.findUnique({ where: { id: "default" } }),
    klien.akun.findMany({ where: { jenis: "PENDAPATAN" }, select: { id: true, kode: true, nama: true, jenis: true, kelompok: true, indukId: true } }),
    // Σ per akun pendapatan per bulan (zona waktu usaha), tanpa jurnal penutup
    klien.$queryRaw<{ akunId: string; bulan: number; debit: Desimal; kredit: Desimal }[]>`
      SELECT bj."akunId",
             EXTRACT(MONTH FROM ((j."tanggal" AT TIME ZONE 'UTC') AT TIME ZONE ${ZONA_WAKTU}))::int AS bulan,
             SUM(bj."debit") AS debit, SUM(bj."kredit") AS kredit
      FROM "BarisJurnal" bj
      JOIN "Jurnal" j ON j."id" = bj."jurnalId"
      JOIN "Akun" a ON a."id" = bj."akunId"
      WHERE j."tanggal" >= ${dari} AND j."tanggal" <= ${sampai} AND j."sumber" <> 'PENUTUP' AND a."jenis" = 'PENDAPATAN'
        ${perusahaanId ? Prisma.sql`AND j."perusahaanId" = ${perusahaanId}` : Prisma.empty}
      GROUP BY 1, 2`,
  ]);
  const nol = D(0);
  const dasar: AkunSaldo[] = daftarAkun.map((a) => ({ ...a, debit: nol, kredit: nol, saldo: nol }));
  const bukanOmzet = new Set([
    ...keturunanDari(dasar, akarDari(dasar, pemetaan?.diskonPenjualanId ?? undefined)),
    ...keturunanDari(dasar, pemetaan?.pendapatanLainId ?? null),
  ]);
  const perBulan = <T extends { tanggal: Date }>(daftar: T[], bulan: number) => daftar.filter((d) => d.tanggal.getMonth() + 1 === bulan);
  const brutoDok = (x: { dpp: Desimal; diskon: Desimal }) => D(x.dpp).plus(x.diskon);
  const petaTercatat = new Map<string, (typeof tercatat)[number][]>();
  for (const t of tercatat) petaTercatat.set(t.periode, [...(petaTercatat.get(t.periode) ?? []), t]);
  const bulan: PajakBulan[] = [];
  for (let b = 1; b <= 12; b++) {
    const omzet = jumlahkan(agregat.filter((x) => x.bulan === b && !bukanOmzet.has(x.akunId)).map((x) => D(x.kredit).minus(x.debit)));
    const omzetFaktur = jumlahkan(perBulan(fj, b).map(brutoDok)).minus(jumlahkan(perBulan(rj, b).map(brutoDok)));
    const ppnKeluaran = jumlahkan(perBulan(fj, b).map((x) => x.ppn)).minus(jumlahkan(perBulan(rj, b).map((x) => x.ppn)));
    const ppnMasukan = jumlahkan(perBulan(fb, b).map((x) => x.ppn)).minus(jumlahkan(perBulan(rb, b).map((x) => x.ppn)));
    const daftarTercatat = petaTercatat.get(periodeBulan(tahun, b)) ?? [];
    const t = daftarTercatat[0];
    bulan.push({
      periode: periodeBulan(tahun, b),
      bulan: b,
      omzet,
      omzetFaktur,
      omzetLain: omzet.minus(omzetFaktur),
      ppnKeluaran,
      ppnMasukan,
      ppnKurangBayar: ppnKeluaran.minus(ppnMasukan),
      pph23DipotongKlien: jumlahkan(perBulan(trm, b).map((x) => x.potonganPajak)),
      pph23KitaPotong: jumlahkan(perBulan(byr, b).map((x) => x.potonganPajak)),
      pphFinal: hitungPphFinal(omzet, tarifPphFinal),
      tercatat: t
        ? {
            id: t.id,
            jumlah: jumlahkan(daftarTercatat.map((x) => x.jumlah)),
            omzet: jumlahkan(daftarTercatat.map((x) => x.omzet)),
            tarifPersen: D(t.tarifPersen),
            nomorJurnal: daftarTercatat.length === 1 ? (t.jurnal?.nomor ?? null) : null,
            jumlahCatatan: daftarTercatat.length,
          }
        : null,
    });
  }
  const total = (k: keyof PajakBulan) => jumlahkan(bulan.map((x) => x[k] as Desimal));
  return {
    tahun,
    tarifPphFinal,
    bulan,
    total: { omzet: total("omzet"), omzetFaktur: total("omzetFaktur"), omzetLain: total("omzetLain"), ppnKeluaran: total("ppnKeluaran"), ppnMasukan: total("ppnMasukan"), ppnKurangBayar: total("ppnKurangBayar"), pph23DipotongKlien: total("pph23DipotongKlien"), pph23KitaPotong: total("pph23KitaPotong"), pphFinal: total("pphFinal") },
    totalPphFinalTercatat: jumlahkan(bulan.map((x) => x.tercatat?.jumlah ?? nol)),
  };
}

export type PajakPerusahaan = { perusahaan: { id: string; kode: string; nama: string; aktif: boolean }; pengaturan: PengaturanPajak; ringkasan: RingkasanPajak };
export type RingkasanPajakGabungan = {
  tahun: number;
  /** semua perusahaan (termasuk yang diarsipkan), urut menurut urutan lalu nama */
  perPerusahaan: PajakPerusahaan[];
  /** penjumlahan per perusahaan; pphFinal = Σ PPh Final tiap perusahaan */
  total: RingkasanPajak["total"];
  totalPphFinalTercatat: Desimal;
};

/**
 * Ringkasan pajak gabungan (D1 §4.7, perbaikan tinjauan P10 butir 4). Tiap perusahaan wajib pajak sendiri, jadi
 * ringkasannya dihitung per perusahaan dengan pengaturan dan tarif PPh Final perusahaan itu. Omzet, PPN, dan PPh 23
 * gabungan sama dengan penjumlahan biasa, tetapi PPh Final gabungan = jumlah PPh Final per perusahaan, bukan tarif x
 * omzet gabungan: omzet negatif (retur) satu perusahaan tidak mengurangi PPh Final perusahaan lain.
 */
export async function ringkasanPajakGabungan(klien: Klien, tahun: number): Promise<RingkasanPajakGabungan> {
  const daftar = await klien.perusahaan.findMany({ select: { id: true, kode: true, nama: true, aktif: true }, orderBy: [{ urutan: "asc" }, { nama: "asc" }] });
  const perPerusahaan = await Promise.all(
    daftar.map(async (perusahaan) => {
      const pengaturan = await ambilPengaturanPerusahaan(klien, perusahaan.id);
      return { perusahaan, pengaturan, ringkasan: await ringkasanPajak(klien, tahun, pengaturan.pphFinalPersen, perusahaan.id) };
    }),
  );
  const jumlah = (k: keyof RingkasanPajak["total"]) => jumlahkan(perPerusahaan.map((x) => x.ringkasan.total[k]));
  return {
    tahun,
    perPerusahaan,
    total: { omzet: jumlah("omzet"), omzetFaktur: jumlah("omzetFaktur"), omzetLain: jumlah("omzetLain"), ppnKeluaran: jumlah("ppnKeluaran"), ppnMasukan: jumlah("ppnMasukan"), ppnKurangBayar: jumlah("ppnKurangBayar"), pph23DipotongKlien: jumlah("pph23DipotongKlien"), pph23KitaPotong: jumlah("pph23KitaPotong"), pphFinal: jumlah("pphFinal") },
    totalPphFinalTercatat: jumlahkan(perPerusahaan.map((x) => x.ringkasan.totalPphFinalTercatat)),
  };
}

/**
 * Benar bila ringkasan setahun punya angka atau catatan PPh Final (dipakai halaman Pajak gabungan untuk memilih
 * perusahaan). Angka per bulan ikut diperiksa: omzet +X di satu bulan dan -X di bulan lain membuat total setahun nol,
 * tetapi PPh Final bulan positif tetap ada dan ikut dijumlah di kartu gabungan.
 */
export function adaAngkaPajak(r: RingkasanPajak): boolean {
  const t = r.total;
  return (
    [t.omzet, t.omzetFaktur, t.ppnKeluaran, t.ppnMasukan, t.pph23DipotongKlien, t.pph23KitaPotong, t.pphFinal].some((v) => !v.isZero()) ||
    r.bulan.some((b) => b.tercatat !== null || [b.omzet, b.omzetFaktur, b.omzetLain, b.ppnKeluaran, b.ppnMasukan, b.pph23DipotongKlien, b.pph23KitaPotong, b.pphFinal].some((v) => !v.isZero()))
  );
}
