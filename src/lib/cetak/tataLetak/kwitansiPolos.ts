import { KERTAS } from "@/lib/cetak/mesin/kanvas";
import { gambarTabel, type BarisTabel, type SelTabel } from "@/lib/cetak/mesin/tabel";
import { formatJumlah } from "@/lib/cetak/format";
import { terbilangRupiah } from "@/lib/cetak/terbilang";
import { bukanNol, buatKanvas, isiTokenRekening, jarak, kotaTanggal, ruangUtuh, rupiah, tandaTanganDipakai, teksKotak, type MasukanTataLetak } from "@/lib/cetak/tataLetak/blok";
import { jumlahKwitansi, modeInvoiceTulisan } from "@/lib/cetak/tataLetak/kwitansiEntitas";

/*
 * Kwitansi polos (KWITANSI_POLOS, pola Kwitansi SMARA.docx tanpa Figma, D3 §3.7 dan spec/10 §5.3): A4, margin
 * 19,05 mm, Carlito, tanpa gambar dekorasi. Merek, judul, nomor, tiga baris isian, kotak nominal, lampiran item
 * bila ada, lalu pembayaran (kiri) dan tanda tangan (kanan) yang tidak dipisah halaman.
 */

export const KWITANSI_POLOS = {
  marginMm: 19.05,
  hurufMerek: 26,
  hurufJudul: 16,
  huruf: 11,
  hurufNominal: 14,
  hurufLampiran: 9,
  labelMm: 40,
  titikDuaMm: 4,
  nominalMm: 60,
  kolomLampiranMm: [8, 72, 14, 18, 30, 30],
  kolomTtdMm: 70,
  ruangTtdMm: 25,
} as const;

