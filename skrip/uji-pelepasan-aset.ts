import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { periksaSinkron } from "../src/lib/sinkron";
import { buatAsetTetap, jalankanPenyusutanBulanan, lepasAset } from "../src/lib/aksi/asetTetap";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";

/*
 * Pelepasan aset: dijual (laba/rugi vs nilai buku) atau dihapusbukukan; jurnal JU-LPS mengeluarkan aset &
 * akumulasi penyusutan; aset yang dilepas tidak ikut penyusutan; pembatalan memulihkan status & jurnal.
 */
async function jalankan(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    const digest = (err as { digest?: string })?.digest ?? "";
    const pesan = (err as { message?: string })?.message ?? "";
    if (!digest.startsWith("NEXT_REDIRECT") && !pesan.includes("static generation store missing")) throw err;
  }
  console.log(`[ok] ${label}`);
}
function formulir(isian: Record<string, string | number | object>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(isian)) fd.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  return fd;
}
function pastikan(kondisi: unknown, pesan: string) {
  if (!kondisi) {
    console.error(`[FAIL] ${pesan}`);
    process.exit(1);
  }
  console.log(`[ok] ${pesan}`);
}
async function harusDitolak(label: string, fn: () => Promise<unknown>, potongan: string) {
  try {
    await fn();
  } catch (err) {
    const pesan = (err as { message?: string })?.message ?? String(err);
    pastikan(pesan.includes(potongan), `${label} ditolak: "${pesan}"`);
    return;
  }
  console.error(`[FAIL] ${label} TIDAK ditolak`);
  process.exit(1);
}
const n = (v: { toString(): string }) => Number(v);
async function saldoDebit(akunId: string) {
  const agg = await db.barisJurnal.aggregate({ where: { akunId }, _sum: { debit: true, kredit: true } });
  return n(agg._sum.debit ?? 0) - n(agg._sum.kredit ?? 0);
}

