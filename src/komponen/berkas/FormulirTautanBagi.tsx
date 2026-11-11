"use client";

import { useActionState } from "react";
import { buatTautanBagiFormulir, cabutTautanBagiFormulir } from "@/lib/aksi/berkas";
import type { StatusFormulir } from "@/lib/statusFormulir";
import FormulirAksi from "@/komponen/FormulirAksi";
import Ikon from "@/komponen/ui/Ikon";
import TombolSalin from "@/komponen/berkas/TombolSalin";

export type TautanAktifBerkas = { id: string; dibuatOlehNama: string; kedaluwarsa: Date; jumlahUnduh: number; bolehCabut: boolean };

type StatusTautan = StatusFormulir & { hasil?: { tautan: string; kedaluwarsa: Date } };

const formatTanggalJam = (d: Date) =>
  new Date(d).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

/**
 * Membuat tautan bagi publik (D7 §3.3.13, §7.2 no. 3). Token hanya ditampilkan sekali dari hasil aksi, jadi formulir
 * memakai useActionState sendiri (bukan FormulirAksi) supaya tautannya bisa dibaca dan disalin.
 */
export default function FormulirTautanBagi({ berkasId, tautanAktif }: { berkasId: string; tautanAktif: TautanAktifBerkas[] }) {
  const [status, aksi, sedangProses] = useActionState<StatusTautan, FormData>(buatTautanBagiFormulir.bind(null, berkasId), { galat: null });
  const tautanBaru = status.ok ? status.hasil?.tautan : undefined;

  return (
    <div className="space-y-3 text-left whitespace-normal">
      <form action={aksi} className="flex flex-wrap items-end gap-2" aria-busy={sedangProses}>
        <div className="space-y-1">
          <label htmlFor={`masa-${berkasId}`} className="label">Masa berlaku</label>
          <select id={`masa-${berkasId}`} name="masaBerlaku" defaultValue="7" className="isian isian-kecil" disabled={sedangProses}>
            <option value="1">1 hari</option>
            <option value="7">7 hari</option>
            <option value="30">30 hari</option>
          </select>
        </div>
        <button type="submit" className="tombol tombol-utama tombol-kecil" disabled={sedangProses}>
          <Ikon nama="share" className="!text-[16px]" />
          Buat tautan
        </button>
      </form>
      {status.galat && (
        <p role="alert" className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {status.galat}
        </p>
      )}
      {tautanBaru && (
        <div role="status" className="space-y-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <p>Tautan dibuat. Salin sekarang; tautan ini tidak ditampilkan lagi.</p>
          <div className="flex items-center gap-2">
            <input readOnly value={tautanBaru} aria-label="Tautan bagi" className="isian isian-kecil mono flex-1 min-w-0" onFocus={(e) => e.currentTarget.select()} />
            <TombolSalin teks={tautanBaru} />
          </div>
        </div>
      )}
      <DaftarTautanAktif tautanAktif={tautanAktif} />
    </div>
  );
}

/**
 * Daftar tautan aktif beserta tombol Cabut. Dipakai di dalam FormulirTautanBagi, dan sendirian untuk pemegang hak hapus
 * berkas yang tidak punya hak bagikan (D7 §3.3.13 no. 3: mereka boleh mencabut, tetapi tidak membuat tautan).
 */
export function DaftarTautanAktif({ tautanAktif }: { tautanAktif: TautanAktifBerkas[] }) {
  if (tautanAktif.length === 0) return null;
  return (
    <div className="space-y-1 text-left whitespace-normal">
      <p className="teks-label">Tautan aktif</p>
      <ul className="divide-y divide-slate-100 text-xs text-slate-600">
        {tautanAktif.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 py-1.5">
            <span className="min-w-0">
              {t.dibuatOlehNama} · berlaku sampai {formatTanggalJam(t.kedaluwarsa)} · {t.jumlahUnduh.toLocaleString("id-ID")} unduhan
            </span>
            {t.bolehCabut && (
              <FormulirAksi aksi={cabutTautanBagiFormulir.bind(null, t.id)} className="shrink-0" pesanSuksesHalaman="Tautan dicabut.">
                <button type="submit" className="tombol-tautan-bahaya">
                  <Ikon nama="link_off" className="!text-[16px] align-[-3px]" /> Cabut
                </button>
              </FormulirAksi>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
