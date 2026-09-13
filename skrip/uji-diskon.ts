import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { D } from "../src/lib/uang";
import { terapkanBaganAkunStandar } from "../src/lib/baganAkun";
import { buatPesanan, buatFaktur, buatRetur } from "../src/lib/aksi/penjualan";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { periksaSinkron } from "../src/lib/sinkron";
import { ringkasanPajak } from "../src/lib/pajak";
import { formulir, jalankan, pastikan } from "./bantuan";

/*
 * Diskon faktur penjualan (kontra-pendapatan) & omzet bruto:
 * faktur berdiskon → jurnal Dr Piutang (net) / Dr Diskon Penjualan / Cr Pendapatan (bruto); DPP = subtotal − diskon;
 * retur atas faktur berdiskon membalik diskon prorata; omzet Pajak & SPT tetap bruto (sebelum diskon);
 * diskon > subtotal ditolak; hapus dokumen membalik semuanya dan buku besar tetap sinkron.
 */
const n = (v: { toString(): string }) => Number(v);
const dekat = (a: number, b: number) => Math.abs(a - b) < 0.01;

async function harusDitolak(label: string, fn: () => Promise<unknown>, potongan: string) {
  try {
    await fn();
  } catch (err) {
    const pesan = (err as { message?: string })?.message ?? "";
    pastikan(pesan.includes(potongan), `${label}: ditolak dengan pesan yang tepat (${pesan})`);
    return;
  }
  pastikan(false, `${label}: seharusnya ditolak`);
}

