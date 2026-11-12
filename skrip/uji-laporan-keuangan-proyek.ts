import "dotenv/config";
// Skrip ini memanggil aksi server dan route handler di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { D } from "../src/lib/uang";
import type { Hak, PenggunaSesi } from "../src/lib/hakAkses";
import { penggunaSaatIni } from "../src/lib/otentikasi";
import { periksaSinkron } from "../src/lib/sinkron";
import { terapkanBaganAkunStandar } from "../src/lib/baganAkun";
import { ringkasanKeuanganProyek } from "../src/lib/keuanganProyek";
import { buatPerekam } from "../src/lib/cetak";
import { buatPdfLaporanKeuanganProyek, dataLaporanKeuanganLampiran, dataLaporanKeuanganProyek, namaBerkasLaporanKeuangan, simpanLaporanKeuanganProyek } from "../src/lib/pdf/laporanKeuanganProyek";
import { simpanLaporanKeuanganKeBerkas, simpanLaporanKeuanganKeBerkasFormulir } from "../src/lib/aksi/laporanKeuanganProyek";
import { buatPembayaranMitra, buatTalanganMitra, tambahMitraProyek } from "../src/lib/aksi/bagiHasil";
import { buatFaktur, buatPenawaran, buatPenerimaan, konversiPenawaranKePesanan } from "../src/lib/aksi/penjualan";
import { buatKasKeluar } from "../src/lib/aksi/jurnal";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { GET as laporanGet } from "../src/app/cetak/proyek/[id]/keuangan/route";
import { aturPersetujuan, formulir, harusDitolak, jalankan, pastikan } from "./bantuan";

/*
 * Uji PDF laporan keuangan proyek (P38, D5 §6.4, §6.5, §9.1 B20):
 *  1. Data laporan sama dengan ringkasan halaman; B20: tanpa bagi-hasil.lihat bagian bagi hasil, pembayaran ke mitra,
 *     dan baris bagi laba tidak ada (jumlahnya hanya di keterangan), dengan hak itu ada; dokumen pendapatan disaring hak
 *     lihat per jenis.
 *  2. PDF diawali %PDF dan diakhiri %%EOF, isi teks lewat Perekam (judul bagian, angka, kaki halaman, penanda terpotong).
 *  3. Nama berkas.
 *  4. Rute GET /cetak/proyek/[id]/keuangan: PEMILIK 200 inline tanpa log, unduh attachment dengan satu log CETAK,
 *     KASIR dan GUDANG 403, proyek tidak ada 404.
 *  5. Simpan ke berkas: Berkas laporan-keuangan-proyek bertag DOKUMEN di folder KEUANGAN, isi %PDF, log UNGGAH dan
 *     CETAK; GUDANG, pengguna tanpa hak lihat, dan pengguna tanpa hak unggah ditolak; simpan kedua menjadi riwayat.
 *  5b. Versi lampiran (perbaikan tinjauan P45 T2): berkas yang disimpan PEMILIK tidak memuat bagi hasil, pembayaran ke
 *     mitra, baris bagi laba, maupun daftar dokumen pendapatan. Penanda terpotong menyebut baris tercetak (P45 R1).
 * Data uji berawalan LKP; berkas uji dihapus permanen, log dan notifikasi uji dibuang, periksaSinkron sama di awal dan
 * akhir. Tidak ada baris HakAksesPeran yang dibuat: pengguna tanpa hak tertentu dibentuk langsung sebagai PenggunaSesi.
 */

const K = "LKP";
const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");
const pdfSah = (b: Uint8Array) => latin1(b.subarray(0, 5)) === "%PDF-" && latin1(b.subarray(b.length - 8)).includes("%%EOF");

async function sebagaiPeran<T>(peran: string, fn: () => Promise<T>): Promise<T> {
  const lama = process.env.UJI_PERAN;
  process.env.UJI_PERAN = peran;
  try {
    return await fn();
  } finally {
    if (lama === undefined) delete process.env.UJI_PERAN;
    else process.env.UJI_PERAN = lama;
  }
}

