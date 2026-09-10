import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { daftarAkunKasBank, terapkanBaganAkunStandar } from "../src/lib/baganAkun";
import { BAGAN_AKUN_STANDAR } from "../src/lib/baganAkunStandar";
import { buatJurnalManual, buatKasMasuk } from "../src/lib/aksi/jurnal";
import { simpanPemetaanAkun } from "../src/lib/aksi/pengaturan";

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

async function main() {
  console.log("=== 1. Terapkan bagan akun standar: idempoten & lengkap ===");
  const awal = await terapkanBaganAkunStandar(db);
  console.log("   penerapan pertama:", awal);
  const ada = await db.akun.findMany({ where: { kode: { in: BAGAN_AKUN_STANDAR.map((a) => a.kode) } } });
  pastikan(ada.length === BAGAN_AKUN_STANDAR.length, `semua ${BAGAN_AKUN_STANDAR.length} kode standar ada di basis data`);
  const ulang = await terapkanBaganAkunStandar(db);
  pastikan(ulang.dibuat === 0 && ulang.sudahAda === BAGAN_AKUN_STANDAR.length, "penerapan ulang tidak membuat akun baru");

  console.log("=== 2. Akun yang dihapus dibuat ulang lengkap dengan induk & tanda ===");
  const cobaKode = "5-9300"; // Denda & Bunga Pajak: akun rinci daun, tidak dipakai data contoh
  const sebelum = await db.akun.findUniqueOrThrow({ where: { kode: cobaKode }, include: { barisJurnal: true } });
  pastikan(sebelum.barisJurnal.length === 0, `${cobaKode} tidak punya jurnal (aman dihapus untuk uji)`);
  await db.akun.delete({ where: { id: sebelum.id } });
  const setelahHapus = await terapkanBaganAkunStandar(db);
  pastikan(setelahHapus.dibuat === 1, "penerapan membuat tepat 1 akun yang hilang");
  const dibuatUlang = await db.akun.findUniqueOrThrow({ where: { kode: cobaKode }, include: { induk: true } });
  pastikan(dibuatUlang.induk?.kode === "5-9000" && dibuatUlang.kelompok === false, `${cobaKode} kembali dengan induk 5-9000 dan bukan kelompok`);

  console.log("=== 3. Akun kelompok tidak bisa dijurnal ===");
  const bebanPokok = await db.akun.findUniqueOrThrow({ where: { kode: "5-1000" } }); // kelompok
  const kas = await db.akun.findUniqueOrThrow({ where: { kode: "1-1100" } });
  const bankKelompok = await db.akun.findUniqueOrThrow({ where: { kode: "1-1200" } }); // kelompok
  const pendapatanKelompok = await db.akun.findUniqueOrThrow({ where: { kode: "4-1000" } }); // kelompok
  pastikan(bebanPokok.kelompok && bankKelompok.kelompok && pendapatanKelompok.kelompok, "5-1000, 1-1200, 4-1000 bertanda kelompok");

  const fdJurnal = new FormData();
  fdJurnal.set("keterangan", "Uji jurnal ke akun kelompok");
  fdJurnal.set("baris", JSON.stringify([
    { akunId: bebanPokok.id, debit: 1000, kredit: 0 },
    { akunId: kas.id, debit: 0, kredit: 1000 },
  ]));
  await harusDitolak("jurnal umum ke 5-1000", () => buatJurnalManual(fdJurnal), "Akun kelompok tidak bisa dijurnal");

  const fdKas = new FormData();
  fdKas.set("akunKasId", bankKelompok.id);
  fdKas.set("akunLawanId", kas.id);
  fdKas.set("jumlah", "5000");
  await harusDitolak("kas masuk ke 1-1200 (Bank, kelompok)", () => buatKasMasuk(fdKas), "Akun kelompok tidak bisa dijurnal");

  const jurnalSetelah = await db.jurnal.count({ where: { keterangan: "Uji jurnal ke akun kelompok" } });
  pastikan(jurnalSetelah === 0, "tidak ada jurnal uji yang tersimpan");

  console.log("=== 4. Pemetaan akun menolak akun kelompok ===");
  const pemetaanSebelum = await db.pemetaanAkun.findUniqueOrThrow({ where: { id: "default" } });
  const fdPeta = new FormData();
  fdPeta.set("piutangUsahaId", pemetaanSebelum.piutangUsahaId);
  fdPeta.set("persediaanId", pemetaanSebelum.persediaanId);
  fdPeta.set("hppId", pemetaanSebelum.hppId);
  fdPeta.set("pendapatanPenjualanId", pendapatanKelompok.id);
  fdPeta.set("utangUsahaId", pemetaanSebelum.utangUsahaId);
  await harusDitolak("pemetaan pendapatan ke 4-1000", () => simpanPemetaanAkun(fdPeta), "Akun kelompok tidak bisa dijurnal");
  const pemetaanSesudah = await db.pemetaanAkun.findUniqueOrThrow({ where: { id: "default" } });
  pastikan(pemetaanSesudah.pendapatanPenjualanId === pemetaanSebelum.pendapatanPenjualanId, "pemetaan tidak berubah");

  console.log("=== 5. Daftar akun Kas/Bank hanya berisi akun bertanda kasBank ===");
  const kasBank = await daftarAkunKasBank(db);
  pastikan(kasBank.length >= 2 && kasBank.every((a) => a.kasBank && !a.kelompok), `daftar kas/bank: ${kasBank.map((a) => a.kode).join(", ")}`);

  console.log("=== DONE, all bagan akun checks passed ===");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("TEST FAILED", err);
    process.exit(1);
  });
