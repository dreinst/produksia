"use server";

import { pastikanHak, wajibHakAksi, wajibMasukAksi } from "@/lib/otentikasi";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { D, kali, jumlahkan, terkecil, type Desimal } from "@/lib/uang";
import { kunciStokUrut, kurangiStok, tambahStok, labelBarang, ubahNilaiStok, sesuaikanHargaRata, urutBarang } from "@/lib/stok";
import type { Hak, PenggunaSesi } from "@/lib/hakAkses";
import { Prisma } from "@/prisma-klien/client";
import { pastikanTahunTerbuka } from "@/lib/tutupBuku";
import { BERKAS, type JenisPersetujuan } from "@/lib/persetujuan";
import { catatAktivitas } from "@/lib/log";
import { kunciBarisPesananPenjualan, kunciBarisSuratJalan, kunciBarisSuratJalanPesanan } from "@/lib/dokumenPenjualan";

/*
 * Menghapus dokumen transaksi = MEMBALIK seluruh efeknya dalam satu transaksi: stok fisik & harga pokok,
 * jurnal (dihapus), progres pesanan (terkirim/difaktur/diterima), dan status dokumen induk.
 * Dokumen yang sudah punya turunan (faktur yang sudah diterima bayarannya, pesanan yang sudah dikirim, …)
 * ditolak dengan pesan yang menyebut apa yang harus dihapus lebih dulu. Setiap penghapusan dicatat di LogAktivitas.
 * "Ubah" dokumen = hapus lalu buat ulang, supaya jejak stok/jurnal selalu konsisten.
 */

type Tx = Prisma.TransactionClient;
export type JenisDokumen =
  | "penawaran"
  | "pesanan"
  | "pengiriman"
  | "faktur"
  | "penerimaan"
  | "uangMuka"
  | "returPenjualan"
  | "pesananPembelian"
  | "penerimaanBarang"
  | "fakturPembelian"
  | "pembayaran"
  | "returPembelian"
  | "jurnal"
  | "dokumenKas"
  | "penyesuaian"
  | "pindahBarang"
  | "peminjamanBarang"
  | "laporanKerusakan"
  | "pphFinal"
  | "prive"
  | "aset"
  | "penyusutan"
  | "pelepasanAset"
  | "penggajian"
  | "antarPerusahaan";

const LABEL: Record<JenisDokumen, string> = {
  penawaran: "Penawaran Penjualan",
  pesanan: "Pesanan Penjualan",
  pengiriman: "Surat Jalan",
  faktur: "Faktur Penjualan",
  penerimaan: "Penerimaan Penjualan",
  uangMuka: "Uang Muka Pelanggan",
  returPenjualan: "Retur Penjualan",
  pesananPembelian: "Pesanan Pembelian",
  penerimaanBarang: "Terima Barang",
  fakturPembelian: "Faktur Pembelian",
  pembayaran: "Pembayaran Pembelian",
  returPembelian: "Retur Pembelian",
  jurnal: "Jurnal",
  dokumenKas: "Kas Masuk / Kas Keluar",
  penyesuaian: "Penyesuaian Stok",
  pindahBarang: "Pindah Barang",
  peminjamanBarang: "Peminjaman Barang",
  laporanKerusakan: "Laporan Kerusakan Barang",
  pphFinal: "PPh Final Bulanan",
  prive: "Prive",
  aset: "Aset Tetap",
  penyusutan: "Penyusutan",
  pelepasanAset: "Pelepasan Aset",
  penggajian: "Penggajian",
  antarPerusahaan: "Transaksi Antar Perusahaan",
};

const JALUR: Record<JenisDokumen, string[]> = {
  penawaran: ["/penjualan/penawaran"],
  pesanan: ["/penjualan/pesanan", "/penjualan/penawaran"],
  pengiriman: ["/penjualan/pengiriman", "/penjualan/pesanan", "/persediaan"],
  faktur: ["/penjualan/faktur", "/penjualan/pesanan"],
  penerimaan: ["/penjualan/penerimaan", "/penjualan/faktur"],
  uangMuka: ["/penjualan/uang-muka", "/penjualan/pesanan"],
  returPenjualan: ["/penjualan/retur", "/penjualan/faktur", "/persediaan"],
  pesananPembelian: ["/pembelian/pesanan"],
  penerimaanBarang: ["/pembelian/penerimaan-barang", "/pembelian/pesanan", "/persediaan"],
  fakturPembelian: ["/pembelian/faktur", "/pembelian/pesanan"],
  pembayaran: ["/pembelian/pembayaran", "/pembelian/faktur"],
  returPembelian: ["/pembelian/retur", "/pembelian/faktur", "/persediaan"],
  jurnal: ["/buku-besar/jurnal", "/kas-bank/masuk", "/kas-bank/keluar", "/persetujuan"],
  dokumenKas: ["/kas-bank/masuk", "/kas-bank/keluar", "/buku-besar/jurnal", "/persetujuan"],
  penyesuaian: ["/persediaan/penyesuaian", "/persediaan"],
  pindahBarang: ["/persediaan/pindah", "/persediaan"],
  peminjamanBarang: ["/persediaan", "/persediaan/peminjaman"],
  laporanKerusakan: ["/persediaan", "/persediaan/kerusakan"],
  pphFinal: ["/buku-besar/pajak", "/buku-besar/jurnal"],
  prive: ["/kas-bank/prive", "/laporan/prive", "/buku-besar/jurnal"],
  aset: ["/aset-tetap"],
  penyusutan: ["/aset-tetap/penyusutan", "/aset-tetap"],
  pelepasanAset: ["/aset-tetap", "/buku-besar/jurnal"],
  penggajian: ["/sdm/penggajian", "/buku-besar/jurnal"],
  antarPerusahaan: ["/buku-besar/antar-perusahaan", "/buku-besar/jurnal"],
};

function statusFaktur(total: Desimal, dibayar: Desimal, retur: Desimal): "DRAF" | "SEBAGIAN" | "LUNAS" {
  if (dibayar.plus(retur).gte(total)) return "LUNAS";
  return dibayar.gt(0) || retur.gt(0) ? "SEBAGIAN" : "DRAF";
}

async function hapusJurnal(tx: Tx, jurnalId: string | null | undefined) {
  if (!jurnalId) return;
  const jurnal = await tx.jurnal.findUnique({ where: { id: jurnalId }, select: { tanggal: true } });
  if (jurnal) await pastikanTahunTerbuka(tx, jurnal.tanggal);
  await tx.barisJurnal.deleteMany({ where: { jurnalId } });
  await tx.jurnal.delete({ where: { id: jurnalId } });
}

async function catatLog(tx: Tx, pengguna: PenggunaSesi, jenis: JenisDokumen, nomor: string, keterangan: string) {
  await tx.logAktivitas.create({
    data: { penggunaId: pengguna.id === "skrip-uji" ? null : pengguna.id, penggunaNama: pengguna.nama, aksi: "HAPUS", jenis: LABEL[jenis], nomor, keterangan },
  });
}

