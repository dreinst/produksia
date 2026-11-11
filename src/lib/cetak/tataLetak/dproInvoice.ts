import { KERTAS, type KanvasCetak } from "@/lib/cetak/mesin/kanvas";
import { gambarTabel, type BarisTabel, type SelTabel } from "@/lib/cetak/mesin/tabel";
import { formatTanggalPanjang } from "@/lib/cetak/format";
import { terbilangRupiah } from "@/lib/cetak/terbilang";
import type { Desimal } from "@/lib/uang";
import {
  PUTIH,
  alirBerbutir,
  angka,
  barisDicetak,
  berbutir,
  bukanNol,
  buatKanvas,
  gambarSlot,
  hurufJudul,
  isiUraian,
  jarak,
  judulSama,
  persen,
  ruangUtuh,
  syaratDicetak,
  tandaTanganDipakai,
  teksUangMukaDipotong,
  tinggiGambarSlot,
  type MasukanTataLetak,
} from "@/lib/cetak/tataLetak/blok";

/*
 * Invoice bertabel D'Pro A4, A5, dan A5 landscape (D3 §3.6, spec/10 §5.1), setia dengan build_invoice di
 * dpro-docgen/dpro_docs.py. Koordinat dalam piksel frame Figma lebar 2480; A5 potret = desain A4 dikali skala
 * 1748/2480 (k.skala). Jarak "pt" yang di generator ditulis langsung dalam pt (mis. after=2) tidak diskalakan, sama
 * dengan generator. Baris Discount, PPN, Uang Muka, Pembayaran Diterima, Retur, dan Sisa Tagihan hanya muncul bila
 * nilainya bukan nol, jadi data contoh menghasilkan tiga baris ringkasan Figma.
 */

export const DPRO_INVOICE = {
  A4: {
    margin: { atas: 440, bawah: 300, sisi: 261 },
    watermark: { x: 471, y: 1196, w: 1538, h: 1300 },
    jarak: 62,
    jarakSebelumBawah: 230,
    kepalaTabel: 102,
    baris: 77,
    padBaris: 8,
    hurufTabel: 37,
    hurufGrandTotal: 64,
    ruangTtd: 400,
    sesudahLabelBayar: 30,
    antarRekening: 3,
    judulTerpisah: true,
  },
  A5_LANDSCAPE: {
    margin: { atas: 405, bawah: 255, sisi: 261 },
    watermark: { x: 731, y: 538, w: 1017, h: 860 },
    jarak: 20,
    jarakSebelumBawah: 20,
    kepalaTabel: 64,
    baris: 50,
    padBaris: 4,
    hurufTabel: 34,
    hurufGrandTotal: 54,
    ruangTtd: 110,
    sesudahLabelBayar: 12,
    antarRekening: 2,
    judulTerpisah: false,
  },
  kop: { h: 415 },
  kaki: { h: 242 },
  kolomTabel: [170, 1334, 454],
  padSisi: 25,
  kolomAtas: [1100, 858],
  kolomAtasLS: [900, 358, 700],
  judulLebar: 327,
  labelBayarLebar: 442,
  labelSalamLebar: 310,
  padKananTtd: 85,
  padKiriBayar: 25,
} as const;

/** Tinggi gambar tanda tangan: 26,46 mm × skala (A4/A5) atau 14,11 mm (A5 landscape), rasio dijaga. */
const TINGGI_TTD_MM = { biasa: 26.46, lanskap: 14.11 };

/** Dekorasi D'Pro per halaman: watermark di belakang, kop dan kaki di depan (selebar kertas, menempel tepi). */
export function lapisanDpro(m: MasukanTataLetak, watermark: { x: number; y: number; w: number; h: number }) {
  return {
    belakang: (k: KanvasCetak) => {
      gambarSlot(k, m, "WATERMARK", { x: k.px(watermark.x), y: k.px(watermark.y), w: k.px(watermark.w), h: k.px(watermark.h) });
    },
    depan: (k: KanvasCetak) => {
      gambarSlot(k, m, "KOP", { x: 0, y: 0, w: k.lebarKertas, h: k.px(DPRO_INVOICE.kop.h) });
      gambarSlot(k, m, "KAKI", { x: 0, y: k.tinggiKertas - k.px(DPRO_INVOICE.kaki.h), w: k.lebarKertas, h: k.px(DPRO_INVOICE.kaki.h) });
    },
  };
}

/**
 * Judul invoice di (x, y) selebar `lebar`, tanpa menggerakkan kursor: gambar JUDUL_INVOICE (lebar 327 px, tengah)
 * bila judulnya INVOICE dan gambarnya ada; selain itu teks Carlito Bold warnaUtama 18 pt × skala, jarak huruf 1 pt.
 */
