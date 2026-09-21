import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { periksaSinkron } from "../src/lib/sinkron";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { buatPenyesuaianPersediaan } from "../src/lib/aksi/persediaan";
import {
  ajukanKembaliPeminjamanBarang,
  buatPeminjamanBarang,
  hapusFotoPeminjaman,
  konfirmasiKembaliPeminjamanBarang,
  tautkanPenyesuaianPeminjaman,
  ubahPeminjamanBarang,
  unggahFotoPeminjaman,
} from "../src/lib/aksi/peminjaman";
import { statusPeminjaman, terlambat } from "../src/lib/peminjaman";
import { tanggalIso } from "../src/lib/waktu";
import { formulir, harusDitolak, jalankan, pastikan } from "./bantuan";

/*
 * Peminjaman barang (loading out / loading in). Di skrip uji, alur persetujuan MATI (bawaan), jadi
 * setiap "Ajukan pinjam" langsung DISETUJUI dan StokBarang.jumlah langsung berkurang saat itu juga
 * (lihat src/lib/persetujuan.ts, berkas "peminjaman", dan src/lib/aksi/peminjaman.ts). Alur maker-checker
 * sungguhan (DRAFT -> MENUNGGU -> DISETUJUI/DITOLAK, termasuk pengajuan kedua ditolak karena stok sudah
 * direbut yang pertama) diuji terpisah di skrip/uji-persetujuan.ts, sama seperti dokumen lain. Barang
 * kembali tetap dua langkah: Kru "ajukan kembali" (stok belum berubah), Gudang "konfirmasi kembali"
 * (StokBarang ditambah balik saat itu). Buku besar tidak pernah tersentuh (tidak ada jurnal).
 */
const JPEG_PALSU = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const BUKAN_GAMBAR = Buffer.from("halo ini bukan gambar");

/** FormData isian + lampiran foto; file.type sengaja octet-stream supaya terbukti tipe dibaca dari magic bytes. */
function denganFoto(isian: Parameters<typeof formulir>[0], jumlahFoto = 1, isi: Buffer = JPEG_PALSU): FormData {
  const fd = formulir(isian);
  for (let i = 0; i < jumlahFoto; i++) fd.append("foto", new File([new Uint8Array(isi)], `bukti-${i}.bin`, { type: "application/octet-stream" }));
  return fd;
}

async function pastikanSinkron(label: string) {
  const s = await periksaSinkron(db);
  pastikan(s.seimbang && s.persediaan.sinkron, `sinkron setelah ${label} (persediaan ${Number(s.persediaan.bukuBesar)}/${Number(s.persediaan.dokumen)})`);
}
const stok = async (barangId: string, gudangId: string) => Number((await db.stokBarang.findUnique({ where: { barangId_gudangId: { barangId, gudangId } } }))?.jumlah ?? 0);
const dokumen = (id: string) => db.peminjamanBarang.findUniqueOrThrow({ where: { id }, include: { baris: true, foto: { select: { tahap: true, tipe: true, ukuran: true, urutan: true } } } });

