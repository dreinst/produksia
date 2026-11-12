import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { D, uang } from "../src/lib/uang";
import { punyaHak } from "../src/lib/hakAkses";
import { hitungRingkasanKeuangan, persen, ringkasanKeuanganProyek, type MasukanKeuangan } from "../src/lib/keuanganProyek";
import type { Prisma } from "../src/prisma-klien/client";
import { KATEGORI_BAWAAN, cariAtauBuatKategori, kunciNama, muatPetaKategori, pemetaanBawaanDilewati, penentuKategori, rapikanNama, terapkanKategoriAnggaranBawaan } from "../src/lib/kategoriAnggaran";
import { beriKunci, muatBarisSumber, sinkronDokumenDalamTransaksi, statusSinkronAnggaran, tandaSumber, type HasilSinkronAnggaran } from "../src/lib/sinkronAnggaran";
import { periksaKonsistensiPerusahaan } from "../src/lib/sinkron";
import { hapusBarisAnggaran, samakanAnggaranBiayaProyek, sinkronAnggaranDariDokumen, tambahBarisAnggaran, ubahBarisAnggaran } from "../src/lib/aksi/anggaranProyek";
import { hapusKategoriAnggaran, siapkanKategoriBawaan, simpanPemetaanKategori, tambahKategoriAnggaran, ubahKategoriAnggaran } from "../src/lib/aksi/kategoriAnggaran";
import { buatPenawaran, konversiPenawaranKePesanan } from "../src/lib/aksi/penjualan";
import { ubahPenawaran } from "../src/lib/aksi/dokumenPenjualan";
import { ubahDataInduk } from "../src/lib/aksi/dataInduk";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { terapkanBaganAkun } from "../src/lib/aksi/pengaturan";
import { formulir, harusDitolak, jalankan, pastikan, sebagai } from "./bantuan";

/*
 * Uji kategori dan anggaran proyek (P34, D5 §9.1): bagian A fungsi murni (A8 sampai A16; A1 sampai A7 bagi hasil
 * milik P35 bersama src/lib/bagiHasil.ts), bagian B alur basis data untuk kategori bawaan (B0), kategori dan
 * pemetaan (B4), baris anggaran (B5), sinkron dari penawaran dan pesanan (B8, B9), samakan anggaran biaya LPJ (B19),
 * dan konsistensi perusahaan sumber impor. Perbaikan tinjauan P34: sinkron serentak dengan hapus dan ubah dokumen
 * sumber (S1, memakai klien transaksi yang ditahan seperti skrip peninjau), pemetaan bawaan yang dikosongkan tidak
 * dibuat ulang (S2), ganti perusahaan proyek dengan baris anggaran dari dokumen yang pindah proyek (R1), dua sinkron
 * serentak yang menambah baris (R2), samakan tanpa baris anggaran (R3), dan aturan nama pemetaan bawaan (R4).
 * Data uji berawalan KPA (proyek, pelanggan, barang, akun, perusahaan,
 * kategori "KPA ..."). Kategori dan pemetaan yang tidak ada saat uji mulai dihapus lagi, nama kategori yang diganti
 * dipulihkan, dan penyesuaian HakAksesPeran sementara dipulihkan di finally.
 */

const AWALAN = "KPA";
const juta = (n: number) => D(n * 1_000_000);
const sama = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function bersihkanDokumen() {
  const pelanggan = { pelanggan: { kode: `${AWALAN}-CUST` } };
  for (const d of await db.pesananPenjualan.findMany({ where: pelanggan, select: { id: true, nomor: true } })) await jalankan(`hapus ${d.nomor}`, () => hapusDokumen("pesanan", d.id));
  for (const d of await db.penawaranPenjualan.findMany({ where: pelanggan, select: { id: true, nomor: true } })) await jalankan(`hapus ${d.nomor}`, () => hapusDokumen("penawaran", d.id));
}

async function bersihkanData() {
  await db.proyek.deleteMany({ where: { kode: { startsWith: `${AWALAN}-PRJ-` } } });
  await db.kategoriAnggaran.deleteMany({ where: { namaKunci: { startsWith: "kpa " } } });
  await db.barang.deleteMany({ where: { kode: { startsWith: `${AWALAN}-` } } });
  await db.pelanggan.deleteMany({ where: { kode: `${AWALAN}-CUST` } });
  await db.akun.deleteMany({ where: { kode: { startsWith: `${AWALAN}-` } } });
  await db.perusahaan.deleteMany({ where: { kode: `${AWALAN}X` } });
}

