import type { TataLetakCetak } from "@/prisma-klien/enums";
import { gambarTabel, type BarisTabel, type SelTabel } from "@/lib/cetak/mesin/tabel";
import type { BarisTeksCetak, OpsiTeks, Segmen } from "@/lib/cetak/mesin/kanvas";
import { formatAngka, formatTanggalPanjang } from "@/lib/cetak/format";
import { terbilangRupiah } from "@/lib/cetak/terbilang";
import type { TampilanEventCetak } from "@/lib/cetak/tipe";
import type { Desimal } from "@/lib/uang";
import { PUTIH, barisDicetak, berbutir, bukanNol, hurufJudul, jarak, persen, ruangUtuh, satuBaris, tandaTanganDipakai, type MasukanTataLetak } from "@/lib/cetak/tataLetak/blok";
import { ABU, LABEL_NOMOR_HKA, alamatHka, butirHka, ikonSosial, kepalaTengah, mulaiHka, namaPenerbit, o, paragrafHka, qtyHka, rpHka, sel, syaratHka, teksRekeningHka, tint, type Hka } from "@/lib/cetak/tataLetak/hkaStandar";

/*
 * Tampilan event HKA (spec/02 §16, D3 §3.8) untuk penawaran dan faktur mode event bertata letak HKA_*: rinci (satu
 * halaman detail dengan terbilang, metode pembayaran, stempel, tanda tangan), ringkas (faktur: halaman ringkas paket
 * lalu halaman RAB; penawaran: halaman RAB saja). Tata letak kop hanya menentukan warna, kepala tengah, dan kaki:
 * kaki bergelombang hanya bila kop bermerek atau surat dan punya ikon sosial atau alamat kaki.
 */

const GRID = { warna: "#9AA3AD", tebal: 0.4 };
const HITAM = { warna: "#000000", tebal: 0.6 };

/** Stempel/e-meterai: hanya faktur bukan draf, dengan izin dan permintaan yang sama dengan tanda tangan (D3 §3.3). */
const stempelDipakai = (m: MasukanTataLetak) => (m.dok.jenis === "faktur" && m.tandaTangan && !m.dok.draf ? (m.tema.aset.STEMPEL ?? null) : null);

/** Tabel event (event_table): baris judul bagian setiap kali bagian berganti. RAB memakai kepala huruf besar. */
function tabelEvent(h: Hka, rab: boolean): void {
  const { k, m, x0, W, mm, aksen } = h;
  const kepalaTeks = rab ? ["URAIAN", "QTY", "SATUAN", "FREQ", "HARGA", "TOTAL"] : ["Item", "Qty", "Satuan", "Freq", "Harga", "Total Harga"];
  const rata: SelTabel["rata"][] = ["kiri", "tengah", "tengah", "tengah", "kanan", "kanan"];
  const pad: [number, number, number, number] = [3, 3, 3, 3];
  const isi = (v: SelTabel["isi"], i: number, lain: Partial<SelTabel> = {}) => sel(h, v, 8.5, { rata: rata[i], valign: "tengah", pad, ...lain });
  const baris: BarisTabel[] = [];
  let bagian: string | null = null;
  for (const b of barisDicetak(m)) {
    const sek = b.bagian?.trim() || null;
    if (sek && sek !== bagian) {
      baris.push({ sel: [isi(sek, 0, { span: 6, font: "B", latar: tint(aksen, 0.82) })] });
      bagian = sek;
    }
    const deskripsi = berbutir(b.deskripsi);
    const uraian: SelTabel["isi"] = deskripsi.length ? ([{ jenis: "paragraf", isi: [{ teks: b.nama, tebal: false }] }, ...deskripsi] as BarisTeksCetak[]) : b.nama;
    baris.push({
      sel: [
        isi(uraian, 0),
        isi(qtyHka(m, b.jumlah), 1),
        isi(b.satuan, 2),
        isi(`${qtyHka(m, b.frekuensi)}${b.satuanFrekuensi ? ` ${b.satuanFrekuensi}` : ""}`, 3),
        isi(rpHka(m, b.harga), 4),
        isi(rpHka(m, b.nilai), 5),
      ],
    });
  }
  gambarTabel(k, {
    x: x0,
    kolom: [W - mm(108), mm(12), mm(14), mm(22), mm(28), mm(32)],
    garisBawaan: GRID,
    kepala: { sel: kepalaTeks.map((t, i) => isi(t, i, { font: "B", warna: PUTIH, latar: aksen })) },
    baris,
  });
}

