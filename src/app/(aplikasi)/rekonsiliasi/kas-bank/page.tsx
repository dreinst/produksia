import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { daftarAkunKasBank } from "@/lib/baganAkun";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { bacaPeriode } from "@/lib/laporan";
import { D, jumlahkan } from "@/lib/uang";
import { cocokkanOtomatisFormulir, cocokkanManualFormulir, lepasCocokFormulir, konfirmasiPerhatianFormulir } from "@/lib/aksi/rekonsiliasi";
import FormulirAksi from "@/komponen/FormulirAksi";
import FilterPeriode from "@/komponen/ui/FilterPeriode";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import Ikon from "@/komponen/ui/Ikon";

const angka = (v: { toString(): string }) => Number(v).toLocaleString("id-ID");
const tgl = (d: Date) => d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

export default async function HalamanRekonsiliasiKasBank({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("rekonsiliasi.lihat");
  const bolehTulis = punyaHak(pengguna, "rekonsiliasi.tulis");
  const param = await searchParams;
  const [daftarAkun, pengaturan] = await Promise.all([daftarAkunKasBank(), ambilPengaturanPerusahaan(db)]);
  const akunParam = Array.isArray(param.akun) ? param.akun[param.akun.length - 1] : param.akun;
  const akunId = typeof akunParam === "string" && daftarAkun.some((a) => a.id === akunParam) ? akunParam : (daftarAkun[0]?.id ?? "");
  const akun = daftarAkun.find((a) => a.id === akunId);
  const periode = bacaPeriode(param, pengaturan.tahunBuku);
  if (!akun) {
    return <div className="kartu"><p className="redup">Belum ada akun kas/bank. Tandai akun kas atau bank di Data Induk, Bagan Akun.</p></div>;
  }
  const [mutasi, baris, saldoBukuAgg, saldoTerakhir] = await Promise.all([
    db.mutasiBank.findMany({ where: { akunId, tanggal: { gte: periode.dari, lte: periode.sampai } }, include: { barisJurnal: { include: { jurnal: { select: { nomor: true, tanggal: true } } } } }, orderBy: { tanggal: "asc" } }),
    db.barisJurnal.findMany({ where: { akunId, jurnal: { tanggal: { gte: periode.dari, lte: periode.sampai } } }, include: { jurnal: { select: { nomor: true, tanggal: true, keterangan: true } }, mutasiBank: { select: { id: true, tanggal: true, perluPerhatian: true, dikonfirmasiPada: true } } }, orderBy: { jurnal: { tanggal: "asc" } } }),
    db.barisJurnal.aggregate({ where: { akunId, jurnal: { tanggal: { lte: periode.sampai } } }, _sum: { debit: true, kredit: true } }),
    db.mutasiBank.findFirst({ where: { akunId, tanggal: { lte: periode.sampai }, saldo: { not: null } }, orderBy: [{ tanggal: "desc" }, { diimporPada: "desc" }], select: { saldo: true } }),
  ]);
  const saldoBuku = D(saldoBukuAgg._sum.debit ?? 0).minus(D(saldoBukuAgg._sum.kredit ?? 0));
  const mutasiBelum = mutasi.filter((m) => !m.barisJurnalId);
  const perluPerhatian = mutasi.filter((m) => m.perluPerhatian && !m.dikonfirmasiPada);
  const barisBelum = baris.filter((b) => !b.mutasiBank);
  const nilaiMutasiBelum = jumlahkan(mutasiBelum.map((m) => D(m.masuk).minus(m.keluar)));
  const nilaiBarisBelum = jumlahkan(barisBelum.map((b) => D(b.debit).minus(b.kredit)));
  const saldoRekening = saldoTerakhir?.saldo ? D(saldoTerakhir.saldo) : null;
  const saldoRekeningHarap = saldoBuku.minus(nilaiBarisBelum).plus(nilaiMutasiBelum);
  const selisih = saldoRekening ? saldoRekening.minus(saldoRekeningHarap) : null;
  const kandidatUntuk = (m: (typeof mutasi)[number]) =>
    barisBelum.filter((b) => (D(m.masuk).gt(0) ? D(b.debit).equals(m.masuk) && D(b.kredit).isZero() : D(b.kredit).equals(m.keluar) && D(b.debit).isZero()));
  const tuntas = mutasiBelum.length + barisBelum.length + perluPerhatian.length === 0;

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Rekonsiliasi" }]}
        judul={`Rekonsiliasi Kas/Bank: ${akun.kode} ${akun.nama}`}
        subjudul="Mencocokkan mutasi rekening koran dengan catatan kas/bank di buku."
        lencana={<span className={`lencana ${tuntas ? "lencana-emerald" : "lencana-amber"}`}>{tuntas ? "Semua cocok" : `${mutasiBelum.length} mutasi belum di buku, ${barisBelum.length} baris buku belum di rekening, ${perluPerhatian.length} perlu perhatian`}</span>}
        aksi={bolehTulis ? <Link href="/rekonsiliasi/mutasi" className="tombol tombol-utama"><Ikon nama="upload_file" className="!text-[18px]" /> Impor mutasi rekening</Link> : undefined}
      />
      <FilterPeriode
        dari={periode.dariTeks}
        sampai={periode.sampaiTeks}
        tahunBuku={pengaturan.tahunBuku}
        tersembunyi={{ akun: akunId }}
        tambahan={
          <div className="bidang">
            <label className="label" htmlFor="akun">Akun kas/bank</label>
            <select id="akun" name="akun" defaultValue={akunId} className="isian isian-kecil w-auto">
              {daftarAkun.map((a) => (
                <option key={a.id} value={a.id}>{a.kode} - {a.nama}</option>
              ))}
            </select>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="kartu p-4"><div className="teks-label">Saldo buku</div><div className="font-heading text-lg font-bold angka mt-1">Rp {angka(saldoBuku)}</div><div className="text-xs text-slate-500">per {periode.sampaiTeks}</div></div>
        <div className="kartu p-4"><div className="teks-label">Di buku, belum di rekening</div><div className="font-heading text-lg font-bold angka mt-1">Rp {angka(nilaiBarisBelum)}</div><div className="text-xs text-slate-500">{barisBelum.length} baris</div></div>
        <div className="kartu p-4"><div className="teks-label">Di rekening, belum di buku</div><div className="font-heading text-lg font-bold angka mt-1">Rp {angka(nilaiMutasiBelum)}</div><div className="text-xs text-slate-500">{mutasiBelum.length} mutasi</div></div>
        <div className={`kartu p-4 ${perluPerhatian.length ? "border-amber-300" : ""}`}><div className="teks-label">Perlu perhatian</div><div className="font-heading text-lg font-bold angka mt-1">{perluPerhatian.length}</div><div className="text-xs text-slate-500">cocok, tapi tanggal berbeda</div></div>
        <div className={`kartu p-4 ${selisih ? (selisih.isZero() ? "border-emerald-200" : "border-rose-300") : ""}`}><div className="teks-label">Saldo rekening koran</div><div className="font-heading text-lg font-bold angka mt-1">{saldoRekening ? `Rp ${angka(saldoRekening)}` : "-"}</div><div className={`text-xs ${selisih && !selisih.isZero() ? "text-rose-700" : "text-slate-500"}`}>{saldoRekening ? (selisih!.isZero() ? "sesuai dengan buku" : `selisih Rp ${angka(selisih!)}`) : "belum ada kolom saldo di mutasi"}</div></div>
      </div>

      {bolehTulis && (
        <FormulirAksi aksi={cocokkanOtomatisFormulir} className="kartu flex flex-wrap items-end gap-3 !p-4" pesanSukses="Pencocokan otomatis selesai.">
          <input type="hidden" name="akunId" value={akunId} />
          <div className="bidang">
            <label className="label" htmlFor="toleransiHari">Toleransi beda tanggal (hari)</label>
            <input id="toleransiHari" name="toleransiHari" type="number" min={0} max={31} defaultValue={3} className="isian isian-kecil w-28" />
          </div>
          <button type="submit" className="tombol tombol-utama tombol-kecil">Cocokkan otomatis</button>
        </FormulirAksi>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <FormulirAksi aksi={konfirmasiPerhatianFormulir} className="kartu kartu-tabel" pesanSukses="Tanda sudah dicek tersimpan.">
          <input type="hidden" name="akunId" value={akunId} />
          <div className="kepala-kartu">
            <h2 className="judul-kartu">Mutasi rekening koran ({mutasi.length})</h2>
            {bolehTulis && perluPerhatian.length > 0 && <button type="submit" className="tombol tombol-garis tombol-kecil">Simpan tanda sudah dicek</button>}
          </div>
          <div className="bungkus-tabel">
            <table className="tabel text-xs">
              <thead><tr><th>Tanggal</th><th>Keterangan</th><th className="text-right">Masuk</th><th className="text-right">Keluar</th><th>Status</th></tr></thead>
              <tbody>
                {mutasi.map((m) => {
                  const kandidat = m.barisJurnalId ? [] : kandidatUntuk(m);
                  const bedaTanggal = m.barisJurnal && m.barisJurnal.jurnal.tanggal.toDateString() !== m.tanggal.toDateString();
                  return (
                    <tr key={m.id} className={!m.barisJurnalId ? "bg-amber-50/40" : m.perluPerhatian && !m.dikonfirmasiPada ? "bg-amber-50/70" : undefined}>
                      <td className="whitespace-nowrap">{tgl(m.tanggal)}</td>
                      <td>{m.keterangan}{m.referensi && <span className="mono text-slate-400"> {m.referensi}</span>}</td>
                      <td className="text-right angka text-emerald-700">{Number(m.masuk) ? angka(m.masuk) : ""}</td>
                      <td className="text-right angka text-blue-700">{Number(m.keluar) ? angka(m.keluar) : ""}</td>
                      <td className="whitespace-nowrap">
                        {m.barisJurnal ? (
                          <span className="inline-flex items-center gap-2">
                            {m.perluPerhatian ? (
                              <label className="inline-flex items-center gap-1" title={`Tanggal di buku ${tgl(m.barisJurnal.jurnal.tanggal)}, di rekening ${tgl(m.tanggal)}`}>
                                <input type="checkbox" name={`cek_${m.id}`} defaultChecked={!!m.dikonfirmasiPada} disabled={!bolehTulis} className="h-4 w-4 rounded border-amber-400" />
                                <span className={m.dikonfirmasiPada ? "lencana lencana-emerald" : "lencana lencana-amber"}>{m.dikonfirmasiPada ? "Sudah dicek" : "Perlu perhatian"}</span>
                              </label>
                            ) : (
                              <span className="lencana lencana-emerald">Cocok</span>
                            )}
                            <span className="mono text-slate-500">{m.barisJurnal.jurnal.nomor}{bedaTanggal ? ` (${tgl(m.barisJurnal.jurnal.tanggal)})` : ""}</span>
                            {bolehTulis && (
                              <FormulirAksi aksi={lepasCocokFormulir} className="inline"><input type="hidden" name="mutasiId" value={m.id} /><button type="submit" className="tombol-tautan-bahaya">lepas</button></FormulirAksi>
                            )}
                          </span>
                        ) : bolehTulis && kandidat.length ? (
                          <FormulirAksi aksi={cocokkanManualFormulir} className="inline-flex items-center gap-1">
                            <input type="hidden" name="mutasiId" value={m.id} />
                            <select name="barisId" className="isian isian-kecil w-auto" defaultValue={kandidat[0].id} aria-label="Baris jurnal">
                              {kandidat.map((b) => (
                                <option key={b.id} value={b.id}>{b.jurnal.nomor} ({tgl(b.jurnal.tanggal)})</option>
                              ))}
                            </select>
                            <button type="submit" className="tombol tombol-garis tombol-kecil">Cocokkan</button>
                          </FormulirAksi>
                        ) : (
                          <span className="inline-flex items-center gap-2">
                            <span className="lencana lencana-amber">Belum di buku</span>
                            {bolehTulis && (
                              <Link href={Number(m.masuk) ? `/kas-bank/masuk?jumlah=${Number(m.masuk)}&keterangan=${encodeURIComponent(m.keterangan)}` : `/kas-bank/keluar?jumlah=${Number(m.keluar)}&keterangan=${encodeURIComponent(m.keterangan)}`} className="tombol-tautan">catat</Link>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {mutasi.length === 0 && <tr><td colSpan={5} className="kosong">Belum ada mutasi pada periode ini. Impor dulu.</td></tr>}
              </tbody>
            </table>
          </div>
        </FormulirAksi>

        <div className="kartu kartu-tabel">
          <div className="kepala-kartu"><h2 className="judul-kartu">Buku kas/bank ({baris.length})</h2></div>
          <div className="bungkus-tabel">
            <table className="tabel text-xs">
              <thead><tr><th>Tanggal</th><th>Jurnal</th><th>Keterangan</th><th className="text-right">Debit</th><th className="text-right">Kredit</th><th>Status</th></tr></thead>
              <tbody>
                {baris.map((b) => (
                  <tr key={b.id} className={!b.mutasiBank ? "bg-amber-50/40" : undefined}>
                    <td className="whitespace-nowrap">{tgl(b.jurnal.tanggal)}</td>
                    <td className="mono">{b.jurnal.nomor}</td>
                    <td>{b.keterangan ?? b.jurnal.keterangan ?? ""}</td>
                    <td className="text-right angka text-emerald-700">{Number(b.debit) ? angka(b.debit) : ""}</td>
                    <td className="text-right angka text-blue-700">{Number(b.kredit) ? angka(b.kredit) : ""}</td>
                    <td>
                      {b.mutasiBank ? (
                        b.mutasiBank.perluPerhatian && !b.mutasiBank.dikonfirmasiPada ? (
                          <span className="lencana lencana-amber">Perlu perhatian</span>
                        ) : (
                          <span className="lencana lencana-emerald">Cocok</span>
                        )
                      ) : (
                        <span className="lencana lencana-amber">Belum di rekening</span>
                      )}
                    </td>
                  </tr>
                ))}
                {baris.length === 0 && <tr><td colSpan={6} className="kosong">Tidak ada catatan kas/bank pada periode ini.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <details className="kartu text-sm">
        <summary className="cursor-pointer font-semibold text-slate-800">Cara membaca status</summary>
        <ul className="list-disc pl-5 mt-2 space-y-1 text-slate-600">
          <li><strong>Cocok</strong>: mutasi dan catatan buku sama nominal dan tanggalnya.</li>
          <li><strong>Perlu perhatian</strong>: nominal sama, tanggal berbeda. Periksa, lalu centang dan simpan.</li>
          <li><strong>Belum di buku</strong>: ada di rekening, belum dicatat. Klik catat.</li>
          <li><strong>Belum di rekening</strong>: sudah dicatat di buku, belum muncul di rekening. Tunggu bank atau periksa.</li>
        </ul>
      </details>
    </div>
  );
}
