import "dotenv/config";
// Skrip ini memanggil aksi server dan route handler di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { db } from "../src/lib/db";
import { D } from "../src/lib/uang";
import type { Hak, PenggunaSesi } from "../src/lib/hakAkses";
import { penggunaSaatIni } from "../src/lib/otentikasi";
import { periksaSinkron } from "../src/lib/sinkron";
import { JENIS_LAMPIRAN } from "../src/lib/berkas";
import { simpanPdfDokumenPenjualan } from "../src/lib/pdf/dokumenPenjualan";
import { simpanPdfDokumen, simpanPdfDokumenFormulir } from "../src/lib/aksi/pdfPenjualan";
import { buatFaktur, buatPenawaran, buatPenerimaan, konversiPenawaranKePesanan } from "../src/lib/aksi/penjualan";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { GET as cetakGet } from "../src/app/cetak/[jenis]/[id]/route";
import TombolCetakDokumen from "../src/komponen/penjualan/TombolCetakDokumen";
import PanelCetak from "../src/komponen/cetak/PanelCetak";
import { aturPersetujuan, formulir, harusDitolak, jalankan, pastikan } from "./bantuan";

/*
 * Uji simpan PDF dokumen penjualan ke lampiran (P45, D2 §6.2 simpanPdfDokumen, D3 §9.1 butir 6):
 *  1. Faktur dan kwitansi: Berkas bertag DOKUMEN di jenis lampiran yang benar (faktur, penerimaan), isi %PDF, nama
 *     berkas aman dan sama dengan nama unduhan rute GET, simpan kedua menjadi riwayat, log UNGGAH.
 *  2. Penolakan: tanpa hak lihat dokumen (GUDANG lewat aksi, pengguna tanpa faktur.lihat), tanpa hak unggah, jenis
 *     tidak dikenal, dokumen tidak ada, ukuran tidak sah; versi Formulir mengembalikan galat. Tidak ada berkas tersimpan.
 *  3. TombolCetakDokumen: tidak tampil tanpa hak lihat, Simpan hanya bagi yang boleh mengunggah lampiran.
 * Data uji berawalan SPD; berkas uji dihapus permanen, log dan notifikasi uji dibuang, periksaSinkron sama di awal dan
 * akhir. Tidak ada baris HakAksesPeran yang dibuat: pengguna tanpa hak tertentu dibentuk langsung sebagai PenggunaSesi.
 */

