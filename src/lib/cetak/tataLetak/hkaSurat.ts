import { gambarTabel, type BarisTabel, type SelTabel } from "@/lib/cetak/mesin/tabel";
import { formatTanggalPanjang } from "@/lib/cetak/format";
import { barisDicetak, berbutir, hurufJudul, jarak, satuBaris, type MasukanTataLetak } from "@/lib/cetak/tataLetak/blok";
import {
  butirHka,
  catatanPotonganHka,
  jumlahKwitansiHka,
  kepalaTengah,
  kwitansiHka,
  mulaiHka,
  nilaiTotal,
  o,
  paragrafHka,
  qtyHka,
  ringkasanHka,
  rpHka,
  sel,
  syaratHka,
  tandaTanganHka,
  uraianBaris,
  uraianKwitansiHka,
} from "@/lib/cetak/tataLetak/hkaStandar";

/*
 * Tata letak surat / SPH HKA (letter, spec/02 §13): kepala tengah, kota dan tanggal, Nomor, Lampiran, Perihal,
 * Kepada, pembuka, tabel spesifikasi dengan baris total di dalamnya, catatan kiri dan kanan berbingkai, syarat,
 * penutup, tanda tangan, kaki bergelombang. Tetap tanpa blok rekening (perilaku HKA, D3 §3.8).
 */

const GARIS = { warna: "#222222", tebal: 0.8 };

export async function renderHkaSurat(m: MasukanTataLetak, judulBerkas: string): Promise<Uint8Array> {
  const h = mulaiHka(m, judulBerkas, { gelombang: true, ikon: true });
  const { k, x0, W, mm } = h;
  const { dok, identitas: i } = m;
  const kw = kwitansiHka(m);

  kepalaTengah(h);
  jarak(k, mm(5));
  paragrafHka(h, i.kota ? `${i.kota}, ${formatTanggalPanjang(dok.tanggal)}` : formatTanggalPanjang(dok.tanggal), 10, { rata: "kanan" });
  jarak(k, mm(5));

  // Nomor, Lampiran, Perihal, Kepada (34 mm + sisa)
  const kepada = [satuBaris(dok.kepada.up), kw ? satuBaris(dok.kwitansi?.terimaDari ?? dok.kepada.nama) : satuBaris(dok.kepada.nama)].filter(Boolean).join(" - ");
  const meta: [string, string][] = [
    ["Nomor", dok.nomorTampil],
    ["Lampiran", satuBaris(dok.surat.lampiran) || "-"],
    ["Perihal", satuBaris(dok.surat.perihal) || hurufJudul(m.judul)],
    ["Kepada", kepada],
  ];
  for (const [label, nilai] of meta) {
    const y = k.y;
    const a = k.teks(label, o(h, 10, { y, lebar: mm(34) }));
    const b = k.teks(`: ${nilai}`, o(h, 10, { x: x0 + mm(34), y, lebar: W - mm(34) }));
    k.y = y + Math.max(a, b);
  }
  jarak(k, mm(4));
  if (dok.surat.teksPembuka?.trim()) {
    paragrafHka(h, dok.surat.teksPembuka.trim(), 10);
    jarak(k, mm(4));
  }

  // Tabel: grid #222 0,8 pt, kepala tengah 10, baris total di dalam tabel
  const pad: [number, number, number, number] = [5, 5, 5, 5];
  // kepala dengan pad samping kecil supaya "Satuan" muat di kolom 13 mm
  const kepala = (isi: string) => sel(h, isi, 10, { font: "B", rata: "tengah", pad: [5, 1.5, 5, 1.5] });
  const isi = (v: SelTabel["isi"], lain: Partial<SelTabel> = {}) => sel(h, v, 10, { pad, ...lain });
  if (kw) {
    gambarTabel(k, {
      x: x0,
      kolom: [mm(12), W - mm(57), mm(45)],
      garisBawaan: GARIS,
      kepala: { sel: [kepala("No"), kepala("Uraian"), kepala("Jumlah")] },
      baris: [{ sel: [isi("1", { rata: "tengah" }), isi(uraianKwitansiHka(m)), isi(rpHka(m, jumlahKwitansiHka(m), "Rp. "), { rata: "kanan" })] }],
    });
    jarak(k, mm(2));
    paragrafHka(h, `Metode pembayaran: ${satuBaris(dok.kwitansi?.metodeBayar) || "-"}`, 10);
    catatanPotonganHka(h, 10);
  } else {
    const baris = barisDicetak(m);
    const r = ringkasanHka(m);
    const kosong = (span: number) => isi("", { span });
    const total = (label: string, nilai: string, tebal: boolean, u: number): BarisTabel => ({
      sel: [kosong(5), isi(label, { font: "B", ukuran: u, tinggiBaris: { pasti: 1.35 * u } }), isi(nilai, { font: tebal ? "B" : "R", ukuran: u, rata: "kanan", tinggiBaris: { pasti: 1.35 * u } })],
    });
    const adaRinci = r.rinci.length > 1 || baris.length > 1;
    gambarTabel(k, {
      x: x0,
      kolom: [mm(10), mm(30), W - mm(131), mm(12), mm(13), mm(30), mm(36)],
      garisBawaan: GARIS,
      kepala: { sel: ["No", "Item", "Spesifikasi", "Qty", "Satuan", "Harga", "Total Harga"].map(kepala) },
      baris: [
        ...baris.map((b) => ({
          sel: [
            isi(String(b.no), { rata: "tengah" }),
            isi(b.nama),
            isi(uraianBaris(b, false)),
            isi(b.frekuensi.equals(1) ? qtyHka(m, b.jumlah) : `${qtyHka(m, b.jumlah)} × ${qtyHka(m, b.frekuensi)}`, { rata: "tengah" }),
            isi(b.satuan, { rata: "tengah" }),
            isi(rpHka(m, b.harga, "Rp. "), { rata: "kanan" }),
            isi(rpHka(m, b.nilai, "Rp. "), { rata: "kanan" }),
          ],
        })),
        ...(adaRinci ? r.rinci.map((b) => total(b.label, nilaiTotal(m, b, "Rp. "), false, 9.5)) : []),
        total("Total", rpHka(m, r.total, "Rp. "), true, 10),
        ...r.tambahan.map((b) => total(b.label, nilaiTotal(m, b, "Rp. "), true, 10)),
      ],
    });
  }
  jarak(k, mm(5));

  // Catatan kiri dan kanan berbingkai
  const kiri = berbutir(dok.surat.catatan);
  const kanan = berbutir(dok.surat.catatanKanan);
  if (kiri.length || kanan.length) {
    const kotak = (v: typeof kiri): SelTabel => sel(h, v.length ? v : "", 10, { pad: [6, 5, 10, 5] });
    gambarTabel(k, { x: x0, kolom: [W / 2, W / 2], garisBawaan: GARIS, baris: [{ sel: [kotak(kiri), kotak(kanan)] }] });
    jarak(k, mm(5));
  }
  const syarat = syaratHka(m);
  if (syarat && butirHka(h, syarat, 10, h.tinta)) jarak(k, mm(3));
  if (dok.surat.teksPenutup?.trim()) {
    paragrafHka(h, dok.surat.teksPenutup.trim(), 10);
    jarak(k, mm(3));
  }
  jarak(k, mm(2));
  tandaTanganHka(h);
  return k.selesai();
}
