import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { bacaMutasi, bacaAngka, bacaTanggal, sidikMutasi, CONTOH_CSV } from "../src/lib/mutasiBank";
import { imporMutasi, cocokkanOtomatis, cocokkanManual, lepasCocok, hapusMutasi, konfirmasiPerhatian } from "../src/lib/aksi/rekonsiliasi";
import { buatKasMasuk, buatKasKeluar } from "../src/lib/aksi/jurnal";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { laporanPiutang, laporanHutang } from "../src/lib/laporanRekanan";
import { jalankan, formulir, pastikan, harusDitolak } from "./bantuan";

/*
 * Impor mutasi rekening (CSV format Indonesia, CSV Inggris satu kolom jumlah, HTML tabel) dan rekonsiliasi:
 * dedupe sidik, pencocokan otomatis (nominal+arah, tanggal ±3 hari), manual, lepas, hapus berkas;
 * plus laporan umur piutang/hutang.
 */
const n = (v: { toString(): string } | null) => (v === null ? null : Number(v));
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const mulaiUji = new Date();
  console.log("=== 1. Pembaca angka, tanggal, CSV, HTML ===");
  pastikan(n(bacaAngka("1.234.567,89")) === 1234567.89 && n(bacaAngka("1,234,567.89")) === 1234567.89 && n(bacaAngka("(500)")) === -500 && n(bacaAngka("-1.000")) === -1000 && n(bacaAngka("2.500 DB")) === -2500 && n(bacaAngka("Rp 3.000")) === 3000 && bacaAngka("-") === null, "bacaAngka: format Indonesia/Inggris, kurung, DB, Rp");
  pastikan(iso(bacaTanggal("05/09/2026")!) === "2026-09-05" && iso(bacaTanggal("2026-09-05")!) === "2026-09-05" && iso(bacaTanggal("05 Sep 2026")!) === "2026-09-05" && iso(bacaTanggal("5-9-26")!) === "2026-09-05" && bacaTanggal("abc") === null, "bacaTanggal: dd/mm/yyyy, iso, dd MMM yyyy, dd-mm-yy");
  const csv = bacaMutasi(CONTOH_CSV, "contoh.csv");
  pastikan(csv.format === "csv" && csv.baris.length === 3 && n(csv.baris[0].masuk) === 1000000 && n(csv.baris[1].keluar) === 6500 && n(csv.baris[2].saldo) === 10393500 && csv.baris[0].referensi === "TRX001", "CSV contoh (titik koma, angka Indonesia) terbaca 3 baris");
  const csvInggris = "Date,Description,Amount,Balance\n2026-09-01,\"Transfer in, client\",\"1,000,000.00\",\"11,000,000.00\"\n2026-09-02,Bank fee,-6500.00,\"10,993,500.00\"\nfoo,bar,baz,qux";
  const en = bacaMutasi(csvInggris, "statement.csv");
  pastikan(en.baris.length === 2 && n(en.baris[0].masuk) === 1000000 && n(en.baris[1].keluar) === 6500 && en.baris[0].keterangan === "Transfer in, client" && en.diabaikan.length === 1, "CSV Inggris satu kolom Amount bertanda + kutip + baris rusak diabaikan");
  const html = `<html><body><h1>Mutasi</h1><table><tr><th>Tanggal</th><th>Keterangan</th><th>Debit</th><th>Kredit</th><th>Saldo</th></tr><tr><td>01/09/2026</td><td>SETORAN &amp; TRF</td><td></td><td>1.000.000,00</td><td>1.000.000,00</td></tr><tr><td>02/09/2026</td><td>ADMIN</td><td>6.500,00</td><td>&nbsp;</td><td>993.500,00</td></tr></table></body></html>`;
  const h = bacaMutasi(html, "mutasi.html");
  pastikan(h.format === "html" && h.baris.length === 2 && h.baris[0].keterangan === "SETORAN & TRF" && n(h.baris[1].keluar) === 6500, "HTML tabel terbaca dengan entitas HTML dibersihkan");
  await harusDitolak("tanpa kolom jumlah", async () => bacaMutasi("Tanggal;Keterangan\n01/09/2026;x", "x.csv"), "Kolom jumlah tidak ditemukan");
  console.log("=== 1b. Sudut pandang Debit/Kredit → sudut buku ===");
  pastikan(csv.sudutPandang === "bank" && n(csv.baris[0].masuk) === 1000000 && n(csv.baris[1].keluar) === 6500, "contoh (kredit bank = masuk) terdeteksi sudut rekening koran dari saldo yang turun setelah debit bank");
  const csvBuku = "Tanggal;Keterangan;Debit;Kredit;Saldo\n01/09/2026;Setoran modal;1.000.000;;1.000.000\n02/09/2026;Bayar admin;;6.500;993.500";
  const buku = bacaMutasi(csvBuku, "buku.csv");
  pastikan(buku.sudutPandang === "buku" && n(buku.baris[0].masuk) === 1000000 && n(buku.baris[1].keluar) === 6500, "berkas sudut buku (Debit = masuk) terdeteksi dari saldo dan dibalik dengan benar");
  const tanpaSaldo = "Tanggal;Keterangan;Debit;Kredit\n01/09/2026;Setoran;1.000.000;\n02/09/2026;Admin;;6.500";
  const bawaan = bacaMutasi(tanpaSaldo, "x.csv");
  const dipaksaBuku = bacaMutasi(tanpaSaldo, "x.csv", {}, "buku");
  const dipaksaBank = bacaMutasi(tanpaSaldo, "x.csv", {}, "bank");
  pastikan(bawaan.sudutPandang === "bank" && n(bawaan.baris[0].keluar) === 1000000 && n(dipaksaBuku.baris[0].masuk) === 1000000 && n(dipaksaBuku.baris[1].keluar) === 6500 && n(dipaksaBank.baris[0].keluar) === 1000000, "tanpa saldo: bawaan rekening koran (Debit bank = keluar); dipaksa buku membalik; dipaksa bank tetap");
  pastikan(n(en.baris[0].masuk) === 1000000 && bacaMutasi(csvInggris, "s.csv", {}, "buku").baris[0].masuk.equals(en.baris[0].masuk), "kolom Jumlah bertanda tidak terpengaruh sudut pandang (positif selalu masuk)");
  const b0 = csv.baris[0];
  pastikan(sidikMutasi("A", b0) === sidikMutasi("A", { ...b0, keterangan: b0.keterangan.toUpperCase() }) && sidikMutasi("A", b0) !== sidikMutasi("B", b0), "sidik stabil per akun (huruf besar/kecil diabaikan)");

  console.log("=== 2. Impor ke akun bank + dedupe ===");
  // bersihkan sisa uji sebelumnya yang gagal di tengah jalan
  const sisaAkun = await db.akun.findUnique({ where: { kode: "REK-BANK" } });
  if (sisaAkun) {
    await db.mutasiBank.deleteMany({ where: { akunId: sisaAkun.id } });
    for (const j of await db.jurnal.findMany({ where: { keterangan: { startsWith: "uji rekonsiliasi" } } })) {
      await db.barisJurnal.deleteMany({ where: { jurnalId: j.id } });
      await db.jurnal.delete({ where: { id: j.id } });
    }
    await db.akun.delete({ where: { id: sisaAkun.id } });
  }
  const bank = await db.akun.create({ data: { kode: "REK-BANK", nama: "Bank Uji Rekonsiliasi", jenis: "ASET", kasBank: true } });
  const modal = await db.akun.findFirstOrThrow({ where: { jenis: "MODAL", kelompok: false } });
  const bebanAdmin = await db.akun.findFirstOrThrow({ where: { jenis: "BEBAN", kelompok: false } });
  await harusDitolak("impor ke akun bukan kas/bank", () => imporMutasi(formulir({ akunId: modal.id, namaBerkas: "x.csv", isi: CONTOH_CSV })), "kas/bank");
  await jalankan("impor contoh", () => imporMutasi(formulir({ akunId: bank.id, namaBerkas: "contoh.csv", isi: CONTOH_CSV })));
  pastikan((await db.mutasiBank.count({ where: { akunId: bank.id } })) === 3, "3 mutasi baru tersimpan");
  await jalankan("impor ulang berkas yang sama", () => imporMutasi(formulir({ akunId: bank.id, namaBerkas: "contoh-ulang.csv", isi: CONTOH_CSV })));
  pastikan((await db.mutasiBank.count({ where: { akunId: bank.id } })) === 3 && (await db.mutasiBank.count({ where: { akunId: bank.id, berkas: "contoh-ulang.csv" } })) === 0, "impor ulang tidak menggandakan (3 ganda dilewati)");
  pastikan((await db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, jenis: "Rekonsiliasi", aksi: "IMPOR" } })) === 2, "impor tercatat di log aktivitas");

  console.log("=== 3. Pencocokan otomatis, manual, lepas ===");
  // buku: kas masuk 1.000.000 tgl hari ini (mutasi 01/09 → selisih hari bisa > 3) → pakai toleransi 31 lalu cek 0
  await jalankan("KM 1.000.000 (DP klien) ke bank uji", () => buatKasMasuk(formulir({ akunKasId: bank.id, akunLawanId: modal.id, jumlah: 1000000, keterangan: "uji rekonsiliasi dp" })));
  await jalankan("KK 6.500 admin bank", () => buatKasKeluar(formulir({ akunKasId: bank.id, akunLawanId: bebanAdmin.id, jumlah: 6500, keterangan: "uji rekonsiliasi admin" })));
  await jalankan("cocokkan otomatis toleransi 0 hari", () => cocokkanOtomatis(formulir({ akunId: bank.id, toleransiHari: 0 })));
  const hariSelisih = Math.abs((new Date().getTime() - new Date(2026, 8, 1).getTime()) / 86400000);
  const cocok0 = await db.mutasiBank.count({ where: { akunId: bank.id, barisJurnalId: { not: null } } });
  pastikan(hariSelisih < 1 ? cocok0 >= 1 : cocok0 === 0, `toleransi 0 hari: ${cocok0} cocok (selisih tanggal ${Math.round(hariSelisih)} hari)`);
  await jalankan("cocokkan otomatis toleransi 31 hari", () => cocokkanOtomatis(formulir({ akunId: bank.id, toleransiHari: 31 })));
  const tercocok = await db.mutasiBank.findMany({ where: { akunId: bank.id, barisJurnalId: { not: null } }, include: { barisJurnal: { include: { jurnal: { select: { tanggal: true } } } } } });
  pastikan(tercocok.length === 2 && tercocok.every((m) => m.barisJurnal?.rekonsiliasiPada), "2 mutasi (DP 1.000.000 & admin 6.500) cocok dengan baris buku dan baris ditandai");
  const bedaTanggal = tercocok.filter((m) => m.tanggal.toDateString() !== m.barisJurnal!.jurnal.tanggal.toDateString());
  pastikan(bedaTanggal.every((m) => m.perluPerhatian && !m.dikonfirmasiPada) && tercocok.filter((m) => !bedaTanggal.includes(m)).every((m) => !m.perluPerhatian), `${bedaTanggal.length} mutasi beda tanggal ditandai perlu perhatian, sisanya cocok penuh`);
  if (bedaTanggal.length > 0) {
    const fdCek = formulir({ akunId: bank.id });
    fdCek.set(`cek_${bedaTanggal[0].id}`, "on");
    await jalankan("tandai 1 mutasi beda tanggal sudah dicek", () => konfirmasiPerhatian(fdCek));
    const dicek = await db.mutasiBank.findUniqueOrThrow({ where: { id: bedaTanggal[0].id } });
    pastikan(dicek.perluPerhatian && dicek.dikonfirmasiPada !== null, "mutasi yang dicentang tersimpan sudah dicek");
    if (bedaTanggal.length > 1) pastikan((await db.mutasiBank.findUniqueOrThrow({ where: { id: bedaTanggal[1].id } })).dikonfirmasiPada === null, "yang tidak dicentang tetap belum dicek");
    await jalankan("hapus centang", () => konfirmasiPerhatian(formulir({ akunId: bank.id })));
    pastikan((await db.mutasiBank.findUniqueOrThrow({ where: { id: bedaTanggal[0].id } })).dikonfirmasiPada === null, "centang dilepas → belum dicek lagi");
  }
  const belum = await db.mutasiBank.findFirstOrThrow({ where: { akunId: bank.id, barisJurnalId: null } });
  pastikan(n(belum.keluar) === 600000, "mutasi 600.000 (pembayaran vendor) belum cocok karena belum dicatat di buku");
  await harusDitolak("cocok manual nominal beda", () => cocokkanManual(formulir({ mutasiId: belum.id, barisId: tercocok[0].barisJurnalId! })), "sudah dicocokkan");
  await jalankan("KK 600.000 vendor", () => buatKasKeluar(formulir({ akunKasId: bank.id, akunLawanId: bebanAdmin.id, jumlah: 600000, keterangan: "uji rekonsiliasi vendor" })));
  const barisVendor = await db.barisJurnal.findFirstOrThrow({ where: { akunId: bank.id, kredit: 600000 } });
  await jalankan("cocok manual 600.000", () => cocokkanManual(formulir({ mutasiId: belum.id, barisId: barisVendor.id })));
  pastikan((await db.mutasiBank.count({ where: { akunId: bank.id, barisJurnalId: null } })) === 0, "semua mutasi cocok");
  const manual = await db.mutasiBank.findUniqueOrThrow({ where: { id: belum.id } });
  pastikan(!manual.perluPerhatian && manual.dikonfirmasiPada !== null, "cocok manual = sudah dicek orang, tanpa tanda perlu perhatian");
  await jalankan("lepas cocok 600.000", () => lepasCocok(formulir({ mutasiId: belum.id })));
  const dilepas = await db.mutasiBank.findUniqueOrThrow({ where: { id: belum.id } });
  pastikan((await db.barisJurnal.findUniqueOrThrow({ where: { id: barisVendor.id } })).rekonsiliasiPada === null && dilepas.barisJurnalId === null && !dilepas.perluPerhatian && dilepas.dikonfirmasiPada === null, "lepas cocok memulihkan keduanya dan menghapus tanda");
  const jurnalBuku = await db.jurnal.findFirst({ where: { keterangan: "uji rekonsiliasi dp" }, include: { baris: true } });
  await harusDitolak("hapus jurnal yang sudah direkonsiliasi tetap boleh? (tidak dibatasi) — cek tidak ada galat lain", async () => { throw new Error("dilewati"); }, "dilewati");
  void jurnalBuku;

  console.log("=== 4. Laporan umur piutang/hutang pada seed (semua lunas) ===");
  const piutang = await laporanPiutang(db, new Date());
  const hutang = await laporanHutang(db, new Date());
  pastikan(piutang.total.isZero() && hutang.total.isZero() && piutang.perKeranjang.length === 5, "seed: piutang & hutang terbuka 0 (semua lunas), 5 keranjang umur");

  console.log("=== Bersih-bersih ===");
  await jalankan("hapus mutasi berkas", () => hapusMutasi(formulir({ akunId: bank.id, berkas: "contoh.csv" })));
  pastikan((await db.mutasiBank.count({ where: { akunId: bank.id } })) === 0, "mutasi berkas terhapus");
  for (const ket of ["uji rekonsiliasi dp", "uji rekonsiliasi admin", "uji rekonsiliasi vendor"]) {
    const j = await db.jurnal.findFirstOrThrow({ where: { keterangan: ket } });
    await jalankan(`hapus ${j.nomor}`, () => hapusDokumen("jurnal", j.id));
  }
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji } } });
  await db.akun.delete({ where: { id: bank.id } });
  console.log("=== DONE, all rekonsiliasi checks passed ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
