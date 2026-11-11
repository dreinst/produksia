import { Prisma, type PrismaClient } from "@/prisma-klien/client";
import { db } from "@/lib/db";
import { D, type Desimal } from "@/lib/uang";

/*
 * Pemeriksaan sinkronisasi buku besar ↔ dokumen/stok. Dipakai kartu Integritas di beranda
 * dan skrip regresi `skrip/uji-sinkron.ts`. Setiap selisih ≠ 0 berarti ada jalur yang tidak
 * menjurnal (atau menjurnal dua kali), harus diperlakukan sebagai bug.
 *
 * Semua angka dijumlahkan di PostgreSQL (aggregate / SUM) sehingga biayanya tetap kecil
 * berapa pun banyaknya dokumen; tidak ada baris yang dimuat ke memori.
 *
 * opsi.perusahaanId (D1 §4.9) membatasi pemeriksaan ke satu perusahaan: jurnal menurut Jurnal.perusahaanId, dokumen
 * menurut perusahaanId-nya, dan stok menurut pemilik barang (K3: barang stok milik tepat satu perusahaan, jadi stok,
 * peminjaman, dan kerusakannya ikut perusahaan itu). Tanpa perusahaanId semua kueri sama persis dengan sebelumnya.
 */
export type Perbandingan = { bukuBesar: Desimal; dokumen: Desimal; selisih: Desimal; sinkron: boolean };
export type HasilSinkron = {
  pemetaanAda: boolean;
  seimbang: boolean;
  totalDebit: Desimal;
  totalKredit: Desimal;
  persediaan: Perbandingan;
  piutang: Perbandingan;
  hutang: Perbandingan;
  barangBelumDitagih: Perbandingan;
  barangTerkirim: Perbandingan;
  uangMuka: Perbandingan;
};

const TOLERANSI = D(1); // pembulatan harga rata-rata ke 2 desimal

function banding(bukuBesar: Desimal, dokumen: Desimal): Perbandingan {
  const selisih = bukuBesar.minus(dokumen);
  return { bukuBesar, dokumen, selisih, sinkron: selisih.abs().lte(TOLERANSI) };
}

type Jumlah = { nilai: Desimal | number | null }[];
const satu = (r: Jumlah) => D(r[0]?.nilai ?? 0);

