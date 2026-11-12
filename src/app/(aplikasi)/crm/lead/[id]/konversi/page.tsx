import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { cariPelangganMirip } from "@/lib/crm";
import { tanggalIso } from "@/lib/waktu";
import { konversiLeadKePelangganFormulir, tautkanLeadKePelangganFormulir } from "@/lib/aksi/crm";
import FormulirAksi from "@/komponen/FormulirAksi";
import Ikon from "@/komponen/ui/Ikon";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";

/*
 * Jadikan pelanggan (D4 §3.7, §7.2): data yang disalin, pelanggan yang mirip (tautkan), dan formulir pelanggan baru.
 * Lead yang sudah berpelanggan langsung diarahkan (idempoten), ke penawaran baru bila ?lanjut=penawaran.
 */

export default async function HalamanKonversiLead({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ lanjut?: string | string[] }> }) {
  await wajibHak("lead.ubah");
  const pengguna = await wajibHak("data-induk.tulis");
  const { id } = await params;
  const q = await searchParams;
  const lanjut = q.lanjut === "penawaran" ? "penawaran" : "";
  const lead = await db.lead.findUnique({ where: { id }, include: { pic: { select: { nama: true, karyawan: { select: { nama: true } } } } } });
  if (!lead) notFound();
  if (lead.dihapusPada) redirect(`/crm/lead/${id}`);
  if (lead.pelangganId) redirect(lanjut && punyaHak(pengguna, "penawaran.buat") ? `/penjualan/penawaran/baru?leadId=${encodeURIComponent(id)}` : `/crm/lead/${id}`);

  const mirip = await cariPelangganMirip(db, lead);
  const rincianMirip = mirip.length
    ? await db.pelanggan.findMany({ where: { id: { in: mirip.map((p) => p.id) } }, select: { id: true, kode: true, nama: true, telepon: true, email: true }, orderBy: { kode: "asc" } })
    : [];
  const tahun = tanggalIso(new Date()).slice(0, 4);
  const salinan: [string, string, string][] = [
    ["Nama", "Perusahaan/usaha", lead.namaUsaha],
    ["Nama kontak", "Nama kontak", lead.nama],
    ["Email", "Email", lead.email ?? "-"],
    ["Telepon", "Telepon", lead.telepon],
    ["Alamat", "Lokasi", lead.lokasi ?? "-"],
    ["Penjual", "PIC", lead.pic?.karyawan?.nama ?? (lead.pic ? `- (${lead.pic.nama} belum terdaftar sebagai karyawan)` : "-")],
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      <KepalaHalaman
        jejak={[{ label: "CRM", href: "/crm/dasbor" }, { label: "Lead", href: "/crm/lead" }, { label: lead.nama, href: `/crm/lead/${id}` }, { label: "Jadikan pelanggan" }]}
        judul="Jadikan pelanggan"
        subjudul={lanjut ? "Sesudah lead menjadi pelanggan, formulir penawaran baru langsung dibuka." : undefined}
      />

      <div className="kartu kartu-tabel">
        <div className="px-5 md:px-6 pt-5">
          <h2 className="judul-kartu">Data yang akan disalin</h2>
          <p className="subjudul-kartu">WhatsApp, Instagram, situs web, industri, catatan, tag, dan field tambahan tetap di lead.</p>
        </div>
        <div className="bungkus-tabel">
          <table className="tabel min-w-[32rem]">
            <thead>
              <tr>
                <th>Pelanggan</th>
                <th>Dari lead</th>
                <th>Isi</th>
              </tr>
            </thead>
            <tbody>
              {salinan.map(([pel, dari, isi]) => (
                <tr key={pel}>
                  <td>{pel}</td>
                  <td className="text-slate-500">{dari}</td>
                  <td className="break-words">{isi}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="kartu kartu-tabel">
        <div className="px-5 md:px-6 pt-5">
          <h2 className="judul-kartu">Pelanggan yang mirip</h2>
          <p className="subjudul-kartu">Nama, telepon, atau email sama dengan lead ini. Data pelanggan yang ditautkan tidak diubah.</p>
        </div>
        <div className="bungkus-tabel">
          <table className="tabel min-w-[40rem]">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Nama</th>
                <th>Telepon</th>
                <th>Email</th>
                <th className="th-lekat" aria-label="Aksi" />
              </tr>
            </thead>
            <tbody>
              {rincianMirip.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-slate-500">
                    Tidak ada pelanggan yang mirip.
                  </td>
                </tr>
              ) : (
                rincianMirip.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.kode}</td>
                    <td>{p.nama}</td>
                    <td>{p.telepon ?? "-"}</td>
                    <td>{p.email ?? "-"}</td>
                    <td className="td-lekat">
                      <FormulirAksi aksi={tautkanLeadKePelangganFormulir.bind(null, id, p.id)}>
                        <input type="hidden" name="lanjut" value={lanjut} />
                        <button type="submit" className="tombol-tautan inline-flex items-center gap-1">
                          <Ikon nama="link" className="!text-[16px]" />
                          Tautkan ke pelanggan ini
                        </button>
                      </FormulirAksi>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <FormulirAksi aksi={konversiLeadKePelangganFormulir.bind(null, id)} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <h2 className="judul-kartu">Buat pelanggan baru</h2>
        </div>
        <input type="hidden" name="lanjut" value={lanjut} />
        <div className="bidang">
          <label className="label" htmlFor="kode">
            Kode pelanggan
          </label>
          <input id="kode" name="kode" maxLength={30} className="isian mono" />
          <span className="petunjuk">Kosongkan untuk kode otomatis PLG-{tahun}-NNNN. Kode manual tanpa spasi dan tidak boleh berpola PLG-tahun-nomor.</span>
        </div>
        {rincianMirip.length > 0 && (
          <label className="md:col-span-2 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="abaikanMirip" value="1" />
            Tetap buat pelanggan baru walau ada yang mirip
          </label>
        )}
        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama w-full sm:w-auto min-h-11">
            <Ikon nama="how_to_reg" className="!text-[18px]" />
            Buat pelanggan
          </button>
        </div>
      </FormulirAksi>
    </div>
  );
}