/** Tabel total event (totals_table): GRAND TOTAL, lalu Total Terbayar dan Sisa Tagihan faktur bila sudah dibayar. */
function totalEvent(h: Hka, denganBayar: boolean): void {
  const { m, mm, aksen } = h;
  const r = m.dok.ringkasan;
  const muda = tint(aksen, 0.85);
  const baris: BarisTabel[] = [];
  const tambah = (label: string, nilai: string, gaya: { tebal?: boolean; latar?: string; warna?: string } = {}) =>
    baris.push({
      sel: [label, nilai].map((t) => sel(h, t, 8.5, { rata: "kanan", font: gaya.tebal ? "B" : "R", latar: gaya.latar, warna: gaya.warna ?? h.tinta, pad: [2.5, 2.5, 2.5, 2.5] })),
    });
  tambah("Subtotal", rpHka(m, r.subtotal), { tebal: true, latar: muda });
  if (bukanNol(r.diskon)) tambah("Diskon", `- ${rpHka(m, r.diskon)}`);
  if (bukanNol(r.fee)) tambah(r.feePersen ? `Management Fee ${persen(m, r.feePersen)}%` : "Management Fee", rpHka(m, r.fee), { tebal: true, latar: muda });
  if (bukanNol(r.fee) && bukanNol(r.ppn)) tambah("Total", rpHka(m, r.total.minus(r.ppn)), { tebal: true, latar: muda });
  if (bukanNol(r.ppn)) tambah(`PPN ${persen(m, r.ppnPersen)}%`, rpHka(m, r.ppn), { tebal: true, latar: muda });
  tambah("GRAND TOTAL", rpHka(m, r.total), { tebal: true, latar: aksen, warna: PUTIH });
  if (denganBayar && m.dok.jenis === "faktur" && (bukanNol(r.terbayar) || bukanNol(r.retur))) {
    tambah("Total Terbayar", rpHka(m, r.terbayar), { tebal: true });
    if (bukanNol(r.retur)) tambah("Retur", rpHka(m, r.retur), { tebal: true });
    tambah("Sisa Tagihan", rpHka(m, r.sisa), { tebal: true });
  }
  const lebar = mm(80);
  gambarTabel(h.k, { x: h.x0 + h.W - lebar, kolom: [mm(44), mm(36)], baris, garisBawaan: GRID, ulangKepala: false });
}

/** Baris rekening event (bank_lines): baris berisi 6 digit atau lebih dicetak tebal ukuran + 2. */
function barisRekening(h: Hka, x: number, lebar: number, y: number, ukuran: number, rata: "kiri" | "tengah", gambar: boolean): number {
  let tinggi = 0;
  for (const baris of teksRekeningHka(h.m).split("\n").map((s) => s.trim()).filter(Boolean)) {
    const nomor = (baris.match(/\d/g) ?? []).length >= 6;
    const opsi = o(h, nomor ? ukuran + 2 : ukuran, { x, y: y + tinggi, lebar, rata, font: nomor ? "B" : "R" });
    tinggi += gambar ? h.k.teks(baris, opsi) : h.k.ukur(baris, opsi).tinggi;
  }
  return tinggi;
}

/**
 * Tanda tangan event (signature_col): salam tebal, nama penerbit huruf besar (bila diminta), gambar 22 mm atau ruang
 * 18 mm, nama bergaris bawah tebal, jabatan. Mengembalikan tingginya; `gambar` false hanya mengukur.
 */
