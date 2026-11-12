import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";

/*
 * Bagian perusahaan di formulir Talangan Mitra dan Pembayaran ke Mitra (tinjauan P37 S2). Dokumen mitra selalu dibukukan
 * ke perusahaan proyek, bukan lingkup aktif, jadi formulir menyebut perusahaannya bila lingkup aktif berbeda. Perusahaan
 * yang diarsipkan menggantikan formulir dengan pesan, karena server menolak dokumen baru untuknya.
 */

type PerusahaanProyek = { kode: string; nama: string; warna: string | null };

export function PesanPerusahaanDiarsipkan({ perusahaan }: { perusahaan: PerusahaanProyek }) {
  return (
    <p role="status" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      Perusahaan {perusahaan.nama} sudah diarsipkan; aktifkan dulu untuk mencatat dokumen mitra.
    </p>
  );
}

export function BidangPerusahaanProyek({ perusahaan }: { perusahaan: PerusahaanProyek }) {
  return (
    <div className="space-y-1 md:col-span-2">
      <span className="label">Perusahaan</span>
      <div className="isian flex items-center gap-2 bg-slate-50 text-slate-700" aria-readonly="true">
        <LencanaPerusahaan kode={perusahaan.kode} warna={perusahaan.warna} />
        <span className="truncate">{perusahaan.nama}</span>
      </div>
      <p className="petunjuk">Dokumen mitra dibukukan ke perusahaan proyek, bukan perusahaan lingkup aktif.</p>
    </div>
  );
}
