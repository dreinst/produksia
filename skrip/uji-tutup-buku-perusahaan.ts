import "dotenv/config";
// Skrip ini memanggil pustaka dan aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { D, jumlahkan } from "../src/lib/uang";
import { PERUSAHAAN_UTAMA } from "../src/lib/perusahaan";
import { catatJurnal } from "../src/lib/akuntansi";
import { saldoAkunPeriode } from "../src/lib/laporan";
import { periksaSinkron } from "../src/lib/sinkron";
import { akhirTahun, awalTahun, barisJurnalPenutup, pratinjauTutupBuku, ringkasanPenutupan, ringkasanPenutupanPerPerusahaan } from "../src/lib/tutupBuku";
import { bukaKembaliTahun, tutupTahun } from "../src/lib/aksi/tutupBuku";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { formulir, harusDitolak, jalankan, pastikan } from "./bantuan";

/*
 * Uji tutup buku serentak per perusahaan (P12, D1 §4.3, K4, §9.1 kasus 29 dan 30). Jurnal tahun lalu dibuat langsung
 * di utama dan tiga perusahaan uji: satu laba, satu rugi, satu laba nol dengan saldo. tutupTahun membuat satu JU-TUTUP
 * per perusahaan bersaldo (seimbang, milik perusahaan itu) dan satu baris TutupBukuPerusahaan per jurnal; perusahaan
 * tanpa saldo tidak mendapat jurnal; tahun tertutup menolak jurnal semua perusahaan; Laba Ditahan milik perusahaan
 * lain ditolak dengan pesan yang menyebut perusahaannya; bukaKembaliTahun menghapus semua jurnal penutup, termasuk
 * tutup buku lama tanpa rincian. Data uji berkode UJITB dihapus di awal dan di akhir; periksaSinkron(db) seimbang.
 */

const KODE = "UJITB";
/** Tahun tanpa data untuk menguji tutup buku lama (sebelum multi perusahaan) yang tidak punya baris rincian. */
const TAHUN_LAMA = 2002;
const tahunLalu = new Date().getFullYear() - 1;
const sama = (a: { toString(): string } | null | undefined, b: { toString(): string } | number) => D(a?.toString() ?? 0).equals(D(b.toString()));
const awalUji = new Date();

/** Menjalankan fn dengan UJI_PERAN sementara. */
async function sebagaiPeran<T>(peran: string, fn: () => Promise<T>): Promise<T> {
  const lama = process.env.UJI_PERAN;
  process.env.UJI_PERAN = peran;
  try {
    return await fn();
  } finally {
    if (lama === undefined) delete process.env.UJI_PERAN;
    else process.env.UJI_PERAN = lama;
  }
}

async function hapusJurnalLangsung(jurnalIds: string[]) {
  if (jurnalIds.length === 0) return;
  await db.barisJurnal.deleteMany({ where: { jurnalId: { in: jurnalIds } } });
  await db.jurnal.deleteMany({ where: { id: { in: jurnalIds } } });
}

async function bersihkanData() {
  const pt = (await db.perusahaan.findMany({ where: { kode: { startsWith: KODE } }, select: { id: true } })).map((p) => p.id);
  // sisa uji yang gagal di tengah: tahun lalu yang ditutup bersama perusahaan uji dibuka lewat aksinya
  for (const t of await db.tutupBuku.findMany({ where: { OR: [{ tahun: TAHUN_LAMA }, { rincianPerusahaan: { some: { perusahaanId: { in: pt } } } }] }, select: { tahun: true } })) {
    await jalankan(`buka sisa tutup buku ${t.tahun}`, () => bukaKembaliTahun(formulir({ tahun: t.tahun })));
  }
  const akunUji = (await db.akun.findMany({ where: { kode: { startsWith: `${KODE}-` } }, select: { id: true } })).map((a) => a.id);
  const jurnalUji = await db.jurnal.findMany({ where: { OR: [{ nomor: { startsWith: `${KODE}-` } }, { perusahaanId: { in: pt } }, { baris: { some: { akunId: { in: akunUji } } } }] }, select: { id: true } });
  await hapusJurnalLangsung(jurnalUji.map((j) => j.id));
  await db.akun.deleteMany({ where: { kode: { startsWith: `${KODE}-` } } });
  await db.perusahaan.deleteMany({ where: { id: { in: pt } } });
  await db.logAktivitas.deleteMany({ where: { jenis: "Tutup Buku", nomor: { in: [`TAHUN ${tahunLalu}`, `TAHUN ${TAHUN_LAMA}`] }, waktu: { gte: awalUji } } });
}