function ttdEvent(h: Hka, x: number, lebar: number, y: number, salam: string, denganPenerbit: boolean, gambar: boolean): number {
  const { k, m } = h;
  const ttd = tandaTanganDipakai(m);
  const nama = m.identitas.penandaTangan?.trim();
  const jabatan = m.identitas.jabatanPenandaTangan?.trim();
  let tinggi = 0;
  const opsi = (u: number, lain: Partial<OpsiTeks> = {}) => o(h, u, { x, lebar, rata: "tengah", ...lain });
  const tulis = (t: string, u: number, lain: Partial<OpsiTeks> = {}) => (gambar ? k.teks(t, opsi(u, { y: y + tinggi, ...lain })) : k.ukur(t, opsi(u, lain)).tinggi);
  tinggi += tulis(salam, 9.5, { font: "B" });
  if (denganPenerbit) tinggi += tulis(namaPenerbit(m), 9);
  const ruang = ttd ? h.mm(22) : h.mm(18);
  if (gambar && ttd) k.gambar(ttd, { x, y: y + tinggi, muat: [lebar, ruang] }, "TANDA_TANGAN");
  tinggi += ruang;
  if (nama) tinggi += tulis(nama, 9.5, { font: "B", garisBawah: true });
  if (jabatan) tinggi += tulis(jabatan, 9);
  return tinggi;
}

/** Tanda tangan event di kolom (kiri atau kanan) yang tidak terpotong. */
function blokTtdEvent(h: Hka, sisi: "kiri" | "kanan", lebarMm: number, salam: string, denganPenerbit: boolean): void {
  const lebar = h.mm(lebarMm);
  const x = sisi === "kiri" ? h.x0 : h.x0 + h.W - lebar;
  ruangUtuh(h.k, ttdEvent(h, x, lebar, 0, salam, denganPenerbit, false));
  h.k.y += ttdEvent(h, x, lebar, h.k.y, salam, denganPenerbit, true);
}

/** Judul bagian dan butir (SYARAT PEMBAYARAN, CATATAN). */
function bagianButir(h: Hka, judul: string, teks: string | null | undefined): void {
  if (!berbutir(teks).length) return;
  jarak(h.k, h.mm(4));
  paragrafHka(h, judul, 7.5, { font: "B", warna: ABU.label });
  butirHka(h, teks, 8.5, h.tinta);
}

