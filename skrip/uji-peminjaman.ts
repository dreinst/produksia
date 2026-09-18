import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { periksaSinkron } from "../src/lib/sinkron";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { buatPenyesuaianPersediaan } from "../src/lib/aksi/persediaan";
import {
  buatPeminjamanBarang,
  hapusFotoPeminjaman,
  kembalikanPeminjamanBarang,
  tautkanPenyesuaianPeminjaman,
  ubahPeminjamanBarang,
  unggahFotoPeminjaman,
} from "../src/lib/aksi/peminjaman";
import { petaSedangDiLuar, statusPeminjaman, terlambat } from "../src/lib/peminjaman";
import { tanggalIso } from "../src/lib/waktu";
import { aturPersetujuan, formulir, harusDitolak, jalankan, pastikan } from "./bantuan";

/*
 * Peminjaman barang (loading out / loading in): keluar mengurangi "tersedia" tetapi StokBarang.jumlah tetap,
 * kembali sebagian bertahap lalu tutup otomatis, tutup dengan selisih tetap dihitung di luar sampai ditautkan
 * ke Penyesuaian Stok DISETUJUI, hapus dokumen membersihkan baris & foto, dan buku besar tidak pernah tersentuh.
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
const diLuar = async (barangId: string, gudangId: string) => (await petaSedangDiLuar(db, gudangId)).get(barangId) ?? 0;
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

  console.log("=== 1. Penolakan saat catat keluar ===");
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
  await harusDitolak("melebihi stok (31 > 30)", () => buatPeminjamanBarang(denganFoto({ ...isianKeluar, baris: [{ barangId: barang.id, jumlah: 31 }] })), "stok 30, sedang di luar 0, diminta 31");
  pastikan((await db.peminjamanBarang.count({ where: { gudangId: gudang.id } })) === 0 && (await db.foto.count({ where: { peminjaman: { gudangId: gudang.id } } })) === 0, "penolakan tidak menyimpan dokumen maupun foto");

  console.log("=== 2. Keluar 20 (2 foto), stok tetap, tersedia berkurang ===");
  await jalankan("PJ 20 untuk event", () => buatPeminjamanBarang(denganFoto({ ...isianKeluar, proyekId: proyek.id, keterangan: "uji pinjam", rencanaKembali: "2030-01-31" }, 2)));
  const dok1 = await db.peminjamanBarang.findFirstOrThrow({ where: { gudangId: gudang.id }, include: { baris: true, foto: true } });
  pastikan(dok1.nomor.startsWith("PJ-") && dok1.baris.length === 1 && Number(dok1.baris[0].jumlah) === 20 && Number(dok1.baris[0].jumlahKembali) === 0, `dokumen ${dok1.nomor} tersimpan dengan 1 baris × 20`);
  pastikan(dok1.proyekId === proyek.id && dok1.namaPengambil === "Andi" && dok1.dicatatOlehNama === "Skrip Uji" && dok1.dicatatOlehId === null, "proyek, pengambil, dan pencatat tersimpan");
  pastikan(dok1.foto.length === 2 && dok1.foto.every((f) => f.tahap === "KELUAR" && f.tipe === "image/jpeg" && f.ukuran === JPEG_PALSU.length) && Buffer.from(dok1.foto[0].isi).equals(JPEG_PALSU), "2 foto KELUAR tersimpan, tipe image/jpeg dari magic bytes");
  pastikan(statusPeminjaman(dok1) === "TERBUKA" && !terlambat(dok1), "status TERBUKA, belum terlambat");
  pastikan((await stok(barang.id, gudang.id)) === 30 && (await diLuar(barang.id, gudang.id)) === 20, "StokBarang tetap 30, sedang di luar 20");
  pastikan((await db.jurnal.count()) === jurnalSetelahPs, "peminjaman tidak membuat jurnal");
  await pastikanSinkron("PJ keluar");
  await harusDitolak("keluar 11 saat tersedia 10", () => buatPeminjamanBarang(denganFoto({ ...isianKeluar, baris: [{ barangId: barang.id, jumlah: 11 }] })), "stok 30, sedang di luar 20, diminta 11");
  await jalankan("PJ 10 (tersedia habis)", () => buatPeminjamanBarang(denganFoto({ ...isianKeluar, namaPengambil: "Budi", baris: [{ barangId: barang.id, jumlah: 10 }] })));
  const dok2 = await db.peminjamanBarang.findFirstOrThrow({ where: { gudangId: gudang.id, namaPengambil: "Budi" } });
  pastikan(dok2.nomor > dok1.nomor && (await diLuar(barang.id, gudang.id)) === 30, `nomor berurutan (${dok1.nomor}, ${dok2.nomor}), sedang di luar 30`);

  console.log("=== 2b. Satuan desimal: 0,1 + 0,2 sedang di luar harus persis 0,3 ===");
  const isianKabel = (jumlah: number) => denganFoto({ gudangId: gudang.id, namaPengambil: "Dedi", baris: [{ barangId: kabel.id, jumlah }] });
  await jalankan("kabel keluar 0,1", () => buatPeminjamanBarang(isianKabel(0.1)));
  await jalankan("kabel keluar 0,2", () => buatPeminjamanBarang(isianKabel(0.2)));
  pastikan((await diLuar(kabel.id, gudang.id)) === 0.3, "sedang di luar persis 0,3 (bukan 0,30000000000000004)");
  await jalankan("kabel keluar 0,7 (tersedia habis)", () => buatPeminjamanBarang(isianKabel(0.7)));
  await harusDitolak("kabel keluar 0,01 saat tersedia 0", () => buatPeminjamanBarang(isianKabel(0.01)), "stok 1, sedang di luar 1, diminta 0,01");

  console.log("=== 3. Ubah terbatas selama TERBUKA ===");
  await harusDitolak("ubah tanpa nama", () => ubahPeminjamanBarang(dok2.id, formulir({ namaPengambil: "" })), "Nama pengambil wajib");
  await jalankan("ubah pengambil, proyek, rencana kembali", () => ubahPeminjamanBarang(dok2.id, formulir({ namaPengambil: "Budi Santoso", proyekId: proyek.id, keterangan: "diubah", rencanaKembali: "2020-01-01" })));
  const dok2Ubah = await dokumen(dok2.id);
  pastikan(dok2Ubah.namaPengambil === "Budi Santoso" && dok2Ubah.proyekId === proyek.id && dok2Ubah.keterangan === "diubah" && terlambat(dok2Ubah), "perubahan tersimpan dan dokumen terlambat");
  const sekarang = new Date();
  pastikan(!terlambat({ rencanaKembali: new Date(`${tanggalIso(sekarang)}T00:00:00Z`), ditutupPada: null }, sekarang), "rencana kembali hari ini belum terlambat");
  pastikan((await db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, jenis: "Peminjaman Barang", aksi: "UBAH" } })) === 1, "perubahan tercatat di log aktivitas");

  console.log("=== 4. Kembali sebagian bertahap lalu selesai otomatis ===");
  await harusDitolak("kembali tanpa foto", () => kembalikanPeminjamanBarang(dok1.id, formulir({ baris: [{ barangId: barang.id, jumlahKembali: 5 }] })), "Foto wajib");
  await harusDitolak("kembali 0 tanpa tutup", () => kembalikanPeminjamanBarang(dok1.id, denganFoto({ baris: [{ barangId: barang.id, jumlahKembali: 0 }] })), "minimal pada satu barang");
  await harusDitolak("kembali 25 > sisa 20", () => kembalikanPeminjamanBarang(dok1.id, denganFoto({ baris: [{ barangId: barang.id, jumlahKembali: 25 }] })), "melebihi sisa di luar (20)");
  await harusDitolak("kembali barang lain", () => kembalikanPeminjamanBarang(dok1.id, denganFoto({ baris: [{ barangId: jasa.id, jumlahKembali: 1 }] })), "tidak ada di dokumen ini");
  await jalankan("kembali 12", () => kembalikanPeminjamanBarang(dok1.id, denganFoto({ baris: [{ barangId: barang.id, jumlahKembali: 12 }] })));
  let d = await dokumen(dok1.id);
  pastikan(!d.ditutupPada && Number(d.baris[0].jumlahKembali) === 12 && (await diLuar(barang.id, gudang.id)) === 18, "masih terbuka, kembali 12, sedang di luar 18");
  await harusDitolak("kembali 9 > sisa 8", () => kembalikanPeminjamanBarang(dok1.id, denganFoto({ baris: [{ barangId: barang.id, jumlahKembali: 9 }] })), "melebihi sisa di luar (8)");
  await jalankan("kembali 8 (lunas)", () => kembalikanPeminjamanBarang(dok1.id, denganFoto({ baris: [{ barangId: barang.id, jumlahKembali: 8 }] })));
  d = await dokumen(dok1.id);
  pastikan(!!d.ditutupPada && statusPeminjaman(d) === "SELESAI" && (await diLuar(barang.id, gudang.id)) === 10, "tutup otomatis, status SELESAI, sedang di luar tinggal 10");
  pastikan(d.foto.filter((f) => f.tahap === "KEMBALI").length === 2 && d.foto.filter((f) => f.tahap === "KEMBALI").map((f) => f.urutan).join(",") === "0,1", "2 foto KEMBALI dengan urutan berlanjut");
  await harusDitolak("kembali ke dokumen yang sudah ditutup", () => kembalikanPeminjamanBarang(dok1.id, denganFoto({ baris: [{ barangId: barang.id, jumlahKembali: 1 }] })), "sudah ditutup");
  pastikan((await stok(barang.id, gudang.id)) === 30, "StokBarang tetap 30 sepanjang keluar-kembali");
  await pastikanSinkron("kembali");

  console.log("=== 5. Tutup dengan selisih tetap dihitung di luar ===");
  await harusDitolak("tutup selisih tanpa catatan", () => kembalikanPeminjamanBarang(dok2.id, denganFoto({ baris: [{ barangId: barang.id, jumlahKembali: 7 }], tutupDenganSelisih: "1" })), "Catatan wajib");
  await jalankan("kembali 7, tutup dengan selisih 3", () => kembalikanPeminjamanBarang(dok2.id, denganFoto({ baris: [{ barangId: barang.id, jumlahKembali: 7 }], tutupDenganSelisih: "1", catatan: "3 hilang di venue" })));
  d = await dokumen(dok2.id);
  pastikan(!!d.ditutupPada && statusPeminjaman(d) === "SELISIH" && d.catatanKembali === "3 hilang di venue" && !terlambat(d), "status SELISIH dengan catatan, tidak lagi terlambat");
  pastikan((await diLuar(barang.id, gudang.id)) === 3 && (await stok(barang.id, gudang.id)) === 30, "3 yang hilang tetap dihitung di luar, stok tetap 30");
  await harusDitolak("ubah dokumen yang sudah ditutup", () => ubahPeminjamanBarang(dok2.id, formulir({ namaPengambil: "Budi" })), "sudah ditutup");
  await harusDitolak("keluar 28 saat tersedia 27", () => buatPeminjamanBarang(denganFoto({ ...isianKeluar, baris: [{ barangId: barang.id, jumlah: 28 }] })), "stok 30, sedang di luar 3, diminta 28");

  console.log("=== 6. Tautkan Penyesuaian Stok ===");
  aturPersetujuan(true);
  await jalankan("PS draf (belum disetujui)", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudang.id, akunLawanId: modal.id, baris: [{ barangId: barang.id, jumlahSesudah: 27 }] })));
  aturPersetujuan(false);
  const psDraf = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { gudangId: gudang.id, statusPersetujuan: "DRAFT" } });
  await harusDitolak("tautkan PS draf", () => tautkanPenyesuaianPeminjaman(dok2.id, formulir({ penyesuaianId: psDraf.id })), "belum disetujui");
  await harusDitolak("tautkan tanpa PS", () => tautkanPenyesuaianPeminjaman(dok2.id, formulir({})), "wajib dipilih");
  await harusDitolak("tautkan PS tidak ada", () => tautkanPenyesuaianPeminjaman(dok2.id, formulir({ penyesuaianId: "tidak-ada" })), "tidak ditemukan");
  await harusDitolak("tautkan ke dokumen SELESAI", () => tautkanPenyesuaianPeminjaman(dok1.id, formulir({ penyesuaianId: psDraf.id })), "tidak punya selisih");
  await jalankan("hapus PS draf", () => hapusDokumen("penyesuaian", psDraf.id));
  await jalankan("PS opname 27 (disetujui)", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudang.id, akunLawanId: modal.id, keterangan: "3 hilang", baris: [{ barangId: barang.id, jumlahSesudah: 27 }] })));
  const psOpname = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { gudangId: gudang.id, keterangan: "3 hilang" } });
  pastikan(psOpname.statusPersetujuan === "DISETUJUI" && (await stok(barang.id, gudang.id)) === 27, "PS opname disetujui, stok 27");
  await pastikanSinkron("PS opname");
  const gudangLain = await db.gudang.create({ data: { kode: "WH-PJ2", nama: "Gudang Lain Uji Pinjam" } });
  await jalankan("PS saldo awal di gudang lain (disetujui)", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudangLain.id, akunLawanId: modal.id, baris: [{ barangId: barang.id, jumlahSesudah: 3, hargaSatuan: 5000 }] })));
  const psGudangLain = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { gudangId: gudangLain.id } });
  await harusDitolak("tautkan PS gudang lain", () => tautkanPenyesuaianPeminjaman(dok2.id, formulir({ penyesuaianId: psGudangLain.id })), "untuk gudang lain");
  await jalankan("hapus PS gudang lain", () => hapusDokumen("penyesuaian", psGudangLain.id));
  await jalankan("tautkan PS ke dokumen selisih", () => tautkanPenyesuaianPeminjaman(dok2.id, formulir({ penyesuaianId: psOpname.id })));
  d = await dokumen(dok2.id);
  pastikan(d.penyesuaianId === psOpname.id && statusPeminjaman(d) === "DISESUAIKAN" && (await diLuar(barang.id, gudang.id)) === 0, "status DISESUAIKAN, tidak lagi dihitung di luar");
  pastikan((await db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, jenis: "Peminjaman Barang", aksi: "TAUTKAN" } })) === 1, "penautan tercatat di log aktivitas");
  await harusDitolak("tautkan dua kali", () => tautkanPenyesuaianPeminjaman(dok2.id, formulir({ penyesuaianId: psOpname.id })), "sudah ditautkan");
  await jalankan("PJ 27 (tersedia penuh lagi)", () => buatPeminjamanBarang(denganFoto({ ...isianKeluar, namaPengambil: "Citra", baris: [{ barangId: barang.id, jumlah: 27 }] })));
  const dok3 = await db.peminjamanBarang.findFirstOrThrow({ where: { gudangId: gudang.id, namaPengambil: "Citra" } });
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

  console.log("=== 8. Hapus dokumen ===");
  await harusDitolak("hapus dokumen yang sudah ditautkan", () => hapusDokumen("peminjamanBarang", dok2.id), "sudah ditautkan");
  await jalankan("hapus PJ selesai", () => hapusDokumen("peminjamanBarang", dok1.id));
  await jalankan("hapus PJ terbuka", () => hapusDokumen("peminjamanBarang", dok3.id));
  pastikan((await db.peminjamanBarang.count({ where: { id: { in: [dok1.id, dok3.id] } } })) === 0 && (await db.barisPeminjamanBarang.count({ where: { peminjamanId: { in: [dok1.id, dok3.id] } } })) === 0 && (await db.foto.count({ where: { peminjamanId: { in: [dok1.id, dok3.id] } } })) === 0, "dokumen, baris, dan foto ikut terhapus");
  pastikan((await db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, jenis: "Peminjaman Barang", aksi: "HAPUS" } })) === 2, "2 penghapusan tercatat di log aktivitas");
  pastikan((await stok(barang.id, gudang.id)) === 27 && (await diLuar(barang.id, gudang.id)) === 0, "hapus tidak menyentuh stok");
  await jalankan("hapus PS opname", () => hapusDokumen("penyesuaian", psOpname.id));
  d = await dokumen(dok2.id);
  pastikan(d.penyesuaianId === null && statusPeminjaman(d) === "SELISIH" && (await diLuar(barang.id, gudang.id)) === 3, "PS dihapus: tautan lepas, dokumen kembali SELISIH dan dihitung di luar");
  const psAwal = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { gudangId: gudang.id } });
  await jalankan("hapus PS saldo awal", () => hapusDokumen("penyesuaian", psAwal.id));
  pastikan((await db.jurnal.count()) === jumlahJurnalAwal, "tidak ada jurnal uji yang tersisa");
  await db.stokBarang.deleteMany({ where: { barangId: { in: [barang.id, kabel.id] } } });
  await harusDitolak("hapus barang yang punya riwayat peminjaman", () => db.barang.delete({ where: { id: barang.id } }), "BarisPeminjamanBarang_barangId_fkey");
  await db.peminjamanBarang.deleteMany({ where: { gudangId: gudang.id, namaPengambil: "Dedi" } });
  await jalankan("hapus PJ selisih", () => hapusDokumen("peminjamanBarang", dok2.id));
  await pastikanSinkron("hapus semua");

  console.log("=== Bersih-bersih ===");
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji } } });
  await db.barang.deleteMany({ where: { id: { in: [barang.id, jasa.id, kabel.id] } } });
  await db.proyek.delete({ where: { id: proyek.id } });
  await db.gudang.deleteMany({ where: { id: { in: [gudang.id, gudangLain.id] } } });
  await db.akun.deleteMany({ where: { kode: { startsWith: "PJ-" } } });
  await pastikanSinkron("bersih-bersih");
  console.log("=== DONE, all peminjaman barang checks passed ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