const tanpaHak = (p: PenggunaSesi, ...buang: Hak[]): PenggunaSesi => ({ ...p, hak: p.hak.filter((h) => !buang.includes(h)) });

async function bersihkanDokumen(): Promise<string[]> {
  const proyekUji = (await db.proyek.findMany({ where: { kode: { startsWith: `PRJ-${K}` } }, select: { id: true } })).map((p) => p.id);
  const akunUji = (await db.akun.findMany({ where: { kode: { startsWith: `${K}-` } }, select: { id: true } })).map((a) => a.id);
  const pelanggan = { pelanggan: { kode: `CUST-${K}` } };
  const terbaru = { orderBy: [{ tanggal: "desc" as const }, { nomor: "desc" as const }], select: { id: true, nomor: true } };
  const nomor: string[] = [];
  const hapus = async (jenis: Parameters<typeof hapusDokumen>[0], d: { id: string; nomor: string }) => {
    nomor.push(d.nomor);
    await jalankan(`hapus ${d.nomor}`, () => hapusDokumen(jenis, d.id)).catch((e: unknown) => console.warn(`[bersih] ${d.nomor} gagal dihapus: ${(e as Error).message}`));
  };
  await db.berkas.deleteMany({ where: { jenisEntitas: "laporan-keuangan-proyek", entitasId: { in: proyekUji } } });
  for (const d of await db.pembayaranMitra.findMany({ where: { proyekId: { in: proyekUji } }, ...terbaru })) await hapus("pembayaranMitra", d);
  for (const d of await db.talanganMitra.findMany({ where: { proyekId: { in: proyekUji } }, ...terbaru })) await hapus("talanganMitra", d);
  for (const j of await db.jurnal.findMany({ where: { sumber: { in: ["KAS_MASUK", "KAS_KELUAR"] }, baris: { some: { akunId: { in: akunUji } } } }, select: { id: true, nomor: true } })) await hapus("jurnal", j);
  for (const d of await db.penerimaanPenjualan.findMany({ where: { faktur: pelanggan }, ...terbaru })) await hapus("penerimaan", d);
  for (const d of await db.fakturPenjualan.findMany({ where: pelanggan, ...terbaru })) await hapus("faktur", d);
  for (const d of await db.pesananPenjualan.findMany({ where: pelanggan, ...terbaru })) await hapus("pesanan", d);
  for (const d of await db.penawaranPenjualan.findMany({ where: pelanggan, ...terbaru })) await hapus("penawaran", d);
  return nomor;
}

async function bersihkanData() {
  await db.proyek.deleteMany({ where: { kode: { startsWith: `PRJ-${K}` } } });
  await db.barang.deleteMany({ where: { kode: { startsWith: `JSA-${K}` } } });
  await db.pelanggan.deleteMany({ where: { kode: `CUST-${K}` } });
  await db.akun.deleteMany({ where: { kode: { startsWith: `${K}-` } } });
}

async function teksPdf(data: Parameters<typeof buatPdfLaporanKeuanganProyek>[0]) {
  const perekam = buatPerekam();
  const isi = await buatPdfLaporanKeuanganProyek(data, { perekam });
  return { isi, teks: perekam.teks.map((t) => t.teks).join("\n"), halaman: perekam.halaman };
}

