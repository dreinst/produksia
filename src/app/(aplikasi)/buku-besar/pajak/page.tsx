import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { ringkasanPajak } from "@/lib/pajak";
import { catatPphFinalFormulir } from "@/lib/aksi/pajak";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";

const angka = (v: { toString(): string }) => Number(v).toLocaleString("id-ID");
const NAMA_BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

export default async function HalamanPajak({ searchParams }: { searchParams: Promise<{ tahun?: string }> }) {
  const pengguna = await wajibHak("buku-besar.lihat");
  const bolehTulis = punyaHak(pengguna.peran, "buku-besar.tulis");
  const bolehHapus = punyaHak(pengguna.peran, "dokumen.hapus");
  const { tahun: tahunParam } = await searchParams;
  const pengaturan = await ambilPengaturanPerusahaan(db);
  const tahun = Number(tahunParam) >= 2000 && Number(tahunParam) <= 2100 ? Number(tahunParam) : pengaturan.tahunBuku;
  const r = await ringkasanPajak(db, tahun, pengaturan.pphFinalPersen);
  const sekarang = new Date();
  const akunSiap = !!pengaturan.akunBebanPphFinalId && !!pengaturan.akunHutangPphFinalId;
  const bulanBerjalan = (b: number) => new Date(tahun, b - 1, 1) <= sekarang;

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Buku Besar" }]}
        judul="Ringkasan Pajak & SPT"
        subjudul={`Tahun ${tahun} — omzet, PPN, PPh 23, dan PPh Final UMKM ${angka(pengaturan.pphFinalPersen)}% per masa pajak, dihitung langsung dari dokumen.`}
        lencana={<span className={`lencana ${pengaturan.pkp ? "lencana-blue" : "lencana-slate"}`}>{pengaturan.pkp ? `PKP · PPN ${angka(pengaturan.tarifPpnPersen)}%` : "Non-PKP"}</span>}
        aksi={
          <span className="flex items-center gap-2">
            <Link href={`/buku-besar/pajak?tahun=${tahun - 1}`} className="tombol tombol-garis tombol-kecil">‹ {tahun - 1}</Link>
            <Link href={`/buku-besar/pajak?tahun=${tahun + 1}`} className="tombol tombol-garis tombol-kecil">{tahun + 1} ›</Link>
          </span>
        }
      />

      {!akunSiap && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Akun Beban PPh Final / Hutang PPh Final belum diatur — buka <Link href="/pengaturan/perusahaan" className="font-semibold underline">Perusahaan &amp; Pajak</Link> sebelum mencatat PPh Final.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="kartu p-5"><div className="teks-label">Omzet (DPP) {tahun}</div><div className="font-heading text-lg font-bold angka mt-1">Rp {angka(r.total.omzet)}</div></div>
        <div className="kartu p-5"><div className="teks-label">PPN kurang (lebih) bayar</div><div className="font-heading text-lg font-bold angka mt-1">Rp {angka(r.total.ppnKurangBayar)}</div><div className="text-xs text-slate-500">Keluaran {angka(r.total.ppnKeluaran)} − masukan {angka(r.total.ppnMasukan)}</div></div>
        <div className="kartu p-5"><div className="teks-label">PPh 23 dipotong klien / kita potong</div><div className="font-heading text-lg font-bold angka mt-1">Rp {angka(r.total.pph23DipotongKlien)} / {angka(r.total.pph23KitaPotong)}</div></div>
        <div className="kartu p-5"><div className="teks-label">PPh Final {angka(pengaturan.pphFinalPersen)}% (tercatat)</div><div className="font-heading text-lg font-bold angka mt-1">Rp {angka(r.total.pphFinal)} <span className="text-sm text-slate-500">({angka(r.totalPphFinalTercatat)})</span></div></div>
      </div>

      <div className="kartu kartu-tabel">
        <div className="kepala-kartu"><h2 className="judul-kartu">Per masa pajak</h2></div>
        <div className="bungkus-tabel">
          <table className="tabel min-w-[64rem]">
            <thead>
              <tr>
                <th>Masa</th>
                <th className="text-right">Omzet (DPP)</th>
                <th className="text-right">PPN keluaran</th>
                <th className="text-right">PPN masukan</th>
                <th className="text-right">PPN kurang/(lebih)</th>
                <th className="text-right">PPh 23 dipotong klien</th>
                <th className="text-right">PPh 23 kita potong</th>
                <th className="text-right">PPh Final {angka(pengaturan.pphFinalPersen)}%</th>
                <th>Status PPh Final</th>
              </tr>
            </thead>
            <tbody>
              {r.bulan.map((b) => (
                <tr key={b.periode} className={!bulanBerjalan(b.bulan) ? "text-slate-400" : undefined}>
                  <td className="whitespace-nowrap">{NAMA_BULAN[b.bulan - 1]} <span className="mono text-xs text-slate-400">{b.periode}</span></td>
                  <td className="text-right angka">{angka(b.omzet)}</td>
                  <td className="text-right angka">{angka(b.ppnKeluaran)}</td>
                  <td className="text-right angka">{angka(b.ppnMasukan)}</td>
                  <td className={`text-right angka ${b.ppnKurangBayar.lt(0) ? "text-emerald-700" : ""}`}>{angka(b.ppnKurangBayar)}</td>
                  <td className="text-right angka">{angka(b.pph23DipotongKlien)}</td>
                  <td className="text-right angka">{angka(b.pph23KitaPotong)}</td>
                  <td className="text-right angka font-semibold">{angka(b.pphFinal)}</td>
                  <td className="whitespace-nowrap">
                    {b.tercatat ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="lencana lencana-emerald">Tercatat {angka(b.tercatat.jumlah)}</span>
                        <span className="mono text-xs text-slate-500">{b.tercatat.nomorJurnal ?? "—"}</span>
                        <TombolHapusDokumen jenis="pphFinal" id={b.tercatat.id} nomor={b.tercatat.nomorJurnal ?? b.periode} boleh={bolehHapus} />
                      </span>
                    ) : b.omzet.gt(0) && bulanBerjalan(b.bulan) && bolehTulis ? (
                      <FormulirAksi aksi={catatPphFinalFormulir} pesanKonfirmasi={`Catat PPh Final ${b.periode} sebesar Rp ${angka(b.pphFinal)} (Dr Beban PPh Final / Cr Hutang PPh Final)?`}>
                        <input type="hidden" name="periode" value={b.periode} />
                        <button type="submit" className="tombol tombol-garis tombol-kecil" disabled={!akunSiap}>Catat</button>
                      </FormulirAksi>
                    ) : (
                      <span className="text-xs text-slate-400">{b.omzet.gt(0) ? "—" : "tanpa omzet"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td>Total {tahun}</td>
                <td className="text-right angka">{angka(r.total.omzet)}</td>
                <td className="text-right angka">{angka(r.total.ppnKeluaran)}</td>
                <td className="text-right angka">{angka(r.total.ppnMasukan)}</td>
                <td className="text-right angka">{angka(r.total.ppnKurangBayar)}</td>
                <td className="text-right angka">{angka(r.total.pph23DipotongKlien)}</td>
                <td className="text-right angka">{angka(r.total.pph23KitaPotong)}</td>
                <td className="text-right angka">{angka(r.total.pphFinal)}</td>
                <td className="text-xs text-slate-500">tercatat {angka(r.totalPphFinalTercatat)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-sm">
        <div className="kartu space-y-2">
          <h2 className="judul-kartu">Cara pakai untuk SPT</h2>
          <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li><strong>PPh Final UMKM</strong> (PP 55/2022, {angka(pengaturan.pphFinalPersen)}% dari peredaran bruto): klik <em>Catat</em> tiap akhir bulan → jurnal Dr Beban PPh Final / Cr Hutang PPh Final. Setor ke DJP (kode akun pajak 411128-420) lewat <Link href="/kas-bank/keluar/baru" className="text-blue-600 hover:underline">Kas Keluar</Link> dengan akun lawan Hutang PPh Final, paling lambat tanggal 15 bulan berikutnya.</li>
            <li><strong>PPN</strong> (hanya PKP): kolom kurang/(lebih) bayar = PPN keluaran faktur penjualan − PPN masukan faktur pembelian, sudah dikurangi retur; laporkan di SPT Masa PPN dan setor lewat Kas Keluar (akun lawan Hutang PPN Keluaran / PPN Masukan).</li>
            <li><strong>PPh 23</strong>: yang dipotong klien menjadi kredit pajak (akun Pajak Dibayar Dimuka, minta bukti potongnya); yang kita potong dari vendor wajib disetor & dilaporkan (SPT Masa PPh Unifikasi).</li>
          </ul>
        </div>
        <div className="kartu space-y-2">
          <h2 className="judul-kartu">Catatan</h2>
          <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Omzet = DPP faktur penjualan bulan itu dikurangi DPP retur penjualan (bukan kas diterima).</li>
            <li>PPh Final yang sudah dicatat menyimpan omzet & tarif saat itu; bila dokumen bulan itu berubah, hapus catatannya lalu catat ulang.</li>
            <li>Bulan pada tahun yang sudah ditutup bukunya tidak bisa dicatat/dihapus sampai tahun dibuka kembali.</li>
            <li>Ambang omzet Rp 4,8 miliar/tahun (batas skema UMKM) dan pengecualian omzet Rp 500 juta pertama untuk WP orang pribadi tidak dihitung otomatis.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
