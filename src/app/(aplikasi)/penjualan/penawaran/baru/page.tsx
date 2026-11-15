import { wajibHak } from "@/lib/otentikasi";
import { punyaHak, PERAN_TERTINGGI } from "@/lib/hakAkses";
import { db } from "@/lib/db";
import { PERUSAHAAN_UTAMA, daftarPerusahaan, lingkupPerusahaan, perusahaanFormulir } from "@/lib/perusahaan";
import { buatPenawaranFormulir } from "@/lib/aksi/penjualan";
import FormulirDokumenPenjualan, { PilihPerusahaanPenerbit, muatOpsiDokumenPenjualan } from "@/komponen/penjualan/FormulirDokumenPenjualan";

export default async function HalamanPenawaranBaru({ searchParams }: { searchParams: Promise<{ perusahaan?: string | string[]; leadId?: string | string[] }> }) {
  const pengguna = await wajibHak("penawaran.buat");
  const q = await searchParams;
  // parameter berulang (?leadId=a&leadId=b) berupa larik dan diabaikan, supaya tidak masuk ke penyaring Prisma
  const pilihan = typeof q.perusahaan === "string" ? q.perusahaan : undefined;
  const leadId = typeof q.leadId === "string" ? q.leadId : undefined;
  const [lingkup, perusahaanAktif] = await Promise.all([lingkupPerusahaan(), daftarPerusahaan()]);
  // lingkup satu perusahaan aktif = perusahaan itu; gabungan dan lingkup arsip memilih perusahaan penerbit (D2 §7.1)
  const p = perusahaanFormulir(lingkup);

  // prapengisian dari lead CRM (D4 §8 no. 16): lead aktif yang sudah berpelanggan, milik perusahaan lingkup bila satu
  // perusahaan; di gabungan perusahaan penerbit = perusahaan lead
  const lead =
    leadId && punyaHak(pengguna, "lead.lihat")
      ? await db.lead.findFirst({
          where: { id: leadId, dihapusPada: null, pelangganId: { not: null }, perusahaan: { aktif: true }, ...(p ? { perusahaanId: p } : {}) },
          select: { id: true, nama: true, namaUsaha: true, pelangganId: true, perusahaanId: true },
        })
      : null;
  const leadTidakSah = !!leadId && punyaHak(pengguna, "lead.lihat") && !lead;
  const terpilih = perusahaanAktif.find((x) => x.id === (lead?.perusahaanId ?? p ?? pilihan)) ?? null;

  const peringatanLead = leadTidakSah && (
    <div className="max-w-xl rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Lead tidak ditemukan, sudah diarsipkan, atau belum menjadi pelanggan</div>
  );

  if (!terpilih) {
    return (
      <div className="space-y-6">
        <h1 className="judul-halaman">Penawaran Penjualan Baru</h1>
        {peringatanLead}
        <PilihPerusahaanPenerbit daftar={perusahaanAktif} href={(id) => `/penjualan/penawaran/baru?perusahaan=${encodeURIComponent(id)}`} />
      </div>
    );
  }

  const opsi = await muatOpsiDokumenPenjualan(terpilih.id, "penawaran");
  return (
    <div className="space-y-6 max-w-6xl">
      <h1 className="judul-halaman">Penawaran Penjualan Baru</h1>
      {peringatanLead}
      <FormulirDokumenPenjualan
        jenis="penawaran"
        aksi={buatPenawaranFormulir}
        perusahaan={terpilih}
        // pola formulir akar halaman lama (KONTRAK-TAMBAHAN): utama hanya isian tersembunyi
        tampilPerusahaan={p === PERUSAHAAN_UTAMA ? "tersembunyi" : p ? "bacaSaja" : { gantiHref: lead ? null : "/penjualan/penawaran/baru" }}
        opsi={opsi}
        bolehNego={punyaHak(pengguna, "harga.nego")}
        bolehBawahMinimum={PERAN_TERTINGGI.includes(pengguna.peran)}
        // tautan ke halaman lead hanya untuk pemegang lead.lihat; lead di atas sudah disaring ke lingkup dan perusahaan aktif
        lead={lead ? { id: lead.id, nama: lead.nama, namaUsaha: lead.namaUsaha, pelangganId: lead.pelangganId!, href: punyaHak(pengguna, "lead.lihat") ? `/crm/lead/${lead.id}` : null } : null}
      />
    </div>
  );
}
