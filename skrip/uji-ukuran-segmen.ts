import { inflateSync } from "node:zlib";
import { KERTAS, KanvasCetak, buatPerekam, type BarisTeksCetak, type OpsiTeks, type Segmen } from "../src/lib/cetak/mesin/kanvas";
import { gambarTabel } from "../src/lib/cetak/mesin/tabel";
import { pastikan } from "./bantuan";

/*
 * Uji ukuran huruf per segmen di KanvasCetak dan sel tabel (sisa P30). Tanpa basis data.
 *  1. Positif: segmen berukuran lebih kecil diukur dan digambar dengan ukurannya sendiri (lebar lebih sempit, operator
 *     Tf di PDF), sejajar pada garis dasar yang sama, tinggi baris tetap dari ukuran dasar, dan tercatat di perekam.
 *  2. Tidak berubah: teks tanpa ukuran segmen, atau berukuran sama dengan ukuran dasar, menghasilkan PDF, perekam, dan
 *     ukuran yang sama persis dengan sebelumnya (tanpa kunci `potongan` di perekam).
 *  3. Sel tabel: segmen kecil di sel Segmen[] dan sel berbutir, kata yang dipotong per huruf, ukuran tidak sah jatuh
 *     ke ukuran dasar, baris tabel tidak lebih tinggi karena segmen kecil.
 */

const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");
const dekat = (a: number, b: number, t = 0.01) => Math.abs(a - b) <= t;

/** Isi aliran halaman PDF (yang bisa di-inflate), tanpa tanggal pembuatan. */
function isiAliran(b: Uint8Array): string {
  const teks = latin1(b);
  const hasil: string[] = [];
  for (const m of teks.matchAll(/stream\r?\n/g)) {
    const awal = m.index! + m[0].length;
    const akhir = teks.indexOf("endstream", awal);
    try {
      hasil.push(inflateSync(Buffer.from(b.subarray(awal, akhir))).toString("latin1"));
    } catch {
      // gambar atau aliran tanpa kompresi
    }
  }
  return hasil.join("\n");
}
const tanpaTanggal = (b: Uint8Array) => latin1(b).replace(/\/(CreationDate|ModDate) \([^)]*\)/g, "").replace(/\/ID \[[^\]]*\]/g, "");

/** Pasangan (ukuran Tf, y garis dasar dari Tm) per potongan teks (operator TJ) di aliran konten, berurutan; potongan beruntun berukuran sama digabung. */
function operasiTeks(pdf: Uint8Array): { ukuran: number; y: number }[] {
  const hasil: { ukuran: number; y: number }[] = [];
  let ukuran = 0;
  let y = 0;
  for (const baris of isiAliran(pdf).split("\n")) {
    const tm = baris.match(/^1 0 0 1 [-\d.]+ ([-\d.]+) Tm/);
    if (tm) y = Number(tm[1]);
    const tf = baris.match(/^\/F\d+ ([\d.]+) Tf/);
    if (tf) ukuran = Number(tf[1]);
    if (baris.endsWith(" TJ") && !(hasil.length && hasil[hasil.length - 1].ukuran === ukuran)) hasil.push({ ukuran, y });
  }
  return hasil;
}

function kanvasUji() {
  const perekam = buatPerekam();
  const k = new KanvasCetak({ judul: "Uji ukuran segmen", subjek: "Uji", penulis: "skrip", perekam });
  k.aturArea({ atas: k.mm(15), bawah: k.mm(15), kiri: k.mm(15), kanan: k.mm(15) });
  k.halamanBaru(KERTAS.A4);
  return { k, perekam };
}

const OPSI: OpsiTeks = { x: 40, y: 100, lebar: 300, ukuran: 10 };

