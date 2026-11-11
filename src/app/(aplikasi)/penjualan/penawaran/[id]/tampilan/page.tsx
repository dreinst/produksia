import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { tanggalIso } from "@/lib/waktu";
import { KOLOM_TEKS_SURAT } from "@/lib/dokumenPenjualan";
import type { NilaiTeksDokumen } from "@/komponen/penjualan/IsianTeksDokumen";
import { nomorTampil } from "../../../_detail/bagian";
import { FormulirTampilanSurat, KepalaTampilan, barisTeksAwal, muatOpsiTampilan } from "../../../_tampilan/bagian";

/** Ubah tampilan penawaran (D2 §7.1), juga untuk penawaran yang sudah dikonversi: teks, kop, nomor cetak, add on, baris. */
export default async function HalamanTampilanPenawaran({ params }: { params: Promise<{ id: string }> }) {
  const pengguna = await wajibHak("penawaran.ubah");
  const { id } = await params;
  const p = await db.penawaranPenjualan.findUnique({
    where: { id },
    include: { baris: { orderBy: [{ urutan: "asc" }, { id: "asc" }], include: { barang: { select: { kode: true, nama: true, satuan: true } } } } },
  });
  if (!p) notFound();

  const opsi = await muatOpsiTampilan(p.perusahaanId);
  const teks: NilaiTeksDokumen = { judulCetak: p.judulCetak, nomorCetak: p.nomorCetak, kopSuratId: p.kopSuratId };
  for (const k of KOLOM_TEKS_SURAT) teks[k] = p[k];

  return (
    <div className="space-y-6 max-w-6xl">
      <KepalaTampilan jenis="penawaran" id={p.id} tampil={nomorTampil(p)} />
      <FormulirTampilanSurat
        jenis="penawaran"
        id={p.id}
        teks={teks}
        event={p.mode === "EVENT" ? p : null}
        baris={barisTeksAwal(p.baris)}
        opsi={opsi}
        bolehNego={punyaHak(pengguna, "harga.nego")}
        tambahan={
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bidang">
              <label className="label" htmlFor="berlakuSampai">
                Berlaku sampai
              </label>
              <input id="berlakuSampai" name="berlakuSampai" type="date" defaultValue={p.berlakuSampai ? tanggalIso(p.berlakuSampai) : ""} className="isian" />
            </div>
            <div className="hidden md:block" />
            <div className="bidang">
              <label className="label" htmlFor="nilaiAddOn">
                Add on
              </label>
              <input id="nilaiAddOn" name="nilaiAddOn" type="number" min={0} step="0.01" defaultValue={p.nilaiAddOn?.toString() ?? ""} className="isian" />
              <span className="petunjuk">Add on ditampilkan di bawah grand total, tidak dijumlahkan</span>
            </div>
            <div className="bidang">
              <label className="label" htmlFor="keteranganAddOn">
                Keterangan add on
              </label>
              <input id="keteranganAddOn" name="keteranganAddOn" maxLength={200} defaultValue={p.keteranganAddOn ?? ""} className="isian" />
            </div>
          </div>
        }
      />
    </div>
  );
}
