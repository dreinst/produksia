import type { PrismaClient } from "@/prisma-klien/client";
import { db } from "@/lib/db";
import { D, jumlahkan, type Desimal } from "@/lib/uang";
import { susunHierarki, type AkunSaldo, type BarisLaporan, type OpsiLaporan, type Periode } from "@/lib/laporan";
import { kelasArus } from "@/lib/arusKas";

/*
 * Sudut pandang KAS untuk laporan manajemen (Laba Rugi basis kas & Ringkasan Pendapatan basis kas).
 * Buku besar tetap akrual (wajib untuk pembukuan pajak, Penjelasan Pasal 28 ayat (5) UU KUP); laporan ini
 * membaca ulang jurnal yang menyentuh akun kas/bank, seperti Arus Kas metode langsung, lalu:
 * - kas dari pelanggan (akun lawan: Piutang Usaha, Uang Muka Pelanggan, akun pendapatan, PPh 23 dibayar dimuka)
 *   dialokasikan ke akun pendapatan menurut baris faktur (Penerimaan) atau baris pesanan (Uang Muka),
 *   bagian PPN-nya dipisah sebagai titipan; kas masuk langsung ke akun pendapatan dipakai apa adanya;
 *   semuanya ditelusuri ke pelanggan dokumennya;
 * - kas operasi lainnya dikelompokkan per akun lawan: positif = penerimaan lain, negatif = pengeluaran;
 * - investasi (aset tetap) dan pendanaan (modal, prive, pinjaman) tidak ikut, sama seperti Laba Rugi.
 * Surplus kas operasi = pendapatan diterima + PPN titipan + penerimaan lain − pengeluaran = arus kas operasi.
 */

type Rekanan = { id: string; kode: string; nama: string };
export type BarisKas = { id: string; kode: string; nama: string; jumlah: Desimal };
export type PendapatanKasPelanggan = { id: string | null; kode: string; nama: string; uangMuka: Desimal; pelunasan: Desimal; lainnya: Desimal; total: Desimal; jumlahDokumen: number };
export type LabaRugiKas = {
  periode: Periode;
  pendapatan: BarisLaporan[];
  totalPendapatan: Desimal;
  ppnTitipan: Desimal;
  penerimaanLain: BarisKas[];
  totalPenerimaanLain: Desimal;
  pengeluaran: BarisKas[];
  totalPengeluaran: Desimal;
  surplus: Desimal;
  perPelanggan: PendapatanKasPelanggan[];
  totalDariPelanggan: Desimal;
  jumlahDokumen: number;
};
export type KasBulan = { bulan: number; diterima: Desimal; dikeluarkan: Desimal; surplus: Desimal };
export type LabaRugiKasBulanan = { tahun: number; bulan: KasBulan[]; total: { diterima: Desimal; dikeluarkan: Desimal; surplus: Desimal } };

export const TANPA_PELANGGAN_KAS = "Tanpa pelanggan (kas masuk langsung, jurnal umum)";
const PPN_TITIPAN = { id: "ppn-titipan", kode: "", nama: "PPN dalam penerimaan (titipan, bukan pendapatan)" };

/** Satu jurnal kas yang sudah dinormalkan. */
type CatatanKas = {
  bulan: number;
  pendapatan: Map<string, Desimal>; // akunId pendapatan → kas dialokasikan
  ppn: Desimal;
  lain: Map<string, Desimal>; // akun lawan operasi lain → kas masuk (negatif = keluar)
  pelanggan: Rekanan | null;
  jenis: "UANG_MUKA" | "PELUNASAN" | "LAINNYA";
  dariPelanggan: Desimal;
};

const tambah = (peta: Map<string, Desimal>, k: string, v: Desimal) => peta.set(k, (peta.get(k) ?? D(0)).plus(v));

