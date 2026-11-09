import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { createHash, randomBytes } from "node:crypto";
import { db } from "../src/lib/db";
import { punyaHak, type PenggunaSesi } from "../src/lib/hakAkses";
import { penggunaSaatIni } from "../src/lib/otentikasi";
import {
  ID_PERUSAHAAN_STANDAR,
  PERUSAHAAN_UTAMA,
  daftarPerusahaan,
  lingkupPerusahaan,
  pastikanBarangMilik,
  pemilikTunggalBarang,
  perusahaanDariInduk,
  perusahaanDokumenBaru,
  saringMilikAtauBersama,
  saringPerusahaan,
  simpanLingkupSesi,
  tentukanLingkup,
} from "../src/lib/perusahaan";
import { adaDataPerusahaanLain, akunDalamLingkup, muatDataBerandaKeuangan } from "../src/lib/berandaKeuangan";
import { gantiPerusahaanAktif } from "../src/lib/aksi/perusahaan";
import { formulir, harusDitolak, pastikan, sebagai } from "./bantuan";

/** Menjalankan fn dengan UJI_PERUSAHAAN (dan opsional UJI_PERAN) sementara; "semua" = gabungan. */
async function dengan<T>(isian: { perusahaan?: string; peran?: string }, fn: () => Promise<T>): Promise<T> {
  const lama = { perusahaan: process.env.UJI_PERUSAHAAN, peran: process.env.UJI_PERAN };
  const atur = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
  atur("UJI_PERUSAHAAN", isian.perusahaan);
  atur("UJI_PERAN", isian.peran);
  try {
    return await fn();
  } finally {
    atur("UJI_PERUSAHAAN", lama.perusahaan);
    atur("UJI_PERAN", lama.peran);
  }
}

/*
 * Salinan PERSIS kueri beranda sebelum multi perusahaan (src/app/(aplikasi)/page.tsx versi dasar, baris 58-77).
 * Menjadi pembanding: lingkup gabungan dan lingkup utama harus menghasilkan data yang sama dengan ini.
 */
async function kueriBerandaLama(now: Date) {
  const awalBulan = new Date(now.getFullYear(), now.getMonth(), 1);
  const [fakturJualBelumLunas, fakturBeliBelumLunas, daftarAkun, agregatAkun, daftarStok, jumlahBarang, daftarAset, penawaranDraf, pesananAktif, pengirimanBulanIni, penerimaanBulanIni, fakturTerbaru, pesananTerbaru, penerimaanTerbaru, pengirimanTerbaru, fakturBeliTerbaru, pembayaranTerbaru] = await Promise.all([
    db.fakturPenjualan.findMany({ where: { status: { not: "LUNAS" }, statusPersetujuan: "DISETUJUI" }, include: { penerimaan: true, retur: { select: { total: true } } } }),
    db.fakturPembelian.findMany({ where: { status: { not: "LUNAS" }, statusPersetujuan: "DISETUJUI" }, include: { pembayaran: true, retur: { select: { total: true } } } }),
    db.akun.findMany({ orderBy: { kode: "asc" } }),
    db.barisJurnal.groupBy({ by: ["akunId"], _sum: { debit: true, kredit: true } }),
    db.stokBarang.findMany({ include: { barang: true, gudang: true } }),
    db.barang.count({ where: { jenis: "BARANG" } }),
    db.asetTetap.findMany({ where: { status: "AKTIF", statusPersetujuan: "DISETUJUI" }, include: { penyusutan: true } }),
    db.penawaranPenjualan.findMany({ where: { status: "DRAF" } }),
    db.pesananPenjualan.findMany({ where: { status: { in: ["DRAF", "SEBAGIAN"] } } }),
    db.pengirimanPesanan.count({ where: { tanggal: { gte: awalBulan } } }),
    db.penerimaanPenjualan.findMany({ where: { tanggal: { gte: awalBulan } } }),
    db.fakturPenjualan.findMany({ include: { pelanggan: true }, orderBy: { tanggal: "desc" }, take: 4 }),
    db.pesananPenjualan.findMany({ include: { pelanggan: true, baris: true }, orderBy: { tanggal: "desc" }, take: 4 }),
    db.penerimaanPenjualan.findMany({ include: { pelanggan: true }, orderBy: { tanggal: "desc" }, take: 3 }),
    db.pengirimanPesanan.findMany({ include: { pesanan: { include: { pelanggan: true } } }, orderBy: { tanggal: "desc" }, take: 3 }),
    db.fakturPembelian.findMany({ include: { pemasok: true }, orderBy: { tanggal: "desc" }, take: 3 }),
    db.pembayaranPembelian.findMany({ include: { pemasok: true }, orderBy: { tanggal: "desc" }, take: 2 }),
  ]);
  return { fakturJualBelumLunas, fakturBeliBelumLunas, daftarAkun, agregatAkun, daftarStok, jumlahBarang, daftarAset, penawaranDraf, pesananAktif, pengirimanBulanIni, penerimaanBulanIni, fakturTerbaru, pesananTerbaru, penerimaanTerbaru, pengirimanTerbaru, fakturBeliTerbaru, pembayaranTerbaru };
}

