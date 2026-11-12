import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { daftarPenggunaCrm, teksFieldTambahan } from "@/lib/crm";
import { ubahLeadFormulir } from "@/lib/aksi/crm";
import FormulirAksi from "@/komponen/FormulirAksi";
import FormulirLead from "@/komponen/crm/FormulirLead";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";

/*
 * Ubah lead (D4 §7.2, §3.4). Tanpa tahap dan perusahaan. PIC yang sudah tidak memenuhi syarat tetap tampil
 * "(nonaktif)" dan dikirim kosong (PIC tetap); sumber yang sudah dihapus dari daftar tetap bisa dipertahankan.
 */

export default async function HalamanUbahLead({ params }: { params: Promise<{ id: string }> }) {
  await wajibHak("lead.ubah");
  const { id } = await params;
  const lead = await db.lead.findUnique({ where: { id }, include: { pic: { select: { id: true, nama: true } } } });
  if (!lead) notFound();
  if (lead.dihapusPada) redirect(`/crm/lead/${id}`);
  const [sumber, penggunaCrm] = await Promise.all([
    db.sumberLead.findMany({ where: { perusahaanId: lead.perusahaanId }, orderBy: [{ urutan: "asc" }, { nama: "asc" }], select: { nama: true } }),
    daftarPenggunaCrm(db),
  ]);
  const picLama = lead.pic && !penggunaCrm.some((p) => p.id === lead.pic!.id) ? lead.pic : null;

  return (
    <div className="space-y-6 max-w-3xl">
      <KepalaHalaman jejak={[{ label: "CRM", href: "/crm/dasbor" }, { label: "Lead", href: "/crm/lead" }, { label: lead.nama, href: `/crm/lead/${id}` }, { label: "Ubah" }]} judul="Ubah lead" />
      <FormulirAksi aksi={ubahLeadFormulir.bind(null, id)} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormulirLead
          mode="ubah"
          nilai={{
            nama: lead.nama,
            namaUsaha: lead.namaUsaha,
            telepon: lead.telepon,
            whatsapp: lead.whatsapp,
            email: lead.email,
            instagram: lead.instagram,
            website: lead.website,
            lokasi: lead.lokasi,
            sumber: lead.sumber,
            picId: lead.picId,
            industri: lead.industri,
            nilaiEstimasi: lead.nilaiEstimasi.toString(),
            tag: lead.tag,
            fieldTambahan: teksFieldTambahan(lead.fieldTambahan),
            catatan: lead.catatan,
          }}
          sumber={sumber.map((s) => s.nama)}
          pengguna={penggunaCrm}
          picLama={picLama}
          batalHref={`/crm/lead/${id}`}
        />
      </FormulirAksi>
    </div>
  );
}
