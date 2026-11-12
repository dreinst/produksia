import { Prisma } from "@/prisma-klien/client";
import { D, terbesar, terkecil, uang, type Desimal } from "@/lib/uang";

/*
 * Algoritma bagi hasil proyek (D5 §3.12, §3.13), persis HKA (_split, _sharing, _payout_status di routes_finance.py).
 * Murni: tanpa basis data. Pemuatnya (mitra, talangan, pembayaran) ada di src/lib/keuanganProyek.ts.
 *
 * Urutan pembagian: modal setiap pemodal kembali lebih dulu (pro rata bila uang diterima belum menutup biaya aktual),
 * lalu bagian nominal tetap sesuai urutan mitra (dibatasi sisa), lalu persen dari sisa setelah nominal tetap (tidak
 * berantai); sisanya bagian perusahaan. Rugi tidak dibagi. Modal perusahaan = biaya aktual dikurangi talangan mitra.
 */

export type ModeMitra = "PERSEN" | "NOMINAL";

/** Mitra sudah urut (urutan, dibuatPada, id). */
export type MitraBagi = { id: string; nama: string; mode: ModeMitra; nilai: Desimal };

export type StatusBayarMitra = "LEBIH_BAYAR" | "LUNAS" | "DIBAYAR_SEBAGIAN" | "PERLU_DIBAYAR" | "BELUM_ADA_HAK";

export const LABEL_STATUS_BAYAR_MITRA: Record<StatusBayarMitra, string> = {
  LEBIH_BAYAR: "Lebih bayar",
  LUNAS: "Lunas",
  DIBAYAR_SEBAGIAN: "Sebagian dibayar",
  PERLU_DIBAYAR: "Perlu dibayar",
  BELUM_ADA_HAK: "Belum ada hak",
};

const NOL = D(0);
const SERATUS = D(100);
const TOLERANSI = D("0.5");

const jumlah = (xs: Iterable<Desimal>) => {
  let a = NOL;
  for (const x of xs) a = a.plus(x);
  return a;
};

/** Pembagian satu basis margin (padanan _split). Basis negatif dianggap 0: rugi tidak dibagi. */
export function bagiMargin(mitra: readonly MitraBagi[], basis: Desimal): { bagian: Map<string, Desimal>; perusahaan: Desimal; setelahTetap: Desimal } {
  const bagian = new Map<string, Desimal>();
  let sisa = terbesar(uang(basis), NOL);
  for (const m of mitra) {
    if (m.mode !== "NOMINAL") continue;
    const b = terkecil(uang(m.nilai), sisa);
    bagian.set(m.id, b);
    sisa = uang(sisa.minus(b));
  }
  const setelahTetap = sisa;
  for (const m of mitra) {
    if (m.mode !== "PERSEN") continue;
    const b = uang(setelahTetap.mul(m.nilai).div(SERATUS));
    bagian.set(m.id, b);
    sisa = uang(sisa.minus(b));
  }
  return { bagian, perusahaan: terbesar(sisa, NOL), setelahTetap };
}

/** Status pembayaran mitra (padanan _payout_status), toleransi 0,5 rupiah, dicek berurutan. */
export function statusBayarMitra(hak: Desimal, dibayar: Desimal): StatusBayarMitra {
  if (dibayar.gt(hak.plus(TOLERANSI))) return "LEBIH_BAYAR";
  if (hak.gt(0) && dibayar.gte(hak.minus(TOLERANSI))) return "LUNAS";
  if (dibayar.gt(0)) return "DIBAYAR_SEBAGIAN";
  if (hak.gt(0)) return "PERLU_DIBAYAR";
  return "BELUM_ADA_HAK";
}

export type BarisMitraBagiHasil = MitraBagi & {
  /** bagian dari margin rencana */
  estimasi: Desimal;
  /** bagian dari margin kas */
  realisasi: Desimal;
  /** talangan DISETUJUI mitra ini */
  modalMasuk: Desimal;
  modalKembali: Desimal;
  totalHak: Desimal;
  dibayarModal: Desimal;
  dibayarLaba: Desimal;
  dibayar: Desimal;
  /** negatif = lebih bayar */
  terutang: Desimal;
  modalTerutang: Desimal;
  labaTerutang: Desimal;
  status: StatusBayarMitra;
};

