import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { daftarPerusahaan, lingkupPerusahaan, saringPerusahaan } from "@/lib/perusahaan";
import { proyekBawaan } from "@/lib/filterProyek";
import { buatKampanyeFormulir } from "@/lib/aksi/iklan";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import FormulirKampanye from "@/komponen/iklan/FormulirKampanye";

/*
 * Kampanye baru (D6 §7.7). Nilai awal: tujuan Prospek, anggaran 0, status Direncanakan, proyek dari saringan halaman
 * daftar (?proyek=) bila proyek itu aktif di lingkup. Di lingkup gabungan perusahaan wajib dipilih, dan pilihan proyek
 * diberi kode perusahaan (server menolak proyek milik perusahaan lain).
 */
export default async function HalamanKampanyeBaru({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await wajibHak("kampanye.buat");
  const sp = await searchParams;
  const [lingkup, perusahaan] = await Promise.all([lingkupPerusahaan(), daftarPerusahaan()]);
  const proyek = await db.proyek.findMany({
    where: { status: { notIn: ["BATAL", "DIARSIP"] }, ...saringPerusahaan(lingkup.perusahaanId) },
    orderBy: { kode: "asc" },
    select: { id: true, kode: true, nama: true, perusahaanId: true },
  });
  const kode = new Map(perusahaan.map((p) => [p.id, p.kode]));
  const gabungan = lingkup.perusahaanId === null;

  return (
    <div className="space-y-6 max-w-3xl">
      <KepalaHalaman
        jejak={[{ label: "Pemasaran" }, { label: "Perencana Iklan Meta", href: "/pemasaran/iklan" }, { label: "Kampanye baru" }]}
        judul="Kampanye baru"
        aksi={
          <Link href="/pemasaran/iklan" className="tombol tombol-garis">
            Kembali
          </Link>
        }
      />
      <FormulirKampanye
        aksi={buatKampanyeFormulir}
        buat={{ lingkup, daftar: perusahaan }}
        proyek={proyek.map((p) => ({ id: p.id, label: `${gabungan ? `${kode.get(p.perusahaanId) ?? ""} · ` : ""}${p.kode} - ${p.nama}` }))}
        nilai={{ nama: "", tujuan: "PROSPEK", anggaran: "0", status: "DIRENCANAKAN", tanggalMulai: null, tanggalSelesai: null, proyekId: proyekBawaan(sp, proyek), catatan: null }}
      />
    </div>
  );
}
