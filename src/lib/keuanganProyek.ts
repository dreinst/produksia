import { Prisma, type PrismaClient } from "@/prisma-klien/client";
import { saringPerusahaan } from "@/lib/perusahaan";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { muatPetaKategori } from "@/lib/kategoriAnggaran";
import { hitungBagiHasil, type HasilBagiHasil, type MitraBagi } from "@/lib/bagiHasil";
import { hitungModulProyek, penghitungTerlihat, type HitunganModul, type KunciModulProyek } from "@/lib/hitunganModulProyek";
import { ruangTersembunyi, syaratBerkasTerlihat } from "@/lib/berkas";
import { punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { labelKlienProyek } from "@/lib/proyek";
import { D, terbesar, uang, type Desimal } from "@/lib/uang";

/*
 * Keuangan proyek (D5 §3.7, §3.8, §6.3), bagian baca saja: rumus ringkasan murni dan pemuatnya. Bukan "use server".
 * Biaya aktual dibaca dari baris jurnal akun BEBAN yang jurnalnya bertanda proyek dan bukan jurnal penutup, persis
 * seperti ringkasanProyek LPJ (src/lib/proyek.ts). Peta akun ke kategori anggaran dari src/lib/kategoriAnggaran.ts.
 * Posting talangan dan pembayaran mitra ada di src/lib/jurnalMitra.ts, algoritma bagi hasil di src/lib/bagiHasil.ts.
 * Berkas ini memuat angkanya untuk halaman keuangan proyek: ringkasan beserta bagi hasil, rincian realisasi (tab Biaya),
 * dokumen mitra (tab Bagi Hasil), dan data daftar /proyek dengan hitungan per modul.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

export const BATAS_UANG_D5 = uang("10000000000000");

/** Persen satu desimal setengah ke atas; null bila penyebut nol (D5 §3.7). */
export function persen(a: Desimal, b: Desimal): Desimal | null {
  return b.isZero() ? null : a.div(b).mul(100).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP);
}

export type SumberPendapatan = "KONTRAK" | "FAKTUR" | "PENAWARAN" | "MANUAL" | "TIDAK_ADA";

export type BarisKategori = {
  kategoriId: string | null;
  nama: string;
  rencana: Desimal;
  aktual: Desimal;
  sisa: Desimal;
  persenTerpakai: Desimal | null;
  lebih: boolean;
  tanpaAnggaran: boolean;
};

export type MasukanKeuangan = {
  pesanan: { id: string; total: Desimal }[];
  penawaran: { id: string; tanggal: Date; total: Desimal; status: string; statusKomersial: string | null; punyaPesanan: boolean }[];
  faktur: { pesananId: string; dpp: Desimal; total: Desimal; uangMuka: Desimal; dibayar: Desimal; returDpp: Desimal }[];
  uangMuka: { pesananId: string; jumlah: Desimal; dipakaiDisetujui: Desimal }[];
  /** per pesananId */
  terminDitagih: Map<string, Desimal>;
  faktorDppUangMuka: Desimal;
  nilaiKontrakManual: Desimal | null;
  rencana: { kategoriId: string; rencana: Desimal }[];
  /** semua akun BEBAN, termasuk bagi hasil */
  bebanPerAkun: { akunId: string; nilai: Desimal }[];
  akunBagiHasilId: string | null;
  kategoriUntukAkun: (akunId: string) => string | null;
  namaKategori: Map<string, string>;
};

export type RingkasanKeuangan = {
  kontrak: Desimal;
  dikutip: Desimal;
  ditagih: Desimal;
  diterima: Desimal;
  piutang: Desimal;
  belumDitagih: Desimal;
  pendapatanRencana: Desimal;
  sumberPendapatan: SumberPendapatan;
  anggaran: Desimal;
  aktual: Desimal;
  bagiHasilDibayar: Desimal;
  sisaAnggaran: Desimal;
  persenTerpakai: Desimal | null;
  perkiraanBiaya: Desimal;
  marginRencana: Desimal;
  marginPerkiraan: Desimal;
  marginTagih: Desimal;
  marginKas: Desimal;
  persenMarginRencana: Desimal | null;
  persenMarginPerkiraan: Desimal | null;
  persenMarginTagih: Desimal | null;
  persenMarginKas: Desimal | null;
  kategori: BarisKategori[];
};

const NOL = D(0);
const jumlah = (xs: Iterable<Desimal>) => {
  let a = NOL;
  for (const x of xs) a = a.plus(x);
  return a;
};
const STATUS_KOMERSIAL_TERTUTUP = new Set(["DITERIMA", "DITOLAK", "KEDALUWARSA"]);
export const NAMA_TANPA_KATEGORI = "Belum dikategorikan";

