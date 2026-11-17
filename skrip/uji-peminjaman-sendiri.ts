import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { hashKataSandi } from "../src/lib/kataSandi";
import { periksaSinkron } from "../src/lib/sinkron";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { buatPenyesuaianPersediaan } from "../src/lib/aksi/persediaan";
import { ajukanKembaliPeminjamanBarang, buatPeminjamanBarang, ubahPeminjamanBarang } from "../src/lib/aksi/peminjaman";
import { ajukanDokumen, setujuiDokumen, tolakDokumen } from "../src/lib/aksi/persetujuan";
import { hanyaPeminjamanSendiri, peminjamanMilik, saringPeminjamanSendiri } from "../src/lib/peminjaman";
import { aturPersetujuan, formulir, harusDitolak, jalankan, pastikan, sebagai } from "./bantuan";

/*
 * Kru dan Guest hanya mengurus peminjaman yang dicatatnya sendiri: aksi "Ajukan", "Ubah data", dan "Ajukan kembali"
 * menolak dokumen orang lain dengan pesan yang sama seperti dokumen yang tidak ada, dan saringPeminjamanSendiri
 * memberi where Prisma yang sama untuk kartu "Menunggu persetujuan" dan "Sedang di luar". Pengaju (diajukanOlehId)
 * tidak dihitung sebagai pemilik, supaya menekan "Ajukan" pada draf orang lain tidak memindahkan kepemilikannya.
 * Gudang dan peran lain mengurus semuanya.
 * Pengguna uji dibuat sungguhan (ujipsd-*) karena yang dibandingkan adalah id pengguna di dokumen.
 * Data uji berkode PSD dan dibersihkan lewat hapusDokumen di akhir (stok ikut dibalik).
 */
const KRU_A = "ujipsd-kru-a";
const KRU_B = "ujipsd-kru-b";
const GUEST = "ujipsd-guest";
const GUDANG = "ujipsd-gudang";
const PESAN_TIDAK_ADA = "Dokumen peminjaman tidak ditemukan";
const PESAN_AJUKAN_TIDAK_ADA = "Peminjaman Barang tidak ditemukan";
const NAMA_PELAKU_UJI = ["Skrip Uji", "Kru A Uji", "Kru B Uji", "Guest Uji", "Gudang Uji"];
const JPEG_PALSU = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

function denganFoto(isian: Parameters<typeof formulir>[0]): FormData {
  const fd = formulir(isian);
  fd.append("foto", new File([new Uint8Array(JPEG_PALSU)], "bukti-0.bin", { type: "application/octet-stream" }));
  return fd;
}

const stok = async (barangId: string, gudangId: string) => Number((await db.stokBarang.findUnique({ where: { barangId_gudangId: { barangId, gudangId } } }))?.jumlah ?? 0);
const keadaan = async (id: string) => {
  const d = await db.peminjamanBarang.findUniqueOrThrow({ where: { id }, include: { baris: true, foto: { select: { tahap: true } } } });
  return { diajukan: Number(d.baris[0].jumlahDiajukanKembali), kembali: Number(d.baris[0].jumlahKembali), fotoKembali: d.foto.filter((f) => f.tahap === "KEMBALI").length };
};

/** Membuang sisa dari putaran yang terputus: dokumen lewat aksi (stok dibalik), lalu data induk dan pengguna. */
async function bersihkanSisa() {
  const daftar = await db.peminjamanBarang.findMany({ where: { gudang: { kode: "WH-PSD" } }, select: { id: true } });
  for (const d of daftar) await jalankan("hapus sisa peminjaman", () => hapusDokumen("peminjamanBarang", d.id));
  const ps = await db.penyesuaianPersediaan.findMany({ where: { gudang: { kode: "WH-PSD" } }, select: { id: true } });
  for (const p of ps) await jalankan("hapus sisa PS", () => hapusDokumen("penyesuaian", p.id));
  await db.stokBarang.deleteMany({ where: { barang: { kode: "BRG-PSD" } } });
  await db.barang.deleteMany({ where: { kode: "BRG-PSD" } });
  await db.gudang.deleteMany({ where: { kode: "WH-PSD" } });
  await db.akun.deleteMany({ where: { kode: "PSD-MODAL" } });
  await db.pengguna.deleteMany({ where: { namaPengguna: { in: [KRU_A, KRU_B, GUEST, GUDANG] } } });
}