async function kumpulkanKas(klien: PrismaClient, dari: Date, sampai: Date, opsi: OpsiLaporan) {
  const [akunKas, pemetaan, pengaturan, daftarAkun] = await Promise.all([
    klien.akun.findMany({ where: { kasBank: true, kelompok: false }, select: { id: true } }),
    klien.pemetaanAkun.findUnique({ where: { id: "default" } }),
    klien.pengaturanPerusahaan.findUnique({ where: { id: "default" }, select: { akunPph23DimukaId: true } }),
    klien.akun.findMany({ select: { id: true, kode: true, nama: true, jenis: true, kelompok: true, indukId: true } }),
  ]);
  const idKas = akunKas.map((a) => a.id);
  const daftarJurnal = await klien.jurnal.findMany({
    where: { tanggal: { gte: dari, lte: sampai }, baris: { some: { akunId: { in: idKas } } }, ...(opsi.proyekId ? { proyekId: opsi.proyekId } : {}) },
    select: {
      id: true,
      tanggal: true,
      baris: { select: { akunId: true, debit: true, kredit: true, akun: { select: { jenis: true, kode: true, kasBank: true } } } },
      penerimaanPenjualan: {
        select: {
          pelanggan: { select: { id: true, kode: true, nama: true } },
          faktur: { select: { dpp: true, ppn: true, baris: { select: { subtotal: true, barang: { select: { akunPendapatanId: true } } } } } },
        },
      },
      uangMukaPelanggan: {
        select: {
          pelanggan: { select: { id: true, kode: true, nama: true } },
          pesanan: { select: { baris: { select: { jumlah: true, harga: true, barang: { select: { akunPendapatanId: true } } } } } },
        },
      },
    },
  });
  const akunPendapatanBawaan = pemetaan?.pendapatanPenjualanId ?? null;
  const milikPelanggan = new Set([pemetaan?.piutangUsahaId, pemetaan?.uangMukaPelangganId, pengaturan?.akunPph23DimukaId].filter((x): x is string => Boolean(x)));
  const nol = D(0);
  const catatan: CatatanKas[] = [];
  for (const j of daftarJurnal) {
    const c: CatatanKas = { bulan: j.tanggal.getMonth() + 1, pendapatan: new Map(), ppn: nol, lain: new Map(), pelanggan: null, jenis: "LAINNYA", dariPelanggan: nol };
    const barisPendapatanLangsung: { akunId: string; nilai: Desimal }[] = [];
    for (const b of j.baris) {
      if (b.akun.kasBank) continue;
      if (kelasArus(b.akun) !== "OPERASI") continue;
      const masuk = D(b.kredit).minus(b.debit);
      if (masuk.isZero()) continue;
      if (b.akun.jenis === "PENDAPATAN") {
        c.dariPelanggan = c.dariPelanggan.plus(masuk);
        barisPendapatanLangsung.push({ akunId: b.akunId, nilai: masuk });
      } else if (milikPelanggan.has(b.akunId)) {
        c.dariPelanggan = c.dariPelanggan.plus(masuk);
        if (!j.penerimaanPenjualan && !j.uangMukaPelanggan) tambah(c.lain, b.akunId, masuk); // piutang/DP tanpa dokumen (mis. pengembalian DP lewat Kas Keluar)
      } else {
        tambah(c.lain, b.akunId, masuk);
      }
    }
    // Alokasi kas dari pelanggan ke akun pendapatan menurut dokumen asalnya
    const alokasi = (bobot: { akunId: string | null; nilai: Desimal }[], kas: Desimal) => {
      const perAkun = new Map<string, Desimal>();
      for (const w of bobot) tambah(perAkun, w.akunId ?? akunPendapatanBawaan ?? "", w.nilai);
      const total = jumlahkan(perAkun.values());
      if (total.lte(0) || kas.isZero()) return;
      let sisa = kas;
      const daftar = [...perAkun.entries()];
      daftar.forEach(([akunId, w], i) => {
        const bagian = i === daftar.length - 1 ? sisa : kas.mul(w).div(total).toDecimalPlaces(2);
        sisa = sisa.minus(bagian);
        tambah(c.pendapatan, akunId, bagian);
      });
    };
    if (j.penerimaanPenjualan) {
      const f = j.penerimaanPenjualan.faktur;
      const totalFaktur = D(f.dpp).plus(f.ppn);
      const bagianPpn = totalFaktur.gt(0) && D(f.ppn).gt(0) ? c.dariPelanggan.mul(f.ppn).div(totalFaktur).toDecimalPlaces(2) : nol;
      c.ppn = bagianPpn;
      alokasi(f.baris.map((b) => ({ akunId: b.barang.akunPendapatanId, nilai: D(b.subtotal) })), c.dariPelanggan.minus(bagianPpn));
      c.pelanggan = j.penerimaanPenjualan.pelanggan;
      c.jenis = "PELUNASAN";
    } else if (j.uangMukaPelanggan) {
      alokasi(j.uangMukaPelanggan.pesanan.baris.map((b) => ({ akunId: b.barang.akunPendapatanId, nilai: D(b.jumlah).mul(b.harga) })), c.dariPelanggan);
      c.pelanggan = j.uangMukaPelanggan.pelanggan;
      c.jenis = "UANG_MUKA";
    } else {
      for (const b of barisPendapatanLangsung) tambah(c.pendapatan, b.akunId, b.nilai);
      // piutang/DP tanpa dokumen sudah masuk `lain`; jangan dihitung dua kali sebagai kas dari pelanggan
      c.dariPelanggan = jumlahkan(barisPendapatanLangsung.map((b) => b.nilai));
    }
    if (c.pendapatan.size === 0 && c.lain.size === 0 && c.ppn.isZero()) continue;
    catatan.push(c);
  }
  return { catatan, daftarAkun };
}

function susunPendapatan(daftarAkun: { id: string; kode: string; nama: string; jenis: string; kelompok: boolean; indukId: string | null }[], perAkun: Map<string, Desimal>) {
  const nol = D(0);
  const dasar: AkunSaldo[] = daftarAkun.map((a) => {
    const saldo = perAkun.get(a.id) ?? nol;
    return { ...a, debit: nol, kredit: saldo, saldo };
  });
  return susunHierarki(dasar, (a) => a.jenis === "PENDAPATAN");
}

