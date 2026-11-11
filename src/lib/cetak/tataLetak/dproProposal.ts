import { KERTAS, type KanvasCetak } from "@/lib/cetak/mesin/kanvas";
import { gambarTabel, type BarisTabel, type SelTabel } from "@/lib/cetak/mesin/tabel";
import { formatJumlah } from "@/lib/cetak/format";
import type { Desimal } from "@/lib/uang";
import { DPRO_INVOICE, lapisanDpro } from "@/lib/cetak/tataLetak/dproInvoice";
import {
  PUTIH,
  alirBerbutir,
  alirTeks,
  angka,
  barisDicetak,
  berbutir,
  bukanNol,
  buatKanvas,
  gambarSlot,
  isiUraian,
  jarak,
  kotaTanggal,
  persen,
  ruangUtuh,
  syaratDicetak,
  tandaTanganDipakai,
  tinggiGambarSlot,
  type MasukanTataLetak,
} from "@/lib/cetak/tataLetak/blok";

/*
 * Proposal pengajuan anggaran D'Pro A4 dua halaman (D3 §3.6, spec/10 §5.2), setia dengan build_proposal di
 * dpro-docgen/dpro_docs.py. Halaman 1: nomor, tanggal, tujuan, event, pembuka, tabel anggaran 9 kolom dengan baris
 * total, dan tabel Diajukan/Disetujui. Halaman 2 (selalu halaman baru): penutup, salam dan tanda tangan, kotak Nb.
 * MANAGEMENT FEE, PPN, syarat pembayaran, dan catatan hanya muncul bila diisi, jadi data contoh sama dengan Figma.
 */

export const DPRO_PROPOSAL = {
  margin: { atas: 470, bawah: 300, sisi: 261 },
  watermark: DPRO_INVOICE.A4.watermark,
  huruf: 37,
  tabEvent: 190,
  indenParagraf: 110,
  kolom: [70, 500, 100, 130, 80, 120, 230, 260, 468],
  hurufTabel: 28,
  kepala: { tinggi: 76, pad: [8, 12] },
  baris: { tinggi: 56, pad: [6, 12] },
  kolomTtd: [800, 1158],
  padTtd: [24, 20],
  ruangTtd: 200,
  kolomPenutup: [1200, 758],
  padKananPenutup: 80,
  labelSalamLebar: 303,
  ruangTtdPenutup: 300,
  lebarNb: 1320,
  padNb: [50, 60],
  hurufNb: 34,
  indenNb: 50,
} as const;

const PEMBUKA_BAWAAN = "Bersama ini akan kami sampaikan anggaran yang diperlukan untuk acara yang saudara selenggarakan. Anggaran yang kami ajukan adalah sebagai berikut:";
const PENUTUP_BAWAAN = "Demikian pengajuan anggaran dari kami. Besar harapan kami untuk bisa bekerjasama dengan anda. Atas perhatian dan kerjasamanya kami ucapkan terima kasih.";