async function main() {
  const mulaiUji = new Date();
  await bersihkanSisa();

  console.log("=== Data uji ===");
  const buatPengguna = async (namaPengguna: string, nama: string, peran: "KRU" | "GUEST" | "GUDANG") =>
    db.pengguna.create({ data: { namaPengguna, nama, peran, kataSandiHash: await hashKataSandi(`${namaPengguna}-123`) } });
  const kruA = await buatPengguna(KRU_A, "Kru A Uji", "KRU");
  const kruB = await buatPengguna(KRU_B, "Kru B Uji", "KRU");
  const guest = await buatPengguna(GUEST, "Guest Uji", "GUEST");
  const gudangPengguna = await buatPengguna(GUDANG, "Gudang Uji", "GUDANG");
  const gudang = await db.gudang.create({ data: { kode: "WH-PSD", nama: "Gudang Uji Peminjaman Sendiri" } });
  const barang = await db.barang.create({ data: { kode: "BRG-PSD", nama: "Barang Uji Peminjaman Sendiri", hargaBeli: 0, hargaJual: 1000 } });
  const modal = await db.akun.create({ data: { kode: "PSD-MODAL", nama: "Modal Uji Peminjaman Sendiri", jenis: "MODAL" } });
  await jalankan("PS saldo awal 100", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudang.id, akunLawanId: modal.id, baris: [{ barangId: barang.id, jumlahSesudah: 100, hargaSatuan: 1000 }] })));

  const pinjam = (pengguna: string, namaPengambil: string, jumlah = 10) =>
    sebagai(pengguna, () => jalankan(`${pengguna} pinjam ${jumlah} (${namaPengambil})`, () => buatPeminjamanBarang(denganFoto({ gudangId: gudang.id, namaPengambil, nomorTelepon: "+6281234567890", baris: [{ barangId: barang.id, jumlah }] }))));
  const ambil = (namaPengambil: string) => db.peminjamanBarang.findFirstOrThrow({ where: { gudangId: gudang.id, namaPengambil } });
  const kembalikan = (pengguna: string, dokumenId: string, jumlahKembali: number) =>
    sebagai(pengguna, () => ajukanKembaliPeminjamanBarang(dokumenId, denganFoto({ nomorTeleponKembali: "+6281234567890", baris: [{ barangId: barang.id, jumlahKembali }] })));

  await pinjam(KRU_A, "Pengambil A");
  await pinjam(GUEST, "Pengambil Guest");
  await pinjam(GUDANG, "Pengambil Dicatat Gudang");
  const dokA = await ambil("Pengambil A");
  const dokGuest = await ambil("Pengambil Guest");
  const dokGudang = await ambil("Pengambil Dicatat Gudang");
  pastikan(dokA.statusPersetujuan === "DISETUJUI" && dokA.dicatatOlehId === kruA.id && dokA.diajukanOlehId === kruA.id, "dokumen Kru A DISETUJUI, dicatat dan diajukan Kru A");
  pastikan(dokGudang.dicatatOlehId === gudangPengguna.id && dokGudang.diajukanOlehId === gudangPengguna.id, "dokumen Gudang dicatat dan diajukan Gudang");
  pastikan((await stok(barang.id, gudang.id)) === 70, "stok 70 setelah tiga peminjaman 10");

  console.log("=== 1. Kru B dan Guest tidak bisa mengajukan kembali dokumen Kru A ===");
  const stokAwal = await stok(barang.id, gudang.id);
  for (const [pelaku, label] of [[KRU_B, "Kru B"], [GUEST, "Guest"]] as const) {
    await harusDitolak(`${label} ajukan kembali dokumen Kru A`, () => kembalikan(pelaku, dokA.id, 5), PESAN_TIDAK_ADA);
    const k = await keadaan(dokA.id);
    pastikan(k.diajukan === 0 && k.kembali === 0 && k.fotoKembali === 0, `penolakan ${label}: jumlahDiajukanKembali 0 dan tidak ada foto KEMBALI`);
  }
  pastikan((await stok(barang.id, gudang.id)) === stokAwal, "penolakan tidak menyentuh stok");

  console.log("=== 2. Kru A mengajukan kembali dokumennya sendiri ===");
  await jalankan("Kru A ajukan kembali 4", () => kembalikan(KRU_A, dokA.id, 4));
  let k = await keadaan(dokA.id);
  pastikan(k.diajukan === 4 && k.kembali === 0 && k.fotoKembali === 1, "jumlahDiajukanKembali naik jadi 4, foto KEMBALI tersimpan, jumlahKembali tetap 0");
  pastikan((await stok(barang.id, gudang.id)) === stokAwal, "ajukan kembali belum mengubah stok");

  console.log("=== 3. Guest: sama dengan Kru ===");
  await harusDitolak("Guest ajukan kembali dokumen Gudang", () => kembalikan(GUEST, dokGudang.id, 5), PESAN_TIDAK_ADA);
  await harusDitolak("Kru A ajukan kembali dokumen Guest", () => kembalikan(KRU_A, dokGuest.id, 5), PESAN_TIDAK_ADA);
  k = await keadaan(dokGuest.id);
  pastikan(k.diajukan === 0 && k.fotoKembali === 0, "dokumen Guest tidak berubah oleh penolakan");
  await jalankan("Guest ajukan kembali dokumennya sendiri 6", () => kembalikan(GUEST, dokGuest.id, 6));
  k = await keadaan(dokGuest.id);
  pastikan(k.diajukan === 6 && k.fotoKembali === 1, "Guest berhasil: jumlahDiajukanKembali 6, 1 foto KEMBALI");

  console.log("=== 4. Dokumen yang dicatat Gudang atas nama kru tidak bisa diajukan kembali Kru A ===");
  await harusDitolak("Kru A ajukan kembali dokumen yang dicatat Gudang", () => kembalikan(KRU_A, dokGudang.id, 5), PESAN_TIDAK_ADA);
  k = await keadaan(dokGudang.id);
  pastikan(k.diajukan === 0 && k.fotoKembali === 0, "dokumen Gudang tidak berubah");

  console.log("=== 5. Gudang boleh mengajukan kembali dokumen siapa pun ===");
  await jalankan("Gudang ajukan kembali dokumen Kru A 3", () => kembalikan(GUDANG, dokA.id, 3));
  k = await keadaan(dokA.id);
  pastikan(k.diajukan === 7 && k.fotoKembali === 2, "dokumen Kru A: diajukan 4 + 3 = 7, 2 foto KEMBALI");
  await jalankan("Gudang ajukan kembali dokumen Guest 2", () => kembalikan(GUDANG, dokGuest.id, 2));
  pastikan((await keadaan(dokGuest.id)).diajukan === 8, "dokumen Guest: diajukan 6 + 2 = 8");
  await jalankan("Gudang ajukan kembali dokumennya sendiri 10", () => kembalikan(GUDANG, dokGudang.id, 10));
  pastikan((await keadaan(dokGudang.id)).diajukan === 10, "dokumen Gudang diajukan kembali penuh");

  console.log("=== 6. Milik sendiri = pencatat; pengaju saja tidak cukup ===");
  await pinjam(KRU_B, "Pengambil B", 5);
  const dokB = await ambil("Pengambil B");
  await db.peminjamanBarang.update({ where: { id: dokB.id }, data: { dicatatOlehId: gudangPengguna.id } });
  await harusDitolak("Kru B (hanya pengaju) ajukan kembali dokumen yang dicatat Gudang", () => kembalikan(KRU_B, dokB.id, 1), PESAN_TIDAK_ADA);
  pastikan((await keadaan(dokB.id)).diajukan === 0, "diajukanOlehId = Kru B saja tidak cukup");
  await db.peminjamanBarang.update({ where: { id: dokB.id }, data: { dicatatOlehId: kruB.id, diajukanOlehId: gudangPengguna.id } });
  await jalankan("Kru B (pencatat) ajukan kembali dokumen yang diajukan Gudang", () => kembalikan(KRU_B, dokB.id, 1));
  pastikan((await keadaan(dokB.id)).diajukan === 1, "dicatatOlehId = Kru B cukup");
  await db.peminjamanBarang.update({ where: { id: dokB.id }, data: { dicatatOlehId: null, diajukanOlehId: null } });
  await harusDitolak("Kru B ajukan kembali dokumen tanpa pencatat", () => kembalikan(KRU_B, dokB.id, 1), PESAN_TIDAK_ADA);
  pastikan((await keadaan(dokB.id)).diajukan === 1, "dokumen tanpa pencatat tidak berubah");

  console.log("=== 7. Fungsi bantu peminjaman ===");
  pastikan(peminjamanMilik({ dicatatOlehId: "u1" }, "u1"), "peminjamanMilik benar untuk pencatat");
  pastikan(!peminjamanMilik({ dicatatOlehId: "u2" }, "u1") && !peminjamanMilik({ dicatatOlehId: null }, "u1"), "peminjamanMilik salah untuk orang lain dan dokumen tanpa pencatat");
  const hanyaPengaju = { dicatatOlehId: "u2", diajukanOlehId: "u1" };
  pastikan(!peminjamanMilik(hanyaPengaju, "u1"), "pengaju saja bukan pemilik");
  pastikan(hanyaPeminjamanSendiri({ peran: "KRU" }) && hanyaPeminjamanSendiri({ peran: "GUEST" }), "Kru dan Guest hanya peminjaman sendiri");
  pastikan(["GUDANG", "ADMIN", "PEMILIK", "SUPERADMIN"].every((peran) => !hanyaPeminjamanSendiri({ peran })), "Gudang, Admin, Pemilik, Superadmin mengurus semuanya");
  const semuaId = (await db.peminjamanBarang.findMany({ where: { gudangId: gudang.id }, select: { id: true } })).map((d) => d.id).sort();
  const idUntuk = async (pengguna: { id: string; peran: string }) =>
    (await db.peminjamanBarang.findMany({ where: { gudangId: gudang.id, ...saringPeminjamanSendiri(pengguna) }, select: { id: true } })).map((d) => d.id).sort();
  pastikan(JSON.stringify(await idUntuk({ id: kruA.id, peran: "KRU" })) === JSON.stringify([dokA.id]), "saringPeminjamanSendiri Kru A: hanya dokumen yang dicatatnya");
  pastikan(JSON.stringify(await idUntuk({ id: guest.id, peran: "GUEST" })) === JSON.stringify([dokGuest.id]), "saringPeminjamanSendiri Guest: hanya dokumen yang dicatatnya");
  pastikan(Object.keys(saringPeminjamanSendiri({ id: gudangPengguna.id, peran: "GUDANG" })).length === 0, "saringPeminjamanSendiri Gudang: objek kosong");
  pastikan(JSON.stringify(await idUntuk({ id: gudangPengguna.id, peran: "GUDANG" })) === JSON.stringify(semuaId), "Gudang melihat semua dokumen");

  console.log("=== 8. Alur persetujuan menyala: draf Kru A tidak bisa diajukan atau diubah Kru B dan Guest ===");
  aturPersetujuan(true);
  await pinjam(KRU_A, "Pengambil A Persetujuan", 5);
  const dokP = await ambil("Pengambil A Persetujuan");
  pastikan(dokP.statusPersetujuan === "DRAFT" && dokP.dicatatOlehId === kruA.id && dokP.diajukanOlehId === null, "dokumen baru DRAFT, dicatat Kru A, belum ada pengaju");
  const ubah = (pengguna: string, dokumenId: string, namaPengambil: string, keterangan: string) =>
    sebagai(pengguna, () => ubahPeminjamanBarang(dokumenId, formulir({ namaPengambil, keterangan })));
  for (const [pelaku, label] of [[KRU_B, "Kru B"], [GUEST, "Guest"]] as const) {
    await harusDitolak(`${label} menekan Ajukan pada draf Kru A`, () => sebagai(pelaku, () => ajukanDokumen("peminjaman", dokP.id)), PESAN_AJUKAN_TIDAK_ADA);
    await harusDitolak(`${label} mengubah data draf Kru A`, () => ubah(pelaku, dokP.id, "Diganti Orang Lain", "diubah orang lain"), PESAN_TIDAK_ADA);
  }
  let segar = await db.peminjamanBarang.findUniqueOrThrow({ where: { id: dokP.id } });
  pastikan(segar.statusPersetujuan === "DRAFT" && segar.diajukanOlehId === null, "draf Kru A tetap DRAFT tanpa pengaju sesudah dua penolakan");
  pastikan(segar.namaPengambil === "Pengambil A Persetujuan" && segar.keterangan === null, "data draf Kru A tidak berubah");
  await jalankan("Kru A mengubah data drafnya sendiri", () => ubah(KRU_A, dokP.id, "Pengambil A Persetujuan", "diubah Kru A"));
  await jalankan("Gudang mengubah data draf Kru A", () => ubah(GUDANG, dokP.id, "Pengambil A Persetujuan", "diubah Gudang"));
  pastikan((await db.peminjamanBarang.findUniqueOrThrow({ where: { id: dokP.id } })).keterangan === "diubah Gudang", "Kru A dan Gudang boleh mengubah data draf itu");
  await sebagai(KRU_A, () => jalankan("Kru A ajukan dokumen", () => ajukanDokumen("peminjaman", dokP.id)));
  await sebagai(GUDANG, () => jalankan("Gudang setujui dokumen Kru A", () => setujuiDokumen("peminjaman", dokP.id)));
  segar = await db.peminjamanBarang.findUniqueOrThrow({ where: { id: dokP.id } });
  pastikan(segar.statusPersetujuan === "DISETUJUI" && segar.diajukanOlehId === kruA.id, "DISETUJUI Gudang, pengaju tetap Kru A");
  await harusDitolak("Kru B ajukan kembali dokumen hasil persetujuan", () => kembalikan(KRU_B, dokP.id, 2), PESAN_TIDAK_ADA);
  await harusDitolak("Kru B mengubah data pinjaman Kru A yang sudah disetujui", () => ubah(KRU_B, dokP.id, "Diganti Orang Lain", "diubah orang lain"), PESAN_TIDAK_ADA);
  await jalankan("Kru A ajukan kembali dokumen hasil persetujuan 2", () => kembalikan(KRU_A, dokP.id, 2));
  pastikan((await keadaan(dokP.id)).diajukan === 2, "Kru A berhasil mengajukan kembali dokumen yang disetujui lewat alur persetujuan");
  await harusDitolak("Kru A mengubah data pinjamannya sendiri yang sudah disetujui", () => ubah(KRU_A, dokP.id, "Pengambil A Persetujuan", "diubah sesudah disetujui"), "sudah disetujui");
  await jalankan("Gudang mengubah data pinjaman Kru A yang sudah disetujui", () => ubah(GUDANG, dokP.id, "Pengambil A Persetujuan", "diubah Gudang sesudah disetujui"));
  pastikan((await db.peminjamanBarang.findUniqueOrThrow({ where: { id: dokP.id } })).keterangan === "diubah Gudang sesudah disetujui", "sesudah disetujui hanya peran yang mengurus semua peminjaman yang mengubah datanya");

  console.log("=== 9. Draf Kru A yang diajukan Gudang tetap milik Kru A ===");
  await pinjam(KRU_A, "Pengambil A Diajukan Gudang", 3);
  const dokQ = await ambil("Pengambil A Diajukan Gudang");
  await sebagai(GUDANG, () => jalankan("Gudang menekan Ajukan pada draf Kru A", () => ajukanDokumen("peminjaman", dokQ.id)));
  // pengajunya Gudang, jadi sesama Gudang tidak boleh menyetujui; Pemilik (pengguna skrip bawaan) yang menyetujui
  await harusDitolak("Gudang menyetujui dokumen yang diajukannya sendiri", () => sebagai(GUDANG, () => setujuiDokumen("peminjaman", dokQ.id)), "pengguna lain");
  await jalankan("Pemilik setujui dokumen yang diajukan Gudang", () => setujuiDokumen("peminjaman", dokQ.id));
  segar = await db.peminjamanBarang.findUniqueOrThrow({ where: { id: dokQ.id } });
  pastikan(segar.statusPersetujuan === "DISETUJUI" && segar.dicatatOlehId === kruA.id && segar.diajukanOlehId === gudangPengguna.id, "DISETUJUI, pencatat Kru A, pengaju Gudang");
  await harusDitolak("Kru B ajukan kembali dokumen itu", () => kembalikan(KRU_B, dokQ.id, 1), PESAN_TIDAK_ADA);
  await jalankan("Kru A ajukan kembali dokumen itu 1", () => kembalikan(KRU_A, dokQ.id, 1));
  pastikan((await keadaan(dokQ.id)).diajukan === 1, "pencatat tetap pemilik walau pengajunya orang lain");

  console.log("=== 10. Ditolak lalu Ajukan Ulang: hanya pencatat (atau Gudang) yang mengurus drafnya ===");
  await pinjam(KRU_A, "Pengambil A Ditolak", 2);
  const dokR = await ambil("Pengambil A Ditolak");
  await sebagai(KRU_A, () => jalankan("Kru A ajukan dokumen", () => ajukanDokumen("peminjaman", dokR.id)));
  await harusDitolak("Kru A mengubah data saat MENUNGGU", () => ubah(KRU_A, dokR.id, "Pengambil A Ditolak", "diubah saat menunggu"), "menunggu persetujuan");
  await sebagai(GUDANG, () => jalankan("Gudang menolak dokumen Kru A", () => tolakDokumen("peminjaman", dokR.id, "Jumlah perlu dicek ulang")));
  pastikan((await db.peminjamanBarang.findUniqueOrThrow({ where: { id: dokR.id } })).statusPersetujuan === "DITOLAK", "dokumen Kru A DITOLAK");
  await harusDitolak("Kru B menekan Ajukan Ulang pada dokumen Kru A", () => sebagai(KRU_B, () => ajukanDokumen("peminjaman", dokR.id)), PESAN_AJUKAN_TIDAK_ADA);
  await harusDitolak("Kru B mengubah data dokumen Kru A yang ditolak", () => ubah(KRU_B, dokR.id, "Diganti Orang Lain", "diubah orang lain"), PESAN_TIDAK_ADA);
  await jalankan("Gudang mengubah data dokumen Kru A yang ditolak", () => ubah(GUDANG, dokR.id, "Pengambil A Ditolak", "diperbaiki Gudang"));
  await jalankan("Kru A mengubah data dokumennya yang ditolak", () => ubah(KRU_A, dokR.id, "Pengambil A Ditolak", "diperbaiki Kru A"));
  await sebagai(KRU_A, () => jalankan("Kru A menekan Ajukan Ulang", () => ajukanDokumen("peminjaman", dokR.id)));
  segar = await db.peminjamanBarang.findUniqueOrThrow({ where: { id: dokR.id } });
  pastikan(segar.statusPersetujuan === "MENUNGGU" && segar.diajukanOlehId === kruA.id && segar.keterangan === "diperbaiki Kru A", "Ajukan Ulang oleh pencatat berhasil: MENUNGGU, pengaju Kru A");
  await sebagai(GUDANG, () => jalankan("Gudang setujui sesudah Ajukan Ulang", () => setujuiDokumen("peminjaman", dokR.id)));
  aturPersetujuan(false);

  console.log("=== Bersih-bersih ===");
  const semua = await db.peminjamanBarang.findMany({ where: { gudangId: gudang.id }, select: { id: true } });
  for (const d of semua) await jalankan("hapus peminjaman uji", () => hapusDokumen("peminjamanBarang", d.id));
  pastikan((await stok(barang.id, gudang.id)) === 100, "stok kembali 100 setelah semua peminjaman dihapus");
  await bersihkanSisa();
  // hanya log buatan skrip ini: pengguna uji di atas dan pengguna skrip bawaan
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji }, penggunaNama: { in: NAMA_PELAKU_UJI } } });
  const s = await periksaSinkron(db);
  pastikan(s.seimbang && s.persediaan.sinkron, "sinkron setelah bersih-bersih");
  console.log("=== DONE, all peminjaman sendiri checks passed ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
