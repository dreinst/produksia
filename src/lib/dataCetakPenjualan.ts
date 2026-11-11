import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import { db } from "@/lib/db";
import { D, jumlahkan, terbesar, type Desimal } from "@/lib/uang";
import { hitungPpn } from "@/lib/pengaturanPerusahaan";
import { nilaiBaris, subtotalDokumen, subtotalFaktur } from "@/lib/dokumenPenjualan";
import { brutoRencana, hitungProgresTermin } from "@/lib/rencanaTermin";
import { rentangTanggalTeks } from "@/lib/cetak/format";
import type { DokumenCetakPenjualan, JenisCetakPenjualan } from "@/lib/cetak/tipe";

/*
 * Data bisnis dokumen penjualan untuk dicetak (D2 §6.3). D2 menyusun angka dan teks; D3 (src/lib/cetak) hanya menata
 * letak. Semua uang dikirim sebagai string toFixed(2) supaya pembulatan tetap milik server. Bukan "use server": rute
 * cetak dan aksi simpan PDF memeriksa hak (HAK_CETAK_PENJUALAN) sebelum memanggil fungsi ini.
 *
 * Permintaan D3 §10.1: kwitansi dan kwitansi DP membawa baris faktur atau pesanan terkait (lampiran rincian), dan
 * dokumen berstatus DIBATALKAN diberi draf = true supaya cetakannya bertanda DRAF.
 */

export type { DokumenCetakPenjualan, JenisCetakPenjualan } from "@/lib/cetak/tipe";
export { HAK_CETAK_PENJUALAN, JENIS_CETAK_PENJUALAN, jenisCetakPenjualanSah } from "@/lib/cetak/tipe";

type Klien = PrismaClient | Prisma.TransactionClient;
type Uang = Desimal | number | string;
type BarisCetakData = DokumenCetakPenjualan["baris"][number];
type Ringkasan = DokumenCetakPenjualan["ringkasan"];

const NOL = D(0);
const s2 = (v: Uang) => D(v).toFixed(2);

type BarisSumber = {
  bagian: string | null;
  nama: string | null;
  deskripsi: string | null;
  jumlah: Uang;
  satuan: string | null;
  frekuensi: Uang;
  satuanFrekuensi: string | null;
  harga: Uang;
  subtotal?: Uang;
  keterangan: string | null;
  urutan: number;
  id: string;
  barang: { nama: string; satuan: string };
};

