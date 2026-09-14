import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";

import { db } from "../src/lib/db";
import { formulir, harusDitolak, jalankan, pastikan } from "./bantuan";
import { terapkanBaganAkunStandar } from "../src/lib/baganAkun";
import { buatPesanan, buatFaktur } from "../src/lib/aksi/penjualan";
import { catatKurs, jalankanPenilaianKurs, tambahMataUang } from "../src/lib/aksi/mataUang";
import { kursPada } from "../src/lib/mataUang";
import { jalankanRevaluasi } from "../src/lib/selisihKurs";

/*
 * Uji akuntansi multi mata uang.
 *
 * Aturan yang diperiksa:
 *   - IDR adalah mata uang fungsional: SELURUH baris jurnal tetap rupiah, tidak ada baris mata uang asing
 *   - faktur mata uang asing menyimpan mataUangId + kurs (snapshot) + nilaiAsli (nilai dalam mata uang itu)
 *   - baris jurnalnya membawa jejak mataUangAsliId/kursAsli/nilaiAsli, nilainya = nilai rupiah / kurs
 *   - kurs baru yang dimasukkan belakangan TIDAK mengubah jurnal yang sudah tercatat
 *   - penilaian kembali (revaluasi) mencatat satu jurnal JU-SK yang seimbang dan idempoten
 *   - transaksi memakai mata uang yang kursnya belum ada ditolak dengan pesan jelas
 */

const KODE_UJI = "UJD"; // kode ISO 4217 palsu khusus uji, supaya tidak mengganggu daftar sungguhan