async function main() {
  console.log("=== 1. Positif ===");
  const campur: Segmen[] = [{ teks: "Nama " }, { teks: "deskripsi kecil", ukuran: 6 }];
  const { k, perekam } = kanvasUji();
  const wDasar = k.ukur("Nama deskripsi kecil", OPSI);
  const wCampur = k.ukur(campur, OPSI);
  const wKecil = k.ukur("deskripsi kecil", { ...OPSI, ukuran: 6 });
  // "Nama " dengan spasi: ukur membuang spasi penutup baris, jadi hitung dari "Nama d" dikurangi "d"
  const wNama = { lebar: k.ukur("Nama d", OPSI).lebar - k.ukur("d", OPSI).lebar };
  pastikan(wCampur.lebar < wDasar.lebar && dekat(wCampur.lebar, wNama.lebar + wKecil.lebar, 0.05), `lebar campuran = lebar "Nama " 10 pt + lebar deskripsi 6 pt (${wCampur.lebar.toFixed(2)} < ${wDasar.lebar.toFixed(2)})`);
  pastikan(wCampur.tinggi === wDasar.tinggi && wCampur.jumlahBaris === 1, "tinggi baris tetap dari ukuran dasar");
  k.teks(campur, OPSI);
  const rek = perekam.teks[0];
  pastikan(rek.ukuran === 10 && rek.potongan?.length === 2 && rek.potongan[0].ukuran === 10 && rek.potongan[0].teks === "Nama " && rek.potongan[1].ukuran === 6 && rek.potongan[1].teks === "deskripsi kecil" && rek.teks === "Nama deskripsi kecil", "perekam mencatat potongan berukuran 10 dan 6");
  const pdf = await k.selesai();
  const op = operasiTeks(pdf);
  pastikan(op.length === 2 && op[0].ukuran === 10 && op[1].ukuran === 6, `PDF memuat Tf 10 lalu 6 (${JSON.stringify(op)})`);
  pastikan(dekat(op[0].y, op[1].y, 0.01), `garis dasar potongan besar dan kecil sama (${op[0].y} dan ${op[1].y})`);

  console.log("=== 2. Teks tanpa fitur ini tidak berubah ===");
  const a = kanvasUji();
  a.k.teks("Nama deskripsi biasa yang cukup panjang untuk dua baris di lebar sempit", { ...OPSI, lebar: 120 });
  const b = kanvasUji();
  b.k.teks([{ teks: "Nama deskripsi biasa yang cukup panjang untuk dua baris di lebar sempit" }], { ...OPSI, lebar: 120 });
  const c = kanvasUji();
  c.k.teks([{ teks: "Nama deskripsi biasa yang cukup panjang untuk dua baris di lebar sempit", ukuran: 10 }], { ...OPSI, lebar: 120 });
  const [pa, pb, pc] = [await a.k.selesai(), await b.k.selesai(), await c.k.selesai()];
  pastikan(tanpaTanggal(pa) === tanpaTanggal(pb) && tanpaTanggal(pb) === tanpaTanggal(pc), "string, Segmen[] tanpa ukuran, dan Segmen[] berukuran sama dengan ukuran dasar menghasilkan PDF identik");
  pastikan(a.perekam.teks.length >= 2 && a.perekam.teks.every((t) => !("potongan" in t)) && c.perekam.teks.every((t) => !("potongan" in t)), "perekam tanpa kunci potongan bila ukuran seragam");
  const d = kanvasUji();
  const ukurBawaan = d.k.ukur("Teks tebal", { ...OPSI, font: "B" });
  const ukurSegmen = d.k.ukur([{ teks: "Teks tebal", tebal: true }], OPSI);
  pastikan(dekat(ukurBawaan.lebar, ukurSegmen.lebar), "segmen tebal tanpa ukuran memakai ukuran dasar");

  console.log("=== 3. Sel tabel ===");
  const berbutir = (ukuranDeskripsi?: number): BarisTeksCetak[] => [
    { jenis: "paragraf", isi: [{ teks: "Nama barang", tebal: false }] },
    { jenis: "butir", isi: [{ teks: "rincian pertama deskripsi", tebal: false, ukuran: ukuranDeskripsi }] },
  ];
  const tabel = async (isi: (SelIsi)) => {
    const t = kanvasUji();
    gambarTabel(t.k, { x: 40, kolom: [60, 140], baris: [{ sel: [{ isi: "1", ukuran: 10 }, { isi, ukuran: 10 }] }] });
    const yAkhir = t.k.y;
    return { yAkhir, perekam: t.perekam, pdf: await t.k.selesai() };
  };
  type SelIsi = Parameters<typeof gambarTabel>[1]["baris"][number]["sel"][number]["isi"];
  const dasar = await tabel(berbutir());
  const kecil = await tabel(berbutir(6));
  const tebal = kecil.perekam.teks.find((t) => t.teks.includes("rincian"));
  pastikan(!!tebal && tebal.ukuran === 10 && tebal.potongan?.[0].ukuran === 6, "sel berbutir: deskripsi tercatat berukuran 6");
  pastikan(dasar.yAkhir === kecil.yAkhir && dasar.perekam.teks.every((t) => !("potongan" in t)), "tinggi baris tabel sama dengan versi seukuran; versi tanpa ukuran tanpa potongan");
  const op2 = operasiTeks(kecil.pdf).map((o) => o.ukuran);
  pastikan(op2.includes(6) && op2.includes(10), `PDF sel berbutir memuat Tf 6 dan 10 (${op2.join(",")})`);

  const panjang = await tabel([{ teks: "Kata ", ukuran: 10 }, { teks: "supercalifragilisticexpialidocious_tanpa_spasi_sangat_panjang", ukuran: 6 }]);
  const kataLebar = panjang.perekam.teks.filter((t) => t.potongan?.some((p) => p.ukuran === 6));
  pastikan(kataLebar.length >= 2 && panjang.perekam.teks.every((t) => t.x + t.lebar <= 40 + 60 + 140 + 0.01), "kata panjang berukuran kecil dipotong per huruf dan tidak melewati sel");

  const tidakSah = kanvasUji();
  const ukDasar = tidakSah.k.ukur("abc def", OPSI);
  const ukSalah = tidakSah.k.ukur([{ teks: "abc def", ukuran: Number.NaN }], OPSI);
  const ukNol = tidakSah.k.ukur([{ teks: "abc def", ukuran: 0 }], OPSI);
  const ukNegatif = tidakSah.k.ukur([{ teks: "abc def", ukuran: -4 }], OPSI);
  pastikan(dekat(ukDasar.lebar, ukSalah.lebar) && dekat(ukDasar.lebar, ukNol.lebar) && dekat(ukDasar.lebar, ukNegatif.lebar), "ukuran NaN, 0, dan negatif jatuh ke ukuran dasar");
  console.log("=== DONE, all ukuran-segmen checks passed ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