/** Baris cetak urut `urutan` lalu id; nama dan satuan kosong memakai data barang; nilai = subtotal tersimpan atau nilaiBaris. */
function barisCetak(baris: readonly BarisSumber[]): BarisCetakData[] {
  return [...baris]
    .sort((a, b) => a.urutan - b.urutan || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((b, i) => ({
      no: i + 1,
      bagian: b.bagian,
      nama: b.nama ?? b.barang.nama,
      deskripsi: b.deskripsi,
      jumlah: s2(b.jumlah),
      satuan: b.satuan ?? b.barang.satuan,
      frekuensi: s2(b.frekuensi),
      satuanFrekuensi: b.satuanFrekuensi,
      harga: s2(b.harga),
      subtotal: s2(b.subtotal ?? nilaiBaris({ jumlah: b.jumlah, harga: b.harga, frekuensi: b.frekuensi })),
      keterangan: b.keterangan,
    }));
}

type Kepada = { kepada: string | null; kepadaUp: string | null; kepadaAlamat: string | null; kepadaTelepon: string | null; kepadaEmail: string | null };
type PelangganCetak = { nama: string; namaKontak: string | null; alamat: string | null; telepon: string | null; email: string | null; npwp: string | null };

/** Tujuan cetak: isian dokumen, kalau kosong data induk pelanggan saat dicetak. */
function kepadaCetak(d: Partial<Kepada>, p: PelangganCetak): DokumenCetakPenjualan["kepada"] {
  return { nama: d.kepada ?? p.nama, up: d.kepadaUp ?? p.namaKontak, alamat: d.kepadaAlamat ?? p.alamat, telepon: d.kepadaTelepon ?? p.telepon, email: d.kepadaEmail ?? p.email, npwp: p.npwp };
}

type Event = { mode: "STANDAR" | "EVENT"; tampilanEvent: "RINCI" | "RINGKAS"; namaEvent: string | null; venue: string | null; tanggalEvent: string | null };
type ProyekCetak = { tanggalMulai: Date | null; tanggalSelesai: Date | null } | null;

/** Event cetak: tanggalEvent kosong = rentang tanggal proyek ("27-30 Agustus 2026"). */
function eventCetak(d: Event, proyek: ProyekCetak): DokumenCetakPenjualan["event"] {
  let tanggalEvent = d.tanggalEvent;
  if (!tanggalEvent && proyek?.tanggalMulai) tanggalEvent = rentangTanggalTeks(proyek.tanggalMulai, proyek.tanggalSelesai ?? proyek.tanggalMulai);
  return { mode: d.mode, tampilan: d.tampilanEvent, namaEvent: d.namaEvent, venue: d.venue, tanggalEvent };
}

type Surat = { perihal: string | null; lampiran: string | null; teksPembuka: string | null; teksPenutup: string | null };
const suratKosong: Surat = { perihal: null, lampiran: null, teksPembuka: null, teksPenutup: null };

/** Ringkasan penawaran atau pesanan (total tanpa PPN): PPN hanya tampilan, grand total = total + PPN. */
function ringkasanDokumen(d: { total: Uang; diskon: Uang; fee: Uang; jenisDiskon: "NOMINAL" | "PERSEN"; nilaiDiskon: Uang; jenisFee: "NOMINAL" | "PERSEN"; nilaiFee: Uang; ppnPersen: Uang }, addOn: Ringkasan["addOn"]): Ringkasan {
  const ppn = hitungPpn(D(d.total), D(d.ppnPersen));
  const total = D(d.total).plus(ppn);
  return {
    subtotal: s2(subtotalDokumen({ total: d.total, diskon: d.diskon, fee: d.fee })),
    jenisDiskon: d.jenisDiskon,
    nilaiDiskon: s2(d.nilaiDiskon),
    diskon: s2(d.diskon),
    jenisFee: d.jenisFee,
    nilaiFee: s2(d.nilaiFee),
    fee: s2(d.fee),
    dpp: s2(d.total),
    ppnPersen: s2(d.ppnPersen),
    ppn: s2(ppn),
    total: s2(total),
    uangMuka: s2(NOL),
    terbayar: s2(NOL),
    retur: s2(NOL),
    sisa: s2(total),
    addOn,
  };
}

/** Ringkasan faktur: terbayar = uang muka + Σ(penerimaan + potongan pajak); sisa = total - terbayar - retur (rumus sisa lama). */
function ringkasanFaktur(f: {
  dpp: Uang; diskon: Uang; fee: Uang; jenisDiskon: "NOMINAL" | "PERSEN"; nilaiDiskon: Uang; jenisFee: "NOMINAL" | "PERSEN"; nilaiFee: Uang; ppnPersen: Uang; ppn: Uang; total: Uang; uangMuka: Uang;
  penerimaan: readonly { jumlah: Uang; potonganPajak: Uang }[];
  retur: readonly { total: Uang }[];
}): Ringkasan {
  const terbayar = D(f.uangMuka).plus(jumlahkan(f.penerimaan.map((p) => D(p.jumlah).plus(D(p.potonganPajak)))));
  const retur = jumlahkan(f.retur.map((r) => r.total));
  return {
    subtotal: s2(subtotalFaktur({ dpp: f.dpp, diskon: f.diskon, fee: f.fee })),
    jenisDiskon: f.jenisDiskon,
    nilaiDiskon: s2(f.nilaiDiskon),
    diskon: s2(f.diskon),
    jenisFee: f.jenisFee,
    nilaiFee: s2(f.nilaiFee),
    fee: s2(f.fee),
    dpp: s2(f.dpp),
    ppnPersen: s2(f.ppnPersen),
    ppn: s2(f.ppn),
    total: s2(f.total),
    uangMuka: s2(f.uangMuka),
    terbayar: s2(terbayar),
    retur: s2(retur),
    sisa: s2(D(f.total).minus(terbayar).minus(retur)),
    addOn: null,
  };
}

const PELANGGAN = { select: { nama: true, namaKontak: true, alamat: true, telepon: true, email: true, npwp: true } } as const;
const PROYEK = { select: { tanggalMulai: true, tanggalSelesai: true } } as const;
const BARIS = { include: { barang: { select: { nama: true, satuan: true } } } } as const;
const TERMIN = { select: { id: true, no: true, label: true, jumlah: true, persen: true, jatuhTempo: true, ditagihPada: true, nomorCetak: true } } as const;

/** Butir termin cetak dengan nilai termasuk PPN dari brutoRencana (butir terakhir menutup sisa PPN, KONTRAK-TAMBAHAN P25). */
function terminRencana(butir: readonly { no: number; label: string; jumlah: Uang; persen: Uang; jatuhTempo: Date | null }[], ppnPersen: Uang, status: string): DokumenCetakPenjualan["termin"] {
  return brutoRencana(butir, ppnPersen).map(({ butir: b, bruto }) => ({ no: b.no, label: b.label, persen: s2(b.persen), jumlah: s2(b.jumlah), jumlahBruto: s2(bruto), jatuhTempo: b.jatuhTempo, status }));
}

/** Rujukan dokumen asal penawaran: nomor cetak, kalau kosong nomor internal. */
const nomorTampil = (d: { nomorCetak?: string | null; nomor: string }) => d.nomorCetak ?? d.nomor;

/**
 * Data cetak satu dokumen penjualan; null bila dokumen tidak ada (atau, untuk tagihan termin, butir bukan milik pesanan).
 * `jenis` memakai kosakata cetak: kwitansi = PenerimaanPenjualan, kwitansi-dp = UangMukaPelanggan, tagihan-termin =
 * RencanaTermin pesanan.
 */
export async function dataCetakPenjualan(jenis: JenisCetakPenjualan, id: string, klien: Klien = db): Promise<DokumenCetakPenjualan | null> {
  switch (jenis) {
    case "penawaran":
      return cetakPenawaran(klien, id);
    case "faktur":
      return cetakFaktur(klien, id);
    case "kwitansi":
      return cetakKwitansi(klien, id);
    case "kwitansi-dp":
      return cetakKwitansiDp(klien, id);
    case "tagihan-termin":
      return cetakTagihanTermin(klien, id);
    default:
      return null;
  }
}

async function cetakPenawaran(klien: Klien, id: string): Promise<DokumenCetakPenjualan | null> {
  const p = await klien.penawaranPenjualan.findUnique({
    where: { id },
    include: { pelanggan: PELANGGAN, proyek: PROYEK, baris: BARIS, rencanaTermin: TERMIN },
  });
  if (!p) return null;
  return {
    jenis: "penawaran",
    id: p.id,
    perusahaanId: p.perusahaanId,
    kopSuratId: p.kopSuratId,
    nomorTampil: nomorTampil(p),
    nomorInternal: p.nomor,
    draf: p.status === "DIBATALKAN",
    judul: p.judulCetak,
    tanggal: p.tanggal,
    tanggalKedua: p.berlakuSampai ? { label: "Berlaku sampai", tanggal: p.berlakuSampai } : null,
    referensi: p.referensi,
    kepada: kepadaCetak(p, p.pelanggan),
    surat: { perihal: p.perihal, lampiran: p.lampiran, teksPembuka: p.teksPembuka, teksPenutup: p.teksPenutup },
    event: eventCetak(p, p.proyek),
    baris: barisCetak(p.baris),
    ringkasan: ringkasanDokumen(p, p.nilaiAddOn !== null ? { nilai: s2(p.nilaiAddOn), keterangan: p.keteranganAddOn } : null),
    uangMukaDipakai: [],
    termin: terminRencana(p.rencanaTermin, p.ppnPersen, "Belum ditagih"),
    konteksTermin: null,
    kwitansi: null,
    catatan: p.catatan,
    catatanKanan: p.catatanKanan,
    syaratPembayaran: p.syaratPembayaran,
    infoBank: p.infoBank,
  };
}

const INCLUDE_FAKTUR = {
  pelanggan: PELANGGAN,
  baris: BARIS,
  penerimaan: { select: { jumlah: true, potonganPajak: true } },
  retur: { select: { total: true } },
  pemakaianUangMuka: { orderBy: { id: "asc" }, include: { uangMuka: { select: { nomor: true, nomorCetak: true, tanggal: true, rencanaTermin: { select: { label: true } } } } } },
  pesanan: { select: { nomor: true, proyek: PROYEK, penawaran: { select: { nomor: true, nomorCetak: true } } } },
} as const;

async function bacaFaktur(klien: Klien, id: string) {
  return klien.fakturPenjualan.findUnique({ where: { id }, include: INCLUDE_FAKTUR });
}
type FakturCetak = NonNullable<Awaited<ReturnType<typeof bacaFaktur>>>;

/** Rujukan dokumen asal faktur: nomor tampil penawaran asal pesanan, kalau tidak ada nomor pesanan. */
const asalFaktur = (f: FakturCetak) => (f.pesanan?.penawaran ? nomorTampil(f.pesanan.penawaran) : (f.pesanan?.nomor ?? null));

async function cetakFaktur(klien: Klien, id: string): Promise<DokumenCetakPenjualan | null> {
  const f = await bacaFaktur(klien, id);
  if (!f) return null;
  return {
    jenis: "faktur",
    id: f.id,
    perusahaanId: f.perusahaanId,
    kopSuratId: f.kopSuratId,
    nomorTampil: nomorTampil(f),
    nomorInternal: f.nomor,
    // faktur belum disetujui (draf, menunggu, ditolak) atau dibatalkan dicetak bertanda DRAF
    draf: f.statusPersetujuan !== "DISETUJUI" || f.status === "DIBATALKAN",
    judul: f.judulCetak,
    tanggal: f.tanggal,
    tanggalKedua: f.jatuhTempo ? { label: "Jatuh tempo", tanggal: f.jatuhTempo } : null,
    referensi: f.referensi ?? asalFaktur(f),
    kepada: kepadaCetak(f, f.pelanggan),
    surat: { perihal: f.perihal, lampiran: f.lampiran, teksPembuka: f.teksPembuka, teksPenutup: f.teksPenutup },
    event: eventCetak(f, f.pesanan?.proyek ?? null),
    baris: barisCetak(f.baris),
    ringkasan: ringkasanFaktur(f),
    uangMukaDipakai: [...f.pemakaianUangMuka]
      .sort((a, b) => a.uangMuka.tanggal.getTime() - b.uangMuka.tanggal.getTime() || (a.id < b.id ? -1 : 1))
      .map((p) => ({ nomor: nomorTampil(p.uangMuka), labelTermin: p.uangMuka.rencanaTermin?.label ?? null, jumlah: s2(p.jumlah) })),
    termin: [],
    konteksTermin: null,
    kwitansi: null,
    catatan: f.catatan,
    catatanKanan: f.catatanKanan,
    syaratPembayaran: f.syaratPembayaran,
    infoBank: f.infoBank,
  };
}

async function cetakKwitansi(klien: Klien, id: string): Promise<DokumenCetakPenjualan | null> {
  const t = await klien.penerimaanPenjualan.findUnique({ where: { id }, include: { pelanggan: PELANGGAN } });
  if (!t) return null;
  const f = await bacaFaktur(klien, t.fakturId);
  if (!f) return null;
  const nomorFaktur = nomorTampil(f);
  return {
    jenis: "kwitansi",
    id: t.id,
    perusahaanId: t.perusahaanId,
    kopSuratId: t.kopSuratId,
    nomorTampil: nomorTampil(t),
    nomorInternal: t.nomor,
    draf: t.statusPersetujuan !== "DISETUJUI",
    judul: t.judulCetak,
    tanggal: t.tanggal,
    tanggalKedua: null,
    referensi: nomorFaktur,
    kepada: kepadaCetak(f, t.pelanggan),
    surat: suratKosong,
    event: eventCetak(f, f.pesanan?.proyek ?? null),
    // lampiran rincian (D3 §10.1): baris faktur yang dilunasi
    baris: barisCetak(f.baris),
    ringkasan: ringkasanFaktur(f),
    uangMukaDipakai: [],
    termin: [],
    konteksTermin: null,
    kwitansi: {
      terimaDari: t.terimaDari ?? t.pelanggan.nama,
      // nilai piutang yang dilunasi; potongan PPh 23 dicetak sebagai catatan
      jumlah: s2(D(t.jumlah).plus(D(t.potonganPajak))),
      potonganPajak: s2(t.potonganPajak),
      keperluan: t.keperluan ?? `Pembayaran ${nomorFaktur}`,
      metodeBayar: t.metodeBayar,
      untukDokumen: nomorFaktur,
    },
    catatan: t.catatan,
    catatanKanan: null,
    syaratPembayaran: null,
    infoBank: f.infoBank,
  };
}

const INCLUDE_PESANAN = {
  pelanggan: PELANGGAN,
  proyek: PROYEK,
  baris: BARIS,
  rencanaTermin: TERMIN,
  uangMuka: { select: { jumlah: true, rencanaTerminId: true } },
  faktur: { select: { penerimaan: { select: { jumlah: true, potonganPajak: true } } } },
  penawaran: { select: { nomor: true, nomorCetak: true } },
} as const;

async function bacaPesanan(klien: Klien, id: string) {
  return klien.pesananPenjualan.findUnique({ where: { id }, include: INCLUDE_PESANAN });
}
type PesananCetak = NonNullable<Awaited<ReturnType<typeof bacaPesanan>>>;

function progresPesanan(p: PesananCetak) {
  return hitungProgresTermin({ total: p.total, ppnPersen: p.ppnPersen, butir: p.rencanaTermin, uangMuka: p.uangMuka, penerimaan: p.faktur.flatMap((f) => f.penerimaan) });
}

function terminProgres(p: PesananCetak): DokumenCetakPenjualan["termin"] {
  return progresPesanan(p).butir.map((b) => ({ no: b.no, label: b.label, persen: s2(b.persen), jumlah: s2(b.jumlah), jumlahBruto: s2(b.bruto), jatuhTempo: b.jatuhTempo, status: b.status }));
}

async function cetakKwitansiDp(klien: Klien, id: string): Promise<DokumenCetakPenjualan | null> {
  const u = await klien.uangMukaPelanggan.findUnique({ where: { id }, include: { pelanggan: PELANGGAN, rencanaTermin: { select: { label: true } } } });
  if (!u) return null;
  const p = await bacaPesanan(klien, u.pesananId);
  if (!p) return null;
  const asal = p.penawaran ? nomorTampil(p.penawaran) : p.nomor;
  // keperluan kosong: "Pembayaran {label termin} {nama event}" bila bertermin, kalau tidak keterangan uang muka
  const keperluan = u.keperluan ?? (u.rencanaTermin ? `Pembayaran ${u.rencanaTermin.label}${p.namaEvent ? ` ${p.namaEvent}` : ""}` : (u.keterangan ?? `Uang muka ${asal}`));
  return {
    jenis: "kwitansi-dp",
    id: u.id,
    perusahaanId: u.perusahaanId,
    kopSuratId: u.kopSuratId,
    nomorTampil: nomorTampil(u),
    nomorInternal: u.nomor,
    draf: u.statusPersetujuan !== "DISETUJUI",
    judul: u.judulCetak,
    tanggal: u.tanggal,
    tanggalKedua: null,
    referensi: p.referensi ?? asal,
    kepada: kepadaCetak(p, u.pelanggan),
    surat: suratKosong,
    event: eventCetak(p, p.proyek),
    // lampiran rincian (D3 §10.1): baris pesanan yang dibayar di muka
    baris: barisCetak(p.baris),
    ringkasan: ringkasanDokumen(p, null),
    uangMukaDipakai: [],
    termin: terminProgres(p),
    konteksTermin: null,
    kwitansi: { terimaDari: u.terimaDari ?? u.pelanggan.nama, jumlah: s2(u.jumlah), potonganPajak: s2(NOL), keperluan, metodeBayar: u.metodeBayar, untukDokumen: asal },
    catatan: null,
    catatanKanan: null,
    syaratPembayaran: null,
    infoBank: p.infoBank,
  };
}

async function cetakTagihanTermin(klien: Klien, id: string): Promise<DokumenCetakPenjualan | null> {
  const t = await klien.rencanaTermin.findUnique({ where: { id }, select: { id: true, pesananId: true } });
  if (!t?.pesananId) return null;
  const p = await bacaPesanan(klien, t.pesananId);
  if (!p) return null;
  const progres = progresPesanan(p);
  const b = progres.butir.find((x) => x.id === id);
  const butir = p.rencanaTermin.find((x) => x.id === id);
  if (!b || !butir) return null;
  // Σ uang muka butir bernomor lebih kecil + uang muka tanpa termin; sisa = kontrak bruto - Σ bruto butir no <= n
  const dibayarSebelumnya = jumlahkan(progres.butir.filter((x) => x.no < b.no).map((x) => x.dibayar)).plus(progres.dpTanpaTermin);
  const sisaSetelahTermin = progres.nilaiKontrakBruto.minus(jumlahkan(progres.butir.filter((x) => x.no <= b.no).map((x) => x.bruto)));
  const asal = p.penawaran ? nomorTampil(p.penawaran) : p.nomor;
  const nomorInternal = `${p.nomor}/T${b.no}`;
  return {
    jenis: "tagihan-termin",
    id: b.id,
    perusahaanId: p.perusahaanId,
    kopSuratId: p.kopSuratId,
    nomorTampil: butir.nomorCetak ?? nomorInternal,
    nomorInternal,
    // tagihan yang belum diterbitkan dicetak bertanda DRAF
    draf: !butir.ditagihPada || p.status === "DIBATALKAN",
    judul: null,
    tanggal: butir.ditagihPada ?? new Date(),
    tanggalKedua: butir.jatuhTempo ? { label: "Jatuh tempo", tanggal: butir.jatuhTempo } : null,
    referensi: p.referensi ?? asal,
    kepada: kepadaCetak(p, p.pelanggan),
    surat: { perihal: p.perihal, lampiran: p.lampiran, teksPembuka: p.teksPembuka, teksPenutup: p.teksPenutup },
    event: eventCetak(p, p.proyek),
    // kosong: D3 membangun satu baris dari konteksTermin
    baris: [],
    ringkasan: {
      subtotal: s2(b.jumlah),
      jenisDiskon: "NOMINAL",
      nilaiDiskon: s2(NOL),
      diskon: s2(NOL),
      jenisFee: "NOMINAL",
      nilaiFee: s2(NOL),
      fee: s2(NOL),
      dpp: s2(b.jumlah),
      ppnPersen: s2(p.ppnPersen),
      ppn: s2(b.bruto.minus(b.jumlah)),
      total: s2(b.bruto),
      uangMuka: s2(NOL),
      terbayar: s2(b.dibayar),
      retur: s2(NOL),
      sisa: s2(terbesar(b.bruto.minus(b.dibayar), NOL)),
      addOn: null,
    },
    uangMukaDipakai: [],
    termin: terminProgres(p),
    konteksTermin: {
      no: b.no,
      jumlahButir: progres.butir.length,
      label: b.label,
      persen: s2(b.persen),
      jumlah: s2(b.jumlah),
      jumlahBruto: s2(b.bruto),
      nilaiKontrakBruto: s2(progres.nilaiKontrakBruto),
      dibayarSebelumnya: s2(dibayarSebelumnya),
      sisaSetelahTermin: s2(terbesar(sisaSetelahTermin, NOL)),
      nomorPesanan: p.nomor,
    },
    kwitansi: null,
    catatan: p.catatan,
    catatanKanan: p.catatanKanan,
    syaratPembayaran: p.syaratPembayaran,
    infoBank: p.infoBank,
  };
}
