import { Fragment } from "react";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { pratinjauTutupBuku, type PenutupanPerusahaan } from "@/lib/tutupBuku";
import { bukaKembaliTahunFormulir, tutupTahunFormulir } from "@/lib/aksi/tutupBuku";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import { NomorDokumen } from "@/komponen/ui/Lencana";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import { PERUSAHAAN_UTAMA, daftarPerusahaan } from "@/lib/perusahaan";
import { jumlahkan } from "@/lib/uang";

const rp = (v: { toString(): string }) => Number(v).toLocaleString("id-ID");
const tanggal = (d: Date) => d.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

export default async function HalamanTutupBuku({ searchParams }: { searchParams: Promise<{ tahun?: string }> }) {
  const pengguna = await wajibHak("buku-besar.lihat");
  const bolehTulis = punyaHak(pengguna, "tutup-buku.buat");
  const { tahun: tahunParam } = await searchParams;
  const [pengaturan, pemetaan, daftarTutup, batasJurnal] = await Promise.all([
    ambilPengaturanPerusahaan(db),
    db.pemetaanAkun.findUnique({ where: { id: "default" }, include: { labaDitahan: true } }),
    db.tutupBuku.findMany({
      include: {
        jurnal: { select: { nomor: true } },
        // urutan tetap antar muat (tinjauan P17): mengikuti urutan perusahaan, lalu kodenya
        rincianPerusahaan: {
          include: { jurnal: { select: { nomor: true } }, perusahaan: { select: { kode: true, nama: true, warna: true } } },
          orderBy: [{ perusahaan: { urutan: "asc" } }, { perusahaan: { kode: "asc" } }],
        },
      },
      orderBy: { tahun: "desc" },
    }),
    db.jurnal.aggregate({ _min: { tanggal: true }, _max: { tanggal: true } }),
  ]);
  const tahunIni = new Date().getFullYear();
  const tahunAwal = Math.min(batasJurnal._min.tanggal?.getFullYear() ?? tahunIni, pengaturan.tahunBuku, ...daftarTutup.map((t) => t.tahun));
  const tahunAkhir = Math.max(batasJurnal._max.tanggal?.getFullYear() ?? tahunIni, tahunIni, pengaturan.tahunBuku);
  const daftarTahun: number[] = [];
  for (let t = tahunAkhir; t >= tahunAwal; t--) daftarTahun.push(t);
  const tutupPer = new Map(daftarTutup.map((t) => [t.tahun, t]));
  const tahunDipilih = Number(tahunParam) >= 2000 && Number(tahunParam) <= 2100 ? Number(tahunParam) : pengaturan.tahunBuku;
  // Tutup buku tidak mengikuti lingkup (D1 §7.4, §8.4): pratinjau per perusahaan bersaldo dari pratinjauTutupBuku,
  // sama dengan yang dibukukan tutupTahun. Ringkasan gabungan tidak dipakai untuk baris karena akun bersama yang
  // saldonya saling meniadakan antar perusahaan tetap dinolkan di jurnal masing-masing (tinjauan P12 R4).
  const [pratinjau, semuaPerusahaan] = await Promise.all([pratinjauTutupBuku(db, tahunDipilih), daftarPerusahaan(true)]);
  const warna = new Map(semuaPerusahaan.map((x) => [x.id, x.warna]));
  const tutupDipilih = tutupPer.get(tahunDipilih);
  const totalPendapatan = jumlahkan(pratinjau.map((x) => x.ringkasan.totalPendapatan));
  const totalBeban = jumlahkan(pratinjau.map((x) => x.ringkasan.totalBeban));
  const labaBersih = totalPendapatan.minus(totalBeban);
  const untung = labaBersih.gte(0);
  const jumlahJurnal = pratinjau.reduce((n, x) => n + x.ringkasan.jumlahJurnal, 0);
  const jumlahPendapatan = new Set(pratinjau.flatMap((x) => x.ringkasan.pendapatan.map((b) => b.akunId))).size;
  const jumlahBeban = new Set(pratinjau.flatMap((x) => x.ringkasan.beban.map((b) => b.akunId))).size;
  // nomor JU-TUTUP per perusahaan; tutup buku lama tanpa rincian memakai TutupBuku.jurnal (milik utama)
  const nomorTutup = new Map<string, string>();
  if (tutupDipilih) {
    for (const r of tutupDipilih.rincianPerusahaan) if (r.jurnal) nomorTutup.set(r.perusahaanId, r.jurnal.nomor);
    if (tutupDipilih.rincianPerusahaan.length === 0 && tutupDipilih.jurnal) nomorTutup.set(PERUSAHAAN_UTAMA, tutupDipilih.jurnal.nomor);
  }
  const daftarNomor = [...new Set([...(tutupDipilih?.jurnal ? [tutupDipilih.jurnal.nomor] : []), ...nomorTutup.values()])];

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
                  const kelas = t === tahunDipilih ? "bg-blue-50/60" : undefined;
                  return (
                    <Fragment key={t}>
                      <tr className={kelas}>
                        <td><a href={`/buku-besar/tutup-buku?tahun=${t}`} className="font-semibold text-blue-600 hover:underline">{t}</a></td>
                        <td>{tutup ? <span className="lencana lencana-slate">Ditutup</span> : <span className="lencana lencana-emerald">Terbuka</span>}</td>
                        <td className="text-right angka">{tutup ? rp(tutup.labaBersih) : "-"}</td>
                      </tr>
                      {/* rincian per perusahaan yang tersimpan saat ditutup (D1 §8.4): kode, laba, nomor JU-TUTUP */}
                      {tutup && tutup.rincianPerusahaan.length > 0 && (
                        <tr className={kelas}>
                          <td colSpan={3} className="!pt-0">
                            <ul className="space-y-1 text-xs text-slate-500">
                              {tutup.rincianPerusahaan.map((r) => (
                                <li key={r.perusahaanId} className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="flex items-center gap-1.5">
                                    <LencanaPerusahaan kode={r.perusahaan.kode} warna={r.perusahaan.warna} nama={r.perusahaan.nama} />
                                    {r.jurnal ? <span className="mono">{r.jurnal.nomor}</span> : null}
                                  </span>
                                  <span className="angka">{rp(r.labaBersih)}</span>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
                    ? `Ditutup ${tanggal(tutupDipilih.tanggal)} oleh ${tutupDipilih.penggunaNama}${daftarNomor.length > 0 ? ` · jurnal ${daftarNomor.join(", ")}` : " · tanpa jurnal (tidak ada pendapatan/beban)"}`
                    : `${jumlahJurnal} jurnal tercatat; ${jumlahPendapatan} akun pendapatan dan ${jumlahBeban} akun beban akan dinolkan.`}
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
              <div className="ubin"><div className="teks-label">Pendapatan</div><div className="font-heading text-lg font-bold angka">Rp {rp(totalPendapatan)}</div></div>
              <div className="ubin"><div className="teks-label">Beban</div><div className="font-heading text-lg font-bold angka">Rp {rp(totalBeban)}</div></div>
              <div className="ubin"><div className="teks-label">{untung ? "Laba bersih" : "Rugi bersih"} → {pemetaan?.labaDitahan ? `${pemetaan.labaDitahan.kode} ${pemetaan.labaDitahan.nama}` : "Laba Ditahan"}</div><div className={`font-heading text-lg font-bold angka ${untung ? "text-emerald-700" : "text-rose-700"}`}>Rp {rp(labaBersih.abs())}</div></div>
            </div>
            <p className="text-xs text-slate-500">Tutup buku berlaku serentak untuk semua perusahaan: satu jurnal penutup dibuat untuk setiap perusahaan yang punya pendapatan atau beban di tahun ini.</p>
          </div>

          {pratinjau.length === 0 ? (
            <div className="kartu kartu-tabel">
              <div className="kepala-kartu">
                <h2 className="judul-kartu">{tutupDipilih ? "Jurnal penutup yang dibuat" : "Pratinjau per perusahaan"} {tahunDipilih}</h2>
                {daftarNomor.map((n) => <NomorDokumen key={n} nomor={n} />)}
              </div>
              <div className="bungkus-tabel">
                <table className="tabel">
                  <thead><tr><th>Kode</th><th>Akun</th><th className="text-right">Debit</th><th className="text-right">Kredit</th></tr></thead>
                  <tbody>
                    <tr><td colSpan={4} className="kosong">Tidak ada pendapatan/beban pada tahun ini.</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            pratinjau.map((x) => (
              <TabelPenutupan
                key={x.perusahaan.id}
                judul={`${tutupDipilih ? "Jurnal penutup yang dibuat" : "Pratinjau per perusahaan"} ${tahunDipilih}`}
                data={x}
                warna={warna.get(x.perusahaan.id) ?? null}
                nomor={nomorTutup.get(x.perusahaan.id)}
                labaDitahan={pemetaan?.labaDitahan ?? null}
              />
            ))
          )}
          <p className="text-xs text-slate-500">
            Setelah ditutup, transaksi bertanggal tahun itu ditolak sampai tahun dibuka kembali.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Baris jurnal penutup satu perusahaan (pratinjau, atau yang sudah dibuat bila `nomor` ada). */
function TabelPenutupan({
  judul,
  data,
  warna,
  nomor,
  labaDitahan,
}: {
  judul: string;
  data: PenutupanPerusahaan;
  warna: string | null;
  nomor?: string;
  labaDitahan: { kode: string; nama: string } | null;
}) {
  const { perusahaan, ringkasan } = data;
  return (
    <div className="kartu kartu-tabel">
      <div className="kepala-kartu">
        <h2 className="judul-kartu flex flex-wrap items-center gap-2">
          {judul}
          <LencanaPerusahaan kode={perusahaan.kode} warna={warna} nama={perusahaan.nama} />
          <span className="text-sm font-normal text-slate-500">{perusahaan.nama}</span>
        </h2>
        {nomor && <NomorDokumen nomor={nomor} />}
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
              <tr className="bg-slate-50/70 font-semibold"><td className="mono">{labaDitahan?.kode ?? "-"}</td><td>{labaDitahan?.nama ?? "Laba Ditahan"}</td><td className="text-right angka">{ringkasan.labaBersih.lt(0) ? rp(ringkasan.labaBersih.neg()) : "-"}</td><td className="text-right angka">{ringkasan.labaBersih.gt(0) ? rp(ringkasan.labaBersih) : "-"}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
