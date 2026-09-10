import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { daftarAkunKasBank } from "@/lib/baganAkun";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { bacaPeriode } from "@/lib/laporan";
import { D, jumlahkan } from "@/lib/uang";
import { cocokkanOtomatisFormulir, cocokkanManualFormulir, lepasCocokFormulir, tandaiBarisCocokFormulir } from "@/lib/aksi/rekonsiliasi";
import FormulirAksi from "@/komponen/FormulirAksi";
import FilterPeriode from "@/komponen/ui/FilterPeriode";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";

const angka = (v: { toString(): string }) => Number(v).toLocaleString("id-ID");
const tgl = (d: Date) => d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

export default async function HalamanRekonsiliasiKasBank({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("rekonsiliasi.lihat");
  const bolehTulis = punyaHak(pengguna, "rekonsiliasi.tulis");
  const param = await searchParams;
  const [daftarAkun, pengaturan] = await Promise.all([daftarAkunKasBank(), ambilPengaturanPerusahaan(db)]);
  // parameter akun bisa ganda (isian tersembunyi + pilihan); yang terakhir = pilihan pengguna
  const akunParam = Array.isArray(param.akun) ? param.akun[param.akun.length - 1] : param.akun;
  const akunId = typeof akunParam === "string" && daftarAkun.some((a) => a.id === akunParam) ? akunParam : (daftarAkun[0]?.id ?? "");
  const akun = daftarAkun.find((a) => a.id === akunId);
  const periode = bacaPeriode(param, pengaturan.tahunBuku);
  if (!akun) {
    return <div className="kartu"><p className="redup">Belum ada akun kas/bank. Tandai akun sebagai Kas/Bank di Data Induk → Bagan Akun.</p></div>;
  }
  const [mutasi, baris, saldoBukuAgg, mutasiSemua] = await Promise.all([
    db.mutasiBank.findMany({ where: { akunId, tanggal: { gte: periode.dari, lte: periode.sampai } }, include: { barisJurnal: { include: { jurnal: { select: { nomor: true, tanggal: true } } } } }, orderBy: { tanggal: "asc" } }),
    db.barisJurnal.findMany({ where: { akunId, jurnal: { tanggal: { gte: periode.dari, lte: periode.sampai } } }, include: { jurnal: { select: { nomor: true, tanggal: true, keterangan: true } }, mutasiBank: { select: { id: true, keterangan: true, tanggal: true } } }, orderBy: { jurnal: { tanggal: "asc" } } }),
    db.barisJurnal.aggregate({ where: { akunId, jurnal: { tanggal: { lte: periode.sampai } } }, _sum: { debit: true, kredit: true } }),
    db.mutasiBank.findFirst({ where: { akunId, tanggal: { lte: periode.sampai }, saldo: { not: null } }, orderBy: [{ tanggal: "desc" }, { diimporPada: "desc" }], select: { saldo: true, tanggal: true } }),
  ]);
  const saldoBuku = D(saldoBukuAgg._sum.debit ?? 0).minus(D(saldoBukuAgg._sum.kredit ?? 0));
  const mutasiBelum = mutasi.filter((m) => !m.barisJurnalId);
  const barisBelum = baris.filter((b) => !b.mutasiBank && !b.rekonsiliasiPada);
  const barisCocokTanpaMutasi = baris.filter((b) => !b.mutasiBank && b.rekonsiliasiPada);
  const nilaiMutasiBelum = jumlahkan(mutasiBelum.map((m) => D(m.masuk).minus(m.keluar)));
  const nilaiBarisBelum = jumlahkan(barisBelum.map((b) => D(b.debit).minus(b.kredit)));
  const saldoRekening = mutasiSemua?.saldo ? D(mutasiSemua.saldo) : null;
  // saldo rekening yang diharapkan dari buku = saldo buku − (di buku tapi belum di rekening) + (di rekening tapi belum di buku)
  const saldoRekeningHarap = saldoBuku.minus(nilaiBarisBelum).plus(nilaiMutasiBelum);
  const selisih = saldoRekening ? saldoRekening.minus(saldoRekeningHarap) : null;
  const kandidatUntuk = (m: (typeof mutasi)[number]) =>
    barisBelum.filter((b) => (D(m.masuk).gt(0) ? D(b.debit).equals(m.masuk) && D(b.kredit).isZero() : D(b.kredit).equals(m.keluar) && D(b.debit).isZero()));

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Rekonsiliasi" }]}
        judul={`Rekonsiliasi Kas/Bank · ${akun.kode} ${akun.nama}`}
        subjudul="Mencocokkan mutasi rekening koran (hasil impor) dengan baris jurnal kas/bank di buku: nominal & arah sama, tanggal berdekatan. Sisa yang belum cocok = perlu dicatat (Kas Masuk/Keluar) atau ditunggu bank."
        lencana={<span className={`lencana ${mutasiBelum.length + barisBelum.length === 0 ? "lencana-emerald" : "lencana-amber"}`}>{mutasiBelum.length + barisBelum.length === 0 ? "Semua cocok" : `${mutasiBelum.length} mutasi & ${barisBelum.length} baris buku belum cocok`}</span>}
        aksi={bolehTulis ? <Link href="/rekonsiliasi/mutasi" className="tombol tombol-garis">Impor mutasi</Link> : undefined}
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
        <div className="kartu p-4"><div className="teks-label">Saldo buku per {periode.sampaiTeks}</div><div className="font-heading text-lg font-bold angka mt-1">Rp {angka(saldoBuku)}</div></div>
        <div className="kartu p-4"><div className="teks-label">Di buku, belum di rekening</div><div className="font-heading text-lg font-bold angka mt-1">Rp {angka(nilaiBarisBelum)}</div><div className="text-xs text-slate-500">{barisBelum.length} baris (cek/transfer belum cair, belum tercatat bank)</div></div>
        <div className="kartu p-4"><div className="teks-label">Di rekening, belum di buku</div><div className="font-heading text-lg font-bold angka mt-1">Rp {angka(nilaiMutasiBelum)}</div><div className="text-xs text-slate-500">{mutasiBelum.length} mutasi (bunga, admin bank, transfer belum dicatat)</div></div>
        <div className="kartu p-4"><div className="teks-label">Saldo rekening seharusnya</div><div className="font-heading text-lg font-bold angka mt-1">Rp {angka(saldoRekeningHarap)}</div><div className="text-xs text-slate-500">buku − belum di rekening + belum di buku</div></div>
        <div className={`kartu p-4 ${selisih ? (selisih.isZero() ? "border-emerald-200" : "border-rose-300") : ""}`}><div className="teks-label">Saldo rekening koran</div><div className="font-heading text-lg font-bold angka mt-1">{saldoRekening ? `Rp ${angka(saldoRekening)}` : "—"}</div><div className={`text-xs ${selisih && !selisih.isZero() ? "text-rose-700" : "text-slate-500"}`}>{saldoRekening ? (selisih!.isZero() ? "selisih 0 — rekonsiliasi tuntas" : `selisih Rp ${angka(selisih!)} (periksa mutasi yang belum diimpor)`) : "kolom Saldo tidak ada di mutasi yang diimpor"}</div></div>
      </div>

      {bolehTulis && (
        <FormulirAksi aksi={cocokkanOtomatisFormulir} className="kartu flex flex-wrap items-end gap-3 !p-4" pesanSukses="Pencocokan otomatis selesai.">
          <input type="hidden" name="akunId" value={akunId} />
          <div className="bidang">
            <label className="label" htmlFor="toleransiHari">Toleransi selisih tanggal (hari)</label>
            <input id="toleransiHari" name="toleransiHari" type="number" min={0} max={31} defaultValue={3} className="isian isian-kecil w-28" />
          </div>
          <button type="submit" className="tombol tombol-utama tombol-kecil">Cocokkan otomatis</button>
          <span className="text-xs text-slate-500">Pasangan nominal & arah sama dengan tanggal terdekat; sisanya cocokkan manual di bawah.</span>
        </FormulirAksi>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="kartu kartu-tabel">
          <div className="kepala-kartu"><h2 className="judul-kartu">Mutasi rekening koran ({mutasi.length})</h2></div>
          <div className="bungkus-tabel">
            <table className="tabel text-xs">
              <thead><tr><th>Tanggal</th><th>Keterangan</th><th className="text-right">Masuk</th><th className="text-right">Keluar</th><th>Buku</th></tr></thead>
              <tbody>
                {mutasi.map((m) => {
                  const kandidat = m.barisJurnalId ? [] : kandidatUntuk(m);
                  return (
                    <tr key={m.id} className={m.barisJurnalId ? undefined : "bg-amber-50/40"}>
                      <td className="whitespace-nowrap">{tgl(m.tanggal)}</td>
                      <td>{m.keterangan}{m.referensi && <span className="mono text-slate-400"> {m.referensi}</span>}</td>
                      <td className="text-right angka text-emerald-700">{Number(m.masuk) ? angka(m.masuk) : ""}</td>
                      <td className="text-right angka text-rose-700">{Number(m.keluar) ? angka(m.keluar) : ""}</td>
                      <td className="whitespace-nowrap">
                        {m.barisJurnal ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="lencana lencana-emerald">{m.barisJurnal.jurnal.nomor}</span>
                            {bolehTulis && (
                              <FormulirAksi aksi={lepasCocokFormulir} className="inline"><input type="hidden" name="mutasiId" value={m.id} /><button type="submit" className="tombol-tautan-bahaya">lepas</button></FormulirAksi>
                            )}
                          </span>
                        ) : bolehTulis && kandidat.length ? (
                          <FormulirAksi aksi={cocokkanManualFormulir} className="inline-flex items-center gap-1">
                            <input type="hidden" name="mutasiId" value={m.id} />
                            <select name="barisId" className="isian isian-kecil w-auto" defaultValue={kandidat[0].id} aria-label="Baris jurnal">
                              {kandidat.map((b) => (
                                <option key={b.id} value={b.id}>{b.jurnal.nomor} · {tgl(b.jurnal.tanggal)}</option>
                              ))}
                            </select>
                            <button type="submit" className="tombol tombol-garis tombol-kecil">Cocokkan</button>
                          </FormulirAksi>
                        ) : (
                          <span className="inline-flex items-center gap-2">
                            <span className="lencana lencana-amber">belum di buku</span>
                            {bolehTulis && (
                              <Link href={Number(m.masuk) ? `/kas-bank/masuk?jumlah=${Number(m.masuk)}&keterangan=${encodeURIComponent(m.keterangan)}` : `/kas-bank/keluar?jumlah=${Number(m.keluar)}&keterangan=${encodeURIComponent(m.keterangan)}`} className="tombol-tautan">catat</Link>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {mutasi.length === 0 && <tr><td colSpan={5} className="kosong">Belum ada mutasi rekening pada periode ini — impor dulu.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <FormulirAksi aksi={tandaiBarisCocokFormulir} className="kartu kartu-tabel" pesanSukses="Tanda cocok tersimpan.">
          <input type="hidden" name="akunId" value={akunId} />
          <input type="hidden" name="sampai" value={periode.sampaiTeks} />
          <div className="kepala-kartu">
            <h2 className="judul-kartu">Buku kas/bank ({baris.length} baris)</h2>
            {bolehTulis && <button type="submit" className="tombol tombol-garis tombol-kecil">Simpan tanda cocok</button>}
          </div>
          <div className="bungkus-tabel">
            <table className="tabel text-xs">
              <thead><tr><th>Tanggal</th><th>Jurnal</th><th>Keterangan</th><th className="text-right">Debit</th><th className="text-right">Kredit</th><th>Cocok</th></tr></thead>
              <tbody>
                {baris.map((b) => (
                  <tr key={b.id} className={!b.mutasiBank && !b.rekonsiliasiPada ? "bg-amber-50/40" : undefined}>
                    <td className="whitespace-nowrap">{tgl(b.jurnal.tanggal)}</td>
                    <td className="mono">{b.jurnal.nomor}</td>
                    <td>{b.keterangan ?? b.jurnal.keterangan ?? ""}</td>
                    <td className="text-right angka text-emerald-700">{Number(b.debit) ? angka(b.debit) : ""}</td>
                    <td className="text-right angka text-rose-700">{Number(b.kredit) ? angka(b.kredit) : ""}</td>
                    <td>
                      {b.mutasiBank ? (
                        <span className="lencana lencana-emerald" title={b.mutasiBank.keterangan}>mutasi {tgl(b.mutasiBank.tanggal)}</span>
                      ) : (
                        <label className="inline-flex items-center gap-1"><input type="checkbox" name={`cocok_${b.id}`} defaultChecked={!!b.rekonsiliasiPada} disabled={!bolehTulis} className="h-4 w-4 rounded border-slate-300" /> <span className="text-slate-500">manual</span></label>
                      )}
                    </td>
                  </tr>
                ))}
                {baris.length === 0 && <tr><td colSpan={6} className="kosong">Tidak ada jurnal kas/bank pada periode ini.</td></tr>}
              </tbody>
            </table>
          </div>
          {barisCocokTanpaMutasi.length > 0 && <p className="text-xs text-slate-500 p-3">{barisCocokTanpaMutasi.length} baris ditandai cocok secara manual (tanpa mutasi impor).</p>}
        </FormulirAksi>
      </div>
    </div>
  );
}
