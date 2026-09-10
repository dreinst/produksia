import Ikon from "@/komponen/ui/Ikon";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Pemilih periode laporan (GET, tanpa JavaScript): dari–sampai atau hanya "per tanggal". */
export default function FilterPeriode({ dari, sampai, hanyaSampai = false }: { dari?: string; sampai: string; hanyaSampai?: boolean }) {
  const hariIni = new Date();
  const awalBulan = iso(new Date(hariIni.getFullYear(), hariIni.getMonth(), 1));
  const awalTahun = `${hariIni.getFullYear()}-01-01`;
  const akhirTahunLalu = `${hariIni.getFullYear() - 1}-12-31`;
  const pintas = hanyaSampai
    ? [
        { label: "Hari ini", href: `?sampai=${iso(hariIni)}` },
        { label: "Akhir tahun lalu", href: `?sampai=${akhirTahunLalu}` },
      ]
    : [
        { label: "Bulan ini", href: `?dari=${awalBulan}&sampai=${iso(hariIni)}` },
        { label: "Tahun ini", href: `?dari=${awalTahun}&sampai=${iso(hariIni)}` },
        { label: "Tahun lalu", href: `?dari=${hariIni.getFullYear() - 1}-01-01&sampai=${akhirTahunLalu}` },
        { label: "Semua", href: `?dari=2000-01-01&sampai=${iso(hariIni)}` },
      ];

  return (
    <form method="get" className="kartu flex flex-col sm:flex-row sm:items-end gap-3 !p-4">
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
      <button type="submit" className="tombol tombol-utama tombol-kecil">
        <Ikon nama="search" className="!text-[16px]" />
        Tampilkan
      </button>
      <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto text-xs">
        {pintas.map((p) => (
          <a key={p.label} href={p.href} className="tombol tombol-lembut tombol-kecil">
            {p.label}
          </a>
        ))}
      </div>
    </form>
  );
}