async function main() {
  await bersihkanData();
  const tutupLaluAda = await db.tutupBuku.findUnique({ where: { tahun: tahunLalu } });
  if (tutupLaluAda) throw new Error(`Tahun ${tahunLalu} sudah ditutup di basis data ini; uji tutup buku perusahaan butuh tahun lalu yang terbuka`);
  const awalHakAksesPeran = await db.hakAksesPeran.count();
  const jumlahJurnalAwal = await db.jurnal.count();
  const jumlahRincianAwal = await db.tutupBukuPerusahaan.count();
  const pengaturanAwal = await db.pengaturanPerusahaan.findUnique({ where: { id: "default" }, select: { tahunBuku: true } });
  const sinkronAwal = await periksaSinkron(db);
  pastikan(sinkronAwal.seimbang, "buku besar seimbang sebelum uji");
  const pemetaan = await db.pemetaanAkun.findUniqueOrThrow({ where: { id: "default" } });
  pastikan(pemetaan.labaDitahanId, "pemetaan punya akun Laba Ditahan");
  const labaDitahanId = pemetaan.labaDitahanId!;

  console.log(`=== 1. Data uji tahun ${tahunLalu}: utama, laba, rugi, laba nol ===`);
  const buatPt = (akhiran: string, nama: string, urutan: number) => db.perusahaan.create({ data: { kode: `${KODE}${akhiran}`, nama, urutan } });
  const u1 = await buatPt("1", "PT Uji Tutup Laba", 97);
  const u2 = await buatPt("2", "PT Uji Tutup Rugi", 98);
  const u3 = await buatPt("3", "PT Uji Tutup Impas", 99);
  const ujiIds = [u1.id, u2.id, u3.id];
  const akunBaru = (kode: string, nama: string, jenis: "ASET" | "PENDAPATAN" | "BEBAN" | "MODAL", perusahaanId: string | null) =>
    db.akun.create({ data: { kode: `${KODE}-${kode}`, nama, jenis, kasBank: jenis === "ASET", perusahaanId } });
  const kasUt = await akunBaru("KAS-UT", "Kas Uji Tutup Utama", "ASET", PERUSAHAAN_UTAMA);
  const kas1 = await akunBaru("KAS-1", "Kas Uji Tutup Laba", "ASET", u1.id);
  const kas2 = await akunBaru("KAS-2", "Kas Uji Tutup Rugi", "ASET", u2.id);
  const kas3 = await akunBaru("KAS-3", "Kas Uji Tutup Impas", "ASET", u3.id);
  const pend = await akunBaru("PEND", "Pendapatan Uji Tutup", "PENDAPATAN", null);
  const beban = await akunBaru("BEBAN", "Beban Uji Tutup", "BEBAN", null);
  let urut = 0;
  const jurnalLama = (perusahaanId: string, bulan: string, debit: string, kredit: string, nilai: number) =>
    db.jurnal.create({
      data: {
        nomor: `${KODE}-${++urut}`,
        tanggal: new Date(`${tahunLalu}-${bulan}T10:00:00`),
        keterangan: "Uji tutup buku per perusahaan",
        sumber: "MANUAL",
        perusahaanId,
        baris: { create: [{ akunId: debit, debit: nilai, kredit: 0 }, { akunId: kredit, debit: 0, kredit: nilai }] },
      },
    });
  // D1 §9.1 kasus 29: U Dr Kas / Cr Pendapatan 1.000, utama 400
  const jurnalLamaU1 = await jurnalLama(u1.id, "03-10", kas1.id, pend.id, 1000);
  await jurnalLama(PERUSAHAAN_UTAMA, "03-11", kasUt.id, pend.id, 400);
  await jurnalLama(u2.id, "04-01", kas2.id, pend.id, 300);
  await jurnalLama(u2.id, "05-01", beban.id, kas2.id, 500);
  await jurnalLama(u3.id, "06-01", kas3.id, pend.id, 500);
  await jurnalLama(u3.id, "07-01", beban.id, kas3.id, 500);

  console.log("=== 2. Ringkasan dan pratinjau per perusahaan ===");
  const gabunganAwal = await ringkasanPenutupan(db, tahunLalu);
  const utamaAwal = await ringkasanPenutupan(db, tahunLalu, PERUSAHAAN_UTAMA);
  const r1 = await ringkasanPenutupan(db, tahunLalu, u1.id);
  const r2 = await ringkasanPenutupan(db, tahunLalu, u2.id);
  const r3 = await ringkasanPenutupan(db, tahunLalu, u3.id);
  pastikan(sama(r1.labaBersih, 1000) && r1.pendapatan.length === 1 && r1.beban.length === 0 && r1.jumlahJurnal === 1, "ringkasan perusahaan laba: pendapatan 1.000, satu jurnal");
  pastikan(sama(r2.labaBersih, -200) && sama(r2.totalPendapatan, 300) && sama(r2.totalBeban, 500) && r2.jumlahJurnal === 2, "ringkasan perusahaan rugi: 300 - 500 = -200");
  pastikan(r3.labaBersih.isZero() && sama(r3.totalPendapatan, 500) && sama(r3.totalBeban, 500), "ringkasan perusahaan impas: laba 0 dengan saldo pendapatan dan beban");
  pastikan(utamaAwal.pendapatan.some((b) => b.akunId === pend.id && sama(b.saldo, 400)), "ringkasan utama memuat pendapatan uji 400 saja");
  const perPerusahaan = await ringkasanPenutupanPerPerusahaan(db, tahunLalu);
  pastikan(sama(jumlahkan(perPerusahaan.map((x) => x.ringkasan.labaBersih)), gabunganAwal.labaBersih), "Σ laba per perusahaan = laba gabungan");
  const pratinjau = await pratinjauTutupBuku(db, tahunLalu);
  const idPratinjau = pratinjau.map((x) => x.perusahaan.id);
  pastikan(ujiIds.every((id) => idPratinjau.includes(id)) && idPratinjau.includes(PERUSAHAAN_UTAMA), "pratinjau memuat utama dan ketiga perusahaan uji (laba nol tetap tampil karena bersaldo)");
  pastikan(pratinjau.every((x) => x.ringkasan.pendapatan.length + x.ringkasan.beban.length > 0) && new Set(idPratinjau).size === idPratinjau.length, "pratinjau: satu baris per perusahaan bersaldo");
  const tanpaSaldo = perPerusahaan.filter((x) => x.ringkasan.pendapatan.length + x.ringkasan.beban.length === 0).map((x) => x.perusahaan.id);
  pastikan(tanpaSaldo.length > 0 && tanpaSaldo.every((id) => !idPratinjau.includes(id)), `perusahaan tanpa saldo tidak tampil di pratinjau (${tanpaSaldo.length} perusahaan)`);
  pastikan(sama(pratinjau.find((x) => x.perusahaan.id === u2.id)!.ringkasan.labaBersih, -200), "pratinjau perusahaan rugi -200");
  const baris2 = barisJurnalPenutup(r2, labaDitahanId);
  pastikan(sama(jumlahkan(baris2.map((b) => b.debit)), jumlahkan(baris2.map((b) => b.kredit))) && baris2.some((b) => b.akunId === labaDitahanId && sama(b.debit, 200)), "barisJurnalPenutup rugi: seimbang, Dr Laba Ditahan 200");
  pastikan(!barisJurnalPenutup(r3, labaDitahanId).some((b) => b.akunId === labaDitahanId), "barisJurnalPenutup impas: tanpa baris Laba Ditahan");

  console.log("=== 3. Hak dan Laba Ditahan milik perusahaan lain ===");
  await sebagaiPeran("KASIR", () => harusDitolak("KASIR menutup tahun", () => tutupTahun(formulir({ tahun: tahunLalu })), "tidak punya hak"));
  // Laba Ditahan milik utama: utama lolos, perusahaan uji pertama yang bersaldo ditolak dan seluruh tutup buku batal
  const ldUtama = await akunBaru("LD-UT", "Laba Ditahan Uji Utama", "MODAL", PERUSAHAAN_UTAMA);
  await db.pemetaanAkun.update({ where: { id: "default" }, data: { labaDitahanId: ldUtama.id } });
  try {
    await harusDitolak("Laba Ditahan milik utama dipakai perusahaan uji", () => tutupTahun(formulir({ tahun: tahunLalu })), `Tutup buku ${KODE}1 ${u1.nama}: Akun ${KODE}-LD-UT Laba Ditahan Uji Utama milik`);
  } finally {
    await db.pemetaanAkun.update({ where: { id: "default" }, data: { labaDitahanId } });
  }
  pastikan((await db.tutupBuku.count({ where: { tahun: tahunLalu } })) === 0 && (await db.jurnal.count({ where: { sumber: "PENUTUP", tanggal: { gte: awalTahun(tahunLalu), lte: akhirTahun(tahunLalu) } } })) === 0, "tutup buku yang gagal tidak menyisakan TutupBuku maupun JU-TUTUP (termasuk milik utama)");

  console.log(`=== 4. Tutup buku serentak ${tahunLalu} (D1 §9.1 kasus 29) ===`);
  await jalankan(`tutup tahun ${tahunLalu}`, () => tutupTahun(formulir({ tahun: tahunLalu })));
  const tutup = await db.tutupBuku.findUniqueOrThrow({ where: { tahun: tahunLalu }, include: { rincianPerusahaan: { include: { jurnal: { include: { baris: true } } } } } });
  const rincian = new Map(tutup.rincianPerusahaan.map((r) => [r.perusahaanId, r]));
  pastikan(sama(tutup.labaBersih, gabunganAwal.labaBersih), `TutupBuku.labaBersih = laba gabungan (${tutup.labaBersih})`);
  pastikan(tutup.rincianPerusahaan.length === pratinjau.length && idPratinjau.every((id) => rincian.has(id)), `satu baris TutupBukuPerusahaan per perusahaan bersaldo (${tutup.rincianPerusahaan.length})`);
  pastikan(tanpaSaldo.every((id) => !rincian.has(id)), "perusahaan tanpa saldo tidak mendapat jurnal penutup");
  pastikan(tutup.jurnalId !== null && tutup.jurnalId === rincian.get(PERUSAHAAN_UTAMA)?.jurnalId, "TutupBuku.jurnalId = JU-TUTUP utama");
  for (const r of tutup.rincianPerusahaan) {
    const j = r.jurnal!;
    pastikan(j.perusahaanId === r.perusahaanId && j.sumber === "PENUTUP" && j.nomor.startsWith("JU-TUTUP") && j.tanggal.getTime() === akhirTahun(tahunLalu).getTime(), `JU-TUTUP ${j.nomor} milik perusahaannya, bertanggal 31 Desember`);
    pastikan(sama(jumlahkan(j.baris.map((b) => b.debit)), jumlahkan(j.baris.map((b) => b.kredit))), `JU-TUTUP ${j.nomor} seimbang`);
  }
  const j1 = rincian.get(u1.id)!, j2 = rincian.get(u2.id)!, j3 = rincian.get(u3.id)!;
  pastikan(sama(j1.labaBersih, 1000) && j1.jurnal!.baris.length === 2 && j1.jurnal!.baris.some((b) => b.akunId === pend.id && sama(b.debit, 1000)) && j1.jurnal!.baris.some((b) => b.akunId === labaDitahanId && sama(b.kredit, 1000)), "perusahaan laba: Dr Pendapatan 1.000 / Cr Laba Ditahan 1.000");
  pastikan(!!j1.jurnal!.keterangan?.startsWith(`Jurnal penutup tahun buku ${tahunLalu} ${KODE}1 (laba bersih `), `keterangan perusahaan lain memuat kodenya: "${j1.jurnal!.keterangan}"`);
  pastikan(sama(j2.labaBersih, -200) && j2.jurnal!.baris.some((b) => b.akunId === beban.id && sama(b.kredit, 500)) && j2.jurnal!.baris.some((b) => b.akunId === labaDitahanId && sama(b.debit, 200)), "perusahaan rugi: Cr Beban 500, Dr Laba Ditahan 200");
  pastikan(j3.labaBersih.isZero() && j3.jurnal!.baris.length === 2 && !j3.jurnal!.baris.some((b) => b.akunId === labaDitahanId), "perusahaan impas: jurnal penutup tanpa Laba Ditahan, rincian laba 0");
  const jUtama = rincian.get(PERUSAHAAN_UTAMA)!.jurnal!;
  pastikan(!!jUtama.keterangan?.startsWith(`Jurnal penutup tahun buku ${tahunLalu} (laba bersih `) && sama(rincian.get(PERUSAHAAN_UTAMA)!.labaBersih, utamaAwal.labaBersih), "keterangan dan laba JU-TUTUP utama sama dengan sebelum multi perusahaan");
  const log = await db.logAktivitas.findFirst({ where: { aksi: "TUTUP", nomor: `TAHUN ${tahunLalu}`, waktu: { gte: awalUji } }, orderBy: { waktu: "desc" } });
  pastikan(log?.keterangan?.endsWith(`; ${tutup.rincianPerusahaan.length} perusahaan`), `log tutup buku menyebut jumlah perusahaan: "${log?.keterangan}"`);
  // Neraca perusahaan laba per 31 Desember: pendapatan dan beban nol, buku seimbang
  const saldo1 = await saldoAkunPeriode(db, awalTahun(tahunLalu), akhirTahun(tahunLalu), false, { perusahaanId: u1.id });
  const labaBerjalan1 = jumlahkan(saldo1.filter((a) => !a.kelompok && a.jenis === "PENDAPATAN").map((a) => a.saldo)).minus(jumlahkan(saldo1.filter((a) => !a.kelompok && a.jenis === "BEBAN").map((a) => a.saldo)));
  pastikan(labaBerjalan1.isZero() && saldo1.some((a) => a.id === labaDitahanId && sama(a.saldo, 1000)), "perusahaan laba sesudah tutup: laba berjalan 0, Laba Ditahan 1.000");
  for (const id of [...ujiIds, PERUSAHAAN_UTAMA]) pastikan((await periksaSinkron(db, { perusahaanId: id })).seimbang, `buku ${id === PERUSAHAAN_UTAMA ? "utama" : id} seimbang sesudah tutup buku`);
  pastikan((await periksaSinkron(db)).seimbang, "buku gabungan seimbang sesudah tutup buku");
  pastikan((await ringkasanPenutupan(db, tahunLalu, u1.id)).labaBersih.equals(r1.labaBersih), "ringkasan penutupan tetap membaca laba tahun itu (jurnal penutup diabaikan)");

  console.log("=== 5. Tahun tertutup menolak jurnal semua perusahaan ===");
  await harusDitolak("tutup tahun yang sama dua kali", () => tutupTahun(formulir({ tahun: tahunLalu })), "sudah ditutup");
  await harusDitolak("hapus jurnal lama perusahaan uji", () => hapusDokumen("jurnal", jurnalLamaU1.id), "sudah ditutup");
  await harusDitolak("hapus JU-TUTUP perusahaan uji lewat jurnal", () => hapusDokumen("jurnal", j1.jurnalId!), "jurnal penutup");
  const jurnalTertutup = (perusahaanId: string, kas: string) =>
    db.$transaction((tx) => catatJurnal(tx, "JU", "Uji tahun tertutup", "PENJUALAN", [{ akunId: kas, debit: D(10), kredit: D(0), keterangan: "Uji" }, { akunId: pend.id, debit: D(0), kredit: D(10), keterangan: "Uji" }], { perusahaanId, tanggal: new Date(`${tahunLalu}-09-01T10:00:00`) }));
  await harusDitolak("jurnal perusahaan uji di tahun tertutup", () => jurnalTertutup(u2.id, kas2.id), `Tahun buku ${tahunLalu} sudah ditutup (jurnal penutup ${jUtama.nomor})`);
  await harusDitolak("jurnal utama di tahun tertutup", () => jurnalTertutup(PERUSAHAAN_UTAMA, kasUt.id), "sudah ditutup");
  await sebagaiPeran("KASIR", () => harusDitolak("KASIR membuka tahun", () => bukaKembaliTahun(formulir({ tahun: tahunLalu })), "tidak punya hak"));

  console.log(`=== 6. Buka kembali ${tahunLalu} (D1 §9.1 kasus 30) ===`);
  const idPenutup = tutup.rincianPerusahaan.map((r) => r.jurnalId!);
  await jalankan(`buka kembali ${tahunLalu}`, () => bukaKembaliTahun(formulir({ tahun: tahunLalu })));
  pastikan((await db.jurnal.count({ where: { id: { in: idPenutup } } })) === 0 && (await db.barisJurnal.count({ where: { jurnalId: { in: idPenutup } } })) === 0, `semua ${idPenutup.length} JU-TUTUP terhapus beserta barisnya`);
  pastikan((await db.tutupBuku.count({ where: { tahun: tahunLalu } })) === 0 && (await db.tutupBukuPerusahaan.count()) === jumlahRincianAwal, "TutupBuku dan rinciannya terhapus");
  pastikan((await db.pengaturanPerusahaan.findUnique({ where: { id: "default" }, select: { tahunBuku: true } }))?.tahunBuku === pengaturanAwal?.tahunBuku, "tahun buku aktif sama dengan sebelum uji");
  await jalankan("jurnal perusahaan uji boleh lagi sesudah dibuka", async () => {
    const j = await jurnalTertutup(u2.id, kas2.id);
    if (j) await hapusJurnalLangsung([j.id]);
  });

  console.log("=== 7. Tutup buku lama tanpa rincian tetap bisa dibuka ===");
  const jurnalTutupLama = await db.jurnal.create({ data: { nomor: `${KODE}-TUTUP-LAMA`, tanggal: akhirTahun(TAHUN_LAMA), keterangan: "Jurnal penutup lama", sumber: "PENUTUP", baris: { create: [{ akunId: pend.id, debit: 5, kredit: 0 }, { akunId: labaDitahanId, debit: 0, kredit: 5 }] } } });
  await db.tutupBuku.create({ data: { tahun: TAHUN_LAMA, labaBersih: 5, penggunaNama: "uji", jurnalId: jurnalTutupLama.id } });
  await jalankan(`buka kembali ${TAHUN_LAMA}`, () => bukaKembaliTahun(formulir({ tahun: TAHUN_LAMA })));
  pastikan((await db.tutupBuku.count({ where: { tahun: TAHUN_LAMA } })) === 0 && (await db.jurnal.count({ where: { id: jurnalTutupLama.id } })) === 0, "tutup buku lama: jurnal penutupnya ikut terhapus");

  console.log("=== 8. Kunci tahun: klik ganda dan balapan dengan jurnal baru (tinjauan P12 R3) ===");
  const jumlahPenutupTahun = () => db.jurnal.count({ where: { sumber: "PENUTUP", tanggal: { gte: awalTahun(tahunLalu), lte: akhirTahun(tahunLalu) } } });
  // revalidatePath hanya berjalan di dalam permintaan HTTP; galat itu berarti aksi sudah selesai (pola jalankan di bantuan.ts)
  const hasil = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => ((e as Error)?.message?.includes("static generation store missing") ? null : (e as Error)));
  const [tutupA, tutupB] = await Promise.all([hasil(tutupTahun(formulir({ tahun: tahunLalu }))), hasil(tutupTahun(formulir({ tahun: tahunLalu })))]);
  const galatTutup = [tutupA, tutupB].filter((g): g is Error => g !== null);
  pastikan(galatTutup.length === 1 && galatTutup[0].message === `Tahun buku ${tahunLalu} sudah ditutup`, `klik ganda Tutup: satu berhasil, satu ditolak "sudah ditutup" (${galatTutup.map((g) => g.message).join(" | ")})`);
  const tutupGanda = await db.tutupBuku.findUniqueOrThrow({ where: { tahun: tahunLalu }, include: { rincianPerusahaan: true } });
  pastikan((await jumlahPenutupTahun()) === tutupGanda.rincianPerusahaan.length && tutupGanda.rincianPerusahaan.length === pratinjau.length, "klik ganda Tutup: JU-TUTUP tidak dobel");
  const [bukaA, bukaB] = await Promise.all([hasil(bukaKembaliTahun(formulir({ tahun: tahunLalu }))), hasil(bukaKembaliTahun(formulir({ tahun: tahunLalu })))]);
  const galatBuka = [bukaA, bukaB].filter((g): g is Error => g !== null);
  pastikan(galatBuka.length === 1 && galatBuka[0].message === `Tahun buku ${tahunLalu} tidak dalam keadaan ditutup`, `klik ganda Buka kembali: satu berhasil, satu ditolak "tidak dalam keadaan ditutup" (${galatBuka.map((g) => g.message).join(" | ")})`);
  pastikan((await db.tutupBuku.count({ where: { tahun: tahunLalu } })) === 0 && (await jumlahPenutupTahun()) === 0, "klik ganda Buka kembali: tahun terbuka tanpa JU-TUTUP tersisa");

  // Balapan: transaksi jurnal T1 sudah lolos pastikanTahunTerbuka tetapi belum commit saat tutup buku dimulai. Tutup buku
  // harus menunggu T1 dan ikut menolkan jurnalnya. Jurnal T2 yang datang saat tutup buku menunggu harus ditolak sesudahnya.
  const tungguPenunggu = async (n: number) => {
    for (let i = 0; i < 200; i++) {
      const [{ jumlah }] = await db.$queryRaw<{ jumlah: number }[]>`SELECT count(*)::int AS jumlah FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid = ${tahunLalu}::int::oid AND objsubid = 2`;
      if (jumlah >= n) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Tidak ada ${n} transaksi yang menunggu kunci tahun ${tahunLalu}; tutup buku tidak menunggu jurnal yang sedang berjalan`);
  };
  let lepasT1!: () => void;
  const gerbangT1 = new Promise<void>((r) => (lepasT1 = r));
  let t1Siap!: () => void;
  const sinyalT1 = new Promise<void>((r) => (t1Siap = r));
  const jurnalBalapan = (tx: Parameters<typeof catatJurnal>[0], perusahaanId: string, kas: string) =>
    catatJurnal(tx, "JU", "Uji balapan tutup buku", "PENJUALAN", [{ akunId: kas, debit: D(50), kredit: D(0), keterangan: "Uji" }, { akunId: pend.id, debit: D(0), kredit: D(50), keterangan: "Uji" }], { perusahaanId, tanggal: new Date(`${tahunLalu}-09-02T10:00:00`) });
  const t1 = hasil(db.$transaction(async (tx) => { await jurnalBalapan(tx, u1.id, kas1.id); t1Siap(); await gerbangT1; }, { timeout: 30_000 }));
  let hTutup: Promise<Error | null> = Promise.resolve(null), hT2: Promise<Error | null> = Promise.resolve(null);
  try {
    await sinyalT1;
    hTutup = hasil(tutupTahun(formulir({ tahun: tahunLalu })));
    await tungguPenunggu(1);
    hT2 = hasil(db.$transaction((tx) => jurnalBalapan(tx, u2.id, kas2.id)));
    await tungguPenunggu(2);
  } finally {
    lepasT1();
  }
  const [gT1, gTutup, gT2] = await Promise.all([t1, hTutup, hT2]);
  pastikan(gT1 === null && gTutup === null, `jurnal T1 dan tutup buku sama-sama berhasil (${gT1?.message ?? ""} ${gTutup?.message ?? ""})`);
  pastikan(gT2?.message.startsWith(`Tahun buku ${tahunLalu} sudah ditutup`), `jurnal T2 yang menunggu tutup buku ditolak "sudah ditutup" (${gT2?.message ?? "lolos"})`);
  const tutupBalapan = await db.tutupBuku.findUniqueOrThrow({ where: { tahun: tahunLalu }, include: { rincianPerusahaan: true } });
  pastikan(sama(tutupBalapan.rincianPerusahaan.find((r) => r.perusahaanId === u1.id)?.labaBersih, 1050), "tutup buku menunggu T1: laba perusahaan laba 1.050 (jurnal T1 ikut ditutup)");
  pastikan(sama(tutupBalapan.rincianPerusahaan.find((r) => r.perusahaanId === u2.id)?.labaBersih, -200), "jurnal T2 tidak masuk buku perusahaan rugi");
  const saldoBalapan = await saldoAkunPeriode(db, awalTahun(tahunLalu), akhirTahun(tahunLalu), false, { perusahaanId: u1.id });
  pastikan(saldoBalapan.filter((a) => !a.kelompok && (a.jenis === "PENDAPATAN" || a.jenis === "BEBAN")).every((a) => a.saldo.isZero()), "sesudah balapan, pendapatan dan beban perusahaan laba nol (laba berjalan 0)");
  await jalankan(`buka kembali ${tahunLalu} sesudah uji balapan`, () => bukaKembaliTahun(formulir({ tahun: tahunLalu })));

  console.log("=== 9. Bersih-bersih ===");
  if (pengaturanAwal) await db.pengaturanPerusahaan.update({ where: { id: "default" }, data: { tahunBuku: pengaturanAwal.tahunBuku } });
  await bersihkanData();
  pastikan((await db.perusahaan.count({ where: { kode: { startsWith: KODE } } })) === 0 && (await db.akun.count({ where: { kode: { startsWith: `${KODE}-` } } })) === 0, "perusahaan dan akun uji terhapus");
  pastikan((await db.jurnal.count()) === jumlahJurnalAwal, "jumlah jurnal kembali ke awal");
  pastikan((await db.hakAksesPeran.count()) === awalHakAksesPeran, "tidak ada baris HakAksesPeran baru");
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron sama dengan sebelum uji");
  console.log("=== DONE, all tutup buku perusahaan checks passed ===");
}

main()
  .then(() => process.exit(0))
  .catch(async (galat) => {
    console.error(galat);
    await bersihkanData().catch((e) => console.error("bersih-bersih gagal", e));
    process.exit(1);
  });
