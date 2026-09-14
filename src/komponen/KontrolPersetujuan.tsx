import FormulirAksi from "@/komponen/FormulirAksi";
import { LencanaPersetujuan } from "@/komponen/ui/Lencana";
import { punyaHak, type Hak, type PenggunaSesi } from "@/lib/hakAkses";
import type { JenisPersetujuan } from "@/lib/persetujuan";
import { ajukanDokumenFormulir, setujuiDokumenFormulir, tolakDokumenFormulir } from "@/lib/aksi/persetujuan";

type Props = {
  jenis: JenisPersetujuan;
  /** Kode dokumen untuk hak akses, mis. "faktur" → hak "faktur.buat" & "faktur.setujui" */
  kode: string;
  id: string;
  nomor: string;
  status: string;
  diajukanOlehId: string | null;
  pengguna: PenggunaSesi;
  /** Catatan penolakan terakhir, ditampilkan agar pembuat tahu apa yang harus diperbaiki */
  catatanPenolakan?: string | null;
};

/**
 * Tombol alur persetujuan satu dokumen: "Ajukan" untuk pembuatnya, "Setujui"/"Tolak" untuk pemeriksa.
 * Tombolnya disembunyikan bila pengguna tidak berhak, TAPI pemeriksaan sungguhannya tetap di aksi
 * server (src/lib/aksi/persetujuan.ts) — termasuk aturan pembuat tidak boleh menyetujui dokumennya sendiri.
 */
export default function KontrolPersetujuan({ jenis, kode, id, nomor, status, diajukanOlehId, pengguna, catatanPenolakan }: Props) {
  const bolehAjukan = punyaHak(pengguna, `${kode}.buat` as Hak);
  const bolehSetujui = punyaHak(pengguna, `${kode}.setujui` as Hak);
  const pengajuSendiri = diajukanOlehId !== null && diajukanOlehId === pengguna.id;

  if (status === "DISETUJUI") return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(status === "DRAFT" || status === "DITOLAK") && bolehAjukan && (
        <FormulirAksi aksi={ajukanDokumenFormulir.bind(null, jenis, id)} className="inline">
          <button type="submit" className="tombol tombol-garis tombol-kecil">
            {status === "DITOLAK" ? "Ajukan Ulang" : "Ajukan"}
          </button>
        </FormulirAksi>
      )}

      {status === "MENUNGGU" && bolehSetujui && !pengajuSendiri && (
        <>
          <FormulirAksi
            aksi={setujuiDokumenFormulir.bind(null, jenis, id)}
            pesanKonfirmasi={`Setujui ${nomor}? Jurnalnya langsung dicatat ke buku besar.`}
            className="inline"
          >
            <button type="submit" className="tombol tombol-utama tombol-kecil">
              Setujui
            </button>
          </FormulirAksi>

          <details className="inline-block">
            <summary className="tombol-tautan-bahaya cursor-pointer list-none">Tolak</summary>
            <FormulirAksi aksi={tolakDokumenFormulir.bind(null, jenis, id)} className="mt-2 flex flex-col gap-2">
              <label className="label" htmlFor={`catatan-${id}`}>
                Alasan penolakan *
              </label>
              <textarea id={`catatan-${id}`} name="catatanPenolakan" rows={2} required maxLength={500} className="isian" placeholder="Mis. nominal tidak sesuai kontrak" />
              <button type="submit" className="tombol tombol-garis tombol-kecil w-fit">
                Kirim Penolakan
              </button>
            </FormulirAksi>
          </details>
        </>
      )}

      {status === "MENUNGGU" && bolehSetujui && pengajuSendiri && (
        <span className="text-xs text-slate-500">Diajukan oleh Anda sendiri; harus disetujui pengguna lain</span>
      )}

      {status === "DITOLAK" && catatanPenolakan && <span className="text-xs text-rose-700">Ditolak: {catatanPenolakan}</span>}
    </div>
  );
}

/** Lencana status + tombol dalam satu sel tabel. */
export function SelPersetujuan(props: Props) {
  return (
    <div className="flex flex-col gap-1">
      <LencanaPersetujuan status={props.status} />
      <KontrolPersetujuan {...props} />
    </div>
  );
}
