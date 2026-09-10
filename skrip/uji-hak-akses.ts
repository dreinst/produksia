import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { DOKUMEN_HAK, HAK_BAWAAN, SEMUA_HAK, HAK_LAIN, hitungHak, labelHak, modulTerlihat, punyaHak, type Hak, type PenggunaSesi } from "../src/lib/hakAkses";
import { simpanHakAkses, pulihkanHakBawaan } from "../src/lib/aksi/hakAkses";

/** Aksi server diakhiri revalidatePath() yang melempar di luar Next — efek DB-nya sudah tersimpan. */
async function jalankan(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    const pesan = (err as { message?: string })?.message ?? "";
    if (!pesan.includes("static generation store missing")) throw err;
  }
  console.log(`[ok] ${label}`);
}

/*
 * Hak akses per dokumen: bawaan tiap peran masuk akal, penyesuaian dari Pengaturan › Hak Akses
 * menambah/mengurangi hak (kecuali Superadmin/Pemilik dan hak-akses.kelola), tersimpan sebagai selisih
 * terhadap bawaan, dan bisa dipulihkan.
 */
function pastikan(kondisi: unknown, pesan: string) {
  if (!kondisi) {
    console.error(`[FAIL] ${pesan}`);
    process.exit(1);
  }
  console.log(`[ok] ${pesan}`);
}
function formulir(isian: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(isian)) fd.set(k, v);
  return fd;
}
const sesi = (peran: PenggunaSesi["peran"], hak: readonly Hak[]): PenggunaSesi => ({ id: "x", nama: "Uji", namaPengguna: "uji", email: null, peran, hak });

