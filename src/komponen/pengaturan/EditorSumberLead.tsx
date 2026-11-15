import { tambahSumberLeadFormulir, hapusSumberLeadFormulir } from "@/lib/aksi/crm";
import FormulirAksi from "@/komponen/FormulirAksi";
import Ikon from "@/komponen/ui/Ikon";

/*
 * Editor sumber lead satu perusahaan di halaman Daftar Pilihan (P44 e.12). Memakai aksi dan hak Pengaturan CRM yang
 * sudah ada (tambahSumberLead dan hapusSumberLead, wajib pengaturan-crm.ubah); halaman pemasang memegang wajibHak,
 * pilihan perusahaan aktif, dan hanya memasang komponen ini bila pengguna memegang pengaturan-crm.ubah. Perusahaan yang
 * belum punya baris sumber menampilkan daftar bawaan tanpa tombol hapus: menambah sumber pertama menyalin bawaan lebih
 * dulu (pastikanBawaanCrm di aksi), baru sesudah itu butir bisa dihapus.
 */
export default function EditorSumberLead({
  perusahaan,
  sumber,
  bawaan,
}: {
  perusahaan: { id: string; nama: string };
  /** baris sumber milik perusahaan; kosong = belum diatur */
  sumber: { id: string; nama: string }[];
  /** daftar yang tampil bila belum diatur */
  bawaan: readonly string[];
}) {
  const diatur = sumber.length > 0;
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-2" aria-label="Sumber lead">
        {diatur
          ? sumber.map((s) => (
              <li key={s.id} className="lencana lencana-slate !pr-1 inline-flex items-center gap-1">
                {s.nama}
                <FormulirAksi aksi={hapusSumberLeadFormulir.bind(null, s.id)} pesanKonfirmasi={`Hapus sumber ${s.nama}?`} pesanSuksesHalaman="Sumber dihapus" className="inline-flex">
                  <button type="submit" className="tombol-tautan-bahaya inline-flex items-center rounded-full p-0.5" aria-label={`Hapus sumber ${s.nama}`}>
                    <Ikon nama="close" className="!text-[14px]" />
                  </button>
                </FormulirAksi>
              </li>
            ))
          : bawaan.map((n) => (
              <li key={n} className="lencana lencana-slate">
                {n}
              </li>
            ))}
      </ul>
      <FormulirAksi key={`sumber-baru-${perusahaan.id}`} aksi={tambahSumberLeadFormulir} pesanSukses="Sumber ditambahkan" className="flex flex-col sm:flex-row sm:items-end gap-3">
        <input type="hidden" name="perusahaanId" value={perusahaan.id} />
        <div className="bidang">
          <label className="label" htmlFor={`sumber-baru-${perusahaan.id}`}>
            Nama sumber baru
          </label>
          <input id={`sumber-baru-${perusahaan.id}`} name="nama" required maxLength={60} className="isian isian-kecil" />
        </div>
        <button type="submit" className="tombol tombol-utama tombol-kecil min-h-11 sm:min-h-0">
          <Ikon nama="add" className="!text-[16px]" />
          Tambah sumber
        </button>
      </FormulirAksi>
      {!diatur && <p className="petunjuk">Menambah sumber pertama menyalin daftar bawaan di atas lebih dulu, sesudah itu setiap butir bisa dihapus.</p>}
    </div>
  );
}
