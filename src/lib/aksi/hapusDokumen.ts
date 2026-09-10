"use server";

import { wajibHakAksi } from "@/lib/otentikasi";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { D, kali, jumlahkan, terkecil, type Desimal } from "@/lib/uang";
import { kurangiStok, tambahStok, labelBarang, ubahNilaiStok, sesuaikanHargaRata } from "@/lib/stok";
import type { PenggunaSesi } from "@/lib/hakAkses";
import type { Prisma } from "@/prisma-klien/client";

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
  | "returPenjualan"
  | "pesananPembelian"
  | "penerimaanBarang"
  | "fakturPembelian"
  | "pembayaran"
  | "returPembelian"
  | "jurnal"
  | "penyesuaian"
  | "aset"
  | "penyusutan";

const LABEL: Record<JenisDokumen, string> = {
  penawaran: "Penawaran Penjualan",
  pesanan: "Pesanan Penjualan",
  pengiriman: "Surat Jalan",
  faktur: "Faktur Penjualan",
  penerimaan: "Penerimaan Penjualan",
  returPenjualan: "Retur Penjualan",
  pesananPembelian: "Pesanan Pembelian",
  penerimaanBarang: "Terima Barang",
  fakturPembelian: "Faktur Pembelian",
  pembayaran: "Pembayaran Pembelian",
  returPembelian: "Retur Pembelian",
  jurnal: "Jurnal",
  penyesuaian: "Penyesuaian Stok",
  aset: "Aset Tetap",
  penyusutan: "Penyusutan",
};

const JALUR: Record<JenisDokumen, string[]> = {
  penawaran: ["/penjualan/penawaran"],
  pesanan: ["/penjualan/pesanan", "/penjualan/penawaran"],
  pengiriman: ["/penjualan/pengiriman", "/penjualan/pesanan", "/persediaan"],
  faktur: ["/penjualan/faktur", "/penjualan/pesanan"],
  penerimaan: ["/penjualan/penerimaan", "/penjualan/faktur"],
  returPenjualan: ["/penjualan/retur", "/penjualan/faktur", "/persediaan"],
  pesananPembelian: ["/pembelian/pesanan"],
  penerimaanBarang: ["/pembelian/penerimaan-barang", "/pembelian/pesanan", "/persediaan"],
  fakturPembelian: ["/pembelian/faktur", "/pembelian/pesanan"],
  pembayaran: ["/pembelian/pembayaran", "/pembelian/faktur"],
  returPembelian: ["/pembelian/retur", "/pembelian/faktur", "/persediaan"],
  jurnal: ["/buku-besar/jurnal", "/kas-bank/masuk", "/kas-bank/keluar"],
  penyesuaian: ["/persediaan/penyesuaian", "/persediaan"],
  aset: ["/aset-tetap"],
  penyusutan: ["/aset-tetap/penyusutan", "/aset-tetap"],
};

function statusFaktur(total: Desimal, dibayar: Desimal, retur: Desimal): "DRAF" | "SEBAGIAN" | "LUNAS" {
  if (dibayar.plus(retur).gte(total)) return "LUNAS";
  return dibayar.gt(0) || retur.gt(0) ? "SEBAGIAN" : "DRAF";
}

