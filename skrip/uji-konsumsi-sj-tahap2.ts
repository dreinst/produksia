import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { db } from "../src/lib/db";
import type { Prisma } from "../src/prisma-klien/client";
import { D, type Desimal } from "../src/lib/uang";
import { periksaKonsumsiSj, periksaSinkron } from "../src/lib/sinkron";
import { catatJurnalFakturPenjualan } from "../src/lib/akuntansi";
import { buatPesanan, buatPengiriman, buatFaktur, buatUangMuka } from "../src/lib/aksi/penjualan";
import { buatPenyesuaianPersediaan } from "../src/lib/aksi/persediaan";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { terbitkanTagihanTermin } from "../src/lib/aksi/dokumenPenjualan";
import { aturPersetujuan, formulir, harusDitolak, jalankan, pastikan } from "./bantuan";

/*
 * Perbaikan tinjauan perbaikan konsumsi SJ tahap 2 (TINJAU-PERBAIKAN-2 P27, commit 7ac77cb):
 *  t1.  Migrasi 20261112100000 membagi ulang data lama B-10 (A = 5, B = 0 menjadi A = 2, B = 3) sebelum CHECK dipasang,
 *       grup yang sudah dalam batas tidak disentuh, data yang tidak bisa dibagi ulang menghentikan migrasi tanpa
 *       mengubah apa pun, dan faktur lama atas data yang dibagi ulang tetap bisa dihapus (pembalik urut terbalik).
 *  t2.  Hapus pesanan yang berbarengan dengan faktur baru mengunci baris pesanan lebih dulu, jadi ditolak "sudah punya
 *       faktur", bukan menghapus pesanan dan meninggalkan faktur tanpa pesanan.
 *  t3.  Tanggal faktur diambil sesudah kunci baris pesanan.
 *  t4.  Tagihan termin untuk butir yang sudah lunas ditolak.
 *  t5.  Batas kuantitas cadangan faktur lama dibulatkan ke bawah, jadi nilai yang dibalik tidak melewati nilaiTransit.
 *  t6.  periksaKonsumsiSj membawa contoh nomor dokumen dan hitungan catatan pada faktur yang tidak tercatat.
 * Bagian t1 menjalankan berkas migrasi apa adanya lewat pg (protokol kueri sederhana, satu transaksi implisit) sesudah
 * kedua CHECK dilepas sementara; berkas itu sendiri memasangnya kembali. UJI_TAHAP2_BAGIAN=<nama> menjalankan satu bagian.
 */

const K = "UK2";
const sama = (x: unknown, harap: number | string) => D(x as Desimal).equals(D(harap));
const hanya = process.env.UJI_TAHAP2_BAGIAN;
const jalan = (bagian: string) => !hanya || hanya === bagian;
const BERKAS_MIGRASI = join(process.cwd(), "prisma/migrations/20261112100000_batas_jumlah_difaktur/migration.sql");
const NAMA_CHECK = ["BarisPesananPenjualan_jumlahDifaktur_batas", "BarisPengiriman_jumlahDifaktur_batas"];

