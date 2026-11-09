import { Fragment } from "react";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { HAK_BAWAAN, LABEL_PERAN, PERAN_DAPAT_DIATUR, PERAN_TERTINGGI, hitungHak, type Hak } from "@/lib/hakAkses";
import { AKSI_MATRIKS, SINGKATAN_AKSI, barisHakLain, barisMatriks, type SelMatriks } from "@/lib/matriksHakAkses";
import { pulihkanHakBawaanFormulir, simpanHakAksesFormulir } from "@/lib/aksi/hakAkses";
import type { PeranPengguna } from "@/prisma-klien/enums";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import Ikon from "@/komponen/ui/Ikon";

const TEKS_TERKUNCI = "Hanya Superadmin/Pemilik, tidak bisa diberikan ke peran lain";

export default async function HalamanHakAkses() {
  await wajibHak("hak-akses.kelola");
  const penyesuaian = await db.hakAksesPeran.findMany();
  const efektif = Object.fromEntries(PERAN_DAPAT_DIATUR.map((p) => [p, new Set(hitungHak(p, penyesuaian.filter((x) => x.peran === p)))])) as Record<PeranPengguna, Set<Hak>>;
  const bawaan = Object.fromEntries(PERAN_DAPAT_DIATUR.map((p) => [p, new Set(HAK_BAWAAN[p])])) as Record<PeranPengguna, Set<Hak>>;
  const kelompok = barisMatriks();
  const hakLain = barisHakLain();
  const lebarBaris = 1 + PERAN_DAPAT_DIATUR.length;

  const Terkunci = () => (
    <span title={TEKS_TERKUNCI} className="inline-flex">
      <Ikon nama="lock" className="!text-[14px] text-slate-300" />
      <span className="sr-only">{TEKS_TERKUNCI}</span>
    </span>
  );

  const Kotak = ({ peran, hak, label }: { peran: PeranPengguna; hak: Hak; label: string }) => {
    const boleh = efektif[peran].has(hak);
    const beda = boleh !== bawaan[peran].has(hak);
    const judul = `${LABEL_PERAN[peran]} · ${label}${beda ? " · berbeda dari bawaan" : ""}`;
    return (
      <input
        type="checkbox"
        name={`${peran}|${hak}`}
        defaultChecked={boleh}
        aria-label={judul}
        title={judul}
        className={`h-4 w-4 rounded border-slate-300 ${beda ? "outline outline-2 outline-amber-400" : ""}`}
      />
    );
  };

  const SelDokumen = ({ peran, labelDokumen, sel }: { peran: PeranPengguna; labelDokumen: string; sel: SelMatriks[] }) => (
    <div className="flex items-start justify-center gap-1.5">
      {sel.map((s) => (
        <label key={s.aksi} className="flex flex-col items-center gap-0.5">
          {s.terkunci ? <Terkunci /> : <Kotak peran={peran} hak={s.hak} label={`${labelDokumen} · ${s.aksi}`} />}
          <span className="text-[10px] leading-none text-slate-400" aria-hidden="true">{SINGKATAN_AKSI[s.aksi]}</span>
        </label>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Administrasi" }, { label: "Pengaturan" }]}
        judul="Hak Akses per Dokumen"
        subjudul={`Atur per peran: dokumen mana yang boleh dilihat, dibuat, diubah, disetujui, dan dihapus. ${PERAN_TERTINGGI.map((p) => LABEL_PERAN[p]).join(" dan ")} selalu penuh.`}
        lencana={<span className={`lencana ${penyesuaian.length ? "lencana-amber" : "lencana-emerald"}`}>{penyesuaian.length ? `${penyesuaian.length} penyesuaian dari bawaan` : "Semua bawaan"}</span>}
      />

      <FormulirAksi aksi={simpanHakAksesFormulir} className="space-y-6" pesanSukses="Hak akses tersimpan dan langsung berlaku.">
        <p className="text-xs text-slate-500">{AKSI_MATRIKS.map((a) => `${SINGKATAN_AKSI[a]} ${a}`).join(" · ")}</p>
        <div className="kartu kartu-tabel">
          <div className="bungkus-tabel">
            <table className="tabel min-w-[88rem]">
              <thead>
                <tr>
                  <th className="align-bottom">Dokumen</th>
                  {PERAN_DAPAT_DIATUR.map((p) => (
                    <th key={p} className="text-center border-l border-slate-200">
                      {LABEL_PERAN[p]}
                      {/* Penanda: peran ini dirender lengkap, jadi kotak yang tidak dicentang berarti dicabut. */}
                      <input type="hidden" name="peranDirender" value={p} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {kelompok.map((k) => (
                  <Fragment key={k.modul}>
                    <tr className="bg-slate-50/70">
                      <td colSpan={lebarBaris} className="font-semibold text-slate-900">{k.label}</td>
                    </tr>
                    {k.dokumen.map((d) => (
                      <tr key={d.kode}>
                        <td>{d.label} <span className="mono text-xs text-slate-400">{d.kode}</span></td>
                        {PERAN_DAPAT_DIATUR.map((p) => (
                          <td key={p} className="text-center border-l border-slate-200">
                            <SelDokumen peran={p} labelDokumen={d.label} sel={d.sel} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
                <tr className="bg-slate-50/70">
                  <td colSpan={lebarBaris} className="font-semibold text-slate-900">Lainnya (per modul)</td>
                </tr>
                {hakLain.map((b) => (
                  <tr key={b.hak}>
                    <td>{b.label} <span className="mono text-xs text-slate-400">{b.hak}</span></td>
                    {PERAN_DAPAT_DIATUR.map((p) => (
                      <td key={p} className="text-center border-l border-slate-200">
                        {b.terkunci ? <Terkunci /> : <Kotak peran={p} hak={b.hak} label={b.label} />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="tombol tombol-utama">Simpan hak akses</button>
          <span className="text-xs text-slate-500">Kotak berbingkai kuning berbeda dari bawaan. Pengguna dengan peran tambahan mendapat gabungan hak semua perannya.</span>
        </div>
      </FormulirAksi>

      <FormulirAksi aksi={pulihkanHakBawaanFormulir} pesanKonfirmasi="Kembalikan semua peran ke hak bawaan? Semua penyesuaian akan dihapus." pesanSukses="Semua peran kembali ke bawaan.">
        <button type="submit" className="tombol tombol-garis">Kembalikan ke bawaan</button>
      </FormulirAksi>
    </div>
  );
}
