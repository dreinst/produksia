import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import type { PeranPengguna, Prisma } from "../src/prisma-klien/client";
import { D, type Desimal } from "../src/lib/uang";
import { HAK_BAWAAN, punyaHak, type Hak } from "../src/lib/hakAkses";
import { penggunaSaatIni } from "../src/lib/otentikasi";
import { periksaSinkron } from "../src/lib/sinkron";
import { terapkanBaganAkunStandar } from "../src/lib/baganAkun";
import { KATEGORI_BAWAAN, muatPetaKategori, terapkanKategoriAnggaranBawaan } from "../src/lib/kategoriAnggaran";
import { bagiMargin, hitungBagiHasil, statusBayarMitra, PERINGATAN_BELUM_ADA_MARGIN, PERINGATAN_NOMINAL_MELEBIHI, type MitraBagi } from "../src/lib/bagiHasil";
import { PENGHITUNG_MODUL_PROYEK, penghitungTerlihat } from "../src/lib/hitunganModulProyek";
import { daftarDokumenMitra, daftarKeuanganProyek, daftarProyekUntukHalaman, kunciBarisProyek, rincianRealisasi, ringkasanKeuanganProyek } from "../src/lib/keuanganProyek";
import { ringkasanProyek, daftarProyekAktif } from "../src/lib/proyek";
import { kunciBarisMitra, sisaModalMitra } from "../src/lib/jurnalMitra";
import { buatPembayaranMitra, buatTalanganMitra, hapusMitraProyek, pindahUrutanMitra, tambahMitraProyek, ubahMitraProyek } from "../src/lib/aksi/bagiHasil";
import { ubahTampilanProyek } from "../src/lib/aksi/proyek";
import { simpanPemetaanKategori, tambahKategoriAnggaran } from "../src/lib/aksi/kategoriAnggaran";
import { buatFaktur, buatPenawaran, buatPenerimaan, konversiPenawaranKePesanan } from "../src/lib/aksi/penjualan";
import { buatKasKeluar } from "../src/lib/aksi/jurnal";
import { hapusDataInduk, ubahDataInduk } from "../src/lib/aksi/dataInduk";
import { bukaPembatasanProyek, simpanAksesBerkasProyek } from "../src/lib/aksi/berkas";
import { ajukanDokumen, setujuiDokumen } from "../src/lib/aksi/persetujuan";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { aturPersetujuan, formulir, harusDitolak, jalankan, pastikan, sebagai } from "./bantuan";

/*
 * Uji mitra, bagi hasil, dan ringkasan keuangan proyek (P35, D5 §9.1). Bagian A fungsi murni bagi hasil (A1 sampai A7,
 * ditunda dari P34). Bagian B alur basis data: B0 persiapan, B1 tampilan proyek, B2 validasi proyek lewat data induk,
 * B3 tanda pembatasan berkas di data /proyek, B6 dan B7 ringkasan, realisasi, dan ember kategori, B10 mitra, B11
 * talangan, B12 contoh B, B13 pembayaran (termasuk dua pengembalian modal serentak saat buat), B14 urutan hapus, B15
 * persetujuan, B16 bawaan hak, B17 hitungan modul, B18 daftar keuangan per perusahaan, B21 log, B22 bersih-bersih, dan
 * uji serentak pola E (KONTRAK-TAMBAHAN, urutan kunci keuangan proyek). B4, B5, B8, B9, B19 ada di uji-anggaran-proyek
 * (P34); B20 (data laporan PDF) milik paket PDF laporan keuangan proyek.
 * Data uji berawalan KPU. Kategori dan pemetaan dipulihkan seperti awal, log dan notifikasi uji dibuang, dan
 * periksaSinkron sama di awal dan akhir. Tidak ada baris HakAksesPeran yang dibuat.
 */

const K = "KPU";
const P2 = "tapussa";
const juta = (n: number) => D(n * 1_000_000);
const sama = (a: Desimal | null | undefined, b: number | string) => !!a && D(a).equals(D(b));
const besok = () => {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  return d.toISOString().slice(0, 10);
};