async function bersihkan() {
  const pel = (await db.pelanggan.findMany({ where: { kode: { startsWith: `PLG-${K}` } }, select: { id: true } })).map((p) => p.id);
  const jurnalIds: string[] = [];
  const kumpul = (xs: { jurnalId: string | null }[]) => jurnalIds.push(...xs.flatMap((x) => (x.jurnalId ? [x.jurnalId] : [])));
  if (pel.length > 0) {
    const faktur = await db.fakturPenjualan.findMany({ where: { pelangganId: { in: pel } }, select: { id: true, jurnalId: true } });
    const pesanan = await db.pesananPenjualan.findMany({ where: { pelangganId: { in: pel } }, select: { id: true } });
    const sj = await db.pengirimanPesanan.findMany({ where: { pesananId: { in: pesanan.map((p) => p.id) } }, select: { id: true, jurnalId: true } });
    const um = await db.uangMukaPelanggan.findMany({ where: { pesananId: { in: pesanan.map((p) => p.id) } }, select: { id: true, jurnalId: true } });
    for (const xs of [faktur, sj, um]) kumpul(xs);
    await db.pemakaianUangMuka.deleteMany({ where: { fakturId: { in: faktur.map((f) => f.id) } } });
    await db.barisFakturPenjualan.deleteMany({ where: { fakturId: { in: faktur.map((f) => f.id) } } });
    await db.fakturPenjualan.deleteMany({ where: { id: { in: faktur.map((f) => f.id) } } });
    await db.uangMukaPelanggan.deleteMany({ where: { id: { in: um.map((u) => u.id) } } });
    await db.barisPengiriman.deleteMany({ where: { pengirimanId: { in: sj.map((s) => s.id) } } });
    await db.pengirimanPesanan.deleteMany({ where: { id: { in: sj.map((s) => s.id) } } });
    await db.rencanaTermin.deleteMany({ where: { pesananId: { in: pesanan.map((p) => p.id) } } });
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

/** Penahan memegang kunci lewat `pegang`; kerja yang dikembalikan `isi` ditunggu sesudah penahan melepas kuncinya. */
async function denganPenahan(pegang: (tx: Prisma.TransactionClient) => Promise<unknown>, isi: (pid: number) => Promise<Promise<string>[]>): Promise<string[]> {
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
  const pid = await Promise.race([terkunci, penahan.then(() => Promise.reject(new Error("penahan selesai sebelum mengunci")))]);
  let janji: Promise<string>[] = [];
  try {
    janji = await isi(pid);
  } finally {
    lepas();
    await penahan;
  }
  return Promise.all(janji);
}

const kunciBp = (id: string) => (tx: Prisma.TransactionClient) => tx.$queryRaw`SELECT 1 FROM "BarisPesananPenjualan" WHERE "id" = ${id} FOR NO KEY UPDATE`;

type Konteks = { gudang: { id: string }; barang: { id: string }; jasa: { id: string }; pelanggan: { id: string }; modal: { id: string }; kas: { id: string } };

// ---------- pembantu ----------

const stokSesudah = async (k: Konteks, label: string, jumlahSesudah: number, hargaSatuan: number) => {
  await jalankan(`PS ${label}: stok jadi ${jumlahSesudah} @ ${hargaSatuan}`, () =>
    buatPenyesuaianPersediaan(formulir({ gudangId: k.gudang.id, akunLawanId: k.modal.id, keterangan: `${K} ${label}`, baris: [{ barangId: k.barang.id, jumlahSesudah, hargaSatuan }] })),
  );
  return db.penyesuaianPersediaan.findFirstOrThrow({ where: { keterangan: `${K} ${label}` } });
};
const pesananBaru = async (k: Konteks, label: string, baris: { barangId: string; jumlah: number; harga: number }[], tambahan: Record<string, unknown> = {}) => {
  await jalankan(`PSJ ${label}`, () => buatPesanan(formulir({ pelangganId: k.pelanggan.id, ppnPersen: 0, baris, ...tambahan })));
  return db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: k.pelanggan.id }, orderBy: { nomor: "desc" }, include: { baris: { orderBy: [{ urutan: "asc" }, { id: "asc" }] } } });
};
const formFaktur = (pesananId: string, barisPesananId: string, jumlah: number) => formulir({ pesananId, ppnPersen: 0, baris: [{ barisPesananId, jumlah }] });
const fakturTerbaru = (pesananId: string) =>
  db.fakturPenjualan.findFirstOrThrow({ where: { pesananId }, orderBy: [{ tanggal: "desc" }, { nomor: "desc" }], include: { baris: { include: { konsumsiSj: true } } } });
const difaktur = async (barisSjId: string) => D((await db.barisPengiriman.findUniqueOrThrow({ where: { id: barisSjId } })).jumlahDifaktur);
const difakturBp = async (id: string) => D((await db.barisPesananPenjualan.findUniqueOrThrow({ where: { id } })).jumlahDifaktur);
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

/**
 * Faktur buatan kode lama (konsumsiSjTercatat = false, tanpa catatan dan tanpa barisPesananId kecuali disebut): baris
 * faktur dengan nilaiTransit dan jurnal HPP-nya, jumlahDifaktur baris pesanan (`tagih`) dan baris SJ (`pakai`)
 * dinaikkan langsung seperti yang dulu dilakukan buatFaktur.
 */
