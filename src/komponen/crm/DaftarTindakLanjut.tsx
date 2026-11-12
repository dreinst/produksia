import Link from "next/link";
import { hapusTindakLanjutFormulir, ubahStatusTindakLanjutFormulir, ubahTindakLanjutFormulir } from "@/lib/aksi/crm";
import { tindakLanjutTerlambat } from "@/lib/crm";
import { formatWaktu, nilaiWaktuLokal } from "@/lib/waktu";
import type { StatusTindakLanjut } from "@/prisma-klien/enums";
import FormulirAksi from "@/komponen/FormulirAksi";
import Ikon from "@/komponen/ui/Ikon";
import { LencanaStatus } from "@/komponen/ui/Lencana";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";

/*
 * Daftar tindak lanjut (D4 §7.3): judul, jatuh tempo, lencana status (Terlambat bila MENUNGGU dan sudah lewat),
 * tautan lead (tidak tampil di detail lead), penerima, catatan, lalu tombol status, Ubah (di <details>), dan Hapus.
 * Tombol memakai pesanSuksesHalaman karena barisnya bisa hilang dari daftar tersaring sesudah aksi; halaman
 * pemakai memasang <PesanSuksesHalaman />.
 */

export type TindakLanjutTampil = {
  id: string;
  judul: string;
  jatuhTempo: Date;
  status: StatusTindakLanjut;
  catatan: string | null;
  leadId: string | null;
  /** tidak dibutuhkan bila tampilLead false (detail lead) */
  lead?: { nama: string; namaUsaha: string } | null;
  ditugaskanKe: { id: string; nama: string } | null;
  perusahaan?: { kode: string; nama: string; warna: string | null } | null;
};

