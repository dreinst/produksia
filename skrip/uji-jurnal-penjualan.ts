import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import type { Prisma } from "../src/prisma-klien/client";
import { db } from "../src/lib/db";
import { D, type Desimal } from "../src/lib/uang";
import { nilaiBaris } from "../src/lib/nilaiBaris";
import { periksaSinkron } from "../src/lib/sinkron";
import { labaRugiKas } from "../src/lib/basisKas";
import { BERKAS, type JenisPersetujuan } from "../src/lib/persetujuan";
import { bentrokNomorCetak, simpanNomorCetak } from "../src/lib/nomorCetak";
import {
  KUNCI_AKUN_FEE,
  akunFeeManajemen,
  catatJurnalFakturPenjualan,
  catatJurnalPenerimaanPenjualan,
  catatJurnalReturPenjualan,
  catatJurnalUangMuka,
  type BarisDokumen,
} from "../src/lib/akuntansi";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { ajukanDokumen, setujuiDokumen, tolakDokumen } from "../src/lib/aksi/persetujuan";
import { harusDitolak, jalankan, pastikan, sebagai } from "./bantuan";

/*
 * P21: akuntansi dokumen penjualan (D2 §4).
 * 1. jurnal faktur dan retur tanpa fee dan frekuensi sama dengan rumus lama (baris, urutan, keterangan);
 * 2. fee > 0 menambah satu baris akun fee (pemetaan tambahan atau akun pendapatan bawaan); contoh D2 §4.1;
 * 3. akun fee yang bukan akun rinci Pendapatan atau berada di kelompok bukan omzet ditolak;
 * 4. frekuensi 3 menghasilkan nilai pendapatan tiga kali lipat (faktur dan retur);
 * 5. nomor cetak faktur dialokasikan saat posting persetujuan bila format aktif, tidak bila nonaktif atau manual,
 *    juga lewat setujuiDokumen sungguhan; P2002 nomor cetak diterjemahkan;
 * 6. basis kas membagi kas uang muka dan pelunasan ke akun fee secara proporsional;
 * 7. hapus faktur jalur id memulihkan sisa per baris pesanan dan baris SJ; hapus pesanan dan penawaran membuang
 *    rencana termin; hak hapus dan setujui;
 * 8. persetujuan bersamaan (tinjauan P21 butir 1): dua setujui atas faktur atau kas masuk yang sama menghasilkan satu
 *    jurnal dan satu nomor cetak, setujui dan tolak bersamaan berakhir konsisten, ajukan ganda tercatat sekali;
 * 9. basis kas memakai akun Pendapatan Penjualan untuk bagian fee bila pemetaan fee bukan akun rinci Pendapatan
 *    (tinjauan P21 butir 3).
 * Bagian 1-6 dan 9 berjalan di transaksi yang selalu dibatalkan. Data bagian 5 (alur sungguhan), 7, dan 8 dihapus di akhir,
 * pemetaan tambahan fee uji dipulihkan, dan periksaSinkron(db) sama dengan sebelum uji.
 */

type Tx = Prisma.TransactionClient;
const AWALAN = "UJIJP";

class Batal extends Error {}
/** Menjalankan fn di transaksi yang selalu dibatalkan, lalu mengembalikan hasilnya. */
async function dalamTransaksiBatal<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let hasil: T | undefined;
  try {
    await db.$transaction(
      async (tx) => {
        hasil = await fn(tx);
        throw new Batal();
      },
      { timeout: 120_000 },
    );
  } catch (e) {
    if (!(e instanceof Batal)) throw e;
  }
  return hasil as T;
}

/** Baris jurnal sebagai teks "kode|debit|kredit|keterangan" menurut urutan sisip. */
async function barisJurnal(tx: Tx, jurnalId: string | null | undefined): Promise<string[]> {
  if (!jurnalId) return [];
  const baris = await tx.barisJurnal.findMany({ where: { jurnalId }, orderBy: { id: "asc" }, select: { debit: true, kredit: true, keterangan: true, akun: { select: { kode: true } } } });
  return baris.map((b) => `${b.akun.kode}|${D(b.debit).toFixed(2)}|${D(b.kredit).toFixed(2)}|${b.keterangan}`);
}

async function galat(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as Error).message;
  }
  return "";
}

async function bersihkan() {
  const faktur = await db.fakturPenjualan.findMany({ where: { nomor: { startsWith: AWALAN } }, select: { id: true, jurnalId: true } });
  for (const f of faktur) {
    await db.pemakaianUangMuka.deleteMany({ where: { fakturId: f.id } });
    await db.barisFakturPenjualan.deleteMany({ where: { fakturId: f.id } });
    await db.fakturPenjualan.delete({ where: { id: f.id } });
    if (f.jurnalId) {
      await db.barisJurnal.deleteMany({ where: { jurnalId: f.jurnalId } });
      await db.jurnal.delete({ where: { id: f.jurnalId } });
    }
  }
  for (const d of await db.dokumenKas.findMany({ where: { nomor: { startsWith: AWALAN } }, select: { id: true, jurnalId: true } })) {
    await db.dokumenKas.delete({ where: { id: d.id } });
    if (d.jurnalId) {
      await db.barisJurnal.deleteMany({ where: { jurnalId: d.jurnalId } });
      await db.jurnal.delete({ where: { id: d.jurnalId } });
    }
  }
  // jurnal tanpa dokumen (mis. jurnal kedua dari persetujuan ganda bila bagian 8 gagal) tetap dibersihkan
  await db.barisJurnal.deleteMany({ where: { jurnal: { keterangan: { contains: `${AWALAN}-` } } } });
  await db.jurnal.deleteMany({ where: { keterangan: { contains: `${AWALAN}-` } } });
  await db.barisPengiriman.deleteMany({ where: { pengiriman: { nomor: { startsWith: AWALAN } } } });
  await db.pengirimanPesanan.deleteMany({ where: { nomor: { startsWith: AWALAN } } });
  await db.rencanaTermin.deleteMany({ where: { OR: [{ pesanan: { nomor: { startsWith: AWALAN } } }, { penawaran: { nomor: { startsWith: AWALAN } } }] } });
  await db.barisPesananPenjualan.deleteMany({ where: { pesanan: { nomor: { startsWith: AWALAN } } } });
  await db.pesananPenjualan.deleteMany({ where: { nomor: { startsWith: AWALAN } } });
  await db.barisPenawaranPenjualan.deleteMany({ where: { penawaran: { nomor: { startsWith: AWALAN } } } });
  await db.penawaranPenjualan.deleteMany({ where: { nomor: { startsWith: AWALAN } } });
  await db.formatNomor.deleteMany({ where: { kunciDeret: { startsWith: "ujijp" } } });
  await db.penghitungNomor.deleteMany({ where: { kunciDeret: { startsWith: "ujijp" } } });
  await db.pemetaanAkunTambahan.deleteMany({ where: { kunci: KUNCI_AKUN_FEE, akun: { kode: { startsWith: `4-${AWALAN}` } } } });
  await db.barang.deleteMany({ where: { kode: { startsWith: AWALAN } } });
  await db.akun.deleteMany({ where: { kode: { startsWith: `4-${AWALAN}` } } });
  await db.pelanggan.deleteMany({ where: { kode: { startsWith: AWALAN } } });
  await db.notifikasi.deleteMany({ where: { judul: { contains: AWALAN } } });
  await db.logAktivitas.deleteMany({ where: { nomor: { startsWith: AWALAN } } });
}

