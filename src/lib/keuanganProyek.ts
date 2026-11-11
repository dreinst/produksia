import { Prisma, type PrismaClient } from "@/prisma-klien/client";
import { saringPerusahaan } from "@/lib/perusahaan";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { D, terbesar, uang, type Desimal } from "@/lib/uang";

/*
 * Keuangan proyek (D5 §3.7, §3.8, §6.3), bagian baca saja: rumus ringkasan murni dan pemuatnya. Bukan "use server".
 * Biaya aktual dibaca dari baris jurnal akun BEBAN yang jurnalnya bertanda proyek dan bukan jurnal penutup, persis
 * seperti ringkasanProyek LPJ (src/lib/proyek.ts). Posting talangan dan pembayaran mitra, bagi hasil, dan halaman
 * keuangan proyek ditambahkan paket Keuangan Proyek dengan nama dan tanda tangan rancangan.
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
 * Peta akun → kategori anggaran: pemetaan terdekat ke atas pohon akun menang (D5 §2.6). Padanan muatPetaKategori
 * rancangan (src/lib/kategoriAnggaran.ts milik paket Keuangan Proyek); dipindah ke sana saat berkas itu dibuat.
 */
async function muatPetaKategoriBaca(klien: Klien): Promise<{ kategoriUntukAkun: (akunId: string) => string | null; namaKategori: Map<string, string> }> {
  const [akun, peta, kategori] = await Promise.all([
    klien.akun.findMany({ select: { id: true, indukId: true } }),
    klien.akunKategoriAnggaran.findMany({ select: { akunId: true, kategoriId: true } }),
    klien.kategoriAnggaran.findMany({ select: { id: true, nama: true } }),
  ]);
  const induk = new Map(akun.map((a) => [a.id, a.indukId]));
  const langsung = new Map(peta.map((p) => [p.akunId, p.kategoriId]));
  const tembolok = new Map<string, string | null>();
  const kategoriUntukAkun = (akunId: string): string | null => {
    if (tembolok.has(akunId)) return tembolok.get(akunId)!;
    let id: string | null | undefined = akunId;
    const dilihat = new Set<string>();
    let hasil: string | null = null;
    while (id && !dilihat.has(id)) {
      dilihat.add(id);
      const k = langsung.get(id);
      if (k) {
        hasil = k;
        break;
      }
      id = induk.get(id);
    }
    tembolok.set(akunId, hasil);
    return hasil;
  };
  return { kategoriUntukAkun, namaKategori: new Map(kategori.map((k) => [k.id, k.nama])) };
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
    muatPetaKategoriBaca(klien),
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

/**
 * Ringkasan keuangan satu proyek; null bila proyek tidak ada. Angka bagi hasil (D5 §3.12) ditambahkan paket
 * Keuangan Proyek bersama src/lib/bagiHasil.ts.
 */
export async function ringkasanKeuanganProyek(klien: Klien, proyekId: string): Promise<{ proyek: ProyekKeuangan; ringkasan: RingkasanKeuangan } | null> {
  const p = await klien.proyek.findUnique({ where: { id: proyekId }, select: PILIH_PROYEK });
  if (!p) return null;
  const masukan = (await muatMasukanKeuangan(klien, [p.id])).get(p.id)!;
  return { proyek: proyekRingkas(p), ringkasan: hitungRingkasanKeuangan(masukan) };
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
