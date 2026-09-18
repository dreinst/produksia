// Zona waktu eksplisit: Vercel menjalankan server di UTC dan tidak menerima env TZ,
// jadi format tanggal tidak boleh mengandalkan zona waktu proses.
const ZONA_WAKTU = process.env.ZONA_WAKTU ?? "Asia/Jakarta";

/** "18 Sep 2026, 14.05" */
export function formatWaktu(d: Date): string {
  return d.toLocaleString("id-ID", { timeZone: ZONA_WAKTU, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** "18 Sep 2026" */
export function formatTanggal(d: Date): string {
  return d.toLocaleDateString("id-ID", { timeZone: ZONA_WAKTU, day: "2-digit", month: "short", year: "numeric" });
}

/** "2026-09-18" di zona waktu tampilan; untuk nilai <input type="date"> dan perbandingan per hari. */
export function tanggalIso(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: ZONA_WAKTU });
}
