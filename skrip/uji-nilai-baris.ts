import "dotenv/config";
// Skrip ini memanggil pustaka di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { D, uang, type Desimal } from "../src/lib/uang";
import { hitungPpn } from "../src/lib/pengaturanPerusahaan";
import { penggunaSaatIni } from "../src/lib/otentikasi";
import * as nilaiBarisAsli from "../src/lib/nilaiBaris";
import {
  KOLOM_SALIN_BARIS,
  KOLOM_SALIN_PENAWARAN_KE_PESANAN,
  KOLOM_TAMPILAN,
  KOLOM_TEKS_FAKTUR,
  KOLOM_TEKS_PENAWARAN,
  SEKSI_BAWAAN,
  TEKS_PEMBUKA_BAWAAN,
  bacaBarisDokumen,
  bacaBarisFaktur,
  bacaBarisRetur,
  bacaBarisTampilan,
  bacaBerlakuSampai,
  bacaDiskonFaktur,
  bacaIsianTampilan,
  bacaJatuhTempo,
  bacaJenisNilai,
  bacaModeDokumen,
  bacaNilaiAddOn,
  bacaRingkasanDokumen,
  bacaTampilanEvent,
  bacaTeksDokumen,
  catatLogPenjualan,
  diskonWarisan,
  feeFaktur,
  hitungDiskon,
  hitungFee,
  konteksProrata,
  nilaiBaris,
  nilaiRetur,
  pastikanHakBarisBebas,
  pastikanKopSuratDokumen,
  rapikanDaftarSeksi,
  ringkasPerubahan,
  ringkasanDokumen,
  ringkasanFaktur,
  salinKolom,
  siapkanBarisFaktur,
  siapkanBarisRetur,
  sisaReturPerBaris,
  subtotalBaris,
  subtotalDokumen,
  subtotalFaktur,
  uraiBarisDokumen,
  type BarisPesananSumber,
  type PesananSumber,
} from "../src/lib/dokumenPenjualan";
import {
  bacaRencanaTermin,
  brutoButir,
  brutoRencana,
  hitungProgresTermin,
  kunciButirTermin,
  nilaiBrutoKontrak,
  pastikanBatalTagihanTermin,
  pastikanPembayaranTermin,
  pastikanRencanaPesananBolehDiubah,
  pastikanTagihanBolehDibatalkan,
  periksaBatasTermin,
  progresTermin,
  salinButirKePesanan,
  selesaikanRencana,
} from "../src/lib/rencanaTermin";
import { uraiTeksBerbutir } from "../src/lib/teksBerbutir";
import { KODE_BARANG_LAIN, isiBarangLainLain, pastikanBarangLainLain } from "../src/lib/barangLainLain";
import { nilaiBarisKlien, pratinjauTerminKlien, ringkasanDokumenKlien, subtotalKlien } from "../src/lib/hitungDokumenKlien";
import { formulir, harusDitolak, pastikan } from "./bantuan";

/*
 * Uji pustaka dokumen penjualan (P20, D2 §9.2 uji-nilai-baris kasus 3 sampai 8 dan 11; kasus 1, 2, 9, 10 ada di
 * uji-pustaka-bersama P08):
 * - angka contoh D'Pro (proposal 12 baris, invoice ber-fee) dan HKA (Nawasena, Evoked, standar) lewat bacaBarisDokumen,
 *   ringkasanDokumen, dan ringkasanFaktur; penolakan diskon dan fee; prorata fee dan diskon nominal antar faktur;
 *   rencana termin; uraiTeksBerbutir;
 * - pembantu lain P20: baca baris (baris bebas, mode STANDAR dan EVENT, batas), teks dokumen dan warisan, enum, tanggal,
 *   jalur ID dan jalur lama faktur dan retur, nilai retur ber-fee, daftar putih tampilan, kolom konversi, seksi;
 * - pratinjau klien (hitungDokumenKlien) sama dengan server; berkas klien tanpa impor; akuntansi.ts tidak mengimpor
 *   dokumenPenjualan.ts (L1);
 * - fungsi berbasis data (Barang JASA-LAIN, kop surat, batas dan progres termin, log penjualan) di transaksi yang
 *   selalu dibatalkan, jadi suite ini tidak meninggalkan data.
 */

const NOL = D(0);
const teks = (d: Desimal) => d.toFixed(2);
const sama = (d: Desimal, harap: string | number) => d.equals(D(harap));

/** Penanda pembatalan transaksi uji. */
class Batal extends Error {}

/** Menjalankan fn di transaksi yang selalu dibatalkan di akhir. */
async function diTransaksiBatal(fn: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<void>) {
  try {
    await db.$transaction(async (tx) => {
      await fn(tx);
      throw new Batal();
    }, { timeout: 30_000 });
  } catch (e) {
    if (!(e instanceof Batal)) throw e;
  }
}

