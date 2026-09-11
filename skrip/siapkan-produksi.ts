import "dotenv/config";
import { db } from "../src/lib/db";
import { terapkanBaganAkunStandar } from "../src/lib/baganAkun";

/*
 * Menyiapkan buku PRODUKSI (tanpa data dummy): terapkan Bagan Akun Standar EO/WO + pemetaan akun,
 * lalu set identitas perusahaan = D'Production Event Organizer. Idempoten (aman diulang).
 * Jalankan dengan DATABASE_URL + DB_SSL_CA produksi.
 */
async function main() {
  const hasil = await terapkanBaganAkunStandar(db);
  const akun = (kode: string) => db.akun.findUniqueOrThrow({ where: { kode } });
  const [ppnKeluaran, ppnMasukan, pph23Dimuka, pph23Hutang, bebanPphFinal] = await Promise.all(
    ["2-1330", "1-1800", "1-1900", "2-1320", "5-9100"].map(akun),
  );
  await db.pengaturanPerusahaan.upsert({
    where: { id: "default" },
    update: { nama: "D'Production Event Organizer" },
    create: {
      id: "default", nama: "D'Production Event Organizer", pkp: false, tarifPpnPersen: 11, terminHari: 14, pphFinalPersen: 0.5,
      akunPpnKeluaranId: ppnKeluaran.id, akunPpnMasukanId: ppnMasukan.id, akunPph23DimukaId: pph23Dimuka.id,
      akunPph23DipotongId: pph23Hutang.id, akunBebanPphFinalId: bebanPphFinal.id, akunHutangPphFinalId: pph23Hutang.id,
    },
  });
  const jml = await db.akun.count();
  console.log(`OK — akun dibuat: ${hasil.dibuat ?? "?"}, total akun: ${jml}, perusahaan: D'Production Event Organizer, pemetaan diterapkan`);
}
main().catch((e) => { console.error("GAGAL:", String(e).slice(0, 300)); process.exit(1); }).finally(() => db.$disconnect());
