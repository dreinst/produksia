/**
 * Mencetak Bagan Akun Standar sebagai tabel Markdown (dipakai untuk BAGAN-AKUN.md).
 * Pakai: npx tsx skrip/cetak-bagan-akun.ts
 */
import { BAGAN_AKUN_STANDAR, KEPUTUSAN_KURASI, PEMETAAN_STANDAR, kedalamanAkun } from "../src/lib/baganAkunStandar";

const LABEL_JENIS: Record<string, string> = { ASET: "Aset", KEWAJIBAN: "Kewajiban", MODAL: "Ekuitas", PENDAPATAN: "Pendapatan", BEBAN: "Beban" };
const LABEL_ASAL: Record<string, string> = { ASLI: "asli", USUL: "**usul**", KEPUTUSAN: "**keputusan**" };
const peta = new Map(BAGAN_AKUN_STANDAR.map((a) => [a.kode, a]));
const pemetaan = new Set<string>(Object.values(PEMETAAN_STANDAR));

const baris: string[] = ["| Kode | Nama akun | Jenis | Tanda | Asal | Keterangan |", "|---|---|---|---|---|---|"];
for (const a of BAGAN_AKUN_STANDAR) {
  const indent = "&nbsp;&nbsp;&nbsp;".repeat(kedalamanAkun(a.kode, peta));
  const nama = a.kelompok ? `${indent}**${a.nama}**` : `${indent}${a.nama}`;
  const tanda = [a.kelompok ? "kelompok" : "", a.kasBank ? "kas/bank" : "", pemetaan.has(a.kode) ? "pemetaan" : ""].filter(Boolean).join(", ");
  baris.push(`| \`${a.kode}\` | ${nama} | ${LABEL_JENIS[a.jenis]} | ${tanda} | ${LABEL_ASAL[a.asal]} | ${a.keterangan ?? ""} |`);
}

const jumlah = {
  total: BAGAN_AKUN_STANDAR.length,
  kelompok: BAGAN_AKUN_STANDAR.filter((a) => a.kelompok).length,
  asli: BAGAN_AKUN_STANDAR.filter((a) => a.asal === "ASLI").length,
  usul: BAGAN_AKUN_STANDAR.filter((a) => a.asal === "USUL").length,
  keputusan: BAGAN_AKUN_STANDAR.filter((a) => a.asal === "KEPUTUSAN").length,
};
console.log(`<!-- jumlah: ${JSON.stringify(jumlah)} -->`);
console.log("");
console.log("## Keputusan atas butir pending\n");
console.log("| Butir | Keputusan |\n|---|---|");
for (const k of KEPUTUSAN_KURASI) console.log(`| ${k.butir} | ${k.keputusan} |`);
console.log("\n## Daftar akun\n");
console.log(baris.join("\n"));
