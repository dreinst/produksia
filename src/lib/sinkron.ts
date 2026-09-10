import type { PrismaClient } from "@/prisma-klien/client";
import { db } from "@/lib/db";
import { D, type Desimal } from "@/lib/uang";

/*
 * Pemeriksaan sinkronisasi buku besar ↔ dokumen/stok. Dipakai kartu Integritas di beranda
 * dan skrip regresi `skrip/uji-sinkron.ts`. Setiap selisih ≠ 0 berarti ada jalur yang tidak
 * menjurnal (atau menjurnal dua kali), harus diperlakukan sebagai bug.
 *
 * Semua angka dijumlahkan di PostgreSQL (aggregate / SUM) sehingga biayanya tetap kecil
 * berapa pun banyaknya dokumen; tidak ada baris yang dimuat ke memori.
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
  uangMuka: Perbandingan;
};

const TOLERANSI = D(1); // pembulatan harga rata-rata ke 2 desimal

function banding(bukuBesar: Desimal, dokumen: Desimal): Perbandingan {
  const selisih = bukuBesar.minus(dokumen);
  return { bukuBesar, dokumen, selisih, sinkron: selisih.abs().lte(TOLERANSI) };
}

type Jumlah = { nilai: Desimal | number | null }[];
const satu = (r: Jumlah) => D(r[0]?.nilai ?? 0);

export async function periksaSinkron(klien: PrismaClient = db): Promise<HasilSinkron> {
  const [pemetaan, total, akunPersediaanBarang, nilaiStokRaw, fakturJual, terimaJual, returJual, fakturBeli, bayarBeli, returBeli, belumDitagihRaw, terkirimRaw, uangMukaAgg] = await Promise.all([
    klien.pemetaanAkun.findUnique({ where: { id: "default" } }),
    klien.barisJurnal.aggregate({ _sum: { debit: true, kredit: true } }),
    klien.barang.findMany({ where: { akunPersediaanId: { not: null } }, select: { akunPersediaanId: true }, distinct: ["akunPersediaanId"] }),
    // Σ stok × harga pokok rata-rata (hanya BARANG)
    klien.$queryRaw<Jumlah>`SELECT COALESCE(SUM(s."jumlah" * b."hargaBeli"), 0) AS nilai FROM "StokBarang" s JOIN "Barang" b ON b."id" = s."barangId" WHERE b."jenis" = 'BARANG'`,
    klien.fakturPenjualan.aggregate({ _sum: { total: true, uangMuka: true } }),
    klien.penerimaanPenjualan.aggregate({ _sum: { jumlah: true, potonganPajak: true } }),
    klien.returPenjualan.aggregate({ _sum: { total: true } }),
    klien.fakturPembelian.aggregate({ _sum: { total: true } }),
    klien.pembayaranPembelian.aggregate({ _sum: { jumlah: true, potonganPajak: true } }),
    klien.returPembelian.aggregate({ _sum: { total: true } }),
    // Σ per baris pesanan pembelian: (BARANG diterima − sudah difaktur) × harga pesanan (negatif bila faktur mendahului TB)
    klien.$queryRaw<Jumlah>`
      SELECT COALESCE(SUM((t."diterima" - bp."jumlahDifaktur") * bp."harga"), 0) AS nilai
      FROM (
        SELECT bt."barisPesananId", SUM(bt."jumlah") AS diterima
        FROM "BarisPenerimaanBarang" bt JOIN "Barang" b ON b."id" = bt."barangId"
        WHERE b."jenis" = 'BARANG' GROUP BY bt."barisPesananId"
      ) t JOIN "BarisPesananPembelian" bp ON bp."id" = t."barisPesananId"`,
    // Σ (BARANG dikirim − sudah difaktur) × harga pokok saat kirim
    klien.$queryRaw<Jumlah>`SELECT COALESCE(SUM((bp."jumlah" - bp."jumlahDifaktur") * bp."hargaPokok"), 0) AS nilai FROM "BarisPengiriman" bp JOIN "Barang" b ON b."id" = bp."barangId" WHERE b."jenis" = 'BARANG'`,
    klien.uangMukaPelanggan.aggregate({ _sum: { jumlah: true, jumlahDipakai: true } }),
  ]);
  const totalDebit = D(total._sum.debit ?? 0);
  const totalKredit = D(total._sum.kredit ?? 0);
  const nol = D(0);
  const kosong = banding(nol, nol);
  if (!pemetaan) {
    return { pemetaanAda: false, seimbang: totalDebit.equals(totalKredit), totalDebit, totalKredit, persediaan: kosong, piutang: kosong, hutang: kosong, barangBelumDitagih: kosong, barangTerkirim: kosong, uangMuka: kosong };
  }

  // saldo tiap akun pembanding dalam satu groupBy (bukan satu kueri per akun)
  const akunPersediaan = [...new Set([pemetaan.persediaanId, ...akunPersediaanBarang.map((b) => b.akunPersediaanId!)])];
  const akunDicek = [...new Set([...akunPersediaan, pemetaan.piutangUsahaId, pemetaan.utangUsahaId, pemetaan.barangBelumDitagihId, pemetaan.barangTerkirimId, pemetaan.uangMukaPelangganId].filter((x): x is string => Boolean(x)))];
  const saldoPerAkun = new Map<string, { debit: Desimal; kredit: Desimal }>();
  for (const g of await klien.barisJurnal.groupBy({ by: ["akunId"], where: { akunId: { in: akunDicek } }, _sum: { debit: true, kredit: true } })) {
    saldoPerAkun.set(g.akunId, { debit: D(g._sum.debit ?? 0), kredit: D(g._sum.kredit ?? 0) });
  }
  const saldo = (ids: (string | null | undefined)[], normalDebit: boolean) => {
    let debit = nol, kredit = nol;
    for (const id of ids) {
      const s = id ? saldoPerAkun.get(id) : undefined;
      if (!s) continue;
      debit = debit.plus(s.debit);
      kredit = kredit.plus(s.kredit);
    }
    return normalDebit ? debit.minus(kredit) : kredit.minus(debit);
  };

  const persediaan = banding(saldo(akunPersediaan, true), satu(nilaiStokRaw));
  // Piutang: Σ (total faktur − uang muka dipakai) − Σ (penerimaan + potongan pajak) − Σ retur
  const sisaPiutang = D(fakturJual._sum.total ?? 0).minus(fakturJual._sum.uangMuka ?? 0).minus(terimaJual._sum.jumlah ?? 0).minus(terimaJual._sum.potonganPajak ?? 0).minus(returJual._sum.total ?? 0);
  const piutang = banding(saldo([pemetaan.piutangUsahaId], true), sisaPiutang);
  // Hutang: Σ total faktur − Σ (pembayaran + potongan pajak) − Σ retur
  const sisaHutang = D(fakturBeli._sum.total ?? 0).minus(bayarBeli._sum.jumlah ?? 0).minus(bayarBeli._sum.potonganPajak ?? 0).minus(returBeli._sum.total ?? 0);
  const hutang = banding(saldo([pemetaan.utangUsahaId], false), sisaHutang);
  const barangBelumDitagih = pemetaan.barangBelumDitagihId ? banding(saldo([pemetaan.barangBelumDitagihId], false), satu(belumDitagihRaw)) : kosong;
  const barangTerkirim = pemetaan.barangTerkirimId ? banding(saldo([pemetaan.barangTerkirimId], true), satu(terkirimRaw)) : kosong;
  const nilaiUangMuka = D(uangMukaAgg._sum.jumlah ?? 0).minus(uangMukaAgg._sum.jumlahDipakai ?? 0);
  const uangMuka = pemetaan.uangMukaPelangganId ? banding(saldo([pemetaan.uangMukaPelangganId], false), nilaiUangMuka) : kosong;

  return { pemetaanAda: true, seimbang: totalDebit.equals(totalKredit), totalDebit, totalKredit, persediaan, piutang, hutang, barangBelumDitagih, barangTerkirim, uangMuka };
}
