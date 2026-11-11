import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import type { Prisma } from "../src/prisma-klien/client";
import { D, type Desimal } from "../src/lib/uang";
import { periksaSinkron } from "../src/lib/sinkron";
import { KODE_BARANG_LAIN } from "../src/lib/barangLainLain";
import { buatPenawaran, buatPesanan, buatPengiriman, buatFaktur, buatRetur, konversiPenawaranKePesanan } from "../src/lib/aksi/penjualan";
import { buatPenyesuaianPersediaan } from "../src/lib/aksi/persediaan";
import { hapusDokumen, type JenisDokumen } from "../src/lib/aksi/hapusDokumen";
import { ubahPenawaran } from "../src/lib/aksi/dokumenPenjualan";
import { aturPersetujuan, formulir, harusDitolak, jalankan, pastikan } from "./bantuan";

/*
 * P23: barang yang sama di beberapa baris dokumen penjualan (D2 §9.2 uji-baris-ganda, perbaikan pencocokan per id):
 *  1. pesanan EVENT dengan barang sama di dua seksi dan dua baris bebas; 2. SJ per baris; 3. faktur jalur ID hanya
 *  menyentuh baris pesanan dan baris SJ-nya; 4. kiriman rakitan ditolak; 5. faktur kedua menutup semua baris;
 *  6. retur jalur ID memakai harga baris faktur itu; jalur lama faktur dan retur pada pesanan STANDAR berbarang ganda
 *  membagi jumlah ke baris berbarang sama (tinjauan P23 S1); 7. hapus faktur jalur ID hanya membalik barisnya; 8. jalur
 *  lama pada pesanan bergaya lama tetap lolos dan hapusnya sama dengan cabang lama; 8b. tinjauan P23 R1-R5 (sisa
 *  kumulatif, faktur serentak, prorata retur, surat jalan rujukan, klaim konversi); 8c. perbaikan P25: konversi membaca
 *  baris penawaran di dalam transaksi sesudah klaim, jadi ubahPenawaran yang selesai tepat sebelumnya ikut tersalin;
 *  8d. perbaikan tinjauan P25: jalur lama barang ganda mendahulukan baris yang sudah dikirim sehingga HPP diakui dan
 *  transit habis (T1), SJ yatim dari data lama dikonsumsi lintas baris dan dibalik saat faktur dihapus, serta faktur
 *  jalur lama dibagi ulang di dalam transaksi (R6); 9. bersih-bersih dan sinkron.
 */

const K = "GND";
const sama = (x: unknown, harap: number | string) => D(x as Desimal).equals(D(harap));

async function bersihkan() {
  const pel = (await db.pelanggan.findMany({ where: { kode: { startsWith: `PLG-${K}` } }, select: { id: true } })).map((p) => p.id);
  const jurnalIds: string[] = [];
  const kumpul = (xs: { jurnalId: string | null }[]) => jurnalIds.push(...xs.flatMap((x) => (x.jurnalId ? [x.jurnalId] : [])));
  if (pel.length > 0) {
    const faktur = await db.fakturPenjualan.findMany({ where: { pelangganId: { in: pel } }, select: { id: true, jurnalId: true } });
    const fakturIds = faktur.map((f) => f.id);
    const retur = await db.returPenjualan.findMany({ where: { fakturId: { in: fakturIds } }, select: { id: true, jurnalId: true } });
    const pesanan = await db.pesananPenjualan.findMany({ where: { pelangganId: { in: pel } }, select: { id: true } });
    const sj = await db.pengirimanPesanan.findMany({ where: { pesananId: { in: pesanan.map((p) => p.id) } }, select: { id: true, jurnalId: true } });
    for (const xs of [faktur, retur, sj]) kumpul(xs);
    await db.barisReturPenjualan.deleteMany({ where: { returId: { in: retur.map((r) => r.id) } } });
    await db.returPenjualan.deleteMany({ where: { id: { in: retur.map((r) => r.id) } } });
    await db.barisFakturPenjualan.deleteMany({ where: { fakturId: { in: fakturIds } } });
    await db.fakturPenjualan.deleteMany({ where: { id: { in: fakturIds } } });
    await db.barisPengiriman.deleteMany({ where: { pengirimanId: { in: sj.map((s) => s.id) } } });
    await db.pengirimanPesanan.deleteMany({ where: { id: { in: sj.map((s) => s.id) } } });
    await db.rencanaTermin.deleteMany({ where: { pesananId: { in: pesanan.map((p) => p.id) } } });
    await db.barisPesananPenjualan.deleteMany({ where: { pesananId: { in: pesanan.map((p) => p.id) } } });
    await db.pesananPenjualan.deleteMany({ where: { id: { in: pesanan.map((p) => p.id) } } });
    const pnw = await db.penawaranPenjualan.findMany({ where: { pelangganId: { in: pel } }, select: { id: true } });
    await db.rencanaTermin.deleteMany({ where: { penawaranId: { in: pnw.map((p) => p.id) } } });
    await db.barisPenawaranPenjualan.deleteMany({ where: { penawaranId: { in: pnw.map((p) => p.id) } } });
    await db.penawaranPenjualan.deleteMany({ where: { id: { in: pnw.map((p) => p.id) } } });
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

/** Penahan memegang kunci di transaksi sendiri sampai `selagi` selesai (pola uji-kunci-persetujuan). */
async function selagiTerkunci<T>(pegang: (tx: Prisma.TransactionClient) => Promise<unknown>, selagi: (pid: number) => Promise<T>): Promise<T> {
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
  const pid = await Promise.race([terkunci, penahan.then(() => -1)]);
  try {
    return await selagi(pid);
  } finally {
    lepas();
    await penahan;
  }
}

/** Menunggu sampai n sesi terhalang penahan, langsung atau lewat sesi lain yang juga menunggu. */
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

/** Kerja dijalankan berurutan masuk antrean di belakang penahan, lalu penahan dilepas. Hasil "ok" atau pesan galat. */
async function berantre(pegang: (tx: Prisma.TransactionClient) => Promise<unknown>, kerja: (() => Promise<unknown>)[]): Promise<string[]> {
  const { janji } = await selagiTerkunci(pegang, async (pid) => {
    const janji: Promise<string>[] = [];
    for (const [i, k] of kerja.entries()) {
      janji.push(aksi(k));
      await tungguAntre(pid, i + 1);
    }
    return { janji };
  });
  return Promise.all(janji);
}

async function main() {
  await bersihkan();
  aturPersetujuan(false);
  const mulaiUji = new Date();
  const sinkronAwal = await periksaSinkron(db);
  const jurnalAwal = await db.jurnal.count();
  const lainLainAwal = await db.barang.findUnique({ where: { kode: KODE_BARANG_LAIN }, select: { id: true } });
  try {
    await uji();
  } finally {
    await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji }, penggunaNama: "Skrip Uji" } });
    await bersihkan();
    if (!lainLainAwal) {
      const dipakai =
        (await db.barisPenawaranPenjualan.count({ where: { barang: { kode: KODE_BARANG_LAIN } } })) +
        (await db.barisPesananPenjualan.count({ where: { barang: { kode: KODE_BARANG_LAIN } } })) +
        (await db.barisFakturPenjualan.count({ where: { barang: { kode: KODE_BARANG_LAIN } } }));
      if (dipakai === 0) await db.barang.deleteMany({ where: { kode: KODE_BARANG_LAIN } });
    }
  }
  pastikan(lainLainAwal !== null || (await db.barang.count({ where: { kode: KODE_BARANG_LAIN } })) === 0, "Barang JASA-LAIN buatan suite ini sudah dihapus");
  pastikan((await db.jurnal.count()) === jurnalAwal, "jumlah jurnal sama dengan sebelum uji");
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron seimbang dan sama dengan sebelum uji");
  console.log("=== DONE, all baris-ganda checks passed ===");
}