async function main() {
  await bersihkanDokumen();
  await bersihkanData();
  aturPersetujuan(false);

  const mulaiUji = new Date();
  const idLogAwal = new Set((await db.logAktivitas.findMany({ select: { id: true } })).map((l) => l.id));
  const jurnalAwal = await db.jurnal.count();
  const hakAwal = await db.hakAksesPeran.count();
  const berkasAwal = await db.berkas.count();
  const sinkronAwal = await periksaSinkron(db);
  let nomorDokumen: string[] = [];

  await terapkanBaganAkunStandar(db);
  const akun = (kode: string) => db.akun.findUniqueOrThrow({ where: { kode } });
  const [a1600, a1500] = await Promise.all(["5-1600", "5-1500"].map(akun));
  const kas = await db.akun.create({ data: { kode: `${K}-KAS`, nama: "Kas Uji Laporan Proyek", jenis: "ASET", kasBank: true } });
  const pelanggan = await db.pelanggan.create({ data: { kode: `CUST-${K}`, nama: "Klien Uji Laporan" } });
  const jasa = await db.barang.create({ data: { kode: `JSA-${K}-1`, nama: "Jasa Uji Laporan", jenis: "JASA", hargaBeli: 0, hargaJual: 1_000_000 } });
  const prj = await db.proyek.create({ data: { kode: `PRJ-${K}`, nama: "Event Uji / Laporan: Keuangan!", pelangganId: pelanggan.id, tanggalMulai: new Date("2026-03-01T12:00:00") } });
  const prjKosong = await db.proyek.create({ data: { kode: `PRJ-${K}2`, nama: "Event Uji Laporan Kosong" } });

  try {
    const pemilik = (await penggunaSaatIni())!;

    console.log("=== 0. Data proyek uji ===");
    await jalankan("PNW 10.000.000", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, proyekId: prj.id, baris: [{ barangId: jasa.id, jumlah: 10, harga: 1_000_000 }] })));
    const pnw = await db.penawaranPenjualan.findFirstOrThrow({ where: { proyekId: prj.id } });
    await jalankan("konversi ke PSJ", () => konversiPenawaranKePesanan(pnw.id));
    const psj = await db.pesananPenjualan.findFirstOrThrow({ where: { penawaranId: pnw.id } });
    await jalankan("FJ 10.000.000", () => buatFaktur(formulir({ pesananId: psj.id, baris: [{ barangId: jasa.id, jumlah: 10, harga: 1_000_000 }] })));
    const fj = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj.id } });
    await jalankan("TRM sebesar total faktur", () => buatPenerimaan(formulir({ fakturId: fj.id, akunId: kas.id, jumlah: D(fj.total).toFixed(2) })));
    await jalankan("KK 5-1600 2.500.000 (proyek)", () => buatKasKeluar(formulir({ akunKasId: kas.id, akunLawanId: a1600.id, jumlah: 2_500_000, keterangan: "Sewa venue uji laporan", proyekId: prj.id })));
    await jalankan("mitra persen 30", () => tambahMitraProyek(prj.id, formulir({ nama: "Mitra Laporan", mode: "PERSEN", nilai: 30 })));
    const mitra = await db.mitraProyek.findFirstOrThrow({ where: { proyekId: prj.id } });
    await jalankan("talangan 1.000.000", () => buatTalanganMitra(prj.id, formulir({ mitraId: mitra.id, akunBebanId: a1500.id, jumlah: 1_000_000, deskripsi: "Honor talent ditalangi", vendor: "Vendor Uji" })));
    await jalankan("bagi laba 500.000", () => buatPembayaranMitra(prj.id, formulir({ mitraId: mitra.id, jenis: "LABA", jumlah: 500_000, akunKasId: kas.id, catatan: "TRF laba uji" })));

    console.log("=== 1. Data laporan dan B20 ===");
    const penuh = (await dataLaporanKeuanganProyek(db, prj.id, pemilik))!;
    const kp = (await ringkasanKeuanganProyek(db, prj.id, { denganBagiHasil: true }))!;
    pastikan(JSON.stringify(penuh.ringkasan) === JSON.stringify(kp.ringkasan), "ringkasan laporan sama dengan ringkasan halaman (fungsi yang sama)");
    pastikan(penuh.ringkasan.aktual.equals(3_500_000) && penuh.ringkasan.diterima.equals(10_000_000) && penuh.ringkasan.bagiHasilDibayar.equals(500_000), `aktual 3.500.000, diterima 10.000.000, bagi hasil dibayar 500.000 (${penuh.ringkasan.aktual}, ${penuh.ringkasan.bagiHasilDibayar})`);
    pastikan(penuh.bagiHasil !== null && penuh.bagiHasil.mitra.length === 1 && penuh.bagiHasil.mitra[0].nama === "Mitra Laporan", "PEMILIK: bagian bagi hasil memuat mitra");
    pastikan(penuh.pembayaranMitra.length === 1 && penuh.pembayaranMitra[0].jenis === "LABA" && penuh.pembayaranMitra[0].mitra === "Mitra Laporan" && penuh.pembayaranMitra[0].jumlah.equals(500_000), "PEMILIK: pembayaran ke mitra memuat bagi laba 500.000");
    pastikan(penuh.biaya.baris.length === 2 && penuh.biaya.total.equals(penuh.ringkasan.aktual) && penuh.biaya.bagiLabaTersembunyi === null, "biaya: dua baris (tanpa baris bagi laba), Σ = biaya aktual");
    pastikan(penuh.biaya.baris[0].tanggal.getTime() <= penuh.biaya.baris[1].tanggal.getTime(), "biaya urut tanggal naik");
    pastikan(penuh.biaya.baris.some((b) => b.uraian.endsWith("(Vendor Uji)") && b.didanaiOleh === "Mitra Laporan (talangan)") && penuh.biaya.ditalangiMitra.equals(1_000_000) && penuh.biaya.dibayarPerusahaan.equals(2_500_000), "talangan: uraian dengan vendor, didanai mitra, dibayar perusahaan 2.500.000 dan ditalangi 1.000.000");
    pastikan(["Penawaran", "Pesanan", "Faktur"].every((j) => penuh.pendapatan.some((p) => p.jenis === j)), "pendapatan memuat penawaran, pesanan, dan faktur");

    const tanpaBagi = tanpaHak(pemilik, "bagi-hasil.lihat");
    const terbatas = (await dataLaporanKeuanganProyek(db, prj.id, tanpaBagi))!;
    pastikan(terbatas.bagiHasil === null && terbatas.pembayaranMitra.length === 0, "B20: tanpa bagi-hasil.lihat bagian bagi hasil dan pembayaran ke mitra tidak ada");
    pastikan(!JSON.stringify(terbatas.biaya.baris).includes("Bagi laba") && terbatas.biaya.bagiLabaTersembunyi?.equals(500_000) === true, "B20: baris bagi laba dibuang, jumlahnya hanya di bagiLabaTersembunyi");
    pastikan(JSON.stringify(terbatas.ringkasan) === JSON.stringify(penuh.ringkasan), "angka ringkasan tidak bergantung hak bagi hasil");
    const tanpaPembayaran = (await dataLaporanKeuanganProyek(db, prj.id, tanpaHak(pemilik, "pembayaran-mitra.lihat")))!;
    pastikan(tanpaPembayaran.bagiHasil !== null && tanpaPembayaran.pembayaranMitra.length === 0, "tanpa pembayaran-mitra.lihat: bagi hasil ada, daftar pembayaran ke mitra tidak");
    const tanpaFaktur = (await dataLaporanKeuanganProyek(db, prj.id, tanpaHak(pemilik, "faktur.lihat", "uang-muka.lihat")))!;
    pastikan(!tanpaFaktur.pendapatan.some((p) => p.jenis === "Faktur" || p.jenis === "Uang muka") && tanpaFaktur.pendapatan.some((p) => p.jenis === "Pesanan"), "dokumen pendapatan disaring hak lihat per jenis");
    pastikan((await dataLaporanKeuanganProyek(db, "tidak-ada", pemilik)) === null, "proyek tidak ada: null");

    console.log("=== 2. PDF ===");
    const p1 = await teksPdf(penuh);
    pastikan(pdfSah(p1.isi), "B20: PDF PEMILIK diawali %PDF dan diakhiri %%EOF");
    for (const t of ["LAPORAN KEUANGAN PROYEK", "1. Ringkasan", "2. Pendapatan", "3. Anggaran vs aktual", "4. Biaya aktual dan pembayar", "5. Penyelesaian dan bagi hasil", "6. Pembayaran ke mitra", "Nilai kontrak (pesanan)", "Rp 3.500.000", "Mitra Laporan", "Perusahaan (sisa)", "Bagi laba", "Halaman 1 dari"])
      pastikan(p1.teks.includes(t), `PDF PEMILIK memuat "${t}"`);
    pastikan(p1.teks.includes(`${prj.nama} | Rahasia, untuk internal dan mitra proyek ini`) && p1.teks.includes("Dibuat ") && p1.teks.includes(`oleh ${pemilik.nama}`), "kaki halaman dan baris dibuat oleh");
    const p2 = await teksPdf(terbatas);
    pastikan(pdfSah(p2.isi), "B20: PDF tanpa bagi-hasil.lihat diawali %PDF");
    pastikan(!p2.teks.includes("5. Penyelesaian dan bagi hasil") && !p2.teks.includes("6. Pembayaran ke mitra") && !p2.teks.includes("Bagian laba") && !p2.teks.includes("Perusahaan (sisa)"), "B20: PDF tanpa bagi-hasil.lihat tidak memuat bagian bagi hasil");
    pastikan(p2.teks.includes("termasuk bagi laba mitra Rp 500.000"), "PDF tanpa bagi-hasil.lihat menyebut jumlah bagi laba tanpa rincian mitra");
    const kosong = await teksPdf((await dataLaporanKeuanganProyek(db, prjKosong.id, pemilik))!);
    pastikan(pdfSah(kosong.isi) && kosong.teks.includes("Belum ada penawaran, pesanan, atau faktur untuk proyek ini.") && kosong.teks.includes("Belum ada biaya yang dijurnal.") && kosong.teks.includes("Belum ada mitra untuk proyek ini."), "proyek kosong: PDF sah dengan teks kosong tiap bagian");
    const panjang = { ...penuh, biaya: { ...penuh.biaya, terpotong: true, batas: 500, baris: Array.from({ length: 120 }, (_, i) => ({ ...penuh.biaya.baris[0], uraian: `Baris uji ${i + 1}` })) } };
    const p3 = await teksPdf(panjang);
    // perbaikan tinjauan P45 R1: penanda dan baris total menyebut jumlah baris yang benar-benar tercetak (120), bukan batas
    pastikan(pdfSah(p3.isi) && p3.halaman >= 3 && p3.teks.includes("Menampilkan 120 baris biaya terbaru") && p3.teks.includes("Total (120 baris terbaru)") && !p3.teks.includes("500 baris") && p3.teks.includes(`Halaman 1 dari ${p3.halaman}`), `biaya terpotong: penanda menyebut baris yang tercetak, tabel berlanjut ke ${p3.halaman} halaman`);

    console.log("=== 3. Nama berkas ===");
    pastikan(namaBerkasLaporanKeuangan(prj) === "Laporan-Keuangan-PRJ-LKP-Event-Uji-Laporan-Keuangan.pdf", `nama berkas dibersihkan (${namaBerkasLaporanKeuangan(prj)})`);
    pastikan(namaBerkasLaporanKeuangan({ kode: "P1", nama: "!!!" }) === "Laporan-Keuangan-P1-proyek.pdf" && namaBerkasLaporanKeuangan({ kode: "P1", nama: "a".repeat(80) }) === `Laporan-Keuangan-P1-${"a".repeat(60)}.pdf`, "nama kosong menjadi proyek, dipotong 60 karakter");

    console.log("=== 4. Rute GET /cetak/proyek/[id]/keuangan ===");
    const panggil = (id: string, query = "") => laporanGet(new Request(`http://localhost/cetak/proyek/${id}/keuangan${query}`), { params: Promise.resolve({ id }) });
    const logCetak = () => db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, aksi: "CETAK", modul: "anggaran-proyek", entitasId: prj.id } });
    const r1 = await panggil(prj.id);
    const isi1 = new Uint8Array(await r1.arrayBuffer());
    pastikan(r1.status === 200 && r1.headers.get("content-type") === "application/pdf" && pdfSah(isi1) && (r1.headers.get("content-disposition") ?? "").startsWith("inline") && r1.headers.get("cache-control") === "private, no-store", "PEMILIK: 200 PDF inline, private no-store");
    pastikan((r1.headers.get("content-disposition") ?? "").includes("Laporan-Keuangan-PRJ-LKP-Event-Uji-Laporan-Keuangan.pdf") && r1.headers.get("content-length") === String(isi1.byteLength), "nama berkas dan Content-Length");
    pastikan((await logCetak()) === 0, "pratinjau tidak dicatat");
    const r2 = await panggil(prj.id, "?unduh=1");
    pastikan(r2.status === 200 && (r2.headers.get("content-disposition") ?? "").startsWith("attachment") && pdfSah(new Uint8Array(await r2.arrayBuffer())), "unduh: attachment");
    const lg = await db.logAktivitas.findMany({ where: { waktu: { gte: mulaiUji }, aksi: "CETAK", modul: "anggaran-proyek", entitasId: prj.id } });
    pastikan(lg.length === 1 && lg[0].jenis === "Laporan Keuangan Proyek" && lg[0].nomor === prj.kode && lg[0].keterangan === "Unduh PDF" && lg[0].perusahaanId === "utama", "unduh: satu log CETAK modul anggaran-proyek");
    for (const peran of ["KASIR", "GUDANG"]) {
      const r = await sebagaiPeran(peran, () => panggil(prj.id));
      pastikan(r.status === 403 && (await r.text()) === "Anda tidak punya hak melihat keuangan proyek ini", `${peran}: 403`);
    }
    const r404 = await panggil("tidak-ada");
    pastikan(r404.status === 404 && (await r404.text()) === "Proyek tidak ditemukan", "proyek tidak ada: 404");

    console.log("=== 5. Simpan ke berkas ===");
    await jalankan("PEMILIK simpan laporan ke berkas", () => simpanLaporanKeuanganKeBerkas(prj.id));
    const tersimpan = await db.berkas.findMany({ where: { jenisEntitas: "laporan-keuangan-proyek", entitasId: prj.id }, include: { isi: true } });
    const b1 = tersimpan[0];
    pastikan(tersimpan.length === 1 && b1.tag === "DOKUMEN" && b1.folderKode === "KEUANGAN" && b1.proyekId === prj.id && b1.perusahaanId === "utama" && b1.tipeMime === "application/pdf" && b1.namaBerkas === namaBerkasLaporanKeuangan(prj), `berkas laporan bertag DOKUMEN di KEUANGAN (${b1?.namaBerkas})`);
    pastikan(!!b1.isi && latin1(new Uint8Array(b1.isi.isi).subarray(0, 5)) === "%PDF-", "isi berkas diawali %PDF");
    const logSimpan = await db.logAktivitas.findMany({ where: { waktu: { gte: mulaiUji }, OR: [{ aksi: "UNGGAH", entitasId: b1.id }, { aksi: "CETAK", modul: "anggaran-proyek", keterangan: "Simpan PDF ke berkas" }] } });
    pastikan(logSimpan.some((l) => l.aksi === "UNGGAH") && logSimpan.some((l) => l.aksi === "CETAK" && (l.meta as { disimpanKeBerkas?: boolean; berkasId?: string }).berkasId === b1.id), "log UNGGAH dan CETAK (meta disimpanKeBerkas, berkasId)");
    await sebagaiPeran("GUDANG", () => harusDitolak("GUDANG simpan laporan", () => simpanLaporanKeuanganKeBerkas(prj.id), "tidak punya hak"));
    const hasilFormulir = await sebagaiPeran("KASIR", () => simpanLaporanKeuanganKeBerkasFormulir(prj.id));
    pastikan(!!hasilFormulir.galat && hasilFormulir.galat.includes("tidak punya hak"), `versi Formulir mengembalikan galat untuk KASIR (${hasilFormulir.galat})`);
    await harusDitolak("tanpa anggaran-proyek.lihat", () => simpanLaporanKeuanganProyek(db, tanpaHak(pemilik, "anggaran-proyek.lihat"), prj.id), "tidak punya hak");
    await harusDitolak("tanpa hak unggah (anggaran-proyek.ubah dan berkas.buat)", () => simpanLaporanKeuanganProyek(db, tanpaHak(pemilik, "anggaran-proyek.ubah", "berkas.buat", "berkas.akses-penuh"), prj.id), "tidak punya hak mengunggah");
    await harusDitolak("proyek tidak ada", () => simpanLaporanKeuanganProyek(db, pemilik, "tidak-ada"), "Proyek tidak ditemukan");
    pastikan((await db.berkas.count({ where: { jenisEntitas: "laporan-keuangan-proyek", entitasId: prj.id } })) === 1, "penolakan tidak menyimpan berkas");
    const b2 = await simpanLaporanKeuanganProyek(db, tanpaBagi, prj.id);
    pastikan(b2.id !== b1.id && (await db.berkas.count({ where: { jenisEntitas: "laporan-keuangan-proyek", entitasId: prj.id, dihapusPada: null } })) === 2, "simpan kedua menjadi berkas kedua (riwayat)");

    console.log("=== 5b. Versi lampiran (perbaikan tinjauan P45 T2) ===");
    // berkas tersimpan dibaca setiap pemegang anggaran-proyek.lihat, jadi isinya versi hak minimum apa pun hak penyimpannya
    const lampiran = (await dataLaporanKeuanganLampiran(db, prj.id, pemilik))!;
    pastikan(lampiran.versiLampiran && !penuh.versiLampiran && lampiran.bagiHasil === null && lampiran.pembayaranMitra.length === 0 && lampiran.pendapatan.length === 0, "versi lampiran PEMILIK: tanpa bagi hasil, tanpa pembayaran ke mitra, tanpa daftar dokumen pendapatan");
    pastikan(!JSON.stringify(lampiran.biaya.baris).includes("Bagi laba") && lampiran.biaya.bagiLabaTersembunyi?.equals(500_000) === true && JSON.stringify(lampiran.ringkasan) === JSON.stringify(penuh.ringkasan) && lampiran.dibuatOleh === pemilik.nama, "versi lampiran: baris bagi laba menjadi keterangan, ringkasan sama, nama pembuat tetap penyimpan");
    const rekamSimpan = buatPerekam();
    const b3 = await simpanLaporanKeuanganProyek(db, pemilik, prj.id, { perekam: rekamSimpan });
    const teksSimpan = rekamSimpan.teks.map((t) => t.teks).join("\n");
    pastikan(
      !!b3.id &&
        !teksSimpan.includes("5. Penyelesaian dan bagi hasil") && !teksSimpan.includes("6. Pembayaran ke mitra") && !teksSimpan.includes("Perusahaan (sisa)") &&
        penuh.pendapatan.every((d) => !teksSimpan.includes(d.nomor)) &&
        teksSimpan.includes("Versi lampiran berkas") && teksSimpan.includes("Rincian dokumen pendapatan tidak dimuat di versi lampiran") && teksSimpan.includes("termasuk bagi laba mitra Rp 500.000"),
      `PDF yang disimpan PEMILIK: tanpa bagian bagi hasil dan nomor dokumen pendapatan; pendapatan hanya total (${["5. Penyelesaian dan bagi hasil", "6. Pembayaran ke mitra", "Perusahaan (sisa)", ...penuh.pendapatan.map((d) => d.nomor)].filter((t) => teksSimpan.includes(t)).join(", ")})`,
    );
  } finally {
    aturPersetujuan(false);
    nomorDokumen = await bersihkanDokumen();
    await bersihkanData();
    const logBaru = (await db.logAktivitas.findMany({ where: { waktu: { gte: mulaiUji } }, select: { id: true } })).map((l) => l.id).filter((id) => !idLogAwal.has(id));
    await db.logAktivitas.deleteMany({ where: { id: { in: logBaru } } });
    for (const n of nomorDokumen) await db.notifikasi.deleteMany({ where: { dibuatPada: { gte: mulaiUji }, judul: { contains: n } } });
  }

  console.log("=== 6. Bersih-bersih ===");
  pastikan((await db.jurnal.count()) === jurnalAwal, "jumlah jurnal kembali seperti awal");
  pastikan((await db.berkas.count()) === berkasAwal, "berkas uji dihapus permanen");
  pastikan((await db.proyek.count({ where: { kode: { startsWith: `PRJ-${K}` } } })) === 0 && (await db.akun.count({ where: { kode: { startsWith: `${K}-` } } })) === 0, "proyek dan akun uji terhapus");
  pastikan((await db.hakAksesPeran.count()) === hakAwal, "HakAksesPeran sama dengan awal");
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron sama dengan awal");
  console.log("=== DONE, all laporan-keuangan-proyek checks passed ===");
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