export async function renderDproProposal(m: MasukanTataLetak): Promise<Uint8Array> {
  // proposal hanya A4 (UKURAN_SAH); ukuran lain tetap digambar A4
  const mA4: MasukanTataLetak = { ...m, ukuran: "A4" };
  const k = buatKanvas(mA4, "Proposal");
  const P = DPRO_PROPOSAL;
  const px = (v: number) => k.px(v);
  const pt = (v: number) => k.ukuranHuruf(v);
  const { warnaUtama: utama, warnaTinta: tinta, warnaAksen: aksen, warnaSekunder: sekunder, warnaLembut: lembut } = m.tema;
  const { dok, identitas } = m;
  const r = dok.ringkasan;
  const B = pt(P.huruf);

  k.aturArea({ atas: px(P.margin.atas), bawah: px(P.margin.bawah), kiri: px(P.margin.sisi), kanan: px(P.margin.sisi) });
  k.halamanBaru(KERTAS.A4, lapisanDpro(mA4, P.watermark));
  const x0 = k.areaIsi.kiri;
  const lebar = k.areaIsi.lebar;
  const paragraf = (teks: string, sesudah: number) => {
    alirTeks(k, teks, { x: x0, lebar, ukuran: B, warna: tinta, rata: "rata", indenPertama: px(P.indenParagraf), tinggiBaris: 1.3 });
    jarak(k, sesudah);
  };

  // ---------- Halaman 1 ----------
  k.teks([{ teks: "NO: " }, { teks: dok.nomorTampil, tebal: true }], { x: x0, lebar, ukuran: B, warna: tinta, rata: "kanan" });
  jarak(k, 2);
  k.teks(kotaTanggal(m, dok.tanggal), { x: x0, lebar, ukuran: B, warna: tinta, rata: "kanan" });
  jarak(k, pt(46));
  k.teks("Kepada Yth :", { x: x0, lebar, ukuran: B, font: "B", warna: utama });
  jarak(k, 4);
  k.teks(dok.kepada.nama, { x: x0, lebar, ukuran: pt(40), font: "B", warna: tinta });
  jarak(k, 4);
  k.teks("di tempat", { x: x0, lebar, ukuran: B, warna: tinta });
  jarak(k, pt(46));
  const tab = px(P.tabEvent);
  for (const [label, nilai] of [
    ["Event", dok.event.namaEvent ?? dok.surat.perihal ?? ""],
    ["Tanggal", dok.event.tanggalEvent ?? ""],
  ] as const) {
    const y = k.y;
    k.teks(label, { x: x0, y, lebar: tab, ukuran: B, warna: tinta });
    k.teks(`: ${nilai}`, { x: x0 + tab, lebar: lebar - tab, ukuran: B, warna: tinta });
    jarak(k, 3);
  }
  jarak(k, pt(40));
  k.teks("Dengan hormat,", { x: x0, lebar, ukuran: B, warna: tinta });
  jarak(k, 6);
  paragraf(dok.surat.teksPembuka?.trim() || PEMBUKA_BAWAAN, pt(46));

  // Tabel anggaran
  const kolom = P.kolom.map(px);
  const garis = { warna: utama, tebal: 0.5 };
  const F = pt(P.hurufTabel);
  const padKepala: [number, number, number, number] = [px(P.kepala.pad[0]), px(P.kepala.pad[1]), px(P.kepala.pad[0]), px(P.kepala.pad[1])];
  const padBaris: [number, number, number, number] = [px(P.baris.pad[0]), px(P.baris.pad[1]), px(P.baris.pad[0]), px(P.baris.pad[1])];
  const padTotal: [number, number, number, number] = [0, px(P.baris.pad[1]), 0, px(P.baris.pad[1])];
  const sKepala = (isi: string, span = 1): SelTabel => ({ isi, span, ukuran: F, font: "B", warna: PUTIH, latar: aksen, rata: "tengah", valign: "tengah", pad: padKepala });
  const kepala: BarisTabel = {
    tinggiMin: px(P.kepala.tinggi),
    sel: [sKepala("No"), sKepala("Uraian"), sKepala("Qty"), sKepala("UOM"), sKepala("Freq", 2), sKepala("Harga Satuan (Rp)"), sKepala("Jumlah (Rp)"), sKepala("Keterangan")],
  };
  const rata = ["tengah", "kiri", "tengah", "tengah", "tengah", "tengah", "kanan", "kanan", "kiri"] as const;
  const g = m.tema.gayaAngka;
  const rincian: BarisTabel[] = barisDicetak(m).map((b) => ({
    tinggiMin: px(P.baris.tinggi),
    sel: [String(b.no), isiUraian(b), formatJumlah(b.jumlah, g), b.satuan, formatJumlah(b.frekuensi, g), b.satuanFrekuensi ?? "", angka(m, b.harga), angka(m, b.nilai), b.keterangan ?? ""].map(
      (isi, i): SelTabel => ({ isi, ukuran: F, warna: tinta, rata: rata[i], valign: "tengah", pad: padBaris }),
    ),
  }));
  const total = (label: string, nilai: Desimal, gaya: { label: string; latar: string; garis: string; nilai: string; ukuranLabel?: number }): BarisTabel => ({
    tinggiMin: px(P.baris.tinggi),
    sel: [
      { isi: label, span: 7, garis: null, ukuran: pt(gaya.ukuranLabel ?? P.hurufTabel), font: "BI", warna: gaya.label, rata: "kanan", valign: "tengah", pad: padTotal },
      { isi: angka(m, nilai), latar: gaya.latar, garis: { warna: gaya.garis, tebal: 0.5 }, ukuran: F, font: "B", warna: gaya.nilai, rata: "kanan", valign: "tengah", pad: padTotal },
      { isi: "", garis: null, ukuran: F },
    ],
  });
  const gayaLembut = { label: utama, latar: lembut, garis: utama, nilai: utama };
  const daftarTotal: BarisTabel[] = [
    total("TOTAL BIAYA LANGSUNG (NETT)", r.subtotal, { label: sekunder, latar: sekunder, garis: sekunder, nilai: PUTIH }),
    ...(bukanNol(r.diskon) ? [total("DISCOUNT", r.diskon, gayaLembut)] : []),
    ...(bukanNol(r.fee) ? [total(r.feePersen ? `MANAGEMENT FEE ${persen(m, r.feePersen)}%` : "MANAGEMENT FEE", r.fee, gayaLembut)] : []),
    ...(bukanNol(r.ppn) ? [total(`PPN ${persen(m, r.ppnPersen)}%`, r.ppn, gayaLembut)] : []),
    total("GRAND TOTAL BIAYA", r.total, { label: utama, latar: utama, garis: utama, nilai: PUTIH, ukuranLabel: 40 }),
    ...(r.addOn && r.addOn.nilai.gt(0) ? [total("ADD ON", r.addOn.nilai, gayaLembut)] : []),
  ];
  gambarTabel(k, { x: x0, kolom, kepala, baris: [...rincian, ...daftarTotal], garisBawaan: garis });

  // Diajukan Oleh | Disetujui Oleh, tepat di bawah tabel, tidak terpotong
  {
    const [kiri, kanan] = P.kolomTtd.map(px);
    const [padV, padH] = [px(P.padTtd[0]), px(P.padTtd[1])];
    const kolomIsi = [
      { x: x0, w: kiri, judul: "Diajukan Oleh", nama: identitas.penandaTangan ?? "", sub: identitas.namaLegal || identitas.nama },
      { x: x0 + kiri, w: kanan, judul: "Disetujui Oleh", nama: dok.kepada.nama, sub: "" },
    ];
    const opsi = (c: (typeof kolomIsi)[number], ukuran: number, font: "R" | "B", warna: string, garisBawah = false) => ({ x: c.x + padH, lebar: c.w - 2 * padH, ukuran, font, warna, rata: "tengah" as const, garisBawah });
    const tinggiIsi = (c: (typeof kolomIsi)[number]) =>
      k.ukur(c.judul, opsi(c, pt(30), "B", utama)).tinggi + pt(P.ruangTtd) + k.ukur(c.nama || " ", opsi(c, pt(30), "B", utama)).tinggi + k.ukur(c.sub || " ", opsi(c, pt(28), "B", tinta)).tinggi;
    const tinggi = Math.max(...kolomIsi.map(tinggiIsi)) + 2 * padV;
    ruangUtuh(k, tinggi);
    const y0 = k.y;
    for (const c of kolomIsi) {
      let y = y0 + padV;
      y += k.teks(c.judul, { ...opsi(c, pt(30), "B", utama), y });
      y += pt(P.ruangTtd);
      y += k.teks(c.nama, { ...opsi(c, pt(30), "B", utama, true), y }) || k.ukur(" ", opsi(c, pt(30), "B", utama)).tinggi;
      k.teks(c.sub, { ...opsi(c, pt(28), "B", tinta), y });
      k.kotak(c.x, y0, c.w, tinggi, { garis });
    }
    k.y = y0 + tinggi;
  }

  // ---------- Halaman 2 ----------
  k.lanjutHalaman();
  paragraf(dok.surat.teksPenutup?.trim() || PENUTUP_BAWAAN, pt(60));
  {
    const [kiri, kanan] = P.kolomPenutup.map(px);
    const x = x0 + kiri;
    const w = kanan - px(P.padKananPenutup);
    const lebarSalam = px(P.labelSalamLebar);
    const ruang = pt(P.ruangTtdPenutup);
    const nama = { x, lebar: w, ukuran: pt(42), font: "B" as const, warna: utama, rata: "tengah" as const, garisBawah: true };
    const salam = { x, lebar: w, ukuran: pt(45), font: "B" as const, warna: utama, rata: "tengah" as const };
    const hSalam = tinggiGambarSlot(m, "LABEL_SALAM", lebarSalam) ?? k.ukur(identitas.teksSalam, salam).tinggi;
    const ttd = tandaTanganDipakai(m);
    ruangUtuh(k, hSalam + ruang + (identitas.penandaTangan ? k.ukur(identitas.penandaTangan, nama).tinggi : 0));
    let y = k.y;
    if (m.tema.aset.LABEL_SALAM) gambarSlot(k, m, "LABEL_SALAM", { x: x + (w - lebarSalam) / 2, y, w: lebarSalam });
    else k.teks(identitas.teksSalam, { ...salam, y });
    y += hSalam;
    // tanda tangan setinggi paling banyak ruang ini, rasio dijaga
    if (ttd) k.gambar(ttd, { x, y, muat: [w, ruang] }, "TANDA_TANGAN");
    y += ruang;
    if (identitas.penandaTangan) y += k.teks(identitas.penandaTangan, { ...nama, y });
    k.y = y;
  }
  jarak(k, pt(60));
  kotakNb(k, m, x0);

  // Tambahan di luar Figma, hanya bila diisi: syarat pembayaran (dengan skema termin) dan catatan
  const tambahan = [syaratDicetak(m), dok.surat.catatan].filter((t): t is string => !!t?.trim());
  for (const t of tambahan) {
    jarak(k, pt(40));
    alirBerbutir(k, berbutir(t), { x: x0, lebar, ukuran: pt(P.hurufNb), warna: tinta });
  }

  return k.selesai();
}