const K = "SPD";
const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");
const NAMA_AMAN = /^[^\\/:*?"<>|\p{Cc}]+\.pdf$/u;

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

/** Cari elemen PanelCetak di pohon hasil TombolCetakDokumen (komponen async tidak bisa dirender renderToStaticMarkup). */
function cariPanel(n: ReactNode): ReactElement<Parameters<typeof PanelCetak>[0]> | null {
  if (Array.isArray(n)) {
    for (const x of n) {
      const h = cariPanel(x);
      if (h) return h;
    }
    return null;
  }
  if (!isValidElement(n)) return null;
  if (n.type === PanelCetak) return n as ReactElement<Parameters<typeof PanelCetak>[0]>;
  return cariPanel((n.props as { children?: ReactNode }).children);
}

async function bersihkan(): Promise<string[]> {
  const pelanggan = { pelanggan: { kode: `CUST-${K}` } };
  const terbaru = { orderBy: [{ tanggal: "desc" as const }, { nomor: "desc" as const }], select: { id: true, nomor: true } };
  const fj = await db.fakturPenjualan.findMany({ where: pelanggan, ...terbaru });
  const trm = await db.penerimaanPenjualan.findMany({ where: { faktur: pelanggan }, ...terbaru });
  const pnw = await db.penawaranPenjualan.findMany({ where: pelanggan, ...terbaru });
  await db.berkas.deleteMany({ where: { entitasId: { in: [...fj, ...trm, ...pnw].map((d) => d.id) } } });
  const nomor: string[] = [];
  const hapus = async (jenis: Parameters<typeof hapusDokumen>[0], d: { id: string; nomor: string }) => {
    nomor.push(d.nomor);
    await jalankan(`hapus ${d.nomor}`, () => hapusDokumen(jenis, d.id)).catch((e: unknown) => console.warn(`[bersih] ${d.nomor} gagal dihapus: ${(e as Error).message}`));
  };
  for (const d of trm) await hapus("penerimaan", d);
  for (const d of fj) await hapus("faktur", d);
  for (const d of await db.pesananPenjualan.findMany({ where: pelanggan, ...terbaru })) await hapus("pesanan", d);
  for (const d of pnw) await hapus("penawaran", d);
  await db.barang.deleteMany({ where: { kode: { startsWith: `JSA-${K}` } } });
  await db.pelanggan.deleteMany({ where: { kode: `CUST-${K}` } });
  await db.akun.deleteMany({ where: { kode: { startsWith: `${K}-` } } });
  return nomor;
}

async function main() {
  await bersihkan();
  aturPersetujuan(false);
  const mulaiUji = new Date();
  const idLogAwal = new Set((await db.logAktivitas.findMany({ select: { id: true } })).map((l) => l.id));
  const jurnalAwal = await db.jurnal.count();
  const berkasAwal = await db.berkas.count();
  const hakAwal = await db.hakAksesPeran.count();
  const sinkronAwal = await periksaSinkron(db);
  let nomorDokumen: string[] = [];

  const kas = await db.akun.create({ data: { kode: `${K}-KAS`, nama: "Kas Uji Simpan PDF", jenis: "ASET", kasBank: true } });
  const pelanggan = await db.pelanggan.create({ data: { kode: `CUST-${K}`, nama: "Klien Uji Simpan PDF" } });
  const jasa = await db.barang.create({ data: { kode: `JSA-${K}-1`, nama: "Jasa Uji Simpan PDF", jenis: "JASA", hargaBeli: 0, hargaJual: 1_000_000 } });

  try {
    const pemilik = (await penggunaSaatIni())!;
    await jalankan("PNW 5.000.000", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: jasa.id, jumlah: 5, harga: 1_000_000 }] })));
    const pnw = await db.penawaranPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id } });
    await jalankan("konversi ke PSJ", () => konversiPenawaranKePesanan(pnw.id));
    const psj = await db.pesananPenjualan.findFirstOrThrow({ where: { penawaranId: pnw.id } });
    await jalankan("FJ 5.000.000", () => buatFaktur(formulir({ pesananId: psj.id, baris: [{ barangId: jasa.id, jumlah: 5, harga: 1_000_000 }] })));
    const fj = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj.id } });
    await jalankan("TRM sebagian", () => buatPenerimaan(formulir({ fakturId: fj.id, akunId: kas.id, jumlah: D(fj.total).div(2).toFixed(2) })));
    const trm = await db.penerimaanPenjualan.findFirstOrThrow({ where: { fakturId: fj.id } });
    const berkasDok = (jenisEntitas: string, entitasId: string) => db.berkas.findMany({ where: { jenisEntitas, entitasId }, include: { isi: true }, orderBy: { dibuatPada: "asc" } });

    console.log("=== 1. Simpan PDF faktur dan kwitansi ===");
    await jalankan("PEMILIK simpan PDF faktur A5", () => simpanPdfDokumen("faktur", fj.id, formulir({ ukuran: "A5", ttd: "0" })));
    const bf = await berkasDok("faktur", fj.id);
    const unduh = await cetakGet(new Request(`http://localhost/cetak/faktur/${fj.id}?ukuran=A5&unduh=1`), { params: Promise.resolve({ jenis: "faktur", id: fj.id }) });
    const disposisi = decodeURIComponent((unduh.headers.get("content-disposition") ?? "").split("filename*=UTF-8''")[1] ?? "");
    pastikan(bf.length === 1 && bf[0].tag === "DOKUMEN" && bf[0].tipeMime === "application/pdf" && bf[0].perusahaanId === fj.perusahaanId && bf[0].folderKode === JENIS_LAMPIRAN.faktur.folderBawaan, `faktur: satu berkas DOKUMEN application/pdf di folder bawaan lampiran faktur (${bf[0]?.folderKode})`);
    pastikan(!!bf[0].isi && latin1(new Uint8Array(bf[0].isi.isi).subarray(0, 5)) === "%PDF-", "faktur: isi berkas diawali %PDF");
    pastikan(NAMA_AMAN.test(bf[0].namaBerkas) && bf[0].namaBerkas === disposisi, `faktur: nama berkas aman dan sama dengan nama unduhan rute GET (${bf[0].namaBerkas} | ${disposisi})`);
    const kotak = (b: Uint8Array) => latin1(b).match(/\/MediaBox \[[^\]]+\]/)?.[0];
    pastikan(!!kotak(new Uint8Array(bf[0].isi!.isi)) && kotak(new Uint8Array(bf[0].isi!.isi)) === kotak(new Uint8Array(await unduh.arrayBuffer())), `faktur: opsi formulir sama dengan rute GET berkueri sama (${kotak(new Uint8Array(bf[0].isi!.isi))})`);
    pastikan((await db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, aksi: "UNGGAH", entitasId: bf[0].id } })) === 1 && (await db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, aksi: "CETAK", entitasId: fj.id, meta: { path: ["disimpanKeBerkas"], equals: true } } })) === 0, "faktur: satu log UNGGAH, tanpa log CETAK karena tidak bertanda tangan");
    await jalankan("simpan PDF faktur kedua", () => simpanPdfDokumen("faktur", fj.id, formulir({})));
    pastikan((await berkasDok("faktur", fj.id)).length === 2, "simpan kedua menjadi berkas kedua (riwayat)");

    await sebagaiPeran("KASIR", () => jalankan("KASIR simpan PDF kwitansi", () => simpanPdfDokumen("kwitansi", trm.id, formulir({}))));
    const bk = await berkasDok("penerimaan", trm.id);
    pastikan(bk.length === 1 && bk[0].tag === "DOKUMEN" && bk[0].tipeMime === "application/pdf" && NAMA_AMAN.test(bk[0].namaBerkas) && latin1(new Uint8Array(bk[0].isi!.isi).subarray(0, 5)) === "%PDF-", `kwitansi: berkas DOKUMEN di lampiran penerimaan, isi %PDF (${bk[0]?.namaBerkas})`);

    const meta = await simpanPdfDokumenPenjualan(db, pemilik, "penawaran", pnw.id, formulir({}));
    pastikan(meta.jenisEntitas === "penawaran" && meta.entitasId === pnw.id && meta.tag === "DOKUMEN", "penawaran: berkas di lampiran penawaran");

    console.log("=== 2. Penolakan ===");
    const jumlahAwal = await db.berkas.count({ where: { entitasId: { in: [fj.id, trm.id, pnw.id] } } });
    await sebagaiPeran("GUDANG", () => harusDitolak("GUDANG simpan PDF faktur", () => simpanPdfDokumen("faktur", fj.id, formulir({})), "tidak punya hak"));
    await sebagaiPeran("GUDANG", () => harusDitolak("GUDANG simpan PDF kwitansi", () => simpanPdfDokumen("kwitansi", trm.id, formulir({})), "tidak punya hak"));
    const hasilFormulir = await sebagaiPeran("GUDANG", () => simpanPdfDokumenFormulir("faktur", fj.id, { galat: null }, formulir({})));
    pastikan(!!hasilFormulir.galat?.includes("tidak punya hak"), `versi Formulir mengembalikan galat (${hasilFormulir.galat})`);
    await harusDitolak("jenis tidak dikenal", () => simpanPdfDokumen("pesanan", psj.id, formulir({})), "Jenis dokumen tidak dikenal");
    await harusDitolak("dokumen tidak ada", () => simpanPdfDokumen("faktur", "tidak-ada", formulir({})), "Dokumen tidak ditemukan");
    await harusDitolak("ukuran A3", () => simpanPdfDokumen("faktur", fj.id, formulir({ ukuran: "A3" })), "Ukuran kertas tidak dikenal");
    await harusDitolak("tanpa faktur.lihat", () => simpanPdfDokumenPenjualan(db, tanpaHak(pemilik, "faktur.lihat"), "faktur", fj.id, formulir({})), "tidak punya hak");
    await harusDitolak("tanpa hak unggah faktur", () => simpanPdfDokumenPenjualan(db, tanpaHak(pemilik, "faktur.buat", "faktur.ubah", "berkas.buat", "berkas.akses-penuh"), "faktur", fj.id, formulir({})), "tidak punya hak mengunggah");
    await harusDitolak("tanpa hak unggah kwitansi", () => simpanPdfDokumenPenjualan(db, tanpaHak(pemilik, "penerimaan.buat", "penerimaan.ubah", "berkas.buat", "berkas.akses-penuh"), "kwitansi", trm.id, formulir({})), "tidak punya hak mengunggah");
    pastikan((await db.berkas.count({ where: { entitasId: { in: [fj.id, trm.id, pnw.id] } } })) === jumlahAwal, "penolakan tidak menyimpan berkas");

    console.log("=== 3. TombolCetakDokumen ===");
    const tombol = (p: PenggunaSesi, jenis: "faktur" | "kwitansi", id: string) => TombolCetakDokumen({ jenis, id, pengguna: p });
    const t1 = cariPanel(await tombol(pemilik, "faktur", fj.id));
    pastikan(!!t1 && t1.props.jenis === "faktur" && t1.props.id === fj.id && t1.props.perusahaanId === fj.perusahaanId && typeof t1.props.aksiSimpan === "function" && t1.props.draf === false, "PEMILIK: panel cetak faktur dengan Simpan PDF ke Lampiran");
    const t2 = cariPanel(await tombol(tanpaHak(pemilik, "faktur.buat", "faktur.ubah", "berkas.buat", "berkas.akses-penuh"), "faktur", fj.id));
    pastikan(!!t2 && t2.props.aksiSimpan === undefined, "tanpa hak unggah: panel tanpa Simpan PDF ke Lampiran");
    pastikan((await tombol(tanpaHak(pemilik, "faktur.lihat"), "faktur", fj.id)) === null && (await tombol(pemilik, "faktur", "tidak-ada")) === null, "tanpa faktur.lihat atau dokumen tidak ada: tombol tidak tampil");
    pastikan(!!cariPanel(await tombol(pemilik, "kwitansi", trm.id)), "kwitansi: panel cetak tampil");
  } finally {
    aturPersetujuan(false);
    nomorDokumen = await bersihkan();
    const logBaru = (await db.logAktivitas.findMany({ where: { waktu: { gte: mulaiUji } }, select: { id: true } })).map((l) => l.id).filter((id) => !idLogAwal.has(id));
    await db.logAktivitas.deleteMany({ where: { id: { in: logBaru } } });
    for (const n of nomorDokumen) await db.notifikasi.deleteMany({ where: { dibuatPada: { gte: mulaiUji }, judul: { contains: n } } });
  }

  console.log("=== 4. Bersih-bersih ===");
  pastikan((await db.berkas.count()) === berkasAwal, "berkas uji dihapus permanen");
  pastikan((await db.jurnal.count()) === jurnalAwal, "jumlah jurnal kembali seperti awal");
  pastikan((await db.hakAksesPeran.count()) === hakAwal, "HakAksesPeran sama dengan awal");
  pastikan(JSON.stringify(await periksaSinkron(db)) === JSON.stringify(sinkronAwal), "periksaSinkron sama dengan awal");
  console.log("=== DONE, all simpan-pdf checks passed ===");
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