export async function periksaSinkron(klien: PrismaClient = db, opsi: { perusahaanId?: string } = {}): Promise<HasilSinkron> {
  const p = opsi.perusahaanId || undefined;
  const saringJurnal = p ? { jurnal: { perusahaanId: p } } : {};
  const saringDok = p ? { perusahaanId: p } : {};
  const milikBarang = p ? Prisma.sql` AND b."perusahaanId" = ${p}` : Prisma.empty;
  const [pemetaan, total, akunPersediaanBarang, nilaiStokRaw, nilaiDipinjamRaw, nilaiRusakRaw, fakturJual, terimaJual, returJual, fakturBeli, bayarBeli, returBeli, belumDitagihRaw, terkirimRaw, uangMukaAgg] = await Promise.all([
    klien.pemetaanAkun.findUnique({ where: { id: "default" } }),
    p ? klien.barisJurnal.aggregate({ where: saringJurnal, _sum: { debit: true, kredit: true } }) : klien.barisJurnal.aggregate({ _sum: { debit: true, kredit: true } }),
    klien.barang.findMany({ where: { akunPersediaanId: { not: null } }, select: { akunPersediaanId: true }, distinct: ["akunPersediaanId"] }),
    // Σ stok × harga pokok rata-rata (hanya BARANG)
    klien.$queryRaw<Jumlah>`SELECT COALESCE(SUM(s."jumlah" * b."hargaBeli"), 0) AS nilai FROM "StokBarang" s JOIN "Barang" b ON b."id" = s."barangId" WHERE b."jenis" = 'BARANG'${milikBarang}`,
    // Peminjaman Barang mengurangi StokBarang saat disetujui TANPA jurnal (barang masih milik
    // perusahaan, cuma sedang di luar, bukan terjual/dipakai) — lihat src/lib/persetujuan.ts.
    // Supaya nilai stok tetap sama dengan saldo akun Persediaan, bagian yang masih di luar (jumlah -
    // jumlahKembali, TERMASUK yang ditutup dengan selisih/hilang) ditambahkan balik di sini, tanpa
    // peduli statusnya sudah ditautkan ke Penyesuaian Stok atau belum: tautkan hanya jejak opsional,
    // Penyesuaian Stok yang ditautkan tidak harus menyesuaikan barang/nilai yang sama (lihat
    // tautkanPenyesuaianPeminjaman di src/lib/aksi/peminjaman.ts). Dokumen DRAFT/MENUNGGU/DITOLAK
    // belum menyentuh stok sama sekali, jadi tidak diikutkan.
    klien.$queryRaw<Jumlah>`
      SELECT COALESCE(SUM((bp."jumlah" - bp."jumlahKembali") * b."hargaBeli"), 0) AS nilai
      FROM "BarisPeminjamanBarang" bp
      JOIN "PeminjamanBarang" p ON p."id" = bp."peminjamanId"
      JOIN "Barang" b ON b."id" = bp."barangId"
      WHERE p."statusPersetujuan" = 'DISETUJUI' AND b."jenis" = 'BARANG'${milikBarang}`,
    // Laporan Kerusakan Barang: sama alasannya dengan Peminjaman Barang di atas, tapi tanpa "jumlahKembali"
    // (tidak ada alur kembali — begitu disetujui, dianggap rusak permanen selamanya sampai ditautkan).
    klien.$queryRaw<Jumlah>`
      SELECT COALESCE(SUM(bk."jumlah" * b."hargaBeli"), 0) AS nilai
      FROM "BarisKerusakanBarang" bk
      JOIN "LaporanKerusakanBarang" k ON k."id" = bk."laporanId"
      JOIN "Barang" b ON b."id" = bk."barangId"
      WHERE k."statusPersetujuan" = 'DISETUJUI' AND b."jenis" = 'BARANG'${milikBarang}`,
    // Hanya dokumen yang sudah DISETUJUI (jurnalnya ada di buku besar); draf & yang menunggu persetujuan dikecualikan
    // supaya angka dokumen selalu sama dengan saldo buku besar. Lihat src/lib/persetujuan.ts.
    klien.fakturPenjualan.aggregate({ where: { statusPersetujuan: "DISETUJUI", ...saringDok }, _sum: { total: true, uangMuka: true } }),
    p ? klien.penerimaanPenjualan.aggregate({ where: saringDok, _sum: { jumlah: true, potonganPajak: true } }) : klien.penerimaanPenjualan.aggregate({ _sum: { jumlah: true, potonganPajak: true } }),
    p ? klien.returPenjualan.aggregate({ where: saringDok, _sum: { total: true } }) : klien.returPenjualan.aggregate({ _sum: { total: true } }),
    klien.fakturPembelian.aggregate({ where: { statusPersetujuan: "DISETUJUI", ...saringDok }, _sum: { total: true } }),
    p ? klien.pembayaranPembelian.aggregate({ where: saringDok, _sum: { jumlah: true, potonganPajak: true } }) : klien.pembayaranPembelian.aggregate({ _sum: { jumlah: true, potonganPajak: true } }),
    p ? klien.returPembelian.aggregate({ where: saringDok, _sum: { total: true } }) : klien.returPembelian.aggregate({ _sum: { total: true } }),
    // Σ per baris pesanan pembelian: (BARANG diterima − sudah difaktur) × harga pesanan (negatif bila faktur mendahului TB)
    klien.$queryRaw<Jumlah>`
      SELECT COALESCE(SUM((t."diterima" - bp."jumlahDifaktur") * bp."harga"), 0) AS nilai
      FROM (
        SELECT bt."barisPesananId", SUM(bt."jumlah") AS diterima
        FROM "BarisPenerimaanBarang" bt JOIN "Barang" b ON b."id" = bt."barangId"
        WHERE b."jenis" = 'BARANG' GROUP BY bt."barisPesananId"
      ) t JOIN "BarisPesananPembelian" bp ON bp."id" = t."barisPesananId"${
        p ? Prisma.sql` JOIN "PesananPembelian" ps ON ps."id" = bp."pesananId" WHERE ps."perusahaanId" = ${p}` : Prisma.empty
      }`,
    // Σ (BARANG dikirim − sudah difaktur) × harga pokok saat kirim
    p
      ? klien.$queryRaw<Jumlah>`SELECT COALESCE(SUM((bp."jumlah" - bp."jumlahDifaktur") * bp."hargaPokok"), 0) AS nilai FROM "BarisPengiriman" bp JOIN "Barang" b ON b."id" = bp."barangId" JOIN "PengirimanPesanan" pp ON pp."id" = bp."pengirimanId" WHERE b."jenis" = 'BARANG' AND pp."perusahaanId" = ${p}`
      : klien.$queryRaw<Jumlah>`SELECT COALESCE(SUM((bp."jumlah" - bp."jumlahDifaktur") * bp."hargaPokok"), 0) AS nilai FROM "BarisPengiriman" bp JOIN "Barang" b ON b."id" = bp."barangId" WHERE b."jenis" = 'BARANG'`,
    p ? klien.uangMukaPelanggan.aggregate({ where: saringDok, _sum: { jumlah: true, jumlahDipakai: true } }) : klien.uangMukaPelanggan.aggregate({ _sum: { jumlah: true, jumlahDipakai: true } }),
  ]);
  const totalDebit = D(total._sum.debit ?? 0);
  const totalKredit = D(total._sum.kredit ?? 0);
  const nol = D(0);
  const kosong = banding(nol, nol);
  if (!pemetaan) {
    return { pemetaanAda: false, seimbang: totalDebit.equals(totalKredit), totalDebit, totalKredit, persediaan: kosong, piutang: kosong, hutang: kosong, barangBelumDitagih: kosong, barangTerkirim: kosong, uangMuka: kosong };
  }

  // saldo tiap akun pembanding dalam satu groupBy (bukan satu kueri per akun)
  const akunPersediaan = [...new Set([pemetaan.persediaanId, ...akunPersediaanBarang.map((b) => b.akunPersediaanId!)])];
  const akunDicek = [...new Set([...akunPersediaan, pemetaan.piutangUsahaId, pemetaan.utangUsahaId, pemetaan.barangBelumDitagihId, pemetaan.barangTerkirimId, pemetaan.uangMukaPelangganId].filter((x): x is string => Boolean(x)))];
  const saldoPerAkun = new Map<string, { debit: Desimal; kredit: Desimal }>();
  for (const g of await klien.barisJurnal.groupBy({ by: ["akunId"], where: { akunId: { in: akunDicek }, ...saringJurnal }, _sum: { debit: true, kredit: true } })) {
    saldoPerAkun.set(g.akunId, { debit: D(g._sum.debit ?? 0), kredit: D(g._sum.kredit ?? 0) });
  }
  const saldo = (ids: (string | null | undefined)[], normalDebit: boolean) => {
    let debit = nol, kredit = nol;
    for (const id of ids) {
      const s = id ? saldoPerAkun.get(id) : undefined;
      if (!s) continue;
      debit = debit.plus(s.debit);
      kredit = kredit.plus(s.kredit);
    }
    return normalDebit ? debit.minus(kredit) : kredit.minus(debit);
  };

  const persediaan = banding(saldo(akunPersediaan, true), satu(nilaiStokRaw).plus(satu(nilaiDipinjamRaw)).plus(satu(nilaiRusakRaw)));
  // Piutang: Σ (total faktur − uang muka dipakai) − Σ (penerimaan + potongan pajak) − Σ retur
  const sisaPiutang = D(fakturJual._sum.total ?? 0).minus(fakturJual._sum.uangMuka ?? 0).minus(terimaJual._sum.jumlah ?? 0).minus(terimaJual._sum.potonganPajak ?? 0).minus(returJual._sum.total ?? 0);
  const piutang = banding(saldo([pemetaan.piutangUsahaId], true), sisaPiutang);
  // Hutang: Σ total faktur − Σ (pembayaran + potongan pajak) − Σ retur
  const sisaHutang = D(fakturBeli._sum.total ?? 0).minus(bayarBeli._sum.jumlah ?? 0).minus(bayarBeli._sum.potonganPajak ?? 0).minus(returBeli._sum.total ?? 0);
  const hutang = banding(saldo([pemetaan.utangUsahaId], false), sisaHutang);
  const barangBelumDitagih = pemetaan.barangBelumDitagihId ? banding(saldo([pemetaan.barangBelumDitagihId], false), satu(belumDitagihRaw)) : kosong;
  const barangTerkirim = pemetaan.barangTerkirimId ? banding(saldo([pemetaan.barangTerkirimId], true), satu(terkirimRaw)) : kosong;
  const nilaiUangMuka = D(uangMukaAgg._sum.jumlah ?? 0).minus(uangMukaAgg._sum.jumlahDipakai ?? 0);
  const uangMuka = pemetaan.uangMukaPelangganId ? banding(saldo([pemetaan.uangMukaPelangganId], false), nilaiUangMuka) : kosong;

  return { pemetaanAda: true, seimbang: totalDebit.equals(totalKredit), totalDebit, totalKredit, persediaan, piutang, hutang, barangBelumDitagih, barangTerkirim, uangMuka };
}

