import Link from "next/link";
import type { JenisNilai } from "@/prisma-klien/enums";
import { D, jumlahkan, type Desimal } from "@/lib/uang";
import { hitungPpn } from "@/lib/pengaturanPerusahaan";
import { subtotalDokumen, subtotalFaktur } from "@/lib/dokumenPenjualan";
import { Rp } from "@/komponen/ui/Lencana";

type Angka = Desimal | number | string;

type NilaiBerjenis = { jenisDiskon: JenisNilai; nilaiDiskon: Angka; diskon: Angka; jenisFee: JenisNilai; nilaiFee: Angka; fee: Angka; ppnPersen: Angka };

type Props =
  | {
      jenis: "penawaran" | "pesanan";
      dokumen: NilaiBerjenis & { total: Angka; nilaiAddOn?: Angka | null; keteranganAddOn?: string | null };
    }
  | {
      jenis: "faktur";
      dokumen: NilaiBerjenis & { total: Angka; dpp: Angka; ppn: Angka; uangMuka: Angka };
      /** pemakaian uang muka per kuitansi DP, urut tanggal; href hanya untuk halaman yang ada */
      uangMuka: { label: string; jumlah: Angka; href?: string }[];
      terbayar: Angka;
      retur: Angka;
    };

type Baris = { label: string; nilai: Desimal; kunci: string; tebal?: boolean; kurang?: boolean; href?: string };

const persen = (x: Angka) => D(x).toNumber().toLocaleString("id-ID");

/**
 * Ringkasan nilai dokumen (D2 §7.2). Penawaran dan pesanan: total tersimpan TANPA PPN (subtotal - diskon + fee), PPN
 * hanya tampilan dari total itu, lalu add on di luar total. Faktur: DPP, PPN, dan total tersimpan, lalu uang muka
 * dipakai, terbayar (termasuk potongan PPh 23), retur, dan sisa dengan rumus sisa faktur lama.
 */
export default function RingkasanNilaiDokumen(p: Props) {
  const d = p.dokumen;
  const diskon = D(d.diskon);
  const fee = D(d.fee);
  const ppnPersen = D(d.ppnPersen);
  const baris: Baris[] = [];
  const subtotal = p.jenis === "faktur" ? subtotalFaktur(p.dokumen) : subtotalDokumen({ total: d.total, diskon: d.diskon, fee: d.fee });
  baris.push({ kunci: "subtotal", label: "Subtotal", nilai: subtotal });
  if (diskon.gt(0)) baris.push({ kunci: "diskon", label: `Diskon${d.jenisDiskon === "PERSEN" ? ` ${persen(d.nilaiDiskon)}%` : ""}`, nilai: diskon, kurang: true });
  if (fee.gt(0)) baris.push({ kunci: "fee", label: `Management fee${d.jenisFee === "PERSEN" ? ` ${persen(d.nilaiFee)}%` : ""}`, nilai: fee });

  if (p.jenis === "faktur") {
    const f = p.dokumen;
    baris.push({ kunci: "dpp", label: "DPP", nilai: D(f.dpp) });
    if (ppnPersen.gt(0) || D(f.ppn).gt(0)) baris.push({ kunci: "ppn", label: `PPN ${persen(ppnPersen)}%`, nilai: D(f.ppn) });
    baris.push({ kunci: "total", label: "Total", nilai: D(f.total), tebal: true });
    p.uangMuka.forEach((u, i) => baris.push({ kunci: `um-${i}`, label: `Uang muka dipakai · ${u.label}`, nilai: D(u.jumlah), kurang: true, href: u.href }));
    // faktur lama tanpa baris pemakaian tetap menampilkan kolom uangMuka
    const tanpaRincian = D(f.uangMuka).minus(jumlahkan(p.uangMuka.map((u) => u.jumlah)));
    if (tanpaRincian.gt(0)) baris.push({ kunci: "um-lama", label: "Uang muka dipakai", nilai: tanpaRincian, kurang: true });
    if (D(p.terbayar).gt(0)) baris.push({ kunci: "terbayar", label: "Terbayar", nilai: D(p.terbayar), kurang: true });
    if (D(p.retur).gt(0)) baris.push({ kunci: "retur", label: "Retur", nilai: D(p.retur), kurang: true });
    const sisa = D(f.total).minus(D(f.uangMuka)).minus(D(p.terbayar)).minus(D(p.retur));
    baris.push({ kunci: "sisa", label: "Sisa tagihan", nilai: sisa, tebal: true });
  } else {
    const total = D(d.total);
    const ppn = hitungPpn(total, ppnPersen);
    if (ppnPersen.gt(0)) {
      baris.push({ kunci: "total", label: "Total sebelum PPN", nilai: total });
      baris.push({ kunci: "ppn", label: `PPN ${persen(ppnPersen)}%`, nilai: ppn });
      baris.push({ kunci: "bruto", label: "Total termasuk PPN", nilai: total.plus(ppn), tebal: true });
    } else baris.push({ kunci: "total", label: "Total", nilai: total, tebal: true });
  }
  const addOn = p.jenis === "faktur" ? null : p.dokumen.nilaiAddOn;

  return (
    <div className="space-y-3">
      <dl className="divide-y divide-slate-100 text-sm">
        {baris.map((b) => (
          <div key={b.kunci} className={`flex items-baseline justify-between gap-4 py-1.5 ${b.tebal ? "font-semibold text-slate-900" : "text-slate-700"}`}>
            <dt>{b.href ? <Link href={b.href} className="tombol-tautan">{b.label}</Link> : b.label}</dt>
            <dd className="text-right whitespace-nowrap">
              {b.kurang && b.nilai.gt(0) ? "- " : ""}
              <Rp nilai={b.nilai} />
            </dd>
          </div>
        ))}
      </dl>
      {addOn !== null && addOn !== undefined && (
        <p className="text-sm text-slate-600">
          Add on (di luar total): Rp <Rp nilai={D(addOn)} />
          {p.jenis !== "faktur" && p.dokumen.keteranganAddOn ? ` ${p.dokumen.keteranganAddOn}` : ""}
        </p>
      )}
    </div>
  );
}