async function main() {
  const mulaiUji = new Date();
  const jumlahJurnalAwal = await db.jurnal.count();

  console.log("=== Data uji ===");
  const gudang = await db.gudang.create({ data: { kode: "WH-PJ", nama: "Gudang Uji Pinjam" } });
  const barang = await db.barang.create({ data: { kode: "BRG-PJ", nama: "Barang Uji Pinjam", warna: "Hitam", hargaBeli: 0, hargaJual: 20000 } });
  const jasa = await db.barang.create({ data: { kode: "JSA-PJ", nama: "Jasa Uji Pinjam", jenis: "JASA", hargaBeli: 0, hargaJual: 50000 } });
  const kabel = await db.barang.create({ data: { kode: "KBL-PJ", nama: "Kabel Uji Pinjam", satuan: "meter", hargaBeli: 0, hargaJual: 1000 } });
  const modal = await db.akun.create({ data: { kode: "PJ-MODAL", nama: "Modal Uji Pinjam", jenis: "MODAL" } });
  const proyek = await db.proyek.create({ data: { kode: "PRJ-PJ", nama: "Event Uji Pinjam" } });
  await jalankan("PS saldo awal 30 @ 5.000 + kabel 1 meter", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudang.id, akunLawanId: modal.id, baris: [{ barangId: barang.id, jumlahSesudah: 30, hargaSatuan: 5000 }, { barangId: kabel.id, jumlahSesudah: 1, hargaSatuan: 1000 }] })));
  const jurnalSetelahPs = await db.jurnal.count();
  await pastikanSinkron("saldo awal");

  console.log("=== 1. Penolakan saat ajukan pinjam ===");
  const isianKeluar = { gudangId: gudang.id, namaPengambil: "Andi", baris: [{ barangId: barang.id, jumlah: 20 }] };
  await harusDitolak("tanpa foto", () => buatPeminjamanBarang(formulir(isianKeluar)), "Foto wajib");
  await harusDitolak("4 foto", () => buatPeminjamanBarang(denganFoto(isianKeluar, 4)), "Maksimal 3 foto");
  await harusDitolak("berkas bukan gambar", () => buatPeminjamanBarang(denganFoto(isianKeluar, 1, BUKAN_GAMBAR)), "tidak didukung");
  await harusDitolak("tanpa gudang", () => buatPeminjamanBarang(denganFoto({ ...isianKeluar, gudangId: "" })), "Gudang wajib");
  await harusDitolak("tanpa nama pengambil", () => buatPeminjamanBarang(denganFoto({ ...isianKeluar, namaPengambil: "  " })), "Nama pengambil wajib");
  await harusDitolak("baris kosong", () => buatPeminjamanBarang(denganFoto({ ...isianKeluar, baris: [] })), "Minimal 1 baris");
  await harusDitolak("jumlah 0", () => buatPeminjamanBarang(denganFoto({ ...isianKeluar, baris: [{ barangId: barang.id, jumlah: 0 }] })), "lebih dari 0");
  await harusDitolak("baris JASA", () => buatPeminjamanBarang(denganFoto({ ...isianKeluar, baris: [{ barangId: jasa.id, jumlah: 1 }] })), "JASA");
  await harusDitolak("barang ganda", () => buatPeminjamanBarang(denganFoto({ ...isianKeluar, baris: [{ barangId: barang.id, jumlah: 1 }, { barangId: barang.id, jumlah: 1 }] })), "hanya boleh muncul sekali");
  await harusDitolak("proyek tidak ada", () => buatPeminjamanBarang(denganFoto({ ...isianKeluar, proyekId: "tidak-ada" })), "Proyek/event tidak ditemukan");
  await harusDitolak("rencana kembali bukan tanggal", () => buatPeminjamanBarang(denganFoto({ ...isianKeluar, rencanaKembali: "besok" })), "format tanggal");
  await harusDitolak("melebihi stok (31 > 30)", () => buatPeminjamanBarang(denganFoto({ ...isianKeluar, baris: [{ barangId: barang.id, jumlah: 31 }] })), "tidak cukup di gudang ini");
  pastikan((await db.peminjamanBarang.count({ where: { gudangId: gudang.id } })) === 0 && (await db.foto.count({ where: { peminjaman: { gudangId: gudang.id } } })) === 0, "penolakan tidak menyimpan dokumen maupun foto");
  pastikan((await stok(barang.id, gudang.id)) === 30, "penolakan tidak menyentuh stok");

  console.log("=== 2. Ajukan pinjam 20 (2 foto): langsung DISETUJUI, stok berkurang saat itu ===");
  await jalankan("PJ 20 untuk event", () => buatPeminjamanBarang(denganFoto({ ...isianKeluar, proyekId: proyek.id, keterangan: "uji pinjam", rencanaKembali: "2030-01-31" }, 2)));
  const dok1 = await db.peminjamanBarang.findFirstOrThrow({ where: { gudangId: gudang.id }, include: { baris: true, foto: true } });
  pastikan(dok1.nomor.startsWith("PJ-") && dok1.baris.length === 1 && Number(dok1.baris[0].jumlah) === 20 && Number(dok1.baris[0].jumlahKembali) === 0, `dokumen ${dok1.nomor} tersimpan dengan 1 baris × 20`);
  pastikan(dok1.proyekId === proyek.id && dok1.namaPengambil === "Andi" && dok1.dicatatOlehNama === "Skrip Uji" && dok1.dicatatOlehId === null, "proyek, pengambil, dan pencatat tersimpan");
  pastikan(dok1.foto.length === 2 && dok1.foto.every((f) => f.tahap === "KELUAR" && f.tipe === "image/jpeg" && f.ukuran === JPEG_PALSU.length) && Buffer.from(dok1.foto[0].isi).equals(JPEG_PALSU), "2 foto KELUAR tersimpan, tipe image/jpeg dari magic bytes");
  pastikan(dok1.statusPersetujuan === "DISETUJUI" && statusPeminjaman(dok1) === "TERBUKA" && !terlambat(dok1), "langsung DISETUJUI (persetujuan mati di skrip uji), status TERBUKA, belum terlambat");
  pastikan((await stok(barang.id, gudang.id)) === 10, "StokBarang langsung berkurang jadi 10 (30 - 20)");
  pastikan((await db.jurnal.count()) === jurnalSetelahPs, "peminjaman tidak membuat jurnal");
  await pastikanSinkron("PJ keluar");
  await harusDitolak("pinjam 11 saat stok 10", () => buatPeminjamanBarang(denganFoto({ ...isianKeluar, baris: [{ barangId: barang.id, jumlah: 11 }] })), "tidak cukup di gudang ini");
  await jalankan("PJ 10 (stok habis)", () => buatPeminjamanBarang(denganFoto({ ...isianKeluar, namaPengambil: "Budi", baris: [{ barangId: barang.id, jumlah: 10 }] })));
  const dok2 = await db.peminjamanBarang.findFirstOrThrow({ where: { gudangId: gudang.id, namaPengambil: "Budi" } });
  pastikan(dok2.nomor > dok1.nomor && (await stok(barang.id, gudang.id)) === 0, `nomor berurutan (${dok1.nomor}, ${dok2.nomor}), stok habis`);

  console.log("=== 2b. Satuan desimal: 0,1 + 0,2 pengurangan stok harus persis 0,3 ===");
  const isianKabel = (jumlah: number) => denganFoto({ gudangId: gudang.id, namaPengambil: "Dedi", baris: [{ barangId: kabel.id, jumlah }] });
  await jalankan("kabel keluar 0,1", () => buatPeminjamanBarang(isianKabel(0.1)));
  await jalankan("kabel keluar 0,2", () => buatPeminjamanBarang(isianKabel(0.2)));
  pastikan((await stok(kabel.id, gudang.id)) === 0.7, "stok kabel persis 0,7 (bukan 0,6999999999999998)");
  await jalankan("kabel keluar 0,7 (stok habis)", () => buatPeminjamanBarang(isianKabel(0.7)));
  await harusDitolak("kabel keluar 0,01 saat stok 0", () => buatPeminjamanBarang(isianKabel(0.01)), "tidak cukup di gudang ini");

  console.log("=== 3. Ubah data (metadata saja, tidak menyentuh stok) ===");
  await harusDitolak("ubah tanpa nama", () => ubahPeminjamanBarang(dok2.id, formulir({ namaPengambil: "" })), "Nama pengambil wajib");
  await jalankan("ubah pengambil, proyek, rencana kembali (walau sudah DISETUJUI)", () => ubahPeminjamanBarang(dok2.id, formulir({ namaPengambil: "Budi Santoso", proyekId: proyek.id, keterangan: "diubah", rencanaKembali: "2020-01-01" })));
  const dok2Ubah = await dokumen(dok2.id);
  pastikan(dok2Ubah.namaPengambil === "Budi Santoso" && dok2Ubah.proyekId === proyek.id && dok2Ubah.keterangan === "diubah" && terlambat(dok2Ubah), "perubahan tersimpan dan dokumen terlambat");
  const sekarang = new Date();
  pastikan(!terlambat({ rencanaKembali: new Date(`${tanggalIso(sekarang)}T00:00:00Z`), ditutupPada: null }, sekarang), "rencana kembali hari ini belum terlambat");
  pastikan((await db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, jenis: "Peminjaman Barang", aksi: "UBAH" } })) === 1, "perubahan tercatat di log aktivitas");
  pastikan((await stok(barang.id, gudang.id)) === 0, "ubah data tidak menyentuh stok");

  console.log("=== 4. Ajukan kembali (Kru) lalu konfirmasi (Gudang) sebagian bertahap lalu selesai otomatis ===");
  await harusDitolak("ajukan kembali tanpa foto", () => ajukanKembaliPeminjamanBarang(dok1.id, formulir({ baris: [{ barangId: barang.id, jumlahKembali: 5 }] })), "Foto wajib");
  await harusDitolak("ajukan kembali 0", () => ajukanKembaliPeminjamanBarang(dok1.id, denganFoto({ baris: [{ barangId: barang.id, jumlahKembali: 0 }] })), "minimal pada satu barang");
  await harusDitolak("ajukan kembali 25 > sisa 20", () => ajukanKembaliPeminjamanBarang(dok1.id, denganFoto({ baris: [{ barangId: barang.id, jumlahKembali: 25 }] })), "melebihi sisa yang belum diklaim (20)");
  await harusDitolak("ajukan kembali barang lain", () => ajukanKembaliPeminjamanBarang(dok1.id, denganFoto({ baris: [{ barangId: jasa.id, jumlahKembali: 1 }] })), "tidak ada di dokumen ini");
  await jalankan("Kru ajukan kembali 12", () => ajukanKembaliPeminjamanBarang(dok1.id, denganFoto({ baris: [{ barangId: barang.id, jumlahKembali: 12 }] })));
  let d = await dokumen(dok1.id);
  pastikan(!d.ditutupPada && Number(d.baris[0].jumlahKembali) === 0 && Number(d.baris[0].jumlahDiajukanKembali) === 12, "diklaim 12, TAPI stok/jumlahKembali belum berubah sebelum dikonfirmasi Gudang");
  pastikan((await stok(barang.id, gudang.id)) === 0, "ajukan kembali belum menyentuh stok");
  await harusDitolak("konfirmasi 13 > yang diklaim 12", () => konfirmasiKembaliPeminjamanBarang(dok1.id, denganFoto({ baris: [{ barangId: barang.id, jumlahKembali: 13 }] })), "melebihi yang diklaim Kru (12)");
  await jalankan("Gudang konfirmasi kembali 12", () => konfirmasiKembaliPeminjamanBarang(dok1.id, formulir({ baris: [{ barangId: barang.id, jumlahKembali: 12 }] })));
  d = await dokumen(dok1.id);
  pastikan(!d.ditutupPada && Number(d.baris[0].jumlahKembali) === 12 && (await stok(barang.id, gudang.id)) === 12, "masih terbuka, kembali 12, stok bertambah balik jadi 12");
  // Dua panggilan terpisah (bukan digabung dalam satu jalankan()): masing-masing aksi memanggil
  // revalidatePath sendiri di akhir, yang melempar galat "di luar request" di skrip uji (ditoleransi
  // jalankan()) -- kalau digabung dalam satu lambda, galat dari ajukan akan menghentikan lambda
  // sebelum sempat memanggil konfirmasi.
  await jalankan("Kru ajukan kembali sisa 8", () => ajukanKembaliPeminjamanBarang(dok1.id, denganFoto({ baris: [{ barangId: barang.id, jumlahKembali: 8 }] })));
  await jalankan("Gudang konfirmasi kembali 8 (lunas)", () => konfirmasiKembaliPeminjamanBarang(dok1.id, formulir({ baris: [{ barangId: barang.id, jumlahKembali: 8 }] })));
  d = await dokumen(dok1.id);
  pastikan(!!d.ditutupPada && statusPeminjaman(d) === "SELESAI" && (await stok(barang.id, gudang.id)) === 20, "tutup otomatis, status SELESAI, stok kembali 20");
  pastikan(d.foto.filter((f) => f.tahap === "KEMBALI").length === 2 && d.foto.filter((f) => f.tahap === "KEMBALI").map((f) => f.urutan).join(",") === "0,1", "2 foto KEMBALI (dari 2x ajukan kembali) dengan urutan berlanjut");
  await harusDitolak("ajukan kembali ke dokumen yang sudah ditutup", () => ajukanKembaliPeminjamanBarang(dok1.id, denganFoto({ baris: [{ barangId: barang.id, jumlahKembali: 1 }] })), "sudah ditutup");
  await pastikanSinkron("kembali");

  console.log("=== 5. Tutup dengan selisih: bagian yang tidak kembali TETAP dianggap dikeluarkan dari stok ===");
  await harusDitolak("tutup selisih tanpa catatan", () => konfirmasiKembaliPeminjamanBarang(dok2.id, formulir({ baris: [], tutupDenganSelisih: "1" })), "Catatan wajib");
  await jalankan("tutup dengan selisih 10 (tanpa klaim kembali)", () => konfirmasiKembaliPeminjamanBarang(dok2.id, formulir({ baris: [], tutupDenganSelisih: "1", catatan: "10 hilang di venue" })));
  d = await dokumen(dok2.id);
  pastikan(!!d.ditutupPada && statusPeminjaman(d) === "SELISIH" && d.catatanKembali === "10 hilang di venue" && !terlambat(d), "status SELISIH dengan catatan, tidak lagi terlambat");
  pastikan((await stok(barang.id, gudang.id)) === 20, "10 yang hilang TETAP terkurangi dari stok (sudah dikurangi sejak disetujui, tidak dikembalikan)");
  await harusDitolak("ubah dokumen yang sudah ditutup", () => ubahPeminjamanBarang(dok2.id, formulir({ namaPengambil: "Budi" })), "sudah ditutup");
  await jalankan("PJ 20 (stok penuh lagi)", () => buatPeminjamanBarang(denganFoto({ ...isianKeluar, baris: [{ barangId: barang.id, jumlah: 20 }] })));
  await harusDitolak("pinjam 1 saat stok 0", () => buatPeminjamanBarang(denganFoto({ ...isianKeluar, baris: [{ barangId: barang.id, jumlah: 1 }] })), "tidak cukup di gudang ini");
  const dok3 = await db.peminjamanBarang.findFirstOrThrow({ where: { gudangId: gudang.id, namaPengambil: "Andi", baris: { some: { jumlah: 20 } } }, orderBy: { waktuKeluar: "desc" } });
  await jalankan("dok3 ajukan kembali 20 (penuh)", () => ajukanKembaliPeminjamanBarang(dok3.id, denganFoto({ baris: [{ barangId: barang.id, jumlahKembali: 20 }] })));
  await jalankan("dok3 konfirmasi kembali 20, supaya stok longgar lagi untuk bagian berikut", () => konfirmasiKembaliPeminjamanBarang(dok3.id, formulir({ baris: [{ barangId: barang.id, jumlahKembali: 20 }] })));
  pastikan((await stok(barang.id, gudang.id)) === 20, "stok 20 lagi setelah dok3 dikembalikan penuh");

  console.log("=== 6. Tautkan Penyesuaian Stok (jejak akuntansi tambahan opsional untuk SELISIH) ===");
  await harusDitolak("tautkan tanpa PS", () => tautkanPenyesuaianPeminjaman(dok2.id, formulir({})), "wajib dipilih");
  await harusDitolak("tautkan PS tidak ada", () => tautkanPenyesuaianPeminjaman(dok2.id, formulir({ penyesuaianId: "tidak-ada" })), "tidak ditemukan");
  await harusDitolak("tautkan ke dokumen SELESAI", () => tautkanPenyesuaianPeminjaman(dok1.id, formulir({ penyesuaianId: "tidak-ada" })), "tidak punya selisih");
  // Stok `barang` sudah benar (20) sejak dok2 disetujui/ditutup; PS di sini bukan koreksi barang yang
  // sama, melainkan opname rutin gudang yang kebetulan mau ditautkan sebagai jejak tambahan (kode
  // tautkanPenyesuaianPeminjaman hanya mensyaratkan gudang yang sama, bukan barang yang sama).
  await jalankan("PS opname kabel (disetujui, tidak menyentuh stok barang)", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudang.id, akunLawanId: modal.id, keterangan: "catatan tambahan 10 hilang", baris: [{ barangId: kabel.id, jumlahSesudah: 5 }] })));
  const psOpname = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { gudangId: gudang.id, keterangan: "catatan tambahan 10 hilang" } });
  pastikan(psOpname.statusPersetujuan === "DISETUJUI" && (await stok(barang.id, gudang.id)) === 20, "PS opname disetujui, stok barang tetap 20 (PS ini murni jejak tambahan, tidak menyentuh barang)");
  await pastikanSinkron("PS opname");
  const gudangLain = await db.gudang.create({ data: { kode: "WH-PJ2", nama: "Gudang Lain Uji Pinjam" } });
  await jalankan("PS saldo awal di gudang lain (disetujui)", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudangLain.id, akunLawanId: modal.id, baris: [{ barangId: barang.id, jumlahSesudah: 3, hargaSatuan: 5000 }] })));
  const psGudangLain = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { gudangId: gudangLain.id } });
  await harusDitolak("tautkan PS gudang lain", () => tautkanPenyesuaianPeminjaman(dok2.id, formulir({ penyesuaianId: psGudangLain.id })), "untuk gudang lain");
  await jalankan("hapus PS gudang lain", () => hapusDokumen("penyesuaian", psGudangLain.id));
  await jalankan("tautkan PS ke dokumen selisih", () => tautkanPenyesuaianPeminjaman(dok2.id, formulir({ penyesuaianId: psOpname.id })));
  d = await dokumen(dok2.id);
  pastikan(d.penyesuaianId === psOpname.id && statusPeminjaman(d) === "DISESUAIKAN", "status DISESUAIKAN (tautan hanya jejak, stok sudah benar sejak awal)");
  pastikan((await db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, jenis: "Peminjaman Barang", aksi: "TAUTKAN" } })) === 1, "penautan tercatat di log aktivitas");
  await harusDitolak("tautkan dua kali", () => tautkanPenyesuaianPeminjaman(dok2.id, formulir({ penyesuaianId: psOpname.id })), "sudah ditautkan");
  await pastikanSinkron("tautkan PS");

  console.log("=== 7. Foto bukti tambahan ===");
  await jalankan("unggah 1 foto KELUAR tambahan", () => unggahFotoPeminjaman(dok2.id, "KELUAR", denganFoto({})));
  d = await dokumen(dok2.id);
  const fotoKeluar = d.foto.filter((f) => f.tahap === "KELUAR");
  pastikan(fotoKeluar.length === 2 && fotoKeluar.map((f) => f.urutan).sort().join(",") === "0,1", "foto KELUAR jadi 2 dengan urutan lanjut");
  await harusDitolak("unggah ke dokumen tidak ada", () => unggahFotoPeminjaman("tidak-ada", "KELUAR", denganFoto({})), "tidak ditemukan");
  const fotoTambahan = await db.foto.findFirstOrThrow({ where: { peminjamanId: dok2.id, tahap: "KELUAR", urutan: 1 } });
  await jalankan("hapus foto tambahan", () => hapusFotoPeminjaman(fotoTambahan.id));
  pastikan((await db.foto.count({ where: { peminjamanId: dok2.id, tahap: "KELUAR" } })) === 1, "foto tambahan terhapus");
  const fotoBarang = await db.foto.create({ data: { barangId: barang.id, tipe: "image/jpeg", ukuran: JPEG_PALSU.length, isi: new Uint8Array(JPEG_PALSU) } });
  await harusDitolak("hapus foto barang lewat aksi peminjaman", () => hapusFotoPeminjaman(fotoBarang.id), "tidak ditemukan");

  console.log("=== 8. Hapus dokumen: bagian yang masih di luar dikembalikan ke stok ===");
  await harusDitolak("hapus dokumen yang sudah ditautkan", () => hapusDokumen("peminjamanBarang", dok2.id), "sudah ditautkan");
  const stokSebelumHapus = await stok(barang.id, gudang.id);
  pastikan((await dokumen(dok3.id)).ditutupPada !== null, "dok3 sudah ditutup (dikembalikan penuh) di bagian 5");
  await jalankan("hapus PJ selesai (tanpa sisa, stok tidak berubah)", () => hapusDokumen("peminjamanBarang", dok1.id));
  pastikan((await stok(barang.id, gudang.id)) === stokSebelumHapus, "hapus PJ yang sudah lunas (sisa 0) tidak mengubah stok");
  await jalankan("PJ 5 lalu hapus tanpa dikembalikan dulu", () => buatPeminjamanBarang(denganFoto({ ...isianKeluar, namaPengambil: "Citra", baris: [{ barangId: barang.id, jumlah: 5 }] })));
  const dok4 = await db.peminjamanBarang.findFirstOrThrow({ where: { gudangId: gudang.id, namaPengambil: "Citra" } });
  const stokSebelumHapusDok4 = await stok(barang.id, gudang.id);
  await jalankan("hapus PJ yang masih penuh di luar", () => hapusDokumen("peminjamanBarang", dok4.id));
  pastikan((await stok(barang.id, gudang.id)) === stokSebelumHapusDok4 + 5, "hapus PJ yang masih 5 di luar mengembalikan 5 itu ke stok");
  pastikan((await db.peminjamanBarang.count({ where: { id: { in: [dok1.id, dok4.id] } } })) === 0 && (await db.barisPeminjamanBarang.count({ where: { peminjamanId: { in: [dok1.id, dok4.id] } } })) === 0 && (await db.foto.count({ where: { peminjamanId: { in: [dok1.id, dok4.id] } } })) === 0, "dokumen, baris, dan foto ikut terhapus");
  pastikan((await db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, jenis: "Peminjaman Barang", aksi: "HAPUS" } })) === 2, "2 penghapusan tercatat di log aktivitas");
  await jalankan("hapus PS opname", () => hapusDokumen("penyesuaian", psOpname.id));
  d = await dokumen(dok2.id);
  pastikan(d.penyesuaianId === null && statusPeminjaman(d) === "SELISIH", "PS dihapus: tautan lepas, dokumen kembali SELISIH");
  // dok2 (barang) masih punya baris; harus dihapus/dikosongkan dulu sebelum barang boleh dihapus.
  // Bisa kena constraint StokBarang atau BarisPeminjamanBarang duluan tergantung urutan pemeriksaan Postgres;
  // yang penting dua-duanya masih menahan (barang masih punya stok & riwayat peminjaman saat ini).
  await harusDitolak("hapus barang yang punya riwayat peminjaman", () => db.barang.delete({ where: { id: barang.id } }), "_barangId_fkey");

  // PS saldo awal menginjeksikan 30 barang + 1 kabel ke stok; supaya penghapusannya nanti bisa
  // membalik dengan bersih (stok cukup untuk dibalik), SEMUA peminjaman yang masih memegang sebagian
  // dari stok itu -- termasuk yang "hilang" (dok2, SELISIH) dan kabel Dedi yang tidak pernah
  // dikembalikan -- harus dihapus lebih dulu lewat hapusDokumen supaya efeknya ikut dibalik.
  const dokKabelDedi = await db.peminjamanBarang.findMany({ where: { gudangId: gudang.id, namaPengambil: "Dedi" } });
  for (const dk of dokKabelDedi) await jalankan(`hapus PJ kabel ${dk.nomor} (Dedi)`, () => hapusDokumen("peminjamanBarang", dk.id));
  pastikan((await stok(kabel.id, gudang.id)) === 1, "kabel kembali penuh 1 meter setelah semua PJ kabel dihapus");
  await jalankan("hapus PJ selisih (mengembalikan 10 yang tadinya dianggap hilang)", () => hapusDokumen("peminjamanBarang", dok2.id));
  pastikan((await stok(barang.id, gudang.id)) === 30, "barang kembali penuh 30 setelah PJ selisih dihapus");
  await jalankan("hapus PJ dok3 (sudah lunas, sisa terakhir yang masih terikat ke barang)", () => hapusDokumen("peminjamanBarang", dok3.id));

  const psAwal = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { gudangId: gudang.id } });
  await jalankan("hapus PS saldo awal", () => hapusDokumen("penyesuaian", psAwal.id));
  pastikan((await db.jurnal.count()) === jumlahJurnalAwal, "tidak ada jurnal uji yang tersisa");
  pastikan((await stok(barang.id, gudang.id)) === 0 && (await stok(kabel.id, gudang.id)) === 0, "stok kembali 0 setelah PS saldo awal dibalik");
  await pastikanSinkron("hapus semua");

  console.log("=== Bersih-bersih ===");
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji } } });
  await db.stokBarang.deleteMany({ where: { barangId: { in: [barang.id, kabel.id] } } });
  await db.barang.deleteMany({ where: { id: { in: [barang.id, jasa.id, kabel.id] } } });
  await db.proyek.delete({ where: { id: proyek.id } });
  await db.gudang.deleteMany({ where: { id: { in: [gudang.id, gudangLain.id] } } });
  await db.akun.deleteMany({ where: { kode: { startsWith: "PJ-" } } });
  await pastikanSinkron("bersih-bersih");
  console.log("=== DONE, all peminjaman barang checks passed ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
