import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import type { Prisma } from "../src/prisma-klien/client";
import { D, type Desimal } from "../src/lib/uang";
import { periksaKonsistensiPerusahaan, periksaSinkron } from "../src/lib/sinkron";
import { catatJurnalFakturPenjualan } from "../src/lib/akuntansi";
import { nomorDokumenBerikutnya } from "../src/lib/penomoran";
import { buatPesanan, buatPengiriman, buatFaktur } from "../src/lib/aksi/penjualan";
import { buatPenyesuaianPersediaan } from "../src/lib/aksi/persediaan";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { aturPersetujuan, formulir, harusDitolak, jalankan, pastikan, sebagai } from "./bantuan";

/*
 * Perbaikan tinjauan P27 (KonsumsiSuratJalan): buatFaktur mencatat baris SJ yang dikonsumsi tiap baris faktur, dan
 * hapus faktur membalik persis catatan itu.
 *  t1. Skenario peninjau T1: SJ-B (harga pokok 40.000) lebih dulu dari SJ-A (60.000), faktur lama F0 (tanpa catatan)
 *      menagih A dan mengonsumsi SJ-B, F1 baris B mengonsumsi SJ-A yang yatim. Hapus F1 mengembalikan SJ-A, bukan SJ-B;
 *      dibuat ulang lalu dihapus lagi; F0 dibalik dengan cara lama.
 *  s2. Bug lama S2: faktur kedua yang belum dikirim (tanpa konsumsi) dihapus; SJ milik faktur pertama tetap terkonsumsi.
 *  s1. Dua faktur jalur ID serentak (baris B dan C) yang sama-sama kekurangan SJ tidak mengonsumsi SJ yatim yang sama.
 *  r2. Faktur serentak yang ternyata menutup pesanan berfee nominal ditolak karena fee prorata berubah.
 * Tiap bagian memeriksa periksaSinkron (seimbang, piutang dan barang terkirim sinkron) dan saldo transit tepat.
 * UJI_KONSUMSI_BAGIAN=t1|s2|s1|r2 menjalankan satu bagian saja. UJI_KONSUMSI_KODE_LAMA=1 melewati asersi tentang
 * tabel dan kolom baru (catatan konsumsi, konsumsiSjTercatat), supaya uji perilaku bisa dijalankan pada aksi sebelum
 * perbaikan dan gagal di asersi perilakunya (bukti di PERBAIKAN-P27.md).
 */

const K = "UKS";
const sama = (x: unknown, harap: number | string) => D(x as Desimal).equals(D(harap));
const hanya = process.env.UJI_KONSUMSI_BAGIAN;
const jalan = (bagian: string) => !hanya || hanya === bagian;
const kodeLama = process.env.UJI_KONSUMSI_KODE_LAMA === "1";
/** Asersi tentang catatan konsumsi; dilewati saat membuktikan kegagalan perilaku kode lama. */
const pastikanCatatan = (kondisi: () => unknown, pesan: string) => (kodeLama ? console.log(`[lewat] ${pesan}`) : pastikan(kondisi(), pesan));