/** Tampilan rinci (detail_story). */
function rinci(h: Hka): void {
  const { k, m, x0, W, mm, aksen } = h;
  const { dok } = m;
  const faktur = dok.jenis === "faktur";
  kepalaTengah(h);
  jarak(k, mm(4));
  paragrafHka(h, m.judul, 20, { font: "B", warna: aksen, rata: "tengah" });
  jarak(k, mm(5));
  {
    const wKanan = mm(75);
    const wKiri = W - wKanan;
    const y = k.y;
    let yL = y;
    yL += k.teks(faktur ? "DITUJUKAN KEPADA:" : "DISIAPKAN UNTUK:", o(h, 8.5, { y: yL, lebar: wKiri, font: "B", warna: ABU.sedang }));
    yL += k.teks(satuBaris(dok.kepada.nama), o(h, 11, { y: yL, lebar: wKiri, font: "B" }));
    for (const b of [dok.kepada.up, alamatHka(h, dok.kepada.alamat), dok.kepada.telepon, dok.kepada.email]) if (b?.trim()) yL += k.teks(b.trim(), o(h, 9, { y: yL, lebar: wKiri, warna: ABU.teks }));
    if (dok.event.namaEvent?.trim()) {
      yL += mm(1.5);
      const isi: Segmen[] = [{ teks: "Event:", tebal: true }, { teks: ` ${satuBaris(dok.event.namaEvent)}${dok.event.venue?.trim() ? ` · ${satuBaris(dok.event.venue)}` : ""}` }];
      yL += k.teks(isi, o(h, 9, { y: yL, lebar: wKiri }));
    }
    const xR = x0 + wKiri;
    let yR = y;
    const kanan = (t: string) => (yR += k.teks(t, o(h, 9.5, { x: xR, y: yR, lebar: wKanan, rata: "kanan" })));
    kanan(`${LABEL_NOMOR_HKA[dok.jenis]} ${dok.nomorTampil}`);
    kanan(formatTanggalPanjang(dok.tanggal));
    if (dok.tanggalKedua) kanan(`${dok.tanggalKedua.label}: ${formatTanggalPanjang(dok.tanggalKedua.tanggal)}`);
    k.y = Math.max(yL, yR);
  }
  jarak(k, mm(7));
  tabelEvent(h, false);
  jarak(k, mm(2));
  totalEvent(h, true);
  jarak(k, mm(6));
  {
    const terbilang = terbilangRupiah(dok.ringkasan.total, "KAPITAL");
    ruangUtuh(k, k.ukur("TERBILANG:", o(h, 9)).tinggi + k.ukur(terbilang, o(h, 9, { font: "BI" })).tinggi);
    paragrafHka(h, "TERBILANG:", 9, { font: "B", rata: "tengah" });
    paragrafHka(h, terbilang, 9, { font: "BI", rata: "tengah" });
  }
  jarak(k, mm(7));

  // Blok bawah tiga kolom 38% | 20% | 42%, tidak terpotong
  {
    const [w1, w2, w3] = [0.38 * W, 0.2 * W, 0.42 * W];
    const stempel = stempelDipakai(m);
    const tKiri = faktur ? k.ukur("METODE PEMBAYARAN", o(h, 10, { lebar: w1 })).tinggi + barisRekening(h, x0, w1, 0, 9, "kiri", false) : 0;
    const tTengah = stempel ? mm(20) : 0;
    const tKanan = ttdEvent(h, x0 + w1 + w2, w3, 0, m.identitas.teksSalam, false, false);
    ruangUtuh(k, Math.max(tKiri, tTengah, tKanan));
    const y = k.y;
    if (faktur) {
      const t = k.teks("METODE PEMBAYARAN", o(h, 10, { y, lebar: w1, font: "B", warna: aksen }));
      barisRekening(h, x0, w1, y + t, 9, "kiri", true);
    }
    if (stempel) k.gambar(stempel, { x: x0 + w1, y, muat: [w2, mm(20)] }, "STEMPEL");
    ttdEvent(h, x0 + w1 + w2, w3, y, m.identitas.teksSalam, false, true);
    k.y = y + Math.max(tKiri, tTengah, tKanan);
  }
  // syarat juga untuk penawaran supaya skema termin tercetak (D3 §3.8, menutup celah HKA spec/02 §7.7)
  bagianButir(h, "SYARAT PEMBAYARAN", syaratHka(m));
  bagianButir(h, "CATATAN", dok.surat.catatan);
}

/** Halaman RAB (rab_story). `lampiran` false = penawaran ringkas (RAB saja, dengan baris nomor dan syarat). */
function rab(h: Hka, lampiran: boolean): void {
  const { k, m, x0, W, mm, aksen } = h;
  const { dok } = m;
  kepalaTengah(h);
  jarak(k, mm(4));
  {
    const nama = satuBaris(dok.event.namaEvent) || satuBaris(dok.surat.perihal) || hurufJudul(m.judul);
    const venue = satuBaris(dok.event.venue);
    const wChip = mm(34);
    const y = k.y;
    const tNama = k.ukur(nama, o(h, 15, { lebar: W - wChip, font: "B" })).tinggi;
    const tChip = venue ? k.ukur(venue, o(h, 8, { lebar: wChip - 12, font: "B" })).tinggi + 12 : 0;
    const tinggi = Math.max(tNama, tChip);
    if (venue) {
      k.kotak(x0, y + (tinggi - tChip) / 2, wChip, tChip, { isi: tint(aksen, 0.8) });
      k.teks(venue, o(h, 8, { x: x0 + 6, y: y + (tinggi - tChip) / 2 + 6, lebar: wChip - 12, font: "B", warna: "#222222", rata: "tengah" }));
    }
    k.teks(nama, o(h, 15, { x: x0 + wChip, y: y + (tinggi - tNama) / 2, lebar: W - wChip, font: "B", rata: "tengah" }));
    k.y = y + tinggi;
  }
  jarak(k, mm(4));
  if (!lampiran) {
    paragrafHka(h, `${LABEL_NOMOR_HKA[dok.jenis]} ${dok.nomorTampil} · ${formatTanggalPanjang(dok.tanggal)} · ${satuBaris(dok.kepada.nama)}`, 9, { warna: ABU.teks, rata: "tengah" });
    jarak(k, mm(3));
  }
  tabelEvent(h, true);
  jarak(k, mm(2));
  totalEvent(h, false);
  if (!lampiran) bagianButir(h, "SYARAT PEMBAYARAN", syaratHka(m));
  jarak(k, mm(8));
  blokTtdEvent(h, "kanan", 62, "Mengetahui,", true);
}

