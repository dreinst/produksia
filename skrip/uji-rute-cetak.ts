import "dotenv/config";
// Skrip ini memanggil aksi server dan route handler di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { deflateSync } from "node:zlib";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "../src/lib/db";
import { penggunaSaatIni } from "../src/lib/otentikasi";
import type { Hak, PenggunaSesi } from "../src/lib/hakAkses";
import { periksaSinkron } from "../src/lib/sinkron";
import { PESAN_GAMBAR_TIDAK_SAH } from "../src/lib/cetak/aset";
import { PESAN_ASET_FORMAT, PESAN_ASET_TERLALU_BESAR, PESAN_KOP_BUKAN_MILIK } from "../src/lib/cetak/kop";
import { dataCetakPenjualan, dataCetakUntukPengguna } from "../src/lib/dataCetakPenjualan";
import type { JenisCetakPenjualan } from "../src/lib/cetak/tipe";
import { buatFaktur, buatPenawaran, buatPenerimaan, buatPesanan, buatUangMuka } from "../src/lib/aksi/penjualan";
import { terbitkanTagihanTermin } from "../src/lib/aksi/dokumenPenjualan";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { buatKopSurat, hapusAsetKop, hapusKopSurat, jadikanKopBawaan, simpanTemplateCetak, ubahKopSurat } from "../src/lib/aksi/kopSurat";
import { GET as cetakGet } from "../src/app/cetak/[jenis]/[id]/route";
import { GET as contohGet } from "../src/app/cetak/contoh/[kopId]/route";
import { GET as asetBawaanGet } from "../src/app/cetak/aset-bawaan/[gaya]/[slot]/route";
import { POST as unggahPost } from "../src/app/api/cetak/kop/[kopId]/aset/route";
import PanelCetak from "../src/komponen/cetak/PanelCetak";
import { aturPersetujuan, formulir, harusDitolak, jalankan, pastikan } from "./bantuan";

/*
 * Uji rute cetak, unggah aset kop, dan aksi Kop & Template (P31, D3 §9.1 bagian rute dan aksi):
 *  1. Aksi kop: validasi buat (nama, preset, perusahaan), buat dari preset DPRO dengan lima template, nama unik tanpa
 *     beda huruf besar per perusahaan, kop bawaan pertama, jadikan bawaan, hapus lunak dengan promosi bawaan, ubah
 *     daftar putih (warna HEX, email, tata letak umum, perusahaanId diabaikan, log UBAH), template per jenis, hak.
 *  2. Unggah aset (POST /api/cetak/kop/[kopId]/aset): PNG sah lolos dan menggantikan unggahan lama, PNG rusak, GIF, dan
 *     gambar lebih dari 2 MB ditolak tanpa mematikan proses, Content-Length lebih dari 3 MB 413, asal beda 403, hak,
 *     jenis tidak dikenal, kop tidak ada; hapus unggahan.
 *  3. GET /cetak/[jenis]/[id]: lima jenis dokumen nyata 200 PDF inline, unduh attachment, jenis tidak dikenal dan id
 *     acak 404, GUDANG 403, ukuran tidak sah 400, ?ukuran=A5, ?kop milik perusahaan lain 400, log CETAK hanya untuk
 *     unduhan dan cetakan bertanda tangan (ADMIN ttd=1 bertanda tangan, KASIR tidak), kop dokumen yang dihapus jatuh
 *     ke kop bawaan.
 *  4. Pratinjau contoh (semua preset × lima jenis PDF sah, ADMIN 403, jenis tidak dikenal 400) dan aset bawaan.
 *  5. Data kuitansi tanpa faktur.lihat atau pesanan.lihat dikosongkan (KONTRAK-TAMBAHAN P31).
 *  6. PanelCetak: alasan tanpa tanda tangan (draf, peran, kop tanpa gambar), ukuran sah per kop.
 * Data uji berawalan RCT, dibersihkan di awal dan akhir; kop bawaan utama sebelum uji dikembalikan.
 */

const K = "RCT";
const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");
const pdfSah = (b: Uint8Array) => latin1(b.subarray(0, 5)) === "%PDF-" && latin1(b.subarray(b.length - 8)).includes("%%EOF");
const ASAL = "http://localhost";
/** Halaman A5 tegak (148 × 210 mm = 419,53 × 595,28 pt). */
const kertasA5 = (b: Uint8Array) => /\/MediaBox \[0 0 419\.5\d* 595\.2\d*\]/.test(latin1(b));

/** PNG RGBA 8-bit buatan sendiri; `rusak` = IDAT bukan zlib. */
function png(lebar: number, tinggi: number, opsi: { rusak?: boolean; isiTambahan?: number } = {}): Uint8Array {
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
  const idat = opsi.rusak ? Buffer.from("bukan-zlib") : deflateSync(piksel);
  const bagian = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), potong("IHDR", ihdr)];
  if (opsi.isiTambahan) bagian.push(potong("tEXt", Buffer.alloc(opsi.isiTambahan, 0x41)));
  bagian.push(potong("IDAT", idat), potong("IEND", Buffer.alloc(0)));
  return new Uint8Array(Buffer.concat(bagian));
}

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

type Jawab = { status: number; tipe: string; disposisi: string; isi: Uint8Array; teks: string };
async function baca(r: Response): Promise<Jawab> {
  const isi = new Uint8Array(await r.arrayBuffer());
  return { status: r.status, tipe: r.headers.get("content-type") ?? "", disposisi: r.headers.get("content-disposition") ?? "", isi, teks: isi.length < 2000 ? Buffer.from(isi).toString("utf8") : "" };
}
const cetak = async (jenis: string, id: string, query = "") =>
  baca(await cetakGet(new Request(`${ASAL}/cetak/${jenis}/${id}${query}`), { params: Promise.resolve({ jenis, id }) }));
