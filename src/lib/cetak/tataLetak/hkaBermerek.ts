import { gambarTabel, type BarisTabel, type SelTabel } from "@/lib/cetak/mesin/tabel";
import { formatTanggalPendek } from "@/lib/cetak/format";
import { PUTIH, barisDicetak, berbutir, jarak, satuBaris, type MasukanTataLetak } from "@/lib/cetak/tataLetak/blok";
import {
  ABU,
  LABEL_NOMOR_HKA,
  butirHka,
  catatanPotonganHka,
  garisSisi,
  jumlahKwitansiHka,
  kepalaTengah,
  kwitansiHka,
  mulaiHka,
  nilaiTotal,
  o,
  paragrafHka,
  qtyBaris,
  rekeningHka,
  ringkasanHka,
  rpHka,
  sel,
  syaratHka,
  tabelTotalKanan,
  tandaTanganHka,
  tanggalKeduaHka,
  tint,
  uraianBaris,
  uraianKwitansiHka,
} from "@/lib/cetak/tataLetak/hkaStandar";

/*
 * Tata letak bermerek HKA (branded, spec/02 §12): kepala tengah, judul dengan tabel meta bergaris bawah, KEPADA dan
 * PEMBAYARAN KE dua kolom, tabel item berkepala aksen, TOTAL TAGIHAN, catatan bank, rekening, syarat, catatan, tanda
 * tangan, dan kaki bergelombang. Judul memakai warnaUtama kop (HKA tetap #1f3550, sama dengan bawaan kop generik).
 */

const GARIS_TABEL = "#C9D3DE";

