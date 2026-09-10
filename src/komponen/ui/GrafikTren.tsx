import type { LabaRugiBulan } from "@/lib/laporan";

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const L = 720, T = 200, KIRI = 8, KANAN = 8, ATAS = 14, BAWAH = 28;

function jalur(nilai: number[], maks: number) {
  const lebar = L - KIRI - KANAN, tinggi = T - ATAS - BAWAH;
  const titik = nilai.map((v, i) => [KIRI + (lebar * i) / (nilai.length - 1), ATAS + tinggi - (maks > 0 ? (v / maks) * tinggi : 0)] as const);
  // kurva halus (Catmull-Rom → Bézier) supaya garis tidak patah-patah
  let d = `M${titik[0][0].toFixed(1)} ${titik[0][1].toFixed(1)}`;
  for (let i = 0; i < titik.length - 1; i++) {
    const p0 = titik[Math.max(0, i - 1)], p1 = titik[i], p2 = titik[i + 1], p3 = titik[Math.min(titik.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  const area = `${d} L${titik[titik.length - 1][0].toFixed(1)} ${ATAS + tinggi} L${titik[0][0].toFixed(1)} ${ATAS + tinggi} Z`;
  return { garis: d, area, titik };
}

const ringkas = (n: number) => (n >= 1e9 ? `${(n / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M` : n >= 1e6 ? `${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt` : n >= 1e3 ? `${(n / 1e3).toLocaleString("id-ID", { maximumFractionDigits: 0 })} rb` : `${n}`);

/**
 * Grafik area 12 bulan: pendapatan (navy) dan beban (oranye), gradasi lembut, garis "menggambar" saat tampil.
 * SVG murni tanpa pustaka; tiap bulan punya <title> untuk tooltip bawaan browser.
 */
export default function GrafikTren({ bulan, tahun }: { bulan: LabaRugiBulan[]; tahun: number }) {
  const pendapatan = bulan.map((b) => Number(b.pendapatan));
  const beban = bulan.map((b) => Number(b.bebanPokok) + Number(b.bebanLain));
  const maks = Math.max(1, ...pendapatan, ...beban) * 1.12;
  const p = jalur(pendapatan, maks), b = jalur(beban, maks);
  const bulanIni = new Date().getFullYear() === tahun ? new Date().getMonth() : 11;
  return (
    <svg viewBox={`0 0 ${L} ${T}`} className="w-full h-auto grafik-tren" role="img" aria-label={`Pendapatan dan beban per bulan ${tahun}`}>
      <defs>
        <linearGradient id="tren-p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#17417a" stopOpacity="0.35" /><stop offset="1" stopColor="#17417a" stopOpacity="0" /></linearGradient>
        <linearGradient id="tren-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f86e18" stopOpacity="0.3" /><stop offset="1" stopColor="#f86e18" stopOpacity="0" /></linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={KIRI} x2={L - KANAN} y1={ATAS + (T - ATAS - BAWAH) * (1 - g)} y2={ATAS + (T - ATAS - BAWAH) * (1 - g)} stroke="#e2e8f0" strokeDasharray="3 5" />
      ))}
      <path d={p.area} fill="url(#tren-p)" className="area" />
      <path d={b.area} fill="url(#tren-b)" className="area" />
      <path d={b.garis} fill="none" stroke="#f86e18" strokeWidth="2.5" strokeLinecap="round" className="garis" />
      <path d={p.garis} fill="none" stroke="#17417a" strokeWidth="2.5" strokeLinecap="round" className="garis" />
      {p.titik.map(([x, y], i) => (
        <g key={i}>
          <title>{`${BULAN[i]} ${tahun}: pendapatan Rp ${pendapatan[i].toLocaleString("id-ID")}, beban Rp ${beban[i].toLocaleString("id-ID")}`}</title>
          <circle cx={x} cy={y} r={i === bulanIni ? 5 : 3} fill="#fff" stroke="#17417a" strokeWidth="2" className="titik" />
          <circle cx={b.titik[i][0]} cy={b.titik[i][1]} r={i === bulanIni ? 4 : 2.5} fill="#fff" stroke="#f86e18" strokeWidth="2" className="titik" />
          <rect x={x - 30} y={ATAS} width="60" height={T - ATAS - BAWAH} fill="transparent" />
          <text x={x} y={T - 8} textAnchor="middle" fontSize="11" fill={i === bulanIni ? "#0b2141" : "#94a3b8"} fontWeight={i === bulanIni ? 700 : 500}>{BULAN[i]}</text>
        </g>
      ))}
      <text x={L - KANAN} y={ATAS + 4} textAnchor="end" fontSize="10" fill="#94a3b8">maks {ringkas(maks / 1.12)}</text>
    </svg>
  );
}
