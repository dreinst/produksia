/** Warna bawaan proyek tanpa warna (abu-abu HKA). */
export const WARNA_PROYEK_BAWAAN = "#71717a";

/**
 * Titik warna proyek 10 px (D5 §7.3). Warna sudah divalidasi #rrggbb saat disimpan; tanpa warna memakai abu-abu.
 * Tanpa hook, jadi bisa dipakai di komponen server maupun klien.
 */
export default function TitikWarnaProyek({ warna }: { warna?: string | null }) {
  return <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: warna ?? WARNA_PROYEK_BAWAAN }} aria-hidden="true" />;
}
