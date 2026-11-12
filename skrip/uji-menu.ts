import "dotenv/config";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DAFTAR_PERAN, hitungHak, hitungHakPengguna, punyaHak, type Hak, type PenggunaSesi } from "../src/lib/hakAkses";
import { aktifDi, DOKUMEN_PERSETUJUAN, GRUP_DATA_INDUK, GRUP_OPERASIONAL, GRUP_PERSEDIAAN, menuTerlihat, semuaHrefMenu, TAUTAN_ATAS, TAUTAN_PENGATURAN, type MenuTerlihat } from "../src/lib/menu";
import type { PeranPengguna } from "../src/prisma-klien/enums";
import { pastikan } from "./bantuan";

/*
 * Menu bilah samping (src/lib/menu.ts, DESAIN.md G19). Tanpa basis data.
 * 1. Menu tiap peran sama dengan salinan beku menu HEAD 84c3670 (BilahSamping.tsx sebelum dipindah) yang disaring
 *    hak bawaan, ditambah entri yang dipasang paket sesudahnya (TAMBAHAN_PER_PAKET).
 * 2. Setiap href di seluruh data menu punya page.tsx atau route.ts di src/app (tidak ada tautan mati).
 * 3. aktifDi untuk semua href lama sama dengan fungsi lama pada sampel path.
 * 4. Grup tanpa tautan terlihat dibuang, dan data menu tidak lagi ditulis di BilahSamping.tsx.
 *
 * Paket yang memasang menu baru menambah entrinya di src/lib/menu.ts DAN di TAMBAHAN_PER_PAKET di bawah.
 * Salinan beku (BEKU_*) tidak pernah diubah.
 */

// ---------------------------------------------------------------------------------------------------------------
// Salinan beku menu HEAD 84c3670 (src/komponen/BilahSamping.tsx baris 15-152), hanya nama konstanta yang diganti.
// ---------------------------------------------------------------------------------------------------------------
const BEKU_DOKUMEN_PERSETUJUAN = ["faktur", "faktur-pembelian", "kas-masuk", "kas-keluar", "penyesuaian", "peminjaman", "kerusakan", "aset", "penggajian"] as const;

type TautanBeku = { href: string; label: string; kode?: string; hak: Hak };
type GrupBeku = { judul: string; ikon: string; tautan: TautanBeku[] };