async function main() {
  await bersihkan();
  const sinkronAwal = await periksaSinkron(db);
  const hakAwal = await db.hakAksesPeran.count();
  const jurnalAwal = await db.jurnal.count();
  // pemetaan tambahan fee yang mungkin sudah ada (mis. dibuat pemilik): disimpan lalu dipulihkan
  const feeAwal = await db.pemetaanAkunTambahan.findUnique({ where: { kunci: KUNCI_AKUN_FEE } });
  if (feeAwal) await db.pemetaanAkunTambahan.delete({ where: { id: feeAwal.id } });

  const m = await db.pemetaanAkun.findUniqueOrThrow({ where: { id: "default" } });
  const akun = async (kode: string) => (await db.akun.findFirstOrThrow({ where: { kode } })).id;
  const kodeAkun = async (id: string | null) => (id ? (await db.akun.findUniqueOrThrow({ where: { id } })).kode : "");
  const [k4000, k4200, k4900, k4800, kKas, kPpnK] = await Promise.all([akun("4-1000"), akun("4-1200"), akun("4-9000"), akun("4-8000"), akun("1-1100"), akun("2-1330")]);
  const kodePendapatan = await kodeAkun(m.pendapatanPenjualanId);
  const kodePiutang = await kodeAkun(m.piutangUsahaId);
  const kodeDiskon = await kodeAkun(m.diskonPenjualanId);
  const kodeUm = await kodeAkun(m.uangMukaPelangganId);
  const kodeTerkirim = await kodeAkun(m.barangTerkirimId);
  const kodeHpp = await kodeAkun(m.hppId);
  const kodePersediaan = await kodeAkun(m.persediaanId);

  const pelanggan = await db.pelanggan.create({ data: { kode: `${AWALAN}-PLG`, nama: "Pelanggan Uji Jurnal Penjualan" } });
  const jasa = await db.barang.create({ data: { kode: `${AWALAN}-JASA`, nama: "Jasa Uji", jenis: "JASA", perusahaanId: null, hargaJual: 1000 } });
  const kamar = await db.barang.create({ data: { kode: `${AWALAN}-KAMAR`, nama: "Kamar Uji", jenis: "JASA", perusahaanId: null, akunPendapatanId: k4200 } });
  const sound = await db.barang.create({ data: { kode: `${AWALAN}-SOUND`, nama: "Sound Uji", jenis: "BARANG", hargaBeli: 1_000_000 } });
  const akunFee = await db.akun.create({ data: { kode: `4-${AWALAN}1`, nama: "Pendapatan Fee Uji", jenis: "PENDAPATAN", kelompok: false, indukId: k4000 } });
  const akunLain = await db.akun.create({ data: { kode: `4-${AWALAN}2`, nama: "Fee di Pendapatan Lain Uji", jenis: "PENDAPATAN", kelompok: false, indukId: k4900 } });
  const akunPotongan = await db.akun.create({ data: { kode: `4-${AWALAN}3`, nama: "Fee di Potongan Uji", jenis: "PENDAPATAN", kelompok: false, indukId: k4800 } });
  const gudang = await db.gudang.findFirstOrThrow({ orderBy: { kode: "asc" } });
  const baris = (barangId: string, jumlah: number | string, harga: number | string, frekuensi?: number | string): BarisDokumen => ({ barangId, jumlah: D(jumlah), harga: D(harga), ...(frekuensi === undefined ? {} : { frekuensi: D(frekuensi) }) });

  try {
    console.log("=== 1. Fee 0 dan frekuensi kosong: jurnal sama dengan rumus lama ===");
    const pakaiPpn = { nomor: `${AWALAN}-FJ1`, total: D(2664), ppn: D(264), uangMuka: D(500), diskon: D("16.66"), perusahaanId: "utama" };
    const barisLama = [baris(jasa.id, "1.25", "333.33"), baris(kamar.id, 2, 1000)];
    const harapan = [
      `${kodePiutang}|2164.00|0.00|Piutang ${pakaiPpn.nomor}`,
      `${kodeUm}|500.00|0.00|Uang muka dipakai ${pakaiPpn.nomor}`,
      `${kodeDiskon}|16.66|0.00|Diskon ${pakaiPpn.nomor}`,
      `${kodePendapatan}|0.00|416.66|Pendapatan ${pakaiPpn.nomor}`,
      `4-1200|0.00|2000.00|Pendapatan ${pakaiPpn.nomor}`,
      `2-1330|0.00|264.00|PPN keluaran ${pakaiPpn.nomor}`,
    ];
    const tanpaFee = await dalamTransaksiBatal(async (tx) => barisJurnal(tx, (await catatJurnalFakturPenjualan(tx, pakaiPpn, barisLama, kPpnK))?.id));
    pastikan(JSON.stringify(tanpaFee) === JSON.stringify(harapan), `faktur tanpa fee: baris, urutan, dan keterangan sama dengan rumus lama ${JSON.stringify(tanpaFee)}`);
    const feeNol = await dalamTransaksiBatal(async (tx) => barisJurnal(tx, (await catatJurnalFakturPenjualan(tx, { ...pakaiPpn, fee: D(0) }, barisLama.map((b) => ({ ...b, frekuensi: D(1) })), kPpnK))?.id));
    pastikan(JSON.stringify(feeNol) === JSON.stringify(harapan), "faktur fee 0 dan frekuensi 1 identik dengan tanpa kolom baru");
    // fee 0 tidak membaca pemetaan fee sama sekali: pemetaan rusak pun tidak menggagalkan faktur lama
    const feeNolPetaRusak = await dalamTransaksiBatal(async (tx) => {
      await tx.pemetaanAkunTambahan.create({ data: { kunci: KUNCI_AKUN_FEE, label: "Pendapatan Fee Manajemen", dibuatOleh: "uji", akunId: k4000 } });
      return barisJurnal(tx, (await catatJurnalFakturPenjualan(tx, { ...pakaiPpn, fee: 0 }, barisLama, kPpnK))?.id);
    });
    pastikan(JSON.stringify(feeNolPetaRusak) === JSON.stringify(harapan), "fee 0 dengan pemetaan fee tidak sah tetap identik (akun fee tidak dibaca)");
    const returLama = await dalamTransaksiBatal(async (tx) =>
      barisJurnal(tx, (await catatJurnalReturPenjualan(tx, { nomor: `${AWALAN}-RJ1`, total: D("1110.00"), ppn: D(110), diskon: D("6.66"), perusahaanId: "utama" }, [baris(jasa.id, 1, "1006.66")], kPpnK))?.id),
    );
    pastikan(
      JSON.stringify(returLama) === JSON.stringify([`${kodePendapatan}|1006.66|0.00|Retur ${AWALAN}-RJ1`, `2-1330|110.00|0.00|PPN keluaran dibalik ${AWALAN}-RJ1`, `${kodeDiskon}|0.00|6.66|Diskon dibalik ${AWALAN}-RJ1`, `${kodePiutang}|0.00|1110.00|Pengurangan piutang ${AWALAN}-RJ1`]),
      `retur tanpa fee sama dengan rumus lama ${JSON.stringify(returLama)}`,
    );

    console.log("=== 2. Fee > 0: satu baris kredit akun fee (contoh D2 §4.1) ===");
    const fjEvent = { nomor: `${AWALAN}-FJ2`, total: D(66_946_000), dpp: D(66_946_000), ppn: D(0), uangMuka: D(20_083_800), diskon: D(890_000), fee: D(6_086_000), perusahaanId: "utama" };
    const barisEvent = [baris(sound.id, 1, 2_000_000, 3), baris(jasa.id, 25, 650_000, 3), baris(jasa.id, 1, 7_000_000, 1)];
    const transit = [{ barangId: sound.id, nilai: D(1_000_000) }];
    const tanpaPeta = await dalamTransaksiBatal(async (tx) => barisJurnal(tx, (await catatJurnalFakturPenjualan(tx, fjEvent, barisEvent, null, transit))?.id));
    pastikan(
      JSON.stringify(tanpaPeta) ===
        JSON.stringify([
          `${kodePiutang}|46862200.00|0.00|Piutang ${fjEvent.nomor}`,
          `${kodeUm}|20083800.00|0.00|Uang muka dipakai ${fjEvent.nomor}`,
          `${kodeDiskon}|890000.00|0.00|Diskon ${fjEvent.nomor}`,
          `${kodePendapatan}|0.00|61750000.00|Pendapatan ${fjEvent.nomor}`,
          `${kodePendapatan}|0.00|6086000.00|Management fee ${fjEvent.nomor}`,
          `${kodeHpp}|1000000.00|0.00|HPP ${fjEvent.nomor}`,
          `${kodeTerkirim}|0.00|1000000.00|Barang terkirim ditagih ${fjEvent.nomor}`,
        ]),
      `faktur event D2 §4.1 tanpa pemetaan fee: fee ke akun Pendapatan Penjualan, seimbang 68.836.000 ${JSON.stringify(tanpaPeta)}`,
    );
    const denganPeta = await dalamTransaksiBatal(async (tx) => {
      await tx.pemetaanAkunTambahan.create({ data: { kunci: KUNCI_AKUN_FEE, label: "Pendapatan Fee Manajemen", dibuatOleh: "uji", akunId: akunFee.id } });
      return barisJurnal(tx, (await catatJurnalFakturPenjualan(tx, fjEvent, barisEvent, null, transit))?.id);
    });
    pastikan(denganPeta.length === 7 && denganPeta[4] === `${akunFee.kode}|0.00|6086000.00|Management fee ${fjEvent.nomor}` && denganPeta[3] === `${kodePendapatan}|0.00|61750000.00|Pendapatan ${fjEvent.nomor}`, "dengan pemetaan Pendapatan Fee Manajemen: fee di akun pemetaan, sesudah baris pendapatan");
    const returEvent = await dalamTransaksiBatal(async (tx) => {
      await tx.pemetaanAkunTambahan.create({ data: { kunci: KUNCI_AKUN_FEE, label: "Pendapatan Fee Manajemen", dibuatOleh: "uji", akunId: akunFee.id } });
      return barisJurnal(tx, (await catatJurnalReturPenjualan(tx, { nomor: `${AWALAN}-RJ2`, total: D("10570421.05"), ppn: D(0), diskon: D("140526.32"), fee: D("960947.37"), perusahaanId: "utama" }, [baris(kamar.id, 5, 650_000, 3)], null))?.id);
    });
    pastikan(
      JSON.stringify(returEvent) ===
        JSON.stringify([`4-1200|9750000.00|0.00|Retur ${AWALAN}-RJ2`, `${akunFee.kode}|960947.37|0.00|Management fee dibalik ${AWALAN}-RJ2`, `${kodeDiskon}|0.00|140526.32|Diskon dibalik ${AWALAN}-RJ2`, `${kodePiutang}|0.00|10570421.05|Pengurangan piutang ${AWALAN}-RJ2`]),
      `retur 5 kamar × 3 malam D2 §4.1: Dr pendapatan 9.750.000 dan Dr fee 960.947,37 ${JSON.stringify(returEvent)}`,
    );
    const tidakSeimbang = await galat(() => dalamTransaksiBatal((tx) => catatJurnalFakturPenjualan(tx, { ...fjEvent, fee: D(6_000_000) }, barisEvent, null, transit)));
    pastikan(tidakSeimbang.includes("tidak seimbang"), "fee yang tidak cocok dengan total tetap ditolak catatJurnal (tidak seimbang)");

    console.log("=== 3. Akun fee tidak sah ditolak ===");
    const cobaPeta = (akunId: string) =>
      galat(() =>
        dalamTransaksiBatal(async (tx) => {
          await tx.pemetaanAkunTambahan.create({ data: { kunci: KUNCI_AKUN_FEE, label: "Pendapatan Fee Manajemen", dibuatOleh: "uji", akunId } });
          await catatJurnalFakturPenjualan(tx, fjEvent, barisEvent, null, transit);
        }),
      );
    pastikan((await cobaPeta(k4000)) === "Akun 'Pendapatan Fee Manajemen' di Pemetaan Akun harus akun rinci jenis Pendapatan", "akun kelompok ditolak");
    pastikan((await cobaPeta(kKas)) === "Akun 'Pendapatan Fee Manajemen' di Pemetaan Akun harus akun rinci jenis Pendapatan", "akun bukan Pendapatan ditolak");
    pastikan((await cobaPeta(akunLain.id)) === "Akun fee manajemen tidak boleh berada di kelompok Diskon Penjualan atau Pendapatan Lain-lain", "akun di kelompok Pendapatan Lain-lain ditolak");
    pastikan((await cobaPeta(akunPotongan.id)) === "Akun fee manajemen tidak boleh berada di kelompok Diskon Penjualan atau Pendapatan Lain-lain", "akun di kelompok Diskon Penjualan ditolak");
    pastikan((await cobaPeta(m.diskonPenjualanId!)) === "Akun fee manajemen tidak boleh berada di kelompok Diskon Penjualan atau Pendapatan Lain-lain", "akun Diskon Penjualan sendiri ditolak");
    const returPetaSalah = await galat(() =>
      dalamTransaksiBatal(async (tx) => {
        await tx.pemetaanAkunTambahan.create({ data: { kunci: KUNCI_AKUN_FEE, label: "Pendapatan Fee Manajemen", dibuatOleh: "uji", akunId: akunLain.id } });
        await catatJurnalReturPenjualan(tx, { nomor: `${AWALAN}-RJ3`, total: D(1100), fee: D(100), perusahaanId: "utama" }, [baris(jasa.id, 1, 1000)], null);
      }),
    );
    pastikan(returPetaSalah.includes("kelompok Diskon Penjualan atau Pendapatan Lain-lain"), "retur ber-fee juga memeriksa akun fee");
    const idSah = await dalamTransaksiBatal(async (tx) => {
      await tx.pemetaanAkunTambahan.create({ data: { kunci: KUNCI_AKUN_FEE, label: "Pendapatan Fee Manajemen", dibuatOleh: "uji", akunId: akunFee.id } });
      return akunFeeManajemen(tx, m);
    });
    pastikan(idSah === akunFee.id && (await dalamTransaksiBatal((tx) => akunFeeManajemen(tx, m))) === m.pendapatanPenjualanId, "akunFeeManajemen: pemetaan sah dipakai, tanpa pemetaan akun Pendapatan Penjualan");

    console.log("=== 4. Frekuensi ===");
    const nilaiPecahan = nilaiBaris({ jumlah: "1.5", harga: "1000.01", frekuensi: 3 }).toFixed(2);
    const frek = await dalamTransaksiBatal(async (tx) =>
      barisJurnal(tx, (await catatJurnalFakturPenjualan(tx, { nomor: `${AWALAN}-FJ3`, total: D(nilaiPecahan), perusahaanId: "utama" }, [baris(jasa.id, "1.5", "1000.01", 3)], null))?.id),
    );
    pastikan(nilaiPecahan === "4500.05" && frek[1] === `${kodePendapatan}|0.00|4500.05|Pendapatan ${AWALAN}-FJ3`, `frekuensi 3: 1,5 × 3 × 1.000,01 = 4.500,05 dengan satu pembulatan ${JSON.stringify(frek)}`);
    const frekSeimbang = await dalamTransaksiBatal(async (tx) =>
      barisJurnal(tx, (await catatJurnalFakturPenjualan(tx, { nomor: `${AWALAN}-FJ4`, total: D(6_000_000), perusahaanId: "utama" }, [baris(jasa.id, 1, 2_000_000, 3)], null))?.id),
    );
    pastikan(frekSeimbang[1] === `${kodePendapatan}|0.00|6000000.00|Pendapatan ${AWALAN}-FJ4`, "frekuensi 3 hari: nilai baris 3 × 2.000.000");
    const frekRetur = await dalamTransaksiBatal(async (tx) =>
      barisJurnal(tx, (await catatJurnalReturPenjualan(tx, { nomor: `${AWALAN}-RJ4`, total: D(2_000_000), perusahaanId: "utama" }, [baris(sound.id, 1, 1_000_000, 2)], null))?.id),
    );
    pastikan(
      frekRetur[0] === `${kodePendapatan}|2000000.00|0.00|Retur ${AWALAN}-RJ4` && frekRetur.includes(`${kodePersediaan}|1000000.00|0.00|Barang retur masuk ${AWALAN}-RJ4`),
      "retur frekuensi 2: pendapatan dibalik 2 ×, persediaan tetap jumlah × harga pokok (frekuensi tidak ikut stok)",
    );

    console.log("=== 5. Nomor cetak faktur saat posting persetujuan ===");
    const buatDraf = async (k: Tx | typeof db, nomor: string, isi: Partial<{ nomorCetak: string; perusahaanId: string; statusPersetujuan: "DRAFT" | "MENUNGGU"; diajukanOlehId: string }> = {}) =>
      k.fakturPenjualan.create({
        data: {
          nomor,
          pelangganId: pelanggan.id,
          tanggal: new Date(),
          total: 6_600_000,
          dpp: 6_600_000,
          fee: 600_000,
          statusPersetujuan: isi.statusPersetujuan ?? "MENUNGGU",
          diajukanOlehId: isi.diajukanOlehId ?? null,
          nomorCetak: isi.nomorCetak ?? null,
          perusahaanId: isi.perusahaanId ?? "utama",
          baris: { create: [{ barangId: jasa.id, jumlah: 1, harga: 2_000_000, frekuensi: 3, subtotal: nilaiBaris({ jumlah: 1, harga: 2_000_000, frekuensi: 3 }) }] },
        },
      });
    const tahun = new Date().getFullYear();
    const hasilPosting = await dalamTransaksiBatal(async (tx) => {
      await tx.formatNomor.create({ data: { perusahaanId: "utama", jenis: "faktur", pola: "UJIJP-{SEQ3}/{YYYY}", kunciDeret: "ujijp-faktur", reset: "TAHUNAN" } });
      const f1 = await buatDraf(tx, `${AWALAN}-FJ5`);
      const f2 = await buatDraf(tx, `${AWALAN}-FJ6`, { nomorCetak: "MANUAL-UJIJP" });
      const f3 = await buatDraf(tx, `${AWALAN}-FJ7`);
      await BERKAS.faktur.posting(tx, f1.id);
      await BERKAS.faktur.posting(tx, f2.id);
      await BERKAS.faktur.posting(tx, f3.id);
      const baca = (id: string) => tx.fakturPenjualan.findUniqueOrThrow({ where: { id }, select: { nomorCetak: true, jurnalId: true } });
      const [b1, b2, b3] = [await baca(f1.id), await baca(f2.id), await baca(f3.id)];
      const jurnal1 = await barisJurnal(tx, b1.jurnalId);
      // format nonaktif: tidak ada nomor
      await tx.formatNomor.update({ where: { perusahaanId_jenis: { perusahaanId: "utama", jenis: "faktur" } }, data: { aktif: false } });
      const f4 = await buatDraf(tx, `${AWALAN}-FJ8`);
      await BERKAS.faktur.posting(tx, f4.id);
      const b4 = await baca(f4.id);
      // perusahaan lain tanpa format
      const lain = await tx.perusahaan.findFirst({ where: { id: { not: "utama" }, aktif: true }, select: { id: true } });
      let b5: { nomorCetak: string | null; jurnalId: string | null } | null = null;
      if (lain) {
        await tx.akun.updateMany({ where: { id: { in: [m.piutangUsahaId, m.pendapatanPenjualanId] }, perusahaanId: { not: null } }, data: { perusahaanId: null } });
        const f5 = await buatDraf(tx, `${AWALAN}-FJ9`, { perusahaanId: lain.id });
        await BERKAS.faktur.posting(tx, f5.id);
        b5 = await baca(f5.id);
      }
      const penghitung = await tx.penghitungNomor.findMany({ where: { kunciDeret: "ujijp-faktur" } });
      return { b1, b2, b3, b4, b5, jurnal1, penghitung };
    });
    pastikan(hasilPosting.b1.nomorCetak === `UJIJP-001/${tahun}` && hasilPosting.b3.nomorCetak === `UJIJP-002/${tahun}` && hasilPosting.b1.jurnalId, "format aktif: nomor cetak dialokasikan saat posting, berurutan");
    pastikan(hasilPosting.b2.nomorCetak === "MANUAL-UJIJP" && hasilPosting.b2.jurnalId, "nomor manual tidak ditimpa dan penghitung tidak naik untuknya");
    pastikan(hasilPosting.penghitung.length === 1 && hasilPosting.penghitung[0].nilai === 2, "penghitung hanya naik untuk faktur tanpa nomor manual");
    pastikan(hasilPosting.b4.nomorCetak === null && hasilPosting.b4.jurnalId, "format nonaktif: faktur disetujui tanpa nomor cetak");
    pastikan(!hasilPosting.b5 || (hasilPosting.b5.nomorCetak === null && hasilPosting.b5.jurnalId), "perusahaan tanpa format faktur: tanpa nomor cetak");
    pastikan(
      JSON.stringify(hasilPosting.jurnal1) === JSON.stringify([`${kodePiutang}|6600000.00|0.00|Piutang ${AWALAN}-FJ5`, `${kodePendapatan}|0.00|6000000.00|Pendapatan ${AWALAN}-FJ5`, `${kodePendapatan}|0.00|600000.00|Management fee ${AWALAN}-FJ5`]),
      `posting persetujuan: frekuensi 3 dan fee faktur ikut jurnal ${JSON.stringify(hasilPosting.jurnal1)}`,
    );
    pastikan((await db.formatNomor.count({ where: { kunciDeret: "ujijp-faktur" } })) === 0 && (await db.fakturPenjualan.count({ where: { nomor: { startsWith: AWALAN } } })) === 0, "transaksi uji posting dibatalkan tanpa sisa");

    // P2002 nomor cetak: dua faktur dengan nomor cetak sama di perusahaan sama
    const p2002 = await galat(() =>
      dalamTransaksiBatal(async (tx) => {
        await buatDraf(tx, `${AWALAN}-FJ10`, { nomorCetak: "UJIJP-GANDA" });
        const f = await buatDraf(tx, `${AWALAN}-FJ11`);
        await simpanNomorCetak("UJIJP-GANDA", () => tx.fakturPenjualan.update({ where: { id: f.id }, data: { nomorCetak: "UJIJP-GANDA" } }));
      }),
    );
    pastikan(p2002 === "Nomor cetak UJIJP-GANDA sudah dipakai dokumen lain.", `P2002 unik nomor cetak diterjemahkan: ${p2002}`);
    const bukanNomor = await galat(() => simpanNomorCetak("X", async () => Promise.reject(Object.assign(new Error("unik lain"), { code: "P2002", meta: { target: ["nomor"] } }))));
    pastikan(bukanNomor === "unik lain" && !bentrokNomorCetak({ code: "P2003", meta: { x: "nomorCetak" } }), "P2002 indeks lain dan galat lain diteruskan apa adanya");

    // alur sungguhan: faktur MENUNGGU diajukan kasir, disetujui pemilik lewat setujuiDokumen
    const kasir = await db.pengguna.findUniqueOrThrow({ where: { namaPengguna: "kasir" } });
    await db.formatNomor.create({ data: { perusahaanId: "utama", jenis: "faktur", pola: "UJIJP-{SEQ3}/{YYYY}", kunciDeret: "ujijp-faktur", reset: "TAHUNAN" } });
    const fSetuju = await buatDraf(db, `${AWALAN}-FJ12`, { diajukanOlehId: kasir.id });
    await harusDitolak("GUDANG menyetujui faktur", () => sebagai("gudang", () => setujuiDokumen("faktur", fSetuju.id)), "tidak punya hak");
    pastikan((await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fSetuju.id } })).nomorCetak === null, "penolakan hak tidak memakan nomor cetak");
    await sebagai("owner", () => jalankan("pemilik menyetujui faktur ber-fee", () => setujuiDokumen("faktur", fSetuju.id)));
    const disetujui = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fSetuju.id } });
    pastikan(disetujui.statusPersetujuan === "DISETUJUI" && disetujui.nomorCetak === `UJIJP-001/${tahun}` && disetujui.jurnalId, "setujuiDokumen: nomor cetak dialokasikan saat disetujui");
    pastikan((await periksaSinkron(db)).seimbang, "periksaSinkron seimbang sesudah faktur ber-fee disetujui");
    await sebagai("owner", () => jalankan("hapus faktur ber-fee yang disetujui", () => hapusDokumen("faktur", fSetuju.id)));
    pastikan((await db.jurnal.count()) === jurnalAwal, "hapus faktur membuang jurnal beserta baris fee");
    await db.formatNomor.deleteMany({ where: { kunciDeret: "ujijp-faktur" } });
    await db.penghitungNomor.deleteMany({ where: { kunciDeret: "ujijp-faktur" } });

    console.log("=== 6. Basis kas: kas dibagi ke akun fee secara proporsional ===");
    const kas = await dalamTransaksiBatal(async (tx) => {
      await tx.pemetaanAkunTambahan.create({ data: { kunci: KUNCI_AKUN_FEE, label: "Pendapatan Fee Manajemen", dibuatOleh: "uji", akunId: akunFee.id } });
      const kini = new Date();
      const periode = { dari: new Date(kini.getFullYear(), 0, 1), sampai: new Date(kini.getFullYear(), 11, 31, 23, 59, 59, 999), dariTeks: `${kini.getFullYear()}-01-01`, sampaiTeks: `${kini.getFullYear()}-12-31` };
      const klien = tx as unknown as typeof db;
      const sebelum = await labaRugiKas(klien, periode);
      const pesanan = await tx.pesananPenjualan.create({
        data: {
          nomor: `${AWALAN}-PSN1`,
          pelangganId: pelanggan.id,
          total: 66_946_000,
          diskon: 890_000,
          fee: 6_086_000,
          baris: { create: [{ barangId: sound.id, jumlah: 1, harga: 2_000_000, frekuensi: 3 }, { barangId: kamar.id, jumlah: 25, harga: 650_000, frekuensi: 3 }, { barangId: jasa.id, jumlah: 1, harga: 7_000_000 }] },
        },
      });
      const um = await tx.uangMukaPelanggan.create({ data: { nomor: `${AWALAN}-UM1`, pelangganId: pelanggan.id, pesananId: pesanan.id, akunId: kKas, jumlah: 20_083_800 } });
      const jUm = await catatJurnalUangMuka(tx, um, pesanan.nomor);
      await tx.uangMukaPelanggan.update({ where: { id: um.id }, data: { jurnalId: jUm!.id } });
      const f = await tx.fakturPenjualan.create({
        data: {
          nomor: `${AWALAN}-FJ13`,
          pelangganId: pelanggan.id,
          pesananId: pesanan.id,
          total: 66_946_000,
          dpp: 66_946_000,
          diskon: 890_000,
          fee: 6_086_000,
          uangMuka: 20_083_800,
          statusPersetujuan: "DISETUJUI",
          baris: {
            create: [
              { barangId: sound.id, jumlah: 1, harga: 2_000_000, frekuensi: 3, subtotal: 6_000_000 },
              { barangId: kamar.id, jumlah: 25, harga: 650_000, frekuensi: 3, subtotal: 48_750_000 },
              { barangId: jasa.id, jumlah: 1, harga: 7_000_000, subtotal: 7_000_000 },
            ],
          },
        },
      });
      const trm = await tx.penerimaanPenjualan.create({ data: { nomor: `${AWALAN}-TRM1`, pelangganId: pelanggan.id, fakturId: f.id, akunId: kKas, jumlah: 46_862_200 } });
      const jTrm = await catatJurnalPenerimaanPenjualan(tx, trm, f.nomor);
      await tx.penerimaanPenjualan.update({ where: { id: trm.id }, data: { jurnalId: jTrm!.id } });
      const sesudahUm = async () => labaRugiKas(klien, periode);
      const sesudah = await sesudahUm();
      const perAkun = (l: Awaited<ReturnType<typeof labaRugiKas>>) => new Map<string, Desimal>(l.pendapatan.filter((x) => !x.kelompok).map((x) => [x.kode, D(x.jumlah)]));
      const a = perAkun(sebelum), b = perAkun(sesudah);
      const selisih = (kode: string) => (b.get(kode) ?? D(0)).minus(a.get(kode) ?? D(0)).toFixed(2);
      return { fee: selisih(akunFee.kode), k4200: selisih("4-1200"), bawaan: selisih(kodePendapatan), total: sesudah.totalPendapatan.minus(sebelum.totalPendapatan).toFixed(2) };
    });
    // UM 20.083.800 = 30%: fee 1.825.800; pelunasan 46.862.200 = 70%: fee 4.260.200; total fee 6.086.000 (1/11 kas)
    pastikan(kas.fee === "6086000.00", `basis kas: bagian fee = 6.086.000 (${kas.fee})`);
    pastikan(kas.total === "66946000.00" && D(kas.fee).plus(kas.k4200).plus(kas.bawaan).toFixed(2) === "66946000.00", `basis kas: seluruh kas pelanggan teralokasi (${kas.total}, kamar ${kas.k4200}, bawaan ${kas.bawaan})`);
    // bobot kamar = 48.750.000 (25 × 3 malam × 650.000) × (61.750.000 − 890.000) / 61.750.000; dibulatkan per dokumen
    const bobotKamar = D(48_750_000).mul(60_860_000).div(61_750_000);
    const harapanKamar = D(20_083_800).mul(bobotKamar).div(66_946_000).toDecimalPlaces(2).plus(D(46_862_200).mul(bobotKamar).div(66_946_000).toDecimalPlaces(2));
    pastikan(kas.k4200 === harapanKamar.toFixed(2), `basis kas: kamar mendapat bobot nilai baris berfrekuensi dikurangi diskon prorata (${kas.k4200} = ${harapanKamar.toFixed(2)})`);

    console.log("=== 7. Hapus faktur jalur id, rencana termin, hak ===");
    const kemarin = new Date(Date.now() - 24 * 3600 * 1000);
    const psn = await db.pesananPenjualan.create({
      data: { nomor: `${AWALAN}-PSN2`, pelangganId: pelanggan.id, tanggal: kemarin, total: 400, baris: { create: [{ barangId: sound.id, jumlah: 2, harga: 100, jumlahTerkirim: 2, jumlahDifaktur: 2, urutan: 0 }, { barangId: sound.id, jumlah: 2, harga: 100, jumlahTerkirim: 2, jumlahDifaktur: 2, urutan: 1 }] } },
      include: { baris: { orderBy: { urutan: "asc" } } },
    });
    const [r1, r2] = psn.baris;
    const sj = await db.pengirimanPesanan.create({
      data: { nomor: `${AWALAN}-SJ1`, pesananId: psn.id, gudangId: gudang.id, tanggal: kemarin, baris: { create: [{ barisPesananId: r1.id, barangId: sound.id, jumlah: 2, jumlahDifaktur: 2, hargaPokok: 50 }, { barisPesananId: r2.id, barangId: sound.id, jumlah: 2, jumlahDifaktur: 2, hargaPokok: 50 }] } },
      include: { baris: true },
    });
    const s1 = sj.baris.find((x) => x.barisPesananId === r1.id)!;
    const s2 = sj.baris.find((x) => x.barisPesananId === r2.id)!;
    const fId = await db.fakturPenjualan.create({
      data: { nomor: `${AWALAN}-FJ14`, pelangganId: pelanggan.id, pesananId: psn.id, total: 200, dpp: 200, baris: { create: [{ barangId: sound.id, jumlah: 2, harga: 100, subtotal: 200, barisPesananId: r2.id }] } },
    });
    await harusDitolak("GUDANG menghapus faktur", () => sebagai("gudang", () => hapusDokumen("faktur", fId.id)), "tidak punya hak");
    await jalankan("hapus faktur jalur id", () => hapusDokumen("faktur", fId.id));
    const bacaBp = async (id: string) => D((await db.barisPesananPenjualan.findUniqueOrThrow({ where: { id } })).jumlahDifaktur).toFixed(2);
    const bacaSj = async (id: string) => D((await db.barisPengiriman.findUniqueOrThrow({ where: { id } })).jumlahDifaktur).toFixed(2);
    pastikan((await bacaBp(r2.id)) === "0.00" && (await bacaBp(r1.id)) === "2.00", "jalur id: jumlah difaktur baris pesanan kedua kembali, baris pertama (barang sama) utuh");
    pastikan((await bacaSj(s2.id)) === "0.00" && (await bacaSj(s1.id)) === "2.00", "jalur id: konsumsi SJ baris kedua kembali, baris SJ pertama utuh");
    // jalur lama (barisPesananId kosong): kode lama per barangId tetap berjalan
    await db.barisPesananPenjualan.update({ where: { id: r2.id }, data: { jumlahDifaktur: 2 } });
    await db.barisPengiriman.update({ where: { id: s2.id }, data: { jumlahDifaktur: 2 } });
    const fLama = await db.fakturPenjualan.create({ data: { nomor: `${AWALAN}-FJ15`, pelangganId: pelanggan.id, pesananId: psn.id, total: 100, dpp: 100, baris: { create: [{ barangId: sound.id, jumlah: 1, harga: 100, subtotal: 100 }] } } });
    await jalankan("hapus faktur jalur lama", () => hapusDokumen("faktur", fLama.id));
    pastikan(D(await bacaBp(r1.id)).plus(await bacaBp(r2.id)).toFixed(2) === "3.00" && D(await bacaSj(s1.id)).plus(await bacaSj(s2.id)).toFixed(2) === "3.00", "jalur lama: satu baris pesanan dan SJ berbarang sama dikurangi 1 (perilaku lama)");
    // rencana termin ikut terhapus bersama pesanan dan penawaran
    await db.barisPengiriman.deleteMany({ where: { pengirimanId: sj.id } });
    await db.pengirimanPesanan.delete({ where: { id: sj.id } });
    await db.rencanaTermin.create({ data: { pesananId: psn.id, no: 1, label: "DP", jumlah: 120, persen: 30 } });
    await db.rencanaTermin.create({ data: { pesananId: psn.id, no: 2, label: "Pelunasan", jumlah: 280, persen: 70 } });
    await harusDitolak("GUDANG menghapus pesanan", () => sebagai("gudang", () => hapusDokumen("pesanan", psn.id)), "tidak punya hak");
    await jalankan("hapus pesanan bertermin", () => hapusDokumen("pesanan", psn.id));
    pastikan((await db.pesananPenjualan.count({ where: { id: psn.id } })) === 0 && (await db.rencanaTermin.count({ where: { pesananId: psn.id } })) === 0, "hapus pesanan membuang rencana terminnya");
    const pnw = await db.penawaranPenjualan.create({ data: { nomor: `${AWALAN}-PNW1`, pelangganId: pelanggan.id, total: 400, rencanaTermin: { create: [{ no: 1, label: "DP", jumlah: 400, persen: 100 }] } } });
    await jalankan("hapus penawaran bertermin", () => hapusDokumen("penawaran", pnw.id));
    pastikan((await db.penawaranPenjualan.count({ where: { id: pnw.id } })) === 0 && (await db.rencanaTermin.count({ where: { penawaranId: pnw.id } })) === 0, "hapus penawaran membuang rencana terminnya");
    pastikan((await db.logAktivitas.count({ where: { aksi: "HAPUS", nomor: { startsWith: AWALAN } } })) === 5, "lima penghapusan tercatat di log (faktur ber-fee, dua faktur, pesanan, penawaran)");

    console.log("=== 8. Persetujuan bersamaan: satu jurnal dan satu nomor cetak (tinjauan P21 butir 1) ===");
    // kunci baris tiap jenis dokumen persetujuan berjalan (nama tabel benar); id fiktif tidak mengunci apa pun
    for (const jenis of Object.keys(BERKAS) as JenisPersetujuan[]) {
      const pesan = await galat(() => dalamTransaksiBatal((tx) => BERKAS[jenis].kunci(tx, "tidak-ada")));
      pastikan(pesan === "", `kunci baris ${jenis} berjalan ${pesan}`);
    }
    // dua aksi dijalankan serentak oleh pengguna yang sama (UJI_PENGGUNA berlaku untuk keduanya); galat revalidatePath
    // di luar HTTP terjadi sesudah transaksi selesai, jadi dianggap sukses seperti di jalankan()
    const sesudahCommit = async (k: () => Promise<unknown>) => {
      try {
        await k();
      } catch (e) {
        if (!String((e as Error)?.message ?? "").includes("static generation store missing")) throw e;
      }
    };
    const serentak = (nama: string, ...kerja: (() => Promise<unknown>)[]) => sebagai(nama, () => Promise.allSettled(kerja.map((k) => sesudahCommit(k))));
    const ditolakDengan = (h: PromiseSettledResult<unknown>[]) => h.filter((x): x is PromiseRejectedResult => x.status === "rejected").map((x) => (x.reason as Error).message);
    const jumlahJurnal = (nomor: string) => db.jurnal.count({ where: { keterangan: { contains: nomor } } });
    await db.formatNomor.create({ data: { perusahaanId: "utama", jenis: "faktur", pola: "UJIJP-{SEQ3}/{YYYY}", kunciDeret: "ujijp-faktur", reset: "TAHUNAN" } });
    const PUTARAN = 5;
    for (let i = 1; i <= PUTARAN; i++) {
      const f = await buatDraf(db, `${AWALAN}-FJ2${i}`, { diajukanOlehId: kasir.id });
      const h = await serentak("owner", () => setujuiDokumen("faktur", f.id), () => setujuiDokumen("faktur", f.id));
      const tolak = ditolakDengan(h);
      const akhir = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: f.id } });
      pastikan(tolak.length === 1 && tolak[0].includes("sudah disetujui"), `putaran ${i}: satu dari dua setujui serentak ditolak "sudah disetujui" ${JSON.stringify(tolak)}`);
      pastikan((await jumlahJurnal(f.nomor)) === 1 && akhir.jurnalId && akhir.statusPersetujuan === "DISETUJUI", `putaran ${i}: tepat satu jurnal faktur dan jurnalId menunjuknya`);
      pastikan(akhir.nomorCetak === `UJIJP-00${i}/${tahun}`, `putaran ${i}: nomor cetak ${akhir.nomorCetak} tidak tertimpa dan deret tanpa lubang`);
      pastikan((await db.logAktivitas.count({ where: { aksi: "SETUJUI", nomor: f.nomor } })) === 1, `putaran ${i}: log SETUJUI satu kali`);
    }
    const penghitungAkhir = await db.penghitungNomor.findMany({ where: { kunciDeret: "ujijp-faktur" } });
    pastikan(penghitungAkhir.length === 1 && penghitungAkhir[0].nilai === PUTARAN, `penghitung nomor faktur naik sekali per faktur (${penghitungAkhir[0]?.nilai})`);
    pastikan((await periksaSinkron(db)).seimbang, "periksaSinkron seimbang sesudah persetujuan serentak");

    // setujui dan tolak serentak: hasil akhirnya selalu konsisten (disetujui berjurnal, atau ditolak tanpa jurnal dan nomor)
    for (let i = 1; i <= 3; i++) {
      const f = await buatDraf(db, `${AWALAN}-FJ3${i}`, { diajukanOlehId: kasir.id });
      const h = await serentak("owner", () => setujuiDokumen("faktur", f.id), () => tolakDokumen("faktur", f.id, "Uji serentak"));
      const akhir = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: f.id } });
      const jurnalF = await jumlahJurnal(f.nomor);
      const konsisten =
        akhir.statusPersetujuan === "DISETUJUI" ? jurnalF === 1 && akhir.jurnalId !== null && akhir.catatanPenolakan === null : akhir.statusPersetujuan === "DITOLAK" && jurnalF === 0 && akhir.jurnalId === null && akhir.nomorCetak === null;
      pastikan(ditolakDengan(h).length === 1 && konsisten, `setujui dan tolak serentak ${i}: satu aksi menang, status ${akhir.statusPersetujuan} konsisten dengan jurnal (${jurnalF}) ${JSON.stringify(ditolakDengan(h))}`);
    }
    await db.formatNomor.deleteMany({ where: { kunciDeret: "ujijp-faktur" } });
    await db.penghitungNomor.deleteMany({ where: { kunciDeret: "ujijp-faktur" } });

    // Kas Masuk: ajukan ganda tercatat sekali, setujui ganda satu jurnal KM
    for (let i = 1; i <= 3; i++) {
      const nomor = `${AWALAN}-KM${i}`;
      const km = await db.dokumenKas.create({ data: { nomor, jenis: "MASUK", akunKasId: kKas, akunLawanId: m.pendapatanPenjualanId!, jumlah: 1_000 * i, keterangan: `Kas masuk uji ${nomor}`, dibuatOleh: "kasir" } });
      const hAju = await serentak("kasir", () => ajukanDokumen("dokumenKas", km.id), () => ajukanDokumen("dokumenKas", km.id));
      pastikan(ditolakDengan(hAju).length === 1 && (await db.logAktivitas.count({ where: { aksi: "AJUKAN", nomor } })) === 1, `kas masuk ${i}: ajukan serentak tercatat sekali ${JSON.stringify(ditolakDengan(hAju))}`);
      const hSetuju = await serentak("owner", () => setujuiDokumen("dokumenKas", km.id), () => setujuiDokumen("dokumenKas", km.id));
      const akhir = await db.dokumenKas.findUniqueOrThrow({ where: { id: km.id } });
      pastikan(
        ditolakDengan(hSetuju).length === 1 && (await jumlahJurnal(nomor)) === 1 && akhir.jurnalId && akhir.statusPersetujuan === "DISETUJUI",
        `kas masuk ${i}: setujui serentak menghasilkan satu jurnal KM ${JSON.stringify(ditolakDengan(hSetuju))}`,
      );
    }

    // P2002 nomor cetak lewat updateMany bersyarat (cara posting faktur menulis nomor) tetap diterjemahkan
    const p2002Bersyarat = await galat(() =>
      dalamTransaksiBatal(async (tx) => {
        await buatDraf(tx, `${AWALAN}-FJ40`, { nomorCetak: "UJIJP-GANDA" });
        const f = await buatDraf(tx, `${AWALAN}-FJ41`);
        await simpanNomorCetak("UJIJP-GANDA", () => tx.fakturPenjualan.updateMany({ where: { id: f.id, nomorCetak: null }, data: { nomorCetak: "UJIJP-GANDA" } }));
      }),
    );
    pastikan(p2002Bersyarat === "Nomor cetak UJIJP-GANDA sudah dipakai dokumen lain.", `P2002 nomor cetak dari updateMany diterjemahkan: ${p2002Bersyarat}`);

    console.log("=== 9. Basis kas: pemetaan fee yang bukan akun rinci Pendapatan memakai akun Pendapatan Penjualan ===");
    for (const [label, akunPeta] of [["akun Kewajiban", kPpnK], ["akun kelompok Pendapatan", k4000]] as const) {
      const hasil = await dalamTransaksiBatal(async (tx) => {
        await tx.pemetaanAkunTambahan.create({ data: { kunci: KUNCI_AKUN_FEE, label: "Pendapatan Fee Manajemen", dibuatOleh: "uji", akunId: akunPeta } });
        const kini = new Date();
        const periode = { dari: new Date(kini.getFullYear(), 0, 1), sampai: new Date(kini.getFullYear(), 11, 31, 23, 59, 59, 999), dariTeks: `${kini.getFullYear()}-01-01`, sampaiTeks: `${kini.getFullYear()}-12-31` };
        const klien = tx as unknown as typeof db;
        const sebelum = await labaRugiKas(klien, periode);
        // uang muka pesanan ber-fee tetap bisa dicatat walau pemetaan fee salah (jurnal UM tidak membaca akun fee)
        const pesanan = await tx.pesananPenjualan.create({
          data: {
            nomor: `${AWALAN}-PSN3`,
            pelangganId: pelanggan.id,
            total: 66_946_000,
            diskon: 890_000,
            fee: 6_086_000,
            baris: { create: [{ barangId: sound.id, jumlah: 1, harga: 2_000_000, frekuensi: 3 }, { barangId: kamar.id, jumlah: 25, harga: 650_000, frekuensi: 3 }, { barangId: jasa.id, jumlah: 1, harga: 7_000_000 }] },
          },
        });
        const um = await tx.uangMukaPelanggan.create({ data: { nomor: `${AWALAN}-UM2`, pelangganId: pelanggan.id, pesananId: pesanan.id, akunId: kKas, jumlah: 20_083_800 } });
        const jUm = await catatJurnalUangMuka(tx, um, pesanan.nomor);
        await tx.uangMukaPelanggan.update({ where: { id: um.id }, data: { jurnalId: jUm!.id } });
        const sesudah = await labaRugiKas(klien, periode);
        const perAkun = (l: Awaited<ReturnType<typeof labaRugiKas>>) => new Map<string, Desimal>(l.pendapatan.filter((x) => !x.kelompok).map((x) => [x.kode, D(x.jumlah)]));
        const a = perAkun(sebelum), b = perAkun(sesudah);
        const selisih = (kode: string) => (b.get(kode) ?? D(0)).minus(a.get(kode) ?? D(0)).toFixed(2);
        return { total: sesudah.totalPendapatan.minus(sebelum.totalPendapatan).toFixed(2), k4200: selisih("4-1200"), bawaan: selisih(kodePendapatan) };
      });
      // UM 30% dari total: seluruh 20.083.800 tetap pendapatan kas, termasuk bagian fee 1.825.800 di akun bawaan
      pastikan(hasil.total === "20083800.00" && D(hasil.k4200).plus(hasil.bawaan).toFixed(2) === "20083800.00", `pemetaan fee ${label}: kas uang muka utuh di pendapatan (${hasil.total}, kamar ${hasil.k4200}, bawaan ${hasil.bawaan})`);
    }
  } finally {
    await bersihkan();
    if (feeAwal) await db.pemetaanAkunTambahan.create({ data: feeAwal });
  }

  const feeAkhir = await db.pemetaanAkunTambahan.findUnique({ where: { kunci: KUNCI_AKUN_FEE } });
  pastikan(JSON.stringify(feeAkhir) === JSON.stringify(feeAwal), "pemetaan Pendapatan Fee Manajemen kembali seperti sebelum uji");
  pastikan((await db.jurnal.count()) === jurnalAwal, "jumlah jurnal sama dengan sebelum uji");
  pastikan((await db.hakAksesPeran.count()) === hakAwal, "HakAksesPeran tidak berubah");
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron seimbang dan sama dengan sebelum uji");
  console.log("=== DONE, all jurnal-penjualan checks passed ===");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