async function bersihkan() {
  const pel = (await db.pelanggan.findMany({ where: { kode: { startsWith: `PLG-${K}` } }, select: { id: true } })).map((p) => p.id);
  const jurnalIds: string[] = [];
  const kumpul = (xs: { jurnalId: string | null }[]) => jurnalIds.push(...xs.flatMap((x) => (x.jurnalId ? [x.jurnalId] : [])));
  if (pel.length > 0) {
    const faktur = await db.fakturPenjualan.findMany({ where: { pelangganId: { in: pel } }, select: { id: true, jurnalId: true } });
    const pesanan = await db.pesananPenjualan.findMany({ where: { pelangganId: { in: pel } }, select: { id: true } });
    const sj = await db.pengirimanPesanan.findMany({ where: { pesananId: { in: pesanan.map((p) => p.id) } }, select: { id: true, jurnalId: true } });
    for (const xs of [faktur, sj]) kumpul(xs);
    // baris faktur dihapus lebih dulu: KonsumsiSuratJalan ikut terhapus (kaskade) sebelum baris SJ yang dirujuknya
    await db.pemakaianUangMuka.deleteMany({ where: { fakturId: { in: faktur.map((f) => f.id) } } });
    await db.barisFakturPenjualan.deleteMany({ where: { fakturId: { in: faktur.map((f) => f.id) } } });
    await db.fakturPenjualan.deleteMany({ where: { id: { in: faktur.map((f) => f.id) } } });
    await db.barisPengiriman.deleteMany({ where: { pengirimanId: { in: sj.map((s) => s.id) } } });
    await db.pengirimanPesanan.deleteMany({ where: { id: { in: sj.map((s) => s.id) } } });
    await db.barisPesananPenjualan.deleteMany({ where: { pesananId: { in: pesanan.map((p) => p.id) } } });
    await db.pesananPenjualan.deleteMany({ where: { id: { in: pesanan.map((p) => p.id) } } });
  }
  const barang = await db.barang.findMany({ where: { kode: { startsWith: `BRG-${K}` } }, select: { id: true } });
  const ps = await db.penyesuaianPersediaan.findMany({ where: { baris: { some: { barangId: { in: barang.map((b) => b.id) } } } }, select: { id: true, jurnalId: true } });
  kumpul(ps);
  await db.barisPenyesuaianPersediaan.deleteMany({ where: { penyesuaianId: { in: ps.map((p) => p.id) } } });
  await db.penyesuaianPersediaan.deleteMany({ where: { id: { in: ps.map((p) => p.id) } } });
  await db.barisJurnal.deleteMany({ where: { jurnalId: { in: jurnalIds } } });
  await db.jurnal.deleteMany({ where: { id: { in: jurnalIds } } });
  await db.stokBarang.deleteMany({ where: { barangId: { in: barang.map((b) => b.id) } } });
  await db.barang.deleteMany({ where: { id: { in: barang.map((b) => b.id) } } });
  await db.gudang.deleteMany({ where: { kode: `WH-${K}` } });
  await db.akun.deleteMany({ where: { kode: { startsWith: `UJI-${K}` } } });
  await db.pelanggan.deleteMany({ where: { kode: { startsWith: `PLG-${K}` } } });
}

/** Galat redirect atau revalidatePath di luar HTTP terjadi sesudah transaksi selesai, jadi dianggap sukses. */
async function aksi(k: () => Promise<unknown>): Promise<string> {
  try {
    await k();
    return "ok";
  } catch (e) {
    const digest = (e as { digest?: string })?.digest ?? "";
    const pesan = String((e as Error)?.message ?? e);
    return digest.startsWith("NEXT_REDIRECT") || pesan.includes("static generation store missing") ? "ok" : pesan;
  }
}