export default function DaftarTindakLanjut({
  daftar,
  tampilLead = true,
  bolehUbah,
  bolehHapus,
  pengguna,
  sekarang = new Date(),
  kosong = "Belum ada tindak lanjut. Jadwalkan pengingat supaya lead tidak dingin.",
}: {
  daftar: TindakLanjutTampil[];
  tampilLead?: boolean;
  /** lead.ubah: status dan ubah */
  bolehUbah: boolean;
  /** lead.hapus */
  bolehHapus: boolean;
  /** pilihan penerima untuk formulir ubah */
  pengguna: { id: string; nama: string }[];
  sekarang?: Date;
  kosong?: string;
}) {
  if (daftar.length === 0) return <p className="text-sm text-slate-500">{kosong}</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {daftar.map((t) => {
        const terlambat = tindakLanjutTerlambat(t, sekarang);
        const penerimaTerdaftar = !t.ditugaskanKe || pengguna.some((p) => p.id === t.ditugaskanKe!.id);
        return (
          <li key={t.id} className="py-3 space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-semibold text-slate-900 break-words">{t.judul}</p>
                <p className="text-xs text-slate-500">
                  {formatWaktu(t.jatuhTempo)} · {t.ditugaskanKe?.nama ?? "Tanpa penerima"}
                  {tampilLead && (
                    <>
                      {" · "}
                      {t.lead && t.leadId ? (
                        <Link href={`/crm/lead/${t.leadId}`} className="tombol-tautan">
                          {t.lead.nama} ({t.lead.namaUsaha})
                        </Link>
                      ) : (
                        "Tanpa lead"
                      )}
                    </>
                  )}
                </p>
                {t.catatan && <p className="text-xs text-slate-600 whitespace-pre-line break-words">{t.catatan}</p>}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {t.perusahaan && <LencanaPerusahaan kode={t.perusahaan.kode} warna={t.perusahaan.warna} nama={t.perusahaan.nama} />}
                <LencanaStatus status={terlambat ? "TERLAMBAT" : t.status} />
              </div>
            </div>
            {(bolehUbah || bolehHapus) && (
              <div className="flex flex-wrap items-center gap-3 text-xs">
                {bolehUbah && t.status === "MENUNGGU" && (
                  <>
                    <FormulirAksi aksi={ubahStatusTindakLanjutFormulir.bind(null, t.id, "SELESAI")} pesanSuksesHalaman="Ditandai selesai">
                      <button type="submit" className="tombol-tautan inline-flex items-center gap-1">
                        <Ikon nama="check_circle" className="!text-[16px]" />
                        Selesai
                      </button>
                    </FormulirAksi>
                    <FormulirAksi aksi={ubahStatusTindakLanjutFormulir.bind(null, t.id, "DIBATALKAN")} pesanSuksesHalaman="Ditandai dibatalkan">
                      <button type="submit" className="tombol-tautan inline-flex items-center gap-1">
                        <Ikon nama="cancel" className="!text-[16px]" />
                        Batalkan
                      </button>
                    </FormulirAksi>
                  </>
                )}
                {bolehUbah && t.status !== "MENUNGGU" && (
                  <FormulirAksi aksi={ubahStatusTindakLanjutFormulir.bind(null, t.id, "MENUNGGU")} pesanSuksesHalaman="Dibuka lagi">
                    <button type="submit" className="tombol-tautan inline-flex items-center gap-1">
                      <Ikon nama="undo" className="!text-[16px]" />
                      Buka lagi
                    </button>
                  </FormulirAksi>
                )}
                {bolehHapus && (
                  <FormulirAksi aksi={hapusTindakLanjutFormulir.bind(null, t.id)} pesanKonfirmasi={`Hapus pengingat ${t.judul}?`} pesanSuksesHalaman="Pengingat dihapus">
                    <button type="submit" className="tombol-tautan-bahaya inline-flex items-center gap-1">
                      <Ikon nama="delete" className="!text-[16px]" />
                      Hapus
                    </button>
                  </FormulirAksi>
                )}
                {bolehUbah && (
                  <details className="w-full">
                    <summary className="tombol-tautan cursor-pointer inline-flex items-center gap-1">
                      <Ikon nama="edit_note" className="!text-[16px]" />
                      Ubah
                    </summary>
                    <FormulirAksi aksi={ubahTindakLanjutFormulir.bind(null, t.id)} pesanSuksesHalaman="Pengingat diperbarui" className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="bidang md:col-span-2">
                        <label className="label" htmlFor={`ubah-tl-${t.id}-judul`}>
                          Judul pengingat *
                        </label>
                        <input id={`ubah-tl-${t.id}-judul`} name="judul" required maxLength={160} defaultValue={t.judul} className="isian isian-kecil" />
                      </div>
                      <div className="bidang">
                        <label className="label" htmlFor={`ubah-tl-${t.id}-jatuhTempo`}>
                          Tanggal &amp; jam *
                        </label>
                        <input id={`ubah-tl-${t.id}-jatuhTempo`} name="jatuhTempo" type="datetime-local" required defaultValue={nilaiWaktuLokal(t.jatuhTempo)} className="isian isian-kecil" />
                      </div>
                      <div className="bidang">
                        <label className="label" htmlFor={`ubah-tl-${t.id}-penerima`}>
                          Tugaskan ke
                        </label>
                        {/* "" = penerima tetap (kontrak P22), juga untuk penerima yang sudah tidak memenuhi syarat */}
                        <select id={`ubah-tl-${t.id}-penerima`} name="ditugaskanKeId" defaultValue={penerimaTerdaftar ? (t.ditugaskanKe?.id ?? "") : ""} className="isian isian-kecil">
                          {!penerimaTerdaftar && <option value="">{t.ditugaskanKe!.nama} (nonaktif)</option>}
                          {!t.ditugaskanKe && <option value="">Pilih penerima…</option>}
                          {pengguna.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nama}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="bidang md:col-span-2">
                        <label className="label" htmlFor={`ubah-tl-${t.id}-catatan`}>
                          Catatan
                        </label>
                        <textarea id={`ubah-tl-${t.id}-catatan`} name="catatan" maxLength={2000} defaultValue={t.catatan ?? ""} className="isian h-auto min-h-16 py-2" />
                      </div>
                      <div className="md:col-span-2">
                        <button type="submit" className="tombol tombol-utama tombol-kecil">
                          Simpan perubahan
                        </button>
                      </div>
                    </FormulirAksi>
                  </details>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