function judulInvoice(k: KanvasCetak, m: MasukanTataLetak, x: number, y: number, lebar: number, ukurSaja = false): number {
  const w = k.px(DPRO_INVOICE.judulLebar);
  if (judulSama(m.judul, "INVOICE") && m.tema.aset.JUDUL_INVOICE) {
    if (ukurSaja) return tinggiGambarSlot(m, "JUDUL_INVOICE", w) ?? 0;
    return gambarSlot(k, m, "JUDUL_INVOICE", { x: x + (lebar - w) / 2, y, w })?.h ?? 0;
  }
  const opsi = { x, y, lebar, ukuran: 18 * k.skala, font: "B" as const, warna: m.tema.warnaUtama, rata: "tengah" as const, jarakHuruf: 1 };
  return ukurSaja ? k.ukur(m.judul, opsi).tinggi : k.teks(m.judul, opsi);
}

/** Label nomor: "Invoice No." bila judulnya INVOICE, selain itu "No. {judul huruf judul}" (D3 §3.6 butir 2). */
export const labelNomorInvoice = (judul: string) => (judulSama(judul, "INVOICE") ? "Invoice No." : `No. ${hurufJudul(judul.trim())}`);

export async function renderDproInvoice(m: MasukanTataLetak): Promise<Uint8Array> {
  const LS = m.ukuran === "A5_LANDSCAPE";
  const p = LS ? DPRO_INVOICE.A5_LANDSCAPE : DPRO_INVOICE.A4;
  const k = buatKanvas(m, m.dok.jenis === "tagihan-termin" ? "Tagihan Termin" : "Invoice");
  const px = (v: number) => k.px(v);
  const pt = (v: number) => k.ukuranHuruf(v);
  const { warnaUtama: utama, warnaTinta: tinta, warnaAksen: aksen, warnaSekunder: sekunder, warnaLembut: lembut } = m.tema;
  const { dok, identitas } = m;
  const r = dok.ringkasan;

  k.aturArea({ atas: px(p.margin.atas), bawah: px(p.margin.bawah), kiri: px(p.margin.sisi), kanan: px(p.margin.sisi) });
  k.halamanBaru(KERTAS[m.ukuran], lapisanDpro(m, p.watermark));
  const x0 = k.areaIsi.kiri;
  const lebar = k.areaIsi.lebar;

  // 1. Judul terpisah (A4/A5), jarak bawah 62 px
  if (p.judulTerpisah) {
    k.y += judulInvoice(k, m, x0, k.y, lebar);
    jarak(k, pt(p.jarak));
  }

  // 2. ISSUED TO | (judul A5L) | nomor dan tanggal
  {
    const kolom = (LS ? DPRO_INVOICE.kolomAtasLS : DPRO_INVOICE.kolomAtas).map(px);
    const y = k.y;
    const hLabel = k.teks("ISSUED TO:", { x: x0, y, lebar: kolom[0], ukuran: pt(37), font: "B", warna: utama });
    const hKiri = hLabel + 2 + k.teks(dok.kepada.nama, { x: x0, y: y + hLabel + 2, lebar: kolom[0], ukuran: pt(45), font: "B", warna: tinta });
    const xKanan = x0 + kolom.slice(0, -1).reduce((a, b) => a + b, 0);
    const lebarKanan = kolom[kolom.length - 1];
    const hNomor = k.teks(`${labelNomorInvoice(m.judul)} ${dok.nomorTampil}`, { x: xKanan, y, lebar: lebarKanan, ukuran: pt(37), warna: tinta, rata: "kanan" });
    const hKanan = hNomor + 2 + k.teks(formatTanggalPanjang(dok.tanggal), { x: xKanan, y: y + hNomor + 2, lebar: lebarKanan, ukuran: pt(37), warna: tinta, rata: "kanan" });
    // A5L: judul di kolom tengah, rata tengah secara tegak (cell_style bawaan generator)
    let hTengah = 0;
    if (LS) {
      const hJudul = judulInvoice(k, m, x0 + kolom[0], -1e6, kolom[1], true);
      hTengah = judulInvoice(k, m, x0 + kolom[0], y + Math.max(0, (Math.max(hKiri, hKanan) - hJudul) / 2), kolom[1]);
    }
    k.y = y + Math.max(hKiri, hTengah, hKanan);
  }
  jarak(k, pt(p.jarak));

  // 4-5. Tabel rincian dan ringkasan
  {
    const kolom = DPRO_INVOICE.kolomTabel.map(px);
    const ukuran = pt(p.hurufTabel);
    const sisi = px(DPRO_INVOICE.padSisi);
    const pad: [number, number, number, number] = [px(p.padBaris), sisi, px(p.padBaris), sisi];
    const padRingkas: [number, number, number, number] = [0, sisi, 0, sisi];
    const kepala: BarisTabel = {
      tinggiMin: px(p.kepalaTabel),
      sel: ["NO.", "DESCRIPTION", "PRICE"].map((isi): SelTabel => ({ isi, ukuran, font: "B", warna: PUTIH, latar: aksen, rata: "tengah", valign: "tengah", pad: padRingkas })),
    };
    const rincian: BarisTabel[] = barisDicetak(m).map((b) => ({
      tinggiMin: px(p.baris),
      sel: [
        { isi: String(b.no), ukuran, warna: tinta, rata: "tengah", valign: "tengah", pad },
        { isi: isiUraian(b), ukuran, warna: tinta, valign: "tengah", pad },
        { isi: angka(m, b.nilai), rpKiri: true, ukuran, warna: tinta, valign: "tengah", pad },
      ],
    }));
    const ringkas = (label: string, nilai: Desimal, gaya: { label: string; latar: string; garis: string; nilai: string; ukuranLabel?: number }): BarisTabel => ({
      tinggiMin: px(p.baris),
      sel: [
        { isi: label, span: 2, garis: null, ukuran: pt(gaya.ukuranLabel ?? p.hurufTabel), font: "BI", warna: gaya.label, rata: "kanan", valign: "tengah", pad: padRingkas },
        { isi: angka(m, nilai), rpKiri: true, latar: gaya.latar, garis: { warna: gaya.garis, tebal: 0.75 }, ukuran, font: "B", warna: gaya.nilai, valign: "tengah", pad: padRingkas },
      ],
    });
    const gayaLembut = { label: utama, latar: lembut, garis: utama, nilai: utama };
    const gayaUtama = { label: utama, latar: utama, garis: utama, nilai: PUTIH };
    const diterima = r.terbayar.minus(r.uangMuka);
    const potongan = bukanNol(r.uangMuka) || bukanNol(diterima) || bukanNol(r.retur);
    const daftarRingkas: BarisTabel[] = [
      ringkas("Total", r.subtotal, { label: sekunder, latar: sekunder, garis: sekunder, nilai: PUTIH }),
      ...(bukanNol(r.diskon) ? [ringkas("Discount", r.diskon, gayaLembut)] : []),
      ...(bukanNol(r.fee) ? [ringkas("Management Fee", r.fee, gayaLembut)] : []),
      ...(bukanNol(r.ppn) ? [ringkas(`PPN ${persen(m, r.ppnPersen)}%`, r.ppn, gayaLembut)] : []),
      ringkas("Grand Total", r.total, { ...gayaUtama, ukuranLabel: p.hurufGrandTotal }),
      ...(bukanNol(r.uangMuka) ? [ringkas("Uang Muka", r.uangMuka, gayaLembut)] : []),
      ...(bukanNol(diterima) ? [ringkas("Pembayaran Diterima", diterima, gayaLembut)] : []),
      ...(bukanNol(r.retur) ? [ringkas("Retur", r.retur, gayaLembut)] : []),
      ...(potongan ? [ringkas("Sisa Tagihan", r.sisa, gayaUtama)] : []),
    ];
    gambarTabel(k, { x: x0, kolom, kepala, baris: [...rincian, ...daftarRingkas], garisBawaan: { warna: utama, tebal: 0.75 } });
  }
  jarak(k, pt(p.jarak));

  // 6. Terbilang dari total, label dan isi tidak dipisah halaman
  {
    const label = { x: x0, lebar, ukuran: pt(37), font: "BI" as const, warna: utama, rata: "tengah" as const };
    const isi = { x: x0, lebar, ukuran: pt(35), font: "BI" as const, warna: tinta, rata: "tengah" as const, hurufBesar: true };
    const teks = terbilangRupiah(r.total, "KAPITAL");
    ruangUtuh(k, k.ukur("TERBILANG:", label).tinggi + 3 + k.ukur(teks, isi).tinggi);
    k.teks("TERBILANG:", label);
    jarak(k, 3);
    k.teks(teks, isi);
  }
  jarak(k, pt(p.jarakSebelumBawah));

  // 7. Blok bawah tak terpotong: metode pembayaran | salam, tanda tangan, nama
  {
    const [kolomKiri, kolomKanan] = DPRO_INVOICE.kolomAtas.map(px);
    const xKiri = x0 + px(DPRO_INVOICE.padKiriBayar);
    const lebarKiri = kolomKiri - px(DPRO_INVOICE.padKiriBayar);
    const xKanan = x0 + kolomKiri;
    const lebarKanan = kolomKanan - px(DPRO_INVOICE.padKananTtd);
    const ttd = tandaTanganDipakai(m);
    const tinggiTtd = LS ? k.mm(TINGGI_TTD_MM.lanskap) : k.mm(TINGGI_TTD_MM.biasa) * k.skala;
    const ruang = ttd ? Math.max(pt(p.ruangTtd), tinggiTtd) : pt(p.ruangTtd);

    const lebarLabelBayar = px(DPRO_INVOICE.labelBayarLebar);
    const hLabelBayar = tinggiGambarSlot(m, "LABEL_PEMBAYARAN", lebarLabelBayar);
    const teksLabelBayar = { x: xKiri, lebar: lebarKiri, ukuran: pt(45), font: "B" as const, warna: utama };
    const lebarSalam = px(DPRO_INVOICE.labelSalamLebar);
    const hSalam = tinggiGambarSlot(m, "LABEL_SALAM", lebarSalam);
    const teksSalam = { x: xKanan, lebar: lebarKanan, ukuran: pt(45), font: "B" as const, warna: utama, rata: "tengah" as const };
    const infoBank = dok.surat.infoBank?.trim() || null;
    const rek = [
      { teks: identitas.namaBank ?? "", ukuran: pt(37), font: "R" as const, warna: tinta },
      { teks: identitas.nomorRekening ?? "", ukuran: pt(57), font: "B" as const, warna: utama },
      { teks: `AN. ${(identitas.atasNamaRekening ?? "").toLocaleUpperCase("id-ID")}`, ukuran: pt(37), font: "R" as const, warna: tinta },
    ];
    const nama = { x: xKanan, lebar: lebarKanan, ukuran: pt(43), font: "B" as const, warna: utama, rata: "tengah" as const, garisBawah: true };

    const tinggiKiri =
      (hLabelBayar ?? k.ukur("PAYMENT METHOD", teksLabelBayar).tinggi) +
      pt(p.sesudahLabelBayar) +
      (infoBank ? k.ukur(infoBank, { x: xKiri, lebar: lebarKiri, ukuran: pt(37) }).tinggi : rek.reduce((n, b, i) => n + k.ukur(b.teks, { x: xKiri, lebar: lebarKiri, ukuran: b.ukuran, font: b.font }).tinggi + (i < rek.length - 1 ? p.antarRekening : 0), 0));
    const tinggiKanan = (hSalam ?? k.ukur(identitas.teksSalam, teksSalam).tinggi) + ruang + (identitas.penandaTangan ? k.ukur(identitas.penandaTangan, nama).tinggi : 0);
    ruangUtuh(k, Math.max(tinggiKiri, tinggiKanan));
    const y0 = k.y;

    let y = y0;
    if (hLabelBayar !== null) y += gambarSlot(k, m, "LABEL_PEMBAYARAN", { x: xKiri, y, w: lebarLabelBayar })?.h ?? 0;
    else y += k.teks("PAYMENT METHOD", { ...teksLabelBayar, y });
    y += pt(p.sesudahLabelBayar);
    if (infoBank) k.teks(infoBank, { x: xKiri, y, lebar: lebarKiri, ukuran: pt(37), warna: tinta });
    else
      rek.forEach((b, i) => {
        y += k.teks(b.teks, { x: xKiri, y, lebar: lebarKiri, ukuran: b.ukuran, font: b.font, warna: b.warna }) + (i < rek.length - 1 ? p.antarRekening : 0);
      });

    y = y0;
    if (hSalam !== null) y += gambarSlot(k, m, "LABEL_SALAM", { x: xKanan + (lebarKanan - lebarSalam) / 2, y, w: lebarSalam })?.h ?? 0;
    else y += k.teks(identitas.teksSalam, { ...teksSalam, y });
    if (ttd) k.gambar(ttd, { x: xKanan, y: y + (ruang - tinggiTtd) / 2, muat: [lebarKanan, tinggiTtd] }, "TANDA_TANGAN");
    y += ruang;
    if (identitas.penandaTangan) k.teks(identitas.penandaTangan, { ...nama, y });
    k.y = y0 + Math.max(tinggiKiri, tinggiKanan);
  }

  // 8. Catatan tambahan di bawah blok (tidak ada di Figma; hanya bila diisi)
  const catatan = [teksUangMukaDipotong(m), syaratDicetak(m), dok.surat.catatan].filter((t): t is string => !!t?.trim());
  if (catatan.length) {
    jarak(k, pt(p.jarak));
    for (const t of catatan) {
      alirBerbutir(k, berbutir(t), { x: x0, lebar, ukuran: pt(34), warna: tinta });
      jarak(k, pt(20));
    }
  }

  return k.selesai();
}
