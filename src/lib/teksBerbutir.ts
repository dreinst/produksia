/*
 * Teks berbutir untuk deskripsi baris, catatan, dan syarat dokumen penjualan (D2 §6.3). Dipakai tata letak cetak
 * (D3) dan tampilan layar. Berkas ini murni tanpa impor, jadi aman untuk komponen klien. Hasilnya struktur data,
 * bukan HTML, sehingga teks pengguna tidak pernah dirender sebagai markup.
 */

export type PotonganTeks = { teks: string; tebal: boolean };
export type BarisTeks = { jenis: "paragraf" | "butir" | "subbutir"; isi: PotonganTeks[] };

/** Memecah "a **b** c" menjadi potongan biasa dan tebal. `**x**` dicari tidak serakah; `**` tanpa pasangan tetap teks. */
function uraiTebal(teks: string): PotonganTeks[] {
  const hasil: PotonganTeks[] = [];
  const pola = /\*\*(.+?)\*\*/g;
  let awal = 0;
  for (const m of teks.matchAll(pola)) {
    const posisi = m.index ?? 0;
    if (posisi > awal) hasil.push({ teks: teks.slice(awal, posisi), tebal: false });
    hasil.push({ teks: m[1], tebal: true });
    awal = posisi + m[0].length;
  }
  if (awal < teks.length) hasil.push({ teks: teks.slice(awal), tebal: false });
  return hasil;
}

/**
 * Aturan per baris (baris kosong dibuang, tiap baris dipangkas):
 * - awalan `**-` = sub-butir yang seluruh isinya tebal (penutup `**` di akhir dibuang);
 * - awalan `--` = sub-butir;
 * - awalan `-` atau `•` = butir;
 * - selain itu paragraf.
 * Di dalam isi, `**x**` menjadi potongan tebal, juga di sub-butir `-- **x**` (beda yang disengaja dengan HKA).
 */
export function uraiTeksBerbutir(teks: string | null | undefined): BarisTeks[] {
  if (!teks) return [];
  const hasil: BarisTeks[] = [];
  for (const mentah of teks.replace(/\r\n?/g, "\n").split("\n")) {
    const baris = mentah.trim();
    if (!baris) continue;
    if (baris.startsWith("**-")) {
      const isi = baris.slice(3).replace(/\*\*$/, "").trim();
      if (isi) hasil.push({ jenis: "subbutir", isi: [{ teks: isi, tebal: true }] });
      continue;
    }
    let jenis: BarisTeks["jenis"] = "paragraf";
    let isi = baris;
    if (baris.startsWith("--")) {
      jenis = "subbutir";
      isi = baris.slice(2).trim();
    } else if (baris.startsWith("-") || baris.startsWith("•")) {
      jenis = "butir";
      isi = baris.slice(1).trim();
    }
    if (!isi) continue;
    hasil.push({ jenis, isi: uraiTebal(isi) });
  }
  return hasil;
}