async function uji() {
  console.log("=== 1. Data dan pesanan EVENT dengan barang sama di dua seksi ===");
  const gudang = await db.gudang.create({ data: { kode: `WH-${K}`, nama: "Gudang Uji Baris Ganda" } });
  const barang = await db.barang.create({ data: { kode: `BRG-${K}`, nama: "Lampu Uji Baris Ganda", jenis: "BARANG", satuan: "unit", hargaBeli: 50_000, hargaJual: 100_000 } });
  const pelanggan = await db.pelanggan.create({ data: { kode: `PLG-${K}`, nama: "Klien Uji Baris Ganda" } });
  const modal = await db.akun.create({ data: { kode: `UJI-${K}-MODAL`, nama: "Modal Uji Baris Ganda", jenis: "MODAL" } });
  await jalankan("PS saldo awal 10 @ 50.000", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudang.id, akunLawanId: modal.id, baris: [{ barangId: barang.id, jumlahSesudah: 10, hargaSatuan: 50_000 }] })));
  const stok = async () => D((await db.stokBarang.findUnique({ where: { barangId_gudangId: { barangId: barang.id, gudangId: gudang.id } } }))?.jumlah ?? 0);

  // pesanan bergaya lama (STANDAR, barang tunggal) untuk bagian 4 dan 8
  await jalankan("PSJ lama STANDAR 4 @ 100.000", () => buatPesanan(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: barang.id, jumlah: 4, harga: 100_000 }] })));
  const psjLama = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id }, include: { baris: true } });
  await jalankan("PSJ EVENT: A 2 @ 100.000 (Hari 1), B 3 @ 200.000 (Hari 2), dua baris bebas", () =>
    buatPesanan(
      formulir({
        pelangganId: pelanggan.id,
        mode: "EVENT",
        ppnPersen: 0,
        baris: [
          { barangId: barang.id, jumlah: 2, harga: 100_000, bagian: "Hari 1" },
          { barangId: barang.id, jumlah: 3, harga: 200_000, bagian: "Hari 2" },
          { nama: "Sewa genset", jumlah: 1, harga: 500_000, bagian: "Produksi" },
          { nama: "Transport kru", jumlah: 1, harga: 300_000, bagian: "Transportasi" },
        ],
      }),
    ),
  );
  const psj = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id, mode: "EVENT" }, include: { baris: { orderBy: { urutan: "asc" }, include: { barang: true } } } });
  const [bA, bB, bC, bD] = psj.baris;
  pastikan(psj.baris.length === 4 && bA.barangId === bB.barangId && bA.bagian === "Hari 1" && bB.bagian === "Hari 2", "baris A dan B memakai barang yang sama di dua seksi");
  pastikan(bC.barang.kode === KODE_BARANG_LAIN && bD.barangId === bC.barangId && bC.nama === "Sewa genset" && bD.nama === "Transport kru", "baris C dan D sama-sama JASA-LAIN dengan nama berbeda");
  pastikan(sama(psj.total, 1_600_000), `total pesanan 200.000 + 600.000 + 500.000 + 300.000 = 1.600.000 (${psj.total})`);

  console.log("=== 2. SJ per baris ===");
  await jalankan("SJ A 2 dan B 3", () => buatPengiriman(formulir({ pesananId: psj.id, gudangId: gudang.id, baris: [{ barisPesananId: bA.id, barangId: barang.id, jumlah: 2 }, { barisPesananId: bB.id, barangId: barang.id, jumlah: 3 }] })));
  const sj = await db.pengirimanPesanan.findFirstOrThrow({ where: { pesananId: psj.id }, include: { baris: true } });
  const sjA = sj.baris.find((b) => b.barisPesananId === bA.id)!;
  const sjB = sj.baris.find((b) => b.barisPesananId === bB.id)!;
  pastikan((await stok()).equals(5) && sama(sjA.jumlah, 2) && sama(sjB.jumlah, 3), "stok 10 → 5, baris SJ A 2 dan B 3");
  const difakturSj = async (id: string) => D((await db.barisPengiriman.findUniqueOrThrow({ where: { id } })).jumlahDifaktur);
  const difakturBp = async (id: string) => D((await db.barisPesananPenjualan.findUniqueOrThrow({ where: { id } })).jumlahDifaktur);

  console.log("=== 3. Faktur 1 jalur ID: baris A saja ===");
  await jalankan("FJ1 A 2", () => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, baris: [{ barisPesananId: bA.id, barangId: barang.id, jumlah: 2 }] })));
  const fj1 = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj.id }, include: { baris: true } });
  pastikan((await difakturBp(bA.id)).equals(2) && (await difakturBp(bB.id)).isZero(), "baris pesanan A difaktur 2, B tetap 0 (tidak menumpuk di baris pertama)");
  pastikan(sama(fj1.baris[0].nilaiTransit, 100_000) && fj1.baris[0].barisPesananId === bA.id && sama(fj1.total, 200_000), "nilai transit faktur 1 = 2 × harga pokok SJ baris A");
  pastikan((await difakturSj(sjA.id)).equals(2) && (await difakturSj(sjB.id)).isZero(), "faktur 1 hanya mengonsumsi baris SJ A");

  console.log("=== 4. Kiriman rakitan ditolak ===");
  await harusDitolak("dua baris B @ 3 (kumulatif 6)", () => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, baris: [{ barisPesananId: bB.id, jumlah: 3 }, { barisPesananId: bB.id, jumlah: 3 }] })), "melebihi sisa yang belum ditagih (sisa 3, diminta 6)");
  await harusDitolak("baris pesanan lain", () => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, baris: [{ barisPesananId: psjLama.baris[0].id, jumlah: 1 }] })), "Baris pesanan tidak ditemukan di pesanan ini");
  await harusDitolak("campuran berid dan tanpa id", () => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, baris: [{ barisPesananId: bB.id, jumlah: 1 }, { barangId: barang.id, jumlah: 1, harga: 200_000 }] })), "semuanya memakai baris pesanan");
  await harusDitolak("jalur lama pada pesanan ini", () => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, baris: [{ barangId: barang.id, jumlah: 1, harga: 200_000 }] })), "wajib dibuat dari komposer faktur");
  pastikan((await db.fakturPenjualan.count({ where: { pesananId: psj.id } })) === 1 && (await difakturBp(bB.id)).isZero(), "kiriman yang ditolak tidak menyimpan faktur");

  console.log("=== 5. Faktur 2: B 3, C 1, D 1 ===");
  await jalankan("FJ2 B 3, C 1, D 1", () => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, baris: [{ barisPesananId: bB.id, jumlah: 3 }, { barisPesananId: bC.id, jumlah: 1 }, { barisPesananId: bD.id, jumlah: 1 }] })));
  const fj2 = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj.id, NOT: { id: fj1.id } }, include: { baris: { orderBy: { urutan: "asc" } } } });
  pastikan(sama(fj2.total, 1_400_000) && fj2.baris.map((b) => b.barisPesananId).join() === [bB.id, bC.id, bD.id].join() && fj2.baris[1].nama === "Sewa genset", "faktur 2 total 1.400.000, satu baris faktur per baris pesanan");
  const barisPsj = await db.barisPesananPenjualan.findMany({ where: { pesananId: psj.id } });
  // ekspresi daftar pesanan (src/app/(aplikasi)/penjualan/pesanan/page.tsx): difaktur semua
  const difakturSemua = barisPsj.every((l) => Number(l.jumlahDifaktur) >= Number(l.jumlah));
  pastikan(difakturSemua, "daftar pesanan menganggap pesanan difaktur semua");
  pastikan(sama(fj2.baris[0].nilaiTransit, 150_000) && (await difakturSj(sjB.id)).equals(3) && (await difakturSj(sjA.id)).equals(2), "faktur 2 mengonsumsi baris SJ B saja (transit 150.000)");

  console.log("=== 6. Retur jalur ID dan jalur lama ===");
  const fbB = fj2.baris[0];
  await jalankan("RJ1 jalur ID baris B 1 unit", () => buatRetur(formulir({ fakturId: fj2.id, gudangId: gudang.id, baris: [{ barisFakturId: fbB.id, barangId: barang.id, jumlah: 1 }] })));
  const rj1 = await db.returPenjualan.findFirstOrThrow({ where: { fakturId: fj2.id }, include: { baris: true } });
  pastikan(sama(rj1.total, 200_000) && rj1.baris[0].barisFakturId === fbB.id, `retur baris B bernilai 200.000, bukan 100.000 milik baris A (${rj1.total})`);
  await harusDitolak("retur baris B 3 lagi", () => buatRetur(formulir({ fakturId: fj2.id, gudangId: gudang.id, baris: [{ barisFakturId: fbB.id, jumlah: 3 }] })), "maks 2");
  await jalankan("RJ2 jalur lama barang tunggal di faktur 2", () => buatRetur(formulir({ fakturId: fj2.id, gudangId: gudang.id, baris: [{ barangId: barang.id, jumlah: 1 }] })));
  const rj2 = await db.returPenjualan.findFirstOrThrow({ where: { fakturId: fj2.id, NOT: { id: rj1.id } }, include: { baris: true } });
  pastikan(sama(rj2.total, 200_000) && rj2.baris[0].barisFakturId === fbB.id, "retur jalur lama mengisi barisFakturId baris B dan memakai harganya");
  pastikan((await stok()).equals(7), "dua retur barang menambah stok 5 → 7");
  // pesanan STANDAR berbarang ganda lewat komposer lama (tinjauan P23 S1): jalur lama membagi jumlah per barang ke
  // baris berbarang sama urut urutan lalu id; sisa diperiksa per barang dan kumulatif
  await jalankan("PSJ STANDAR barang ganda 1 @ 100.000 + 1 @ 150.000", () => buatPesanan(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: barang.id, jumlah: 1, harga: 100_000 }, { barangId: barang.id, jumlah: 1, harga: 150_000 }] })));
  const psj3 = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id, mode: "STANDAR", total: 250_000 }, include: { baris: { orderBy: { urutan: "asc" } } } });
  const [bA3, bB3] = psj3.baris;
  await harusDitolak("jalur lama 3 unit (sisa barang 2)", () => buatFaktur(formulir({ pesananId: psj3.id, ppnPersen: 0, baris: [{ barangId: barang.id, jumlah: 3, harga: 100_000 }] })), "melebihi sisa yang belum ditagih (sisa 2, diminta 3)");
  await harusDitolak("jalur lama 2 + 1 unit (kumulatif 3, tinjauan P23 R1)", () => buatFaktur(formulir({ pesananId: psj3.id, ppnPersen: 0, baris: [{ barangId: barang.id, jumlah: 2, harga: 100_000 }, { barangId: barang.id, jumlah: 1, harga: 150_000 }] })), "melebihi sisa yang belum ditagih (sisa 0, diminta 1)");
  await harusDitolak("surat jalan pesanan lain sebagai rujukan (tinjauan P23 R4)", () => buatFaktur(formulir({ pesananId: psj3.id, pengirimanId: sj.id, ppnPersen: 0, baris: [{ barangId: barang.id, jumlah: 1, harga: 100_000 }, { barangId: barang.id, jumlah: 1, harga: 150_000 }] })), "Surat jalan tidak ditemukan di pesanan ini");
  pastikan((await db.fakturPenjualan.count({ where: { pesananId: psj3.id } })) === 0, "kiriman yang ditolak tidak menyimpan faktur");
  await jalankan("FJ3 jalur lama komposer lama: barang sama dua baris 1 @ 100.000 dan 1 @ 150.000", () => buatFaktur(formulir({ pesananId: psj3.id, ppnPersen: 0, baris: [{ barangId: barang.id, jumlah: 1, harga: 100_000 }, { barangId: barang.id, jumlah: 1, harga: 150_000 }] })));
  const fj3 = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj3.id }, include: { baris: { orderBy: { urutan: "asc" } } } });
  pastikan(sama(fj3.total, 250_000) && fj3.baris.length === 2 && fj3.baris[0].barisPesananId === bA3.id && fj3.baris[1].barisPesananId === bB3.id && sama(fj3.baris[0].harga, 100_000) && sama(fj3.baris[1].harga, 150_000), "faktur 250.000, baris pertama ke baris pesanan pertama, baris kedua ke baris pesanan kedua");
  pastikan((await difakturBp(bA3.id)).equals(1) && (await difakturBp(bB3.id)).equals(1), "kedua baris pesanan berbarang sama difaktur 1");
  // pesanan berbarang ganda lain: satu baris kiriman 2 unit dibagi ke dua baris pesanan
  await jalankan("PSJ STANDAR barang ganda kedua 1 @ 100.000 + 2 @ 100.000", () => buatPesanan(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: barang.id, jumlah: 1, harga: 100_000 }, { barangId: barang.id, jumlah: 2, harga: 100_000 }] })));
  const psj4 = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id, mode: "STANDAR", total: 300_000 }, include: { baris: { orderBy: { urutan: "asc" } } } });
  await jalankan("FJ4 jalur lama satu baris kiriman 2 unit", () => buatFaktur(formulir({ pesananId: psj4.id, ppnPersen: 0, baris: [{ barangId: barang.id, jumlah: 2, harga: 100_000 }] })));
  const fj4 = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj4.id }, include: { baris: { orderBy: { urutan: "asc" } } } });
  pastikan(fj4.baris.map((b) => `${b.barisPesananId === psj4.baris[0].id ? "A" : "B"}:${D(b.jumlah)}`).join() === "A:1,B:1" && sama(fj4.total, 200_000), "kiriman 2 unit dibagi: 1 ke baris pertama (penuh), 1 ke baris kedua");
  // retur jalur lama atas faktur berbarang ganda: dijumlahkan per barang lalu dibagi ke baris faktur urut urutan
  await harusDitolak("retur jalur lama 1 + 2 unit atas faktur gabungan (kumulatif 3, tinjauan P23 R2)", () => buatRetur(formulir({ fakturId: fj3.id, gudangId: gudang.id, baris: [{ barangId: barang.id, jumlah: 1 }, { barangId: barang.id, jumlah: 2 }] })), "melebihi yang bisa diretur (maks 2, diminta 3)");
  await jalankan("RJ3 jalur lama 1 unit atas faktur gabungan", () => buatRetur(formulir({ fakturId: fj3.id, gudangId: gudang.id, baris: [{ barangId: barang.id, jumlah: 1 }] })));
  const rj3 = await db.returPenjualan.findFirstOrThrow({ where: { fakturId: fj3.id }, include: { baris: true } });
  pastikan(sama(rj3.total, 100_000) && rj3.baris.length === 1 && rj3.baris[0].barisFakturId === fj3.baris[0].id, "retur jalur lama mengambil baris faktur pertama dengan harganya (100.000)");
  await harusDitolak("retur jalur lama 1 + 1 unit sesudah RJ3 (maks 1)", () => buatRetur(formulir({ fakturId: fj3.id, gudangId: gudang.id, baris: [{ barangId: barang.id, jumlah: 1 }, { barangId: barang.id, jumlah: 1 }] })), "melebihi yang bisa diretur (maks 1, diminta 2)");
  await jalankan("RJ4 jalur lama 1 unit sisa", () => buatRetur(formulir({ fakturId: fj3.id, gudangId: gudang.id, baris: [{ barangId: barang.id, jumlah: 1 }] })));
  const rj4 = await db.returPenjualan.findFirstOrThrow({ where: { fakturId: fj3.id, NOT: { id: rj3.id } }, include: { baris: true } });
  pastikan(sama(rj4.total, 150_000) && rj4.baris[0].barisFakturId === fj3.baris[1].id, "retur berikutnya mengambil baris faktur kedua dengan harganya (150.000)");
  await jalankan("hapus RJ4", () => hapusDokumen("returPenjualan", rj4.id));
  await jalankan("hapus RJ3", () => hapusDokumen("returPenjualan", rj3.id));

  console.log("=== 7. Hapus faktur 2 hanya membalik baris B, C, D ===");
  await jalankan("hapus RJ2", () => hapusDokumen("returPenjualan", rj2.id));
  await jalankan("hapus RJ1", () => hapusDokumen("returPenjualan", rj1.id));
  await jalankan("hapus FJ2", () => hapusDokumen("faktur", fj2.id));
  pastikan((await difakturBp(bA.id)).equals(2) && (await difakturBp(bB.id)).isZero() && (await difakturBp(bC.id)).isZero() && (await difakturBp(bD.id)).isZero(), "baris A tetap 2; B, C, D kembali 0");
  pastikan((await difakturSj(sjB.id)).isZero() && (await difakturSj(sjA.id)).equals(2), "baris SJ B kembali 0; baris SJ A tidak tersentuh");
  pastikan((await stok()).equals(5), "stok kembali 5 sesudah retur dihapus");

  console.log("=== 8. Jalur lama pada pesanan bergaya lama ===");
  const bpLama = psjLama.baris[0];
  await jalankan("SJ pesanan lama 4", () => buatPengiriman(formulir({ pesananId: psjLama.id, gudangId: gudang.id, baris: [{ barisPesananId: bpLama.id, barangId: barang.id, jumlah: 4 }] })));
  const sjLama = await db.pengirimanPesanan.findFirstOrThrow({ where: { pesananId: psjLama.id }, include: { baris: true } });
  const putaran = async (cabangLama: boolean) => {
    await jalankan(`FJ jalur lama 3 @ 100.000 dengan surat jalan pesanan sendiri (${cabangLama ? "lalu dihapus lewat cabang lama" : "lalu dihapus lewat cabang id"})`, () => buatFaktur(formulir({ pesananId: psjLama.id, pengirimanId: sjLama.id, ppnPersen: 0, baris: [{ barangId: barang.id, jumlah: 3, harga: 100_000 }] })));
    const f = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psjLama.id }, include: { baris: true } });
    pastikan(f.baris[0].barisPesananId === bpLama.id && sama(f.baris[0].frekuensi, 1) && sama(f.baris[0].nilaiTransit, 150_000) && f.pengirimanId === sjLama.id, "jalur lama mengisi barisPesananId, frekuensi 1, transit 3 × 50.000, surat jalan rujukan tersimpan");
    const sesudahBuat = [await difakturBp(bpLama.id), await difakturSj(sjLama.baris[0].id)].map(String).join();
    // baris faktur lama (sebelum migrasi) tidak punya barisPesananId: hapus memakai kode lama per barangId
    if (cabangLama) await db.barisFakturPenjualan.updateMany({ where: { fakturId: f.id }, data: { barisPesananId: null } });
    await jalankan(`hapus faktur lama (${cabangLama ? "cabang barangId" : "cabang id"})`, () => hapusDokumen("faktur", f.id));
    return { sesudahBuat, sesudahHapus: [await difakturBp(bpLama.id), await difakturSj(sjLama.baris[0].id)].map(String).join() };
  };
  const cabangId = await putaran(false);
  const cabangLama = await putaran(true);
  pastikan(cabangId.sesudahBuat === "3,3" && JSON.stringify(cabangId) === JSON.stringify(cabangLama) && cabangId.sesudahHapus === "0,0", `hapus cabang id sama dengan cabang lama (${JSON.stringify(cabangId)} vs ${JSON.stringify(cabangLama)})`);

  await bagianTinjauan({ pelanggan, gudang, barang });
  await bagianTransit({ pelanggan, gudang, barang });

  console.log("=== 9. Bersih-bersih ===");
  const hapus = (jenis: JenisDokumen, id: string, label: string) => jalankan(`hapus ${label}`, () => hapusDokumen(jenis, id));
  await hapus("faktur", fj4.id, "FJ4");
  await hapus("pesanan", psj4.id, "pesanan barang ganda kedua");
  await hapus("faktur", fj3.id, "FJ3");
  await hapus("faktur", fj1.id, "FJ1");
  await hapus("pengiriman", sj.id, "SJ pesanan EVENT");
  await hapus("pengiriman", sjLama.id, "SJ pesanan lama");
  await hapus("pesanan", psj.id, "pesanan EVENT");
  await hapus("pesanan", psj3.id, "pesanan barang ganda");
  await hapus("pesanan", psjLama.id, "pesanan lama");
  const ps = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { baris: { some: { barangId: barang.id } } } });
  await hapus("penyesuaian", ps.id, "PS saldo awal");
  const s = await periksaSinkron(db);
  pastikan(s.seimbang && s.persediaan.sinkron && s.piutang.sinkron && s.barangTerkirim.sinkron, "periksaSinkron sinkron sesudah dokumen uji dihapus");
}

