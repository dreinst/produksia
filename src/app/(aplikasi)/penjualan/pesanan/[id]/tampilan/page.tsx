import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { KOLOM_TEKS_SURAT } from "@/lib/dokumenPenjualan";
import type { NilaiTeksDokumen } from "@/komponen/penjualan/IsianTeksDokumen";
import { FormulirTampilanSurat, KepalaTampilan, barisTeksAwal, muatOpsiTampilan } from "../../../_tampilan/bagian";

/** Ubah tampilan pesanan penjualan (D2 §7.1): teks surat, kop, isian event, dan teks baris. Pesanan tidak punya nomor cetak. */
export default async function HalamanTampilanPesanan({ params }: { params: Promise<{ id: string }> }) {
  const pengguna = await wajibHak("pesanan.ubah");
  const { id } = await params;
  const p = await db.pesananPenjualan.findUnique({
    where: { id },
    include: { baris: { orderBy: [{ urutan: "asc" }, { id: "asc" }], include: { barang: { select: { kode: true, nama: true, satuan: true } } } } },
  });
  if (!p) notFound();

  const opsi = await muatOpsiTampilan(p.perusahaanId);
  const teks: NilaiTeksDokumen = { kopSuratId: p.kopSuratId };
  for (const k of KOLOM_TEKS_SURAT) teks[k] = p[k];

  return (
    <div className="space-y-6 max-w-6xl">
      <KepalaTampilan jenis="pesanan" id={p.id} tampil={p.nomor} />
      <FormulirTampilanSurat
        jenis="pesanan"
        id={p.id}
        teks={teks}
        event={p.mode === "EVENT" ? p : null}
        baris={barisTeksAwal(p.baris)}
        opsi={opsi}
        bolehNego={punyaHak(pengguna, "harga.nego")}
      />
    </div>
  );
}