// ---------- Catatan konsumsi surat jalan (tinjauan perbaikan P27 R4) ----------

export type KodeKonsumsiSj = "TRANSIT_CATATAN" | "CATATAN_MELEBIHI_DIFAKTUR" | "DIFAKTUR_DI_LUAR_BATAS";
export type HasilKonsumsiSj = { sinkron: boolean; rincian: { kode: KodeKonsumsiSj; label: string; jumlah: number }[] };

/**
 * Invarian catatan konsumsi surat jalan (KonsumsiSuratJalan). Kerusakan di sini tidak terlihat periksaSinkron, karena
 * dokumen dan buku besar sama-sama mencatat transit. Semua harus 0:
 * 1. baris faktur tercatat (konsumsiSjTercatat) yang nilaiTransit-nya beda dari jumlah nilai catatannya;
 * 2. baris SJ yang jumlah catatan konsumsinya melebihi jumlahDifaktur-nya;
 * 3. baris SJ atau baris pesanan penjualan dengan jumlahDifaktur di luar 0..jumlah (dijaga CHECK sejak migrasi
 *    20261112100000_batas_jumlah_difaktur, tetap dihitung untuk berjaga-jaga).
 * Dihitung di PostgreSQL dalam satu kueri, tanpa memuat baris ke memori.
 */