async function bersihkanSisaUji() {
  const mu = await db.mataUang.findUnique({ where: { kode: KODE_UJI } });
  // Jurnal yang harus ikut dibuang: jurnal penilaian kurs + jurnal faktur milik pelanggan uji
  const fakturUji = await db.fakturPenjualan.findMany({ where: { pelanggan: { kode: "CUST-MU" } }, select: { jurnalId: true } });
  const jurnalUji = [
    ...(await db.jurnal.findMany({ where: { sumber: "SELISIH_KURS" }, select: { id: true } })),
    ...fakturUji.filter((f) => f.jurnalId).map((f) => ({ id: f.jurnalId! })),
  ];
  await db.barisFakturPenjualan.deleteMany({ where: { faktur: { pelanggan: { kode: "CUST-MU" } } } });
  await db.fakturPenjualan.deleteMany({ where: { pelanggan: { kode: "CUST-MU" } } });
  await db.barisPesananPenjualan.deleteMany({ where: { pesanan: { pelanggan: { kode: "CUST-MU" } } } });
  await db.pesananPenjualan.deleteMany({ where: { pelanggan: { kode: "CUST-MU" } } });
  await db.barang.deleteMany({ where: { kode: "JASA-MU" } });
  await db.pelanggan.deleteMany({ where: { kode: "CUST-MU" } });
  await db.barisJurnal.deleteMany({ where: { jurnalId: { in: jurnalUji.map((j) => j.id) } } });
  await db.jurnal.deleteMany({ where: { id: { in: jurnalUji.map((j) => j.id) } } });
  if (mu) {
    await db.kursMataUang.deleteMany({ where: { mataUangId: mu.id } });
    await db.mataUang.delete({ where: { id: mu.id } });
  }
  await db.akun.deleteMany({ where: { kode: "MU-SELISIHKURS" } });
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const mulaiUji = new Date();
  console.log("=== Persiapan ===");
  await bersihkanSisaUji();
  await terapkanBaganAkunStandar(db);

  // Akun Selisih Kurs + pemetaannya
  const akunSelisihKurs = await db.akun.create({ data: { kode: "MU-SELISIHKURS", nama: "Selisih Kurs Uji", jenis: "BEBAN" } });
  const pemetaanSebelum = await db.pemetaanAkun.findUniqueOrThrow({ where: { id: "default" } });
  await db.pemetaanAkun.update({ where: { id: "default" }, data: { selisihKursId: akunSelisihKurs.id } });

  const pelanggan = await db.pelanggan.create({ data: { kode: "CUST-MU", nama: "Klien Luar Negeri Uji" } });
  const jasa = await db.barang.create({ data: { kode: "JASA-MU", nama: "Jasa Uji Mata Uang", jenis: "JASA", hargaJual: 1_000_000, hargaBeli: 0 } });

  console.log("\n=== 1. Daftar mata uang & kurs ===");
  await jalankan("tambah mata uang uji", () => tambahMataUang(formulir({ kode: KODE_UJI, nama: "Mata Uang Uji", simbol: "U$", desimal: 2 })));
  const mataUang = await db.mataUang.findUniqueOrThrow({ where: { kode: KODE_UJI } });
  pastikan(!mataUang.fungsional && mataUang.aktif, "mata uang baru aktif dan bukan mata uang fungsional");

  await harusDitolak("kode bukan 3 huruf", () => tambahMataUang(formulir({ kode: "US", nama: "Salah" })), "3 huruf sesuai ISO 4217");
  await harusDitolak("mata uang ganda", () => tambahMataUang(formulir({ kode: KODE_UJI, nama: "Ganda" })), "sudah ada");

  const kemarin = new Date(mulaiUji.getTime() - 24 * 60 * 60 * 1000);
  await jalankan("catat kurs kemarin 15.000", () => catatKurs(formulir({ mataUangId: mataUang.id, tanggal: iso(kemarin), kurs: 15000, sumber: "Kurs uji" })));
  const kursDibaca = await kursPada(db, mataUang.id, mulaiUji);
  pastikan(Number(kursDibaca) === 15000, `kurs yang berlaku hari ini = kurs terakhir <= hari ini (${kursDibaca})`);

  console.log("\n=== 2. Faktur mata uang asing: buku besar tetap rupiah ===");
  await jalankan("buat pesanan", () => buatPesanan(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: jasa.id, jumlah: 1, harga: 30_000_000 }] })));
  const pesanan = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id }, orderBy: { tanggal: "desc" } });

  await jalankan("buat faktur dalam mata uang asing (kurs 15.000)", () =>
    buatFaktur(formulir({ pesananId: pesanan.id, mataUangId: mataUang.id, baris: [{ barangId: jasa.id, jumlah: 1, harga: 30_000_000 }] })),
  );
  const faktur = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: pesanan.id }, orderBy: { tanggal: "desc" }, include: { jurnal: { include: { baris: true } } } });
  pastikan(faktur.mataUangId === mataUang.id, "mata uang tersimpan di faktur");
  pastikan(Number(faktur.kurs) === 15000, `kurs dokumen tersimpan (snapshot) = 15.000 (${faktur.kurs})`);
  pastikan(Number(faktur.total) === 30_000_000, `total faktur dalam RUPIAH = 30.000.000 (${faktur.total})`);
  pastikan(Number(faktur.nilaiAsli) === 2000, `nilai dalam mata uang transaksi = 30.000.000 / 15.000 = 2.000 (${faktur.nilaiAsli})`);

  pastikan(faktur.jurnal !== null, "faktur punya jurnal (alur persetujuan mati di skrip uji)");
  const barisJurnal = faktur.jurnal!.baris;
  const totalDebitIdr = barisJurnal.reduce((s, b) => s + Number(b.debit), 0);
  const totalKreditIdr = barisJurnal.reduce((s, b) => s + Number(b.kredit), 0);
  pastikan(totalDebitIdr === 30_000_000 && totalKreditIdr === 30_000_000, `jurnal dicatat dalam rupiah & seimbang (${totalDebitIdr}/${totalKreditIdr})`);
  pastikan(
    barisJurnal.every((b) => b.mataUangAsliId === mataUang.id && Number(b.kursAsli) === 15000),
    "setiap baris jurnal membawa jejak mata uang asal & kursnya",
  );
  pastikan(
    barisJurnal.every((b) => Number(b.nilaiAsli) === 2000),
    `jejak nilai asli per baris = 2.000 (${barisJurnal.map((b) => String(b.nilaiAsli)).join(", ")})`,
  );

  console.log("\n=== 3. Kurs baru tidak mengubah jurnal lama ===");
  await jalankan("catat kurs hari ini 16.000", () => catatKurs(formulir({ mataUangId: mataUang.id, tanggal: iso(mulaiUji), kurs: 16000, sumber: "Kurs uji naik" })));
  const fakturSetelahKursBaru = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: faktur.id }, include: { jurnal: { include: { baris: true } } } });
  pastikan(Number(fakturSetelahKursBaru.kurs) === 15000, "kurs dokumen tidak ikut berubah");
  pastikan(
    fakturSetelahKursBaru.jurnal!.baris.reduce((s, b) => s + Number(b.debit), 0) === 30_000_000,
    "nilai jurnal lama tidak bergeser saat kurs baru dimasukkan",
  );

  console.log("\n=== 4. Penilaian kembali (revaluasi) piutang mata uang asing ===");
  // Aksi servernya dipanggil lewat `jalankan` karena revalidatePath hanya jalan di dalam permintaan HTTP;
  // hasilnya diperiksa dari basis data (transaksinya sudah commit sebelum revalidatePath).
  await jalankan("jalankan penilaian kembali", () => jalankanPenilaianKurs(formulir({ tanggal: iso(mulaiUji) })));
  pastikan((await db.jurnal.count({ where: { sumber: "SELISIH_KURS" } })) === 1, "penilaian kembali menghasilkan 1 jurnal JU-SK");
  const logRevaluasi = await db.logAktivitas.findFirstOrThrow({ where: { aksi: "REVALUASI", waktu: { gte: mulaiUji } } });
  pastikan(logRevaluasi.keterangan!.includes("1 faktur"), `log aktivitas revaluasi tercatat: "${logRevaluasi.keterangan}"`);

  const jurnalSk = await db.jurnal.findFirstOrThrow({ where: { sumber: "SELISIH_KURS" }, include: { baris: { include: { akun: true } } } });
  const debitSk = jurnalSk.baris.reduce((s, b) => s + Number(b.debit), 0);
  const kreditSk = jurnalSk.baris.reduce((s, b) => s + Number(b.kredit), 0);
  pastikan(debitSk === kreditSk && debitSk === 2_000_000, `jurnal JU-SK seimbang 2.000.000 (${debitSk}/${kreditSk})`);
  const barisPiutang = jurnalSk.baris.find((b) => b.akunId === pemetaanSebelum.piutangUsahaId);
  const barisSelisih = jurnalSk.baris.find((b) => b.akunId === akunSelisihKurs.id);
  pastikan(barisPiutang !== undefined && Number(barisPiutang.debit) === 2_000_000, "piutang usaha DIDEBIT 2.000.000 (nilai rupiah piutang naik)");
  pastikan(barisSelisih !== undefined && Number(barisSelisih.kredit) === 2_000_000, "akun Selisih Kurs DIKREDIT 2.000.000 (laba kurs)");

  const fakturSetelahRevaluasi = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: faktur.id } });
  pastikan(Number(fakturSetelahRevaluasi.kursRevaluasi) === 16000, `kurs yang dibawa faktur diperbarui ke 16.000 (${fakturSetelahRevaluasi.kursRevaluasi})`);
  pastikan(Number(fakturSetelahRevaluasi.total) === 30_000_000, "total faktur (nilai historis) tidak diubah revaluasi");

  console.log("\n=== 5. Revaluasi kedua pada kurs yang sama tidak membuat jurnal baru (idempoten) ===");
  const hasilKedua = await db.$transaction((tx) => jalankanRevaluasi(tx, mulaiUji));
  pastikan(hasilKedua.nomorJurnal === null, "penilaian kembali kedua tidak membuat jurnal");
  pastikan(hasilKedua.ringkasan.baris.length === 0, "tidak ada selisih yang tersisa untuk dinilai");
  pastikan((await db.jurnal.count({ where: { sumber: "SELISIH_KURS" } })) === 1, "hanya ada 1 jurnal JU-SK");

  console.log("\n=== 6. Mata uang tanpa kurs ditolak ===");
  await jalankan("tambah mata uang tanpa kurs", () => tambahMataUang(formulir({ kode: "UDX", nama: "Mata Uang Tanpa Kurs" })));
  const tanpaKurs = await db.mataUang.findUniqueOrThrow({ where: { kode: "UDX" } });
  await jalankan("buat pesanan kedua", () => buatPesanan(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: jasa.id, jumlah: 1, harga: 1_000_000 }] })));
  const pesananKedua = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id }, orderBy: { tanggal: "desc" } });
  await harusDitolak(
    "faktur memakai mata uang yang kursnya belum dicatat",
    () => buatFaktur(formulir({ pesananId: pesananKedua.id, mataUangId: tanpaKurs.id, baris: [{ barangId: jasa.id, jumlah: 1, harga: 1_000_000 }] })),
    "belum ada. Masukkan kursnya di Pengaturan",
  );
  await harusDitolak("kursPada untuk mata uang tanpa kurs", () => kursPada(db, tanpaKurs.id, mulaiUji), "belum ada");
  await db.mataUang.delete({ where: { id: tanpaKurs.id } });

  console.log("\n=== 7. Buku besar tidak punya baris non-rupiah ===");
  const barisNonIdr = await db.barisJurnal.count({ where: { debit: { lt: 0 } } });
  pastikan(barisNonIdr === 0, "tidak ada baris jurnal bernilai negatif (semua sisi debit/kredit rupiah positif)");

  console.log("\n=== Bersih-bersih ===");
  await db.pemetaanAkun.update({ where: { id: "default" }, data: { selisihKursId: pemetaanSebelum.selisihKursId } });
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji } } });
  await bersihkanSisaUji();

  console.log("\n=== DONE, seluruh pemeriksaan multi mata uang lolos ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("UJI MATA UANG GAGAL", err);
  process.exit(1);
});
