import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { DOKUMEN_HAK, HAK_BAWAAN, HAK_LAIN, LABEL_HAK_LAIN, LABEL_PERAN, PERAN_DAPAT_DIATUR, PERAN_TERTINGGI, hitungHak, type AksiDokumen, type Hak, type ModulDokumen } from "@/lib/hakAkses";
import { pulihkanHakBawaanFormulir, simpanHakAksesFormulir } from "@/lib/aksi/hakAkses";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";

const LABEL_MODUL: Record<ModulDokumen, string> = { penjualan: "Penjualan", pembelian: "Pembelian", "kas-bank": "Kas & Bank", "buku-besar": "Buku Besar", persediaan: "Persediaan", "aset-tetap": "Aset Tetap" };
const AKSI: AksiDokumen[] = ["lihat", "buat", "hapus"];

export default async function HalamanHakAkses() {
  await wajibHak("hak-akses.kelola");
  const penyesuaian = await db.hakAksesPeran.findMany();
  const efektif = Object.fromEntries(PERAN_DAPAT_DIATUR.map((p) => [p, new Set(hitungHak(p, penyesuaian.filter((x) => x.peran === p)))])) as Record<string, Set<Hak>>;
  const bawaan = Object.fromEntries(PERAN_DAPAT_DIATUR.map((p) => [p, new Set(HAK_BAWAAN[p])])) as Record<string, Set<Hak>>;
  const modul = [...new Set(DOKUMEN_HAK.map((d) => d.modul))];

  const Kotak = ({ peran, hak }: { peran: string; hak: Hak }) => {
    const boleh = efektif[peran].has(hak);
    const beda = boleh !== bawaan[peran].has(hak);
    return (
      <input
        type="checkbox"
        name={`${peran}|${hak}`}
        defaultChecked={boleh}
        aria-label={`${LABEL_PERAN[peran as keyof typeof LABEL_PERAN]} ${hak}`}
        title={beda ? "Berbeda dari bawaan" : undefined}
        className={`h-4 w-4 rounded border-slate-300 ${beda ? "outline outline-2 outline-amber-400" : ""}`}
      />
    );
  };

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Administrasi" }, { label: "Pengaturan" }]}
        judul="Hak Akses per Dokumen"
        subjudul={`Atur per peran: dokumen mana yang boleh dilihat, dibuat, dan dihapus. ${PERAN_TERTINGGI.map((p) => LABEL_PERAN[p]).join(" dan ")} selalu penuh.`}
        lencana={<span className={`lencana ${penyesuaian.length ? "lencana-amber" : "lencana-emerald"}`}>{penyesuaian.length ? `${penyesuaian.length} penyesuaian dari bawaan` : "Semua bawaan"}</span>}
      />

      <FormulirAksi aksi={simpanHakAksesFormulir} className="space-y-6" pesanSukses="Hak akses tersimpan dan langsung berlaku.">
        <div className="kartu kartu-tabel">
          <div className="bungkus-tabel">
            <table className="tabel min-w-[56rem]">
              <thead>
                <tr>
                  <th rowSpan={2} className="align-bottom">Dokumen</th>
                  {PERAN_DAPAT_DIATUR.map((p) => (
                    <th key={p} colSpan={3} className="text-center border-l border-slate-200">{LABEL_PERAN[p]}</th>
                  ))}
                </tr>
                <tr>
                  {PERAN_DAPAT_DIATUR.map((p) => AKSI.map((a) => (
                    <th key={`${p}-${a}`} className={`text-center text-[11px] font-medium text-slate-500 ${a === "lihat" ? "border-l border-slate-200" : ""}`}>{a}</th>
                  )))}
                </tr>
              </thead>
              <tbody>
                {modul.map((m) => (
                  <>
                    <tr key={`m-${m}`} className="bg-slate-50/70">
                      <td colSpan={1 + PERAN_DAPAT_DIATUR.length * 3} className="font-semibold text-slate-900">{LABEL_MODUL[m]}</td>
                    </tr>
                    {DOKUMEN_HAK.filter((d) => d.modul === m).map((d) => (
                      <tr key={d.kode}>
                        <td>{d.label} <span className="mono text-xs text-slate-400">{d.kode}</span></td>
                        {PERAN_DAPAT_DIATUR.map((p) => AKSI.map((a) => (
                          <td key={`${p}-${a}`} className={`text-center ${a === "lihat" ? "border-l border-slate-200" : ""}`}>
                            {(d.aksi as readonly string[]).includes(a) ? <Kotak peran={p} hak={`${d.kode}.${a}` as Hak} /> : <span className="text-slate-300">-</span>}
                          </td>
                        )))}
                      </tr>
                    ))}
                  </>
                ))}
                <tr className="bg-slate-50/70">
                  <td colSpan={1 + PERAN_DAPAT_DIATUR.length * 3} className="font-semibold text-slate-900">Lainnya (per modul)</td>
                </tr>
                {HAK_LAIN.filter((h) => h !== "hak-akses.kelola").map((h) => (
                  <tr key={h}>
                    <td>{LABEL_HAK_LAIN[h]} <span className="mono text-xs text-slate-400">{h}</span></td>
                    {PERAN_DAPAT_DIATUR.map((p) => (
                      <td key={p} colSpan={3} className="text-center border-l border-slate-200"><Kotak peran={p} hak={h} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="tombol tombol-utama">Simpan hak akses</button>
          <span className="text-xs text-slate-500">Kotak berbingkai kuning berbeda dari bawaan.</span>
        </div>
      </FormulirAksi>

      <FormulirAksi aksi={pulihkanHakBawaanFormulir} pesanKonfirmasi="Kembalikan semua peran ke hak bawaan? Semua penyesuaian akan dihapus." pesanSukses="Semua peran kembali ke bawaan.">
        <button type="submit" className="tombol tombol-garis">Kembalikan ke bawaan</button>
      </FormulirAksi>
    </div>
  );
}
