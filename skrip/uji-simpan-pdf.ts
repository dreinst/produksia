import "dotenv/config";
// Skrip ini memanggil aksi server dan route handler di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { deflateSync } from "node:zlib";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { db } from "../src/lib/db";
import { D } from "../src/lib/uang";
import type { Hak, PenggunaSesi } from "../src/lib/hakAkses";
import { penggunaSaatIni } from "../src/lib/otentikasi";
import { periksaSinkron } from "../src/lib/sinkron";
import { JENIS_LAMPIRAN } from "../src/lib/berkas";
import { pembacaMinimumLampiran, simpanPdfDokumenPenjualan } from "../src/lib/pdf/dokumenPenjualan";
import { dataCetakPenjualan, dataCetakUntukPengguna, infoPanelCetak, JENIS_CETAK_PENJUALAN } from "../src/lib/dataCetakPenjualan";
import { buatPerekam, renderPdfDokumenPenjualan, type Perekam } from "../src/lib/cetak";
import { ubahRencanaTermin, terbitkanTagihanTermin } from "../src/lib/aksi/dokumenPenjualan";
import { buatKopSurat } from "../src/lib/aksi/kopSurat";
import { POST as unggahPost } from "../src/app/api/cetak/kop/[kopId]/aset/route";
import { simpanPdfDokumen, simpanPdfDokumenFormulir } from "../src/lib/aksi/pdfPenjualan";
import { buatFaktur, buatPenawaran, buatPenerimaan, buatUangMuka, konversiPenawaranKePesanan } from "../src/lib/aksi/penjualan";
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
 *  5. Perbaikan tinjauan P45: T1 PDF lampiran tanpa tanda tangan walau formulir meminta (kop bergambar tanda tangan
 *     sebagai pembanding), T3 kwitansi, kwitansi DP, dan tagihan termin disaring hak minimum pembaca lampiran, R3 nilai
 *     panel dari kueri ringan sama dengan data cetak lengkap untuk kelima jenis.
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
const teksRekam = (r: Perekam) => r.teks.map((t) => t.teks).join("\n");
const SLOT_TTD = ["TANDA_TANGAN", "STEMPEL"];
const gambarTtd = (r: Perekam) => r.gambar.filter((x) => SLOT_TTD.includes(x.slot ?? "")).length;

/** PNG RGBA 8-bit buatan sendiri (pola uji-rute-cetak). */
function png(lebar: number, tinggi: number): Uint8Array {
  const tabel = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = tabel[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const potong = (jenis: string, isi: Buffer) => {
    const k = Buffer.alloc(8);
    k.writeUInt32BE(isi.length, 0);
    k.write(jenis, 4, "ascii");
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([k.subarray(4), isi])), 0);
    return Buffer.concat([k, isi, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lebar, 0);
  ihdr.writeUInt32BE(tinggi, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const piksel = Buffer.alloc(tinggi * (1 + lebar * 4), 0x80);
  for (let r = 0; r < tinggi; r++) piksel[r * (1 + lebar * 4)] = 0;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), potong("IHDR", ihdr), potong("IDAT", deflateSync(piksel)), potong("IEND", Buffer.alloc(0))]));
}