async function main() {
  const mulaiUji = new Date();
  console.log("=== 1. Bawaan peran ===");
  pastikan(SEMUA_HAK.length === DOKUMEN_HAK.reduce((s, d) => s + d.aksi.length, 0) + HAK_LAIN.length, `${SEMUA_HAK.length} hak: ${DOKUMEN_HAK.length} dokumen + ${HAK_LAIN.length} hak modul`);
  pastikan(new Set(SEMUA_HAK).size === SEMUA_HAK.length, "tidak ada hak ganda");
  pastikan(hitungHak("SUPERADMIN").length === SEMUA_HAK.length && hitungHak("PEMILIK").length === SEMUA_HAK.length, "Superadmin & Pemilik penuh");
  pastikan(!punyaHak("ADMIN", "hak-akses.kelola") && !punyaHak("ADMIN", "pengguna.kelola") && !punyaHak("ADMIN", "pengaturan.tulis") && punyaHak("ADMIN", "faktur.hapus") && punyaHak("ADMIN", "buku-besar.lihat") && punyaHak("ADMIN", "rekonsiliasi.tulis"), "Admin: dokumen, laporan, rekonsiliasi; tanpa pengaturan/pengguna/hak akses");
  pastikan(punyaHak("KASIR", "faktur.buat") && punyaHak("KASIR", "kas-masuk.buat") && !punyaHak("KASIR", "faktur.hapus") && !punyaHak("KASIR", "pengiriman.buat") && punyaHak("KASIR", "pengiriman.lihat") && !punyaHak("KASIR", "buku-besar.lihat") && !punyaHak("KASIR", "jurnal.lihat"), "Kasir: buat dokumen keuangan, lihat SJ, tanpa hapus, tanpa laporan/jurnal");
  pastikan(punyaHak("GUDANG", "pengiriman.buat") && punyaHak("GUDANG", "pindah-barang.buat") && !punyaHak("GUDANG", "faktur.buat") && !punyaHak("GUDANG", "kas-masuk.lihat") && !punyaHak("GUDANG", "buku-besar.lihat"), "Gudang: SJ/TB/stok, tanpa keuangan");
  pastikan(modulTerlihat(sesi("GUDANG", HAK_BAWAAN.GUDANG), "penjualan") && !modulTerlihat(sesi("GUDANG", HAK_BAWAAN.GUDANG), "kas-bank"), "modul tampil hanya bila ada dokumen yang boleh dilihat");
  pastikan(labelHak("faktur.buat") === "Faktur Penjualan · buat" && labelHak("pengguna.kelola") === "Pengguna · kelola", "label hak terbaca manusia");

  console.log("=== 2. Penyesuaian: kurangi Kasir, tambah Gudang, coba beri hak-akses.kelola ===");
  pastikan(hitungHak("KASIR", [{ hak: "faktur.buat", boleh: false }, { hak: "faktur.hapus", boleh: true }]).includes("faktur.hapus") && !hitungHak("KASIR", [{ hak: "faktur.buat", boleh: false }]).includes("faktur.buat"), "hitungHak menerapkan penyesuaian");
  pastikan(!hitungHak("ADMIN", [{ hak: "hak-akses.kelola", boleh: true }]).includes("hak-akses.kelola") && hitungHak("PEMILIK", [{ hak: "faktur.buat", boleh: false }]).includes("faktur.buat"), "hak-akses.kelola tak bisa diberikan; Pemilik tak bisa dikurangi");
  // formulir: semua kotak bawaan tercentang, kecuali KASIR|faktur.buat dimatikan dan GUDANG|faktur.lihat + GUDANG|kas-masuk.buat dinyalakan
  const isian: Record<string, string> = {};
  for (const peran of ["ADMIN", "KASIR", "GUDANG"] as const) for (const h of HAK_BAWAAN[peran]) isian[`${peran}|${h}`] = "on";
  delete isian["KASIR|faktur.buat"];
  isian["GUDANG|kas-masuk.buat"] = "on";
  isian["ADMIN|hak-akses.kelola"] = "on"; // harus diabaikan
  await jalankan("simpan matriks", () => simpanHakAkses(formulir(isian)));
  const tersimpan = await db.hakAksesPeran.findMany({ orderBy: [{ peran: "asc" }, { hak: "asc" }] });
  pastikan(tersimpan.length === 2 && tersimpan.some((t) => t.peran === "KASIR" && t.hak === "faktur.buat" && !t.boleh) && tersimpan.some((t) => t.peran === "GUDANG" && t.hak === "kas-masuk.buat" && t.boleh), `hanya selisih yang tersimpan (${tersimpan.length} baris)`);
  const kasir = hitungHak("KASIR", tersimpan.filter((t) => t.peran === "KASIR"));
  const gudang = hitungHak("GUDANG", tersimpan.filter((t) => t.peran === "GUDANG"));
  pastikan(!kasir.includes("faktur.buat") && kasir.includes("penerimaan.buat"), "Kasir kehilangan faktur.buat saja");
  pastikan(gudang.includes("kas-masuk.buat") && modulTerlihat(sesi("GUDANG", gudang), "kas-bank") === false, "Gudang dapat kas-masuk.buat (modul kas tetap tersembunyi tanpa hak lihat)");
  pastikan((await db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, jenis: "Hak Akses" } })) === 1, "perubahan tercatat di log aktivitas");
  // simpan ulang tanpa perubahan → tidak ada baris baru
  await jalankan("simpan ulang", () => simpanHakAkses(formulir(isian)));
  pastikan((await db.hakAksesPeran.count()) === 2, "simpan ulang tanpa perubahan tidak menambah penyesuaian");
  // kembalikan satu hak ke bawaan lewat formulir → barisnya hilang
  isian["KASIR|faktur.buat"] = "on";
  await jalankan("kembalikan satu hak", () => simpanHakAkses(formulir(isian)));
  pastikan((await db.hakAksesPeran.count({ where: { peran: "KASIR" } })) === 0, "mengembalikan ke bawaan menghapus baris penyesuaian");

  console.log("=== 3. Pulihkan bawaan ===");
  await jalankan("pulihkan bawaan", () => pulihkanHakBawaan());
  pastikan((await db.hakAksesPeran.count()) === 0, "semua penyesuaian terhapus");
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji } } });
  console.log("=== DONE, all hak akses checks passed ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
