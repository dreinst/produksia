import "dotenv/config";
// Skrip ini memanggil halaman dan pustaka di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { existsSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { db } from "../src/lib/db";
import { HAK_BAWAAN, hitungHak, type Hak, type PenggunaSesi } from "../src/lib/hakAkses";
import { TAB_BERANDA, pilihTab, tabBeranda, type TabBeranda as KodeTab } from "../src/lib/beranda";
import { bulanTerakhir, ringkasRupiah, statistikCrm, tindakLanjutSaya, tindakLanjutTerlambat } from "../src/lib/crm";
import { bacaWaktuLokal, nilaiWaktuLokal } from "../src/lib/waktu";
import { muatDataBerandaKeuangan } from "../src/lib/berandaKeuangan";
import { ambilPengaturanPerusahaan } from "../src/lib/pengaturanPerusahaan";
import { D } from "../src/lib/uang";
import Beranda from "../src/app/(aplikasi)/page";
import TabBeranda from "../src/komponen/beranda/TabBeranda";
import DasborModul from "../src/komponen/beranda/DasborModul";
import BerandaKosong from "../src/komponen/beranda/BerandaKosong";
import PanelCrmBeranda from "../src/komponen/beranda/PanelCrmBeranda";
import PanelSistem, { muatRingkasanSistem } from "../src/komponen/beranda/PanelSistem";
import PanelSaya, { menungguPersetujuanSaya } from "../src/komponen/beranda/PanelSaya";
import PanelPenjualanDokumen, { muatPenjualanDokumen } from "../src/komponen/beranda/PanelPenjualanDokumen";
import AngkaBergerak from "../src/komponen/ui/AngkaBergerak";
import type { PeranPengguna } from "../src/prisma-klien/client";
import { pastikan, sebagai } from "./bantuan";

/*
 * Uji beranda per tab (paket DF3): pilihan tab menurut hak, jalur keuangan tanpa baris tab bagi Kasir,
 * fungsi baca CRM (statistikCrm D4 §3.12, tindakLanjutSaya), data panel Tugas Saya, Penjualan, dan Sistem
 * menurut lingkup perusahaan, penolakan panel tanpa hak, dan tautan panel hanya ke rute yang sudah ada.
 * Data uji memakai perusahaan UJB1/UJB2 dan pengguna ujiberanda-*; semuanya dibersihkan di akhir.
 */

const PREFIKS = "ujiberanda-";

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

function penggunaSintetis(peran: PeranPengguna, hak: readonly Hak[] = hitungHak(peran)): PenggunaSesi {
  return { id: "skrip-uji", nama: "Skrip Uji", namaPengguna: "skrip-uji", email: null, nomorTelepon: null, peran, hak };
}

const sama = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Cari elemen bertipe tertentu di pohon tanpa menjalankan komponen (melihat apa yang dirender halaman langsung). */
function cariDangkal(node: ReactNode, tipe: unknown): ReactElement<Record<string, unknown>>[] {
  const hasil: ReactElement<Record<string, unknown>>[] = [];
  const jalan = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(jalan);
    if (!isValidElement(n)) return;
    const el = n as ReactElement<Record<string, unknown>>;
    if (el.type === tipe) hasil.push(el);
    jalan(el.props.children as ReactNode);
  };
  jalan(node);
  return hasil;
}

/**
 * Menjalankan komponen server (termasuk async) secara rekursif untuk mengumpulkan teks dan href.
 * Komponen klien (Link, AngkaBergerak) tidak dijalankan: href Link dicatat, nilai AngkaBergerak dicatat sebagai teks.
 */
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

/** Tautan internal harus menuju halaman yang ada di src/app/(aplikasi). */
function ruteAda(href: string): boolean {
  const jalur = href.split("?")[0].split("#")[0];
  if (jalur === "/" || jalur === "") return existsSync("src/app/(aplikasi)/page.tsx");
  return existsSync(`src/app/(aplikasi)${jalur}/page.tsx`);
}

/** Hapus data uji (juga sisa percobaan yang terputus). Urutan aman FK: dokumen, tindak lanjut, lead, perusahaan (tahap Cascade), pengguna. */
async function bersihkanDataUji() {
  const ids = (await db.perusahaan.findMany({ where: { kode: { in: ["UJB1", "UJB2"] } }, select: { id: true } })).map((p) => p.id);
  await db.dokumenKas.deleteMany({ where: { nomor: { startsWith: "UJB-KK-" } } });
  await db.tindakLanjut.deleteMany({ where: { perusahaanId: { in: ids } } });
  await db.lead.deleteMany({ where: { perusahaanId: { in: ids } } });
  await db.perusahaan.deleteMany({ where: { id: { in: ids } } });
  await db.pengguna.deleteMany({ where: { namaPengguna: { startsWith: PREFIKS } } });
  await db.logAktivitas.deleteMany({ where: { nomor: { startsWith: "UJB-" } } });
}

