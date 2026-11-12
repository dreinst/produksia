import { gambarTabel, type BarisTabel, type SelTabel } from "@/lib/cetak/mesin/tabel";
import { formatAngka, formatTanggalPanjang } from "@/lib/cetak/format";
import type { Desimal } from "@/lib/uang";
import { barisDicetak, berbutir, jarak, satuBaris, tandaTanganDipakai, type MasukanTataLetak } from "@/lib/cetak/tataLetak/blok";
import {
  ABU,
  alamatHka,
  barisLabelHka,
  berspasi,
  butirHka,
  catatanPotonganHka,
  garisSisi,
  jumlahKwitansiHka,
  kwitansiHka,
  mulaiHka,
  o,
  paragrafHka,
  penerimaHka,
  qtyBaris,
  rekeningHka,
  ringkasanHka,
  sel,
  syaratHka,
  tandaTanganHka,
  uraianKwitansiHka,
} from "@/lib/cetak/tataLetak/hkaStandar";

/*
 * Tata letak minimal HKA (spec/02 §14): monokrom warna aksen kop, logo kiri dan merek kanan, judul berspasi huruf besar,
 * meta KEPADA/TANGGAL, tabel URAIAN/QTY/SATUAN/JUMLAH tanpa harga satuan, TOTAL TAGIHAN, BAYAR KE, syarat, catatan,
 * tanda tangan hanya bila kop punya nama penanda tangan atau gambar tanda tangan, garis penutup tebal, kaki teks.
 */

