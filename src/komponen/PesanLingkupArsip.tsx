import type { RingkasPerusahaan } from "@/lib/perusahaan";

/** Pengganti formulir dokumen persediaan baru bila lingkup menunjuk perusahaan arsip (tinjauan P16 S1). */
export default function PesanLingkupArsip({ perusahaan }: { perusahaan: RingkasPerusahaan }) {
  return (
    <p className="redup">
      {`Perusahaan ${perusahaan.nama} sudah diarsipkan. Aktifkan dulu di Pengaturan, atau ganti lingkup lewat pemilih perusahaan di bilah samping.`}
    </p>
  );
}