export async function periksaKonsumsiSj(klien: PrismaClient | Prisma.TransactionClient = db): Promise<HasilKonsumsiSj> {
  const [baris] = await klien.$queryRaw<{ transit: number; melebihi: number; batas: number }[]>`
    SELECT
      (SELECT COUNT(*) FROM "BarisFakturPenjualan" bf
         JOIN "FakturPenjualan" f ON f."id" = bf."fakturId"
         LEFT JOIN (SELECT "barisFakturId", SUM("nilaiTransit") AS nilai FROM "KonsumsiSuratJalan" GROUP BY "barisFakturId") k ON k."barisFakturId" = bf."id"
       WHERE f."konsumsiSjTercatat" AND bf."nilaiTransit" <> COALESCE(k.nilai, 0))::int AS "transit",
      (SELECT COUNT(*) FROM "BarisPengiriman" bp
         JOIN (SELECT "barisPengirimanId", SUM("jumlah") AS jumlah FROM "KonsumsiSuratJalan" GROUP BY "barisPengirimanId") k ON k."barisPengirimanId" = bp."id"
       WHERE k.jumlah > bp."jumlahDifaktur")::int AS "melebihi",
      ((SELECT COUNT(*) FROM "BarisPengiriman" WHERE "jumlahDifaktur" < 0 OR "jumlahDifaktur" > "jumlah")
        + (SELECT COUNT(*) FROM "BarisPesananPenjualan" WHERE "jumlahDifaktur" < 0 OR "jumlahDifaktur" > "jumlah"))::int AS "batas"`;
  const rincian: HasilKonsumsiSj["rincian"] = [
    { kode: "TRANSIT_CATATAN", label: "Baris faktur yang nilai transitnya beda dari catatan konsumsi surat jalannya", jumlah: Number(baris?.transit ?? 0) },
    { kode: "CATATAN_MELEBIHI_DIFAKTUR", label: "Baris surat jalan yang catatan konsumsinya melebihi jumlah yang sudah difaktur", jumlah: Number(baris?.melebihi ?? 0) },
    { kode: "DIFAKTUR_DI_LUAR_BATAS", label: "Baris surat jalan atau pesanan dengan jumlah difaktur di bawah nol atau di atas jumlahnya", jumlah: Number(baris?.batas ?? 0) },
  ];
  return { sinkron: rincian.every((r) => r.jumlah === 0), rincian };
}

// ---------- Konsistensi perusahaan (D1 §4.9) ----------

export type KodeKonsistensi =
  | "JURNAL_DOKUMEN"
  | "ANAK_INDUK"
  | "AKUN_JURNAL"
  | "AKUN_DOKUMEN"
  | "GUDANG_DOKUMEN"
  | "PROYEK_DOKUMEN"
  | "BARANG_BARIS"
  | "STOK_GUDANG"
  | "KARYAWAN_GAJI"
  | "BERKAS_ENTITAS"
  | "KOP_DOKUMEN";
export type HasilKonsistensi = { konsisten: boolean; total: number; rincian: { kode: KodeKonsistensi; label: string; jumlah: number }[] };

/** Nama tabel atau kolom bertanda kutip. Hanya untuk konstanta di berkas ini, tidak pernah untuk masukan pengguna. */
const nm = (nama: string) => Prisma.raw(`"${nama}"`);

/** Baris tabel `t` yang perusahaannya berbeda dengan induk lewat kolom `fk` (induk `ti`, kolom perusahaan `kp` di induk). */
const bedaInduk = (t: string, fk: string, ti: string, kp = "perusahaanId", kpAnak = "perusahaanId") =>
  Prisma.sql`SELECT COUNT(*) FROM ${nm(t)} a JOIN ${nm(ti)} b ON b."id" = a.${nm(fk)} WHERE a.${nm(kpAnak)} <> b.${nm(kp)}`;

/** Dokumen berjurnal: perusahaan dokumen = perusahaan jurnalnya. */
const DOKUMEN_BERJURNAL = [
  "PengirimanPesanan", "FakturPenjualan", "UangMukaPelanggan", "PenerimaanPenjualan", "ReturPenjualan", "PenerimaanBarang", "FakturPembelian",
  "PembayaranPembelian", "ReturPembelian", "DokumenKas", "PenyesuaianPersediaan", "Prive", "Penggajian", "PphFinalBulanan", "TutupBukuPerusahaan",
  "TalanganMitra", "PembayaranMitra",
];

