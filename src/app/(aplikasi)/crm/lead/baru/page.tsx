import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { daftarPerusahaan, lingkupPerusahaan, perusahaanFormulir } from "@/lib/perusahaan";
import { daftarPenggunaCrm, pastikanBawaanCrm } from "@/lib/crm";
import { buatLeadFormulir } from "@/lib/aksi/crm";
import FormulirAksi from "@/komponen/FormulirAksi";
import FormulirLead from "@/komponen/crm/FormulirLead";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";

/*
 * Lead baru (D4 §7.2, §3.13 no. 3). Tahap dan sumber bergantung perusahaan, jadi gabungan (dan lingkup arsip) memilih
 * perusahaan lebih dulu lewat ?perusahaan=; ?pilih=1 menampilkan pilihan lagi. Aksi tetap memakai
 * perusahaanDokumenBaru atas isian tersembunyi perusahaanId.
 */

export default async function HalamanLeadBaru({ searchParams }: { searchParams: Promise<{ perusahaan?: string | string[]; pilih?: string | string[] }> }) {
  await wajibHak("lead.buat");
  const q = await searchParams;
  const pilihan = typeof q.perusahaan === "string" ? q.perusahaan : undefined;
  const [lingkup, aktif] = await Promise.all([lingkupPerusahaan(), daftarPerusahaan()]);
  const p = q.pilih === "1" ? null : (aktif.find((x) => x.id === pilihan) ?? aktif.find((x) => x.id === perusahaanFormulir(lingkup)) ?? null);

  if (!p) {
    return (
      <div className="space-y-6 max-w-3xl">
        <KepalaHalaman jejak={[{ label: "CRM", href: "/crm/dasbor" }, { label: "Lead", href: "/crm/lead" }, { label: "Lead baru" }]} judul="Lead baru" />
        <div className="kartu space-y-3 max-w-xl">
          <h2 className="judul-kartu">Pilih perusahaan untuk lead ini</h2>
          <p className="redup text-sm">Tahap pipeline, sumber lead, dan pengingat mengikuti perusahaan yang dipilih.</p>
          <ul className="space-y-2">
            {aktif.map((x) => (
              <li key={x.id}>
                <Link href={`/crm/lead/baru?perusahaan=${encodeURIComponent(x.id)}`} className="flex items-center gap-2 rounded border border-slate-200 px-3 py-2 hover:bg-slate-50">
                  <LencanaPerusahaan kode={x.kode} warna={x.warna} />
                  <span>{x.nama}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  await pastikanBawaanCrm(db, p.id);
  const [tahap, sumber, penggunaCrm] = await Promise.all([
    db.tahapLead.findMany({ where: { perusahaanId: p.id, jenis: "BERJALAN" }, orderBy: [{ urutan: "asc" }, { id: "asc" }], select: { id: true, nama: true } }),
    db.sumberLead.findMany({ where: { perusahaanId: p.id }, orderBy: [{ urutan: "asc" }, { nama: "asc" }], select: { nama: true } }),
    daftarPenggunaCrm(db),
  ]);

  return (
    <div className="space-y-6 max-w-3xl">
      <KepalaHalaman jejak={[{ label: "CRM", href: "/crm/dasbor" }, { label: "Lead", href: "/crm/lead" }, { label: "Lead baru" }]} judul="Lead baru" />
      <p className="text-sm text-slate-600 flex flex-wrap items-center gap-2">
        Perusahaan: <LencanaPerusahaan kode={p.kode} warna={p.warna} /> {p.nama}
        <Link href="/crm/lead/baru?pilih=1" className="tombol-tautan">
          ganti
        </Link>
      </p>
      <FormulirAksi key={p.id} aksi={buatLeadFormulir} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormulirLead mode="buat" perusahaanId={p.id} sumber={sumber.map((s) => s.nama)} pengguna={penggunaCrm} tahapAwal={tahap} batalHref="/crm/lead" />
      </FormulirAksi>
    </div>
  );
}
