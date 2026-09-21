import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { periksaSinkron } from "../src/lib/sinkron";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { buatPenyesuaianPersediaan } from "../src/lib/aksi/persediaan";
import {
  buatLaporanKerusakan,
  hapusFotoKerusakan,
  tautkanPenyesuaianKerusakan,
  ubahLaporanKerusakan,
  unggahFotoKerusakan,
} from "../src/lib/aksi/kerusakan";
import { formulir, harusDitolak, jalankan, pastikan } from "./bantuan";

/*
 * Laporan Kerusakan Barang: pola sama dengan Peminjaman Barang (skrip/uji-peminjaman.ts) TAPI tanpa
 * alur "kembali" -- begitu disetujui (di skrip uji, alur persetujuan MATI bawaan, jadi langsung
 * DISETUJUI), StokBarang berkurang PERMANEN saat itu juga (lihat src/lib/persetujuan.ts, berkas
 * "kerusakan"). Tidak menjurnal. Alur maker-checker sungguhan (DRAFT -> MENUNGGU -> DISETUJUI/DITOLAK)
 * diuji terpisah di skrip/uji-persetujuan.ts, sama seperti dokumen lain.
 */
const JPEG_PALSU = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const BUKAN_GAMBAR = Buffer.from("halo ini bukan gambar");

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
const dokumen = (id: string) => db.laporanKerusakanBarang.findUniqueOrThrow({ where: { id }, include: { baris: true, foto: { select: { tipe: true, ukuran: true, urutan: true } } } });

