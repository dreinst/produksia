import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";

import { db } from "../src/lib/db";
import { aturPersetujuan, formulir, harusDitolak, jalankan, pastikan, sebagai } from "./bantuan";
import { terapkanBaganAkunStandar } from "../src/lib/baganAkun";
import { hashKataSandi } from "../src/lib/kataSandi";
import { buatPesanan, buatFaktur } from "../src/lib/aksi/penjualan";
import { buatPesananPembelian, buatFakturPembelian } from "../src/lib/aksi/pembelian";
import { buatKasKeluar } from "../src/lib/aksi/jurnal";
import { buatPenyesuaianPersediaan } from "../src/lib/aksi/persediaan";
import { buatLaporanKerusakan } from "../src/lib/aksi/kerusakan";
import { buatAsetTetap } from "../src/lib/aksi/asetTetap";
import { buatPenggajian } from "../src/lib/aksi/sdm";
import { ajukanDokumen, setujuiDokumen, tolakDokumen } from "../src/lib/aksi/persetujuan";
import { periksaSinkron } from "../src/lib/sinkron";
import { laporanPiutang } from "../src/lib/laporanRekanan";

/*
 * Uji alur persetujuan maker-checker untuk 6 jenis dokumen yang sudah tersambung:
 * Faktur Penjualan, Faktur Pembelian, Kas Keluar, Penyesuaian Stok, Aset Tetap, Penggajian.
 *
 * Yang diperiksa untuk setiap jenis:
 *   1. dibuat  → DRAFT dan TIDAK ada jurnal (buku besar belum tersentuh)
 *   2. diajukan → MENUNGGU, masih tanpa jurnal
 *   3. pengaju menyetujui sendiri → DITOLAK sistem (pemisahan tugas)
 *   4. pemeriksa menyetujui → DISETUJUI, jurnalnya muncul dan seimbang
 * Plus: penolakan dengan alasan, pengajuan ulang setelah ditolak, dan peran tanpa hak "setujui".
 */

const PENGAJU = "uji-pengaju";
const PEMERIKSA = "uji-pemeriksa";
// SDM (Karyawan, Departemen, Penggajian) sekarang dikunci hanya Superadmin/Pemilik (Admin pun tidak
// punya lagi), jadi Penggajian butuh pengaju berperan SUPERADMIN, beda dari PENGAJU (berperan ADMIN).
const PENGAJU_SDM = "uji-pengaju-sdm";
const JPEG_PALSU = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

/** FormData isian + lampiran foto (dipakai Laporan Kerusakan Barang, satu-satunya dokumen di sini yang wajib foto). */
function denganFoto(isian: Parameters<typeof formulir>[0]): FormData {
  const fd = formulir(isian);
  fd.append("foto", new File([new Uint8Array(JPEG_PALSU)], "bukti-0.bin", { type: "application/octet-stream" }));
  return fd;
}

async function jumlahJurnalDokumen(tabel: "fakturPenjualan" | "fakturPembelian" | "penyesuaianPersediaan" | "penggajian" | "dokumenKas", id: string) {
  const baris = await (db as unknown as Record<string, { findUniqueOrThrow: (a: unknown) => Promise<{ jurnalId: string | null; statusPersetujuan: string }> }>)[tabel].findUniqueOrThrow({
    where: { id },
    select: { jurnalId: true, statusPersetujuan: true },
  });
  return baris;
}

async function jurnalSeimbang(jurnalId: string) {
  const baris = await db.barisJurnal.findMany({ where: { jurnalId } });
  const debit = baris.reduce((s, b) => s + Number(b.debit), 0);
  const kredit = baris.reduce((s, b) => s + Number(b.kredit), 0);
  return { debit, kredit, seimbang: Math.abs(debit - kredit) < 0.005, jumlahBaris: baris.length };
}

/**
 * Membuang sisa data uji dari jalannya skrip ini sebelumnya (mis. karena gagal di tengah),
 * supaya skrip selalu bisa dijalankan ulang tanpa bentrok kode unik.
 */