type DataBeranda = Record<string, unknown>;

/** Bentuk kanonik untuk dibandingkan: larik tanpa urutan diurutkan, kolom tambahan `perusahaan` (lencana) dibuang. */
function kanonik(data: DataBeranda): Record<string, string> {
  const tanpaUrutan = new Set(["fakturJualBelumLunas", "fakturBeliBelumLunas", "agregatAkun", "daftarStok", "daftarAset", "penawaranDraf", "pesananAktif", "penerimaanBulanIni"]);
  const hasil: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    let nilai = v;
    if (Array.isArray(v)) {
      const bersih = v.map((x) => {
        const { perusahaan: _abaikan, ...sisa } = x as Record<string, unknown>;
        return sisa;
      });
      nilai = tanpaUrutan.has(k) ? bersih.map((x) => JSON.stringify(x)).sort() : bersih;
    }
    hasil[k] = JSON.stringify(nilai);
  }
  return hasil;
}

/** Angka KPI beranda dari data mentah, rumus sama dengan halaman. */
function angkaKpi(d: Awaited<ReturnType<typeof muatDataBerandaKeuangan>>, lingkupId: string | null) {
  const now = new Date();
  const ar = d.fakturJualBelumLunas.reduce((s, i) => s + Number(i.total) - Number(i.uangMuka) - i.penerimaan.reduce((t, r) => t + Number(r.jumlah) + Number(r.potonganPajak), 0) - i.retur.reduce((t, r) => t + Number(r.total), 0), 0);
  const ap = d.fakturBeliBelumLunas.reduce((s, i) => s + Number(i.total) - i.pembayaran.reduce((t, p) => t + Number(p.jumlah) + Number(p.potonganPajak), 0) - i.retur.reduce((t, r) => t + Number(r.total), 0), 0);
  const per = new Map(d.agregatAkun.map((g) => [g.akunId, { debit: Number(g._sum.debit ?? 0), kredit: Number(g._sum.kredit ?? 0) }]));
  const saldo = d.daftarAkun.map((a) => {
    const { debit, kredit } = per.get(a.id) ?? { debit: 0, kredit: 0 };
    return { ...a, debit, kredit, balance: ["ASET", "BEBAN"].includes(a.jenis) ? debit - kredit : kredit - debit };
  });
  const bertanda = saldo.filter((a) => a.kasBank && !a.kelompok && akunDalamLingkup(a, lingkupId));
  const kas = bertanda.reduce((s, a) => s + a.balance, 0);
  const persediaan = d.daftarStok.reduce((s, st) => s + Number(st.jumlah) * Number(st.barang.hargaBeli), 0);
  const totalDebit = saldo.reduce((s, a) => s + a.debit, 0);
  void now;
  return { ar, ap, kas, persediaan, totalDebit, jumlahBarang: d.jumlahBarang, aset: d.daftarAset.length, penawaran: d.penawaranDraf.length, pesanan: d.pesananAktif.length, pengiriman: d.pengirimanBulanIni, terbaru: d.fakturTerbaru.length + d.pesananTerbaru.length + d.penerimaanTerbaru.length + d.pengirimanTerbaru.length + d.fakturBeliTerbaru.length + d.pembayaranTerbaru.length };
}

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

