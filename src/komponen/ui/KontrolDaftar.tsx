import Link from "next/link";
import Ikon from "@/komponen/ui/Ikon";
import type { ParamDaftar } from "@/lib/daftar";

/**
 * Baris kontrol di atas tabel daftar: kotak cari (GET, tanpa JavaScript) + paginasi.
 * Pencarian selalu mengembalikan ke halaman 1; paginasi mempertahankan kata kunci.
 */
export default function KontrolDaftar({
  param,
  total,
  placeholder = "Cari…",
  tambahan,
}: {
  param: ParamDaftar;
  total: number;
  placeholder?: string;
  /** Parameter query lain yang harus dipertahankan (mis. filter akun). */
  tambahan?: Record<string, string | undefined>;
}) {
  const { q, hal, ambil, lewati } = param;
  const jumlahHalaman = Math.max(1, Math.ceil(total / ambil));
  const dari = total === 0 ? 0 : lewati + 1;
  const sampai = Math.min(lewati + ambil, total);
  const ekstra = Object.entries(tambahan ?? {}).filter((pasangan): pasangan is [string, string] => Boolean(pasangan[1]));

  const tautanHal = (n: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    for (const [k, v] of ekstra) sp.set(k, v);
    if (n > 1) sp.set("hal", String(n));
    const s = sp.toString();
    return s ? `?${s}` : "?";
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 md:px-6 py-3 border-b border-slate-100 last:border-b-0">
      <form method="get" role="search" className="relative w-full sm:max-w-xs">
        {ekstra.map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <Ikon nama="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 !text-[18px] text-slate-400" />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={placeholder}
          aria-label="Cari di daftar"
          className="isian isian-kecil pl-8"
        />
      </form>

      <div className="flex items-center justify-between sm:justify-end gap-3 text-xs text-slate-500">
        <span className="whitespace-nowrap">
          {total === 0 ? (
            q ? (
              <>Tidak ada hasil untuk “{q}”</>
            ) : (
              "Belum ada data"
            )
          ) : (
            <>
              <span className="angka">{dari}–{sampai}</span> dari <span className="angka">{total.toLocaleString("id-ID")}</span>
            </>
          )}
        </span>
        {jumlahHalaman > 1 && (
          <nav className="flex items-center gap-1" aria-label="Paginasi">
            {hal > 1 ? (
              <Link href={tautanHal(hal - 1)} className="tombol tombol-garis tombol-kecil !px-2" aria-label="Halaman sebelumnya">
                <Ikon nama="chevron_left" className="!text-[18px]" />
              </Link>
            ) : (
              <span className="tombol tombol-garis tombol-kecil !px-2 opacity-40" aria-hidden="true">
                <Ikon nama="chevron_left" className="!text-[18px]" />
              </span>
            )}
            <span className="px-1 whitespace-nowrap">
              Hal <span className="angka">{hal}</span> / <span className="angka">{jumlahHalaman}</span>
            </span>
            {hal < jumlahHalaman ? (
              <Link href={tautanHal(hal + 1)} className="tombol tombol-garis tombol-kecil !px-2" aria-label="Halaman berikutnya">
                <Ikon nama="chevron_right" className="!text-[18px]" />
              </Link>
            ) : (
              <span className="tombol tombol-garis tombol-kecil !px-2 opacity-40" aria-hidden="true">
                <Ikon nama="chevron_right" className="!text-[18px]" />
              </span>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}