async function main() {
  await terapkanBaganAkunStandar(db);
  const pemetaan = await db.pemetaanAkun.findUniqueOrThrow({ where: { id: "default" }, include: { diskonPenjualan: true, pendapatanPenjualan: true, piutangUsaha: true } });
  pastikan(pemetaan.diskonPenjualanId && pemetaan.pendapatanLainId, "pemetaan Diskon Penjualan & Pendapatan Lain-lain terisi dari standar");
  const tag = Date.now();
  const sekarang = new Date();
  const tahun = sekarang.getFullYear(), bulan = sekarang.getMonth() + 1;
  const [gudang, pelanggan, jasa] = await Promise.all([
    db.gudang.create({ data: { kode: `GD-DISKON-${tag}`, nama: "Gudang Uji Diskon" } }),
    db.pelanggan.create({ data: { kode: `PLG-DISKON-${tag}`, nama: "Pelanggan Uji Diskon" } }),
    db.barang.create({ data: { kode: `JSA-DISKON-${tag}`, nama: "Jasa Uji Diskon", jenis: "JASA", satuan: "paket", hargaBeli: 0, hargaJual: 50000 } }),
  ]);
  const pajakSebelum = (await ringkasanPajak(db, tahun, D("0.5"))).bulan[bulan - 1];
  const sinkronAwal = await periksaSinkron(db);
  pastikan(sinkronAwal.piutang.sinkron, "piutang sinkron sebelum uji");

  let pesananId: string | null = null, fakturId: string | null = null, returId: string | null = null;
  try {
    console.log("=== 1. Faktur berdiskon: jurnal, DPP, total ===");
    await jalankan("buatPesanan", () => buatPesanan(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: jasa.id, jumlah: 2, harga: 50000 }] })));
    const pesanan = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id } });
    pesananId = pesanan.id;
    await harusDitolak("diskon melebihi subtotal", () => buatFaktur(formulir({ pesananId: pesanan.id, baris: [{ barangId: jasa.id, jumlah: 2, harga: 50000 }], diskon: 200000 })), "melebihi subtotal");
    await jalankan("buatFaktur diskon 10.000", () => buatFaktur(formulir({ pesananId: pesanan.id, baris: [{ barangId: jasa.id, jumlah: 2, harga: 50000 }], diskon: 10000 })));
    const faktur = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: pesanan.id }, include: { jurnal: { include: { baris: true } } } });
    fakturId = faktur.id;
    pastikan(dekat(n(faktur.diskon), 10000) && dekat(n(faktur.dpp), 90000) && dekat(n(faktur.ppn), 0) && dekat(n(faktur.total), 90000), `faktur: diskon 10.000, dpp 90.000, total 90.000 (${n(faktur.diskon)}/${n(faktur.dpp)}/${n(faktur.total)})`);
    const cari = (akunId: string) => faktur.jurnal!.baris.filter((b) => b.akunId === akunId);
    pastikan(dekat(n(cari(pemetaan.piutangUsahaId)[0]?.debit ?? 0), 90000), "jurnal: Dr Piutang 90.000 (net)");
    pastikan(dekat(n(cari(pemetaan.diskonPenjualanId!)[0]?.debit ?? 0), 10000), "jurnal: Dr Diskon Penjualan 10.000");
    pastikan(dekat(n(cari(pemetaan.pendapatanPenjualanId)[0]?.kredit ?? 0), 100000), "jurnal: Cr Pendapatan 100.000 (bruto)");
    const sinkron1 = await periksaSinkron(db);
    pastikan(sinkron1.seimbang && sinkron1.piutang.sinkron, "buku besar seimbang & piutang = dokumen setelah faktur berdiskon");

    console.log("=== 2. Retur atas faktur berdiskon: diskon dibalik prorata ===");
    await jalankan("buatRetur 1 dari 2", () => buatRetur(formulir({ fakturId: faktur.id, gudangId: gudang.id, alasan: "uji", baris: [{ barangId: jasa.id, jumlah: 1 }] })));
    const retur = await db.returPenjualan.findFirstOrThrow({ where: { fakturId: faktur.id }, include: { jurnal: { include: { baris: true } } } });
    returId = retur.id;
    pastikan(dekat(n(retur.diskon), 5000) && dekat(n(retur.dpp), 45000) && dekat(n(retur.total), 45000), `retur: diskon prorata 5.000, dpp 45.000, total 45.000 (${n(retur.diskon)}/${n(retur.dpp)}/${n(retur.total)})`);
    const cariR = (akunId: string) => retur.jurnal!.baris.filter((b) => b.akunId === akunId);
    pastikan(dekat(n(cariR(pemetaan.pendapatanPenjualanId)[0]?.debit ?? 0), 50000), "jurnal retur: Dr Pendapatan 50.000 (bruto)");
    pastikan(dekat(n(cariR(pemetaan.diskonPenjualanId!)[0]?.kredit ?? 0), 5000), "jurnal retur: Cr Diskon Penjualan 5.000");
    pastikan(dekat(n(cariR(pemetaan.piutangUsahaId)[0]?.kredit ?? 0), 45000), "jurnal retur: Cr Piutang 45.000");
    const fakturSetelah = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: faktur.id } });
    pastikan(fakturSetelah.status === "SEBAGIAN", `status faktur setelah retur separuh = SEBAGIAN (${fakturSetelah.status})`);
    const sinkron2 = await periksaSinkron(db);
    pastikan(sinkron2.seimbang && sinkron2.piutang.sinkron, "buku besar seimbang & piutang sinkron setelah retur");

    console.log("=== 3. Omzet Pajak & SPT tetap bruto (sebelum diskon) ===");
    const pajakSesudah = (await ringkasanPajak(db, tahun, D("0.5"))).bulan[bulan - 1];
    pastikan(dekat(n(pajakSesudah.omzetFaktur) - n(pajakSebelum.omzetFaktur), 50000), `omzet dari faktur bertambah 100.000 − 50.000 = 50.000 (${n(pajakSesudah.omzetFaktur) - n(pajakSebelum.omzetFaktur)})`);
    pastikan(dekat(n(pajakSesudah.omzet) - n(pajakSebelum.omzet), 50000), `omzet buku besar bertambah 50.000, diskon tidak mengurangi (${n(pajakSesudah.omzet) - n(pajakSebelum.omzet)})`);
    pastikan(dekat(n(pajakSesudah.omzetLain), n(pajakSebelum.omzetLain)), "omzet di luar faktur tidak berubah");

    console.log("=== 4. Hapus dokumen membalik semuanya ===");
    await jalankan("hapus retur", () => hapusDokumen("returPenjualan", retur.id));
    returId = null;
    await jalankan("hapus faktur", () => hapusDokumen("faktur", faktur.id));
    fakturId = null;
    await jalankan("hapus pesanan", () => hapusDokumen("pesanan", pesanan.id));
    pesananId = null;
    pastikan((await db.jurnal.count({ where: { id: { in: [faktur.jurnalId!, retur.jurnalId!] } } })) === 0, "jurnal faktur & retur terhapus");
    const pajakAkhir = (await ringkasanPajak(db, tahun, D("0.5"))).bulan[bulan - 1];
    pastikan(dekat(n(pajakAkhir.omzet), n(pajakSebelum.omzet)), "omzet kembali seperti semula");
    const sinkronAkhir = await periksaSinkron(db);
    pastikan(sinkronAkhir.seimbang && sinkronAkhir.piutang.sinkron, "buku besar seimbang & piutang sinkron setelah hapus");
    console.log("=== DONE, all diskon checks passed ===");
  } finally {
    if (returId) await hapusDokumen("returPenjualan", returId).catch(() => {});
    if (fakturId) await hapusDokumen("faktur", fakturId).catch(() => {});
    if (pesananId) await hapusDokumen("pesanan", pesananId).catch(() => {});
    await db.barang.delete({ where: { id: jasa.id } }).catch(() => {});
    await db.pelanggan.delete({ where: { id: pelanggan.id } }).catch(() => {});
    await db.gudang.delete({ where: { id: gudang.id } }).catch(() => {});
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