export async function renderHkaBermerek(m: MasukanTataLetak, judulBerkas: string): Promise<Uint8Array> {
  const h = mulaiHka(m, judulBerkas, { gelombang: true, ikon: true });
  const { k, x0, W, mm, aksen } = h;
  const { dok, identitas: i } = m;
  const navy = m.tema.warnaUtama;
  const kw = kwitansiHka(m);

  kepalaTengah(h);
  jarak(k, mm(6));

  // Judul (kiri) dan meta (kanan 27 + 50 mm), garis bawah navy 1,4 pt
  {
    const wMeta = mm(80);
    const y = k.y;
    const kedua = tanggalKeduaHka(m, "Dibayar");
    const meta: [string, string][] = [
      [LABEL_NOMOR_HKA[dok.jenis], `: ${dok.nomorTampil}`],
      ["Tanggal", `: ${formatTanggalPendek(dok.tanggal)}`],
      [kedua.label, `: ${kedua.nilai}`],
    ];
    const tinggiMeta = meta.reduce((n, [a, b]) => n + Math.max(k.ukur(a, o(h, 9.5, { lebar: mm(27) })).tinggi, k.ukur(b, o(h, 9.5, { lebar: mm(50) })).tinggi) + 2, 0);
    const tinggiJudul = k.ukur(m.judul, o(h, 22, { lebar: W - wMeta, font: "B" })).tinggi;
    const tinggi = Math.max(tinggiMeta, tinggiJudul);
    k.teks(m.judul, o(h, 22, { y: y + (tinggi - tinggiJudul) / 2, lebar: W - wMeta, font: "B", warna: navy }));
    let yM = y + (tinggi - tinggiMeta) / 2;
    const xM = x0 + W - mm(77);
    for (const [label, nilai] of meta) {
      const a = k.teks(label, o(h, 9.5, { x: xM, y: yM, lebar: mm(27), font: "B", warna: ABU.sedang }));
      const b = k.teks(nilai, o(h, 9.5, { x: xM + mm(27), y: yM, lebar: mm(50) }));
      yM += Math.max(a, b) + 2;
    }
    const bawah = y + tinggi + 3;
    k.garis(x0, bawah, x0 + W, bawah, { warna: navy, tebal: 1.4 });
    k.y = bawah;
    jarak(k, mm(5));
  }

  // KEPADA | PEMBAYARAN KE
  {
    const w = W / 2;
    const y = k.y;
    let yL = y;
    yL += k.teks(kw ? "DITERIMA DARI" : "KEPADA", o(h, 10, { y: yL, lebar: w, font: "B", warna: navy }));
    yL += k.teks(kw ? (dok.kwitansi?.terimaDari ?? dok.kepada.nama) : satuBaris(dok.kepada.nama), o(h, 10, { y: yL, lebar: w, font: "B" }));
    for (const baris of [dok.kepada.up, dok.kepada.alamat, dok.kepada.telepon, dok.kepada.email]) if (baris?.trim()) yL += k.teks(baris.trim(), o(h, 9.5, { y: yL, lebar: w }));
    const xR = x0 + w;
    let yR = y;
    yR += k.teks("PEMBAYARAN KE", o(h, 10, { x: xR, y: yR, lebar: w, font: "B", warna: navy, rata: "kanan" }));
    yR += k.teks(i.nama, o(h, 10, { x: xR, y: yR, lebar: w, font: "B", rata: "kanan" }));
    if (i.namaLegal && i.namaLegal !== i.nama) yR += k.teks(i.namaLegal, o(h, 10, { x: xR, y: yR, lebar: w, font: "B", rata: "kanan" }));
    for (const baris of [i.alamat, i.telepon, i.email]) if (baris?.trim()) yR += k.teks(baris.trim(), o(h, 9.5, { x: xR, y: yR, lebar: w, rata: "kanan" }));
    k.y = Math.max(yL, yR);
    jarak(k, mm(6));
  }

  // Tabel item: kepala aksen, grid 0,6 pt
  const grid = { warna: GARIS_TABEL, tebal: 0.6 };
  const pad: [number, number, number, number] = [5, 5, 5, 5];
  const kepala = (isi: string, rata: SelTabel["rata"] = "kiri") => sel(h, isi, 10, { font: "B", warna: PUTIH, latar: aksen, rata, pad });
  const isi = (v: SelTabel["isi"], lain: Partial<SelTabel> = {}) => sel(h, v, 9.5, { pad, ...lain });
  if (kw) {
    gambarTabel(k, {
      x: x0,
      kolom: [mm(14), W - mm(59), mm(45)],
      garisBawaan: grid,
      kepala: { sel: [kepala("No.", "tengah"), kepala("Uraian"), kepala("Jumlah", "kanan")] },
      baris: [{ sel: [isi("1", { rata: "tengah" }), isi(uraianKwitansiHka(m)), isi(rpHka(m, jumlahKwitansiHka(m)), { rata: "kanan" })] }],
    });
    jarak(k, mm(3));
    paragrafHka(h, `Metode pembayaran: ${satuBaris(dok.kwitansi?.metodeBayar) || "-"} · Dibayar ${formatTanggalPendek(dok.tanggal)}`, 9.5);
    catatanPotonganHka(h, 9.5);
    jarak(k, mm(4));
  } else {
    gambarTabel(k, {
      x: x0,
      kolom: [mm(14), W - mm(32) - 0.38 * W, mm(18), 0.18 * W, 0.2 * W],
      garisBawaan: grid,
      kepala: { sel: [kepala("No.", "tengah"), kepala("Uraian"), kepala("Qty", "tengah"), kepala("Harga satuan", "kanan"), kepala("Jumlah", "kanan")] },
      baris: barisDicetak(m).map((b) => ({
        sel: [isi(String(b.no), { rata: "tengah" }), isi(uraianBaris(b, true)), isi(qtyBaris(m, b, true), { rata: "tengah" }), isi(rpHka(m, b.harga), { rata: "kanan" }), isi(rpHka(m, b.nilai), { rata: "kanan" })],
      })),
    });

    // TOTAL TAGIHAN rata kanan (42 + 46 mm)
    const r = ringkasanHka(m);
    const bawah = garisSisi(GARIS_TABEL, 0.6, ["bawah"]);
    const baris = (label: string, nilai: string, total = false): BarisTabel => {
      const u = total ? 12.5 : 10;
      const gaya: Partial<SelTabel> = { pad: [4, 4, 4, 4], garis: bawah, latar: total ? tint(aksen, 0.88) : undefined, warna: total ? navy : h.tinta };
      return { sel: [sel(h, label, u, { ...gaya, font: "B", rata: "kanan" }), sel(h, nilai, u, { ...gaya, font: total ? "B" : "R", rata: "kanan" })] };
    };
    tabelTotalKanan(h, [mm(42), mm(46)], [
      ...r.rinci.map((b) => baris(b.label, nilaiTotal(m, b))),
      baris("TOTAL TAGIHAN", rpHka(m, r.total), true),
      ...r.tambahan.map((b) => baris(b.label === "Uang muka" ? "UANG MUKA" : b.label, nilaiTotal(m, b), b.label === "Uang muka")),
    ]);
    jarak(k, mm(5));

    // Catatan bank, rekening, syarat
    if (i.catatanBank?.trim()) paragrafHka(h, i.catatanBank.trim(), 9.5, { warna: ABU.teks });
    const rekening = rekeningHka(m);
    if (rekening) {
      for (const [label, nilai] of rekening) {
        const y = k.y;
        const a = k.teks(label, o(h, 10, { y, lebar: mm(32), font: "B" }));
        const b = k.teks(`: ${nilai.trim() || "-"}`, o(h, 10, { x: x0 + mm(32), y, lebar: mm(80), font: "B" }));
        k.y = y + Math.max(a, b);
      }
    } else paragrafHka(h, dok.surat.infoBank!.trim(), 10, { font: "B" });
    const syarat = syaratHka(m);
    if (syarat) {
      jarak(k, mm(3));
      butirHka(h, syarat, 9, ABU.teks);
    }
  }

  if (berbutir(dok.surat.catatan).length) {
    jarak(k, mm(3));
    butirHka(h, dok.surat.catatan, 9, ABU.teks);
  }
  jarak(k, mm(4));
  tandaTanganHka(h);
  return k.selesai();
}