/** Menunggu sampai n sesi terhalang penahan, langsung atau lewat sesi lain yang juga menunggu (pola uji-baris-ganda). */
async function tungguAntre(pidPenahan: number, n: number) {
  for (let t = 0; t < 400; t++) {
    const [{ antre }] = await db.$queryRaw<{ antre: number }[]>`
      WITH RECURSIVE rantai(pid) AS (
        SELECT a.pid FROM pg_stat_activity a WHERE ${pidPenahan}::int = ANY(pg_blocking_pids(a.pid))
        UNION
        SELECT a.pid FROM pg_stat_activity a JOIN rantai r ON r.pid = ANY(pg_blocking_pids(a.pid))
      )
      SELECT count(*)::int AS "antre" FROM rantai`;
    if (antre >= n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`antrean kunci tidak mencapai ${n}`);
}

/**
 * Dua faktur berantre di belakang penahan lalu dilepas bersamaan. Nomor internal FJ dihitung di luar transaksi, jadi
 * sesudah faktur pertama menunggu, satu nomor sesudahnya dipesan dengan faktur pengganjal supaya faktur kedua mendapat
 * nomor lain (yang diuji di sini konsumsi SJ dan prorata, bukan bentrok nomor internal).
 */
async function duaSerentak(pegang: (tx: Prisma.TransactionClient) => Promise<unknown>, pelangganId: string, kerja: [() => Promise<unknown>, () => Promise<unknown>]) {
  let lepas!: () => void;
  let siap!: (pid: number) => void;
  const tahan = new Promise<void>((r) => (lepas = r));
  const terkunci = new Promise<number>((r) => (siap = r));
  const penahan = db.$transaction(
    async (tx) => {
      await pegang(tx);
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS "pid"`;
      siap(pid);
      await tahan;
    },
    { timeout: 60_000 },
  );
  const pid = await terkunci;
  const janji: Promise<string>[] = [];
  try {
    janji.push(aksi(kerja[0]));
    await tungguAntre(pid, 1);
    const berikut = await nomorDokumenBerikutnya(db.fakturPenjualan, "FJ");
    const awalan = berikut.slice(0, berikut.lastIndexOf("-") + 1);
    const nomorGanjal = `${awalan}${String(Number(berikut.slice(awalan.length)) + 1).padStart(4, "0")}`;
    await db.fakturPenjualan.create({ data: { nomor: nomorGanjal, pelangganId } });
    janji.push(aksi(kerja[1]));
    await tungguAntre(pid, 2);
  } finally {
    lepas();
    await penahan;
  }
  return Promise.all(janji);
}

type Konteks = { gudang: { id: string }; barang: { id: string }; jasa: { id: string }; pelanggan: { id: string }; modal: { id: string } };

async function main() {
  await bersihkan();
  aturPersetujuan(false);
  const mulaiUji = new Date();
  const sinkronAwal = await periksaSinkron(db);
  const jurnalAwal = await db.jurnal.count();
  try {
    const gudang = await db.gudang.create({ data: { kode: `WH-${K}`, nama: "Gudang Uji Konsumsi SJ" } });
    const barang = await db.barang.create({ data: { kode: `BRG-${K}`, nama: "Lampu Uji Konsumsi SJ", jenis: "BARANG", satuan: "unit", hargaBeli: 0, hargaJual: 100_000 } });
    const jasa = await db.barang.create({ data: { kode: `BRG-${K}-JASA`, nama: "Jasa Uji Konsumsi SJ", jenis: "JASA", satuan: "paket", hargaBeli: 0, hargaJual: 100 } });
    const pelanggan = await db.pelanggan.create({ data: { kode: `PLG-${K}`, nama: "Klien Uji Konsumsi SJ" } });
    const modal = await db.akun.create({ data: { kode: `UJI-${K}-MODAL`, nama: "Modal Uji Konsumsi SJ", jenis: "MODAL" } });
    const k: Konteks = { gudang, barang, jasa, pelanggan, modal };
    if (jalan("t1")) await bagianT1(k);
    if (jalan("s2")) await bagianS2(k);
    if (jalan("s1")) await bagianS1(k);
    if (jalan("r2")) await bagianR2(k);
    const konsistensi = await periksaKonsistensiPerusahaan(db);
    pastikan(konsistensi.rincian.find((r) => r.kode === "ANAK_INDUK")?.jumlah === 0, "periksaKonsistensiPerusahaan (termasuk KonsumsiSuratJalan lintas perusahaan) tanpa temuan ANAK_INDUK");
  } finally {
    await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji }, penggunaNama: "Skrip Uji" } });
    await bersihkan();
  }
  pastikan((await db.konsumsiSuratJalan.count({ where: { barisFaktur: { barang: { kode: { startsWith: `BRG-${K}` } } } } })) === 0, "catatan konsumsi uji sudah terhapus");
  pastikan((await db.jurnal.count()) === jurnalAwal, "jumlah jurnal sama dengan sebelum uji");
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron seimbang dan sama dengan sebelum uji");
  console.log("=== DONE, all konsumsi-sj checks passed ===");
}

// ---------- pembantu ----------

const stokSesudah = async (k: Konteks, label: string, jumlahSesudah: number, hargaSatuan: number) => {
  await jalankan(`PS ${label}: stok jadi ${jumlahSesudah} @ ${hargaSatuan}`, () =>
    buatPenyesuaianPersediaan(formulir({ gudangId: k.gudang.id, akunLawanId: k.modal.id, keterangan: `${K} ${label}`, baris: [{ barangId: k.barang.id, jumlahSesudah, hargaSatuan }] })),
  );
  return db.penyesuaianPersediaan.findFirstOrThrow({ where: { keterangan: `${K} ${label}` } });
};
const pesananBaru = async (k: Konteks, label: string, baris: { barangId: string; jumlah: number; harga: number }[], tambahan: Record<string, string | number> = {}) => {
  await jalankan(`PSJ ${label}`, () => buatPesanan(formulir({ pelangganId: k.pelanggan.id, ppnPersen: 0, ...tambahan, baris })));
  return db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: k.pelanggan.id }, orderBy: { nomor: "desc" }, include: { baris: { orderBy: [{ urutan: "asc" }, { id: "asc" }] } } });
};
const kirim = async (k: Konteks, pesananId: string, barisPesananId: string, label: string) => {
  await jalankan(`SJ ${label}`, () => buatPengiriman(formulir({ pesananId, gudangId: k.gudang.id, baris: [{ barisPesananId, barangId: k.barang.id, jumlah: 1 }] })));
  const sj = await db.pengirimanPesanan.findFirstOrThrow({ where: { pesananId, baris: { some: { barisPesananId } } }, orderBy: { nomor: "desc" }, include: { baris: true } });
  return { sj, baris: sj.baris[0] };
};
const fakturId = async (pesananId: string, baris: { barisPesananId: string; jumlah: number }[], label: string) => {
  await jalankan(label, () => buatFaktur(formulir({ pesananId, ppnPersen: 0, baris })));
  // F0 (data lama) bernomor UKS-FJ0, jadi faktur terbaru dicari menurut tanggal
  return db.fakturPenjualan.findFirstOrThrow({ where: { pesananId }, orderBy: [{ tanggal: "desc" }, { nomor: "desc" }], include: { baris: { include: { konsumsiSj: true } } } });
};
const difaktur = async (barisSjId: string) => D((await db.barisPengiriman.findUniqueOrThrow({ where: { id: barisSjId } })).jumlahDifaktur);
const difakturBp = async (id: string) => D((await db.barisPesananPenjualan.findUniqueOrThrow({ where: { id } })).jumlahDifaktur);
/** periksaSinkron seimbang, piutang dan barang terkirim sinkron; mengembalikan saldo buku besar barang terkirim. */
const sinkron = async (label: string) => {
  const s = await periksaSinkron(db);
  pastikan(
    s.seimbang && s.piutang.sinkron && s.barangTerkirim.sinkron,
    `${label}: periksaSinkron seimbang, piutang dan barang terkirim sinkron (barang terkirim buku besar ${s.barangTerkirim.bukuBesar}, dokumen ${s.barangTerkirim.dokumen})`,
  );
  return D(s.barangTerkirim.bukuBesar);
};
const transitTepat = async (label: string, awal: Desimal, selisih: number) => {
  const kini = await sinkron(label);
  pastikan(kini.minus(awal).equals(D(selisih)), `${label}: saldo barang terkirim = awal + ${selisih} (selisih ${kini.minus(awal)})`);
};

// ---------- t1 ----------

async function bagianT1(k: Konteks) {
  console.log("=== t1. SJ yatim dengan dua harga pokok: hapus faktur membalik SJ yang benar-benar dipakai ===");
  const awal = await sinkron("awal t1");
  const psj = await pesananBaru(k, "T1: A 1 @ 100.000, B 1 @ 100.000", [
    { barangId: k.barang.id, jumlah: 1, harga: 100_000 },
    { barangId: k.barang.id, jumlah: 1, harga: 100_000 },
  ]);
  const [bA, bB] = psj.baris;
  const ps1 = await stokSesudah(k, "t1 harga pokok 40.000", 1, 40_000);
  const sjB = await kirim(k, psj.id, bB.id, "B (harga pokok 40.000)");
  const ps2 = await stokSesudah(k, "t1 harga pokok 60.000", 1, 60_000);
  const sjA = await kirim(k, psj.id, bA.id, "A (harga pokok 60.000)");
  pastikan(sama(sjB.baris.hargaPokok, 40_000) && sama(sjA.baris.hargaPokok, 60_000) && sjB.sj.tanggal <= sjA.sj.tanggal, "SJ-B 40.000 lebih dulu dari SJ-A 60.000");
  await transitTepat("sesudah dua SJ", awal, 100_000);

  // F0 meniru faktur kode lama: menagih baris A (jumlahDifaktur A = 1) tetapi mengonsumsi SJ-B (FIFO per barang),
  // tanpa barisPesananId (barang ganda) dan tanpa catatan konsumsi; jurnalnya mengakui HPP 40.000
  const f0 = await db.fakturPenjualan.create({
    data: {
      nomor: `${K}-FJ0`,
      pelangganId: k.pelanggan.id,
      pesananId: psj.id,
      total: 100_000,
      dpp: 100_000,
      status: "DIPROSES",
      statusPersetujuan: "DISETUJUI",
      baris: { create: [{ barangId: k.barang.id, jumlah: 1, harga: 100_000, subtotal: 100_000, nilaiTransit: 40_000 }] },
    },
    include: { baris: true },
  });
  const jurnalF0 = await db.$transaction((tx) => catatJurnalFakturPenjualan(tx, f0, f0.baris, null, [{ barangId: k.barang.id, nilai: D(40_000) }]));
  await db.fakturPenjualan.update({ where: { id: f0.id }, data: { jurnalId: jurnalF0!.id } });
  await db.barisPesananPenjualan.update({ where: { id: bA.id }, data: { jumlahDifaktur: 1 } });
  await db.barisPengiriman.update({ where: { id: sjB.baris.id }, data: { jumlahDifaktur: 1 } });
  pastikanCatatan(() => !f0.konsumsiSjTercatat, "faktur lama F0 tanpa catatan konsumsi (konsumsiSjTercatat = false)");
  await transitTepat("sesudah F0 (data lama)", awal, 60_000);

  const f1 = await fakturId(psj.id, [{ barisPesananId: bB.id, jumlah: 1 }], "F1 jalur ID baris B 1");
  const k1 = f1.baris[0].konsumsiSj;
  pastikan(sama(f1.baris[0].nilaiTransit, 60_000), `F1 mengonsumsi SJ yatim A, transit 60.000 (${f1.baris[0].nilaiTransit})`);
  pastikanCatatan(() => f1.konsumsiSjTercatat && k1.length === 1 && k1[0].barisPengirimanId === sjA.baris.id && sama(k1[0].jumlah, 1) && sama(k1[0].nilaiTransit, 60_000), "catatan konsumsi F1: SJ-A 1 unit senilai 60.000");
  pastikan((await difaktur(sjA.baris.id)).equals(1) && (await difaktur(sjB.baris.id)).equals(1), "SJ-A dan SJ-B sama-sama terkonsumsi");
  await transitTepat("sesudah F1", awal, 0);

  // SJ yang tercatat dikonsumsi faktur tidak bisa dihapus walau tanggalnya (mis. selisih jam) sesudah fakturnya
  if (!kodeLama) {
    const tanggalAsli = sjA.sj.tanggal;
    await db.pengirimanPesanan.update({ where: { id: sjA.sj.id }, data: { tanggal: new Date(Date.now() + 60_000) } });
    await harusDitolak("hapus SJ-A yang tercatat dikonsumsi F1", () => hapusDokumen("pengiriman", sjA.sj.id), `sudah mengakui HPP ${sjA.sj.nomor}; hapus faktur itu dulu`);
    await db.pengirimanPesanan.update({ where: { id: sjA.sj.id }, data: { tanggal: tanggalAsli } });
  }
  await harusDitolak("GUDANG menghapus F1", () => sebagai("gudang", () => hapusDokumen("faktur", f1.id)), "tidak punya hak");
  await jalankan("hapus F1", () => hapusDokumen("faktur", f1.id));
  pastikan((await difaktur(sjA.baris.id)).isZero(), "hapus F1 mengembalikan SJ-A (yang dipakai F1)");
  pastikan((await difaktur(sjB.baris.id)).equals(1), "SJ-B milik F0 tetap terkonsumsi");
  pastikan((await difakturBp(bB.id)).isZero() && (await difakturBp(bA.id)).equals(1), "baris pesanan B kembali 0, A tetap 1");
  const sisaCatatan = await db.konsumsiSuratJalan.count({ where: { barisPengirimanId: { in: [sjA.baris.id, sjB.baris.id] } } });
  pastikanCatatan(() => sisaCatatan === 0, "catatan konsumsi F1 ikut terhapus");
  await transitTepat("sesudah hapus F1", awal, 60_000);

  // hapus lalu buat ulang: faktur baru mengakui HPP 60.000 lagi (bukan 40.000), lalu dihapus lagi
  const f1b = await fakturId(psj.id, [{ barisPesananId: bB.id, jumlah: 1 }], "F1 dibuat ulang");
  pastikan(sama(f1b.baris[0].nilaiTransit, 60_000) && (await difaktur(sjA.baris.id)).equals(1), "F1 ulang mengonsumsi SJ-A lagi, HPP 60.000");
  pastikanCatatan(() => f1b.baris[0].konsumsiSj.length === 1 && f1b.baris[0].konsumsiSj[0].barisPengirimanId === sjA.baris.id, "catatan konsumsi F1 ulang: SJ-A");
  await transitTepat("sesudah F1 ulang", awal, 0);
  await jalankan("hapus F1 ulang", () => hapusDokumen("faktur", f1b.id));
  pastikan((await difaktur(sjA.baris.id)).isZero() && (await difaktur(sjB.baris.id)).equals(1), "hapus F1 ulang kembali mengembalikan SJ-A saja");
  await transitTepat("sesudah hapus F1 ulang", awal, 60_000);

  // F0 tanpa catatan dibalik dengan cara kode lama (per barang, SJ terbaru dulu): SJ-A sudah 0, jadi SJ-B yang turun
  await jalankan("hapus F0 (cadangan kode lama)", () => hapusDokumen("faktur", f0.id));
  pastikan((await difaktur(sjA.baris.id)).isZero() && (await difaktur(sjB.baris.id)).isZero() && (await difakturBp(bA.id)).isZero(), "hapus F0 mengembalikan SJ-B dan baris pesanan A");
  await transitTepat("sesudah hapus F0", awal, 100_000);

  await jalankan("hapus SJ-A", () => hapusDokumen("pengiriman", sjA.sj.id));
  await jalankan("hapus SJ-B", () => hapusDokumen("pengiriman", sjB.sj.id));
  await jalankan("hapus PSJ t1", () => hapusDokumen("pesanan", psj.id));
  await jalankan("hapus PS 60.000", () => hapusDokumen("penyesuaian", ps2.id));
  await jalankan("hapus PS 40.000", () => hapusDokumen("penyesuaian", ps1.id));
  await transitTepat("sesudah t1 dibersihkan", awal, 0);
}

// ---------- s2 ----------

async function bagianS2(k: Konteks) {
  console.log("=== s2. Faktur tanpa konsumsi dihapus: SJ faktur sebelumnya tetap terkonsumsi ===");
  const awal = await sinkron("awal s2");
  const psj = await pesananBaru(k, "S2: R 2 @ 100.000", [{ barangId: k.barang.id, jumlah: 2, harga: 100_000 }]);
  const [bR] = psj.baris;
  const ps = await stokSesudah(k, "s2 harga pokok 50.000", 1, 50_000);
  const sj = await kirim(k, psj.id, bR.id, "R 1 unit");
  const f1 = await fakturId(psj.id, [{ barisPesananId: bR.id, jumlah: 1 }], "F1 R 1 (sudah dikirim)");
  pastikan(sama(f1.baris[0].nilaiTransit, 50_000) && (await difaktur(sj.baris.id)).equals(1), "F1 mengonsumsi SJ (transit 50.000)");
  pastikanCatatan(() => f1.baris[0].konsumsiSj.length === 1, "F1 punya satu catatan konsumsi");
  const f2 = await fakturId(psj.id, [{ barisPesananId: bR.id, jumlah: 1 }], "F2 R 1 (belum dikirim)");
  pastikan(f2.id !== f1.id && sama(f2.baris[0].nilaiTransit, 0), "F2 tanpa konsumsi SJ (transit 0)");
  pastikanCatatan(() => f2.konsumsiSjTercatat && f2.baris[0].konsumsiSj.length === 0, "F2 tanpa catatan, tetapi tercatat lengkap (konsumsiSjTercatat = true)");
  await transitTepat("sesudah F1 dan F2", awal, 0);

  await jalankan("hapus F2", () => hapusDokumen("faktur", f2.id));
  pastikan((await difaktur(sj.baris.id)).equals(1), "hapus F2 tidak menyentuh SJ yang dipakai F1");
  pastikan((await difakturBp(bR.id)).equals(1), "baris pesanan R kembali 1");
  await transitTepat("sesudah hapus F2", awal, 0);

  await jalankan("hapus F1", () => hapusDokumen("faktur", f1.id));
  pastikan((await difaktur(sj.baris.id)).isZero() && (await difakturBp(bR.id)).isZero(), "hapus F1 mengembalikan SJ dan baris pesanan");
  await transitTepat("sesudah hapus F1", awal, 50_000);

  const f3 = await fakturId(psj.id, [{ barisPesananId: bR.id, jumlah: 2 }], "F3 R 2 sesudah hapus");
  pastikan(sama(f3.baris[0].nilaiTransit, 50_000) && (await difaktur(sj.baris.id)).equals(1), "faktur baru sesudah hapus mengonsumsi SJ yang sama sekali lagi");
  await transitTepat("sesudah F3", awal, 0);
  await jalankan("hapus F3", () => hapusDokumen("faktur", f3.id));
  await jalankan("hapus SJ s2", () => hapusDokumen("pengiriman", sj.sj.id));
  await jalankan("hapus PSJ s2", () => hapusDokumen("pesanan", psj.id));
  await jalankan("hapus PS s2", () => hapusDokumen("penyesuaian", ps.id));
  await transitTepat("sesudah s2 dibersihkan", awal, 0);
}

// ---------- s1 ----------

async function bagianS1(k: Konteks) {
  console.log("=== s1. Dua faktur serentak tidak mengonsumsi SJ yatim yang sama ===");
  const awal = await sinkron("awal s1");
  const psj = await pesananBaru(k, "S1: A, B, C masing-masing 1 @ 100.000", [0, 1, 2].map(() => ({ barangId: k.barang.id, jumlah: 1, harga: 100_000 })));
  const [bA, bB, bC] = psj.baris;
  const ps = await stokSesudah(k, "s1 harga pokok 50.000", 1, 50_000);
  const sjA = await kirim(k, psj.id, bA.id, "A 1 unit");
  // data lama: baris A penuh ditagih tanpa mengonsumsi SJ-A, jadi SJ-A yatim
  await db.barisPesananPenjualan.update({ where: { id: bA.id }, data: { jumlahDifaktur: 1 } });
  const kirimFaktur = (barisPesananId: string) => () => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, baris: [{ barisPesananId, jumlah: 1 }] }));
  const hasil = await duaSerentak((tx) => tx.$queryRaw`SELECT 1 FROM "BarisPengiriman" WHERE "id" = ${sjA.baris.id} FOR UPDATE`, k.pelanggan.id, [kirimFaktur(bB.id), kirimFaktur(bC.id)]);
  pastikan(hasil.every((h) => h === "ok"), `kedua faktur serentak lolos (${hasil.join(" | ")})`);
  const faktur = await db.fakturPenjualan.findMany({ where: { pesananId: psj.id }, include: { baris: { include: { konsumsiSj: true } } } });
  const transit = faktur.reduce((t, f) => t.plus(D(f.baris[0].nilaiTransit)), D(0));
  pastikan(faktur.length === 2 && transit.equals(50_000), `HPP SJ-A diakui sekali saja: total transit kedua faktur 50.000 (${transit})`);
  pastikan((await difaktur(sjA.baris.id)).equals(1), "SJ-A difaktur 1, tidak 2");
  pastikanCatatan(() => faktur.flatMap((f) => f.baris.flatMap((b) => b.konsumsiSj)).length === 1, "hanya satu catatan konsumsi untuk SJ-A");
  await transitTepat("sesudah dua faktur serentak", awal, 0);

  for (const f of [...faktur].sort((a, b) => b.tanggal.getTime() - a.tanggal.getTime() || b.nomor.localeCompare(a.nomor))) await jalankan(`hapus ${f.nomor}`, () => hapusDokumen("faktur", f.id));
  pastikan((await difaktur(sjA.baris.id)).isZero(), "hapus kedua faktur mengembalikan SJ-A");
  await db.barisPesananPenjualan.update({ where: { id: bA.id }, data: { jumlahDifaktur: 0 } });
  await transitTepat("sesudah hapus faktur s1", awal, 50_000);
  await jalankan("hapus SJ-A s1", () => hapusDokumen("pengiriman", sjA.sj.id));
  await jalankan("hapus PSJ s1", () => hapusDokumen("pesanan", psj.id));
  await jalankan("hapus PS s1", () => hapusDokumen("penyesuaian", ps.id));
  await db.fakturPenjualan.deleteMany({ where: { pelangganId: k.pelanggan.id, pesananId: null, total: 0 } });
  await transitTepat("sesudah s1 dibersihkan", awal, 0);
}

// ---------- r2 ----------

async function bagianR2(k: Konteks) {
  console.log("=== r2. Faktur serentak yang ternyata menutup pesanan berfee nominal ditolak ===");
  const psj = await pesananBaru(k, "R2: jasa A, B, C @ 100, fee nominal 1", [0, 1, 2].map(() => ({ barangId: k.jasa.id, jumlah: 1, harga: 100 })), { jenisFee: "NOMINAL", nilaiFee: 1 });
  const [bA, bB, bC] = psj.baris;
  pastikan(sama(psj.fee, 1), `fee pesanan 1 (${psj.fee})`);
  const fA = await fakturId(psj.id, [{ barisPesananId: bA.id, jumlah: 1 }], "FJ baris A");
  pastikan(sama(fA.fee, "0.33"), `fee faktur A prorata 0,33 (${fA.fee})`);
  const kirimFaktur = (barisPesananId: string) => () => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, baris: [{ barisPesananId, jumlah: 1 }] }));
  // faktur serentak dibuat sebagai draf persetujuan (tanpa jurnal), supaya yang diuji hanya prorata fee: tanpa itu kode
  // lama gagal lebih dulu di bentrok nomor jurnal karena kedua faktur berjalan bersamaan
  aturPersetujuan(true);
  const hasil = await duaSerentak((tx) => tx.$queryRaw`SELECT 1 FROM "PesananPenjualan" WHERE "id" = ${psj.id} FOR UPDATE`, k.pelanggan.id, [kirimFaktur(bB.id), kirimFaktur(bC.id)]);
  aturPersetujuan(false);
  pastikan(hasil[0] === "ok" && hasil[1].includes("Sisa pesanan berubah saat faktur disimpan"), `faktur pertama lolos, faktur kedua yang ternyata menutup pesanan ditolak (${hasil.join(" | ")})`);
  pastikan((await difakturBp(bC.id)).isZero(), "baris C belum difaktur sesudah penolakan");
  await fakturId(psj.id, [{ barisPesananId: bC.id, jumlah: 1 }], "FJ baris C diulang");
  const semua = await db.fakturPenjualan.findMany({ where: { pesananId: psj.id }, orderBy: { nomor: "asc" } });
  pastikan(semua.length === 3 && semua.reduce((t, f) => t.plus(D(f.fee)), D(0)).equals(1), `jumlah fee ketiga faktur = fee pesanan 1 (${semua.map((f) => D(f.fee).toFixed(2)).join(" + ")})`);
  await sinkron("sesudah r2");
  for (const f of [...semua].reverse()) await jalankan(`hapus ${f.nomor}`, () => hapusDokumen("faktur", f.id));
  await jalankan("hapus PSJ r2", () => hapusDokumen("pesanan", psj.id));
  await db.fakturPenjualan.deleteMany({ where: { pelangganId: k.pelanggan.id, pesananId: null, total: 0 } });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