export async function labaRugiKas(klien: PrismaClient = db, periode: Periode, opsi: OpsiLaporan = {}): Promise<LabaRugiKas> {
  const { catatan, daftarAkun } = await kumpulkanKas(klien, periode.dari, periode.sampai, opsi);
  const nol = D(0);
  const perAkun = new Map<string, Desimal>();
  const lain = new Map<string, Desimal>();
  const perPelanggan = new Map<string, PendapatanKasPelanggan>();
  let ppnTitipan = nol;
  let jumlahDokumen = 0;
  for (const c of catatan) {
    for (const [k, v] of c.pendapatan) tambah(perAkun, k, v);
    for (const [k, v] of c.lain) tambah(lain, k, v);
    ppnTitipan = ppnTitipan.plus(c.ppn);
    if (c.dariPelanggan.isZero()) continue;
    const kunci = c.pelanggan?.id ?? "";
    const p = perPelanggan.get(kunci) ?? { id: c.pelanggan?.id ?? null, kode: c.pelanggan?.kode ?? "", nama: c.pelanggan?.nama ?? TANPA_PELANGGAN_KAS, uangMuka: nol, pelunasan: nol, lainnya: nol, total: nol, jumlahDokumen: 0 };
    if (c.jenis === "UANG_MUKA") p.uangMuka = p.uangMuka.plus(c.dariPelanggan);
    else if (c.jenis === "PELUNASAN") p.pelunasan = p.pelunasan.plus(c.dariPelanggan);
    else p.lainnya = p.lainnya.plus(c.dariPelanggan);
    p.total = p.total.plus(c.dariPelanggan);
    if (c.jenis !== "LAINNYA") {
      p.jumlahDokumen++;
      jumlahDokumen++;
    }
    perPelanggan.set(kunci, p);
  }
  const pendapatan = susunPendapatan(daftarAkun, perAkun);
  const akunById = new Map(daftarAkun.map((a) => [a.id, a]));
  const barisLain = [...lain.entries()]
    .filter(([, v]) => !v.isZero())
    .map(([id, jumlah]) => ({ id, kode: akunById.get(id)?.kode ?? "", nama: akunById.get(id)?.nama ?? id, jumlah }))
    .sort((a, b) => a.kode.localeCompare(b.kode));
  const penerimaanLain = barisLain.filter((b) => b.jumlah.gt(0));
  if (ppnTitipan.gt(0)) penerimaanLain.unshift({ ...PPN_TITIPAN, jumlah: ppnTitipan });
  const pengeluaran = barisLain.filter((b) => b.jumlah.lt(0)).map((b) => ({ ...b, jumlah: b.jumlah.neg() }));
  const totalPenerimaanLain = jumlahkan(penerimaanLain.map((b) => b.jumlah));
  const totalPengeluaran = jumlahkan(pengeluaran.map((b) => b.jumlah));
  const daftarPelanggan = [...perPelanggan.values()].sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : b.total.comparedTo(a.total)));
  return {
    periode,
    pendapatan: pendapatan.baris,
    totalPendapatan: pendapatan.total,
    ppnTitipan,
    penerimaanLain,
    totalPenerimaanLain,
    pengeluaran,
    totalPengeluaran,
    surplus: pendapatan.total.plus(totalPenerimaanLain).minus(totalPengeluaran),
    perPelanggan: daftarPelanggan,
    totalDariPelanggan: jumlahkan(daftarPelanggan.map((p) => p.total)),
    jumlahDokumen,
  };
}

/** Kas masuk (dari pelanggan + penerimaan lain) dan kas keluar operasi per bulan satu tahun. */
export async function labaRugiKasBulanan(klien: PrismaClient = db, tahun: number, opsi: OpsiLaporan = {}): Promise<LabaRugiKasBulanan> {
  const { catatan } = await kumpulkanKas(klien, new Date(tahun, 0, 1), new Date(tahun, 11, 31, 23, 59, 59, 999), opsi);
  const nol = D(0);
  const bulan: KasBulan[] = Array.from({ length: 12 }, (_, i) => ({ bulan: i + 1, diterima: nol, dikeluarkan: nol, surplus: nol }));
  for (const c of catatan) {
    const m = bulan[c.bulan - 1];
    let masuk = jumlahkan(c.pendapatan.values()).plus(c.ppn);
    let keluar = nol;
    for (const v of c.lain.values()) {
      if (v.gt(0)) masuk = masuk.plus(v);
      else keluar = keluar.plus(v.neg());
    }
    m.diterima = m.diterima.plus(masuk);
    m.dikeluarkan = m.dikeluarkan.plus(keluar);
  }
  for (const m of bulan) m.surplus = m.diterima.minus(m.dikeluarkan);
  return {
    tahun,
    bulan,
    total: { diterima: jumlahkan(bulan.map((m) => m.diterima)), dikeluarkan: jumlahkan(bulan.map((m) => m.dikeluarkan)), surplus: jumlahkan(bulan.map((m) => m.surplus)) },
  };
}