const BEKU_OPERASIONAL: GrupBeku[] = [
  {
    judul: "Penjualan",
    ikon: "point_of_sale",
    tautan: [
      { href: "/penjualan/penawaran", label: "Penawaran", kode: "PNW", hak: "penawaran.lihat" },
      { href: "/penjualan/pesanan", label: "Pesanan", kode: "PSJ", hak: "pesanan.lihat" },
      { href: "/penjualan/uang-muka", label: "Uang Muka", kode: "UM", hak: "uang-muka.lihat" },
      { href: "/penjualan/pengiriman", label: "Pengiriman", kode: "SJ", hak: "pengiriman.lihat" },
      { href: "/penjualan/faktur", label: "Faktur Penjualan", kode: "FJ", hak: "faktur.lihat" },
      { href: "/penjualan/penerimaan", label: "Penerimaan", kode: "TRM", hak: "penerimaan.lihat" },
      { href: "/penjualan/retur", label: "Retur Penjualan", kode: "RJ", hak: "retur-penjualan.lihat" },
    ],
  },
  {
    judul: "Pembelian",
    ikon: "shopping_bag",
    tautan: [
      { href: "/pembelian/pesanan", label: "Pesanan", kode: "PSB", hak: "pesanan-pembelian.lihat" },
      { href: "/pembelian/penerimaan-barang", label: "Penerimaan Barang", kode: "TB", hak: "penerimaan-barang.lihat" },
      { href: "/pembelian/faktur", label: "Faktur Pembelian", kode: "FB", hak: "faktur-pembelian.lihat" },
      { href: "/pembelian/pembayaran", label: "Pembayaran", kode: "BYR", hak: "pembayaran.lihat" },
      { href: "/pembelian/retur", label: "Retur Pembelian", kode: "RB", hak: "retur-pembelian.lihat" },
    ],
  },
  {
    judul: "Kas & Bank",
    ikon: "account_balance",
    tautan: [
      { href: "/kas-bank/masuk", label: "Kas Masuk", kode: "KM", hak: "kas-masuk.lihat" },
      { href: "/kas-bank/keluar", label: "Kas Keluar", kode: "KK", hak: "kas-keluar.lihat" },
      { href: "/kas-bank/prive", label: "Prive", kode: "PRV", hak: "prive.lihat" },
    ],
  },
  {
    judul: "Buku Besar",
    ikon: "menu_book",
    tautan: [
      { href: "/buku-besar/jurnal", label: "Jurnal Umum", kode: "JU", hak: "jurnal.lihat" },
      { href: "/buku-besar/mutasi", label: "Buku Besar Mutasi", hak: "buku-besar.lihat" },
      { href: "/buku-besar/tutup-buku", label: "Tutup Buku", kode: "TUTUP", hak: "buku-besar.lihat" },
    ],
  },
  {
    judul: "Laporan",
    ikon: "monitoring",
    tautan: [
      { href: "/buku-besar/neraca-saldo", label: "Neraca Saldo", hak: "buku-besar.lihat" },
      { href: "/laporan/piutang", label: "Laporan Piutang", hak: "buku-besar.lihat" },
      { href: "/laporan/hutang", label: "Laporan Hutang", hak: "buku-besar.lihat" },
      { href: "/buku-besar/neraca", label: "Neraca", hak: "buku-besar.lihat" },
      { href: "/buku-besar/laba-rugi", label: "Laba Rugi (per event / per waktu)", hak: "buku-besar.lihat" },
      { href: "/laporan/pendapatan", label: "Ringkasan Pendapatan", hak: "buku-besar.lihat" },
      { href: "/laporan/perubahan-modal", label: "Perubahan Modal", hak: "buku-besar.lihat" },
      { href: "/laporan/prive", label: "Laporan Prive", hak: "buku-besar.lihat" },
      { href: "/buku-besar/arus-kas", label: "Arus Kas", hak: "buku-besar.lihat" },
      { href: "/buku-besar/pajak", label: "Pajak & SPT", hak: "buku-besar.lihat" },
    ],
  },
  {
    judul: "Rekonsiliasi",
    ikon: "fact_check",
    tautan: [
      { href: "/rekonsiliasi", label: "Rekonsiliasi Event (LPJ)", kode: "LPJ", hak: "rekonsiliasi.lihat" },
      { href: "/rekonsiliasi/kas-bank", label: "Rekonsiliasi Kas/Bank", hak: "rekonsiliasi.lihat" },
      { href: "/rekonsiliasi/mutasi", label: "Impor Mutasi Rekening", kode: "CSV", hak: "rekonsiliasi.tulis" },
    ],
  },
  {
    judul: "Aset Tetap",
    ikon: "domain",
    tautan: [
      { href: "/aset-tetap", label: "Daftar Aset", hak: "aset.lihat" },
      { href: "/aset-tetap/penyusutan", label: "Hitung Penyusutan", kode: "PNY", hak: "penyusutan.lihat" },
    ],
  },
  {
    judul: "SDM",
    ikon: "group",
    tautan: [
      { href: "/data-induk/karyawan", label: "Karyawan", hak: "sdm.lihat" },
      { href: "/data-induk/departemen", label: "Departemen", hak: "sdm.lihat" },
      { href: "/sdm/penggajian", label: "Penggajian", kode: "GJ", hak: "penggajian.lihat" },
    ],
  },
];

const BEKU_PERSEDIAAN: GrupBeku = {
  judul: "Persediaan",
  ikon: "inventory_2",
  tautan: [
    { href: "/persediaan", label: "Stok per Gudang", hak: "persediaan.lihat" },
    { href: "/persediaan/penyesuaian", label: "Penyesuaian Stok", kode: "PS", hak: "penyesuaian.lihat" },
    { href: "/persediaan/pindah", label: "Pindah Barang", kode: "PB", hak: "pindah-barang.lihat" },
    { href: "/persediaan/peminjaman", label: "Peminjaman Barang", kode: "PJ", hak: "peminjaman.lihat" },
    { href: "/persediaan/kerusakan", label: "Laporan Kerusakan Barang", kode: "BR", hak: "kerusakan.lihat" },
  ],
};

const BEKU_DATA_INDUK: GrupBeku = {
  judul: "Data Induk",
  ikon: "dataset",
  tautan: [
    { href: "/data-induk/pelanggan", label: "Pelanggan", hak: "data-induk.lihat" },
    { href: "/data-induk/pemasok", label: "Pemasok", hak: "data-induk.lihat" },
    { href: "/data-induk/barang", label: "Barang & Jasa", hak: "stok-induk.lihat" },
    { href: "/data-induk/kelompok-barang", label: "Kategori Barang", hak: "stok-induk.lihat" },
    { href: "/data-induk/gudang", label: "Gudang", hak: "stok-induk.lihat" },
    { href: "/data-induk/akun", label: "Bagan Akun", hak: "data-induk.lihat" },
    { href: "/data-induk/proyek", label: "Proyek", hak: "data-induk.lihat" },
  ],
};

