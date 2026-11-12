import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { db } from "../src/lib/db";
import type { Prisma } from "../src/prisma-klien/client";
import { D, type Desimal } from "../src/lib/uang";
import { periksaKonsumsiSj, periksaSinkron } from "../src/lib/sinkron";
import { catatJurnalFakturPenjualan } from "../src/lib/akuntansi";
import { nomorDokumenBerikutnya } from "../src/lib/penomoran";
import { buatPesanan, buatPengiriman, buatFaktur } from "../src/lib/aksi/penjualan";
import { buatPenyesuaianPersediaan } from "../src/lib/aksi/persediaan";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { ubahTampilanDokumen } from "../src/lib/aksi/dokumenPenjualan";
import { setujuiDokumen } from "../src/lib/aksi/persetujuan";
import type { ButirProgres, ProgresTermin } from "../src/lib/rencanaTermin";
import PanelTermin from "../src/komponen/penjualan/PanelTermin";
import { aturPersetujuan, formulir, harusDitolak, jalankan, pastikan, sebagai } from "./bantuan";

/*
 * Perbaikan tinjauan perbaikan konsumsi SJ (TINJAU-PERBAIKAN P27, commit 9ccab13). Lanjutan uji-konsumsi-sj:
 *  sj.   S1: surat jalan yang menunggu kunci sementara faktur atas baris yang sama selesai lebih dulu menghitung porsi
 *        "sudah difaktur" dari data sesudah kunci, sehingga HPP unit itu diakui tepat sekali.
 *  sj2.  S1: dua surat jalan serentak tidak bisa mengirim melebihi pesanan.
 *  s2a.  S2a: hapus faktur lama yang berbarengan dengan faktur baru membaca ulang faktur pesanan sesudah kunci.
 *  s2b.  S2b: hapus faktur yang berbarengan dengan surat jalan baru membaca ulang surat jalan pesanan sesudah kunci.
 *  r1.   R1: hapus surat jalan yang berbarengan dengan faktur yang mengonsumsinya ditolak dengan pesan jelas.
 *  r2.   R2: ubah tampilan pesanan dan faktur atas baris yang sama tidak saling kunci (urutan kunci id).
 *  s3.   S3: cadangan faktur lama berhenti di nilaiTransit baris faktur bila pesanan punya faktur lain.
 *  r3.   R3: faktur ber-SJ lewat persetujuan, faktur jalur lama mencatat konsumsi, cadangan berbarisPesananId.
 *  r4.   R4: invarian periksaKonsumsiSj, CHECK jumlahDifaktur 0..jumlah, dan pembalik catatan bersyarat.
 *  r5.   R5: tanpa lihatBayar, tombol butir termin tidak membuka status bayar.
 * UJI_KONSUMSI_BAGIAN=<nama> menjalankan satu bagian saja.
 */

const K = "UKL";
const sama = (x: unknown, harap: number | string) => D(x as Desimal).equals(D(harap));
const hanya = process.env.UJI_KONSUMSI_BAGIAN;
const jalan = (bagian: string) => !hanya || hanya === bagian;

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
 * Penahan memegang kunci lewat `pegang`, lalu `isi` menyusun urutan kerja (menjalankan aksi dan menunggu antrean). Kerja
 * yang dikembalikan `isi` ditunggu sesudah penahan melepas kuncinya.
 */
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

type Konteks = { gudang: { id: string }; barang: { id: string }; jasa: { id: string }; pelanggan: { id: string }; modal: { id: string }; barangTerkirimId: string };

async function main() {
  await bersihkan();
  aturPersetujuan(false);
  const mulaiUji = new Date();
  const sinkronAwal = await periksaSinkron(db);
  const jurnalAwal = await db.jurnal.count();
  const notifikasiAwal = await db.notifikasi.count();
  try {
    const gudang = await db.gudang.create({ data: { kode: `WH-${K}`, nama: "Gudang Uji Konsumsi SJ Lanjut" } });
    const barang = await db.barang.create({ data: { kode: `BRG-${K}`, nama: "Lampu Uji Konsumsi SJ Lanjut", jenis: "BARANG", satuan: "unit", hargaBeli: 0, hargaJual: 100_000 } });
    const jasa = await db.barang.create({ data: { kode: `BRG-${K}-JASA`, nama: "Jasa Uji Konsumsi SJ Lanjut", jenis: "JASA", satuan: "paket", hargaBeli: 0, hargaJual: 100 } });
    const pelanggan = await db.pelanggan.create({ data: { kode: `PLG-${K}`, nama: "Klien Uji Konsumsi SJ Lanjut" } });
    const modal = await db.akun.create({ data: { kode: `UJI-${K}-MODAL`, nama: "Modal Uji Konsumsi SJ Lanjut", jenis: "MODAL" } });
    const pemetaan = await db.pemetaanAkun.findUniqueOrThrow({ where: { id: "default" } });
    const k: Konteks = { gudang, barang, jasa, pelanggan, modal, barangTerkirimId: pemetaan.barangTerkirimId! };
    if (jalan("sj")) await bagianSj(k);
    if (jalan("sj2")) await bagianSj2(k);
    if (jalan("s2a")) await bagianS2a(k);
    if (jalan("s2b")) await bagianS2b(k);
    if (jalan("r1")) await bagianR1(k);
    if (jalan("r2")) await bagianR2(k);
    if (jalan("s3")) await bagianS3(k);
    if (jalan("r3")) await bagianR3(k);
    if (jalan("r4")) await bagianR4(k);
    if (jalan("r5")) bagianR5();
  } finally {
    aturPersetujuan(false);
    await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji }, penggunaNama: "Skrip Uji" } });
    await bersihkan();
  }
  pastikan((await db.konsumsiSuratJalan.count({ where: { barisFaktur: { barang: { kode: { startsWith: `BRG-${K}` } } } } })) === 0, "catatan konsumsi uji sudah terhapus");
  pastikan((await db.jurnal.count()) === jurnalAwal, "jumlah jurnal sama dengan sebelum uji");
  pastikan((await db.notifikasi.count()) === notifikasiAwal, "tidak ada notifikasi tersisa dari uji");
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron seimbang dan sama dengan sebelum uji");
  const invarian = await periksaKonsumsiSj(db);
  pastikan(invarian.sinkron, `periksaKonsumsiSj tanpa temuan sesudah uji (${invarian.rincian.map((r) => `${r.kode} ${r.jumlah}`).join(", ")})`);
  console.log("=== DONE, all konsumsi-sj-lanjut checks passed ===");
}