/** Rumus ringkasan keuangan satu proyek (D5 §3.7, §3.8). Murni; setiap hasil antara dibulatkan uang(). */
export function hitungRingkasanKeuangan(m: MasukanKeuangan): RingkasanKeuangan {
  // Pendapatan
  const penawaranDiterimaTanpaPesanan = m.penawaran.filter((q) => q.statusKomersial === "DITERIMA" && !q.punyaPesanan);
  const kontrak = uang(jumlah(m.pesanan.map((p) => p.total)).plus(jumlah(penawaranDiterimaTanpaPesanan.map((q) => q.total))));
  const terbuka = m.penawaran
    .filter((q) => q.status === "DRAF" && !STATUS_KOMERSIAL_TERTUTUP.has(q.statusKomersial ?? ""))
    .sort((a, b) => a.tanggal.getTime() - b.tanggal.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const dikutip = terbuka.length ? uang(terbuka[terbuka.length - 1].total) : NOL;

  const pesananIds = new Set<string>([...m.pesanan.map((p) => p.id), ...m.faktur.map((f) => f.pesananId), ...m.terminDitagih.keys()]);
  const ditagih = uang(
    jumlah(
      [...pesananIds].map((id) => {
        const fakturPesanan = m.faktur.filter((f) => f.pesananId === id);
        const dariFaktur = uang(jumlah(fakturPesanan.map((f) => f.dpp)).minus(jumlah(fakturPesanan.map((f) => f.returDpp))));
        return terbesar(dariFaktur, m.terminDitagih.get(id) ?? NOL);
      }),
    ),
  );
  const diterima = uang(
    jumlah(m.faktur.map((f) => (f.total.gt(0) ? uang(f.uangMuka.plus(f.dibayar).mul(f.dpp).div(f.total)) : NOL))).plus(
      jumlah(m.uangMuka.map((u) => uang(u.jumlah.minus(u.dipakaiDisetujui).mul(m.faktorDppUangMuka)))),
    ),
  );
  const piutang = uang(ditagih.minus(diterima));
  const belumDitagih = kontrak.gt(0) ? terbesar(uang(kontrak.minus(ditagih)), NOL) : NOL;
  let pendapatanRencana: Desimal;
  let sumberPendapatan: SumberPendapatan;
  if (!kontrak.isZero()) [pendapatanRencana, sumberPendapatan] = [kontrak, "KONTRAK"];
  else if (!ditagih.isZero()) [pendapatanRencana, sumberPendapatan] = [ditagih, "FAKTUR"];
  else if (!dikutip.isZero()) [pendapatanRencana, sumberPendapatan] = [dikutip, "PENAWARAN"];
  else if (m.nilaiKontrakManual && !m.nilaiKontrakManual.isZero()) [pendapatanRencana, sumberPendapatan] = [uang(m.nilaiKontrakManual), "MANUAL"];
  else [pendapatanRencana, sumberPendapatan] = [NOL, "TIDAK_ADA"];

  // Biaya per kategori
  const rencanaPer = new Map<string, Desimal>();
  for (const r of m.rencana) rencanaPer.set(r.kategoriId, (rencanaPer.get(r.kategoriId) ?? NOL).plus(r.rencana));
  const aktualPer = new Map<string | null, Desimal>();
  let bagiHasil = NOL;
  for (const b of m.bebanPerAkun) {
    if (m.akunBagiHasilId && b.akunId === m.akunBagiHasilId) {
      bagiHasil = bagiHasil.plus(b.nilai);
      continue;
    }
    const k = m.kategoriUntukAkun(b.akunId);
    aktualPer.set(k, (aktualPer.get(k) ?? NOL).plus(b.nilai));
  }
  const anggaran = uang(jumlah(rencanaPer.values()));
  const aktual = uang(jumlah(aktualPer.values()));
  const bagiHasilDibayar = uang(bagiHasil);
  const kunciKategori = new Set<string | null>([...rencanaPer.keys(), ...[...aktualPer.entries()].filter(([, v]) => !v.isZero()).map(([k]) => k)]);
  const perkiraanBiaya = uang(jumlah([...kunciKategori].map((k) => terbesar(uang(k === null ? NOL : (rencanaPer.get(k) ?? NOL)), uang(aktualPer.get(k) ?? NOL)))));
  const kategori: BarisKategori[] = [...kunciKategori]
    .map((k) => {
      const rencana = uang(k === null ? NOL : (rencanaPer.get(k) ?? NOL));
      const akt = uang(aktualPer.get(k) ?? NOL);
      return {
        kategoriId: k,
        nama: k === null ? NAMA_TANPA_KATEGORI : (m.namaKategori.get(k) ?? NAMA_TANPA_KATEGORI),
        rencana,
        aktual: akt,
        sisa: uang(rencana.minus(akt)),
        persenTerpakai: persen(akt, rencana),
        lebih: rencana.gt(0) && akt.gt(rencana),
        tanpaAnggaran: rencana.isZero() && akt.gt(0),
      };
    })
    .sort((a, b) => b.aktual.comparedTo(a.aktual) || a.nama.localeCompare(b.nama, "id"));

  const marginRencana = uang(pendapatanRencana.minus(anggaran));
  const marginPerkiraan = uang(pendapatanRencana.minus(perkiraanBiaya));
  const marginTagih = uang(ditagih.minus(aktual));
  const marginKas = uang(diterima.minus(aktual));
  return {
    kontrak,
    dikutip,
    ditagih,
    diterima,
    piutang,
    belumDitagih,
    pendapatanRencana,
    sumberPendapatan,
    anggaran,
    aktual,
    bagiHasilDibayar,
    sisaAnggaran: uang(anggaran.minus(aktual)),
    persenTerpakai: persen(aktual, anggaran),
    perkiraanBiaya,
    marginRencana,
    marginPerkiraan,
    marginTagih,
    marginKas,
    persenMarginRencana: persen(marginRencana, pendapatanRencana),
    persenMarginPerkiraan: persen(marginPerkiraan, pendapatanRencana),
    persenMarginTagih: persen(marginTagih, ditagih),
    persenMarginKas: persen(marginKas, diterima),
    kategori,
  };
}

type AkunRingkas = { id: string; kode: string; nama: string };

/**
 * Akun peran keuangan proyek (D5 §4.2): pemetaan tambahan dulu, lalu kode Bagan Akun Standar. Akun yang jenisnya salah
 * atau akun kelompok dianggap belum ada.
 */
export async function akunKeuanganProyek(klien: Klien): Promise<{ hutangMitra: AkunRingkas | null; bebanBagiHasil: AkunRingkas | null }> {
  const pilih = { id: true, kode: true, nama: true, jenis: true, kelompok: true } as const;
  const [petaHutang, petaBagi, stdHutang, stdBagi] = await Promise.all([
    klien.pemetaanAkunTambahan.findUnique({ where: { kunci: "hutang-mitra-proyek" }, select: { akun: { select: pilih } } }),
    klien.pemetaanAkunTambahan.findUnique({ where: { kunci: "beban-bagi-hasil-mitra" }, select: { akun: { select: pilih } } }),
    klien.akun.findUnique({ where: { kode: "2-1700" }, select: pilih }),
    klien.akun.findUnique({ where: { kode: "5-1700" }, select: pilih }),
  ]);
  const sah = (a: { id: string; kode: string; nama: string; jenis: string; kelompok: boolean } | null | undefined, jenis: string): AkunRingkas | null =>
    a && a.jenis === jenis && !a.kelompok ? { id: a.id, kode: a.kode, nama: a.nama } : null;
  return {
    hutangMitra: sah(petaHutang?.akun ?? stdHutang, "KEWAJIBAN"),
    bebanBagiHasil: sah(petaBagi?.akun ?? stdBagi, "BEBAN"),
  };
}

/**
 * Kunci baris proyek (FOR NO KEY UPDATE) sampai transaksi pemanggil selesai: menyerialkan sinkron anggaran dan
 * perubahan mitra satu proyek tanpa menghalangi sisipan baris anak ber-FK (KEY SHARE dari Jurnal ber-proyekId).
 * Urutan kunci keuangan proyek: baris dokumen, lalu Proyek, lalu MitraProyek (KONTRAK-TAMBAHAN, tinjauan P33).
 */
export async function kunciBarisProyek(tx: Prisma.TransactionClient, proyekId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "Proyek" WHERE "id" = ${proyekId} FOR NO KEY UPDATE`;
}

/** Batas proyek per panggilan, seperti overview HKA. */
export const BATAS_PROYEK_MUAT = 500;

/** Masukan ringkasan untuk banyak proyek sekaligus dengan jumlah kueri tetap (D5 §6.3). */
export async function muatMasukanKeuangan(klien: Klien, proyekIds: string[]): Promise<Map<string, MasukanKeuangan>> {
  const ids = [...new Set(proyekIds)].slice(0, BATAS_PROYEK_MUAT);
  const hasil = new Map<string, MasukanKeuangan>();
  if (ids.length === 0) return hasil;
  const [proyek, pesanan, penawaran, faktur, uangMuka, termin, rencana, beban, petaKategori, akunPeran] = await Promise.all([
    klien.proyek.findMany({ where: { id: { in: ids } }, select: { id: true, nilaiKontrak: true, perusahaanId: true } }),
    klien.pesananPenjualan.findMany({ where: { proyekId: { in: ids } }, select: { id: true, proyekId: true, total: true } }),
    klien.penawaranPenjualan.findMany({
      where: { proyekId: { in: ids } },
      select: { id: true, proyekId: true, tanggal: true, total: true, status: true, statusKomersial: true, pesanan: { select: { id: true } } },
    }),
    klien.fakturPenjualan.findMany({
      where: { statusPersetujuan: "DISETUJUI", pesanan: { proyekId: { in: ids } } },
      select: {
        pesananId: true, dpp: true, total: true, uangMuka: true,
        pesanan: { select: { proyekId: true } },
        penerimaan: { select: { jumlah: true, potonganPajak: true } },
        retur: { select: { dpp: true } },
      },
    }),
    klien.uangMukaPelanggan.findMany({
      where: { pesanan: { proyekId: { in: ids } } },
      select: { pesananId: true, jumlah: true, pesanan: { select: { proyekId: true } }, pemakaian: { where: { faktur: { statusPersetujuan: "DISETUJUI" } }, select: { jumlah: true } } },
    }),
    klien.rencanaTermin.groupBy({ by: ["pesananId"], where: { ditagihPada: { not: null }, pesanan: { proyekId: { in: ids } } }, _sum: { jumlah: true } }),
    klien.barisAnggaranProyek.groupBy({ by: ["proyekId", "kategoriId"], where: { proyekId: { in: ids } }, _sum: { rencana: true } }),
    klien.$queryRaw<{ proyekId: string; akunId: string; d: Desimal | null; k: Desimal | null }[]>`
      SELECT j."proyekId", b."akunId", SUM(b."debit") AS d, SUM(b."kredit") AS k
      FROM "BarisJurnal" b
      JOIN "Jurnal" j ON j."id" = b."jurnalId"
      JOIN "Akun" a ON a."id" = b."akunId"
      WHERE a."jenis" = 'BEBAN' AND j."sumber" <> 'PENUTUP' AND j."proyekId" IN (${Prisma.join(ids)})
      GROUP BY 1, 2`,
    muatPetaKategori(klien),
    akunKeuanganProyek(klien),
  ]);
  const perusahaanIds = [...new Set(proyek.map((p) => p.perusahaanId))];
  // pengaturan pajak per perusahaan proyek (D1 §3.6); perusahaan tanpa baris pengaturan = bawaan non-PKP
  const pengaturan = await Promise.all(perusahaanIds.map((id) => ambilPengaturanPerusahaan(klien, id)));
  const faktorDpp = new Map(pengaturan.map((p) => [p.perusahaanId, p.pkp ? D(100).div(D(100).plus(p.tarifPpnPersen)) : D(1)]));
  const proyekPesanan = new Map(pesanan.map((p) => [p.id, p.proyekId]));

  for (const p of proyek) {
    hasil.set(p.id, {
      pesanan: [],
      penawaran: [],
      faktur: [],
      uangMuka: [],
      terminDitagih: new Map(),
      faktorDppUangMuka: faktorDpp.get(p.perusahaanId) ?? D(1),
      nilaiKontrakManual: p.nilaiKontrak === null ? null : D(p.nilaiKontrak),
      rencana: [],
      bebanPerAkun: [],
      akunBagiHasilId: akunPeran.bebanBagiHasil?.id ?? null,
      kategoriUntukAkun: petaKategori.kategoriUntukAkun,
      namaKategori: petaKategori.namaKategori,
    });
  }
  for (const x of pesanan) if (x.proyekId) hasil.get(x.proyekId)?.pesanan.push({ id: x.id, total: D(x.total) });
  for (const q of penawaran) {
    if (!q.proyekId) continue;
    hasil.get(q.proyekId)?.penawaran.push({ id: q.id, tanggal: q.tanggal, total: D(q.total), status: q.status, statusKomersial: q.statusKomersial, punyaPesanan: !!q.pesanan });
  }
  for (const f of faktur) {
    if (!f.pesananId || !f.pesanan?.proyekId) continue;
    hasil.get(f.pesanan.proyekId)?.faktur.push({
      pesananId: f.pesananId,
      dpp: D(f.dpp),
      total: D(f.total),
      uangMuka: D(f.uangMuka),
      dibayar: jumlah(f.penerimaan.map((t) => D(t.jumlah).plus(D(t.potonganPajak)))),
      returDpp: jumlah(f.retur.map((r) => D(r.dpp))),
    });
  }
  for (const u of uangMuka) {
    if (!u.pesanan.proyekId) continue;
    hasil.get(u.pesanan.proyekId)?.uangMuka.push({ pesananId: u.pesananId, jumlah: D(u.jumlah), dipakaiDisetujui: jumlah(u.pemakaian.map((x) => D(x.jumlah))) });
  }
  for (const t of termin) {
    const proyekId = t.pesananId ? proyekPesanan.get(t.pesananId) : null;
    if (proyekId && t.pesananId) hasil.get(proyekId)?.terminDitagih.set(t.pesananId, D(t._sum.jumlah));
  }
  for (const r of rencana) hasil.get(r.proyekId)?.rencana.push({ kategoriId: r.kategoriId, rencana: D(r._sum.rencana) });
  for (const b of beban) hasil.get(b.proyekId)?.bebanPerAkun.push({ akunId: b.akunId, nilai: D(b.d).minus(D(b.k)) });
  return hasil;
}

export type ProyekKeuangan = {
  id: string;
  kode: string;
  nama: string;
  warna: string | null;
  status: string;
  klien: string | null;
  tanggalMulai: Date | null;
  tanggalSelesai: Date | null;
  perusahaan: { id: string; kode: string; nama: string; warna: string | null };
};

const PILIH_PROYEK = {
  id: true, kode: true, nama: true, warna: true, status: true, namaKlien: true, tanggalMulai: true, tanggalSelesai: true,
  pelanggan: { select: { nama: true } },
  perusahaan: { select: { id: true, kode: true, nama: true, warna: true } },
} as const;

function proyekRingkas(p: Prisma.ProyekGetPayload<{ select: typeof PILIH_PROYEK }>): ProyekKeuangan {
  return {
    id: p.id, kode: p.kode, nama: p.nama, warna: p.warna, status: p.status,
    klien: p.pelanggan?.nama ?? p.namaKlien ?? null,
    tanggalMulai: p.tanggalMulai, tanggalSelesai: p.tanggalSelesai, perusahaan: p.perusahaan,
  };
}

export type PembayaranMitraRingkas = { id: string; nomor: string; tanggal: Date; mitraId: string; jenis: "MODAL" | "LABA"; jumlah: Desimal; catatan: string | null };
export type BagiHasilProyek = HasilBagiHasil & { pembayaran: PembayaranMitraRingkas[] };

/**
 * Bagi hasil satu proyek dari angka ringkasannya (D5 §3.12): mitra urut (urutan, dibuatPada, id), modal masuk =
 * Σ talangan DISETUJUI, dibayar = Σ pembayaran DISETUJUI per jenis. Dokumen draf, menunggu, dan ditolak tidak masuk
 * angka. `pembayaran` hanya yang DISETUJUI dan mitranya masih ada, urut tanggal lalu dibuatPada turun.
 */
export async function muatBagiHasil(klien: Klien, proyekId: string, ringkasan: Pick<RingkasanKeuangan, "marginRencana" | "marginKas" | "diterima" | "aktual">): Promise<BagiHasilProyek> {
  const mitra = await klien.mitraProyek.findMany({ where: { proyekId }, orderBy: [{ urutan: "asc" }, { dibuatPada: "asc" }, { id: "asc" }], select: { id: true, nama: true, mode: true, nilai: true } });
  const talangan = await klien.talanganMitra.groupBy({ by: ["mitraId"], where: { proyekId, statusPersetujuan: "DISETUJUI" }, _sum: { jumlah: true } });
  const bayar = await klien.pembayaranMitra.groupBy({ by: ["mitraId", "jenis"], where: { proyekId, statusPersetujuan: "DISETUJUI" }, _sum: { jumlah: true } });
  const daftarBayar = await klien.pembayaranMitra.findMany({
    where: { proyekId, statusPersetujuan: "DISETUJUI" },
    orderBy: [{ tanggal: "desc" }, { dibuatPada: "desc" }, { id: "asc" }],
    select: { id: true, nomor: true, tanggal: true, mitraId: true, jenis: true, jumlah: true, catatan: true },
  });
  const modalMasuk = new Map(talangan.map((t) => [t.mitraId, D(t._sum.jumlah)]));
  const dibayar = new Map<string, { modal: Desimal; laba: Desimal }>();
  for (const b of bayar) {
    const ada = dibayar.get(b.mitraId) ?? { modal: NOL, laba: NOL };
    if (b.jenis === "MODAL") ada.modal = ada.modal.plus(D(b._sum.jumlah));
    else ada.laba = ada.laba.plus(D(b._sum.jumlah));
    dibayar.set(b.mitraId, ada);
  }
  const daftarMitra: MitraBagi[] = mitra.map((m) => ({ id: m.id, nama: m.nama, mode: m.mode, nilai: D(m.nilai) }));
  return {
    ...hitungBagiHasil(ringkasan, daftarMitra, modalMasuk, dibayar),
    pembayaran: daftarBayar.map((b) => ({ ...b, jumlah: D(b.jumlah) })),
  };
}

export type HasilRingkasanKeuanganProyek = { proyek: ProyekKeuangan; ringkasan: RingkasanKeuangan; bagiHasil: BagiHasilProyek | null };

/**
 * Ringkasan keuangan satu proyek; null bila proyek tidak ada. Bagi hasil dimuat hanya bila pemanggil memilih
 * `denganBagiHasil` secara eksplisit (tinjauan P35 R3): halaman dan PDF mengisinya dengan
 * `punyaHak(pengguna, "bagi-hasil.lihat")`, sehingga tsc memaksa setiap pemanggil memilih. Panggilan tanpa opsi
 * (bentuk lama DF4, dipakai panel beranda) hanya mengembalikan proyek dan ringkasan tanpa memuat mitra.
 */
export async function ringkasanKeuanganProyek(klien: Klien, proyekId: string): Promise<Omit<HasilRingkasanKeuanganProyek, "bagiHasil"> | null>;
export async function ringkasanKeuanganProyek(klien: Klien, proyekId: string, opsi: { denganBagiHasil: boolean }): Promise<HasilRingkasanKeuanganProyek | null>;
export async function ringkasanKeuanganProyek(klien: Klien, proyekId: string, opsi?: { denganBagiHasil: boolean }): Promise<HasilRingkasanKeuanganProyek | Omit<HasilRingkasanKeuanganProyek, "bagiHasil"> | null> {
  const p = await klien.proyek.findUnique({ where: { id: proyekId }, select: PILIH_PROYEK });
  if (!p) return null;
  const masukan = (await muatMasukanKeuangan(klien, [p.id])).get(p.id)!;
  const ringkasan = hitungRingkasanKeuangan(masukan);
  if (!opsi) return { proyek: proyekRingkas(p), ringkasan };
  const bagiHasil = opsi.denganBagiHasil === true ? await muatBagiHasil(klien, p.id, ringkasan) : null;
  return { proyek: proyekRingkas(p), ringkasan, bagiHasil };
}

export type BarisRealisasi = {
  barisId: string;
  jurnalId: string;
  tanggal: Date;
  nomorJurnal: string;
  keterangan: string | null;
  akun: { id: string; kode: string; nama: string };
  kategoriId: string | null;
  kategori: string;
  /** "{nama mitra} (talangan)" atau nama perusahaan proyek */
  didanaiOleh: string;
  /** debit − kredit */
  jumlah: Desimal;
  /** jumlah berkas dokumen sumber yang terlihat oleh pengguna; null bila pengguna tidak diberikan */
  lampiran: number | null;
  /** baris akun Bagi Hasil Mitra Proyek (tidak masuk biaya aktual) */
  bagiHasil: boolean;
};

/** Jenis lampiran dokumen sumber satu jurnal (D5 §5.3): kas, faktur pembelian, talangan, atau jurnal itu sendiri. */
function sumberLampiran(j: { id: string; dokumenKas: { id: string; jenis: string } | null; fakturPembelian: { id: string } | null; talanganMitra: { id: string } | null }): { jenisEntitas: string; entitasId: string } {
  if (j.dokumenKas) return { jenisEntitas: j.dokumenKas.jenis === "MASUK" ? "kas-masuk" : "kas-keluar", entitasId: j.dokumenKas.id };
  if (j.fakturPembelian) return { jenisEntitas: "faktur-pembelian", entitasId: j.fakturPembelian.id };
  if (j.talanganMitra) return { jenisEntitas: "talangan-mitra", entitasId: j.talanganMitra.id };
  return { jenisEntitas: "jurnal", entitasId: j.id };
}

export type RincianRealisasi = {
  baris: BarisRealisasi[];
  /** true bila baris yang memenuhi syarat lebih banyak dari batas (tinjauan P35 R6); halaman menampilkan penanda */
  terpotong: boolean;
  /** batas yang dipakai, untuk teks penanda "menampilkan {batas} baris terbaru" */
  batas: number;
  /**
   * Σ baris akun Bagi Hasil Mitra Proyek yang disembunyikan karena `denganBagiHasil` false (tinjauan P35 R4), untuk
   * keterangan "termasuk bagi laba" tanpa rincian per mitra. null bila baris bagi hasil ikut tampil.
   */
  bagiLabaTersembunyi: Desimal | null;
};

/**
 * Rincian realisasi (tab Biaya, D5 §3.8): satu baris per BarisJurnal akun BEBAN pada jurnal bertanda proyek yang
 * bukan jurnal penutup, urut tanggal turun lalu nomor. Bila tidak terpotong, Σ jumlah baris yang bukan bagiHasil =
 * aktual ringkasan.
 * - `denganBagiHasil` wajib (tinjauan P35 R4): false membuang baris akun Bagi Hasil Mitra Proyek (keterangan "Bagi laba
 *   {mitra}") dan hanya mengembalikan jumlahnya di `bagiLabaTersembunyi`. Isi dengan `punyaHak(pengguna, "bagi-hasil.lihat")`.
 * - `pengguna` diisi: jumlah lampiran memakai syarat berkas terlihat pengguna itu (folder dan proyek terbatas, hak
 *   lihat jenis lampiran).
 * - `batas` (bawaan 500) membatasi jumlah baris; `terpotong` menandai bila ada baris lain di luar batas.
 */
export async function rincianRealisasi(
  klien: Klien,
  proyekId: string,
  opsi: { denganBagiHasil: boolean; pengguna?: PenggunaSesi; batas?: number },
): Promise<RincianRealisasi> {
  const batas = opsi.batas ?? 500;
  const { pengguna } = opsi;
  const proyek = await klien.proyek.findUnique({ where: { id: proyekId }, select: { perusahaan: { select: { nama: true } } } });
  if (!proyek) return { baris: [], terpotong: false, batas, bagiLabaTersembunyi: opsi.denganBagiHasil ? null : D(0) };
  const akunPeran = await akunKeuanganProyek(klien);
  const idBagi = akunPeran.bebanBagiHasil?.id ?? null;
  const syaratJurnal = { proyekId, sumber: { not: "PENUTUP" as const } };
  const sembunyikan = !opsi.denganBagiHasil && idBagi !== null;
  const hasil = await klien.barisJurnal.findMany({
    where: { akun: { jenis: "BEBAN" }, jurnal: syaratJurnal, ...(sembunyikan ? { akunId: { not: idBagi } } : {}) },
    orderBy: [{ jurnal: { tanggal: "desc" } }, { jurnal: { nomor: "asc" } }, { id: "asc" }],
    take: batas + 1,
    select: {
      id: true, debit: true, kredit: true, keterangan: true,
      akun: { select: { id: true, kode: true, nama: true } },
      jurnal: {
        select: {
          id: true, nomor: true, tanggal: true, keterangan: true,
          dokumenKas: { select: { id: true, jenis: true } },
          fakturPembelian: { select: { id: true } },
          talanganMitra: { select: { id: true, mitra: { select: { nama: true } } } },
        },
      },
    },
  });
  const terpotong = hasil.length > batas;
  const baris = terpotong ? hasil.slice(0, batas) : hasil;
  let bagiLabaTersembunyi: Desimal | null = null;
  if (!opsi.denganBagiHasil) {
    if (idBagi === null) bagiLabaTersembunyi = D(0);
    else {
      const agr = await klien.barisJurnal.aggregate({ where: { akunId: idBagi, jurnal: syaratJurnal }, _sum: { debit: true, kredit: true } });
      bagiLabaTersembunyi = D(agr._sum.debit ?? 0).minus(D(agr._sum.kredit ?? 0));
    }
  }
  const peta = await muatPetaKategori(klien);
  const sumber = new Map(baris.map((b) => [b.jurnal.id, sumberLampiran(b.jurnal)]));
  let lampiran: Map<string, number> | null = null;
  if (pengguna && sumber.size > 0) {
    const ruang = await ruangTersembunyi(klien, pengguna);
    const kunci = [...new Map([...sumber.values()].map((x) => [`${x.jenisEntitas}:${x.entitasId}`, x])).values()];
    const hitung = await klien.berkas.groupBy({
      by: ["jenisEntitas", "entitasId"],
      where: { AND: [syaratBerkasTerlihat(pengguna, ruang), { OR: kunci.map((k) => ({ jenisEntitas: k.jenisEntitas, entitasId: k.entitasId })) }] },
      _count: { _all: true },
    });
    lampiran = new Map(hitung.map((h) => [`${h.jenisEntitas}:${h.entitasId}`, h._count._all]));
  }
  return {
    terpotong,
    batas,
    bagiLabaTersembunyi,
    baris: baris.map((b) => {
      const kategoriId = peta.kategoriUntukAkun(b.akun.id);
      const s = sumber.get(b.jurnal.id)!;
      return {
        barisId: b.id,
        jurnalId: b.jurnal.id,
        tanggal: b.jurnal.tanggal,
        nomorJurnal: b.jurnal.nomor,
        keterangan: b.keterangan ?? b.jurnal.keterangan,
        akun: b.akun,
        kategoriId,
        kategori: kategoriId ? (peta.namaKategori.get(kategoriId) ?? NAMA_TANPA_KATEGORI) : NAMA_TANPA_KATEGORI,
        didanaiOleh: b.jurnal.talanganMitra ? `${b.jurnal.talanganMitra.mitra.nama} (talangan)` : proyek.perusahaan.nama,
        jumlah: D(b.debit).minus(D(b.kredit)),
        lampiran: lampiran ? (lampiran.get(`${s.jenisEntitas}:${s.entitasId}`) ?? 0) : null,
        bagiHasil: idBagi === b.akun.id,
      };
    }),
  };
}

/**
 * Dokumen mitra satu proyek untuk tab Bagi Hasil: semua status (draf dan yang menunggu tampil dengan lencana
 * persetujuan), urut tanggal lalu dibuatPada turun. Pemanggil menyaring dengan hak talangan-mitra.lihat dan
 * pembayaran-mitra.lihat.
 */
export async function daftarDokumenMitra(klien: Klien, proyekId: string) {
  const pilihStatus = { statusPersetujuan: true, diajukanOlehId: true, catatanPenolakan: true, jurnalId: true } as const;
  const talangan = await klien.talanganMitra.findMany({
    where: { proyekId },
    orderBy: [{ tanggal: "desc" }, { dibuatPada: "desc" }, { id: "asc" }],
    select: { id: true, nomor: true, tanggal: true, jumlah: true, deskripsi: true, vendor: true, mitraId: true, mitra: { select: { nama: true } }, akunBeban: { select: { kode: true, nama: true } }, ...pilihStatus },
  });
  const pembayaran = await klien.pembayaranMitra.findMany({
    where: { proyekId },
    orderBy: [{ tanggal: "desc" }, { dibuatPada: "desc" }, { id: "asc" }],
    select: { id: true, nomor: true, tanggal: true, jumlah: true, jenis: true, catatan: true, mitraId: true, mitra: { select: { nama: true } }, akunKas: { select: { kode: true, nama: true } }, ...pilihStatus },
  });
  return { talangan, pembayaran };
}

export type BarisProyekHalaman = {
  id: string;
  kode: string;
  nama: string;
  warna: string | null;
  status: string;
  klien: string | null;
  tanggalMulai: Date | null;
  tanggalSelesai: Date | null;
  perusahaan: { id: string; kode: string; nama: string; warna: string | null };
  /** hanya diisi untuk pemegang berkas.akses-penuh: proyek punya pembatasan berkas (AksesBerkasProyek) */
  terbatas?: boolean;
  hitungan: Partial<Record<KunciModulProyek, HitunganModul>>;
};

/**
 * Data halaman /proyek (D5 §3.3, §6.3): proyek tersaring (q pada kode, nama, nama klien, pelanggan; status atau
 * kecualiStatus), urut
 * tanggal mulai turun lalu kode, dipaginasi, dengan hitungan modul yang haknya dipegang pengguna. Tanpa angka keuangan.
 * perusahaanId null/undefined = gabungan.
 */
export async function daftarProyekUntukHalaman(
  klien: Klien,
  pengguna: PenggunaSesi,
  param: { q?: string; status?: string; kecualiStatus?: string[]; lewati?: number; ambil?: number } = {},
  perusahaanId?: string | null,
): Promise<{ total: number; baris: BarisProyekHalaman[] }> {
  const where: Prisma.ProyekWhereInput = { ...saringPerusahaan(perusahaanId) };
  // kecualiStatus: saringan bawaan halaman /proyek "Semua kecuali diarsipkan" (D5 §7.2); status tunggal menang
  if (param.status) where.status = param.status;
  else if (param.kecualiStatus?.length) where.status = { notIn: param.kecualiStatus };
  const q = param.q?.trim();
  if (q) {
    const ci = { contains: q, mode: "insensitive" as const };
    where.OR = [{ kode: ci }, { nama: ci }, { namaKlien: ci }, { pelanggan: { nama: ci } }];
  }
  const aksesPenuh = punyaHak(pengguna, "berkas.akses-penuh");
  const total = await klien.proyek.count({ where });
  const proyek = await klien.proyek.findMany({
    where,
    orderBy: [{ tanggalMulai: { sort: "desc", nulls: "last" } }, { kode: "asc" }],
    skip: Math.max(0, param.lewati ?? 0),
    take: Math.min(Math.max(1, param.ambil ?? 50), BATAS_PROYEK_MUAT),
    select: { ...PILIH_PROYEK, ...(aksesPenuh ? { aksesBerkas: { select: { proyekId: true } } } : {}) },
  });
  const ids = proyek.map((p) => p.id);
  const hitungan = await hitungModulProyek(klien, ids, penghitungTerlihat((h) => punyaHak(pengguna, h)));
  return {
    total,
    baris: proyek.map((p) => ({
      id: p.id, kode: p.kode, nama: p.nama, warna: p.warna, status: p.status,
      klien: labelKlienProyek(p),
      tanggalMulai: p.tanggalMulai, tanggalSelesai: p.tanggalSelesai, perusahaan: p.perusahaan,
      ...(aksesPenuh ? { terbatas: !!(p as { aksesBerkas?: unknown }).aksesBerkas } : {}),
      hitungan: hitungan.get(p.id) ?? {},
    })),
  };
}

export type TotalKeuanganProyek = {
  kontrak: Desimal;
  pendapatanRencana: Desimal;
  ditagih: Desimal;
  diterima: Desimal;
  anggaran: Desimal;
  aktual: Desimal;
  marginRencana: Desimal;
  marginKas: Desimal;
};

/**
 * Daftar keuangan proyek dalam lingkup (D5 §6.3): semua proyek tersaring (paling banyak 500) beserta ringkasannya,
 * urut tanggal mulai turun (tanpa tanggal di belakang) lalu kode, dan totalnya. perusahaanId null/undefined = gabungan.
 * `total` hanya dari baris yang dimuat; `jumlahTotal` = jumlah semua proyek tersaring, jadi `jumlahTotal > baris.length`
 * berarti daftar dan totalnya terpotong di 500 proyek pertama.
 */
export async function daftarKeuanganProyek(
  klien: Klien,
  filter: { status?: string; q?: string } = {},
  perusahaanId?: string | null,
): Promise<{ baris: (ProyekKeuangan & { ringkasan: RingkasanKeuangan })[]; total: TotalKeuanganProyek; jumlahTotal: number }> {
  const where: Prisma.ProyekWhereInput = { ...saringPerusahaan(perusahaanId) };
  if (filter.status) where.status = filter.status;
  const q = filter.q?.trim();
  if (q) {
    const ci = { contains: q, mode: "insensitive" as const };
    where.OR = [{ kode: ci }, { nama: ci }, { namaKlien: ci }, { pelanggan: { nama: ci } }];
  }
  const proyek = await klien.proyek.findMany({
    where,
    orderBy: [{ tanggalMulai: { sort: "desc", nulls: "last" } }, { kode: "asc" }],
    take: BATAS_PROYEK_MUAT,
    select: PILIH_PROYEK,
  });
  // hitung ulang hanya bila batas tercapai; di bawah batas semua proyek sudah termuat
  const [masukan, jumlahTotal] = await Promise.all([
    muatMasukanKeuangan(klien, proyek.map((p) => p.id)),
    proyek.length < BATAS_PROYEK_MUAT ? Promise.resolve(proyek.length) : klien.proyek.count({ where }),
  ]);
  const baris = proyek.map((p) => ({ ...proyekRingkas(p), ringkasan: hitungRingkasanKeuangan(masukan.get(p.id)!) }));
  const jml = (f: (r: RingkasanKeuangan) => Desimal) => uang(jumlah(baris.map((b) => f(b.ringkasan))));
  return {
    baris,
    jumlahTotal,
    total: {
      kontrak: jml((r) => r.kontrak),
      pendapatanRencana: jml((r) => r.pendapatanRencana),
      ditagih: jml((r) => r.ditagih),
      diterima: jml((r) => r.diterima),
      anggaran: jml((r) => r.anggaran),
      aktual: jml((r) => r.aktual),
      marginRencana: jml((r) => r.marginRencana),
      marginKas: jml((r) => r.marginKas),
    },
  };
}
