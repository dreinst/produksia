import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { muatPetaKategori } from "@/lib/kategoriAnggaran";
import { NAMA_TANPA_KATEGORI } from "@/lib/keuanganProyek";
import { formatTanggal, formatWaktu } from "@/lib/waktu";
import { hapusDokumenFormulir } from "@/lib/aksi/hapusDokumen";
import FormulirAksi from "@/komponen/FormulirAksi";
import KontrolPersetujuan from "@/komponen/KontrolPersetujuan";
import LampiranBerkas from "@/komponen/berkas/LampiranBerkas";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import { LencanaPersetujuan, NomorDokumen } from "@/komponen/ui/Lencana";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";

/*
 * Detail Talangan Mitra (D5 §7.2): rincian, alur persetujuan, hapus, dan bukti. Dokumen yang tidak milik proyek di URL
 * memberi 404. Sesudah dihapus, pengguna dibawa ke tab Bagi hasil (atau halaman yang boleh ia buka).
 */

export default async function HalamanDetailTalangan({ params }: { params: Promise<{ id: string; dokId: string }> }) {
  const pengguna = await wajibHak("talangan-mitra.lihat");
  const boleh = (h: Parameters<typeof punyaHak>[1]) => punyaHak(pengguna, h);
  const { id, dokId } = await params;
  const d = await db.talanganMitra.findUnique({
    where: { id: dokId },
    include: {
      mitra: { select: { nama: true } },
      proyek: { select: { id: true, kode: true, nama: true } },
      perusahaan: { select: { kode: true, nama: true, warna: true } },
      akunBeban: { select: { id: true, kode: true, nama: true } },
      jurnal: { select: { nomor: true } },
      disetujuiOleh: { select: { nama: true } },
    },
  });
  if (!d || d.proyekId !== id) notFound();
  const peta = await muatPetaKategori(db);
  const kategori = peta.kategoriUntukAkun(d.akunBeban.id);
  const keuangan = boleh("anggaran-proyek.lihat") ? `/proyek/${d.proyek.id}/keuangan` : null;
  const sesudahHapus = keuangan && boleh("bagi-hasil.lihat") ? `${keuangan}?tab=bagi-hasil` : keuangan ?? (boleh("proyek.lihat") ? `/proyek/${d.proyek.id}` : "/persetujuan");
  const baris: [string, React.ReactNode][] = [
    ["Mitra", d.mitra.nama],
    ["Proyek", keuangan ? <Link href={keuangan} className="tombol-tautan">{`${d.proyek.kode} · ${d.proyek.nama}`}</Link> : `${d.proyek.kode} · ${d.proyek.nama}`],
    ["Tanggal", formatTanggal(d.tanggal)],
    ["Akun beban", `${d.akunBeban.kode} ${d.akunBeban.nama}`],
    ["Kategori", kategori ? (peta.namaKategori.get(kategori) ?? NAMA_TANPA_KATEGORI) : NAMA_TANPA_KATEGORI],
    ["Jumlah", `Rp ${Number(d.jumlah).toLocaleString("id-ID")}`],
    ["Uraian", d.deskripsi],
    ["Vendor", d.vendor ?? "-"],
    ["Catatan", d.catatan ?? "-"],
    ["Dicatat oleh", `${d.dicatatOlehNama} · ${formatWaktu(d.dibuatPada)}`],
    ["Disetujui oleh", d.disetujuiOleh ? `${d.disetujuiOleh.nama}${d.disetujuiPada ? ` · ${formatWaktu(d.disetujuiPada)}` : ""}` : "-"],
    ["Jurnal", d.jurnal ? <NomorDokumen nomor={d.jurnal.nomor} /> : "Belum dijurnal"],
  ];

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Keuangan Proyek", href: keuangan ? "/proyek/keuangan" : undefined }, { label: d.proyek.kode, href: keuangan ?? undefined }, { label: d.nomor }]}
        judul={`Talangan Mitra ${d.nomor}`}
        lencana={
          <span className="flex items-center gap-2">
            <LencanaPersetujuan status={d.statusPersetujuan} />
            <LencanaPerusahaan kode={d.perusahaan.kode} warna={d.perusahaan.warna} nama={d.perusahaan.nama} />
          </span>
        }
        aksi={
          <span className="flex flex-wrap items-center gap-3">
            <KontrolPersetujuan jenis="talanganMitra" kode="talangan-mitra" id={d.id} nomor={d.nomor} status={d.statusPersetujuan} diajukanOlehId={d.diajukanOlehId} pengguna={pengguna} catatanPenolakan={d.catatanPenolakan} />
            {boleh("talangan-mitra.hapus") && (
              <FormulirAksi
                aksi={hapusDokumenFormulir.bind(null, "talanganMitra", d.id)}
                pesanKonfirmasi={`Hapus ${d.nomor}? Jurnalnya akan dibalik. Tindakan ini dicatat di log aktivitas.`}
                alihkanKe={sesudahHapus}
                className="inline"
              >
                <button type="submit" className="tombol-tautan-bahaya">
                  Hapus
                </button>
              </FormulirAksi>
            )}
          </span>
        }
      />
      <section className="kartu">
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          {baris.map(([label, isi]) => (
            <div key={label}>
              <dt className="teks-label">{label}</dt>
              <dd className="mt-1 text-slate-800">{isi}</dd>
            </div>
          ))}
        </dl>
      </section>
      <LampiranBerkas jenisEntitas="talangan-mitra" entitasId={d.id} judul="Bukti (nota, kuitansi, transfer)" kosong="Belum ada bukti untuk talangan ini." />
    </div>
  );
}
