import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { verifikasiKataSandi } from "../src/lib/kataSandi";
import { mintaAturUlang, pakaiTautanAturUlang, periksaTautanAturUlang } from "../src/lib/aksi/otentikasi";
import { buatTautanAturUlang, tolakPermintaanAturUlang, aturUlangKataSandi } from "../src/lib/aksi/pengguna";

/*
 * Lupa kata sandi tanpa email: permintaan dari halaman masuk → Superadmin/Pemilik/Admin membuat tautan
 * sekali pakai (24 jam) → pengguna membuat kata sandi baru → sesi lama dicabut. Nama pengguna yang tidak ada
 * tidak menghasilkan galat (tidak membocorkan keberadaan akun) dan permintaan terbuka tidak digandakan.
 */
async function jalankan(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    const digest = (err as { digest?: string })?.digest ?? "";
    const pesan = (err as { message?: string })?.message ?? "";
    if (!digest.startsWith("NEXT_REDIRECT") && !pesan.includes("static generation store missing") && !pesan.includes("cookies") && !pesan.includes("outside a request scope")) throw err;
  }
  console.log(`[ok] ${label}`);
}
function formulir(isian: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(isian)) fd.set(k, v);
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

async function main() {
  const mulaiUji = new Date();
  const kasir = await db.pengguna.findUniqueOrThrow({ where: { namaPengguna: "kasir" } });
  const hashAwal = kasir.kataSandiHash;

  console.log("=== 1. Permintaan dari halaman masuk ===");
  await jalankan("nama pengguna tidak dikenal → tanpa galat", () => mintaAturUlang(formulir({ namaPengguna: "tidak-ada-xyz" })));
  pastikan((await db.permintaanAturUlang.count({ where: { dibuatPada: { gte: mulaiUji } } })) === 0, "tidak ada permintaan untuk akun yang tidak ada");
  await harusDitolak("tanpa nama pengguna", () => mintaAturUlang(formulir({ namaPengguna: "" })), "wajib diisi");
  await jalankan("kasir minta atur ulang", () => mintaAturUlang(formulir({ namaPengguna: "KASIR" })));
  await jalankan("kasir minta lagi (tidak digandakan)", () => mintaAturUlang(formulir({ namaPengguna: "kasir" })));
  const daftar = await db.permintaanAturUlang.findMany({ where: { penggunaId: kasir.id, dibuatPada: { gte: mulaiUji } } });
  pastikan(daftar.length === 1 && daftar[0].status === "MENUNGGU", "satu permintaan MENUNGGU untuk kasir");
  const p = daftar[0];

  console.log("=== 2. Tautan sekali pakai ===");
  pastikan((await periksaTautanAturUlang("bukan-token")) === null, "token asal-asalan tidak sah");
  await jalankan("buat tautan", () => buatTautanAturUlang(p.id));
  const p2 = await db.permintaanAturUlang.findUniqueOrThrow({ where: { id: p.id } });
  pastikan(p2.status === "TAUTAN" && p2.token && p2.kedaluwarsa && p2.kedaluwarsa.getTime() - Date.now() > 23 * 3600 * 1000, "status TAUTAN dengan token & kedaluwarsa ~24 jam");
  pastikan((await periksaTautanAturUlang(p2.token!))?.pengguna.namaPengguna === "kasir", "tautan sah menunjuk ke kasir");
  await harusDitolak("kata sandi lemah", () => pakaiTautanAturUlang(p2.token!, formulir({ kataSandiBaru: "pendek", ulangiKataSandi: "pendek" })), "minimal");
  await harusDitolak("ulangi tidak sama", () => pakaiTautanAturUlang(p2.token!, formulir({ kataSandiBaru: "kasirbaru123", ulangiKataSandi: "beda123456" })), "tidak sama");
  await db.sesi.create({ data: { tokenHash: "uji-sesi-lama-" + Date.now(), penggunaId: kasir.id, kedaluwarsa: new Date(Date.now() + 3600000) } });
  await jalankan("kasir memakai tautan → kata sandi baru", () => pakaiTautanAturUlang(p2.token!, formulir({ kataSandiBaru: "kasirbaru123", ulangiKataSandi: "kasirbaru123" })));
  const kasir2 = await db.pengguna.findUniqueOrThrow({ where: { id: kasir.id } });
  pastikan(await verifikasiKataSandi("kasirbaru123", kasir2.kataSandiHash), "kata sandi kasir berganti");
  pastikan((await db.sesi.count({ where: { penggunaId: kasir.id, tokenHash: { startsWith: "uji-sesi-lama-" } } })) === 0, "sesi lama kasir dicabut");
  const p3 = await db.permintaanAturUlang.findUniqueOrThrow({ where: { id: p.id } });
  pastikan(p3.status === "SELESAI" && p3.token === null && p3.selesaiPada, "permintaan SELESAI, token dihapus");
  await harusDitolak("tautan dipakai dua kali", () => pakaiTautanAturUlang(p2.token!, formulir({ kataSandiBaru: "lagi12345", ulangiKataSandi: "lagi12345" })), "tidak berlaku");
  await harusDitolak("buat tautan untuk permintaan selesai", () => buatTautanAturUlang(p.id), "sudah selesai");

  console.log("=== 3. Kedaluwarsa, tolak, dan atur ulang manual menutup permintaan ===");
  await jalankan("kasir minta lagi", () => mintaAturUlang(formulir({ namaPengguna: "kasir" })));
  const q = await db.permintaanAturUlang.findFirstOrThrow({ where: { penggunaId: kasir.id, status: "MENUNGGU" } });
  await jalankan("buat tautan", () => buatTautanAturUlang(q.id));
  await db.permintaanAturUlang.update({ where: { id: q.id }, data: { kedaluwarsa: new Date(Date.now() - 1000) } });
  const q2 = await db.permintaanAturUlang.findUniqueOrThrow({ where: { id: q.id } });
  pastikan((await periksaTautanAturUlang(q2.token!)) === null, "tautan kedaluwarsa tidak sah");
  await jalankan("tolak permintaan", () => tolakPermintaanAturUlang(q.id));
  pastikan((await db.permintaanAturUlang.findUniqueOrThrow({ where: { id: q.id } })).status === "DITOLAK", "status DITOLAK");
  await jalankan("kasir minta lagi", () => mintaAturUlang(formulir({ namaPengguna: "kasir" })));
  await jalankan("admin atur ulang manual", () => aturUlangKataSandi(kasir.id, formulir({ kataSandiBaru: "kasir123" })));
  pastikan((await db.permintaanAturUlang.count({ where: { penggunaId: kasir.id, status: { in: ["MENUNGGU", "TAUTAN"] } } })) === 0, "atur ulang manual menutup permintaan terbuka");
  pastikan(await verifikasiKataSandi("kasir123", (await db.pengguna.findUniqueOrThrow({ where: { id: kasir.id } })).kataSandiHash), "kata sandi kasir kembali kasir123");
  pastikan((await db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, jenis: "Kata Sandi" } })) >= 4, "tautan/atur ulang/tolak tercatat di log");

  console.log("=== Bersih-bersih ===");
  await db.pengguna.update({ where: { id: kasir.id }, data: { kataSandiHash: hashAwal } });
  await db.permintaanAturUlang.deleteMany({ where: { penggunaId: kasir.id } });
  await db.sesi.deleteMany({ where: { penggunaId: kasir.id } });
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji } } });
  console.log("=== DONE, all lupa kata sandi checks passed ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