async function aksi(k: () => Promise<unknown>): Promise<string> {
  try {
    await k();
    return "ok";
  } catch (e) {
    const p = String((e as Error)?.message ?? e);
    if (p.includes("static generation store missing") || p.includes("outside a request scope") || (e as { digest?: string })?.digest?.startsWith?.("NEXT_REDIRECT")) return "ok";
    return p;
  }
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

async function tungguAntre(pid: number, n: number) {
  for (let t = 0; t < 400; t++) {
    const [{ antre }] = await db.$queryRaw<{ antre: number }[]>`
      WITH RECURSIVE r(pid) AS (
        SELECT a.pid FROM pg_stat_activity a WHERE ${pid}::int = ANY(pg_blocking_pids(a.pid))
        UNION SELECT a.pid FROM pg_stat_activity a JOIN r ON r.pid = ANY(pg_blocking_pids(a.pid))
      ) SELECT count(*)::int AS antre FROM r`;
    if (antre >= n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`antrean kunci tidak mencapai ${n}`);
}

/**
 * Transaksi X memegang kunci baris proyek (kunciBarisProyek) lalu menulis baris mitra, pola E tinjauan P33 S1.
 * `tulisDulu`: mitra ditulis sebelum tahanan dilepas (X memegang proyek dan mitra), selain itu sesudahnya.
 */
async function pegangProyekTulisMitra<T>(proyekId: string, mitraId: string, tulisDulu: boolean, selagi: (pid: number) => Promise<T>): Promise<{ hasil: T; x: string }> {
  let lepas!: () => void;
  let siap!: (pid: number) => void;
  const tahan = new Promise<void>((r) => (lepas = r));
  const terkunci = new Promise<number>((r) => (siap = r));
  const tulis = (tx: Prisma.TransactionClient) => tx.$executeRaw`UPDATE "MitraProyek" SET "nilai" = "nilai" WHERE "id" = ${mitraId}`;
  const x = db
    .$transaction(
      async (tx) => {
        await kunciBarisProyek(tx, proyekId);
        if (tulisDulu) await tulis(tx);
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS "pid"`;
        siap(pid);
        await tahan;
        if (!tulisDulu) await tulis(tx);
      },
      { timeout: 60_000 },
    )
    .then(
      () => "ok",
      (e: Error) => e.message,
    );
  try {
    const hasil = await selagi(await terkunci);
    return { hasil, x: await (lepas(), x) };
  } finally {
    lepas();
    await x;
  }
}

// ---------- Bagian A: fungsi murni ----------

function bagianA() {
  const m = (id: string, mode: "PERSEN" | "NOMINAL", nilai: number): MitraBagi => ({ id, nama: id, mode, nilai: D(nilai) });
  const kosong = new Map<string, Desimal>();
  const tanpaBayar = new Map<string, { modal: Desimal; laba: Desimal }>();

  console.log("=== A1. bagiMargin contoh A ===");
  const mitraA = [m("A", "NOMINAL", 1_000_000), m("B", "PERSEN", 30), m("C", "PERSEN", 20)];
  const real = bagiMargin(mitraA, D(6_500_000));
  pastikan(sama(real.bagian.get("A"), 1_000_000) && sama(real.bagian.get("B"), 1_650_000) && sama(real.bagian.get("C"), 1_100_000) && sama(real.perusahaan, 2_750_000) && sama(real.setelahTetap, 5_500_000), "A1 realisasi 6,5 juta: A 1.000.000, B 1.650.000, C 1.100.000, perusahaan 2.750.000, setelah tetap 5.500.000");
  const est = bagiMargin(mitraA, D(6_000_000));
  pastikan(sama(est.bagian.get("A"), 1_000_000) && sama(est.bagian.get("B"), 1_500_000) && sama(est.bagian.get("C"), 1_000_000) && sama(est.perusahaan, 2_500_000) && sama(est.setelahTetap, 5_000_000), "A1 estimasi 6 juta: 1.000.000 / 1.500.000 / 1.000.000 / perusahaan 2.500.000, setelah tetap 5.000.000");
  const rugi = bagiMargin(mitraA, D(-2_000_000));
  pastikan(sama(rugi.perusahaan, 0) && [...rugi.bagian.values()].every((x) => x.isZero()), "basis negatif: rugi tidak dibagi");

  console.log("=== A2. hitungBagiHasil contoh A dengan pembayaran laba ===");
  const angkaA = { marginRencana: D(6_000_000), marginKas: D(6_500_000), diterima: juta(10), aktual: D(3_500_000) };
  const bayarA = new Map([
    ["B", { modal: D(0), laba: juta(1) }],
    ["C", { modal: D(0), laba: D(1_100_000) }],
    ["A", { modal: D(0), laba: juta(2) }],
  ]);
  const a2 = hitungBagiHasil(angkaA, mitraA, kosong, bayarA);
  const baris = (h: typeof a2, id: string) => h.mitra.find((x) => x.id === id)!;
  pastikan(sama(a2.perusahaan.total, 6_250_000) && sama(a2.perusahaan.modalKembali, 3_500_000) && sama(a2.penyelesaian.totalTerdistribusi, 10_000_000) && sama(a2.penyelesaian.totalHakMitra, 3_750_000), "A2 perusahaan 6.250.000 (modal 3.500.000 kembali penuh), hak mitra 3.750.000, terdistribusi 10.000.000");
  pastikan(baris(a2, "A").status === "LEBIH_BAYAR" && sama(baris(a2, "A").terutang, -1_000_000) && baris(a2, "B").status === "DIBAYAR_SEBAGIAN" && sama(baris(a2, "B").terutang, 650_000) && baris(a2, "C").status === "LUNAS" && sama(baris(a2, "C").terutang, 0), "A2 A lebih bayar (-1.000.000), B sebagian (650.000), C lunas");
  pastikan(sama(a2.dibayarTotal, 4_100_000) && sama(a2.terutangTotal, 650_000) && sama(a2.persenTotal, 50) && sama(a2.nominalTotal, 1_000_000) && a2.peringatan.length === 0, "A2 dibayar 4.100.000, terutang 650.000 (lebih bayar tidak mengurangi), persen 50, nominal 1.000.000, tanpa peringatan");

  console.log("=== A3. contoh B ===");
  const mitraB = [m("B", "PERSEN", 30), m("A", "NOMINAL", 1_000_000)];
  const angkaB = { marginRencana: D(0), marginKas: D(4_500_000), diterima: juta(10), aktual: D(5_500_000) };
  const modalB = new Map([["B", juta(2)]]);
  const a3 = hitungBagiHasil(angkaB, mitraB, modalB, tanpaBayar);
  pastikan(sama(baris(a3, "A").realisasi, 1_000_000) && sama(baris(a3, "B").realisasi, 1_050_000) && sama(a3.perusahaan.realisasi, 2_450_000), "A3 A 1.000.000 (nominal lebih dulu walau urutan kedua), B 1.050.000, perusahaan 2.450.000");
  pastikan(sama(baris(a3, "B").totalHak, 3_050_000) && sama(baris(a3, "B").modalKembali, 2_000_000) && sama(a3.perusahaan.total, 5_950_000) && sama(a3.perusahaan.modalMasuk, 3_500_000) && sama(a3.penyelesaian.totalTerdistribusi, 10_000_000), "A3 hak B 3.050.000, perusahaan 5.950.000 (modal 3.500.000), terdistribusi 10.000.000");
  pastikan(sama(a3.penyelesaian.marginDibagi, 4_500_000) && sama(a3.penyelesaian.danaMitra, 2_000_000) && sama(a3.penyelesaian.danaPerusahaan, 3_500_000) && sama(a3.penyelesaian.persenModalKembali, "100.0") && sama(a3.penyelesaian.modalBelumKembali, 0), "A3 penyelesaian: margin dibagi 4.500.000, dana mitra 2 juta, perusahaan 3,5 juta, modal kembali 100,0%");
  const a3b = hitungBagiHasil(angkaB, mitraB, modalB, new Map([["B", { modal: juta(2), laba: D(0) }]]));
  pastikan(sama(baris(a3b, "B").modalTerutang, 0) && sama(baris(a3b, "B").labaTerutang, 1_050_000) && baris(a3b, "B").status === "DIBAYAR_SEBAGIAN", "A3 sesudah MODAL 2.000.000: modal terutang 0, laba terutang 1.050.000, sebagian dibayar");

  console.log("=== A4. contoh C ===");
  const a4 = hitungBagiHasil({ marginRencana: D(0), marginKas: D(-3_000_000), diterima: juta(1), aktual: juta(4) }, [m("B", "PERSEN", 50)], new Map([["B", D(2_500_000)]]), tanpaBayar);
  pastikan(a4.rasio.equals(D("0.25")) && sama(baris(a4, "B").modalKembali, 625_000) && sama(a4.perusahaan.modalKembali, 375_000) && sama(baris(a4, "B").realisasi, 0) && baris(a4, "B").status === "PERLU_DIBAYAR", "A4 rasio 0,25: modal kembali B 625.000, perusahaan 375.000, laba 0, perlu dibayar");
  pastikan(sama(a4.penyelesaian.persenModalKembali, "25.0") && sama(a4.penyelesaian.modalBelumKembali, 3_000_000) && sama(a4.penyelesaian.totalTerdistribusi, 1_000_000), "A4 modal kembali 25,0%, belum kembali 3.000.000, terdistribusi 1.000.000");
  pastikan(a4.peringatan.length === 2 && a4.peringatan[0] === PERINGATAN_BELUM_ADA_MARGIN && a4.peringatan[1].includes("proporsional (25%)"), `A4 peringatan 1 dan 3 dengan "(25%)" (${a4.peringatan.join(" | ")})`);

  console.log("=== A5. contoh D ===");
  const a5 = hitungBagiHasil({ marginRencana: D(0), marginKas: D(-2_500_000), diterima: juta(1), aktual: D(3_500_000) }, [m("A", "PERSEN", 50)], kosong, tanpaBayar);
  pastikan(baris(a5, "A").status === "BELUM_ADA_HAK" && sama(baris(a5, "A").totalHak, 0) && a5.peringatan.length === 1 && a5.peringatan[0] === PERINGATAN_BELUM_ADA_MARGIN, "A5 A belum ada hak, hanya peringatan 1");
  pastikan(a5.perusahaan.modalKembali.toFixed(2) === "1000000.00", `A5 modal kembali perusahaan tepat 1.000.000,00 (${a5.perusahaan.modalKembali.toFixed(2)})`);
  const a5b = hitungBagiHasil({ marginRencana: D(0), marginKas: D(-2_000_000), diterima: D(1_000_000), aktual: juta(3) }, [m("A", "PERSEN", 50)], new Map([["A", D(1_200_000)]]), tanpaBayar);
  pastikan(a5b.peringatan.some((p) => p.includes("proporsional (33,3%)")), `persen proporsional satu desimal format id-ID (${a5b.peringatan.join(" | ")})`);

  console.log("=== A6. contoh E dan tukar urutan ===");
  const angkaE = { marginRencana: D(0), marginKas: D(1_500_000), diterima: D(1_500_000), aktual: D(0) };
  const a6 = hitungBagiHasil(angkaE, [m("A", "NOMINAL", 1_000_000), m("B", "NOMINAL", 1_000_000), m("C", "PERSEN", 20)], kosong, tanpaBayar);
  pastikan(sama(baris(a6, "A").realisasi, 1_000_000) && sama(baris(a6, "B").realisasi, 500_000) && sama(baris(a6, "C").realisasi, 0) && sama(a6.perusahaan.realisasi, 0) && a6.peringatan.length === 1 && a6.peringatan[0] === PERINGATAN_NOMINAL_MELEBIHI, "A6 A 1.000.000, B 500.000, C 0, perusahaan 0, peringatan 2");
  const a6b = hitungBagiHasil(angkaE, [m("B", "NOMINAL", 1_000_000), m("A", "NOMINAL", 1_000_000), m("C", "PERSEN", 20)], kosong, tanpaBayar);
  pastikan(sama(baris(a6b, "B").realisasi, 1_000_000) && sama(baris(a6b, "A").realisasi, 500_000), "A6 B dipindah ke atas A: B 1.000.000, A 500.000");
  const lebihModal = hitungBagiHasil(angkaE, [m("A", "PERSEN", 10)], new Map([["A", D(100)]]), new Map([["A", { modal: D(200), laba: D(0) }]]));
  pastikan(lebihModal.peringatan.some((p) => p.includes("Pengembalian modal ke A melebihi talangannya")), "pengembalian modal melebihi talangan memberi peringatan per mitra");

  console.log("=== A7. statusBayarMitra di batas toleransi ===");
  const st = (h: number | string, b: number | string) => statusBayarMitra(D(h), D(b));
  pastikan(
    st(100, "100.5") === "LUNAS" && st(100, "100.51") === "LEBIH_BAYAR" && st(100, "99.5") === "LUNAS" && st(100, "99.49") === "DIBAYAR_SEBAGIAN" && st(0, 0) === "BELUM_ADA_HAK" && st(0, 1) === "LEBIH_BAYAR" && st(100, 0) === "PERLU_DIBAYAR",
    "A7 (100; 100,5) lunas, (100; 100,51) lebih bayar, (100; 99,5) lunas, (100; 99,49) sebagian, (0; 0) belum ada hak, (0; 1) lebih bayar, (100; 0) perlu dibayar",
  );
}

// ---------- Bersih-bersih ----------

async function bersihkanDokumen(): Promise<string[]> {
  const akunUji = (await db.akun.findMany({ where: { kode: { startsWith: `${K}-` } }, select: { id: true } })).map((a) => a.id);
  const proyekUji = (await db.proyek.findMany({ where: { kode: { startsWith: `PRJ-${K}` } }, select: { id: true } })).map((p) => p.id);
  const pelanggan = { pelanggan: { kode: `CUST-${K}` } };
  const terbaru = { orderBy: [{ tanggal: "desc" as const }, { nomor: "desc" as const }], select: { id: true, nomor: true } };
  const nomor: string[] = [];
  const hapus = async (jenis: Parameters<typeof hapusDokumen>[0], d: { id: string; nomor: string }) => {
    nomor.push(d.nomor);
    await jalankan(`hapus ${d.nomor}`, () => hapusDokumen(jenis, d.id)).catch((e: unknown) => console.warn(`[bersih] ${d.nomor} gagal dihapus: ${(e as Error).message}`));
  };
  for (const d of await db.pembayaranMitra.findMany({ where: { proyekId: { in: proyekUji } }, ...terbaru })) await hapus("pembayaranMitra", d);
  for (const d of await db.talanganMitra.findMany({ where: { proyekId: { in: proyekUji } }, ...terbaru })) await hapus("talanganMitra", d);
  for (const d of await db.dokumenKas.findMany({ where: { OR: [{ akunKasId: { in: akunUji } }, { akunLawanId: { in: akunUji } }] }, select: { id: true, nomor: true } })) await hapus("dokumenKas", d);
  // kas keluar dengan persetujuan mati langsung menjadi jurnal KAS_KELUAR tanpa DokumenKas
  for (const j of await db.jurnal.findMany({ where: { sumber: { in: ["KAS_MASUK", "KAS_KELUAR"] }, baris: { some: { akunId: { in: akunUji } } } }, select: { id: true, nomor: true } })) await hapus("jurnal", j);
  for (const d of await db.penerimaanPenjualan.findMany({ where: { faktur: pelanggan }, ...terbaru })) await hapus("penerimaan", d);
  for (const d of await db.fakturPenjualan.findMany({ where: pelanggan, ...terbaru })) await hapus("faktur", d);
  for (const d of await db.pesananPenjualan.findMany({ where: pelanggan, ...terbaru })) await hapus("pesanan", d);
  for (const d of await db.penawaranPenjualan.findMany({ where: pelanggan, ...terbaru })) await hapus("penawaran", d);
  return nomor;
}

async function bersihkanData() {
  await db.konten.deleteMany({ where: { judul: { startsWith: `${K} ` } } });
  await db.proyek.deleteMany({ where: { kode: { startsWith: `PRJ-${K}` } } });
  await db.barang.deleteMany({ where: { kode: { startsWith: `JSA-${K}` } } });
  await db.pelanggan.deleteMany({ where: { kode: `CUST-${K}` } });
  await db.akunKategoriAnggaran.deleteMany({ where: { akun: { kode: { startsWith: `${K}-` } } } });
  await db.akun.deleteMany({ where: { kode: { startsWith: `${K}-` } } });
  await db.kategoriAnggaran.deleteMany({ where: { namaKunci: { startsWith: "kpu " }, barisAnggaran: { none: {} } } });
}

async function main() {
  await bersihkanDokumen();
  await bersihkanData();
  aturPersetujuan(false);
  bagianA();

  const mulaiUji = new Date();
  const idLogAwal = new Set((await db.logAktivitas.findMany({ select: { id: true } })).map((l) => l.id));
  const jurnalAwal = await db.jurnal.count();
  const hakAwal = await db.hakAksesPeran.count();
  const kategoriAwal = new Map((await db.kategoriAnggaran.findMany({ select: { id: true, nama: true, namaKunci: true } })).map((k) => [k.id, k]));
  const pemetaanAwal = new Map((await db.akunKategoriAnggaran.findMany()).map((p) => [p.akunId, p.kategoriId]));
  let nomorDokumen: string[] = [];

  console.log("=== B0. Persiapan ===");
  const sinkronAwal = await periksaSinkron(db);
  pastikan(sinkronAwal.seimbang && sinkronAwal.hutangMitra.sinkron, "periksaSinkron awal seimbang, hutangMitra cocok");
  await terapkanBaganAkunStandar(db);
  await terapkanKategoriAnggaranBawaan(db);
  const kedua = await terapkanKategoriAnggaranBawaan(db);
  pastikan(kedua.kategoriDibuat === 0 && kedua.pemetaanDibuat === 0 && (await db.kategoriAnggaran.count({ where: { bawaan: true } })) === KATEGORI_BAWAAN.length, "kategori bawaan diterapkan, panggilan kedua (0, 0), sembilan kategori bawaan");

  const akun = (kode: string) => db.akun.findUniqueOrThrow({ where: { kode } });
  const [a1600, a1500, a1300, a1000, a1700, a2700, a1100] = await Promise.all(["5-1600", "5-1500", "5-1300", "5-1000", "5-1700", "2-1700", "1-1100"].map(akun));
  const kas = await db.akun.create({ data: { kode: `${K}-KAS`, nama: "Kas Uji Keuangan Proyek", jenis: "ASET", kasBank: true } });
  const bebanUji = await db.akun.create({ data: { kode: `${K}-BEBAN`, nama: "Beban Uji Keuangan Proyek", jenis: "BEBAN" } });
  const pelanggan = await db.pelanggan.create({ data: { kode: `CUST-${K}`, nama: "Klien Uji Keuangan Proyek" } });
  const jasa = await db.barang.create({ data: { kode: `JSA-${K}-1`, nama: "Jasa Uji Keuangan Proyek", jenis: "JASA", hargaBeli: 0, hargaJual: 1_000_000 } });
  const jasa2 = await db.barang.create({ data: { kode: `JSA-${K}-2`, nama: "Jasa Uji Bagi Hasil", jenis: "JASA", hargaBeli: 0, hargaJual: 1_000_000, perusahaanId: P2 } });
  const prj = await db.proyek.create({ data: { kode: `PRJ-${K}`, nama: "Event Uji Keuangan", pelangganId: pelanggan.id, tanggalMulai: new Date("2026-03-01T12:00:00") } });
  const prj2 = await db.proyek.create({ data: { kode: `PRJ-${K}2`, nama: "Event Uji Bagi Hasil", namaKlien: "Klien Teks", perusahaanId: P2, tanggalMulai: new Date("2026-02-01T12:00:00") } });
  const prj3 = await db.proyek.create({ data: { kode: `PRJ-${K}3`, nama: "Event Uji Arsip" } });
  const admin = await db.pengguna.findUniqueOrThrow({ where: { namaPengguna: "admin" } });
  const sP2Awal = await periksaSinkron(db, { perusahaanId: P2 });
  const log = { mitra: { BUAT: 0, UBAH: 0, URUTAN: 0, HAPUS: 0 }, talangan: 0, pembayaran: 0 };

  try {
    console.log("=== B1. Tampilan proyek ===");
    await jalankan("warna #2563EB dan nama klien", () => ubahTampilanProyek(prj.id, formulir({ warna: "#2563EB", namaKlien: "  Klien Bebas  " })));
    const t1 = await db.proyek.findUniqueOrThrow({ where: { id: prj.id } });
    pastikan(t1.warna === "#2563eb" && t1.namaKlien === "Klien Bebas", `warna disimpan huruf kecil, nama klien dipangkas (${t1.warna}, ${t1.namaKlien})`);
    await harusDitolak("warna merah", () => ubahTampilanProyek(prj.id, formulir({ warna: "merah" })), "Warna harus kode #rrggbb");
    await harusDitolak("nama klien 161 karakter", () => ubahTampilanProyek(prj.id, formulir({ namaKlien: "k".repeat(161) })), "Nama klien maksimal 160 karakter");
    pastikan(!punyaHak("KRU", "data-induk.tulis"), "KRU tanpa data-induk.tulis");
    await sebagaiPeran("KRU", () => harusDitolak("KRU ubah tampilan", () => ubahTampilanProyek(prj.id, formulir({ warna: "#000000" })), "tidak punya hak"));
    await jalankan("simpan ulang tanpa perubahan", () => ubahTampilanProyek(prj.id, formulir({ warna: "#2563eb", namaKlien: "Klien Bebas" })));
    await jalankan("kosongkan warna", () => ubahTampilanProyek(prj.id, formulir({ warna: "", namaKlien: "Klien Bebas" })));
    const logTampilan = await db.logAktivitas.findMany({ where: { waktu: { gte: mulaiUji }, aksi: "UBAH", jenis: "Proyek", nomor: prj.kode, modul: "proyek" }, orderBy: { waktu: "asc" } });
    pastikan(logTampilan.length === 2 && (await db.proyek.findUniqueOrThrow({ where: { id: prj.id } })).warna === null && (logTampilan[1].meta as { warna?: { dari: string; ke: null } }).warna?.dari === "#2563eb" && (logTampilan[1].meta as { warna?: { ke: null } }).warna?.ke === null && !("namaKlien" in (logTampilan[1].meta as object)), "dua log UBAH (simpan ulang tanpa perubahan tidak dicatat), warna kosong = null, meta dari/ke");

    console.log("=== B2. Validasi proyek lewat data induk ===");
    const isiProyek = (isian: Record<string, string>) => formulir({ kode: prj3.kode, nama: prj3.nama, status: "BERJALAN", ...isian });
    await harusDitolak("status AKTIF", () => ubahDataInduk("proyek", prj3.id, isiProyek({ status: "AKTIF" })), "Status proyek tidak dikenal");
    await harusDitolak("selesai sebelum mulai", () => ubahDataInduk("proyek", prj3.id, isiProyek({ tanggalMulai: "2026-05-02", tanggalSelesai: "2026-05-01" })), "Tanggal selesai tidak boleh sebelum tanggal mulai");
    await jalankan("BERJALAN ke DITUNDA", () => ubahDataInduk("proyek", prj3.id, isiProyek({ status: "DITUNDA" })));
    pastikan((await db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, aksi: "UBAH_STATUS", nomor: prj3.kode } })) === 1, "satu log UBAH_STATUS");
    await jalankan("DITUNDA ke DIARSIP", () => ubahDataInduk("proyek", prj3.id, isiProyek({ status: "DIARSIP" })));
    pastikan(!(await daftarProyekAktif(db)).some((p) => p.id === prj3.id) && (await daftarProyekAktif(db)).some((p) => p.id === prj.id), "daftarProyekAktif tidak memuat proyek DIARSIP");

    console.log("=== B3. Tanda pembatasan berkas di data /proyek ===");
    await jalankan("batasi berkas PRJ-KPU untuk ADMIN", () => simpanAksesBerkasProyek(prj.id, formulir({ peran: "ADMIN" })));
    const pemilik = (await penggunaSaatIni())!;
    const halP = await daftarProyekUntukHalaman(db, pemilik, { q: K });
    const halA = await sebagaiPeran("ADMIN", async () => daftarProyekUntukHalaman(db, (await penggunaSaatIni())!, { q: K }));
    pastikan(halP.baris.find((b) => b.id === prj.id)?.terbatas === true && halP.baris.find((b) => b.id === prj2.id)?.terbatas === false, "PEMILIK (berkas.akses-penuh): terbatas true untuk proyek berpembatasan, false untuk lainnya");
    pastikan(halA.baris.every((b) => b.terbatas === undefined) && halA.total === 3, "ADMIN: terbatas tidak diisi, tiga proyek uji");
    pastikan(halP.baris.find((b) => b.id === prj.id)?.klien === "Klien Uji Keuangan Proyek" && halP.baris.find((b) => b.id === prj2.id)?.klien === "Klien Teks", "klien: pelanggan dulu, lalu nama klien bebas");
    pastikan((await daftarProyekUntukHalaman(db, pemilik, { q: K }, "utama")).baris.every((b) => b.perusahaan.id === "utama") && (await daftarProyekUntukHalaman(db, pemilik, { q: K, lewati: 1, ambil: 1 })).baris.length === 1, "saring perusahaan dan paginasi");
    await jalankan("buka pembatasan", () => bukaPembatasanProyek(prj.id));

    console.log("=== B6. Ringkasan dan realisasi PRJ-KPU ===");
    await jalankan("PNW jasa 10.000.000", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, proyekId: prj.id, baris: [{ barangId: jasa.id, jumlah: 10, harga: 1_000_000 }] })));
    const pnw = await db.penawaranPenjualan.findFirstOrThrow({ where: { proyekId: prj.id } });
    let r = (await ringkasanKeuanganProyek(db, prj.id))!.ringkasan;
    pastikan(sama(r.dikutip, 10_000_000) && r.kontrak.isZero() && r.sumberPendapatan === "PENAWARAN", "penawaran draf: dikutip 10 juta, sumber PENAWARAN");
    await jalankan("konversi ke PSJ", () => konversiPenawaranKePesanan(pnw.id));
    const psj = await db.pesananPenjualan.findFirstOrThrow({ where: { penawaranId: pnw.id } });
    r = (await ringkasanKeuanganProyek(db, prj.id))!.ringkasan;
    pastikan(sama(r.kontrak, 10_000_000) && r.dikutip.isZero() && r.sumberPendapatan === "KONTRAK", "sesudah konversi: kontrak 10 juta, dikutip 0");
    await jalankan("FJ 10.000.000", () => buatFaktur(formulir({ pesananId: psj.id, baris: [{ barangId: jasa.id, jumlah: 10, harga: 1_000_000 }] })));
    const fj = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj.id } });
    r = (await ringkasanKeuanganProyek(db, prj.id))!.ringkasan;
    pastikan(sama(r.ditagih, 10_000_000) && sama(r.piutang, 10_000_000) && r.diterima.isZero(), "faktur disetujui belum dibayar: ditagih dan piutang 10 juta");
    await jalankan("KK 5-1600 2.500.000 (proyek)", () => buatKasKeluar(formulir({ akunKasId: kas.id, akunLawanId: a1600.id, jumlah: 2_500_000, keterangan: "Sewa venue uji", proyekId: prj.id })));
    await jalankan("KK 5-1500 1.000.000 (proyek)", () => buatKasKeluar(formulir({ akunKasId: kas.id, akunLawanId: a1500.id, jumlah: 1_000_000, keterangan: "Honor talent uji", proyekId: prj.id })));
    await jalankan("TRM sebesar total faktur", () => buatPenerimaan(formulir({ fakturId: fj.id, akunId: kas.id, jumlah: D(fj.total).toFixed(2) })));
    const kp = (await ringkasanKeuanganProyek(db, prj.id))!;
    r = kp.ringkasan;
    const lpj = (await ringkasanProyek(db, prj.id))!;
    pastikan(sama(r.diterima, 10_000_000) && r.piutang.isZero() && sama(r.aktual, 3_500_000) && sama(r.marginKas, 6_500_000) && sama(r.persenMarginKas, "65.0"), `diterima 10 juta, aktual 3,5 juta, margin kas 6,5 juta (65,0%) (${r.diterima}, ${r.aktual}, ${r.marginKas})`);
    pastikan(r.aktual.plus(r.bagiHasilDibayar).equals(lpj.labaRugi.totalBeban), `identitas aktual + bagi hasil dibayar = total beban LPJ (${r.aktual} + ${r.bagiHasilDibayar} = ${lpj.labaRugi.totalBeban})`);
    pastikan(kp.bagiHasil !== null && kp.bagiHasil.mitra.length === 0 && (await ringkasanKeuanganProyek(db, prj.id, { denganBagiHasil: false }))!.bagiHasil === null, "bagi hasil termuat (tanpa mitra), dan null bila diminta tanpa bagi hasil");
    const peta = await muatPetaKategori(db);
    const kat = new Map(r.kategori.map((x) => [x.kategoriId, x]));
    pastikan(sama(kat.get(peta.kategoriUntukAkun(a1600.id))?.aktual, 2_500_000) && sama(kat.get(peta.kategoriUntukAkun(a1500.id))?.aktual, 1_000_000), "realisasi per kategori mengikuti pemetaan akun 5-1600 dan 5-1500");
    const rinci = await rincianRealisasi(db, prj.id, pemilik);
    pastikan(rinci.length === 2 && rinci.reduce((s, b) => s.plus(b.jumlah), D(0)).equals(r.aktual) && rinci.every((b) => b.didanaiOleh === kp.proyek.perusahaan.nama) && rinci.every((b) => b.lampiran === 0 && !b.bagiHasil), `rincian realisasi: dua baris, Σ = aktual, lampiran 0 (${rinci.map((b) => `${b.akun.kode} ${b.jumlah} ${b.didanaiOleh}`).join("; ")})`);
    pastikan((await rincianRealisasi(db, prj.id)).every((b) => b.lampiran === null), "tanpa pengguna: jumlah lampiran tidak dihitung");

    console.log("=== B7. Ember kategori ===");
    await jalankan("kategori KPU Sound System", () => tambahKategoriAnggaran(formulir({ nama: "KPU Sound System" })));
    const katSound = await db.kategoriAnggaran.findUniqueOrThrow({ where: { namaKunci: "kpu sound system" } });
    await jalankan("petakan KPU-BEBAN", () => simpanPemetaanKategori(formulir({ [`kategori_${bebanUji.id}`]: katSound.id })));
    await jalankan("KK KPU-BEBAN 100.000 (proyek)", () => buatKasKeluar(formulir({ akunKasId: kas.id, akunLawanId: bebanUji.id, jumlah: 100_000, keterangan: "Sound uji", proyekId: prj.id })));
    r = (await ringkasanKeuanganProyek(db, prj.id))!.ringkasan;
    pastikan(sama(r.kategori.find((x) => x.kategoriId === katSound.id)?.aktual, 100_000) && r.kategori.find((x) => x.kategoriId === katSound.id)?.tanpaAnggaran === true, "KK KPU-BEBAN masuk KPU Sound System (tanpa anggaran)");
    await jalankan("cabut pemetaan KPU-BEBAN", () => simpanPemetaanKategori(formulir({ [`kategori_${bebanUji.id}`]: "" })));
    r = (await ringkasanKeuanganProyek(db, prj.id))!.ringkasan;
    pastikan(sama(r.kategori.find((x) => x.kategoriId === null)?.aktual, 100_000) && r.kategori.find((x) => x.kategoriId === null)?.nama === "Belum dikategorikan", "pemetaan dicabut: masuk Belum dikategorikan");
    pastikan(r.kategori.reduce((s, x) => s.plus(x.aktual), D(0)).equals(r.aktual) && sama(r.aktual, 3_600_000), "Σ baris kategori = aktual 3.600.000");

    console.log("=== B10. Mitra (PRJ-KPU2) ===");
    const tambah = async (label: string, isian: Record<string, string | number>) => {
      await jalankan(label, () => tambahMitraProyek(prj2.id, formulir(isian)));
      log.mitra.BUAT++;
    };
    await tambah("A nominal 1.000.000", { nama: "Mitra A", mode: "NOMINAL", nilai: 1_000_000 });
    await tambah("B persen 30", { nama: "Mitra B", mode: "PERSEN", nilai: 30 });
    await tambah("C persen 20", { nama: "Mitra C", mode: "PERSEN", nilai: 20, catatan: "Pemodal kecil" });
    const daftarMitra = () => db.mitraProyek.findMany({ where: { proyekId: prj2.id }, orderBy: [{ urutan: "asc" }, { dibuatPada: "asc" }, { id: "asc" }] });
    let mitra = await daftarMitra();
    const [mA, mB, mC] = mitra;
    pastikan(mitra.map((x) => `${x.nama}:${x.urutan}`).join() === "Mitra A:1,Mitra B:2,Mitra C:3", "urutan 1, 2, 3");
    await harusDitolak("D persen 60 (total 110%)", () => tambahMitraProyek(prj2.id, formulir({ nama: "Mitra D", mode: "PERSEN", nilai: 60 })), "Total persen mitra proyek ini menjadi 110%. Maksimal 100%");
    await harusDitolak("D persen 150", () => tambahMitraProyek(prj2.id, formulir({ nama: "Mitra D", mode: "PERSEN", nilai: 150 })), "Satu mitra persen tidak boleh lebih dari 100%");
    await harusDitolak("nilai 0", () => tambahMitraProyek(prj2.id, formulir({ nama: "Mitra D", mode: "NOMINAL", nilai: 0 })), "Nilai harus lebih dari 0");
    await harusDitolak("jenis bagian salah", () => tambahMitraProyek(prj2.id, formulir({ nama: "Mitra D", mode: "LAIN", nilai: 5 })), "Jenis bagian tidak dikenal");
    await harusDitolak("nama kosong", () => tambahMitraProyek(prj2.id, formulir({ nama: " ", mode: "PERSEN", nilai: 5 })), "Nama mitra wajib diisi");
    await harusDitolak("nama 121 karakter", () => tambahMitraProyek(prj2.id, formulir({ nama: "m".repeat(121), mode: "PERSEN", nilai: 5 })), "Nama mitra maksimal 120 karakter");
    await sebagaiPeran("ADMIN", () => harusDitolak("ADMIN tambah mitra (tanpa bagi-hasil.buat)", () => tambahMitraProyek(prj2.id, formulir({ nama: "Mitra D", mode: "PERSEN", nilai: 5 })), "tidak punya hak"));
    await jalankan("ubah C ke 25", () => ubahMitraProyek(prj2.id, mC.id, formulir({ nama: "Mitra C", mode: "PERSEN", nilai: 25 })));
    log.mitra.UBAH++;
    pastikan(sama((await db.mitraProyek.findUniqueOrThrow({ where: { id: mC.id } })).nilai, 25), "C sekarang 25%");
    await harusDitolak("ubah C ke 75 (total 105%)", () => ubahMitraProyek(prj2.id, mC.id, formulir({ nama: "Mitra C", mode: "PERSEN", nilai: 75 })), "menjadi 105%");
    await harusDitolak("ubah mitra lewat proyek lain", () => ubahMitraProyek(prj.id, mC.id, formulir({ nama: "Mitra C", mode: "PERSEN", nilai: 20 })), "Mitra tidak ditemukan di proyek ini");
    await jalankan("ubah C kembali ke 20", () => ubahMitraProyek(prj2.id, mC.id, formulir({ nama: "Mitra C", mode: "PERSEN", nilai: 20 })));
    log.mitra.UBAH++;
    await harusDitolak("A naik dari urutan teratas", () => pindahUrutanMitra(prj2.id, mA.id, "naik"), "Mitra sudah di urutan teratas");
    await harusDitolak("C turun dari urutan terbawah", () => pindahUrutanMitra(prj2.id, mC.id, "turun"), "Mitra sudah di urutan terbawah");
    await jalankan("B naik", () => pindahUrutanMitra(prj2.id, mB.id, "naik"));
    log.mitra.URUTAN++;
    mitra = await daftarMitra();
    pastikan(mitra.map((x) => `${x.nama}:${x.urutan}`).join() === "Mitra B:1,Mitra A:2,Mitra C:3", "tukar urutan tersimpan: B 1, A 2, C 3");

    console.log("=== B11. Talangan (PRJ-KPU2) ===");
    const mitraLain = await db.mitraProyek.create({ data: { proyekId: prj.id, nama: "Mitra Proyek Lain", nilai: 5, urutan: 1 } });
    const isiTalangan = (isian: Record<string, string | number>) => formulir({ mitraId: mB.id, akunBebanId: a1600.id, jumlah: 2_000_000, deskripsi: "Sewa venue ditalangi", vendor: "Gedung Uji", ...isian });
    await harusDitolak("mitra kosong", () => buatTalanganMitra(prj2.id, isiTalangan({ mitraId: "" })), "Mitra wajib dipilih");
    await harusDitolak("mitra proyek lain", () => buatTalanganMitra(prj2.id, isiTalangan({ mitraId: mitraLain.id })), "Mitra tidak ditemukan di proyek ini");
    await harusDitolak("akun 5-1000 (kelompok)", () => buatTalanganMitra(prj2.id, isiTalangan({ akunBebanId: a1000.id })), "harus akun Beban rinci");
    await harusDitolak("akun 5-1700", () => buatTalanganMitra(prj2.id, isiTalangan({ akunBebanId: a1700.id })), "Akun Bagi Hasil Mitra Proyek tidak boleh dipakai untuk talangan");
    await harusDitolak("akun ASET", () => buatTalanganMitra(prj2.id, isiTalangan({ akunBebanId: a1100.id })), "harus akun Beban rinci");
    await harusDitolak("jumlah 0", () => buatTalanganMitra(prj2.id, isiTalangan({ jumlah: 0 })), "Jumlah harus lebih dari 0");
    await harusDitolak("jumlah di atas 10 triliun", () => buatTalanganMitra(prj2.id, isiTalangan({ jumlah: "10000000000001" })), "Jumlah melebihi batas Rp 10 triliun");
    await harusDitolak("tanggal besok", () => buatTalanganMitra(prj2.id, isiTalangan({ tanggal: besok() })), "Tanggal tidak boleh di masa depan");
    await harusDitolak("tanggal rusak", () => buatTalanganMitra(prj2.id, isiTalangan({ tanggal: "2026-13-45" })), "Tanggal tidak valid");
    await harusDitolak("uraian kosong", () => buatTalanganMitra(prj2.id, isiTalangan({ deskripsi: "" })), "Uraian wajib diisi");
    await harusDitolak("uraian 201 karakter", () => buatTalanganMitra(prj2.id, isiTalangan({ deskripsi: "u".repeat(201) })), "Uraian maksimal 200 karakter");
    await harusDitolak("akun beban kosong", () => buatTalanganMitra(prj2.id, isiTalangan({ akunBebanId: "" })), "Akun beban wajib dipilih");
    await sebagaiPeran("KASIR", () => harusDitolak("KASIR buat talangan", () => buatTalanganMitra(prj2.id, isiTalangan({})), "tidak punya hak"));
    pastikan((await db.talanganMitra.count({ where: { proyekId: prj2.id } })) === 0, "penolakan tidak menyimpan talangan");
    await jalankan("talangan B 2.000.000 ke 5-1600", () => buatTalanganMitra(prj2.id, isiTalangan({})));
    log.talangan++;
    const tlm = await db.talanganMitra.findFirstOrThrow({ where: { proyekId: prj2.id }, include: { jurnal: { include: { baris: { orderBy: { debit: "desc" } } } } } });
    const jt = tlm.jurnal!;
    pastikan(tlm.nomor.startsWith("TLM-") && tlm.statusPersetujuan === "DISETUJUI" && tlm.perusahaanId === P2 && tlm.dicatatOlehNama.length > 0, `nomor ${tlm.nomor}, langsung disetujui (persetujuan mati), perusahaan proyek`);
    pastikan(jt.nomor.startsWith("JU-TLM") && jt.sumber === "MITRA_PROYEK" && jt.proyekId === prj2.id && jt.perusahaanId === P2 && jt.baris[0].akunId === a1600.id && sama(jt.baris[0].debit, 2_000_000) && jt.baris[1].akunId === a2700.id && sama(jt.baris[1].kredit, 2_000_000), "jurnal JU-TLM MITRA_PROYEK bertanda proyek: Dr 5-1600 / Cr 2-1700 2.000.000");
    pastikan((await periksaSinkron(db)).hutangMitra.sinkron && (await periksaSinkron(db, { perusahaanId: P2 })).hutangMitra.sinkron, "hutangMitra sinkron gabungan dan per perusahaan");
    pastikan((await ringkasanProyek(db, prj2.id))!.pengeluaran.bebanLain.some((b) => b.id === jt.id), "LPJ beban lain memuat jurnal talangan");
    await harusDitolak("hapus jurnal talangan dari Jurnal Umum", () => hapusDokumen("jurnal", jt.id), "jurnal otomatis");
    nomorDokumen.push(tlm.nomor);

    console.log("=== B12. Contoh B penuh (PRJ-KPU2) ===");
    await jalankan("hapus mitra C (belum punya dokumen)", () => hapusMitraProyek(prj2.id, mC.id));
    log.mitra.HAPUS++;
    await harusDitolak("hapus mitra lewat proyek lain", () => hapusMitraProyek(prj.id, mB.id), "Mitra tidak ditemukan di proyek ini");
    await jalankan("PNW 10.000.000 (PRJ-KPU2)", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, proyekId: prj2.id, perusahaanId: P2, baris: [{ barangId: jasa2.id, jumlah: 10, harga: 1_000_000 }] })));
    const pnw2 = await db.penawaranPenjualan.findFirstOrThrow({ where: { proyekId: prj2.id } });
    await jalankan("konversi ke PSJ", () => konversiPenawaranKePesanan(pnw2.id));
    const psj2 = await db.pesananPenjualan.findFirstOrThrow({ where: { penawaranId: pnw2.id } });
    await jalankan("FJ 10.000.000", () => buatFaktur(formulir({ pesananId: psj2.id, baris: [{ barangId: jasa2.id, jumlah: 10, harga: 1_000_000 }] })));
    const fj2 = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj2.id } });
    await jalankan("TRM sebesar total faktur", () => buatPenerimaan(formulir({ fakturId: fj2.id, akunId: kas.id, jumlah: D(fj2.total).toFixed(2) })));
    await jalankan("KK 5-1300 3.500.000 (PRJ-KPU2)", () => buatKasKeluar(formulir({ akunKasId: kas.id, akunLawanId: a1300.id, jumlah: 3_500_000, keterangan: "Produksi uji", proyekId: prj2.id, perusahaanId: P2 })));
    let k2 = (await ringkasanKeuanganProyek(db, prj2.id))!;
    let bh = k2.bagiHasil!;
    const bm = (id: string) => bh.mitra.find((x) => x.id === id)!;
    pastikan(sama(k2.ringkasan.diterima, 10_000_000) && sama(k2.ringkasan.aktual, 5_500_000) && sama(k2.ringkasan.marginKas, 4_500_000), `diterima 10 juta, aktual 5,5 juta, margin kas 4,5 juta (${k2.ringkasan.aktual})`);
    pastikan(bh.mitra.map((x) => x.nama).join() === "Mitra B,Mitra A" && sama(bm(mA.id).realisasi, 1_000_000) && sama(bm(mB.id).realisasi, 1_050_000) && sama(bh.perusahaan.realisasi, 2_450_000), "contoh B: A 1.000.000, B 1.050.000, perusahaan 2.450.000");
    pastikan(sama(bm(mB.id).modalMasuk, 2_000_000) && sama(bm(mB.id).totalHak, 3_050_000) && sama(bm(mA.id).totalHak, 1_000_000) && sama(bh.perusahaan.total, 5_950_000) && sama(bh.penyelesaian.totalTerdistribusi, 10_000_000), "hak B 3.050.000, A 1.000.000, perusahaan 5.950.000, terdistribusi 10.000.000");
    const rinci2 = await rincianRealisasi(db, prj2.id, pemilik);
    pastikan(rinci2.some((b) => b.didanaiOleh === "Mitra B (talangan)" && sama(b.jumlah, 2_000_000)) && rinci2.reduce((s, b) => s.plus(b.jumlah), D(0)).equals(k2.ringkasan.aktual), "rincian: talangan didanai Mitra B, Σ = aktual");

    console.log("=== B13. Pembayaran ===");
    const isiBayar = (isian: Record<string, string | number>) => formulir({ mitraId: mB.id, jenis: "MODAL", jumlah: 2_000_000, akunKasId: kas.id, catatan: "TRF uji", ...isian });
    await harusDitolak("MODAL 2.000.000,01 melebihi sisa", () => buatPembayaranMitra(prj2.id, isiBayar({ jumlah: "2000000.01" })), "Pengembalian modal melebihi sisa modal Mitra B (Rp 2.000.000)");
    await harusDitolak("jenis salah", () => buatPembayaranMitra(prj2.id, isiBayar({ jenis: "BONUS" })), "Jenis pembayaran tidak dikenal");
    await harusDitolak("akun bukan kas", () => buatPembayaranMitra(prj2.id, isiBayar({ akunKasId: a1600.id })), "Akun sumber harus akun kas/bank");
    await harusDitolak("akun kas kosong", () => buatPembayaranMitra(prj2.id, isiBayar({ akunKasId: "" })), "Akun kas/bank wajib dipilih");
    await sebagaiPeran("KASIR", () => harusDitolak("KASIR buat pembayaran", () => buatPembayaranMitra(prj2.id, isiBayar({})), "tidak punya hak"));
    // dua pengembalian serentak atas sisa 2.000.000: kunci baris mitra di transaksi buat membuat tepat satu yang lolos
    const serentak = await Promise.all([aksi(() => buatPembayaranMitra(prj2.id, isiBayar({ jumlah: 1_500_000 }))), aksi(() => buatPembayaranMitra(prj2.id, isiBayar({ jumlah: 1_500_000 })))]);
    pastikan(serentak.filter((x) => x === "ok").length === 1 && serentak.some((x) => x.includes("melebihi sisa modal Mitra B (Rp 500.000)")), `dua pengembalian 1.500.000 serentak saat buat: tepat satu lolos (${serentak.join(" | ")})`);
    const bymSerentak = await db.pembayaranMitra.findFirstOrThrow({ where: { mitraId: mB.id } });
    await jalankan("hapus pengembalian serentak", () => hapusDokumen("pembayaranMitra", bymSerentak.id));
    nomorDokumen.push(bymSerentak.nomor);
    log.pembayaran++;
    await jalankan("MODAL B 2.000.000", () => buatPembayaranMitra(prj2.id, isiBayar({})));
    log.pembayaran++;
    const bymModal = await db.pembayaranMitra.findFirstOrThrow({ where: { mitraId: mB.id, jenis: "MODAL" }, include: { jurnal: { include: { baris: { orderBy: { debit: "desc" } } } } } });
    pastikan(bymModal.nomor.startsWith("BYM-") && bymModal.jurnal!.nomor.startsWith("JU-BYM") && bymModal.jurnal!.baris[0].akunId === a2700.id && bymModal.jurnal!.baris[1].akunId === kas.id && sama(bymModal.jurnal!.baris[0].debit, 2_000_000), "JU-BYM Dr 2-1700 / Cr KPU-KAS 2.000.000");
    pastikan((await periksaSinkron(db)).hutangMitra.sinkron && (await sisaModalMitra(db, mB.id, { hanyaDisetujui: true })).isZero(), "hutangMitra sinkron, sisa modal B 0");
    const totalBebanSebelum = (await ringkasanProyek(db, prj2.id))!.labaRugi.totalBeban;
    await jalankan("LABA B 1.050.000", () => buatPembayaranMitra(prj2.id, isiBayar({ jenis: "LABA", jumlah: 1_050_000 })));
    log.pembayaran++;
    const bymLaba = await db.pembayaranMitra.findFirstOrThrow({ where: { mitraId: mB.id, jenis: "LABA" }, include: { jurnal: { include: { baris: { orderBy: { debit: "desc" } } } } } });
    pastikan(bymLaba.jurnal!.baris[0].akunId === a1700.id && bymLaba.jurnal!.baris[1].akunId === kas.id, "LABA: Dr 5-1700 / Cr kas");
    k2 = (await ringkasanKeuanganProyek(db, prj2.id))!;
    bh = k2.bagiHasil!;
    const lpj2 = (await ringkasanProyek(db, prj2.id))!;
    pastikan(bm(mB.id).status === "LUNAS" && sama(k2.ringkasan.aktual, 5_500_000) && sama(k2.ringkasan.bagiHasilDibayar, 1_050_000), "B lunas, aktual tetap 5.500.000, bagi hasil dibayar 1.050.000");
    pastikan(k2.ringkasan.aktual.plus(k2.ringkasan.bagiHasilDibayar).equals(lpj2.labaRugi.totalBeban) && lpj2.labaRugi.totalBeban.minus(totalBebanSebelum).equals(D(1_050_000)), `identitas LPJ tetap, total beban LPJ naik 1.050.000 (${lpj2.labaRugi.totalBeban})`);
    pastikan(bh.pembayaran.length === 2 && bh.pembayaran.every((p) => p.mitraId === mB.id), "daftar pembayaran disetujui di hasil bagi hasil");
    await jalankan("LABA A 2.000.000", () => buatPembayaranMitra(prj2.id, isiBayar({ mitraId: mA.id, jenis: "LABA", jumlah: 2_000_000 })));
    log.pembayaran++;
    bh = (await ringkasanKeuanganProyek(db, prj2.id))!.bagiHasil!;
    pastikan(bm(mA.id).status === "LEBIH_BAYAR" && sama(bm(mA.id).terutang, -1_000_000), "A lebih bayar (terutang -1.000.000)");
    const dokMitra = await daftarDokumenMitra(db, prj2.id);
    pastikan(dokMitra.talangan.length === 1 && dokMitra.pembayaran.length === 3, "daftarDokumenMitra: satu talangan, tiga pembayaran");

    console.log("=== B14. Urutan hapus ===");
    await harusDitolak("hapus mitra B (punya pembayaran)", () => hapusMitraProyek(prj2.id, mB.id), `Mitra Mitra B sudah punya pembayaran (${[bymModal.nomor, bymLaba.nomor].sort().join(", ")}). Hapus pembayarannya dulu`);
    await harusDitolak("hapus talangan B (sudah dikembalikan)", () => hapusDokumen("talanganMitra", tlm.id), "sudah dikembalikan sebagai modal");
    await jalankan("hapus BYM MODAL", () => hapusDokumen("pembayaranMitra", bymModal.id));
    await jalankan("hapus talangan", () => hapusDokumen("talanganMitra", tlm.id));
    await harusDitolak("hapus mitra B (masih ada BYM LABA)", () => hapusMitraProyek(prj2.id, mB.id), "sudah punya pembayaran");
    await jalankan("hapus BYM LABA B", () => hapusDokumen("pembayaranMitra", bymLaba.id));
    const tlmTahan = await db.talanganMitra.create({ data: { nomor: `TLM-${K}-TAHAN`, tanggal: new Date(), perusahaanId: P2, proyekId: prj2.id, mitraId: mB.id, akunBebanId: a1600.id, jumlah: 1, deskripsi: "draf uji", dicatatOlehNama: "Skrip Uji" } });
    await harusDitolak("hapus mitra B (punya draf talangan)", () => hapusMitraProyek(prj2.id, mB.id), `Mitra Mitra B sudah menalangi biaya proyek (${tlmTahan.nomor}). Hapus talangannya dulu`);
    await jalankan("hapus draf talangan", () => hapusDokumen("talanganMitra", tlmTahan.id));
    await jalankan("hapus mitra B", () => hapusMitraProyek(prj2.id, mB.id));
    log.mitra.HAPUS++;
    nomorDokumen.push(bymModal.nomor, bymLaba.nomor, tlmTahan.nomor);
    pastikan((await db.jurnal.count({ where: { id: { in: [jt.id, bymModal.jurnalId!, bymLaba.jurnalId!] } } })) === 0 && (await periksaSinkron(db)).hutangMitra.sinkron, "jurnal dokumen mitra B habis, hutangMitra sinkron");

    console.log("=== B15. Persetujuan ===");
    aturPersetujuan(true);
    try {
      await sebagai("owner", () => jalankan("owner buat talangan A 2.000.000 (draf)", () => buatTalanganMitra(prj2.id, isiTalangan({ mitraId: mA.id }))));
      log.talangan++;
      const tDraf = await db.talanganMitra.findFirstOrThrow({ where: { mitraId: mA.id } });
      nomorDokumen.push(tDraf.nomor);
      pastikan(tDraf.statusPersetujuan === "DRAFT" && tDraf.jurnalId === null && (await sisaModalMitra(db, mA.id, { hanyaDisetujui: false })).isZero(), "talangan draf: tanpa jurnal, tidak masuk modal mitra");
      await sebagai("owner", () => jalankan("owner ajukan talangan", () => ajukanDokumen("talanganMitra", tDraf.id)));
      await sebagai("owner", () => harusDitolak("owner menyetujui talangannya sendiri", () => setujuiDokumen("talanganMitra", tDraf.id), "tidak boleh menyetujui"));
      await sebagai("admin", () => jalankan("admin setujui talangan", () => setujuiDokumen("talanganMitra", tDraf.id)));
      pastikan((await db.talanganMitra.findUniqueOrThrow({ where: { id: tDraf.id } })).jurnalId !== null, "talangan disetujui admin: jurnal tercatat");
      await sebagai("admin", () => jalankan("admin buat MODAL draf 2.000.000", () => buatPembayaranMitra(prj2.id, isiBayar({ mitraId: mA.id }))));
      log.pembayaran++;
      const bDraf = await db.pembayaranMitra.findFirstOrThrow({ where: { mitraId: mA.id, jenis: "MODAL" } });
      nomorDokumen.push(bDraf.nomor);
      pastikan(bDraf.statusPersetujuan === "DRAFT" && bDraf.jurnalId === null, "pengembalian modal draf tanpa jurnal");
      await sebagai("admin", () => harusDitolak("MODAL draf kedua 1 (sisa sudah dipesan draf)", () => buatPembayaranMitra(prj2.id, isiBayar({ mitraId: mA.id, jumlah: 1 })), "melebihi sisa modal Mitra A (Rp 0)"));
      await sebagai("admin", () => jalankan("admin ajukan MODAL", () => ajukanDokumen("pembayaranMitra", bDraf.id)));
      await sebagai("admin", () => harusDitolak("admin setujui MODAL (tanpa pembayaran-mitra.setujui)", () => setujuiDokumen("pembayaranMitra", bDraf.id), "tidak punya hak"));
      await sebagai("owner", () => jalankan("owner hapus talangan selagi MODAL menunggu", () => hapusDokumen("talanganMitra", tDraf.id)));
      await sebagai("owner", () => harusDitolak("owner setujui MODAL sesudah talangan dihapus", () => setujuiDokumen("pembayaranMitra", bDraf.id), "melebihi sisa modal"));
      await sebagai("owner", () => jalankan("hapus MODAL menunggu", () => hapusDokumen("pembayaranMitra", bDraf.id)));
    } finally {
      aturPersetujuan(false);
    }

    console.log("=== Pola E. Proyek dipegang lalu mitra ditulis, berbarengan dengan setujui MODAL ===");
    await tambah("mitra E", { nama: "Mitra E", mode: "PERSEN", nilai: 10 });
    const mE = await db.mitraProyek.findFirstOrThrow({ where: { proyekId: prj2.id, nama: "Mitra E" } });
    await jalankan("talangan E 1.000.000", () => buatTalanganMitra(prj2.id, isiTalangan({ mitraId: mE.id, jumlah: 1_000_000 })));
    log.talangan++;
    const modalE = async () => {
      const d = await db.pembayaranMitra.create({ data: { nomor: `BYM-${K}-E${Date.now()}`, tanggal: new Date(), perusahaanId: P2, proyekId: prj2.id, mitraId: mE.id, jenis: "MODAL", jumlah: 100_000, akunKasId: kas.id, dicatatOlehNama: "Skrip Uji", statusPersetujuan: "MENUNGGU", diajukanOlehId: admin.id, diajukanPada: new Date() } });
      nomorDokumen.push(d.nomor);
      return d;
    };
    await sebagai("owner", async () => {
      // E1: X memegang proyek; setujui (kunci mitra, sisipan jurnal ber-proyekId) tidak boleh tertahan; X lalu menulis mitra
      const p1 = await modalE();
      const e1 = await pegangProyekTulisMitra(prj2.id, mE.id, false, () => Promise.race([aksi(() => setujuiDokumen("pembayaranMitra", p1.id)), new Promise<string>((r) => setTimeout(() => r("TERTAHAN"), 15_000))]));
      pastikan(e1.hasil === "ok" && e1.x === "ok", `E1 X pegang proyek, setujui MODAL selesai tanpa menunggu, X menulis mitra: setujui=[${e1.hasil}] X=[${e1.x}]`);
      // E2: X memegang proyek dan sudah menulis mitra; setujui menunggu kunci mitra lalu selesai sesudah X
      const p2 = await modalE();
      const e2 = await pegangProyekTulisMitra(prj2.id, mE.id, true, async (pid) => {
        const janji = aksi(() => setujuiDokumen("pembayaranMitra", p2.id));
        await tungguAntre(pid, 1);
        return { janji };
      });
      const h2 = await e2.hasil.janji;
      pastikan(h2 === "ok" && e2.x === "ok", `E2 X pegang proyek lalu mitra, setujui MODAL menunggu lalu selesai: setujui=[${h2}] X=[${e2.x}]`);
      // E3: aksi sungguhan ubahMitraProyek (proyek lalu mitra) berbarengan dengan setujui MODAL
      for (let i = 0; i < 3; i++) {
        const p = await modalE();
        const h = await Promise.all([aksi(() => ubahMitraProyek(prj2.id, mE.id, formulir({ nama: "Mitra E", mode: "PERSEN", nilai: 10 + i }))), aksi(() => setujuiDokumen("pembayaranMitra", p.id))]);
        log.mitra.UBAH++;
        pastikan(h.every((x) => x === "ok"), `E3 #${i} ubahMitraProyek dan setujui MODAL serentak, keduanya selesai (${h.join(" | ")})`);
      }
    });
    pastikan(sama(await sisaModalMitra(db, mE.id, { hanyaDisetujui: true }), 500_000) && (await periksaSinkron(db)).hutangMitra.sinkron, "sesudah pola E: lima pengembalian 100.000 disetujui, sisa 500.000, hutangMitra sinkron");

    console.log("=== Hapus proyek (catatan orkestrator sesudah P35) ===");
    await sebagai("owner", async () => {
      await harusDitolak("hapus proyek yang punya dokumen mitra, mitra, dan jurnal", () => hapusDataInduk("proyek", prj2.id), `Proyek PRJ-${K}2 masih punya`);
      // posting dokumen mitra memegang kunci mitra lalu menyisipkan jurnal ber-proyekId (FOR KEY SHARE Proyek). Hapus
      // proyek yang berjalan di tengahnya harus langsung ditolak dengan pesan jelas, tanpa menunggu kunci mitra dan
      // tanpa deadlock. Kode lama (DELETE langsung) menunggu kunci mitra lewat cascade lalu bertemu siklus ini.
      let lepas!: () => void;
      const tahan = new Promise<void>((r) => (lepas = r));
      let siap!: () => void;
      const terkunci = new Promise<void>((r) => (siap = r));
      const posting = db
        .$transaction(
          async (tx) => {
            await kunciBarisMitra(tx, mE.id);
            siap();
            await tahan;
            await tx.$queryRaw`SELECT 1 FROM "Proyek" WHERE "id" = ${prj2.id} FOR KEY SHARE`;
          },
          { timeout: 60_000 },
        )
        .then(
          () => "ok",
          (e: Error) => `${(e as { code?: string }).code ?? ""} ${e.message.split("\n").slice(-2).join(" ")}`,
        );
      await terkunci;
      const hapus = aksi(() => hapusDataInduk("proyek", prj2.id));
      const awalTunggu = await Promise.race([hapus, new Promise<string>((r) => setTimeout(() => r("TERTAHAN"), 5_000))]);
      lepas();
      const [hPosting, hHapus] = await Promise.all([posting, hapus]);
      pastikan(
        awalTunggu !== "TERTAHAN" && hHapus.includes(`Proyek PRJ-${K}2 masih punya`) && hPosting === "ok" && (await db.proyek.count({ where: { id: prj2.id } })) === 1,
        `hapus proyek selagi kunci mitra dipegang: langsung ditolak dengan pesan jelas, posting selesai (hapus=[${awalTunggu === "TERTAHAN" ? "TERTAHAN, lalu " : ""}${hHapus}] posting=[${hPosting}])`,
      );
      // pola skrip peninjau P35 (tinjau35b): buat talangan mitra dan hapus proyek serentak atas proyek bermitra tanpa
      // dokumen. Kode lama: DELETE proyek memegang Proyek lalu menunggu kunci mitra lewat cascade, sedangkan talangan
      // memegang mitra lalu menyisipkan jurnal ber-proyekId, jadi sebagian putaran berakhir deadlock.
      for (let i = 0; i < 6; i++) {
        const prjD = await db.proyek.create({ data: { kode: `PRJ-${K}-HD${i}`, nama: `Event Uji Hapus Serentak ${i}`, perusahaanId: P2 } });
        await jalankan(`mitra proyek HD${i}`, () => tambahMitraProyek(prjD.id, formulir({ nama: "Mitra HD", mode: "PERSEN", nilai: 5 })));
        log.mitra.BUAT++;
        const mD = await db.mitraProyek.findFirstOrThrow({ where: { proyekId: prjD.id } });
        const talangan = () => aksi(() => buatTalanganMitra(prjD.id, isiTalangan({ mitraId: mD.id, jumlah: 1_000 })));
        const hapusD = () => aksi(() => hapusDataInduk("proyek", prjD.id));
        const [hT, hH] = i % 2 === 0 ? await Promise.all([talangan(), hapusD()]) : (await Promise.all([hapusD(), talangan()])).reverse();
        if (hT === "ok") log.talangan++;
        pastikan(
          hT === "ok" && hH.includes(`Proyek PRJ-${K}-HD${i} masih punya`) && (await db.proyek.count({ where: { id: prjD.id } })) === 1,
          `putaran ${i}: buat talangan dan hapus proyek serentak tanpa deadlock, talangan tersimpan dan hapus ditolak jelas (talangan=[${hT.replace(/\s+/g, " ").slice(-160)}] hapus=[${hH.replace(/\s+/g, " ").slice(-160)}])`,
        );
        // talangan uji dibuang lagi supaya angka hutang mitra perusahaan kedua di B18 tetap
        for (const t of await db.talanganMitra.findMany({ where: { proyekId: prjD.id }, select: { id: true, nomor: true } })) {
          nomorDokumen.push(t.nomor);
          await jalankan(`hapus ${t.nomor}`, () => hapusDokumen("talanganMitra", t.id));
        }
      }
      // proyek tanpa anak tetap terhapus seperti dulu; data yang hanya menautkan proyek dikosongkan proyeknya
      const prjH = await db.proyek.create({ data: { kode: `PRJ-${K}-HPS`, nama: "Event Uji Hapus", perusahaanId: P2 } });
      const konten = await db.konten.create({ data: { judul: `${K} konten hapus proyek`, dibuatOlehNama: "Skrip Uji", proyekId: prjH.id, status: "DRAF" } });
      await jalankan("hapus proyek tanpa anak", () => hapusDataInduk("proyek", prjH.id));
      pastikan((await db.proyek.count({ where: { id: prjH.id } })) === 0 && (await db.konten.findUniqueOrThrow({ where: { id: konten.id } })).proyekId === null, "proyek tanpa anak terhapus, konten yang menautkannya dikosongkan proyeknya (perilaku lama)");
      await harusDitolak("hapus proyek yang sudah terhapus", () => hapusDataInduk("proyek", prjH.id), "Data tidak ditemukan");
    });

    console.log("=== B16. Bawaan hak ===");
    const ya = (peran: PeranPengguna, hak: Hak[]) => hak.every((h) => punyaHak(peran, h));
    const tidak = (peran: PeranPengguna, hak: Hak[]) => hak.every((h) => !punyaHak(peran, h));
    const semuaD5: Hak[] = ["anggaran-proyek.lihat", "anggaran-proyek.buat", "anggaran-proyek.ubah", "anggaran-proyek.hapus", "kategori-anggaran.ubah", "bagi-hasil.lihat", "bagi-hasil.buat", "bagi-hasil.ubah", "bagi-hasil.hapus", "talangan-mitra.lihat", "talangan-mitra.buat", "talangan-mitra.setujui", "talangan-mitra.hapus", "pembayaran-mitra.lihat", "pembayaran-mitra.buat", "pembayaran-mitra.setujui", "pembayaran-mitra.hapus"];
    pastikan(ya("PEMILIK", ["proyek.lihat", ...semuaD5]) && ya("SUPERADMIN", ["proyek.lihat", ...semuaD5]), "PEMILIK dan SUPERADMIN memegang semua hak D5");
    pastikan(
      ya("ADMIN", ["proyek.lihat", "anggaran-proyek.lihat", "anggaran-proyek.buat", "anggaran-proyek.ubah", "anggaran-proyek.hapus", "kategori-anggaran.ubah", "bagi-hasil.lihat", "talangan-mitra.lihat", "talangan-mitra.buat", "talangan-mitra.setujui", "talangan-mitra.hapus", "pembayaran-mitra.lihat", "pembayaran-mitra.buat"]) &&
        tidak("ADMIN", ["bagi-hasil.buat", "bagi-hasil.ubah", "bagi-hasil.hapus", "pembayaran-mitra.setujui", "pembayaran-mitra.hapus"]),
      "ADMIN: anggaran, kategori, lihat bagi hasil, seluruh talangan, lihat dan buat pembayaran; tanpa ketentuan mitra serta setujui dan hapus pembayaran",
    );
    pastikan(ya("KASIR", ["proyek.lihat"]) && tidak("KASIR", semuaD5), "KASIR hanya proyek.lihat");
    pastikan((["GUDANG", "KRU", "GUEST"] as PeranPengguna[]).every((p) => tidak(p, ["proyek.lihat", ...semuaD5])) && HAK_BAWAAN.KRU.length === 2 && HAK_BAWAAN.GUEST.length === 2, "GUDANG, KRU, GUEST tanpa hak D5; KRU dan GUEST tetap dua hak");
    pastikan((["SOSMED", "IKLAN", "DESAINER"] as PeranPengguna[]).every((p) => ya(p, ["proyek.lihat"]) && tidak(p, semuaD5)), "SOSMED, IKLAN, DESAINER hanya proyek.lihat");

    console.log("=== B17. Hitungan modul PRJ-KPU ===");
    await jalankan("PNW kedua (draf)", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, proyekId: prj.id, baris: [{ barangId: jasa.id, jumlah: 1, harga: 1_000_000 }] })));
    await db.konten.createMany({ data: [{ judul: `${K} konten draf`, dibuatOlehNama: "Skrip Uji", proyekId: prj.id, status: "DRAF" }, { judul: `${K} konten terbit`, dibuatOlehNama: "Skrip Uji", proyekId: prj.id, status: "TERBIT" }, { judul: `${K} konten arsip`, dibuatOlehNama: "Skrip Uji", proyekId: prj.id, status: "DRAF", diarsipkanPada: new Date() }] });
    const hit = (await daftarProyekUntukHalaman(db, pemilik, { q: `PRJ-${K}` })).baris.find((b) => b.id === prj.id)!.hitungan;
    const fjStatus = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fj.id }, select: { status: true, statusPersetujuan: true } });
    const fjTerbuka = fjStatus.status === "LUNAS" && fjStatus.statusPersetujuan === "DISETUJUI" ? 0 : 1;
    pastikan(hit.penawaran?.total === 2 && hit.penawaran.terbuka === 1, `penawaran total 2 terbuka 1 (${JSON.stringify(hit.penawaran)})`);
    pastikan(hit.faktur?.total === 1 && hit.faktur.terbuka === fjTerbuka && fjTerbuka === 0, `faktur total 1 terbuka 0 (lunas) (${JSON.stringify(hit.faktur)}, ${fjStatus.status})`);
    pastikan(hit.penerimaan?.total === 1 && hit.penerimaan.terbuka === 0 && hit.konten?.total === 2 && hit.konten.terbuka === 1 && hit.kampanye?.total === 0 && hit["tugas-desain"]?.total === 0, "penerimaan 1/0, konten 2/1 (arsip tidak dihitung), kampanye dan desain 0");
    const hitSosmed = await sebagaiPeran("SOSMED", async () => (await daftarProyekUntukHalaman(db, (await penggunaSaatIni())!, { q: `PRJ-${K}` })).baris[0].hitungan);
    pastikan(hitSosmed.faktur === undefined && hitSosmed.konten !== undefined && !punyaHak("SOSMED", "faktur.lihat"), "sesi tanpa faktur.lihat (SOSMED): kolom faktur tidak dihitung, konten tetap");
    pastikan(penghitungTerlihat(() => true).length === PENGHITUNG_MODUL_PROYEK.length && PENGHITUNG_MODUL_PROYEK.filter((p) => p.tautan).every((p) => p.tautan!("x").includes("?proyek=x")), "penghitung dan tautannya (hanya ke halaman yang membaca ?proyek=)");

    console.log("=== B18. Daftar keuangan per perusahaan ===");
    const dk = await daftarKeuanganProyek(db, { q: `PRJ-${K}` });
    const ids = dk.baris.map((b) => b.id);
    pastikan(ids.includes(prj.id) && ids.includes(prj2.id) && dk.total.aktual.equals(dk.baris.reduce((s, b) => s.plus(b.ringkasan.aktual), D(0))) && dk.total.diterima.equals(dk.baris.reduce((s, b) => s.plus(b.ringkasan.diterima), D(0))), "gabungan memuat PRJ-KPU dan PRJ-KPU2, total = Σ baris");
    pastikan(!(await daftarKeuanganProyek(db, { q: `PRJ-${K}` }, "utama")).baris.some((b) => b.id === prj2.id) && (await daftarKeuanganProyek(db, { q: `PRJ-${K}` }, P2)).baris.some((b) => b.id === prj2.id), "PRJ-KPU2 tidak muncul di utama, muncul di perusahaannya");
    const jurnalE = await db.talanganMitra.findFirstOrThrow({ where: { mitraId: mE.id }, include: { jurnal: { select: { perusahaanId: true } } } });
    const sP2 = await periksaSinkron(db, { perusahaanId: P2 });
    const sUt = await periksaSinkron(db, { perusahaanId: "utama" });
    pastikan(jurnalE.jurnal?.perusahaanId === P2 && sP2.hutangMitra.sinkron && sP2.hutangMitra.dokumen.minus(sP2Awal.hutangMitra.dokumen).equals(D(500_000)) && sUt.hutangMitra.sinkron, "jurnal talangan milik perusahaan proyek, periksaSinkron per perusahaan sinkron");

    console.log("=== B21. Log ===");
    const jumlahLog = (jenis: string, aksi: string) => db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, jenis, aksi, modul: "bagi-hasil" } });
    for (const [a, n] of Object.entries(log.mitra)) pastikan((await jumlahLog("Mitra Proyek", a)) === n, `log Mitra Proyek ${a} = ${n}`);
    pastikan((await jumlahLog("Talangan Mitra", "BUAT")) === log.talangan && (await jumlahLog("Pembayaran ke Mitra", "BUAT")) === log.pembayaran, `log BUAT talangan ${log.talangan} dan pembayaran ${log.pembayaran}`);
    const logT = await db.logAktivitas.findFirstOrThrow({ where: { waktu: { gte: mulaiUji }, jenis: "Talangan Mitra", aksi: "BUAT", nomor: tlm.nomor } });
    pastikan(logT.keterangan === `Mitra B menalangi 2.000.000 untuk Sewa venue ditalangi (${prj2.kode})` && logT.entitasId === tlm.id && logT.perusahaanId === P2, `keterangan log talangan (${logT.keterangan})`);
    const logB = await db.logAktivitas.findFirstOrThrow({ where: { waktu: { gte: mulaiUji }, jenis: "Pembayaran ke Mitra", aksi: "BUAT", nomor: bymLaba.nomor } });
    pastikan(logB.keterangan === `Bagi laba 1.050.000 ke Mitra B (${prj2.kode}) dari ${kas.kode} ${kas.nama}`, `keterangan log bagi laba (${logB.keterangan})`);
    const logM = await db.logAktivitas.findFirstOrThrow({ where: { waktu: { gte: mulaiUji }, jenis: "Mitra Proyek", aksi: "BUAT", nomor: prj2.kode }, orderBy: { waktu: "asc" } });
    pastikan(logM.entitasId === prj2.id && logM.perusahaanId === P2 && (logM.meta as { mode?: string }).mode === "NOMINAL", "log mitra: entitas proyek, perusahaan proyek, meta mitra");
  } finally {
    aturPersetujuan(false);
    nomorDokumen = [...nomorDokumen, ...(await bersihkanDokumen())];
    await bersihkanData();
    await db.akunKategoriAnggaran.deleteMany({ where: { akunId: { notIn: [...pemetaanAwal.keys()] } } });
    for (const [akunId, kategoriId] of pemetaanAwal) await db.akunKategoriAnggaran.upsert({ where: { akunId }, create: { akunId, kategoriId }, update: { kategoriId } });
    await db.kategoriAnggaran.deleteMany({ where: { id: { notIn: [...kategoriAwal.keys()] }, barisAnggaran: { none: {} } } });
    for (const k of kategoriAwal.values()) await db.kategoriAnggaran.updateMany({ where: { id: k.id }, data: { nama: k.nama, namaKunci: k.namaKunci } });
    const logBaru = (await db.logAktivitas.findMany({ where: { waktu: { gte: mulaiUji } }, select: { id: true } })).map((l) => l.id).filter((id) => !idLogAwal.has(id));
    await db.logAktivitas.deleteMany({ where: { id: { in: logBaru } } });
    for (const n of nomorDokumen) await db.notifikasi.deleteMany({ where: { dibuatPada: { gte: mulaiUji }, judul: { contains: n } } });
  }

  console.log("=== B22. Bersih-bersih ===");
  pastikan((await db.jurnal.count()) === jurnalAwal, "jumlah jurnal kembali seperti awal");
  pastikan((await db.proyek.count({ where: { kode: { startsWith: `PRJ-${K}` } } })) === 0 && (await db.akun.count({ where: { kode: { startsWith: `${K}-` } } })) === 0, "proyek dan akun uji terhapus");
  pastikan((await db.kategoriAnggaran.count()) === kategoriAwal.size && (await db.akunKategoriAnggaran.count()) === pemetaanAwal.size, "kategori dan pemetaan kembali seperti awal");
  pastikan((await db.hakAksesPeran.count()) === hakAwal, "HakAksesPeran sama dengan awal");
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(sinkronAkhir.seimbang && sinkronAkhir.hutangMitra.sinkron && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron seimbang dan sama dengan awal, termasuk hutangMitra");
  console.log("=== DONE, all keuangan-proyek checks passed ===");
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