// ---------- pembantu ----------

const stokSesudah = async (k: Konteks, label: string, jumlahSesudah: number, hargaSatuan: number) => {
  await jalankan(`PS ${label}: stok jadi ${jumlahSesudah} @ ${hargaSatuan}`, () =>
    buatPenyesuaianPersediaan(formulir({ gudangId: k.gudang.id, akunLawanId: k.modal.id, keterangan: `${K} ${label}`, baris: [{ barangId: k.barang.id, jumlahSesudah, hargaSatuan }] })),
  );
  return db.penyesuaianPersediaan.findFirstOrThrow({ where: { keterangan: `${K} ${label}` } });
};
const pesananBaru = async (k: Konteks, label: string, baris: { barangId: string; jumlah: number; harga: number }[]) => {
  await jalankan(`PSJ ${label}`, () => buatPesanan(formulir({ pelangganId: k.pelanggan.id, ppnPersen: 0, baris })));
  return db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: k.pelanggan.id }, orderBy: { nomor: "desc" }, include: { baris: { orderBy: [{ urutan: "asc" }, { id: "asc" }] } } });
};
const formSj = (k: Konteks, pesananId: string, barisPesananId: string, jumlah: number) => formulir({ pesananId, gudangId: k.gudang.id, baris: [{ barisPesananId, barangId: k.barang.id, jumlah }] });
const kirim = async (k: Konteks, pesananId: string, barisPesananId: string, jumlah: number, label: string) => {
  await jalankan(`SJ ${label}`, () => buatPengiriman(formSj(k, pesananId, barisPesananId, jumlah)));
  return sjTerbaru(pesananId);
};
const sjTerbaru = async (pesananId: string) => {
  const sj = await db.pengirimanPesanan.findFirstOrThrow({ where: { pesananId, baris: { some: {} } }, orderBy: { nomor: "desc" }, include: { baris: true } });
  return { sj, baris: sj.baris[0] };
};
const formFaktur = (pesananId: string, barisPesananId: string, jumlah: number) => formulir({ pesananId, ppnPersen: 0, baris: [{ barisPesananId, jumlah }] });
const fakturTerbaru = (pesananId: string) =>
  db.fakturPenjualan.findFirstOrThrow({ where: { pesananId }, orderBy: [{ tanggal: "desc" }, { nomor: "desc" }], include: { baris: { include: { konsumsiSj: true } } } });
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
/** Nomor SJ berikutnya dipesan dengan SJ pengganjal tanpa baris (nomor internal dihitung di luar transaksi). */
const ganjalSj = async (k: Konteks, pesananId: string) => {
  const berikut = await nomorDokumenBerikutnya(db.pengirimanPesanan, "SJ");
  const awalan = berikut.slice(0, berikut.lastIndexOf("-") + 1);
  return db.pengirimanPesanan.create({ data: { nomor: `${awalan}${String(Number(berikut.slice(awalan.length)) + 1).padStart(4, "0")}`, pesananId, gudangId: k.gudang.id } });
};

