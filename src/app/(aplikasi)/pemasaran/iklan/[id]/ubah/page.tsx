import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { lingkupPerusahaan } from "@/lib/perusahaan";
import { ubahKampanyeFormulir } from "@/lib/aksi/iklan";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import FormulirKampanye from "@/komponen/iklan/FormulirKampanye";

/*
 * Ubah kampanye (D6 §7.7). Perusahaan kampanye tidak bisa diganti, jadi pilihan proyek hanya proyek perusahaan itu
 * (ditambah proyek sekarang walau sudah batal atau diarsipkan). Kampanye milik perusahaan di luar lingkup aktif hanya
 * memberi pemberitahuan (D6 §3.0 no. 5).
 */
export default async function HalamanUbahKampanye({ params }: { params: Promise<{ id: string }> }) {
  await wajibHak("kampanye.ubah");
  const { id } = await params;
  const k = await db.kampanye.findFirst({ where: { id, diarsipkanPada: null }, include: { perusahaan: { select: { nama: true } } } });
  if (!k) notFound();
  const lingkup = await lingkupPerusahaan();
  const jejak = [{ label: "Pemasaran" }, { label: "Perencana Iklan Meta", href: "/pemasaran/iklan" }, { label: k.nama, href: `/pemasaran/iklan/${k.id}` }, { label: "Ubah" }];
  if (lingkup.perusahaanId !== null && k.perusahaanId !== lingkup.perusahaanId) {
    return (
      <div className="space-y-6 max-w-3xl">
        <KepalaHalaman jejak={jejak} judul="Ubah kampanye" />
        <p className="kartu text-sm text-amber-800">Data ini milik {k.perusahaan.nama}. Ganti perusahaan aktif untuk membukanya.</p>
      </div>
    );
  }
  const proyek = await db.proyek.findMany({
    where: { perusahaanId: k.perusahaanId, OR: [{ status: { notIn: ["BATAL", "DIARSIP"] } }, ...(k.proyekId ? [{ id: k.proyekId }] : [])] },
    orderBy: { kode: "asc" },
    select: { id: true, kode: true, nama: true },
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <KepalaHalaman
        jejak={jejak}
        judul="Ubah kampanye"
        subjudul={k.nama}
        aksi={
          <Link href={`/pemasaran/iklan/${k.id}`} className="tombol tombol-garis">
            Kembali
          </Link>
        }
      />
      <FormulirKampanye
        aksi={ubahKampanyeFormulir.bind(null, k.id)}
        proyek={proyek.map((p) => ({ id: p.id, label: `${p.kode} - ${p.nama}` }))}
        nilai={{ nama: k.nama, tujuan: k.tujuan, anggaran: k.anggaran.toString(), status: k.status, tanggalMulai: k.tanggalMulai, tanggalSelesai: k.tanggalSelesai, proyekId: k.proyekId, catatan: k.catatan }}
      />
    </div>
  );
}
