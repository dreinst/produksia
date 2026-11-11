import { Prisma } from "@/prisma-klien/browser";
import type { Desimal } from "@/lib/uang";

/*
 * Terbilang rupiah (D3 §3.4): algoritma HKA yang identik dengan D'Pro untuk bilangan bulat, ditulis ulang dengan
 * bigint. Bedanya dengan sumber: sen tidak dibulatkan (Produksia menyimpan sen, jadi terbilang sama dengan angka yang
 * tercetak) dan nol menjadi "nol rupiah". Fungsi murni, aman untuk komponen klien.
 */

export type GayaTerbilang = "KAPITAL" | "JUDUL";

const SATUAN = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
// target kompilasi ES2017 belum mengenal literal 12n, jadi konstanta bigint dibuat lewat BigInt()
const B = (n: number | string) => BigInt(n);
const SKALA: readonly [bigint, string][] = [
  [B("1000000000000"), "triliun"],
  [B(1_000_000_000), "miliar"],
  [B(1_000_000), "juta"],
];
const BATAS_EJA = B("1000000000000000");

const gabung = (a: string, b: string) => (b ? `${a} ${b}` : a);

function eja(n: bigint): string {
  if (n < B(12)) return SATUAN[Number(n)];
  if (n < B(20)) return `${eja(n - B(10))} belas`;
  if (n < B(100)) return gabung(`${eja(n / B(10))} puluh`, eja(n % B(10)));
  if (n < B(200)) return gabung("seratus", eja(n - B(100)));
  if (n < B(1000)) return gabung(`${eja(n / B(100))} ratus`, eja(n % B(100)));
  if (n < B(2000)) return gabung("seribu", eja(n - B(1000)));
  if (n < B(1_000_000)) return gabung(`${eja(n / B(1000))} ribu`, eja(n % B(1000)));
  for (const [ukuran, kata] of SKALA) if (n >= ukuran) return gabung(`${eja(n / ukuran)} ${kata}`, eja(n % ukuran));
  return "";
}

const hurufJudul = (s: string) => s.replace(/(^|\s)(\S)/g, (_, spasi: string, huruf: string) => spasi + huruf.toUpperCase());

/**
 * Terbilang rupiah. KAPITAL = huruf besar semua (invoice D'Pro, HKA); JUDUL = huruf besar di awal tiap kata
 * (kwitansi D'Pro). Nilai dari 10^15 ke atas ditulis angka ("1000000000000000 RUPIAH", perilaku HKA). Negatif ditolak.
 */
export function terbilangRupiah(nilai: Desimal | number | string, gaya: GayaTerbilang = "KAPITAL"): string {
  let d: Desimal;
  try {
    d = new Prisma.Decimal(nilai);
  } catch {
    throw new Error(`Angka tidak valid: ${String(nilai)}`);
  }
  if (!d.isFinite()) throw new Error(`Angka tidak valid: ${String(nilai)}`);
  // tanda diperiksa setelah pembulatan: -0,001 tercetak 0, jadi diterima sebagai nol
  const bulat = d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (bulat.isNegative() && !bulat.isZero()) throw new Error("Terbilang tidak menerima nilai negatif");
  const [bagianBulat, bagianSen] = bulat.abs().toFixed(2).split(".");
  const rupiah = B(bagianBulat);
  const sen = Number(bagianSen);
  let teks: string;
  if (rupiah === B(0) && sen === 0) teks = "nol rupiah";
  else {
    const bagian: string[] = [];
    if (rupiah >= BATAS_EJA) bagian.push(`${bagianBulat} rupiah`);
    else if (rupiah > B(0)) bagian.push(`${eja(rupiah)} rupiah`);
    if (sen > 0) bagian.push(`${eja(B(sen))} sen`);
    teks = bagian.join(" ");
  }
  return gaya === "KAPITAL" ? teks.toUpperCase() : hurufJudul(teks);
}