/**
 * Faktur buatan kode lama (konsumsiSjTercatat = false, tanpa catatan): baris faktur dengan nilaiTransit dan jurnal HPP-nya,
 * jumlahDifaktur baris pesanan (`tagih`) dan baris SJ (`pakai`) dinaikkan langsung seperti yang dulu dilakukan buatFaktur.
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
  pastikan(!f.konsumsiSjTercatat, `faktur lama ${nomor} tanpa catatan konsumsi (konsumsiSjTercatat = false)`);
  return f;
}

// ---------- sj: S1, surat jalan menunggu, faktur selesai lebih dulu ----------

async function bagianSj(k: Konteks) {
  console.log("=== sj. Surat jalan yang menunggu kunci stok menghitung porsi sudah difaktur dari data sesudah kunci ===");
  const awal = await sinkron("awal sj");
  const psj = await pesananBaru(k, "SJ: R 1 @ 100.000", [{ barangId: k.barang.id, jumlah: 1, harga: 100_000 }]);
  const [bR] = psj.baris;
  const ps = await stokSesudah(k, "sj harga pokok 50.000", 1, 50_000);
  const hasil = await denganPenahan(
    (tx) => tx.$queryRaw`SELECT 1 FROM "StokBarang" WHERE "barangId" = ${k.barang.id} AND "gudangId" = ${k.gudang.id} FOR UPDATE`,
    async (pid) => {
      const sj = aksi(() => buatPengiriman(formSj(k, psj.id, bR.id, 1)));
      await tungguAntre(pid, 1);
      // faktur atas baris yang sama selesai selagi surat jalan menunggu kunci stok
      const f = await aksi(() => buatFaktur(formFaktur(psj.id, bR.id, 1)));
      pastikan(f === "ok", `faktur R 1 selesai selagi surat jalan menunggu (${f})`);
      return [sj];
    },
  );
  pastikan(hasil[0] === "ok", `surat jalan yang menunggu lolos (${hasil[0]})`);
  const sj = await sjTerbaru(psj.id);
  const f = await fakturTerbaru(psj.id);
  pastikan(sama(f.baris[0].nilaiTransit, 0) && f.baris[0].konsumsiSj.length === 0, "faktur dibuat sebelum surat jalan commit: tanpa konsumsi SJ");
  pastikan((await difaktur(sj.baris.id)).equals(1), `baris SJ tercatat sudah difaktur 1 karena faktur selesai lebih dulu (${await difaktur(sj.baris.id)})`);
  await transitTepat("sesudah SJ dan faktur serentak (HPP diakui tepat sekali di jurnal SJ)", awal, 0);

  await jalankan("hapus SJ sj", () => hapusDokumen("pengiriman", sj.sj.id));
  await jalankan("hapus faktur sj", () => hapusDokumen("faktur", f.id));
  await jalankan("hapus PSJ sj", () => hapusDokumen("pesanan", psj.id));
  await jalankan("hapus PS sj", () => hapusDokumen("penyesuaian", ps.id));
  await transitTepat("sesudah sj dibersihkan", awal, 0);
}

// ---------- sj2: S1, dua surat jalan serentak ----------

async function bagianSj2(k: Konteks) {
  console.log("=== sj2. Dua surat jalan serentak tidak mengirim melebihi pesanan ===");
  const awal = await sinkron("awal sj2");
  const psj = await pesananBaru(k, "SJ2: R 2 @ 100.000", [{ barangId: k.barang.id, jumlah: 2, harga: 100_000 }]);
  const [bR] = psj.baris;
  const ps = await stokSesudah(k, "sj2 stok 4 @ 50.000", 4, 50_000);
  let ganjal: { id: string } | null = null;
  const hasil = await denganPenahan(
    (tx) => tx.$queryRaw`SELECT 1 FROM "StokBarang" WHERE "barangId" = ${k.barang.id} AND "gudangId" = ${k.gudang.id} FOR UPDATE`,
    async (pid) => {
      const a = aksi(() => buatPengiriman(formSj(k, psj.id, bR.id, 2)));
      await tungguAntre(pid, 1);
      ganjal = await ganjalSj(k, psj.id);
      const b = aksi(() => buatPengiriman(formSj(k, psj.id, bR.id, 2)));
      await tungguAntre(pid, 2);
      return [a, b];
    },
  );
  await db.pengirimanPesanan.delete({ where: { id: ganjal!.id } });
  pastikan(
    hasil.filter((h) => h === "ok").length === 1 && hasil.some((h) => h.includes("Kuantitas kirim melebihi sisa pesanan (sisa 0, diminta 2)")),
    `satu surat jalan lolos, yang lain ditolak melebihi sisa (${hasil.join(" | ")})`,
  );
  pastikan(sama((await db.barisPesananPenjualan.findUniqueOrThrow({ where: { id: bR.id } })).jumlahTerkirim, 2), "baris pesanan terkirim 2, tidak 4");
  await transitTepat("sesudah dua SJ serentak", awal, 100_000);

  for (const s of await db.pengirimanPesanan.findMany({ where: { pesananId: psj.id }, orderBy: { nomor: "desc" } })) await jalankan(`hapus ${s.nomor}`, () => hapusDokumen("pengiriman", s.id));
  await jalankan("hapus PSJ sj2", () => hapusDokumen("pesanan", psj.id));
  await jalankan("hapus PS sj2", () => hapusDokumen("penyesuaian", ps.id));
  await transitTepat("sesudah sj2 dibersihkan", awal, 0);
}

// ---------- s2a: hapus faktur lama berbarengan dengan faktur baru ----------

async function bagianS2a(k: Konteks) {
  console.log("=== s2a. Hapus faktur lama berbarengan dengan faktur baru: faktur pesanan dibaca ulang sesudah kunci ===");
  const awal = await sinkron("awal s2a");
  const psj = await pesananBaru(k, "S2a: R 2 @ 100.000", [{ barangId: k.barang.id, jumlah: 2, harga: 100_000 }]);
  const [bR] = psj.baris;
  const ps = await stokSesudah(k, "s2a stok 2 @ 50.000", 2, 50_000);
  const sj1 = await kirim(k, psj.id, bR.id, 1, "SJ-1 R 1");
  const sj2 = await kirim(k, psj.id, bR.id, 1, "SJ-2 R 1");
  const f0 = await fakturLama(k, psj.id, `${K}-FJL-S2A`, [{ barangId: k.barang.id, jumlah: 1, harga: 100_000, nilaiTransit: 50_000 }], [{ id: bR.id, jumlah: 1 }], [{ id: sj1.baris.id, jumlah: 1 }]);
  await transitTepat("sesudah F0 lama", awal, 50_000);

  const hasil = await denganPenahan(kunciBp(bR.id), async (pid) => {
    const f1 = aksi(() => buatFaktur(formFaktur(psj.id, bR.id, 1)));
    await tungguAntre(pid, 1);
    const hapus = aksi(() => hapusDokumen("faktur", f0.id));
    await tungguAntre(pid, 2);
    return [f1, hapus];
  });
  pastikan(hasil[0] === "ok", `faktur baru F1 lolos (${hasil[0]})`);
  pastikan(hasil[1].includes("Hapus faktur yang lebih baru dulu"), `hapus F0 yang menunggu ditolak karena F1 lebih baru (${hasil[1]})`);
  pastikan((await difaktur(sj1.baris.id)).equals(1) && (await difaktur(sj2.baris.id)).equals(1), "SJ-1 (milik F0) dan SJ-2 (milik F1) tetap terkonsumsi");
  await transitTepat("sesudah F1 dan hapus F0 ditolak", awal, 0);

  const f1 = await fakturTerbaru(psj.id);
  await jalankan("hapus F1", () => hapusDokumen("faktur", f1.id));
  await jalankan("hapus F0 (sekarang faktur terbaru)", () => hapusDokumen("faktur", f0.id));
  pastikan((await difaktur(sj1.baris.id)).isZero() && (await difaktur(sj2.baris.id)).isZero() && (await difakturBp(bR.id)).isZero(), "kedua SJ dan baris pesanan kembali 0");
  await transitTepat("sesudah hapus F1 dan F0", awal, 100_000);
  await jalankan("hapus SJ-2", () => hapusDokumen("pengiriman", sj2.sj.id));
  await jalankan("hapus SJ-1", () => hapusDokumen("pengiriman", sj1.sj.id));
  await jalankan("hapus PSJ s2a", () => hapusDokumen("pesanan", psj.id));
  await jalankan("hapus PS s2a", () => hapusDokumen("penyesuaian", ps.id));
  await transitTepat("sesudah s2a dibersihkan", awal, 0);
}

// ---------- s2b: hapus faktur berbarengan dengan surat jalan baru ----------

async function bagianS2b(k: Konteks) {
  console.log("=== s2b. Hapus faktur berbarengan dengan surat jalan baru: surat jalan pesanan dibaca ulang sesudah kunci ===");
  const awal = await sinkron("awal s2b");
  const psj = await pesananBaru(k, "S2b: R 1 @ 100.000", [{ barangId: k.barang.id, jumlah: 1, harga: 100_000 }]);
  const [bR] = psj.baris;
  const ps = await stokSesudah(k, "s2b stok 1 @ 50.000", 1, 50_000);
  await jalankan("F ditagih sebelum kirim", () => buatFaktur(formFaktur(psj.id, bR.id, 1)));
  const f = await fakturTerbaru(psj.id);

  const hasil = await denganPenahan(kunciBp(bR.id), async (pid) => {
    const sj = aksi(() => buatPengiriman(formSj(k, psj.id, bR.id, 1)));
    await tungguAntre(pid, 1);
    const hapus = aksi(() => hapusDokumen("faktur", f.id));
    await tungguAntre(pid, 2);
    return [sj, hapus];
  });
  pastikan(hasil[0] === "ok", `surat jalan lolos (${hasil[0]})`);
  pastikan(hasil[1].includes("dibuat setelah") && hasil[1].includes("hapus itu dulu"), `hapus F yang menunggu ditolak karena surat jalan sesudahnya (${hasil[1]})`);
  const sj = await sjTerbaru(psj.id);
  pastikan((await db.fakturPenjualan.count({ where: { id: f.id } })) === 1 && (await difakturBp(bR.id)).equals(1), "faktur F tetap ada, baris pesanan tetap difaktur 1");
  pastikan((await difaktur(sj.baris.id)).equals(1), "baris SJ tercatat sudah difaktur (HPP di jurnal SJ) dan fakturnya masih ada");
  await transitTepat("sesudah SJ dan hapus F ditolak", awal, 0);

  await jalankan("hapus SJ s2b", () => hapusDokumen("pengiriman", sj.sj.id));
  await jalankan("hapus F s2b", () => hapusDokumen("faktur", f.id));
  await jalankan("hapus PSJ s2b", () => hapusDokumen("pesanan", psj.id));
  await jalankan("hapus PS s2b", () => hapusDokumen("penyesuaian", ps.id));
  await transitTepat("sesudah s2b dibersihkan", awal, 0);
}

// ---------- r1: hapus SJ berbarengan dengan faktur yang mengonsumsinya ----------

async function bagianR1(k: Konteks) {
  console.log("=== r1. Hapus surat jalan berbarengan dengan faktur yang mengonsumsinya ===");
  const awal = await sinkron("awal r1");
  const psj = await pesananBaru(k, "R1: R 1 @ 100.000", [{ barangId: k.barang.id, jumlah: 1, harga: 100_000 }]);
  const [bR] = psj.baris;
  const ps = await stokSesudah(k, "r1 stok 1 @ 50.000", 1, 50_000);
  const sj = await kirim(k, psj.id, bR.id, 1, "R 1");

  const hasil = await denganPenahan(kunciBp(bR.id), async (pid) => {
    const f = aksi(() => buatFaktur(formFaktur(psj.id, bR.id, 1)));
    await tungguAntre(pid, 1);
    const hapus = aksi(() => hapusDokumen("pengiriman", sj.sj.id));
    await tungguAntre(pid, 2);
    return [f, hapus];
  });
  pastikan(hasil[0] === "ok", `faktur lolos (${hasil[0]})`);
  pastikan(hasil[1].includes("sudah mengakui HPP") && hasil[1].includes("hapus faktur itu dulu"), `hapus SJ yang menunggu ditolak dengan pesan jelas, bukan galat FK mentah (${hasil[1]})`);
  const f = await fakturTerbaru(psj.id);
  pastikan(sama(f.baris[0].nilaiTransit, 50_000) && (await difaktur(sj.baris.id)).equals(1), "faktur mengonsumsi SJ (transit 50.000), SJ tetap ada");
  await transitTepat("sesudah faktur dan hapus SJ ditolak", awal, 0);

  await jalankan("hapus faktur r1", () => hapusDokumen("faktur", f.id));
  await jalankan("hapus SJ r1", () => hapusDokumen("pengiriman", sj.sj.id));
  await jalankan("hapus PSJ r1", () => hapusDokumen("pesanan", psj.id));
  await jalankan("hapus PS r1", () => hapusDokumen("penyesuaian", ps.id));
  await transitTepat("sesudah r1 dibersihkan", awal, 0);
}

// ---------- r2: ubah tampilan pesanan berbarengan dengan faktur ----------

async function bagianR2(k: Konteks) {
  console.log("=== r2. Ubah tampilan pesanan (urutan formulir B lalu A) berbarengan dengan faktur tidak saling kunci ===");
  const psj = await pesananBaru(k, "R2: jasa A, B @ 100", [0, 1].map(() => ({ barangId: k.jasa.id, jumlah: 1, harga: 100 })));
  const [bA, bB] = psj.baris;
  const isian = formulir({ baris: [{ id: bB.id, keterangan: "B diubah", urutan: 0 }, { id: bA.id, keterangan: "A diubah", urutan: 1 }] });
  const hasil = await denganPenahan(kunciBp(bB.id), async (pid) => {
    const ubah = aksi(() => ubahTampilanDokumen("pesanan", psj.id, isian));
    await tungguAntre(pid, 1);
    const f = aksi(() => buatFaktur(formFaktur(psj.id, bA.id, 1)));
    await tungguAntre(pid, 2);
    return [ubah, f];
  });
  pastikan(hasil.every((h) => h === "ok"), `ubah tampilan dan faktur sama-sama lolos tanpa deadlock (${hasil.join(" | ")})`);
  const baris = await db.barisPesananPenjualan.findMany({ where: { pesananId: psj.id } });
  pastikan(baris.find((b) => b.id === bA.id)?.keterangan === "A diubah" && baris.find((b) => b.id === bB.id)?.keterangan === "B diubah", "keterangan kedua baris tersimpan");
  pastikan((await difakturBp(bA.id)).equals(1), "baris A difaktur 1");
  const f = await fakturTerbaru(psj.id);
  await jalankan("hapus faktur r2", () => hapusDokumen("faktur", f.id));
  await jalankan("hapus PSJ r2", () => hapusDokumen("pesanan", psj.id));
}

// ---------- s3: cadangan faktur lama dibatasi nilaiTransit ----------

async function bagianS3(k: Konteks) {
  console.log("=== s3. Cadangan faktur lama berhenti di nilaiTransit baris faktur ===");
  const awal = await sinkron("awal s3");

  // s3a: F2 lama tanpa konsumsi (transit 0) tidak mengembalikan SJ milik F1 lama
  const psjA = await pesananBaru(k, "S3a: R 2 @ 100.000", [{ barangId: k.barang.id, jumlah: 2, harga: 100_000 }]);
  const [aR] = psjA.baris;
  const psA = await stokSesudah(k, "s3a stok 1 @ 50.000", 1, 50_000);
  const sjA = await kirim(k, psjA.id, aR.id, 1, "S3a R 1");
  const f1a = await fakturLama(k, psjA.id, `${K}-FJL-S3A1`, [{ barangId: k.barang.id, jumlah: 1, harga: 100_000, nilaiTransit: 50_000 }], [{ id: aR.id, jumlah: 1 }], [{ id: sjA.baris.id, jumlah: 1 }]);
  const f2a = await fakturLama(k, psjA.id, `${K}-FJL-S3A2`, [{ barangId: k.barang.id, jumlah: 1, harga: 100_000, nilaiTransit: 0 }], [{ id: aR.id, jumlah: 1 }], []);
  await transitTepat("s3a sesudah F1 dan F2 lama", awal, 0);
  await jalankan("hapus F2 lama (transit 0)", () => hapusDokumen("faktur", f2a.id));
  pastikan((await difaktur(sjA.baris.id)).equals(1), "hapus F2 lama bertransit 0 tidak mengembalikan SJ milik F1");
  await transitTepat("s3a sesudah hapus F2", awal, 0);
  await jalankan("hapus F1 lama", () => hapusDokumen("faktur", f1a.id));
  pastikan((await difaktur(sjA.baris.id)).isZero() && (await difakturBp(aR.id)).isZero(), "hapus F1 lama mengembalikan SJ dan baris pesanan");
  await transitTepat("s3a sesudah hapus F1", awal, 50_000);
  await jalankan("hapus SJ s3a", () => hapusDokumen("pengiriman", sjA.sj.id));
  await jalankan("hapus PSJ s3a", () => hapusDokumen("pesanan", psjA.id));
  await jalankan("hapus PS s3a", () => hapusDokumen("penyesuaian", psA.id));

  // s3b: F2 lama 2 unit yang hanya mengonsumsi SJ terbaru (60.000) berhenti di sana, SJ lebih lama milik F1 tetap
  const psjB = await pesananBaru(k, "S3b: R 3 @ 100.000", [{ barangId: k.barang.id, jumlah: 3, harga: 100_000 }]);
  const [bR] = psjB.baris;
  const psB1 = await stokSesudah(k, "s3b stok 1 @ 40.000", 1, 40_000);
  const sjB1 = await kirim(k, psjB.id, bR.id, 1, "S3b SJ-1 40.000");
  const psB2 = await stokSesudah(k, "s3b stok 1 @ 60.000", 1, 60_000);
  const sjB2 = await kirim(k, psjB.id, bR.id, 1, "S3b SJ-2 60.000");
  pastikan(sama(sjB1.baris.hargaPokok, 40_000) && sama(sjB2.baris.hargaPokok, 60_000) && sjB1.sj.tanggal <= sjB2.sj.tanggal, "SJ-1 40.000 lebih dulu dari SJ-2 60.000");
  const f1b = await fakturLama(k, psjB.id, `${K}-FJL-S3B1`, [{ barangId: k.barang.id, jumlah: 1, harga: 100_000, nilaiTransit: 40_000 }], [{ id: bR.id, jumlah: 1 }], [{ id: sjB1.baris.id, jumlah: 1 }]);
  const f2b = await fakturLama(k, psjB.id, `${K}-FJL-S3B2`, [{ barangId: k.barang.id, jumlah: 2, harga: 100_000, nilaiTransit: 60_000 }], [{ id: bR.id, jumlah: 2 }], [{ id: sjB2.baris.id, jumlah: 1 }]);
  await transitTepat("s3b sesudah F1 dan F2 lama", awal, 0);
  await jalankan("hapus F2 lama (2 unit, transit 60.000)", () => hapusDokumen("faktur", f2b.id));
  pastikan((await difaktur(sjB2.baris.id)).isZero() && (await difaktur(sjB1.baris.id)).equals(1), "hapus F2 lama mengembalikan SJ-2 saja; SJ-1 milik F1 tetap terkonsumsi");
  pastikan((await difakturBp(bR.id)).equals(1), "baris pesanan kembali 1");
  await transitTepat("s3b sesudah hapus F2", awal, 60_000);
  await jalankan("hapus F1 lama", () => hapusDokumen("faktur", f1b.id));
  pastikan((await difaktur(sjB1.baris.id)).isZero(), "hapus F1 lama mengembalikan SJ-1");
  await transitTepat("s3b sesudah hapus F1", awal, 100_000);
  await jalankan("hapus SJ-2 s3b", () => hapusDokumen("pengiriman", sjB2.sj.id));
  await jalankan("hapus SJ-1 s3b", () => hapusDokumen("pengiriman", sjB1.sj.id));
  await jalankan("hapus PSJ s3b", () => hapusDokumen("pesanan", psjB.id));
  await jalankan("hapus PS s3b 60.000", () => hapusDokumen("penyesuaian", psB2.id));
  await jalankan("hapus PS s3b 40.000", () => hapusDokumen("penyesuaian", psB1.id));
  await transitTepat("sesudah s3 dibersihkan", awal, 0);
}

// ---------- r3: persetujuan, jalur lama, cadangan berbarisPesananId ----------

async function bagianR3(k: Konteks) {
  console.log("=== r3. Faktur ber-SJ lewat persetujuan, jalur lama mencatat konsumsi, cadangan berbarisPesananId ===");
  const awal = await sinkron("awal r3");
  const psj = await pesananBaru(k, "R3: R 2 @ 100.000", [{ barangId: k.barang.id, jumlah: 2, harga: 100_000 }]);
  const [bR] = psj.baris;
  const ps = await stokSesudah(k, "r3 stok 2 @ 50.000", 2, 50_000);
  const sj = await kirim(k, psj.id, bR.id, 2, "R 2");

  aturPersetujuan(true);
  await jalankan("draf F1 R 1", () => buatFaktur(formFaktur(psj.id, bR.id, 1)));
  const f1 = await fakturTerbaru(psj.id);
  await jalankan("draf F2 R 1", () => buatFaktur(formFaktur(psj.id, bR.id, 1)));
  const f2 = await fakturTerbaru(psj.id);
  aturPersetujuan(false);
  for (const [f, label] of [[f1, "F1"], [f2, "F2"]] as const) {
    const c = f.baris[0].konsumsiSj;
    pastikan(
      f.statusPersetujuan === "DRAFT" && f.jurnalId === null && f.konsumsiSjTercatat && c.length === 1 && c[0].barisPengirimanId === sj.baris.id && sama(c[0].jumlah, 1) && sama(c[0].nilaiTransit, 50_000) && sama(f.baris[0].nilaiTransit, 50_000),
      `draf ${label} mencatat konsumsi SJ saat dibuat (1 unit, 50.000) tanpa jurnal`,
    );
  }
  pastikan((await difaktur(sj.baris.id)).equals(2), "SJ dikonsumsi kedua draf (2)");

  await db.fakturPenjualan.update({ where: { id: f1.id }, data: { statusPersetujuan: "MENUNGGU" } });
  await sebagai("owner", () => jalankan("owner menyetujui F1", () => setujuiDokumen("faktur", f1.id)));
  const f1Setuju = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: f1.id }, include: { jurnal: { include: { baris: true } }, baris: { include: { konsumsiSj: true } } } });
  const hppJurnal = (f1Setuju.jurnal?.baris ?? []).filter((b) => b.akunId === k.barangTerkirimId).reduce((t, b) => t.plus(D(b.kredit)), D(0));
  const hppCatatan = f1Setuju.baris.flatMap((b) => b.konsumsiSj).reduce((t, c) => t.plus(D(c.nilaiTransit)), D(0));
  pastikan(f1Setuju.statusPersetujuan === "DISETUJUI" && hppJurnal.equals(50_000) && hppJurnal.equals(hppCatatan), `jurnal HPP F1 saat disetujui = jumlah catatan konsumsinya (${hppJurnal} = ${hppCatatan})`);

  await jalankan("hapus draf F2", () => hapusDokumen("faktur", f2.id));
  pastikan((await difaktur(sj.baris.id)).equals(1), "hapus draf F2 mengembalikan 1 unit SJ");
  pastikan((await db.konsumsiSuratJalan.count({ where: { barisPengirimanId: sj.baris.id } })) === 1, "tinggal catatan konsumsi F1");
  await transitTepat("sesudah F1 disetujui dan draf F2 dihapus", awal, 50_000);

  // jalur lama ({ barangId, jumlah, harga }) juga mencatat konsumsi
  await jalankan("F3 jalur lama R 1", () => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, baris: [{ barangId: k.barang.id, jumlah: 1, harga: 100_000 }] })));
  const f3 = await fakturTerbaru(psj.id);
  const c3 = f3.baris[0].konsumsiSj;
  pastikan(f3.konsumsiSjTercatat && f3.baris[0].barisPesananId === bR.id && c3.length === 1 && c3[0].barisPengirimanId === sj.baris.id && sama(c3[0].nilaiTransit, 50_000) && sama(f3.baris[0].nilaiTransit, 50_000), "faktur jalur lama mencatat konsumsi SJ (1 unit, 50.000)");
  await transitTepat("sesudah F3 jalur lama", awal, 0);
  await jalankan("hapus F3 jalur lama", () => hapusDokumen("faktur", f3.id));
  await jalankan("hapus F1", () => hapusDokumen("faktur", f1.id));
  pastikan((await difaktur(sj.baris.id)).isZero() && (await difakturBp(bR.id)).isZero(), "hapus F3 dan F1 mengembalikan SJ dan baris pesanan");
  await transitTepat("sesudah hapus F3 dan F1", awal, 100_000);

  // cadangan faktur lama berbarisPesananId (isi ulang migrasi lebur): membalik SJ baris pesanannya
  const fLama = await fakturLama(
    k,
    psj.id,
    `${K}-FJL-R3`,
    [{ barangId: k.barang.id, jumlah: 2, harga: 100_000, nilaiTransit: 100_000, barisPesananId: bR.id }],
    [{ id: bR.id, jumlah: 2 }],
    [{ id: sj.baris.id, jumlah: 2 }],
  );
  await transitTepat("sesudah faktur lama berbarisPesananId", awal, 0);
  await jalankan("hapus faktur lama berbarisPesananId", () => hapusDokumen("faktur", fLama.id));
  pastikan((await difaktur(sj.baris.id)).isZero() && (await difakturBp(bR.id)).isZero(), "cadangan berbarisPesananId mengembalikan SJ dan baris pesanannya");
  await transitTepat("sesudah hapus faktur lama berbarisPesananId", awal, 100_000);

  await jalankan("hapus SJ r3", () => hapusDokumen("pengiriman", sj.sj.id));
  await jalankan("hapus PSJ r3", () => hapusDokumen("pesanan", psj.id));
  await jalankan("hapus PS r3", () => hapusDokumen("penyesuaian", ps.id));
  await transitTepat("sesudah r3 dibersihkan", awal, 0);
}

// ---------- r4: invarian, CHECK, pembalik bersyarat ----------

const temuan = async (kode: string) => (await periksaKonsumsiSj(db)).rincian.find((r) => r.kode === kode)?.jumlah ?? -1;
/** Perintah SQL mentah harus ditolak basis data dengan pesan yang memuat `potongan`. */
async function harusDitolakDb(label: string, fn: () => Promise<unknown>, potongan: string) {
  const hasil = await aksi(fn);
  pastikan(hasil !== "ok" && hasil.includes(potongan), `${label} ditolak basis data (${hasil.slice(0, 160)})`);
}

