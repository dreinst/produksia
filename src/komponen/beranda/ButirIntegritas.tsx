import Ikon from "@/komponen/ui/Ikon";
import { periksaKonsistensiTersimpan, type HasilKonsistensi } from "@/lib/sinkron";

/** Satu butir di kartu Integritas beranda. ok null = belum atau tidak dapat diperiksa (kuning). */
export function ButirIntegritas({ t, ok, d }: { t: string; ok: boolean | null; d: string }) {
  const warnaIkon = ok === null ? "text-amber-400" : ok ? "text-emerald-400" : "text-rose-400";
  const warnaJudul = ok === null ? "text-amber-200" : ok ? "text-white" : "text-rose-300";
  return (
    <div className="flex items-start gap-2.5">
      <Ikon nama={ok === false || ok === null ? "error" : "check_circle"} className={`!text-[18px] mt-0.5 ${warnaIkon}`} />
      <div>
        <span className={`font-semibold ${warnaJudul}`}>{t}</span>
        <p className="text-slate-400 text-[11px] mt-0.5">{d}</p>
      </div>
    </div>
  );
}

const JUDUL_KONSISTENSI = "Data tiap perusahaan tidak tercampur";

/** Penampung selama butir konsistensi masih diperiksa (fallback <Suspense>). */
export function ButirKonsistensiMemuat() {
  return <ButirIntegritas t={JUDUL_KONSISTENSI} ok={null} d="Sedang diperiksa..." />;
}

/**
 * Butir konsistensi perusahaan di beranda gabungan (D1 §8.4). Komponen server async di dalam <Suspense> supaya kartu
 * lain tidak menunggu kuerinya, memakai hasil yang disimpan 60 detik, dan galatnya tidak menjatuhkan beranda
 * (tinjauan P14 S1). `periksa` hanya diganti oleh uji.
 */
export default async function ButirKonsistensi({ periksa = periksaKonsistensiTersimpan }: { periksa?: () => Promise<HasilKonsistensi> }) {
  let hasil: HasilKonsistensi;
  try {
    hasil = await periksa();
  } catch (e) {
    console.error("[beranda] pemeriksaan konsistensi perusahaan gagal", e);
    return <ButirIntegritas t={JUDUL_KONSISTENSI} ok={null} d="Pemeriksaan gagal. Muat ulang halaman beberapa saat lagi." />;
  }
  return (
    <ButirIntegritas
      t={JUDUL_KONSISTENSI}
      ok={hasil.konsisten}
      d={
        hasil.konsisten
          ? "Jurnal, dokumen turunan, akun, gudang, proyek, barang, gaji, dan lampiran memakai perusahaan yang sama (0 pelanggaran)"
          : hasil.rincian.filter((r) => r.jumlah > 0).map((r) => `${r.label}: ${r.jumlah}`).join(" · ")
      }
    />
  );
}
