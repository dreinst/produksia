import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { DOKUMEN_HAK, HAK_BAWAAN, HAK_TERTINGGI_SAJA, SEMUA_HAK, HAK_LAIN, hitungHak, labelHak, modulTerlihat, punyaHak, type Hak, type PenggunaSesi } from "../src/lib/hakAkses";
import { simpanHakAkses, pulihkanHakBawaan } from "../src/lib/aksi/hakAkses";
import { jalankan, formulir, pastikan } from "./bantuan";

/** Aksi server diakhiri revalidatePath() yang melempar di luar Next — efek DB-nya sudah tersimpan. */

/*
 * Hak akses per dokumen: bawaan tiap peran masuk akal, penyesuaian dari Pengaturan › Hak Akses
 * menambah/mengurangi hak (kecuali Superadmin/Pemilik dan hak-akses.kelola), tersimpan sebagai selisih
 * terhadap bawaan, dan bisa dipulihkan.
 */
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
  pastikan(
    punyaHak("GUDANG", "stok-induk.lihat") && punyaHak("GUDANG", "stok-induk.tulis") && !punyaHak("GUDANG", "data-induk.lihat") && !punyaHak("GUDANG", "data-induk.tulis"),
    "Gudang: kelola Barang/Kelompok Barang/Gudang sendiri (stok-induk), tanpa data induk komersial sama sekali",
  );
  pastikan(
    !punyaHak("ADMIN", "sdm.lihat") && !punyaHak("ADMIN", "sdm.tulis") && !punyaHak("ADMIN", "penggajian.lihat") &&
      !punyaHak("GUDANG", "sdm.lihat") && !punyaHak("GUDANG", "sdm.tulis") && !punyaHak("KASIR", "sdm.lihat") && !punyaHak("KASIR", "sdm.tulis"),
    "SDM (Karyawan/Departemen/Penggajian, termasuk gaji): hanya Superadmin/Pemilik, Admin pun tidak",
  );
  pastikan(
    punyaHak("GUDANG", "pengiriman.buat") && punyaHak("GUDANG", "penerimaan-barang.buat") && punyaHak("GUDANG", "penyesuaian.buat") && punyaHak("GUDANG", "pindah-barang.buat") &&
      !punyaHak("GUDANG", "faktur.lihat") && !punyaHak("GUDANG", "penawaran.lihat") && !punyaHak("GUDANG", "pesanan.lihat") && !punyaHak("GUDANG", "faktur-pembelian.lihat") && !punyaHak("GUDANG", "pembayaran.lihat"),
    "Gudang: hanya 4 dokumen penggerak stok, tanpa dokumen penjualan/pembelian lain",
  );
  pastikan(
    punyaHak("GUDANG", "peminjaman.lihat") && punyaHak("GUDANG", "peminjaman.buat") && punyaHak("GUDANG", "peminjaman.setujui") && !punyaHak("GUDANG", "peminjaman.hapus") && !punyaHak("KASIR", "peminjaman.lihat") && punyaHak("ADMIN", "peminjaman.hapus"),
    "Peminjaman Barang: Gudang lihat, buat & setujui tanpa hapus, Kasir tidak melihat, Admin boleh hapus",
  );
  pastikan(
    punyaHak("GUDANG", "kerusakan.lihat") && punyaHak("GUDANG", "kerusakan.buat") && punyaHak("GUDANG", "kerusakan.setujui") && !punyaHak("GUDANG", "kerusakan.hapus") && punyaHak("ADMIN", "kerusakan.hapus"),
    "Laporan Kerusakan Barang: Gudang lihat, buat & setujui tanpa hapus, Admin boleh hapus",
  );
  pastikan(
    punyaHak("KRU", "peminjaman.lihat") && punyaHak("KRU", "peminjaman.buat") && !punyaHak("KRU", "peminjaman.setujui") && !punyaHak("KRU", "peminjaman.hapus") &&
      punyaHak("KRU", "kerusakan.lihat") && punyaHak("KRU", "kerusakan.buat") && !punyaHak("KRU", "kerusakan.setujui") && !punyaHak("KRU", "kerusakan.hapus") &&
      HAK_BAWAAN.KRU.length === 4,
    "Kru: cuma peminjaman & kerusakan (lihat & buat), tanpa setujui/hapus, tanpa hak lain sama sekali",
  );
  pastikan(modulTerlihat(sesi("KRU", HAK_BAWAAN.KRU), "persediaan") && !modulTerlihat(sesi("KRU", HAK_BAWAAN.KRU), "penjualan"), "Kru: modul persediaan tampil (karena peminjaman.lihat), modul lain tidak");
  for (const peran of ["ADMIN", "KASIR", "GUDANG", "KRU"] as const) {
    for (const h of HAK_TERTINGGI_SAJA) pastikan(!HAK_BAWAAN[peran].includes(h), `${peran} tidak punya ${h} secara bawaan`);
  }
  // Simulasikan formulir sungguhan: semua kotak bawaan tetap tercentang, PLUS mencoba menyalakan
  // sdm.tulis/penggajian.lihat untuk Gudang (harus diabaikan, bukan cuma "tidak disentuh").
  const isianCobaSdm: Record<string, string> = {};
  for (const peran of ["ADMIN", "KASIR", "GUDANG", "KRU"] as const) for (const h of HAK_BAWAAN[peran]) isianCobaSdm[`${peran}|${h}`] = "on";
  isianCobaSdm["GUDANG|sdm.tulis"] = "on";
  isianCobaSdm["GUDANG|penggajian.lihat"] = "on";
  await jalankan("simpan matriks mencoba memberi sdm.tulis ke Gudang (diabaikan)", () => simpanHakAkses(formulir(isianCobaSdm)));
  pastikan(!punyaHak("GUDANG", "sdm.tulis") && !punyaHak("GUDANG", "penggajian.lihat"), "sdm.tulis/penggajian.lihat tetap tidak bisa diberikan ke Gudang lewat formulir");
  pastikan((await db.hakAksesPeran.count()) === 0, "mencoba memberi hak terkunci tidak meninggalkan penyesuaian tersimpan");
  pastikan(modulTerlihat(sesi("GUDANG", HAK_BAWAAN.GUDANG), "penjualan") && !modulTerlihat(sesi("GUDANG", HAK_BAWAAN.GUDANG), "kas-bank"), "modul tampil hanya bila ada dokumen yang boleh dilihat");
  pastikan(labelHak("faktur.buat") === "Faktur Penjualan · buat" && labelHak("pengguna.kelola") === "Pengguna · kelola", "label hak terbaca manusia");

  console.log("=== 2. Penyesuaian: kurangi Kasir, tambah Gudang, coba beri hak-akses.kelola ===");
  pastikan(hitungHak("KASIR", [{ hak: "faktur.buat", boleh: false }, { hak: "faktur.hapus", boleh: true }]).includes("faktur.hapus") && !hitungHak("KASIR", [{ hak: "faktur.buat", boleh: false }]).includes("faktur.buat"), "hitungHak menerapkan penyesuaian");
  pastikan(!hitungHak("ADMIN", [{ hak: "hak-akses.kelola", boleh: true }]).includes("hak-akses.kelola") && hitungHak("PEMILIK", [{ hak: "faktur.buat", boleh: false }]).includes("faktur.buat"), "hak-akses.kelola tak bisa diberikan; Pemilik tak bisa dikurangi");
  // formulir: semua kotak bawaan tercentang, kecuali KASIR|faktur.buat dimatikan dan GUDANG|faktur.lihat + GUDANG|kas-masuk.buat dinyalakan
  const isian: Record<string, string> = {};
  for (const peran of ["ADMIN", "KASIR", "GUDANG", "KRU"] as const) for (const h of HAK_BAWAAN[peran]) isian[`${peran}|${h}`] = "on";
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