/** Menunggu sampai n sesi terhalang oleh pid penahan (langsung atau berantai). false bila tidak tercapai. */
async function tungguAntre(pid: number, n: number, percobaan = 400): Promise<boolean> {
  for (let t = 0; t < percobaan; t++) {
    const [{ antre }] = await db.$queryRaw<{ antre: number }[]>`
      WITH RECURSIVE r(pid) AS (
        SELECT a.pid FROM pg_stat_activity a WHERE ${pid}::int = ANY(pg_blocking_pids(a.pid))
        UNION SELECT a.pid FROM pg_stat_activity a JOIN r ON r.pid = ANY(pg_blocking_pids(a.pid))
      ) SELECT count(*)::int AS antre FROM r`;
    if (antre >= n) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

/** Galat revalidatePath atau redirect di luar HTTP terjadi sesudah transaksi selesai, jadi dianggap sukses. */
async function aksi(k: () => Promise<unknown>): Promise<string> {
  try {
    await k();
    return "ok";
  } catch (e) {
    const pesan = String((e as Error)?.message ?? e);
    const digest = String((e as { digest?: string })?.digest ?? "");
    return pesan.includes("static generation store missing") || digest.startsWith("NEXT_REDIRECT") ? "ok" : `${(e as { code?: string }).code ?? ""} ${pesan.split("\n").slice(-2).join(" ")}`.trim();
  }
}

/**
 * Proksi klien transaksi yang menahan panggilan `barisAnggaranProyek.{metode}` sampai `gerbang` dibuka (pola skrip
 * peninjau P34). Urutan pernyataan kode asli tidak berubah; `sampai` terpenuhi saat panggilan itu dicapai.
 */
function tahanDi(tx: Prisma.TransactionClient, metode: string, sampai: () => void, gerbang: Promise<void>): Prisma.TransactionClient {
  const asli = tx.barisAnggaranProyek;
  const ikat = (o: object, k: string | symbol) => {
    const v = (o as Record<string | symbol, unknown>)[k];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(o) : v;
  };
  const model = new Proxy(asli, {
    get(o, m) {
      if (m === metode)
        return async (...arg: unknown[]) => {
          sampai();
          await gerbang;
          return ((o as unknown as Record<string, (...a: unknown[]) => unknown>)[metode])(...arg);
        };
      return ikat(o, m);
    },
  });
  return new Proxy(tx, { get: (t, k) => (k === "barisAnggaranProyek" ? model : ikat(t, k)) }) as Prisma.TransactionClient;
}

/**
 * Sinkron dokumen sumber di transaksi T1 yang ditahan pada `barisAnggaranProyek.{metode}`, lalu `selagi(pid T1)`
 * dijalankan, lalu tahanan dilepas. Mengembalikan hasil T1 ("ok" + hasil sinkron, atau pesan galat) dan hasil selagi.
 */
async function sinkronDitahan<T>(proyek: { id: string; kode: string }, sumber: { jenis: "penawaran" | "pesanan"; id: string }, metode: string, selagi: (pid: number) => Promise<T>) {
  let lepas!: () => void;
  const gerbang = new Promise<void>((r) => (lepas = r));
  let sampai!: (pid: number) => void;
  const tercapai = new Promise<number>((r) => (sampai = r));
  const t1 = db
    .$transaction(
      async (tx) => {
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS "pid"`;
        return sinkronDokumenDalamTransaksi(tahanDi(tx, metode, () => sampai(pid), gerbang), proyek, sumber, new Date());
      },
      { timeout: 60_000 },
    )
    .then(
      (h): { ok: true; h: HasilSinkronAnggaran } => ({ ok: true, h }),
      (e: Error) => ({ ok: false as const, pesan: `${(e as { code?: string }).code ?? ""} ${e.message.split("\n").slice(-2).join(" ")}` }),
    );
  const pid = await Promise.race([tercapai, t1.then(() => -1)]);
  try {
    const hasil = await selagi(pid);
    lepas();
    return { t1: await t1, hasil };
  } finally {
    lepas();
    await t1;
  }
}

function masukanDasar(lain: Partial<MasukanKeuangan> = {}): MasukanKeuangan {
  return {
    pesanan: [],
    penawaran: [],
    faktur: [],
    uangMuka: [],
    terminDitagih: new Map(),
    faktorDppUangMuka: D(1),
    nilaiKontrakManual: null,
    rencana: [],
    bebanPerAkun: [],
    akunBagiHasilId: null,
    kategoriUntukAkun: () => null,
    namaKategori: new Map(),
    ...lain,
  };
}

function bagianA() {
  console.log("=== A8 sampai A13. Ringkasan keuangan (murni) ===");
  const nama = new Map([["venue", "Venue"], ["produksi", "Produksi"], ["talent", "Talent / Artis"]]);
  const kategoriAkun = new Map([["a-venue", "venue"], ["a-talent", "talent"]]);
  const a8 = (dibayar: number) =>
    hitungRingkasanKeuangan(
      masukanDasar({
        pesanan: [{ id: "p1", total: juta(10) }],
        penawaran: [{ id: "q1", tanggal: new Date("2026-01-01"), total: juta(10), status: "DIKONVERSI", statusKomersial: "DITERIMA", punyaPesanan: true }],
        faktur: [{ pesananId: "p1", dpp: juta(10), total: juta(10), uangMuka: D(0), dibayar: juta(dibayar), returDpp: D(0) }],
        rencana: [{ kategoriId: "venue", rencana: juta(2) }, { kategoriId: "produksi", rencana: juta(3) }],
        bebanPerAkun: [{ akunId: "a-venue", nilai: D(2_500_000) }, { akunId: "a-talent", nilai: juta(1) }],
        kategoriUntukAkun: (id) => kategoriAkun.get(id) ?? null,
        namaKategori: nama,
      }),
    );
  const r = a8(10);
  pastikan(r.kontrak.equals(juta(10)) && r.ditagih.equals(juta(10)) && r.diterima.equals(juta(10)) && r.sumberPendapatan === "KONTRAK", "A8: kontrak = ditagih = diterima = 10 juta, sumber KONTRAK");
  pastikan(r.anggaran.equals(juta(5)) && r.aktual.equals(D(3_500_000)) && r.sisaAnggaran.equals(D(1_500_000)) && r.persenTerpakai!.equals(D("70.0")), "A8: anggaran 5 juta, aktual 3,5 juta, sisa 1,5 juta, terpakai 70,0%");
  pastikan(r.perkiraanBiaya.equals(D(6_500_000)) && r.marginRencana.equals(juta(5)) && r.persenMarginRencana!.equals(D("50.0")) && r.marginPerkiraan.equals(D(3_500_000)) && r.persenMarginPerkiraan!.equals(D("35.0")), "A8: perkiraan 6,5 juta, margin rencana 50,0%, margin perkiraan 35,0%");
  pastikan(r.marginTagih.equals(D(6_500_000)) && r.marginKas.equals(D(6_500_000)) && r.persenMarginKas!.equals(D("65.0")) && r.piutang.isZero() && r.belumDitagih.isZero(), "A8: margin tagih = margin kas = 6,5 juta (65,0%), piutang dan belum ditagih 0");
  const k = new Map(r.kategori.map((x) => [x.nama, x]));
  pastikan(k.get("Venue")!.lebih && k.get("Talent / Artis")!.tanpaAnggaran && k.get("Produksi")!.persenTerpakai!.equals(D("0.0")), "A8: Venue lebih, Talent / Artis tanpa anggaran, Produksi terpakai 0,0%");
  pastikan(r.kategori.reduce((s, x) => s.plus(x.aktual), D(0)).equals(r.aktual), "A8: Σ aktual per kategori = aktual");
  const belum = a8(0);
  pastikan(belum.diterima.isZero() && belum.piutang.equals(juta(10)), "A8: faktur disetujui belum dibayar, diterima 0 dan piutang 10 juta");

  const a9 = hitungRingkasanKeuangan(masukanDasar({ pesanan: [{ id: "p1", total: juta(10) }], faktur: [{ pesananId: "p1", dpp: juta(10), total: D(11_100_000), uangMuka: D(0), dibayar: D(5_550_000), returDpp: D(0) }] }));
  pastikan(a9.diterima.equals(juta(5)) && a9.piutang.equals(juta(5)), "A9: pembayaran sebagian PKP, diterima 5 juta, piutang 5 juta");

  const q = (id: string, tgl: string, total: number, status = "DRAF", komersial: string | null = "DRAF") => ({ id, tanggal: new Date(tgl), total: D(total), status, statusKomersial: komersial, punyaPesanan: false });
  const hanyaDraf = hitungRingkasanKeuangan(masukanDasar({ penawaran: [q("q2", "2026-02-01", 5_000_000), q("q1", "2026-01-01", 8_000_000)] }));
  pastikan(hanyaDraf.sumberPendapatan === "PENAWARAN" && hanyaDraf.dikutip.equals(juta(5)) && hanyaDraf.kontrak.isZero(), "A10: hanya penawaran DRAF, sumber PENAWARAN dan dikutip = penawaran terbuka TERBARU (5 juta, bukan 8 juta)");
  pastikan(hitungRingkasanKeuangan(masukanDasar({ pesanan: [{ id: "p1", total: juta(8) }] })).sumberPendapatan === "KONTRAK", "A10: ada pesanan, sumber KONTRAK");
  pastikan(hitungRingkasanKeuangan(masukanDasar({ faktur: [{ pesananId: "x", dpp: juta(2), total: juta(2), uangMuka: D(0), dibayar: D(0), returDpp: D(0) }] })).sumberPendapatan === "FAKTUR", "A10: hanya faktur, sumber FAKTUR");
  const manual = hitungRingkasanKeuangan(masukanDasar({ nilaiKontrakManual: D(750_000) }));
  pastikan(manual.sumberPendapatan === "MANUAL" && manual.pendapatanRencana.equals(D(750_000)), "A10: semua nol dengan nilai kontrak manual, sumber MANUAL");
  pastikan(hitungRingkasanKeuangan(masukanDasar()).sumberPendapatan === "TIDAK_ADA", "A10: semua nol, sumber TIDAK_ADA");

  const um = (faktor: ReturnType<typeof D>) => hitungRingkasanKeuangan(masukanDasar({ pesanan: [{ id: "p1", total: juta(10) }], uangMuka: [{ pesananId: "p1", jumlah: juta(3), dipakaiDisetujui: D(0) }], faktorDppUangMuka: faktor }));
  pastikan(um(D(1)).diterima.equals(juta(3)) && um(D(100).div(111)).diterima.equals(D("2702702.70")), "A11: DP 3 juta belum dipakai, diterima 3 juta (non-PKP) dan 2.702.702,70 (PKP 11%)");

  const termin = new Map([["p1", juta(3)]]);
  pastikan(hitungRingkasanKeuangan(masukanDasar({ pesanan: [{ id: "p1", total: juta(10) }], terminDitagih: termin })).ditagih.equals(juta(3)), "A12: termin ditagih 3 juta tanpa faktur, ditagih 3 juta");
  pastikan(
    hitungRingkasanKeuangan(masukanDasar({ pesanan: [{ id: "p1", total: juta(10) }], terminDitagih: termin, faktur: [{ pesananId: "p1", dpp: juta(10), total: juta(10), uangMuka: D(0), dibayar: D(0), returDpp: D(0) }] })).ditagih.equals(juta(10)),
    "A12: sesudah faktur 10 juta disetujui, ditagih 10 juta (yang terbesar per pesanan)",
  );
  pastikan(persen(D(1), D(0)) === null && persen(D(1), D(3))!.equals(D("33.3")) && persen(D(2), D(3))!.equals(D("66.7")), "A13: persen(x, 0) null, 1/3 = 33,3, 2/3 = 66,7");

  console.log("=== A14 sampai A16. Kunci, tanda, nama, kategori akun (murni) ===");
  const b = (nama: string, nilai: number, bagian = "") => ({ nama, bagian, nilai: D(nilai), akunBebanBarangId: null });
  const k1 = beriKunci([b("Sound", 4_000_000), b("  LIGHTS  ", 1_000_000, " Panggung  Utama "), b("sound", 2_000_000)]);
  pastikan(sama(k1.map((x) => x.kunci), ["sound||1", "lights|panggung utama|1", "sound||2"]) && k1[1].nama === "LIGHTS" && k1[1].bagian === "Panggung Utama", "A14: kunci sound||1, sound||2, nama dan bagian dirapikan lalu huruf kecil");
  const t1 = tandaSumber(k1);
  pastikan(t1.length === 16 && t1 === tandaSumber(beriKunci([b("Sound", 4_000_000), b("LIGHTS", 1_000_000, "Panggung Utama"), b("sound", 2_000_000)])), "A14: masukan sama, tanda sama (16 karakter)");
  pastikan(t1 !== tandaSumber(beriKunci([b("Sound", 4_000_001), b("LIGHTS", 1_000_000, "Panggung Utama"), b("sound", 2_000_000)])), "A14: nilai berubah, tanda berubah");
  pastikan(rapikanNama("  Venue  ") === "Venue" && kunciNama("Talent  /  ARTIS") === "talent / artis", "A15: rapikanNama dan kunciNama");
  const induk = new Map<string, string | null>([["anak", "induk"], ["induk", "akar"], ["akar", null], ["lain", "akar"], ["s1", "s2"], ["s2", "s1"]]);
  const tentukan = penentuKategori(induk, new Map([["anak", "K-anak"], ["induk", "K-induk"]]));
  pastikan(tentukan("anak") === "K-anak" && tentukan("induk") === "K-induk" && tentukan("lain") === null && tentukan("tidak-ada") === null && tentukan("s1") === null, "A16: anak dipetakan sendiri, induk dipetakan, tanpa pemetaan null, siklus berhenti tanpa galat");
  const dalam = new Map<string, string | null>(Array.from({ length: 30 }, (_, i) => [`d${i}`, i === 29 ? null : `d${i + 1}`]));
  pastikan(penentuKategori(dalam, new Map([["d29", "K"]]))("d0") === null && penentuKategori(dalam, new Map([["d10", "K"]]))("d0") === "K", "A16: penelusuran berhenti sesudah 20 tingkat");
}

async function main() {
  bagianA();
  await bersihkanDokumen();
  await bersihkanData();
  const mulai = new Date();
  const hakAwal = await db.hakAksesPeran.count();
  const kategoriAwal = new Map((await db.kategoriAnggaran.findMany({ select: { id: true, nama: true, namaKunci: true } })).map((k) => [k.id, k]));
  const pemetaanAwal = new Map((await db.akunKategoriAnggaran.findMany()).map((p) => [p.akunId, p.kategoriId]));
  const nomorDokumen: string[] = [];
  const logAksi = (aksi: string, entitasId?: string) => db.logAktivitas.count({ where: { modul: "anggaran-proyek", aksi, waktu: { gte: mulai }, ...(entitasId ? { entitasId } : {}) } });
  try {
    console.log("=== B0. Kategori bawaan dan pemetaan akun bawaan ===");
    // aksi "Terapkan ke sistem" di Pengaturan, Bagan Akun Standar ikut menerapkan kategori bawaan (D5 §8 no. 23)
    await jalankan("terapkanBaganAkun (pengaturan)", () => sebagai("owner", () => terapkanBaganAkun()));
    pastikan((await db.kategoriAnggaran.count({ where: { bawaan: true } })) === KATEGORI_BAWAAN.length, "sesudah Terapkan ke sistem: 9 kategori bawaan ada");
    const kedua = await terapkanKategoriAnggaranBawaan(db);
    pastikan(sama(kedua, { kategoriDibuat: 0, pemetaanDibuat: 0 }), `panggilan kedua idempoten ${JSON.stringify(kedua)}`);
    const bawaan = await db.kategoriAnggaran.findMany({ where: { bawaan: true }, orderBy: { urutan: "asc" }, select: { id: true, nama: true, urutan: true } });
    pastikan(sama(bawaan.map((k) => k.urutan), KATEGORI_BAWAAN.map((k) => k.urutan)), `9 kategori bawaan (${bawaan.map((k) => k.nama).join(", ")})`);
    const idBawaan = (urutan: number) => bawaan.find((k) => k.urutan === urutan)!.id;
    const akunKode = async (kode: string) => db.akun.findUniqueOrThrow({ where: { kode }, select: { id: true } });
    const peta = await muatPetaKategori(db);
    pastikan(peta.kategoriUntukAkun((await akunKode("5-3100")).id) === idBawaan(70) && peta.kategoriUntukAkun((await akunKode("5-3500")).id) === idBawaan(80), "5-3100 masuk Logistik (pemetaan sendiri), 5-3500 masuk Operasional lewat induk 5-3000");
    pastikan(peta.kategoriUntukAkun((await akunKode("5-1500")).id) === idBawaan(10) && peta.kategoriUntukAkun((await akunKode("5-1600")).id) === idBawaan(20), "5-1500 Talent / Artis, 5-1600 Venue");
    pastikan((await db.akunKategoriAnggaran.count({ where: { akun: { kode: "5-1700" } } })) === 0, "5-1700 (bagi hasil) tidak pernah dipetakan");
    pastikan((await pemetaanBawaanDilewati(db)).length === 0, "data seed: tidak ada akun berkode bawaan yang dilewati pemetaan bawaan");
    // kode standar dipakai akun dengan jenis, kelompok, atau nama lain: tidak dipetakan (tinjauan P34 R4). Kategori
    // Talent / Artis, Venue, Pemasaran, dan Logistik dihapus lalu dibuat ulang supaya pemetaan bawaannya dicoba lagi
    // (pemetaan bawaan hanya untuk kategori yang baru dibuat, S2). Semua digulung balik.
    await db
      .$transaction(async (tx) => {
        await tx.kategoriAnggaran.deleteMany({ where: { bawaan: true, urutan: { in: [10, 20, 60, 70] } } });
        await tx.akun.update({ where: { kode: "5-1500" }, data: { nama: "  biaya TALENT /  artis " } });
        await tx.akun.update({ where: { kode: "5-1600" }, data: { kelompok: true } });
        await tx.akun.update({ where: { kode: "5-7000" }, data: { nama: "Sewa Sound" } });
        await tx.akun.update({ where: { kode: "5-3100" }, data: { jenis: "ASET" } });
        const h = await terapkanKategoriAnggaranBawaan(tx);
        const dipetakan = new Set((await tx.akunKategoriAnggaran.findMany({ where: { akun: { kode: { in: ["5-1500", "5-1600", "5-7000", "5-3100", "5-3200", "5-3300", "5-3400"] } } }, select: { akun: { select: { kode: true } } } })).map((p) => p.akun.kode));
        pastikan(h.kategoriDibuat === 4 && sama([...dipetakan].sort(), ["5-1500", "5-3200", "5-3300", "5-3400"]), `kategori dibuat ulang 4; 5-1500 (nama beda huruf dan spasi saja) dipetakan, 5-1600 kelompok, 5-7000 bernama lain, 5-3100 berjenis lain tidak (${[...dipetakan].sort().join(", ")})`);
        const lewat = await pemetaanBawaanDilewati(tx);
        pastikan(sama(lewat.map((a) => a.kode), ["5-1600", "5-3100", "5-7000"]) && lewat.find((a) => a.kode === "5-7000")!.alasan.includes("namanya berbeda") && lewat.find((a) => a.kode === "5-7000")!.kategori === "Pemasaran", `pemetaanBawaanDilewati mencantumkan 5-1600, 5-3100, 5-7000 beserta alasannya (${JSON.stringify(lewat.map((a) => [a.kode, a.alasan]))})`);
        throw new Error(BATAL);
      })
      .catch((e: Error) => {
        if (e.message !== BATAL) throw e;
      });
    pastikan((await db.akunKategoriAnggaran.count({ where: { akun: { kode: { in: ["5-1500", "5-1600"] } } } })) === 2, "akun 5-1500 dan 5-1600 kembali seperti semula sesudah digulung balik");
    // pemetaan bawaan yang dikosongkan pengguna tidak dibuat ulang (tinjauan P34 S2)
    const a3100 = await akunKode("5-3100");
    await jalankan("kosongkan pemetaan 5-3100", () => sebagai("owner", () => simpanPemetaanKategori(formulir({ [`kategori_${a3100.id}`]: "" }))));
    pastikan((await muatPetaKategori(db)).kategoriUntukAkun(a3100.id) === idBawaan(80), "5-3100 dikosongkan: ikut induk 5-3000 (Operasional)");
    await jalankan("Terapkan ke sistem lagi", () => sebagai("owner", () => terapkanBaganAkun()));
    const siapUlang = await sebagai("owner", () => siapkanKategoriBawaan()).catch((e: { message?: string }) => {
      if (!String(e?.message).includes("static generation store missing")) throw e;
      return null;
    });
    pastikan(
      (await db.akunKategoriAnggaran.findUnique({ where: { akunId: a3100.id } })) === null && (await terapkanKategoriAnggaranBawaan(db)).pemetaanDibuat === 0 && (siapUlang === null || siapUlang.pemetaanDibuat === 0),
      "sesudah Terapkan ke sistem, Siapkan kategori bawaan, dan terapkan ulang: pemetaan 5-3100 tetap kosong",
    );
    pastikan((await pemetaanBawaanDilewati(db)).length === 0, "akun yang sengaja dikosongkan tetapi cocok bagan standar tidak masuk daftar periksa");
    await jalankan("pulihkan pemetaan 5-3100", () => sebagai("owner", () => simpanPemetaanKategori(formulir({ [`kategori_${a3100.id}`]: idBawaan(70) }))));
    // kategori bawaan yang diganti nama tidak dibuat ulang
    const venue = bawaan.find((k) => k.urutan === 20)!;
    await jalankan("ganti nama Venue", () => sebagai("owner", () => ubahKategoriAnggaran(venue.id, formulir({ nama: "Venue Acara" }))));
    pastikan((await terapkanKategoriAnggaranBawaan(db)).kategoriDibuat === 0 && (await db.kategoriAnggaran.count({ where: { bawaan: true } })) === 9, "sesudah ganti nama, terapkan ulang tidak membuat Venue baru");
    await jalankan("nama Venue dipulihkan", () => sebagai("owner", () => ubahKategoriAnggaran(venue.id, formulir({ nama: venue.nama }))));

    console.log("=== B4. Kategori dan pemetaan ===");
    const ulang = await cariAtauBuatKategori(db, " venue ");
    pastikan(ulang.id === venue.id && !ulang.baru && ulang.nama === "Venue", "cariAtauBuatKategori(\" venue \") memakai kategori Venue yang sudah ada");
    await harusDitolak("KASIR tambah kategori", () => sebagai("kasir", () => tambahKategoriAnggaran(formulir({ nama: "KPA X" }))), "tidak punya hak");
    await harusDitolak("nama kosong", () => sebagai("owner", () => tambahKategoriAnggaran(formulir({ nama: "   " }))), "Nama kategori wajib diisi");
    await harusDitolak("nama 61 karakter", () => sebagai("owner", () => tambahKategoriAnggaran(formulir({ nama: "K".repeat(61) }))), "Nama kategori maksimal 60 karakter");
    await jalankan("tambah KPA Sound System", () => sebagai("owner", () => tambahKategoriAnggaran(formulir({ nama: " KPA  Sound   System " }))));
    const sound = await db.kategoriAnggaran.findUniqueOrThrow({ where: { namaKunci: "kpa sound system" } });
    pastikan(sound.nama === "KPA Sound System" && !sound.bawaan && sound.urutan === 1000, "kategori baru dirapikan, bukan bawaan, urutan 1000");
    await harusDitolak("nama kembar beda huruf", () => sebagai("owner", () => tambahKategoriAnggaran(formulir({ nama: "kpa sound system" }))), "Kategori KPA Sound System sudah ada");
    await jalankan("tambah KPA Kosong", () => sebagai("owner", () => tambahKategoriAnggaran(formulir({ nama: "KPA Kosong" }))));
    const kosongK = await db.kategoriAnggaran.findUniqueOrThrow({ where: { namaKunci: "kpa kosong" } });
    await harusDitolak("ganti nama ke nama lain yang ada", () => sebagai("owner", () => ubahKategoriAnggaran(kosongK.id, formulir({ nama: "KPA SOUND system" }))), "sudah ada");
    await jalankan("ganti huruf besar nama sendiri", () => sebagai("owner", () => ubahKategoriAnggaran(sound.id, formulir({ nama: "KPA Sound SYSTEM" }))));
    pastikan((await db.kategoriAnggaran.findUniqueOrThrow({ where: { id: sound.id } })).nama === "KPA Sound SYSTEM", "ganti huruf besar nama sendiri boleh");

    const bebanUji = await db.akun.create({ data: { kode: `${AWALAN}-BEBAN`, nama: "Beban Uji KPA", jenis: "BEBAN" } });
    const asetUji = await db.akun.create({ data: { kode: `${AWALAN}-ASET`, nama: "Aset Uji KPA", jenis: "ASET" } });
    const a1700 = await akunKode("5-1700");
    await harusDitolak("petakan akun bagi hasil", () => sebagai("owner", () => simpanPemetaanKategori(formulir({ [`kategori_${a1700.id}`]: sound.id }))), "dikecualikan dari biaya aktual");
    await harusDitolak("petakan akun aset", () => sebagai("owner", () => simpanPemetaanKategori(formulir({ [`kategori_${asetUji.id}`]: sound.id }))), "bukan akun beban");
    await harusDitolak("kategori tidak ada", () => sebagai("owner", () => simpanPemetaanKategori(formulir({ [`kategori_${bebanUji.id}`]: "tidak-ada" }))), "Kategori tidak ditemukan");
    await harusDitolak("KASIR petakan", () => sebagai("kasir", () => simpanPemetaanKategori(formulir({ [`kategori_${bebanUji.id}`]: sound.id }))), "tidak punya hak");
    const logPemetaan = await logAksi("UBAH_PEMETAAN");
    await jalankan("petakan KPA-BEBAN ke KPA Sound System", () => sebagai("owner", () => simpanPemetaanKategori(formulir({ [`kategori_${bebanUji.id}`]: sound.id, [`kategori_${a1700.id}`]: "" }))));
    pastikan((await db.akunKategoriAnggaran.findUnique({ where: { akunId: bebanUji.id } }))?.kategoriId === sound.id && (await logAksi("UBAH_PEMETAAN")) === logPemetaan + 1, "pemetaan tersimpan, satu log UBAH_PEMETAAN (5-1700 kosong tidak berubah)");
    await jalankan("simpan pemetaan yang sama", () => sebagai("owner", () => simpanPemetaanKategori(formulir({ [`kategori_${bebanUji.id}`]: sound.id }))));
    pastikan((await logAksi("UBAH_PEMETAAN")) === logPemetaan + 1, "tanpa perubahan: tanpa log");
    await harusDitolak("hapus kategori bawaan", () => sebagai("owner", () => hapusKategoriAnggaran(idBawaan(90))), "Kategori bawaan tidak bisa dihapus");
    await jalankan("tambah KPA Hapus", () => sebagai("owner", () => tambahKategoriAnggaran(formulir({ nama: "KPA Hapus" }))));
    const kHapus = await db.kategoriAnggaran.findUniqueOrThrow({ where: { namaKunci: "kpa hapus" } });
    await jalankan("petakan 5-9300 ke KPA Hapus", async () => {
      const a = await akunKode("5-9300");
      await sebagai("owner", () => simpanPemetaanKategori(formulir({ [`kategori_${a.id}`]: kHapus.id })));
    });
    await jalankan("hapus KPA Hapus", () => sebagai("owner", () => hapusKategoriAnggaran(kHapus.id)));
    const a9300 = await akunKode("5-9300");
    pastikan((await db.kategoriAnggaran.count({ where: { id: kHapus.id } })) === 0 && (await db.akunKategoriAnggaran.findUnique({ where: { akunId: a9300.id } })) === null, "kategori terhapus beserta pemetaannya; 5-9300 kembali mengikuti induk");
    pastikan((await muatPetaKategori(db)).kategoriUntukAkun(a9300.id) === idBawaan(90), "5-9300 lewat induk 5-9000 masuk Lainnya");
    if (pemetaanAwal.has(a9300.id)) await db.akunKategoriAnggaran.create({ data: { akunId: a9300.id, kategoriId: pemetaanAwal.get(a9300.id)! } });
    const siap = await sebagai("owner", () => siapkanKategoriBawaan()).catch((e: { message?: string }) => {
      if (!String(e?.message).includes("static generation store missing")) throw e;
      return null;
    });
    pastikan(siap === null || (siap.kategoriDibuat === 0 && siap.pemetaanDibuat === 0), "siapkanKategoriBawaan sesudah diterapkan: tidak ada yang dibuat");

    console.log("=== B5. Baris anggaran ===");
    const pelanggan = await db.pelanggan.create({ data: { kode: `${AWALAN}-CUST`, nama: "Klien Uji KPA" } });
    const p1 = await db.proyek.create({ data: { kode: `${AWALAN}-PRJ-1`, nama: "Event Uji KPA", pelangganId: pelanggan.id } });
    const p2 = await db.proyek.create({ data: { kode: `${AWALAN}-PRJ-2`, nama: "Event Uji KPA Dua" } });
    const tambah = (proyekId: string, o: Record<string, string>) => sebagai("owner", () => tambahBarisAnggaran(proyekId, formulir({ kategoriId: idBawaan(20), deskripsi: "Sewa gedung", rencana: "2000000", ...o })));
    await harusDitolak("tanpa kategori", () => tambah(p1.id, { kategoriId: "" }), "Kategori wajib dipilih");
    await harusDitolak("kategori tidak ada", () => tambah(p1.id, { kategoriId: "tidak-ada" }), "Kategori tidak ditemukan");
    await harusDitolak("uraian kosong", () => tambah(p1.id, { deskripsi: " " }), "Uraian wajib diisi");
    await harusDitolak("uraian 201 karakter", () => tambah(p1.id, { deskripsi: "u".repeat(201) }), "Uraian maksimal 200 karakter");
    await harusDitolak("vendor 121 karakter", () => tambah(p1.id, { vendor: "v".repeat(121) }), "Vendor maksimal 120 karakter");
    await harusDitolak("catatan 1001 karakter", () => tambah(p1.id, { catatan: "c".repeat(1001) }), "Catatan maksimal 1000 karakter");
    await harusDitolak("rencana negatif", () => tambah(p1.id, { rencana: "-1" }), "Rencana biaya tidak boleh negatif");
    await harusDitolak("rencana di atas 10 triliun", () => tambah(p1.id, { rencana: "10000000000000.01" }), "Rencana biaya melebihi batas Rp 10 triliun");
    await harusDitolak("proyek tidak ada", () => tambah("tidak-ada", {}), "Proyek tidak ditemukan");
    await harusDitolak("KASIR tambah baris", () => sebagai("kasir", () => tambahBarisAnggaran(p1.id, formulir({ kategoriId: idBawaan(20), deskripsi: "x" }))), "tidak punya hak");
    await jalankan("Venue 2.000.000", () => tambah(p1.id, { vendor: " Gedung A ", catatan: "DP 50%" }));
    await jalankan("Produksi 3.000.000 lewat kategoriBaru ' produksi '", () => tambah(p1.id, { kategoriId: "", kategoriBaru: " produksi ", deskripsi: "Dekor", rencana: "3000000" }));
    await jalankan("kategori baru KPA Dokumentasi, rencana kosong", () => tambah(p1.id, { kategoriId: "", kategoriBaru: "KPA Dokumentasi", deskripsi: "Foto", rencana: "" }));
    const baris1 = await db.barisAnggaranProyek.findMany({ where: { proyekId: p1.id }, orderBy: [{ dibuatPada: "asc" }, { id: "asc" }], include: { kategori: true } });
    pastikan(
      sama(baris1.map((b) => `${b.kategori.nama}:${b.deskripsi}:${D(b.rencana).toFixed(0)}`), ["Venue:Sewa gedung:2000000", "Produksi:Dekor:3000000", "KPA Dokumentasi:Foto:0"]) && baris1[0].vendor === "Gedung A" && baris1[0].catatan === "DP 50%",
      "tiga baris: Venue, Produksi (kategori yang ada menang), KPA Dokumentasi (baru, rencana kosong = 0), vendor dipangkas",
    );
    pastikan((await logAksi("BUAT", p1.id)) === 3, "tiga log BUAT anggaran proyek");
    await harusDitolak("ubah lewat proyek lain", () => sebagai("owner", () => ubahBarisAnggaran(p2.id, baris1[0].id, formulir({ kategoriId: idBawaan(20), deskripsi: "x", rencana: "1" }))), "Baris anggaran tidak ditemukan di proyek ini");
    await harusDitolak("hapus lewat proyek lain", () => sebagai("owner", () => hapusBarisAnggaran(p2.id, baris1[0].id)), "Baris anggaran tidak ditemukan di proyek ini");
    await harusDitolak("KASIR ubah", () => sebagai("kasir", () => ubahBarisAnggaran(p1.id, baris1[0].id, formulir({ kategoriId: idBawaan(20), deskripsi: "x" }))), "tidak punya hak");
    await jalankan("ubah Foto ke 500.000", () => sebagai("owner", () => ubahBarisAnggaran(p1.id, baris1[2].id, formulir({ kategoriId: baris1[2].kategoriId, deskripsi: "Foto dan video", rencana: "500000", vendor: "", catatan: "" }))));
    const foto = await db.barisAnggaranProyek.findUniqueOrThrow({ where: { id: baris1[2].id } });
    pastikan(foto.deskripsi === "Foto dan video" && D(foto.rencana).equals(D(500_000)) && (await logAksi("UBAH", p1.id)) === 1, "ubah tersimpan dengan log UBAH");
    await harusDitolak("hapus kategori yang dipakai baris", () => sebagai("owner", () => hapusKategoriAnggaran(foto.kategoriId)), "dipakai 1 baris anggaran; pindahkan barisnya dulu");
    await jalankan("hapus baris Foto", () => sebagai("owner", () => hapusBarisAnggaran(p1.id, foto.id)));
    pastikan((await db.barisAnggaranProyek.count({ where: { proyekId: p1.id } })) === 2 && (await logAksi("HAPUS", p1.id)) === 1, "baris terhapus fisik dengan log HAPUS");
    const ringkas = (await ringkasanKeuanganProyek(db, p1.id))!.ringkasan;
    pastikan(ringkas.anggaran.equals(juta(5)), `ringkasan keuangan membaca anggaran 5 juta (${ringkas.anggaran})`);

    console.log("=== B19. Samakan anggaran biaya LPJ ===");
    await harusDitolak("KASIR samakan", () => sebagai("kasir", () => samakanAnggaranBiayaProyek(p1.id)), "tidak punya hak");
    await jalankan("samakan (anggaranBiaya null)", () => sebagai("owner", () => samakanAnggaranBiayaProyek(p1.id)));
    pastikan(D((await db.proyek.findUniqueOrThrow({ where: { id: p1.id } })).anggaranBiaya).equals(juta(5)), "anggaranBiaya = total rencana 5 juta");
    await harusDitolak("samakan kedua", () => sebagai("owner", () => samakanAnggaranBiayaProyek(p1.id)), "Anggaran biaya event sudah sama dengan total anggaran");
    await db.proyek.update({ where: { id: p2.id }, data: { anggaranBiaya: 7_000_000 } });
    await harusDitolak("samakan proyek tanpa baris anggaran (tinjauan P34 R3)", () => sebagai("owner", () => samakanAnggaranBiayaProyek(p2.id)), "Proyek belum punya baris anggaran");
    pastikan(D((await db.proyek.findUniqueOrThrow({ where: { id: p2.id } })).anggaranBiaya).equals(juta(7)), "anggaran biaya LPJ proyek tanpa baris anggaran tetap 7 juta");
    await db.proyek.update({ where: { id: p2.id }, data: { anggaranBiaya: null } });
    pastikan((await db.logAktivitas.count({ where: { modul: "anggaran-proyek", jenis: "Proyek", aksi: "UBAH", entitasId: p1.id, waktu: { gte: mulai } } })) === 1, "satu log UBAH jenis Proyek");

    console.log("=== B8. Sinkron dari penawaran ===");
    const a1200 = await akunKode("5-1200");
    const barang = async (kode: string, nama: string, harga: number, akunBebanId: string | null = null) =>
      db.barang.create({ data: { kode: `${AWALAN}-${kode}`, nama, jenis: "JASA", hargaBeli: 0, hargaJual: harga, akunBebanId } });
    const bSound = await barang("SOUND", "Sound KPA", 4_000_000, a1200.id);
    const bLights = await barang("LIGHTS", "Lights KPA", 1_000_000);
    const bStage = await barang("STAGE", "Stage KPA", 1_500_000);
    await jalankan("PNW Sound 1 × 4 juta, Lights 2 × 1 juta", () =>
      sebagai("owner", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, proyekId: p1.id, baris: [{ barangId: bSound.id, jumlah: 1, harga: 4_000_000 }, { barangId: bLights.id, jumlah: 2, harga: 1_000_000 }] }))),
    );
    const pnw = await db.penawaranPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id, proyekId: p1.id }, include: { baris: { orderBy: [{ urutan: "asc" }, { id: "asc" }] } } });
    nomorDokumen.push(pnw.nomor);
    const sinkron = (proyekId: string, sumber: string, siapa = "owner") => sebagai(siapa, () => sinkronAnggaranDariDokumen(proyekId, formulir({ sumber })));
    const logTerakhir = async () => (await db.logAktivitas.findFirstOrThrow({ where: { modul: "anggaran-proyek", entitasId: p1.id, aksi: { in: ["IMPOR", "SINKRON"] } }, orderBy: [{ waktu: "desc" }, { id: "desc" }] })) as unknown as { aksi: string; keterangan: string | null; meta: Record<string, unknown> };
    const dariPnw = () => db.barisAnggaranProyek.findMany({ where: { sumberPenawaranId: pnw.id }, orderBy: [{ dibuatPada: "asc" }, { id: "asc" }], include: { kategori: true } });
    await jalankan("impor dari PNW", () => sinkron(p1.id, `penawaran:${pnw.id}`));
    let impor = await dariPnw();
    let log = await logTerakhir();
    pastikan(
      sama(impor.map((b) => `${b.deskripsi}:${D(b.rencana).toFixed(0)}:${D(b.nilaiAcuan).toFixed(0)}:${b.kunciSumber}:${b.kategori.nama}`), ["Sound KPA:0:4000000:sound kpa||1:Vendor", "Lights KPA:0:2000000:lights kpa||1:Lainnya"]),
      `impor 2 baris, rencana 0, acuan 4 juta dan 2 juta; kategori Sound dari akun beban barang 5-1200 (Vendor), Lights tanpa akun ke Lainnya (${JSON.stringify(impor.map((b) => b.kategori.nama))})`,
    );
    pastikan(log.aksi === "IMPOR" && log.keterangan === `Impor anggaran dari ${pnw.nomor}: 2 baris` && log.meta.ditambah === 2, "log IMPOR dengan keterangan dan meta");
    pastikan(impor.every((b) => b.tandaSumber === impor[0].tandaSumber && b.disinkronPada && !b.dihapusDariSumber), "tanda dan waktu sinkron terisi");
    await jalankan("isi rencana Sound 3 juta", () => sebagai("owner", () => ubahBarisAnggaran(p1.id, impor[0].id, formulir({ kategoriId: impor[0].kategoriId, deskripsi: "Sound KPA (uraian diubah)", rencana: "3000000" }))));
    await jalankan("sinkron ulang tanpa perubahan", () => sinkron(p1.id, `penawaran:${pnw.id}`));
    log = await logTerakhir();
    const status1 = await statusSinkronAnggaran(db, p1.id);
    pastikan(log.aksi === "SINKRON" && log.meta.ditambah === 0 && log.meta.diperbarui === 0 && log.meta.dihapus === 0 && status1.get(`penawaran:${pnw.id}`)?.basi === false && status1.get(`penawaran:${pnw.id}`)?.jumlahBaris === 2, "sinkron ulang (0, 0, 0) dan tidak basi");
    // baris dokumen diubah: Sound 5 juta, Lights dihapus, Stage 1,5 juta (id baris Sound berganti, kunci tetap)
    const [sSound, sLights] = pnw.baris;
    await db.barisPenawaranPenjualan.delete({ where: { id: sSound.id } });
    await db.barisPenawaranPenjualan.delete({ where: { id: sLights.id } });
    await db.barisPenawaranPenjualan.createMany({
      data: [
        { penawaranId: pnw.id, barangId: bSound.id, jumlah: 1, harga: 5_000_000, subtotal: 5_000_000, urutan: 1 },
        { penawaranId: pnw.id, barangId: bStage.id, jumlah: 1, harga: 1_500_000, subtotal: 1_500_000, urutan: 2 },
      ],
    });
    pastikan((await statusSinkronAnggaran(db, p1.id)).get(`penawaran:${pnw.id}`)?.basi === true, "dokumen berubah: basi");
    await jalankan("sinkron sesudah berubah", () => sinkron(p1.id, `penawaran:${pnw.id}`));
    log = await logTerakhir();
    impor = await dariPnw();
    const per = new Map(impor.map((b) => [b.kunciSumber, b]));
    pastikan(log.meta.ditambah === 1 && log.meta.diperbarui === 1 && log.meta.dihapus === 1 && log.keterangan === `Sinkron dengan ${pnw.nomor}: 1 harga berubah, 1 ditambah, 1 tidak ada lagi di dokumen`, `sinkron (ditambah 1, diperbarui 1, dihapus 1) ${JSON.stringify(log.meta)}`);
    const soundB = per.get("sound kpa||1")!;
    pastikan(D(soundB.rencana).equals(juta(3)) && D(soundB.nilaiAcuan).equals(juta(5)) && soundB.deskripsi === "Sound KPA (uraian diubah)", "Sound: rencana tetap 3 juta, acuan 5 juta, uraian buatan pengguna tidak disentuh");
    pastikan(per.get("lights kpa||1")!.dihapusDariSumber && D(per.get("stage kpa||1")!.rencana).isZero(), "Lights ditandai tidak ada lagi di dokumen; Stage baris baru berencana 0");
    pastikan((await statusSinkronAnggaran(db, p1.id)).get(`penawaran:${pnw.id}`)?.basi === false, "sesudah sinkron: tidak basi");
    await jalankan("hapus baris Stage", () => sebagai("owner", () => hapusBarisAnggaran(p1.id, per.get("stage kpa||1")!.id)));
    // bagian: kategori dari bagian (yang ada menang, yang baru dibuat); Lights kembali ke dokumen
    await db.barisPenawaranPenjualan.createMany({
      data: [
        { penawaranId: pnw.id, barangId: bLights.id, jumlah: 2, harga: 1_000_000, subtotal: 2_000_000, urutan: 3 },
        { penawaranId: pnw.id, barangId: bStage.id, nama: "Backdrop", bagian: "KPA  Dekorasi Panggung", jumlah: 1, harga: 750_000, subtotal: 750_000, urutan: 4 },
        { penawaranId: pnw.id, barangId: bStage.id, nama: "Genset", bagian: " venue ", jumlah: 1, harga: 250_000, subtotal: 250_000, urutan: 5 },
      ],
    });
    await jalankan("sinkron dengan bagian", () => sinkron(p1.id, `penawaran:${pnw.id}`));
    log = await logTerakhir();
    impor = await dariPnw();
    const per2 = new Map(impor.map((b) => [b.kunciSumber, b]));
    pastikan(per2.has("stage kpa||1") && D(per2.get("stage kpa||1")!.rencana).isZero(), "baris impor yang dihapus dibuat ulang berencana 0");
    pastikan(!per2.get("lights kpa||1")!.dihapusDariSumber && per2.get("backdrop|kpa dekorasi panggung|1")!.kategori.nama === "KPA Dekorasi Panggung" && per2.get("genset|venue|1")!.kategori.nama === "Venue", "Lights cocok lagi; bagian baru jadi kategori baru, bagian 'venue' memakai Venue");
    pastikan(sama(log.meta.kategoriBaru, ["KPA Dekorasi Panggung"]) && log.meta.ditambah === 3, `meta kategoriBaru ${JSON.stringify(log.meta)}`);
    const totalSesudah = impor.length;
    // dokumen mendapat satu baris baru lebih dulu, jadi kedua sinkron serentak sama-sama ingin menambah baris (tinjauan P34 R2)
    await db.barisPenawaranPenjualan.create({ data: { penawaranId: pnw.id, barangId: bStage.id, nama: "Kabel KPA", jumlah: 1, harga: 100_000, subtotal: 100_000, urutan: 6 } });
    const logSebelumSerentak = new Date();
    const serentak = await Promise.all([aksi(() => sinkron(p1.id, `penawaran:${pnw.id}`)), aksi(() => sinkron(p1.id, `penawaran:${pnw.id}`))]);
    const metaSerentak = (await db.logAktivitas.findMany({ where: { modul: "anggaran-proyek", entitasId: p1.id, aksi: "SINKRON", waktu: { gte: logSebelumSerentak } }, select: { meta: true } })).map((l) => (l.meta as { ditambah: number }).ditambah).sort();
    pastikan(serentak.every((h) => h === "ok") && (await dariPnw()).length === totalSesudah + 1 && sama(metaSerentak, [0, 1]), `dua sinkron serentak sesudah dokumen bertambah satu baris: total bertambah tepat 1, log ditambah 1 dan 0 (${serentak.join(" | ")}; ${JSON.stringify(metaSerentak)})`);

    console.log("=== Sinkron serentak dengan hapus dan ubah dokumen sumber (tinjauan P34 S1) ===");
    const p3 = await db.proyek.create({ data: { kode: `${AWALAN}-PRJ-3`, nama: "Event Uji KPA Tiga", pelangganId: pelanggan.id } });
    const idPnw3: string[] = [];
    const pnwBaru = async (harga: number) => {
      await jalankan(`PNW proyek tiga ${harga}`, () => sebagai("owner", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, proyekId: p3.id, baris: [{ barangId: bSound.id, jumlah: 1, harga }, { barangId: bLights.id, jumlah: 1, harga: 1_000_000 }] }))));
      const d = await db.penawaranPenjualan.findFirstOrThrow({ where: { proyekId: p3.id, id: { notIn: idPnw3 } } });
      idPnw3.push(d.id);
      nomorDokumen.push(d.nomor);
      await jalankan(`impor ${d.nomor}`, () => sinkron(p3.id, `penawaran:${d.id}`));
      return d;
    };
    // S1a: sinkron yang menambah satu baris ditahan tepat sebelum sisipan; hapus penawaran berjalan di tengahnya.
    // Tanpa kunci dokumen sumber di depan, hapus (dokumen lalu baris anggaran) dan sinkron (baris anggaran lalu dokumen)
    // saling mengunci dan salah satunya gagal P2034.
    const pnwH = await pnwBaru(4_100_000);
    await db.barisPenawaranPenjualan.create({ data: { penawaranId: pnwH.id, barangId: bStage.id, nama: "Tambahan Hapus", jumlah: 1, harga: 500_000, subtotal: 500_000, urutan: 9 } });
    const s1a = await sinkronDitahan(p3, { jenis: "penawaran", id: pnwH.id }, "createMany", async (pid) => {
      const hapus = aksi(() => sebagai("owner", () => hapusDokumen("penawaran", pnwH.id)));
      const antre = await tungguAntre(pid, 1);
      return { hapus, antre };
    });
    const hapusH = await s1a.hasil.hapus;
    const sisaH = await db.barisAnggaranProyek.findMany({ where: { proyekId: p3.id }, select: { sumberPenawaranId: true } });
    pastikan(
      s1a.t1.ok && s1a.t1.h.ditambah === 1 && s1a.hasil.antre && hapusH === "ok" && (await db.penawaranPenjualan.count({ where: { id: pnwH.id } })) === 0 && sisaH.length === 3 && sisaH.every((b) => b.sumberPenawaranId === null),
      `S1a sinkron (menambah 1 baris) dan hapus penawaran serentak: hapus menunggu sinkron lalu berhasil, 3 baris anggaran tetap dengan sumber dikosongkan (sinkron=[${s1a.t1.ok ? `ditambah ${s1a.t1.h.ditambah}` : s1a.t1.pesan}] hapus=[${hapusH}] antre=${s1a.hasil.antre})`,
    );
    // S1b: ubah penawaran saat sinkron sedang berjalan menunggu sinkron selesai (FOR SHARE), jadi sinkron tidak memakai
    // isi yang berubah di tengah jalan. Sesudahnya dokumen basi dan sinkron berikutnya menyamakannya.
    const pnwU = await pnwBaru(4_200_000);
    const s1b = await sinkronDitahan(p3, { jenis: "penawaran", id: pnwU.id }, "findMany", async (pid) => {
      const ubah = aksi(() => sebagai("owner", () => ubahPenawaran(pnwU.id, formulir({ pelangganId: pelanggan.id, proyekId: p3.id, baris: [{ barangId: bSound.id, jumlah: 1, harga: 4_300_000 }, { barangId: bLights.id, jumlah: 1, harga: 1_000_000 }] }))));
      const antre = await tungguAntre(pid, 1, 120);
      return { ubah, antre };
    });
    const ubahU = await s1b.hasil.ubah;
    const statusU = await statusSinkronAnggaran(db, p3.id);
    pastikan(s1b.t1.ok && s1b.hasil.antre && ubahU === "ok" && statusU.get(`penawaran:${pnwU.id}`)?.basi === true, `S1b ubah penawaran menunggu sinkron yang sedang berjalan, lalu tersimpan dan dokumen basi (sinkron=[${s1b.t1.ok ? "ok" : s1b.t1.pesan}] ubah=[${ubahU}] antre=${s1b.hasil.antre})`);
    await jalankan("sinkron sesudah ubah", () => sinkron(p3.id, `penawaran:${pnwU.id}`));
    const soundU = await db.barisAnggaranProyek.findFirstOrThrow({ where: { sumberPenawaranId: pnwU.id, kunciSumber: "sound kpa||1" } });
    pastikan((await statusSinkronAnggaran(db, p3.id)).get(`penawaran:${pnwU.id}`)?.basi === false && D(soundU.nilaiAcuan).equals(D(4_300_000)), "sinkron berikutnya memakai isi terbaru (acuan Sound 4,3 juta) dan tidak basi");

    console.log("=== B9. Sinkron ditolak dan sinkron dari pesanan ===");
    await jalankan("PNW proyek dua", () => sebagai("owner", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, proyekId: p2.id, baris: [{ barangId: bLights.id, jumlah: 1, harga: 1_000_000 }] }))));
    const pnw2 = await db.penawaranPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id, proyekId: p2.id } });
    nomorDokumen.push(pnw2.nomor);
    await harusDitolak("penawaran proyek lain", () => sinkron(p1.id, `penawaran:${pnw2.id}`), `Dokumen ${pnw2.nomor} bukan milik proyek ${AWALAN}-PRJ-1`);
    await harusDitolak("sumber tidak dikenal", () => sinkron(p1.id, `faktur:${pnw.id}`), "Pilih penawaran atau pesanan sumber anggaran");
    await harusDitolak("dokumen tidak ada", () => sinkron(p1.id, "penawaran:tidak-ada"), "Dokumen tidak ditemukan");
    await harusDitolak("KASIR sinkron", () => sinkron(p1.id, `penawaran:${pnw.id}`, "kasir"), "tidak punya hak");
    const pnwKosong = await db.penawaranPenjualan.create({ data: { nomor: `${AWALAN}-PNW-KOSONG`, pelangganId: pelanggan.id, proyekId: p2.id, tanggal: new Date(), total: 0 } });
    await harusDitolak("dokumen tanpa baris", () => sinkron(p2.id, `penawaran:${pnwKosong.id}`), `Dokumen ${AWALAN}-PNW-KOSONG tidak punya baris`);
    await db.penawaranPenjualan.delete({ where: { id: pnwKosong.id } });
    if (punyaHak("ADMIN", "anggaran-proyek.buat") && punyaHak("ADMIN", "penawaran.lihat")) {
      const kunci = { peran_hak: { peran: "ADMIN" as const, hak: "penawaran.lihat" } };
      const lama = await db.hakAksesPeran.findUnique({ where: kunci });
      await db.hakAksesPeran.upsert({ where: kunci, create: { peran: "ADMIN", hak: "penawaran.lihat", boleh: false }, update: { boleh: false } });
      try {
        await harusDitolak("ADMIN tanpa penawaran.lihat", () => sinkron(p1.id, `penawaran:${pnw.id}`, "admin"), "tidak punya hak");
      } finally {
        if (lama) await db.hakAksesPeran.update({ where: kunci, data: { boleh: lama.boleh } });
        else await db.hakAksesPeran.deleteMany({ where: { peran: "ADMIN", hak: "penawaran.lihat" } });
      }
    } else console.log("[lewati] ADMIN tanpa anggaran-proyek.buat atau penawaran.lihat bawaan");
    // dokumen berbeda perusahaan dengan proyek ditolak (dipasang sementara lalu dipulihkan)
    const X = (await db.perusahaan.create({ data: { kode: `${AWALAN}X`, nama: "PT Uji KPA X", urutan: 95 } })).id;
    await db.penawaranPenjualan.update({ where: { id: pnw2.id }, data: { perusahaanId: X } });
    try {
      await harusDitolak("dokumen berbeda perusahaan dengan proyek", () => sinkron(p2.id, `penawaran:${pnw2.id}`), "berbeda perusahaan dengan proyek");
    } finally {
      await db.penawaranPenjualan.update({ where: { id: pnw2.id }, data: { perusahaanId: p2.perusahaanId } });
    }
    await jalankan("konversi PNW ke PSJ", () => sebagai("owner", () => konversiPenawaranKePesanan(pnw.id)));
    const psj = await db.pesananPenjualan.findFirstOrThrow({ where: { penawaranId: pnw.id } });
    nomorDokumen.push(psj.nomor);
    const sumberPsj = (await muatBarisSumber(db, "pesanan", psj.id))!;
    await jalankan("impor dari PSJ", () => sinkron(p1.id, `pesanan:${psj.id}`));
    const dariPsj = await db.barisAnggaranProyek.findMany({ where: { sumberPesananId: psj.id } });
    log = await logTerakhir();
    pastikan(dariPsj.length === sumberPsj.baris.length && dariPsj.length > 0 && log.aksi === "IMPOR" && dariPsj.every((b) => b.sumberPenawaranId === null), `impor dari pesanan: ${dariPsj.length} baris, terpisah dari baris penawaran`);
    pastikan(uang(dariPsj.reduce((s, b) => s.plus(D(b.nilaiAcuan)), D(0))).equals(uang(sumberPsj.baris.reduce((s, b) => s.plus(b.nilai), D(0)))), "acuan baris pesanan = nilaiBaris pesanan");

    console.log("=== Konsistensi perusahaan sumber impor (KONTRAK P34) ===");
    const anakInduk = async (k: Parameters<typeof periksaKonsistensiPerusahaan>[0]) => (await periksaKonsistensiPerusahaan(k)).rincian.find((r) => r.kode === "ANAK_INDUK")!.jumlah;
    const awalKons = await anakInduk(db);
    await jalankan("impor PNW proyek dua", () => sinkron(p2.id, `penawaran:${pnw2.id}`));
    const nSumber = await db.barisAnggaranProyek.count({ where: { sumberPenawaranId: pnw2.id } });
    pastikan((await anakInduk(db)) === awalKons && nSumber === 1, "sumber satu perusahaan dengan proyek: ANAK_INDUK tetap");
    await db
      .$transaction(async (tx) => {
        await tx.penawaranPenjualan.update({ where: { id: pnw2.id }, data: { perusahaanId: X } });
        pastikan((await anakInduk(tx)) === awalKons + nSumber, `penawaran sumber pindah perusahaan: ANAK_INDUK bertambah ${nSumber}`);
        throw new Error(BATAL);
      })
      .catch((e: Error) => {
        if (e.message !== BATAL) throw e;
      });

    console.log("=== Ganti perusahaan proyek dengan baris anggaran dari dokumen yang pindah proyek (tinjauan P34 R1) ===");
    // pnw2 diimpor ke proyek dua lalu dipindah ke proyek tiga; baris anggaran proyek dua tetap menunjuk pnw2
    await db.penawaranPenjualan.update({ where: { id: pnw2.id }, data: { proyekId: p3.id } });
    try {
      pastikan(!(await statusSinkronAnggaran(db, p2.id)).has(`penawaran:${pnw2.id}`) && (await db.barisAnggaranProyek.count({ where: { proyekId: p2.id, sumberPenawaranId: pnw2.id } })) === nSumber, "statusSinkronAnggaran tidak mencantumkan dokumen yang sudah pindah proyek; barisnya tetap");
      await harusDitolak(
        "proyek dua dipindah ke perusahaan X",
        () => sebagai("owner", () => ubahDataInduk("proyek", p2.id, formulir({ kode: p2.kode, nama: p2.nama, status: "BERJALAN", perusahaanId: X }))),
        `Proyek ${AWALAN}-PRJ-2 punya baris anggaran yang bersumber dokumen`,
      );
      pastikan((await db.proyek.findUniqueOrThrow({ where: { id: p2.id } })).perusahaanId === p2.perusahaanId, "perusahaan proyek dua tidak berubah");
    } finally {
      await db.penawaranPenjualan.update({ where: { id: pnw2.id }, data: { proyekId: p2.id } });
    }
  } finally {
    await bersihkanDokumen();
    await bersihkanData();
    // kategori dan pemetaan yang tidak ada saat mulai dibuang, nama kategori lama dipulihkan
    await db.akunKategoriAnggaran.deleteMany({ where: { akunId: { notIn: [...pemetaanAwal.keys()] } } });
    for (const [akunId, kategoriId] of pemetaanAwal) await db.akunKategoriAnggaran.upsert({ where: { akunId }, create: { akunId, kategoriId }, update: { kategoriId } });
    await db.barisAnggaranProyek.deleteMany({ where: { kategoriId: { notIn: [...kategoriAwal.keys()] }, proyek: { kode: { startsWith: `${AWALAN}-` } } } });
    await db.kategoriAnggaran.deleteMany({ where: { id: { notIn: [...kategoriAwal.keys()] }, barisAnggaran: { none: {} } } });
    for (const k of kategoriAwal.values()) await db.kategoriAnggaran.updateMany({ where: { id: k.id }, data: { nama: k.nama, namaKunci: k.namaKunci } });
    await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulai }, OR: [{ modul: "anggaran-proyek" }, { nomor: { in: nomorDokumen } }, { nomor: { startsWith: AWALAN } }] } });
  }
  pastikan((await db.kategoriAnggaran.count()) === kategoriAwal.size && (await db.akunKategoriAnggaran.count()) === pemetaanAwal.size, "kategori dan pemetaan kembali seperti awal");
  pastikan((await db.hakAksesPeran.count()) === hakAwal && (await db.proyek.count({ where: { kode: { startsWith: `${AWALAN}-` } } })) === 0 && (await db.penawaranPenjualan.count({ where: { pelanggan: { kode: `${AWALAN}-CUST` } } })) === 0, "HakAksesPeran sama dengan awal, data uji terhapus");
  console.log("=== DONE, all anggaran proyek checks passed ===");
}

const BATAL = "batal-uji";

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
