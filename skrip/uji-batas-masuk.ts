import "dotenv/config";
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { pastikanBolehCoba, catatKegagalanMasuk, resetPercobaanMasuk } from "../src/lib/batasMasuk";
import { pastikan, harusDitolak, jalankan } from "./bantuan";

/*
 * Pembatas laju masuk (anti brute-force): setelah 5 kegagalan per akun, percobaan berikutnya ditolak
 * (backoff); reset saat berhasil memulihkan akun; kunci IP terpisah dari kunci akun.
 */
async function main() {
  const AKUN = "uji-brute-" + Math.floor(Date.now() / 1000);
  const IP = "203.0.113.77";
  await db.percobaanMasuk.deleteMany({ where: { OR: [{ namaPengguna: AKUN }, { ip: IP }] } });

  await jalankan("belum ada kegagalan → boleh mencoba", () => pastikanBolehCoba(AKUN, IP));
  for (let i = 1; i <= 5; i++) await catatKegagalanMasuk(AKUN, IP);
  await harusDitolak("5 kegagalan → akun terkunci", () => pastikanBolehCoba(AKUN, IP), "Terlalu banyak percobaan");

  await resetPercobaanMasuk(AKUN);
  await jalankan("berhasil masuk (reset) → kunci akun pulih", () => pastikanBolehCoba(AKUN, "198.51.100.9"));

  // kunci IP terpisah: banyak kegagalan lintas akun dari satu IP tetap mengunci IP itu
  const IP2 = "203.0.113.88";
  await db.percobaanMasuk.deleteMany({ where: { ip: IP2 } });
  for (let i = 1; i <= 20; i++) await catatKegagalanMasuk(`akun-acak-${i}`, IP2);
  await harusDitolak("20 kegagalan lintas akun dari 1 IP → IP terkunci", () => pastikanBolehCoba("akun-baru", IP2), "Terlalu banyak percobaan");

  await db.percobaanMasuk.deleteMany({ where: { OR: [{ ip: IP }, { ip: IP2 }, { ip: "198.51.100.9" }, { namaPengguna: AKUN }] } });
  await db.percobaanMasuk.deleteMany({ where: { namaPengguna: { startsWith: "akun-acak-" } } });
  pastikan(true, "bersih-bersih data uji");
  console.log("=== DONE, all batas-masuk checks passed ===");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
