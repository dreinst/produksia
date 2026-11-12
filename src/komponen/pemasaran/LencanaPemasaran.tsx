import type {
  AksiRiwayatKonten,
  KeputusanRevisiDesain,
  PlatformKonten,
  PrioritasDesain,
  StatusKampanye,
  StatusKonten,
  StatusPersetujuanKonten,
  StatusTugasDesain,
} from "@/prisma-klien/enums";
import {
  AKSI_RIWAYAT_KONTEN,
  KEPUTUSAN_REVISI,
  LABEL_PLATFORM,
  PRIORITAS_DESAIN,
  STATUS_DESAIN,
  STATUS_KAMPANYE,
  STATUS_KONTEN,
  STATUS_PERSETUJUAN_KONTEN,
  TITIK_PLATFORM,
  kelasLencana,
  type GayaLabel,
} from "@/lib/labelPemasaran";

/*
 * Lencana modul Pemasaran (D6 §7.10, §7.12). Satu komponen per enum, dengan peta bertipe Record<Enum, ...> dari
 * labelPemasaran.ts, karena enum yang berbeda memakai kunci yang sama (DISETUJUI, DITINJAU, SELESAI). Tanpa hook,
 * jadi bisa dipakai di komponen server maupun klien.
 */

function Lencana({ gaya }: { gaya: GayaLabel }) {
  return <span className={kelasLencana(gaya.warna)}>{gaya.label}</span>;
}

export function LencanaStatusKonten({ status }: { status: StatusKonten }) {
  return <Lencana gaya={STATUS_KONTEN[status]} />;
}

/** Tidak merender apa pun untuk TIDAK_ADA. */
export function LencanaPersetujuanKonten({ status }: { status: StatusPersetujuanKonten }) {
  const gaya = STATUS_PERSETUJUAN_KONTEN[status];
  return gaya ? <Lencana gaya={gaya} /> : null;
}

export function LencanaAksiRiwayat({ aksi }: { aksi: AksiRiwayatKonten }) {
  return <Lencana gaya={AKSI_RIWAYAT_KONTEN[aksi]} />;
}

export function LencanaStatusDesain({ status }: { status: StatusTugasDesain }) {
  return <Lencana gaya={STATUS_DESAIN[status]} />;
}

export function LencanaPrioritas({ prioritas }: { prioritas: PrioritasDesain }) {
  return <Lencana gaya={PRIORITAS_DESAIN[prioritas]} />;
}

export function LencanaKeputusanRevisi({ keputusan }: { keputusan: KeputusanRevisiDesain }) {
  return <Lencana gaya={KEPUTUSAN_REVISI[keputusan]} />;
}

export function LencanaStatusKampanye({ status }: { status: StatusKampanye }) {
  return <Lencana gaya={STATUS_KAMPANYE[status]} />;
}

/** Titik warna platform; `denganLabel` menambah nama platform di sebelahnya. */
export function TitikPlatform({ platform, denganLabel = false }: { platform: PlatformKonten; denganLabel?: boolean }) {
  const titik = <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${TITIK_PLATFORM[platform]}`} aria-hidden="true" />;
  if (!denganLabel) return titik;
  return (
    <span className="inline-flex items-center gap-1.5">
      {titik}
      {LABEL_PLATFORM[platform]}
    </span>
  );
}
