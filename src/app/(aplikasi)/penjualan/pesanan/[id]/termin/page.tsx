import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { tanggalIso } from "@/lib/waktu";
import { ubahRencanaTerminFormulir } from "@/lib/aksi/dokumenPenjualan";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import FormulirAksi from "@/komponen/FormulirAksi";
import EditorRencanaTermin from "@/komponen/penjualan/EditorRencanaTermin";

/**
 * Ubah rencana termin pesanan (D2 §7.1, §3.8). Basis = total pesanan sebelum PPN, PPN = PPN pesanan. Rencana hanya
 * bisa diganti selama belum ada butir yang ditagih atau dibayar; server memeriksa ulang di dalam transaksi.
 */
export default async function HalamanTerminPesanan({ params }: { params: Promise<{ id: string }> }) {
  await wajibHak("pesanan.ubah");
  const { id } = await params;
  const p = await db.pesananPenjualan.findUnique({
    where: { id },
    select: {
      id: true,
      nomor: true,
      total: true,
      ppnPersen: true,
      rencanaTermin: { orderBy: { no: "asc" }, select: { label: true, mode: true, nilai: true, jatuhTempo: true, ditagihPada: true, _count: { select: { uangMuka: true } } } },
    },
  });
  if (!p) notFound();

  const terkunci = p.rencanaTermin.find((b) => b.ditagihPada || b._count.uangMuka > 0);
  const terakhir = p.rencanaTermin.length - 1;
  const nilaiAwal = p.rencanaTermin.map((b, i) => ({
    label: b.label,
    mode: b.mode,
    // butir terakhir selalu menutup sisa, nilainya tidak diisi
    nilai: i === terakhir ? "" : b.nilai.toString(),
    jatuhTempo: b.jatuhTempo ? tanggalIso(b.jatuhTempo) : "",
  }));
  const kembali = (
    <Link href={`/penjualan/pesanan/${p.id}`} className="tombol tombol-garis">
      Kembali ke pesanan
    </Link>
  );

  return (
    <div className="space-y-6 max-w-5xl">
      <KepalaHalaman
        jejak={[{ label: "Penjualan" }, { label: "Pesanan", href: "/penjualan/pesanan" }, { label: p.nomor, href: `/penjualan/pesanan/${p.id}` }, { label: "Ubah termin" }]}
        judul={`Termin Pembayaran ${p.nomor}`}
        subjudul={`Nilai pesanan sebelum PPN ${Number(p.total).toLocaleString("id-ID")}${Number(p.ppnPersen) > 0 ? ` · PPN ${Number(p.ppnPersen).toLocaleString("id-ID")}%` : ""}`}
        aksi={kembali}
      />
      {terkunci ? (
        <div className="kartu space-y-3">
          <p className="text-sm text-slate-700">
            {terkunci.label} sudah {terkunci.ditagihPada ? "ditagih" : "dibayar"}, jadi rencana termin pesanan ini tidak bisa diganti lagi. Batalkan tagihannya lebih dulu bila belum ada
            pembayaran.
          </p>
        </div>
      ) : (
        <FormulirAksi aksi={ubahRencanaTerminFormulir.bind(null, "pesanan", p.id)} pesanSukses="Rencana termin tersimpan. Membuka halaman pesanan…" alihkanKe={`/penjualan/pesanan/${p.id}`} className="kartu space-y-4">
          <h2 className="judul-kartu">Termin pembayaran</h2>
          <EditorRencanaTermin basis={Number(p.total)} ppnPersen={Number(p.ppnPersen)} nilaiAwal={nilaiAwal} />
          <div>
            <button type="submit" className="tombol tombol-utama">
              Simpan termin
            </button>
          </div>
        </FormulirAksi>
      )}
    </div>
  );
}