async function bersihkanSisaUji() {
  const kodeBarang = ["JASA-PST", "BRG-PST"];
  const jurnalUji = await db.jurnal.findMany({
    where: { OR: [{ keterangan: { contains: "Uji Persetujuan" } }, { keterangan: { contains: "uji persetujuan" } }] },
    select: { id: true },
  });
  await db.barisPenggajian.deleteMany({ where: { penggajian: { keterangan: "Gaji uji persetujuan" } } });
  await db.penggajian.deleteMany({ where: { keterangan: "Gaji uji persetujuan" } });
  await db.asetTetap.deleteMany({ where: { kode: "AT-PST" } });
  await db.barisPenyesuaianPersediaan.deleteMany({ where: { penyesuaian: { gudang: { kode: "WH-PST" } } } });
  await db.penyesuaianPersediaan.deleteMany({ where: { gudang: { kode: "WH-PST" } } });
  await db.foto.deleteMany({ where: { kerusakan: { gudang: { kode: "WH-PST" } } } });
  await db.barisKerusakanBarang.deleteMany({ where: { laporan: { gudang: { kode: "WH-PST" } } } });
  await db.laporanKerusakanBarang.deleteMany({ where: { gudang: { kode: "WH-PST" } } });
  await db.dokumenKas.deleteMany({ where: { keterangan: "Honor crew uji persetujuan" } });
  await db.barisFakturPembelian.deleteMany({ where: { faktur: { pemasok: { kode: "SUP-PST" } } } });
  await db.fakturPembelian.deleteMany({ where: { pemasok: { kode: "SUP-PST" } } });
  await db.barisPesananPembelian.deleteMany({ where: { pesanan: { pemasok: { kode: "SUP-PST" } } } });
  await db.pesananPembelian.deleteMany({ where: { pemasok: { kode: "SUP-PST" } } });
  await db.barisFakturPenjualan.deleteMany({ where: { faktur: { pelanggan: { kode: "CUST-PST" } } } });
  await db.fakturPenjualan.deleteMany({ where: { pelanggan: { kode: "CUST-PST" } } });
  await db.barisPesananPenjualan.deleteMany({ where: { pesanan: { pelanggan: { kode: "CUST-PST" } } } });
  await db.pesananPenjualan.deleteMany({ where: { pelanggan: { kode: "CUST-PST" } } });
  await db.stokBarang.deleteMany({ where: { barang: { kode: { in: kodeBarang } } } });
  await db.barang.deleteMany({ where: { kode: { in: kodeBarang } } });
  await db.karyawan.deleteMany({ where: { kode: "KRY-PST" } });
  await db.pelanggan.deleteMany({ where: { kode: "CUST-PST" } });
  await db.pemasok.deleteMany({ where: { kode: "SUP-PST" } });
  await db.gudang.deleteMany({ where: { kode: "WH-PST" } });
  await db.barisJurnal.deleteMany({ where: { jurnalId: { in: jurnalUji.map((j) => j.id) } } });
  await db.jurnal.deleteMany({ where: { id: { in: jurnalUji.map((j) => j.id) } } });
  await db.pengguna.deleteMany({ where: { namaPengguna: { in: [PENGAJU, PEMERIKSA, "uji-kasir"] } } });
  await db.akun.deleteMany({ where: { kode: { in: ["PST-ASET", "PST-AKUM", "PST-SUSUT", "PST-SELISIH"] } } });
}

