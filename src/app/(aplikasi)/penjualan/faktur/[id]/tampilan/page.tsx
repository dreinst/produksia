import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { tanggalIso } from "@/lib/waktu";
import { KOLOM_TEKS_SURAT } from "@/lib/dokumenPenjualan";
import type { NilaiTeksDokumen } from "@/komponen/penjualan/IsianTeksDokumen";
import { nomorTampil } from "../../../_detail/bagian";
import { FormulirTampilanSurat, KepalaTampilan, barisTeksAwal, muatOpsiTampilan } from "../../../_tampilan/bagian";

/**
 * Ubah tampilan faktur penjualan (D2 §7.1): teks surat, kop, nomor cetak, jatuh tempo, isian event, dan teks baris.
 * Nomor cetak faktur yang sudah disetujui hanya bisa diganti pemegang faktur.setujui (diperiksa server).
 */
export default async function HalamanTampilanFaktur({ params }: { params: Promise<{ id: string }> }) {
  const pengguna = await wajibHak("faktur.ubah");
  const { id } = await params;
  const f = await db.fakturPenjualan.findUnique({
    where: { id },
    include: { baris: { orderBy: [{ urutan: "asc" }, { id: "asc" }], include: { barang: { select: { kode: true, nama: true, satuan: true } } } } },
  });
  if (!f) notFound();

  const opsi = await muatOpsiTampilan(f.perusahaanId);
  const teks: NilaiTeksDokumen = { judulCetak: f.judulCetak, nomorCetak: f.nomorCetak, kopSuratId: f.kopSuratId };
  for (const k of KOLOM_TEKS_SURAT) teks[k] = f[k];
  const nomorTerkunci = f.statusPersetujuan === "DISETUJUI" && !punyaHak(pengguna, "faktur.setujui");

  return (
    <div className="space-y-6 max-w-6xl">
      <KepalaTampilan jenis="faktur" id={f.id} tampil={nomorTampil(f)} />
      <FormulirTampilanSurat
        jenis="faktur"
        id={f.id}
        teks={teks}
        event={f.mode === "EVENT" ? f : null}
        baris={barisTeksAwal(f.baris)}
        opsi={opsi}
        bolehNego={punyaHak(pengguna, "harga.nego")}
        catatanNomor={nomorTerkunci ? "Faktur ini sudah disetujui. Nomor cetaknya hanya bisa diganti pemegang hak setujui faktur." : undefined}
        tambahan={
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bidang">
              <label className="label" htmlFor="jatuhTempo">
                Jatuh tempo
              </label>
              <input id="jatuhTempo" name="jatuhTempo" type="date" min={tanggalIso(f.tanggal)} defaultValue={f.jatuhTempo ? tanggalIso(f.jatuhTempo) : ""} className="isian" />
              <span className="petunjuk">Tidak boleh sebelum tanggal faktur. Kosong = tidak diubah.</span>
            </div>
          </div>
        }
      />
    </div>
  );
}