/** Bagian 8b: tinjauan P23 R1 (faktur serentak jalur lama), R3 (prorata fee dan diskon retur), R5 (klaim konversi). */
async function bagianTinjauan(d: { pelanggan: { id: string }; gudang: { id: string }; barang: { id: string } }) {
  console.log("=== 8b. Faktur serentak, prorata retur, klaim konversi ===");
  const jasa = await db.barang.create({ data: { kode: `BRG-${K}-JASA`, nama: "Jasa Uji Baris Ganda", jenis: "JASA", satuan: "paket", hargaBeli: 0, hargaJual: 100 } });

  // R1: dua faktur jalur lama serentak atas sisa yang sama; yang kedua ditolak di dalam transaksi
  await jalankan("PSJ jasa 2 @ 100", () => buatPesanan(formulir({ pelangganId: d.pelanggan.id, baris: [{ barangId: jasa.id, jumlah: 2, harga: 100 }] })));
  const psjR = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: d.pelanggan.id, total: 200 }, include: { baris: true } });
  const kirimR = () => buatFaktur(formulir({ pesananId: psjR.id, ppnPersen: 0, baris: [{ barangId: jasa.id, jumlah: 2, harga: 100 }] }));
  const hasilR = await berantre((tx) => tx.$queryRaw`SELECT 1 FROM "BarisPesananPenjualan" WHERE "id" = ${psjR.baris[0].id} FOR UPDATE`, [kirimR, kirimR]);
  pastikan(hasilR[0] === "ok" && hasilR[1].includes("melebihi sisa yang belum ditagih (sisa 0, diminta 2)"), `faktur jalur lama serentak: yang pertama lolos, yang kedua ditolak (${hasilR.join(" | ")})`);
  pastikan((await db.fakturPenjualan.count({ where: { pesananId: psjR.id } })) === 1 && D((await db.barisPesananPenjualan.findUniqueOrThrow({ where: { id: psjR.baris[0].id } })).jumlahDifaktur).equals(2), "hanya satu faktur tersimpan; baris pesanan difaktur 2, tidak 4");
  const fjR = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psjR.id } });

  // R3: faktur tiga baris @ 100 dengan fee dan diskon nominal 5; tiga retur satu baris tidak melebihi 5
  await jalankan("PSJ jasa tiga baris @ 100, diskon 5, fee nominal 5", () =>
    buatPesanan(formulir({ pelangganId: d.pelanggan.id, mode: "EVENT", ppnPersen: 0, nilaiDiskon: 5, jenisFee: "NOMINAL", nilaiFee: 5, baris: [1, 2, 3].map((n) => ({ barangId: jasa.id, jumlah: 1, harga: 100, bagian: `Hari ${n}` })) })),
  );
  const psjF = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: d.pelanggan.id, mode: "EVENT", total: 300 }, include: { baris: { orderBy: { urutan: "asc" } } } });
  await jalankan("FJ jalur ID tiga baris", () => buatFaktur(formulir({ pesananId: psjF.id, ppnPersen: 0, baris: psjF.baris.map((b) => ({ barisPesananId: b.id, jumlah: 1 })) })));
  const fjF = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psjF.id }, include: { baris: { orderBy: { urutan: "asc" } } } });
  pastikan(sama(fjF.fee, 5) && sama(fjF.diskon, 5) && sama(fjF.total, 300), "faktur fee 5, diskon 5, total 300");
  const returF: { id: string; diskon: string; fee: string; total: string }[] = [];
  for (const [i, b] of fjF.baris.entries()) {
    await jalankan(`RJ baris ${i + 1}`, () => buatRetur(formulir({ fakturId: fjF.id, gudangId: d.gudang.id, baris: [{ barisFakturId: b.id, jumlah: 1 }] })));
    const r = await db.returPenjualan.findFirstOrThrow({ where: { fakturId: fjF.id, NOT: { id: { in: returF.map((x) => x.id) } } } });
    returF.push({ id: r.id, diskon: D(r.diskon).toFixed(2), fee: D(r.fee).toFixed(2), total: D(r.total).toFixed(2) });
  }
  pastikan(returF.map((r) => `${r.fee}/${r.diskon}`).join() === "1.67/1.67,1.67/1.67,1.66/1.66", `fee dan diskon retur 1,67 + 1,67 + 1,66 = 5 (${returF.map((r) => `${r.fee}/${r.diskon}`).join()})`);
  pastikan(returF.reduce((t, r) => t.plus(r.total), D(0)).equals(D(fjF.total)) && (await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fjF.id } })).status === "LUNAS", "Σ total retur = total faktur; faktur LUNAS");
  for (const r of [...returF].reverse()) await jalankan("hapus retur prorata", () => hapusDokumen("returPenjualan", r.id));

  // R5: penawaran ditolak tepat saat konversi menunggu kunci baris penawaran
  await jalankan("PNW jasa 1 @ 100", () => buatPenawaran(formulir({ pelangganId: d.pelanggan.id, baris: [{ barangId: jasa.id, jumlah: 1, harga: 100 }] })));
  const pnw = await db.penawaranPenjualan.findFirstOrThrow({ where: { pelangganId: d.pelanggan.id } });
  const hasilK = await berantre((tx) => tx.$executeRaw`UPDATE "PenawaranPenjualan" SET "statusKomersial" = 'DITOLAK' WHERE "id" = ${pnw.id}`, [() => konversiPenawaranKePesanan(pnw.id)]);
  pastikan(hasilK[0].includes("berstatus Ditolak; ubah statusnya dulu"), `konversi yang menunggu penolakan serentak ikut ditolak (${hasilK[0]})`);
  const pnwSesudah = await db.penawaranPenjualan.findUniqueOrThrow({ where: { id: pnw.id } });
  pastikan(pnwSesudah.status === "DRAF" && pnwSesudah.statusKomersial === "DITOLAK" && (await db.pesananPenjualan.count({ where: { penawaranId: pnw.id } })) === 0, "penawaran tetap DRAF berstatus Ditolak, tanpa pesanan");

  await jalankan("hapus PNW", () => hapusDokumen("penawaran", pnw.id));

  // 8c (perbaikan P25): ubahPenawaran dan konversi menunggu kunci baris penawaran yang sama. Konversi membaca penawaran
  // sebelum ubah selesai, tetapi pesanan harus memuat isi sesudah ubah karena baris dibaca ulang sesudah klaim.
  console.log("=== 8c. Konversi sesudah ubah penawaran serentak ===");
  const kunciPnw = (id: string) => (tx: Prisma.TransactionClient) => tx.$queryRaw`SELECT 1 FROM "PenawaranPenjualan" WHERE "id" = ${id} FOR UPDATE`;
  await jalankan("PNW-U jasa 1 @ 100", () => buatPenawaran(formulir({ pelangganId: d.pelanggan.id, ppnPersen: 0, namaEvent: "Ubah Lalu Konversi", baris: [{ barangId: jasa.id, jumlah: 1, harga: 100 }] })));
  const pnwU = await db.penawaranPenjualan.findFirstOrThrow({ where: { pelangganId: d.pelanggan.id, namaEvent: "Ubah Lalu Konversi" } });
  const isianUbah = formulir({
    pelangganId: d.pelanggan.id,
    ppnPersen: 0,
    namaEvent: "Ubah Lalu Konversi (revisi)",
    jenisFee: "NOMINAL",
    nilaiFee: 20,
    baris: [
      { barangId: jasa.id, jumlah: 3, harga: 200, bagian: "Hari 1" },
      { nama: "Transport revisi", jumlah: 1, harga: 50, bagian: "Hari 1" },
    ],
    rencanaTermin: [{ label: "DP", nilai: 50 }, { label: "Pelunasan" }],
  });
  const hasilU = await berantre(kunciPnw(pnwU.id), [() => ubahPenawaran(pnwU.id, isianUbah), () => konversiPenawaranKePesanan(pnwU.id)]);
  pastikan(hasilU[0] === "ok" && hasilU[1] === "ok", `ubah lalu konversi serentak sama-sama lolos (${hasilU.join(" | ")})`);
  const psjU = await db.pesananPenjualan.findFirstOrThrow({ where: { penawaranId: pnwU.id }, include: { baris: { orderBy: { urutan: "asc" } }, rencanaTermin: { orderBy: { no: "asc" } } } });
  pastikan(
    psjU.baris.length === 2 && sama(psjU.baris[0].jumlah, 3) && sama(psjU.baris[0].harga, 200) && psjU.baris[1].nama === "Transport revisi" && sama(psjU.baris[1].harga, 50),
    `pesanan memuat baris sesudah ubah, bukan baris lama (${psjU.baris.map((b) => `${D(b.jumlah).toFixed(0)}@${D(b.harga).toFixed(0)}`).join(", ")})`,
  );
  pastikan(sama(psjU.total, 670) && sama(psjU.fee, 20) && psjU.namaEvent === "Ubah Lalu Konversi (revisi)", `kepala pesanan dari isi sesudah ubah: total 650 + fee 20 = 670, nama event revisi (total ${D(psjU.total).toFixed(2)})`);
  pastikan(psjU.rencanaTermin.length === 2 && psjU.rencanaTermin.map((b) => b.label).join() === "DP,Pelunasan", "rencana termin sesudah ubah ikut tersalin ke pesanan");

  // urutan sebaliknya: konversi menang, ubah yang menunggu ditolak, pesanan memuat baris asli
  await jalankan("PNW-K jasa 1 @ 100", () => buatPenawaran(formulir({ pelangganId: d.pelanggan.id, ppnPersen: 0, namaEvent: "Konversi Lalu Ubah", baris: [{ barangId: jasa.id, jumlah: 1, harga: 100 }] })));
  const pnwK = await db.penawaranPenjualan.findFirstOrThrow({ where: { pelangganId: d.pelanggan.id, namaEvent: "Konversi Lalu Ubah" } });
  const hasilK2 = await berantre(kunciPnw(pnwK.id), [() => konversiPenawaranKePesanan(pnwK.id), () => ubahPenawaran(pnwK.id, isianUbah)]);
  pastikan(hasilK2[0] === "ok" && hasilK2[1].includes("sudah dikonversi tidak bisa diubah"), `konversi lebih dulu: ubah yang menunggu ditolak (${hasilK2.join(" | ")})`);
  const psjK = await db.pesananPenjualan.findFirstOrThrow({ where: { penawaranId: pnwK.id }, include: { baris: true } });
  const pnwKSesudah = await db.penawaranPenjualan.findUniqueOrThrow({ where: { id: pnwK.id }, include: { baris: true } });
  pastikan(psjK.baris.length === 1 && sama(psjK.baris[0].jumlah, 1) && sama(psjK.total, 100) && pnwKSesudah.baris.length === 1 && sama(pnwKSesudah.total, 100), "pesanan dan penawaran tetap berisi baris asli");

  for (const p of [psjU, psjK]) await jalankan("hapus PSJ konversi serentak", () => hapusDokumen("pesanan", p.id));
  for (const p of [pnwU, pnwK]) await jalankan("hapus PNW konversi serentak", () => hapusDokumen("penawaran", p.id));
  await jalankan("hapus FJ prorata", () => hapusDokumen("faktur", fjF.id));
  await jalankan("hapus PSJ prorata", () => hapusDokumen("pesanan", psjF.id));
  await jalankan("hapus FJ serentak", () => hapusDokumen("faktur", fjR.id));
  await jalankan("hapus PSJ serentak", () => hapusDokumen("pesanan", psjR.id));
}

