import type { ReactNode } from "react";
import Ikon from "@/komponen/ui/Ikon";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Pemilih periode laporan (GET, tanpa JavaScript): dari–sampai atau hanya "per tanggal".
 * Pintasan mengikuti tahun buku: minggu ini, bulan ini, bulan lalu, tahun buku, tahun lalu.
 * `tambahan` = isian lain yang ikut dikirim (mis. pilihan proyek/event), `tersembunyi` = parameter yang dipertahankan.
 */
export default function FilterPeriode({
  dari,
  sampai,
  hanyaSampai = false,
  tahunBuku,
  tambahan,
  tersembunyi = {},
}: {
  dari?: string;
  sampai: string;
  hanyaSampai?: boolean;
  tahunBuku?: number;
  tambahan?: ReactNode;
  tersembunyi?: Record<string, string | undefined>;
}) {
  const hariIni = new Date();
  const tahun = tahunBuku ?? hariIni.getFullYear();
  const tahunBerjalan = tahun === hariIni.getFullYear();
  const akhirTahunBuku = tahunBerjalan ? iso(hariIni) : `${tahun}-12-31`;
  const awalBulan = iso(new Date(hariIni.getFullYear(), hariIni.getMonth(), 1));
  const awalBulanLalu = iso(new Date(hariIni.getFullYear(), hariIni.getMonth() - 1, 1));
  const akhirBulanLalu = iso(new Date(hariIni.getFullYear(), hariIni.getMonth(), 0));
  const senin = new Date(hariIni);
  senin.setDate(hariIni.getDate() - ((hariIni.getDay() + 6) % 7));
  const ekstra = Object.entries(tersembunyi)
    .filter(([, v]) => v)
    .map(([k, v]) => `&${k}=${encodeURIComponent(v!)}`)
    .join("");
  const pintas = hanyaSampai
    ? [
        { label: "Hari ini", href: `?sampai=${iso(hariIni)}${ekstra}` },
        { label: "Akhir bulan lalu", href: `?sampai=${akhirBulanLalu}${ekstra}` },
        { label: `Akhir tahun buku ${tahun}`, href: `?sampai=${tahun}-12-31${ekstra}` },
        { label: `Akhir ${tahun - 1}`, href: `?sampai=${tahun - 1}-12-31${ekstra}` },
      ]
    : [
        { label: "Minggu ini", href: `?dari=${iso(senin)}&sampai=${iso(hariIni)}${ekstra}` },
        { label: "Bulan ini", href: `?dari=${awalBulan}&sampai=${iso(hariIni)}${ekstra}` },
        { label: "Bulan lalu", href: `?dari=${awalBulanLalu}&sampai=${akhirBulanLalu}${ekstra}` },
        { label: `Tahun buku ${tahun}`, href: `?dari=${tahun}-01-01&sampai=${akhirTahunBuku}${ekstra}` },
        { label: `Tahun ${tahun - 1}`, href: `?dari=${tahun - 1}-01-01&sampai=${tahun - 1}-12-31${ekstra}` },
        { label: "Semua", href: `?dari=2000-01-01&sampai=${iso(hariIni)}${ekstra}` },
      ];

  return (
    <form method="get" className="kartu flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 !p-4">
      {Object.entries(tersembunyi).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {!hanyaSampai && (
        <div className="bidang">
          <label className="label" htmlFor="dari">Dari</label>
          <input id="dari" type="date" name="dari" defaultValue={dari} className="isian isian-kecil w-auto" />
        </div>
      )}
      <div className="bidang">
        <label className="label" htmlFor="sampai">{hanyaSampai ? "Per tanggal" : "Sampai"}</label>
        <input id="sampai" type="date" name="sampai" defaultValue={sampai} className="isian isian-kecil w-auto" />
      </div>
      {tambahan}
      <button type="submit" className="tombol tombol-utama tombol-kecil">
        <Ikon nama="search" className="!text-[16px]" />
        Tampilkan
      </button>
      <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto text-xs">
        {pintas.map((p) => (
          <a key={p.label} href={p.href} className="tombol tombol-garis tombol-kecil">
            {p.label}
          </a>
        ))}
      </div>
    </form>
  );
}