export type HasilBagiHasil = {
  basisEstimasi: Desimal;
  basisRealisasi: Desimal;
  /** diterima / aktual dibatasi 0..1, presisi penuh (tidak dibulatkan) */
  rasio: Desimal;
  setelahTetapEstimasi: Desimal;
  setelahTetapRealisasi: Desimal;
  mitra: BarisMitraBagiHasil[];
  perusahaan: { estimasi: Desimal; realisasi: Desimal; modalMasuk: Desimal; modalKembali: Desimal; total: Desimal };
  penyelesaian: {
    diterima: Desimal;
    biayaAktual: Desimal;
    danaPerusahaan: Desimal;
    danaMitra: Desimal;
    marginDibagi: Desimal;
    persenModalKembali: Desimal;
    modalBelumKembali: Desimal;
    modalKembaliMitra: Desimal;
    labaMitra: Desimal;
    totalHakMitra: Desimal;
    totalPerusahaan: Desimal;
    totalTerdistribusi: Desimal;
  };
  persenTotal: Desimal;
  nominalTotal: Desimal;
  dibayarTotal: Desimal;
  terutangTotal: Desimal;
  peringatan: string[];
};

/** Persen satu desimal untuk teks (format id-ID tanpa nol desimal: "25", "28,6"). */
function teksPersen(rasio: Desimal): string {
  return rasio.mul(SERATUS).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP).toNumber().toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

export const PERINGATAN_BELUM_ADA_MARGIN = "Belum ada margin kas (uang diterima dikurangi biaya aktual), jadi belum ada laba yang bisa dibagikan.";
export const PERINGATAN_NOMINAL_MELEBIHI = "Total bagian nominal tetap melebihi margin kas. Mitra di urutan bawah menerima lebih sedikit sampai ada uang masuk lagi.";
export const PERINGATAN_AKTUAL_KURANG_DARI_TALANGAN = "Biaya aktual lebih kecil dari total talangan mitra; periksa jurnal koreksi bertanda proyek ini";
export const peringatanModalProporsional = (persenTeks: string) =>
  `Uang yang diterima belum menutup biaya aktual, jadi modal dikembalikan proporsional (${persenTeks}%) dan belum ada laba yang dibagikan.`;
export const peringatanModalLebihKembali = (nama: string) => `Pengembalian modal ke ${nama} melebihi talangannya; periksa dokumen mitra proyek ini`;

/**
 * Bagi hasil satu proyek (padanan _sharing). `angka` dari ringkasan keuangan (D5 §3.7), `modalMasuk` = Σ talangan
 * DISETUJUI per mitra, `dibayar` = Σ pembayaran DISETUJUI per mitra per jenis. Mitra tanpa entri di peta bernilai 0.
 */