async function segarkanStatusFakturPenjualan(tx: Tx, fakturId: string) {
  const f = await tx.fakturPenjualan.findUniqueOrThrow({ where: { id: fakturId }, include: { penerimaan: true, retur: true } });
  const status = statusFaktur(D(f.total), D(f.uangMuka).plus(jumlahkan(f.penerimaan.map((p) => D(p.jumlah).plus(p.potonganPajak)))), jumlahkan(f.retur.map((r) => r.total)));
  await tx.fakturPenjualan.update({ where: { id: fakturId }, data: { status } });
}
async function segarkanStatusFakturPembelian(tx: Tx, fakturId: string) {
  const f = await tx.fakturPembelian.findUniqueOrThrow({ where: { id: fakturId }, include: { pembayaran: true, retur: true } });
  const status = statusFaktur(D(f.total), jumlahkan(f.pembayaran.map((p) => D(p.jumlah).plus(p.potonganPajak))), jumlahkan(f.retur.map((r) => r.total)));
  await tx.fakturPembelian.update({ where: { id: fakturId }, data: { status } });
}
async function segarkanStatusPesananPenjualan(tx: Tx, pesananId: string) {
  const baris = await tx.barisPesananPenjualan.findMany({ where: { pesananId } });
  const semua = baris.every((l) => D(l.jumlahTerkirim).gte(l.jumlah));
  const ada = baris.some((l) => D(l.jumlahTerkirim).gt(0));
  await tx.pesananPenjualan.update({ where: { id: pesananId }, data: { status: semua ? "DIPROSES" : ada ? "SEBAGIAN" : "DRAF" } });
}
async function segarkanStatusPesananPembelian(tx: Tx, pesananId: string) {
  const baris = await tx.barisPesananPembelian.findMany({ where: { pesananId } });
  const semua = baris.every((l) => D(l.jumlahDiterima).gte(l.jumlah));
  const ada = baris.some((l) => D(l.jumlahDiterima).gt(0));
  await tx.pesananPembelian.update({ where: { id: pesananId }, data: { status: semua ? "DIPROSES" : ada ? "SEBAGIAN" : "DRAF" } });
}
/** Hak yang dibutuhkan untuk menghapus tiap jenis dokumen (jurnal diperiksa menurut sumbernya). */
const HAK_HAPUS: Record<Exclude<JenisDokumen, "jurnal" | "dokumenKas">, Hak> = {
  penawaran: "penawaran.hapus",
  pesanan: "pesanan.hapus",
  pengiriman: "pengiriman.hapus",
  faktur: "faktur.hapus",
  penerimaan: "penerimaan.hapus",
  uangMuka: "uang-muka.hapus",
  returPenjualan: "retur-penjualan.hapus",
  pesananPembelian: "pesanan-pembelian.hapus",
  penerimaanBarang: "penerimaan-barang.hapus",
  fakturPembelian: "faktur-pembelian.hapus",
  pembayaran: "pembayaran.hapus",
  returPembelian: "retur-pembelian.hapus",
  penyesuaian: "penyesuaian.hapus",
  pindahBarang: "pindah-barang.hapus",
  peminjamanBarang: "peminjaman.hapus",
  laporanKerusakan: "kerusakan.hapus",
  pphFinal: "pph-final.hapus",
  prive: "prive.hapus",
  aset: "aset.hapus",
  penyusutan: "penyusutan.hapus",
  pelepasanAset: "pelepasan-aset.hapus",
  penggajian: "penggajian.hapus",
  antarPerusahaan: "antar-perusahaan.hapus",
};

const daftarNomor = (d: { nomor: string }[]) => d.map((x) => x.nomor).join(", ");

/**
 * Jenis hapus untuk setiap jenis dokumen persetujuan (BERKAS). Record lengkap, jadi jenis persetujuan baru gagal tsc
 * sampai dipetakan di sini.
 */
const HAPUS_BERPERSETUJUAN: Record<JenisPersetujuan, JenisDokumen> = {
  faktur: "faktur",
  fakturPembelian: "fakturPembelian",
  dokumenKas: "dokumenKas",
  penyesuaian: "penyesuaian",
  peminjaman: "peminjamanBarang",
  kerusakan: "laporanKerusakan",
  aset: "aset",
  penggajian: "penggajian",
};
const PERSETUJUAN_DARI_HAPUS = new Map(Object.entries(HAPUS_BERPERSETUJUAN).map(([p, h]) => [h, p as JenisPersetujuan]));

/**
 * Batas waktu transaksi hapus, sama dengan persetujuan: hapus dokumen berpersetujuan bisa menunggu setujui yang sedang
 * berjalan (faktur berbaris banyak) di dalam transaksinya (tinjauan perbaikan P22, catatan batas waktu).
 */
const BATAS_WAKTU_HAPUS = 15_000;

/** Kunci stok untuk baris dokumen yang mutasinya akan dibalik (satu gudang). */
const kunciStokBaris = (tx: Tx, baris: { barangId: string }[], gudangId: string, buatKosong = false) => kunciStokUrut(tx, baris.map((b) => ({ barangId: b.barangId, gudangId, buatKosong })));

