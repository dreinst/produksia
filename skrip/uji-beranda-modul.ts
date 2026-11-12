import "dotenv/config";
// Skrip ini memanggil halaman, aksi, dan pustaka di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { existsSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { db } from "../src/lib/db";
import { HAK_BAWAAN, hitungHak, type Hak, type PenggunaSesi } from "../src/lib/hakAkses";
import { tabBeranda } from "../src/lib/beranda";
import {
  KELAS_BATANG, PRIORITAS_DESAIN, STATUS_DESAIN, STATUS_KAMPANYE, STATUS_KONTEN, URUTAN_PRIORITAS, URUTAN_STATUS_DESAIN,
  URUTAN_STATUS_KAMPANYE, URUTAN_STATUS_KONTEN, nadaKanban,
} from "../src/lib/labelPemasaran";
import { geserTanggalIso, ringkasanKontenBeranda } from "../src/lib/konten";
import { ringkasanDesainBeranda, tugasLewatTenggat } from "../src/lib/desain";
import { ringkasanIklan, totalMetrik, turunanMetrik, type BarisMetrik } from "../src/lib/iklan";
import { BATAS_PROYEK_MUAT, daftarKeuanganProyek, hitungRingkasanKeuangan, persen, ringkasanKeuanganProyek, type MasukanKeuangan } from "../src/lib/keuanganProyek";
import { periksaSinkron } from "../src/lib/sinkron";
import { ringkasanProyek } from "../src/lib/proyek";
import { tanggalIso } from "../src/lib/waktu";
import { D, uang, type Desimal } from "../src/lib/uang";
import { buatPenawaran, konversiPenawaranKePesanan, buatFaktur, buatPenerimaan, buatUangMuka } from "../src/lib/aksi/penjualan";
import { buatKasKeluar } from "../src/lib/aksi/jurnal";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import Beranda from "../src/app/(aplikasi)/page";
import DasborModul from "../src/komponen/beranda/DasborModul";
import PanelPemasaran, { muatDataPemasaran } from "../src/komponen/beranda/PanelPemasaran";
import PanelProyek from "../src/komponen/beranda/PanelProyek";
import PanelSaya, { TAUTAN_MENUNGGU, menungguPersetujuanSaya } from "../src/komponen/beranda/PanelSaya";
import AngkaBergerak from "../src/komponen/ui/AngkaBergerak";
import type { PeranPengguna } from "../src/prisma-klien/client";
import { aturPersetujuan, formulir, jalankan, pastikan, sebagai } from "./bantuan";

/*
 * Uji tab Pemasaran dan Keuangan Proyek di beranda (paket DF4): rumus iklan Decimal (contoh angka D6 §3.3), rumus
 * ringkasan keuangan proyek (contoh D5 §3.7), ringkasan konten, desain, dan iklan pada data uji di dua perusahaan,
 * keuangan proyek yang biaya dan pendapatannya sama dengan LPJ, panel per hak dan per lingkup, dan tautan panel.
 * Tambahan P01: faktur draf yang memakai sisa DP tidak mengubah ditagih dan diterima, jumlahTotal dan keterangan batas
 * 500 proyek, sisa percobaan terputus dibersihkan di awal, serta periksaSinkron dan angka jurnal, akun, stok sama
 * sebelum dan sesudah suite.
 * Data uji memakai perusahaan UJM1/UJM2, pengguna ujimodul-*, dan kode UJM-*; semuanya dibersihkan di akhir.
 */

const PREFIKS = "ujimodul-";