const contoh = async (kopId: string, query: string) => baca(await contohGet(new Request(`${ASAL}/cetak/contoh/${kopId}${query}`), { params: Promise.resolve({ kopId }) }));
const asetBawaan = async (gaya: string, slot: string) => baca(await asetBawaanGet(new Request(`${ASAL}/cetak/aset-bawaan/x/y`), { params: Promise.resolve({ gaya, slot }) }));

/** POST unggah aset: badan multipart diserialisasi dulu supaya Content-Length terisi seperti dari peramban. */
async function unggah(kopId: string, jenis: string, isi: Uint8Array | null, opsi: { asal?: string; panjang?: string; nama?: string; tipe?: string } = {}) {
  const fd = new FormData();
  fd.set("jenis", jenis);
  if (isi) fd.set("gambar", new File([Buffer.from(isi)], opsi.nama ?? "gambar.png", { type: opsi.tipe ?? "image/png" }));
  const r = new Response(fd);
  const badan = new Uint8Array(await r.arrayBuffer());
  const req = new Request(`${ASAL}/api/cetak/kop/${kopId}/aset`, {
    method: "POST",
    body: badan,
    headers: { "content-type": r.headers.get("content-type") ?? "", "content-length": opsi.panjang ?? String(badan.byteLength), origin: opsi.asal ?? ASAL, host: "localhost" },
  });
  const jawab = await unggahPost(req, { params: Promise.resolve({ kopId }) });
  return { status: jawab.status, isi: (await jawab.json()) as { ok: boolean; galat?: string } };
}

const idUji = { berkas: [] as string[] };

async function bersihkan() {
  const pel = (await db.pelanggan.findMany({ where: { kode: { startsWith: `PLG-${K}` } }, select: { id: true } })).map((p) => p.id);
  const jurnalIds: string[] = [];
  const kumpul = (xs: { jurnalId: string | null }[]) => jurnalIds.push(...xs.flatMap((x) => (x.jurnalId ? [x.jurnalId] : [])));
  if (pel.length) {
    const faktur = await db.fakturPenjualan.findMany({ where: { pelangganId: { in: pel } }, select: { id: true, jurnalId: true } });
    const pesanan = await db.pesananPenjualan.findMany({ where: { pelangganId: { in: pel } }, select: { id: true } });
    const um = await db.uangMukaPelanggan.findMany({ where: { pesananId: { in: pesanan.map((p) => p.id) } }, select: { id: true, jurnalId: true } });
    const trm = await db.penerimaanPenjualan.findMany({ where: { fakturId: { in: faktur.map((f) => f.id) } }, select: { id: true, jurnalId: true } });
    for (const xs of [faktur, um, trm]) kumpul(xs);
    await db.penerimaanPenjualan.deleteMany({ where: { id: { in: trm.map((t) => t.id) } } });
    await db.pemakaianUangMuka.deleteMany({ where: { fakturId: { in: faktur.map((f) => f.id) } } });
    await db.barisFakturPenjualan.deleteMany({ where: { fakturId: { in: faktur.map((f) => f.id) } } });
    await db.fakturPenjualan.deleteMany({ where: { id: { in: faktur.map((f) => f.id) } } });
    await db.uangMukaPelanggan.deleteMany({ where: { id: { in: um.map((u) => u.id) } } });
    await db.rencanaTermin.deleteMany({ where: { OR: [{ pesananId: { in: pesanan.map((p) => p.id) } }, { penawaran: { pelangganId: { in: pel } } }] } });
    await db.barisPesananPenjualan.deleteMany({ where: { pesananId: { in: pesanan.map((p) => p.id) } } });
    await db.pesananPenjualan.deleteMany({ where: { id: { in: pesanan.map((p) => p.id) } } });
    await db.barisPenawaranPenjualan.deleteMany({ where: { penawaran: { pelangganId: { in: pel } } } });
    await db.penawaranPenjualan.deleteMany({ where: { pelangganId: { in: pel } } });
  }
  await db.barisJurnal.deleteMany({ where: { jurnalId: { in: jurnalIds } } });
  await db.jurnal.deleteMany({ where: { id: { in: jurnalIds } } });
  const kop = (await db.kopSurat.findMany({ where: { nama: { startsWith: K } }, select: { id: true } })).map((k) => k.id);
  await db.berkas.deleteMany({ where: { OR: [{ id: { in: idUji.berkas } }, { jenisEntitas: "kop-surat", entitasId: { in: kop } }] } });
  await db.kopSurat.deleteMany({ where: { id: { in: kop } } });
  await db.barang.deleteMany({ where: { kode: { startsWith: `BRG-${K}` } } });
  await db.akun.deleteMany({ where: { kode: { startsWith: `UJI-${K}` } } });
  await db.pelanggan.deleteMany({ where: { kode: { startsWith: `PLG-${K}` } } });
}

/** Tambah nilai kedua untuk kunci yang sama (pola isian tersembunyi lalu kotak centang). */
const isianDua = (fd: FormData, kunci: string, nilai: string) => {
  fd.append(kunci, nilai);
  return fd;
};
const kopBernama = (nama: string, perusahaanId = "utama") => db.kopSurat.findFirstOrThrow({ where: { nama, perusahaanId, dihapusPada: null } });
const jumlahLog = (where: Record<string, unknown>, sejak: Date) => db.logAktivitas.count({ where: { ...where, waktu: { gte: sejak } } });