/** Halaman ringkas faktur (summary_story), lalu halaman RAB. */
function ringkas(h: Hka): void {
  const { k, m, x0, W, mm } = h;
  const { dok } = m;
  const r = dok.ringkasan;
  const angka = (d: Desimal) => formatAngka(d, m.tema.gayaAngka, m.tema.desimal);
  kepalaTengah(h);
  jarak(k, mm(5));
  for (const [label, nilai, tebal] of [
    ["Tanggal :", formatTanggalPanjang(dok.tanggal), false],
    ["No. :", dok.nomorTampil, false],
    ["Perihal :", satuBaris(dok.surat.perihal) || hurufJudul(m.judul), false],
    ["Kepada :", satuBaris(dok.kepada.nama), true],
  ] as const) {
    const y = k.y;
    const a = k.teks(label, o(h, 9.5, { y, lebar: mm(22), rata: "kanan" }));
    const b = k.teks(nilai, o(h, 9.5, { x: x0 + mm(24), y, lebar: mm(100), font: tebal ? "B" : "R" }));
    k.y = y + Math.max(a, b);
  }
  jarak(k, mm(5));
  paragrafHka(h, hurufJudul(m.judul), 10.5, { font: "B", rata: "tengah", garisBawah: true });
  jarak(k, mm(3));

  // Tabel ringkas paket
  const paket: [string, Desimal, boolean][] = [[satuBaris(dok.event.namaEvent) || satuBaris(dok.surat.perihal) || "Paket acara", r.subtotal, false]];
  if (bukanNol(r.diskon)) paket.push(["Diskon", r.diskon, true]);
  if (bukanNol(r.fee)) paket.push([r.feePersen ? `Management Fee ${persen(m, r.feePersen)}%` : "Management Fee", r.fee, false]);
  if (bukanNol(r.ppn)) paket.push([`PPN ${persen(m, r.ppnPersen)}%`, r.ppn, false]);
  const isi = (v: string, rata: SelTabel["rata"], lain: Partial<SelTabel> = {}) => sel(h, v, 9, { rata, valign: "tengah", pad: [3, 3, 3, 3], ...lain });
  gambarTabel(k, {
    x: x0,
    kolom: [mm(10), W - mm(100), mm(16), mm(16), mm(26), mm(32)],
    garisBawaan: HITAM,
    kepala: { sel: ["No", "Deskripsi", "Jumlah", "Satuan", "Harga", "Total Harga"].map((t) => isi(t, "tengah", { font: "B" })) },
    baris: paket.map(([nama, nilai, kurang], n) => {
      const tampil = kurang ? nilai.negated() : nilai;
      return { sel: [isi(String(n + 1), "tengah"), isi(nama, "kiri"), isi("1", "tengah"), isi("lot", "tengah"), isi(angka(tampil), "kanan"), isi(rpHka(m, tampil), "kanan")] };
    }),
  });
  {
    const baris: BarisTabel[] = [];
    const tambah = (label: string, nilai: string) => baris.push({ sel: [isi(label, "kiri", { font: "B" }), isi(nilai, "kanan", { font: "B" })] });
    tambah("Total Tagihan", rpHka(m, r.total));
    if (bukanNol(r.terbayar) || bukanNol(r.retur)) {
      tambah("Total Terbayar", rpHka(m, r.terbayar));
      if (bukanNol(r.retur)) tambah("Retur", rpHka(m, r.retur));
      tambah("Sisa Tagihan", rpHka(m, r.sisa));
    }
    gambarTabel(k, { x: x0 + W - mm(74), kolom: [mm(38), mm(36)], baris, garisBawaan: HITAM, ulangKepala: false });
  }
  jarak(k, mm(6));

  // Termasuk (kiri) | jatuh tempo dan rekening (kanan)
  {
    const wKanan = mm(70);
    const wKiri = W - wKanan;
    const xR = x0 + wKiri;
    const catatan = berbutir(dok.surat.catatan);
    const tKiri = k.ukur("Termasuk :", o(h, 9.5)).tinggi + (catatan.length ? k.ukurBerbutir(catatan, o(h, 8.5, { lebar: wKiri - mm(4) })).tinggi : k.ukur("Terlampir pada RAB", o(h, 8.5)).tinggi);
    const tTempo = dok.tanggalKedua ? k.ukur("X", o(h, 9)).tinggi + 6 : 0;
    const wRek = mm(68);
    const tRek = 6 + k.ukur("Mohon lakukan pembayaran ke:", o(h, 8.5, { lebar: wRek - 6 })).tinggi + barisRekening(h, xR, wRek - 6, 0, 9, "tengah", false) + 6;
    const tKanan = tTempo + (tTempo ? mm(3) : 0) + tRek;
    ruangUtuh(k, Math.max(tKiri, tKanan));
    const y = k.y;
    let yL = y + k.teks("Termasuk :", o(h, 9.5, { y, lebar: wKiri - mm(4), font: "B" }));
    if (catatan.length) k.teksBerbutir(catatan, o(h, 8.5, { y: yL, lebar: wKiri - mm(4) }));
    else yL += k.teks("Terlampir pada RAB", o(h, 8.5, { y: yL, lebar: wKiri - mm(4) }));
    let yR = y;
    if (dok.tanggalKedua) {
      k.kotak(xR, yR, mm(28), tTempo, { garis: HITAM });
      k.kotak(xR + mm(28), yR, mm(40), tTempo, { garis: HITAM });
      k.teks("Jatuh Tempo", o(h, 9, { x: xR + 3, y: yR + 3, lebar: mm(28) - 6, font: "B" }));
      k.teks(formatTanggalPanjang(dok.tanggalKedua.tanggal), o(h, 9, { x: xR + mm(28) + 3, y: yR + 3, lebar: mm(40) - 6 }));
      yR += tTempo + mm(3);
    }
    k.kotak(xR, yR, wRek, tRek, { garis: HITAM });
    const t = k.teks("Mohon lakukan pembayaran ke:", o(h, 8.5, { x: xR + 3, y: yR + 6, lebar: wRek - 6, rata: "tengah" }));
    barisRekening(h, xR + 3, wRek - 6, yR + 6 + t, 9, "tengah", true);
    k.y = y + Math.max(tKiri, tKanan);
  }
  jarak(k, mm(10));
  blokTtdEvent(h, "kiri", 75, "Mengetahui,", true);
  k.lanjutHalaman();
  rab(h, true);
}

/**
 * Tampilan event HKA. `tataLetakKop` = tata letak HKA template (menentukan kaki bergelombang). Penawaran ringkas
 * hanya halaman RAB; faktur ringkas halaman ringkas lalu RAB; rinci satu tampilan detail.
 */
export async function renderHkaEvent(m: MasukanTataLetak, judulBerkas: string, tampilan: TampilanEventCetak, tataLetakKop: TataLetakCetak): Promise<Uint8Array> {
  const bergelombang = tataLetakKop === "HKA_BERMEREK" || tataLetakKop === "HKA_SURAT";
  const deko = bergelombang && (ikonSosial(m).length > 0 || !!m.identitas.alamatKaki?.trim());
  const h = mulaiHka(m, judulBerkas, { gelombang: deko, ikon: deko });
  if (tampilan === "RINCI") rinci(h);
  else if (m.dok.jenis === "faktur") ringkas(h);
  else rab(h, false);
  return h.k.selesai();
}
