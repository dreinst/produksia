import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { ringkasanPenutupan } from "@/lib/tutupBuku";
import { bukaKembaliTahunFormulir, tutupTahunFormulir } from "@/lib/aksi/tutupBuku";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import { NomorDokumen } from "@/komponen/ui/Lencana";

const rp = (v: { toString(): string }) => Number(v).toLocaleString("id-ID");
const tanggal = (d: Date) => d.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

export default async function HalamanTutupBuku({ searchParams }: { searchParams: Promise<{ tahun?: string }> }) {
  const pengguna = await wajibHak("buku-besar.lihat");
  const bolehTulis = punyaHak(pengguna, "tutup-buku.buat");
  const { tahun: tahunParam } = await searchParams;
  const [pengaturan, pemetaan, daftarTutup, batasJurnal] = await Promise.all([
    ambilPengaturanPerusahaan(db),
    db.pemetaanAkun.findUnique({ where: { id: "default" }, include: { labaDitahan: true } }),
    db.tutupBuku.findMany({ include: { jurnal: { select: { nomor: true } } }, orderBy: { tahun: "desc" } }),
    db.jurnal.aggregate({ _min: { tanggal: true }, _max: { tanggal: true } }),
  ]);
  const tahunIni = new Date().getFullYear();
  const tahunAwal = Math.min(batasJurnal._min.tanggal?.getFullYear() ?? tahunIni, pengaturan.tahunBuku, ...daftarTutup.map((t) => t.tahun));
  const tahunAkhir = Math.max(batasJurnal._max.tanggal?.getFullYear() ?? tahunIni, tahunIni, pengaturan.tahunBuku);
  const daftarTahun: number[] = [];
  for (let t = tahunAkhir; t >= tahunAwal; t--) daftarTahun.push(t);
  const tutupPer = new Map(daftarTutup.map((t) => [t.tahun, t]));
  const tahunDipilih = Number(tahunParam) >= 2000 && Number(tahunParam) <= 2100 ? Number(tahunParam) : pengaturan.tahunBuku;
  const ringkasan = await ringkasanPenutupan(db, tahunDipilih);
  const tutupDipilih = tutupPer.get(tahunDipilih);
  const untung = ringkasan.labaBersih.gte(0);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Buku Besar" }]}
        judul="Tutup Buku Tahunan"
        subjudul="Menutup tahun memindahkan laba/rugi ke Laba Ditahan dan mengunci tahun itu."
        lencana={<span className="lencana lencana-slate">Tahun buku aktif {pengaturan.tahunBuku}</span>}
      />

      {!pemetaan?.labaDitahanId && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Akun <strong>Laba Ditahan</strong> belum diatur. Buka Pengaturan, Pemetaan Akun.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="kartu kartu-tabel lg:col-span-1">
          <div className="kepala-kartu"><h2 className="judul-kartu">Status per tahun</h2></div>
          <div className="bungkus-tabel">
            <table className="tabel">
              <thead><tr><th>Tahun</th><th>Status</th><th className="text-right">Laba bersih</th></tr></thead>
              <tbody>
                {daftarTahun.map((t) => {
                  const tutup = tutupPer.get(t);
                  return (
                    <tr key={t} className={t === tahunDipilih ? "bg-blue-50/60" : undefined}>
                      <td><a href={`/buku-besar/tutup-buku?tahun=${t}`} className="font-semibold text-blue-600 hover:underline">{t}</a></td>
                      <td>{tutup ? <span className="lencana lencana-slate">Ditutup</span> : <span className="lencana lencana-emerald">Terbuka</span>}</td>
                      <td className="text-right angka">{tutup ? rp(tutup.labaBersih) : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="kartu space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="judul-kartu">Tahun {tahunDipilih}</h2>
                <p className="subjudul-kartu">
                  {tutupDipilih
                    ? `Ditutup ${tanggal(tutupDipilih.tanggal)} oleh ${tutupDipilih.penggunaNama}${tutupDipilih.jurnal ? ` · jurnal ${tutupDipilih.jurnal.nomor}` : " · tanpa jurnal (tidak ada pendapatan/beban)"}`
                    : `${ringkasan.jumlahJurnal} jurnal tercatat; ${ringkasan.pendapatan.length} akun pendapatan dan ${ringkasan.beban.length} akun beban akan dinolkan.`}
                </p>
              </div>
              {bolehTulis && (tutupDipilih ? (
                <FormulirAksi aksi={bukaKembaliTahunFormulir} pesanKonfirmasi={`Buka kembali tahun buku ${tahunDipilih}? Jurnal penutupnya akan dihapus dan transaksi tahun itu bisa dicatat lagi.`} pesanSukses={`Tahun ${tahunDipilih} dibuka kembali.`}>
                  <input type="hidden" name="tahun" value={tahunDipilih} />
                  <button type="submit" className="tombol tombol-garis">Buka kembali tahun {tahunDipilih}</button>
                </FormulirAksi>
              ) : (
                <FormulirAksi aksi={tutupTahunFormulir} pesanKonfirmasi={`Tutup tahun buku ${tahunDipilih}? Pendapatan & beban tahun itu dipindahkan ke Laba Ditahan dan tahun ${tahunDipilih} dikunci dari transaksi baru.`} pesanSukses={`Tahun ${tahunDipilih} ditutup.`}>
                  <input type="hidden" name="tahun" value={tahunDipilih} />
                  <button type="submit" className="tombol tombol-utama" disabled={!pemetaan?.labaDitahanId || tahunDipilih > tahunIni}>Tutup tahun {tahunDipilih}</button>
                </FormulirAksi>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="ubin"><div className="teks-label">Pendapatan</div><div className="font-heading text-lg font-bold angka">Rp {rp(ringkasan.totalPendapatan)}</div></div>
              <div className="ubin"><div className="teks-label">Beban</div><div className="font-heading text-lg font-bold angka">Rp {rp(ringkasan.totalBeban)}</div></div>
              <div className="ubin"><div className="teks-label">{untung ? "Laba bersih" : "Rugi bersih"} → {pemetaan?.labaDitahan ? `${pemetaan.labaDitahan.kode} ${pemetaan.labaDitahan.nama}` : "Laba Ditahan"}</div><div className={`font-heading text-lg font-bold angka ${untung ? "text-emerald-700" : "text-rose-700"}`}>Rp {rp(ringkasan.labaBersih.abs())}</div></div>
            </div>
          </div>

          <div className="kartu kartu-tabel">
            <div className="kepala-kartu">
              <h2 className="judul-kartu">{tutupDipilih ? "Jurnal penutup yang dibuat" : "Pratinjau jurnal penutup"} {tahunDipilih}</h2>
              {tutupDipilih?.jurnal && <NomorDokumen nomor={tutupDipilih.jurnal.nomor} />}
            </div>
            <div className="bungkus-tabel">
              <table className="tabel">
                <thead><tr><th>Kode</th><th>Akun</th><th className="text-right">Debit</th><th className="text-right">Kredit</th></tr></thead>
                <tbody>
                  {ringkasan.pendapatan.map((b) => (
                    <tr key={b.akunId}><td className="mono">{b.kode}</td><td>{b.nama}</td><td className="text-right angka">{b.saldo.gt(0) ? rp(b.saldo) : "-"}</td><td className="text-right angka">{b.saldo.lt(0) ? rp(b.saldo.neg()) : "-"}</td></tr>
                  ))}
                  {ringkasan.beban.map((b) => (
                    <tr key={b.akunId}><td className="mono">{b.kode}</td><td>{b.nama}</td><td className="text-right angka">{b.saldo.lt(0) ? rp(b.saldo.neg()) : "-"}</td><td className="text-right angka">{b.saldo.gt(0) ? rp(b.saldo) : "-"}</td></tr>
                  ))}
                  {!ringkasan.labaBersih.isZero() && (
                    <tr className="bg-slate-50/70 font-semibold"><td className="mono">{pemetaan?.labaDitahan?.kode ?? "-"}</td><td>{pemetaan?.labaDitahan?.nama ?? "Laba Ditahan"}</td><td className="text-right angka">{ringkasan.labaBersih.lt(0) ? rp(ringkasan.labaBersih.neg()) : "-"}</td><td className="text-right angka">{ringkasan.labaBersih.gt(0) ? rp(ringkasan.labaBersih) : "-"}</td></tr>
                  )}
                  {ringkasan.pendapatan.length + ringkasan.beban.length === 0 && (
                    <tr><td colSpan={4} className="kosong">Tidak ada pendapatan/beban pada tahun ini.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Setelah ditutup, transaksi bertanggal tahun itu ditolak sampai tahun dibuka kembali.
          </p>
        </div>
      </div>
    </div>
  );
}
