import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { renderToStaticMarkup } from "react-dom/server";
import type { Prisma } from "../src/prisma-klien/client";
import { db } from "../src/lib/db";
import { D, type Desimal } from "../src/lib/uang";
import { akunAntarPerusahaan, daftarPerusahaan, saldoAntarPerusahaan } from "../src/lib/perusahaan";
import { periksaKonsistensiPerusahaan, periksaSinkron, type HasilSinkron } from "../src/lib/sinkron";
import { hitungNeraca, saldoAkunPeriode } from "../src/lib/laporan";
import { hitungArusKas } from "../src/lib/arusKas";
import { buatPerusahaan } from "../src/lib/aksi/perusahaan";
import { buatPenyesuaianPersediaan } from "../src/lib/aksi/persediaan";
import { buatFaktur, buatPenawaran, buatPenerimaan, buatPengiriman, buatPesanan, buatRetur, buatUangMuka, konversiPenawaranKePesanan } from "../src/lib/aksi/penjualan";
import { buatTransaksiAntarPerusahaan } from "../src/lib/aksi/antarPerusahaan";
import { hapusDokumen, type JenisDokumen } from "../src/lib/aksi/hapusDokumen";
import CatatanGabungan from "../src/komponen/CatatanGabungan";
import { aturPersetujuan, formulir, harusDitolak, jalankan, pastikan } from "./bantuan";

/*
 * Uji multi perusahaan (P24, D1 §9.1): kasus yang butuh aksi penjualan dan transaksi antar perusahaan.
 * - Kasus 5: siklus jual di perusahaan uji UJIMP (PNW, konversi, UM, SJ, FJ, TRM, RJ): dokumen dan jurnal milik
 *   perusahaan uji, jatuh tempo dari termin perusahaan uji (30 hari), jurnal FJ bertanda proyek perusahaan uji.
 * - Kasus 18 bagian penjualan: rujukan milik perusahaan lain ditolak (gudang SJ, kas TRM, barang dan proyek PSJ).
 * - Kasus 14 sampai 17: transaksi antar perusahaan TAGIH dan LUNAS (dua jurnal seimbang, masing-masing di bukunya),
 *   penolakan, hapus membalik kedua jurnal; hak KASIR (kasus 32).
 * - Kontrak P24 (tinjauan P11 butir 6): cabang akunAntarPerusahaan tanpa pemetaan dan tanpa akun standar (null, saldo
 *   nol) di transaksi yang dibatalkan, dan pesan aksi yang menunjuk "Terapkan ke sistem".
 * - CatatanGabungan memuat saldo sesudah transaksi uji dan kembali ke awal sesudah dibersihkan.
 * - Kasus 24 sampai 28 dengan data lengkap: neraca dan arus kas per perusahaan, gabungan = penjumlahan per akun,
 *   periksaSinkron perusahaan uji, utama tidak terpengaruh, periksaKonsistensiPerusahaan nol.
 * - Kasus 34: semua dokumen dihapus lewat hapusDokumen, master dan perusahaan uji dihapus; jumlah jurnal,
 *   periksaSinkron, dan HakAksesPeran sama dengan awal.
 * Data uji berkode UJIMP/UJIUT dan dihapus di awal dan di akhir.
 */

const KODE = "UJIMP";
const KODE_UT = "UJIUT";
/** Kode sementara akun standar antar perusahaan saat menguji cabang "akun belum ada" (dipulihkan di finally dan bersihkan). */
const GANTI_KODE: [string, string][] = [
  ["1-1750", `${KODE}-X1750`],
  ["2-1550", `${KODE}-X1550`],
];
const awalUji = new Date();
const nomorLog: string[] = [];

/** Menjalankan fn dengan UJI_PERUSAHAAN (dan opsional UJI_PERAN) sementara; "semua" = gabungan. */
async function dengan<T>(isian: { perusahaan?: string; peran?: string }, fn: () => Promise<T>): Promise<T> {
  const lama = { perusahaan: process.env.UJI_PERUSAHAAN, peran: process.env.UJI_PERAN };
  const atur = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
  atur("UJI_PERUSAHAAN", isian.perusahaan);
  atur("UJI_PERAN", isian.peran);
  try {
    return await fn();
  } finally {
    atur("UJI_PERUSAHAAN", lama.perusahaan);
    atur("UJI_PERAN", lama.peran);
  }
}

class Batal extends Error {}
/** Menjalankan fn di dalam transaksi lalu membatalkannya; mengembalikan hasil fn. */
async function dalamTxBatal<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  let hasil: T | undefined;
  try {
    await db.$transaction(async (tx) => {
      hasil = await fn(tx);
      throw new Batal();
    });
  } catch (e) {
    if (!(e instanceof Batal)) throw e;
  }
  return hasil as T;
}

const sama = (a: { toString(): string } | null | undefined, b: { toString(): string } | number) => D(a?.toString() ?? 0).equals(D(b.toString()));
const isoLokal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const rupiah = (d: Desimal) => Number(d.toString()).toLocaleString("id-ID");

async function hapus(jenis: JenisDokumen, id: string, label: string) {
  await jalankan(`hapus ${label}`, () => hapusDokumen(jenis, id));
}

