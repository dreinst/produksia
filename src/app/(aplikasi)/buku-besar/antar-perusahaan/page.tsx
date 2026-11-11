import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { lingkupPerusahaan } from "@/lib/perusahaan";
import { formatTanggal } from "@/lib/waktu";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import { NomorDokumen, Rp } from "@/komponen/ui/Lencana";

/**
 * Daftar Transaksi Antar Perusahaan (D1 §7.2). Lingkup satu perusahaan menampilkan transaksi yang perusahaan itu
 * menjadi pemberi ATAU penerima; gabungan menampilkan semua. Hapus lewat hapusDokumen("antarPerusahaan") membalik
 * kedua jurnalnya.
 */
export default async function HalamanAntarPerusahaan({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("antar-perusahaan.lihat");
  const bolehBuat = punyaHak(pengguna, "antar-perusahaan.buat");
  const bolehHapus = punyaHak(pengguna, "antar-perusahaan.hapus");
  const param = await bacaParamDaftar(searchParams);
  const lp = (await lingkupPerusahaan()).perusahaanId;
  const cari = param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { keterangan: cocokTeks(param.q) }] } : {};
  const where = { AND: [cari, lp ? { OR: [{ pemberiId: lp }, { penerimaId: lp }] } : {}] };
  const pilihPerusahaan = { select: { kode: true, nama: true, warna: true } } as const;
  const [total, daftar] = await Promise.all([
    db.transaksiAntarPerusahaan.count({ where }),
    db.transaksiAntarPerusahaan.findMany({
      where,
      include: { pemberi: pilihPerusahaan, penerima: pilihPerusahaan, jurnalPemberi: { select: { nomor: true } }, jurnalPenerima: { select: { nomor: true } } },
      orderBy: [{ tanggal: "desc" }, { nomor: "desc" }],
      skip: param.lewati,
      take: param.ambil,
    }),
  ]);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Buku Besar" }, { label: "Transaksi Antar Perusahaan" }]}
        judul="Transaksi Antar Perusahaan"
        subjudul="Tagihan dan pelunasan antar perusahaan grup. Setiap transaksi membuat dua jurnal: Piutang Antar Perusahaan di buku pemberi dan Hutang Antar Perusahaan di buku penerima."
        aksi={
          bolehBuat ? (
            <Link className="tombol tombol-utama" href="/buku-besar/antar-perusahaan/baru">
              + Transaksi Antar Perusahaan
            </Link>
          ) : undefined
        }
      />

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari nomor / keterangan" />
        <div className="bungkus-tabel">
          <table className="tabel min-w-[56rem]">
            <thead>
              <tr>
                <th>Nomor</th>
                <th>Tanggal</th>
                <th>Jenis</th>
                <th>Pemberi → Penerima</th>
                <th className="text-right">Jumlah</th>
                <th>Jurnal</th>
                <th>Keterangan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {daftar.map((t) => (
                <tr key={t.id}>
                  <td>
                    <NomorDokumen nomor={t.nomor} />
                  </td>
                  <td className="text-slate-500 whitespace-nowrap">{formatTanggal(t.tanggal)}</td>
                  <td>{t.jenis === "TAGIH" ? <span className="lencana lencana-blue">Tagih</span> : <span className="lencana lencana-emerald">Lunas</span>}</td>
                  <td className="whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <LencanaPerusahaan kode={t.pemberi.kode} warna={t.pemberi.warna} nama={t.pemberi.nama} />
                      <span className="text-slate-400" aria-label="ke">
                        →
                      </span>
                      <LencanaPerusahaan kode={t.penerima.kode} warna={t.penerima.warna} nama={t.penerima.nama} />
                    </span>
                  </td>
                  <td className="text-right">
                    Rp <Rp nilai={t.jumlah} />
                  </td>
                  <td>
                    <div className="flex flex-col gap-1">
                      {t.jurnalPemberi && <NomorDokumen nomor={t.jurnalPemberi.nomor} />}
                      {t.jurnalPenerima && <NomorDokumen nomor={t.jurnalPenerima.nomor} />}
                    </div>
                  </td>
                  <td className="text-slate-600">{t.keterangan}</td>
                  <td className="text-right">
                    <TombolHapusDokumen
                      jenis="antarPerusahaan"
                      id={t.id}
                      nomor={t.nomor}
                      boleh={bolehHapus}
                      pesanKonfirmasi={`Hapus ${t.nomor}? Kedua jurnalnya (buku ${t.pemberi.kode} dan buku ${t.penerima.kode}) ikut dihapus. Tindakan ini dicatat di log aktivitas.`}
                    />
                  </td>
                </tr>
              ))}
              {daftar.length === 0 && (
                <tr>
                  <td colSpan={8} className="kosong">
                    {param.q ? "Tidak ada yang cocok." : "Belum ada transaksi antar perusahaan"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