export async function renderHkaMinimal(m: MasukanTataLetak, judulBerkas: string): Promise<Uint8Array> {
  const h = mulaiHka(m, judulBerkas, { gelombang: false, ikon: true });
  // spec/02 §14: warna tinta minimal = warna aksen kop (cadangan #111111). Teks kaki di dekorasi tidak memakai
  // h.tinta (dekorasiHka memakai ABU.label), jadi perubahan sesudah mulaiHka ini hanya berlaku untuk isi dokumen.
  h.tinta = h.aksen || "#111111";
  const { k, x0, W, mm, tinta } = h;
  const { dok, identitas: i } = m;
  const kw = kwitansiHka(m);
  const angka = (d: Desimal) => formatAngka(d, m.tema.gayaAngka, m.tema.desimal);

  // Kepala dua kolom: logo (atau nama) kiri, merek dan teks kepala kanan, rata tengah tegak
  {
    const w = W / 2;
    const y = k.y;
    const logo = m.tema.aset.LOGO;
    const hKiri = logo ? mm(18) : k.ukur(i.nama, o(h, 14, { lebar: w, font: "B" })).tinggi;
    const merek = k.ukur(i.judulMerek, o(h, 20, { lebar: w, font: "B" })).tinggi;
    const kepala = i.teksKepala?.trim() ? berspasi(i.teksKepala.trim().toLocaleUpperCase("id-ID")) : null;
    const hKepala = kepala ? k.ukur(kepala, o(h, 8.5, { lebar: w })).tinggi : 0;
    const tinggi = Math.max(hKiri, merek + hKepala);
    if (logo) k.gambar(logo, { x: x0, y: y + (tinggi - hKiri) / 2, muat: [w, mm(18)], rata: "kiri" }, "LOGO");
    else k.teks(i.nama, o(h, 14, { y: y + (tinggi - hKiri) / 2, lebar: w, font: "B" }));
    let yK = y + (tinggi - merek - hKepala) / 2;
    yK += k.teks(i.judulMerek, o(h, 20, { x: x0 + w, y: yK, lebar: w, font: "B", rata: "kanan" }));
    if (kepala) k.teks(kepala, o(h, 8.5, { x: x0 + w, y: yK, lebar: w, warna: ABU.gelap, rata: "kanan" }));
    k.y = y + tinggi;
  }
  jarak(k, mm(10));
  paragrafHka(h, berspasi(m.judul.toLocaleUpperCase("id-ID")), 30, { rata: "kanan" });
  paragrafHka(h, dok.nomorTampil, 11, { font: "B", warna: "#222222", rata: "kanan" });
  jarak(k, mm(9));

  // Meta (52 mm + sisa)
  const meta: [string, string][] = [
    [kw ? "DITERIMA DARI:" : "KEPADA:", penerimaHka(m, kw).toLocaleUpperCase("id-ID")],
    ["TANGGAL:", formatTanggalPanjang(dok.tanggal).toLocaleUpperCase("id-ID")],
  ];
  if (!kw && dok.tanggalKedua) meta.push([`${dok.tanggalKedua.label.toLocaleUpperCase("id-ID")}:`, formatTanggalPanjang(dok.tanggalKedua.tanggal).toLocaleUpperCase("id-ID")]);
  const alamat = alamatHka(h, dok.kepada.alamat);
  if (alamat) meta.push(["ALAMAT:", alamat]);
  for (const [label, nilai] of meta) {
    const y = k.y;
    const a = k.teks(berspasi(label), o(h, 10, { y, lebar: mm(52), font: "B" }));
    const b = k.teks(nilai, o(h, 10.5, { x: x0 + mm(52), y, lebar: W - mm(52), warna: ABU.teks }));
    k.y = y + Math.max(a, b) + 2;
  }
  jarak(k, mm(4));

  // Tabel item: garis atas kepala 0,8, bawah kepala 2, bawah baris terakhir 0,8
  const pad: [number, number, number, number] = [9, 4, 12, 4];
  const kepala = (isi: string, rata: SelTabel["rata"], tebal: boolean) => sel(h, berspasi(isi), 9.5, { font: tebal ? "B" : "R", rata, pad, garis: garisSisi(tinta, 2, ["bawah"]) });
  const isi = (v: SelTabel["isi"], akhir: boolean, lain: Partial<SelTabel> = {}) => sel(h, v, 10, { pad, garis: akhir ? garisSisi(tinta, 0.8, ["bawah"]) : null, ...lain });
  k.pastikanRuang(mm(30));
  k.garis(x0, k.y, x0 + W, k.y, { warna: tinta, tebal: 0.8 });
  if (kw) {
    gambarTabel(k, {
      x: x0,
      kolom: [0.78 * W, 0.22 * W],
      kepala: { sel: [kepala("URAIAN", "kiri", true), kepala("JUMLAH", "kanan", true)] },
      baris: [{ sel: [isi(uraianKwitansiHka(m), true, { font: "B" }), isi(angka(jumlahKwitansiHka(m)), true, { rata: "kanan", warna: ABU.teks })] }],
    });
  } else {
    const baris = barisDicetak(m);
    gambarTabel(k, {
      x: x0,
      kolom: [0.48, 0.14, 0.16, 0.22].map((p) => p * W),
      kepala: { sel: [kepala("URAIAN", "kiri", true), kepala("QTY", "tengah", false), kepala("SATUAN", "tengah", false), kepala("JUMLAH", "kanan", true)] },
      baris: baris.map((b, n) => {
        const akhir = n === baris.length - 1;
        const deskripsi = berbutir(b.deskripsi);
        const uraian: SelTabel["isi"] = deskripsi.length ? [{ jenis: "paragraf", isi: [{ teks: b.nama, tebal: true }] }, ...deskripsi] : [{ jenis: "paragraf", isi: [{ teks: b.nama, tebal: true }] }];
        return { sel: [isi(uraian, akhir, { warna: ABU.gelap }), isi(qtyBaris(m, b), akhir, { rata: "tengah" }), isi(b.satuan, akhir, { rata: "tengah" }), isi(angka(b.nilai), akhir, { rata: "kanan", warna: ABU.teks })] };
      }),
    });
  }
  jarak(k, mm(3));

  // Ringkasan (52 + 36 mm): garis 2 pt di atas TOTAL TAGIHAN dan di bawah baris terakhir
  {
    const r = ringkasanHka(m);
    const atas = garisSisi(tinta, 2, ["atas"]);
    const bawah = garisSisi(tinta, 2, ["bawah"]);
    const baris = (label: string, nilai: string, uLabel: number, uNilai: number, tebal: boolean, garis: SelTabel["garis"]): BarisTabel => ({
      sel: [
        sel(h, berspasi(label.toLocaleUpperCase("id-ID")), uLabel, { font: tebal ? "B" : "R", warna: tebal ? tinta : ABU.teks, rata: "kanan", pad: [3, 3, 3, 3], garis }),
        sel(h, nilai, uNilai, { font: tebal ? "B" : "R", rata: "kanan", pad: [3, 0, 3, 3], garis }),
      ],
    });
    const isiBaris: BarisTabel[] = [];
    if (!kw && (r.rinci.length > 1)) for (const b of r.rinci) isiBaris.push(baris(b.label, `${b.kurang ? "- " : ""}${angka(b.nilai)}`, 9, 10, false, null));
    const tambahan = kw ? [] : r.tambahan;
    isiBaris.push(baris(kw ? "JUMLAH DIBAYAR" : "TOTAL TAGIHAN", angka(kw ? jumlahKwitansiHka(m) : r.total), 11, 12, true, tambahan.length ? atas : garisSisi(tinta, 2, ["atas", "bawah"])));
    tambahan.forEach((b, n) => isiBaris.push(baris(b.label, angka(b.nilai), 9, 10, b.label === "Uang muka", n === tambahan.length - 1 ? bawah : null)));
    const lebar = mm(88);
    gambarTabel(k, { x: x0 + W - lebar, kolom: [mm(52), mm(36)], baris: isiBaris, ulangKepala: false });
    if (kw) catatanPotonganHka(h);
  }
  jarak(k, mm(12));

  // BAYAR KE
  if (!kw) {
    // Judul, jarak 2 mm, dan baris rekening diukur bersama lalu pindah halaman utuh (judul tidak tertinggal sendirian)
    const judulBayar = berspasi("BAYAR KE:");
    const judul = {
      tinggi: k.ukur(judulBayar, o(h, 12, { font: "B" })).tinggi + mm(2),
      gambar: () => {
        paragrafHka(h, judulBayar, 12, { font: "B" });
        jarak(k, mm(2));
      },
    };
    const rekening = rekeningHka(m);
    if (rekening) {
      const urut: [string, string][] = [rekening[0], rekening[2], rekening[1]];
      barisLabelHka(
        h,
        urut.map(([label, nilai]) => [berspasi(label.toLocaleUpperCase("id-ID")), nilai.trim() || "-"]),
        (_, y) => o(h, 9, { y, lebar: mm(52), warna: ABU.sedang }),
        (_, y) => o(h, 10, { x: x0 + mm(52), y, lebar: W - mm(52) }),
        judul,
      );
    } else {
      judul.gambar();
      paragrafHka(h, dok.surat.infoBank!.trim(), 10);
    }
    const syarat = syaratHka(m);
    if (syarat) {
      jarak(k, mm(3));
      butirHka(h, syarat, 9, ABU.teks);
    }
  } else if (dok.kwitansi?.metodeBayar) paragrafHka(h, `Metode pembayaran: ${satuBaris(dok.kwitansi.metodeBayar)}`, 10);
  if (berbutir(dok.surat.catatan).length) {
    jarak(k, mm(3));
    butirHka(h, dok.surat.catatan, 9, ABU.teks);
  }

  // Tanda tangan hanya bila kop punya penanda tangan atau gambarnya dibubuhkan
  if (i.penandaTangan?.trim() || tandaTanganDipakai(m)) {
    jarak(k, mm(6));
    tandaTanganHka(h);
  }
  jarak(k, mm(4));
  k.pastikanRuang(2);
  k.garis(x0, k.y, x0 + W, k.y, { warna: tinta, tebal: 2 });
  return k.selesai();
}
