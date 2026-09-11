import { wajibMasuk } from "@/lib/otentikasi";
import { punyaHak, type Hak } from "@/lib/hakAkses";
import Link from "next/link";
import { db } from "@/lib/db";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import { NomorDokumen, LencanaStatus } from "@/komponen/ui/Lencana";

type Hit = { nomor: string; tanggal?: Date; status?: string; siapa?: string; href: string; jenis: string };

export default async function HalamanCari({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const pengguna = await wajibMasuk();
  const boleh = (hak: Hak) => punyaHak(pengguna, hak);
  const { q = "" } = await searchParams;
  const term = q.trim();
  const ci = { contains: term, mode: "insensitive" as const };

  // Tiap kelompok hasil hanya dikueri bila pemanggil punya hak-lihat modul terkait,
  // supaya /cari tidak membocorkan dokumen (mis. jurnal & mutasi kas) ke peran yang dilarang.
  const [sq, so, dov, inv, rcp, ret, po, gr, pinv, pp, pret, ju, daftarPelanggan, daftarPemasok, daftarBarang, daftarAkun] = term
    ? await Promise.all([
        boleh("penawaran.lihat") ? db.penawaranPenjualan.findMany({ where: { nomor: ci }, include: { pelanggan: true }, take: 10 }) : [],
        boleh("pesanan.lihat") ? db.pesananPenjualan.findMany({ where: { nomor: ci }, include: { pelanggan: true }, take: 10 }) : [],
        boleh("pengiriman.lihat") ? db.pengirimanPesanan.findMany({ where: { nomor: ci }, include: { pesanan: { include: { pelanggan: true } } }, take: 10 }) : [],
        boleh("faktur.lihat") ? db.fakturPenjualan.findMany({ where: { nomor: ci }, include: { pelanggan: true }, take: 10 }) : [],
        boleh("penerimaan.lihat") ? db.penerimaanPenjualan.findMany({ where: { nomor: ci }, include: { pelanggan: true }, take: 10 }) : [],
        boleh("retur-penjualan.lihat") ? db.returPenjualan.findMany({ where: { nomor: ci }, include: { faktur: { include: { pelanggan: true } } }, take: 10 }) : [],
        boleh("pesanan-pembelian.lihat") ? db.pesananPembelian.findMany({ where: { nomor: ci }, include: { pemasok: true }, take: 10 }) : [],
        boleh("penerimaan-barang.lihat") ? db.penerimaanBarang.findMany({ where: { nomor: ci }, include: { pesanan: { include: { pemasok: true } } }, take: 10 }) : [],
        boleh("faktur-pembelian.lihat") ? db.fakturPembelian.findMany({ where: { nomor: ci }, include: { pemasok: true }, take: 10 }) : [],
        boleh("pembayaran.lihat") ? db.pembayaranPembelian.findMany({ where: { nomor: ci }, include: { pemasok: true }, take: 10 }) : [],
        boleh("retur-pembelian.lihat") ? db.returPembelian.findMany({ where: { nomor: ci }, include: { faktur: { include: { pemasok: true } } }, take: 10 }) : [],
        boleh("jurnal.lihat") ? db.jurnal.findMany({ where: { OR: [{ nomor: ci }, { keterangan: ci }] }, take: 10 }) : [],
        boleh("data-induk.lihat") ? db.pelanggan.findMany({ where: { OR: [{ kode: ci }, { nama: ci }] }, take: 10 }) : [],
        boleh("data-induk.lihat") ? db.pemasok.findMany({ where: { OR: [{ kode: ci }, { nama: ci }] }, take: 10 }) : [],
        boleh("data-induk.lihat") ? db.barang.findMany({ where: { OR: [{ kode: ci }, { nama: ci }] }, take: 10 }) : [],
        boleh("data-induk.lihat") ? db.akun.findMany({ where: { OR: [{ kode: ci }, { nama: ci }] }, take: 10 }) : [],
      ])
    : [[], [], [], [], [], [], [], [], [], [], [], [], [], [], [], []];

  const docs: Hit[] = [
    ...sq.map((d) => ({ nomor: d.nomor, tanggal: d.tanggal, status: d.status, siapa: d.pelanggan.nama, href: "/penjualan/penawaran", jenis: "Penawaran" })),
    ...so.map((d) => ({ nomor: d.nomor, tanggal: d.tanggal, status: d.status, siapa: d.pelanggan.nama, href: "/penjualan/pesanan", jenis: "Pesanan Penjualan" })),
    ...dov.map((d) => ({ nomor: d.nomor, tanggal: d.tanggal, status: d.status, siapa: d.pesanan.pelanggan.nama, href: "/penjualan/pengiriman", jenis: "Pengiriman" })),
    ...inv.map((d) => ({ nomor: d.nomor, tanggal: d.tanggal, status: d.status, siapa: d.pelanggan.nama, href: "/penjualan/faktur", jenis: "Faktur Penjualan" })),
    ...rcp.map((d) => ({ nomor: d.nomor, tanggal: d.tanggal, siapa: d.pelanggan.nama, href: "/penjualan/penerimaan", jenis: "Penerimaan" })),
    ...ret.map((d) => ({ nomor: d.nomor, tanggal: d.tanggal, siapa: d.faktur.pelanggan.nama, href: "/penjualan/retur", jenis: "Retur Penjualan" })),
    ...po.map((d) => ({ nomor: d.nomor, tanggal: d.tanggal, status: d.status, siapa: d.pemasok.nama, href: "/pembelian/pesanan", jenis: "Pesanan Pembelian" })),
    ...gr.map((d) => ({ nomor: d.nomor, tanggal: d.tanggal, status: d.status, siapa: d.pesanan.pemasok.nama, href: "/pembelian/penerimaan-barang", jenis: "Penerimaan Barang" })),
    ...pinv.map((d) => ({ nomor: d.nomor, tanggal: d.tanggal, status: d.status, siapa: d.pemasok.nama, href: "/pembelian/faktur", jenis: "Faktur Pembelian" })),
    ...pp.map((d) => ({ nomor: d.nomor, tanggal: d.tanggal, siapa: d.pemasok.nama, href: "/pembelian/pembayaran", jenis: "Pembayaran" })),
    ...pret.map((d) => ({ nomor: d.nomor, tanggal: d.tanggal, siapa: d.faktur.pemasok.nama, href: "/pembelian/retur", jenis: "Retur Pembelian" })),
    ...ju.map((d) => ({ nomor: d.nomor, tanggal: d.tanggal, siapa: d.keterangan ?? "", href: "/buku-besar/jurnal", jenis: "Jurnal" })),
  ].sort((a, b) => (b.tanggal?.getTime() ?? 0) - (a.tanggal?.getTime() ?? 0));

  const masters = [
    ...daftarPelanggan.map((m) => ({ kode: m.kode, nama: m.nama, href: "/data-induk/pelanggan", jenis: "Pelanggan" })),
    ...daftarPemasok.map((m) => ({ kode: m.kode, nama: m.nama, href: "/data-induk/pemasok", jenis: "Pemasok" })),
    ...daftarBarang.map((m) => ({ kode: m.kode, nama: m.nama, href: "/data-induk/barang", jenis: "Barang" })),
    ...daftarAkun.map((m) => ({ kode: m.kode, nama: m.nama, href: "/data-induk/akun", jenis: "Akun" })),
  ];

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Beranda", href: "/" }, { label: "Pencarian" }]}
        judul={term ? `Hasil untuk “${term}”` : "Pencarian"}
        subjudul={term ? `${docs.length} dokumen · ${masters.length} master data` : "Ketik nomor dokumen, nama rekanan, barang, atau akun di kotak pencarian."}
      />

      {term && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 daftarBarang-awal">
          <div className="lg:col-span-8 kartu kartu-tabel">
            <div className="kepala-kartu">
              <div>
                <h2 className="judul-kartu">Dokumen</h2>
                <p className="kartu-subjudul">Klik untuk membuka daftar modul terkait.</p>
              </div>
            </div>
            <div className="bungkus-tabel">
              <table className="tabel min-w-[36rem]">
                <thead>
                  <tr>
                    <th>No Dokumen</th>
                    <th>Jenis</th>
                    <th>Tanggal</th>
                    <th>Rekanan / Memo</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={`${d.jenis}-${d.nomor}`}>
                      <td>
                        <Link href={d.href} className="hover:underline">
                          <NomorDokumen nomor={d.nomor} />
                        </Link>
                      </td>
                      <td>{d.jenis}</td>
                      <td className="text-slate-500">{d.tanggal?.toLocaleDateString("id-ID")}</td>
                      <td className="font-medium text-slate-900">{d.siapa}</td>
                      <td>{d.status ? <LencanaStatus status={d.status} /> : "-"}</td>
                    </tr>
                  ))}
                  {docs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="kosong">
                        Tidak ada dokumen yang cocok.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:col-span-4 kartu">
            <div className="kepala-kartu">
              <h2 className="judul-kartu">Data Induk</h2>
            </div>
            <ul className="divide-y divide-slate-100">
              {masters.map((m) => (
                <li key={`${m.jenis}-${m.kode}`} className="py-2 flex items-center justify-between gap-3">
                  <Link href={m.href} className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">{m.nama}</div>
                    <div className="mono text-slate-500">{m.kode}</div>
                  </Link>
                  <span className="lencana lencana-slate">{m.jenis}</span>
                </li>
              ))}
              {masters.length === 0 && <li className="py-6 text-center text-sm text-slate-400">Tidak ada master data yang cocok.</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