async function main() {
  const mulaiUji = new Date();
  aturPersetujuan(true);

  console.log("=== Persiapan: hapus sisa uji sebelumnya, bagan akun standar, dua pengguna, data induk ===");
  await bersihkanSisaUji();
  await terapkanBaganAkunStandar(db);
  const akunKas = await db.akun.findUniqueOrThrow({ where: { kode: "1-1100" } });
  const akunBebanLain = await db.akun.findUniqueOrThrow({ where: { kode: "5-2100" } });
  const akunAset = await db.akun.upsert({
    where: { kode: "PST-ASET" },
    create: { kode: "PST-ASET", nama: "Peralatan Uji Persetujuan", jenis: "ASET" },
    update: {},
  });
  const akunAkumulasi = await db.akun.upsert({
    where: { kode: "PST-AKUM" },
    create: { kode: "PST-AKUM", nama: "Akumulasi Penyusutan Uji", jenis: "ASET" },
    update: {},
  });
  const akunBebanSusut = await db.akun.upsert({
    where: { kode: "PST-SUSUT" },
    create: { kode: "PST-SUSUT", nama: "Beban Penyusutan Uji", jenis: "BEBAN" },
    update: {},
  });
  const akunSelisih = await db.akun.upsert({
    where: { kode: "PST-SELISIH" },
    create: { kode: "PST-SELISIH", nama: "Selisih Persediaan Uji", jenis: "BEBAN" },
    update: {},
  });

  const pengaju = await db.pengguna.upsert({
    where: { namaPengguna: PENGAJU },
    create: { namaPengguna: PENGAJU, nama: "Pengaju Uji", peran: "ADMIN", kataSandiHash: await hashKataSandi("uji-pengaju-123") },
    update: { peran: "ADMIN", aktif: true },
  });
  const pemeriksa = await db.pengguna.upsert({
    where: { namaPengguna: PEMERIKSA },
    create: { namaPengguna: PEMERIKSA, nama: "Pemeriksa Uji", peran: "PEMILIK", kataSandiHash: await hashKataSandi("uji-pemeriksa-123") },
    update: { peran: "PEMILIK", aktif: true },
  });
  const kasir = await db.pengguna.upsert({
    where: { namaPengguna: "uji-kasir" },
    create: { namaPengguna: "uji-kasir", nama: "Kasir Uji", peran: "KASIR", kataSandiHash: await hashKataSandi("uji-kasir-123") },
    update: { peran: "KASIR", aktif: true },
  });
  await db.pengguna.upsert({
    where: { namaPengguna: PENGAJU_SDM },
    create: { namaPengguna: PENGAJU_SDM, nama: "Pengaju SDM Uji", peran: "SUPERADMIN", kataSandiHash: await hashKataSandi("uji-pengaju-sdm-123") },
    update: { peran: "SUPERADMIN", aktif: true },
  });

  const gudang = await db.gudang.create({ data: { kode: "WH-PST", nama: "Gudang Uji Persetujuan" } });
  const pelanggan = await db.pelanggan.create({ data: { kode: "CUST-PST", nama: "Pelanggan Uji Persetujuan" } });
  const pemasok = await db.pemasok.create({ data: { kode: "SUP-PST", nama: "Pemasok Uji Persetujuan" } });
  const jasa = await db.barang.create({ data: { kode: "JASA-PST", nama: "Jasa Uji Persetujuan", jenis: "JASA", hargaJual: 1_000_000, hargaBeli: 400_000 } });
  const barang = await db.barang.create({ data: { kode: "BRG-PST", nama: "Barang Uji Persetujuan", jenis: "BARANG", hargaJual: 50_000, hargaBeli: 20_000 } });
  const karyawan = await db.karyawan.create({ data: { kode: "KRY-PST", nama: "Karyawan Uji Persetujuan", gajiPokok: 3_000_000, tunjangan: 500_000 } });

  // ---------------------------------------------------------------- Faktur Penjualan
  console.log("\n=== 1. Faktur Penjualan ===");
  await sebagai(PENGAJU, () =>
    jalankan("buat pesanan penjualan", () => buatPesanan(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: jasa.id, jumlah: 2, harga: 1_000_000 }] }))),
  );
  const pesanan = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id }, orderBy: { tanggal: "desc" } });

  await sebagai(PENGAJU, () =>
    jalankan("buat faktur penjualan (draf)", () => buatFaktur(formulir({ pesananId: pesanan.id, baris: [{ barangId: jasa.id, jumlah: 2, harga: 1_000_000 }] }))),
  );
  const faktur = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: pesanan.id }, orderBy: { tanggal: "desc" } });
  let s = await jumlahJurnalDokumen("fakturPenjualan", faktur.id);
  pastikan(s.statusPersetujuan === "DRAFT", `faktur baru berstatus DRAFT (${s.statusPersetujuan})`);
  pastikan(s.jurnalId === null, "faktur DRAFT belum punya jurnal (buku besar belum tersentuh)");
  pastikan(faktur.diajukanOlehId === null, "faktur DRAFT belum punya pengaju");

  // Laporan yang membaca tabel dokumen (bukan Jurnal) harus MENGECUALIKAN faktur yang belum disetujui,
  // kalau tidak piutang dokumen akan berbeda dari saldo buku besar selama dokumen menunggu.
  const sinkronDraf = await periksaSinkron(db);
  pastikan(sinkronDraf.piutang.sinkron, `pemeriksaan sinkron tetap cocok walau ada faktur DRAFT (BB ${sinkronDraf.piutang.bukuBesar} vs dokumen ${sinkronDraf.piutang.dokumen})`);
  const piutangDraf = await laporanPiutang(db, new Date());
  const nomorDiPiutang = (l: { kelompok: { faktur: { nomor: string }[] }[] }) => l.kelompok.flatMap((k) => k.faktur.map((f) => f.nomor));
  pastikan(!nomorDiPiutang(piutangDraf).includes(faktur.nomor), "Laporan Piutang belum memuat faktur yang masih DRAFT");

  await sebagai(PENGAJU, () => jalankan("ajukan faktur", () => ajukanDokumen("faktur", faktur.id)));
  s = await jumlahJurnalDokumen("fakturPenjualan", faktur.id);
  pastikan(s.statusPersetujuan === "MENUNGGU", `faktur diajukan berstatus MENUNGGU (${s.statusPersetujuan})`);
  pastikan(s.jurnalId === null, "faktur MENUNGGU masih belum punya jurnal");
  const fakturDiajukan = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: faktur.id } });
  pastikan(fakturDiajukan.diajukanOlehId === pengaju.id, "pengaju faktur tercatat");

  await sebagai(PENGAJU, () =>
    harusDitolak("pengaju menyetujui fakturnya sendiri", () => setujuiDokumen("faktur", faktur.id), "tidak boleh menyetujui dokumennya sendiri"),
  );

  await sebagai("uji-kasir", () =>
    harusDitolak("kasir (tanpa hak setujui) menyetujui faktur", () => setujuiDokumen("faktur", faktur.id), 'tidak punya hak "Faktur Penjualan · setujui"'),
  );

  await sebagai(PEMERIKSA, () => jalankan("pemeriksa menyetujui faktur", () => setujuiDokumen("faktur", faktur.id)));
  s = await jumlahJurnalDokumen("fakturPenjualan", faktur.id);
  pastikan(s.statusPersetujuan === "DISETUJUI", `faktur disetujui (${s.statusPersetujuan})`);
  pastikan(s.jurnalId !== null, "faktur DISETUJUI punya jurnal");
  const jFaktur = await jurnalSeimbang(s.jurnalId!);
  pastikan(jFaktur.seimbang, `jurnal faktur seimbang (debit ${jFaktur.debit} = kredit ${jFaktur.kredit}, ${jFaktur.jumlahBaris} baris)`);
  pastikan(jFaktur.debit === 2_000_000, `nilai jurnal faktur = 2.000.000 (${jFaktur.debit})`);

  const fakturDisetujui = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: faktur.id } });
  pastikan(fakturDisetujui.disetujuiOlehId === pemeriksa.id, "penyetuju faktur tercatat");
  pastikan(fakturDisetujui.disetujuiPada !== null, "waktu persetujuan faktur tercatat");

  await sebagai(PEMERIKSA, () =>
    harusDitolak("menyetujui faktur dua kali", () => setujuiDokumen("faktur", faktur.id), "sudah disetujui"),
  );

  const sinkronSetelah = await periksaSinkron(db);
  pastikan(sinkronSetelah.piutang.sinkron, `pemeriksaan sinkron tetap cocok setelah faktur disetujui (BB ${sinkronSetelah.piutang.bukuBesar} vs dokumen ${sinkronSetelah.piutang.dokumen})`);
  const piutangSetelah = await laporanPiutang(db, new Date());
  pastikan(piutangSetelah.kelompok.flatMap((k) => k.faktur.map((f) => f.nomor)).includes(faktur.nomor), "Laporan Piutang memuat faktur setelah disetujui");

  const logFaktur = await db.logAktivitas.findMany({ where: { nomor: faktur.nomor, waktu: { gte: mulaiUji } }, orderBy: { waktu: "asc" } });
  pastikan(
    logFaktur.map((l) => l.aksi).join(",") === "AJUKAN,SETUJUI",
    `log aktivitas faktur mencatat AJUKAN lalu SETUJUI (${logFaktur.map((l) => l.aksi).join(",")})`,
  );

  // ---------------------------------------------------------------- Faktur Pembelian + penolakan
  console.log("\n=== 2. Faktur Pembelian (termasuk penolakan & pengajuan ulang) ===");
  await sebagai(PENGAJU, () =>
    jalankan("buat pesanan pembelian", () => buatPesananPembelian(formulir({ pemasokId: pemasok.id, baris: [{ barangId: barang.id, jumlah: 10, harga: 20_000 }] }))),
  );
  const pesananBeli = await db.pesananPembelian.findFirstOrThrow({ where: { pemasokId: pemasok.id }, orderBy: { tanggal: "desc" } });

  await sebagai(PENGAJU, () =>
    jalankan("buat faktur pembelian (draf)", () => buatFakturPembelian(formulir({ pesananId: pesananBeli.id, baris: [{ barangId: barang.id, jumlah: 10, harga: 20_000 }] }))),
  );
  const fakturBeli = await db.fakturPembelian.findFirstOrThrow({ where: { pesananId: pesananBeli.id }, orderBy: { tanggal: "desc" } });
  s = await jumlahJurnalDokumen("fakturPembelian", fakturBeli.id);
  pastikan(s.statusPersetujuan === "DRAFT" && s.jurnalId === null, "faktur pembelian baru DRAFT tanpa jurnal");

  await sebagai(PENGAJU, () => jalankan("ajukan faktur pembelian", () => ajukanDokumen("fakturPembelian", fakturBeli.id)));
  await sebagai(PEMERIKSA, () => jalankan("tolak faktur pembelian", () => tolakDokumen("fakturPembelian", fakturBeli.id, "Nominal tidak sesuai kontrak vendor")));
  const ditolak = await db.fakturPembelian.findUniqueOrThrow({ where: { id: fakturBeli.id } });
  pastikan(ditolak.statusPersetujuan === "DITOLAK", `faktur pembelian ditolak (${ditolak.statusPersetujuan})`);
  pastikan(ditolak.catatanPenolakan === "Nominal tidak sesuai kontrak vendor", "alasan penolakan tersimpan");
  pastikan(ditolak.ditolakOlehId === pemeriksa.id, "penolak tercatat");
  pastikan(ditolak.jurnalId === null, "dokumen DITOLAK tidak punya jurnal");

  await sebagai(PEMERIKSA, () =>
    harusDitolak("menolak tanpa alasan", () => tolakDokumen("fakturPembelian", fakturBeli.id, "   "), "Alasan penolakan wajib diisi"),
  );

  await sebagai(PENGAJU, () => jalankan("ajukan ulang faktur pembelian", () => ajukanDokumen("fakturPembelian", fakturBeli.id)));
  const diajukanUlang = await db.fakturPembelian.findUniqueOrThrow({ where: { id: fakturBeli.id } });
  pastikan(diajukanUlang.statusPersetujuan === "MENUNGGU", "faktur ditolak bisa diajukan ulang");
  pastikan(diajukanUlang.catatanPenolakan === null, "catatan penolakan dibersihkan saat diajukan ulang");

  await sebagai(PEMERIKSA, () => jalankan("setujui faktur pembelian", () => setujuiDokumen("fakturPembelian", fakturBeli.id)));
  s = await jumlahJurnalDokumen("fakturPembelian", fakturBeli.id);
  pastikan(s.statusPersetujuan === "DISETUJUI" && s.jurnalId !== null, "faktur pembelian disetujui & berjurnal");
  const jBeli = await jurnalSeimbang(s.jurnalId!);
  pastikan(jBeli.seimbang, `jurnal faktur pembelian seimbang (${jBeli.debit} = ${jBeli.kredit})`);

  // ---------------------------------------------------------------- Kas Keluar
  console.log("\n=== 3. Kas Keluar ===");
  await sebagai(PENGAJU, () =>
    jalankan("buat kas keluar (draf)", () =>
      buatKasKeluar(formulir({ akunKasId: akunKas.id, akunLawanId: akunBebanLain.id, jumlah: 750_000, keterangan: "Honor crew uji persetujuan" })),
    ),
  );
  const dokKas = await db.dokumenKas.findFirstOrThrow({ where: { jenis: "KELUAR" }, orderBy: { dibuatPada: "desc" } });
  pastikan(dokKas.statusPersetujuan === "DRAFT" && dokKas.jurnalId === null, "kas keluar baru DRAFT tanpa jurnal");
  const jurnalKkSebelum = await db.jurnal.count({ where: { sumber: "KAS_KELUAR", tanggal: { gte: mulaiUji } } });
  pastikan(jurnalKkSebelum === 0, "belum ada jurnal KK sebelum disetujui");

  await sebagai(PENGAJU, () => jalankan("ajukan kas keluar", () => ajukanDokumen("dokumenKas", dokKas.id)));
  await sebagai(PENGAJU, () =>
    harusDitolak("pengaju menyetujui kas keluarnya sendiri", () => setujuiDokumen("dokumenKas", dokKas.id), "tidak boleh menyetujui dokumennya sendiri"),
  );
  await sebagai(PEMERIKSA, () => jalankan("setujui kas keluar", () => setujuiDokumen("dokumenKas", dokKas.id)));
  const dokKasSetelah = await db.dokumenKas.findUniqueOrThrow({ where: { id: dokKas.id } });
  pastikan(dokKasSetelah.statusPersetujuan === "DISETUJUI" && dokKasSetelah.jurnalId !== null, "kas keluar disetujui & berjurnal");
  const jKas = await jurnalSeimbang(dokKasSetelah.jurnalId!);
  pastikan(jKas.seimbang && jKas.debit === 750_000, `jurnal kas keluar seimbang 750.000 (${jKas.debit}/${jKas.kredit})`);
  const jurnalKk = await db.jurnal.findUniqueOrThrow({ where: { id: dokKasSetelah.jurnalId! } });
  pastikan(jurnalKk.sumber === "KAS_KELUAR", `jurnal kas keluar bersumber KAS_KELUAR (${jurnalKk.sumber})`);

  // ---------------------------------------------------------------- Penyesuaian Stok
  console.log("\n=== 4. Penyesuaian Stok (stok fisik juga menunggu persetujuan) ===");
  await sebagai(PENGAJU, () =>
    jalankan("buat penyesuaian stok (draf)", () =>
      buatPenyesuaianPersediaan(
        formulir({ gudangId: gudang.id, akunLawanId: akunSelisih.id, keterangan: "Opname uji persetujuan", baris: [{ barangId: barang.id, jumlahSesudah: 25, hargaSatuan: 20_000 }] }),
      ),
    ),
  );
  const penyesuaian = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { gudangId: gudang.id }, orderBy: { dibuatPada: "desc" } });
  pastikan(penyesuaian.statusPersetujuan === "DRAFT" && penyesuaian.jurnalId === null, "penyesuaian baru DRAFT tanpa jurnal");
  const stokSebelum = await db.stokBarang.findUnique({ where: { barangId_gudangId: { barangId: barang.id, gudangId: gudang.id } } });
  pastikan(stokSebelum === null, "stok fisik BELUM berubah selama penyesuaian masih draf");

  await sebagai(PENGAJU, () => jalankan("ajukan penyesuaian", () => ajukanDokumen("penyesuaian", penyesuaian.id)));
  await sebagai(PEMERIKSA, () => jalankan("setujui penyesuaian", () => setujuiDokumen("penyesuaian", penyesuaian.id)));
  const stokSesudah = await db.stokBarang.findUniqueOrThrow({ where: { barangId_gudangId: { barangId: barang.id, gudangId: gudang.id } } });
  pastikan(Number(stokSesudah.jumlah) === 25, `stok menjadi 25 setelah disetujui (${stokSesudah.jumlah})`);
  const penyesuaianSetelah = await db.penyesuaianPersediaan.findUniqueOrThrow({ where: { id: penyesuaian.id } });
  pastikan(penyesuaianSetelah.jurnalId !== null, "penyesuaian disetujui punya jurnal");
  const jPs = await jurnalSeimbang(penyesuaianSetelah.jurnalId!);
  pastikan(jPs.seimbang && jPs.debit === 500_000, `jurnal penyesuaian seimbang 25 × 20.000 = 500.000 (${jPs.debit})`);

  // ---------------------------------------------------------------- Laporan Kerusakan Barang
  console.log("\n=== 4b. Laporan Kerusakan Barang (stok fisik juga menunggu persetujuan, TANPA jurnal) ===");
  await sebagai(PENGAJU, () =>
    jalankan("lapor barang rusak (draf)", () =>
      buatLaporanKerusakan(denganFoto({ gudangId: gudang.id, namaPelapor: "Kru Uji Persetujuan", keterangan: "Rusak saat uji persetujuan", baris: [{ barangId: barang.id, jumlah: 5 }] })),
    ),
  );
  const kerusakan = await db.laporanKerusakanBarang.findFirstOrThrow({ where: { gudangId: gudang.id }, orderBy: { waktuLapor: "desc" } });
  pastikan(kerusakan.statusPersetujuan === "DRAFT", "laporan kerusakan baru DRAFT");
  const stokSebelumRusak = await db.stokBarang.findUniqueOrThrow({ where: { barangId_gudangId: { barangId: barang.id, gudangId: gudang.id } } });
  pastikan(Number(stokSebelumRusak.jumlah) === 25, "stok fisik BELUM berubah selama laporan masih draf (masih 25)");

  await sebagai(PENGAJU, () => jalankan("ajukan laporan kerusakan", () => ajukanDokumen("kerusakan", kerusakan.id)));
  await sebagai(PENGAJU, () =>
    harusDitolak("pengaju menyetujui laporannya sendiri", () => setujuiDokumen("kerusakan", kerusakan.id), "tidak boleh menyetujui dokumennya sendiri"),
  );
  await sebagai(PEMERIKSA, () => jalankan("setujui laporan kerusakan", () => setujuiDokumen("kerusakan", kerusakan.id)));
  const stokSetelahRusak = await db.stokBarang.findUniqueOrThrow({ where: { barangId_gudangId: { barangId: barang.id, gudangId: gudang.id } } });
  pastikan(Number(stokSetelahRusak.jumlah) === 20, `stok berkurang permanen jadi 20 setelah disetujui (${stokSetelahRusak.jumlah})`);
  const kerusakanSetelah = await db.laporanKerusakanBarang.findUniqueOrThrow({ where: { id: kerusakan.id } });
  pastikan(kerusakanSetelah.statusPersetujuan === "DISETUJUI", "laporan kerusakan disetujui");

  // ---------------------------------------------------------------- Aset Tetap
  console.log("\n=== 5. Aset Tetap (perolehan) ===");
  await sebagai(PENGAJU, () =>
    jalankan("buat aset tetap (draf)", () =>
      buatAsetTetap(
        formulir({
          kode: "AT-PST",
          nama: "Sound System Uji Persetujuan",
          hargaPerolehan: 6_000_000,
          nilaiSisa: 600_000,
          umurBulan: 36,
          akunAsetId: akunAset.id,
          akunBebanPenyusutanId: akunBebanSusut.id,
          akunAkumulasiPenyusutanId: akunAkumulasi.id,
          akunPembayaranId: akunKas.id,
        }),
      ),
    ),
  );
  const aset = await db.asetTetap.findUniqueOrThrow({ where: { kode: "AT-PST" } });
  pastikan(aset.statusPersetujuan === "DRAFT" && aset.jurnalPerolehanId === null, "aset baru DRAFT tanpa jurnal perolehan");

  await sebagai(PENGAJU, () => jalankan("ajukan aset", () => ajukanDokumen("aset", aset.id)));
  await sebagai(PEMERIKSA, () => jalankan("setujui aset", () => setujuiDokumen("aset", aset.id)));
  const asetSetelah = await db.asetTetap.findUniqueOrThrow({ where: { id: aset.id } });
  pastikan(asetSetelah.statusPersetujuan === "DISETUJUI" && asetSetelah.jurnalPerolehanId !== null, "aset disetujui & berjurnal perolehan");
  const jAt = await jurnalSeimbang(asetSetelah.jurnalPerolehanId!);
  pastikan(jAt.seimbang && jAt.debit === 6_000_000, `jurnal perolehan aset seimbang 6.000.000 (${jAt.debit})`);

  // ---------------------------------------------------------------- Penggajian
  console.log("\n=== 6. Penggajian ===");
  // Bulan berikutnya, bukan bulan berjalan: seed.ts juga memproses gaji "bulan berjalan"
  // (periode saat ini), jadi memakai periode yang sama di sini akan selalu bentrok
  // ("Penggajian periode ... sudah diproses") setiap kali uji dijalankan setelah seed.
  const bulanUji = new Date(mulaiUji.getFullYear(), mulaiUji.getMonth() + 1, 1);
  const periode = `${bulanUji.getFullYear()}-${String(bulanUji.getMonth() + 1).padStart(2, "0")}`;
  await sebagai(PENGAJU_SDM, () =>
    jalankan("buat penggajian (draf)", () =>
      buatPenggajian(
        formulir({
          periode,
          akunKasId: akunKas.id,
          keterangan: "Gaji uji persetujuan",
          baris: [{ karyawanId: karyawan.id, gajiPokok: 3_000_000, tunjangan: 500_000, potongan: 100_000, keteranganPotongan: "PPh 21" }],
        }),
      ),
    ),
  );
  const gaji = await db.penggajian.findUniqueOrThrow({ where: { periode } });
  pastikan(gaji.statusPersetujuan === "DRAFT" && gaji.jurnalId === null, "penggajian baru DRAFT tanpa jurnal");
  pastikan(Number(gaji.totalDibayar) === 3_400_000, `gaji bersih 3.400.000 (${gaji.totalDibayar})`);

  await sebagai(PENGAJU_SDM, () => jalankan("ajukan penggajian", () => ajukanDokumen("penggajian", gaji.id)));
  await sebagai(PENGAJU_SDM, () =>
    harusDitolak("pengaju menyetujui penggajiannya sendiri", () => setujuiDokumen("penggajian", gaji.id), "tidak boleh menyetujui dokumennya sendiri"),
  );
  await sebagai(PENGAJU, () =>
    harusDitolak("Admin tidak punya hak SDM untuk menyetujui penggajian", () => setujuiDokumen("penggajian", gaji.id), "tidak punya hak"),
  );
  await sebagai(PEMERIKSA, () => jalankan("setujui penggajian", () => setujuiDokumen("penggajian", gaji.id)));
  const gajiSetelah = await db.penggajian.findUniqueOrThrow({ where: { id: gaji.id } });
  pastikan(gajiSetelah.statusPersetujuan === "DISETUJUI" && gajiSetelah.jurnalId !== null, "penggajian disetujui & berjurnal");
  const jGaji = await jurnalSeimbang(gajiSetelah.jurnalId!);
  pastikan(jGaji.seimbang && jGaji.debit === 3_500_000, `jurnal penggajian seimbang (beban 3.500.000 = potongan + kas) (${jGaji.debit})`);

  // ---------------------------------------------------------------- Semua jurnal uji seimbang
  console.log("\n=== 7. Seluruh jurnal yang dibuat uji ini seimbang ===");
  const jurnalUji = await db.jurnal.findMany({ where: { tanggal: { gte: mulaiUji } }, include: { baris: true } });
  const totalDebit = jurnalUji.reduce((s, j) => s + j.baris.reduce((x, b) => x + Number(b.debit), 0), 0);
  const totalKredit = jurnalUji.reduce((s, j) => s + j.baris.reduce((x, b) => x + Number(b.kredit), 0), 0);
  pastikan(Math.abs(totalDebit - totalKredit) < 0.005, `total debit = total kredit atas ${jurnalUji.length} jurnal (${totalDebit} = ${totalKredit})`);
  pastikan(jurnalUji.every((j) => j.statusPersetujuan === "DISETUJUI"), "setiap baris Jurnal berstatus DISETUJUI (ada di buku besar = sudah disetujui)");

  // ---------------------------------------------------------------- Bersih-bersih
  console.log("\n=== Bersih-bersih ===");
  await db.barisPenggajian.deleteMany({ where: { penggajianId: gaji.id } });
  await db.penggajian.deleteMany({ where: { id: gaji.id } });
  await db.asetTetap.deleteMany({ where: { id: aset.id } });
  await db.barisPenyesuaianPersediaan.deleteMany({ where: { penyesuaianId: penyesuaian.id } });
  await db.penyesuaianPersediaan.deleteMany({ where: { id: penyesuaian.id } });
  await db.foto.deleteMany({ where: { kerusakanId: kerusakan.id } });
  await db.barisKerusakanBarang.deleteMany({ where: { laporanId: kerusakan.id } });
  await db.laporanKerusakanBarang.deleteMany({ where: { id: kerusakan.id } });
  await db.dokumenKas.deleteMany({ where: { id: dokKas.id } });
  await db.barisFakturPembelian.deleteMany({ where: { fakturId: fakturBeli.id } });
  await db.fakturPembelian.deleteMany({ where: { id: fakturBeli.id } });
  await db.barisPesananPembelian.deleteMany({ where: { pesananId: pesananBeli.id } });
  await db.pesananPembelian.deleteMany({ where: { id: pesananBeli.id } });
  await db.barisFakturPenjualan.deleteMany({ where: { fakturId: faktur.id } });
  await db.fakturPenjualan.deleteMany({ where: { id: faktur.id } });
  await db.barisPesananPenjualan.deleteMany({ where: { pesananId: pesanan.id } });
  await db.pesananPenjualan.deleteMany({ where: { id: pesanan.id } });
  await db.stokBarang.deleteMany({ where: { barangId: { in: [barang.id, jasa.id] } } });
  await db.barang.deleteMany({ where: { id: { in: [barang.id, jasa.id] } } });
  await db.karyawan.deleteMany({ where: { id: karyawan.id } });
  await db.pelanggan.deleteMany({ where: { id: pelanggan.id } });
  await db.pemasok.deleteMany({ where: { id: pemasok.id } });
  await db.gudang.deleteMany({ where: { id: gudang.id } });
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji } } });
  const idJurnal = jurnalUji.map((j) => j.id);
  await db.barisJurnal.deleteMany({ where: { jurnalId: { in: idJurnal } } });
  await db.jurnal.deleteMany({ where: { id: { in: idJurnal } } });
  await db.pengguna.deleteMany({ where: { id: { in: [pengaju.id, pemeriksa.id, kasir.id] } } });
  await db.akun.deleteMany({ where: { id: { in: [akunAset.id, akunAkumulasi.id, akunBebanSusut.id, akunSelisih.id] } } });

  console.log("\n=== DONE, seluruh pemeriksaan alur persetujuan lolos ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("UJI PERSETUJUAN GAGAL", err);
  process.exit(1);
});