/** Membersihkan sisa data uji (juga sisa putaran yang terhenti), selalu lewat hapusDokumen untuk dokumen berjurnal. */
async function bersihkan() {
  for (const [asli, sementara] of GANTI_KODE) {
    if (await db.akun.findUnique({ where: { kode: sementara } })) await db.akun.update({ where: { kode: sementara }, data: { kode: asli } });
  }
  const pt = await db.perusahaan.findUnique({ where: { kode: KODE }, select: { id: true } });
  const akunUji = (await db.akun.findMany({ where: { kode: { in: [`${KODE}-KAS`, `${KODE_UT}-KAS`] } }, select: { id: true } })).map((a) => a.id);
  const ap = await db.transaksiAntarPerusahaan.findMany({ where: { OR: [{ akunPemberiId: { in: akunUji } }, { akunPenerimaId: { in: akunUji } }, ...(pt ? [{ pemberiId: pt.id }, { penerimaId: pt.id }] : [])] }, select: { id: true, nomor: true } });
  for (const t of ap) await hapus("antarPerusahaan", t.id, `sisa ${t.nomor}`);
  // log sisa putaran yang terhenti: CATAT lewat entitasId, HAPUS dari pembersihan ini lewat nomor
  await db.logAktivitas.deleteMany({ where: { OR: [{ entitasId: { in: ap.map((t) => t.id) } }, { aksi: "HAPUS", nomor: { in: ap.map((t) => t.nomor) }, waktu: { gte: awalUji } }] } });
  if (pt) {
    const p = pt.id;
    for (const d of await db.penerimaanPenjualan.findMany({ where: { perusahaanId: p }, select: { id: true, nomor: true } })) await hapus("penerimaan", d.id, `sisa ${d.nomor}`);
    for (const d of await db.returPenjualan.findMany({ where: { perusahaanId: p }, select: { id: true, nomor: true } })) await hapus("returPenjualan", d.id, `sisa ${d.nomor}`);
    for (const d of await db.fakturPenjualan.findMany({ where: { perusahaanId: p }, orderBy: { tanggal: "desc" }, select: { id: true, nomor: true } })) await hapus("faktur", d.id, `sisa ${d.nomor}`);
    for (const d of await db.uangMukaPelanggan.findMany({ where: { perusahaanId: p }, select: { id: true, nomor: true } })) await hapus("uangMuka", d.id, `sisa ${d.nomor}`);
    for (const d of await db.pengirimanPesanan.findMany({ where: { perusahaanId: p }, orderBy: { tanggal: "desc" }, select: { id: true, nomor: true } })) await hapus("pengiriman", d.id, `sisa ${d.nomor}`);
    for (const d of await db.pesananPenjualan.findMany({ where: { perusahaanId: p }, select: { id: true, nomor: true } })) await hapus("pesanan", d.id, `sisa ${d.nomor}`);
    for (const d of await db.penawaranPenjualan.findMany({ where: { perusahaanId: p }, select: { id: true, nomor: true } })) await hapus("penawaran", d.id, `sisa ${d.nomor}`);
    for (const d of await db.penyesuaianPersediaan.findMany({ where: { perusahaanId: p }, select: { id: true, nomor: true } })) await hapus("penyesuaian", d.id, `sisa ${d.nomor}`);
  }
  const barangUji = (await db.barang.findMany({ where: { kode: { in: [`BRG-${KODE}`, `JSA-${KODE}`, `BRG-${KODE_UT}`] } }, select: { id: true } })).map((b) => b.id);
  await db.stokBarang.deleteMany({ where: { barangId: { in: barangUji } } });
  await db.barang.deleteMany({ where: { id: { in: barangUji } } });
  await db.gudang.deleteMany({ where: { kode: { in: [`WH-${KODE}`, `WH-${KODE_UT}`] } } });
  await db.pelanggan.deleteMany({ where: { kode: `CUST-${KODE}` } });
  await db.proyek.deleteMany({ where: { kode: { in: [`PRJ-${KODE}`, `PRJ-${KODE_UT}`] } } });
  await db.akun.deleteMany({ where: { id: { in: akunUji } } });
  if (pt) {
    await db.pengaturanPerusahaan.deleteMany({ where: { perusahaanId: pt.id } });
    await db.perusahaan.delete({ where: { id: pt.id } });
  }
  await db.logAktivitas.deleteMany({ where: { OR: [{ nomor: { in: [...nomorLog, KODE] } }, { modul: "antar-perusahaan" }], waktu: { gte: awalUji } } });
}

/** Enam perbandingan periksaSinkron (nilai buku besar dan dokumen). */
const enamPerbandingan = (s: HasilSinkron) =>
  JSON.stringify([s.persediaan, s.piutang, s.hutang, s.barangBelumDitagih, s.barangTerkirim, s.uangMuka].map((x) => [x.bukuBesar.toString(), x.dokumen.toString()]));

