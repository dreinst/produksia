import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/prisma-klien/client";

/*
 * Uji beban sederhana untuk build produksi (jalankan `npm run build && npx next start -p 3100` dulu):
 * membuat satu sesi Pemilik langsung di tabel Sesi, lalu menembak N permintaan serentak ke halaman-halaman
 * berat dan mencetak p50/p95/maks serta jumlah yang sukses. Sesi uji dihapus di akhir.
 *   BEBAN_URL=http://localhost:3100 BEBAN_SERENTAK=30 npx tsx skrip/beban.ts
 */
const base = process.env.BEBAN_URL ?? "http://localhost:3100";
const serentak = Number(process.env.BEBAN_SERENTAK ?? 30);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

async function main() {
  const pengguna = await db.pengguna.findUniqueOrThrow({ where: { namaPengguna: "owner" } });
  const token = randomBytes(32).toString("base64url");
  await db.sesi.create({ data: { tokenHash: hash(token), penggunaId: pengguna.id, kedaluwarsa: new Date(Date.now() + 3600_000) } });
  const cookie = `sesi_ac=${token}`;
  const halaman = ["/", "/buku-besar/neraca", "/buku-besar/laba-rugi", "/penjualan/faktur", "/rekonsiliasi/kas-bank", "/persediaan", "/buku-besar/jurnal", "/laporan/piutang"];
  async function ukur(jalur: string, n: number) {
    const mulai = performance.now();
    const hasil = await Promise.all(
      Array.from({ length: n }, async () => {
        const t0 = performance.now();
        const r = await fetch(base + jalur, { headers: { cookie }, redirect: "manual" });
        const html = await r.text();
        // sukses = 200 DAN benar-benar halaman aplikasi (ada navigasi utama), bukan pengalihan ke /masuk
        return { ms: performance.now() - t0, ok: r.status === 200 && html.includes('aria-label="Navigasi utama"') };
      }),
    );
    const ms = hasil.map((h) => h.ms).sort((a, b) => a - b);
    const p = (q: number) => Math.round(ms[Math.min(ms.length - 1, Math.floor(q * ms.length))]);
    return { jalur, n, ok: hasil.filter((h) => h.ok).length, p50: p(0.5), p95: p(0.95), maks: Math.round(ms[ms.length - 1]), total: Math.round(performance.now() - mulai) };
  }
  try {
    for (const j of halaman) await ukur(j, 2); // pemanasan
    console.log(`| Halaman | Serentak | Sukses | p50 ms | p95 ms | Maks ms | Total ms |`);
    console.log(`|---|---|---|---|---|---|---|`);
    for (const j of halaman) {
      const r = await ukur(j, serentak);
      console.log(`| ${r.jalur} | ${r.n} | ${r.ok}/${r.n} | ${r.p50} | ${r.p95} | ${r.maks} | ${r.total} |`);
    }
    const t0 = performance.now();
    const campur = await Promise.all(
      Array.from({ length: serentak * 2 }, (_, i) => fetch(base + halaman[i % halaman.length], { headers: { cookie }, redirect: "manual" }).then(async (r) => ((await r.text()).includes('aria-label="Navigasi utama"') ? r.status : 0))),
    );
    console.log(`\nCampuran ${serentak * 2} permintaan serentak ke ${halaman.length} halaman: ${campur.filter((s) => s === 200).length}/${serentak * 2} sukses dalam ${Math.round(performance.now() - t0)} ms.`);
  } finally {
    await db.sesi.deleteMany({ where: { tokenHash: hash(token) } });
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