export async function hapusDokumen(jenis: JenisDokumen, id: string) {
  // Jurnal & dokumen kas haknya ditentukan setelah datanya dibaca (menurut sumber jurnal / jenis kas)
  const pengguna = jenis === "jurnal" || jenis === "dokumenKas" ? await wajibMasukAksi() : await wajibHakAksi(HAK_HAPUS[jenis]);

  await db.$transaction(async (tx) => {
    // Dokumen berpersetujuan dikunci lebih dulu, sebelum statusnya dibaca (perbaikan tinjauan P21). Hapus yang berjalan
    // bersamaan dengan persetujuan menunggu persetujuan selesai, lalu membaca status dan jurnalId terbaru, sehingga
    // jurnalnya ikut dihapus. Bila hapus lebih dulu, persetujuan mendapat "tidak ditemukan". Mode "hapus" (FOR UPDATE)
    // dipakai karena DELETE di bawah butuh kunci itu; sisipan baris anak ber-FK menunggu sejak awal tanpa memegang
    // apa pun, jadi tidak ada siklus dengan penerimaan, retur, pembayaran, atau pelepasan (tinjauan perbaikan P22).
    const jenisPersetujuan = PERSETUJUAN_DARI_HAPUS.get(jenis);
    if (jenisPersetujuan) await BERKAS[jenisPersetujuan].kunci(tx, id, "hapus");
    switch (jenis) {
      case "penawaran": {
        const d = await tx.penawaranPenjualan.findUniqueOrThrow({ where: { id }, include: { pesanan: true } });
        if (d.pesanan) throw new Error(`${d.nomor} sudah dikonversi menjadi ${d.pesanan.nomor}; hapus pesanan itu dulu`);
        // rencana termin ikut terhapus (kaskade juga ada, ditulis eksplisit seperti baris; D2 §4.6). Lampiran berkas
        // tidak dibuang (DESAIN G11)
        await tx.rencanaTermin.deleteMany({ where: { penawaranId: id } });
        await tx.barisPenawaranPenjualan.deleteMany({ where: { penawaranId: id } });
        await tx.penawaranPenjualan.delete({ where: { id } });
        await catatLog(tx, pengguna, jenis, d.nomor, "Penawaran draf dihapus");
        return;
      }
      case "pesanan": {
        // Baris pesanan dikunci urut id lebih dulu, sama dengan faktur, surat jalan, dan hapus keduanya (tinjauan perbaikan
        // P27 tahap 2 T2). Surat jalan, faktur, dan uang muka dibaca sesudah kunci, jadi faktur yang selesai selagi hapus ini
        // menunggu ikut menahan hapus, bukan tertinggal tanpa pesanan (FK faktur ON DELETE SET NULL).
        await kunciBarisPesananPenjualan(tx, id);
        const d = await tx.pesananPenjualan.findUniqueOrThrow({ where: { id }, include: { pengiriman: true, faktur: true, uangMuka: true } });
        if (d.pengiriman.length) throw new Error(`${d.nomor} sudah punya surat jalan ${daftarNomor(d.pengiriman)}; hapus itu dulu`);
        if (d.faktur.length) throw new Error(`${d.nomor} sudah punya faktur ${daftarNomor(d.faktur)}; hapus itu dulu`);
        if (d.uangMuka.length) throw new Error(`${d.nomor} sudah punya uang muka ${daftarNomor(d.uangMuka)}; hapus itu dulu`);
        // penjaga uang muka di atas menjamin tidak ada UM yang menaut butir termin (FK Restrict); G11: lampiran tetap
        await tx.rencanaTermin.deleteMany({ where: { pesananId: id } });
        await tx.barisPesananPenjualan.deleteMany({ where: { pesananId: id } });
        await tx.pesananPenjualan.delete({ where: { id } });
        if (d.penawaranId) await tx.penawaranPenjualan.update({ where: { id: d.penawaranId }, data: { status: "DRAF" } });
        await catatLog(tx, pengguna, jenis, d.nomor, d.penawaranId ? "Pesanan dihapus; penawaran asal kembali menjadi draf" : "Pesanan dihapus");
        return;
      }
      case "pengiriman": {
        const d = await tx.pengirimanPesanan.findUniqueOrThrow({
          where: { id },
          include: { baris: { include: { barang: { select: { jenis: true, kode: true, nama: true } } } }, pesanan: { select: { nomor: true } }, faktur: true },
        });
        await kunciStokBaris(tx, d.baris.filter((b) => b.barang.jenis === "BARANG"), d.gudangId, true);
        // baris pesanan dikunci sesudah stok, urut id seperti buatPengiriman dan faktur (tinjauan P27 R1). Faktur pesanan
        // dibaca ulang sesudah kunci: faktur yang selesai selagi hapus ini menunggu ikut diperiksa, jadi pesannya jelas,
        // bukan galat FK mentah dari KonsumsiSuratJalan (tinjauan perbaikan P27 R1).
        await kunciBarisPesananPenjualan(tx, d.pesananId, d.baris.map((b) => b.barisPesananId));
        const fakturPesanan = await tx.fakturPenjualan.findMany({ where: { pesananId: d.pesananId }, select: { nomor: true, tanggal: true } });
        const fakturSetelah = fakturPesanan.filter((f) => f.tanggal >= d.tanggal);
        if (fakturSetelah.length) {
          throw new Error(`Faktur ${daftarNomor(fakturSetelah)} dibuat setelah ${d.nomor} dan sudah mengakui HPP-nya; hapus faktur itu dulu`);
        }
        // pengaman FK Restrict KonsumsiSuratJalan: baris SJ yang masih tercatat dikonsumsi faktur tidak boleh hilang
        const pemakai = await tx.fakturPenjualan.findMany({ where: { baris: { some: { konsumsiSj: { some: { barisPengiriman: { pengirimanId: id } } } } } }, select: { nomor: true } });
        if (pemakai.length) throw new Error(`Faktur ${daftarNomor(pemakai)} sudah mengakui HPP ${d.nomor}; hapus faktur itu dulu`);
        // urut barangId supaya kunci Barang (harga rata) berurutan sama dengan kunci stok (tinjauan P22b T4)
        for (const b of urutBarang(d.baris)) {
          if (b.barang.jenis === "BARANG") {
            await tambahStok(tx, b.barangId, d.gudangId, D(b.jumlah));
            await ubahNilaiStok(tx, b.barangId, D(b.jumlah), kali(b.jumlah, b.hargaPokok));
          }
          await tx.barisPesananPenjualan.update({ where: { id: b.barisPesananId }, data: { jumlahTerkirim: { decrement: b.jumlah } } });
        }
        await tx.fakturPenjualan.updateMany({ where: { pengirimanId: id }, data: { pengirimanId: null } });
        await tx.barisPengiriman.deleteMany({ where: { pengirimanId: id } });
        await tx.pengirimanPesanan.delete({ where: { id } });
        await hapusJurnal(tx, d.jurnalId);
        await segarkanStatusPesananPenjualan(tx, d.pesananId);
        await catatLog(tx, pengguna, jenis, d.nomor, `Stok dikembalikan ke gudang, progres pesanan ${d.pesanan.nomor} dikurangi, jurnal SJ dihapus`);
        return;
      }
      case "faktur": {
        const d = await tx.fakturPenjualan.findUniqueOrThrow({
          where: { id },
          include: {
            penerimaan: true,
            retur: true,
            baris: { orderBy: [{ urutan: "asc" }, { id: "asc" }], include: { barang: { select: { jenis: true } } } },
          },
        });
        if (d.penerimaan.length) throw new Error(`${d.nomor} sudah punya penerimaan ${daftarNomor(d.penerimaan)}; hapus itu dulu`);
        if (d.retur.length) throw new Error(`${d.nomor} sudah punya retur ${daftarNomor(d.retur)}; hapus itu dulu`);
        // Kunci baris pesanan (urut id) lalu baris SJ (urut id), urutan yang sama dengan buatFaktur (tinjauan P27 R1, S1).
        // Faktur dan surat jalan pesanan dibaca SESUDAH kunci (tinjauan perbaikan P27 S2): buatFaktur, buatPengiriman, dan
        // hapus surat jalan memegang kunci baris pesanan sampai commit, jadi faktur atau surat jalan yang selesai selagi
        // hapus ini menunggu ikut diperiksa.
        if (d.pesananId) await kunciBarisPesananPenjualan(tx, d.pesananId);
        const [fakturPesanan, sjPesanan, catatan] = await Promise.all([
          d.pesananId ? tx.fakturPenjualan.findMany({ where: { pesananId: d.pesananId }, select: { id: true, nomor: true, tanggal: true } }) : [],
          d.pesananId ? tx.pengirimanPesanan.findMany({ where: { pesananId: d.pesananId }, select: { id: true, nomor: true, tanggal: true } }) : [],
          tx.konsumsiSuratJalan.findMany({ where: { barisFaktur: { fakturId: id } }, orderBy: [{ barisPengirimanId: "asc" }, { id: "asc" }], include: { barisPengiriman: { select: { pengirimanId: true } } } }),
        ]);
        const lebihBaru = fakturPesanan.filter((f) => f.id !== id && f.tanggal > d.tanggal);
        if (lebihBaru.length) throw new Error(`Hapus faktur yang lebih baru dulu (${daftarNomor(lebihBaru)}) agar pengakuan HPP bisa dibalik urut`);
        // SJ yang barisnya dikonsumsi faktur ini (tercatat) bukan SJ "sesudah" faktur ini walau tanggalnya lebih baru
        // (faktur menunggu kunci selagi SJ itu selesai); tanpa pengecualian ini faktur dan SJ saling menahan hapus
        const sjDikonsumsi = new Set(catatan.map((c) => c.barisPengiriman.pengirimanId));
        const sjSetelah = sjPesanan.filter((s) => s.tanggal > d.tanggal && !sjDikonsumsi.has(s.id));
        if (sjSetelah.length) throw new Error(`Surat jalan ${daftarNomor(sjSetelah)} dibuat setelah ${d.nomor}; hapus itu dulu`);
        for (const b of d.baris) {
          if (!d.pesananId) continue;
          // Baris faktur jalur id (barisPesananId terisi) membalik tepat baris pesanannya, sehingga barang yang muncul di
          // beberapa baris pesanan tidak menumpuk di baris pertama (D2 §4.6, bug B-10 / §10.5 no. 6). Pembalik bersyarat:
          // progres faktur baris pesanan tidak pernah turun di bawah nol (CHECK jumlahDifaktur 0..jumlah).
          const pesanTidakCocok = `Progres faktur baris pesanan lebih kecil dari jumlah ${d.nomor}; data pesanan tidak cocok, periksa dulu sebelum menghapus`;
          if (b.barisPesananId) {
            const { count } = await tx.barisPesananPenjualan.updateMany({ where: { id: b.barisPesananId, jumlahDifaktur: { gte: b.jumlah } }, data: { jumlahDifaktur: { decrement: b.jumlah } } });
            if (count !== 1) throw new Error(pesanTidakCocok);
            continue;
          }
          // Tanpa barisPesananId (faktur lama atas barang ganda): kurangi baris pesanan berbarang sama urut terbalik
          // (urutan lalu id turun), masing-masing sampai jumlahDifaktur-nya, hingga jumlah baris faktur habis (tinjauan
          // perbaikan P27 tahap 2 T1). Migrasi 20261112100000 membagi ulang data lama B-10 urut naik, jadi faktur lama
          // tetap bisa dihapus apa pun baris yang dulu menampung progresnya. Ditolak hanya bila totalnya kurang.
          const kandidat = await tx.barisPesananPenjualan.findMany({
            where: { pesananId: d.pesananId, barangId: b.barangId },
            orderBy: [{ urutan: "desc" }, { id: "desc" }],
            select: { id: true, jumlahDifaktur: true },
          });
          if (kandidat.length === 0) continue;
          let sisa = D(b.jumlah);
          if (jumlahkan(kandidat.map((k) => k.jumlahDifaktur)).lt(sisa)) throw new Error(pesanTidakCocok);
          for (const k of kandidat) {
            if (sisa.lte(0)) break;
            const ambil = terkecil(D(k.jumlahDifaktur), sisa);
            if (ambil.lte(0)) continue;
            const { count } = await tx.barisPesananPenjualan.updateMany({ where: { id: k.id, jumlahDifaktur: { gte: ambil } }, data: { jumlahDifaktur: { decrement: ambil } } });
            if (count !== 1) throw new Error(pesanTidakCocok);
            sisa = sisa.minus(ambil);
          }
        }
        if (d.konsumsiSjTercatat) {
          // Konsumsi SJ dibalik persis menurut catatan KonsumsiSuratJalan (tinjauan P27 T1, S2): hanya baris SJ yang
          // benar-benar dipakai faktur ini, sebanyak yang dipakainya, termasuk SJ yatim baris pesanan lain. Catatannya
          // ikut terhapus (kaskade) bersama baris faktur. Pembaliknya bersyarat (tinjauan perbaikan P27 S2): baris SJ yang
          // jumlahDifaktur-nya lebih kecil dari catatan berarti data rusak, jadi hapus ditolak, tidak diturunkan sampai negatif.
          await kunciBarisSuratJalan(tx, catatan.map((c) => c.barisPengirimanId));
          for (const c of catatan) {
            const { count } = await tx.barisPengiriman.updateMany({ where: { id: c.barisPengirimanId, jumlahDifaktur: { gte: c.jumlah } }, data: { jumlahDifaktur: { decrement: c.jumlah } } });
            if (count !== 1) throw new Error(`Catatan konsumsi ${d.nomor} tidak cocok dengan surat jalan (jumlah difaktur baris SJ lebih kecil); periksa integritas data sebelum menghapus`);
          }
        } else if (d.pesananId) {
          // Faktur lama tanpa catatan konsumsi: perilaku kode lama 46729a2, kembalikan konsumsi transit ke baris SJ
          // terbaru lebih dulu (kebalikan urutan konsumsi), dibatasi jumlah baris faktur. Baris dengan barisPesananId
          // (hasil isi ulang migrasi lebur, barangnya tunggal di pesanan) memakai baris SJ baris pesanan itu, yang sama
          // dengan per barang. Dua batas tambahan (tinjauan perbaikan P27 S2 dan S3):
          // - per baris SJ hanya porsi yang tidak tercatat milik faktur lain (jumlahDifaktur dikurangi catatan konsumsi);
          // - bila pesanan masih punya faktur lain, pembalikan berhenti begitu nilainya mencapai nilaiTransit baris faktur
          //   (nilai yang dulu benar-benar dikonsumsinya), jadi baris bertransit 0 tidak mengembalikan SJ milik faktur lain.
          //   Tanpa faktur lain, semua konsumsi SJ pesanan milik faktur ini, jadi aturan lama berlaku utuh.
          // Batas yang tersisa: SJ berharga pokok 0 tidak terlihat oleh batas nilai (dampak nilainya juga 0). Pada data lama
          // B-10 atau ber-SJ yatim, baris SJ terbaru bisa milik faktur lain dengan harga pokok berbeda, sehingga pecahan
          // unit dibalik di baris SJ yang bukan miliknya; nilai transitnya tetap dalam batas (tinjauan perbaikan P27 tahap 2 T5).
          await kunciBarisSuratJalanPesanan(tx, d.pesananId);
          const adaFakturLain = fakturPesanan.some((f) => f.id !== id);
          const tercatat = new Map(
            (await tx.konsumsiSuratJalan.groupBy({ by: ["barisPengirimanId"], where: { barisPengiriman: { pengiriman: { pesananId: d.pesananId } } }, _sum: { jumlah: true } })).map((g) => [g.barisPengirimanId, D(g._sum.jumlah ?? 0)]),
          );
          for (const b of d.baris) {
            if (b.barang.jenis !== "BARANG") continue;
            let sisa = D(b.jumlah);
            let nilai = D(0);
            const batasNilai = D(b.nilaiTransit);
            const whereSj = b.barisPesananId ? { barisPesananId: b.barisPesananId, pengiriman: { pesananId: d.pesananId } } : { barangId: b.barangId, pengiriman: { pesananId: d.pesananId } };
            const barisSj = await tx.barisPengiriman.findMany({ where: whereSj, orderBy: [{ pengiriman: { tanggal: "desc" } }, { id: "desc" }] });
            for (const sj of barisSj) {
              if (sisa.lte(0)) break;
              if (adaFakturLain && nilai.gte(batasNilai)) break;
              let bisa = terkecil(D(sj.jumlahDifaktur).minus(tercatat.get(sj.id) ?? 0), sisa);
              const hargaPokok = D(sj.hargaPokok);
              // dibulatkan ke bawah supaya nilai yang dibalik tidak melewati nilaiTransit (tinjauan perbaikan P27 tahap 2 T5)
              if (adaFakturLain && hargaPokok.gt(0)) bisa = terkecil(bisa, batasNilai.minus(nilai).div(hargaPokok).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN));
              if (bisa.lte(0)) continue;
              const { count } = await tx.barisPengiriman.updateMany({ where: { id: sj.id, jumlahDifaktur: { gte: bisa } }, data: { jumlahDifaktur: { decrement: bisa } } });
              if (count !== 1) throw new Error(`Surat jalan pesanan ${d.nomor} berubah saat dihapus; muat ulang halaman lalu coba lagi`);
              sisa = sisa.minus(bisa);
              nilai = nilai.plus(kali(bisa, hargaPokok));
            }
          }
        }
        // kembalikan uang muka yang dipakai faktur ini ke DP asalnya
        const pemakaian = await tx.pemakaianUangMuka.findMany({ where: { fakturId: id } });
        for (const p of pemakaian) {
          await tx.uangMukaPelanggan.update({ where: { id: p.uangMukaId }, data: { jumlahDipakai: { decrement: p.jumlah } } });
        }
        await tx.pemakaianUangMuka.deleteMany({ where: { fakturId: id } });
        await tx.barisFakturPenjualan.deleteMany({ where: { fakturId: id } });
        await tx.fakturPenjualan.delete({ where: { id } });
        await hapusJurnal(tx, d.jurnalId);
        await catatLog(tx, pengguna, jenis, d.nomor, pemakaian.length ? "Piutang, uang muka dipakai, pendapatan, PPN, dan HPP dibalik; progres faktur pesanan dikurangi" : "Piutang, pendapatan, PPN, dan HPP dibalik; progres faktur pesanan dikurangi");
        return;
      }
      case "penerimaan": {
        const d = await tx.penerimaanPenjualan.findUniqueOrThrow({ where: { id } });
        await tx.penerimaanPenjualan.delete({ where: { id } });
        await hapusJurnal(tx, d.jurnalId);
        await segarkanStatusFakturPenjualan(tx, d.fakturId);
        await catatLog(tx, pengguna, jenis, d.nomor, "Kas/bank dan piutang dibalik; status faktur dihitung ulang");
        return;
      }
      case "uangMuka": {
        const d = await tx.uangMukaPelanggan.findUniqueOrThrow({ where: { id }, include: { pemakaian: { include: { faktur: { select: { nomor: true } } } } } });
        if (D(d.jumlahDipakai).gt(0)) throw new Error(`${d.nomor} sudah dipakai faktur ${daftarNomor(d.pemakaian.map((p) => p.faktur))}; hapus faktur itu dulu`);
        await tx.uangMukaPelanggan.delete({ where: { id } });
        await hapusJurnal(tx, d.jurnalId);
        await catatLog(tx, pengguna, jenis, d.nomor, "Kas/bank dan uang muka pelanggan dibalik");
        return;
      }
      case "returPenjualan": {
        const d = await tx.returPenjualan.findUniqueOrThrow({ where: { id }, include: { baris: { include: { barang: { select: { jenis: true } } } } } });
        const label = await labelBarang(tx, d.baris.map((b) => b.barangId));
        await kunciStokBaris(tx, d.baris.filter((b) => b.barang.jenis === "BARANG"), d.gudangId);
        for (const b of d.baris) {
          if (b.barang.jenis === "BARANG") {
            await kurangiStok(tx, b.barangId, d.gudangId, D(b.jumlah), label.get(b.barangId) ?? b.barangId);
            await ubahNilaiStok(tx, b.barangId, D(b.jumlah).neg(), kali(b.jumlah, b.hargaPokok).neg());
          }
        }
        await tx.barisReturPenjualan.deleteMany({ where: { returId: id } });
        await tx.returPenjualan.delete({ where: { id } });
        await hapusJurnal(tx, d.jurnalId);
        await segarkanStatusFakturPenjualan(tx, d.fakturId);
        await catatLog(tx, pengguna, jenis, d.nomor, "Barang retur dikeluarkan lagi dari gudang, jurnal retur dihapus, status faktur dihitung ulang");
        return;
      }
      case "pesananPembelian": {
        const d = await tx.pesananPembelian.findUniqueOrThrow({ where: { id }, include: { penerimaanBarang: true, faktur: true } });
        if (d.penerimaanBarang.length) throw new Error(`${d.nomor} sudah punya terima barang ${daftarNomor(d.penerimaanBarang)}; hapus itu dulu`);
        if (d.faktur.length) throw new Error(`${d.nomor} sudah punya faktur ${daftarNomor(d.faktur)}; hapus itu dulu`);
        await tx.barisPesananPembelian.deleteMany({ where: { pesananId: id } });
        await tx.pesananPembelian.delete({ where: { id } });
        await catatLog(tx, pengguna, jenis, d.nomor, "Pesanan pembelian dihapus");
        return;
      }
      case "penerimaanBarang": {
        const d = await tx.penerimaanBarang.findUniqueOrThrow({ where: { id }, include: { baris: { include: { barang: { select: { jenis: true } } } } } });
        const label = await labelBarang(tx, d.baris.map((b) => b.barangId));
        await kunciStokBaris(tx, d.baris.filter((b) => b.barang.jenis === "BARANG"), d.gudangId);
        for (const b of d.baris) {
          if (b.barang.jenis === "BARANG") {
            await kurangiStok(tx, b.barangId, d.gudangId, D(b.jumlah), label.get(b.barangId) ?? b.barangId);
            await ubahNilaiStok(tx, b.barangId, D(b.jumlah).neg(), kali(b.jumlah, b.hargaSatuan).neg());
          }
          await tx.barisPesananPembelian.update({ where: { id: b.barisPesananId }, data: { jumlahDiterima: { decrement: b.jumlah } } });
        }
        await tx.fakturPembelian.updateMany({ where: { penerimaanId: id }, data: { penerimaanId: null } });
        await tx.barisPenerimaanBarang.deleteMany({ where: { penerimaanId: id } });
        await tx.penerimaanBarang.delete({ where: { id } });
        await hapusJurnal(tx, d.jurnalId);
        await segarkanStatusPesananPembelian(tx, d.pesananId);
        await catatLog(tx, pengguna, jenis, d.nomor, "Stok dikeluarkan lagi, progres pesanan dikurangi, jurnal TB dihapus");
        return;
      }
      case "fakturPembelian": {
        const d = await tx.fakturPembelian.findUniqueOrThrow({
          where: { id },
          include: { pembayaran: true, retur: true, baris: { include: { barang: { select: { jenis: true } } } }, pesanan: { include: { baris: true } } },
        });
        if (d.pembayaran.length) throw new Error(`${d.nomor} sudah punya pembayaran ${daftarNomor(d.pembayaran)}; hapus itu dulu`);
        if (d.retur.length) throw new Error(`${d.nomor} sudah punya retur ${daftarNomor(d.retur)}; hapus itu dulu`);
        for (const b of urutBarang(d.baris)) {
          if (d.pesananId) {
            const bp = d.pesanan?.baris.find((ol) => ol.barangId === b.barangId);
            if (bp) {
              await tx.barisPesananPembelian.update({ where: { id: bp.id }, data: { jumlahDifaktur: { decrement: b.jumlah } } });
              if (b.barang.jenis === "BARANG") await sesuaikanHargaRata(tx, b.barangId, kali(b.jumlah, D(b.harga).minus(bp.harga)).neg());
            }
          }
        }
        await tx.barisFakturPembelian.deleteMany({ where: { fakturId: id } });
        await tx.fakturPembelian.delete({ where: { id } });
        await hapusJurnal(tx, d.jurnalId);
        await catatLog(tx, pengguna, jenis, d.nomor, "Hutang, PPN masukan, beban/persediaan dibalik; progres faktur pesanan dikurangi");
        return;
      }
      case "pembayaran": {
        const d = await tx.pembayaranPembelian.findUniqueOrThrow({ where: { id } });
        await tx.pembayaranPembelian.delete({ where: { id } });
        await hapusJurnal(tx, d.jurnalId);
        await segarkanStatusFakturPembelian(tx, d.fakturId);
        await catatLog(tx, pengguna, jenis, d.nomor, "Kas/bank dan hutang dibalik; status faktur dihitung ulang");
        return;
      }
      case "returPembelian": {
        const d = await tx.returPembelian.findUniqueOrThrow({ where: { id }, include: { baris: { include: { barang: { select: { jenis: true } } } } } });
        await kunciStokBaris(tx, d.baris.filter((b) => b.barang.jenis === "BARANG"), d.gudangId, true);
        for (const b of urutBarang(d.baris)) {
          if (b.barang.jenis === "BARANG") {
            await tambahStok(tx, b.barangId, d.gudangId, D(b.jumlah));
            await ubahNilaiStok(tx, b.barangId, D(b.jumlah), kali(b.jumlah, b.hargaPokok));
          }
        }
        await tx.barisReturPembelian.deleteMany({ where: { returId: id } });
        await tx.returPembelian.delete({ where: { id } });
        await hapusJurnal(tx, d.jurnalId);
        await segarkanStatusFakturPembelian(tx, d.fakturId);
        await catatLog(tx, pengguna, jenis, d.nomor, "Barang retur dikembalikan ke gudang, jurnal retur dihapus, status faktur dihitung ulang");
        return;
      }
      case "antarPerusahaan": {
        // D1 §4.5: kedua jurnal (pemberi dan penerima) dibalik bersama dokumennya
        const d = await tx.transaksiAntarPerusahaan.findUniqueOrThrow({ where: { id } });
        await tx.transaksiAntarPerusahaan.delete({ where: { id } });
        await hapusJurnal(tx, d.jurnalPemberiId);
        await hapusJurnal(tx, d.jurnalPenerimaId);
        // modul sama dengan log CATAT supaya visibilitas dan saringan modulnya konsisten (tinjauan P24 T5)
        await catatAktivitas(tx, pengguna, {
          aksi: "HAPUS",
          jenis: LABEL[jenis],
          nomor: d.nomor,
          keterangan: "Transaksi antar perusahaan dihapus; dua jurnal dibalik",
          modul: "antar-perusahaan",
          entitasId: id,
          meta: { pemberiId: d.pemberiId, penerimaId: d.penerimaId },
        });
        return;
      }
      case "jurnal": {
        const d = await tx.jurnal.findUniqueOrThrow({ where: { id } });
        pastikanHak(pengguna, d.sumber === "KAS_MASUK" ? "kas-masuk.hapus" : d.sumber === "KAS_KELUAR" ? "kas-keluar.hapus" : "jurnal.hapus");
        if (d.sumber === "PENUTUP") throw new Error(`${d.nomor} adalah jurnal penutup tahun; buka kembali tahun bukunya di Buku Besar › Tutup Buku`);
        if (!["MANUAL", "KAS_MASUK", "KAS_KELUAR"].includes(d.sumber)) {
          throw new Error(`${d.nomor} adalah jurnal otomatis; hapus lewat dokumen sumbernya`);
        }
        // Jurnal KM/KK hasil persetujuan milik DokumenKas yang disetujui. Tombol hapus di halaman Kas dan Jurnal mengirim
        // jenis "jurnal", jadi dokumen kasnya ikut dihapus bersama jurnalnya (tinjauan P22b T1), tidak hanya jurnalnya
        // (dokumen Disetujui tanpa jurnal). Jurnal KM/KK mode langsung tidak punya dokumen kas.
        if (d.sumber !== "MANUAL") {
          const dokKas = await tx.dokumenKas.findUnique({ where: { jurnalId: id }, select: { id: true } });
          if (dokKas) {
            await BERKAS.dokumenKas.kunci(tx, dokKas.id, "hapus");
            const dk = await tx.dokumenKas.findUniqueOrThrow({ where: { id: dokKas.id } });
            pastikanHak(pengguna, dk.jenis === "MASUK" ? "kas-masuk.hapus" : "kas-keluar.hapus");
            if (dk.jurnalId !== id) throw new Error(`${d.nomor} sudah tidak menjadi jurnal dokumen kas ${dk.nomor}. Muat ulang halaman`);
            await tx.dokumenKas.delete({ where: { id: dk.id } });
            await hapusJurnal(tx, id);
            await catatLog(tx, pengguna, "dokumenKas", dk.nomor, `Dokumen kas dan jurnalnya (${d.nomor}) dihapus lewat menu jurnal`);
            return;
          }
        }
        await hapusJurnal(tx, id);
        await catatLog(tx, pengguna, jenis, d.nomor, `Jurnal ${d.sumber.toLowerCase().replace("_", " ")} dihapus${d.keterangan ? ` (${d.keterangan})` : ""}`);
        return;
      }
      case "dokumenKas": {
        const d = await tx.dokumenKas.findUniqueOrThrow({ where: { id } });
        pastikanHak(pengguna, d.jenis === "MASUK" ? "kas-masuk.hapus" : "kas-keluar.hapus");
        await tx.dokumenKas.delete({ where: { id } });
        await hapusJurnal(tx, d.jurnalId);
        await catatLog(
          tx,
          pengguna,
          jenis,
          d.nomor,
          d.jurnalId ? "Dokumen kas dan jurnalnya dihapus" : `Draf dokumen kas dihapus (status ${d.statusPersetujuan}); belum ada jurnal`,
        );
        return;
      }
      case "penyesuaian": {
        const d = await tx.penyesuaianPersediaan.findUniqueOrThrow({ where: { id }, include: { baris: true } });
        // Penyesuaian yang belum disetujui belum memindahkan stok maupun membuat jurnal: tidak ada yang perlu dibalik
        if (d.statusPersetujuan !== "DISETUJUI") {
          await tx.barisPenyesuaianPersediaan.deleteMany({ where: { penyesuaianId: id } });
          await tx.penyesuaianPersediaan.delete({ where: { id } });
          await catatLog(tx, pengguna, jenis, d.nomor, `Draf penyesuaian dihapus (status ${d.statusPersetujuan}); stok dan jurnal tidak tersentuh`);
          return;
        }
        const label = await labelBarang(tx, d.baris.map((b) => b.barangId));
        // baris yang stoknya ditambah kembali (penyesuaian turun) dibuat nol bila belum ada (tinjauan P22b T3)
        await kunciStokUrut(tx, d.baris.filter((b) => !D(b.jumlahSesudah).equals(D(b.jumlahSebelum))).map((b) => ({ barangId: b.barangId, gudangId: d.gudangId, buatKosong: D(b.jumlahSesudah).lt(D(b.jumlahSebelum)) })));
        for (const b of d.baris) {
          const selisih = D(b.jumlahSesudah).minus(b.jumlahSebelum);
          if (selisih.gt(0)) await kurangiStok(tx, b.barangId, d.gudangId, selisih, label.get(b.barangId) ?? b.barangId);
          else if (selisih.lt(0)) await tambahStok(tx, b.barangId, d.gudangId, selisih.neg());
          await ubahNilaiStok(tx, b.barangId, selisih.neg(), kali(selisih, b.hargaSatuan).neg());
        }
        await tx.barisPenyesuaianPersediaan.deleteMany({ where: { penyesuaianId: id } });
        await tx.penyesuaianPersediaan.delete({ where: { id } });
        await hapusJurnal(tx, d.jurnalId);
        await catatLog(tx, pengguna, jenis, d.nomor, "Selisih stok dibalik, jurnal penyesuaian dihapus");
        return;
      }
      case "pindahBarang": {
        const d = await tx.pindahBarang.findUniqueOrThrow({ where: { id }, include: { baris: true, gudangTujuan: true } });
        const label = await labelBarang(tx, d.baris.map((b) => b.barangId));
        await kunciStokUrut(tx, d.baris.flatMap((b) => [{ barangId: b.barangId, gudangId: d.gudangTujuanId }, { barangId: b.barangId, gudangId: d.gudangAsalId, buatKosong: true }]));
        for (const b of d.baris) {
          // stok harus masih ada di gudang tujuan; bila sudah terpakai, kurangiStok menolak dengan pesan jelas
          await kurangiStok(tx, b.barangId, d.gudangTujuanId, D(b.jumlah), `${label.get(b.barangId) ?? b.barangId} (gudang ${d.gudangTujuan.nama})`);
          await tambahStok(tx, b.barangId, d.gudangAsalId, D(b.jumlah));
        }
        await tx.barisPindahBarang.deleteMany({ where: { pindahId: id } });
        await tx.pindahBarang.delete({ where: { id } });
        await catatLog(tx, pengguna, jenis, d.nomor, "Stok dikembalikan ke gudang asal");
        return;
      }
      case "peminjamanBarang": {
        // Tidak menjurnal, tapi SUDAH menyentuh stok sejak disetujui (lihat src/lib/persetujuan.ts,
        // berkas "peminjaman"): bagian yang masih di luar (jumlah - jumlahKembali) harus dikembalikan
        // ke StokBarang; bagian yang sudah dikonfirmasi kembali sudah ditambah balik saat itu, tidak diulang.
        const d = await tx.peminjamanBarang.findUniqueOrThrow({ where: { id }, include: { baris: { include: { barang: { select: { kode: true } } } }, penyesuaian: { select: { nomor: true } } } });
        if (d.penyesuaian) throw new Error(`${d.nomor} sudah ditautkan ke ${d.penyesuaian.nomor}; hapus penyesuaian itu dulu bila memang salah`);
        if (d.statusPersetujuan === "DISETUJUI") {
          await kunciStokBaris(tx, d.baris.filter((b) => D(b.jumlah).gt(D(b.jumlahKembali))), d.gudangId, true);
          for (const b of d.baris) {
            const sisa = D(b.jumlah).minus(D(b.jumlahKembali));
            if (sisa.gt(0)) await tambahStok(tx, b.barangId, d.gudangId, sisa);
          }
        }
        await tx.peminjamanBarang.delete({ where: { id } });
        const ringkasBaris = d.baris.map((b) => `${b.barang.kode} ${b.jumlah} (kembali ${b.jumlahKembali})`).join(", ");
        await catatLog(tx, pengguna, jenis, d.nomor, `Pengambil ${d.namaPengambil}; ${ringkasBaris}${d.statusPersetujuan === "DISETUJUI" ? "; stok yang masih di luar dikembalikan" : ""}`);
        return;
      }
      case "laporanKerusakan": {
        // Tidak menjurnal, tapi SUDAH menyentuh stok sejak disetujui (lihat src/lib/persetujuan.ts,
        // berkas "kerusakan"): tidak ada alur "kembali", jadi seluruh jumlah tiap baris dikembalikan.
        const d = await tx.laporanKerusakanBarang.findUniqueOrThrow({ where: { id }, include: { baris: { include: { barang: { select: { kode: true } } } }, penyesuaian: { select: { nomor: true } } } });
        if (d.penyesuaian) throw new Error(`${d.nomor} sudah ditautkan ke ${d.penyesuaian.nomor}; hapus penyesuaian itu dulu bila memang salah`);
        if (d.statusPersetujuan === "DISETUJUI") {
          await kunciStokBaris(tx, d.baris, d.gudangId, true);
          for (const b of d.baris) await tambahStok(tx, b.barangId, d.gudangId, D(b.jumlah));
        }
        await tx.laporanKerusakanBarang.delete({ where: { id } });
        const ringkasBaris = d.baris.map((b) => `${b.barang.kode} ${b.jumlah}`).join(", ");
        await catatLog(tx, pengguna, jenis, d.nomor, `Pelapor ${d.namaPelapor}; ${ringkasBaris}${d.statusPersetujuan === "DISETUJUI" ? "; stok dikembalikan" : ""}`);
        return;
      }
      case "pphFinal": {
        const d = await tx.pphFinalBulanan.findUniqueOrThrow({ where: { id }, include: { jurnal: { select: { nomor: true } } } });
        await tx.pphFinalBulanan.delete({ where: { id } });
        await hapusJurnal(tx, d.jurnalId);
        await catatLog(tx, pengguna, jenis, d.jurnal?.nomor ?? d.periode, `PPh Final periode ${d.periode} dibatalkan; beban & hutang PPh Final dibalik`);
        return;
      }
      case "prive": {
        const d = await tx.prive.findUniqueOrThrow({ where: { id } });
        await tx.prive.delete({ where: { id } });
        await hapusJurnal(tx, d.jurnalId);
        await catatLog(tx, pengguna, jenis, d.nomor, `Prive ${d.pemilikNama} ${d.jumlah} dibatalkan; kas dan akun prive dibalik`);
        return;
      }
      case "penggajian": {
        const d = await tx.penggajian.findUniqueOrThrow({ where: { id } });
        await tx.barisPenggajian.deleteMany({ where: { penggajianId: id } });
        await tx.penggajian.delete({ where: { id } });
        await hapusJurnal(tx, d.jurnalId);
        // bulan, bukan periode: periode perusahaan selain utama berisi kunci internal YYYY-MM@id (utama identik)
        await catatLog(tx, pengguna, jenis, d.nomor, `Penggajian periode ${d.bulan} dibatalkan (${d.totalDibayar} dibayar); beban dan kas dibalik`);
        return;
      }
      case "aset": {
        const d = await tx.asetTetap.findUniqueOrThrow({ where: { id }, include: { penyusutan: true, pelepasan: true } });
        if (d.pelepasan) throw new Error(`${d.kode} sudah dilepas (${d.status}); hapus pelepasannya dulu`);
        if (d.penyusutan.length) throw new Error(`${d.kode} sudah punya ${d.penyusutan.length} penyusutan; hapus penyusutannya dulu`);
        await tx.asetTetap.delete({ where: { id } });
        await hapusJurnal(tx, d.jurnalPerolehanId);
        await catatLog(tx, pengguna, jenis, d.kode, d.jurnalPerolehanId ? "Aset dan jurnal perolehannya dihapus" : "Aset dihapus");
        return;
      }
      case "pelepasanAset": {
        const d = await tx.pelepasanAset.findUniqueOrThrow({ where: { id }, include: { aset: true, jurnal: { select: { nomor: true } } } });
        await tx.pelepasanAset.delete({ where: { id } });
        await hapusJurnal(tx, d.jurnalId);
        await tx.asetTetap.update({ where: { id: d.asetId }, data: { status: "AKTIF" } });
        await catatLog(tx, pengguna, jenis, d.jurnal?.nomor ?? d.aset.kode, `Pelepasan ${d.aset.kode} dibatalkan; aset kembali AKTIF, jurnal pelepasan dihapus`);
        return;
      }
      case "penyusutan": {
        // id = jurnalId satu periode penyusutan (bisa memuat beberapa aset)
        const jurnal = await tx.jurnal.findUniqueOrThrow({ where: { id }, include: { penyusutanAset: { include: { aset: { include: { penyusutan: true } } } } } });
        if (jurnal.sumber !== "PENYUSUTAN") throw new Error(`${jurnal.nomor} bukan jurnal penyusutan`);
        for (const p of jurnal.penyusutanAset) {
          const lebihBaru = p.aset.penyusutan.filter((x) => x.periode > p.periode);
          if (lebihBaru.length) throw new Error(`${p.aset.kode} punya penyusutan periode lebih baru; hapus dari yang terbaru dulu`);
        }
        await tx.penyusutanAset.deleteMany({ where: { jurnalId: id } });
        await hapusJurnal(tx, id);
        await catatLog(tx, pengguna, jenis, jurnal.nomor, `Penyusutan ${jurnal.penyusutanAset.length} aset dibalik`);
        return;
      }
    }
  }, { timeout: BATAS_WAKTU_HAPUS });

  for (const jalur of JALUR[jenis]) revalidatePath(jalur);
  revalidatePath("/");
}