async function bagianR4(k: Konteks) {
  console.log("=== r4. Invarian catatan konsumsi, CHECK jumlahDifaktur, pembalik catatan bersyarat ===");
  const awal = await sinkron("awal r4");
  const mulai = await periksaKonsumsiSj(db);
  pastikan(mulai.sinkron && mulai.rincian.length === 4 && mulai.rincian.every((r) => r.jumlah === 0), `periksaKonsumsiSj tanpa temuan di awal (${mulai.rincian.map((r) => `${r.kode} ${r.jumlah}`).join(", ")})`);
  const psj = await pesananBaru(k, "R4: R 1 @ 100.000", [{ barangId: k.barang.id, jumlah: 1, harga: 100_000 }]);
  const [bR] = psj.baris;
  const ps = await stokSesudah(k, "r4 stok 1 @ 50.000", 1, 50_000);
  const sj = await kirim(k, psj.id, bR.id, 1, "R 1");
  await jalankan("F R 1", () => buatFaktur(formFaktur(psj.id, bR.id, 1)));
  const f = await fakturTerbaru(psj.id);
  pastikan(f.baris[0].konsumsiSj.length === 1, "F punya satu catatan konsumsi");

  // (1) nilaiTransit baris faktur tercatat berbeda dari jumlah catatannya
  await db.barisFakturPenjualan.update({ where: { id: f.baris[0].id }, data: { nilaiTransit: 50_001 } });
  pastikan((await temuan("TRANSIT_CATATAN")) === 1 && !(await periksaKonsumsiSj(db)).sinkron, "invarian menemukan nilaiTransit baris faktur yang beda dari catatannya");
  await db.barisFakturPenjualan.update({ where: { id: f.baris[0].id }, data: { nilaiTransit: 50_000 } });
  // (2) catatan melebihi jumlahDifaktur baris SJ
  await db.barisPengiriman.update({ where: { id: sj.baris.id }, data: { jumlahDifaktur: 0 } });
  pastikan((await temuan("CATATAN_MELEBIHI_DIFAKTUR")) === 1, "invarian menemukan catatan konsumsi yang melebihi jumlahDifaktur baris SJ");
  // pembalik catatan bersyarat: SJ yang jumlahDifaktur-nya lebih kecil dari catatan tidak diturunkan sampai negatif
  await harusDitolak("hapus F saat baris SJ lebih kecil dari catatannya", () => hapusDokumen("faktur", f.id), "tidak cocok dengan surat jalan");
  pastikan((await difaktur(sj.baris.id)).isZero() && (await db.fakturPenjualan.count({ where: { id: f.id } })) === 1, "hapus dibatalkan: baris SJ tetap 0, faktur tetap ada");
  await db.barisPengiriman.update({ where: { id: sj.baris.id }, data: { jumlahDifaktur: 1 } });
  pastikan((await periksaKonsumsiSj(db)).sinkron, "invarian kembali tanpa temuan sesudah data dipulihkan");

  // (3) CHECK 0 <= jumlahDifaktur <= jumlah di baris SJ dan baris pesanan
  await harusDitolakDb("jumlahDifaktur baris SJ -1", () => db.$executeRaw`UPDATE "BarisPengiriman" SET "jumlahDifaktur" = -1 WHERE "id" = ${sj.baris.id}`, "BarisPengiriman_jumlahDifaktur_batas");
  await harusDitolakDb("jumlahDifaktur baris SJ melebihi jumlah", () => db.$executeRaw`UPDATE "BarisPengiriman" SET "jumlahDifaktur" = "jumlah" + 1 WHERE "id" = ${sj.baris.id}`, "BarisPengiriman_jumlahDifaktur_batas");
  await harusDitolakDb("jumlahDifaktur baris pesanan -1", () => db.$executeRaw`UPDATE "BarisPesananPenjualan" SET "jumlahDifaktur" = -1 WHERE "id" = ${bR.id}`, "BarisPesananPenjualan_jumlahDifaktur_batas");
  await harusDitolakDb("jumlahDifaktur baris pesanan melebihi jumlah", () => db.$executeRaw`UPDATE "BarisPesananPenjualan" SET "jumlahDifaktur" = "jumlah" + 1 WHERE "id" = ${bR.id}`, "BarisPesananPenjualan_jumlahDifaktur_batas");
  pastikan((await temuan("DIFAKTUR_DI_LUAR_BATAS")) === 0, "tidak ada baris SJ atau baris pesanan dengan jumlahDifaktur di luar 0..jumlah");
  // pesan "melebihi sisa" tetap dari aplikasi (diperiksa sebelum CHECK), termasuk faktur kedua atas baris yang sudah penuh
  await harusDitolak("faktur kedua atas baris yang sudah penuh", () => buatFaktur(formFaktur(psj.id, bR.id, 1)), "melebihi sisa yang belum ditagih");

  await jalankan("hapus F r4", () => hapusDokumen("faktur", f.id));
  pastikan((await difaktur(sj.baris.id)).isZero(), "hapus F mengembalikan SJ");
  await jalankan("hapus SJ r4", () => hapusDokumen("pengiriman", sj.sj.id));
  await jalankan("hapus PSJ r4", () => hapusDokumen("pesanan", psj.id));
  await jalankan("hapus PS r4", () => hapusDokumen("penyesuaian", ps.id));
  await transitTepat("sesudah r4 dibersihkan", awal, 0);
}

