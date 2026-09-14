import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { db } from "../src/lib/db";

/*
 * Uji asap halaman: membuat sesi login langsung di basis data, lalu mengambil tiap halaman lewat HTTP
 * dan memastikan balasannya 200 serta memuat penanda yang diharapkan. Gunanya menangkap galat runtime
 * (kueri Prisma salah, komponen melempar) yang tidak terlihat dari `next build` maupun skrip regresi.
 *
 * Cara pakai (butuh server hidup, mis. `npm run start` di terminal lain):
 *   ALAMAT=http://localhost:3000 npx tsx skrip/asap-halaman.ts
 */

const ALAMAT = process.env.ALAMAT ?? "http://localhost:3000";
const NAMA_COOKIE_SESI = "sesi_ac";

const HALAMAN: { jalur: string; penanda: string }[] = [
  { jalur: "/persetujuan", penanda: "Persetujuan Dokumen" },
  { jalur: "/pengaturan/mata-uang", penanda: "Mata Uang &amp; Kurs" },
  { jalur: "/pengaturan/pemetaan-akun", penanda: "Selisih Kurs" },
  { jalur: "/pengaturan/perusahaan", penanda: "Wajib persetujuan" },
  { jalur: "/penjualan/faktur", penanda: "Persetujuan" },
  { jalur: "/pembelian/faktur", penanda: "Persetujuan" },
  { jalur: "/kas-bank/masuk", penanda: "Kas Masuk" },
  { jalur: "/kas-bank/keluar", penanda: "Kas Keluar" },
  { jalur: "/persediaan/penyesuaian", penanda: "Persetujuan" },
  { jalur: "/aset-tetap", penanda: "Persetujuan" },
  { jalur: "/sdm/penggajian", penanda: "Persetujuan" },
  { jalur: "/buku-besar/jurnal", penanda: "Jurnal" },
  { jalur: "/buku-besar/neraca", penanda: "Neraca" },
  { jalur: "/laporan/piutang", penanda: "Piutang" },
];

async function main() {
  const pengguna = await db.pengguna.findFirstOrThrow({ where: { peran: "PEMILIK", aktif: true } });
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const sesi = await db.sesi.create({
    data: { tokenHash, penggunaId: pengguna.id, kedaluwarsa: new Date(Date.now() + 60 * 60 * 1000) },
  });
  console.log(`Sesi uji dibuat untuk ${pengguna.namaPengguna} (${pengguna.nama})`);

  let gagal = 0;
  try {
    for (const h of HALAMAN) {
      const res = await fetch(`${ALAMAT}${h.jalur}`, { headers: { cookie: `${NAMA_COOKIE_SESI}=${token}` }, redirect: "manual" });
      const teks = res.ok ? await res.text() : "";
      const cocok = res.ok && teks.includes(h.penanda);
      if (cocok) {
        console.log(`[ok]   ${h.jalur} -> ${res.status}, memuat "${h.penanda}"`);
      } else {
        console.error(`[GAGAL] ${h.jalur} -> ${res.status}${res.ok ? `, TIDAK memuat "${h.penanda}"` : ""}`);
        gagal++;
      }
    }
  } finally {
    await db.sesi.delete({ where: { id: sesi.id } });
  }

  console.log(gagal === 0 ? `\n=== DONE, ${HALAMAN.length} halaman tampil normal ===` : `\n=== ${gagal} halaman GAGAL ===`);
  process.exit(gagal === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("UJI ASAP GAGAL", err);
  process.exit(1);
});
