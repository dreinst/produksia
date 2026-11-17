import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { hashKataSandi } from "../src/lib/kataSandi";
import { periksaSinkron } from "../src/lib/sinkron";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { buatPenyesuaianPersediaan } from "../src/lib/aksi/persediaan";
import { buatPesananPembelian, buatPenerimaanBarang } from "../src/lib/aksi/pembelian";
import { buatPesanan, buatPengiriman } from "../src/lib/aksi/penjualan";
import { BATAS_PESANAN_MENUNGGU, pesananMenungguDiterima, pesananMenungguDikirim, type AntreanPesanan } from "../src/lib/pesananTerbuka";
import { formulir, jalankan, pastikan, sebagai } from "./bantuan";

/*
 * Antrean kerja Gudang (src/lib/pesananTerbuka.ts): pesanan yang masih punya BARANG dengan sisa untuk diterima atau
 * dikirim. Yang diperiksa: baris JASA tidak ikut dan tidak menahan pesanan di daftar, pesanan hanya jasa dan pesanan
 * DIBATALKAN tidak muncul, saringan perusahaan, urutan tanggal lama dulu, kunci hasil tanpa harga atau total, nama dan
 * satuan tampil baris penjualan, dan Gudang sungguhan bisa menyelesaikan alurnya sendiri.
 * Data uji ada di perusahaan UJAG (daftar tersaring ke UJAG berisi data skrip ini saja, jadi bisa dibandingkan persis);
 * lingkup gabungan memuat data lain di basis data, jadi hanya diperiksa lewat id pesanan uji. Kode data uji PAG.
 */
const GUDANG_PENGGUNA = "ujiag-gudang";
const KUNCI_PESANAN = ["baris", "id", "mitra", "nomor", "perusahaan", "tanggal"];
const KUNCI_BARIS = ["id", "kode", "nama", "satuan", "sisa"];
const KUNCI_PERUSAHAAN = ["kode", "nama", "warna"];

const kunci = (o: object) => Object.keys(o).sort();
const sama = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const nomorDaftar = (a: AntreanPesanan) => a.daftar.map((p) => p.nomor);