export async function renderKwitansiPolos(m: MasukanTataLetak): Promise<Uint8Array> {
  const P = KWITANSI_POLOS;
  const invoice = modeInvoiceTulisan(m);
  const mA4: MasukanTataLetak = { ...m, ukuran: "A4" };
  const k = buatKanvas(mA4, invoice ? "Invoice" : "Kwitansi");
  const mm = (v: number) => k.mm(v);
  const { dok, identitas } = m;
  const tinta = m.tema.warnaTinta;
  const jumlah = jumlahKwitansi(m);

  k.aturArea({ atas: mm(P.marginMm), bawah: mm(P.marginMm), kiri: mm(P.marginMm), kanan: mm(P.marginMm) });
  k.halamanBaru(KERTAS.A4);
  const x0 = k.areaIsi.kiri;
  const lebar = k.areaIsi.lebar;
  const tengah = { x: x0, lebar, warna: tinta, rata: "tengah" as const };

  k.teks(identitas.judulMerek || identitas.nama, { ...tengah, ukuran: P.hurufMerek, font: "B" });
  k.teks(m.judul, { ...tengah, ukuran: P.hurufJudul, font: "B" });
  k.teks(`No: ${dok.nomorTampil}`, { ...tengah, ukuran: P.huruf });
  jarak(k, mm(8));

  // baris label : nilai, nilai dibungkus
  const xTitik = x0 + mm(P.labelMm);
  const xNilai = xTitik + mm(P.titikDuaMm);
  const isian: [string, string][] = [
    [invoice ? "Kepada" : "Telah Terima Dari", invoice ? dok.kepada.nama : (dok.kwitansi?.terimaDari ?? dok.kepada.nama)],
    ["Uang Sejumlah", `# ${terbilangRupiah(jumlah, "JUDUL")} #`],
    ["Digunakan Untuk", invoice ? (dok.surat.perihal?.trim() || `Tagihan ${dok.nomorTampil}`) : (dok.kwitansi?.keperluan ?? "")],
  ];
  for (const [label, nilai] of isian) {
    const y = k.y;
    k.teks(label, { x: x0, y, lebar: mm(P.labelMm), ukuran: P.huruf, font: "B", warna: tinta });
    k.teks(":", { x: xTitik, y, lebar: mm(P.titikDuaMm), ukuran: P.huruf, font: "B", warna: tinta });
    k.teks(nilai, { x: xNilai, lebar: x0 + lebar - xNilai, ukuran: P.huruf, warna: tinta });
    jarak(k, 4);
  }

  // kotak nominal bergaris
  jarak(k, mm(3));
  const hNominal = P.hurufNominal * 1.6;
  k.kotak(x0, k.y, mm(P.nominalMm), hNominal, { garis: { warna: tinta, tebal: 0.75 } });
  teksKotak(k, rupiah(m, jumlah), { x: x0, y: k.y, w: mm(P.nominalMm), h: hNominal }, { ukuran: P.hurufNominal, font: "B", warna: tinta, rata: "tengah" });
  jarak(k, hNominal);
  const potongan = !invoice ? dok.kwitansi?.potonganPajak : null;
  if (bukanNol(potongan)) {
    jarak(k, 2);
    k.teks(`Termasuk PPh 23 dipotong pelanggan: ${rupiah(m, potongan!)}`, { x: x0, lebar, ukuran: 9, warna: tinta });
  }

  // lampiran item
  const item = dok.lampiranItem;
  if (item.length) {
    jarak(k, mm(6));
    k.pastikanRuang(P.hurufLampiran * 6);
    k.teks("LAMPIRAN", { x: x0, lebar, ukuran: 12, font: "B", warna: tinta });
    jarak(k, mm(2));
    const pad: [number, number, number, number] = [2, 3, 2, 3];
    const sel = (isi: string, rata: SelTabel["rata"], tebal = false, span = 1): SelTabel => ({ isi, span, rata, valign: "tengah", ukuran: P.hurufLampiran, font: tebal ? "B" : "R", warna: tinta, pad });
    const g = m.tema.gayaAngka;
    const kepala: BarisTabel = { sel: ["No", "Item", "Qty", "Satuan", "Harga Satuan", "Jumlah"].map((t) => sel(t, "tengah", true)) };
    const baris: BarisTabel[] = item.map((b, i) => ({ sel: [sel(String(i + 1), "tengah"), sel(b.nama, "kiri"), sel(formatJumlah(b.jumlah, g), "tengah"), sel(b.satuan, "tengah"), sel(rupiah(m, b.harga), "kanan"), sel(rupiah(m, b.nilai), "kanan")] }));
    const total = item.reduce((n, b) => n.plus(b.nilai), item[0].nilai.minus(item[0].nilai));
    baris.push({ sel: [sel("TOTAL", "tengah", true, 5), sel(rupiah(m, total), "kanan", true)] });
    gambarTabel(k, { x: x0, kolom: P.kolomLampiranMm.map(mm), kepala, baris, garisBawaan: { warna: tinta, tebal: 0.5 } });
  }

  // pembayaran | tanda tangan, tidak dipisah halaman
  jarak(k, mm(8));
  const lebarKanan = mm(P.kolomTtdMm);
  const xKanan = x0 + lebar - lebarKanan;
  const lebarKiri = xKanan - x0 - mm(5);
  const pembayaran = dok.surat.infoBank?.trim() || isiTokenRekening("{singkatanBank} {nomorRekening} an {atasNamaRekening}", identitas);
  const opsiKiri = { x: x0, lebar: lebarKiri, ukuran: P.huruf, warna: tinta };
  const opsiKanan = { x: xKanan, lebar: lebarKanan, ukuran: P.huruf, warna: tinta, rata: "tengah" as const };
  const nama = identitas.penandaTangan ?? "";
  const tinggiKiri = k.ukur("Payment:", { ...opsiKiri, font: "B" }).tinggi + k.ukur(pembayaran, opsiKiri).tinggi;
  const tinggiKanan = k.ukur(kotaTanggal(m, dok.tanggal), opsiKanan).tinggi + mm(P.ruangTtdMm) + k.ukur(nama || " ", { ...opsiKanan, font: "B" }).tinggi;
  ruangUtuh(k, Math.max(tinggiKiri, tinggiKanan));
  const y0 = k.y;
  let y = y0;
  y += k.teks("Payment:", { ...opsiKiri, y, font: "B" });
  k.teks(pembayaran, { ...opsiKiri, y });
  y = y0 + k.teks(kotaTanggal(m, dok.tanggal), { ...opsiKanan, y: y0 });
  const ttd = tandaTanganDipakai(m);
  if (ttd) k.gambar(ttd, { x: xKanan, y, muat: [lebarKanan, mm(P.ruangTtdMm)] }, "TANDA_TANGAN");
  y += mm(P.ruangTtdMm);
  if (nama) k.teks(nama, { ...opsiKanan, y, font: "B", garisBawah: true });
  k.y = y0 + Math.max(tinggiKiri, tinggiKanan);

  return k.selesai();
}
