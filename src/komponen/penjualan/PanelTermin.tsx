import Link from "next/link";
import FormulirAksi from "@/komponen/FormulirAksi";
import Ikon from "@/komponen/ui/Ikon";
import { Rp } from "@/komponen/ui/Lencana";
import { D, type Desimal } from "@/lib/uang";
import { formatTanggal, tanggalIso } from "@/lib/waktu";
import { brutoRencana, type ProgresTermin, type StatusButirTermin } from "@/lib/rencanaTermin";
import { batalkanTagihanTerminFormulir, terbitkanTagihanTerminFormulir } from "@/lib/aksi/dokumenPenjualan";

type Angka = Desimal | number | string;

type ButirRencana = { id: string; no: number; label: string; jumlah: Angka; persen: Angka; jatuhTempo: Date | null };

type Props =
  | { jenis: "penawaran"; butir: readonly ButirRencana[]; ppnPersen: Angka }
  | {
      jenis: "pesanan";
      pesananId: string;
      progres: ProgresTermin;
      /** hak pesanan.ubah: terbitkan dan batalkan tagihan */
      bolehUbah: boolean;
      /** tautan "Catat pembayaran" (uang-muka.buat dan pesanan belum difaktur semua) */
      bolehBayar: boolean;
      /**
       * uang-muka.lihat dan penerimaan.lihat: angka diterima, dibayar, sisa, progres, dan status bayar per butir.
       * Tanpa itu panel hanya menampilkan rencana dan status tagih (tinjauan P27 R4).
       */
      lihatBayar: boolean;
    };

const GAYA_STATUS_BUTIR: Record<StatusButirTermin, string> = {
  "Belum ditagih": "lencana-slate",
  Ditagih: "lencana-blue",
  "Dibayar sebagian": "lencana-amber",
  Lunas: "lencana-emerald",
};

const persen = (x: Angka) => `${D(x).toNumber().toLocaleString("id-ID")}%`;
const tanggal = (d: Date | null) => (d ? formatTanggal(d) : "-");

/**
 * Termin pembayaran (D2 §3.8, §7.3). Penawaran: tabel rencana saja (nilai termasuk PPN dari brutoRencana, butir
 * terakhir menutup sisa PPN). Pesanan: progres dari hitungProgresTermin beserta tombol per butir (terbitkan dan
 * batalkan tagihan memakai aksi P25, catat pembayaran ke formulir uang muka). Tombol cetak tagihan dipasang P45.
 */
