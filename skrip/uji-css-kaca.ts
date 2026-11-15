import "dotenv/config";
import { readFileSync } from "node:fs";
import { transform } from "lightningcss";
import { pastikan } from "./bantuan";

/*
 * Laci menu di HP tampak tembus pandang di Chrome karena build produksi menyisakan hanya -webkit-backdrop-filter pada
 * .kaca: lightningcss membuang backdrop-filter tanpa awalan bila -webkit-backdrop-filter ditulis sesudahnya, dan Chrome
 * tidak menjalankan versi berawalan. Skrip ini memotong tiap blok aturan di globals.css yang memakai backdrop-filter,
 * menjalankannya lewat lightningcss (minify, target bawaan Next) seperti build, lalu memastikan versi tanpa awalan
 * tetap ada. Tanpa target pun hasilnya harus berisi versi tanpa awalan.
 */

const css = readFileSync("src/app/globals.css", "utf8");
const TARGET_NEXT = { chrome: 111 << 16, edge: 111 << 16, firefox: 111 << 16, safari: (16 << 16) | (4 << 8) };

/** Blok aturan sederhana (selector { ... }) yang isinya menyebut backdrop-filter. */
const blok = [...css.matchAll(/([^{}]+)\{([^{}]*backdrop-filter[^{}]*)\}/g)].map((m) => ({ selector: m[1].trim().split("\n").pop()!.trim(), isi: m[2] }));
pastikan(blok.length >= 1, `globals.css memuat aturan ber-backdrop-filter (${blok.map((b) => b.selector).join(", ")})`);
pastikan(blok.some((b) => b.selector === ".kaca"), "aturan .kaca ada");

const tanpaAwalan = /(^|[;{])backdrop-filter:/;
for (const b of blok) {
  for (const [nama, target] of [["target bawaan Next", TARGET_NEXT], ["tanpa target", undefined]] as const) {
    const keluar = transform({ filename: "globals.css", code: Buffer.from(`${b.selector}{${b.isi}}`), minify: true, targets: target }).code.toString();
    pastikan(tanpaAwalan.test(keluar), `${b.selector} (${nama}): backdrop-filter tanpa awalan bertahan setelah dikecilkan`);
  }
}

// kontrol negatif: pola penyebab bug (versi berawalan sesudah versi tanpa awalan) memang terbuang, jadi uji ini bisa gagal
const pola = transform({ filename: "x.css", code: Buffer.from(".x{backdrop-filter:blur(1px);-webkit-backdrop-filter:blur(1px)}"), minify: true, targets: TARGET_NEXT }).code.toString();
pastikan(!tanpaAwalan.test(pola), "kontrol: penulisan berawalan di belakang memang menghilangkan versi tanpa awalan (penyebab bug)");
console.log("=== DONE, all css kaca checks passed ===");
