import Link from "next/link";

/*
 * Isian lead (D4 §7.3, §3.1) di dalam FormulirAksi. Mode buat mengirim perusahaanId tersembunyi dan tahap awal; mode
 * ubah tanpa tahap dan perusahaan. PIC: "" = bawaan (buat: pembuat; ubah: PIC tetap), "-" = tanpa PIC. Tag dikirim
 * sebagai teks dipisah koma, field tambahan sebagai textarea "Nama: Nilai" per baris (kontrak P22).
 */

export type NilaiFormulirLead = {
  nama: string;
  namaUsaha: string;
  telepon: string;
  whatsapp: string;
  email: string | null;
  instagram: string | null;
  website: string | null;
  lokasi: string | null;
  sumber: string;
  picId: string | null;
  industri: string | null;
  nilaiEstimasi: string;
  tag: string[];
  fieldTambahan: string;
  catatan: string | null;
};

export default function FormulirLead({
  mode,
  perusahaanId,
  nilai,
  sumber,
  pengguna,
  picLama,
  tahapAwal = [],
  batalHref,
}: {
  mode: "buat" | "ubah";
  /** wajib untuk mode buat (isian tersembunyi) */
  perusahaanId?: string;
  nilai?: NilaiFormulirLead;
  /** nama sumber perusahaan lead; mode ubah menambah sumber lama bila sudah dihapus dari daftar */
  sumber: string[];
  /** pengguna aktif pemegang lead.lihat */
  pengguna: { id: string; nama: string }[];
  /** PIC tersimpan yang sudah tidak memenuhi syarat (ditandai nonaktif supaya simpan tanpa mengubah PIC tidak gagal) */
  picLama?: { id: string; nama: string } | null;
  /** tahap berjenis Berjalan, hanya mode buat */
  tahapAwal?: { id: string; nama: string }[];
  batalHref: string;
}) {
  const v = nilai;
  const sumberTampil = v?.sumber && !sumber.includes(v.sumber) ? [...sumber, v.sumber] : sumber;
  // PIC lama yang tidak lagi memenuhi syarat dikirim "" (PIC tetap), karena id-nya akan ditolak validasi server
  const picTerpilih = mode === "ubah" ? (picLama ? "" : (v?.picId ?? "-")) : "";
  return (
    <>
      {mode === "buat" && perusahaanId && <input type="hidden" name="perusahaanId" value={perusahaanId} />}
      <h2 className="teks-label md:col-span-2">Kontak</h2>
      <div className="bidang">
        <label className="label" htmlFor="nama">
          Nama kontak *
        </label>
        <input id="nama" name="nama" required maxLength={120} defaultValue={v?.nama ?? ""} className="isian" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor="namaUsaha">
          Perusahaan/usaha *
        </label>
        <input id="namaUsaha" name="namaUsaha" required maxLength={120} defaultValue={v?.namaUsaha ?? ""} className="isian" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor="telepon">
          Telepon *
        </label>
        <input id="telepon" name="telepon" type="tel" required minLength={3} maxLength={40} defaultValue={v?.telepon ?? ""} className="isian" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor="whatsapp">
          WhatsApp *
        </label>
        <input id="whatsapp" name="whatsapp" type="tel" required minLength={3} maxLength={40} defaultValue={v?.whatsapp ?? ""} className="isian" />
        <span className="petunjuk">Boleh sama dengan telepon</span>
      </div>
      <div className="bidang">
        <label className="label" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" maxLength={120} defaultValue={v?.email ?? ""} className="isian" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor="instagram">
          Instagram
        </label>
        <input id="instagram" name="instagram" maxLength={200} defaultValue={v?.instagram ?? ""} className="isian" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor="website">
          Situs web
        </label>
        <input id="website" name="website" maxLength={200} defaultValue={v?.website ?? ""} className="isian" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor="lokasi">
          Lokasi
        </label>
        <input id="lokasi" name="lokasi" maxLength={200} defaultValue={v?.lokasi ?? ""} className="isian" />
      </div>

      <h2 className="teks-label md:col-span-2 pt-2">Peluang</h2>
      <div className="bidang">
        <label className="label" htmlFor="sumber">
          Sumber lead *
        </label>
        <select id="sumber" name="sumber" required defaultValue={v?.sumber ?? ""} className="isian">
          <option value="">Pilih sumber…</option>
          {sumberTampil.map((s) => (
            <option key={s} value={s}>
              {s}
              {v?.sumber === s && !sumber.includes(s) ? " (sudah dihapus dari daftar)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor="picId">
          PIC / Sales
        </label>
        <select id="picId" name="picId" defaultValue={picTerpilih} className="isian">
          {mode === "buat" && <option value="">Saya</option>}
          <option value="-">Tanpa PIC</option>
          {picLama && (
            <option value="">
              {picLama.nama} (nonaktif)
            </option>
          )}
          {pengguna.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nama}
            </option>
          ))}
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor="industri">
          Industri
        </label>
        <input id="industri" name="industri" maxLength={120} defaultValue={v?.industri ?? ""} className="isian" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor="nilaiEstimasi">
          Perkiraan nilai deal (Rp)
        </label>
        <input id="nilaiEstimasi" name="nilaiEstimasi" type="number" min="0" step="0.01" inputMode="decimal" defaultValue={v?.nilaiEstimasi ?? ""} className="isian angka" />
      </div>
      {mode === "buat" && (
        <div className="bidang">
          <label className="label" htmlFor="tahapId">
            Tahap awal
          </label>
          <select id="tahapId" name="tahapId" defaultValue="" className="isian">
            <option value="">Tahap pertama</option>
            {tahapAwal.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nama}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="bidang md:col-span-2">
        <label className="label" htmlFor="tag">
          Tag
        </label>
        <input id="tag" name="tag" defaultValue={v?.tag.join(", ") ?? ""} className="isian" />
        <span className="petunjuk">Pisahkan dengan koma</span>
      </div>
      <div className="bidang md:col-span-2">
        <label className="label" htmlFor="fieldTambahan">
          Field tambahan
        </label>
        <textarea id="fieldTambahan" name="fieldTambahan" defaultValue={v?.fieldTambahan ?? ""} className="isian h-auto min-h-24 py-2" />
        <span className="petunjuk">Satu per baris, format Nama: Nilai</span>
      </div>
      <div className="bidang md:col-span-2">
        <label className="label" htmlFor="catatan">
          Catatan
        </label>
        <textarea id="catatan" name="catatan" maxLength={5000} defaultValue={v?.catatan ?? ""} className="isian h-auto min-h-24 py-2" />
      </div>
      <div className="md:col-span-2 flex flex-wrap items-center gap-3">
        <button type="submit" className="tombol tombol-utama w-full sm:w-auto min-h-11">
          {mode === "buat" ? "Buat lead" : "Simpan perubahan"}
        </button>
        <Link href={batalHref} className="tombol-tautan">
          Batal
        </Link>
      </div>
    </>
  );
}
