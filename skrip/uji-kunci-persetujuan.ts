import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import type { Prisma } from "../src/prisma-klien/client";
import { db } from "../src/lib/db";
import { D } from "../src/lib/uang";
import { periksaSinkron } from "../src/lib/sinkron";
import { BERKAS, type JenisPersetujuan } from "../src/lib/persetujuan";
import { ajukanDokumen, setujuiDokumen, tolakDokumen } from "../src/lib/aksi/persetujuan";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { harusDitolak, jalankan, pastikan, sebagai } from "./bantuan";

/*
 * Kunci persetujuan dan stok (tinjauan perbaikan P21, dikerjakan di perbaikan P22).
 * 1. Butir 4 dan 6: untuk kedelapan jenis di BERKAS, transaksi A memegang BERKAS[jenis].kunci atas baris tabel yang
 *    ditulis di sini secara terpisah dari kode (salah salin nama tabel di kode tertangkap). Koneksi lain yang meminta
 *    FOR NO KEY UPDATE NOWAIT pada baris itu gagal 55P03, sedangkan FOR KEY SHARE NOWAIT (yang diambil sisipan baris
 *    anak lewat kunci asing) tetap berhasil. Sesudah A selesai, NOWAIT berhasil.
 * 2. Butir 2: posting Penyesuaian Stok mengunci baris StokBarang sebelum membandingkan jumlahSebelum. Mutasi stok lain
 *    yang belum commit membuat setujui menunggu lalu menolak dengan pesan "sudah berubah", bukan menimpa stok.
 *    Dua penyesuaian serentak atas barang yang sama: tepat satu disetujui.
 * 3. Butir 5: ajukan atau tolak ganda mendapat pesan "sudah berstatus ..."; setujui ganda tetap memakai pesan lama.
 * Data uji berawalan UJIKP dan dihapus di akhir; periksaSinkron, jumlah jurnal, dan HakAksesPeran sama dengan awal.
 */

const AWALAN = "UJIKP";

/** Nama tabel per jenis, ditulis ulang di sini (bukan dibaca dari kode) supaya kunci yang salah tabel tertangkap. */
const TABEL: Record<JenisPersetujuan, string> = {
  faktur: "FakturPenjualan",
  fakturPembelian: "FakturPembelian",
  dokumenKas: "DokumenKas",
  penyesuaian: "PenyesuaianPersediaan",
  peminjaman: "PeminjamanBarang",
  kerusakan: "LaporanKerusakanBarang",
  aset: "AsetTetap",
  penggajian: "Penggajian",
};

async function bersihkan() {
  for (const p of await db.penyesuaianPersediaan.findMany({ where: { nomor: { startsWith: AWALAN } }, select: { id: true, jurnalId: true } })) {
    await db.barisPenyesuaianPersediaan.deleteMany({ where: { penyesuaianId: p.id } });
    await db.penyesuaianPersediaan.delete({ where: { id: p.id } });
    if (p.jurnalId) {
      await db.barisJurnal.deleteMany({ where: { jurnalId: p.jurnalId } });
      await db.jurnal.delete({ where: { id: p.jurnalId } });
    }
  }
  await db.barisJurnal.deleteMany({ where: { jurnal: { keterangan: { contains: AWALAN } } } });
  await db.jurnal.deleteMany({ where: { keterangan: { contains: AWALAN } } });
  await db.fakturPenjualan.deleteMany({ where: { nomor: { startsWith: AWALAN } } });
  await db.fakturPembelian.deleteMany({ where: { nomor: { startsWith: AWALAN } } });
  await db.dokumenKas.deleteMany({ where: { nomor: { startsWith: AWALAN } } });
  await db.peminjamanBarang.deleteMany({ where: { nomor: { startsWith: AWALAN } } });
  await db.laporanKerusakanBarang.deleteMany({ where: { nomor: { startsWith: AWALAN } } });
  await db.asetTetap.deleteMany({ where: { kode: { startsWith: AWALAN } } });
  await db.penggajian.deleteMany({ where: { nomor: { startsWith: AWALAN } } });
  await db.stokBarang.deleteMany({ where: { barang: { kode: { startsWith: AWALAN } } } });
  await db.barang.deleteMany({ where: { kode: { startsWith: AWALAN } } });
  await db.pelanggan.deleteMany({ where: { kode: { startsWith: AWALAN } } });
  await db.pemasok.deleteMany({ where: { kode: { startsWith: AWALAN } } });
  await db.notifikasi.deleteMany({ where: { OR: [{ judul: { contains: AWALAN } }, { isi: { contains: AWALAN } }] } });
  await db.logAktivitas.deleteMany({ where: { nomor: { startsWith: AWALAN } } });
}