// Dipakai lewat .bind(null, jenis, id); argumen (prevState, dataFormulir) dari useActionState sengaja diabaikan
export async function hapusDokumenFormulir(jenis: JenisDokumen, id: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => hapusDokumen(jenis, id));
}

/** Daftar tujuan sesudah hapus dari halaman detail; tetap di kode supaya tujuan pengalihan tidak bisa diatur klien. */
const DAFTAR_SESUDAH_HAPUS: Partial<Record<JenisDokumen, string>> = {
  penawaran: "/penjualan/penawaran",
  pesanan: "/penjualan/pesanan",
  faktur: "/penjualan/faktur",
  uangMuka: "/penjualan/uang-muka",
  penerimaan: "/penjualan/penerimaan",
};

// Tombol Hapus di halaman detail: sama dengan hapusDokumenFormulir, lalu mengalihkan ke daftar jenisnya bila berhasil,
// karena halaman detail dokumen yang sudah terhapus menjadi 404. Galat tetap dikembalikan ke formulir.
export async function hapusDokumenLaluKembaliFormulir(jenis: JenisDokumen, id: string): Promise<StatusFormulir> {
  const hasil = await jalankanFormulir(() => hapusDokumen(jenis, id));
  const tujuan = DAFTAR_SESUDAH_HAPUS[jenis];
  if (hasil.ok && !hasil.galat && tujuan) redirect(tujuan);
  return hasil;
}