const BEKU_PENGATURAN: (TautanBeku & { ikon: string })[] = [
  { href: "/pengaturan/perusahaan", label: "Perusahaan & Pajak", ikon: "domain", hak: "pengaturan.tulis" },
  { href: "/pengaturan/pemetaan-akun", label: "Pemetaan Akun", ikon: "tune", hak: "pemetaan.tulis" },
  { href: "/pengaturan/mata-uang", label: "Mata Uang & Kurs", ikon: "payments", hak: "pengaturan.tulis" },
  { href: "/pengaturan/bagan-akun", label: "Bagan Akun Standar", ikon: "account_tree", hak: "pengaturan.tulis" },
  { href: "/pengaturan/pengguna", label: "Pengguna", ikon: "group", hak: "pengguna.kelola" },
  { href: "/pengaturan/hak-akses", label: "Hak Akses", ikon: "shield", hak: "hak-akses.kelola" },
  { href: "/pengaturan/log-aktivitas", label: "Log Aktivitas", ikon: "history", hak: "log-aktivitas.lihat" },
];

function bekuSaringGrup(daftar: GrupBeku[], pengguna: PenggunaSesi): GrupBeku[] {
  return daftar
    .map((g) => ({ ...g, tautan: g.tautan.filter((l) => punyaHak(pengguna, l.hak)) }))
    .filter((g) => g.tautan.length > 0);
}

function bekuAktifDi(pathname: string, href: string) {
  if (href === "/aset-tetap") return pathname === "/aset-tetap" || pathname === "/aset-tetap/baru" || /^\/aset-tetap\/[^/]+\/lepas$/.test(pathname);
  if (href === "/rekonsiliasi") return pathname === "/rekonsiliasi" || pathname.startsWith("/rekonsiliasi/event");
  return pathname === href || pathname.startsWith(href + "/");
}

const BEKU_PERAN_TANPA_BERANDA = new Set<PeranPengguna>(["GUDANG", "KRU", "GUEST"]);

// ---------------------------------------------------------------------------------------------------------------
// Entri menu yang dipasang paket sesudah P03. Urutan larik = urutan pemasangan. `setelah` menunjuk href (tautan)
// atau judul (grup) yang sudah ada di menu harapan pada saat entri itu dipasang.
// ---------------------------------------------------------------------------------------------------------------
type TautanAtasBaru = { href: string; label: string; ikon: string; hak: Hak };
type Tambahan =
  | { paket: string; letak: "atas"; setelah: string; tautan: TautanAtasBaru }
  | { paket: string; letak: "grup"; grup: string; setelah: string; tautan: TautanBeku & { ikon?: string } }
  | { paket: string; letak: "grup-baru"; bagian: "operasional" | "administrasi"; setelah: string; grup: GrupBeku }
  | { paket: string; letak: "pengaturan"; setelah: string; tautan: TautanBeku & { ikon: string } }
  | { paket: string; letak: "persetujuan"; kode: string };

const TAMBAHAN_PER_PAKET: Tambahan[] = [
  // P03 tidak menambah entri.
  { paket: "P07", letak: "atas", setelah: "/persetujuan", tautan: { href: "/berkas", label: "Berkas", ikon: "folder", hak: "berkas.lihat" } },
  { paket: "P07", letak: "pengaturan", setelah: "/pengaturan/log-aktivitas", tautan: { href: "/pengaturan/berkas", label: "Akses Berkas", ikon: "lock", hak: "berkas.akses-penuh" } },
  {
    paket: "P32",
    letak: "grup-baru",
    bagian: "operasional",
    setelah: "Penjualan",
    grup: {
      judul: "CRM",
      ikon: "handshake",
      tautan: [
        { href: "/crm/dasbor", label: "Dasbor CRM", hak: "lead.lihat" },
        { href: "/crm/lead", label: "Lead", hak: "lead.lihat" },
        { href: "/crm/pipeline", label: "Pipeline", hak: "lead.lihat" },
        { href: "/crm/tindak-lanjut", label: "Tindak Lanjut", hak: "lead.lihat" },
      ],
    },
  },
  { paket: "P32", letak: "pengaturan", setelah: "/pengaturan/log-aktivitas", tautan: { href: "/crm/pengaturan", label: "Pengaturan CRM", ikon: "handshake", hak: "pengaturan-crm.ubah" } },
  { paket: "P24", letak: "grup", grup: "Buku Besar", setelah: "/buku-besar/jurnal", tautan: { href: "/buku-besar/antar-perusahaan", label: "Transaksi Antar Perusahaan", kode: "AP", hak: "antar-perusahaan.lihat" } },
];

// ---------------------------------------------------------------------------------------------------------------
// Menu harapan = salinan beku + tambahan, lalu disaring dengan aturan lama.
// ---------------------------------------------------------------------------------------------------------------
type AtasHarapan = { href: string; label: string; ikon: string; boleh: (p: PenggunaSesi) => boolean };

function sisipkanSetelah<T>(daftar: T[], cocok: (x: T) => boolean, baru: T, keterangan: string) {
  const i = daftar.findIndex(cocok);
  if (i < 0) throw new Error(`TAMBAHAN_PER_PAKET: ${keterangan} tidak menemukan posisi "setelah"`);
  daftar.splice(i + 1, 0, baru);
}

