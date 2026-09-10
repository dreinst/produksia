import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { periksaSinkron } from "../src/lib/sinkron";
import { bacaPeriode, hitungLabaRugi, hitungNeraca } from "../src/lib/laporan";
import { ringkasanPenutupan } from "../src/lib/tutupBuku";
import { tutupTahun, bukaKembaliTahun } from "../src/lib/aksi/tutupBuku";
import { buatKasMasuk } from "../src/lib/aksi/jurnal";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";

/*
 * Tutup buku: jurnal penutup memindahkan laba tahun ke Laba Ditahan; Laba Rugi tahun itu tetap terbaca,
 * Neraca tetap seimbang; tahun yang ditutup terkunci (jurnal baru & penghapusan ditolak); buka kembali memulihkan.
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
async function saldo(akunId: string, sampai?: Date) {
  const agg = await db.barisJurnal.aggregate({ where: { akunId, ...(sampai ? { jurnal: { tanggal: { lte: sampai } } } : {}) }, _sum: { debit: true, kredit: true } });
  return n(agg._sum.kredit ?? 0) - n(agg._sum.debit ?? 0);
}

async function main() {
  const mulaiUji = new Date();
  const tahunIni = new Date().getFullYear();
  const tahunLalu = tahunIni - 1;
  const pemetaan = await db.pemetaanAkun.findUniqueOrThrow({ where: { id: "default" } });
  pastikan(pemetaan.labaDitahanId, "pemetaan punya akun Laba Ditahan");
  const labaDitahanId = pemetaan.labaDitahanId!;
  const pengaturanAwal = await db.pengaturanPerusahaan.findUnique({ where: { id: "default" } });
  const kas = await db.akun.findFirstOrThrow({ where: { kasBank: true, kelompok: false }, orderBy: { kode: "asc" } });
  const pendapatan = await db.akun.findFirstOrThrow({ where: { jenis: "PENDAPATAN", kelompok: false }, orderBy: { kode: "desc" } });
  const beban = await db.akun.findFirstOrThrow({ where: { jenis: "BEBAN", kelompok: false }, orderBy: { kode: "desc" } });
  const modal = await db.akun.findFirstOrThrow({ where: { jenis: "MODAL", kelompok: false, id: { not: labaDitahanId } }, orderBy: { kode: "asc" } });

  console.log(`=== Data uji: pendapatan 1.000 & beban 400 bertanggal ${tahunLalu} ===`);
  const buatJurnalLama = (nomor: string, bulan: string, baris: { akunId: string; debit: number; kredit: number }[]) =>
    db.jurnal.create({ data: { nomor: `UJI-TUTUP-${nomor}-${Date.now()}`, tanggal: new Date(`${tahunLalu}-${bulan}T10:00:00`), keterangan: "Uji tutup buku", sumber: "MANUAL", baris: { create: baris } } });
  const j1 = await buatJurnalLama("A", "03-10", [{ akunId: kas.id, debit: 1000, kredit: 0 }, { akunId: pendapatan.id, debit: 0, kredit: 1000 }]);
  const j2 = await buatJurnalLama("B", "08-20", [{ akunId: beban.id, debit: 400, kredit: 0 }, { akunId: kas.id, debit: 0, kredit: 400 }]);
  const saldoLabaDitahanAwal = await saldo(labaDitahanId);

  console.log(`=== 1. Ringkasan & penutupan ${tahunLalu} ===`);
  const ringkasan = await ringkasanPenutupan(db, tahunLalu);
  pastikan(n(ringkasan.totalPendapatan) === 1000 && n(ringkasan.totalBeban) === 400 && n(ringkasan.labaBersih) === 600, `ringkasan ${tahunLalu}: pendapatan 1.000, beban 400, laba 600`);
  await harusDitolak("tutup tahun depan", () => tutupTahun(formulir({ tahun: tahunIni + 1 })), "belum berjalan");
  await harusDitolak("tahun tidak valid", () => tutupTahun(formulir({ tahun: "abc" })), "tidak valid");
  await jalankan(`tutup tahun ${tahunLalu}`, () => tutupTahun(formulir({ tahun: tahunLalu })));
  const tutup = await db.tutupBuku.findUniqueOrThrow({ where: { tahun: tahunLalu }, include: { jurnal: { include: { baris: true } } } });
  pastikan(n(tutup.labaBersih) === 600 && tutup.jurnal?.nomor.startsWith("JU-TUTUP") && tutup.jurnal.sumber === "PENUTUP", `TutupBuku ${tahunLalu} laba 600, jurnal ${tutup.jurnal?.nomor}`);
  pastikan(tutup.jurnal!.tanggal.getFullYear() === tahunLalu && tutup.jurnal!.tanggal.getMonth() === 11 && tutup.jurnal!.tanggal.getDate() === 31, "jurnal penutup bertanggal 31 Desember tahun yang ditutup");
  const b = tutup.jurnal!.baris;
  pastikan(b.some((x) => x.akunId === pendapatan.id && n(x.debit) === 1000) && b.some((x) => x.akunId === beban.id && n(x.kredit) === 400) && b.some((x) => x.akunId === labaDitahanId && n(x.kredit) === 600), "JU-TUTUP: Dr Pendapatan 1.000 / Cr Beban 400 / Cr Laba Ditahan 600");
  pastikan((await saldo(labaDitahanId)) - saldoLabaDitahanAwal === 600, "saldo akun Laba Ditahan bertambah 600");
  await harusDitolak(`tutup ${tahunLalu} dua kali`, () => tutupTahun(formulir({ tahun: tahunLalu })), "sudah ditutup");

  console.log("=== 2. Laporan setelah penutupan ===");
  const periodeLalu = bacaPeriode({ dari: `${tahunLalu}-01-01`, sampai: `${tahunLalu}-12-31` });
  const lrLalu = await hitungLabaRugi(db, periodeLalu);
  pastikan(n(lrLalu.totalPendapatan) >= 1000 && n(lrLalu.labaBersih) === 600, `Laba Rugi ${tahunLalu} tetap 600 (jurnal penutup diabaikan)`);
  const neracaLalu = await hitungNeraca(db, periodeLalu.sampai, periodeLalu.sampaiTeks);
  pastikan(neracaLalu.seimbang && n(neracaLalu.labaBerjalan) === 0 && n(neracaLalu.labaDitahan) === 0, `Neraca per 31 Des ${tahunLalu} seimbang; laba berjalan & laba lalu (dihitung) = 0 karena sudah di akun Laba Ditahan`);
  pastikan(neracaLalu.ekuitas.some((r) => r.id === labaDitahanId && n(r.jumlah) === saldoLabaDitahanAwal + 600), "akun Laba Ditahan tampil di ekuitas neraca dengan 600");
  const periodeIni = bacaPeriode({ dari: `${tahunIni}-01-01`, sampai: `${tahunIni}-12-31` });
  const neracaIni = await hitungNeraca(db, periodeIni.sampai, periodeIni.sampaiTeks);
  pastikan(neracaIni.seimbang && n(neracaIni.labaDitahan) === 0, `Neraca ${tahunIni} seimbang; laba tahun lalu (dihitung) 0 karena ${tahunLalu} sudah ditutup`);
  const s = await periksaSinkron(db);
  pastikan(s.seimbang, "Σ debit = Σ kredit setelah penutupan");

  console.log(`=== 3. Tahun ${tahunIni} ditutup → transaksi baru & penghapusan ditolak; buka kembali memulihkan ===`);
  await jalankan(`tutup tahun ${tahunIni}`, () => tutupTahun(formulir({ tahun: tahunIni })));
  const pengaturanSetelah = await db.pengaturanPerusahaan.findUnique({ where: { id: "default" } });
  pastikan(pengaturanSetelah?.tahunBuku === tahunIni + 1, `tahun buku aktif maju ke ${tahunIni + 1}`);
  await harusDitolak("kas masuk di tahun yang ditutup", () => buatKasMasuk(formulir({ akunKasId: kas.id, akunLawanId: modal.id, jumlah: 1000, keterangan: "uji tutup" })), "sudah ditutup");
  const kmLama = await db.jurnal.findFirst({ where: { sumber: "KAS_MASUK", tanggal: { gte: new Date(`${tahunIni}-01-01T00:00:00`) } } });
  if (kmLama) await harusDitolak("hapus kas masuk di tahun yang ditutup", () => hapusDokumen("jurnal", kmLama.id), "sudah ditutup");
  const jurnalTutupIni = await db.tutupBuku.findUniqueOrThrow({ where: { tahun: tahunIni } });
  if (jurnalTutupIni.jurnalId) await harusDitolak("hapus jurnal penutup lewat menu jurnal", () => hapusDokumen("jurnal", jurnalTutupIni.jurnalId!), "jurnal penutup");
  await jalankan(`buka kembali ${tahunIni}`, () => bukaKembaliTahun(formulir({ tahun: tahunIni })));
  pastikan((await db.tutupBuku.count({ where: { tahun: tahunIni } })) === 0 && (await db.jurnal.count({ where: { sumber: "PENUTUP", tanggal: { gte: new Date(`${tahunIni}-01-01T00:00:00`) } } })) === 0, "catatan & jurnal penutup tahun ini hilang");
  pastikan((await db.pengaturanPerusahaan.findUnique({ where: { id: "default" } }))?.tahunBuku === (pengaturanAwal?.tahunBuku ?? null) || (await db.pengaturanPerusahaan.findUnique({ where: { id: "default" } }))?.tahunBuku === tahunIni, "tahun buku aktif kembali");
  await jalankan("kas masuk boleh lagi", () => buatKasMasuk(formulir({ akunKasId: kas.id, akunLawanId: modal.id, jumlah: 1000, keterangan: "uji tutup" })));
  const kmBaru = await db.jurnal.findFirstOrThrow({ where: { sumber: "KAS_MASUK", keterangan: "uji tutup" } });
  await jalankan("hapus kas masuk uji", () => hapusDokumen("jurnal", kmBaru.id));
  await harusDitolak("buka tahun yang tidak ditutup", () => bukaKembaliTahun(formulir({ tahun: tahunIni })), "tidak dalam keadaan ditutup");

  console.log(`=== 4. Buka kembali ${tahunLalu} & bersih-bersih ===`);
  await jalankan(`buka kembali ${tahunLalu}`, () => bukaKembaliTahun(formulir({ tahun: tahunLalu })));
  pastikan((await saldo(labaDitahanId)) === saldoLabaDitahanAwal, "saldo Laba Ditahan kembali semula");
  await db.pengaturanPerusahaan.update({ where: { id: "default" }, data: { tahunBuku: pengaturanAwal?.tahunBuku ?? null } });
  await db.barisJurnal.deleteMany({ where: { jurnalId: { in: [j1.id, j2.id] } } });
  await db.jurnal.deleteMany({ where: { id: { in: [j1.id, j2.id] } } });
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji } } });
  pastikan((await db.tutupBuku.count()) === 0 && (await db.jurnal.count({ where: { sumber: "PENUTUP" } })) === 0, "tidak ada sisa penutupan");
  const s2 = await periksaSinkron(db);
  pastikan(s2.seimbang && s2.persediaan.sinkron && s2.piutang.sinkron, "sinkron setelah bersih-bersih");
  console.log("=== DONE, all tutup buku checks passed ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