async function main() {
  await bersihkan();
  aturPersetujuan(false);
  const mulaiUji = new Date();
  const sinkronAwal = await periksaSinkron(db);
  const jurnalAwal = await db.jurnal.count();
  // kop bawaan utama sebelum uji (dikembalikan di akhir); kop lain utama di luar uji tidak disentuh
  const bawaanAwal = await db.kopSurat.findMany({ where: { perusahaanId: "utama", dihapusPada: null, bawaan: true }, select: { id: true } });
  const adaKopUtama = (await db.kopSurat.count({ where: { perusahaanId: "utama", dihapusPada: null } })) > 0;
  try {
    // ---------- 1. Aksi kop ----------
    console.log("=== 1. Aksi kop dan template ===");
    await harusDitolak("nama kop kosong", () => buatKopSurat(formulir({ perusahaanId: "utama", nama: " ", preset: "DPRO" })), "Nama kop wajib diisi");
    await harusDitolak("nama kop 81 karakter", () => buatKopSurat(formulir({ perusahaanId: "utama", nama: "x".repeat(81) })), "Nama kop maksimal 80 karakter");
    await harusDitolak("preset XYZ", () => buatKopSurat(formulir({ perusahaanId: "utama", nama: `${K} X`, preset: "XYZ" })), "Preset tidak dikenal");
    await harusDitolak("preset toString (bukan kunci sendiri)", () => buatKopSurat(formulir({ perusahaanId: "utama", nama: `${K} X`, preset: "toString" })), "Preset tidak dikenal");
    await harusDitolak("perusahaan tidak dikenal", () => buatKopSurat(formulir({ perusahaanId: "tidak-ada", nama: `${K} X` })), "Perusahaan tidak ditemukan");
    for (const peran of ["ADMIN", "KASIR"]) {
      await sebagaiPeran(peran, () => harusDitolak(`${peran} membuat kop`, () => buatKopSurat(formulir({ perusahaanId: "utama", nama: `${K} X` })), "tidak punya hak"));
    }
    await jalankan("buat kop RCT DPRO dari preset DPRO", () => buatKopSurat(formulir({ perusahaanId: "utama", nama: `${K} DPRO`, preset: "DPRO" })));
    const dpro = await db.kopSurat.findFirstOrThrow({ where: { nama: `${K} DPRO` }, include: { template: true } });
    pastikan(
      dpro.perusahaanId === "utama" && dpro.gayaEntitas === "DPRO" && dpro.template.length === 5 && dpro.warnaUtama === "#0B2144" && dpro.namaBank === "BANK CENTRAL ASIA" && dpro.alamat === null && dpro.nomorRekening === null,
      "kop DPRO: lima template, gaya DPRO, warna navy, namaBank penimpa, identitas lain kosong",
    );
    pastikan(dpro.bawaan === !adaKopUtama, `kop pertama perusahaan menjadi bawaan (${dpro.bawaan}, sebelumnya ada kop: ${adaKopUtama})`);
    pastikan((await jumlahLog({ aksi: "BUAT", jenis: "Kop Surat", modul: "pengaturan", entitasId: dpro.id }, mulaiUji)) === 1, "log BUAT Kop Surat modul pengaturan");
    await harusDitolak("nama ganda beda huruf besar", () => buatKopSurat(formulir({ perusahaanId: "utama", nama: `${K.toLowerCase()} dpro` })), "Nama kop sudah dipakai di perusahaan ini");
    await jalankan("nama sama di perusahaan tapussa boleh", () => buatKopSurat(formulir({ perusahaanId: "tapussa", nama: `${K} DPRO`, preset: "TAPUSSA" })));
    const kopTapussa = await kopBernama(`${K} DPRO`, "tapussa");
    pastikan(kopTapussa.gayaEntitas === "TAPUSSA", "kop tapussa bergaya TAPUSSA");

    await jalankan("buat kop RCT Generik", () => buatKopSurat(formulir({ perusahaanId: "utama", nama: `${K} Generik` })));
    const generik = await kopBernama(`${K} Generik`);
    pastikan(generik.gayaEntitas === null && !generik.bawaan && (await db.templateCetak.count({ where: { kopSuratId: generik.id } })) === 0, "kop generik tanpa gaya, tanpa template, bukan bawaan");
    await jalankan("jadikan RCT Generik bawaan", () => jadikanKopBawaan(generik.id));
    const bawaanUtama = await db.kopSurat.findMany({ where: { perusahaanId: "utama", dihapusPada: null, bawaan: true }, select: { id: true } });
    pastikan(bawaanUtama.length === 1 && bawaanUtama[0].id === generik.id, "tepat satu kop bawaan di utama sesudah jadikan bawaan");
    await jalankan("buat kop RCT Cadangan", () => buatKopSurat(formulir({ perusahaanId: "utama", nama: `${K} Cadangan` })));
    const cadangan = await kopBernama(`${K} Cadangan`);
    await db.kopSurat.update({ where: { id: cadangan.id }, data: { teksKaki: "disentuh terakhir" } });
    await jalankan("hapus kop bawaan RCT Generik", () => hapusKopSurat(generik.id));
    const generikTerhapus = await db.kopSurat.findUniqueOrThrow({ where: { id: generik.id } });
    const bawaanBaru = await db.kopSurat.findMany({ where: { perusahaanId: "utama", dihapusPada: null, bawaan: true }, select: { id: true } });
    pastikan(generikTerhapus.dihapusPada !== null && !generikTerhapus.bawaan, "hapus lunak: dihapusPada terisi, bawaan dilepas");
    pastikan(bawaanBaru.length === 1 && bawaanBaru[0].id === cadangan.id, "kop dengan diubahPada terbaru dipromosikan menjadi bawaan");
    await harusDitolak("hapus kop yang sudah dihapus", () => hapusKopSurat(generik.id), "Kop surat tidak ditemukan");
    await harusDitolak("ubah kop yang sudah dihapus", () => ubahKopSurat(generik.id, formulir({ nama: "x" })), "Kop surat tidak ditemukan");
    await jalankan("nama kop terhapus boleh dipakai lagi", () => buatKopSurat(formulir({ perusahaanId: "utama", nama: `${K} Generik` })));
    const generik2 = await kopBernama(`${K} Generik`);

    await harusDitolak("warna #12345", () => ubahKopSurat(dpro.id, formulir({ warnaAksen: "#12345" })), "harus kode HEX 6 digit");
    await harusDitolak("email x@", () => ubahKopSurat(dpro.id, formulir({ email: "x@" })), "Email kop tidak valid");
    await harusDitolak("tata letak umum bukan HKA", () => ubahKopSurat(dpro.id, formulir({ tataLetakUmum: "DPRO_INVOICE" })), "Tata letak umum hanya boleh salah satu tata letak HKA");
    await harusDitolak("gaya entitas tidak dikenal", () => ubahKopSurat(dpro.id, formulir({ gayaEntitas: "XYZ" })), "Gaya entitas tidak dikenal");
    await harusDitolak("teks kaki 151 karakter", () => ubahKopSurat(dpro.id, formulir({ teksKaki: "x".repeat(151) })), "Teks kaki maksimal 150 karakter");
    await harusDitolak("nama dipakai kop lain", () => ubahKopSurat(dpro.id, formulir({ nama: `${K} cadangan` })), "Nama kop sudah dipakai di perusahaan ini");
    const logUbahAwal = await jumlahLog({ aksi: "UBAH", jenis: "Kop Surat", modul: "pengaturan", entitasId: dpro.id }, mulaiUji);
    await jalankan("ubah kop DPRO: warna, alamat penimpa, salam kosong, perusahaanId diabaikan", () =>
      ubahKopSurat(dpro.id, formulir({ warnaAksen: "#ab12cd", alamat: "Jl. Uji Kop 1", teksSalam: "", perusahaanId: "tapussa", kotakTampil: "1", tampilWatermark: "on" })),
    );
    const dproUbah = await db.kopSurat.findUniqueOrThrow({ where: { id: dpro.id } });
    pastikan(
      dproUbah.warnaAksen === "#AB12CD" && dproUbah.alamat === "Jl. Uji Kop 1" && dproUbah.teksSalam === "Hormat kami," && dproUbah.perusahaanId === "utama" && dproUbah.tampilWatermark && !dproUbah.tampilLogo && dproUbah.namaBank === "BANK CENTRAL ASIA",
      "ubah tersimpan: warna huruf besar, alamat penimpa, salam bawaan, perusahaan tetap, kotak tampil, kolom tak dikirim tetap",
    );
    pastikan((await jumlahLog({ aksi: "UBAH", jenis: "Kop Surat", modul: "pengaturan", entitasId: dpro.id }, mulaiUji)) === logUbahAwal + 1, "log UBAH Kop Surat bertambah satu");
    await jalankan("ubah tanpa perubahan", () => ubahKopSurat(dpro.id, formulir({ alamat: "Jl. Uji Kop 1" })));
    pastikan((await jumlahLog({ aksi: "UBAH", jenis: "Kop Surat", modul: "pengaturan", entitasId: dpro.id }, mulaiUji)) === logUbahAwal + 1, "ubah tanpa perubahan tidak dicatat");
    await jalankan("kembalikan alamat penimpa DPRO", () => ubahKopSurat(dpro.id, formulir({ alamat: "", kotakTampil: "1", tampilLogo: "on" })));

    await harusDitolak("template kwitansi entitas di kop generik", () => simpanTemplateCetak(generik2.id, formulir({ tataLetak_KWITANSI: "KWITANSI_ENTITAS", ukuran_KWITANSI: "A5_LANDSCAPE" })), "Kwitansi entitas butuh gaya entitas di kop ini");
    await harusDitolak("proposal D'Pro untuk faktur", () => simpanTemplateCetak(dpro.id, formulir({ tataLetak_FAKTUR: "DPRO_PROPOSAL", ukuran_FAKTUR: "A4" })), "tidak bisa dipakai untuk");
    await harusDitolak("proposal D'Pro A5", () => simpanTemplateCetak(dpro.id, formulir({ tataLetak_PENAWARAN: "DPRO_PROPOSAL", ukuran_PENAWARAN: "A5" })), "tidak tersedia");
    await harusDitolak("judul 61 karakter", () => simpanTemplateCetak(dpro.id, formulir({ tataLetak_FAKTUR: "DPRO_INVOICE", judul_FAKTUR: "x".repeat(61) })), "Judul maksimal 60 karakter");
    await harusDitolak("tata letak tidak dikenal", () => simpanTemplateCetak(dpro.id, formulir({ tataLetak_FAKTUR: "XYZ" })), "Tata letak tidak dikenal");
    await jalankan("template DPRO: faktur A5 koma tanpa ttd, kwitansi DP dikosongkan", () =>
      simpanTemplateCetak(dpro.id, formulir({ tataLetak_FAKTUR: "DPRO_INVOICE", ukuran_FAKTUR: "A5", gayaAngka_FAKTUR: "KOMA", judul_FAKTUR: "TAGIHAN", ttd_FAKTUR: "0", tataLetak_KWITANSI_DP: "" })),
    );
    const tpl = new Map((await db.templateCetak.findMany({ where: { kopSuratId: dpro.id } })).map((t) => [t.jenis, t]));
    const f = tpl.get("FAKTUR");
    pastikan(tpl.size === 4 && !tpl.has("KWITANSI_DP") && f?.ukuran === "A5" && f.gayaAngka === "KOMA" && f.judul === "TAGIHAN" && !f.tandaTanganBawaan, "template faktur diubah, kwitansi DP dihapus, jenis lain tetap");
    pastikan((await jumlahLog({ aksi: "UBAH", jenis: "Template Cetak", modul: "pengaturan", entitasId: dpro.id }, mulaiUji)) === 1, "log UBAH Template Cetak");
    await jalankan("template DPRO dikembalikan (faktur A4 ber-ttd, kwitansi DP entitas)", () =>
      simpanTemplateCetak(dpro.id, isianDua(formulir({ tataLetak_FAKTUR: "DPRO_INVOICE", ukuran_FAKTUR: "A4", gayaAngka_FAKTUR: "", judul_FAKTUR: "", ttd_FAKTUR: "0", tataLetak_KWITANSI_DP: "KWITANSI_ENTITAS", ukuran_KWITANSI_DP: "A5_LANDSCAPE" }), "ttd_FAKTUR", "1")),
    );
    const f2 = await db.templateCetak.findUniqueOrThrow({ where: { kopSuratId_jenis: { kopSuratId: dpro.id, jenis: "FAKTUR" } } });
    pastikan(f2.ukuran === "A4" && f2.gayaAngka === null && f2.judul === null && f2.tandaTanganBawaan, "ttd memakai nilai terakhir (isian tersembunyi 0 lalu kotak 1)");

    // ---------- 2. Unggah aset ----------
    console.log("=== 2. Unggah aset kop ===");
    const ttd1 = await unggah(dpro.id, "TANDA_TANGAN", png(32, 18));
    pastikan(ttd1.status === 200 && ttd1.isi.ok, `PNG 32 × 18 slot TANDA_TANGAN lolos (${ttd1.status} ${ttd1.isi.galat ?? ""})`);
    const aset1 = await db.asetKopSurat.findUniqueOrThrow({ where: { kopSuratId_jenis: { kopSuratId: dpro.id, jenis: "TANDA_TANGAN" } }, include: { berkas: true } });
    idUji.berkas.push(aset1.berkasId);
    pastikan(
      aset1.lebarPx === 32 && aset1.tinggiPx === 18 && aset1.berkas.jenisEntitas === "kop-surat" && aset1.berkas.entitasId === dpro.id && aset1.berkas.folderKode === "KOP" && aset1.berkas.tipeMime === "image/png" && aset1.berkas.perusahaanId === "utama",
      "AsetKopSurat 32 × 18; berkas lampiran kop-surat, folder KOP, image/png, perusahaan utama",
    );
    const ttd2 = await unggah(dpro.id, "TANDA_TANGAN", png(40, 20));
    pastikan(ttd2.status === 200, "unggah ulang slot yang sama lolos");
    const aset2 = await db.asetKopSurat.findUniqueOrThrow({ where: { kopSuratId_jenis: { kopSuratId: dpro.id, jenis: "TANDA_TANGAN" } } });
    idUji.berkas.push(aset2.berkasId);
    const lama = await db.berkas.findUniqueOrThrow({ where: { id: aset1.berkasId } });
    pastikan(aset2.berkasId !== aset1.berkasId && aset2.lebarPx === 40 && lama.dihapusPada !== null, "unggahan lama dibuang ke Sampah, baris menunjuk berkas baru");
    const rusak = await unggah(dpro.id, "LOGO", png(32, 18, { rusak: true }));
    pastikan(rusak.status === 400 && rusak.isi.galat === PESAN_GAMBAR_TIDAK_SAH, `PNG rusak ditolak 400 (${rusak.isi.galat})`);
    const gif = await unggah(dpro.id, "LOGO", new Uint8Array(Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1")), { nama: "x.gif", tipe: "image/gif" });
    pastikan(gif.status === 400 && gif.isi.galat === PESAN_ASET_FORMAT, `GIF ditolak 400 (${gif.isi.galat})`);
    const besar = await unggah(dpro.id, "LOGO", png(32, 18, { isiTambahan: 2 * 1024 * 1024 }));
    pastikan(besar.status === 400 && besar.isi.galat === PESAN_ASET_TERLALU_BESAR, `gambar lebih dari 2 MB ditolak (${besar.status} ${besar.isi.galat})`);
    const panjang = await unggah(dpro.id, "LOGO", png(32, 18), { panjang: String(3 * 1024 * 1024 + 1) });
    pastikan(panjang.status === 413 && panjang.isi.galat === PESAN_ASET_TERLALU_BESAR, "Content-Length lebih dari 3 MB ditolak 413 sebelum badan dibaca");
    const asal = await unggah(dpro.id, "LOGO", png(32, 18), { asal: "http://jahat.contoh" });
    pastikan(asal.status === 403, "asal permintaan beda ditolak 403");
    const jenisSalah = await unggah(dpro.id, "XYZ", png(32, 18));
    pastikan(jenisSalah.status === 400 && jenisSalah.isi.galat === "Jenis gambar tidak dikenal", "jenis gambar tidak dikenal 400");
    const tanpaGambar = await unggah(dpro.id, "LOGO", null);
    pastikan(tanpaGambar.status === 400 && tanpaGambar.isi.galat === "Pilih satu gambar", "tanpa gambar 400");
    const kopHilang = await unggah("tidak-ada", "LOGO", png(32, 18));
    pastikan(kopHilang.status === 404, "kop tidak ada 404");
    const kopTerhapus = await unggah(generik.id, "LOGO", png(32, 18));
    pastikan(kopTerhapus.status === 404, "kop terhapus 404");
    for (const peran of ["ADMIN", "KASIR"]) {
      const r = await sebagaiPeran(peran, () => unggah(dpro.id, "LOGO", png(32, 18)));
      pastikan(r.status === 403, `${peran} tanpa pengaturan.tulis ditolak 403`);
    }
    const proses = await unggah(dpro.id, "LOGO", png(16, 16));
    pastikan(proses.status === 200, "proses tetap hidup: unggah sah sesudah gambar rusak lolos");
    const logo = await db.asetKopSurat.findUniqueOrThrow({ where: { kopSuratId_jenis: { kopSuratId: dpro.id, jenis: "LOGO" } } });
    idUji.berkas.push(logo.berkasId);
    pastikan((await db.asetKopSurat.count({ where: { kopSuratId: dpro.id } })) === 2 && (await jumlahLog({ aksi: "UBAH", jenis: "Kop Surat", keterangan: { contains: "diunggah" }, entitasId: dpro.id }, mulaiUji)) === 3, "hanya unggahan sah yang tercatat (dua slot, tiga log unggah)");
    await jalankan("hapus unggahan LOGO", () => hapusAsetKop(dpro.id, "LOGO"));
    pastikan((await db.asetKopSurat.count({ where: { kopSuratId: dpro.id, jenis: "LOGO" } })) === 0 && (await db.berkas.findUniqueOrThrow({ where: { id: logo.berkasId } })).dihapusPada !== null, "hapus unggahan: baris hilang, berkas dibuang");
    await harusDitolak("hapus unggahan yang tidak ada", () => hapusAsetKop(dpro.id, "LOGO"), "belum diunggah");
    await harusDitolak("hapus unggahan jenis tidak dikenal", () => hapusAsetKop(dpro.id, "XYZ"), "Jenis gambar tidak dikenal");

    // ---------- 3. Dokumen nyata ----------
    console.log("=== 3. GET /cetak/[jenis]/[id] ===");
    const jasa = await db.barang.create({ data: { kode: `BRG-${K}-JASA`, nama: "Jasa Uji Rute Cetak", jenis: "JASA", satuan: "paket", hargaBeli: 0, hargaJual: 1_000_000 } });
    const pelanggan = await db.pelanggan.create({ data: { kode: `PLG-${K}`, nama: "Klien Uji Rute Cetak" } });
    const kas = await db.akun.create({ data: { kode: `UJI-${K}-KAS`, nama: "Kas Uji Rute Cetak", jenis: "ASET", kasBank: true } });
    await jalankan("PNW", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, ppnPersen: 0, baris: [{ barangId: jasa.id, jumlah: 1, harga: 1_000_000 }] })));
    const pnw = await db.penawaranPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id } });
    await jalankan("PSJ dengan termin DP 50% + pelunasan", () =>
      buatPesanan(formulir({ pelangganId: pelanggan.id, ppnPersen: 0, baris: [{ barangId: jasa.id, jumlah: 1, harga: 1_000_000 }], rencanaTermin: [{ label: "DP", nilai: 50 }, { label: "Pelunasan" }] })),
    );
    const psj = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id }, include: { baris: true, rencanaTermin: { orderBy: { no: "asc" } } } });
    const [t1] = psj.rencanaTermin;
    await jalankan("terbitkan tagihan DP", () => terbitkanTagihanTermin(t1.id, formulir({})));
    await jalankan("UM DP", () => buatUangMuka(formulir({ pesananId: psj.id, akunId: kas.id, jumlah: 500_000, rencanaTerminId: t1.id })));
    const um = await db.uangMukaPelanggan.findFirstOrThrow({ where: { pesananId: psj.id } });
    await jalankan("FJ", () => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, uangMuka: 500_000, baris: [{ barisPesananId: psj.baris[0].id, jumlah: 1 }] })));
    const fj = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj.id } });
    await jalankan("TRM", () => buatPenerimaan(formulir({ fakturId: fj.id, akunId: kas.id, jumlah: 500_000 })));
    const trm = await db.penerimaanPenjualan.findFirstOrThrow({ where: { fakturId: fj.id } });
    const dok: [JenisCetakPenjualan, string][] = [
      ["penawaran", pnw.id],
      ["faktur", fj.id],
      ["kwitansi", trm.id],
      ["kwitansi-dp", um.id],
      ["tagihan-termin", t1.id],
    ];
    const logCetak = (id: string) => jumlahLog({ aksi: "CETAK", modul: "dokumen", entitasId: id }, mulaiUji);
    for (const [jenis, id] of dok) {
      const r = await cetak(jenis, id);
      pastikan(r.status === 200 && r.tipe === "application/pdf" && pdfSah(r.isi) && r.disposisi.startsWith("inline;") && r.disposisi.includes(".pdf"), `${jenis}: 200 PDF sah inline (${r.status} ${r.teks.slice(0, 120)})`);
      const u = await cetak(jenis, id, "?unduh=1");
      pastikan(u.status === 200 && u.disposisi.startsWith("attachment;"), `${jenis}: unduh attachment`);
      const g = await sebagaiPeran("GUDANG", () => cetak(jenis, id));
      pastikan(g.status === 403 && g.teks === "Anda tidak punya hak melihat dokumen ini", `${jenis}: GUDANG 403`);
      pastikan((await logCetak(id)) === 1, `${jenis}: hanya unduhan yang dicatat (satu log CETAK)`);
    }
    const logUnduh = await db.logAktivitas.findFirstOrThrow({ where: { aksi: "CETAK", entitasId: fj.id, waktu: { gte: mulaiUji } } });
    const metaUnduh = logUnduh.meta as { unduh?: boolean; tandaTangan?: boolean };
    pastikan(logUnduh.jenis === "Faktur Penjualan" && logUnduh.nomor === fj.nomor && metaUnduh.unduh === true && logUnduh.perusahaanId === "utama", `log unduh faktur: jenis ${logUnduh.jenis}, nomor internal, meta unduh`);
    pastikan((await cetak("xyz", fj.id)).status === 404, "jenis tidak dikenal 404");
    const acak = await cetak("faktur", "tidak-ada");
    pastikan(acak.status === 404 && acak.teks === "Dokumen tidak ditemukan", "id acak 404");
    const a3 = await cetak("faktur", fj.id, "?ukuran=A3");
    pastikan(a3.status === 400 && a3.teks === "Ukuran kertas tidak dikenal", "?ukuran=A3 400");
    const a5 = await cetak("faktur", fj.id, `?kop=${dpro.id}&ukuran=A5`);
    pastikan(a5.status === 200 && kertasA5(a5.isi), "?ukuran=A5 untuk kop DPRO menjadi kertas A5");
    const kopLain = await cetak("faktur", fj.id, `?kop=${kopTapussa.id}`);
    pastikan(kopLain.status === 400 && kopLain.teks === PESAN_KOP_BUKAN_MILIK, "?kop milik perusahaan lain 400");
    // pratinjau A5 di atas (PEMILIK, kop DPRO bergambar tanda tangan, template faktur ber-ttd) bertanda tangan, jadi dicatat
    const logSebelum = await logCetak(fj.id);
    pastikan(logSebelum === 2, `pratinjau bertanda tangan PEMILIK ikut dicatat (${logSebelum})`);
    const kasirTtd = await sebagaiPeran("KASIR", () => cetak("faktur", fj.id, `?kop=${dpro.id}&ttd=1`));
    pastikan(kasirTtd.status === 200 && pdfSah(kasirTtd.isi) && (await logCetak(fj.id)) === logSebelum, "KASIR ttd=1: 200 tanpa tanda tangan, tanpa log");
    const adminTtd = await sebagaiPeran("ADMIN", () => cetak("faktur", fj.id, `?kop=${dpro.id}&ttd=1`));
    const logTtd = await db.logAktivitas.findMany({ where: { aksi: "CETAK", entitasId: fj.id, waktu: { gte: mulaiUji } }, orderBy: { waktu: "desc" } });
    const metaTtd = logTtd[0].meta as { tandaTangan?: boolean; unduh?: boolean };
    pastikan(adminTtd.status === 200 && logTtd.length === logSebelum + 1 && metaTtd.tandaTangan === true && metaTtd.unduh === false && (logTtd[0].keterangan ?? "").includes("bertanda tangan"), "ADMIN ttd=1 dengan gambar tanda tangan: pratinjau bertanda tangan dicatat");
    const adminTanpa = await sebagaiPeran("ADMIN", () => cetak("faktur", fj.id, `?kop=${dpro.id}&ttd=0`));
    pastikan(adminTanpa.status === 200 && (await logCetak(fj.id)) === logSebelum + 1, "ADMIN ttd=0: tanpa log");
    // kop dokumen: penawaran memakai kop generik kedua; sesudah kop itu dihapus, kop bawaan dipakai
    await db.penawaranPenjualan.update({ where: { id: pnw.id }, data: { kopSuratId: generik2.id } });
    const pakaiKop = await dataCetakPenjualan("penawaran", pnw.id);
    pastikan(pakaiKop?.kopSuratId === generik2.id, "penawaran merujuk kop RCT Generik");
    await jalankan("hapus kop RCT Generik kedua", () => hapusKopSurat(generik2.id));
    const sesudahHapus = await cetak("penawaran", pnw.id);
    pastikan(sesudahHapus.status === 200 && pdfSah(sesudahHapus.isi), "kop dokumen terhapus: PDF tetap jadi dengan kop bawaan");

    // ---------- 4. Contoh dan aset bawaan ----------
    console.log("=== 4. Pratinjau contoh dan aset bawaan ===");
    const presetKop: string[] = [];
    for (const preset of ["TAPUSSA", "BONANOVA", "SAHARA", "SMARA", "NAWASENA", "GENERIK"]) {
      await jalankan(`buat kop preset ${preset}`, () => buatKopSurat(formulir({ perusahaanId: "utama", nama: `${K} P ${preset}`, preset })));
      presetKop.push((await kopBernama(`${K} P ${preset}`)).id);
    }
    let jumlahContoh = 0;
    for (const kopId of [dpro.id, ...presetKop]) {
      for (const jenis of ["PENAWARAN", "TAGIHAN_TERMIN", "FAKTUR", "KWITANSI", "KWITANSI_DP"]) {
        const r = await contoh(kopId, `?jenis=${jenis}`);
        if (r.status !== 200 || !pdfSah(r.isi)) pastikan(false, `contoh ${jenis} kop ${kopId}: ${r.status} ${r.teks.slice(0, 200)}`);
        jumlahContoh++;
      }
    }
    pastikan(jumlahContoh === 35, "contoh tujuh preset × lima jenis: semua PDF sah");
    const ringkas = await contoh(presetKop[5], "?jenis=FAKTUR&tampilan=ringkas");
    pastikan(ringkas.status === 200 && pdfSah(ringkas.isi), "contoh faktur event ringkas pada kop generik");
    const contohA5 = await contoh(dpro.id, "?jenis=FAKTUR&ukuran=A5");
    pastikan(contohA5.status === 200 && kertasA5(contohA5.isi) && contohA5.disposisi.startsWith("inline;"), "contoh faktur DPRO A5 inline");
    pastikan((await contoh(dpro.id, "?jenis=XYZ")).status === 400, "contoh jenis tidak dikenal 400");
    pastikan((await contoh(dpro.id, "")).status === 400, "contoh tanpa jenis 400");
    pastikan((await contoh(generik.id, "?jenis=FAKTUR")).status === 404, "contoh kop terhapus 404");
    pastikan((await sebagaiPeran("ADMIN", () => contoh(dpro.id, "?jenis=FAKTUR"))).status === 403, "contoh ADMIN 403");
    pastikan((await jumlahLog({ aksi: "CETAK" }, mulaiUji)) === 7, "contoh tidak dicatat (log CETAK hanya lima unduhan dan dua pratinjau bertanda tangan)");
    const bawaanKop = await asetBawaan("dpro", "KOP");
    pastikan(bawaanKop.status === 200 && bawaanKop.tipe === "image/png" && latin1(bawaanKop.isi.subarray(1, 4)) === "PNG", "aset bawaan dpro/KOP 200 image/png");
    pastikan((await asetBawaan("dpro", "../kop")).status === 404 && (await asetBawaan("..", "KOP")).status === 404 && (await asetBawaan("DPRO", "KOP")).status === 404, "gaya dan slot di luar daftar putih 404");
    pastikan((await asetBawaan("dpro", "TANDA_TANGAN")).status === 404, "tanda tangan tidak punya aset bawaan");
    pastikan((await sebagaiPeran("KASIR", () => asetBawaan("dpro", "KOP"))).status === 403, "aset bawaan KASIR 403");

    // ---------- 5. Data kuitansi tanpa hak lihat dokumen asal ----------
    console.log("=== 5. Data kuitansi tanpa faktur.lihat atau pesanan.lihat ===");
    const kasir = await sebagaiPeran("KASIR", () => penggunaSaatIni());
    const tanpa = (hak: Hak): PenggunaSesi => ({ ...kasir!, hak: kasir!.hak.filter((h) => h !== hak) });
    const kw = (await dataCetakPenjualan("kwitansi", trm.id))!;
    pastikan(kw.baris.length === 1 && kw.ringkasan.subtotal === "1000000.00", "data kwitansi mentah membawa baris dan ringkasan faktur");
    pastikan(dataCetakUntukPengguna(kw, kasir!) === kw, "dengan faktur.lihat data kwitansi utuh");
    const kwSaring = dataCetakUntukPengguna(kw, tanpa("faktur.lihat"));
    pastikan(
      kwSaring.baris.length === 0 && kwSaring.ringkasan.subtotal === "0.00" && kwSaring.ringkasan.sisa === "0.00" && kwSaring.uangMukaDipakai.length === 0 && kwSaring.kwitansi?.jumlah === kw.kwitansi?.jumlah && kwSaring.nomorTampil === kw.nomorTampil,
      "tanpa faktur.lihat baris dan ringkasan faktur dikosongkan, nilai kwitansi tetap",
    );
    const kwdp = (await dataCetakPenjualan("kwitansi-dp", um.id))!;
    pastikan(kwdp.baris.length === 1 && kwdp.termin.length === 2, "data kwitansi DP mentah membawa baris pesanan dan progres termin");
    const kwdpSaring = dataCetakUntukPengguna(kwdp, tanpa("pesanan.lihat"));
    pastikan(kwdpSaring.baris.length === 0 && kwdpSaring.termin.length === 0 && kwdpSaring.ringkasan.total === kwdp.kwitansi?.jumlah, "tanpa pesanan.lihat baris pesanan dan progres termin dikosongkan");
    pastikan(dataCetakUntukPengguna(kwdp, tanpa("faktur.lihat")) === kwdp, "kwitansi DP hanya bergantung pesanan.lihat");
    const fkt = (await dataCetakPenjualan("faktur", fj.id))!;
    pastikan(dataCetakUntukPengguna(fkt, tanpa("pesanan.lihat")) === fkt, "jenis selain kuitansi tidak disaring");

    // ---------- 6. PanelCetak ----------
    console.log("=== 6. PanelCetak ===");
    const panel = async (peran: string, draf: boolean) =>
      renderToStaticMarkup(
        await sebagaiPeran(peran, async () =>
          PanelCetak({ jenis: "faktur", id: fj.id, perusahaanId: "utama", kopSuratId: dpro.id, draf, modeEvent: false, tampilan: "RINCI", pengguna: (await penggunaSaatIni())! }),
        ),
      );
    const hAdmin = await panel("ADMIN", false);
    pastikan(hAdmin.includes(`action="/cetak/faktur/${fj.id}"`) && hAdmin.includes('target="_blank"') && hAdmin.includes('value="A5L"') && !hAdmin.includes("Peran Anda tidak punya hak") && !hAdmin.includes("disabled=\"\""), "ADMIN: formulir GET tab baru, tiga ukuran invoice D'Pro, tanda tangan bisa dicentang");
    pastikan((await panel("KASIR", false)).includes("Peran Anda tidak punya hak tanda tangan cetak"), "KASIR: alasan peran tanpa hak tanda tangan");
    pastikan((await panel("ADMIN", true)).includes("Dokumen masih draf, tanda tangan tidak dibubuhkan"), "draf: alasan draf");
    const hTanpaGambar = renderToStaticMarkup(
      await sebagaiPeran("ADMIN", async () => PanelCetak({ jenis: "faktur", id: fj.id, perusahaanId: "utama", kopSuratId: presetKop[5], draf: false, modeEvent: false, tampilan: "RINCI", pengguna: (await penggunaSaatIni())! })),
    );
    pastikan(hTanpaGambar.includes("Kop ini belum punya gambar tanda tangan") && hTanpaGambar.includes("Unduh PDF") && hTanpaGambar.includes("Pratinjau PDF"), "kop terpilih tanpa gambar tanda tangan: alasan kop");

    // ---------- bersih ----------
    await jalankan("hapus TRM", () => hapusDokumen("penerimaan", trm.id));
    await jalankan("hapus FJ", () => hapusDokumen("faktur", fj.id));
    await jalankan("hapus UM", () => hapusDokumen("uangMuka", um.id));
    await jalankan("hapus PSJ", () => hapusDokumen("pesanan", psj.id));
    await jalankan("hapus PNW", () => hapusDokumen("penawaran", pnw.id));
  } finally {
    aturPersetujuan(false);
    await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji }, penggunaNama: "Skrip Uji" } });
    await bersihkan();
    for (const k of bawaanAwal) await db.kopSurat.update({ where: { id: k.id }, data: { bawaan: true } });
  }
  pastikan((await db.kopSurat.count({ where: { nama: { startsWith: K } } })) === 0 && (await db.berkas.count({ where: { id: { in: idUji.berkas } } })) === 0, "kop dan berkas uji dibersihkan");
  pastikan((await db.jurnal.count()) === jurnalAwal, "jumlah jurnal sama dengan sebelum uji");
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron seimbang dan sama dengan sebelum uji");
  console.log("=== DONE, all rute-cetak checks passed ===");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
