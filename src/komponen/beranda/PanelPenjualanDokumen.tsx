import Link from "next/link";
import { db } from "@/lib/db";
import { punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { saringPerusahaan } from "@/lib/perusahaan";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { D, jumlahkan, type Desimal } from "@/lib/uang";
import { bacaWaktuLokal, formatTanggal } from "@/lib/waktu";
import KartuKpi from "@/komponen/ui/KartuKpi";
import BatangStatus from "@/komponen/ui/BatangStatus";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import { NomorDokumen, Rp } from "@/komponen/ui/Lencana";

export type FakturMenunggu = {
  id: string;
  nomor: string;
  pelanggan: string;
  jatuhTempo: Date | null;
  sisa: Desimal;
  perusahaan: { kode: string; nama: string; warna: string | null };
};

export type DataPenjualanDokumen = {
  penawaranPerStatus: { status: string; jumlah: number }[] | null;
  fakturBelumLunas: { jumlah: number; sisa: Desimal; daftar: FakturMenunggu[] } | null;
  pendapatanLunas: { tahun: number; nilai: Desimal } | null;
};

/**
 * Data panel dokumen penjualan (D7 §3.5): penawaran per status (penawaran.lihat), faktur belum lunas dan pendapatan
 * lunas tahun buku berjalan (faktur.lihat). Bagian tanpa hak bernilai null dan kuerinya tidak dijalankan.
 * Faktur belum lunas memakai definisi beranda keuangan: DISETUJUI, status bukan LUNAS, sisa = total - uang muka
 * - penerimaan (termasuk potongan pajak) - retur.
 */
export async function muatPenjualanDokumen(pengguna: PenggunaSesi, perusahaanId: string | null): Promise<DataPenjualanDokumen> {
  const p = saringPerusahaan(perusahaanId);
  const bolehPenawaran = punyaHak(pengguna, "penawaran.lihat");
  const bolehFaktur = punyaHak(pengguna, "faktur.lihat");
  const [perStatus, belumLunas, tahunBuku] = await Promise.all([
    bolehPenawaran ? db.penawaranPenjualan.groupBy({ by: ["status"], where: p, _count: { _all: true } }) : Promise.resolve(null),
    bolehFaktur
      ? db.fakturPenjualan.findMany({
          where: { status: { not: "LUNAS" }, statusPersetujuan: "DISETUJUI", ...p },
          select: {
            id: true, nomor: true, jatuhTempo: true, total: true, uangMuka: true,
            pelanggan: { select: { nama: true } },
            perusahaan: { select: { kode: true, nama: true, warna: true } },
            penerimaan: { select: { jumlah: true, potonganPajak: true } },
            retur: { select: { total: true } },
          },
        })
      : Promise.resolve(null),
    bolehFaktur ? ambilPengaturanPerusahaan(db).then((x) => x.tahunBuku) : Promise.resolve(null),
  ]);

  let pendapatanLunas: DataPenjualanDokumen["pendapatanLunas"] = null;
  if (bolehFaktur && tahunBuku !== null) {
    const dari = bacaWaktuLokal(`${tahunBuku}-01-01T00:00`) ?? new Date(tahunBuku, 0, 1);
    const sampai = bacaWaktuLokal(`${tahunBuku + 1}-01-01T00:00`) ?? new Date(tahunBuku + 1, 0, 1);
    const agg = await db.fakturPenjualan.aggregate({
      where: { status: "LUNAS", statusPersetujuan: "DISETUJUI", tanggal: { gte: dari, lt: sampai }, ...p },
      _sum: { dpp: true },
    });
    pendapatanLunas = { tahun: tahunBuku, nilai: D(agg._sum.dpp) };
  }

  let fakturBelumLunas: DataPenjualanDokumen["fakturBelumLunas"] = null;
  if (belumLunas) {
    const baris: FakturMenunggu[] = belumLunas.map((f) => ({
      id: f.id,
      nomor: f.nomor,
      pelanggan: f.pelanggan.nama,
      jatuhTempo: f.jatuhTempo,
      sisa: D(f.total)
        .minus(D(f.uangMuka))
        .minus(jumlahkan(f.penerimaan.map((r) => D(r.jumlah).plus(D(r.potonganPajak)))))
        .minus(jumlahkan(f.retur.map((r) => r.total))),
      perusahaan: f.perusahaan,
    }));
    // jatuh tempo terdekat dulu; tanpa jatuh tempo paling akhir
    const urut = [...baris].sort((a, b) => {
      if (!a.jatuhTempo || !b.jatuhTempo) return (a.jatuhTempo ? 0 : 1) - (b.jatuhTempo ? 0 : 1) || a.nomor.localeCompare(b.nomor);
      return a.jatuhTempo.getTime() - b.jatuhTempo.getTime() || a.nomor.localeCompare(b.nomor);
    });
    fakturBelumLunas = { jumlah: baris.length, sisa: jumlahkan(baris.map((b) => b.sisa)), daftar: urut.slice(0, 6) };
  }

  const penawaranPerStatus = perStatus
    ? perStatus.map((g) => ({ status: g.status as string, jumlah: g._count._all })).sort((a, b) => urutanStatus(a.status) - urutanStatus(b.status))
    : null;
  return { penawaranPerStatus, fakturBelumLunas, pendapatanLunas };
}

const URUTAN_STATUS = ["DRAF", "DIPROSES", "SEBAGIAN", "DIKONVERSI", "LUNAS", "DIBATALKAN"];
/** Label status penawaran (sama dengan LencanaStatus). */
const LABEL_STATUS_DOKUMEN: Record<string, string> = { DRAF: "Draf", DIPROSES: "Diproses", SEBAGIAN: "Sebagian", DIKONVERSI: "Dikonversi", LUNAS: "Lunas", DIBATALKAN: "Dibatalkan" };
const urutanStatus = (s: string) => (URUTAN_STATUS.indexOf(s) + 1 || 99);

export default async function PanelPenjualanDokumen({ pengguna, perusahaanId }: { pengguna: PenggunaSesi; perusahaanId: string | null }) {
  if (!punyaHak(pengguna, "penawaran.lihat") && !punyaHak(pengguna, "faktur.lihat")) return null;
  const data = await muatPenjualanDokumen(pengguna, perusahaanId);
  const sekarang = new Date();
  const gabungan = perusahaanId === null;
  const draf = data.penawaranPerStatus?.find((s) => s.status === "DRAF")?.jumlah ?? 0;

  return (
    <div className="space-y-7">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {data.penawaranPerStatus && <KartuKpi judul="Penawaran draf" ikon="request_quote" nilai={draf} awalan="" sub="Penawaran yang belum dikonversi" />}
        {data.fakturBelumLunas && (
          <KartuKpi
            judul="Faktur belum lunas"
            ikon="receipt_long"
            nilai={data.fakturBelumLunas.jumlah}
            awalan=""
            sub={`Sisa tagihan Rp ${Number(data.fakturBelumLunas.sisa).toLocaleString("id-ID")}`}
          />
        )}
        {data.pendapatanLunas && (
          <KartuKpi judul={`Pendapatan lunas ${data.pendapatanLunas.tahun}`} ikon="payments" nilai={Number(data.pendapatanLunas.nilai)} sub="Faktur lunas, tanpa PPN" />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7">
        {data.fakturBelumLunas && (
          <div className={`kartu kartu-tabel ${data.penawaranPerStatus ? "lg:col-span-8" : "lg:col-span-12"}`}>
            <div className="kepala-kartu">
              <div>
                <h2 className="judul-kartu">Faktur menunggu pembayaran</h2>
                <p className="subjudul-kartu">Enam faktur dengan jatuh tempo terdekat.</p>
              </div>
              <Link href="/penjualan/faktur" className="tombol tombol-lembut tombol-kecil">Buka faktur</Link>
            </div>
            <div className="bungkus-tabel">
              <table className="tabel min-w-[36rem]">
                <thead>
                  <tr>
                    <th>Nomor</th>
                    {gabungan && <th>Perusahaan</th>}
                    <th>Pelanggan</th>
                    <th>Jatuh tempo</th>
                    <th className="text-right">Sisa (Rp)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.fakturBelumLunas.daftar.map((f) => {
                    const lewat = !!f.jatuhTempo && f.jatuhTempo < sekarang;
                    return (
                      <tr key={f.id}>
                        <td><NomorDokumen nomor={f.nomor} /></td>
                        {gabungan && <td><LencanaPerusahaan kode={f.perusahaan.kode} warna={f.perusahaan.warna} nama={f.perusahaan.nama} /></td>}
                        <td className="text-slate-600">{f.pelanggan}</td>
                        <td className={`whitespace-nowrap ${lewat ? "text-rose-600 font-medium" : "text-slate-500"}`}>{f.jatuhTempo ? formatTanggal(f.jatuhTempo) : "-"}</td>
                        <td className="text-right"><Rp nilai={f.sisa} /></td>
                      </tr>
                    );
                  })}
                  {data.fakturBelumLunas.daftar.length === 0 && (
                    <tr>
                      <td colSpan={gabungan ? 5 : 4} className="kosong">Tidak ada faktur yang menunggu pembayaran.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {data.penawaranPerStatus && (
          <div className={`kartu ${data.fakturBelumLunas ? "lg:col-span-4" : "lg:col-span-12"}`}>
            <div className="kepala-kartu">
              <div>
                <h2 className="judul-kartu">Penawaran per status</h2>
                <p className="subjudul-kartu">Semua penawaran penjualan dalam lingkup ini.</p>
              </div>
              <Link href="/penjualan/penawaran" className="tombol tombol-lembut tombol-kecil">Buka penawaran</Link>
            </div>
            {data.penawaranPerStatus.length === 0 ? (
              <p className="text-sm text-slate-500">Belum ada penawaran.</p>
            ) : (
              <BatangStatus
                label="Jumlah penawaran per status"
                data={data.penawaranPerStatus.map((s) => ({ label: LABEL_STATUS_DOKUMEN[s.status] ?? s.status, nilai: s.jumlah }))}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