async function hapusJurnal(tx: Tx, jurnalId: string | null | undefined) {
  if (!jurnalId) return;
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
  const status = statusFaktur(D(f.total), jumlahkan(f.penerimaan.map((p) => D(p.jumlah).plus(p.potonganPajak))), jumlahkan(f.retur.map((r) => r.total)));
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
const daftarNomor = (d: { nomor: string }[]) => d.map((x) => x.nomor).join(", ");

export async function hapusDokumen(jenis: JenisDokumen, id: string) {
  const pengguna = await wajibHakAksi("dokumen.hapus");

  await db.$transaction(async (tx) => {
    switch (jenis) {
      case "penawaran": {
        const d = await tx.penawaranPenjualan.findUniqueOrThrow({ where: { id }, include: { pesanan: true } });
        if (d.pesanan) throw new Error(`${d.nomor} sudah dikonversi menjadi ${d.pesanan.nomor}; hapus pesanan itu dulu`);
        await tx.barisPenawaranPenjualan.deleteMany({ where: { penawaranId: id } });
        await tx.penawaranPenjualan.delete({ where: { id } });
        await catatLog(tx, pengguna, jenis, d.nomor, "Penawaran draf dihapus");
        return;
      }
      case "pesanan": {
        const d = await tx.pesananPenjualan.findUniqueOrThrow({ where: { id }, include: { pengiriman: true, faktur: true } });
        if (d.pengiriman.length) throw new Error(`${d.nomor} sudah punya surat jalan ${daftarNomor(d.pengiriman)}; hapus itu dulu`);
        if (d.faktur.length) throw new Error(`${d.nomor} sudah punya faktur ${daftarNomor(d.faktur)}; hapus itu dulu`);
        await tx.barisPesananPenjualan.deleteMany({ where: { pesananId: id } });
        await tx.pesananPenjualan.delete({ where: { id } });
        if (d.penawaranId) await tx.penawaranPenjualan.update({ where: { id: d.penawaranId }, data: { status: "DRAF" } });
        await catatLog(tx, pengguna, jenis, d.nomor, d.penawaranId ? "Pesanan dihapus; penawaran asal kembali menjadi draf" : "Pesanan dihapus");
        return;
      }
      case "pengiriman": {
        const d = await tx.pengirimanPesanan.findUniqueOrThrow({
          where: { id },
          include: { baris: { include: { barang: { select: { jenis: true, kode: true, nama: true } } } }, pesanan: { include: { faktur: true } }, faktur: true },
        });
        const fakturSetelah = d.pesanan.faktur.filter((f) => f.tanggal >= d.tanggal);
        if (fakturSetelah.length) {
          throw new Error(`Faktur ${daftarNomor(fakturSetelah)} dibuat setelah ${d.nomor} dan sudah mengakui HPP-nya; hapus faktur itu dulu`);
        }
        for (const b of d.baris) {
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
          include: { penerimaan: true, retur: true, baris: { include: { barang: { select: { jenis: true } } } }, pesanan: { include: { faktur: true, pengiriman: true } } },
        });
        if (d.penerimaan.length) throw new Error(`${d.nomor} sudah punya penerimaan ${daftarNomor(d.penerimaan)}; hapus itu dulu`);
        if (d.retur.length) throw new Error(`${d.nomor} sudah punya retur ${daftarNomor(d.retur)}; hapus itu dulu`);
        const lebihBaru = (d.pesanan?.faktur ?? []).filter((f) => f.id !== id && f.tanggal > d.tanggal);
        if (lebihBaru.length) throw new Error(`Hapus faktur yang lebih baru dulu (${daftarNomor(lebihBaru)}) agar pengakuan HPP bisa dibalik urut`);
        const sjSetelah = (d.pesanan?.pengiriman ?? []).filter((s) => s.tanggal > d.tanggal);
        if (sjSetelah.length) throw new Error(`Surat jalan ${daftarNomor(sjSetelah)} dibuat setelah ${d.nomor}; hapus itu dulu`);
        for (const b of d.baris) {
          if (d.pesananId) {
            const bp = await tx.barisPesananPenjualan.findFirst({ where: { pesananId: d.pesananId, barangId: b.barangId } });
            if (bp) await tx.barisPesananPenjualan.update({ where: { id: bp.id }, data: { jumlahDifaktur: { decrement: b.jumlah } } });
            if (b.barang.jenis === "BARANG") {
              // kembalikan konsumsi transit ke baris SJ, terbaru lebih dulu (kebalikan urutan konsumsi)
              let sisa = D(b.jumlah);
              const barisSj = await tx.barisPengiriman.findMany({ where: { barangId: b.barangId, pengiriman: { pesananId: d.pesananId } }, orderBy: { pengiriman: { tanggal: "desc" } } });
              for (const sj of barisSj) {
                if (sisa.lte(0)) break;
                const bisa = terkecil(D(sj.jumlahDifaktur), sisa);
                if (bisa.lte(0)) continue;
                await tx.barisPengiriman.update({ where: { id: sj.id }, data: { jumlahDifaktur: { decrement: bisa } } });
                sisa = sisa.minus(bisa);
              }
            }
          }
        }
        await tx.barisFakturPenjualan.deleteMany({ where: { fakturId: id } });
        await tx.fakturPenjualan.delete({ where: { id } });
        await hapusJurnal(tx, d.jurnalId);
        await catatLog(tx, pengguna, jenis, d.nomor, "Piutang, pendapatan, PPN, dan HPP dibalik; progres faktur pesanan dikurangi");
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
      case "returPenjualan": {
        const d = await tx.returPenjualan.findUniqueOrThrow({ where: { id }, include: { baris: { include: { barang: { select: { jenis: true } } } } } });
        const label = await labelBarang(tx, d.baris.map((b) => b.barangId));
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
        for (const b of d.baris) {
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
        for (const b of d.baris) {
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
      case "jurnal": {
        const d = await tx.jurnal.findUniqueOrThrow({ where: { id } });
        if (!["MANUAL", "KAS_MASUK", "KAS_KELUAR"].includes(d.sumber)) {
          throw new Error(`${d.nomor} adalah jurnal otomatis; hapus lewat dokumen sumbernya`);
        }
        await hapusJurnal(tx, id);
        await catatLog(tx, pengguna, jenis, d.nomor, `Jurnal ${d.sumber.toLowerCase().replace("_", " ")} dihapus${d.keterangan ? ` (${d.keterangan})` : ""}`);
        return;
      }
      case "penyesuaian": {
        const d = await tx.penyesuaianPersediaan.findUniqueOrThrow({ where: { id }, include: { baris: true } });
        const label = await labelBarang(tx, d.baris.map((b) => b.barangId));
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
      case "aset": {
        const d = await tx.asetTetap.findUniqueOrThrow({ where: { id }, include: { penyusutan: true } });
        if (d.penyusutan.length) throw new Error(`${d.kode} sudah punya ${d.penyusutan.length} penyusutan; hapus penyusutannya dulu`);
        await tx.asetTetap.delete({ where: { id } });
        await hapusJurnal(tx, d.jurnalPerolehanId);
        await catatLog(tx, pengguna, jenis, d.kode, d.jurnalPerolehanId ? "Aset dan jurnal perolehannya dihapus" : "Aset dihapus");
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
  });

  for (const jalur of JALUR[jenis]) revalidatePath(jalur);
  revalidatePath("/");
}

// Dipakai lewat .bind(null, jenis, id); argumen (prevState, dataFormulir) dari useActionState sengaja diabaikan
export async function hapusDokumenFormulir(jenis: JenisDokumen, id: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => hapusDokumen(jenis, id));
}