async function denganEnv<T>(isian: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const lama: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(isian)) {
    lama[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(lama)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function penggunaSintetis(peran: PeranPengguna, hak: readonly Hak[] = hitungHak(peran), id = "skrip-uji"): PenggunaSesi {
  return { id, nama: "Skrip Uji", namaPengguna: "skrip-uji", email: null, nomorTelepon: null, peran, hak };
}

const sama = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const samaD = (a: Desimal | null, b: string | number) => a !== null && a.equals(D(b));

/** Menjalankan komponen server (termasuk async) secara rekursif untuk mengumpulkan teks dan href. */
async function render(node: ReactNode): Promise<{ teks: string; href: string[] }> {
  const teks: string[] = [];
  const href: string[] = [];
  const jalan = async (n: ReactNode | Promise<ReactNode>): Promise<void> => {
    const v = await n;
    if (v === null || v === undefined || typeof v === "boolean") return;
    if (typeof v === "string" || typeof v === "number") return void teks.push(String(v));
    if (Array.isArray(v)) {
      for (const x of v) await jalan(x);
      return;
    }
    if (!isValidElement(v)) return;
    const el = v as ReactElement<Record<string, unknown>>;
    if (el.type === Link) {
      href.push(String(el.props.href));
      return jalan(el.props.children as ReactNode);
    }
    if (el.type === AngkaBergerak) return void teks.push(`${el.props.awalan ?? "Rp "}${Number(el.props.nilai).toLocaleString("id-ID")}`);
    if (typeof el.type === "function") return jalan((el.type as (p: unknown) => ReactNode | Promise<ReactNode>)(el.props));
    return jalan(el.props.children as ReactNode);
  };
  await jalan(node);
  return { teks: teks.join(""), href };
}

/** Tautan internal harus menuju halaman yang ada; segmen yang tidak ada boleh cocok dengan folder [id]. */
function ruteAda(href: string): boolean {
  const jalur = href.split("?")[0].split("#")[0];
  if (jalur === "/" || jalur === "") return existsSync("src/app/(aplikasi)/page.tsx");
  let dir = "src/app/(aplikasi)";
  for (const seg of jalur.split("/").filter(Boolean)) {
    if (existsSync(`${dir}/${seg}`)) dir = `${dir}/${seg}`;
    else if (existsSync(`${dir}/[id]`)) dir = `${dir}/[id]`;
    else return false;
  }
  return existsSync(`${dir}/page.tsx`);
}

/** Hapus data uji pemasaran dan proyek langsung (juga sisa percobaan yang terputus). Dokumen berjurnal dihapus lewat hapusDokumen di main. */
async function bersihkanDataUji() {
  const ids = (await db.perusahaan.findMany({ where: { kode: { in: ["UJM1", "UJM2"] } }, select: { id: true } })).map((p) => p.id);
  await db.tugasDesain.deleteMany({ where: { perusahaanId: { in: ids } } });
  await db.konten.deleteMany({ where: { perusahaanId: { in: ids } } });
  await db.kampanye.deleteMany({ where: { perusahaanId: { in: ids } } });
  await db.proyek.deleteMany({ where: { OR: [{ kode: { in: ["UJM-PRJ-2", "UJM-PRJ-3"] } }, { kode: { startsWith: PREFIKS_PROYEK_MASSAL } }] } });
  await db.perusahaan.deleteMany({ where: { id: { in: ids } } });
  await db.pengguna.deleteMany({ where: { namaPengguna: { startsWith: PREFIKS } } });
}

/** Kode proyek massal untuk menguji batas 500 proyek daftarKeuanganProyek (milik perusahaan uji UJM2). */
const PREFIKS_PROYEK_MASSAL = "UJM-PRJ-M";

/**
 * Dokumen berjurnal data uji keuangan proyek (pelanggan UJM-CUST, akun UJM-*), termasuk sisa percobaan yang terputus
 * (pastikan memanggil process.exit, jadi pembersihan akhir bisa terlewat). Dihapus lewat hapusDokumen supaya jurnal,
 * uang muka, dan progres pesanan ikut dibalik: kas, penerimaan, faktur (terbaru dulu), uang muka, pesanan, penawaran.
 * Mengembalikan nomor dokumen dan jurnal yang disentuh, untuk membersihkan log aktivitasnya.
 */
async function bersihkanDokumenProyekUji(): Promise<string[]> {
  const akunUji = (await db.akun.findMany({ where: { kode: { startsWith: "UJM-" } }, select: { id: true } })).map((a) => a.id);
  const pelanggan = { pelanggan: { kode: "UJM-CUST" } };
  const terbaru = { orderBy: { tanggal: "desc" as const }, select: { id: true, nomor: true } };
  const nomor = (await db.jurnal.findMany({ where: { baris: { some: { akunId: { in: akunUji } } } }, select: { nomor: true } })).map((j) => j.nomor);
  const hapus = async (jenis: Parameters<typeof hapusDokumen>[0], d: { id: string; nomor: string }) => {
    nomor.push(d.nomor);
    // jalankan mengabaikan galat revalidatePath di luar permintaan HTTP (datanya sudah terhapus saat itu)
    await jalankan(`hapus ${d.nomor}`, () => hapusDokumen(jenis, d.id)).catch((e: unknown) => console.warn(`[bersih] ${d.nomor} gagal dihapus: ${(e as Error).message}`));
  };
  for (const d of await db.dokumenKas.findMany({ where: { OR: [{ akunKasId: { in: akunUji } }, { akunLawanId: { in: akunUji } }] }, select: { id: true, nomor: true } })) await hapus("dokumenKas", d);
  for (const j of await db.jurnal.findMany({ where: { sumber: { in: ["KAS_MASUK", "KAS_KELUAR"] }, baris: { some: { akunId: { in: akunUji } } } }, select: { id: true, nomor: true } })) await hapus("jurnal", j);
  for (const d of await db.penerimaanPenjualan.findMany({ where: { faktur: pelanggan }, ...terbaru })) await hapus("penerimaan", d);
  for (const d of await db.fakturPenjualan.findMany({ where: pelanggan, ...terbaru })) await hapus("faktur", d);
  for (const d of await db.uangMukaPelanggan.findMany({ where: { pesanan: pelanggan }, ...terbaru })) await hapus("uangMuka", d);
  for (const d of await db.pesananPenjualan.findMany({ where: pelanggan, ...terbaru })) await hapus("pesanan", d);
  for (const d of await db.penawaranPenjualan.findMany({ where: pelanggan, ...terbaru })) await hapus("penawaran", d);
  return nomor;
}

/** Angka pembanding pembersihan: jumlah jurnal, baris jurnal, akun, dan baris stok beserta totalnya. */
async function potretAkuntansi() {
  const stok = await db.stokBarang.aggregate({ _count: true, _sum: { jumlah: true } });
  return JSON.stringify({ jurnal: await db.jurnal.count(), barisJurnal: await db.barisJurnal.count(), akun: await db.akun.count(), stok: stok._count, jumlahStok: String(stok._sum.jumlah ?? 0) });
}

async function bersihkanDataProyekLangsung() {
  await db.proyek.deleteMany({ where: { kode: { startsWith: "UJM-PRJ-" } } });
  await db.akunKategoriAnggaran.deleteMany({ where: { akun: { kode: { startsWith: "UJM-" } } } });
  await db.kategoriAnggaran.deleteMany({ where: { namaKunci: { startsWith: "ujm kategori" } } });
  await db.barang.deleteMany({ where: { kode: "UJM-JASA" } });
  await db.pelanggan.deleteMany({ where: { kode: "UJM-CUST" } });
  await db.akun.deleteMany({ where: { kode: { startsWith: "UJM-" } } });
}

async function main() {
  // sisa percobaan yang terputus: dokumen berjurnal dulu, lalu data induk proyek, lalu data uji lain
  await bersihkanDokumenProyekUji();
  await bersihkanDataProyekLangsung();
  await bersihkanDataUji();
  aturPersetujuan(false);
  const sinkronAwal = JSON.stringify(await periksaSinkron(db));
  const akuntansiAwal = await potretAkuntansi();

  console.log("=== 1. Label pemasaran ===");
  pastikan(sama(Object.keys(STATUS_KONTEN), [...URUTAN_STATUS_KONTEN]) && sama(Object.keys(STATUS_DESAIN), [...URUTAN_STATUS_DESAIN]), "urutan status konten dan desain lengkap dan sejalan dengan labelnya");
  pastikan(sama(Object.keys(STATUS_KAMPANYE), [...URUTAN_STATUS_KAMPANYE]) && sama(Object.keys(PRIORITAS_DESAIN), [...URUTAN_PRIORITAS]), "urutan status kampanye dan prioritas lengkap");
  pastikan(STATUS_KONTEN.TERJADWAL.warna === "cyan" && nadaKanban("cyan") === "blue" && nadaKanban("indigo") === "emerald" && nadaKanban("rose") === "rose", "nada kanban: cyan jadi blue, indigo jadi emerald");
  pastikan(Object.values(KELAS_BATANG).every((c) => c.startsWith("bg-")), "kelas batang per warna terdefinisi");

  console.log("=== 2. Rumus iklan (D6 §3.3 no. 5, Decimal) ===");
  const r1: BarisMetrik = { belanja: "2500000", jangkauan: 90000, tayangan: 120000, klik: 2400, leads: 48, konversi: 0, pendapatan: "9000000" };
  const r2: BarisMetrik = { belanja: "3100000", jangkauan: 100000, tayangan: 150000, klik: 3300, leads: 61, konversi: 0, pendapatan: "12500000" };
  const t1 = turunanMetrik(r1, "PROSPEK");
  pastikan(t1.ctr.equals(D("2.00")) && t1.cpc.equals(D("1041.67")) && t1.cpm.equals(D("20833.33")) && t1.cpr.equals(D("52083.33")) && t1.roas.equals(D("3.60")), `laporan 1: CTR 2,00; CPC 1.041,67; CPM 20.833,33; CPR 52.083,33; ROAS 3,60 (${t1.ctr}, ${t1.cpc}, ${t1.cpm}, ${t1.cpr}, ${t1.roas})`);
  const t2 = turunanMetrik(r2, "PROSPEK");
  pastikan(t2.ctr.equals(D("2.20")) && t2.cpc.equals(D("939.39")) && t2.cpm.equals(D("20666.67")) && t2.cpr.equals(D("50819.67")) && t2.roas.equals(D("4.03")), "laporan 2: CTR 2,20; CPC 939,39; CPM 20.666,67; CPR 50.819,67; ROAS 4,03");
  const tt = totalMetrik([r1, r2], "PROSPEK");
  pastikan(tt.ctr.equals(D("2.11")) && tt.cpc.equals(D("982.46")) && tt.cpm.equals(D("20740.74")) && samaD(tt.cpr, "51376.15") && tt.roas.equals(D("3.84")), `total: CTR 2,11; CPC 982,46; CPM 20.740,74; CPR 51.376,15; ROAS 3,84 (${tt.ctr}, ${tt.cpc}, ${tt.cpm}, ${tt.cpr}, ${tt.roas})`);
  const nol = turunanMetrik({ belanja: 0, jangkauan: 0, tayangan: 0, klik: 0, leads: 0, konversi: 0, pendapatan: 0 }, "PROSPEK");
  pastikan([nol.ctr, nol.cpc, nol.cpm, nol.cpr, nol.roas].every((x) => x.isZero()), "semua penyebut nol: semua turunan 0");
  const manual = turunanMetrik({ ...r1, ctrManual: "5" }, "PROSPEK");
  pastikan(manual.ctr.equals(D("5.00")) && totalMetrik([{ ...r1, ctrManual: "5" }, r2], "PROSPEK").ctr.equals(D("2.11")), "ctrManual 5 menimpa CTR laporan, total mengabaikan nilai manual");
  pastikan(turunanMetrik({ belanja: 1, jangkauan: 0, tayangan: 0, klik: 8, leads: 0, konversi: 0, pendapatan: 0 }, "TRAFFIC").cpc.equals(D("0.13")), "pembulatan setengah ke atas: belanja 1, klik 8 = CPC 0,13");
  const interaksi = { belanja: 50000, jangkauan: 10, tayangan: 100, klik: 5, leads: 3, konversi: 2, pendapatan: 0 };
  pastikan(turunanMetrik(interaksi, "INTERAKSI").cpr.isZero() && turunanMetrik({ ...interaksi, hasil: 100 }, "INTERAKSI").cpr.equals(D("500.00")), "INTERAKSI tanpa hasil: CPR 0; hasil 100 dan belanja 50.000: CPR 500,00");
  pastikan(turunanMetrik(interaksi, "KESADARAN").hasilEfektif === 10 && turunanMetrik(interaksi, "PENJUALAN").hasilEfektif === 2 && turunanMetrik(interaksi, "TRAFFIC").hasilEfektif === 5, "KESADARAN memakai jangkauan, PENJUALAN konversi, TRAFFIC klik");
  pastikan(totalMetrik([r1, interaksi], ["PROSPEK", "TRAFFIC"]).cpr === null, "total lintas tujuan berbeda: CPR null");

  console.log("=== 3. Rumus ringkasan keuangan proyek (D5 §3.7, murni) ===");
  const kategori = new Map([["venue", "Venue"], ["produksi", "Produksi"], ["talent", "Talent / Artis"]]);
  const petaAkun: Record<string, string | null> = { "akun-venue": "venue", "akun-talent": "talent", "akun-lain": null };
  const dasarMasukan = (isi: Partial<MasukanKeuangan>): MasukanKeuangan => ({
    pesanan: [], penawaran: [], faktur: [], uangMuka: [], terminDitagih: new Map(), faktorDppUangMuka: D(1), nilaiKontrakManual: null,
    rencana: [], bebanPerAkun: [], akunBagiHasilId: null, kategoriUntukAkun: (a) => petaAkun[a] ?? null, namaKategori: kategori, ...isi,
  });
  const contoh = dasarMasukan({
    pesanan: [{ id: "ps1", total: D(10000000) }],
    faktur: [{ pesananId: "ps1", dpp: D(10000000), total: D(10000000), uangMuka: D(0), dibayar: D(10000000), returDpp: D(0) }],
    rencana: [{ kategoriId: "venue", rencana: D(2000000) }, { kategoriId: "produksi", rencana: D(3000000) }],
    bebanPerAkun: [{ akunId: "akun-venue", nilai: D(2500000) }, { akunId: "akun-talent", nilai: D(1000000) }],
  });
  const rk = hitungRingkasanKeuangan(contoh);
  pastikan(rk.kontrak.equals(D(10000000)) && rk.ditagih.equals(D(10000000)) && rk.diterima.equals(D(10000000)) && rk.sumberPendapatan === "KONTRAK", "contoh: kontrak = ditagih = diterima = 10.000.000, sumber KONTRAK");
  pastikan(rk.anggaran.equals(D(5000000)) && rk.aktual.equals(D(3500000)) && rk.sisaAnggaran.equals(D(1500000)) && samaD(rk.persenTerpakai, 70), "anggaran 5.000.000, aktual 3.500.000, sisa 1.500.000, terpakai 70,0%");
  pastikan(rk.perkiraanBiaya.equals(D(6500000)) && rk.marginRencana.equals(D(5000000)) && samaD(rk.persenMarginRencana, 50) && rk.marginPerkiraan.equals(D(3500000)) && samaD(rk.persenMarginPerkiraan, 35), "perkiraan 6.500.000; margin rencana 5.000.000 (50%); margin perkiraan 3.500.000 (35%)");
  pastikan(rk.marginTagih.equals(D(6500000)) && rk.marginKas.equals(D(6500000)) && samaD(rk.persenMarginKas, 65) && rk.piutang.isZero() && rk.belumDitagih.isZero(), "margin tagih = margin kas = 6.500.000 (65%), piutang 0, belum ditagih 0");
  pastikan(sama(rk.kategori.map((k) => `${k.nama}:${k.aktual.toFixed(0)}:${k.lebih ? "L" : ""}${k.tanpaAnggaran ? "T" : ""}`), ["Venue:2500000:L", "Talent / Artis:1000000:T", "Produksi:0:"]), `realisasi per kategori urut aktual turun (${JSON.stringify(rk.kategori.map((k) => k.nama))})`);
  const belumBayar = hitungRingkasanKeuangan(dasarMasukan({ ...contoh, faktur: [{ ...contoh.faktur[0], dibayar: D(0) }] }));
  pastikan(belumBayar.diterima.isZero() && belumBayar.piutang.equals(D(10000000)), "faktur disetujui belum dibayar: diterima 0, piutang 10.000.000");
  const sebagian = hitungRingkasanKeuangan(dasarMasukan({ pesanan: [{ id: "ps1", total: D(10000000) }], faktur: [{ pesananId: "ps1", dpp: D(10000000), total: D(11100000), uangMuka: D(0), dibayar: D(5550000), returDpp: D(0) }] }));
  pastikan(sebagian.diterima.equals(D(5000000)) && sebagian.piutang.equals(D(5000000)), "PKP dibayar sebagian 5.550.000 dari 11.100.000: diterima 5.000.000 (tanpa PPN), piutang 5.000.000");
  const hanyaPenawaran = hitungRingkasanKeuangan(dasarMasukan({ penawaran: [{ id: "q1", tanggal: new Date("2026-01-01"), total: D(8000000), status: "DRAF", statusKomersial: "DRAF", punyaPesanan: false }] }));
  pastikan(hanyaPenawaran.kontrak.isZero() && hanyaPenawaran.dikutip.equals(D(8000000)) && hanyaPenawaran.pendapatanRencana.equals(D(8000000)) && hanyaPenawaran.sumberPendapatan === "PENAWARAN", "hanya penawaran DRAF 8.000.000: dikutip 8.000.000, sumber PENAWARAN");
  const dikonversi = hitungRingkasanKeuangan(dasarMasukan({ pesanan: [{ id: "ps1", total: D(8000000) }], penawaran: [{ id: "q1", tanggal: new Date("2026-01-01"), total: D(8000000), status: "DIKONVERSI", statusKomersial: "DITERIMA", punyaPesanan: true }] }));
  pastikan(dikonversi.kontrak.equals(D(8000000)) && dikonversi.dikutip.isZero() && dikonversi.sumberPendapatan === "KONTRAK", "setelah dikonversi: kontrak 8.000.000, dikutip 0, sumber KONTRAK");
  pastikan(hitungRingkasanKeuangan(dasarMasukan({ nilaiKontrakManual: D(750000) })).sumberPendapatan === "MANUAL" && hitungRingkasanKeuangan(dasarMasukan({})).sumberPendapatan === "TIDAK_ADA", "cadangan nilai kontrak manual hanya bila semua dokumen nol");
  const bagi = hitungRingkasanKeuangan(dasarMasukan({ akunBagiHasilId: "akun-bagi", bebanPerAkun: [{ akunId: "akun-bagi", nilai: D(400000) }, { akunId: "akun-lain", nilai: D(100000) }] }));
  pastikan(bagi.aktual.equals(D(100000)) && bagi.bagiHasilDibayar.equals(D(400000)) && bagi.kategori.length === 1 && bagi.kategori[0].nama === "Belum dikategorikan", "akun bagi hasil dikecualikan dari aktual; akun tanpa kategori masuk Belum dikategorikan");
  pastikan(persen(D(1), D(3))!.equals(D("33.3")) && persen(D(2), D(3))!.equals(D("66.7")) && persen(D(1), D(0)) === null, "persen satu desimal setengah ke atas; penyebut nol = null");

  console.log("=== Data uji pemasaran ===");
  const p1 = await db.perusahaan.create({ data: { kode: "UJM1", nama: "PT Uji Modul Satu", urutan: 96 } });
  const p2 = await db.perusahaan.create({ data: { kode: "UJM2", nama: "PT Uji Modul Dua", urutan: 97 } });
  const uD = await db.pengguna.create({ data: { namaPengguna: `${PREFIKS}d`, nama: "Uji Modul Desainer", peran: "DESAINER", kataSandiHash: "-" } });
  const uS = await db.pengguna.create({ data: { namaPengguna: `${PREFIKS}s`, nama: "Uji Modul Sosmed", peran: "SOSMED", kataSandiHash: "-" } });
  const hariIni = tanggalIso(new Date());
  const hari = (n: number) => new Date(`${geserTanggalIso(hariIni, n)}T12:00:00`);
  const sebelumKontenGab = await ringkasanKontenBeranda(db, null);
  const sebelumDesainGab = await ringkasanDesainBeranda(db, uD.id, null);
  const sebelumIklanGab = await ringkasanIklan(db, {}, null);
  const konten = (perusahaanId: string, judul: string, status: string, n: number | null, lain: { menunggu?: boolean; arsip?: boolean; jam?: string } = {}) =>
    db.konten.create({
      data: {
        perusahaanId, judul, status: status as never, dibuatOlehNama: "Skrip Uji", platform: "INSTAGRAM",
        tanggalTerbit: n === null ? null : hari(n), jamTerbit: lain.jam ?? null,
        statusPersetujuan: lain.menunggu ? "MENUNGGU" : "TIDAK_ADA",
        diarsipkanPada: lain.arsip ? new Date() : null,
      },
    });
  await konten(p1.id, "UJM Ide", "IDE", null);
  const kB = await konten(p1.id, "UJM Hari ini", "DRAF", 0, { jam: "09:00" });
  const kC = await konten(p1.id, "UJM Tiga hari", "DITINJAU", 3, { menunggu: true });
  const kD = await konten(p1.id, "UJM Empat belas hari", "TERJADWAL", 14);
  await konten(p1.id, "UJM Kemarin", "TERBIT", -1);
  await konten(p1.id, "UJM Lima belas hari", "DESAIN", 15);
  await konten(p1.id, "UJM Arsip", "DRAF", 2, { menunggu: true, arsip: true });
  const kH = await konten(p2.id, "UJM Perusahaan dua", "DITINJAU", 1, { menunggu: true });

  const tugas = (perusahaanId: string, judul: string, status: string, desainerId: string | null, n: number | null, arsip = false) =>
    db.tugasDesain.create({ data: { perusahaanId, judul, status: status as never, desainerId, tenggat: n === null ? null : hari(n), dibuatOlehNama: "Skrip Uji", diarsipkanPada: arsip ? new Date() : null } });
  const T1 = await tugas(p1.id, "UJM Tugas ditugaskan", "DITUGASKAN", uD.id, 5);
  const T2 = await tugas(p1.id, "UJM Tugas revisi", "REVISI", uD.id, -2);
  const T3 = await tugas(p1.id, "UJM Tugas ditinjau", "DITINJAU", uD.id, null);
  await tugas(p1.id, "UJM Tugas selesai", "SELESAI", uD.id, 1);
  await tugas(p1.id, "UJM Tugas arsip", "DIKERJAKAN", uD.id, 1, true);
  await tugas(p1.id, "UJM Tugas orang lain", "DITINJAU", null, null);
  const T7 = await tugas(p2.id, "UJM Tugas perusahaan dua", "DISETUJUI", uD.id, 1);

  const kampanye = (perusahaanId: string, nama: string, tujuan: string, status: string, anggaran: string, arsip = false) =>
    db.kampanye.create({ data: { perusahaanId, nama, tujuan: tujuan as never, status: status as never, anggaran, dibuatOlehNama: "Skrip Uji", diarsipkanPada: arsip ? new Date() : null } });
  const metrik = (kampanyeId: string, n: number, m: Partial<BarisMetrik> & { hasil?: number | null }) =>
    db.metrikIklan.create({ data: { kampanyeId, tanggal: hari(n), dicatatOlehNama: "Skrip Uji", ...(m as object) } });
  const K1 = await kampanye(p1.id, "UJM Prospek", "PROSPEK", "DIRENCANAKAN", "6000000");
  await metrik(K1.id, -2, r1);
  await metrik(K1.id, -1, r2);
  await new Promise((s) => setTimeout(s, 5));
  const K2 = await kampanye(p1.id, "UJM Traffic", "TRAFFIC", "AKTIF", "1500000.50");
  await metrik(K2.id, -2, { belanja: "100000", tayangan: 10000, klik: 200, hasil: 50 });
  await metrik(K2.id, -1, { belanja: "50000", tayangan: 5000, klik: 300, jangkauan: 4000 });
  const K4 = await kampanye(p1.id, "UJM Arsip", "PROSPEK", "AKTIF", "999", true);
  await metrik(K4.id, -1, { belanja: "999999", leads: 9 });
  const K3 = await kampanye(p2.id, "UJM Dua", "PROSPEK", "AKTIF", "100");
  await metrik(K3.id, -1, { belanja: "1000", leads: 2 });

  console.log("=== 4. ringkasanKontenBeranda ===");
  const rkn1 = await ringkasanKontenBeranda(db, p1.id);
  pastikan(sama(rkn1.perStatus.map((s) => `${s.status}:${s.jumlah}`), ["IDE:1", "DRAF:1", "DESAIN:1", "DITINJAU:1", "DISETUJUI:0", "TERJADWAL:1", "TERBIT:1"]), `per status urut kanban, konten arsip tidak dihitung (${JSON.stringify(rkn1.perStatus)})`);
  pastikan(rkn1.menungguPersetujuan === 1, "menunggu persetujuan = 1 (arsip tidak ikut)");
  pastikan(sama(rkn1.mendatang.map((k) => k.id), [kB.id, kC.id, kD.id]), "mendatang: hari ini sampai hari ini + 14, urut tanggal, tanpa kemarin, hari ke-15, dan arsip");
  const rkn2 = await ringkasanKontenBeranda(db, p2.id);
  pastikan(rkn2.menungguPersetujuan === 1 && sama(rkn2.mendatang.map((k) => k.id), [kH.id]) && rkn2.perStatus.reduce((s, x) => s + x.jumlah, 0) === 1, "perusahaan dua hanya melihat kontennya sendiri");
  const rknG = await ringkasanKontenBeranda(db, null);
  pastikan(rknG.menungguPersetujuan - sebelumKontenGab.menungguPersetujuan === 2 && rknG.perStatus.reduce((s, x) => s + x.jumlah, 0) - sebelumKontenGab.perStatus.reduce((s, x) => s + x.jumlah, 0) === 7, "gabungan = jumlah kedua perusahaan");

  console.log("=== 5. ringkasanDesainBeranda ===");
  const rd1 = await ringkasanDesainBeranda(db, uD.id, p1.id);
  pastikan(rd1.ditugaskanKeSaya === 3 && rd1.revisiSaya === 1 && rd1.menungguTinjauan === 2, `desainer lingkup satu: ditugaskan 3, revisi 1, menunggu tinjauan 2 (${rd1.ditugaskanKeSaya}, ${rd1.revisiSaya}, ${rd1.menungguTinjauan})`);
  pastikan(sama(rd1.tugasSaya.map((t) => t.id), [T2.id, T1.id, T3.id]), "tugas saya urut tenggat naik, tanpa tenggat paling akhir, tanpa Selesai dan arsip");
  pastikan(sama(rd1.perStatus.map((s) => s.jumlah), [0, 1, 0, 2, 1, 0, 1]), `per status semua tugas aktif dalam lingkup (${JSON.stringify(rd1.perStatus)})`);
  const rdG = await ringkasanDesainBeranda(db, uD.id, null);
  pastikan(rdG.ditugaskanKeSaya === 4 && sama(rdG.tugasSaya.map((t) => t.id), [T2.id, T7.id, T1.id, T3.id]) && rdG.menungguTinjauan - sebelumDesainGab.menungguTinjauan === 2, "gabungan memuat tugas perusahaan dua (Disetujui tetap dihitung, seperti HKA)");
  pastikan((await ringkasanDesainBeranda(db, uS.id, p1.id)).ditugaskanKeSaya === 0, "pengguna lain tidak melihat tugas desainer sebagai tugasnya");
  pastikan(tugasLewatTenggat(T2) && !tugasLewatTenggat(T1) && !tugasLewatTenggat(T7) && !tugasLewatTenggat({ tenggat: hari(-3), status: "SELESAI" }), "lewat tenggat hanya untuk tugas belum Disetujui/Selesai dengan tenggat sebelum hari ini");

  console.log("=== 6. ringkasanIklan ===");
  const ri1 = await ringkasanIklan(db, {}, p1.id);
  pastikan(ri1.jumlahKampanye === 2 && ri1.aktif === 1 && ri1.anggaranRencana.equals(D("7500000.50")), "lingkup satu: 2 kampanye (arsip tidak ikut), 1 aktif, anggaran rencana 7.500.000,50");
  pastikan(sama(ri1.perStatus.map((s) => `${s.status}:${s.jumlah}`), ["DIRENCANAKAN:1", "AKTIF:1", "DIJEDA:0", "SELESAI:0"]), "per status kampanye");
  pastikan(ri1.total.belanja.equals(D(5750000)) && ri1.total.cpr === null, "total belanja 5.750.000 tanpa laporan kampanye arsip; CPR null karena tujuan berbeda");
  pastikan(sama(ri1.perKampanye.map((k) => k.id), [K2.id, K1.id]), "per kampanye urut dibuat terbaru dulu");
  const traffic = ri1.perKampanye[0].total;
  pastikan(traffic.hasilEfektif === 350 && traffic.hasilEfektif === totalMetrik([{ belanja: 100000, jangkauan: 0, tayangan: 10000, klik: 200, leads: 0, konversi: 0, pendapatan: 0, hasil: 50 }, { belanja: 50000, jangkauan: 4000, tayangan: 5000, klik: 300, leads: 0, konversi: 0, pendapatan: 0 }], "TRAFFIC").hasilEfektif && samaD(traffic.cpr, "428.57"), "hasil efektif = hasil manual 50 + klik baris otomatis 300; CPR 428,57");
  const prospek = (await ringkasanIklan(db, { status: "DIRENCANAKAN" }, p1.id)).total;
  pastikan(prospek.ctr.equals(tt.ctr) && prospek.cpc.equals(tt.cpc) && prospek.cpm.equals(tt.cpm) && samaD(prospek.cpr, "51376.15") && prospek.roas.equals(D("3.84")), "saringan status: total dari basis data sama dengan contoh D6 (CTR 2,11 ... ROAS 3,84)");
  pastikan((await ringkasanIklan(db, { q: "traffic" }, p1.id)).jumlahKampanye === 1 && (await ringkasanIklan(db, { proyek: "tanpa" }, p1.id)).jumlahKampanye === 2, "saringan nama (tanpa beda huruf besar) dan tanpa proyek");
  const ri2 = await ringkasanIklan(db, {}, p2.id);
  pastikan(ri2.jumlahKampanye === 1 && ri2.total.belanja.equals(D(1000)), "perusahaan dua hanya melihat kampanyenya sendiri");
  const riG = await ringkasanIklan(db, {}, null);
  pastikan(riG.jumlahKampanye - sebelumIklanGab.jumlahKampanye === 3 && riG.total.belanja.minus(sebelumIklanGab.total.belanja).equals(D(5751000)), "gabungan = penjumlahan kedua perusahaan");

  console.log("=== 7. Data dan panel pemasaran per hak ===");
  const pemilik = penggunaSintetis("PEMILIK");
  const dPemilik = await muatDataPemasaran(pemilik, p1.id);
  pastikan(dPemilik.konten !== null && dPemilik.desain !== null && dPemilik.iklan !== null, "PEMILIK: konten, desain, dan iklan dimuat");
  const dSosmed = await muatDataPemasaran(penggunaSintetis("SOSMED"), p1.id);
  pastikan(dSosmed.konten !== null && dSosmed.desain !== null && dSosmed.iklan === null, "SOSMED tanpa kampanye.lihat: data iklan tidak dimuat");
  const dDesainer = await muatDataPemasaran(penggunaSintetis("DESAINER"), p1.id);
  pastikan(dDesainer.iklan === null && dDesainer.konten !== null, "DESAINER: tanpa data iklan");
  pastikan((await PanelPemasaran({ pengguna: penggunaSintetis("KASIR"), perusahaanId: null })) === null, "PanelPemasaran tanpa hak pemasaran: tidak dirender");
  const panelIklan = await render(PanelPemasaran({ pengguna: penggunaSintetis("IKLAN"), perusahaanId: p1.id }));
  pastikan(panelIklan.teks.includes("Iklan Meta") && panelIklan.teks.includes("Rp 5.750.000") && panelIklan.teks.includes("3,74x") && panelIklan.teks.includes("Konten"), "IKLAN lingkup satu: kartu Iklan Meta dengan belanja 5.750.000, ROAS 3,74x, dan kartu Konten");
  const panelSosmed = await render(PanelPemasaran({ pengguna: penggunaSintetis("SOSMED"), perusahaanId: p1.id }));
  pastikan(!panelSosmed.teks.includes("Iklan Meta") && panelSosmed.teks.includes("Tugas desain") && panelSosmed.teks.includes("UJM Tiga hari") && panelSosmed.teks.includes("Menunggu tinjauan:"), "SOSMED: konten dan tugas desain tanpa kartu iklan");
  const panelP2 = await render(PanelPemasaran({ pengguna: pemilik, perusahaanId: p2.id }));
  pastikan(panelP2.teks.includes("UJM Perusahaan dua") && !panelP2.teks.includes("UJM Tiga hari") && panelP2.teks.includes("Rp 1.000"), "lingkup perusahaan dua: hanya konten dan iklan perusahaan dua");
  const panelGab = await render(PanelPemasaran({ pengguna: pemilik, perusahaanId: null }));
  pastikan(panelGab.teks.includes("UJM1") && panelGab.teks.includes("UJM2"), "gabungan: daftar akan terbit memuat lencana perusahaan");
  // P46: tautan "Buka ..." per kartu dan judul konten mendatang ke lacinya
  pastikan(["/pemasaran/konten", "/pemasaran/desain", "/pemasaran/iklan"].every((h) => panelGab.href.includes(h)) && panelGab.href.some((h) => h.startsWith("/pemasaran/konten?konten=")), "PEMILIK: Buka kalender konten, Buka tugas desain, Buka iklan, dan judul konten menaut lacinya");
  pastikan(!panelSosmed.href.includes("/pemasaran/iklan") && panelSosmed.href.includes("/pemasaran/desain"), "SOSMED tanpa kampanye.lihat: tanpa tautan Buka iklan");
  const panelIklanSaja = await render(PanelPemasaran({ pengguna: penggunaSintetis("IKLAN", ["kampanye.lihat"]), perusahaanId: p1.id }));
  pastikan(sama(panelIklanSaja.href, ["/pemasaran/iklan"]), "hanya kampanye.lihat: satu tautan Buka iklan");
  const tautanMati = [...panelGab.href, ...panelSosmed.href, ...panelIklan.href].filter((h) => !ruteAda(h));
  pastikan(tautanMati.length === 0, `tautan panel pemasaran menuju rute yang ada${tautanMati.length ? `; tidak ada: ${tautanMati.join(", ")}` : ""}`);

  console.log("=== 8. Tugas Saya: tugas desain dan persetujuan pemasaran ===");
  const sayaDesainer = await sebagai(`${PREFIKS}d`, async () => (await import("../src/lib/otentikasi")).penggunaSaatIni());
  pastikan(sayaDesainer && sayaDesainer.id === uD.id, "pengguna nyata desainer terbaca lewat UJI_PENGGUNA");
  const panelSayaD = await render(PanelSaya({ pengguna: sayaDesainer, perusahaanId: p1.id }));
  pastikan(panelSayaD.teks.includes("Tugas desain saya") && panelSayaD.teks.includes("UJM Tugas revisi") && panelSayaD.teks.includes("Lewat tenggat") && panelSayaD.teks.includes("Revisi untuk Anda: 1"), "DESAINER: kartu tugas desain saya, tanda lewat tenggat, dan jumlah revisi");
  pastikan(!panelSayaD.teks.includes("UJM Tugas perusahaan dua") && !panelSayaD.teks.includes("UJM Tugas selesai"), "lingkup satu: tanpa tugas perusahaan lain dan tanpa tugas Selesai");
  const mPemilik = await menungguPersetujuanSaya(pemilik, p1.id);
  pastikan(mPemilik.find((b) => b.kode === "konten")?.jumlah === 1 && mPemilik.find((b) => b.kode === "desain")?.jumlah === 2, "PEMILIK: 1 konten menunggu persetujuan dan 2 desain menunggu tinjauan");
  const mAdmin = await menungguPersetujuanSaya(penggunaSintetis("ADMIN"), p1.id);
  pastikan(!mAdmin.some((b) => b.kode === "konten" || b.kode === "desain"), "ADMIN tanpa konten.setujui dan tugas-desain.setujui: tidak ada baris pemasaran");
  const mSosmed = await menungguPersetujuanSaya(penggunaSintetis("SOSMED"), p1.id);
  pastikan(sama(mSosmed.map((b) => `${b.kode}:${b.jumlah}`), ["desain:2"]), "SOSMED (tugas-desain.setujui tanpa konten.setujui): hanya tinjauan desain");
  const mGab = await menungguPersetujuanSaya(pemilik, null);
  pastikan((mGab.find((b) => b.kode === "konten")?.jumlah ?? 0) - sebelumKontenGab.menungguPersetujuan === 2, "gabungan: konten menunggu kedua perusahaan");
  const panelSayaS = await render(PanelSaya({ pengguna: penggunaSintetis("SOSMED"), perusahaanId: p1.id }));
  pastikan(panelSayaS.teks.includes("Tinjauan desain") && !panelSayaS.href.includes("/persetujuan"), "SOSMED: baris Tinjauan desain tanpa tautan Persetujuan (bukan dokumen maker-checker)");
  // P46: judul tugas desain saya ke laci tugas, baris konten dan desain menunggu ke daftar Pemasaran
  pastikan(panelSayaD.href.some((h) => h.startsWith("/pemasaran/desain?tugas=")), "DESAINER: judul tugas desain saya menaut laci tugas");
  const panelSayaP = await render(PanelSaya({ pengguna: pemilik, perusahaanId: p1.id }));
  pastikan(panelSayaP.href.includes(TAUTAN_MENUNGGU.konten.href) && panelSayaP.href.includes(TAUTAN_MENUNGGU.desain.href), "PEMILIK: baris konten dan desain menunggu menaut ke daftar Perencana Konten dan Tugas Desain");
  pastikan(TAUTAN_MENUNGGU.konten.href.startsWith("/pemasaran/konten") && TAUTAN_MENUNGGU.desain.href.startsWith("/pemasaran/desain"), "tujuan baris menunggu: /pemasaran/konten dan /pemasaran/desain");
  const sayaTanpaLihat = await render(PanelSaya({ pengguna: penggunaSintetis("SOSMED", hitungHak("SOSMED").filter((h) => h !== "tugas-desain.lihat")), perusahaanId: p1.id }));
  pastikan(!sayaTanpaLihat.href.some((h) => h.startsWith("/pemasaran/desain")), "tanpa tugas-desain.lihat: baris Tinjauan desain tanpa tautan");
  const mati8 = [...panelSayaD.href, ...panelSayaP.href].filter((h) => !ruteAda(h));
  pastikan(mati8.length === 0, `tautan Tugas Saya menuju rute yang ada${mati8.length ? `; tidak ada: ${mati8.join(", ")}` : ""}`);
  const panelSayaK = await render(PanelSaya({ pengguna: penggunaSintetis("KASIR"), perusahaanId: p1.id }));
  pastikan(!panelSayaK.teks.includes("Tugas desain saya"), "KASIR tanpa tugas-desain.lihat: tanpa kartu tugas desain");

  console.log("=== Data uji keuangan proyek ===");
  await bersihkanDataProyekLangsung();
  const idLogAwal = new Set((await db.logAktivitas.findMany({ select: { id: true } })).map((l) => l.id));
  const pelanggan = await db.pelanggan.create({ data: { kode: "UJM-CUST", nama: "Klien Uji Modul" } });
  const jasa = await db.barang.create({ data: { kode: "UJM-JASA", nama: "Jasa Uji Modul", jenis: "JASA", hargaBeli: 0, hargaJual: 1000000 } });
  const kas = await db.akun.create({ data: { kode: "UJM-KAS", nama: "Kas Uji Modul", jenis: "ASET", kasBank: true } });
  const bebanA = await db.akun.create({ data: { kode: "UJM-BEBAN-A", nama: "Beban Uji Modul A", jenis: "BEBAN" } });
  const bebanB = await db.akun.create({ data: { kode: "UJM-BEBAN-B", nama: "Beban Uji Modul B", jenis: "BEBAN" } });
  const katA = await db.kategoriAnggaran.create({ data: { nama: "UJM Kategori A", namaKunci: "ujm kategori a" } });
  const katB = await db.kategoriAnggaran.create({ data: { nama: "UJM Kategori B", namaKunci: "ujm kategori b" } });
  await db.akunKategoriAnggaran.create({ data: { akunId: bebanA.id, kategoriId: katA.id } });
  const proyek = await db.proyek.create({ data: { kode: "UJM-PRJ-1", nama: "Event Uji Modul", pelangganId: pelanggan.id, nilaiKontrak: 900000, anggaranBiaya: 400000, tanggalMulai: hari(30) } });
  const proyek2 = await db.proyek.create({ data: { kode: "UJM-PRJ-2", nama: "Event Uji Modul Dua", namaKlien: "Klien Teks", perusahaanId: p2.id } });
  const proyek3 = await db.proyek.create({ data: { kode: "UJM-PRJ-3", nama: "Event Uji Modul Selesai", status: "SELESAI" } });
  await db.barisAnggaranProyek.createMany({
    data: [
      { proyekId: proyek.id, kategoriId: katA.id, deskripsi: "Rencana A", rencana: 400000 },
      { proyekId: proyek.id, kategoriId: katB.id, deskripsi: "Rencana B", rencana: 100000 },
      { proyekId: proyek2.id, kategoriId: katB.id, deskripsi: "Rencana dua", rencana: 250000 },
    ],
  });
  // dua unit: faktur pertama menagih satu unit, sisanya untuk kasus faktur draf di bagian 13
  await jalankan("PNW jasa 2 × 1.000.000 (proyek uji)", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, proyekId: proyek.id, baris: [{ barangId: jasa.id, jumlah: 2, harga: 1000000 }] })));
  const pnw = await db.penawaranPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id } });
  await jalankan("konversi ke PSJ", () => konversiPenawaranKePesanan(pnw.id));
  const psj = await db.pesananPenjualan.findFirstOrThrow({ where: { penawaranId: pnw.id } });
  await jalankan("UM 300.000", () => buatUangMuka(formulir({ pesananId: psj.id, akunId: kas.id, jumlah: 300000 })));
  await jalankan("FJ 1.000.000 pakai DP 300.000", () => buatFaktur(formulir({ pesananId: psj.id, uangMuka: 300000, baris: [{ barangId: jasa.id, jumlah: 1, harga: 1000000 }] })));
  const fj = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj.id } });
  await jalankan("TRM 200.000", () => buatPenerimaan(formulir({ fakturId: fj.id, akunId: kas.id, jumlah: 200000 })));
  await jalankan("KK beban A 150.000 (proyek)", () => buatKasKeluar(formulir({ akunKasId: kas.id, akunLawanId: bebanA.id, jumlah: 150000, keterangan: "uji modul beban A", proyekId: proyek.id })));
  await jalankan("KK beban B 50.000 (proyek)", () => buatKasKeluar(formulir({ akunKasId: kas.id, akunLawanId: bebanB.id, jumlah: 50000, keterangan: "uji modul beban B", proyekId: proyek.id })));
  await jalankan("KK beban A 70.000 (tanpa proyek)", () => buatKasKeluar(formulir({ akunKasId: kas.id, akunLawanId: bebanA.id, jumlah: 70000, keterangan: "uji modul tanpa proyek" })));
  const fjSesudah = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fj.id } });
  pastikan(fjSesudah.statusPersetujuan === "DISETUJUI", "faktur uji disetujui (alur persetujuan mati di skrip uji)");

  console.log("=== 9. ringkasanKeuanganProyek sama dengan LPJ ===");
  const lpj = (await ringkasanProyek(db, proyek.id))!;
  const kp = (await ringkasanKeuanganProyek(db, proyek.id))!;
  const r = kp.ringkasan;
  pastikan(kp.proyek.kode === "UJM-PRJ-1" && kp.proyek.klien === "Klien Uji Modul", "proyek dan klien terbaca");
  pastikan(r.aktual.plus(r.bagiHasilDibayar).equals(lpj.labaRugi.totalBeban) && r.aktual.equals(D(200000)), `biaya aktual = total beban LPJ = 200.000 (aktual ${r.aktual}, LPJ ${lpj.labaRugi.totalBeban})`);
  pastikan(r.ditagih.equals(lpj.labaRugi.totalPendapatan) && r.ditagih.equals(D(fjSesudah.dpp)), `ditagih = pendapatan LPJ = DPP faktur (${r.ditagih}, LPJ ${lpj.labaRugi.totalPendapatan})`);
  pastikan(r.kontrak.equals(lpj.pemasukan.totalPesanan) && r.sumberPendapatan === "KONTRAK", "kontrak = total pesanan LPJ, sumber KONTRAK (nilai kontrak manual diabaikan)");
  const harapDiterima = uang(D(fjSesudah.uangMuka).plus(200000).mul(D(fjSesudah.dpp)).div(D(fjSesudah.total)));
  pastikan(r.diterima.equals(harapDiterima) && r.piutang.equals(uang(r.ditagih.minus(harapDiterima))), `diterima = (uang muka + pembayaran) × DPP ÷ total = ${harapDiterima}; uang muka yang sudah dipakai faktur tidak dihitung dua kali`);
  pastikan(r.anggaran.equals(D(500000)) && r.sisaAnggaran.equals(D(300000)) && r.perkiraanBiaya.equals(D(550000)) && r.marginKas.equals(uang(r.diterima.minus(200000))), "anggaran 500.000, sisa 300.000, perkiraan biaya 550.000, margin kas = diterima - aktual");
  pastikan(sama(r.kategori.map((k) => `${k.nama}:${k.rencana.toFixed(0)}:${k.aktual.toFixed(0)}`), ["UJM Kategori A:400000:150000", "Belum dikategorikan:0:50000", "UJM Kategori B:100000:0"]), `realisasi per kategori dari pemetaan akun (${JSON.stringify(r.kategori.map((k) => k.nama))})`);
  pastikan(r.kategori.reduce((s, k) => s.plus(k.aktual), D(0)).equals(r.aktual), "Σ aktual per kategori = aktual");
  pastikan((await ringkasanKeuanganProyek(db, "tidak-ada")) === null, "proyek tidak ada: null");

  console.log("=== 10. daftarKeuanganProyek per lingkup ===");
  const dUtama = await daftarKeuanganProyek(db, { status: "BERJALAN" }, "utama");
  pastikan(dUtama.baris.some((b) => b.id === proyek.id) && !dUtama.baris.some((b) => b.id === proyek2.id || b.id === proyek3.id), "lingkup utama: proyek berjalan utama saja (proyek selesai dan perusahaan lain tidak ikut)");
  pastikan(dUtama.baris[0].id === proyek.id, "urut tanggal mulai turun, tanpa tanggal di belakang");
  const barisUji = dUtama.baris.find((b) => b.id === proyek.id)!;
  pastikan(barisUji.ringkasan.aktual.equals(r.aktual) && barisUji.ringkasan.diterima.equals(r.diterima), "baris daftar sama dengan ringkasan satu proyek");
  pastikan(dUtama.total.aktual.equals(uang(dUtama.baris.reduce((s, b) => s.plus(b.ringkasan.aktual), D(0)))) && dUtama.total.marginKas.equals(uang(dUtama.baris.reduce((s, b) => s.plus(b.ringkasan.marginKas), D(0)))), "total = Σ baris");
  const dP2 = await daftarKeuanganProyek(db, { status: "BERJALAN" }, p2.id);
  pastikan(sama(dP2.baris.map((b) => b.id), [proyek2.id]) && dP2.total.anggaran.equals(D(250000)) && dP2.baris[0].klien === "Klien Teks", "lingkup perusahaan dua: hanya proyeknya, anggaran 250.000, klien teks bebas");
  const dGab = await daftarKeuanganProyek(db, { status: "BERJALAN" }, null);
  pastikan(dGab.baris.some((b) => b.id === proyek.id) && dGab.baris.some((b) => b.id === proyek2.id) && dGab.total.anggaran.equals(dUtama.total.anggaran.plus(250000)), "gabungan memuat kedua perusahaan");
  pastikan((await daftarKeuanganProyek(db, { q: "modul selesai" }, null)).baris.length === 1, "saringan teks pada nama proyek");
  pastikan(dUtama.jumlahTotal === dUtama.baris.length && dUtama.jumlahTotal === (await db.proyek.count({ where: { status: "BERJALAN", perusahaanId: "utama" } })), `jumlahTotal = semua proyek tersaring bila di bawah batas (${dUtama.jumlahTotal})`);
  pastikan(dP2.jumlahTotal === 1 && dGab.jumlahTotal === dGab.baris.length, "jumlahTotal per lingkup dan gabungan");

  console.log("=== 11. Panel Keuangan Proyek per hak dan lingkup ===");
  pastikan((await PanelProyek({ pengguna: penggunaSintetis("KASIR"), perusahaanId: null })) === null, "KASIR (proyek.lihat tanpa anggaran-proyek.lihat): panel tidak dirender");
  pastikan((await PanelProyek({ pengguna: penggunaSintetis("SOSMED"), perusahaanId: null })) === null, "SOSMED: panel tidak dirender");
  const panelUtama = await render(PanelProyek({ pengguna: pemilik, perusahaanId: "utama" }));
  pastikan(panelUtama.teks.includes("UJM-PRJ-1") && !panelUtama.teks.includes("UJM-PRJ-2") && !panelUtama.teks.includes("UJM-PRJ-3"), "PEMILIK lingkup utama: proyek berjalan utama");
  pastikan(panelUtama.href.includes(`/rekonsiliasi/event/${proyek.id}`) && panelUtama.href.includes("/rekonsiliasi"), "tautan LPJ per proyek dan daftar LPJ");
  pastikan(panelUtama.href.includes(`/proyek/${proyek.id}/keuangan`) && ruteAda(`/proyek/${proyek.id}/keuangan`), "P46: nama proyek menaut ke /proyek/{id}/keuangan");
  const panelDua = await render(PanelProyek({ pengguna: pemilik, perusahaanId: p2.id }));
  pastikan(panelDua.teks.includes("UJM-PRJ-2") && !panelDua.teks.includes("UJM-PRJ-1") && panelDua.teks.includes("Rp 250.000"), "lingkup perusahaan dua: proyeknya saja dan anggaran 250.000");
  const adminTanpaLpj = penggunaSintetis("ADMIN", hitungHak("ADMIN").filter((h) => h !== "rekonsiliasi.lihat"));
  const panelAdmin = await render(PanelProyek({ pengguna: adminTanpaLpj, perusahaanId: "utama" }));
  pastikan(panelAdmin.teks.includes("UJM-PRJ-1") && !panelAdmin.href.some((h) => h.startsWith("/rekonsiliasi")), "tanpa rekonsiliasi.lihat: angka tampil tanpa tautan LPJ");
  pastikan(!panelUtama.teks.includes("proyek pertama") && !panelDua.teks.includes("proyek pertama"), "di bawah batas: tanpa keterangan total terpotong");
  // lebih dari 500 proyek berjalan dalam satu lingkup: daftar dan total terpotong, jumlahTotal tetap semua proyek
  await db.proyek.createMany({ data: Array.from({ length: BATAS_PROYEK_MUAT }, (_, i) => ({ kode: `${PREFIKS_PROYEK_MASSAL}${String(i).padStart(3, "0")}`, nama: `Proyek massal ${i}`, perusahaanId: p2.id })) });
  const dMassal = await daftarKeuanganProyek(db, { status: "BERJALAN" }, p2.id);
  pastikan(dMassal.baris.length === BATAS_PROYEK_MUAT && dMassal.jumlahTotal === BATAS_PROYEK_MUAT + 1, `lebih dari batas: ${dMassal.baris.length} baris dimuat, jumlahTotal ${dMassal.jumlahTotal}`);
  const panelMassal = await render(PanelProyek({ pengguna: pemilik, perusahaanId: p2.id }));
  pastikan(panelMassal.teks.includes("501 proyek.") && panelMassal.teks.includes("Total dihitung dari 500 proyek pertama."), "panel terpotong: jumlah semua proyek dan keterangan total dari 500 proyek pertama");
  await db.proyek.deleteMany({ where: { kode: { startsWith: PREFIKS_PROYEK_MASSAL } } });

  console.log("=== 12. Tab dan halaman beranda ===");
  pastikan(sama(tabBeranda({ hak: HAK_BAWAAN.KASIR }), ["keuangan"]), "KASIR bawaan tetap satu tab (tanpa baris tab)");
  pastikan(sama(tabBeranda({ hak: [...hitungHak("KASIR"), "anggaran-proyek.lihat"] }), ["keuangan", "proyek"]), "KASIR yang diberi anggaran-proyek.lihat mendapat tab Keuangan Proyek");
  pastikan(sama(tabBeranda({ hak: ["kampanye.lihat"] }), ["pemasaran"]) && sama(tabBeranda({ hak: ["proyek.lihat"] }), []), "pemasaran cukup salah satu hak pemasaran; proyek.lihat saja tidak membuka tab proyek");
  const muat = (peran: string, tab?: string) => denganEnv({ UJI_PERAN: peran, UJI_PERUSAHAAN: undefined }, () => Beranda({ searchParams: Promise.resolve(tab === undefined ? {} : { tab }) }));
  const halProyek = (await muat("PEMILIK", "proyek")) as ReactElement<Record<string, unknown>>;
  pastikan(halProyek.type === DasborModul && halProyek.props.tab === "proyek", "PEMILIK ?tab=proyek: DasborModul tab proyek");
  pastikan(((await muat("KASIR", "proyek")) as ReactElement).type !== DasborModul, "KASIR ?tab=proyek: tetap beranda keuangan");
  const halSosmedProyek = (await muat("SOSMED", "proyek")) as ReactElement<Record<string, unknown>>;
  pastikan(halSosmedProyek.type === DasborModul && halSosmedProyek.props.tab === "saya", "SOSMED ?tab=proyek: jatuh ke tab bawaan Tugas Saya");
  const halDesainer = (await muat("DESAINER", "pemasaran")) as ReactElement<Record<string, unknown>>;
  pastikan(halDesainer.type === DasborModul && halDesainer.props.tab === "pemasaran", "DESAINER ?tab=pemasaran: tab Pemasaran");
  const semuaHref: string[] = [];
  for (const [peran, perusahaan] of [["PEMILIK", "semua"], ["PEMILIK", p1.id], ["ADMIN", undefined], ["IKLAN", undefined]] as const) {
    await denganEnv({ UJI_PERAN: peran, UJI_PERUSAHAAN: perusahaan }, async () => {
      const pengguna = penggunaSintetis(peran);
      const daftarTab = tabBeranda(pengguna);
      for (const tab of daftarTab.filter((t) => t === "pemasaran" || t === "proyek")) {
        const hasil = await render(DasborModul({ tab, daftarTab, pengguna }));
        semuaHref.push(...hasil.href);
        pastikan(hasil.teks.includes("Halo, Skrip"), `${peran}/${perusahaan === p1.id ? "UJM1" : (perusahaan ?? "bawaan")} tab ${tab}: dasbor dirender`);
      }
    });
  }
  const pemasaranP1 = await denganEnv({ UJI_PERUSAHAAN: p1.id }, () => render(DasborModul({ tab: "pemasaran", daftarTab: tabBeranda(pemilik), pengguna: pemilik })));
  pastikan(pemasaranP1.teks.includes("PT Uji Modul Satu") && pemasaranP1.teks.includes("UJM Tiga hari") && !pemasaranP1.teks.includes("UJM Perusahaan dua"), "DasborModul lingkup UJM1: angka dan daftar mengikuti lingkup");
  const tidakAda = [...new Set(semuaHref)].filter((h) => !ruteAda(h));
  pastikan(semuaHref.length > 0 && tidakAda.length === 0, `semua tautan tab pemasaran dan proyek menuju rute yang ada${tidakAda.length ? `; tidak ada: ${tidakAda.join(", ")}` : ""}`);

  console.log("=== 13. Faktur draf memakai sisa DP tidak mengubah ringkasan ===");
  await jalankan("UM kedua 100.000", () => buatUangMuka(formulir({ pesananId: psj.id, akunId: kas.id, jumlah: 100000 })));
  const sebelumDraf = (await ringkasanKeuanganProyek(db, proyek.id))!.ringkasan;
  const pengaturanUtama = await db.pengaturanPerusahaan.findFirst({ where: { perusahaanId: "utama" }, select: { pkp: true, tarifPpnPersen: true } });
  const faktorDp = pengaturanUtama?.pkp ? D(100).div(D(100).plus(D(pengaturanUtama.tarifPpnPersen))) : D(1);
  const harapSelisihDp = uang(D(100000).mul(faktorDp));
  pastikan(sebelumDraf.diterima.minus(r.diterima).equals(harapSelisihDp) && sebelumDraf.ditagih.equals(r.ditagih), `DP kedua yang belum dipakai dihitung lewat suku uang muka (selisih diterima ${sebelumDraf.diterima.minus(r.diterima)}, harap ${harapSelisihDp})`);
  aturPersetujuan(true);
  try {
    await jalankan("FJ draf 1.000.000 pakai sisa DP 100.000", () => buatFaktur(formulir({ pesananId: psj.id, uangMuka: 100000, baris: [{ barangId: jasa.id, jumlah: 1, harga: 1000000 }] })));
  } finally {
    aturPersetujuan(false);
  }
  const fjDraf = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj.id, id: { not: fj.id } } });
  const umKedua = await db.uangMukaPelanggan.findFirstOrThrow({ where: { pesananId: psj.id, jumlah: 100000 } });
  pastikan(fjDraf.statusPersetujuan === "DRAFT" && D(fjDraf.uangMuka).equals(D(100000)) && D(umKedua.jumlahDipakai).equals(D(100000)), "faktur draf lahir DRAFT dan memakai DP kedua 100.000");
  const sesudahDraf = (await ringkasanKeuanganProyek(db, proyek.id))!.ringkasan;
  pastikan(sesudahDraf.ditagih.equals(sebelumDraf.ditagih) && sesudahDraf.ditagih.equals(r.ditagih), `faktur draf tidak menambah ditagih (${sesudahDraf.ditagih})`);
  pastikan(sesudahDraf.diterima.equals(sebelumDraf.diterima), `DP yang dipakai faktur draf tetap dihitung lewat suku uang muka, diterima tidak berubah (${sesudahDraf.diterima})`);

  console.log("=== Bersih-bersih ===");
  const nomorDok = [...new Set([...(await bersihkanDokumenProyekUji()), pnw.nomor, psj.nomor, fj.nomor, fjDraf.nomor, umKedua.nomor])];
  const sisaJurnal = await db.jurnal.count({ where: { baris: { some: { akunId: { in: [kas.id, bebanA.id, bebanB.id] } } } } });
  pastikan(sisaJurnal === 0, "jurnal uji keuangan proyek sudah terhapus");
  const logUji = await db.logAktivitas.findMany({ where: { nomor: { in: nomorDok } }, select: { id: true } });
  await db.logAktivitas.deleteMany({ where: { id: { in: logUji.map((l) => l.id).filter((id) => !idLogAwal.has(id)) } } });
  await bersihkanDataProyekLangsung();
  await bersihkanDataUji();
  pastikan((await db.konten.count({ where: { judul: { startsWith: "UJM " } } })) === 0 && (await db.kampanye.count({ where: { nama: { startsWith: "UJM " } } })) === 0 && (await db.proyek.count({ where: { kode: { startsWith: "UJM-" } } })) === 0, "data uji pemasaran dan proyek sudah bersih");
  const sisaLog = await db.logAktivitas.findMany({ where: { nomor: { in: nomorDok } }, select: { id: true } });
  pastikan(sisaLog.every((l) => idLogAwal.has(l.id)), "log aktivitas yang dibuat uji ini sudah dihapus, log lain tidak tersentuh");
  pastikan((await potretAkuntansi()) === akuntansiAwal, "jumlah jurnal, baris jurnal, akun, dan stok kembali ke angka awal");
  pastikan(JSON.stringify(await periksaSinkron(db)) === sinkronAwal, "periksaSinkron setelah bersih identik dengan sebelum data uji");
  console.log("=== DONE, all beranda modul checks passed ===");
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("TEST FAILED", err);
    aturPersetujuan(false);
    await bersihkanDokumenProyekUji().catch(() => undefined);
    await bersihkanDataProyekLangsung().catch(() => undefined);
    await bersihkanDataUji().catch(() => undefined);
    process.exit(1);
  });