export function hitungBagiHasil(
  angka: { marginRencana: Desimal; marginKas: Desimal; diterima: Desimal; aktual: Desimal },
  mitra: readonly MitraBagi[],
  modalMasuk: ReadonlyMap<string, Desimal>,
  dibayar: ReadonlyMap<string, { modal: Desimal; laba: Desimal }>,
): HasilBagiHasil {
  const estimasi = bagiMargin(mitra, angka.marginRencana);
  const realisasi = bagiMargin(mitra, angka.marginKas);
  const aktual = angka.aktual;
  const diterima = angka.diterima;
  const rasio = aktual.lte(0) ? D(1) : terkecil(terbesar(diterima.div(aktual), NOL), D(1));
  const modalMitraTotal = uang(jumlah(mitra.map((m) => modalMasuk.get(m.id) ?? NOL)));
  const modalPerusahaan = terbesar(uang(aktual.minus(modalMitraTotal)), NOL);

  const baris: BarisMitraBagiHasil[] = mitra.map((m) => {
    const masuk = uang(modalMasuk.get(m.id) ?? NOL);
    const bayar = dibayar.get(m.id) ?? { modal: NOL, laba: NOL };
    const dibayarModal = uang(bayar.modal);
    const dibayarLaba = uang(bayar.laba);
    const bagianRealisasi = realisasi.bagian.get(m.id) ?? NOL;
    const modalKembali = uang(masuk.mul(rasio));
    const totalHak = uang(modalKembali.plus(bagianRealisasi));
    const total = uang(dibayarModal.plus(dibayarLaba));
    return {
      ...m,
      estimasi: estimasi.bagian.get(m.id) ?? NOL,
      realisasi: bagianRealisasi,
      modalMasuk: masuk,
      modalKembali,
      totalHak,
      dibayarModal,
      dibayarLaba,
      dibayar: total,
      terutang: uang(totalHak.minus(dibayarModal).minus(dibayarLaba)),
      modalTerutang: terbesar(uang(modalKembali.minus(dibayarModal)), NOL),
      labaTerutang: terbesar(uang(bagianRealisasi.minus(dibayarLaba)), NOL),
      status: statusBayarMitra(totalHak, total),
    };
  });

  const modalKembaliPerusahaan = uang(modalPerusahaan.mul(rasio));
  const perusahaan = {
    estimasi: estimasi.perusahaan,
    realisasi: realisasi.perusahaan,
    modalMasuk: modalPerusahaan,
    modalKembali: modalKembaliPerusahaan,
    total: uang(modalKembaliPerusahaan.plus(realisasi.perusahaan)),
  };
  const persenTotal = uang(jumlah(mitra.filter((m) => m.mode === "PERSEN").map((m) => m.nilai)));
  const nominalTotal = uang(jumlah(mitra.filter((m) => m.mode === "NOMINAL").map((m) => m.nilai)));
  const totalHakMitra = uang(jumlah(baris.map((b) => b.totalHak)));

  const peringatan: string[] = [];
  const belumAdaMargin = mitra.length > 0 && angka.marginKas.lte(0);
  if (belumAdaMargin) peringatan.push(PERINGATAN_BELUM_ADA_MARGIN);
  else if (nominalTotal.gt(terbesar(angka.marginKas, NOL))) peringatan.push(PERINGATAN_NOMINAL_MELEBIHI);
  if (modalMitraTotal.gt(0) && diterima.lt(aktual)) peringatan.push(peringatanModalProporsional(teksPersen(rasio)));
  if (aktual.lt(modalMitraTotal)) peringatan.push(PERINGATAN_AKTUAL_KURANG_DARI_TALANGAN);
  for (const b of baris) if (b.dibayarModal.gt(b.modalMasuk)) peringatan.push(peringatanModalLebihKembali(b.nama));

  return {
    basisEstimasi: uang(angka.marginRencana),
    basisRealisasi: uang(angka.marginKas),
    rasio,
    setelahTetapEstimasi: estimasi.setelahTetap,
    setelahTetapRealisasi: realisasi.setelahTetap,
    mitra: baris,
    perusahaan,
    penyelesaian: {
      diterima,
      biayaAktual: aktual,
      danaPerusahaan: modalPerusahaan,
      danaMitra: modalMitraTotal,
      marginDibagi: terbesar(angka.marginKas, NOL),
      persenModalKembali: rasio.mul(SERATUS).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP),
      modalBelumKembali: aktual.gt(0) ? uang(aktual.minus(terkecil(terbesar(diterima, NOL), aktual))) : NOL,
      modalKembaliMitra: uang(jumlah(baris.map((b) => b.modalKembali))),
      labaMitra: uang(jumlah(baris.map((b) => b.realisasi))),
      totalHakMitra,
      totalPerusahaan: perusahaan.total,
      totalTerdistribusi: uang(totalHakMitra.plus(perusahaan.total)),
    },
    persenTotal,
    nominalTotal,
    dibayarTotal: uang(jumlah(baris.map((b) => b.dibayar))),
    terutangTotal: uang(jumlah(baris.map((b) => terbesar(b.terutang, NOL)))),
    peringatan,
  };
}
