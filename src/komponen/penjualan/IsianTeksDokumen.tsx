/*
 * Isian teks surat dokumen penjualan (D2 §7.2): judul dan nomor cetak, tujuan surat, paragraf, catatan, syarat
 * pembayaran, info rekening, dan kop. Tanpa hook dan tanpa impor server, jadi boleh dipakai komponen server maupun
 * klien (PenyusunFaktur). Nama isian sama dengan kolom yang dibaca server (KOLOM_TEKS_* di dokumenPenjualan.ts); batas
 * panjang di sini hanya bantuan, server tetap memeriksa.
 */

export type KopPilihan = { id: string; nama: string; bawaan: boolean };
export type JenisIsianTeks = "penawaran" | "pesanan" | "faktur";
export type NilaiTeksDokumen = Partial<Record<string, string | null>>;

type Bidang = { nama: string; label: string; batas: number; jenis?: "teks" | "panjang" | "email"; petunjuk?: string; placeholder?: string };

const TUJUAN: Bidang[] = [
  { nama: "kepada", label: "Kepada", batas: 200, petunjuk: "Kosong = nama pelanggan" },
  { nama: "kepadaUp", label: "U.p.", batas: 120 },
  { nama: "kepadaAlamat", label: "Alamat tujuan", batas: 500, jenis: "panjang" },
  { nama: "kepadaTelepon", label: "Telepon tujuan", batas: 40 },
  { nama: "kepadaEmail", label: "Email tujuan", batas: 120, jenis: "email" },
];

const SURAT: Bidang[] = [
  { nama: "perihal", label: "Perihal", batas: 200 },
  { nama: "lampiran", label: "Lampiran", batas: 60 },
  { nama: "referensi", label: "Referensi", batas: 120 },
];

const PARAGRAF: Bidang[] = [
  { nama: "teksPembuka", label: "Paragraf pembuka", batas: 3000, jenis: "panjang" },
  { nama: "teksPenutup", label: "Paragraf penutup", batas: 3000, jenis: "panjang" },
  { nama: "catatan", label: "Catatan", batas: 3000, jenis: "panjang", placeholder: "Satu poin per baris: - butir, -- sub-butir, **tebal**" },
  { nama: "catatanKanan", label: "Catatan kanan", batas: 3000, jenis: "panjang" },
  { nama: "syaratPembayaran", label: "Syarat pembayaran", batas: 3000, jenis: "panjang" },
  { nama: "infoBank", label: "Info rekening", batas: 1000, jenis: "panjang", petunjuk: "Kosong = rekening perusahaan penerbit" },
];

function Isian({ b, nilai, awalan }: { b: Bidang; nilai: string; awalan: string }) {
  const id = `${awalan}-${b.nama}`;
  const panjang = b.jenis === "panjang";
  return (
    <div className={`bidang ${panjang ? "md:col-span-2" : ""}`}>
      <label className="label" htmlFor={id}>
        {b.label}
      </label>
      {panjang ? (
        <textarea id={id} name={b.nama} rows={3} maxLength={b.batas} defaultValue={nilai} placeholder={b.placeholder} className="isian" />
      ) : (
        // email memakai type="text" + inputMode: validasi email peramban lebih ketat dari POLA_EMAIL server, dan isian di
        // dalam <details> tertutup yang ditolak peramban memblokir kirim tanpa pesan. Server tetap memvalidasi.
        <input id={id} name={b.nama} type="text" inputMode={b.jenis === "email" ? "email" : undefined} maxLength={b.batas} defaultValue={nilai} placeholder={b.placeholder} className="isian" />
      )}
      {b.petunjuk && <span className="petunjuk">{b.petunjuk}</span>}
    </div>
  );
}

/** Pilihan kop surat milik perusahaan dokumen. Tidak dirender bila perusahaan belum punya kop (kunci tidak dikirim). */
export function PilihKopSurat({ daftarKop, nilai, id = "kopSuratId" }: { daftarKop: readonly KopPilihan[]; nilai?: string | null; id?: string }) {
  if (daftarKop.length === 0) return null;
  const awal = nilai && daftarKop.some((k) => k.id === nilai) ? nilai : "";
  return (
    <div className="bidang">
      <label className="label" htmlFor={id}>
        Kop surat
      </label>
      <select id={id} name="kopSuratId" defaultValue={awal} className="isian">
        <option value="">Kop bawaan perusahaan</option>
        {daftarKop.map((k) => (
          <option key={k.id} value={k.id}>
            {k.nama}
            {k.bawaan ? " (bawaan)" : ""}
          </option>
        ))}
      </select>
      <span className="petunjuk">Kosong = kop bawaan perusahaan</span>
    </div>
  );
}

export default function IsianTeksDokumen({
  jenis,
  nilai = {},
  daftarKop,
  tampilkanJudulNomor = jenis !== "pesanan",
  nomorOtomatis = false,
  awalan = "teks",
}: {
  jenis: JenisIsianTeks;
  /** nilai awal per nama isian (teks surat, kopSuratId, nomorCetak, judulCetak) */
  nilai?: NilaiTeksDokumen;
  daftarKop: readonly KopPilihan[];
  /** judul cetak dan nomor cetak (penawaran dan faktur; pesanan tidak punya) */
  tampilkanJudulNomor?: boolean;
  /** format nomor cetak aktif untuk jenis ini: nomor kosong diisi otomatis */
  nomorOtomatis?: boolean;
  /** awalan id isian, supaya dua isian di satu halaman tidak bentrok */
  awalan?: string;
}) {
  const v = (k: string) => nilai[k] ?? "";
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {tampilkanJudulNomor && (
        <>
          <Isian b={{ nama: "judulCetak", label: "Judul cetak", batas: 60, placeholder: jenis === "faktur" ? "INVOICE" : "PENAWARAN" }} nilai={v("judulCetak")} awalan={awalan} />
          <div className="bidang">
            <label className="label" htmlFor={`${awalan}-nomorCetak`}>
              Nomor cetak
            </label>
            <input id={`${awalan}-nomorCetak`} name="nomorCetak" type="text" maxLength={60} defaultValue={v("nomorCetak")} className="isian mono" />
            <span className="petunjuk">{nomorOtomatis ? "Kosongkan untuk nomor otomatis" : "Kosong = nomor internal dokumen"}</span>
          </div>
        </>
      )}
      {TUJUAN.map((b) => (
        <Isian key={b.nama} b={b} nilai={v(b.nama)} awalan={awalan} />
      ))}
      {SURAT.map((b) => (
        <Isian key={b.nama} b={b} nilai={v(b.nama)} awalan={awalan} />
      ))}
      <PilihKopSurat daftarKop={daftarKop} nilai={nilai.kopSuratId} id={`${awalan}-kopSuratId`} />
      {PARAGRAF.map((b) => (
        <Isian key={b.nama} b={b} nilai={v(b.nama)} awalan={awalan} />
      ))}
    </div>
  );
}
