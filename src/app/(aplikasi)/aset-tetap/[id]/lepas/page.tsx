import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { daftarAkunKasBank } from "@/lib/baganAkun";
import { lepasAsetFormulir } from "@/lib/aksi/asetTetap";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import { LencanaStatus } from "@/komponen/ui/Lencana";

const rp = (n: number) => n.toLocaleString("id-ID");

export default async function HalamanLepasAset({ params }: { params: Promise<{ id: string }> }) {
  await wajibHak("pelepasan-aset.buat");
  const { id } = await params;
  const [aset, akunKas, akunLabaRugi] = await Promise.all([
    db.asetTetap.findUnique({ where: { id }, include: { penyusutan: true, pelepasan: true, akunAset: true, akunAkumulasiPenyusutan: true } }),
    daftarAkunKasBank(),
    db.akun.findMany({ where: { kelompok: false, jenis: { in: ["PENDAPATAN", "BEBAN"] } }, orderBy: { kode: "asc" } }),
  ]);
  if (!aset) notFound();
  const akumulasi = aset.penyusutan.reduce((s, p) => s + Number(p.jumlah), 0);
  const nilaiBuku = Number(aset.hargaPerolehan) - akumulasi;
  const bawaanLabaRugi = akunLabaRugi.find((a) => a.kode === "4-9200")?.id ?? akunLabaRugi.find((a) => a.jenis === "PENDAPATAN")?.id ?? "";
  const hariIni = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6 max-w-3xl">
      <KepalaHalaman
        jejak={[{ label: "Aset Tetap", href: "/aset-tetap" }, { label: aset.kode }]}
        judul={`Lepas Aset ${aset.kode} · ${aset.nama}`}
        subjudul="Menjual atau menghapusbukukan aset: aset & akumulasi penyusutannya dikeluarkan dari neraca, selisih harga jual vs nilai buku diakui sebagai laba/rugi pelepasan."
        lencana={<LencanaStatus status={aset.status} />}
        aksi={<Link href="/aset-tetap" className="tombol tombol-garis">Kembali</Link>}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="kartu p-4"><div className="teks-label">Harga perolehan</div><div className="font-heading text-lg font-bold angka">Rp {rp(Number(aset.hargaPerolehan))}</div></div>
        <div className="kartu p-4"><div className="teks-label">Akumulasi penyusutan</div><div className="font-heading text-lg font-bold angka">Rp {rp(akumulasi)}</div><div className="text-xs text-slate-500">{aset.penyusutan.length} periode</div></div>
        <div className="kartu p-4"><div className="teks-label">Nilai buku</div><div className="font-heading text-lg font-bold angka">Rp {rp(nilaiBuku)}</div></div>
        <div className="kartu p-4"><div className="teks-label">Akun aset / akumulasi</div><div className="text-sm font-mono">{aset.akunAset.kode}</div><div className="text-sm font-mono">{aset.akunAkumulasiPenyusutan.kode}</div></div>
      </div>

      {aset.status !== "AKTIF" || aset.pelepasan ? (
        <div className="kartu">
          <p className="redup">Aset ini sudah dilepas ({aset.status}). Untuk membatalkan, hapus pelepasannya dari daftar aset.</p>
        </div>
      ) : (
        <FormulirAksi aksi={lepasAsetFormulir} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
          <input type="hidden" name="asetId" value={aset.id} />
          <div className="bidang">
            <label className="label" htmlFor="jenis">Jenis pelepasan *</label>
            <select id="jenis" name="jenis" defaultValue="DIJUAL" className="isian">
              <option value="DIJUAL">Dijual (ada hasil penjualan)</option>
              <option value="DIHAPUS">Dihapusbukukan (rusak/hilang, tanpa hasil)</option>
            </select>
          </div>
          <div className="bidang">
            <label className="label" htmlFor="tanggal">Tanggal pelepasan *</label>
            <input id="tanggal" name="tanggal" type="date" defaultValue={hariIni} max={hariIni} required className="isian" />
          </div>
          <div className="bidang">
            <label className="label" htmlFor="hargaJual">Harga jual</label>
            <input id="hargaJual" name="hargaJual" type="number" step="0.01" min={0} defaultValue={nilaiBuku} className="isian" />
            <span className="petunjuk">Di atas nilai buku = laba, di bawah = rugi; isi 0 bila dihapusbukukan</span>
          </div>
          <div className="bidang">
            <label className="label" htmlFor="akunPenerimaanId">Akun Kas/Bank penerima</label>
            <select id="akunPenerimaanId" name="akunPenerimaanId" defaultValue={akunKas[0]?.id ?? ""} className="isian">
              <option value="">— tidak ada hasil</option>
              {akunKas.map((a) => (
                <option key={a.id} value={a.id}>{a.kode} - {a.nama}</option>
              ))}
            </select>
          </div>
          <div className="bidang md:col-span-2">
            <label className="label" htmlFor="akunLabaRugiId">Akun laba/rugi pelepasan *</label>
            <select id="akunLabaRugiId" name="akunLabaRugiId" required defaultValue={bawaanLabaRugi} className="isian">
              {akunLabaRugi.map((a) => (
                <option key={a.id} value={a.id}>{a.kode} - {a.nama} ({a.jenis === "PENDAPATAN" ? "pendapatan" : "beban"})</option>
              ))}
            </select>
            <span className="petunjuk">Bawaan 4-9200 Pendapatan Lainnya (dikredit bila laba, didebit bila rugi). Pilih akun beban bila ingin rugi tampil di beban.</span>
          </div>
          <div className="bidang md:col-span-2">
            <label className="label" htmlFor="keterangan">Keterangan</label>
            <input id="keterangan" name="keterangan" className="isian" placeholder="mis. Dijual ke vendor lama / rusak saat event" />
          </div>
          <div className="md:col-span-2 ubin text-xs text-slate-600 space-y-1">
            <div className="font-semibold text-slate-900">Jurnal yang akan dibuat (JU-LPS)</div>
            <div>Dr Kas/Bank sebesar harga jual · Dr {aset.akunAkumulasiPenyusutan.kode} {rp(akumulasi)} · Cr {aset.akunAset.kode} {rp(Number(aset.hargaPerolehan))} · selisih ke akun laba/rugi pelepasan.</div>
            <div>Setelah dilepas, aset tidak ikut penyusutan bulanan lagi. Pelepasan bisa dibatalkan lewat tombol Hapus di daftar aset.</div>
          </div>
          <div className="md:col-span-2">
            <button type="submit" className="tombol tombol-utama">Lepas aset</button>
          </div>
        </FormulirAksi>
      )}
    </div>
  );
}