/** Kode SQLSTATE dari galat Prisma (kueri mentah melaporkannya di pesan). */
function sqlstate(e: unknown): string {
  const meta = (e as { meta?: { code?: string } })?.meta;
  if (meta?.code) return meta.code;
  return /Code: `([0-9A-Z]{5})`/.exec(String((e as Error)?.message ?? ""))?.[1] ?? "";
}

/** Menjalankan kueri kunci dari koneksi pool di luar transaksi penahan: "ok" atau SQLSTATE galatnya. */
async function cobaKunci(sql: () => Promise<unknown>): Promise<string> {
  try {
    await sql();
    return "ok";
  } catch (e) {
    return sqlstate(e) || String((e as Error)?.message ?? e);
  }
}

/**
 * Menjalankan pegang(tx) di transaksi yang ditahan terbuka, lalu `selagi()` dari koneksi lain, lalu melepas tahanan.
 * Mengembalikan hasil `selagi`.
 */
async function selagiTerkunci<T>(pegang: (tx: Prisma.TransactionClient) => Promise<unknown>, selagi: () => Promise<T>): Promise<T> {
  let lepas!: () => void;
  let siap!: () => void;
  const tahan = new Promise<void>((r) => (lepas = r));
  const terkunci = new Promise<void>((r) => (siap = r));
  const penahan = db.$transaction(
    async (tx) => {
      await pegang(tx);
      siap();
      await tahan;
    },
    { timeout: 60_000 },
  );
  await Promise.race([terkunci, penahan]);
  try {
    return await selagi();
  } finally {
    lepas();
    await penahan;
  }
}