async function main() {
  const mulaiUji = new Date();
  const jumlahJurnalAwal = await db.jurnal.count();
  console.log("=== Data uji ===");
  const [kas, akunAset, akum, susut, labaLain, bebanRugi] = await Promise.all([
    db.akun.create({ data: { kode: "LPS-KAS", nama: "Kas Uji Lepas", jenis: "ASET", kasBank: true } }),
    db.akun.create({ data: { kode: "LPS-ASET", nama: "Aset Uji Lepas", jenis: "ASET" } }),
    db.akun.create({ data: { kode: "LPS-AKUM", nama: "Akum Uji Lepas", jenis: "ASET" } }),
    db.akun.create({ data: { kode: "LPS-SUSUT", nama: "Susut Uji Lepas", jenis: "BEBAN" } }),
    db.akun.create({ data: { kode: "LPS-LABA", nama: "Laba Lain Uji Lepas", jenis: "PENDAPATAN" } }),
    db.akun.create({ data: { kode: "LPS-RUGI", nama: "Rugi Uji Lepas", jenis: "BEBAN" } }),
  ]);
  await jalankan("AT 120.000 dibayar kas, umur 12 bulan", () => buatAsetTetap(formulir({ kode: "AT-LPS", nama: "Aset Uji Lepas", tanggalPerolehan: "2020-01-01", hargaPerolehan: 120000, nilaiSisa: 0, umurBulan: 12, akunAsetId: akunAset.id, akunBebanPenyusutanId: susut.id, akunAkumulasiPenyusutanId: akum.id, akunPembayaranId: kas.id })));
  await jalankan("penyusutan periode 2032-01 (10.000)", () => jalankanPenyusutanBulanan(formulir({ periode: "2032-01" })));
  const aset = await db.asetTetap.findUniqueOrThrow({ where: { kode: "AT-LPS" }, include: { penyusutan: true } });
  const akumulasi = aset.penyusutan.reduce((s, p) => s + n(p.jumlah), 0);
  pastikan(akumulasi === 10000, "akumulasi penyusutan 10.000 → nilai buku 110.000");
  // penyusutan periode itu juga mengenai aset seed; jurnalnya dihapus di bersih-bersih
  const jurnalSusut = await db.penyusutanAset.findMany({ where: { periode: new Date("2032-01-01T00:00:00.000Z") }, distinct: ["jurnalId"], select: { jurnalId: true } });

  console.log("=== 1. Penolakan ===");
  await harusDitolak("tanpa aset", () => lepasAset(formulir({ jenis: "DIJUAL", akunLabaRugiId: labaLain.id })), "Aset wajib");
  await harusDitolak("jenis tak dikenal", () => lepasAset(formulir({ asetId: aset.id, jenis: "HILANG", akunLabaRugiId: labaLain.id })), "DIJUAL atau DIHAPUS");
  await harusDitolak("dijual tanpa akun penerima", () => lepasAset(formulir({ asetId: aset.id, jenis: "DIJUAL", hargaJual: 1000, akunLabaRugiId: labaLain.id })), "penerima");
  await harusDitolak("tanggal masa depan", () => lepasAset(formulir({ asetId: aset.id, jenis: "DIJUAL", hargaJual: 0, tanggal: "2099-01-01", akunLabaRugiId: labaLain.id })), "masa depan");
  await harusDitolak("tanggal sebelum perolehan", () => lepasAset(formulir({ asetId: aset.id, jenis: "DIJUAL", hargaJual: 0, tanggal: "2019-12-31", akunLabaRugiId: labaLain.id })), "sebelum tanggal perolehan");

  console.log("=== 2. Dijual 125.000 → laba 15.000 ===");
  await jalankan("lepas: dijual 125.000 ke kas", () => lepasAset(formulir({ asetId: aset.id, jenis: "DIJUAL", hargaJual: 125000, akunPenerimaanId: kas.id, akunLabaRugiId: labaLain.id, keterangan: "uji" })));
  const lepas = await db.pelepasanAset.findUniqueOrThrow({ where: { asetId: aset.id }, include: { jurnal: { include: { baris: true } } } });
  pastikan(n(lepas.nilaiBuku) === 110000 && n(lepas.labaRugi) === 15000 && lepas.jenis === "DIJUAL", "nilai buku 110.000, laba 15.000");
  const b = lepas.jurnal!.baris;
  pastikan(lepas.jurnal!.nomor.startsWith("JU-LPS") && b.some((x) => x.akunId === kas.id && n(x.debit) === 125000) && b.some((x) => x.akunId === akum.id && n(x.debit) === 10000) && b.some((x) => x.akunId === akunAset.id && n(x.kredit) === 120000) && b.some((x) => x.akunId === labaLain.id && n(x.kredit) === 15000), "JU-LPS: Dr Kas 125.000 / Dr Akum 10.000 / Cr Aset 120.000 / Cr Laba 15.000");
  pastikan((await db.asetTetap.findUniqueOrThrow({ where: { id: aset.id } })).status === "DIJUAL", "status aset DIJUAL");
  pastikan((await saldoDebit(akunAset.id)) === 0 && (await saldoDebit(akum.id)) === 0, "akun aset & akumulasi bersih (nol)");
  await harusDitolak("lepas dua kali", () => lepasAset(formulir({ asetId: aset.id, jenis: "DIHAPUS", akunLabaRugiId: labaLain.id })), "sudah dilepas");
  await harusDitolak("hapus aset yang sudah dilepas", () => hapusDokumen("aset", aset.id), "hapus pelepasannya dulu");
  await jalankan("penyusutan 2032-02 melewati aset yang dilepas", () => jalankanPenyusutanBulanan(formulir({ periode: "2032-02" })));
  pastikan((await db.penyusutanAset.count({ where: { asetId: aset.id } })) === 1, "aset yang dilepas tidak disusutkan lagi");
  const jurnalSusut2 = await db.penyusutanAset.findMany({ where: { periode: new Date("2032-02-01T00:00:00.000Z") }, distinct: ["jurnalId"], select: { jurnalId: true } });
  const s1 = await periksaSinkron(db);
  pastikan(s1.seimbang, "Σ debit = Σ kredit setelah pelepasan");

  console.log("=== 3. Batalkan pelepasan → dihapusbukukan (rugi 110.000) ===");
  await jalankan("hapus pelepasan", () => hapusDokumen("pelepasanAset", lepas.id));
  pastikan((await db.asetTetap.findUniqueOrThrow({ where: { id: aset.id } })).status === "AKTIF" && (await db.jurnal.count({ where: { id: lepas.jurnalId! } })) === 0, "aset kembali AKTIF, jurnal pelepasan hilang");
  await jalankan("lepas: dihapusbukukan (rugi ke akun beban)", () => lepasAset(formulir({ asetId: aset.id, jenis: "DIHAPUS", akunLabaRugiId: bebanRugi.id })));
  const lepas2 = await db.pelepasanAset.findUniqueOrThrow({ where: { asetId: aset.id }, include: { jurnal: { include: { baris: true } } } });
  pastikan(n(lepas2.hargaJual) === 0 && n(lepas2.labaRugi) === -110000 && lepas2.jurnal!.baris.some((x) => x.akunId === bebanRugi.id && n(x.debit) === 110000) && !lepas2.jurnal!.baris.some((x) => x.akunId === kas.id), "JU-LPS: Dr Rugi 110.000 / Dr Akum 10.000 / Cr Aset 120.000, tanpa kas");
  pastikan((await db.asetTetap.findUniqueOrThrow({ where: { id: aset.id } })).status === "DIHAPUS", "status aset DIHAPUS");
  pastikan((await db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, jenis: { in: ["Pelepasan Aset"] } } })) === 3, "dua pelepasan + satu pembatalan tercatat di log");

  console.log("=== Bersih-bersih ===");
  await jalankan("hapus pelepasan kedua", () => hapusDokumen("pelepasanAset", lepas2.id));
  for (const j of [...jurnalSusut2, ...jurnalSusut]) if (j.jurnalId) await jalankan(`hapus penyusutan ${j.jurnalId.slice(0, 6)}`, () => hapusDokumen("penyusutan", j.jurnalId!));
  await jalankan("hapus aset uji", () => hapusDokumen("aset", aset.id));
  pastikan((await db.jurnal.count()) === jumlahJurnalAwal, "tidak ada jurnal uji yang tersisa");
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji } } });
  await db.akun.deleteMany({ where: { kode: { startsWith: "LPS-" } } });
  const s2 = await periksaSinkron(db);
  pastikan(s2.seimbang && s2.persediaan.sinkron, "sinkron setelah bersih-bersih");
  console.log("=== DONE, all pelepasan aset checks passed ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