// ---------- r5: tombol termin tanpa lihatBayar ----------

function bagianR5() {
  console.log("=== r5. Tanpa lihatBayar, tombol butir termin tidak membuka status bayar ===");
  const butir = (id: string, no: number, ditagih: boolean, dibayar: number): ButirProgres => {
    const bruto = D(1_000);
    const sisa = bruto.minus(dibayar);
    return {
      id,
      no,
      label: `Termin ${no}`,
      jumlah: bruto,
      persen: D(50),
      bruto,
      dibayar: D(dibayar),
      sisa,
      status: sisa.isZero() ? "Lunas" : dibayar > 0 ? "Dibayar sebagian" : ditagih ? "Ditagih" : "Belum ditagih",
      lewatJatuhTempo: false,
      jatuhTempo: null,
      ditagihPada: ditagih ? new Date("2026-11-01T03:00:00Z") : null,
      nomorCetak: ditagih ? `TG-${no}` : null,
    };
  };
  const progres = (bayar1: number, bayar2: number): ProgresTermin => ({
    nilaiKontrakBruto: D(2_000),
    butir: [butir("butir-1", 1, true, bayar1), butir("butir-2", 2, false, bayar2)],
    dpTanpaTermin: D(bayar1 + bayar2 > 0 ? 50 : 0),
    totalDiterima: D(bayar1 + bayar2),
    belumDibayar: D(2_000 - bayar1 - bayar2),
  });
  // FormulirAksi memakai useRouter, jadi panel dirender di dalam konteks router tiruan
  const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} } as unknown as AppRouterInstance;
  const html = (p: ProgresTermin, lihatBayar: boolean) =>
    renderToStaticMarkup(
      createElement(AppRouterContext.Provider, { value: router }, createElement(PanelTermin, { jenis: "pesanan", pesananId: "psj-uji", progres: p, bolehUbah: true, bolehBayar: true, lihatBayar })),
    );
  const belumBayar = progres(0, 0);
  const sudahBayar = progres(400, 1_000);
  const tanpaHakA = html(belumBayar, false);
  const tanpaHakB = html(sudahBayar, false);
  pastikan(tanpaHakA === tanpaHakB, "tanpa lihatBayar, panel pesanan yang belum dan sudah dibayar dirender sama persis (tombol tidak membuka status bayar)");
  pastikan(tanpaHakA.includes("Batalkan tagihan") && tanpaHakA.includes("Terbitkan tagihan") && tanpaHakA.includes("Catat pembayaran"), "tanpa lihatBayar, tombol mengikuti status tagih: batal untuk butir ditagih, terbitkan untuk yang belum, catat pembayaran tetap ada");
  const denganHak = html(sudahBayar, true);
  pastikan(!denganHak.includes("Batalkan tagihan") && !denganHak.includes("Terbitkan tagihan"), "dengan lihatBayar, butir yang sudah dibayar tidak menampilkan batal atau terbitkan (perilaku lama)");
  pastikan(html(belumBayar, true).includes("Batalkan tagihan"), "dengan lihatBayar, butir ditagih yang belum dibayar tetap bisa dibatalkan");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