/** Dokumen turunan [tabel, kolom induk, tabel induk]. PJ dan BR dibandingkan dengan penyesuaian yang ditautkan. */
const ANAK_INDUK: [string, string, string][] = [
  ["PesananPenjualan", "penawaranId", "PenawaranPenjualan"],
  ["PengirimanPesanan", "pesananId", "PesananPenjualan"],
  ["FakturPenjualan", "pesananId", "PesananPenjualan"],
  ["FakturPenjualan", "pengirimanId", "PengirimanPesanan"],
  ["UangMukaPelanggan", "pesananId", "PesananPenjualan"],
  ["UangMukaPelanggan", "rencanaTerminId", "RencanaTermin"],
  ["PenerimaanPenjualan", "fakturId", "FakturPenjualan"],
  ["ReturPenjualan", "fakturId", "FakturPenjualan"],
  ["PenerimaanBarang", "pesananId", "PesananPembelian"],
  ["FakturPembelian", "pesananId", "PesananPembelian"],
  ["FakturPembelian", "penerimaanId", "PenerimaanBarang"],
  ["PembayaranPembelian", "fakturId", "FakturPembelian"],
  ["ReturPembelian", "fakturId", "FakturPembelian"],
  ["PeminjamanBarang", "penyesuaianId", "PenyesuaianPersediaan"],
  ["LaporanKerusakanBarang", "penyesuaianId", "PenyesuaianPersediaan"],
  ["RencanaTermin", "penawaranId", "PenawaranPenjualan"],
  ["RencanaTermin", "pesananId", "PesananPenjualan"],
  // CRM (D4 §3.13 butir 4): tahap, tindak lanjut, dan penawaran berlead satu perusahaan dengan lead
  ["Lead", "tahapId", "TahapLead"],
  ["TindakLanjut", "leadId", "Lead"],
  ["PenawaranPenjualan", "leadId", "Lead"],
  ["PesananPenjualan", "leadId", "Lead"],
  // kerja tim (D6 §3.0 butir 5): tugas desain mewarisi konten atau kampanyenya
  ["TugasDesain", "kontenId", "Konten"],
  ["TugasDesain", "kampanyeId", "Kampanye"],
];

/**
 * Akun di kepala dokumen [tabel, kolom akun] (tinjauan P14 R4). Dokumen berjurnal sudah tertangkap AKUN_JURNAL, tetapi
 * draf yang belum disetujui belum punya jurnal. Akun bersama (perusahaanId null) selalu boleh.
 */
const AKUN_KEPALA: [string, string][] = [
  ["DokumenKas", "akunKasId"], ["DokumenKas", "akunLawanId"], ["Prive", "akunKasId"], ["Prive", "akunPriveId"], ["UangMukaPelanggan", "akunId"],
  ["PenerimaanPenjualan", "akunId"], ["PembayaranPembelian", "akunId"], ["Penggajian", "akunKasId"], ["PenyesuaianPersediaan", "akunLawanId"],
  ["TalanganMitra", "akunBebanId"], ["PembayaranMitra", "akunKasId"], ["AsetTetap", "akunAsetId"], ["AsetTetap", "akunBebanPenyusutanId"],
  ["AsetTetap", "akunAkumulasiPenyusutanId"], ["AsetTetap", "akunPembayaranId"],
];

/** Dokumen bergudang [tabel, kolom gudang]. */
const DOKUMEN_BERGUDANG: [string, string][] = [
  ["PengirimanPesanan", "gudangId"], ["ReturPenjualan", "gudangId"], ["PenerimaanBarang", "gudangId"], ["ReturPembelian", "gudangId"],
  ["PenyesuaianPersediaan", "gudangId"], ["PindahBarang", "gudangAsalId"], ["PindahBarang", "gudangTujuanId"], ["PeminjamanBarang", "gudangId"],
  ["LaporanKerusakanBarang", "gudangId"],
];

/** Data berproyek. Peminjaman dan laporan kerusakan sengaja tidak ikut (catatan B D1 §3.3). */
const DATA_BERPROYEK = ["PenawaranPenjualan", "PesananPenjualan", "PesananPembelian", "Jurnal", "DokumenKas", "Penggajian", "TalanganMitra", "PembayaranMitra", "Konten", "TugasDesain", "Kampanye", "Berkas"];