async function main() {
  await bersihkan();
  aturPersetujuan(false);
  const sinkronAwal = await periksaSinkron(db);
  pastikan(sinkronAwal.seimbang, "buku besar seimbang sebelum uji");
  const sinkronUtama0 = await periksaSinkron(db, { perusahaanId: "utama" });
  const jumlahJurnal0 = await db.jurnal.count();
  const hakAwal = await db.hakAksesPeran.count();
  // jurnal antar perusahaan bertanggal pukul 12.00 waktu lokal (pola prive), jadi saldo dihitung sampai akhir hari ini
  const akhirHari = new Date();
  akhirHari.setHours(23, 59, 59, 999);
  const saldoApAwal = await saldoAntarPerusahaan(db, akhirHari);
  const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
  const akunKode = async (kode: string) => db.akun.findUniqueOrThrow({ where: { kode } });
  const [modal, bebanEvent, piutangAp, hutangAp] = await Promise.all(["3-1000", "5-1200", "1-1750", "2-1550"].map(akunKode));

  console.log("=== 0. Perusahaan dan master uji ===");
  await jalankan("buat perusahaan uji UJIMP (termin 30 hari)", () =>
    buatPerusahaan(formulir({ kode: KODE, nama: "PT Uji Multi Perusahaan", jenis: "AGENSI", terminHari: 30, tarifPpnPersen: 11, pphFinalPersen: 0.5, aktif: "on", urutan: 99 })),
  );
  const U = (await db.perusahaan.findUniqueOrThrow({ where: { kode: KODE } })).id;
  const kasU = await db.akun.create({ data: { kode: `${KODE}-KAS`, nama: "Kas Uji Multi Perusahaan", jenis: "ASET", kasBank: true, perusahaanId: U } });
  const kasUt = await db.akun.create({ data: { kode: `${KODE_UT}-KAS`, nama: "Kas Uji Utama", jenis: "ASET", kasBank: true, perusahaanId: "utama" } });
  const gudangU = await db.gudang.create({ data: { kode: `WH-${KODE}`, nama: "Gudang Uji Multi Perusahaan", perusahaanId: U } });
  const gudangUt = await db.gudang.create({ data: { kode: `WH-${KODE_UT}`, nama: "Gudang Uji Utama", perusahaanId: "utama" } });
  const brgU = await db.barang.create({ data: { kode: `BRG-${KODE}`, nama: "Barang Uji Multi Perusahaan", jenis: "BARANG", satuan: "pcs", hargaBeli: 10_000, hargaJual: 15_000, perusahaanId: U } });
  const jsa = await db.barang.create({ data: { kode: `JSA-${KODE}`, nama: "Jasa Uji Multi Perusahaan", jenis: "JASA", satuan: "paket", hargaBeli: 0, hargaJual: 500_000, perusahaanId: null } });
  const brgUt = await db.barang.create({ data: { kode: `BRG-${KODE_UT}`, nama: "Barang Uji Utama", jenis: "BARANG", satuan: "pcs", hargaBeli: 10_000, hargaJual: 15_000, perusahaanId: "utama" } });
  const pelanggan = await db.pelanggan.create({ data: { kode: `CUST-${KODE}`, nama: "Klien Uji Multi Perusahaan" } });
  const proyekU = await db.proyek.create({ data: { kode: `PRJ-${KODE}`, nama: "Event Uji Multi Perusahaan", perusahaanId: U } });
  const proyekUt = await db.proyek.create({ data: { kode: `PRJ-${KODE_UT}`, nama: "Event Uji Utama", perusahaanId: "utama" } });

  console.log("=== 1. Kasus 5: siklus jual di perusahaan uji ===");
  await jalankan("PS saldo awal 50 BRG-UJIMP @ 10.000", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudangU.id, akunLawanId: modal.id, baris: [{ barangId: brgU.id, jumlahSesudah: 50, hargaSatuan: 10_000 }] })));
  await dengan({ perusahaan: U }, () =>
    jalankan("PNW 10 BRG @ 15.000 + 1 JSA @ 500.000, proyek perusahaan uji", () =>
      buatPenawaran(formulir({ pelangganId: pelanggan.id, proyekId: proyekU.id, ppnPersen: 0, baris: [{ barangId: brgU.id, jumlah: 10, harga: 15_000 }, { barangId: jsa.id, jumlah: 1, harga: 500_000 }] })),
    ),
  );
  const pnw = await db.penawaranPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id } });
  await dengan({ perusahaan: U }, () => jalankan("konversi PNW ke PSJ", () => konversiPenawaranKePesanan(pnw.id)));
  const psj = await db.pesananPenjualan.findFirstOrThrow({ where: { penawaranId: pnw.id }, include: { baris: { orderBy: { urutan: "asc" } } } });
  const bpBrg = psj.baris.find((b) => b.barangId === brgU.id)!;
  const bpJsa = psj.baris.find((b) => b.barangId === jsa.id)!;
  await jalankan("UM 200.000 ke kas perusahaan uji", () => buatUangMuka(formulir({ pesananId: psj.id, akunId: kasU.id, jumlah: 200_000 })));
  // kasus 18 (bagian penjualan): selagi pesanan masih punya sisa kirim
  await harusDitolak("SJ pesanan perusahaan uji dari gudang milik utama", () => buatPengiriman(formulir({ pesananId: psj.id, gudangId: gudangUt.id, baris: [{ barisPesananId: bpBrg.id, barangId: brgU.id, jumlah: 1 }] })), `Gudang WH-${KODE_UT}`);
  await jalankan("SJ semua baris dari gudang perusahaan uji", () =>
    buatPengiriman(formulir({ pesananId: psj.id, gudangId: gudangU.id, baris: [{ barisPesananId: bpBrg.id, barangId: brgU.id, jumlah: 10 }, { barisPesananId: bpJsa.id, barangId: jsa.id, jumlah: 1 }] })),
  );
  await jalankan("FJ jalur ID, uang muka 200.000", () => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, uangMuka: 200_000, baris: [{ barisPesananId: bpBrg.id, jumlah: 10 }, { barisPesananId: bpJsa.id, jumlah: 1 }] })));
  const fj = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj.id }, include: { baris: true } });
  await jalankan("TRM 100.000 ke kas perusahaan uji", () => buatPenerimaan(formulir({ fakturId: fj.id, akunId: kasU.id, jumlah: 100_000 })));
  const bfBrg = fj.baris.find((b) => b.barangId === brgU.id)!;
  await jalankan("RJ 1 BRG ke gudang perusahaan uji", () => buatRetur(formulir({ fakturId: fj.id, gudangId: gudangU.id, baris: [{ barisFakturId: bfBrg.id, jumlah: 1 }] })));

  const ps = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { baris: { some: { barangId: brgU.id } } } });
  const um = await db.uangMukaPelanggan.findFirstOrThrow({ where: { pesananId: psj.id } });
  const sj = await db.pengirimanPesanan.findFirstOrThrow({ where: { pesananId: psj.id } });
  const trm = await db.penerimaanPenjualan.findFirstOrThrow({ where: { fakturId: fj.id } });
  const rj = await db.returPenjualan.findFirstOrThrow({ where: { fakturId: fj.id } });
  const fjAkhir = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fj.id } });
  nomorLog.push(...[ps, pnw, psj, um, sj, fj, trm, rj].map((d) => d.nomor));
  const dokumen = [ps, pnw, psj, um, sj, fjAkhir, trm, rj];
  pastikan(dokumen.every((d) => d.perusahaanId === U), `PS, PNW, PSJ, UM, SJ, FJ, TRM, dan RJ milik perusahaan uji (${dokumen.map((d) => d.perusahaanId === U).join(", ")})`);
  const jurnalSiklus = await db.jurnal.findMany({ where: { id: { in: [ps, um, sj, fjAkhir, trm, rj].map((d) => d.jurnalId!).filter(Boolean) } }, select: { id: true, nomor: true, perusahaanId: true, proyekId: true } });
  pastikan(jurnalSiklus.length === 6 && jurnalSiklus.every((j) => j.perusahaanId === U), `enam jurnal (PS, UM, SJ, FJ, TRM, RJ) milik perusahaan uji (${jurnalSiklus.length})`);
  pastikan(jurnalSiklus.find((j) => j.id === fjAkhir.jurnalId)?.proyekId === proyekU.id, "jurnal FJ bertanda proyek perusahaan uji");
  const hariTermin = fjAkhir.jatuhTempo ? Math.round((fjAkhir.jatuhTempo.getTime() - fjAkhir.tanggal.getTime()) / 86_400_000) : null;
  pastikan(hariTermin === 30, `jatuh tempo FJ = tanggal + 30 hari dari termin perusahaan uji (${hariTermin})`);
  pastikan(sama(fjAkhir.total, 650_000) && fjAkhir.status === "SEBAGIAN", `FJ total 650.000 berstatus SEBAGIAN (${fjAkhir.total}, ${fjAkhir.status})`);

  console.log("=== 2. Kasus 18 bagian penjualan: rujukan perusahaan lain ditolak ===");
  await harusDitolak("TRM faktur perusahaan uji ke kas milik utama", () => buatPenerimaan(formulir({ fakturId: fj.id, akunId: kasUt.id, jumlah: 1_000 })), `Akun ${KODE_UT}-KAS`);
  await dengan({ perusahaan: U }, async () => {
    await harusDitolak("PSJ perusahaan uji dengan barang milik utama", () => buatPesanan(formulir({ pelangganId: pelanggan.id, ppnPersen: 0, baris: [{ barangId: brgUt.id, jumlah: 1, harga: 15_000 }] })), `BRG-${KODE_UT} - Barang Uji Utama milik`);
    await harusDitolak("PSJ perusahaan uji dengan proyek milik utama", () => buatPesanan(formulir({ pelangganId: pelanggan.id, proyekId: proyekUt.id, ppnPersen: 0, baris: [{ barangId: jsa.id, jumlah: 1, harga: 500_000 }] })), `Proyek PRJ-${KODE_UT} milik`);
  });
  pastikan((await db.pesananPenjualan.count({ where: { perusahaanId: U } })) === 1, "tidak ada pesanan baru dari percobaan yang ditolak");

  console.log("=== 3. Kontrak P24: cabang tanpa pemetaan dan tanpa akun standar ===");
  const tanpaPeta = (await db.pemetaanAkunTambahan.count({ where: { kunci: { in: ["piutang-antar-perusahaan", "hutang-antar-perusahaan"] } } })) === 0;
  if (tanpaPeta) {
    const cabang = await dalamTxBatal(async (tx) => {
      for (const [asli, sementara] of GANTI_KODE) await tx.akun.update({ where: { kode: asli }, data: { kode: sementara } });
      return { akun: await akunAntarPerusahaan(tx), saldo: await saldoAntarPerusahaan(tx, akhirHari) };
    });
    pastikan(cabang.akun.piutang === null && cabang.akun.hutang === null, "tanpa pemetaan dan tanpa kode 1-1750/2-1550: akunAntarPerusahaan memberi null untuk keduanya");
    pastikan(
      cabang.saldo.piutang.isZero() && cabang.saldo.hutang.isZero() && cabang.saldo.selisih.isZero() && cabang.saldo.akunPiutang === null && cabang.saldo.akunHutang === null && cabang.saldo.masalah.length === 0,
      "saldoAntarPerusahaan tanpa akun: semua nol, tanpa nama akun dan tanpa masalah",
    );
    pastikan((await db.akun.count({ where: { kode: { in: ["1-1750", "2-1550"] } } })) === 2, "transaksi dibatalkan: kode akun standar tetap");
    // aksi memakai db, jadi kode diganti sementara di luar transaksi lalu dipulihkan di finally (dan di bersihkan)
    try {
      for (const [asli, sementara] of GANTI_KODE) await db.akun.update({ where: { kode: asli }, data: { kode: sementara } });
      await harusDitolak(
        "transaksi antar perusahaan tanpa akun antar perusahaan",
        () => buatTransaksiAntarPerusahaan(formulir({ jenis: "TAGIH", pemberiId: "utama", penerimaId: U, tanggal: isoLokal(new Date()), jumlah: 1_000, keterangan: "Uji tanpa akun", akunPemberiId: kasUt.id, akunPenerimaId: bebanEvent.id })),
        'tombol "Terapkan ke sistem"',
      );
    } finally {
      for (const [asli, sementara] of GANTI_KODE) if (await db.akun.findUnique({ where: { kode: sementara } })) await db.akun.update({ where: { kode: sementara }, data: { kode: asli } });
    }
    pastikan((await db.transaksiAntarPerusahaan.count({ where: { keterangan: "Uji tanpa akun" } })) === 0, "tidak ada dokumen dari percobaan tanpa akun");
  } else {
    pastikan(true, "pemetaan tambahan antar perusahaan terpasang, cabang tanpa akun standar dilewati");
  }

  console.log("=== 4. Kasus 14: TAGIH utama ke perusahaan uji ===");
  const tagihIsian = { jenis: "TAGIH", pemberiId: "utama", penerimaId: U, tanggal: isoLokal(new Date()), jumlah: 300_000, keterangan: `${KODE} talangan sewa sound`, akunPemberiId: kasUt.id, akunPenerimaId: bebanEvent.id, proyekPenerimaId: proyekU.id };
  await jalankan("TAGIH utama ke perusahaan uji 300.000", () => buatTransaksiAntarPerusahaan(formulir(tagihIsian)));
  const tagih = await db.transaksiAntarPerusahaan.findFirstOrThrow({
    where: { penerimaId: U, jenis: "TAGIH" },
    include: { jurnalPemberi: { include: { baris: true } }, jurnalPenerima: { include: { baris: true } } },
  });
  nomorLog.push(tagih.nomor);
  const jp = tagih.jurnalPemberi!;
  const jt = tagih.jurnalPenerima!;
  const baris = (j: typeof jp, akunId: string) => j.baris.find((b) => b.akunId === akunId);
  pastikan(/^AP-\d{4}-\d{4}$/.test(tagih.nomor) && jp.nomor.startsWith("JU-AP-") && jt.nomor.startsWith("JU-AP-") && jp.sumber === "ANTAR_PERUSAHAAN" && jt.sumber === "ANTAR_PERUSAHAAN", `nomor ${tagih.nomor}, dua jurnal ${jp.nomor} dan ${jt.nomor} bersumber ANTAR_PERUSAHAAN`);
  pastikan(
    jp.perusahaanId === "utama" && jp.baris.length === 2 && sama(baris(jp, piutangAp.id)?.debit, 300_000) && sama(baris(jp, kasUt.id)?.kredit, 300_000),
    "jurnal pemberi di buku utama: Dr 1-1750 300.000 / Cr kas utama 300.000",
  );
  pastikan(
    jt.perusahaanId === U && jt.baris.length === 2 && sama(baris(jt, bebanEvent.id)?.debit, 300_000) && sama(baris(jt, hutangAp.id)?.kredit, 300_000) && jt.proyekId === proyekU.id,
    "jurnal penerima di buku perusahaan uji: Dr 5-1200 300.000 / Cr 2-1550 300.000, bertanda proyek penerima",
  );
  const kodeUtama = (await db.perusahaan.findUniqueOrThrow({ where: { id: "utama" } })).kode;
  pastikan(
    jp.proyekId === null && jp.baris.every((b) => !!b.keterangan?.includes(tagih.nomor) && !!b.keterangan?.endsWith(`(${KODE})`)) && jt.baris.every((b) => !!b.keterangan?.includes(tagih.nomor) && !!b.keterangan?.endsWith(`(${kodeUtama})`)),
    "keterangan baris menyebut nomor AP dan kode perusahaan lawan",
  );
  const logCatat = await db.logAktivitas.findFirst({ where: { entitasId: tagih.id, aksi: "CATAT" } });
  pastikan(logCatat?.modul === "antar-perusahaan" && logCatat.entitasId === tagih.id && !!logCatat.keterangan?.includes(jp.nomor) && !!logCatat.keterangan?.includes(jt.nomor), `log CATAT modul antar-perusahaan menyebut kedua jurnal (${logCatat?.keterangan})`);
  const saldoTagih = await saldoAntarPerusahaan(db, akhirHari);
  pastikan(saldoTagih.selisih.isZero() && sama(saldoTagih.piutang.minus(saldoApAwal.piutang), 300_000) && sama(saldoTagih.hutang.minus(saldoApAwal.hutang), 300_000), "saldoAntarPerusahaan: piutang dan hutang naik 300.000, selisih nol");
  const catatan = html(await CatatanGabungan({ sampai: akhirHari }));
  pastikan(
    catatan.includes(`Piutang Antar Perusahaan Rp <span class="angka ">${rupiah(saldoTagih.piutang)}</span>`) && catatan.includes(`Hutang Antar Perusahaan Rp <span class="angka ">${rupiah(saldoTagih.hutang)}</span>`) && !catatan.includes("lencana-amber"),
    `CatatanGabungan memuat saldo sesudah transaksi uji (piutang ${rupiah(saldoTagih.piutang)}, selisih nol tanpa peringatan)`,
  );

  console.log("=== 5. Kasus 24 sampai 28: laporan per perusahaan dan gabungan dengan data lengkap ===");
  const tahun = new Date().getFullYear();
  const akhir = new Date();
  akhir.setHours(23, 59, 59, 999);
  const awal = new Date(tahun, 0, 1);
  const periode = { dari: awal, sampai: akhir, dariTeks: isoLokal(awal), sampaiTeks: isoLokal(akhir) };
  for (const p of ["utama", U]) {
    const label = p === U ? "perusahaan uji" : "utama";
    const neraca = await hitungNeraca(db, akhir, isoLokal(akhir), { perusahaanId: p });
    pastikan(neraca.seimbang, `Neraca ${label} seimbang (aset ${neraca.totalAset}, pasiva ${neraca.totalPasiva})`);
    const arus = await hitungArusKas(db, periode, { perusahaanId: p });
    pastikan(arus.cocok, `Arus Kas ${label} cocok dengan buku besar (${arus.kasAkhir} vs ${arus.kasAkhirBukuBesar})`);
    const saldo = await saldoAkunPeriode(db, null, akhir, false, { perusahaanId: p });
    const debit = saldo.reduce((s, a) => s.plus(a.debit), D(0));
    const kredit = saldo.reduce((s, a) => s.plus(a.kredit), D(0));
    pastikan(debit.equals(kredit), `jumlah debit = jumlah kredit buku ${label} (${debit})`);
  }
  const neracaU = await hitungNeraca(db, akhir, isoLokal(akhir), { perusahaanId: U });
  pastikan(neracaU.kewajiban.some((b) => b.kode === "2-1550" && sama(b.jumlah, 300_000)), "Neraca perusahaan uji memuat Hutang Antar Perusahaan 300.000");
  const gabungan = await saldoAkunPeriode(db, awal, akhir, true);
  const daftarPt = await daftarPerusahaan(true);
  const jumlahPer = new Map<string, { debit: Desimal; kredit: Desimal }>();
  for (const pt of daftarPt) {
    for (const a of await saldoAkunPeriode(db, awal, akhir, true, { perusahaanId: pt.id })) {
      const lama = jumlahPer.get(a.id) ?? { debit: D(0), kredit: D(0) };
      jumlahPer.set(a.id, { debit: lama.debit.plus(a.debit), kredit: lama.kredit.plus(a.kredit) });
    }
  }
  const beda = gabungan.filter((a) => {
    const j = jumlahPer.get(a.id) ?? { debit: D(0), kredit: D(0) };
    return !j.debit.equals(a.debit) || !j.kredit.equals(a.kredit);
  });
  const hanyaPer = [...jumlahPer.entries()].filter(([id, j]) => !gabungan.some((a) => a.id === id) && (!j.debit.isZero() || !j.kredit.isZero()));
  pastikan(beda.length === 0 && hanyaPer.length === 0, `gabungan = penjumlahan ${daftarPt.length} perusahaan untuk setiap akun (beda ${beda.map((a) => a.kode).join(", ") || "tidak ada"})`);
  const sU = await periksaSinkron(db, { perusahaanId: U });
  pastikan(
    sU.seimbang && sU.persediaan.sinkron && sU.piutang.sinkron && sU.hutang.sinkron && sU.barangBelumDitagih.sinkron && sU.barangTerkirim.sinkron && sU.uangMuka.sinkron,
    "periksaSinkron perusahaan uji: seimbang dan keenam perbandingan sinkron",
  );
  pastikan(sama(sU.persediaan.bukuBesar, 410_000) && sama(sU.piutang.bukuBesar, 335_000), `persediaan perusahaan uji 41 x 10.000 dan piutang 650.000 - 200.000 - 100.000 - 15.000 (${sU.persediaan.bukuBesar}, ${sU.piutang.bukuBesar})`);
  const sUtama = await periksaSinkron(db, { perusahaanId: "utama" });
  pastikan(enamPerbandingan(sUtama) === enamPerbandingan(sinkronUtama0), "periksaSinkron utama: keenam perbandingan sama dengan sebelum uji (aktivitas perusahaan uji tidak bocor)");
  const konsistensi = await periksaKonsistensiPerusahaan(db);
  pastikan(konsistensi.total === 0, `periksaKonsistensiPerusahaan: total 0 (${konsistensi.rincian.filter((r) => r.jumlah > 0).map((r) => `${r.kode} ${r.jumlah}`).join(", ") || "bersih"})`);

  console.log("=== 6. Kasus 15: LUNAS perusahaan uji ke utama ===");
  const sebelumLunas = { p: await saldoAntarPerusahaan(db, akhirHari) };
  await jalankan("LUNAS 300.000 (pemberi utama, penerima perusahaan uji)", () =>
    buatTransaksiAntarPerusahaan(formulir({ jenis: "LUNAS", pemberiId: "utama", penerimaId: U, tanggal: isoLokal(new Date()), jumlah: 300_000, keterangan: `${KODE} pelunasan talangan`, akunPemberiId: kasUt.id, akunPenerimaId: kasU.id })),
  );
  const lunas = await db.transaksiAntarPerusahaan.findFirstOrThrow({ where: { penerimaId: U, jenis: "LUNAS" }, include: { jurnalPemberi: { include: { baris: true } }, jurnalPenerima: { include: { baris: true } } } });
  nomorLog.push(lunas.nomor);
  pastikan(
    lunas.jurnalPemberi!.perusahaanId === "utama" && sama(baris(lunas.jurnalPemberi!, kasUt.id)?.debit, 300_000) && sama(baris(lunas.jurnalPemberi!, piutangAp.id)?.kredit, 300_000),
    "LUNAS, jurnal pemberi (utama): Dr kas utama / Cr 1-1750",
  );
  pastikan(
    lunas.jurnalPenerima!.perusahaanId === U && sama(baris(lunas.jurnalPenerima!, hutangAp.id)?.debit, 300_000) && sama(baris(lunas.jurnalPenerima!, kasU.id)?.kredit, 300_000),
    "LUNAS, jurnal penerima (perusahaan uji): Dr 2-1550 / Cr kas perusahaan uji",
  );
  const sesudahLunas = await saldoAntarPerusahaan(db, akhirHari);
  pastikan(sesudahLunas.piutang.equals(saldoApAwal.piutang) && sesudahLunas.hutang.equals(saldoApAwal.hutang) && sesudahLunas.selisih.isZero() && !sebelumLunas.p.piutang.equals(sesudahLunas.piutang), "saldo 1-1750 dan 2-1550 kembali ke nilai awal");
  for (const p of ["utama", U]) pastikan((await hitungNeraca(db, akhir, isoLokal(akhir), { perusahaanId: p })).seimbang, `Neraca ${p === U ? "perusahaan uji" : "utama"} tetap seimbang sesudah LUNAS`);

  console.log("=== 7. Kasus 16 dan 32: penolakan ===");
  const isianSah = { ...tagihIsian, keterangan: `${KODE} ditolak` };
  const jumlahAp = await db.transaksiAntarPerusahaan.count();
  await harusDitolak("pemberi sama dengan penerima", () => buatTransaksiAntarPerusahaan(formulir({ ...isianSah, penerimaId: "utama" })), "Perusahaan pemberi dan penerima harus berbeda");
  await harusDitolak("akun pemberi milik perusahaan penerima", () => buatTransaksiAntarPerusahaan(formulir({ ...isianSah, akunPemberiId: kasU.id })), `Akun ${KODE}-KAS Kas Uji Multi Perusahaan milik PT Uji Multi Perusahaan`);
  await harusDitolak("akun penerima milik perusahaan pemberi", () => buatTransaksiAntarPerusahaan(formulir({ ...isianSah, akunPenerimaId: kasUt.id })), "milik D'Production");
  await harusDitolak("akun lawan 1-1750", () => buatTransaksiAntarPerusahaan(formulir({ ...isianSah, akunPemberiId: piutangAp.id })), "Akun lawan tidak boleh akun antar perusahaan; sistem sudah menambahkannya");
  await harusDitolak("akun lawan 2-1550", () => buatTransaksiAntarPerusahaan(formulir({ ...isianSah, akunPenerimaId: hutangAp.id })), "tidak boleh akun antar perusahaan");
  await harusDitolak("jenis tidak sah", () => buatTransaksiAntarPerusahaan(formulir({ ...isianSah, jenis: "PINJAM" })), "harus Tagih atau Lunas");
  await harusDitolak("tanggal di masa depan", () => buatTransaksiAntarPerusahaan(formulir({ ...isianSah, tanggal: `${tahun + 1}-01-01` })), "tidak boleh di masa depan");
  await harusDitolak("tanggal 31 Februari (tinjauan P24 T6)", () => buatTransaksiAntarPerusahaan(formulir({ ...isianSah, tanggal: `${tahun - 1}-02-31` })), "Tanggal tidak valid");
  await harusDitolak("keterangan kurang dari 3 karakter", () => buatTransaksiAntarPerusahaan(formulir({ ...isianSah, keterangan: "ab" })), "3 sampai 300 karakter");
  await harusDitolak("jumlah nol", () => buatTransaksiAntarPerusahaan(formulir({ ...isianSah, jumlah: 0 })), "Jumlah harus lebih dari 0");
  await harusDitolak("proyek pemberi milik perusahaan penerima", () => buatTransaksiAntarPerusahaan(formulir({ ...isianSah, proyekPemberiId: proyekU.id })), `Proyek PRJ-${KODE} milik`);
  await harusDitolak("akun lawan penerima kosong", () => buatTransaksiAntarPerusahaan(formulir({ ...isianSah, akunPenerimaId: "" })), "Akun lawan di buku penerima wajib dipilih");
  const kelompok = await db.akun.findFirstOrThrow({ where: { kelompok: true, perusahaanId: null }, orderBy: { kode: "asc" } });
  await harusDitolak("akun lawan berupa akun kelompok", () => buatTransaksiAntarPerusahaan(formulir({ ...isianSah, akunPenerimaId: kelompok.id })), "Akun kelompok tidak bisa dijurnal");
  await harusDitolak("hapus satu sisi lewat menu jurnal", () => hapusDokumen("jurnal", jp.id), "jurnal otomatis; hapus lewat dokumen sumbernya");
  await dengan({ peran: "KASIR" }, () => harusDitolak("KASIR mencatat transaksi antar perusahaan", () => buatTransaksiAntarPerusahaan(formulir(isianSah)), "tidak punya hak"));
  pastikan((await db.transaksiAntarPerusahaan.count()) === jumlahAp && (await db.jurnal.count({ where: { id: { in: [jp.id, jt.id] } } })) === 2, "tidak ada dokumen baru dari percobaan yang ditolak, kedua jurnal TAGIH utuh");

  console.log("=== 8. Kasus 17: hapus TAGIH membalik kedua jurnal ===");
  await hapus("antarPerusahaan", tagih.id, `TAGIH ${tagih.nomor}`);
  pastikan(
    (await db.transaksiAntarPerusahaan.count({ where: { id: tagih.id } })) === 0 && (await db.jurnal.count({ where: { id: { in: [jp.id, jt.id] } } })) === 0 && (await db.barisJurnal.count({ where: { jurnalId: { in: [jp.id, jt.id] } } })) === 0,
    "dokumen TAGIH dan kedua jurnalnya terhapus",
  );
  pastikan((await db.logAktivitas.count({ where: { aksi: "HAPUS", nomor: tagih.nomor, waktu: { gte: awalUji } } })) === 1, "log HAPUS tercatat satu kali");
  const logHapus = await db.logAktivitas.findFirstOrThrow({ where: { aksi: "HAPUS", nomor: tagih.nomor, waktu: { gte: awalUji } } });
  pastikan(logHapus.modul === "antar-perusahaan" && logHapus.entitasId === tagih.id && JSON.stringify(logHapus.meta) === JSON.stringify({ pemberiId: tagih.pemberiId, penerimaId: tagih.penerimaId }), "log HAPUS bermodul antar-perusahaan dengan entitasId dan meta pemberi dan penerima (tinjauan P24 T5)");
  const sesudahHapusTagih = await saldoAntarPerusahaan(db, akhirHari);
  pastikan(sama(saldoApAwal.piutang.minus(sesudahHapusTagih.piutang), 300_000) && sesudahHapusTagih.selisih.isZero(), "tinggal LUNAS: piutang 300.000 di bawah awal, selisih tetap nol (kedua sisi dibalik bersama)");
  await hapus("antarPerusahaan", lunas.id, `LUNAS ${lunas.nomor}`);

  console.log("=== 9. Kasus 34: bersih-bersih ===");
  await hapus("penerimaan", trm.id, trm.nomor);
  await hapus("returPenjualan", rj.id, rj.nomor);
  await hapus("faktur", fj.id, fj.nomor);
  await hapus("pengiriman", sj.id, sj.nomor);
  await hapus("uangMuka", um.id, um.nomor);
  await hapus("pesanan", psj.id, psj.nomor);
  await hapus("penawaran", pnw.id, pnw.nomor);
  await hapus("penyesuaian", ps.id, ps.nomor);
  await bersihkan();
  pastikan((await db.jurnal.count()) === jumlahJurnal0, `jumlah jurnal kembali ${jumlahJurnal0}`);
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron seimbang dan sama dengan sebelum uji");
  pastikan((await periksaKonsistensiPerusahaan(db)).total === 0, "periksaKonsistensiPerusahaan: total 0 sesudah bersih-bersih");
  pastikan((await db.perusahaan.count({ where: { kode: KODE } })) === 0 && (await db.akun.count({ where: { kode: { in: ["1-1750", "2-1550"] } } })) === 2, "perusahaan uji terhapus, akun standar antar perusahaan utuh");
  const saldoAkhir = await saldoAntarPerusahaan(db, akhirHari);
  const catatanAkhir = html(await CatatanGabungan({ sampai: akhirHari }));
  pastikan(saldoAkhir.piutang.equals(saldoApAwal.piutang) && saldoAkhir.hutang.equals(saldoApAwal.hutang) && catatanAkhir.includes(`Piutang Antar Perusahaan Rp <span class="angka ">${rupiah(saldoApAwal.piutang)}</span>`), "CatatanGabungan kembali ke saldo awal sesudah data uji dibersihkan");
  pastikan((await db.hakAksesPeran.count()) === hakAwal, "HakAksesPeran tidak berubah");
  console.log("=== DONE, all multi-perusahaan checks passed ===");
}

main()
  .catch(async (e) => {
    console.error(e);
    await bersihkan().catch((g) => console.error("bersihkan gagal", g));
    process.exit(1);
  })
  .finally(() => db.$disconnect());