/** POST unggah aset kop (badan multipart diserialisasi dulu supaya Content-Length terisi). */
async function unggahAsetKop(kopId: string, jenis: string, isi: Uint8Array) {
  const fd = new FormData();
  fd.set("jenis", jenis);
  fd.set("gambar", new File([Buffer.from(isi)], "gambar.png", { type: "image/png" }));
  const r = new Response(fd);
  const badan = new Uint8Array(await r.arrayBuffer());
  const req = new Request(`http://localhost/api/cetak/kop/${kopId}/aset`, {
    method: "POST",
    body: badan,
    headers: { "content-type": r.headers.get("content-type") ?? "", "content-length": String(badan.byteLength), origin: "http://localhost", host: "localhost" },
  });
  const jawab = await unggahPost(req, { params: Promise.resolve({ kopId }) });
  return { status: jawab.status, isi: (await jawab.json()) as { ok: boolean; galat?: string } };
}

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
  const um = await db.uangMukaPelanggan.findMany({ where: pelanggan, ...terbaru });
  const termin = await db.rencanaTermin.findMany({ where: { OR: [{ pesanan: pelanggan }, { penawaran: pelanggan }] }, select: { id: true } });
  const kop = (await db.kopSurat.findMany({ where: { nama: { startsWith: `${K} ` } }, select: { id: true } })).map((k) => k.id);
  await db.berkas.deleteMany({ where: { OR: [{ entitasId: { in: [...fj, ...trm, ...pnw, ...um, ...termin].map((d) => d.id) } }, { jenisEntitas: "kop-surat", entitasId: { in: kop } }] } });
  await db.kopSurat.deleteMany({ where: { id: { in: kop } } });
  const nomor: string[] = [];
  const hapus = async (jenis: Parameters<typeof hapusDokumen>[0], d: { id: string; nomor: string }) => {
    nomor.push(d.nomor);
    await jalankan(`hapus ${d.nomor}`, () => hapusDokumen(jenis, d.id)).catch((e: unknown) => console.warn(`[bersih] ${d.nomor} gagal dihapus: ${(e as Error).message}`));
  };
  for (const d of trm) await hapus("penerimaan", d);
  for (const d of um) await hapus("uangMuka", d);
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

    console.log("=== 5. Perbaikan tinjauan P45 ===");
    // T1: kop bergambar tanda tangan; unduhan bertanda tangan memuat gambarnya, lampiran tidak walau formulir meminta ttd
    await jalankan("kop uji bertanda tangan", () => buatKopSurat(formulir({ perusahaanId: fj.perusahaanId, nama: `${K} Kop TTD`, preset: "DPRO" })));
    const kopTtd = await db.kopSurat.findFirstOrThrow({ where: { nama: `${K} Kop TTD`, perusahaanId: fj.perusahaanId, dihapusPada: null } });
    const unggahTtd = await unggahAsetKop(kopTtd.id, "TANDA_TANGAN", png(32, 18));
    pastikan(unggahTtd.status === 200 && unggahTtd.isi.ok, `gambar tanda tangan kop uji terunggah (${unggahTtd.status} ${unggahTtd.isi.galat ?? ""})`);
    const mFj = (await dataCetakPenjualan("faktur", fj.id))!;
    const rekamUnduh = buatPerekam();
    const unduhTtd = await renderPdfDokumenPenjualan(dataCetakUntukPengguna(mFj, pemilik), pemilik, { kopId: kopTtd.id, ttd: true }, { perekam: rekamUnduh });
    pastikan(unduhTtd.tandaTangan && gambarTtd(rekamUnduh) > 0, "pembanding: unduhan PEMILIK dengan ttd memuat gambar tanda tangan kop uji");
    const rekamLampiran = buatPerekam();
    const bTtd = await simpanPdfDokumenPenjualan(db, pemilik, "faktur", fj.id, formulir({ kop: kopTtd.id, ttd: "1" }), { perekam: rekamLampiran });
    pastikan(rekamLampiran.teks.length > 0 && gambarTtd(rekamLampiran) === 0, `T1: lampiran yang disimpan dengan ttd=1 tanpa gambar tanda tangan dan stempel (${gambarTtd(rekamLampiran)} gambar)`);
    pastikan((await db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, aksi: "CETAK", entitasId: fj.id, meta: { path: ["disimpanKeBerkas"], equals: true } } })) === 0 && bTtd.jenisEntitas === "faktur", "T1: simpan tidak mencatat cetak bertanda tangan");

    // T3: dokumen bertermin dengan uang muka DP dan tagihan Pelunasan yang sudah diterbitkan
    await jalankan("PNW termin 4.000.000", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: jasa.id, jumlah: 4, harga: 1_000_000 }] })));
    const pnw2 = await db.penawaranPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id, id: { not: pnw.id } } });
    await jalankan("konversi PSJ termin", () => konversiPenawaranKePesanan(pnw2.id));
    const psj2 = await db.pesananPenjualan.findFirstOrThrow({ where: { penawaranId: pnw2.id } });
    await jalankan("rencana termin DP 40% + Pelunasan", () => ubahRencanaTermin("pesanan", psj2.id, formulir({ rencanaTermin: [{ label: "DP", nilai: 40 }, { label: "Pelunasan" }] })));
    const [butirDp, butirLunas] = await db.rencanaTermin.findMany({ where: { pesananId: psj2.id }, orderBy: { no: "asc" } });
    await jalankan("UM DP", () => buatUangMuka(formulir({ pesananId: psj2.id, akunId: kas.id, jumlah: D(butirDp.jumlah).toFixed(2), rencanaTerminId: butirDp.id })));
    const um = await db.uangMukaPelanggan.findFirstOrThrow({ where: { pesananId: psj2.id } });
    await jalankan("terbitkan tagihan Pelunasan", () => terbitkanTagihanTermin(butirLunas.id, formulir({})));

    // Tata letak kwitansi (KWITANSI_ENTITAS) tidak mencetak rincian baris, jadi untuk kwitansi dan kwitansi DP isi PDF
    // lampiran dibandingkan dengan render data pembaca minimum; tagihan termin dibandingkan langsung dengan PDF lengkap.
    type JenisT3 = "kwitansi" | "kwitansi-dp" | "tagihan-termin";
    const rekamData = async (jenis: JenisT3, id: string, p: PenggunaSesi) => {
      const r = buatPerekam();
      await renderPdfDokumenPenjualan(dataCetakUntukPengguna((await dataCetakPenjualan(jenis, id))!, p), pemilik, { ttd: false }, { perekam: r });
      return teksRekam(r);
    };
    const rekamSimpan = async (jenis: JenisT3, id: string) => {
      const r = buatPerekam();
      const meta = await simpanPdfDokumenPenjualan(db, pemilik, jenis, id, formulir({}), { perekam: r });
      return { meta, teks: teksRekam(r) };
    };

    const mKw = (await dataCetakPenjualan("kwitansi", trm.id))!;
    const kwMin = dataCetakUntukPengguna(mKw, pembacaMinimumLampiran(pemilik, "kwitansi"));
    pastikan(dataCetakUntukPengguna(mKw, pemilik).baris.length > 0 && kwMin.baris.length === 0 && D(kwMin.ringkasan.subtotal).isZero(), "T3 kwitansi: pembaca minimum lampiran penerimaan (penerimaan.lihat) tanpa baris dan ringkasan faktur");
    const kwSimpan = await rekamSimpan("kwitansi", trm.id);
    pastikan(kwSimpan.meta.jenisEntitas === "penerimaan" && kwSimpan.teks.length > 0 && kwSimpan.teks === (await rekamData("kwitansi", trm.id, pembacaMinimumLampiran(pemilik, "kwitansi"))), "T3 kwitansi: PDF lampiran yang disimpan PEMILIK sama dengan PDF pembaca minimum");

    const mDp = (await dataCetakPenjualan("kwitansi-dp", um.id))!;
    const dpMin = dataCetakUntukPengguna(mDp, pembacaMinimumLampiran(pemilik, "kwitansi-dp"));
    pastikan(dataCetakUntukPengguna(mDp, pemilik).baris.length > 0 && dataCetakUntukPengguna(mDp, pemilik).termin.length === 2 && dpMin.baris.length === 0 && dpMin.termin.length === 0, "T3 kwitansi DP: pembaca minimum lampiran uang muka tanpa baris pesanan dan progres termin");
    const dpSimpan = await rekamSimpan("kwitansi-dp", um.id);
    pastikan(dpSimpan.meta.jenisEntitas === "uang-muka" && dpSimpan.meta.entitasId === um.id && dpSimpan.teks.length > 0 && dpSimpan.teks === (await rekamData("kwitansi-dp", um.id, pembacaMinimumLampiran(pemilik, "kwitansi-dp"))), "T3 kwitansi DP: PDF lampiran yang disimpan PEMILIK sama dengan PDF pembaca minimum");

    const mTt = (await dataCetakPenjualan("tagihan-termin", butirLunas.id))!;
    const ttPenuh = dataCetakUntukPengguna(mTt, pemilik);
    const ttMin = dataCetakUntukPengguna(mTt, pembacaMinimumLampiran(pemilik, "tagihan-termin"));
    pastikan(!!ttPenuh.konteksTermin?.dibayarSebelumnya && D(ttPenuh.konteksTermin.dibayarSebelumnya).gt(0) && ttMin.konteksTermin?.dibayarSebelumnya === null && D(ttMin.ringkasan.terbayar).isZero(), "T3 tagihan termin: pembaca minimum (pesanan.lihat) tanpa angka bayar dan Sudah dibayar");
    const ttTeksPenuh = await rekamData("tagihan-termin", butirLunas.id, pemilik);
    const ttSimpan = await rekamSimpan("tagihan-termin", butirLunas.id);
    pastikan(ttTeksPenuh.includes("Sudah dibayar (termin sebelumnya)") && !ttSimpan.teks.includes("Sudah dibayar") && ttSimpan.meta.jenisEntitas === "rencana-termin" && ttSimpan.meta.entitasId === butirLunas.id, "T3 tagihan termin: PDF lengkap PEMILIK memuat Sudah dibayar, PDF lampiran yang disimpan PEMILIK tidak");

    // R3: kueri ringan panel sama dengan nilai dari data cetak lengkap untuk kelima jenis
    const contohId: Record<(typeof JENIS_CETAK_PENJUALAN)[number], string> = { penawaran: pnw.id, faktur: fj.id, kwitansi: trm.id, "kwitansi-dp": um.id, "tagihan-termin": butirLunas.id };
    for (const jenis of JENIS_CETAK_PENJUALAN) {
      const lengkap = (await dataCetakPenjualan(jenis, contohId[jenis]))!;
      const ringan = await infoPanelCetak(jenis, contohId[jenis]);
      pastikan(
        JSON.stringify(ringan) === JSON.stringify({ perusahaanId: lengkap.perusahaanId, kopSuratId: lengkap.kopSuratId, draf: lengkap.draf, modeEvent: lengkap.event.mode === "EVENT", tampilan: lengkap.event.tampilan }),
        `R3 ${jenis}: nilai panel kueri ringan sama dengan data cetak lengkap`,
      );
    }
    pastikan((await infoPanelCetak("tagihan-termin", butirDp.id))?.draf === true && (await infoPanelCetak("faktur", "tidak-ada")) === null, "R3: termin yang belum ditagih bertanda draf, dokumen tidak ada null");
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