/** Bagian 8d: perbaikan tinjauan P25 T1 (HPP jalur lama barang ganda, SJ yatim) dan R6 (bagi ulang di transaksi). */
async function bagianTransit(d: { pelanggan: { id: string }; gudang: { id: string }; barang: { id: string } }) {
  console.log("=== 8d. Jalur lama barang ganda dengan surat jalan, SJ yatim, bagi ulang serentak ===");
  const transitAwal = (await periksaSinkron(db)).barangTerkirim.bukuBesar;
  // tiga unit tambahan untuk tiga surat jalan bagian ini, dengan harga pokok yang sama (50.000)
  const modal = await db.akun.findUniqueOrThrow({ where: { kode: `UJI-${K}-MODAL` } });
  const stokKini = D((await db.stokBarang.findUniqueOrThrow({ where: { barangId_gudangId: { barangId: d.barang.id, gudangId: d.gudang.id } } })).jumlah);
  await jalankan("PS tambah 3 @ 50.000", () => buatPenyesuaianPersediaan(formulir({ gudangId: d.gudang.id, akunLawanId: modal.id, keterangan: `${K} 8d`, baris: [{ barangId: d.barang.id, jumlahSesudah: stokKini.plus(3).toNumber(), hargaSatuan: 50_000 }] })));
  const psTambah = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { keterangan: `${K} 8d` } });
  const pesananBaru = async (label: string, harga: [number, number]) => {
    await jalankan(`PSJ STANDAR ${label}: A 1 @ ${harga[0]}, B 1 @ ${harga[1]}`, () => buatPesanan(formulir({ pelangganId: d.pelanggan.id, ppnPersen: 0, baris: harga.map((h) => ({ barangId: d.barang.id, jumlah: 1, harga: h })) })));
    return db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: d.pelanggan.id, mode: "STANDAR", total: harga[0] + harga[1] }, include: { baris: { orderBy: [{ urutan: "asc" }, { id: "asc" }] } } });
  };
  const kirim = async (pesananId: string, barisPesananId: string, label: string) => {
    await jalankan(`SJ ${label} 1`, () => buatPengiriman(formulir({ pesananId, gudangId: d.gudang.id, baris: [{ barisPesananId, barangId: d.barang.id, jumlah: 1 }] })));
    return db.pengirimanPesanan.findFirstOrThrow({ where: { pesananId, baris: { some: { barisPesananId } } }, include: { baris: true } });
  };
  const fakturLama = (pesananId: string, harga: number, label: string) => jalankan(label, () => buatFaktur(formulir({ pesananId, ppnPersen: 0, baris: [{ barangId: d.barang.id, jumlah: 1, harga }] })));
  const fakturTerbaru = (pesananId: string) => db.fakturPenjualan.findFirstOrThrow({ where: { pesananId }, orderBy: { nomor: "desc" }, include: { baris: true } });
  const belumDifaktur = async (pesananId: string) =>
    (await db.barisPengiriman.findMany({ where: { pengiriman: { pesananId } } })).reduce((t, b) => t.plus(D(b.jumlah).minus(D(b.jumlahDifaktur))), D(0));
  const difakturSj = async (id: string) => D((await db.barisPengiriman.findUniqueOrThrow({ where: { id } })).jumlahDifaktur);
  const transitSinkron = async (label: string) => {
    const s = await periksaSinkron(db);
    pastikan(s.seimbang && s.barangTerkirim.sinkron, `${label}: periksaSinkron seimbang dan barang terkirim sinkron (buku besar ${s.barangTerkirim.bukuBesar}, dokumen ${s.barangTerkirim.dokumen})`);
    return s.barangTerkirim.bukuBesar;
  };

  // T1: SJ hanya untuk baris B. Faktur jalur lama 1 unit wajib jatuh ke B dan mengonsumsi SJ B (kode lama: per barang)
  const psjT = await pesananBaru("T1", [110_000, 120_000]);
  const [tA, tB] = psjT.baris;
  const sjTB = await kirim(psjT.id, tB.id, "baris B");
  await fakturLama(psjT.id, 110_000, "FJ-T1 jalur lama 1 unit");
  const fjT1 = await fakturTerbaru(psjT.id);
  pastikan(fjT1.baris.length === 1 && fjT1.baris[0].barisPesananId === tB.id && sama(fjT1.baris[0].nilaiTransit, 50_000), `faktur pertama ke baris B yang sudah dikirim, transit 50.000 = harga pokok SJ B (${fjT1.baris[0].nilaiTransit})`);
  pastikan((await difakturSj(sjTB.baris[0].id)).equals(1), "baris SJ B habis difaktur");
  const sjTA = await kirim(psjT.id, tA.id, "baris A");
  await fakturLama(psjT.id, 110_000, "FJ-T2 jalur lama 1 unit");
  const fjT2 = await fakturTerbaru(psjT.id);
  pastikan(fjT2.id !== fjT1.id && fjT2.baris[0].barisPesananId === tA.id && sama(fjT2.baris[0].nilaiTransit, 50_000) && (await difakturSj(sjTA.baris[0].id)).equals(1), "faktur kedua ke baris A dan mengonsumsi SJ A (transit 50.000)");
  pastikan((await belumDifaktur(psjT.id)).isZero(), "semua baris SJ pesanan T1 sudah difaktur, tidak ada transit tertahan");
  pastikan((await transitSinkron("sesudah T1")).equals(transitAwal), "saldo barang terkirim kembali ke saldo awal (transit pesanan T1 = 0)");

  // SJ yatim: data lama menumpuk jumlahDifaktur di baris A tanpa mengonsumsi SJ A (kode lama mengonsumsi per barang)
  const psjO = await pesananBaru("SJ yatim", [130_000, 140_000]);
  const [oA, oB] = psjO.baris;
  const sjOA = await kirim(psjO.id, oA.id, "baris A");
  await db.barisPesananPenjualan.update({ where: { id: oA.id }, data: { jumlahDifaktur: 1 } });
  await jalankan("FJ-O1 jalur ID baris B", () => buatFaktur(formulir({ pesananId: psjO.id, ppnPersen: 0, baris: [{ barisPesananId: oB.id, jumlah: 1 }] })));
  const fjO1 = await fakturTerbaru(psjO.id);
  pastikan(sama(fjO1.baris[0].nilaiTransit, 50_000) && (await difakturSj(sjOA.baris[0].id)).equals(1) && (await belumDifaktur(psjO.id)).isZero(), "jalur ID: SJ A yang yatim (baris A penuh) dikonsumsi faktur baris B, HPP diakui");
  await transitSinkron("sesudah FJ-O1");
  await jalankan("hapus FJ-O1", () => hapusDokumen("faktur", fjO1.id));
  pastikan((await difakturSj(sjOA.baris[0].id)).isZero(), "hapus faktur mengembalikan konsumsi SJ yatim");
  await transitSinkron("sesudah hapus FJ-O1");
  await fakturLama(psjO.id, 140_000, "FJ-O2 jalur lama 1 unit");
  const fjO2 = await fakturTerbaru(psjO.id);
  pastikan(fjO2.baris[0].barisPesananId === oB.id && sama(fjO2.baris[0].nilaiTransit, 50_000) && (await belumDifaktur(psjO.id)).isZero(), "jalur lama: potongan ke baris B (A penuh) dan mengonsumsi SJ yatim A");
  await transitSinkron("sesudah FJ-O2");
  await jalankan("hapus FJ-O2", () => hapusDokumen("faktur", fjO2.id));
  pastikan((await difakturSj(sjOA.baris[0].id)).isZero(), "hapus faktur jalur lama mengembalikan konsumsi SJ yatim");
  await db.barisPesananPenjualan.update({ where: { id: oA.id }, data: { jumlahDifaktur: 0 } });

  // R6: faktur lain selesai selagi faktur jalur lama menunggu; pembagian diulang dari baris yang dibaca di transaksi
  const psjR = await pesananBaru("R6", [160_000, 170_000]);
  const [rA, rB] = psjR.baris;
  const hasilR = await berantre((tx) => tx.$executeRaw`UPDATE "BarisPesananPenjualan" SET "jumlahDifaktur" = 1 WHERE "id" = ${rA.id}`, [() => buatFaktur(formulir({ pesananId: psjR.id, ppnPersen: 0, baris: [{ barangId: d.barang.id, jumlah: 1, harga: 160_000 }] }))]);
  const fjR = await fakturTerbaru(psjR.id);
  pastikan(hasilR[0] === "ok" && fjR.baris.length === 1 && fjR.baris[0].barisPesananId === rB.id, `faktur jalur lama yang menunggu dibagi ulang ke baris B, tidak ditolak (${hasilR[0]})`);
  pastikan(D((await db.barisPesananPenjualan.findUniqueOrThrow({ where: { id: rB.id } })).jumlahDifaktur).equals(1), "baris B difaktur 1");

  await jalankan("hapus FJ-R6", () => hapusDokumen("faktur", fjR.id));
  await db.barisPesananPenjualan.update({ where: { id: rA.id }, data: { jumlahDifaktur: 0 } });
  await jalankan("hapus FJ-T2", () => hapusDokumen("faktur", fjT2.id));
  await jalankan("hapus SJ T1 baris A", () => hapusDokumen("pengiriman", sjTA.id));
  await jalankan("hapus FJ-T1", () => hapusDokumen("faktur", fjT1.id));
  await jalankan("hapus SJ T1 baris B", () => hapusDokumen("pengiriman", sjTB.id));
  await jalankan("hapus SJ yatim A", () => hapusDokumen("pengiriman", sjOA.id));
  for (const p of [psjT, psjO, psjR]) await jalankan("hapus PSJ 8d", () => hapusDokumen("pesanan", p.id));
  await jalankan("hapus PS tambah", () => hapusDokumen("penyesuaian", psTambah.id));
  pastikan((await transitSinkron("sesudah 8d dibersihkan")).equals(transitAwal), "saldo barang terkirim kembali ke awal");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