async function main() {
  const mulaiUji = new Date();
  const idSesiUji: string[] = [];
  const now = new Date();

  console.log("=== 1. tentukanLingkup (fungsi murni) ===");
  const ada = new Set<string>(ID_PERUSAHAAN_STANDAR);
  pastikan(tentukanLingkup({ pilihan: "tapussa", bolehGabungan: false, adaIds: ada }) === "tapussa", "pilihan yang ada dipakai apa adanya");
  pastikan(tentukanLingkup({ pilihan: "tidak-ada", bolehGabungan: true, adaIds: ada }) === null, "pilihan tidak ada + boleh gabungan → gabungan");
  pastikan(tentukanLingkup({ pilihan: "tidak-ada", bolehGabungan: false, adaIds: ada }) === "utama", "pilihan tidak ada + tanpa hak gabungan → utama");
  pastikan(tentukanLingkup({ pilihan: null, bolehGabungan: true, adaIds: ada }) === null, "belum memilih + boleh gabungan → gabungan");
  pastikan(tentukanLingkup({ pilihan: null, bolehGabungan: false, adaIds: ada }) === "utama", "belum memilih + tanpa hak gabungan → utama");
  pastikan(tentukanLingkup({ pilihan: null, bolehGabungan: false, adaIds: new Set(["smara", "sahara"]) }) === "smara", "utama tidak ada → perusahaan pertama");

  console.log("=== 2. lingkupPerusahaan di luar HTTP (K5: UJI_PERUSAHAAN atau utama) ===");
  pastikan((await dengan({}, lingkupPerusahaan)).perusahaanId === "utama", "tanpa UJI_PERUSAHAAN → utama");
  const lGab = await dengan({ perusahaan: "semua" }, lingkupPerusahaan);
  pastikan(lGab.perusahaanId === null && lGab.perusahaan === null && lGab.bolehGabungan, "UJI_PERUSAHAAN=semua (Pemilik) → gabungan");
  const lTap = await dengan({ perusahaan: "tapussa" }, lingkupPerusahaan);
  pastikan(lTap.perusahaanId === "tapussa" && lTap.perusahaan?.kode === "TAPUSSA", "UJI_PERUSAHAAN=tapussa → Tapussa beserta ringkasannya");
  const lKasir = await dengan({ perusahaan: "semua", peran: "KASIR" }, lingkupPerusahaan);
  pastikan(lKasir.perusahaanId === "utama" && !lKasir.bolehGabungan, "UJI_PERUSAHAAN=semua + KASIR (tanpa hak gabungan) → utama");
  pastikan((await dengan({ perusahaan: "semua", peran: "GUDANG" }, lingkupPerusahaan)).perusahaanId === null, "GUDANG punya hak gabungan → gabungan");
  pastikan((await dengan({ perusahaan: "tidak-ada", peran: "KASIR" }, lingkupPerusahaan)).perusahaanId === "utama", "id tak dikenal + KASIR → utama");
  pastikan((await dengan({ perusahaan: "tidak-ada" }, lingkupPerusahaan)).perusahaanId === null, "id tak dikenal + Pemilik → gabungan");

  console.log("=== 3. Hak perusahaan-gabungan.lihat per peran ===");
  for (const peran of ["PEMILIK", "SUPERADMIN", "ADMIN", "GUDANG", "SOSMED", "IKLAN", "DESAINER"] as const) {
    pastikan(punyaHak(peran, "perusahaan-gabungan.lihat"), `${peran} punya perusahaan-gabungan.lihat`);
  }
  for (const peran of ["KASIR", "KRU", "GUEST"] as const) {
    pastikan(!punyaHak(peran, "perusahaan-gabungan.lihat"), `${peran} tidak punya perusahaan-gabungan.lihat`);
  }

  console.log("=== 4. Penyaring dan daftar perusahaan ===");
  pastikan(JSON.stringify(saringPerusahaan(null)) === "{}" && JSON.stringify(saringPerusahaan(undefined)) === "{}", "saringPerusahaan gabungan = {}");
  pastikan(saringPerusahaan("smara").perusahaanId === "smara", "saringPerusahaan satu perusahaan");
  pastikan(JSON.stringify(saringMilikAtauBersama(null)) === "{}", "saringMilikAtauBersama gabungan = {}");
  pastikan(JSON.stringify(saringMilikAtauBersama("smara")) === JSON.stringify({ OR: [{ perusahaanId: "smara" }, { perusahaanId: null }] }), "saringMilikAtauBersama = milik ATAU bersama");
  const daftarAktif = await daftarPerusahaan();
  pastikan(daftarAktif.length >= 6 && daftarAktif[0].id === "utama" && daftarAktif.every((p) => p.aktif), "daftarPerusahaan aktif, utama paling atas");

  console.log("=== 5. Beranda keuangan: gabungan dan utama identik dengan kueri lama ===");
  const lama = kanonik(await kueriBerandaLama(now));
  const dataGab = await muatDataBerandaKeuangan(null, now);
  const dataUtama = await muatDataBerandaKeuangan(PERUSAHAAN_UTAMA, now);
  const kGab = kanonik(dataGab);
  const kUtama = kanonik(dataUtama);
  for (const k of Object.keys(lama)) {
    pastikan(kGab[k] === lama[k], `gabungan: ${k} sama persis dengan beranda lama`);
    pastikan(kUtama[k] === lama[k], `utama: ${k} sama persis dengan beranda lama (data lama milik utama)`);
  }
  const kpiGab = angkaKpi(dataGab, null);
  const kpiUtama = angkaKpi(dataUtama, PERUSAHAAN_UTAMA);
  pastikan(JSON.stringify(kpiGab) === JSON.stringify(kpiUtama), `KPI gabungan = KPI utama ${JSON.stringify(kpiGab)}`);
  pastikan(kpiGab.totalDebit > 0 && kpiGab.terbaru > 0, "basis data uji punya data beranda (pembanding tidak kosong)");
  pastikan(!(await adaDataPerusahaanLain(PERUSAHAAN_UTAMA)), "data lama tidak punya jurnal/barang perusahaan lain (panel tren & integritas utama tetap tampil)");

  console.log("=== 6. Beranda keuangan: perusahaan lain menampilkan nol pada data lama ===");
  const dataTap = await muatDataBerandaKeuangan("tapussa", now);
  const kpiTap = angkaKpi(dataTap, "tapussa");
  pastikan(Object.values(kpiTap).every((v) => v === 0), `semua KPI Tapussa nol ${JSON.stringify(kpiTap)}`);
  pastikan(dataTap.daftarAkun.length === dataGab.daftarAkun.length, "daftar akun tetap lengkap (saldo nol), akun kas disaring di halaman");
  pastikan(await adaDataPerusahaanLain("tapussa"), "Tapussa: ada data perusahaan lain → panel tren & integritas global disembunyikan");

  console.log("=== 7. Data milik perusahaan lain hanya masuk lingkupnya ===");
  const akunKas = await db.akun.findFirstOrThrow({ where: { kasBank: true, kelompok: false, perusahaanId: null }, orderBy: { kode: "asc" } });
  const akunLawan = await db.akun.findFirstOrThrow({ where: { jenis: "PENDAPATAN", kelompok: false }, orderBy: { kode: "asc" } });
  const akunKasSmara = await db.akun.create({ data: { kode: "UJILP-KAS", nama: "Kas Uji Lingkup Smara", jenis: "ASET", kasBank: true, perusahaanId: "smara" } });
  const jurnalSmara = await db.jurnal.create({
    data: {
      nomor: `UJILP-${Date.now()}`,
      keterangan: "Uji lingkup perusahaan",
      perusahaanId: "smara",
      baris: { create: [{ akunId: akunKasSmara.id, debit: 125000 }, { akunId: akunLawan.id, kredit: 125000 }] },
    },
  });
  const gudang = await db.gudang.findFirstOrThrow({ orderBy: { kode: "asc" } });
  const barangSmara = await db.barang.create({ data: { kode: "UJILP-BRG", nama: "Barang Uji Lingkup", jenis: "BARANG", hargaBeli: 2000, perusahaanId: "smara" } });
  await db.stokBarang.create({ data: { barangId: barangSmara.id, gudangId: gudang.id, jumlah: 5 } });

  const kpiSmara = angkaKpi(await muatDataBerandaKeuangan("smara", now), "smara");
  pastikan(kpiSmara.kas === 125000 && kpiSmara.persediaan === 10000 && kpiSmara.jumlahBarang === 1, `Smara: kas 125.000, persediaan 10.000, 1 barang (${JSON.stringify(kpiSmara)})`);
  const kpiUtama2 = angkaKpi(await muatDataBerandaKeuangan(PERUSAHAAN_UTAMA, now), PERUSAHAAN_UTAMA);
  pastikan(JSON.stringify(kpiUtama2) === JSON.stringify(kpiUtama), "utama tidak berubah oleh data Smara (akun kas Smara tidak ikut)");
  const kpiGab2 = angkaKpi(await muatDataBerandaKeuangan(null, now), null);
  pastikan(kpiGab2.kas === kpiGab.kas + 125000 && kpiGab2.persediaan === kpiGab.persediaan + 10000 && kpiGab2.jumlahBarang === kpiGab.jumlahBarang + 1, "gabungan = utama + Smara");
  pastikan(akunDalamLingkup(akunKas, "smara") && !akunDalamLingkup(akunKasSmara, "utama") && akunDalamLingkup(akunKasSmara, null), "akunDalamLingkup: bersama masuk semua lingkup, milik Smara hanya Smara dan gabungan");
  pastikan(await adaDataPerusahaanLain(PERUSAHAAN_UTAMA), "utama: setelah ada jurnal Smara, panel global disembunyikan");

  console.log("=== 8. Pembantu dokumen ===");
  pastikan((await dengan({}, () => perusahaanDokumenBaru(formulir({})))) === "utama", "perusahaanDokumenBaru tanpa isian di skrip → utama");
  pastikan((await dengan({ perusahaan: "smara" }, () => perusahaanDokumenBaru(formulir({})))) === "smara", "perusahaanDokumenBaru mengikuti lingkup");
  await harusDitolak("dokumen baru di lingkup gabungan tanpa isian", () => dengan({ perusahaan: "semua" }, () => perusahaanDokumenBaru(formulir({}))), "Pilih perusahaan untuk dokumen ini");
  pastikan((await dengan({ perusahaan: "semua" }, () => perusahaanDokumenBaru(formulir({ perusahaanId: "tapussa" })))) === "tapussa", "gabungan + isian perusahaanId → isian dipakai");
  await harusDitolak("dokumen baru untuk perusahaan tak dikenal", () => perusahaanDokumenBaru(formulir({ perusahaanId: "tidak-ada" })), "Perusahaan tidak ditemukan");
  const arsip = await db.perusahaan.create({ data: { kode: "UJILP", nama: "PT Uji Lingkup Arsip", aktif: false, urutan: 99 } });
  await harusDitolak("dokumen baru untuk perusahaan arsip", () => perusahaanDokumenBaru(formulir({ perusahaanId: arsip.id })), "sudah diarsipkan");
  pastikan(perusahaanDariInduk({ perusahaanId: "smara", nomor: "FJ-X" }) === "smara", "perusahaanDariInduk mewarisi induk");
  pastikan(perusahaanDariInduk({ perusahaanId: "smara", nomor: "FJ-X" }, formulir({ perusahaanId: "smara" })) === "smara", "perusahaanDariInduk menerima isian yang sama");
  await harusDitolak("dokumen anak beda perusahaan", async () => perusahaanDariInduk({ perusahaanId: "smara", nomor: "FJ-X" }, formulir({ perusahaanId: "utama" })), "Dokumen induk FJ-X milik perusahaan lain");
  const barangUtama = await db.barang.findFirstOrThrow({ where: { jenis: "BARANG", perusahaanId: "utama" }, orderBy: { kode: "asc" } });
  await harusDitolak("barang milik perusahaan lain", () => pastikanBarangMilik(db, [barangSmara.id], "utama"), "UJILP-BRG - Barang Uji Lingkup milik SMARA");
  await pastikanBarangMilik(db, [barangUtama.id], "utama");
  pastikan((await pemilikTunggalBarang(db, [barangSmara.id])) === "smara", "pemilikTunggalBarang satu pemilik");
  await harusDitolak("barang dua pemilik dalam satu dokumen", () => pemilikTunggalBarang(db, [barangSmara.id, barangUtama.id]), "Satu dokumen hanya untuk barang milik satu perusahaan (DPRO, SMARA)");

  console.log("=== 9. Ganti lingkup: simpan ke Sesi.perusahaanAktifId ===");
  const pemilik = await sebagai("owner", penggunaSaatIni);
  const kasir = await sebagai("kasir", penggunaSaatIni);
  pastikan(!!pemilik && !!kasir, "pengguna seed owner dan kasir ada");
  const buatSesiUji = async (p: PenggunaSesi) => {
    const s = await db.sesi.create({ data: { tokenHash: hash(randomBytes(32).toString("hex")), penggunaId: p.id, kedaluwarsa: new Date(Date.now() + 3600_000) } });
    idSesiUji.push(s.id);
    return s.id;
  };
  const sesiPemilik = await buatSesiUji(pemilik!);
  const sesiKasir = await buatSesiUji(kasir!);
  const nilaiSesi = async (id: string) => (await db.sesi.findUniqueOrThrow({ where: { id } })).perusahaanAktifId;
  pastikan((await nilaiSesi(sesiPemilik)) === null, "sesi baru belum memilih (null)");

  pastikan((await simpanLingkupSesi(db, sesiPemilik, "tapussa", pemilik!)) === "tapussa" && (await nilaiSesi(sesiPemilik)) === "tapussa", "Pemilik memilih Tapussa → tersimpan di Sesi");
  pastikan((await simpanLingkupSesi(db, sesiPemilik, "semua", pemilik!)) === null && (await nilaiSesi(sesiPemilik)) === null, "Pemilik memilih gabungan → Sesi.perusahaanAktifId null");
  pastikan((await simpanLingkupSesi(db, sesiKasir, "smara", kasir!)) === "smara" && (await nilaiSesi(sesiKasir)) === "smara", "Kasir memilih Smara → tersimpan");
  await harusDitolak("Kasir memilih gabungan", () => simpanLingkupSesi(db, sesiKasir, "semua", kasir!), "tidak punya hak");
  pastikan((await nilaiSesi(sesiKasir)) === "smara", "penolakan gabungan tidak mengubah Sesi Kasir");
  await harusDitolak("id perusahaan tak dikenal", () => simpanLingkupSesi(db, sesiPemilik, "tidak-ada", pemilik!), "Perusahaan tidak ditemukan");
  await harusDitolak("perusahaan arsip", () => simpanLingkupSesi(db, sesiPemilik, arsip.id, pemilik!), "sudah diarsipkan");
  await harusDitolak("pilihan kosong", () => simpanLingkupSesi(db, sesiPemilik, "  ", pemilik!), "Pilih perusahaan");
  pastikan((await nilaiSesi(sesiPemilik)) === null, "penolakan tidak mengubah Sesi Pemilik");
  pastikan(tentukanLingkup({ pilihan: await nilaiSesi(sesiKasir), bolehGabungan: false, adaIds: ada }) === "smara", "pilihan Sesi Kasir menjadi lingkup");

  // perusahaan pilihan dihapus → FK SetNull → kembali ke aturan bawaan
  await db.perusahaan.update({ where: { id: arsip.id }, data: { aktif: true } });
  await simpanLingkupSesi(db, sesiKasir, arsip.id, kasir!);
  await db.perusahaan.delete({ where: { id: arsip.id } });
  const sisaKasir = await nilaiSesi(sesiKasir);
  pastikan(sisaKasir === null && tentukanLingkup({ pilihan: sisaKasir, bolehGabungan: false, adaIds: ada }) === "utama", "perusahaan pilihan dihapus → Sesi null → Kasir kembali ke utama");

  console.log("=== 10. Aksi gantiPerusahaanAktif ===");
  await harusDitolak("ganti lingkup di luar peramban", () => gantiPerusahaanAktif(formulir({ perusahaanId: "tapussa" })), "hanya bisa diganti dari peramban");
  await harusDitolak("ganti lingkup gabungan oleh Kasir di luar peramban", () => dengan({ peran: "KASIR" }, () => gantiPerusahaanAktif(formulir({ perusahaanId: "semua" }))), "hanya bisa diganti dari peramban");

  console.log("=== Bersih-bersih ===");
  await db.sesi.deleteMany({ where: { id: { in: idSesiUji } } });
  await db.stokBarang.deleteMany({ where: { barangId: barangSmara.id } });
  await db.barang.delete({ where: { id: barangSmara.id } });
  await db.barisJurnal.deleteMany({ where: { jurnalId: jurnalSmara.id } });
  await db.jurnal.delete({ where: { id: jurnalSmara.id } });
  await db.akun.delete({ where: { id: akunKasSmara.id } });
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji } } });
  pastikan((await db.perusahaan.count({ where: { kode: "UJILP" } })) === 0, "perusahaan uji terhapus");
  pastikan(!(await adaDataPerusahaanLain(PERUSAHAAN_UTAMA)), "data perusahaan lain uji sudah bersih");
  const lamaAkhir = kanonik(await kueriBerandaLama(now));
  pastikan(Object.keys(lama).every((k) => lamaAkhir[k] === lama[k]), "data beranda kembali seperti awal");
  console.log("=== DONE, all lingkup perusahaan checks passed ===");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("TEST FAILED", err);
    process.exit(1);
  });