async function tungguAntre(n: number) {
  for (let t = 0; t < 400; t++) {
    const [{ antre }] = await db.$queryRaw<{ antre: number }[]>`SELECT count(*)::int AS "antre" FROM pg_locks WHERE NOT granted`;
    if (antre >= n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`antrean kunci tidak mencapai ${n}`);
}

/** Galat revalidatePath di luar HTTP terjadi sesudah transaksi selesai, jadi dianggap sukses. */
async function aksi(k: () => Promise<unknown>): Promise<string> {
  try {
    await k();
    return "ok";
  } catch (e) {
    const pesan = String((e as Error)?.message ?? e);
    return pesan.includes("static generation store missing") ? "ok" : pesan;
  }
}

async function main() {
  await bersihkan();
  const sinkronAwal = await periksaSinkron(db);
  const jurnalAwal = await db.jurnal.count();
  const hakAwal = await db.hakAksesPeran.count();
  const m = await db.pemetaanAkun.findUniqueOrThrow({ where: { id: "default" } });
  const akunKode = async (kode: string) => (await db.akun.findFirstOrThrow({ where: { kode } })).id;
  const kKas = await akunKode("1-1100");
  const akunBeban = await db.akun.findFirstOrThrow({ where: { jenis: "BEBAN", kelompok: false, perusahaanId: null }, orderBy: { kode: "asc" } });
  const gudang = await db.gudang.findFirstOrThrow({ orderBy: { kode: "asc" } });
  const kasir = await db.pengguna.findUniqueOrThrow({ where: { namaPengguna: "kasir" } });

  try {
    console.log("=== 1. Kunci baris per jenis: FOR NO KEY UPDATE pada tabel yang benar (butir 4 dan 6) ===");
    const pelanggan = await db.pelanggan.create({ data: { kode: `${AWALAN}-PLG`, nama: "Pelanggan Uji Kunci" } });
    const pemasok = await db.pemasok.create({ data: { kode: `${AWALAN}-PMS`, nama: "Pemasok Uji Kunci" } });
    const id: Record<JenisPersetujuan, string> = {
      faktur: (await db.fakturPenjualan.create({ data: { nomor: `${AWALAN}-FJ1`, pelangganId: pelanggan.id } })).id,
      fakturPembelian: (await db.fakturPembelian.create({ data: { nomor: `${AWALAN}-FB1`, pemasokId: pemasok.id } })).id,
      dokumenKas: (await db.dokumenKas.create({ data: { nomor: `${AWALAN}-KM1`, jenis: "MASUK", akunKasId: kKas, akunLawanId: m.pendapatanPenjualanId!, jumlah: 1000, dibuatOleh: "kasir" } })).id,
      penyesuaian: (await db.penyesuaianPersediaan.create({ data: { nomor: `${AWALAN}-PS1`, gudangId: gudang.id, akunLawanId: akunBeban.id } })).id,
      peminjaman: (await db.peminjamanBarang.create({ data: { nomor: `${AWALAN}-PJ1`, gudangId: gudang.id, namaPengambil: "Uji", dicatatOlehNama: "Uji" } })).id,
      kerusakan: (await db.laporanKerusakanBarang.create({ data: { nomor: `${AWALAN}-LK1`, gudangId: gudang.id, namaPelapor: "Uji", dicatatOlehNama: "Uji" } })).id,
      aset: (await db.asetTetap.create({ data: { kode: `${AWALAN}-AST1`, nama: "Aset Uji Kunci", hargaPerolehan: 1000, umurBulan: 12, akunAsetId: kKas, akunBebanPenyusutanId: akunBeban.id, akunAkumulasiPenyusutanId: kKas } })).id,
      penggajian: (await db.penggajian.create({ data: { nomor: `${AWALAN}-GJ1`, periode: `${AWALAN}-2099-12`, bulan: "2099-12", akunKasId: kKas, penggunaNama: "Uji" } })).id,
    };
    pastikan(Object.keys(TABEL).length === Object.keys(BERKAS).length && (Object.keys(BERKAS) as JenisPersetujuan[]).every((j) => j in TABEL), "daftar tabel uji memuat setiap jenis di BERKAS");
    for (const jenis of Object.keys(BERKAS) as JenisPersetujuan[]) {
      const tabel = TABEL[jenis];
      const baris = id[jenis];
      const [noKey, keyShare] = await selagiTerkunci(
        (tx) => BERKAS[jenis].kunci(tx, baris),
        async () => [
          await cobaKunci(() => db.$queryRawUnsafe(`SELECT 1 FROM "${tabel}" WHERE "id" = $1 FOR NO KEY UPDATE NOWAIT`, baris)),
          await cobaKunci(() => db.$queryRawUnsafe(`SELECT 1 FROM "${tabel}" WHERE "id" = $1 FOR KEY SHARE NOWAIT`, baris)),
        ],
      );
      pastikan(noKey === "55P03", `${jenis}: selagi kunci dipegang, FOR NO KEY UPDATE NOWAIT pada ${tabel} gagal 55P03 (${noKey})`);
      pastikan(keyShare === "ok", `${jenis}: FOR KEY SHARE NOWAIT (sisipan baris anak) tidak terhalang (${keyShare})`);
      const sesudah = await cobaKunci(() => db.$queryRawUnsafe(`SELECT 1 FROM "${tabel}" WHERE "id" = $1 FOR NO KEY UPDATE NOWAIT`, baris));
      pastikan(sesudah === "ok", `${jenis}: sesudah kunci dilepas, NOWAIT berhasil (${sesudah})`);
    }

    console.log("=== 2. Posting Penyesuaian Stok mengunci baris stok (butir 2) ===");
    const barang = await db.barang.create({ data: { kode: `${AWALAN}-BRG`, nama: "Barang Uji Kunci", jenis: "BARANG" } });
    await db.stokBarang.create({ data: { barangId: barang.id, gudangId: gudang.id, jumlah: 10 } });
    const stok = async () => D((await db.stokBarang.findUniqueOrThrow({ where: { barangId_gudangId: { barangId: barang.id, gudangId: gudang.id } } })).jumlah).toFixed(2);
    const buatPs = (nomor: string, sebelum: number, sesudah: number) =>
      db.penyesuaianPersediaan.create({
        data: {
          nomor,
          gudangId: gudang.id,
          akunLawanId: akunBeban.id,
          statusPersetujuan: "MENUNGGU",
          diajukanOlehId: kasir.id,
          baris: { create: [{ barangId: barang.id, jumlahSebelum: sebelum, jumlahSesudah: sesudah, hargaSatuan: 100 }] },
        },
      });
    // mutasi stok lain (seperti SJ yang mengurangi 3) belum commit saat penyesuaian disetujui
    const p1 = await buatPs(`${AWALAN}-PS2`, 10, 12);
    const hasilP1 = await selagiTerkunci(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "StokBarang" WHERE "barangId" = ${barang.id} AND "gudangId" = ${gudang.id} FOR UPDATE`;
        await tx.stokBarang.update({ where: { barangId_gudangId: { barangId: barang.id, gudangId: gudang.id } }, data: { jumlah: { decrement: 3 } } });
      },
      async () => {
        // janji dibungkus objek supaya selagiTerkunci tidak menunggunya sebelum tahanan dilepas
        const janji = sebagai("owner", () => aksi(() => setujuiDokumen("penyesuaian", p1.id)));
        await tungguAntre(1);
        return { janji };
      },
    ).then((h) => h.janji);
    const p1Akhir = await db.penyesuaianPersediaan.findUniqueOrThrow({ where: { id: p1.id } });
    pastikan(hasilP1.includes("sudah berubah sejak") && (await stok()) === "7.00", `setujui yang menunggu mutasi stok lain ditolak "sudah berubah", stok 7 tidak tertimpa 12 (${hasilP1}, stok ${await stok()})`);
    pastikan(p1Akhir.statusPersetujuan === "MENUNGGU" && p1Akhir.jurnalId === null, "penyesuaian yang ditolak tetap MENUNGGU tanpa jurnal");

    // kontrol: tanpa mutasi lain, setujui berhasil; hapus membalik stok dan jurnal
    const p2 = await buatPs(`${AWALAN}-PS3`, 7, 9);
    await sebagai("owner", () => jalankan("setujui penyesuaian 7 ke 9", () => setujuiDokumen("penyesuaian", p2.id)));
    pastikan((await stok()) === "9.00" && (await db.penyesuaianPersediaan.findUniqueOrThrow({ where: { id: p2.id } })).jurnalId !== null, "kontrol: stok 9 dan jurnal penyesuaian tercatat");
    await sebagai("owner", () => jalankan("hapus penyesuaian 7 ke 9", () => hapusDokumen("penyesuaian", p2.id)));
    pastikan((await stok()) === "7.00", "hapus penyesuaian mengembalikan stok 7");

    // dua penyesuaian serentak atas barang yang sama dari potret stok yang sama: tepat satu disetujui
    for (let i = 1; i <= 3; i++) {
      const awal = Number(await stok());
      const a = await buatPs(`${AWALAN}-PS4${i}`, awal, awal + 2);
      const b = await buatPs(`${AWALAN}-PS5${i}`, awal, awal - 1);
      const [ha, hb] = await sebagai("owner", () => Promise.all([aksi(() => setujuiDokumen("penyesuaian", a.id)), aksi(() => setujuiDokumen("penyesuaian", b.id))]));
      const lolos = [ha, hb].filter((h) => h === "ok").length;
      const harap = ha === "ok" ? awal + 2 : awal - 1;
      pastikan(lolos === 1 && [ha, hb].some((h) => h.includes("sudah berubah sejak")) && (await stok()) === harap.toFixed(2), `putaran ${i}: dua penyesuaian serentak, tepat satu disetujui, stok ${await stok()} sesuai pemenang (${ha} | ${hb})`);
      for (const p of [a, b]) {
        const s = await db.penyesuaianPersediaan.findUniqueOrThrow({ where: { id: p.id } });
        if (s.statusPersetujuan === "DISETUJUI") await sebagai("owner", () => jalankan(`hapus ${s.nomor}`, () => hapusDokumen("penyesuaian", p.id)));
      }
      pastikan((await stok()) === awal.toFixed(2), `putaran ${i}: sesudah pemenang dihapus stok kembali ${awal}`);
    }
    pastikan((await periksaSinkron(db)).seimbang, "periksaSinkron seimbang sesudah uji penyesuaian");

    console.log("=== 3. Pesan ajukan dan tolak ganda (butir 5) ===");
    const km = await db.dokumenKas.create({ data: { nomor: `${AWALAN}-KM2`, jenis: "MASUK", akunKasId: kKas, akunLawanId: m.pendapatanPenjualanId!, jumlah: 2000, keterangan: `Kas masuk ${AWALAN}-KM2`, dibuatOleh: "kasir" } });
    await sebagai("kasir", () => jalankan("ajukan KM2", () => ajukanDokumen("dokumenKas", km.id)));
    await harusDitolak("ajukan KM2 lagi", () => sebagai("kasir", () => ajukanDokumen("dokumenKas", km.id)), `Kas Masuk / Kas Keluar ${AWALAN}-KM2 sudah berstatus "Menunggu persetujuan". Muat ulang halaman untuk melihat status terbarunya`);
    await sebagai("owner", () => jalankan("tolak KM2", () => tolakDokumen("dokumenKas", km.id, "Uji tolak")));
    await harusDitolak("tolak KM2 lagi", () => sebagai("owner", () => tolakDokumen("dokumenKas", km.id, "Uji tolak")), `${AWALAN}-KM2 sudah berstatus "Ditolak". Muat ulang halaman`);
    await sebagai("kasir", () => jalankan("ajukan ulang KM2 sesudah ditolak", () => ajukanDokumen("dokumenKas", km.id)));
    await sebagai("owner", () => jalankan("setujui KM2", () => setujuiDokumen("dokumenKas", km.id)));
    await harusDitolak("setujui KM2 lagi (pesan lama)", () => sebagai("owner", () => setujuiDokumen("dokumenKas", km.id)), "sudah disetujui dan jurnalnya sudah masuk buku besar");
    await harusDitolak("ajukan KM2 yang sudah disetujui (pesan lama)", () => sebagai("kasir", () => ajukanDokumen("dokumenKas", km.id)), "sudah disetujui dan jurnalnya sudah masuk buku besar");
    await sebagai("owner", () => jalankan("hapus KM2", () => hapusDokumen("dokumenKas", km.id)));
  } finally {
    await bersihkan();
  }
  pastikan((await db.jurnal.count()) === jurnalAwal, "jumlah jurnal sama dengan sebelum uji");
  pastikan((await db.hakAksesPeran.count()) === hakAwal, "HakAksesPeran tidak berubah");
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron seimbang dan sama dengan sebelum uji");
  console.log("=== DONE, all kunci-persetujuan checks passed ===");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