function dataHarapan() {
  const kodePersetujuan: string[] = [...BEKU_DOKUMEN_PERSETUJUAN];
  const bolehPersetujuan = (p: PenggunaSesi) =>
    !BEKU_PERAN_TANPA_BERANDA.has(p.peran) && kodePersetujuan.some((k) => punyaHak(p, `${k}.buat` as Hak) || punyaHak(p, `${k}.setujui` as Hak));
  const atas: AtasHarapan[] = [
    { href: "/", label: "Beranda", ikon: "space_dashboard", boleh: (p) => !BEKU_PERAN_TANPA_BERANDA.has(p.peran) },
    { href: "/persetujuan", label: "Persetujuan", ikon: "verified", boleh: bolehPersetujuan },
  ];
  const salin = (g: GrupBeku): GrupBeku => ({ ...g, tautan: g.tautan.map((l) => ({ ...l })) });
  const operasional = BEKU_OPERASIONAL.map(salin);
  const administrasi = [BEKU_PERSEDIAAN, BEKU_DATA_INDUK].map(salin);
  const pengaturan = BEKU_PENGATURAN.map((l) => ({ ...l }));
  for (const t of TAMBAHAN_PER_PAKET) {
    const ket = `${t.paket} ${t.letak}`;
    if (t.letak === "atas") {
      const { hak, ...isi } = t.tautan;
      sisipkanSetelah(atas, (x) => x.href === t.setelah, { ...isi, boleh: (p) => punyaHak(p, hak) }, ket);
    } else if (t.letak === "grup") {
      const g = [...operasional, ...administrasi].find((x) => x.judul === t.grup);
      if (!g) throw new Error(`TAMBAHAN_PER_PAKET: ${ket} grup "${t.grup}" tidak ada`);
      sisipkanSetelah(g.tautan, (x) => x.href === t.setelah, { ...t.tautan }, ket);
    } else if (t.letak === "grup-baru") {
      sisipkanSetelah(t.bagian === "operasional" ? operasional : administrasi, (x) => x.judul === t.setelah, salin(t.grup), ket);
    } else if (t.letak === "pengaturan") {
      sisipkanSetelah(pengaturan, (x) => x.href === t.setelah, { ...t.tautan }, ket);
    } else {
      kodePersetujuan.push(t.kode);
    }
  }
  return { atas, operasional, administrasi, pengaturan, kodePersetujuan };
}

const HARAPAN = dataHarapan();

function menuHarapan(p: PenggunaSesi): MenuTerlihat {
  return {
    atas: HARAPAN.atas.filter((t) => t.boleh(p)),
    operasional: bekuSaringGrup(HARAPAN.operasional, p),
    administrasi: bekuSaringGrup(HARAPAN.administrasi, p),
    pengaturan: HARAPAN.pengaturan.filter((l) => punyaHak(p, l.hak)),
  };
}

/** Bentuk menu yang dirender (tanpa fungsi syarat), untuk dibandingkan. */
function bentuk(m: MenuTerlihat) {
  const tautan = (l: { href: string; label: string; kode?: string; hak?: string; ikon?: string }) => [l.href, l.label, l.kode ?? "", l.hak ?? "", l.ikon ?? ""].join("|");
  return {
    atas: m.atas.map((t) => [t.href, t.label, t.ikon].join("|")),
    operasional: m.operasional.map((g) => ({ judul: g.judul, ikon: g.ikon, tautan: g.tautan.map(tautan) })),
    administrasi: m.administrasi.map((g) => ({ judul: g.judul, ikon: g.ikon, tautan: g.tautan.map(tautan) })),
    pengaturan: m.pengaturan.map(tautan),
  };
}

function hrefTerlihat(m: MenuTerlihat): string[] {
  return [...m.atas.map((t) => t.href), ...[...m.operasional, ...m.administrasi].flatMap((g) => g.tautan.map((l) => l.href)), ...m.pengaturan.map((l) => l.href)];
}

function penggunaSintetis(peran: PeranPengguna, hak: readonly Hak[], peranTambahan: PeranPengguna[] = []): PenggunaSesi {
  return { id: `uji-menu-${peran}`, nama: `Uji ${peran}`, namaPengguna: `uji-menu-${peran.toLowerCase()}`, email: null, nomorTelepon: null, peran, peranTambahan, hak };
}

// ---------------------------------------------------------------------------------------------------------------
// Rute: href punya page.tsx (atau route.ts) di src/app. Grup rute "(x)" transparan, segmen dinamis "[x]" cocok
// dengan segmen apa pun, "[...x]" dan "[[...x]]" menelan sisa segmen.
// ---------------------------------------------------------------------------------------------------------------
const AKAR_APP = "src/app";