/** Tabel baris ber-barangId [tabel baris, kolom kepala, tabel kepala]. */
const BARIS_BERBARANG: [string, string, string][] = [
  ["BarisPenawaranPenjualan", "penawaranId", "PenawaranPenjualan"],
  ["BarisPesananPenjualan", "pesananId", "PesananPenjualan"],
  ["BarisPengiriman", "pengirimanId", "PengirimanPesanan"],
  ["BarisFakturPenjualan", "fakturId", "FakturPenjualan"],
  ["BarisReturPenjualan", "returId", "ReturPenjualan"],
  ["BarisPesananPembelian", "pesananId", "PesananPembelian"],
  ["BarisPenerimaanBarang", "penerimaanId", "PenerimaanBarang"],
  ["BarisFakturPembelian", "fakturId", "FakturPembelian"],
  ["BarisReturPembelian", "returId", "ReturPembelian"],
  ["BarisPenyesuaianPersediaan", "penyesuaianId", "PenyesuaianPersediaan"],
  ["BarisPindahBarang", "pindahId", "PindahBarang"],
  ["BarisPeminjamanBarang", "peminjamanId", "PeminjamanBarang"],
  ["BarisKerusakanBarang", "laporanId", "LaporanKerusakanBarang"],
];

/**
 * Tabel entitas tiap `Berkas.jenisEntitas` (registri JENIS_LAMPIRAN di berkas.ts). Lampiran mewarisi perusahaan
 * entitasnya. Disalin di sini supaya berkas ini tetap bebas sesi; uji-laporan-perusahaan memastikan setiap jenis
 * lampiran punya tabel di peta ini.
 */
export const TABEL_ENTITAS_BERKAS: Record<string, string> = {
  penawaran: "PenawaranPenjualan",
  pesanan: "PesananPenjualan",
  "uang-muka": "UangMukaPelanggan",
  faktur: "FakturPenjualan",
  penerimaan: "PenerimaanPenjualan",
  "faktur-pembelian": "FakturPembelian",
  pembayaran: "PembayaranPembelian",
  "kas-masuk": "DokumenKas",
  "kas-keluar": "DokumenKas",
  jurnal: "Jurnal",
  aset: "AsetTetap",
  proyek: "Proyek",
  "laporan-keuangan-proyek": "Proyek",
  "rencana-termin": "RencanaTermin",
  konten: "Konten",
  "tugas-desain": "TugasDesain",
  "hasil-desain": "TugasDesain",
  kampanye: "Kampanye",
  "kop-surat": "KopSurat",
  "talangan-mitra": "TalanganMitra",
  "pembayaran-mitra": "PembayaranMitra",
};

