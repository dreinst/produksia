import { PilihKopSurat, type KopPilihan } from "@/komponen/penjualan/IsianTeksDokumen";

/*
 * Isian kuitansi penerimaan dan uang muka (D2 §7.5): judul, nomor cetak, terima dari, keperluan, kop, dan catatan
 * (penerimaan). Tanpa hook, boleh menjadi anak FormulirAksi. Nama isian = KOLOM_TEKS_PENERIMAAN atau
 * KOLOM_TEKS_UANG_MUKA ditambah kopSuratId dan nomorCetak.
 */
export default function IsianKwitansi({
  nilai = {},
  daftarKop,
  nomorOtomatis = false,
  namaPelanggan,
  denganCatatan = false,
  awalan = "kwitansi",
}: {
  nilai?: Partial<Record<string, string | null>>;
  daftarKop: readonly KopPilihan[];
  nomorOtomatis?: boolean;
  /** placeholder "Terima dari" */
  namaPelanggan?: string;
  /** penerimaan punya kolom catatan; uang muka tidak */
  denganCatatan?: boolean;
  awalan?: string;
}) {
  const v = (k: string) => nilai[k] ?? "";
  const id = (k: string) => `${awalan}-${k}`;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bidang">
        <label className="label" htmlFor={id("judulCetak")}>
          Judul kuitansi
        </label>
        <input id={id("judulCetak")} name="judulCetak" type="text" maxLength={60} defaultValue={v("judulCetak")} placeholder="KWITANSI" className="isian" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor={id("nomorCetak")}>
          Nomor kuitansi
        </label>
        <input id={id("nomorCetak")} name="nomorCetak" type="text" maxLength={60} defaultValue={v("nomorCetak")} className="isian mono" />
        {nomorOtomatis && <span className="petunjuk">Kosongkan untuk nomor otomatis</span>}
      </div>
      <div className="bidang">
        <label className="label" htmlFor={id("terimaDari")}>
          Terima dari
        </label>
        <input id={id("terimaDari")} name="terimaDari" type="text" maxLength={200} defaultValue={v("terimaDari")} placeholder={namaPelanggan} className="isian" />
        <span className="petunjuk">Kosong = nama pelanggan</span>
      </div>
      <div className="bidang">
        <label className="label" htmlFor={id("keperluan")}>
          Digunakan untuk
        </label>
        <input id={id("keperluan")} name="keperluan" type="text" maxLength={300} defaultValue={v("keperluan")} className="isian" />
      </div>
      <PilihKopSurat daftarKop={daftarKop} nilai={nilai.kopSuratId} id={id("kopSuratId")} />
      {denganCatatan && (
        <div className="bidang md:col-span-2">
          <label className="label" htmlFor={id("catatan")}>
            Catatan
          </label>
          <textarea id={id("catatan")} name="catatan" rows={2} maxLength={3000} defaultValue={v("catatan")} className="isian" />
        </div>
      )}
    </div>
  );
}