function adaHalaman(dir: string): boolean {
  return existsSync(join(dir, "page.tsx")) || existsSync(join(dir, "route.ts"));
}

function cocokRute(dir: string, segmen: string[]): boolean {
  const anak = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  if (segmen.length === 0 && adaHalaman(dir)) return true;
  for (const g of anak.filter((n) => /^\(.+\)$/.test(n))) if (cocokRute(join(dir, g), segmen)) return true;
  if (segmen.length === 0) return anak.some((n) => /^\[\[\.\.\..+\]\]$/.test(n) && adaHalaman(join(dir, n)));
  const [s, ...sisa] = segmen;
  if (anak.includes(s) && !/^[([@_]/.test(s) && cocokRute(join(dir, s), sisa)) return true;
  for (const n of anak) {
    if (/^\[[^.[\]][^\]]*\]$/.test(n) && cocokRute(join(dir, n), sisa)) return true;
    if (/^\[\[?\.\.\..+\]\]?$/.test(n) && adaHalaman(join(dir, n))) return true;
  }
  return false;
}

function ruteAda(href: string): boolean {
  const jalur = href.split("?")[0].split("#")[0];
  return cocokRute(AKAR_APP, jalur.split("/").filter(Boolean));
}

async function main() {
  console.log("=== 1. Struktur data menu ===");
  const semuaHref = semuaHrefMenu();
  const ganda = semuaHref.filter((h, i) => semuaHref.indexOf(h) !== i);
  pastikan(ganda.length === 0, `href menu unik (${semuaHref.length} tautan)${ganda.length ? `; ganda: ${ganda.join(", ")}` : ""}`);
  const jumlahData = TAUTAN_ATAS.length + [...GRUP_OPERASIONAL, GRUP_PERSEDIAAN, GRUP_DATA_INDUK].reduce((a, g) => a + g.tautan.length, 0) + TAUTAN_PENGATURAN.length;
  pastikan(jumlahData === semuaHref.length, "semuaHrefMenu memuat setiap tautan di data menu");
  pastikan(
    JSON.stringify([...DOKUMEN_PERSETUJUAN]) === JSON.stringify(HARAPAN.kodePersetujuan),
    `DOKUMEN_PERSETUJUAN sama dengan salinan beku ditambah paket (${DOKUMEN_PERSETUJUAN.join(", ")})`,
  );
  const sumberMenu = readFileSync("src/lib/menu.ts", "utf8");
  const semuaIkon = [...TAUTAN_ATAS.map((t) => t.ikon), ...[...GRUP_OPERASIONAL, GRUP_PERSEDIAAN, GRUP_DATA_INDUK].flatMap((g) => [g.ikon, ...g.tautan.flatMap((l) => (l.ikon ? [l.ikon] : []))]), ...TAUTAN_PENGATURAN.map((l) => l.ikon)];
  const ikonTakTertangkap = [...new Set(semuaIkon)].filter((i) => !sumberMenu.includes(`ikon: "${i}"`));
  pastikan(ikonTakTertangkap.length === 0, `setiap ikon menu ditulis literal ikon: "..." di menu.ts sehingga ikut subset font${ikonTakTertangkap.length ? `; tidak: ${ikonTakTertangkap.join(", ")}` : ""}`);
  const sumberBilah = readFileSync("src/komponen/BilahSamping.tsx", "utf8");
  pastikan(!/href: "/.test(sumberBilah) && !/DOKUMEN_PERSETUJUAN|PERAN_TANPA_BERANDA|saringGrup/.test(sumberBilah), "BilahSamping.tsx tidak lagi memuat data atau aturan penyaringan menu");
  pastikan(/menuTerlihat\(pengguna\)/.test(sumberBilah), "BilahSamping.tsx merender hasil menuTerlihat(pengguna)");
  pastikan(!/^import [^t].*from "@\/lib\/(db|otentikasi|perusahaan)"/m.test(sumberMenu), "menu.ts tidak mengimpor nilai dari db, otentikasi, atau perusahaan");

  console.log("=== 2. Menu tiap peran sama dengan salinan beku 84c3670 + tambahan paket ===");
  for (const peran of DAFTAR_PERAN) {
    const p = penggunaSintetis(peran, hitungHak(peran));
    const nyata = bentuk(menuTerlihat(p));
    const harap = bentuk(menuHarapan(p));
    pastikan(JSON.stringify(nyata) === JSON.stringify(harap), `${peran}: menu sama dengan harapan (${hrefTerlihat(menuTerlihat(p)).length} tautan)`);
  }
  // Pengguna berperan tambahan: hak gabungan menentukan tautan, peran utama menentukan Beranda/Persetujuan.
  for (const [peran, tambahan] of [["KASIR", ["SOSMED"]], ["GUDANG", ["DESAINER"]], ["ADMIN", ["IKLAN", "DESAINER"]], ["KRU", ["SOSMED", "IKLAN"]]] as [PeranPengguna, PeranPengguna[]][]) {
    const p = penggunaSintetis(peran, hitungHakPengguna(peran, tambahan), tambahan);
    pastikan(JSON.stringify(bentuk(menuTerlihat(p))) === JSON.stringify(bentuk(menuHarapan(p))), `${peran} + ${tambahan.join(" + ")}: menu sama dengan harapan`);
  }
  // Hak yang diubah lewat Pengaturan › Hak Akses ikut menentukan menu (penyesuaian tanpa basis data).
  const kasirTanpaPersetujuan = penggunaSintetis("KASIR", hitungHak("KASIR", DOKUMEN_PERSETUJUAN.flatMap((k) => [{ hak: `${k}.buat`, boleh: false }, { hak: `${k}.setujui`, boleh: false }])));
  const mKasir = menuTerlihat(kasirTanpaPersetujuan);
  pastikan(!mKasir.atas.some((t) => t.href === "/persetujuan") && mKasir.atas.some((t) => t.href === "/"), "KASIR tanpa hak buat/setujui dokumen persetujuan: Persetujuan hilang, Beranda tetap");
  pastikan(JSON.stringify(bentuk(mKasir)) === JSON.stringify(bentuk(menuHarapan(kasirTanpaPersetujuan))), "KASIR dengan hak disesuaikan: menu sama dengan harapan");
  const gudangDiberiFaktur = penggunaSintetis("GUDANG", hitungHak("GUDANG", [{ hak: "faktur.setujui", boleh: true }, { hak: "pengguna.kelola", boleh: true }]));
  const mGudang = menuTerlihat(gudangDiberiFaktur);
  pastikan(mGudang.atas.length === 0, "GUDANG tetap tanpa Beranda dan Persetujuan walaupun diberi faktur.setujui");
  pastikan(mGudang.pengaturan.some((l) => l.href === "/pengaturan/pengguna"), "GUDANG yang diberi pengguna.kelola melihat tautan Pengguna");

  console.log("=== 3. Hak akses per peran (contoh tetap) ===");
  const mPeran = (peran: PeranPengguna) => hrefTerlihat(menuTerlihat(penggunaSintetis(peran, hitungHak(peran))));
  for (const peran of ["SUPERADMIN", "PEMILIK"] as const) pastikan(mPeran(peran).length === semuaHref.length, `${peran} melihat semua ${semuaHref.length} tautan`);
  const admin = mPeran("ADMIN");
  pastikan(admin.includes("/persetujuan") && admin.includes("/pengaturan/log-aktivitas") && !admin.includes("/pengaturan/pengguna") && !admin.includes("/pengaturan/hak-akses") && !admin.includes("/sdm/penggajian"), "ADMIN: tanpa Pengguna, Hak Akses, dan Penggajian");
  const kasir = mPeran("KASIR");
  pastikan(kasir.includes("/") && kasir.includes("/persetujuan") && !kasir.some((h) => h.startsWith("/pengaturan/")), "KASIR: Beranda dan Persetujuan, tanpa tautan pengaturan");
  for (const peran of ["GUDANG", "KRU", "GUEST"] as const) {
    const h = mPeran(peran);
    pastikan(!h.includes("/") && !h.includes("/persetujuan"), `${peran}: tanpa Beranda dan Persetujuan`);
  }
  pastikan(mPeran("GUDANG").includes("/persediaan") && !mPeran("GUDANG").includes("/buku-besar/jurnal"), "GUDANG: Persediaan tampil, Jurnal Umum tidak");
  for (const peran of ["SOSMED", "IKLAN", "DESAINER"] as const) {
    const h = mPeran(peran);
    pastikan(h.includes("/") && !h.includes("/persetujuan") && !h.some((x) => x.startsWith("/buku-besar") || x.startsWith("/pengaturan/")), `${peran}: Beranda tampil, tanpa Persetujuan, Buku Besar, dan pengaturan`);
  }
  // P07 (D7 §7.8): Berkas untuk pemegang berkas.lihat, Akses Berkas hanya untuk berkas.akses-penuh
  for (const peran of ["ADMIN", "SOSMED", "IKLAN", "DESAINER"] as const) {
    const h = mPeran(peran);
    pastikan(h.includes("/berkas") && !h.includes("/pengaturan/berkas"), `${peran}: Berkas tampil, Akses Berkas tidak`);
  }
  for (const peran of ["KASIR", "GUDANG", "KRU", "GUEST"] as const) pastikan(!mPeran(peran).some((h) => h === "/berkas" || h === "/pengaturan/berkas"), `${peran}: tanpa Berkas dan Akses Berkas`);
  // P24 (D1 §7.3): Transaksi Antar Perusahaan di grup Buku Besar sesudah Jurnal Umum, hanya untuk antar-perusahaan.lihat
  for (const peran of ["SUPERADMIN", "PEMILIK", "ADMIN"] as const) {
    const h = mPeran(peran);
    pastikan(h.indexOf("/buku-besar/antar-perusahaan") === h.indexOf("/buku-besar/jurnal") + 1, `${peran}: Transaksi Antar Perusahaan tepat sesudah Jurnal Umum`);
  }
  for (const peran of ["KASIR", "GUDANG", "KRU", "GUEST", "SOSMED", "IKLAN", "DESAINER"] as const) pastikan(!mPeran(peran).includes("/buku-besar/antar-perusahaan"), `${peran}: tanpa Transaksi Antar Perusahaan`);
  // P32 (D4 §7.1, D7 §7.8, HAK.md §2.6): grup CRM sesudah Penjualan untuk lead.lihat, Pengaturan CRM hanya pengaturan-crm.ubah
  for (const peran of ["SUPERADMIN", "PEMILIK", "ADMIN"] as const) {
    const m = menuTerlihat(penggunaSintetis(peran, hitungHak(peran)));
    const judul = m.operasional.map((g) => g.judul);
    const crm = m.operasional.find((g) => g.judul === "CRM");
    pastikan(judul.indexOf("CRM") === judul.indexOf("Penjualan") + 1 && crm?.ikon === "handshake" && crm.tautan.map((l) => l.label).join(", ") === "Dasbor CRM, Lead, Pipeline, Tindak Lanjut", `${peran}: grup CRM (Dasbor CRM, Lead, Pipeline, Tindak Lanjut) tepat sesudah Penjualan`);
    const atur = m.pengaturan.map((l) => l.href);
    pastikan(peran === "ADMIN" ? !atur.includes("/crm/pengaturan") : atur.indexOf("/crm/pengaturan") === atur.indexOf("/pengaturan/log-aktivitas") + 1, `${peran}: ${peran === "ADMIN" ? "tanpa Pengaturan CRM" : "Pengaturan CRM tepat sesudah Log Aktivitas"}`);
  }
  for (const peran of ["KASIR", "GUDANG", "KRU", "GUEST", "SOSMED", "IKLAN", "DESAINER"] as const) {
    const m = menuTerlihat(penggunaSintetis(peran, hitungHak(peran)));
    pastikan(!m.operasional.some((g) => g.judul === "CRM") && !hrefTerlihat(m).some((h) => h.startsWith("/crm")), `${peran}: tanpa grup CRM dan Pengaturan CRM`);
  }
  for (const href of ["/crm/lead", "/crm/lead/baru", "/crm/lead/abc", "/crm/lead/abc/ubah", "/crm/lead/abc/konversi"]) {
    const nyala = ["/crm/dasbor", "/crm/lead", "/crm/pipeline", "/crm/tindak-lanjut", "/crm/pengaturan"].filter((h) => aktifDi(h, href));
    pastikan(nyala.join() === "/crm/lead", `${href} hanya menyalakan Lead`);
  }
  for (const peran of ["SUPERADMIN", "PEMILIK"] as const) {
    const m = menuTerlihat(penggunaSintetis(peran, hitungHak(peran)));
    const atas = m.atas.map((t) => t.href);
    const atur = m.pengaturan.map((l) => l.href);
    // Akses Berkas cukup sesudah Log Aktivitas (tidak harus tepat sesudahnya): HAK.md §2.6 menaruh Pengaturan CRM dan
    // Daftar Pilihan di antara keduanya, dan paket pemiliknya menyisip dengan setelah: "/pengaturan/log-aktivitas".
    pastikan(atas.indexOf("/berkas") === atas.indexOf("/persetujuan") + 1 && atur.indexOf("/pengaturan/log-aktivitas") >= 0 && atur.indexOf("/pengaturan/berkas") > atur.indexOf("/pengaturan/log-aktivitas"), `${peran}: Berkas sesudah Persetujuan, Akses Berkas sesudah Log Aktivitas`);
  }

  console.log("=== 4. Grup tanpa tautan terlihat dibuang ===");
  const kosong = menuTerlihat(penggunaSintetis("KASIR", []));
  pastikan(kosong.operasional.length === 0 && kosong.administrasi.length === 0 && kosong.pengaturan.length === 0, "pengguna tanpa hak: tidak ada grup dan tautan pengaturan");
  pastikan(kosong.atas.map((t) => t.href).join(",") === "/", "pengguna KASIR tanpa hak: hanya Beranda");
  const satu = menuTerlihat(penggunaSintetis("KRU", ["prive.lihat"]));
  pastikan(satu.atas.length === 0 && satu.administrasi.length === 0 && satu.pengaturan.length === 0, "KRU dengan satu hak: tanpa tautan atas, grup administrasi, dan pengaturan");
  pastikan(satu.operasional.length === 1 && satu.operasional[0].judul === "Kas & Bank" && satu.operasional[0].tautan.map((l) => l.href).join(",") === "/kas-bank/prive", "KRU dengan prive.lihat saja: hanya grup Kas & Bank berisi Prive");
  const stok = menuTerlihat(penggunaSintetis("GUEST", ["stok-induk.lihat"]));
  pastikan(stok.operasional.length === 0 && stok.administrasi.length === 1 && stok.administrasi[0].judul === "Data Induk" && stok.administrasi[0].tautan.length === 3, "GUEST dengan stok-induk.lihat saja: hanya Data Induk (3 tautan), Persediaan tidak dirender");
  for (const peran of DAFTAR_PERAN) {
    const m = menuTerlihat(penggunaSintetis(peran, hitungHak(peran)));
    pastikan([...m.operasional, ...m.administrasi].every((g) => g.tautan.length > 0), `${peran}: tidak ada grup kosong`);
  }

  console.log("=== 5. Setiap href menu punya rute ===");
  pastikan(ruteAda("/") && ruteAda("/aset-tetap/abc123/lepas") && ruteAda("/data-induk/karyawan") && ruteAda("/api/foto/xyz"), "pemeriksa rute mengenali grup rute, segmen dinamis, dan route.ts");
  pastikan(!ruteAda("/tidak-ada-rute") && !ruteAda("/data-induk/karyawan/abc/xyz/lebih") && !ruteAda("/aset-tetap/abc123/tidak-ada"), "pemeriksa rute menolak rute yang tidak ada");
  const mati = semuaHref.filter((h) => !ruteAda(h));
  pastikan(mati.length === 0, `semua ${semuaHref.length} href menu menuju rute yang ada${mati.length ? `; tidak ada: ${mati.join(", ")}` : ""}`);
  const hrefTambahan = TAMBAHAN_PER_PAKET.flatMap((t) => (t.letak === "persetujuan" ? [] : t.letak === "grup-baru" ? t.grup.tautan.map((l) => l.href) : [t.tautan.href]));
  pastikan(hrefTambahan.every((h) => semuaHref.includes(h)), `setiap entri TAMBAHAN_PER_PAKET ada di data menu (${hrefTambahan.length})`);

  console.log("=== 6. aktifDi sama dengan fungsi lama ===");
  const hrefLama = [...BEKU_OPERASIONAL, BEKU_PERSEDIAAN, BEKU_DATA_INDUK].flatMap((g) => g.tautan.map((l) => l.href)).concat(BEKU_PENGATURAN.map((l) => l.href), ["/", "/persetujuan"]);
  const sampel = new Set<string>([
    "/", "/aset-tetap/baru", "/aset-tetap/abc123", "/aset-tetap/abc123/lepas", "/aset-tetap/abc123/lepas/lagi", "/aset-tetap/penyusutan", "/aset-tetapx",
    "/rekonsiliasi/event", "/rekonsiliasi/event/abc123", "/rekonsiliasi/eventx", "/rekonsiliasi/kas-bank", "/rekonsiliasi/mutasi", "/rekonsiliasix",
    "/proyek", "/proyek/abc123", "/proyek/keuangan", "/proyek/abc123/keuangan", "/berkas", "/crm/lead", "/pemasaran/konten", "/cari", "/profil", "/tanpa-akses",
  ]);
  for (const h of hrefLama) for (const akhir of ["", "/", "/baru", "/abc123", "/abc123/ubah", "/abc123/lepas", "x"]) sampel.add(h === "/" ? `/${akhir.replace(/^\//, "")}` : h + akhir);
  let beda = 0;
  let cacah = 0;
  for (const h of hrefLama) {
    for (const s of sampel) {
      cacah++;
      if (aktifDi(h, s) !== bekuAktifDi(s, h)) {
        beda++;
        if (beda <= 10) console.error(`  beda: aktifDi("${h}", "${s}")`);
      }
    }
  }
  pastikan(beda === 0, `aktifDi sama dengan fungsi lama untuk ${hrefLama.length} href lama x ${sampel.size} path (${cacah} pasang)`);
  pastikan(aktifDi("/persediaan", "/persediaan/penyesuaian") && aktifDi("/persediaan/penyesuaian", "/persediaan/penyesuaian/baru"), "aktifDi lama tetap: awalan menyala (Stok per Gudang ikut menyala di bawah /persediaan)");
  pastikan(!aktifDi("/rekonsiliasi", "/rekonsiliasi/kas-bank") && !aktifDi("/aset-tetap", "/aset-tetap/penyusutan"), "pengecualian lama /rekonsiliasi dan /aset-tetap tetap");

  console.log("=== DONE, all menu checks passed ===");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("TEST FAILED", err);
    process.exit(1);
  });
