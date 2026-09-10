import Link from "next/link";
import { db } from "@/lib/db";
import { hitungLabaRugiBulanan } from "@/lib/laporan";
import GrafikTren from "@/komponen/ui/GrafikTren";

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

/** Kartu tren 12 bulan di beranda. Komponen server async: dirender di dalam <Suspense> supaya kerangka beranda tampil lebih dulu. */
export default async function PanelTren({ tahun }: { tahun: number }) {
  const tren = await hitungLabaRugiBulanan(db, tahun);
  return (
        <div className="kartu">
          <div className="kepala-kartu">
            <div>
              <h2 className="judul-kartu">Tren Pendapatan &amp; Beban {tahun}</h2>
              <p className="kartu-subjudul">Per bulan dari jurnal, tanpa jurnal penutup. Arahkan kursor ke titik untuk angkanya.</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-600">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-navy-terang" /> Pendapatan {rp(Number(tren.total.pendapatan))}</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-oranye" /> Beban {rp(Number(tren.total.bebanPokok) + Number(tren.total.bebanLain))}</span>
              <Link href={`/buku-besar/laba-rugi?dari=${tahun}-01-01&sampai=${tahun}-12-31&tampilan=bulanan`} className="tombol tombol-lembut tombol-kecil">Laba Rugi per bulan</Link>
            </div>
          </div>
          <GrafikTren bulan={tren.bulan} tahun={tahun} />
        </div>
  );
}

export function KerangkaTren() {
  return (
    <div className="kartu space-y-4" aria-busy="true">
      <div className="kerlip h-5 w-64" />
      <div className="kerlip h-48" />
    </div>
  );
}
