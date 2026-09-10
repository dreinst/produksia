import type { PrismaClient } from "@/prisma-klien/client";
import { db } from "@/lib/db";
import { D, kali, jumlahkan, type Desimal } from "@/lib/uang";

/*
 * Pemeriksaan sinkronisasi buku besar ↔ dokumen/stok. Dipakai kartu Integritas di beranda
 * dan skrip regresi `skrip/uji-sinkron.ts`. Setiap selisih ≠ 0 berarti ada jalur yang tidak
 * menjurnal (atau menjurnal dua kali) — harus diperlakukan sebagai bug.
 */
export type Perbandingan = { bukuBesar: Desimal; dokumen: Desimal; selisih: Desimal; sinkron: boolean };
export type HasilSinkron = {
  pemetaanAda: boolean;
  seimbang: boolean;
  totalDebit: Desimal;
  totalKredit: Desimal;
  persediaan: Perbandingan;
  piutang: Perbandingan;
  hutang: Perbandingan;
  barangBelumDitagih: Perbandingan;
  barangTerkirim: Perbandingan;
};

const TOLERANSI = D(1); // pembulatan harga rata-rata ke 2 desimal

function banding(bukuBesar: Desimal, dokumen: Desimal): Perbandingan {
  const selisih = bukuBesar.minus(dokumen);
  return { bukuBesar, dokumen, selisih, sinkron: selisih.abs().lte(TOLERANSI) };
}

async function saldoAkun(klien: PrismaClient, akunIds: string[], normalDebit: boolean): Promise<Desimal> {
  if (akunIds.length === 0) return D(0);
  const agg = await klien.barisJurnal.aggregate({ where: { akunId: { in: akunIds } }, _sum: { debit: true, kredit: true } });
  const debit = D(agg._sum.debit ?? 0);
  const kredit = D(agg._sum.kredit ?? 0);
  return normalDebit ? debit.minus(kredit) : kredit.minus(debit);
}

export async function periksaSinkron(klien: PrismaClient = db): Promise<HasilSinkron> {
  const [pemetaan, total, daftarStok, akunPersediaanBarang, fakturJual, fakturBeli, tb, barisSj] = await Promise.all([
    klien.pemetaanAkun.findUnique({ where: { id: "default" } }),
    klien.barisJurnal.aggregate({ _sum: { debit: true, kredit: true } }),
    klien.stokBarang.findMany({ include: { barang: { select: { jenis: true, hargaBeli: true } } } }),
    klien.barang.findMany({ where: { akunPersediaanId: { not: null } }, select: { akunPersediaanId: true } }),
    klien.fakturPenjualan.findMany({ include: { penerimaan: { select: { jumlah: true, potonganPajak: true } }, retur: { select: { total: true } } } }),
    klien.fakturPembelian.findMany({ include: { pembayaran: { select: { jumlah: true, potonganPajak: true } }, retur: { select: { total: true } } } }),
    klien.penerimaanBarang.findMany({ include: { baris: { include: { barang: { select: { jenis: true } }, barisPesanan: { select: { harga: true, jumlahDifaktur: true, jumlah: true } } } } } }),
    klien.barisPengiriman.findMany({ include: { barang: { select: { jenis: true } } } }),
  ]);
  const totalDebit = D(total._sum.debit ?? 0);
  const totalKredit = D(total._sum.kredit ?? 0);
  const nol = D(0);
  const kosong = banding(nol, nol);
  if (!pemetaan) {
    return { pemetaanAda: false, seimbang: totalDebit.equals(totalKredit), totalDebit, totalKredit, persediaan: kosong, piutang: kosong, hutang: kosong, barangBelumDitagih: kosong, barangTerkirim: kosong };
  }

  // Persediaan: saldo akun persediaan (pemetaan + akun khusus barang) vs Σ stok × harga pokok
  const akunPersediaan = [...new Set([pemetaan.persediaanId, ...akunPersediaanBarang.map((b) => b.akunPersediaanId!)])];
  const nilaiStok = jumlahkan(daftarStok.filter((s) => s.barang.jenis === "BARANG").map((s) => kali(s.jumlah, s.barang.hargaBeli)));
  const persediaan = banding(await saldoAkun(klien, akunPersediaan, true), nilaiStok);

  // Piutang: saldo akun piutang vs Σ (total faktur − penerimaan − retur)
  const sisaPiutang = jumlahkan(fakturJual.map((f) => D(f.total).minus(jumlahkan(f.penerimaan.map((p) => D(p.jumlah).plus(p.potonganPajak)))).minus(jumlahkan(f.retur.map((r) => r.total)))));
  const piutang = banding(await saldoAkun(klien, [pemetaan.piutangUsahaId], true), sisaPiutang);

  // Hutang: saldo akun hutang vs Σ (total faktur − pembayaran − retur)
  const sisaHutang = jumlahkan(fakturBeli.map((f) => D(f.total).minus(jumlahkan(f.pembayaran.map((p) => D(p.jumlah).plus(p.potonganPajak)))).minus(jumlahkan(f.retur.map((r) => r.total)))));
  const hutang = banding(await saldoAkun(klien, [pemetaan.utangUsahaId], false), sisaHutang);

  // Barang diterima belum ditagih: saldo akun vs Σ (BARANG diterima − difaktur) × harga pesanan
  // (per baris pesanan: yang diterima tapi belum difaktur; bila faktur mendahului TB, nilainya negatif)
  const barisPesananTerlihat = new Map<string, { harga: Desimal; diterima: Desimal; difaktur: Desimal }>();
  for (const dok of tb) {
    for (const b of dok.baris) {
      if (b.barang.jenis !== "BARANG") continue;
      const rekam = barisPesananTerlihat.get(b.barisPesananId) ?? { harga: D(b.barisPesanan.harga), diterima: nol, difaktur: D(b.barisPesanan.jumlahDifaktur) };
      rekam.diterima = rekam.diterima.plus(b.jumlah);
      barisPesananTerlihat.set(b.barisPesananId, rekam);
    }
  }
  const nilaiBelumDitagih = jumlahkan([...barisPesananTerlihat.values()].map((r) => kali(r.diterima.minus(r.difaktur), r.harga)));
  const barangBelumDitagih = pemetaan.barangBelumDitagihId
    ? banding(await saldoAkun(klien, [pemetaan.barangBelumDitagihId], false), nilaiBelumDitagih)
    : kosong;

  // Barang terkirim belum ditagih: saldo akun vs Σ (BARANG dikirim − sudah difaktur) × harga pokok saat kirim
  const nilaiTerkirim = jumlahkan(barisSj.filter((b) => b.barang.jenis === "BARANG").map((b) => kali(D(b.jumlah).minus(b.jumlahDifaktur), b.hargaPokok)));
  const barangTerkirim = pemetaan.barangTerkirimId ? banding(await saldoAkun(klien, [pemetaan.barangTerkirimId], true), nilaiTerkirim) : kosong;

  return { pemetaanAda: true, seimbang: totalDebit.equals(totalKredit), totalDebit, totalKredit, persediaan, piutang, hutang, barangBelumDitagih, barangTerkirim };
}