async function fakturLama(
  k: Konteks,
  pesananId: string,
  nomor: string,
  baris: { barangId: string; jumlah: number; harga: number; nilaiTransit: number; barisPesananId?: string }[],
  tagih: { id: string; jumlah: number }[],
  pakai: { id: string; jumlah: number }[],
) {
  const total = baris.reduce((t, b) => t + b.jumlah * b.harga, 0);
  const f = await db.fakturPenjualan.create({
    data: {
      nomor,
      pelangganId: k.pelanggan.id,
      pesananId,
      total,
      dpp: total,
      status: "DIPROSES",
      statusPersetujuan: "DISETUJUI",
      baris: { create: baris.map((b, i) => ({ barangId: b.barangId, jumlah: b.jumlah, harga: b.harga, subtotal: b.jumlah * b.harga, nilaiTransit: b.nilaiTransit, barisPesananId: b.barisPesananId, urutan: i })) },
    },
    include: { baris: true },
  });
  const transit = baris.filter((b) => b.nilaiTransit > 0).map((b) => ({ barangId: b.barangId, nilai: D(b.nilaiTransit) }));
  const jurnal = await db.$transaction((tx) => catatJurnalFakturPenjualan(tx, f, f.baris, null, transit));
  await db.fakturPenjualan.update({ where: { id: f.id }, data: { jurnalId: jurnal!.id } });
  for (const t of tagih) await db.barisPesananPenjualan.update({ where: { id: t.id }, data: { jumlahDifaktur: { increment: t.jumlah } } });
  for (const p of pakai) await db.barisPengiriman.update({ where: { id: p.id }, data: { jumlahDifaktur: { increment: p.jumlah } } });
  pastikan(!f.konsumsiSjTercatat && f.baris.every((b) => b.barisPesananId === (baris[b.urutan].barisPesananId ?? null)), `faktur lama ${nomor} tanpa catatan konsumsi`);
  return f;
}

// ---------- t1: migrasi membagi ulang data B-10 ----------