/** Kotak Nb (satu sel bergaris, rata kiri): kontak dan rekening dengan nomor gantung. */
function kotakNb(k: KanvasCetak, m: MasukanTataLetak, x0: number): void {
  const P = DPRO_PROPOSAL;
  const px = (v: number) => k.px(v);
  const ukuran = k.ukuranHuruf(P.hurufNb);
  const { warnaUtama: utama, warnaTinta: tinta } = m.tema;
  const i = m.identitas;
  const [padV, padH] = [px(P.padNb[0]), px(P.padNb[1])];
  const w = px(P.lebarNb);
  const xIsi = x0 + padH;
  const lebarIsi = w - 2 * padH;
  const inden = px(P.indenNb);
  const rekening = m.dok.surat.infoBank?.trim() || `${i.singkatanBank ?? i.namaBank ?? ""} an. ${i.atasNamaRekening ?? ""} ac. ${i.nomorRekening ?? ""}`.replace(/ {2,}/g, " ").trim();
  const butir = [
    [{ teks: "Apabila ada hal-hal yang kurang jelas, bisa menghubungi " }, { teks: i.namaKontak ?? i.penandaTangan ?? "", tebal: true }, { teks: " di " }, { teks: i.teleponKontak ?? i.telepon ?? "", tebal: true }],
    [{ teks: "Untuk penyelesaian pembayaran bisa ditransfer ke rekening: " }, { teks: rekening, tebal: true }],
  ];
  const opsiButir = { x: xIsi + inden, lebar: lebarIsi - inden, ukuran, warna: tinta, tinggiBaris: 1.2 };
  const judul = { x: xIsi, lebar: lebarIsi, ukuran, font: "B" as const, warna: utama };
  const tinggiIsi = k.ukur("Nb.", judul).tinggi + 4 + butir.reduce((n, b) => n + k.ukur(b, opsiButir).tinggi + 3, 0);
  const tinggi = tinggiIsi + 2 * padV;
  ruangUtuh(k, tinggi);
  const y0 = k.y;
  let y = y0 + padV;
  y += k.teks("Nb.", { ...judul, y }) + 4;
  butir.forEach((b, n) => {
    k.teks(`${n + 1}.`, { x: xIsi, y, lebar: inden, ukuran, warna: tinta, tinggiBaris: 1.2 });
    y += k.teks(b, { ...opsiButir, y }) + 3;
  });
  k.kotak(x0, y0, w, tinggi, { garis: { warna: utama, tebal: 0.75 } });
  k.y = y0 + tinggi;
}