function aturanKonsistensi(): { kode: KodeKonsistensi; label: string; hitung: Prisma.Sql[] }[] {
  const jenisPerTabel = new Map<string, string[]>();
  for (const [jenis, tabel] of Object.entries(TABEL_ENTITAS_BERKAS)) jenisPerTabel.set(tabel, [...(jenisPerTabel.get(tabel) ?? []), jenis]);
  return [
    {
      kode: "JURNAL_DOKUMEN",
      label: "Jurnal berbeda perusahaan dengan dokumennya",
      hitung: [
        ...DOKUMEN_BERJURNAL.map((t) => bedaInduk(t, "jurnalId", "Jurnal")),
        bedaInduk("AsetTetap", "jurnalPerolehanId", "Jurnal"),
        Prisma.sql`SELECT COUNT(*) FROM "PelepasanAset" x JOIN "AsetTetap" a ON a."id" = x."asetId" JOIN "Jurnal" j ON j."id" = x."jurnalId" WHERE a."perusahaanId" <> j."perusahaanId"`,
        Prisma.sql`SELECT COUNT(*) FROM "PenyusutanAset" x JOIN "AsetTetap" a ON a."id" = x."asetId" JOIN "Jurnal" j ON j."id" = x."jurnalId" WHERE a."perusahaanId" <> j."perusahaanId"`,
        bedaInduk("TransaksiAntarPerusahaan", "jurnalPemberiId", "Jurnal", "perusahaanId", "pemberiId"),
        bedaInduk("TransaksiAntarPerusahaan", "jurnalPenerimaId", "Jurnal", "perusahaanId", "penerimaId"),
        // TutupBuku.jurnalId selalu JU-TUTUP utama (P12); jurnal penutup perusahaan lain ada di TutupBukuPerusahaan
        Prisma.sql`SELECT COUNT(*) FROM "TutupBuku" x JOIN "Jurnal" j ON j."id" = x."jurnalId" WHERE j."perusahaanId" <> 'utama'`,
      ],
    },
    {
      kode: "ANAK_INDUK",
      label: "Dokumen turunan berbeda perusahaan dengan induknya",
      hitung: [
        ...ANAK_INDUK.map(([t, fk, ti]) => bedaInduk(t, fk, ti)),
        Prisma.sql`SELECT COUNT(*) FROM "PemakaianUangMuka" x JOIN "UangMukaPelanggan" u ON u."id" = x."uangMukaId" JOIN "FakturPenjualan" f ON f."id" = x."fakturId" WHERE u."perusahaanId" <> f."perusahaanId"`,
        // konsumsi SJ: faktur dan surat jalan yang dikonsumsinya harus satu perusahaan (perbaikan tinjauan P27)
        Prisma.sql`SELECT COUNT(*) FROM "KonsumsiSuratJalan" x JOIN "BarisFakturPenjualan" bf ON bf."id" = x."barisFakturId" JOIN "FakturPenjualan" f ON f."id" = bf."fakturId" JOIN "BarisPengiriman" bp ON bp."id" = x."barisPengirimanId" JOIN "PengirimanPesanan" s ON s."id" = bp."pengirimanId" WHERE f."perusahaanId" <> s."perusahaanId"`,
      ],
    },
    {
      kode: "AKUN_JURNAL",
      label: "Baris jurnal memakai akun milik perusahaan lain",
      hitung: [Prisma.sql`SELECT COUNT(*) FROM "BarisJurnal" bj JOIN "Jurnal" j ON j."id" = bj."jurnalId" JOIN "Akun" a ON a."id" = bj."akunId" WHERE a."perusahaanId" IS NOT NULL AND a."perusahaanId" <> j."perusahaanId"`],
    },
    {
      kode: "AKUN_DOKUMEN",
      label: "Dokumen memakai akun milik perusahaan lain",
      hitung: [
        ...AKUN_KEPALA.map(([t, kolom]) => Prisma.sql`SELECT COUNT(*) FROM ${nm(t)} d JOIN "Akun" a ON a."id" = d.${nm(kolom)} WHERE a."perusahaanId" IS NOT NULL AND a."perusahaanId" <> d."perusahaanId"`),
        ...["akunPenerimaanId", "akunLabaRugiId"].map(
          (kolom) => Prisma.sql`SELECT COUNT(*) FROM "PelepasanAset" x JOIN "AsetTetap" t ON t."id" = x."asetId" JOIN "Akun" a ON a."id" = x.${nm(kolom)} WHERE a."perusahaanId" IS NOT NULL AND a."perusahaanId" <> t."perusahaanId"`,
        ),
        ...[["akunPemberiId", "pemberiId"], ["akunPenerimaId", "penerimaId"]].map(
          ([kolom, pihak]) => Prisma.sql`SELECT COUNT(*) FROM "TransaksiAntarPerusahaan" d JOIN "Akun" a ON a."id" = d.${nm(kolom)} WHERE a."perusahaanId" IS NOT NULL AND a."perusahaanId" <> d.${nm(pihak)}`,
        ),
      ],
    },
    {
      kode: "GUDANG_DOKUMEN",
      label: "Dokumen memakai gudang milik perusahaan lain",
      hitung: DOKUMEN_BERGUDANG.map(([t, kolom]) => Prisma.sql`SELECT COUNT(*) FROM ${nm(t)} d JOIN "Gudang" g ON g."id" = d.${nm(kolom)} WHERE g."perusahaanId" IS NOT NULL AND g."perusahaanId" <> d."perusahaanId"`),
    },
    {
      kode: "PROYEK_DOKUMEN",
      label: "Dokumen atau jurnal memakai proyek perusahaan lain",
      hitung: [
        ...DATA_BERPROYEK.map((t) => bedaInduk(t, "proyekId", "Proyek")),
        bedaInduk("TransaksiAntarPerusahaan", "proyekPemberiId", "Proyek", "perusahaanId", "pemberiId"),
        bedaInduk("TransaksiAntarPerusahaan", "proyekPenerimaId", "Proyek", "perusahaanId", "penerimaId"),
      ],
    },
    {
      kode: "BARANG_BARIS",
      label: "Baris dokumen memakai barang milik perusahaan lain",
      hitung: BARIS_BERBARANG.map(
        ([t, fk, tk]) => Prisma.sql`SELECT COUNT(*) FROM ${nm(t)} x JOIN ${nm(tk)} d ON d."id" = x.${nm(fk)} JOIN "Barang" b ON b."id" = x."barangId" WHERE b."perusahaanId" IS NOT NULL AND b."perusahaanId" <> d."perusahaanId"`,
      ),
    },
    {
      kode: "STOK_GUDANG",
      label: "Stok barang tersimpan di gudang milik perusahaan lain",
      hitung: [Prisma.sql`SELECT COUNT(*) FROM "StokBarang" s JOIN "Barang" b ON b."id" = s."barangId" JOIN "Gudang" g ON g."id" = s."gudangId" WHERE s."jumlah" <> 0 AND g."perusahaanId" IS NOT NULL AND g."perusahaanId" <> b."perusahaanId"`],
    },
    {
      kode: "KARYAWAN_GAJI",
      label: "Baris gaji untuk karyawan perusahaan lain",
      hitung: [Prisma.sql`SELECT COUNT(*) FROM "BarisPenggajian" x JOIN "Penggajian" g ON g."id" = x."penggajianId" JOIN "Karyawan" k ON k."id" = x."karyawanId" WHERE k."perusahaanId" <> g."perusahaanId"`],
    },
    {
      kode: "BERKAS_ENTITAS",
      label: "Berkas lampiran berbeda perusahaan dengan data yang dilampirinya",
      hitung: [...jenisPerTabel].map(
        ([tabel, jenis]) => Prisma.sql`SELECT COUNT(*) FROM "Berkas" x JOIN ${nm(tabel)} e ON e."id" = x."entitasId" WHERE x."jenisEntitas" IN (${Prisma.join(jenis)}) AND x."perusahaanId" <> e."perusahaanId"`,
      ),
    },
    {
      // kontrak P30: kop dokumen milik perusahaan dokumen (D3 §3.1), gambar kop terlampir ke kopnya sendiri
      kode: "KOP_DOKUMEN",
      label: "Dokumen atau gambar kop memakai kop surat perusahaan lain",
      hitung: [
        ...["PenawaranPenjualan", "PesananPenjualan", "UangMukaPelanggan", "FakturPenjualan", "PenerimaanPenjualan"].map((t) => bedaInduk(t, "kopSuratId", "KopSurat")),
        Prisma.sql`SELECT COUNT(*) FROM "AsetKopSurat" x JOIN "KopSurat" k ON k."id" = x."kopSuratId" JOIN "Berkas" b ON b."id" = x."berkasId" WHERE b."perusahaanId" <> k."perusahaanId" OR b."jenisEntitas" IS DISTINCT FROM 'kop-surat' OR b."entitasId" IS DISTINCT FROM k."id"`,
      ],
    },
  ];
}

