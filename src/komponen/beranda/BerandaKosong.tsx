import Ikon from "@/komponen/ui/Ikon";
import type { PenggunaSesi } from "@/lib/hakAkses";

/** Beranda bagi pengguna yang tidak memegang hak satu tab pun (D7 §3.5 no. 5). */
export default function BerandaKosong({ pengguna }: { pengguna: PenggunaSesi }) {
  const namaDepan = pengguna.nama.trim().split(/\s+/)[0] || pengguna.nama;
  return (
    <div className="space-y-7">
      <div>
        <h1 className="judul-halaman">Halo, {namaDepan}</h1>
      </div>
      <div className="kartu flex items-start gap-3">
        <span className="ubin-ikon"><Ikon nama="space_dashboard" className="!text-[16px]" /></span>
        <div>
          <h2 className="judul-kartu">Belum ada ringkasan untuk peran Anda</h2>
          <p className="subjudul-kartu">Buka menu di samping untuk mulai bekerja.</p>
        </div>
      </div>
    </div>
  );
}
