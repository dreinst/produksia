import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { ringkasanProyek } from "@/lib/proyek";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import { LencanaStatus, NomorDokumen } from "@/komponen/ui/Lencana";

const angka = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("id-ID"));
const tgl = (d: Date | null) => (d ? d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const hariIniIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function Kartu({ judul, nilai, sub, warna }: { judul: string; nilai: string; sub?: string; warna?: string }) {
  return (
    <div className="kartu p-4">
      <div className="teks-label">{judul}</div>
      <div className={`font-heading text-lg font-bold angka mt-1 ${warna ?? ""}`}>{nilai}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function Langkah({ nomor, judul, keterangan, children }: { nomor: string; judul: string; keterangan: string; children: React.ReactNode }) {
  return (
    <section className="kartu kartu-tabel">
      <div className="kepala-kartu">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0">{nomor}</span>
          <div>
            <h2 className="judul-kartu">{judul}</h2>
            <p className="subjudul-kartu">{keterangan}</p>
          </div>
        </div>
      </div>
      <div className="bungkus-tabel">{children}</div>
    </section>
  );
}

export default async function HalamanLpjEvent({ params }: { params: Promise<{ id: string }> }) {
  await wajibHak("rekonsiliasi.lihat");
  const { id } = await params;
  const r = await ringkasanProyek(db, id);
  if (!r) notFound();
  const { proyek: p, pemasukan: m, pengeluaran: k, labaRugi: lr, kas } = r;
  const kontrak = p.nilaiKontrak ?? m.totalPesanan;
  const realisasiBiaya = lr.totalBeban;
  const selisihAnggaran = p.anggaranBiaya ? p.anggaranBiaya.minus(realisasiBiaya) : null;

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Rekonsiliasi" }, { label: "Rekonsiliasi Event (LPJ)", href: "/rekonsiliasi" }, { label: p.kode }]}
        judul={`LPJ ${p.kode} · ${p.nama}`}
        subjudul={`${p.pelanggan ?? "Tanpa klien"}${p.tanggalMulai ? ` · ${tgl(p.tanggalMulai)}${p.tanggalSelesai ? ` s.d. ${tgl(p.tanggalSelesai)}` : ""}` : ""}${p.keterangan ? ` · ${p.keterangan}` : ""}`}
        lencana={<LencanaStatus status={p.status} />}
        aksi={
          <span className="flex items-center gap-2">
            <Link href={`/buku-besar/laba-rugi?proyek=${p.id}&dari=2000-01-01&sampai=${hariIniIso()}`} className="tombol tombol-garis">Laba Rugi event</Link>
            <Link href={`/data-induk/proyek/${p.id}`} className="tombol tombol-garis">Ubah data event</Link>
          </span>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <Kartu judul="Proposal ter-acc / kontrak" nilai={`Rp ${angka(kontrak)}`} sub={p.nilaiKontrak ? `Pesanan Rp ${angka(m.totalPesanan)}` : "= total pesanan (nilai kontrak belum diisi)"} />
        <Kartu judul="Ditagih (faktur) + DP" nilai={`Rp ${angka(m.totalFaktur)}`} sub={`DP diterima Rp ${angka(m.totalUangMuka)}`} />
        <Kartu judul="Kas masuk (TRM + DP)" nilai={`Rp ${angka(m.totalDiterima.plus(m.totalUangMuka))}`} sub={`Sisa piutang (TOP) Rp ${angka(m.sisaPiutang)}`} warna={m.sisaPiutang.gt(0) ? "text-amber-700" : "text-emerald-700"} />
        <Kartu judul="Anggaran biaya" nilai={`Rp ${angka(p.anggaranBiaya)}`} sub={selisihAnggaran ? `${selisihAnggaran.gte(0) ? "Sisa" : "Lebih"} Rp ${angka(selisihAnggaran.abs())}` : "belum diisi"} warna={selisihAnggaran && selisihAnggaran.lt(0) ? "text-rose-700" : "text-blue-700"} />
        <Kartu judul="Biaya dikeluarkan" nilai={`Rp ${angka(realisasiBiaya)}`} sub={`Kas keluar Rp ${angka(kas.keluar)} · sisa hutang Rp ${angka(k.sisaHutang)}`} warna="text-blue-700" />
        <Kartu judul="Laba/Rugi" nilai={`${lr.laba.lt(0) ? "− " : ""}Rp ${angka(lr.laba.abs())}`} sub={`${lr.laba.gte(0) ? "Laba" : "Rugi"} · kas bersih event Rp ${angka(kas.bersih)}`} warna={lr.laba.gte(0) ? "text-emerald-700" : "text-rose-700"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* ===== PEMASUKAN ===== */}
        <div className="space-y-4">
          <h2 className="font-heading font-bold text-slate-900">Pemasukan — Proposal ter-acc / Pesanan → LPJ → Kas/Bank masuk → TOP → Laba/Rugi</h2>
          <Langkah nomor="1" judul="Proposal disetujui & Pesanan" keterangan="Penawaran yang disetujui klien dan pesanan penjualan event ini">
            <table className="tabel">
              <thead><tr><th>Dokumen</th><th>Tanggal</th><th>Status</th><th className="text-right">Nilai</th></tr></thead>
              <tbody>
                {m.penawaran.map((q) => (
                  <tr key={q.id} className="text-slate-500"><td><NomorDokumen nomor={q.nomor} /></td><td>{tgl(q.tanggal)}</td><td><LencanaStatus status={q.status} /></td><td className="text-right angka">{angka(q.total)}</td></tr>
                ))}
                {m.pesanan.map((ps) => (
                  <tr key={ps.id}><td><NomorDokumen nomor={ps.nomor} /></td><td>{tgl(ps.tanggal)}</td><td><LencanaStatus status={ps.status} /></td><td className="text-right angka font-semibold">{angka(ps.total)}</td></tr>
                ))}
                {m.pesanan.length + m.penawaran.length === 0 && <tr><td colSpan={4} className="kosong">Belum ada penawaran/pesanan bertanda event ini.</td></tr>}
              </tbody>
              <tfoot><tr className="font-semibold"><td colSpan={3}>Total pesanan</td><td className="text-right angka">{angka(m.totalPesanan)}</td></tr></tfoot>
            </table>
          </Langkah>
          <Langkah nomor="2" judul="LPJ: Faktur & termin pembayaran (TOP)" keterangan="Tagihan yang diterbitkan, uang muka yang dipakai, sisa per jatuh tempo">
            <table className="tabel">
              <thead><tr><th>Faktur</th><th>Jatuh tempo</th><th className="text-right">Total</th><th className="text-right">DP</th><th className="text-right">Diterima</th><th className="text-right">Sisa</th><th>Status</th></tr></thead>
              <tbody>
                {m.faktur.map((f) => (
                  <tr key={f.id}>
                    <td><NomorDokumen nomor={f.nomor} /></td>
                    <td className={f.lewatTempo ? "text-rose-700" : "text-slate-500"}>{tgl(f.jatuhTempo)}{f.lewatTempo ? " · lewat" : ""}</td>
                    <td className="text-right angka">{angka(f.total)}</td>
                    <td className="text-right angka">{angka(f.uangMuka)}</td>
                    <td className="text-right angka">{angka(f.diterima)}</td>
                    <td className={`text-right angka font-semibold ${f.sisa.gt(0) ? "text-amber-700" : ""}`}>{angka(f.sisa)}</td>
                    <td><LencanaStatus status={f.status} /></td>
                  </tr>
                ))}
                {m.faktur.length === 0 && <tr><td colSpan={7} className="kosong">Belum ada faktur.</td></tr>}
              </tbody>
              <tfoot><tr className="font-semibold"><td colSpan={2}>Total</td><td className="text-right angka">{angka(m.totalFaktur)}</td><td className="text-right angka">{angka(m.totalUangMuka)}</td><td className="text-right angka">{angka(m.totalDiterima)}</td><td className="text-right angka">{angka(m.sisaPiutang)}</td><td /></tr></tfoot>
            </table>
          </Langkah>
          <Langkah nomor="3" judul="Kas/Bank masuk & Laba/Rugi" keterangan="Uang yang benar-benar masuk (DP + penerimaan) dan pendapatan yang diakui">
            <table className="tabel">
              <tbody>
                <tr><td>Kas/bank masuk dari event (jurnal bertanda event)</td><td className="text-right angka font-semibold text-emerald-700">{angka(kas.masuk)}</td></tr>
                {lr.pendapatan.map((x) => (
                  <tr key={x.kode} className="text-slate-600"><td className="pl-6"><span className="mono">{x.kode}</span> {x.nama}</td><td className="text-right angka">{angka(x.jumlah)}</td></tr>
                ))}
                <tr className="font-semibold"><td>Total pendapatan diakui (akrual)</td><td className="text-right angka">{angka(lr.totalPendapatan)}</td></tr>
              </tbody>
            </table>
          </Langkah>
        </div>

        {/* ===== PENGELUARAN ===== */}
        <div className="space-y-4">
          <h2 className="font-heading font-bold text-slate-900">Pengeluaran — Pengadaan / Pembelian / Beban-biaya → Nota → Cash flow → Neraca & L/R</h2>
          <Langkah nomor="1" judul="Pengadaan & pembelian" keterangan="Pesanan pembelian event ini, fakturnya, dan pembayarannya (tunai/transfer)">
            <table className="tabel">
              <thead><tr><th>PSB</th><th>Pemasok</th><th className="text-right">Pesanan</th><th className="text-right">Faktur (nota)</th><th className="text-right">Dibayar</th><th className="text-right">Sisa hutang</th></tr></thead>
              <tbody>
                {k.pesananPembelian.map((b) => (
                  <tr key={b.id}><td><NomorDokumen nomor={b.nomor} /></td><td>{b.pemasok}</td><td className="text-right angka text-blue-700">{angka(b.total)}</td><td className="text-right angka text-blue-700">{angka(b.faktur)}</td><td className="text-right angka text-blue-700">{angka(b.dibayar)}</td><td className={`text-right angka ${b.sisaHutang.gt(0) ? "text-amber-700 font-semibold" : ""}`}>{angka(b.sisaHutang)}</td></tr>
                ))}
                {k.pesananPembelian.length === 0 && <tr><td colSpan={6} className="kosong">Belum ada pesanan pembelian bertanda event ini.</td></tr>}
              </tbody>
              <tfoot><tr className="font-semibold"><td colSpan={2}>Total</td><td className="text-right angka text-blue-700">{angka(k.totalPesananPembelian)}</td><td className="text-right angka text-blue-700">{angka(k.totalFakturPembelian)}</td><td className="text-right angka text-blue-700">{angka(k.totalDibayar)}</td><td className="text-right angka">{angka(k.sisaHutang)}</td></tr></tfoot>
            </table>
          </Langkah>
          <Langkah nomor="2" judul="Beban-biaya langsung (nota kas keluar / jurnal)" keterangan="Kas keluar dan jurnal manual yang diberi tanda event ini">
            <table className="tabel">
              <thead><tr><th>Nota</th><th>Tanggal</th><th>Keterangan</th><th className="text-right">Jumlah</th></tr></thead>
              <tbody>
                {k.bebanLain.map((b) => (
                  <tr key={b.id}><td><NomorDokumen nomor={b.nomor} /></td><td className="text-slate-500">{tgl(b.tanggal)}</td><td className="text-slate-600">{b.keterangan ?? "—"}</td><td className="text-right angka text-blue-700">{angka(b.jumlah)}</td></tr>
                ))}
                {k.bebanLain.length === 0 && <tr><td colSpan={4} className="kosong">Belum ada kas keluar/jurnal beban bertanda event ini.</td></tr>}
              </tbody>
              <tfoot><tr className="font-semibold"><td colSpan={3}>Total beban langsung lewat kas/jurnal</td><td className="text-right angka text-blue-700">{angka(k.totalBebanLain)}</td></tr></tfoot>
            </table>
          </Langkah>
          <Langkah nomor="3" judul="Cash flow keluar & beban diakui" keterangan="Uang yang benar-benar keluar vs biaya yang diakui di L/R (termasuk HPP barang yang dipakai)">
            <table className="tabel">
              <tbody>
                <tr><td>Kas/bank keluar untuk event (jurnal bertanda event)</td><td className="text-right angka font-semibold text-blue-700">{angka(kas.keluar)}</td></tr>
                {lr.beban.map((x) => (
                  <tr key={x.kode} className="text-slate-600"><td className="pl-6"><span className="mono">{x.kode}</span> {x.nama}</td><td className="text-right angka text-blue-700">{angka(x.jumlah)}</td></tr>
                ))}
                <tr className="font-semibold"><td>Total beban diakui (akrual)</td><td className="text-right angka text-blue-700">{angka(lr.totalBeban)}</td></tr>
              </tbody>
            </table>
          </Langkah>
        </div>
      </div>

      <div className="kartu space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="judul-kartu">Rekonsiliasi Laba/Rugi ↔ kas event</h2>
          <div className="flex flex-wrap gap-4 text-xs text-slate-500">
            <span><span className="inline-block w-3 h-3 rounded-sm bg-blue-600 align-middle mr-1" />Biaya yang dikeluarkan</span>
            <span><span className="inline-block w-3 h-3 rounded-sm bg-emerald-600 align-middle mr-1" />Laba</span>
            <span><span className="inline-block w-3 h-3 rounded-sm bg-rose-600 align-middle mr-1" />Rugi</span>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <table className="tabel">
            <tbody>
              <tr><td>Pendapatan diakui</td><td className="text-right angka">{angka(lr.totalPendapatan)}</td></tr>
              <tr><td>− Biaya dikeluarkan (beban diakui)</td><td className="text-right angka text-blue-700">{angka(lr.totalBeban)}</td></tr>
              <tr className="font-semibold border-t border-slate-200"><td>Laba/Rugi event — masuk ke Laporan Laba Rugi</td><td className={`text-right angka ${lr.laba.gte(0) ? "text-emerald-700" : "text-rose-700"}`}>{angka(lr.laba)}</td></tr>
            </tbody>
          </table>
          <table className="tabel">
            <tbody>
              <tr><td>Kas/bank masuk</td><td className="text-right angka">{angka(kas.masuk)}</td></tr>
              <tr><td>− Kas/bank keluar</td><td className="text-right angka text-blue-700">{angka(kas.keluar)}</td></tr>
              <tr className="font-semibold border-t border-slate-200"><td>Kas bersih event — masuk ke Neraca (kas/bank)</td><td className={`text-right angka ${kas.bersih.gte(0) ? "text-emerald-700" : "text-rose-700"}`}>{angka(kas.bersih)}</td></tr>
              <tr className="text-xs text-slate-500"><td>Selisih Laba/Rugi vs kas</td><td className="text-right angka">{angka(lr.laba.minus(kas.bersih))}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">Selisih laba vs kas dijelaskan oleh piutang belum tertagih (Rp {angka(m.sisaPiutang)}), hutang belum dibayar (Rp {angka(k.sisaHutang)}), persediaan yang dipakai (HPP) atau dibeli tapi belum terpakai, serta pajak/potongan. {kas.jumlahJurnal} jurnal bertanda event ini.</p>
      </div>
    </div>
  );
}
