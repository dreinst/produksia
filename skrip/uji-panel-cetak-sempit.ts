import "dotenv/config";
import { readFileSync } from "node:fs";
import { pastikan } from "./bantuan";

/*
 * Panel Cetak di layar sempit (P45 Sisa, e.5). Tombol Cetak di kepala halaman berada di sisi kiri di bawah lg; panel
 * yang menempel ke tepi kanan tombol (absolute right-0, lebar 36rem) terpotong di kiri layar 390 px sehingga pilihan
 * kop, ukuran, dan tombol Pratinjau, Unduh, dan Simpan tidak terjangkau. Perbaikannya: di bawah lg panel mengalir
 * biasa di bawah tombol (details terbuka selebar baris), mulai lg tetap melayang rata kanan. Skrip ini menjaga
 * kontrak kelasnya pada sumber; pengukuran 390 px lewat peramban disimpan sebagai tangkapan layar di laporan paket.
 */

const sumber = readFileSync("src/komponen/penjualan/TombolCetakDokumen.tsx", "utf8");
const kelasDari = (baris: string | undefined) => new Set((/className="([^"]*)"/.exec(baris ?? "")?.[1] ?? "").split(/\s+/));
const barisDetails = sumber.split("\n").find((b) => b.includes("<details"));
const barisPanel = sumber.split("\n").find((b) => b.includes("<div className=") && b.includes("shadow-lg"));
pastikan(!!barisDetails && !!barisPanel, "tag details dan wadah panel Cetak ditemukan");
const details = kelasDari(barisDetails);
const panel = kelasDari(barisPanel);

pastikan(!panel.has("absolute") && !panel.has("right-0"), "tanpa absolute right-0 di semua lebar (itu penyebab panel terpotong di kiri)");
pastikan(!panel.has("fixed") && ![...panel].some((k) => k.endsWith(":fixed")), "tanpa position fixed: pembungkus halaman memegang transform animasi sehingga fixed ikut terkurung");
pastikan(details.has("open:max-lg:w-full"), "di bawah lg, details terbuka selebar baris supaya panel mengalir penuh di dalam layar");
pastikan(panel.has("lg:absolute") && panel.has("lg:right-0") && panel.has("lg:w-[36rem]"), "mulai lg perilaku lama: melayang di bawah tombol, rata kanan, lebar 36rem");
pastikan(!sumber.includes("100vw"), "lebar tidak lagi bergantung pada 100vw");
console.log("=== DONE, all panel cetak sempit checks passed ===");
