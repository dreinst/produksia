import Link from "next/link";
import { db } from "@/lib/db";
import { labaRugiKasBulanan } from "@/lib/basisKas";
import { D } from "@/lib/uang";
import GrafikTren from "@/komponen/ui/GrafikTren";

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

/** Kartu tren kas 12 bulan di beranda (basis kas: uang yang masuk dan keluar untuk operasi). Komponen server async di dalam <Suspense>. */
export default async function PanelTren({ tahun }: { tahun: number }) {
  const tren = await labaRugiKasBulanan(db, tahun);
  const bulan = tren.bulan.map((m) => ({ bulan: m.bulan, pendapatan: m.diterima, bebanPokok: m.dikeluarkan, bebanLain: D(0), labaBersih: m.surplus }));
  return (
        <div className="kartu">
          <div className="kepala-kartu">
            <div>
              <h2 className="judul-kartu">Tren Kas Masuk &amp; Keluar {tahun}</h2>
              <p className="kartu-subjudul">Basis kas: uang yang benar-benar masuk (pelanggan, penerimaan lain) dan keluar (pemasok, beban, pajak) tiap bulan. Arahkan kursor ke titik untuk angkanya.</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-600">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-navy-terang" /> Kas masuk {rp(Number(tren.total.diterima))}</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-oranye" /> Kas keluar {rp(Number(tren.total.dikeluarkan))}</span>
              <Link href={`/buku-besar/laba-rugi?dari=${tahun}-01-01&sampai=${tahun}-12-31&tampilan=bulanan`} className="tombol tombol-lembut tombol-kecil">Laba Rugi per bulan</Link>
            </div>
          </div>
          <GrafikTren bulan={bulan} tahun={tahun} label={{ masuk: "kas masuk", keluar: "kas keluar" }} />
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