async function main() {
  const mulaiUji = new Date();
  await bersihkanDataUji();

  console.log("=== 1. Tab beranda menurut hak ===");
  pastikan(sama(TAB_BERANDA.map((t) => t.kode), ["keuangan", "saya", "penjualan", "pemasaran", "proyek", "sistem"]), "urutan tab lengkap: keuangan, saya, penjualan, pemasaran, proyek, sistem");
  pastikan(TAB_BERANDA.filter((t) => !t.tersedia).map((t) => t.kode).join() === "pemasaran,proyek", "tab pemasaran dan proyek belum aktif (panelnya paket berikutnya)");
  const harap: Record<PeranPengguna, KodeTab[]> = {
    SUPERADMIN: ["keuangan", "saya", "penjualan", "sistem"],
    PEMILIK: ["keuangan", "saya", "penjualan", "sistem"],
    ADMIN: ["keuangan", "saya", "penjualan"],
    KASIR: ["keuangan"],
    GUDANG: [],
    KRU: [],
    GUEST: [],
    SOSMED: ["saya"],
    IKLAN: [],
    DESAINER: ["saya"],
  };
  for (const peran of Object.keys(harap) as PeranPengguna[]) {
    pastikan(sama(tabBeranda({ hak: HAK_BAWAAN[peran] }), harap[peran]), `${peran}: tab ${JSON.stringify(harap[peran])}`);
  }
  pastikan(sama(tabBeranda({ hak: [...hitungHak("KASIR"), "lead.lihat"] }), ["keuangan", "penjualan"]), "KASIR yang diberi lead.lihat mendapat tab Penjualan & CRM (hak, bukan nama peran)");
  pastikan(sama(tabBeranda({ hak: hitungHak("ADMIN").filter((h) => h !== "beranda-keuangan.lihat") }), ["saya", "penjualan"]), "ADMIN yang dicabut beranda-keuangan.lihat kehilangan tab keuangan");
  pastikan(sama(tabBeranda({ hak: ["pengguna.kelola"] }), []), "sistem butuh pengguna.kelola DAN log-aktivitas.lihat (hanya satu: tidak tampil)");
  pastikan(sama(tabBeranda({ hak: ["pengguna.kelola", "log-aktivitas.lihat"] }), ["sistem"]), "keduanya: tab sistem");
  pastikan(sama(tabBeranda({ hak: [] }), []), "tanpa hak: tidak ada tab");
  const tabAdmin = tabBeranda({ hak: HAK_BAWAAN.ADMIN });
  pastikan(pilihTab(tabAdmin, "penjualan") === "penjualan", "pilihTab: tab yang boleh dipakai");
  pastikan(pilihTab(tabAdmin, "sistem") === "keuangan", "pilihTab: tab yang tidak boleh jatuh ke bawaan");
  pastikan(pilihTab(tabAdmin, "ngawur") === "keuangan", "pilihTab: ?tab tidak dikenal jatuh ke bawaan");
  pastikan(pilihTab(tabAdmin, "pemasaran") === "keuangan", "pilihTab: tab yang belum aktif jatuh ke bawaan");
  pastikan(pilihTab(tabAdmin, undefined) === "keuangan", "pilihTab: tanpa ?tab = tab pertama");
  pastikan(pilihTab(tabAdmin, ["saya", "penjualan"]) === "saya", "pilihTab: ?tab ganda memakai nilai pertama");
  pastikan(pilihTab(["saya"], "keuangan") === "saya", "pilihTab: SOSMED meminta keuangan mendapat Tugas Saya");
  pastikan(pilihTab([], "keuangan") === null, "pilihTab: daftar kosong = null");

  console.log("=== 2. Halaman beranda: jalur keuangan dan pengalihan tab ===");
  const muat = (peran: string, tab?: string) =>
    denganEnv({ UJI_PERAN: peran, UJI_PERUSAHAAN: undefined }, () => Beranda({ searchParams: Promise.resolve(tab === undefined ? {} : { tab }) }));
  const halKasir = await muat("KASIR");
  pastikan(cariDangkal(halKasir, TabBeranda).length === 0, "KASIR: beranda keuangan tanpa baris tab");
  const teksKasir = JSON.stringify(cariDangkal(halKasir, "h1").map((e) => e.props.children));
  pastikan(teksKasir.includes("Ringkasan Keuangan"), "KASIR: judul beranda keuangan lama tetap");
  pastikan(cariDangkal(await muat("KASIR", "penjualan"), TabBeranda).length === 0 && cariDangkal(await muat("KASIR", "penjualan"), "h1").length > 0, "KASIR ?tab=penjualan: tetap beranda keuangan");
  const halPemilik = await muat("PEMILIK");
  const barisTab = cariDangkal(halPemilik, TabBeranda);
  pastikan(barisTab.length === 1 && sama(barisTab[0].props.daftar as KodeTab[], harap.PEMILIK) && barisTab[0].props.aktif === "keuangan", "PEMILIK: baris tab empat tab dengan Keuangan aktif");
  pastikan(sama((halPemilik as ReactElement<{ children: ReactNode[] }>).props.children.slice(0, 1).map((c) => isValidElement(c) && c.type === TabBeranda), [true]), "PEMILIK: baris tab adalah anak pertama beranda keuangan");
  const halSuper = await muat("SUPERADMIN");
  pastikan(cariDangkal(halSuper, TabBeranda).length === 1, "SUPERADMIN: baris tab tampil");
  const halSistem = (await muat("PEMILIK", "sistem")) as ReactElement<Record<string, unknown>>;
  pastikan(halSistem.type === DasborModul && halSistem.props.tab === "sistem", "PEMILIK ?tab=sistem: DasborModul tab sistem (jalur keuangan tidak dijalankan)");
  pastikan(((await muat("PEMILIK", "pemasaran")) as ReactElement).type !== DasborModul, "PEMILIK ?tab=pemasaran (belum aktif): kembali ke keuangan");
  pastikan(((await muat("ADMIN", "sistem")) as ReactElement).type !== DasborModul, "ADMIN ?tab=sistem (tanpa hak): kembali ke keuangan");
  const halSosmed = (await muat("SOSMED")) as ReactElement<Record<string, unknown>>;
  pastikan(halSosmed.type === DasborModul && halSosmed.props.tab === "saya" && sama(halSosmed.props.daftarTab as KodeTab[], ["saya"]), "SOSMED: Tugas Saya, bukan kartu saldo keuangan");
  pastikan(((await muat("IKLAN")) as ReactElement).type === BerandaKosong, "IKLAN: belum ada tab, beranda kosong");
  let dialihkan = "";
  try {
    await muat("GUDANG");
  } catch (e) {
    dialihkan = String((e as { digest?: string }).digest ?? "");
  }
  pastikan(dialihkan.startsWith("NEXT_REDIRECT") && dialihkan.includes("/data-induk/barang"), "GUDANG: tetap dialihkan ke /data-induk/barang");

  console.log("=== 3. Pembantu waktu dan ringkasan rupiah ===");
  pastikan(bacaWaktuLokal("2026-11-09T14:30")?.toISOString() === "2026-11-09T07:30:00.000Z", "bacaWaktuLokal: jam dinding WIB ke UTC");
  pastikan(bacaWaktuLokal("2026-02-30T10:00") === null && bacaWaktuLokal("09-11-2026") === null, "bacaWaktuLokal: tanggal tidak ada atau format salah = null");
  pastikan(nilaiWaktuLokal(new Date("2026-11-09T07:30:00Z")) === "2026-11-09T14:30", "nilaiWaktuLokal: UTC ke jam dinding WIB");
  pastikan(ringkasRupiah(1_500_000_000) === "Rp 1,5 M" && ringkasRupiah(12_345_678) === "Rp 12,3 jt" && ringkasRupiah(950_000) === "Rp 950.000", "ringkasRupiah: M, jt, dan rupiah penuh");
  const sekarang = new Date("2026-11-09T05:00:00Z"); // 9 Nov 2026 12.00 WIB
  pastikan(sama(bulanTerakhir(6, sekarang).map((b) => b.bulan), ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]), "bulanTerakhir 9 Nov 2026: Jun sampai Nov tanpa bulan hilang");
  pastikan(bulanTerakhir(6, sekarang)[0].label === "Jun 2026", "label bulan: Jun 2026");
  pastikan(sama(bulanTerakhir(6, new Date("2026-03-31T10:00:00Z")).map((b) => b.bulan), ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]), "bulanTerakhir 31 Mar 2026: Februari ada");
  pastikan(bulanTerakhir(1, new Date("2026-12-31T20:00:00Z"))[0].bulan === "2027-01", "bulanTerakhir memakai zona usaha (31 Des 20.00 UTC = Januari WIB)");

  console.log("=== Data uji CRM ===");
  const p1 = await db.perusahaan.create({ data: { kode: "UJB1", nama: "PT Uji Beranda Satu", urutan: 98 } });
  const p2 = await db.perusahaan.create({ data: { kode: "UJB2", nama: "PT Uji Beranda Dua", urutan: 99 } });
  const uA = await db.pengguna.create({ data: { namaPengguna: `${PREFIKS}a`, nama: "Uji Beranda Andi", peran: "ADMIN", kataSandiHash: "-" } });
  const uB = await db.pengguna.create({ data: { namaPengguna: `${PREFIKS}b`, nama: "Uji Beranda Budi", peran: "ADMIN", kataSandiHash: "-" } });
  const tahap = async (perusahaanId: string, nama: string, jenis: "BERJALAN" | "MENANG" | "KALAH", urutan: number) =>
    db.tahapLead.create({ data: { perusahaanId, nama, jenis, urutan } });
  const t1 = await tahap(p1.id, "Prospek", "BERJALAN", 1);
  const t2 = await tahap(p1.id, "Negosiasi", "BERJALAN", 2);
  const t3 = await tahap(p1.id, "Menang", "MENANG", 3);
  const t4 = await tahap(p1.id, "Kalah", "KALAH", 4);
  const s1 = await tahap(p2.id, "Prospek", "BERJALAN", 1);
  const s2 = await tahap(p2.id, "Menang", "MENANG", 2);
  const sebelumGabungan = await statistikCrm(db, sekarang, null);
  let nomorLead = 0;
  const lead = (perusahaanId: string, tahapId: string, nilai: string, sumber: string, picId: string | null, dibuat: string, lain: { ditutup?: string; arsip?: boolean } = {}) =>
    db.lead.create({
      data: {
        perusahaanId, tahapId, sumber, picId,
        nama: `Kontak Uji ${++nomorLead}`, namaUsaha: `Usaha Uji ${nomorLead}`, telepon: "-", whatsapp: "-",
        nilaiEstimasi: nilai, dibuatOlehNama: "Skrip Uji", dibuatPada: new Date(dibuat),
        ditutupPada: lain.ditutup ? new Date(lain.ditutup) : null,
        dihapusPada: lain.arsip ? new Date("2026-11-05T00:00:00Z") : null,
      },
    });
  const L1 = await lead(p1.id, t1.id, "1000000.50", "Instagram", uA.id, "2026-11-01T03:00:00Z");
  const L2 = await lead(p1.id, t2.id, "2500000", "Instagram", uB.id, "2026-10-31T22:00:00Z"); // 1 Nov 05.00 WIB
  await lead(p1.id, t3.id, "10000000", "Referensi", uA.id, "2026-08-15T03:00:00Z", { ditutup: "2026-10-31T18:00:00Z" }); // ditutup 1 Nov 01.00 WIB
  await lead(p1.id, t3.id, "5000000.25", "", null, "2026-05-20T03:00:00Z", { ditutup: "2026-09-10T03:00:00Z" });
  await lead(p1.id, t4.id, "3000000", "Referensi", uB.id, "2026-10-01T03:00:00Z", { ditutup: "2026-10-20T03:00:00Z" });
  const L6 = await lead(p1.id, t1.id, "99000000", "Instagram", uA.id, "2026-11-02T03:00:00Z", { arsip: true });
  await lead(p1.id, t2.id, "0", "Iklan", uA.id, "2026-06-01T00:00:00Z");
  await lead(p1.id, t1.id, "500000", "Iklan", null, "2026-05-31T18:00:00Z"); // 1 Jun 01.00 WIB: masuk jendela 6 bulan
  const M1 = await lead(p2.id, s1.id, "7000000", "Instagram", uB.id, "2026-11-03T03:00:00Z");
  await lead(p2.id, s2.id, "1000000", "Pameran", uB.id, "2026-07-03T03:00:00Z", { ditutup: "2026-11-04T03:00:00Z" });
  const jam = (h: number) => new Date(sekarang.getTime() + h * 3600_000);
  const tl = (perusahaanId: string, leadId: string | null, judul: string, ditugaskanKeId: string, jatuhTempo: Date, status: "MENUNGGU" | "SELESAI" = "MENUNGGU") =>
    db.tindakLanjut.create({ data: { perusahaanId, leadId, judul, ditugaskanKeId, jatuhTempo, status, dibuatOlehNama: "Skrip Uji" } });
  const TL1 = await tl(p1.id, L1.id, "Telepon ulang", uA.id, jam(-2));
  const TL2 = await tl(p1.id, null, "Siapkan proposal", uA.id, jam(20));
  const TL3 = await tl(p1.id, L2.id, "Kirim penawaran", uA.id, jam(72));
  await tl(p1.id, L1.id, "Sudah selesai", uA.id, jam(-24), "SELESAI");
  await tl(p1.id, L6.id, "Milik lead arsip", uA.id, jam(-1));
  const TL6 = await tl(p1.id, L2.id, "Kunjungan", uB.id, jam(-5));
  const TL7 = await tl(p2.id, M1.id, "Follow up perusahaan dua", uA.id, jam(-3));

  console.log("=== 4. statistikCrm satu perusahaan (rumus D4 §3.12) ===");
  const st = await statistikCrm(db, sekarang, p1.id);
  pastikan(st.totalLead === 7, `totalLead tanpa lead arsip = 7 (dapat ${st.totalLead})`);
  pastikan(st.leadBaru30Hari === 2, `leadBaru30Hari = 2 (dapat ${st.leadBaru30Hari})`);
  pastikan(st.nilaiPipeline.equals(D("4000000.50")), `nilaiPipeline Σ tahap BERJALAN = 4.000.000,50 (dapat ${st.nilaiPipeline})`);
  pastikan(st.menang === 2 && st.kalah === 1, "menang 2, kalah 1");
  pastikan(st.nilaiMenang.equals(D("15000000.25")), `nilaiMenang = 15.000.000,25 (dapat ${st.nilaiMenang})`);
  pastikan(st.tingkatKonversi.equals(D("28.6")), `tingkatKonversi 2×100÷7 dibulatkan = 28,6 (dapat ${st.tingkatKonversi})`);
  pastikan(st.tingkatClosing.equals(D("66.7")), `tingkatClosing 2×100÷3 dibulatkan = 66,7 (dapat ${st.tingkatClosing})`);
  pastikan(st.pendapatanLunas.isZero(), "pendapatanLunas perusahaan tanpa faktur = 0");
  pastikan(
    sama(st.kinerjaSales.map((k) => `${k.nama}:${k.lead}:${k.menang}:${k.nilaiMenang.toFixed(2)}`), ["Uji Beranda Andi:3:1:10000000.00", "Belum ada PIC:2:1:5000000.25", "Uji Beranda Budi:2:0:0.00"]),
    `kinerjaSales urut nilai menang: ${JSON.stringify(st.kinerjaSales.map((k) => k.nama))}`,
  );
  pastikan(
    sama(st.kinerjaSumber.map((k) => `${k.sumber}:${k.lead}:${k.menang}`), ["Iklan:2:0", "Instagram:2:0", "Referensi:2:1", "Tidak diketahui:1:1"]),
    `kinerjaSumber urut lead lalu nama, sumber kosong = Tidak diketahui: ${JSON.stringify(st.kinerjaSumber.map((k) => k.sumber))}`,
  );
  pastikan(sama(st.corong.map((c) => `${c.nama}:${c.jumlah}`), ["Prospek:2", "Negosiasi:2", "Menang:2", "Kalah:1"]), "corong per tahap urut, lead arsip tidak dihitung");
  pastikan(sama(st.bulanan.map((b) => `${b.bulan}:${b.dibuat}:${b.menang}`), ["2026-06:2:0", "2026-07:0:0", "2026-08:1:0", "2026-09:0:1", "2026-10:1:0", "2026-11:2:1"]), `bulanan menurut zona usaha: ${JSON.stringify(st.bulanan.map((b) => `${b.bulan}:${b.dibuat}:${b.menang}`))}`);
  pastikan(sama(st.tindakLanjutJatuhTempo.map((t) => t.id), [TL6.id, TL1.id, TL2.id]), "tindak lanjut jatuh tempo ≤ 24 jam: urut jatuh tempo, tanpa SELESAI, tanpa lead arsip, tanpa perusahaan lain");
  pastikan(st.tindakLanjutJatuhTempo[0].namaLead === L2.nama && st.tindakLanjutJatuhTempo[0].namaPenerima === uB.nama && st.tindakLanjutJatuhTempo[2].namaLead === null, "tindak lanjut jatuh tempo membawa nama lead dan penerima");

  console.log("=== 5. statistikCrm lingkup lain dan gabungan ===");
  const st2 = await statistikCrm(db, sekarang, p2.id);
  pastikan(st2.totalLead === 2 && st2.menang === 1 && st2.nilaiPipeline.equals(D(7000000)) && st2.tindakLanjutJatuhTempo.length === 1, "perusahaan dua hanya melihat datanya sendiri");
  const stUtama = await statistikCrm(db, sekarang, "utama");
  const lunasUtama = await db.fakturPenjualan.aggregate({ where: { status: "LUNAS", statusPersetujuan: "DISETUJUI", perusahaanId: "utama" }, _sum: { dpp: true } });
  pastikan(stUtama.pendapatanLunas.equals(D(lunasUtama._sum.dpp)), `pendapatanLunas utama = Σ dpp faktur LUNAS disetujui (${stUtama.pendapatanLunas})`);
  const stGab = await statistikCrm(db, sekarang, null);
  pastikan(stGab.totalLead - sebelumGabungan.totalLead === 9 && stGab.menang - sebelumGabungan.menang === 3, "gabungan = penjumlahan semua perusahaan (selisih 9 lead, 3 menang)");
  pastikan(stGab.nilaiPipeline.minus(sebelumGabungan.nilaiPipeline).equals(D("11000000.50")), "gabungan nilai pipeline bertambah 11.000.000,50");
  const lunasSemua = await db.fakturPenjualan.aggregate({ where: { status: "LUNAS", statusPersetujuan: "DISETUJUI" }, _sum: { dpp: true } });
  pastikan(stGab.pendapatanLunas.equals(D(lunasSemua._sum.dpp)), "pendapatanLunas gabungan = Σ dpp semua perusahaan");
  const corongUji = stGab.corong.filter((c) => c.perusahaanId === p1.id || c.perusahaanId === p2.id);
  pastikan(sama(corongUji.map((c) => `${c.namaPerusahaan}/${c.nama}:${c.jumlah}`), ["PT Uji Beranda Satu/Prospek:2", "PT Uji Beranda Satu/Negosiasi:2", "PT Uji Beranda Satu/Menang:2", "PT Uji Beranda Satu/Kalah:1", "PT Uji Beranda Dua/Prospek:1", "PT Uji Beranda Dua/Menang:1"]), "corong gabungan: satu blok per perusahaan");

  console.log("=== 6. tindakLanjutSaya ===");
  pastikan(sama((await tindakLanjutSaya(db, uA.id)).map((t) => t.id), [TL7.id, TL1.id, TL2.id, TL3.id]), "milik A semua perusahaan: urut jatuh tempo, tanpa SELESAI dan lead arsip");
  pastikan(sama((await tindakLanjutSaya(db, uA.id, 2)).map((t) => t.id), [TL7.id, TL1.id]), "batas jumlah dipatuhi");
  pastikan(sama((await tindakLanjutSaya(db, uA.id, 10, p1.id)).map((t) => t.id), [TL1.id, TL2.id, TL3.id]), "lingkup satu perusahaan menyaring perusahaan lain");
  pastikan(sama((await tindakLanjutSaya(db, uB.id)).map((t) => t.id), [TL6.id]), "milik B tidak bercampur milik A");
  pastikan((await tindakLanjutSaya(db, "skrip-uji")).length === 0, "pengguna tanpa tindak lanjut: kosong");
  pastikan(tindakLanjutTerlambat(TL1, sekarang) && !tindakLanjutTerlambat(TL2, sekarang), "terlambat = MENUNGGU dan jatuh tempo lewat");

  console.log("=== 7. Menunggu persetujuan Anda ===");
  const pemilik = penggunaSintetis("PEMILIK");
  const akunKas = await db.akun.findFirst({ where: { kasBank: true, kelompok: false }, select: { id: true } });
  const akunLawan = await db.akun.findFirst({ where: { jenis: "BEBAN", kelompok: false }, select: { id: true } });
  pastikan(akunKas && akunLawan, "seed punya akun kas dan akun beban");
  const awalGab = (await menungguPersetujuanSaya(pemilik, null)).find((b) => b.kode === "kas-keluar")?.jumlah ?? 0;
  const kas = (nomor: string, perusahaanId: string, diajukanOlehId: string | null, status: "MENUNGGU" | "DRAFT" = "MENUNGGU") =>
    db.dokumenKas.create({ data: { nomor, jenis: "KELUAR", akunKasId: akunKas.id, akunLawanId: akunLawan.id, jumlah: 1000, dibuatOleh: "Skrip Uji", perusahaanId, statusPersetujuan: status, diajukanOlehId } });
  await kas("UJB-KK-1", p1.id, uA.id);
  await kas("UJB-KK-2", p1.id, null);
  await kas("UJB-KK-3", p1.id, uB.id, "DRAFT");
  await kas("UJB-KK-4", p2.id, uB.id);
  const jumlahKk = (b: { kode: string; jumlah: number }[]) => b.find((x) => x.kode === "kas-keluar")?.jumlah ?? 0;
  pastikan(jumlahKk(await menungguPersetujuanSaya(pemilik, p1.id)) === 2, "PEMILIK lingkup satu: dua kas keluar MENUNGGU (draf tidak dihitung)");
  pastikan(jumlahKk(await menungguPersetujuanSaya(pemilik, null)) - awalGab === 3, "PEMILIK gabungan: tiga kas keluar MENUNGGU baru");
  const sebagaiA = await sebagai(`${PREFIKS}a`, async () => (await import("../src/lib/otentikasi")).penggunaSaatIni());
  pastikan(sebagaiA && sebagaiA.id === uA.id, "pengguna nyata A terbaca lewat UJI_PENGGUNA");
  pastikan(jumlahKk(await menungguPersetujuanSaya(sebagaiA, p1.id)) === 1, "pemisahan tugas: ajuan A sendiri tidak dihitung untuk A");
  pastikan((await menungguPersetujuanSaya(penggunaSintetis("KASIR"), p1.id)).length === 0, "KASIR tanpa hak setujui: tidak ada yang menunggu");

  console.log("=== 8. Data panel penjualan ===");
  const gabPemilik = await muatPenjualanDokumen(pemilik, null);
  const keu = await muatDataBerandaKeuangan(null);
  const sisaLama = keu.fakturJualBelumLunas.reduce((s, i) => s + Number(i.total) - Number(i.uangMuka) - i.penerimaan.reduce((t, r) => t + Number(r.jumlah) + Number(r.potonganPajak), 0) - i.retur.reduce((t, r) => t + Number(r.total), 0), 0);
  pastikan(gabPemilik.fakturBelumLunas !== null && gabPemilik.fakturBelumLunas.jumlah === keu.fakturJualBelumLunas.length, "faktur belum lunas = definisi beranda keuangan");
  pastikan(Number(gabPemilik.fakturBelumLunas.sisa) === sisaLama, `Σ sisa sama dengan KPI piutang beranda keuangan (${sisaLama})`);
  const daftarF = gabPemilik.fakturBelumLunas.daftar;
  pastikan(daftarF.length <= 6 && daftarF.every((f, i) => i === 0 || !f.jatuhTempo || (!!daftarF[i - 1].jatuhTempo && daftarF[i - 1].jatuhTempo!.getTime() <= f.jatuhTempo.getTime())), "maks 6 faktur, urut jatuh tempo, tanpa jatuh tempo paling akhir");
  const jumlahPenawaran = await db.penawaranPenjualan.count();
  pastikan(gabPemilik.penawaranPerStatus !== null && gabPemilik.penawaranPerStatus.reduce((s, x) => s + x.jumlah, 0) === jumlahPenawaran, "penawaran per status menjumlah ke semua penawaran");
  const tahunBuku = (await ambilPengaturanPerusahaan(db)).tahunBuku;
  const lunasTahun = await db.fakturPenjualan.aggregate({
    where: { status: "LUNAS", statusPersetujuan: "DISETUJUI", tanggal: { gte: bacaWaktuLokal(`${tahunBuku}-01-01T00:00`)!, lt: bacaWaktuLokal(`${tahunBuku + 1}-01-01T00:00`)! } },
    _sum: { dpp: true },
  });
  pastikan(gabPemilik.pendapatanLunas?.tahun === tahunBuku && gabPemilik.pendapatanLunas.nilai.equals(D(lunasTahun._sum.dpp)), "pendapatan lunas tahun buku = Σ dpp faktur LUNAS disetujui tahun itu");
  const p1Pemilik = await muatPenjualanDokumen(pemilik, p1.id);
  pastikan(p1Pemilik.fakturBelumLunas?.jumlah === 0 && p1Pemilik.penawaranPerStatus?.length === 0 && p1Pemilik.pendapatanLunas?.nilai.isZero(), "lingkup perusahaan tanpa dokumen: semua nol");
  const sosmed = await muatPenjualanDokumen(penggunaSintetis("SOSMED"), null);
  pastikan(sosmed.fakturBelumLunas === null && sosmed.penawaranPerStatus === null && sosmed.pendapatanLunas === null, "tanpa faktur.lihat dan penawaran.lihat: tidak ada data penjualan");
  const hanyaPenawaran = await muatPenjualanDokumen(penggunaSintetis("ADMIN", ["penawaran.lihat"]), null);
  pastikan(hanyaPenawaran.penawaranPerStatus !== null && hanyaPenawaran.fakturBelumLunas === null && hanyaPenawaran.pendapatanLunas === null, "hanya penawaran.lihat: angka faktur dan pendapatan tidak dimuat");

  console.log("=== 9. Data panel sistem ===");
  await db.logAktivitas.createMany({
    data: [
      { penggunaNama: "Skrip Uji", aksi: "MASUK", jenis: "Sesi", nomor: "UJB-MASUK", modul: "auth", perusahaanId: null },
      { penggunaNama: "Skrip Uji", aksi: "HAPUS", jenis: "Uji", nomor: "UJB-P2", perusahaanId: p2.id },
      { penggunaNama: "Skrip Uji", aksi: "UBAH", jenis: "Lead", nomor: "UJB-CRM", modul: "crm", perusahaanId: p1.id },
    ],
  });
  const sisGab = await muatRingkasanSistem(null);
  const sisP1 = await muatRingkasanSistem(p1.id);
  pastikan(sisGab.perusahaanAktif === (await db.perusahaan.count({ where: { aktif: true } })), "perusahaan aktif dihitung dari daftar perusahaan");
  pastikan(sisGab.pengguna === (await db.pengguna.count()) && sisGab.penggunaAktif === (await db.pengguna.count({ where: { aktif: true } })), "jumlah pengguna total dan aktif");
  pastikan(sisGab.masuk7Hari >= 1, "masuk 7 hari menghitung log MASUK modul auth");
  pastikan(sisGab.aktivitas7Hari - sisP1.aktivitas7Hari === 1, "lingkup satu perusahaan tidak menghitung log perusahaan lain");
  pastikan(!sisGab.terbaru.some((l) => l.nomor === "UJB-CRM") && sisGab.terbaru.length <= 8, "daftar terbaru tanpa catatan modul (menunggu aturan visibilitas modul), maks 8");
  pastikan(!sisP1.terbaru.some((l) => l.nomor === "UJB-P2") && sisGab.terbaru.some((l) => l.nomor === "UJB-P2"), "log perusahaan dua hanya tampil di gabungan");

  console.log("=== 10. Panel tanpa hak dan tautan ===");
  pastikan((await PanelCrmBeranda({ pengguna: penggunaSintetis("KASIR"), perusahaanId: null })) === null, "PanelCrmBeranda tanpa lead.lihat: tidak dirender");
  pastikan((await PanelSistem({ pengguna: penggunaSintetis("ADMIN"), perusahaanId: null })) === null, "PanelSistem tanpa pengguna.kelola: tidak dirender");
  pastikan((await PanelSistem({ pengguna: penggunaSintetis("ADMIN", ["pengguna.kelola"]), perusahaanId: null })) === null, "PanelSistem tanpa log-aktivitas.lihat: tidak dirender");
  pastikan((await PanelPenjualanDokumen({ pengguna: penggunaSintetis("SOSMED"), perusahaanId: null })) === null, "PanelPenjualanDokumen tanpa hak dokumen: tidak dirender");
  const sayaSosmed = await render(PanelSaya({ pengguna: penggunaSintetis("SOSMED"), perusahaanId: null }));
  pastikan(!sayaSosmed.teks.includes("Tindak lanjut saya") && sayaSosmed.teks.includes("Tidak ada yang menunggu persetujuan Anda."), "SOSMED: tanpa lead.lihat tidak melihat kartu tindak lanjut");
  const semuaHref: string[] = [];
  for (const [peran, perusahaan] of [["PEMILIK", "semua"], ["PEMILIK", p1.id], ["ADMIN", undefined]] as const) {
    await denganEnv({ UJI_PERAN: peran, UJI_PERUSAHAAN: perusahaan }, async () => {
      const pengguna = penggunaSintetis(peran);
      const daftarTab = tabBeranda(pengguna);
      for (const tab of daftarTab.filter((t) => t !== "keuangan")) {
        const hasil = await render(DasborModul({ tab, daftarTab, pengguna }));
        semuaHref.push(...hasil.href);
        const lingkupTeks = perusahaan === "semua" ? "Semua perusahaan" : perusahaan ? p1.nama : "PT D'Pro";
        pastikan(hasil.teks.includes("Halo, Skrip") && (perusahaan === undefined || hasil.teks.includes(lingkupTeks)), `${peran}/${perusahaan ?? "bawaan"} tab ${tab}: kepala sapaan dan lingkup`);
        pastikan(hasil.href.filter((h) => h.startsWith("/?tab=")).length === daftarTab.length, `${peran} tab ${tab}: baris tab memuat ${daftarTab.length} tab`);
      }
    });
  }
  const penjualanP1 = await denganEnv({ UJI_PERUSAHAAN: p1.id }, async () => render(DasborModul({ tab: "penjualan", daftarTab: tabBeranda(pemilik), pengguna: pemilik })));
  pastikan(penjualanP1.teks.includes("Deal menang") && penjualanP1.teks.includes("Rp 4,0 jt") && penjualanP1.teks.includes("28,6%") && penjualanP1.teks.includes("Closing 66,7%"), "tab penjualan lingkup UJB1: KPI CRM dari statistikCrm");
  const tidakAda = [...new Set(semuaHref)].filter((h) => !ruteAda(h));
  pastikan(semuaHref.length > 0 && tidakAda.length === 0, `semua tautan panel menuju rute yang ada (${[...new Set(semuaHref)].join(", ")})${tidakAda.length ? `; tidak ada: ${tidakAda.join(", ")}` : ""}`);
  const satuTab = await render(DasborModul({ tab: "saya", daftarTab: ["saya"], pengguna: penggunaSintetis("SOSMED") }));
  pastikan(!satuTab.href.some((h) => h.startsWith("/?tab=")), "pengguna satu tab: baris tab tidak dirender");

  console.log("=== Bersih-bersih ===");
  await bersihkanDataUji();
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji } } });
  pastikan((await db.tahapLead.count({ where: { perusahaanId: { in: [p1.id, p2.id] } } })) === 0, "tahap uji ikut terhapus bersama perusahaan");
  const sesudah = await statistikCrm(db, sekarang, null);
  pastikan(sesudah.totalLead === sebelumGabungan.totalLead && (await db.perusahaan.count({ where: { kode: { in: ["UJB1", "UJB2"] } } })) === 0, "data uji CRM dan perusahaan uji sudah bersih");
  console.log("=== DONE, all beranda checks passed ===");
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("TEST FAILED", err);
    await bersihkanDataUji().catch(() => undefined);
    process.exit(1);
  });