const jumlahCheck = async () =>
  (await db.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS "n" FROM pg_constraint WHERE "conname" = ANY(${NAMA_CHECK}::text[])`)[0].n;
const lepasCheck = async () => {
  await db.$executeRawUnsafe(`ALTER TABLE "BarisPesananPenjualan" DROP CONSTRAINT IF EXISTS "${NAMA_CHECK[0]}"`);
  await db.$executeRawUnsafe(`ALTER TABLE "BarisPengiriman" DROP CONSTRAINT IF EXISTS "${NAMA_CHECK[1]}"`);
};
/** Menjalankan berkas migrasi apa adanya; "ok" atau pesan galat PostgreSQL. */
async function jalankanMigrasi(): Promise<string> {
  const klien = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await klien.connect();
  try {
    await klien.query(readFileSync(BERKAS_MIGRASI, "utf8"));
    return "ok";
  } catch (e) {
    return String((e as Error).message);
  } finally {
    await klien.end();
  }
}
/** Pengaman bila bagian t1 berhenti di tengah: data uji dirapikan ke dalam batas lalu CHECK dipasang ulang. */
async function pulihkanCheck(pesananIds: string[]) {
  if ((await jumlahCheck()) === 2) return;
  await db.$executeRaw`UPDATE "BarisPesananPenjualan" SET "jumlahDifaktur" = LEAST(GREATEST("jumlahDifaktur", 0), "jumlah") WHERE "pesananId" = ANY(${pesananIds}::text[])`;
  await db.$executeRaw`UPDATE "BarisPengiriman" SET "jumlahDifaktur" = LEAST(GREATEST("jumlahDifaktur", 0), "jumlah") WHERE "pengirimanId" IN (SELECT "id" FROM "PengirimanPesanan" WHERE "pesananId" = ANY(${pesananIds}::text[]))`;
  await lepasCheck();
  const hasil = await jalankanMigrasi();
  if (hasil !== "ok") throw new Error(`CHECK gagal dipasang ulang: ${hasil}`);
}

async function bagianT1(k: Konteks) {
  console.log("=== t1. Migrasi membagi ulang data lama B-10, faktur lamanya tetap bisa dihapus ===");
  const awal = await sinkron("awal t1");
  pastikan((await jumlahCheck()) === 2, "kedua CHECK jumlahDifaktur terpasang sebelum uji");
  // P1: A (X, 2) dan B (X, 3), dikirim 5, difaktur 5 unit X oleh faktur lama yang menumpuk progres di A (A = 5, B = 0)
  const p1 = await pesananBaru(k, "T1 P1: A R 2, B R 3", [
    { barangId: k.barang.id, jumlah: 2, harga: 100_000 },
    { barangId: k.barang.id, jumlah: 3, harga: 100_000 },
  ]);
  const [a, b] = p1.baris;
  // P2: C (X, 5) dan D (X, 3) dengan progres menumpuk tetapi masih dalam batas (C = 4, D = 0): tidak boleh disentuh
  const p2 = await pesananBaru(k, "T1 P2: C R 5, D R 3", [
    { barangId: k.barang.id, jumlah: 5, harga: 100_000 },
    { barangId: k.barang.id, jumlah: 3, harga: 100_000 },
  ]);
  const [c, d] = p2.baris;
  const ps = await stokSesudah(k, "t1 stok 5 @ 50.000", 5, 50_000);
  await jalankan("SJ P1 A 2 + B 3", () =>
    buatPengiriman(formulir({ pesananId: p1.id, gudangId: k.gudang.id, baris: [{ barisPesananId: a.id, barangId: k.barang.id, jumlah: 2 }, { barisPesananId: b.id, barangId: k.barang.id, jumlah: 3 }] })),
  );
  const sj = await db.pengirimanPesanan.findFirstOrThrow({ where: { pesananId: p1.id }, include: { baris: true } });
  const sjA = sj.baris.find((x) => x.barisPesananId === a.id)!;
  const sjB = sj.baris.find((x) => x.barisPesananId === b.id)!;
  await transitTepat("t1 sesudah SJ", awal, 250_000);

  let migrasi1 = "";
  let rusakPesanan = "";
  let rusakSj = "";
  let migrasi2 = "";
  let migrasi3 = "";
  let checkSesudahRusak = -1;
  let cSesudahRusak = D(-1);
  let sjSesudahRusak = D(-1);
  let fLama: { id: string; nomor: string } | null = null;
  try {
    // kode lama: CHECK belum ada, faktur menaikkan baris pesanan pertama dan mengonsumsi SJ per barang
    await lepasCheck();
    fLama = await fakturLama(k, p1.id, `${K}-FJL-T1`, [{ barangId: k.barang.id, jumlah: 5, harga: 100_000, nilaiTransit: 250_000 }], [{ id: a.id, jumlah: 5 }], [
      { id: sjA.id, jumlah: 2 },
      { id: sjB.id, jumlah: 3 },
    ]);
    await db.barisPesananPenjualan.update({ where: { id: c.id }, data: { jumlahDifaktur: 4 } });
    migrasi1 = await jalankanMigrasi();

    // data rusak sungguhan: total difaktur per barang di atas total dipesan (C = 9 dari 8) menghentikan migrasi
    await lepasCheck();
    await db.barisPesananPenjualan.update({ where: { id: c.id }, data: { jumlahDifaktur: 9 } });
    rusakPesanan = await jalankanMigrasi();
    cSesudahRusak = await difakturBp(c.id);
    checkSesudahRusak = await jumlahCheck();
    await db.barisPesananPenjualan.update({ where: { id: c.id }, data: { jumlahDifaktur: 4 } });
    migrasi2 = await jalankanMigrasi();

    // baris SJ di luar batas juga menghentikan migrasi
    await lepasCheck();
    await db.barisPengiriman.update({ where: { id: sjA.id }, data: { jumlahDifaktur: -1 } });
    rusakSj = await jalankanMigrasi();
    sjSesudahRusak = await difaktur(sjA.id);
    await db.barisPengiriman.update({ where: { id: sjA.id }, data: { jumlahDifaktur: 2 } });
    migrasi3 = await jalankanMigrasi();
  } finally {
    await pulihkanCheck([p1.id, p2.id]);
  }

  pastikan(migrasi1 === "ok", `migrasi lolos di atas data B-10 (${migrasi1})`);
  pastikan((await difakturBp(a.id)).equals(2) && (await difakturBp(b.id)).equals(3), "progres P1 dibagi ulang urut urutan lalu id: A = 2, B = 3 (total tetap 5)");
  pastikan((await difakturBp(c.id)).equals(4) && (await difakturBp(d.id)).isZero(), "grup P2 yang sudah dalam batas tidak disentuh (C = 4, D = 0)");
  pastikan(rusakPesanan.includes("tidak bisa dibagi ulang") && rusakPesanan.includes(p2.nomor) && rusakPesanan.includes(`BRG-${K}`), `total difaktur di atas dipesan menghentikan migrasi dengan nomor pesanan (${rusakPesanan.slice(0, 200)})`);
  pastikan(cSesudahRusak.equals(9) && checkSesudahRusak === 0, "migrasi yang berhenti tidak mengubah data dan tidak memasang CHECK");
  pastikan(migrasi2 === "ok" && migrasi3 === "ok", `migrasi lolos lagi sesudah data dibetulkan (${migrasi2} | ${migrasi3})`);
  pastikan(rusakSj.includes("baris surat jalan di luar 0..jumlah") && rusakSj.includes(sj.nomor) && sjSesudahRusak.equals(-1), `baris SJ di luar batas menghentikan migrasi dengan nomor SJ (${rusakSj.slice(0, 200)})`);
  pastikan((await jumlahCheck()) === 2, "kedua CHECK terpasang lagi");
  pastikan((await periksaKonsumsiSj(db)).sinkron, "invarian konsumsi SJ tanpa temuan sesudah migrasi");
  await transitTepat("t1 sesudah migrasi", awal, 0);

  // faktur lama atas data yang dibagi ulang tetap bisa dihapus: baris pesanan dikurangi urut terbalik (B lalu A)
  await jalankan("hapus faktur lama B-10", () => hapusDokumen("faktur", fLama!.id));
  pastikan((await difakturBp(a.id)).isZero() && (await difakturBp(b.id)).isZero(), "hapus faktur lama mengembalikan A dan B ke 0");
  pastikan((await difaktur(sjA.id)).isZero() && (await difaktur(sjB.id)).isZero(), "hapus faktur lama mengembalikan kedua baris SJ");
  await transitTepat("t1 sesudah hapus faktur lama", awal, 250_000);

  // pembalik urut terbalik hanya ditolak bila total progres barang itu kurang dari jumlah baris faktur
  const fKurang = await fakturLama(k, p2.id, `${K}-FJL-T1K`, [{ barangId: k.barang.id, jumlah: 5, harga: 100_000, nilaiTransit: 0 }], [], []);
  await harusDitolak("hapus faktur lama 5 unit saat progres barang hanya 4", () => hapusDokumen("faktur", fKurang.id), "Progres faktur baris pesanan lebih kecil");
  pastikan((await difakturBp(c.id)).equals(4) && (await difakturBp(d.id)).isZero(), "hapus yang ditolak tidak mengubah progres");
  await db.barisPesananPenjualan.update({ where: { id: d.id }, data: { jumlahDifaktur: 1 } });
  await jalankan("hapus faktur lama 5 unit atas C = 4, D = 1", () => hapusDokumen("faktur", fKurang.id));
  pastikan((await difakturBp(c.id)).isZero() && (await difakturBp(d.id)).isZero(), "pembalik mengurangi D lalu C sampai habis");

  await jalankan("hapus SJ t1", () => hapusDokumen("pengiriman", sj.id));
  await jalankan("hapus P1", () => hapusDokumen("pesanan", p1.id));
  await jalankan("hapus P2", () => hapusDokumen("pesanan", p2.id));
  await jalankan("hapus PS t1", () => hapusDokumen("penyesuaian", ps.id));
  await transitTepat("sesudah t1 dibersihkan", awal, 0);
}

// ---------- t2: hapus pesanan berbarengan dengan faktur ----------

async function bagianT2(k: Konteks) {
  console.log("=== t2. Hapus pesanan mengunci baris pesanan lebih dulu ===");
  const awal = await sinkron("awal t2");
  const psj = await pesananBaru(k, "T2: jasa 1 @ 100.000", [{ barangId: k.jasa.id, jumlah: 1, harga: 100_000 }]);
  const [bJ] = psj.baris;
  const [faktur, hapus] = await denganPenahan(kunciBp(bJ.id), async (pid) => {
    const f = aksi(() => buatFaktur(formFaktur(psj.id, bJ.id, 1)));
    await tungguAntre(pid, 1);
    const h = aksi(() => hapusDokumen("pesanan", psj.id));
    await tungguAntre(pid, 2);
    return [f, h];
  });
  pastikan(faktur === "ok", `faktur yang lebih dulu antre lolos (${faktur})`);
  pastikan(hapus.includes("sudah punya faktur"), `hapus pesanan yang menunggu ditolak karena faktur baru (${hapus})`);
  const f = await fakturTerbaru(psj.id);
  pastikan(f.pesananId === psj.id && f.baris[0].barisPesananId === bJ.id && (await db.pesananPenjualan.count({ where: { id: psj.id } })) === 1, "pesanan tetap ada dan faktur tetap menaut pesanan dan barisnya");
  await jalankan("hapus F t2", () => hapusDokumen("faktur", f.id));
  await jalankan("hapus PSJ t2", () => hapusDokumen("pesanan", psj.id));
  await transitTepat("sesudah t2", awal, 0);
}

// ---------- t3: tanggal faktur sesudah kunci ----------

async function bagianT3(k: Konteks) {
  console.log("=== t3. Tanggal faktur diambil sesudah kunci baris pesanan ===");
  const psj = await pesananBaru(k, "T3: jasa 1 @ 100.000", [{ barangId: k.jasa.id, jumlah: 1, harga: 100_000 }]);
  const [bJ] = psj.baris;
  let sesudahAntre = new Date(0);
  const [hasil] = await denganPenahan(kunciBp(bJ.id), async (pid) => {
    const f = aksi(() => buatFaktur(formFaktur(psj.id, bJ.id, 1)));
    await tungguAntre(pid, 1);
    await new Promise((r) => setTimeout(r, 30));
    sesudahAntre = new Date();
    return [f];
  });
  pastikan(hasil === "ok", `faktur yang menunggu kunci lolos (${hasil})`);
  const f = await fakturTerbaru(psj.id);
  pastikan(f.tanggal.getTime() >= sesudahAntre.getTime(), `tanggal faktur sesudah faktur mulai menunggu kunci (${f.tanggal.toISOString()} >= ${sesudahAntre.toISOString()})`);
  pastikan(f.jatuhTempo !== null && f.jatuhTempo.getTime() >= f.tanggal.getTime(), "jatuh tempo bawaan dihitung dari tanggal faktur itu");
  await jalankan("hapus F t3", () => hapusDokumen("faktur", f.id));
  await jalankan("hapus PSJ t3", () => hapusDokumen("pesanan", psj.id));
}

// ---------- t4: tagihan termin untuk butir lunas ----------

async function bagianT4(k: Konteks) {
  console.log("=== t4. Tagihan termin untuk butir yang sudah lunas ditolak ===");
  const psj = await pesananBaru(k, "T4: jasa 1 @ 1.000.000, DP 50% + Pelunasan", [{ barangId: k.jasa.id, jumlah: 1, harga: 1_000_000 }], {
    rencanaTermin: [{ label: "DP", nilai: 50 }, { label: "Pelunasan" }],
  });
  const [t1, t2] = await db.rencanaTermin.findMany({ where: { pesananId: psj.id }, orderBy: { no: "asc" } });
  pastikan(sama(t1.jumlah, 500_000) && sama(t2.jumlah, 500_000), "rencana termin 500.000 + 500.000");
  await jalankan("UM DP 500.000 sebelum ditagih", () => buatUangMuka(formulir({ pesananId: psj.id, akunId: k.kas.id, jumlah: 500_000, rencanaTerminId: t1.id })));
  await harusDitolak("terbitkan tagihan DP yang sudah lunas", () => terbitkanTagihanTermin(t1.id, formulir({})), "sudah lunas");
  const t1b = await db.rencanaTermin.findUniqueOrThrow({ where: { id: t1.id } });
  pastikan(t1b.ditagihPada === null && t1b.nomorCetak === null, "butir lunas tetap tanpa tanggal tagih dan nomor cetak");
  await jalankan("UM pelunasan 200.000 (sebagian)", () => buatUangMuka(formulir({ pesananId: psj.id, akunId: k.kas.id, jumlah: 200_000, rencanaTerminId: t2.id })));
  await jalankan("terbitkan tagihan pelunasan yang dibayar sebagian", () => terbitkanTagihanTermin(t2.id, formulir({})));
  pastikan((await db.rencanaTermin.findUniqueOrThrow({ where: { id: t2.id } })).ditagihPada !== null, "butir yang belum lunas tetap bisa ditagih");
  for (const um of await db.uangMukaPelanggan.findMany({ where: { pesananId: psj.id } })) await jalankan(`hapus ${um.nomor}`, () => hapusDokumen("uangMuka", um.id));
  await jalankan("hapus PSJ t4", () => hapusDokumen("pesanan", psj.id));
}

// ---------- t5: batas kuantitas cadangan dibulatkan ke bawah ----------

async function bagianT5(k: Konteks) {
  console.log("=== t5. Batas kuantitas cadangan faktur lama dibulatkan ke bawah ===");
  const psj = await pesananBaru(k, "T5: R 2 @ 100", [{ barangId: k.barang.id, jumlah: 2, harga: 100 }]);
  const [bR] = psj.baris;
  const ps1 = await stokSesudah(k, "t5 stok 1 @ 3", 1, 3);
  await jalankan("SJ-1 R 1", () => buatPengiriman(formulir({ pesananId: psj.id, gudangId: k.gudang.id, baris: [{ barisPesananId: bR.id, barangId: k.barang.id, jumlah: 1 }] })));
  const ps2 = await stokSesudah(k, "t5 stok 1 @ 3 lagi", 1, 3);
  await jalankan("SJ-2 R 1", () => buatPengiriman(formulir({ pesananId: psj.id, gudangId: k.gudang.id, baris: [{ barisPesananId: bR.id, barangId: k.barang.id, jumlah: 1 }] })));
  const [sj1, sj2] = await db.pengirimanPesanan.findMany({ where: { pesananId: psj.id }, orderBy: [{ tanggal: "asc" }, { id: "asc" }], include: { baris: true } });
  pastikan(sama(sj1.baris[0].hargaPokok, 3) && sama(sj2.baris[0].hargaPokok, 3), "kedua SJ berharga pokok 3");
  const f1 = await fakturLama(k, psj.id, `${K}-FJL-T5A`, [{ barangId: k.barang.id, jumlah: 1, harga: 100, nilaiTransit: 3 }], [{ id: bR.id, jumlah: 1 }], [{ id: sj1.baris[0].id, jumlah: 1 }]);
  // F2 lama dulu hanya mengakui HPP 2 (data lama), tetapi SJ-2 tercatat penuh difaktur
  const f2 = await fakturLama(k, psj.id, `${K}-FJL-T5B`, [{ barangId: k.barang.id, jumlah: 1, harga: 100, nilaiTransit: 2 }], [{ id: bR.id, jumlah: 1 }], [{ id: sj2.baris[0].id, jumlah: 1 }]);
  await jalankan("hapus F2 lama (transit 2, harga pokok 3)", () => hapusDokumen("faktur", f2.id));
  // 2/3 = 0,666...: dibulatkan ke bawah 0,66 (nilai 1,98 <= 2), bukan 0,67 (nilai 2,01 > 2)
  pastikan((await difaktur(sj2.baris[0].id)).equals(D("0.34")) && (await difaktur(sj1.baris[0].id)).equals(1), "hapus F2 membalik 0,66 unit SJ-2 (nilai 1,98, tidak melewati transit 2); SJ-1 milik F1 tetap");
  await jalankan("hapus F1 lama", () => hapusDokumen("faktur", f1.id));
  await jalankan("hapus SJ-2 t5", () => hapusDokumen("pengiriman", sj2.id));
  await jalankan("hapus SJ-1 t5", () => hapusDokumen("pengiriman", sj1.id));
  await jalankan("hapus PSJ t5", () => hapusDokumen("pesanan", psj.id));
  await jalankan("hapus PS t5 kedua", () => hapusDokumen("penyesuaian", ps2.id));
  await jalankan("hapus PS t5 pertama", () => hapusDokumen("penyesuaian", ps1.id));
}

// ---------- t6: contoh nomor dan catatan pada faktur tidak tercatat ----------

async function bagianT6(k: Konteks) {
  console.log("=== t6. periksaKonsumsiSj membawa contoh nomor dan hitungan keempat ===");
  const awal = await sinkron("awal t6");
  const mulai = await periksaKonsumsiSj(db);
  pastikan(
    mulai.sinkron && mulai.rincian.map((r) => r.kode).join() === "TRANSIT_CATATAN,CATATAN_MELEBIHI_DIFAKTUR,DIFAKTUR_DI_LUAR_BATAS,CATATAN_FAKTUR_TIDAK_TERCATAT" && mulai.rincian.every((r) => r.contoh.length === 0),
    "empat kode tanpa temuan dan tanpa contoh di awal",
  );
  const psj = await pesananBaru(k, "T6: R 1 @ 100.000", [{ barangId: k.barang.id, jumlah: 1, harga: 100_000 }]);
  const [bR] = psj.baris;
  const ps = await stokSesudah(k, "t6 stok 1 @ 50.000", 1, 50_000);
  await jalankan("SJ t6", () => buatPengiriman(formulir({ pesananId: psj.id, gudangId: k.gudang.id, baris: [{ barisPesananId: bR.id, barangId: k.barang.id, jumlah: 1 }] })));
  const sj = await db.pengirimanPesanan.findFirstOrThrow({ where: { pesananId: psj.id }, include: { baris: true } });
  await jalankan("F t6", () => buatFaktur(formFaktur(psj.id, bR.id, 1)));
  const f = await fakturTerbaru(psj.id);
  const rincian = async () => new Map((await periksaKonsumsiSj(db)).rincian.map((r) => [r.kode, r]));

  await db.barisFakturPenjualan.update({ where: { id: f.baris[0].id }, data: { nilaiTransit: 50_001 } });
  const r1 = (await rincian()).get("TRANSIT_CATATAN")!;
  pastikan(r1.jumlah === 1 && r1.contoh.join() === f.nomor, `TRANSIT_CATATAN memberi nomor faktur ${f.nomor} (${r1.contoh.join()})`);
  await db.barisFakturPenjualan.update({ where: { id: f.baris[0].id }, data: { nilaiTransit: 50_000 } });

  await db.barisPengiriman.update({ where: { id: sj.baris[0].id }, data: { jumlahDifaktur: 0 } });
  const r2 = (await rincian()).get("CATATAN_MELEBIHI_DIFAKTUR")!;
  pastikan(r2.jumlah === 1 && r2.contoh.join() === sj.nomor, `CATATAN_MELEBIHI_DIFAKTUR memberi nomor SJ ${sj.nomor} (${r2.contoh.join()})`);
  await db.barisPengiriman.update({ where: { id: sj.baris[0].id }, data: { jumlahDifaktur: 1 } });

  await db.fakturPenjualan.update({ where: { id: f.id }, data: { konsumsiSjTercatat: false } });
  const r4 = (await rincian()).get("CATATAN_FAKTUR_TIDAK_TERCATAT")!;
  pastikan(r4.jumlah === 1 && r4.contoh.join() === f.nomor && !(await periksaKonsumsiSj(db)).sinkron, `catatan pada faktur tidak tercatat terhitung dengan nomor ${f.nomor} (${r4.contoh.join()})`);
  await db.fakturPenjualan.update({ where: { id: f.id }, data: { konsumsiSjTercatat: true } });
  pastikan((await periksaKonsumsiSj(db)).sinkron, "invarian kembali tanpa temuan sesudah data dipulihkan");

  await jalankan("hapus F t6", () => hapusDokumen("faktur", f.id));
  await jalankan("hapus SJ t6", () => hapusDokumen("pengiriman", sj.id));
  await jalankan("hapus PSJ t6", () => hapusDokumen("pesanan", psj.id));
  await jalankan("hapus PS t6", () => hapusDokumen("penyesuaian", ps.id));
  await transitTepat("sesudah t6", awal, 0);
}

async function main() {
  await bersihkan();
  aturPersetujuan(false);
  const mulaiUji = new Date();
  const sinkronAwal = await periksaSinkron(db);
  const jurnalAwal = await db.jurnal.count();
  const notifikasiAwal = await db.notifikasi.count();
  try {
    const gudang = await db.gudang.create({ data: { kode: `WH-${K}`, nama: "Gudang Uji Konsumsi SJ Tahap 2" } });
    const barang = await db.barang.create({ data: { kode: `BRG-${K}`, nama: "Lampu Uji Konsumsi SJ Tahap 2", jenis: "BARANG", satuan: "unit", hargaBeli: 0, hargaJual: 100_000 } });
    const jasa = await db.barang.create({ data: { kode: `BRG-${K}-JASA`, nama: "Jasa Uji Konsumsi SJ Tahap 2", jenis: "JASA", satuan: "paket", hargaBeli: 0, hargaJual: 100 } });
    const pelanggan = await db.pelanggan.create({ data: { kode: `PLG-${K}`, nama: "Klien Uji Konsumsi SJ Tahap 2" } });
    const modal = await db.akun.create({ data: { kode: `UJI-${K}-MODAL`, nama: "Modal Uji Konsumsi SJ Tahap 2", jenis: "MODAL" } });
    const kas = await db.akun.create({ data: { kode: `UJI-${K}-KAS`, nama: "Kas Uji Konsumsi SJ Tahap 2", jenis: "ASET", kasBank: true } });
    const k: Konteks = { gudang, barang, jasa, pelanggan, modal, kas };
    if (jalan("t1")) await bagianT1(k);
    if (jalan("t2")) await bagianT2(k);
    if (jalan("t3")) await bagianT3(k);
    if (jalan("t4")) await bagianT4(k);
    if (jalan("t5")) await bagianT5(k);
    if (jalan("t6")) await bagianT6(k);
  } finally {
    aturPersetujuan(false);
    await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji }, penggunaNama: "Skrip Uji" } });
    await bersihkan();
  }
  pastikan((await jumlahCheck()) === 2, "kedua CHECK jumlahDifaktur tetap terpasang sesudah uji");
  pastikan((await db.jurnal.count()) === jurnalAwal, "jumlah jurnal sama dengan sebelum uji");
  pastikan((await db.notifikasi.count()) === notifikasiAwal, "tidak ada notifikasi tersisa dari uji");
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron seimbang dan sama dengan sebelum uji");
  const invarian = await periksaKonsumsiSj(db);
  pastikan(invarian.sinkron, `periksaKonsumsiSj tanpa temuan sesudah uji (${invarian.rincian.map((r) => `${r.kode} ${r.jumlah}`).join(", ")})`);
  console.log("=== DONE, all konsumsi-sj-tahap2 checks passed ===");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