/**
 * Pemeriksaan konsistensi perusahaan untuk lingkup gabungan (D1 §4.9): menghitung data yang perusahaannya tidak cocok
 * dengan jurnal, induk, akun, gudang, proyek, barang, karyawan, entitas lampiran, atau kop suratnya. Semua harus 0. Satu kueri
 * berisi sub-kueri COUNT; tidak ada baris yang dimuat ke memori.
 */
export async function periksaKonsistensiPerusahaan(klien: PrismaClient | Prisma.TransactionClient = db): Promise<HasilKonsistensi> {
  const aturan = aturanKonsistensi();
  const kolom = aturan.map((a, i) => Prisma.sql`(${Prisma.join(a.hitung.map((q) => Prisma.sql`(${q})`), " + ")})::int AS ${Prisma.raw(`"k${i}"`)}`);
  const [baris] = await klien.$queryRaw<Record<string, number | bigint>[]>`SELECT ${Prisma.join(kolom, ", ")}`;
  const rincian = aturan.map((a, i) => ({ kode: a.kode, label: a.label, jumlah: Number(baris?.[`k${i}`] ?? 0) }));
  const total = rincian.reduce((s, r) => s + r.jumlah, 0);
  return { konsisten: total === 0, total, rincian };
}

/** Umur simpanan hasil konsistensi untuk beranda (tinjauan P14 S1). */
const UMUR_SIMPANAN_KONSISTENSI = 60_000;
/** Umur simpanan hasil yang gagal, supaya kueri berat yang gagal tidak diulang di setiap muat (tinjauan P16 R5). */
const UMUR_SIMPANAN_GAGAL = 20_000;
let simpananKonsistensi: { sampai: number; hasil: Promise<HasilKonsistensi> } | null = null;

/**
 * periksaKonsistensiPerusahaan dengan simpanan memori per proses selama 60 detik, untuk kartu Integritas beranda
 * gabungan (tinjauan P14 S1). Kueri ini memindai banyak tabel penuh, jadi tidak dijalankan di setiap muat beranda.
 * Permintaan yang datang bersamaan berbagi satu kueri. Hasil gagal disimpan 20 detik saja, lalu dicoba lagi. Halaman
 * integritas (P19) tetap memanggil periksaKonsistensiPerusahaan langsung.
 */
export function periksaKonsistensiTersimpan(): Promise<HasilKonsistensi> {
  const kini = Date.now();
  if (simpananKonsistensi && simpananKonsistensi.sampai > kini) return simpananKonsistensi.hasil;
  const hasil = periksaKonsistensiPerusahaan(db);
  const isi = { sampai: kini + UMUR_SIMPANAN_KONSISTENSI, hasil };
  simpananKonsistensi = isi;
  hasil.catch(() => {
    if (simpananKonsistensi === isi) isi.sampai = Math.min(isi.sampai, Date.now() + UMUR_SIMPANAN_GAGAL);
  });
  return hasil;
}

/** Mengosongkan simpanan periksaKonsistensiTersimpan (dipakai uji). */
export function lupakanKonsistensiTersimpan() {
  simpananKonsistensi = null;
}
