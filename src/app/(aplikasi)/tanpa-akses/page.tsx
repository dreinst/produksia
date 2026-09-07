import Link from "next/link";
import { wajibMasuk } from "@/lib/otentikasi";
import { KETERANGAN_PERAN, LABEL_PERAN } from "@/lib/hakAkses";
import Ikon from "@/komponen/ui/Ikon";

export default async function HalamanTanpaAkses({ searchParams }: { searchParams: Promise<{ hak?: string }> }) {
  const pengguna = await wajibMasuk();
  const { hak } = await searchParams;

  return (
    <div className="kartu max-w-lg space-y-4">
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
          <Ikon nama="lock" />
        </span>
        <div>
          <h1 className="judul-halaman">Tidak ada akses</h1>
          <p className="subjudul-halaman">Halaman ini tidak tersedia untuk peran kamu.</p>
        </div>
      </div>
      <div className="ubin text-sm space-y-1">
        <div>
          Masuk sebagai <strong>{pengguna.nama}</strong> · peran <strong>{LABEL_PERAN[pengguna.peran]}</strong>
        </div>
        <div className="text-slate-500">{KETERANGAN_PERAN[pengguna.peran]}</div>
        {hak && (
          <div className="text-slate-500">
            Hak yang dibutuhkan: <code className="mono">{hak}</code>
          </div>
        )}
      </div>
      <p className="text-sm text-slate-600">Kalau kamu memang perlu mengakses bagian ini, minta Pemilik atau Admin mengubah peran akunmu.</p>
      <Link href="/" className="tombol tombol-utama">
        Ke Beranda
      </Link>
    </div>
  );
}
