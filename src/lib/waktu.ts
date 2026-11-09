// Zona waktu eksplisit: server bisa berjalan di UTC,
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

/** Date → "2026-11-09T14:30" di zona usaha; untuk nilai bawaan <input type="datetime-local">. */
export function nilaiWaktuLokal(d: Date): string {
  return d
    .toLocaleString("sv-SE", { timeZone: ZONA_WAKTU, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .replace(" ", "T");
}

/** "2026-11-09T14:30" (jam dinding ZONA_WAKTU) → Date UTC; null bila format salah atau tanggalnya tidak ada. */
export function bacaWaktuLokal(teks: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(teks.trim());
  if (!m) return null;
  const [th, bl, tg, jm, mn] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const dt = m[6] ? Number(m[6]) : 0;
  const sebagaiUtc = Date.UTC(th, bl - 1, tg, jm, mn, dt);
  // selisih zona pada titik waktu itu; dihitung dua kali supaya benar juga untuk zona ber-DST
  const selisih = (t: number) => {
    const [a, b] = new Date(t).toLocaleString("sv-SE", { timeZone: ZONA_WAKTU, hourCycle: "h23" }).split(" ");
    const [y, mo, d] = a.split("-").map(Number);
    const [h, mi, s] = b.split(":").map(Number);
    return Date.UTC(y, mo - 1, d, h, mi, s) - t;
  };
  let t = sebagaiUtc - selisih(sebagaiUtc);
  t = sebagaiUtc - selisih(t);
  const hasil = new Date(t);
  // tolak tanggal yang tidak ada (mis. 2026-02-30) lewat pemeriksaan balik
  if (nilaiWaktuLokal(hasil) !== `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`) return null;
  return hasil;
}
