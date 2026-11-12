"use client";

import { pindahTahapLeadDariPapan } from "@/lib/aksi/crm";
import Ikon from "@/komponen/ui/Ikon";
import Kanban, { type DialogAlasanKanban, type KartuKanban, type KolomKanban } from "@/komponen/ui/Kanban";

/*
 * Papan pipeline lead (D4 §3.11, §7.3) di atas Kanban generik P15. Kartu diseret atau dipindah lewat "Pindah ke
 * tahap"; tujuan berjenis Kalah membuka dialog alasan wajib. Validasinya diulang di server (pindahTahapLead menolak
 * Kalah tanpa alasan), jadi dialog di sini hanya kemudahan. Tanpa lead.ubah papan hanya-baca.
 */

export default function PapanPipeline({
  kolom,
  kartu,
  kolomKalah,
  bolehPindah,
}: {
  kolom: KolomKanban[];
  kartu: KartuKanban[];
  /** id tahap berjenis Kalah */
  kolomKalah: string[];
  bolehPindah: boolean;
}) {
  const dialogAlasan: Record<string, DialogAlasanKanban> = Object.fromEntries(kolomKalah.map((id) => [id, { judul: "Alasan deal ini kalah", label: "Alasan", wajib: true }]));
  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1">
          <Ikon nama="trophy" className="!text-[16px] text-emerald-600" />
          Kolom hijau berjenis Menang
        </span>
        <span className="inline-flex items-center gap-1">
          <Ikon nama="thumb_down" className="!text-[16px] text-rose-600" />
          Kolom merah berjenis Kalah, wajib diberi alasan
        </span>
        {bolehPindah && (
          <span className="inline-flex items-center gap-1">
            <Ikon nama="drag_indicator" className="!text-[16px] text-slate-400" />
            Seret kartu, atau pakai pilihan &quot;Pindah ke&quot; di layar sentuh
          </span>
        )}
      </p>
      <Kanban kolom={kolom} kartu={kartu} bolehPindah={bolehPindah} pindah={pindahTahapLeadDariPapan} dialogAlasan={dialogAlasan} kosong="Belum ada lead" />
    </div>
  );
}