async function main() {
  const mulaiUji = new Date();
  const jumlahJurnalAwal = await db.jurnal.count();

  console.log("=== Data uji ===");
  const gudang = await db.gudang.create({ data: { kode: "WH-BR", nama: "Gudang Uji Kerusakan" } });
  const barang = await db.barang.create({ data: { kode: "BRG-BR", nama: "Barang Uji Kerusakan", warna: "Merah", hargaBeli: 0, hargaJual: 20000 } });
  const jasa = await db.barang.create({ data: { kode: "JSA-BR", nama: "Jasa Uji Kerusakan", jenis: "JASA", hargaBeli: 0, hargaJual: 50000 } });
  const modal = await db.akun.create({ data: { kode: "BR-MODAL", nama: "Modal Uji Kerusakan", jenis: "MODAL" } });
  const proyek = await db.proyek.create({ data: { kode: "PRJ-BR", nama: "Event Uji Kerusakan" } });
  await jalankan("PS saldo awal 30 @ 5.000", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudang.id, akunLawanId: modal.id, baris: [{ barangId: barang.id, jumlahSesudah: 30, hargaSatuan: 5000 }] })));
  const jurnalSetelahPs = await db.jurnal.count();
  await pastikanSinkron("saldo awal");

  console.log("=== 1. Penolakan saat lapor rusak ===");
  const isianDasar = { gudangId: gudang.id, namaPelapor: "Andi", baris: [{ barangId: barang.id, jumlah: 5 }] };
  await harusDitolak("tanpa foto", () => buatLaporanKerusakan(formulir(isianDasar)), "Foto wajib");
  await harusDitolak("4 foto", () => buatLaporanKerusakan(denganFoto(isianDasar, 4)), "Maksimal 3 foto");
  await harusDitolak("berkas bukan gambar", () => buatLaporanKerusakan(denganFoto(isianDasar, 1, BUKAN_GAMBAR)), "tidak didukung");
  await harusDitolak("tanpa gudang", () => buatLaporanKerusakan(denganFoto({ ...isianDasar, gudangId: "" })), "Gudang wajib");
  await harusDitolak("tanpa nama pelapor", () => buatLaporanKerusakan(denganFoto({ ...isianDasar, namaPelapor: "  " })), "Nama pelapor wajib");
  await harusDitolak("baris kosong", () => buatLaporanKerusakan(denganFoto({ ...isianDasar, baris: [] })), "Minimal 1 baris");
  await harusDitolak("jumlah 0", () => buatLaporanKerusakan(denganFoto({ ...isianDasar, baris: [{ barangId: barang.id, jumlah: 0 }] })), "lebih dari 0");
  await harusDitolak("baris JASA", () => buatLaporanKerusakan(denganFoto({ ...isianDasar, baris: [{ barangId: jasa.id, jumlah: 1 }] })), "JASA");
  await harusDitolak("barang ganda", () => buatLaporanKerusakan(denganFoto({ ...isianDasar, baris: [{ barangId: barang.id, jumlah: 1 }, { barangId: barang.id, jumlah: 1 }] })), "hanya boleh muncul sekali");
  await harusDitolak("melebihi stok (31 > 30)", () => buatLaporanKerusakan(denganFoto({ ...isianDasar, baris: [{ barangId: barang.id, jumlah: 31 }] })), "tidak cukup di gudang ini");
  pastikan((await db.laporanKerusakanBarang.count({ where: { gudangId: gudang.id } })) === 0, "penolakan tidak menyimpan dokumen");
  pastikan((await stok(barang.id, gudang.id)) === 30, "penolakan tidak menyentuh stok");

  console.log("=== 2. Lapor rusak 5: langsung DISETUJUI, stok berkurang permanen saat itu ===");
  await jalankan("BR 5 rusak kehujanan", () => buatLaporanKerusakan(denganFoto({ ...isianDasar, proyekId: proyek.id, keterangan: "Basah kehujanan" }, 2)));
  const dok1 = await db.laporanKerusakanBarang.findFirstOrThrow({ where: { gudangId: gudang.id }, include: { baris: true, foto: true } });
  pastikan(dok1.nomor.startsWith("BR-") && dok1.baris.length === 1 && Number(dok1.baris[0].jumlah) === 5, `dokumen ${dok1.nomor} tersimpan dengan 1 baris × 5`);
  pastikan(dok1.proyekId === proyek.id && dok1.namaPelapor === "Andi" && dok1.keterangan === "Basah kehujanan" && dok1.dicatatOlehNama === "Skrip Uji", "proyek, pelapor, keterangan, dan pencatat tersimpan");
  pastikan(dok1.foto.length === 2 && dok1.foto.every((f) => f.tipe === "image/jpeg" && f.ukuran === JPEG_PALSU.length), "2 foto bukti tersimpan, tipe image/jpeg dari magic bytes");
  pastikan(dok1.statusPersetujuan === "DISETUJUI", "langsung DISETUJUI (persetujuan mati di skrip uji)");
  pastikan((await stok(barang.id, gudang.id)) === 25, "StokBarang langsung berkurang jadi 25 (30 - 5)");
  pastikan((await db.jurnal.count()) === jurnalSetelahPs, "laporan kerusakan tidak membuat jurnal");
  await pastikanSinkron("BR dilaporkan");
  await harusDitolak("lapor 26 saat stok 25", () => buatLaporanKerusakan(denganFoto({ ...isianDasar, baris: [{ barangId: barang.id, jumlah: 26 }] })), "tidak cukup di gudang ini");

  console.log("=== 3. Ubah data (metadata saja, tidak menyentuh stok) ===");
  await harusDitolak("ubah tanpa nama", () => ubahLaporanKerusakan(dok1.id, formulir({ namaPelapor: "" })), "Nama pelapor wajib");
  await jalankan("ubah pelapor, proyek, keterangan (walau sudah DISETUJUI)", () => ubahLaporanKerusakan(dok1.id, formulir({ namaPelapor: "Andi Wijaya", proyekId: proyek.id, keterangan: "Basah kehujanan parah" })));
  const dok1Ubah = await dokumen(dok1.id);
  pastikan(dok1Ubah.namaPelapor === "Andi Wijaya" && dok1Ubah.keterangan === "Basah kehujanan parah", "perubahan tersimpan");
  pastikan((await db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, jenis: "Laporan Kerusakan Barang", aksi: "UBAH" } })) === 1, "perubahan tercatat di log aktivitas");
  pastikan((await stok(barang.id, gudang.id)) === 25, "ubah data tidak menyentuh stok");

  console.log("=== 4. Tautkan Penyesuaian Stok (jejak akuntansi tambahan opsional) ===");
  await harusDitolak("tautkan tanpa PS", () => tautkanPenyesuaianKerusakan(dok1.id, formulir({})), "wajib dipilih");
  await harusDitolak("tautkan PS tidak ada", () => tautkanPenyesuaianKerusakan(dok1.id, formulir({ penyesuaianId: "tidak-ada" })), "tidak ditemukan");
  await jalankan("PS opname 24 (disetujui, koreksi tambahan 1 unit)", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudang.id, akunLawanId: modal.id, keterangan: "opname tambahan", baris: [{ barangId: barang.id, jumlahSesudah: 24 }] })));
  const psOpname = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { gudangId: gudang.id, keterangan: "opname tambahan" } });
  pastikan(psOpname.statusPersetujuan === "DISETUJUI" && (await stok(barang.id, gudang.id)) === 24, "PS opname disetujui, stok jadi 24");
  await pastikanSinkron("PS opname");
  const gudangLain = await db.gudang.create({ data: { kode: "WH-BR2", nama: "Gudang Lain Uji Kerusakan" } });
  await jalankan("PS saldo awal di gudang lain (disetujui)", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudangLain.id, akunLawanId: modal.id, baris: [{ barangId: barang.id, jumlahSesudah: 3, hargaSatuan: 5000 }] })));
  const psGudangLain = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { gudangId: gudangLain.id } });
  await harusDitolak("tautkan PS gudang lain", () => tautkanPenyesuaianKerusakan(dok1.id, formulir({ penyesuaianId: psGudangLain.id })), "untuk gudang lain");
  await jalankan("hapus PS gudang lain", () => hapusDokumen("penyesuaian", psGudangLain.id));
  await jalankan("tautkan PS ke laporan kerusakan", () => tautkanPenyesuaianKerusakan(dok1.id, formulir({ penyesuaianId: psOpname.id })));
  let d = await dokumen(dok1.id);
  pastikan(d.penyesuaianId === psOpname.id, "laporan kerusakan tertaut ke PS");
  pastikan((await db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, jenis: "Laporan Kerusakan Barang", aksi: "TAUTKAN" } })) === 1, "penautan tercatat di log aktivitas");
  await harusDitolak("tautkan dua kali", () => tautkanPenyesuaianKerusakan(dok1.id, formulir({ penyesuaianId: psOpname.id })), "sudah ditautkan");
  await pastikanSinkron("tautkan PS");

  console.log("=== 5. Foto bukti tambahan ===");
  await jalankan("unggah 1 foto tambahan", () => unggahFotoKerusakan(dok1.id, denganFoto({})));
  d = await dokumen(dok1.id);
  pastikan(d.foto.length === 3 && d.foto.map((f) => f.urutan).sort().join(",") === "0,1,2", "foto jadi 3 dengan urutan lanjut");
  await harusDitolak("unggah ke dokumen tidak ada", () => unggahFotoKerusakan("tidak-ada", denganFoto({})), "tidak ditemukan");
  const fotoTambahan = await db.foto.findFirstOrThrow({ where: { kerusakanId: dok1.id, urutan: 2 } });
  await jalankan("hapus foto tambahan", () => hapusFotoKerusakan(fotoTambahan.id));
  pastikan((await db.foto.count({ where: { kerusakanId: dok1.id } })) === 2, "foto tambahan terhapus");
  const fotoBarang = await db.foto.create({ data: { barangId: barang.id, tipe: "image/jpeg", ukuran: JPEG_PALSU.length, isi: new Uint8Array(JPEG_PALSU) } });
  await harusDitolak("hapus foto barang lewat aksi kerusakan", () => hapusFotoKerusakan(fotoBarang.id), "tidak ditemukan");

  console.log("=== 6. Hapus dokumen: stok dikembalikan permanen ===");
  await harusDitolak("hapus dokumen yang sudah ditautkan", () => hapusDokumen("laporanKerusakan", dok1.id), "sudah ditautkan");
  await jalankan("BR 3 (tanpa tautkan)", () => buatLaporanKerusakan(denganFoto({ ...isianDasar, namaPelapor: "Budi", baris: [{ barangId: barang.id, jumlah: 3 }] })));
  const dok2 = await db.laporanKerusakanBarang.findFirstOrThrow({ where: { gudangId: gudang.id, namaPelapor: "Budi" } });
  const stokSebelumHapus = await stok(barang.id, gudang.id);
  await jalankan("hapus BR yang belum ditautkan", () => hapusDokumen("laporanKerusakan", dok2.id));
  pastikan((await stok(barang.id, gudang.id)) === stokSebelumHapus + 3, "hapus BR mengembalikan 3 yang tadi dikurangi");
  pastikan((await db.laporanKerusakanBarang.count({ where: { id: dok2.id } })) === 0, "dokumen terhapus");
  pastikan((await db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, jenis: "Laporan Kerusakan Barang", aksi: "HAPUS" } })) === 1, "penghapusan tercatat di log aktivitas");
  await jalankan("hapus PS opname", () => hapusDokumen("penyesuaian", psOpname.id));
  d = await dokumen(dok1.id);
  pastikan(d.penyesuaianId === null, "PS dihapus: tautan lepas");
  pastikan((await stok(barang.id, gudang.id)) === 25, "stok kembali 25 setelah PS opname dibalik");
  await jalankan("hapus BR dok1 (sisa satu-satunya yang terikat ke barang)", () => hapusDokumen("laporanKerusakan", dok1.id));
  pastikan((await stok(barang.id, gudang.id)) === 30, "stok kembali penuh 30 setelah BR dok1 dihapus");
  const psAwal = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { gudangId: gudang.id } });
  await jalankan("hapus PS saldo awal", () => hapusDokumen("penyesuaian", psAwal.id));
  pastikan((await db.jurnal.count()) === jumlahJurnalAwal, "tidak ada jurnal uji yang tersisa");
  pastikan((await stok(barang.id, gudang.id)) === 0, "stok kembali 0 setelah PS saldo awal dibalik");
  await pastikanSinkron("hapus semua");

  console.log("=== Bersih-bersih ===");
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji } } });
  await db.stokBarang.deleteMany({ where: { barangId: barang.id } });
  await db.barang.deleteMany({ where: { id: { in: [barang.id, jasa.id] } } });
  await db.proyek.delete({ where: { id: proyek.id } });
  await db.gudang.deleteMany({ where: { id: { in: [gudang.id, gudangLain.id] } } });
  await db.akun.deleteMany({ where: { kode: { startsWith: "BR-" } } });
  await pastikanSinkron("bersih-bersih");
  console.log("=== DONE, all laporan kerusakan barang checks passed ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