/** Generator angka acak berbenih (mulberry32), supaya uji acak bisa diulang. */
function acak(benih: number) {
  let a = benih >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Baris pesanan sumber untuk pembantu faktur. */
function barisPesanan(id: string, barangId: string, jumlah: number, harga: number, lain: Partial<BarisPesananSumber> = {}): BarisPesananSumber {
  return { id, barangId, jumlah, jumlahDifaktur: 0, harga, frekuensi: 1, satuanFrekuensi: null, bagian: null, urutan: 0, nama: null, deskripsi: null, satuan: null, keterangan: null, ...lain };
}

async function main() {
  console.log("=== 0. Ekspor ulang nilaiBaris (DESAIN §3.1) ===");
  pastikan(nilaiBaris === nilaiBarisAsli.nilaiBaris && subtotalBaris === nilaiBarisAsli.subtotalBaris, "dokumenPenjualan mengekspor ulang nilaiBaris dan subtotalBaris dari nilaiBaris.ts (fungsi yang sama)");

  console.log("=== 1. Proposal D'Pro (D2 §9.2 kasus 3) ===");
  // spec/10 §4.3: proposal 064/DPRO/P1/VIII/2026, 12 baris persis, baris 3 frekuensi 5
  const proposal = [
    [25, 3, 650_000, "Akomodasi"],
    [3, 3, 550_000, "Akomodasi"],
    [53, 5, 60_000, "Konsumsi"],
    [55, 6, 15_000, "Konsumsi"],
    [1, 4, 3_500_000, "Transportasi"],
    [1, 4, 1_300_000, "Transportasi"],
    [53, 1, 250_000, "Produksi"],
    [1, 1, 7_000_000, "Venue"],
    [1, 1, 12_000_000, "Produksi"],
    [53, 1, 130_000, "Produksi"],
    [53, 1, 125_000, "Produksi"],
    [1, 1, 20_000_000, "Talent / Artis"],
  ].map(([jumlah, frekuensi, harga, bagian], i) => ({ nama: `Item ${i + 1}`, jumlah, frekuensi, satuanFrekuensi: "hari", harga, bagian }));
  const barisProposal = bacaBarisDokumen(formulir({ baris: proposal }), { mode: "EVENT" });
  pastikan(barisProposal.length === 12 && barisProposal.every((b, i) => b.barangId === null && b.urutan === i), "12 baris bebas terbaca berurutan 0-11 dengan barangId null");
  pastikan(teks(subtotalBaris(barisProposal)) === "159515000.00", "proposal D'Pro: subtotal 159.515.000");
  const rProposal = ringkasanDokumen({ subtotal: subtotalBaris(barisProposal), jenisDiskon: "NOMINAL", nilaiDiskon: D(890_000), jenisFee: "PERSEN", nilaiFee: NOL, dokumen: "penawaran" });
  pastikan(teks(rProposal.diskon) === "890000.00" && teks(rProposal.total) === "158625000.00" && rProposal.fee.isZero(), "proposal D'Pro: diskon 890.000, total 158.625.000");
  const addOn = bacaNilaiAddOn("3625000");
  pastikan(addOn !== null && teks(addOn) === "3625000.00", "add on 3.625.000 terbaca");
  const rLewatFormulir = bacaRingkasanDokumen(formulir({ jenisDiskon: "NOMINAL", nilaiDiskon: 890_000, nilaiAddOn: 3_625_000 }), barisProposal, "penawaran");
  pastikan(teks(rLewatFormulir.total) === "158625000.00", "add on tidak mengubah total (158.625.000)");
  pastikan(subtotalDokumen(rProposal).equals(rProposal.subtotal), "identitas subtotal = total + diskon - fee");

  console.log("=== 2. Invoice D'Pro dengan management fee (kasus 4) ===");
  const invoice = [29_990_900, 5_850_000, 7_815_000, 5_400_000, 24_110_700].map((harga, i) => ({ nama: `Biaya ${i + 1}`, jumlah: 1, harga, frekuensi: 3, bagian: "abaikan" }));
  const barisInvoice = bacaBarisDokumen(formulir({ baris: invoice }), { mode: "STANDAR" });
  pastikan(barisInvoice.every((b) => b.frekuensi.equals(1) && b.bagian === null && b.satuanFrekuensi === null), "mode STANDAR memaksa frekuensi 1 dan mengosongkan seksi tanpa galat");
  pastikan(teks(subtotalBaris(barisInvoice)) === "73166600.00", "invoice D'Pro: subtotal 73.166.600");
  const feePersen = ringkasanDokumen({ subtotal: subtotalBaris(barisInvoice), jenisDiskon: "NOMINAL", nilaiDiskon: NOL, jenisFee: "PERSEN", nilaiFee: D(10), dokumen: "pesanan" });
  const feeNominal = ringkasanDokumen({ subtotal: subtotalBaris(barisInvoice), jenisDiskon: "NOMINAL", nilaiDiskon: NOL, jenisFee: "NOMINAL", nilaiFee: D(7_316_660), dokumen: "pesanan" });
  pastikan(teks(feePersen.fee) === "7316660.00" && teks(feePersen.total) === "80483260.00", "fee PERSEN 10: 7.316.660, total 80.483.260");
  pastikan(teks(feeNominal.fee) === "7316660.00" && teks(feeNominal.total) === "80483260.00", "fee NOMINAL 7.316.660: total 80.483.260");
  pastikan(subtotalDokumen(feePersen).equals(D(73_166_600)), "identitas subtotal dokumen ber-fee");

  console.log("=== 3. Contoh HKA (kasus 5) ===");
  // spec/02 §4 hanya memuat subtotal; rincian baris di bawah rekaan yang berjumlah sama (lihat P08 penyimpangan 3)
  const nawasena = bacaBarisDokumen(
    formulir({ baris: [{ nama: "Panggung", jumlah: 1, harga: 25_000_000 }, { nama: "Kru", jumlah: 10, frekuensi: 2, harga: 750_000 }, { nama: "Konsumsi", jumlah: 100, frekuensi: 3, harga: 50_000 }, { nama: "Sound", jumlah: 1, harga: 10_500_000 }] }),
    { mode: "EVENT" },
  );
  const rNawasena = ringkasanDokumen({ subtotal: subtotalBaris(nawasena), jenisDiskon: "NOMINAL", nilaiDiskon: NOL, jenisFee: "PERSEN", nilaiFee: D(10), dokumen: "penawaran" });
  const fNawasena = ringkasanFaktur({ subtotal: rNawasena.subtotal, diskon: rNawasena.diskon, fee: rNawasena.fee, ppnPersen: D(11) });
  pastikan(teks(rNawasena.subtotal) === "65500000.00" && teks(rNawasena.fee) === "6550000.00" && teks(fNawasena.ppn) === "7925500.00" && teks(fNawasena.total) === "79975500.00", "HKA Nawasena: 65.500.000, fee 6.550.000, PPN 7.925.500, total 79.975.500");
  const evoked = bacaBarisDokumen(formulir({ baris: [{ nama: "Konsep", jumlah: 1, harga: 10_000_000 }, { nama: "Talent", jumlah: 5, frekuensi: 3, harga: 500_000 }, { nama: "Lain", jumlah: 1, harga: 635_000 }] }), { mode: "EVENT" });
  const rEvoked = ringkasanDokumen({ subtotal: subtotalBaris(evoked), jenisDiskon: "NOMINAL", nilaiDiskon: NOL, jenisFee: "PERSEN", nilaiFee: D(10), dokumen: "penawaran" });
  pastikan(teks(rEvoked.subtotal) === "18135000.00" && teks(rEvoked.fee) === "1813500.00" && teks(rEvoked.total) === "19948500.00", "HKA Evoked: 18.135.000 + fee 1.813.500 = 19.948.500");
  const standar = bacaBarisDokumen(formulir({ baris: [{ barangId: "brg-standar", jumlah: 2, harga: 900_000 }] }), { mode: "STANDAR" });
  const rStandar = ringkasanDokumen({ subtotal: subtotalBaris(standar), jenisDiskon: "PERSEN", nilaiDiskon: D(5), jenisFee: "PERSEN", nilaiFee: NOL, dokumen: "penawaran" });
  const fStandar = ringkasanFaktur({ subtotal: rStandar.subtotal, diskon: rStandar.diskon, fee: rStandar.fee, ppnPersen: D(11) });
  pastikan(teks(rStandar.diskon) === "90000.00" && teks(fStandar.ppn) === "188100.00" && teks(fStandar.total) === "1898100.00", "HKA standar: 2 x 900.000, diskon 5% = 90.000, PPN 188.100, total 1.898.100");
  // angka uji-dokumen-event (D2 §4.1): sound 2 x 3 hari x 1.000.000, kamar 25 x 3 x 650.000, dokumentasi 7.000.000
  const rEvent = ringkasanDokumen({ subtotal: D(61_750_000), jenisDiskon: "NOMINAL", nilaiDiskon: D(890_000), jenisFee: "PERSEN", nilaiFee: D(10), dokumen: "penawaran" });
  pastikan(teks(rEvent.fee) === "6086000.00" && teks(rEvent.total) === "66946000.00", "contoh D2 §4.1: fee 10% dari subtotal setelah diskon = 6.086.000, total 66.946.000");

  console.log("=== 4. Penolakan diskon dan fee (kasus 6) ===");
  await harusDitolak("diskon PERSEN 101", async () => hitungDiskon(D(1000), "PERSEN", D(101)), "Persen diskon tidak boleh lebih dari 100");
  await harusDitolak("diskon negatif", async () => hitungDiskon(D(1000), "NOMINAL", D(-1)), "Diskon tidak boleh negatif");
  await harusDitolak("fee PERSEN 100,01", async () => hitungFee(D(1000), "PERSEN", D("100.01")), "Persen management fee tidak boleh lebih dari 100");
  await harusDitolak("fee negatif", async () => hitungFee(D(1000), "NOMINAL", D(-5)), "Management fee tidak boleh negatif");
  await harusDitolak("fee nominal di atas 1e14", async () => hitungFee(D(1000), "NOMINAL", D("100000000000001")), "Management fee terlalu besar");
  await harusDitolak("diskon melebihi subtotal penawaran", async () => ringkasanDokumen({ subtotal: D(1000), jenisDiskon: "NOMINAL", nilaiDiskon: D(1001), jenisFee: "PERSEN", nilaiFee: NOL, dokumen: "penawaran" }), "melebihi subtotal penawaran");
  await harusDitolak("diskon melebihi subtotal pesanan", async () => ringkasanDokumen({ subtotal: D(1000), jenisDiskon: "NOMINAL", nilaiDiskon: D(1001), jenisFee: "PERSEN", nilaiFee: NOL, dokumen: "pesanan" }), "melebihi subtotal pesanan");
  pastikan(hitungDiskon(D(1000), "PERSEN", D(100)).equals(1000) && hitungFee(D(1000), "PERSEN", D(100)).equals(1000), "batas 100 persen tepat masih diterima");
  await harusDitolak("jenis diskon tidak dikenal", async () => bacaJenisNilai("SEBAGIAN", "diskon"), "Jenis diskon tidak dikenal");
  await harusDitolak("jenis fee tidak dikenal", async () => bacaJenisNilai("x", "fee"), "Jenis management fee tidak dikenal");
  pastikan(bacaJenisNilai("", "diskon") === "NOMINAL" && bacaJenisNilai(null, "fee") === "PERSEN", "jenis kosong memakai bawaan skema (diskon NOMINAL, fee PERSEN)");
  await harusDitolak("nilai diskon bukan angka", async () => bacaRingkasanDokumen(formulir({ nilaiDiskon: "abc" }), barisInvoice, "penawaran"), "Diskon tidak valid");
  await harusDitolak("add on negatif", async () => bacaNilaiAddOn("-1"), "Add on tidak boleh negatif");
  pastikan(bacaNilaiAddOn("") === null && bacaNilaiAddOn(null) === null, "add on kosong = null");

  console.log("=== 5. Prorata diskon dan fee faktur (kasus 7) ===");
  const pesananFee: PesananSumber = {
    mode: "STANDAR",
    baris: [barisPesanan("bp1", "brg-a", 10, 7_316_660)],
    jenisDiskon: "NOMINAL",
    nilaiDiskon: 7_316_660,
    diskon: 7_316_660,
    jenisFee: "NOMINAL",
    nilaiFee: 7_316_660,
    fee: 7_316_660,
    faktur: [],
  };
  const f1 = siapkanBarisFaktur(pesananFee, { jalur: "ID", baris: [{ barisPesananId: "bp1", jumlah: D(4) }] });
  const sub1 = subtotalBaris(f1);
  const ctx1 = konteksProrata(pesananFee, f1);
  pastikan(!ctx1.menutup && teks(ctx1.subtotalPesanan) === "73166600.00" && sama(sub1, "29266640"), "faktur 1 = 40% subtotal pesanan, belum menutup");
  const fee1 = feeFaktur(pesananFee, sub1, NOL, ctx1);
  const diskon1 = diskonWarisan(pesananFee, sub1, ctx1);
  pastikan(teks(fee1) === "2926664.00" && teks(diskon1) === "2926664.00", "faktur 1: fee dan diskon nominal prorata 2.926.664");
  const pesananFee2 = { ...pesananFee, baris: [barisPesanan("bp1", "brg-a", 10, 7_316_660, { jumlahDifaktur: 4 })], faktur: [{ fee: fee1, diskon: diskon1 }] };
  const f2 = siapkanBarisFaktur(pesananFee2, { jalur: "ID", baris: [{ barisPesananId: "bp1", jumlah: D(6) }] });
  const ctx2 = konteksProrata(pesananFee2, f2);
  const fee2 = feeFaktur(pesananFee2, subtotalBaris(f2), NOL, ctx2);
  const diskon2 = diskonWarisan(pesananFee2, subtotalBaris(f2), ctx2);
  pastikan(ctx2.menutup && teks(fee2) === "4389996.00" && teks(diskon2) === "4389996.00", "faktur 2 (menutup) mengambil sisa 4.389.996");
  pastikan(teks(fee1.plus(fee2)) === "7316660.00", "jumlah fee dua faktur tepat 7.316.660");
  const pesananPersen: PesananSumber = { ...pesananFee, jenisFee: "PERSEN", nilaiFee: 10, fee: 7_316_660, jenisDiskon: "PERSEN", nilaiDiskon: 5, diskon: 3_658_330 };
  const dPersen = diskonWarisan(pesananPersen, sub1, ctx1);
  pastikan(teks(dPersen) === "1463332.00" && teks(feeFaktur(pesananPersen, sub1, dPersen, ctx1)) === "2780330.80", "PERSEN dihitung dari subtotal faktur: diskon 5% = 1.463.332, fee 10% dari subtotal setelah diskon = 2.780.330,80");
  pastikan(feeFaktur({ jenisFee: "PERSEN", nilaiFee: 0, fee: 0 }, D(5000), NOL, ctx1).isZero() && diskonWarisan({ jenisDiskon: "NOMINAL", nilaiDiskon: 0, diskon: 0 }, D(5000), ctx1).isZero(), "pesanan lama (fee dan diskon 0) menghasilkan 0");
  // fee nominal tidak pernah melebihi sisa walau prorata lebih besar
  const pesananSisaKecil = { ...pesananFee, faktur: [{ fee: 7_000_000, diskon: 0 }] };
  pastikan(teks(feeFaktur(pesananSisaKecil, sub1, NOL, konteksProrata(pesananSisaKecil, f1))) === "316660.00", "fee nominal dibatasi sisa fee pesanan");
  // bacaDiskonFaktur: jalur a, b, c dan pesan lama
  const da = bacaDiskonFaktur(formulir({ jenisDiskon: "PERSEN", nilaiDiskon: 10 }), sub1, pesananFee, ctx1);
  pastikan(da.jenisDiskon === "PERSEN" && sama(da.nilaiDiskon, 10) && teks(da.diskon) === "2926664.00", "diskon faktur jalur a: jenisDiskon dan nilaiDiskon dari formulir");
  const db_ = bacaDiskonFaktur(formulir({ diskon: "15000" }), sub1, pesananFee, ctx1);
  pastikan(db_.jenisDiskon === "NOMINAL" && sama(db_.diskon, 15000) && sama(db_.nilaiDiskon, 15000), "diskon faktur jalur b: isian lama diskon nominal (uji-diskon)");
  const dc = bacaDiskonFaktur(formulir({}), sub1, pesananPersen, ctx1);
  pastikan(dc.jenisDiskon === "PERSEN" && sama(dc.nilaiDiskon, 5) && teks(dc.diskon) === "1463332.00", "diskon faktur jalur c: warisan pesanan PERSEN");
  const dcNominal = bacaDiskonFaktur(formulir({ diskon: "" }), sub1, pesananFee, ctx1);
  pastikan(dcNominal.jenisDiskon === "NOMINAL" && teks(dcNominal.nilaiDiskon) === "2926664.00", "diskon faktur jalur c nominal: nilaiDiskon = diskon hasil prorata");
  await harusDitolak("diskon faktur melebihi subtotal", async () => bacaDiskonFaktur(formulir({ diskon: "99999999" }), sub1, pesananFee, ctx1), "melebihi subtotal faktur");
  await harusDitolak("diskon faktur negatif (jalur lama)", async () => bacaDiskonFaktur(formulir({ diskon: "-1" }), sub1, pesananFee, ctx1), "Diskon tidak boleh negatif");

  console.log("=== 6. Rencana termin (kasus 8) ===");
  const termin = selesaikanRencana([{ label: "DP", mode: "PERSEN", nilai: 30 }, { label: "", mode: "PERSEN", nilai: 40 }, { label: "Pelunasan", mode: "PERSEN", nilai: 0 }], D(10_000_000));
  pastikan(termin.map((b) => teks(b.jumlah)).join() === "3000000.00,4000000.00,3000000.00", "DPP 10.000.000: 3.000.000 / 4.000.000 / 3.000.000");
  pastikan(termin.map((b) => b.label).join() === "DP,Termin 2,Pelunasan" && termin.map((b) => teks(b.persen)).join() === "30.00,40.00,30.00" && termin.map((b) => b.no).join() === "1,2,3", "label kosong jadi Termin 2, persen 30/40/30, nomor 1-3");
  const terminNominal = selesaikanRencana([{ label: "DP", mode: "NOMINAL", nilai: 2_500_000 }, { label: "Sisa", mode: "NOMINAL", nilai: 0 }], D(10_000_000));
  pastikan(terminNominal.map((b) => teks(b.jumlah)).join() === "2500000.00,7500000.00" && teks(terminNominal[0].persen) === "25.00", "NOMINAL 2.500.000 + sisa 7.500.000");
  const terminEvent = selesaikanRencana([{ label: "DP", mode: "PERSEN", nilai: 30, jatuhTempo: "2026-12-01" }, { label: "Pelunasan" }], rEvent.total);
  pastikan(terminEvent.map((b) => teks(b.jumlah)).join() === "20083800.00,46862200.00" && terminEvent[0].jatuhTempo?.getDate() === 1 && terminEvent[1].jatuhTempo === null, "contoh D2 §4.1: DP 30% = 20.083.800, pelunasan 46.862.200, jatuh tempo terbaca");
  pastikan(selesaikanRencana([], D(0)).length === 0, "rencana kosong = tanpa termin (basis 0 tidak diperiksa)");
  pastikan(selesaikanRencana([{ label: "Lunas", mode: "PERSEN", nilai: 50 }], D(1000))[0].jumlah.equals(1000), "satu butir selalu menutup seluruh basis");
  await harusDitolak("5 butir termin", async () => selesaikanRencana([{}, {}, {}, {}, {}], D(1000)), "Rencana termin maksimal 4 butir");
  await harusDitolak("[100%, sisa]", async () => selesaikanRencana([{ mode: "PERSEN", nilai: 100 }, { label: "Sisa" }], D(1000)), "Termin sebelumnya sudah menutup seluruh nilai kontrak");
  await harusDitolak("[70%, 50%, sisa]", async () => selesaikanRencana([{ mode: "PERSEN", nilai: 70 }, { mode: "PERSEN", nilai: 50 }, {}], D(1000)), "sudah menutup seluruh nilai kontrak");
  await harusDitolak("[0%, sisa]", async () => selesaikanRencana([{ mode: "PERSEN", nilai: 0 }, {}], D(1000)), "Termin 1 harus lebih dari nol");
  await harusDitolak("basis 0", async () => selesaikanRencana([{ mode: "PERSEN", nilai: 30 }, {}], D(0)), "Rencana termin butuh nilai kontrak di atas nol");
  await harusDitolak("persen 101", async () => selesaikanRencana([{ mode: "PERSEN", nilai: 101 }, {}], D(1000)), "Persen termin 1 tidak boleh lebih dari 100");
  await harusDitolak("label 41 karakter", async () => selesaikanRencana([{ label: "x".repeat(41), nilai: 10 }, {}], D(1000)), "Label termin maksimal 40 karakter");
  pastikan(selesaikanRencana([{ label: "x".repeat(40), nilai: 10 }, {}], D(1000))[0].label.length === 40, "label 40 karakter diterima");
  await harusDitolak("nilai termin terlalu besar", async () => selesaikanRencana([{ mode: "NOMINAL", nilai: "100000000000001" }, {}], D(1000)), "Nilai termin terlalu besar");
  await harusDitolak("nilai termin negatif", async () => selesaikanRencana([{ mode: "NOMINAL", nilai: -5 }, {}], D(1000)), "Nilai termin 1 tidak boleh negatif");
  await harusDitolak("mode termin tidak dikenal", async () => selesaikanRencana([{ mode: "SEBAGIAN", nilai: 5 }, {}], D(1000)), "Mode termin 1 tidak dikenal");
  await harusDitolak("jatuh tempo termin salah", async () => selesaikanRencana([{ nilai: 30, jatuhTempo: "2026-02-30" }, {}], D(1000)), "Jatuh tempo termin 1 tidak valid");
  await harusDitolak("rencana termin bukan JSON", async () => bacaRencanaTermin(formulir({ rencanaTermin: "{bukan" })), "Format rencana termin tidak valid");
  await harusDitolak("rencana termin bukan larik objek", async () => bacaRencanaTermin(formulir({ rencanaTermin: "[1,2]" })), "Format rencana termin tidak valid");
  pastikan(bacaRencanaTermin(formulir({})).length === 0 && bacaRencanaTermin(formulir({ rencanaTermin: "[]" })).length === 0, "rencana termin tidak diisi atau [] = tanpa termin");
  pastikan(bacaRencanaTermin(formulir({ rencanaTermin: [{ label: "DP", mode: "PERSEN", nilai: 30 }, {}] })).length === 2, "rencana termin JSON terbaca");
  pastikan(teks(brutoButir(D(3_000_000), D(11))) === "3330000.00" && teks(brutoButir(D(3_000_000), NOL)) === "3000000.00", "nilai termin termasuk PPN: 3.000.000 + 11% = 3.330.000; non-PKP sama");
  const salinan = salinButirKePesanan(termin.map((b) => ({ ...b, perusahaanId: "utama" })).reverse());
  pastikan(salinan.map((b) => b.no).join() === "1,2,3" && salinan.every((b) => b.nomorCetak === null && b.ditagihPada === null) && sama(salinan[1].jumlah, 4_000_000), "konversi menyalin butir urut nomor, tanpa nomor cetak dan tanggal tagih");
  await harusDitolak("ubah rencana pesanan sesudah ditagih", async () => pastikanRencanaPesananBolehDiubah([{ label: "DP", ditagihPada: new Date(), jumlahUangMuka: 0 }]), "Termin DP sudah ditagih atau dibayar");
  await harusDitolak("ubah rencana pesanan sesudah dibayar", async () => pastikanRencanaPesananBolehDiubah([{ label: "DP", ditagihPada: null, jumlahUangMuka: 0 }, { label: "T2", ditagihPada: null, jumlahUangMuka: 1 }]), "Termin T2 sudah ditagih atau dibayar");
  pastikanRencanaPesananBolehDiubah([{ label: "DP", ditagihPada: null, jumlahUangMuka: 0 }]);
  await harusDitolak("batalkan tagihan yang sudah dibayar", async () => pastikanTagihanBolehDibatalkan({ label: "DP", jumlahUangMuka: 1 }), "Termin DP sudah dibayar; hapus uang mukanya dulu");
  // rencana [DP 3.000.000, Pelunasan 7.000.000]: DP bukan butir terakhir, jadi bruto = 3.000.000 + PPN
  const rencanaUji = [{ no: 1, jumlah: 3_000_000 }, { no: 2, jumlah: 7_000_000 }];
  const batas = periksaBatasTermin({ butir: { pesananId: "p1", no: 1, label: "DP" }, rencana: rencanaUji, pesananId: "p1", ppnPersen: 11, sudahDibayar: 3_000_000, jumlahBaru: 330_000 });
  pastikan(teks(batas.bruto) === "3330000.00" && teks(batas.sisa) === "330000.00", "batas termin: sisa bruto 330.000 boleh dibayar tepat");
  await harusDitolak("bayar melebihi nilai termin", async () => periksaBatasTermin({ butir: { pesananId: "p1", no: 1, label: "DP" }, rencana: rencanaUji, pesananId: "p1", ppnPersen: 11, sudahDibayar: 3_000_000, jumlahBaru: "330000.01" }), "Pembayaran melebihi nilai termin DP (sisa 330.000)");
  await harusDitolak("termin milik pesanan lain", async () => periksaBatasTermin({ butir: { pesananId: "p2", no: 1, label: "DP" }, rencana: rencanaUji, pesananId: "p1", ppnPersen: 0, sudahDibayar: 0, jumlahBaru: 1 }), "Termin tidak ditemukan di pesanan ini");
  await harusDitolak("termin penawaran (tanpa pesanan)", async () => periksaBatasTermin({ butir: { pesananId: null, no: 1, label: "DP" }, rencana: rencanaUji, pesananId: "p1", ppnPersen: 0, sudahDibayar: 0, jumlahBaru: 1 }), "Termin tidak ditemukan di pesanan ini");
  // progres murni: termin 1 lunas, termin 2 ditagih, termin 3 lewat jatuh tempo; UM tanpa termin dan penerimaan faktur
  const hariIni = new Date("2026-11-11T05:00:00Z");
  const progres = hitungProgresTermin(
    {
      total: 10_000_000,
      ppnPersen: 0,
      butir: [
        { id: "t3", no: 3, label: "Pelunasan", jumlah: 3_000_000, persen: 30, jatuhTempo: new Date("2026-11-10T05:00:00Z"), ditagihPada: null, nomorCetak: null },
        { id: "t1", no: 1, label: "DP", jumlah: 3_000_000, persen: 30, jatuhTempo: new Date("2026-11-01T05:00:00Z"), ditagihPada: new Date(), nomorCetak: "001/TGH" },
        { id: "t2", no: 2, label: "Termin 2", jumlah: 4_000_000, persen: 40, jatuhTempo: new Date("2026-11-11T05:00:00Z"), ditagihPada: new Date(), nomorCetak: null },
      ],
      uangMuka: [{ jumlah: 3_000_000, rencanaTerminId: "t1" }, { jumlah: 1_000_000, rencanaTerminId: null }, { jumlah: 500_000, rencanaTerminId: "t2" }],
      penerimaan: [{ jumlah: 900_000, potonganPajak: 100_000 }],
    },
    hariIni,
  );
  pastikan(progres.butir.map((b) => b.no).join() === "1,2,3", "progres urut nomor butir");
  pastikan(progres.butir.map((b) => b.status).join() === "Lunas,Dibayar sebagian,Belum ditagih", "status butir: Lunas, Dibayar sebagian, Belum ditagih");
  pastikan(!progres.butir[0].lewatJatuhTempo && !progres.butir[1].lewatJatuhTempo && progres.butir[2].lewatJatuhTempo, "lewat jatuh tempo hanya butir bersisa dengan jatuh tempo sebelum hari ini (bukan hari ini)");
  pastikan(sama(progres.dpTanpaTermin, 1_000_000) && sama(progres.totalDiterima, 5_500_000) && sama(progres.belumDibayar, 4_500_000) && sama(progres.butir[1].sisa, 3_500_000), "dpTanpaTermin 1.000.000, totalDiterima 5.500.000 (UM + penerimaan + potongan pajak), belumDibayar 4.500.000");
  const progresDitagih = hitungProgresTermin({ total: 1000, ppnPersen: 11, butir: [{ id: "a", no: 1, label: "A", jumlah: 1000, persen: 100, jatuhTempo: null, ditagihPada: new Date(), nomorCetak: null }], uangMuka: [], penerimaan: [] }, hariIni);
  pastikan(progresDitagih.butir[0].status === "Ditagih" && sama(progresDitagih.nilaiKontrakBruto, 1110) && sama(progresDitagih.butir[0].bruto, 1110), "butir ditagih tanpa bayar berstatus Ditagih; nilai kontrak bruto termasuk PPN");

  console.log("=== 7. uraiTeksBerbutir (kasus 11) ===");
  const urai = uraiTeksBerbutir("- a\n-- b\n**c** d\n\n**-e**");
  pastikan(
    JSON.stringify(urai) ===
      JSON.stringify([
        { jenis: "butir", isi: [{ teks: "a", tebal: false }] },
        { jenis: "subbutir", isi: [{ teks: "b", tebal: false }] },
        { jenis: "paragraf", isi: [{ teks: "c", tebal: true }, { teks: " d", tebal: false }] },
        { jenis: "subbutir", isi: [{ teks: "e", tebal: true }] },
      ]),
    "butir, sub-butir, paragraf dengan potongan tebal, sub-butir tebal; baris kosong dibuang",
  );
  pastikan(JSON.stringify(uraiTeksBerbutir("-- **x**")) === JSON.stringify([{ jenis: "subbutir", isi: [{ teks: "x", tebal: true }] }]), "-- **x** tetap tebal (beda yang disengaja dengan HKA)");
  pastikan(JSON.stringify(uraiTeksBerbutir("<b>x</b>")) === JSON.stringify([{ jenis: "paragraf", isi: [{ teks: "<b>x</b>", tebal: false }] }]), "markup mentah tetap teks biasa");
  pastikan(JSON.stringify(uraiTeksBerbutir("• satu\r\n  - dua  ")) === JSON.stringify([{ jenis: "butir", isi: [{ teks: "satu", tebal: false }] }, { jenis: "butir", isi: [{ teks: "dua", tebal: false }] }]), "awalan • dan CRLF; baris dipangkas");
  pastikan(JSON.stringify(uraiTeksBerbutir("a **b** c **d")) === JSON.stringify([{ jenis: "paragraf", isi: [{ teks: "a ", tebal: false }, { teks: "b", tebal: true }, { teks: " c **d", tebal: false }] }]), "tebal tidak serakah; ** tanpa pasangan tetap teks");
  pastikan(uraiTeksBerbutir(null).length === 0 && uraiTeksBerbutir("\n \n").length === 0 && uraiTeksBerbutir("-").length === 0, "teks kosong, spasi, atau awalan tanpa isi = tanpa baris");

  console.log("=== 8. bacaBarisDokumen: baris bebas, mode, batas ===");
  const campur = bacaBarisDokumen(
    formulir({
      baris: [
        { barangId: "brg-1", jumlah: 2, harga: 100_000, frekuensi: 3, satuanFrekuensi: "hari", bagian: "  Hari   1 ", nama: "Sound", deskripsi: "a\r\nb" },
        { jumlah: 1, harga: 5 },
        { nama: "Dokumentasi", jumlah: 1, harga: 7_000_000 },
        { barangId: "brg-2", jumlah: 0, harga: 9 },
        { nama: "   ", jumlah: 1, harga: 1 },
      ],
    }),
    { mode: "EVENT" },
  );
  pastikan(campur.length === 2 && campur[0].barangId === "brg-1" && campur[1].barangId === null && campur[1].nama === "Dokumentasi", "baris tanpa barang dan tanpa nama, serta jumlah 0, dibuang; baris bernama tanpa barang = baris bebas");
  pastikan(campur[0].bagian === "Hari 1" && campur[0].deskripsi === "a\nb" && sama(campur[0].frekuensi, 3) && campur[0].satuanFrekuensi === "hari" && campur.map((b) => b.urutan).join() === "0,1", "seksi dirapikan, CRLF dinormalkan, frekuensi event dipakai, urutan 0, 1");
  pastikan(sama(nilaiBaris(campur[0]), 600_000), "nilai baris event 2 x 3 x 100.000 = 600.000");
  const kosongFrek = bacaBarisDokumen(formulir({ baris: [{ barangId: "b", jumlah: 1, harga: 1, frekuensi: "" }] }), { mode: "EVENT" });
  pastikan(sama(kosongFrek[0].frekuensi, 1), "frekuensi kosong di mode event = 1");
  await harusDitolak("frekuensi 0", async () => bacaBarisDokumen(formulir({ baris: [{ barangId: "b", jumlah: 1, harga: 1, frekuensi: 0 }] }), { mode: "EVENT" }), "Baris 1: frekuensi harus lebih dari 0");
  await harusDitolak("frekuensi 1.000.001", async () => bacaBarisDokumen(formulir({ baris: [{}, { barangId: "b", jumlah: 1, harga: 1, frekuensi: 1_000_001 }] }), { mode: "EVENT" }), "Baris 2: frekuensi maksimal 1.000.000");
  pastikan(sama(bacaBarisDokumen(formulir({ baris: [{ barangId: "b", jumlah: 1, harga: 1, frekuensi: 1_000_000 }] }), { mode: "EVENT" })[0].frekuensi, 1_000_000), "frekuensi 1.000.000 tepat diterima");
  pastikan(sama(bacaBarisDokumen(formulir({ baris: [{ barangId: "b", jumlah: 1, harga: 1, frekuensi: 0 }] }), { mode: "STANDAR" })[0].frekuensi, 1), "mode STANDAR tidak menolak frekuensi 0 (dipaksa 1)");
  await harusDitolak("nama 201 karakter", async () => bacaBarisDokumen(formulir({ baris: [{ nama: "n".repeat(201), jumlah: 1, harga: 1 }] }), { mode: "STANDAR" }), "Baris 1: nama maksimal 200 karakter");
  await harusDitolak("deskripsi 3001 karakter", async () => bacaBarisDokumen(formulir({ baris: [{ barangId: "b", deskripsi: "d".repeat(3001), jumlah: 1, harga: 1 }] }), { mode: "STANDAR" }), "Baris 1: deskripsi maksimal 3000 karakter");
  await harusDitolak("satuan 21 karakter", async () => bacaBarisDokumen(formulir({ baris: [{ barangId: "b", satuan: "s".repeat(21), jumlah: 1, harga: 1 }] }), { mode: "STANDAR" }), "Baris 1: satuan maksimal 20 karakter");
  await harusDitolak("satuan frekuensi 21 karakter", async () => bacaBarisDokumen(formulir({ baris: [{ barangId: "b", satuanFrekuensi: "s".repeat(21), jumlah: 1, harga: 1 }] }), { mode: "EVENT" }), "Baris 1: satuan frekuensi maksimal 20 karakter");
  await harusDitolak("seksi 81 karakter", async () => bacaBarisDokumen(formulir({ baris: [{ barangId: "b", bagian: "s".repeat(81), jumlah: 1, harga: 1 }] }), { mode: "EVENT" }), "Baris 1: seksi maksimal 80 karakter");
  await harusDitolak("keterangan 301 karakter", async () => bacaBarisDokumen(formulir({ baris: [{ barangId: "b", keterangan: "k".repeat(301), jumlah: 1, harga: 1 }] }), { mode: "STANDAR" }), "Baris 1: keterangan maksimal 300 karakter");
  pastikan(bacaBarisDokumen(formulir({ baris: [{ nama: "😀".repeat(200), jumlah: 1, harga: 1 }] }), { mode: "STANDAR" })[0].nama?.length === 400, "batas panjang dihitung per karakter (200 emoji diterima)");
  await harusDitolak("501 baris", async () => uraiBarisDokumen(Array.from({ length: 501 }, () => ({ barangId: "b", jumlah: 1, harga: 1 })), { mode: "STANDAR" }), "Maksimal 500 baris per dokumen");
  pastikan(uraiBarisDokumen(Array.from({ length: 500 }, () => ({ barangId: "b", jumlah: 1, harga: 1 })), { mode: "STANDAR" }).length === 500, "500 baris diterima");
  await harusDitolak("harga negatif", async () => bacaBarisDokumen(formulir({ baris: [{ barangId: "b", jumlah: 1, harga: -1 }] }), { mode: "STANDAR" }), "Harga tidak boleh negatif");
  await harusDitolak("tanpa baris berjumlah", async () => bacaBarisDokumen(formulir({ baris: [{ barangId: "b", jumlah: 0, harga: 1 }] }), { mode: "STANDAR" }), "Minimal 1 baris barang dengan jumlah > 0 wajib diisi");
  await harusDitolak("baris bukan JSON", async () => bacaBarisDokumen(formulir({ baris: "{x" }), { mode: "STANDAR" }), "Format baris barang tidak valid");
  await harusDitolak("baris tidak diisi", async () => bacaBarisDokumen(formulir({}), { mode: "STANDAR" }), "Minimal 1 baris barang wajib diisi");
  await harusDitolak("jumlah bukan angka", async () => bacaBarisDokumen(formulir({ baris: [{ barangId: "b", jumlah: "dua", harga: 1 }] }), { mode: "STANDAR" }), "Angka tidak valid");

  console.log("=== 9. Teks dokumen, enum, tanggal ===");
  const teksPenawaran = bacaTeksDokumen(formulir({ perihal: "  Proposal \r\n acara ", kepadaEmail: "klien@contoh.id", judulCetak: "", namaEvent: "Lari 10K" }), KOLOM_TEKS_PENAWARAN);
  pastikan(teksPenawaran.perihal === "Proposal \n acara" && teksPenawaran.kepadaEmail === "klien@contoh.id" && teksPenawaran.judulCetak === null && teksPenawaran.namaEvent === "Lari 10K" && teksPenawaran.teksPembuka === null, "teks dipangkas, CRLF dinormalkan, kosong = null, server tidak menambah teks sendiri");
  await harusDitolak("perihal 201 karakter", async () => bacaTeksDokumen(formulir({ perihal: "p".repeat(201) }), KOLOM_TEKS_PENAWARAN), "Perihal maksimal 200 karakter");
  await harusDitolak("judul cetak 61 karakter", async () => bacaTeksDokumen(formulir({ judulCetak: "j".repeat(61) }), KOLOM_TEKS_PENAWARAN), "Judul cetak maksimal 60 karakter");
  await harusDitolak("info rekening 1001 karakter", async () => bacaTeksDokumen(formulir({ infoBank: "i".repeat(1001) }), KOLOM_TEKS_PENAWARAN), "Info rekening maksimal 1000 karakter");
  await harusDitolak("teks pembuka 3001 karakter", async () => bacaTeksDokumen(formulir({ teksPembuka: "t".repeat(3001) }), KOLOM_TEKS_PENAWARAN), "Teks pembuka maksimal 3000 karakter");
  await harusDitolak("email tujuan tidak valid", async () => bacaTeksDokumen(formulir({ kepadaEmail: "klien@contoh" }), KOLOM_TEKS_PENAWARAN), "Email tujuan tidak valid");
  const warisan = { perihal: "Perihal pesanan", catatan: "Catatan pesanan", syaratPembayaran: null, kepada: "PT Klien" };
  const teksFaktur = bacaTeksDokumen(formulir({ catatan: "", kepada: "PT Baru" }), KOLOM_TEKS_FAKTUR, { warisan, bawaanSyarat: "Transfer 14 hari" });
  pastikan(teksFaktur.perihal === "Perihal pesanan" && teksFaktur.catatan === null && teksFaktur.kepada === "PT Baru" && teksFaktur.syaratPembayaran === "Transfer 14 hari" && teksFaktur.judulCetak === null, "faktur: kunci tidak ada = warisan, kunci kosong = dikosongkan, kunci terisi menimpa, syarat kosong = bawaan pengaturan");
  pastikan(bacaTeksDokumen(formulir({ syaratPembayaran: "" }), KOLOM_TEKS_FAKTUR, { warisan, bawaanSyarat: "Bawaan" }).syaratPembayaran === null, "syarat pembayaran yang sengaja dikosongkan tidak diisi bawaan");
  pastikan(bacaTeksDokumen(formulir({}), KOLOM_TEKS_FAKTUR, { warisan: { ...warisan, syaratPembayaran: "Syarat pesanan" }, bawaanSyarat: "Bawaan" }).syaratPembayaran === "Syarat pesanan", "syarat warisan pesanan menang atas bawaan");
  pastikan(bacaModeDokumen("") === "STANDAR" && bacaModeDokumen("EVENT") === "EVENT" && bacaTampilanEvent("", "RINGKAS") === "RINGKAS" && bacaTampilanEvent("RINCI") === "RINCI", "mode dan tampilan event: kosong memakai bawaan");
  await harusDitolak("mode tidak dikenal", async () => bacaModeDokumen("event"), "Mode dokumen tidak dikenal");
  await harusDitolak("tampilan event tidak dikenal", async () => bacaTampilanEvent("LENGKAP"), "Tampilan event tidak dikenal");
  const besok = new Date(Date.now() + 2 * 86_400_000).toLocaleDateString("en-CA", { timeZone: process.env.ZONA_WAKTU ?? "Asia/Jakarta" });
  pastikan(bacaBerlakuSampai(besok, { saatBuat: true }) instanceof Date && bacaBerlakuSampai("", { saatBuat: true }) === null, "berlaku sampai lusa diterima, kosong = null");
  await harusDitolak("berlaku sampai kemarin saat buat", async () => bacaBerlakuSampai("2020-01-01", { saatBuat: true }), "Berlaku sampai tidak boleh sebelum hari ini");
  pastikan(bacaBerlakuSampai("2020-01-01", { saatBuat: false })?.getFullYear() === 2020, "berlaku sampai lampau boleh saat ubah");
  await harusDitolak("tanggal berlaku salah", async () => bacaBerlakuSampai("2026-13-01", { saatBuat: false }), "Tanggal berlaku tidak valid");
  const tglFaktur = new Date("2026-09-21T05:00:00Z");
  pastikan(bacaJatuhTempo(formulir({ jatuhTempo: "2026-10-05" }), 14, tglFaktur).getDate() === 5, "jatuh tempo dari isian");
  pastikan(bacaJatuhTempo(formulir({}), 14, tglFaktur).getTime() === tglFaktur.getTime() + 14 * 86_400_000, "tanpa isian: tanggal faktur + termin pengaturan (perilaku lama)");
  await harusDitolak("jatuh tempo sebelum faktur", async () => bacaJatuhTempo(formulir({ jatuhTempo: "2026-09-20" }), 14, tglFaktur), "Jatuh tempo tidak boleh sebelum tanggal faktur");
  await harusDitolak("jatuh tempo salah", async () => bacaJatuhTempo(formulir({ jatuhTempo: "21/09/2026" }), 14, tglFaktur), "Jatuh tempo tidak valid");

  console.log("=== 10. Faktur jalur ID dan jalur lama ===");
  const pesananEvent: PesananSumber = {
    mode: "EVENT",
    baris: [
      barisPesanan("pB", "brg-g", 3, 200_000, { urutan: 1, bagian: "Hari 2", frekuensi: 2 }),
      barisPesanan("pA", "brg-g", 2, 100_000, { urutan: 0, bagian: "Hari 1", jumlahDifaktur: 1 }),
      barisPesanan("pC", "jasa-lain", 1, 50_000, { urutan: 2, nama: "Dokumentasi" }),
    ],
    jenisDiskon: "NOMINAL",
    nilaiDiskon: 0,
    diskon: 0,
    jenisFee: "PERSEN",
    nilaiFee: 0,
    fee: 0,
  };
  const masukanId = bacaBarisFaktur(formulir({ baris: [{ barisPesananId: "pB", barangId: "brg-g", jumlah: 1, harga: 1 }, { barisPesananId: "pA", jumlah: 1 }, { barisPesananId: "pB", jumlah: 2 }, {}] }));
  pastikan(masukanId.jalur === "ID" && masukanId.baris.length === 3, "jalur ID terdeteksi; baris kosong editor dibuang");
  const siapId = siapkanBarisFaktur(pesananEvent, masukanId);
  pastikan(siapId.map((b) => `${b.barisPesananId}:${b.jumlah.toNumber()}`).join() === "pA:1,pB:3", "satu baris faktur per id, jumlah dijumlahkan, urut seperti pesanan");
  pastikan(sama(siapId[1].harga, 200_000) && sama(siapId[1].frekuensi, 2) && siapId[1].bagian === "Hari 2" && sama(nilaiBaris(siapId[1]), 1_200_000), "harga dan frekuensi dari server (harga rakitan 1 diabaikan)");
  await harusDitolak("jumlah kumulatif melebihi sisa", async () => siapkanBarisFaktur(pesananEvent, { jalur: "ID", baris: [{ barisPesananId: "pA", jumlah: D(1) }, { barisPesananId: "pA", jumlah: D(1) }] }), "Kuantitas faktur melebihi sisa yang belum ditagih (sisa 1, diminta 2)");
  await harusDitolak("id baris pesanan lain", async () => siapkanBarisFaktur(pesananEvent, { jalur: "ID", baris: [{ barisPesananId: "lain", jumlah: D(1) }] }), "Baris pesanan tidak ditemukan di pesanan ini");
  await harusDitolak("campuran berid dan tidak", async () => bacaBarisFaktur(formulir({ baris: [{ barisPesananId: "pA", jumlah: 1 }, { barangId: "brg-g", jumlah: 1, harga: 1 }] })), "Baris faktur harus semuanya memakai baris pesanan atau semuanya tidak");
  await harusDitolak("jalur lama pada pesanan event", async () => siapkanBarisFaktur(pesananEvent, bacaBarisFaktur(formulir({ baris: [{ barangId: "brg-g", jumlah: 1, harga: 1 }] }))), "wajib dibuat dari komposer faktur");
  const pesananLama: PesananSumber = { ...pesananEvent, mode: "STANDAR", baris: [barisPesanan("p1", "brg-1", 5, 1000, { jumlahDifaktur: 2 }), barisPesanan("p2", "brg-2", 1, 500)] };
  const lama = siapkanBarisFaktur(pesananLama, bacaBarisFaktur(formulir({ baris: [{ barangId: "brg-1", jumlah: 3, harga: 900 }] })));
  pastikan(lama.length === 1 && lama[0].barisPesananId === "p1" && sama(lama[0].harga, 900) && sama(lama[0].frekuensi, 1) && lama[0].nama === null, "jalur lama: harga dari kiriman, frekuensi 1, barisPesananId baris satu-satunya");
  await harusDitolak("jalur lama melebihi sisa", async () => siapkanBarisFaktur(pesananLama, { jalur: "LAMA", baris: [{ barangId: "brg-1", jumlah: D(4), harga: D(1) }] }), "Kuantitas faktur melebihi sisa yang belum ditagih (sisa 3, diminta 4)");
  await harusDitolak("jalur lama barang tidak ada", async () => siapkanBarisFaktur(pesananLama, { jalur: "LAMA", baris: [{ barangId: "brg-x", jumlah: D(1), harga: D(1) }] }), "Barang tidak ada di pesanan ini");
  await harusDitolak("jalur lama pesanan barang ganda", async () => siapkanBarisFaktur({ ...pesananLama, baris: [barisPesanan("p1", "brg-1", 1, 1), barisPesanan("p2", "brg-1", 1, 1)] }, { jalur: "LAMA", baris: [{ barangId: "brg-1", jumlah: D(1), harga: D(1) }] }), "wajib dibuat dari komposer faktur");
  await harusDitolak("jalur lama baris berfrekuensi", async () => siapkanBarisFaktur({ ...pesananLama, baris: [barisPesanan("p1", "brg-1", 1, 1, { frekuensi: 2 })] }, { jalur: "LAMA", baris: [{ barangId: "brg-1", jumlah: D(1), harga: D(1) }] }), "wajib dibuat dari komposer faktur");
  await harusDitolak("jalur lama harga negatif", async () => bacaBarisFaktur(formulir({ baris: [{ barangId: "brg-1", jumlah: 1, harga: -1 }] })), "Harga tidak boleh negatif");
  await harusDitolak("faktur tanpa baris berjumlah", async () => bacaBarisFaktur(formulir({ baris: [{ barisPesananId: "pA", jumlah: 0 }] })), "Minimal 1 baris barang dengan jumlah > 0 wajib diisi");
  const ctxMenutup = konteksProrata(pesananLama, [{ barisPesananId: "p1", jumlah: D(3) }, { barisPesananId: "p2", jumlah: D(1) }]);
  pastikan(ctxMenutup.menutup && !konteksProrata(pesananLama, [{ barisPesananId: "p1", jumlah: D(3) }]).menutup, "menutup hanya bila semua baris pesanan tertagih penuh sesudah faktur ini");

  console.log("=== 11. Retur jalur ID dan jalur lama, nilai retur ber-fee ===");
  const fakturRetur = { baris: [{ id: "f1", barangId: "brg-g", jumlah: 2, harga: 100_000, frekuensi: 1 }, { id: "f2", barangId: "brg-g", jumlah: 3, harga: 200_000, frekuensi: 2 }, { id: "f3", barangId: "brg-t", jumlah: 4, harga: 10, frekuensi: 1 }] };
  const returLama = [{ barisFakturId: null, barangId: "brg-g", jumlah: 3 }, { barisFakturId: "f2", barangId: "brg-g", jumlah: 1 }];
  const sisaRetur = sisaReturPerBaris(fakturRetur.baris, returLama);
  pastikan(sama(sisaRetur.get("f1")!, 0) && sama(sisaRetur.get("f2")!, 1) && sama(sisaRetur.get("f3")!, 4), "retur lama tanpa id dibagi ke baris berbarang sama urut id (f1 habis, sisa 1 ke f2)");
  const masukanRetur = bacaBarisRetur(formulir({ baris: [{ barisFakturId: "f2", barangId: "brg-g", jumlah: 1 }] }));
  const siapRetur = siapkanBarisRetur(fakturRetur, returLama, masukanRetur);
  pastikan(siapRetur.length === 1 && sama(siapRetur[0].harga, 200_000) && sama(siapRetur[0].frekuensi, 2) && sama(nilaiBaris(siapRetur[0]), 400_000), "retur jalur ID memakai harga dan frekuensi baris faktur itu (bukan baris pertama barang)");
  await harusDitolak("retur melebihi sisa baris", async () => siapkanBarisRetur(fakturRetur, returLama, { jalur: "ID", baris: [{ barisFakturId: "f2", jumlah: D(1) }, { barisFakturId: "f2", jumlah: D(1) }] }), "Kuantitas retur melebihi yang bisa diretur (maks 1, diminta 2)");
  await harusDitolak("retur id baris faktur lain", async () => siapkanBarisRetur(fakturRetur, [], { jalur: "ID", baris: [{ barisFakturId: "lain", jumlah: D(1) }] }), "Baris faktur tidak ditemukan di faktur ini");
  await harusDitolak("retur campuran", async () => bacaBarisRetur(formulir({ baris: [{ barisFakturId: "f1", jumlah: 1 }, { barangId: "brg-g", jumlah: 1 }] })), "Baris retur harus semuanya memakai baris faktur atau semuanya tidak");
  await harusDitolak("retur tanpa baris", async () => bacaBarisRetur(formulir({ baris: [] })), "Minimal 1 baris barang wajib diretur");
  await harusDitolak("retur jalur lama barang ganda", async () => siapkanBarisRetur(fakturRetur, [], { jalur: "LAMA", baris: [{ barangId: "brg-g", jumlah: D(1) }] }), "pilih baris faktur yang diretur");
  const returTunggal = siapkanBarisRetur(fakturRetur, [{ barisFakturId: "f3", barangId: "brg-t", jumlah: 1 }], bacaBarisRetur(formulir({ baris: [{ barangId: "brg-t", jumlah: 3 }] })));
  pastikan(returTunggal[0].barisFakturId === "f3" && sama(returTunggal[0].jumlah, 3), "retur jalur lama barang tunggal: barisFakturId terisi");
  await harusDitolak("retur jalur lama melebihi", async () => siapkanBarisRetur(fakturRetur, [{ barisFakturId: "f3", barangId: "brg-t", jumlah: 1 }], { jalur: "LAMA", baris: [{ barangId: "brg-t", jumlah: D(4) }] }), "Kuantitas retur melebihi yang bisa diretur (maks 3, diminta 4)");
  await harusDitolak("retur jalur lama barang tidak ada", async () => siapkanBarisRetur(fakturRetur, [], { jalur: "LAMA", baris: [{ barangId: "brg-x", jumlah: D(1) }] }), "Barang tidak ada di faktur ini");
  // uji-dokumen-event kasus 12: retur 5 kamar x 3 malam x 650.000 dari faktur subtotal 61.750.000, diskon 890.000, fee 6.086.000
  const rRetur = nilaiRetur({ dpp: 66_946_000, diskon: 890_000, fee: 6_086_000, ppnPersen: 0 }, [{ jumlah: 5, harga: 650_000, frekuensi: 3 }]);
  pastikan(teks(rRetur.bruto) === "9750000.00" && teks(rRetur.diskon) === "140526.32" && teks(rRetur.fee) === "960947.37" && teks(rRetur.dpp) === "10570421.05" && teks(rRetur.total) === "10570421.05", "nilai retur ber-fee: diskon 140.526,32, fee 960.947,37, dpp = total 10.570.421,05");
  const rReturLama = nilaiRetur({ dpp: 900, diskon: 100, fee: 0, ppnPersen: 11 }, [{ jumlah: 1, harga: 500 }]);
  pastikan(teks(rReturLama.diskon) === "50.00" && rReturLama.fee.isZero() && teks(rReturLama.ppn) === "49.50" && teks(rReturLama.total) === "499.50", "faktur tanpa fee: rumus sama dengan retur lama (bruto faktur = dpp + diskon)");

  console.log("=== 12. Daftar putih tampilan, konversi, seksi ===");
  const tampil = bacaIsianTampilan("faktur", formulir({ perihal: "Baru", judulCetak: "PROFORMA INVOICE", total: 1, diskon: 5, jatuhTempo: "2026-12-01", nomorCetak: " 071/X ", kopSuratId: "" }));
  pastikan([...tampil.kolom].sort().join() === ["perihal", "judulCetak", "nomorCetak", "jatuhTempo", "kopSuratId"].sort().join(), "kolom di luar daftar putih (total, diskon) diabaikan");
  pastikan(tampil.data.perihal === "Baru" && tampil.data.nomorCetak === "071/X" && tampil.data.kopSuratId === null && tampil.data.jatuhTempo instanceof Date && !("total" in tampil.data), "nilai tampilan dibaca: teks, nomor cetak dipangkas, kop kosong null, tanggal");
  pastikan(bacaIsianTampilan("pesanan", formulir({ judulCetak: "X", nomorCetak: "1" })).kolom.length === 0 && bacaIsianTampilan("uangMuka", formulir({ catatan: "x", keperluan: "DP" })).kolom.join() === "keperluan", "pesanan tanpa judul dan nomor cetak; uang muka tanpa catatan");
  await harusDitolak("tampilan perihal 201 karakter", async () => bacaIsianTampilan("penawaran", formulir({ perihal: "p".repeat(201) })), "Perihal maksimal 200 karakter");
  await harusDitolak("tampilan add on negatif", async () => bacaIsianTampilan("penawaran", formulir({ nilaiAddOn: "-1" })), "Add on tidak boleh negatif");
  pastikan(KOLOM_TAMPILAN.penawaran.length === 24 && !(KOLOM_TAMPILAN.faktur as readonly string[]).includes("total"), "daftar putih penawaran 24 kolom (D2 §3.11)");
  const barisTampil = bacaBarisTampilan(formulir({ baris: [{ id: "b1", nama: "Baru", harga: 1, urutan: 2 }, { id: "b2", deskripsi: "" }] }));
  pastikan(barisTampil.length === 2 && barisTampil[0].data.nama === "Baru" && barisTampil[0].data.urutan === 2 && !("harga" in barisTampil[0].data) && barisTampil[1].data.deskripsi === null && !("nama" in barisTampil[1].data), "teks baris: hanya kolom teks dan urutan yang dikirim, harga diabaikan");
  await harusDitolak("baris tampilan tanpa id", async () => bacaBarisTampilan(formulir({ baris: [{ nama: "x" }] })), "Baris tidak ditemukan di dokumen ini");
  await harusDitolak("urutan baris tidak sah", async () => bacaBarisTampilan(formulir({ baris: [{ id: "b", urutan: -1 }] })), "Baris 1: urutan tidak valid");
  const meta = ringkasPerubahan({ perihal: "Lama", judulCetak: null }, { perihal: "x".repeat(250), judulCetak: "BARU" }, ["perihal", "judulCetak"]);
  pastikan(meta.kolom.join() === "perihal,judulCetak" && meta.dari.perihal === "Lama" && meta.dari.judulCetak === null && String(meta.ke.perihal).length === 200, "meta log perubahan dengan teks dipotong 200 karakter");
  const penawaranContoh = Object.fromEntries([...KOLOM_SALIN_PENAWARAN_KE_PESANAN, "nomor", "judulCetak", "nomorCetak", "nilaiAddOn", "berlakuSampai", "statusKomersial"].map((k) => [k, `nilai-${k}`]));
  const salinPesanan = salinKolom(penawaranContoh, KOLOM_SALIN_PENAWARAN_KE_PESANAN);
  pastikan(Object.keys(salinPesanan).length === KOLOM_SALIN_PENAWARAN_KE_PESANAN.length && !("judulCetak" in salinPesanan) && !("nomorCetak" in salinPesanan) && !("nilaiAddOn" in salinPesanan) && salinPesanan.leadId === "nilai-leadId", "konversi menyalin kolom D2 §3.9 tanpa judul, nomor cetak, add on, berlaku sampai, dan status komersial");
  pastikan(KOLOM_SALIN_BARIS.includes("frekuensi") && KOLOM_SALIN_BARIS.includes("bagian") && !(KOLOM_SALIN_BARIS as readonly string[]).includes("subtotal"), "baris konversi membawa frekuensi dan seksi");
  pastikan(JSON.stringify(rapikanDaftarSeksi(" Hari  1 \nhari 1\n\nVenue\r\n" + "x".repeat(70))) === JSON.stringify(["Hari 1", "Venue", "x".repeat(60)]), "seksi pengaturan: spasi dirapikan, duplikat tanpa beda huruf besar dibuang, dipotong 60");
  pastikan(rapikanDaftarSeksi(Array.from({ length: 70 }, (_, i) => `S${i}`).join("\n")).length === 60 && SEKSI_BAWAAN.length === 9 && TEKS_PEMBUKA_BAWAAN.startsWith("Bersama ini"), "seksi paling banyak 60 butir; seksi bawaan dan teks pembuka D2 §3.3");

  console.log("=== 13. Hak baris bebas dan Barang JASA-LAIN ===");
  const lamaPeran = process.env.UJI_PERAN;
  try {
    process.env.UJI_PERAN = "GUDANG";
    const gudang = (await penggunaSaatIni())!;
    await harusDitolak("baris bebas tanpa harga.nego (GUDANG)", async () => pastikanHakBarisBebas(gudang, [{ barangId: "b" }, { barangId: null }]), 'Baris bebas (tanpa barang katalog) butuh hak "Harga jual · boleh nego"');
    pastikanHakBarisBebas(gudang, [{ barangId: "b" }]);
    process.env.UJI_PERAN = "KASIR";
    pastikanHakBarisBebas((await penggunaSaatIni())!, [{ barangId: null }]);
    console.log("[ok] baris berbarang tanpa harga.nego lolos; KASIR (punya harga.nego) boleh baris bebas");
  } finally {
    if (lamaPeran === undefined) delete process.env.UJI_PERAN;
    else process.env.UJI_PERAN = lamaPeran;
  }
  pastikan(isiBarangLainLain([{ barangId: null, x: 1 }, { barangId: "b", x: 2 }], "lain").map((b) => b.barangId).join() === "lain,b", "isiBarangLainLain hanya mengisi baris bebas");
  const adaJasaLain = await db.barang.findUnique({ where: { kode: KODE_BARANG_LAIN } });
  await diTransaksiBatal(async (tx) => {
    const id1 = await pastikanBarangLainLain(tx);
    const id2 = await pastikanBarangLainLain(tx);
    const b = await tx.barang.findUniqueOrThrow({ where: { id: id1 } });
    pastikan(id1 === id2 && b.jenis === "JASA" && (adaJasaLain ? true : b.perusahaanId === null && b.nama === "Item lain-lain" && b.satuan === "paket"), "Barang JASA-LAIN dibuat sekali (JASA, bersama), panggilan kedua idempoten");
    await tx.barang.update({ where: { id: id1 }, data: { jenis: "BARANG", perusahaanId: "utama" } });
    await harusDitolak("JASA-LAIN berjenis BARANG", () => pastikanBarangLainLain(tx), "sudah dipakai barang jenis BARANG");
  });
  pastikan((await db.barang.count({ where: { kode: KODE_BARANG_LAIN } })) === (adaJasaLain ? 1 : 0), "transaksi uji dibatalkan: Barang JASA-LAIN tidak tertinggal");

  console.log("=== 14. Kop surat, batas dan progres termin, log penjualan (transaksi dibatalkan) ===");
  const pelanggan = await db.pelanggan.findFirst({ select: { id: true } });
  const kas = await db.akun.findFirst({ where: { kasBank: true, kelompok: false, perusahaanId: null }, select: { id: true } });
  pastikan(pelanggan && kas, "data seed: pelanggan dan akun kas ada");
  const jumlahLogAwal = await db.logAktivitas.count();
  await diTransaksiBatal(async (tx) => {
    const kop = await tx.kopSurat.create({ data: { perusahaanId: "utama", nama: "Kop Uji Nilai Baris" } });
    pastikan((await pastikanKopSuratDokumen(tx, kop.id, "utama")) === kop.id && (await pastikanKopSuratDokumen(tx, null, "utama")) === null, "kop milik perusahaan dokumen diterima; kosong = kop bawaan");
    await harusDitolak("kop perusahaan lain", () => pastikanKopSuratDokumen(tx, kop.id, "tapussa"), "Kop surat tidak ditemukan atau bukan milik perusahaan dokumen");
    await tx.kopSurat.update({ where: { id: kop.id }, data: { dihapusPada: new Date() } });
    await harusDitolak("kop terhapus", () => pastikanKopSuratDokumen(tx, kop.id, "utama"), "Kop surat tidak ditemukan");

    const pesanan = await tx.pesananPenjualan.create({ data: { nomor: "UJINB-PSJ-1", pelangganId: pelanggan!.id, total: 10_000_000, ppnPersen: 11 } });
    const pesananLain = await tx.pesananPenjualan.create({ data: { nomor: "UJINB-PSJ-2", pelangganId: pelanggan!.id, total: 1_000_000 } });
    const butir = selesaikanRencana([{ label: "DP", mode: "PERSEN", nilai: 30 }, { label: "Pelunasan" }], D(10_000_000));
    await tx.rencanaTermin.createMany({ data: butir.map((b) => ({ ...b, perusahaanId: "utama", pesananId: pesanan.id })) });
    const [t1] = await tx.rencanaTermin.findMany({ where: { pesananId: pesanan.id }, orderBy: { no: "asc" } });
    const lolos = await pastikanPembayaranTermin(tx, { rencanaTerminId: t1.id, pesananId: pesanan.id, jumlah: D(3_330_000) });
    pastikan(lolos.label === "DP", "bayar termin DP tepat 3.330.000 (3.000.000 + PPN 11%) lolos");
    await tx.uangMukaPelanggan.create({ data: { nomor: "UJINB-UM-1", pelangganId: pelanggan!.id, pesananId: pesanan.id, akunId: kas!.id, jumlah: 3_000_000, rencanaTerminId: t1.id } });
    await harusDitolak("bayar termin melebihi sisa", () => pastikanPembayaranTermin(tx, { rencanaTerminId: t1.id, pesananId: pesanan.id, jumlah: D("330000.01") }), "Pembayaran melebihi nilai termin DP (sisa 330.000)");
    await harusDitolak("termin pesanan lain", () => pastikanPembayaranTermin(tx, { rencanaTerminId: t1.id, pesananId: pesananLain.id, jumlah: D(1) }), "Termin tidak ditemukan di pesanan ini");
    await harusDitolak("termin tidak ada", () => pastikanPembayaranTermin(tx, { rencanaTerminId: "tidak-ada", pesananId: pesanan.id, jumlah: D(1) }), "Termin tidak ditemukan di pesanan ini");
    const p = await progresTermin(tx, pesanan.id, hariIni);
    pastikan(p !== null && sama(p.nilaiKontrakBruto, 11_100_000) && p.butir[0].status === "Dibayar sebagian" && sama(p.butir[0].sisa, 330_000) && p.butir[1].status === "Belum ditagih" && sama(p.belumDibayar, 8_100_000), "progresTermin dari basis data: kontrak bruto 11.100.000, DP sisa 330.000, belum dibayar 8.100.000");
    pastikan((await progresTermin(tx, "tidak-ada")) === null, "progresTermin pesanan tidak ada = null");

    await catatLogPenjualan(tx, { id: "skrip-uji", nama: "Skrip uji" }, { aksi: "UBAH_TAMPILAN", jenis: "Faktur Penjualan", nomor: "UJINB-FJ", entitasId: "x", meta: ringkasPerubahan({ perihal: "a" }, { perihal: "b" }, ["perihal"]) });
    const log = await tx.logAktivitas.findFirst({ where: { nomor: "UJINB-FJ" } });
    pastikan(log?.modul === "penjualan" && log.penggunaId === null && log.aksi === "UBAH_TAMPILAN" && JSON.stringify((log.meta as { kolom?: unknown })?.kolom) === '["perihal"]' && JSON.stringify((log.meta as { dari?: unknown })?.dari) === '{"perihal":"a"}' && JSON.stringify((log.meta as { ke?: unknown })?.ke) === '{"perihal":"b"}', "catatLogPenjualan menulis modul penjualan dan meta perubahan");
  });
  pastikan((await db.pesananPenjualan.count({ where: { nomor: { startsWith: "UJINB-" } } })) === 0 && (await db.logAktivitas.count()) === jumlahLogAwal && (await db.kopSurat.count({ where: { nama: "Kop Uji Nilai Baris" } })) === 0, "transaksi uji dibatalkan: pesanan, kop, dan log tidak tertinggal");

  console.log("=== 15. Pratinjau klien sama dengan server ===");
  // Angka dokumen nyata: harga rupiah bulat, jumlah bulat atau setengah, frekuensi bulat. Harga bersen, frekuensi
  // pecahan, diskon, fee, PPN, dan termin acak ada di bagian 17 (perbaikan tinjauan P20 S3).
  const rnd = acak(20_261_111);
  let beda = 0;
  for (let i = 0; i < 1000; i++) {
    const jumlah = Math.floor(1 + rnd() * 500) + (rnd() < 0.2 ? 0.5 : 0);
    const harga = Math.floor(rnd() * 10_000_000);
    const frekuensi = rnd() < 0.5 ? 1 : Math.floor(1 + rnd() * 30);
    if (nilaiBarisKlien({ jumlah, harga, frekuensi }) !== nilaiBaris({ jumlah, harga, frekuensi }).toNumber()) beda++;
  }
  pastikan(beda === 0, `1.000 baris acak (harga bulat): nilaiBarisKlien sama dengan nilaiBaris server (beda ${beda})`);
  pastikan(nilaiBarisKlien({ jumlah: 2, harga: 5, frekuensi: "" }) === 10 && nilaiBarisKlien({ jumlah: "abc", harga: 5 }) === 0, "klien: frekuensi kosong = 1, isian tidak sah = 0");
  pastikan(subtotalKlien(proposal) === 159_515_000 && subtotalKlien(invoice.map((b) => ({ ...b, frekuensi: 1 }))) === 73_166_600, "subtotal klien proposal dan invoice D'Pro sama dengan server");
  const kNawasena = ringkasanDokumenKlien({ baris: nawasena.map((b) => ({ jumlah: b.jumlah.toNumber(), harga: b.harga.toNumber(), frekuensi: b.frekuensi.toNumber() })), jenisDiskon: "NOMINAL", nilaiDiskon: 0, jenisFee: "PERSEN", nilaiFee: 10, ppnPersen: 11 });
  pastikan(kNawasena.total === 72_050_000 && kNawasena.ppn === 7_925_500 && kNawasena.totalDenganPpn === 79_975_500 && kNawasena.galat === null, "ringkasan klien Nawasena: total 72.050.000, PPN 7.925.500, 79.975.500");
  const kStandar = ringkasanDokumenKlien({ baris: [{ jumlah: 2, harga: 900_000 }], jenisDiskon: "PERSEN", nilaiDiskon: 5, jenisFee: "PERSEN", nilaiFee: 0, ppnPersen: 11 });
  pastikan(kStandar.diskon === 90_000 && kStandar.totalDenganPpn === 1_898_100, "ringkasan klien HKA standar 1.898.100");
  pastikan(ringkasanDokumenKlien({ baris: [{ jumlah: 1, harga: 1000 }], jenisDiskon: "NOMINAL", nilaiDiskon: 1001, jenisFee: "PERSEN", nilaiFee: 0 }).galat === "Diskon (1.001) melebihi subtotal penawaran (1.000)", "galat klien sama dengan pesan server (diskon melebihi subtotal)");
  pastikan(ringkasanDokumenKlien({ baris: [{ jumlah: 1, harga: 1000 }], jenisDiskon: "PERSEN", nilaiDiskon: 101, jenisFee: "PERSEN", nilaiFee: 0 }).galat === "Persen diskon tidak boleh lebih dari 100" && ringkasanDokumenKlien({ baris: [], jenisDiskon: "NOMINAL", nilaiDiskon: 0, jenisFee: "PERSEN", nilaiFee: 101 }).galat === "Persen management fee tidak boleh lebih dari 100", "galat klien persen diskon dan fee");
  await harusDitolak("server: diskon melebihi subtotal (pembanding galat klien)", async () => ringkasanDokumen({ subtotal: D(1000), jenisDiskon: "NOMINAL", nilaiDiskon: D(1001), jenisFee: "PERSEN", nilaiFee: NOL, dokumen: "penawaran" }), "Diskon (1.001) melebihi subtotal penawaran (1.000)");
  const kTermin = pratinjauTerminKlien([{ label: "DP", mode: "PERSEN", nilai: 30 }, { label: "", mode: "PERSEN", nilai: 40 }, { label: "Pelunasan" }], 10_000_000, 11);
  pastikan(kTermin.galat === null && kTermin.butir.map((b) => `${b.label}:${b.jumlah}:${b.persen}:${b.bruto}`).join() === "DP:3000000:30:3330000,Termin 2:4000000:40:4440000,Pelunasan:3000000:30:3330000", "pratinjau termin klien sama dengan selesaikanRencana dan brutoButir");
  pastikan(pratinjauTerminKlien([{ mode: "PERSEN", nilai: 100 }, {}], 1000).galat === "Termin sebelumnya sudah menutup seluruh nilai kontrak" && pratinjauTerminKlien([{}, {}, {}, {}, {}], 1000).galat === "Rencana termin maksimal 4 butir", "galat termin klien sama dengan server");
  const kEvent = pratinjauTerminKlien([{ label: "DP", mode: "PERSEN", nilai: 30 }, { label: "Pelunasan" }], 66_946_000);
  pastikan(kEvent.butir.map((b) => b.jumlah).join() === terminEvent.map((b) => b.jumlah.toNumber()).join(), "pratinjau termin contoh D2 §4.1 sama dengan server");

  console.log("=== 16. Aturan impor (L1, L10) ===");
  const imporDari = (berkas: string) => [...readFileSync(berkas, "utf8").matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\bfrom\s+)?["']([^"']+)["']|\b(?:import|require)\s*\(\s*["']([^"']+)["']/g)].map((m) => m[1] ?? m[2]);
  pastikan(imporDari("src/lib/hitungDokumenKlien.ts").length === 0 && imporDari("src/lib/teksBerbutir.ts").length === 0, "hitungDokumenKlien.ts dan teksBerbutir.ts tanpa impor apa pun (aman untuk klien)");
  const isiKlien = readFileSync("src/lib/hitungDokumenKlien.ts", "utf8");
  pastikan(!/prisma-klien\/client|@\/lib\/db/.test(isiKlien), "hitungDokumenKlien.ts tidak menyebut prisma-klien/client atau @/lib/db (kriteria P20)");
  const imporAkuntansi = imporDari("src/lib/akuntansi.ts");
  pastikan(!imporAkuntansi.some((s) => /dokumenPenjualan/.test(s)), "akuntansi.ts tidak mengimpor dokumenPenjualan.ts (L1)");
  pastikan(!imporDari("src/lib/nilaiBaris.ts").some((s) => /dokumenPenjualan/.test(s)) && imporDari("src/lib/dokumenPenjualan.ts").includes("@/lib/nilaiBaris"), "dokumenPenjualan.ts mengekspor ulang dari nilaiBaris.ts, bukan sebaliknya");
  const direktifServer = /^\s*["']use server["'];?\s*$/m;
  pastikan(["dokumenPenjualan", "rencanaTermin", "barangLainLain", "teksBerbutir", "hitungDokumenKlien"].every((n) => !direktifServer.test(readFileSync(`src/lib/${n}.ts`, "utf8"))), "pustaka P20 tanpa direktif use server (tidak menjadi endpoint publik)");
  pastikan(KOLOM_TEKS_FAKTUR.length === 15, "daftar teks faktur: 14 teks surat + judul cetak");

  await bagianPerbaikanTinjauan(pelanggan!.id, kas!.id, hariIni);
}

/** Pesan galat fungsi server, atau null bila lolos. */
function galatDari(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Angka acak dua desimal (teks) antara 0 dan maks. */
const sen2 = (rnd: () => number, maks: number) => (Math.floor(rnd() * maks * 100) / 100).toFixed(2);

/** Bagian 17: perbaikan tinjauan P20 (S1 sampai S3, R1 sampai R6). */
async function bagianPerbaikanTinjauan(pelangganId: string, akunKasId: string, hariIni: Date) {
  console.log("=== 17a. S1: bruto butir terakhir menutup sisa PPN ===");
  // contoh tinjauan: basis 20.000.001, rencana 50% lalu sisa, PPN 11%
  const rencanaS1 = selesaikanRencana([{ label: "DP", mode: "PERSEN", nilai: 50 }, { label: "Pelunasan" }], D("20000001"));
  const brutoS1 = brutoRencana(rencanaS1, 11);
  pastikan(teks(nilaiBrutoKontrak(D("20000001"), 11)) === "22200001.11", "nilai kontrak bruto 20.000.001 + PPN 2.200.000,11 = 22.200.001,11");
  pastikan(teks(brutoS1[0].bruto) === "11100000.56" && teks(brutoS1[1].bruto) === "11100000.55", "butir 1 bruto 11.100.000,56 (jumlah + PPN sendiri); butir terakhir 11.100.000,55 (sisa nilai kontrak bruto)");
  pastikan(brutoS1[0].bruto.plus(brutoS1[1].bruto).equals(nilaiBrutoKontrak(D("20000001"), 11)), "Σ bruto butir sama dengan batas uang muka per pesanan (nilaiBrutoKontrak)");
  const rencanaS1Db = rencanaS1.map((b) => ({ no: b.no, jumlah: b.jumlah }));
  const lolosAkhir = periksaBatasTermin({ butir: { pesananId: "p", no: 2, label: "Pelunasan" }, rencana: rencanaS1Db, pesananId: "p", ppnPersen: 11, sudahDibayar: 0, jumlahBaru: "11100000.55" });
  pastikan(teks(lolosAkhir.bruto) === "11100000.55", "termin terakhir bisa dibayar penuh 11.100.000,55");
  await harusDitolak("termin terakhir lebih 1 sen", async () => periksaBatasTermin({ butir: { pesananId: "p", no: 2, label: "Pelunasan" }, rencana: rencanaS1Db, pesananId: "p", ppnPersen: 11, sudahDibayar: 0, jumlahBaru: "11100000.56" }), "Pembayaran melebihi nilai termin Pelunasan");
  await harusDitolak("nomor butir tidak ada di rencana", async () => periksaBatasTermin({ butir: { pesananId: "p", no: 3, label: "X" }, rencana: rencanaS1Db, pesananId: "p", ppnPersen: 11, sudahDibayar: 0, jumlahBaru: 1 }), "Termin tidak ditemukan di pesanan ini");
  const progresS1 = hitungProgresTermin(
    {
      total: "20000001",
      ppnPersen: 11,
      butir: rencanaS1.map((b) => ({ id: `s${b.no}`, no: b.no, label: b.label, jumlah: b.jumlah, persen: b.persen, jatuhTempo: new Date("2026-01-01T05:00:00Z"), ditagihPada: null, nomorCetak: null })),
      uangMuka: [{ jumlah: "11100000.56", rencanaTerminId: "s1" }, { jumlah: "11100000.55", rencanaTerminId: "s2" }],
      penerimaan: [],
    },
    hariIni,
  );
  pastikan(progresS1.butir.every((b) => b.status === "Lunas" && !b.lewatJatuhTempo) && progresS1.belumDibayar.isZero(), "progres: kedua butir Lunas tanpa tanda lewat jatuh tempo, belum dibayar 0");
  const kS1 = pratinjauTerminKlien([{ label: "DP", mode: "PERSEN", nilai: 50 }, { label: "Pelunasan" }], "20000001", 11);
  pastikan(kS1.butir.map((b) => b.bruto).join() === "11100000.56,11100000.55", "pratinjau klien memakai rumus bruto yang sama");
  let selisihKontrak = 0;
  const rndS1 = acak(20_261_112);
  for (let i = 0; i < 2000; i++) {
    const n = 1 + Math.floor(rndS1() * 4);
    const masukan = Array.from({ length: n }, () => ({ mode: "PERSEN", nilai: sen2(rndS1, 100 / n) }));
    const basis = D(sen2(rndS1, 100_000_000)).plus("0.01");
    const ppn = [0, 11, 12, "11.5"][Math.floor(rndS1() * 4)];
    let r: ReturnType<typeof selesaikanRencana>;
    try {
      r = selesaikanRencana(masukan, basis);
    } catch {
      continue;
    }
    const jumlahBruto = brutoRencana(r, ppn).reduce((acc, x) => acc.plus(x.bruto), NOL);
    const jumlahPersen = r.reduce((acc, x) => acc.plus(x.persen), NOL);
    if (!jumlahBruto.equals(nilaiBrutoKontrak(basis, ppn)) || !jumlahPersen.equals(100)) selisihKontrak++;
  }
  pastikan(selisihKontrak === 0, `2.000 rencana acak: Σ bruto = nilai kontrak bruto dan Σ persen = 100 (beda ${selisihKontrak})`);

  console.log("=== 17b. S2: subtotalDokumen untuk penawaran dan pesanan, subtotalFaktur untuk faktur ===");
  pastikan(sama(subtotalFaktur({ dpp: 100, diskon: 0, fee: 0 }), 100) && sama(subtotalFaktur({ dpp: 66_946_000, diskon: 890_000, fee: 6_086_000 }), 61_750_000), "subtotalFaktur = dpp + diskon - fee (faktur dpp 100 PPN 11 total 111: subtotal 100)");
  pastikan(sama(subtotalDokumen({ total: 72_050_000, diskon: 0, fee: 6_550_000 }), 65_500_000), "subtotalDokumen penawaran dan pesanan = total + diskon - fee");
  // @ts-expect-error kepala faktur (punya dpp) tidak boleh masuk subtotalDokumen
  subtotalDokumen({ total: 111, diskon: 0, fee: 0, dpp: 100 });
  console.log("[ok] tipe subtotalDokumen menolak objek ber-dpp (diperiksa tsc lewat @ts-expect-error)");

  console.log("=== 17c. S3: pratinjau klien sama dengan server (harga bersen, frekuensi pecahan, diskon, fee, PPN, termin) ===");
  const rnd = acak(20_261_113);
  let bedaBaris = 0;
  for (let i = 0; i < 20_000; i++) {
    const jumlah = rnd() < 0.6 ? String(1 + Math.floor(rnd() * 500)) : sen2(rnd, 500);
    const frekuensi = rnd() < 0.5 ? String((1 + Math.floor(rnd() * 60)) / 2) : sen2(rnd, 40);
    const harga = rnd() < 0.8 ? sen2(rnd, 10_000_000) : (Math.floor(rnd() * 1e10) / 1000).toFixed(3);
    const server = nilaiBaris({ jumlah: uang(jumlah), harga: uang(harga), frekuensi: uang(frekuensi) }).toNumber();
    if (nilaiBarisKlien({ jumlah, harga, frekuensi }) !== server) bedaBaris++;
  }
  pastikan(bedaBaris === 0, `20.000 baris acak (harga bersen, frekuensi kelipatan 0,5 dan dua desimal): klien sama dengan server (beda ${bedaBaris})`);
  pastikan(nilaiBarisKlien({ jumlah: 7, frekuensi: 4.5, harga: "5125460.31" }) === 161_451_999.77, "contoh tinjauan 7 × 4,5 × 5.125.460,31 = 161.451.999,77");
  let bedaRingkasan = 0;
  for (let i = 0; i < 5000; i++) {
    const baris = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => ({ jumlah: String(1 + Math.floor(rnd() * 30)), frekuensi: String((1 + Math.floor(rnd() * 10)) / 2), harga: sen2(rnd, 20_000_000) }));
    const jenisDiskon = rnd() < 0.5 ? "PERSEN" : "NOMINAL";
    const nilaiDiskon = jenisDiskon === "PERSEN" ? sen2(rnd, rnd() < 0.05 ? 120 : 80) : sen2(rnd, 5_000_000);
    const jenisFee = rnd() < 0.7 ? "PERSEN" : "NOMINAL";
    const nilaiFee = jenisFee === "PERSEN" ? sen2(rnd, 99) : sen2(rnd, 3_000_000);
    const ppnPersen = [0, 11, 12][Math.floor(rnd() * 3)];
    const k = ringkasanDokumenKlien({ baris, jenisDiskon, nilaiDiskon, jenisFee, nilaiFee, ppnPersen });
    const barisServer = baris.map((b) => ({ jumlah: uang(b.jumlah), harga: uang(b.harga), frekuensi: uang(b.frekuensi) }));
    let r: ReturnType<typeof ringkasanDokumen> | null = null;
    const g = galatDari(() => (r = bacaRingkasanDokumen(formulir({ jenisDiskon, nilaiDiskon, jenisFee, nilaiFee }), barisServer, "penawaran")));
    if (g !== null || r === null) {
      if (k.galat !== g) bedaRingkasan++;
      continue;
    }
    const rs: ReturnType<typeof ringkasanDokumen> = r;
    const ppn = hitungPpn(rs.total, D(ppnPersen));
    const cocok = k.galat === null && k.subtotal === rs.subtotal.toNumber() && k.diskon === rs.diskon.toNumber() && k.fee === rs.fee.toNumber() && k.total === rs.total.toNumber() && k.ppn === ppn.toNumber() && k.totalDenganPpn === rs.total.plus(ppn).toNumber();
    if (!cocok) bedaRingkasan++;
  }
  pastikan(bedaRingkasan === 0, `5.000 ringkasan acak (diskon dan fee persen atau nominal, PPN): klien sama dengan server termasuk pesan galat (beda ${bedaRingkasan})`);
  pastikan(ringkasanDokumenKlien({ baris: [{ jumlah: 1, harga: "94982807.50" }], jenisDiskon: "NOMINAL", nilaiDiskon: 0, jenisFee: "PERSEN", nilaiFee: 0, ppnPersen: 11 }).ppn === 10_448_108.83, "contoh tinjauan PPN 11% dari 94.982.807,50 = 10.448.108,83");
  pastikan(ringkasanDokumenKlien({ baris: [{ jumlah: 1, harga: "36555805.98" }], jenisDiskon: "PERSEN", nilaiDiskon: 75, jenisFee: "PERSEN", nilaiFee: 0 }).diskon === 27_416_854.49, "contoh tinjauan 75% dari 36.555.805,98 = 27.416.854,49");
  let bedaTermin = 0;
  for (let i = 0; i < 5000; i++) {
    const n = 1 + Math.floor(rnd() * 4);
    const masukan = Array.from({ length: n }, () => {
      const persen = rnd() < 0.7;
      return { label: rnd() < 0.3 ? "" : "T", mode: rnd() < 0.1 ? "" : persen ? "PERSEN" : "NOMINAL", nilai: persen ? sen2(rnd, rnd() < 0.05 ? 150 : 60) : sen2(rnd, 40_000_000) };
    });
    const basis = sen2(rnd, 100_000_000);
    const ppnPersen = [0, 11, 12][Math.floor(rnd() * 3)];
    const k = pratinjauTerminKlien(masukan, basis, ppnPersen);
    let r: ReturnType<typeof selesaikanRencana> = [];
    const g = galatDari(() => (r = selesaikanRencana(masukan, D(basis))));
    if (g !== null) {
      if (k.galat !== g) bedaTermin++;
      continue;
    }
    const bruto = brutoRencana(r, ppnPersen);
    const cocok = k.galat === null && k.butir.length === r.length && r.every((b, j) => k.butir[j].label === b.label && k.butir[j].jumlah === b.jumlah.toNumber() && k.butir[j].persen === b.persen.toNumber() && k.butir[j].bruto === bruto[j].bruto.toNumber());
    if (!cocok) bedaTermin++;
  }
  pastikan(bedaTermin === 0, `5.000 rencana termin acak (mode kosong, persen, nominal, PPN): klien sama dengan server termasuk pesan galat (beda ${bedaTermin})`);

  console.log("=== 17d. R1: pesan dan pembacaan isian klien sama dengan server ===");
  const ringkas = (lain: Partial<Parameters<typeof ringkasanDokumenKlien>[0]>) => ringkasanDokumenKlien({ baris: [{ jumlah: 1, harga: 1000 }], jenisDiskon: "NOMINAL", nilaiDiskon: 0, jenisFee: "PERSEN", nilaiFee: 0, ...lain });
  pastikan(ringkas({ nilaiDiskon: "abc" }).galat === "Diskon tidak valid" && galatDari(() => bacaRingkasanDokumen(formulir({ nilaiDiskon: "abc" }), [{ jumlah: D(1), harga: D(1000) }], "penawaran")) === "Diskon tidak valid", "diskon bukan angka: klien dan server 'Diskon tidak valid'");
  pastikan(ringkas({ nilaiFee: "1,5" }).galat === "Management fee tidak valid", "fee bukan angka: 'Management fee tidak valid'");
  pastikan(ringkas({ jenisFee: "NOMINAL", nilaiFee: "100000000000000.01" }).galat === "Management fee terlalu besar", "fee nominal di atas 1e14: 'Management fee terlalu besar'");
  pastikan(ringkas({ jenisDiskon: "PERSEN", nilaiDiskon: "100.004" }).galat === null && ringkas({ jenisDiskon: "PERSEN", nilaiDiskon: "100.004" }).diskon === 1000, "persen diskon 100,004 dibulatkan dulu menjadi 100 (diterima seperti server)");
  pastikan(pratinjauTerminKlien([{ mode: "SEBAGIAN", nilai: 5 }, {}], 1000).galat === "Mode termin 1 tidak dikenal" && pratinjauTerminKlien([{ mode: "NOMINAL", nilai: "100000000000001" }, {}], 1000).galat === "Nilai termin terlalu besar" && pratinjauTerminKlien([{ nilai: "x" }, {}], 1000).galat === "Nilai termin 1 tidak valid", "galat termin klien: mode tidak dikenal, terlalu besar, tidak valid");
  const modeKosong = pratinjauTerminKlien([{ mode: "", nilai: 30 }, {}], 1000);
  pastikan(modeKosong.butir[0].jumlah === 300 && selesaikanRencana([{ mode: "", nilai: 30 }, {}], D(1000))[0].jumlah.equals(300), "mode kosong dibaca PERSEN di klien dan server");

  console.log("=== 17e. R2: jumlah persen butir selalu 100 ===");
  const r2 = selesaikanRencana([{ mode: "NOMINAL", nilai: 1 }, { mode: "NOMINAL", nilai: 1 }, {}], D(3));
  pastikan(r2.map((b) => teks(b.persen)).join() === "33.33,33.33,33.34" && pratinjauTerminKlien([{ mode: "NOMINAL", nilai: 1 }, { mode: "NOMINAL", nilai: 1 }, {}], 3).butir.map((b) => b.persen).join() === "33.33,33.33,33.34", "basis 3, butir 1, 1, sisa: persen 33,33 + 33,33 + 33,34 = 100 (server dan klien)");

  console.log("=== 17f. R5: diskon warisan faktur penutup dibatasi subtotal faktur ===");
  const pesananR5 = { jenisDiskon: "NOMINAL" as const, nilaiDiskon: D(1_000_000), diskon: D(1_000_000) };
  const ctxR5 = { subtotalPesanan: D(10_000_000), feeLain: NOL, diskonLain: NOL, menutup: true };
  pastikan(sama(diskonWarisan(pesananR5, D(500_000), ctxR5), 500_000), "faktur penutup bersubtotal 500.000 mewarisi diskon 500.000, bukan 1.000.000");
  pastikan(sama(bacaDiskonFaktur(formulir({}), D(500_000), pesananR5, ctxR5).diskon, 500_000), "faktur penutup tanpa isian diskon tidak ditolak 'melebihi subtotal faktur'");
  pastikan(sama(diskonWarisan(pesananR5, D(5_000_000), { ...ctxR5, menutup: false }), 500_000), "faktur bukan penutup tetap prorata (5.000.000 dari 10.000.000 = 500.000)");

  console.log("=== 17g. R6: jatuh tempo dan tampilan event kosong diabaikan ===");
  const kosong = bacaIsianTampilan("faktur", formulir({ jatuhTempo: "", tampilanEvent: "  ", perihal: "x" }));
  pastikan(!kosong.kolom.includes("jatuhTempo") && !kosong.kolom.includes("tampilanEvent") && !("jatuhTempo" in kosong.data) && kosong.kolom.includes("perihal"), "jatuhTempo dan tampilanEvent kosong tidak ikut diubah");
  const terisi = bacaIsianTampilan("faktur", formulir({ jatuhTempo: "2026-12-31", tampilanEvent: "RINGKAS" }));
  pastikan(terisi.kolom.includes("jatuhTempo") && terisi.data.tampilanEvent === "RINGKAS" && terisi.data.jatuhTempo instanceof Date, "jatuhTempo dan tampilanEvent terisi tetap diubah");
  await harusDitolak("jatuh tempo salah tetap ditolak", async () => bacaIsianTampilan("faktur", formulir({ jatuhTempo: "2026-02-30" })), "Jatuh tempo tidak valid");

  console.log("=== 17h. R3: Barang JASA-LAIN wajib bersama ===");
  await diTransaksiBatal(async (tx) => {
    const id = await pastikanBarangLainLain(tx);
    await tx.barang.update({ where: { id }, data: { perusahaanId: "utama" } });
    await harusDitolak("JASA-LAIN milik perusahaan", () => pastikanBarangLainLain(tx), "Barang JASA-LAIN harus jasa bersama (tanpa perusahaan)");
  });

  console.log("=== 17i. R4: batal tagihan termin mengunci butir ===");
  const nomorUji = "UJINB-PSJ-KUNCI";
  try {
    const pesanan = await db.pesananPenjualan.create({ data: { nomor: nomorUji, pelangganId, total: 1_000_000, ppnPersen: 0 } });
    await db.rencanaTermin.createMany({ data: selesaikanRencana([{ label: "DP", nilai: 40 }, { label: "Pelunasan" }], D(1_000_000)).map((b) => ({ ...b, perusahaanId: "utama", pesananId: pesanan.id, ditagihPada: new Date() })) });
    const [t1, t2] = await db.rencanaTermin.findMany({ where: { pesananId: pesanan.id }, orderBy: { no: "asc" } });
    const k = await db.$transaction((tx) => kunciButirTermin(tx, t1.id));
    pastikan(k?.butir.id === t1.id && k.jumlahUangMuka === 0 && D(k.dibayar).isZero() && k.butir.pesanan?.rencanaTermin.length === 2, "kunciButirTermin membaca butir, rencana pesanan, dan uang muka butir");
    pastikan((await db.$transaction((tx) => kunciButirTermin(tx, "tidak-ada"))) === null, "kunciButirTermin butir tidak ada = null");
    // transaksi A memegang kunci butir lalu mencatat uang muka; B (batal tagihan) mulai sesudahnya dan harus menunggu A
    let lepasA: () => void = () => {};
    const tahanA = new Promise<void>((r) => (lepasA = r));
    let kunciA: () => void = () => {};
    const sudahKunci = new Promise<void>((r) => (kunciA = r));
    const a = db.$transaction(async (tx) => {
      await pastikanPembayaranTermin(tx, { rencanaTerminId: t1.id, pesananId: pesanan.id, jumlah: D(400_000) });
      kunciA();
      await tahanA;
      await tx.uangMukaPelanggan.create({ data: { nomor: "UJINB-UM-KUNCI", pelangganId, pesananId: pesanan.id, akunId: akunKasId, jumlah: 400_000, rencanaTerminId: t1.id } });
    }, { timeout: 20_000 });
    await sudahKunci;
    const b = db.$transaction((tx) => pastikanBatalTagihanTermin(tx, t1.id), { timeout: 20_000 }).then(() => null, (e: Error) => e.message);
    await new Promise((r) => setTimeout(r, 300));
    lepasA();
    await a;
    pastikan((await b) === "Termin DP sudah dibayar; hapus uang mukanya dulu", "batal tagihan yang berjalan bersamaan dengan pembayaran menunggu kunci, lalu ditolak karena butir sudah dibayar");
    const lolos = await db.$transaction((tx) => pastikanBatalTagihanTermin(tx, t2.id));
    pastikan(lolos.id === t2.id, "batal tagihan butir tanpa uang muka lolos");
    await harusDitolak("batal tagihan butir tidak ada", () => db.$transaction((tx) => pastikanBatalTagihanTermin(tx, "tidak-ada")), "Termin tidak ditemukan di pesanan ini");
  } finally {
    await db.uangMukaPelanggan.deleteMany({ where: { nomor: "UJINB-UM-KUNCI" } });
    await db.rencanaTermin.deleteMany({ where: { pesanan: { nomor: nomorUji } } });
    await db.pesananPenjualan.deleteMany({ where: { nomor: nomorUji } });
  }
  pastikan((await db.pesananPenjualan.count({ where: { nomor: nomorUji } })) === 0 && (await db.uangMukaPelanggan.count({ where: { nomor: "UJINB-UM-KUNCI" } })) === 0, "data uji kunci termin dibersihkan");
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