/** Membuang sisa putaran terputus: dokumen turunan lewat aksi (stok dan jurnal dibalik), lalu data induk. */
async function bersihkanSisa() {
  const ids = (await db.perusahaan.findMany({ where: { kode: { in: ["UJAG", "UJAH"] } }, select: { id: true } })).map((p) => p.id);
  // revalidatePath melempar galat di luar permintaan HTTP padahal datanya sudah terhapus; hanya galat lain yang dicatat
  const abaikan = (label: string) => (e: unknown) => {
    const pesan = (e as Error).message ?? "";
    if (!pesan.includes("static generation store missing")) console.warn(`[bersih] ${label}: ${pesan}`);
  };
  const terbaru = { orderBy: { tanggal: "desc" as const }, select: { id: true } };
  for (const d of await db.pengirimanPesanan.findMany({ where: { pesanan: { pelanggan: { kode: "PAG-CUST" } } }, ...terbaru })) await hapusDokumen("pengiriman", d.id).catch(abaikan("pengiriman"));
  for (const d of await db.pesananPenjualan.findMany({ where: { pelanggan: { kode: "PAG-CUST" } }, ...terbaru })) await hapusDokumen("pesanan", d.id).catch(abaikan("pesanan"));
  for (const d of await db.penerimaanBarang.findMany({ where: { pesanan: { pemasok: { kode: "PAG-SUP" } } }, ...terbaru })) await hapusDokumen("penerimaanBarang", d.id).catch(abaikan("penerimaan"));
  for (const d of await db.pesananPembelian.findMany({ where: { pemasok: { kode: "PAG-SUP" } }, ...terbaru })) await hapusDokumen("pesananPembelian", d.id).catch(abaikan("pesanan pembelian"));
  for (const d of await db.penyesuaianPersediaan.findMany({ where: { gudang: { kode: "WH-PAG" } }, ...terbaru })) await hapusDokumen("penyesuaian", d.id).catch(abaikan("PS"));
  await db.stokBarang.deleteMany({ where: { barang: { kode: { startsWith: "PAG-" } } } });
  await db.barang.deleteMany({ where: { kode: { startsWith: "PAG-" } } });
  await db.gudang.deleteMany({ where: { kode: "WH-PAG" } });
  await db.pelanggan.deleteMany({ where: { kode: "PAG-CUST" } });
  await db.pemasok.deleteMany({ where: { kode: "PAG-SUP" } });
  await db.akun.deleteMany({ where: { kode: "PAG-MODAL" } });
  await db.pengguna.deleteMany({ where: { namaPengguna: GUDANG_PENGGUNA } });
  await db.perusahaan.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  const mulaiUji = new Date();
  await bersihkanSisa();

  console.log("=== Data uji ===");
  const ujag = await db.perusahaan.create({ data: { kode: "UJAG", nama: "PT Uji Antrean Gudang", urutan: 97 } });
  const ujah = await db.perusahaan.create({ data: { kode: "UJAH", nama: "PT Uji Antrean Lain", urutan: 98 } });
  const gudang = await db.gudang.create({ data: { kode: "WH-PAG", nama: "Gudang Uji Antrean" } });
  const barang = await db.barang.create({ data: { kode: "PAG-BRG", nama: "Barang Katalog Antrean", satuan: "pcs", hargaBeli: 0, hargaJual: 1000, perusahaanId: ujag.id } });
  const jasa = await db.barang.create({ data: { kode: "PAG-JASA", nama: "Jasa Antrean", jenis: "JASA", hargaBeli: 0, hargaJual: 500, perusahaanId: ujag.id } });
  const pemasok = await db.pemasok.create({ data: { kode: "PAG-SUP", nama: "Pemasok Antrean" } });
  const pelanggan = await db.pelanggan.create({ data: { kode: "PAG-CUST", nama: "Pelanggan Antrean" } });
  const modal = await db.akun.create({ data: { kode: "PAG-MODAL", nama: "Modal Uji Antrean", jenis: "MODAL" } });
  await db.pengguna.create({ data: { namaPengguna: GUDANG_PENGGUNA, nama: "Gudang Antrean Uji", peran: "GUDANG", kataSandiHash: await hashKataSandi("ujiag-gudang-123") } });
  await jalankan("PS saldo awal 50", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudang.id, akunLawanId: modal.id, baris: [{ barangId: barang.id, jumlahSesudah: 50, hargaSatuan: 1000 }] })));

  console.log("=== A. Antrean terima barang (pesanan pembelian) ===");
  const buatPo = async (pemasokBaris: object[]) => {
    const sebelum = new Set((await db.pesananPembelian.findMany({ where: { pemasokId: pemasok.id }, select: { id: true } })).map((p) => p.id));
    await jalankan("PSB", () => buatPesananPembelian(formulir({ pemasokId: pemasok.id, perusahaanId: ujag.id, baris: pemasokBaris })));
    return db.pesananPembelian.findFirstOrThrow({ where: { pemasokId: pemasok.id, id: { notIn: [...sebelum] } }, include: { baris: true } });
  };
  const po1 = await buatPo([{ barangId: barang.id, jumlah: 5, harga: 1000 }, { barangId: jasa.id, jumlah: 1, harga: 500 }]);
  const barisBarang = po1.baris.find((b) => b.barangId === barang.id)!;
  const barisJasa = po1.baris.find((b) => b.barangId === jasa.id)!;
  let a = await pesananMenungguDiterima(ujag.id);
  pastikan(a.total === 1 && a.daftar.length === 1 && a.daftar[0].id === po1.id, "PSB campuran muncul sebagai satu-satunya pesanan UJAG");
  pastikan(a.daftar[0].baris.length === 1 && a.daftar[0].baris[0].id === barisBarang.id && a.daftar[0].baris[0].sisa === 5, "hanya baris BARANG, sisa 5 (baris JASA tidak ikut)");
  pastikan(a.daftar[0].mitra === "Pemasok Antrean" && a.daftar[0].perusahaan.kode === "UJAG" && a.daftar[0].baris[0].kode === "PAG-BRG" && a.daftar[0].baris[0].nama === "Barang Katalog Antrean" && a.daftar[0].baris[0].satuan === "pcs", "mitra, perusahaan, kode, nama, dan satuan benar");
  pastikan(sama(kunci(a.daftar[0]), KUNCI_PESANAN) && sama(kunci(a.daftar[0].baris[0]), KUNCI_BARIS) && sama(kunci(a.daftar[0].perusahaan), KUNCI_PERUSAHAAN), "kunci hasil persis PesananMenunggu dan BarisMenunggu (tanpa harga atau total)");

  const po2 = await buatPo([{ barangId: jasa.id, jumlah: 2, harga: 500 }]);
  a = await pesananMenungguDiterima(ujag.id);
  pastikan(a.total === 1 && !nomorDaftar(a).includes(po2.nomor), "PSB hanya JASA tidak muncul");

  const po3 = await buatPo([{ barangId: barang.id, jumlah: 1, harga: 1000 }]);
  await db.pesananPembelian.update({ where: { id: po3.id }, data: { tanggal: new Date("2020-01-01T00:00:00Z") } });
  a = await pesananMenungguDiterima(ujag.id);
  pastikan(a.total === 2 && a.daftar.length === 2 && sama(nomorDaftar(a), [po3.nomor, po1.nomor]), "total sama dengan panjang daftar dan pesanan tertua tampil lebih dulu");
  pastikan(BATAS_PESANAN_MENUNGGU === 50, "BATAS_PESANAN_MENUNGGU 50");

  const terima = (pesananId: string, baris: { barisPesananId: string; barangId: string; jumlah: number }[], pengguna?: string) => {
    const kerja = () => jalankan(`terima ${baris[0].jumlah}`, () => buatPenerimaanBarang(formulir({ pesananId, gudangId: gudang.id, baris })));
    return pengguna ? sebagai(pengguna, kerja) : kerja();
  };
  await terima(po1.id, [{ barisPesananId: barisBarang.id, barangId: barang.id, jumlah: 2 }]);
  a = await pesananMenungguDiterima(ujag.id);
  const po1Sebagian = a.daftar.find((p) => p.id === po1.id);
  pastikan(a.total === 2 && po1Sebagian?.baris.length === 1 && po1Sebagian.baris[0].sisa === 3, "terima sebagian 2: sisa 3 dan pesanan masih di daftar");
  await terima(po1.id, [{ barisPesananId: barisBarang.id, barangId: barang.id, jumlah: 3 }]);
  a = await pesananMenungguDiterima(ujag.id);
  const jasaPo1 = await db.barisPesananPembelian.findUniqueOrThrow({ where: { id: barisJasa.id } });
  pastikan(Number(jasaPo1.jumlahDiterima) === 0, "baris JASA belum diterima sama sekali");
  pastikan(a.total === 1 && sama(nomorDaftar(a), [po3.nomor]), "diterima penuh: hilang dari daftar walau baris JASA belum diterima");

  console.log("=== A2. Saringan perusahaan ===");
  a = await pesananMenungguDiterima(ujah.id);
  pastikan(a.total === 0 && a.daftar.length === 0, "perusahaan lain: pesanan UJAG tidak muncul");
  // Gabungan dibuktikan lewat hitungan: totalnya sama dengan jumlah total tiap perusahaan (UJAG menyumbang 1). Daftar
  // gabungan dipotong di batas tampil, jadi keanggotaan lewat nomor hanya diperiksa bila daftarnya tidak terpotong.
  const semuaPerusahaan = await db.perusahaan.findMany({ select: { id: true } });
  const jumlahPerPerusahaan = async (ambil: (id: string) => Promise<{ total: number }>) => {
    let jumlah = 0;
    for (const p of semuaPerusahaan) jumlah += (await ambil(p.id)).total;
    return jumlah;
  };
  a = await pesananMenungguDiterima(null);
  pastikan((await pesananMenungguDiterima(ujag.id)).total === 1 && a.total === (await jumlahPerPerusahaan(pesananMenungguDiterima)), "gabungan (null) = jumlah semua perusahaan, termasuk 1 pesanan UJAG");
  if (a.total === a.daftar.length) pastikan(nomorDaftar(a).includes(po3.nomor), "daftar gabungan yang tidak terpotong memuat pesanan UJAG");
  const tanpaLingkup = await pesananMenungguDiterima(undefined);
  pastikan(tanpaLingkup.total === a.total, "undefined diperlakukan sebagai gabungan");

  console.log("=== A3. Pesanan DIBATALKAN ===");
  await db.pesananPembelian.update({ where: { id: po3.id }, data: { status: "DIBATALKAN" } });
  a = await pesananMenungguDiterima(ujag.id);
  pastikan(a.total === 0 && a.daftar.length === 0, "pesanan DIBATALKAN tidak muncul");
  await db.pesananPembelian.update({ where: { id: po3.id }, data: { status: "DIPROSES" } });
  a = await pesananMenungguDiterima(ujag.id);
  pastikan(a.total === 1, "status dikembalikan: muncul lagi (saringan memang dari status)");

  console.log("=== B. Antrean kirim (pesanan penjualan) ===");
  const buatPsj = async (baris: object[]) => {
    const sebelum = new Set((await db.pesananPenjualan.findMany({ where: { pelangganId: pelanggan.id }, select: { id: true } })).map((p) => p.id));
    await jalankan("PSJ", () => buatPesanan(formulir({ pelangganId: pelanggan.id, perusahaanId: ujag.id, baris })));
    return db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id, id: { notIn: [...sebelum] } }, include: { baris: { orderBy: { urutan: "asc" } } } });
  };
  const psj1 = await buatPsj([{ barangId: barang.id, jumlah: 5, harga: 1000, nama: "Nama Tampil Pesanan", satuan: "unit" }, { barangId: jasa.id, jumlah: 1, harga: 500 }]);
  const sBarang = psj1.baris.find((b) => b.barangId === barang.id)!;
  let b = await pesananMenungguDikirim(ujag.id);
  pastikan(b.total === 1 && b.daftar[0].id === psj1.id && b.daftar[0].baris.length === 1 && b.daftar[0].baris[0].sisa === 5, "PSJ campuran muncul, hanya baris BARANG, sisa 5");
  pastikan(b.daftar[0].baris[0].nama === "Nama Tampil Pesanan" && b.daftar[0].baris[0].satuan === "unit" && b.daftar[0].baris[0].kode === "PAG-BRG", "nama dan satuan tampil baris pesanan didahulukan dari Barang");
  pastikan(b.daftar[0].mitra === "Pelanggan Antrean" && b.daftar[0].perusahaan.kode === "UJAG", "mitra dan perusahaan benar");
  pastikan(sama(kunci(b.daftar[0]), KUNCI_PESANAN) && sama(kunci(b.daftar[0].baris[0]), KUNCI_BARIS) && sama(kunci(b.daftar[0].perusahaan), KUNCI_PERUSAHAAN), "kunci hasil persis PesananMenunggu dan BarisMenunggu (tanpa harga atau total)");

  const psj2 = await buatPsj([{ barangId: jasa.id, jumlah: 1, harga: 500 }]);
  b = await pesananMenungguDikirim(ujag.id);
  pastikan(b.total === 1 && !nomorDaftar(b).includes(psj2.nomor), "PSJ hanya JASA tidak muncul");
  const psj3 = await buatPsj([{ barangId: barang.id, jumlah: 1, harga: 1000 }]);
  await db.pesananPenjualan.update({ where: { id: psj3.id }, data: { tanggal: new Date("2020-01-01T00:00:00Z") } });
  b = await pesananMenungguDikirim(ujag.id);
  pastikan(b.total === 2 && b.daftar.length === 2 && sama(nomorDaftar(b), [psj3.nomor, psj1.nomor]), "total sama dengan panjang daftar dan pesanan tertua tampil lebih dulu");
  const kirim = (pesananId: string, baris: { barisPesananId: string; barangId: string; jumlah: number }[], pengguna?: string) => {
    const kerja = () => jalankan(`kirim ${baris[0].jumlah}`, () => buatPengiriman(formulir({ pesananId, gudangId: gudang.id, baris })));
    return pengguna ? sebagai(pengguna, kerja) : kerja();
  };
  await kirim(psj1.id, [{ barisPesananId: sBarang.id, barangId: barang.id, jumlah: 2 }]);
  b = await pesananMenungguDikirim(ujag.id);
  pastikan(b.daftar.find((p) => p.id === psj1.id)?.baris[0].sisa === 3, "kirim sebagian 2: sisa 3");
  await kirim(psj1.id, [{ barisPesananId: sBarang.id, barangId: barang.id, jumlah: 3 }]);
  b = await pesananMenungguDikirim(ujag.id);
  pastikan(b.total === 1 && sama(nomorDaftar(b), [psj3.nomor]), "terkirim penuh: hilang dari daftar walau baris JASA belum diserahkan");
  b = await pesananMenungguDikirim(ujah.id);
  pastikan(b.total === 0 && b.daftar.length === 0, "perusahaan lain: pesanan UJAG tidak muncul");
  b = await pesananMenungguDikirim(null);
  pastikan((await pesananMenungguDikirim(ujag.id)).total === 1 && b.total === (await jumlahPerPerusahaan(pesananMenungguDikirim)), "gabungan (null) = jumlah semua perusahaan, termasuk 1 pesanan UJAG");
  if (b.total === b.daftar.length) pastikan(nomorDaftar(b).includes(psj3.nomor), "daftar gabungan yang tidak terpotong memuat pesanan UJAG");
  await db.pesananPenjualan.update({ where: { id: psj3.id }, data: { status: "DIBATALKAN" } });
  b = await pesananMenungguDikirim(ujag.id);
  pastikan(b.total === 0 && b.daftar.length === 0, "pesanan penjualan DIBATALKAN tidak muncul");

  console.log("=== C. Gudang sungguhan menyelesaikan alurnya sendiri ===");
  const po4 = await buatPo([{ barangId: barang.id, jumlah: 4, harga: 1000 }]);
  const stokSebelum = Number((await db.stokBarang.findUniqueOrThrow({ where: { barangId_gudangId: { barangId: barang.id, gudangId: gudang.id } } })).jumlah);
  a = await pesananMenungguDiterima(ujag.id);
  pastikan(a.daftar.some((p) => p.id === po4.id), "PSB baru ada di antrean");
  await terima(po4.id, [{ barisPesananId: po4.baris[0].id, barangId: barang.id, jumlah: 4 }], GUDANG_PENGGUNA);
  const tb = await db.penerimaanBarang.findFirstOrThrow({ where: { pesananId: po4.id } });
  pastikan(tb.perusahaanId === ujag.id && Number((await db.stokBarang.findUniqueOrThrow({ where: { barangId_gudangId: { barangId: barang.id, gudangId: gudang.id } } })).jumlah) === stokSebelum + 4, "Gudang berhasil Terima Barang: stok bertambah 4");
  a = await pesananMenungguDiterima(ujag.id);
  pastikan(!a.daftar.some((p) => p.id === po4.id), "PSB yang diterima Gudang keluar dari antrean");
  const psj4 = await buatPsj([{ barangId: barang.id, jumlah: 3, harga: 1000 }]);
  await kirim(psj4.id, [{ barisPesananId: psj4.baris[0].id, barangId: barang.id, jumlah: 3 }], GUDANG_PENGGUNA);
  const sj = await db.pengirimanPesanan.findFirstOrThrow({ where: { pesananId: psj4.id } });
  pastikan(sj.perusahaanId === ujag.id && Number((await db.stokBarang.findUniqueOrThrow({ where: { barangId_gudangId: { barangId: barang.id, gudangId: gudang.id } } })).jumlah) === stokSebelum + 4 - 3, "Gudang berhasil Kirim: stok berkurang 3");
  b = await pesananMenungguDikirim(ujag.id);
  pastikan(!b.daftar.some((p) => p.id === psj4.id), "PSJ yang dikirim Gudang keluar dari antrean");

  console.log("=== Bersih-bersih ===");
  await bersihkanSisa();
  pastikan((await db.perusahaan.count({ where: { kode: { in: ["UJAG", "UJAH"] } } })) === 0 && (await db.pesananPembelian.count({ where: { pemasok: { kode: "PAG-SUP" } } })) === 0, "data uji terhapus");
  // hanya log buatan skrip ini: pengguna Gudang uji dan pengguna skrip bawaan
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji }, penggunaNama: { in: ["Skrip Uji", "Gudang Antrean Uji"] } } });
  const s = await periksaSinkron(db);
  pastikan(s.seimbang && s.persediaan.sinkron && s.barangBelumDitagih.sinkron && s.barangTerkirim.sinkron, "sinkron setelah bersih-bersih");
  console.log("=== DONE, all antrean gudang checks passed ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