export default function PanelTermin(p: Props) {
  if (p.jenis === "penawaran") {
    const rencana = brutoRencana(p.butir, p.ppnPersen);
    return (
      <div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
          <thead>
            <tr>
              <th>No</th>
              <th>Label</th>
              <th className="text-right">Persen</th>
              <th className="text-right">Nilai sebelum PPN</th>
              <th className="text-right">Termasuk PPN</th>
              <th>Jatuh tempo</th>
            </tr>
          </thead>
          <tbody>
            {rencana.map(({ butir: b, bruto }) => (
              <tr key={b.id}>
                <td className="text-slate-500">{b.no}</td>
                <td>{b.label}</td>
                <td className="text-right angka">{persen(b.persen)}</td>
                <td className="text-right"><Rp nilai={D(b.jumlah)} /></td>
                <td className="text-right font-medium"><Rp nilai={bruto} /></td>
                <td className="whitespace-nowrap text-slate-600">{tanggal(b.jatuhTempo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const { progres, lihatBayar } = p;
  const kontrak = progres.nilaiKontrakBruto;
  const lebar = kontrak.gt(0) ? Math.min(100, progres.totalDiterima.div(kontrak).mul(100).toNumber()) : 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div>
          <p className="teks-label">Nilai kontrak (termasuk PPN)</p>
          <p className="font-semibold text-slate-900"><Rp nilai={kontrak} /></p>
        </div>
        {lihatBayar && (
          <>
            <div>
              <p className="teks-label">Sudah diterima</p>
              <p className="font-semibold text-emerald-700"><Rp nilai={progres.totalDiterima} /></p>
            </div>
            <div>
              <p className="teks-label">Belum dibayar</p>
              <p className="font-semibold text-slate-900"><Rp nilai={progres.belumDibayar} /></p>
            </div>
          </>
        )}
      </div>
      {lihatBayar && (
        <div className="h-2 rounded-full bg-slate-100" role="progressbar" aria-label="Progres pembayaran" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(lebar)}>
          <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${lebar}%` }} />
        </div>
      )}

      <div className="bungkus-tabel">
        <table className={`tabel ${lihatBayar ? "min-w-[64rem]" : "min-w-[48rem]"}`}>
          <thead>
            <tr>
              <th>No</th>
              <th>Label</th>
              <th className="text-right">Persen</th>
              <th className="text-right">Nilai</th>
              <th className="text-right">Termasuk PPN</th>
              <th>Jatuh tempo</th>
              {lihatBayar && <th className="text-right">Dibayar</th>}
              {lihatBayar && <th className="text-right">Sisa</th>}
              <th>Status</th>
              <th className="th-lekat" />
            </tr>
          </thead>
          <tbody>
            {progres.butir.map((b) => (
              <tr key={b.id} className="align-top">
                <td className="text-slate-500">{b.no}</td>
                <td>
                  <p>{b.label}</p>
                  {b.nomorCetak && <p className="mono text-[11px] text-slate-500">{b.nomorCetak}</p>}
                  {b.ditagihPada && <p className="text-xs text-slate-500">Ditagih {formatTanggal(b.ditagihPada)}</p>}
                </td>
                <td className="text-right angka">{persen(b.persen)}</td>
                <td className="text-right"><Rp nilai={b.jumlah} /></td>
                <td className="text-right"><Rp nilai={b.bruto} /></td>
                <td className="whitespace-nowrap text-slate-600">{tanggal(b.jatuhTempo)}</td>
                {lihatBayar && <td className="text-right"><Rp nilai={b.dibayar} /></td>}
                {lihatBayar && <td className="text-right font-medium"><Rp nilai={b.sisa} /></td>}
                <td>
                  {lihatBayar ? (
                    <span className="flex flex-wrap gap-1">
                      <span className={`lencana ${GAYA_STATUS_BUTIR[b.status]}`}>{b.status}</span>
                      {b.lewatJatuhTempo && <span className="lencana lencana-rose">Lewat jatuh tempo</span>}
                    </span>
                  ) : (
                    // status bayar (Lunas, Dibayar sebagian, lewat jatuh tempo) bersumber dari uang muka dan penerimaan
                    <span className={`lencana ${b.ditagihPada ? GAYA_STATUS_BUTIR.Ditagih : GAYA_STATUS_BUTIR["Belum ditagih"]}`}>{b.ditagihPada ? "Ditagih" : "Belum ditagih"}</span>
                  )}
                </td>
                <td className="td-lekat">
                  <AksiButir pesananId={p.pesananId} butir={b} bolehUbah={p.bolehUbah} bolehBayar={p.bolehBayar} lihatBayar={lihatBayar} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {lihatBayar && progres.dpTanpaTermin.gt(0) && (
        <p className="text-sm text-slate-600">
          Uang muka tanpa termin: Rp <Rp nilai={progres.dpTanpaTermin} />
        </p>
      )}
      <p className="petunjuk">
        Tagihan termin adalah permintaan pembayaran, belum pendapatan. Pendapatan diakui saat faktur dibuat setelah acara; faktur otomatis memakai semua uang muka.
      </p>
    </div>
  );
}

/**
 * Tombol per butir. Tanpa lihatBayar (tinjauan perbaikan P27 R5) tombol hanya mengikuti status tagih, supaya pemegang
 * pesanan.ubah tanpa hak lihat uang muka dan penerimaan tidak bisa menyimpulkan butir mana yang sudah dibayar dari
 * tombol yang muncul. Server tetap menolak terbitkan, batal, atau bayar yang tidak sah.
 */
function AksiButir({ pesananId, butir: b, bolehUbah, bolehBayar, lihatBayar }: { pesananId: string; butir: ProgresTermin["butir"][number]; bolehUbah: boolean; bolehBayar: boolean; lihatBayar: boolean }) {
  const terbit = bolehUbah && !b.ditagihPada && (!lihatBayar || b.sisa.gt(0));
  // server menolak batal bila butir sudah punya uang muka; dibayar menghitung semua uang muka butir
  const batal = bolehUbah && !!b.ditagihPada && (!lihatBayar || b.dibayar.isZero());
  const bayar = bolehBayar && (!lihatBayar || b.sisa.gt(0));
  if (!terbit && !batal && !bayar) return null;
  return (
    <div className="flex flex-col items-start gap-2 whitespace-nowrap">
      {terbit && (
        <details>
          <summary className="tombol-tautan cursor-pointer list-none inline-flex items-center gap-1">
            <Ikon nama="request_quote" className="!text-[16px]" />
            Terbitkan tagihan
          </summary>
          <FormulirAksi aksi={terbitkanTagihanTerminFormulir.bind(null, b.id)} pesanSukses={`Tagihan ${b.label} diterbitkan.`} className="mt-2 flex flex-col gap-2 w-60">
            <div>
              <label className="label" htmlFor={`nomorCetak-${b.id}`}>
                Nomor cetak
              </label>
              <input id={`nomorCetak-${b.id}`} name="nomorCetak" className="isian" maxLength={60} placeholder="Kosongkan untuk nomor otomatis" />
            </div>
            <div>
              <label className="label" htmlFor={`jatuhTempo-${b.id}`}>
                Jatuh tempo
              </label>
              <input id={`jatuhTempo-${b.id}`} name="jatuhTempo" type="date" className="isian" defaultValue={b.jatuhTempo ? tanggalIso(b.jatuhTempo) : ""} />
            </div>
            <button type="submit" className="tombol tombol-utama tombol-kecil">
              Terbitkan tagihan
            </button>
          </FormulirAksi>
        </details>
      )}
      {batal && (
        <FormulirAksi aksi={batalkanTagihanTerminFormulir.bind(null, b.id)} pesanKonfirmasi={`Batalkan tagihan ${b.label}? Nomor tagihannya dilepas.`} className="inline">
          <button type="submit" className="tombol-tautan-bahaya">
            Batalkan tagihan
          </button>
        </FormulirAksi>
      )}
      {bayar && (
        <Link href={`/penjualan/uang-muka/baru?pesananId=${pesananId}&rencanaTerminId=${b.id}`} className="tombol-tautan">
          Catat pembayaran
        </Link>
      )}
    </div>
  );
}
