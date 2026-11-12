import { wajibMasuk } from "@/lib/otentikasi";
import { punyaHak, type Hak } from "@/lib/hakAkses";
import Link from "next/link";
import { db } from "@/lib/db";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import { NomorDokumen, LencanaStatus } from "@/komponen/ui/Lencana";
import { lingkupPerusahaan, daftarPerusahaan } from "@/lib/perusahaan";
import { cariPekerjaan, syaratNomorDokumen, MIN_KATA_CARI, type KelompokCari } from "@/lib/cariGlobal";
import { jadikanLingkupAktifFormulir } from "@/lib/aksi/perusahaan";
import FormulirAksi from "@/komponen/FormulirAksi";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";

type Hit = { nomor: string; nomorCetak?: string | null; tanggal?: Date; status?: string; siapa?: string; href: string; jenis: string };

export default async function HalamanCari({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const pengguna = await wajibMasuk();
  const boleh = (hak: Hak) => punyaHak(pengguna, hak);
  const { q = "" } = await searchParams;
  const term = q.trim();
  const ci = { contains: term, mode: "insensitive" as const };

  // Tiap kelompok hasil hanya dikueri bila pemanggil punya hak-lihat modul terkait,
  // supaya /cari tidak membocorkan dokumen (mis. jurnal & mutasi kas) ke peran yang dilarang.
  // Kelompok lama tetap lintas perusahaan (DESAIN G12); penawaran, faktur, dan penerimaan juga dicari lewat nomor cetak
  // (D2 §8.3) dan menaut ke halaman detailnya.
  const [sq, so, dov, inv, rcp, ret, po, gr, pinv, pp, pret, ju, daftarPelanggan, daftarPemasok, daftarBarang, daftarAkun] = term
    ? await Promise.all([
        boleh("penawaran.lihat") ? db.penawaranPenjualan.findMany({ where: syaratNomorDokumen(term), include: { pelanggan: true }, take: 10 }) : [],
        boleh("pesanan.lihat") ? db.pesananPenjualan.findMany({ where: { nomor: ci }, include: { pelanggan: true }, take: 10 }) : [],
        boleh("pengiriman.lihat") ? db.pengirimanPesanan.findMany({ where: { nomor: ci }, include: { pesanan: { include: { pelanggan: true } } }, take: 10 }) : [],
        boleh("faktur.lihat") ? db.fakturPenjualan.findMany({ where: syaratNomorDokumen(term), include: { pelanggan: true }, take: 10 }) : [],
        boleh("penerimaan.lihat") ? db.penerimaanPenjualan.findMany({ where: syaratNomorDokumen(term), include: { pelanggan: true }, take: 10 }) : [],
        boleh("retur-penjualan.lihat") ? db.returPenjualan.findMany({ where: { nomor: ci }, include: { faktur: { include: { pelanggan: true } } }, take: 10 }) : [],
        boleh("pesanan-pembelian.lihat") ? db.pesananPembelian.findMany({ where: { nomor: ci }, include: { pemasok: true }, take: 10 }) : [],
        boleh("penerimaan-barang.lihat") ? db.penerimaanBarang.findMany({ where: { nomor: ci }, include: { pesanan: { include: { pemasok: true } } }, take: 10 }) : [],
        boleh("faktur-pembelian.lihat") ? db.fakturPembelian.findMany({ where: { nomor: ci }, include: { pemasok: true }, take: 10 }) : [],
        boleh("pembayaran.lihat") ? db.pembayaranPembelian.findMany({ where: { nomor: ci }, include: { pemasok: true }, take: 10 }) : [],
        boleh("retur-pembelian.lihat") ? db.returPembelian.findMany({ where: { nomor: ci }, include: { faktur: { include: { pemasok: true } } }, take: 10 }) : [],
        boleh("jurnal.lihat") ? db.jurnal.findMany({ where: { OR: [{ nomor: ci }, { keterangan: ci }] }, take: 10 }) : [],
        boleh("data-induk.lihat") ? db.pelanggan.findMany({ where: { OR: [{ kode: ci }, { nama: ci }] }, take: 10 }) : [],
        boleh("data-induk.lihat") ? db.pemasok.findMany({ where: { OR: [{ kode: ci }, { nama: ci }] }, take: 10 }) : [],
        boleh("stok-induk.lihat") ? db.barang.findMany({ where: { OR: [{ kode: ci }, { nama: ci }] }, take: 10 }) : [],
        boleh("data-induk.lihat") ? db.akun.findMany({ where: { OR: [{ kode: ci }, { nama: ci }] }, take: 10 }) : [],
      ])
    : [[], [], [], [], [], [], [], [], [], [], [], [], [], [], [], []];

  const docs: Hit[] = [
    ...sq.map((d) => ({ nomor: d.nomor, nomorCetak: d.nomorCetak, tanggal: d.tanggal, status: d.status, siapa: d.pelanggan.nama, href: `/penjualan/penawaran/${d.id}`, jenis: "Penawaran" })),
    ...so.map((d) => ({ nomor: d.nomor, tanggal: d.tanggal, status: d.status, siapa: d.pelanggan.nama, href: "/penjualan/pesanan", jenis: "Pesanan Penjualan" })),
    ...dov.map((d) => ({ nomor: d.nomor, tanggal: d.tanggal, status: d.status, siapa: d.pesanan.pelanggan.nama, href: "/penjualan/pengiriman", jenis: "Pengiriman" })),
    ...inv.map((d) => ({ nomor: d.nomor, nomorCetak: d.nomorCetak, tanggal: d.tanggal, status: d.status, siapa: d.pelanggan.nama, href: `/penjualan/faktur/${d.id}`, jenis: "Faktur Penjualan" })),
    ...rcp.map((d) => ({ nomor: d.nomor, nomorCetak: d.nomorCetak, tanggal: d.tanggal, siapa: d.pelanggan.nama, href: `/penjualan/penerimaan/${d.id}`, jenis: "Penerimaan" })),
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

  // Kelompok "Pekerjaan & Berkas" (D7 §3.6): mengikuti lingkup aktif, minimal MIN_KATA_CARI karakter
  const lingkup = await lingkupPerusahaan();
  const [pekerjaan, semuaPerusahaan] = await Promise.all([cariPekerjaan(pengguna, term, lingkup.perusahaanId), lingkup.perusahaanId === null ? daftarPerusahaan(true) : Promise.resolve([])]);
  const petaPerusahaan = new Map(semuaPerusahaan.map((p) => [p.id, p]));
  const jumlahPekerjaan = pekerjaan.reduce((n, k) => n + k.hasil.length, 0);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Beranda", href: "/" }, { label: "Pencarian" }]}
        judul={term ? `Hasil untuk “${term}”` : "Pencarian"}
        subjudul={
          term
            ? `${docs.length} dokumen · ${masters.length} master data${jumlahPekerjaan > 0 ? ` · ${jumlahPekerjaan} pekerjaan & berkas` : ""}`
            : "Ketik nomor dokumen, nama rekanan, barang, atau akun di kotak pencarian."
        }
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
                        {d.nomorCetak && d.nomorCetak !== d.nomor && <div className="mono text-xs text-slate-500">{d.nomorCetak}</div>}
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

      {term && <KartuPekerjaan term={term} kelompok={pekerjaan} petaPerusahaan={petaPerusahaan} />}
    </div>
  );
}

/** Kartu ketiga "Pekerjaan & Berkas": hasil cariPekerjaan per jenis, dengan lencana jenis dan perusahaan (gabungan). */
function KartuPekerjaan({
  term,
  kelompok,
  petaPerusahaan,
}: {
  term: string;
  kelompok: KelompokCari[];
  petaPerusahaan: Map<string, { kode: string; nama: string; warna: string | null }>;
}) {
  return (
    <section className="kartu" aria-labelledby="judul-pekerjaan">
      <div className="kepala-kartu">
        <div>
          <h2 id="judul-pekerjaan" className="judul-kartu">
            Pekerjaan &amp; Berkas
          </h2>
          <p className="subjudul-kartu">Proyek, dokumen mitra, lead, konten, desain, kampanye, berkas, dan perusahaan dalam lingkup aktif.</p>
        </div>
      </div>
      {term.length < MIN_KATA_CARI ? (
        <p className="py-4 text-center text-sm text-slate-400">Ketik minimal {MIN_KATA_CARI} karakter untuk mencari pekerjaan dan berkas.</p>
      ) : kelompok.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">Tidak ada pekerjaan atau berkas yang cocok.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5">
          {kelompok.map((k) => (
            <div key={k.jenis}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">{k.label}</h3>
              <ul className="divide-y divide-slate-100">
                {k.hasil.map((h) => {
                  const p = h.perusahaanId ? petaPerusahaan.get(h.perusahaanId) : undefined;
                  return (
                    <li key={h.id} className="py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        {k.jenis === "perusahaan" ? (
                          <div className="text-sm font-medium text-slate-900 truncate">{h.judul}</div>
                        ) : (
                          <Link href={h.href} className="block text-sm font-medium text-slate-900 truncate hover:text-blue-700 hover:underline">
                            {h.judul}
                          </Link>
                        )}
                        {h.sub && <div className="text-xs text-slate-500 truncate">{h.sub}</div>}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {p && <LencanaPerusahaan kode={p.kode} warna={p.warna} nama={p.nama} />}
                        {k.jenis === "perusahaan" ? (
                          h.lingkupAktif ? (
                            <span className="lencana lencana-emerald">Lingkup aktif</span>
                          ) : (
                            <FormulirAksi aksi={jadikanLingkupAktifFormulir.bind(null, h.id)}>
                              <button type="submit" className="tombol tombol-garis tombol-kecil">
                                Jadikan lingkup aktif
                              </button>
                            </FormulirAksi>
                          )
                        ) : (
                          <span className="lencana lencana-slate">{k.label}</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
