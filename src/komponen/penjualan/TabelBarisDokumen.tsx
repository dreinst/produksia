import type { ModeDokumen } from "@/prisma-klien/enums";
import { D, jumlahkan, type Desimal } from "@/lib/uang";
import { nilaiBaris } from "@/lib/nilaiBaris";
import { KODE_BARANG_LAIN } from "@/lib/barangLainLain";
import { Rp } from "@/komponen/ui/Lencana";
import TeksBerbutir from "@/komponen/penjualan/TeksBerbutir";

type Angka = Desimal | number | string;

/** Baris dokumen siap tampil: nama dan satuan sudah memakai nilai tampil atau katalog. */
export type BarisTampil = {
  id: string;
  kode: string;
  nama: string;
  deskripsi: string | null;
  jumlah: Angka;
  satuan: string | null;
  frekuensi: Angka;
  satuanFrekuensi: string | null;
  harga: Angka;
  nilai: Angka;
  keterangan: string | null;
  bagian: string | null;
};

/** Baris Prisma penawaran, pesanan, atau faktur (dengan barang) menjadi BarisTampil. Tanpa `this`, aman untuk .map. */
export function barisTampil(b: {
  id: string;
  barang: { kode: string; nama: string; satuan: string | null };
  nama: string | null;
  deskripsi: string | null;
  jumlah: Angka;
  satuan: string | null;
  frekuensi: Angka;
  satuanFrekuensi: string | null;
  harga: Angka;
  /** subtotal tersimpan (penawaran, faktur); pesanan tidak punya kolom ini, jadi dihitung nilaiBaris */
  subtotal?: Angka;
  keterangan: string | null;
  bagian: string | null;
}): BarisTampil {
  return {
    id: b.id,
    kode: b.barang.kode,
    nama: b.nama || b.barang.nama,
    deskripsi: b.deskripsi,
    jumlah: b.jumlah,
    satuan: b.satuan || b.barang.satuan,
    frekuensi: b.frekuensi,
    satuanFrekuensi: b.satuanFrekuensi,
    harga: b.harga,
    nilai: b.subtotal ?? nilaiBaris(b),
    keterangan: b.keterangan,
    bagian: b.bagian,
  };
}

const angka = (x: Angka) => D(x).toNumber().toLocaleString("id-ID");

type Kelompok = { bagian: string | null; baris: BarisTampil[] };

/** Baris berurutan dengan seksi sama dikelompokkan (urutan dokumen dipertahankan, D2 §3.6). */
function kelompokkan(baris: readonly BarisTampil[]): Kelompok[] {
  const hasil: Kelompok[] = [];
  for (const b of baris) {
    const akhir = hasil[hasil.length - 1];
    if (akhir && akhir.bagian === b.bagian) akhir.baris.push(b);
    else hasil.push({ bagian: b.bagian, baris: [b] });
  }
  return hasil;
}

/**
 * Rincian baris dokumen penjualan (D2 §7.2, §7.3): nama dengan deskripsi berbutir, qty dan satuan, frekuensi di mode
 * event, harga, jumlah, dan keterangan (kolom hanya tampil bila ada isinya). Di mode event judul seksi disisipkan
 * saat seksi berganti, dan tiap seksi bernama ditutup subtotalnya.
 */
export default function TabelBarisDokumen({ baris, mode, kosong = "Tidak ada baris." }: { baris: readonly BarisTampil[]; mode: ModeDokumen; kosong?: string }) {
  const event = mode === "EVENT";
  const adaKeterangan = baris.some((b) => b.keterangan);
  const kolom = 5 + (event ? 1 : 0) + (adaKeterangan ? 1 : 0);
  const kelompok = event ? kelompokkan(baris) : [{ bagian: null, baris: [...baris] }];
  const nomorAwal = kelompok.map((_, i) => kelompok.slice(0, i).reduce((t, k) => t + k.baris.length, 0));
  return (
    <div className="bungkus-tabel">
      <table className="tabel min-w-[40rem]">
        <thead>
          <tr>
            <th className="w-10">No</th>
            <th>Uraian</th>
            <th className="text-right">Qty</th>
            {event && <th className="text-right">Frek</th>}
            <th className="text-right">Harga</th>
            <th className="text-right">Jumlah</th>
            {adaKeterangan && <th>Keterangan</th>}
          </tr>
        </thead>
        <tbody>
          {baris.length === 0 && (
            <tr>
              <td colSpan={kolom} className="kosong">
                {kosong}
              </td>
            </tr>
          )}
          {kelompok.map((k, i) => (
            <KelompokBaris key={i} k={k} event={event} adaKeterangan={adaKeterangan} kolom={kolom} nomorAwal={nomorAwal[i]} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KelompokBaris({ k, event, adaKeterangan, kolom, nomorAwal }: { k: Kelompok; event: boolean; adaKeterangan: boolean; kolom: number; nomorAwal: number }) {
  return (
    <>
      {event && k.bagian && (
        <tr className="bg-slate-50">
          <td colSpan={kolom} className="font-semibold text-slate-800">
            {k.bagian}
          </td>
        </tr>
      )}
      {k.baris.map((b, i) => (
        <tr key={b.id} className="align-top">
          <td className="text-slate-500">{nomorAwal + i + 1}</td>
          <td className="min-w-[14rem]">
            <p className="font-medium text-slate-900">{b.nama}</p>
            {b.kode !== KODE_BARANG_LAIN && <p className="mono text-[11px] text-slate-400">{b.kode}</p>}
            <TeksBerbutir teks={b.deskripsi} className="mt-1" />
          </td>
          <td className="text-right whitespace-nowrap angka">
            {angka(b.jumlah)}
            {b.satuan ? ` ${b.satuan}` : ""}
          </td>
          {event && (
            <td className="text-right whitespace-nowrap angka">
              {angka(b.frekuensi)}
              {b.satuanFrekuensi ? ` ${b.satuanFrekuensi}` : ""}
            </td>
          )}
          <td className="text-right">
            <Rp nilai={D(b.harga)} />
          </td>
          <td className="text-right font-medium">
            <Rp nilai={D(b.nilai)} />
          </td>
          {adaKeterangan && <td className="text-slate-600 min-w-[10rem]">{b.keterangan}</td>}
        </tr>
      ))}
      {event && k.bagian && (
        <tr>
          <td colSpan={5} className="text-right text-slate-500">
            Subtotal {k.bagian}
          </td>
          <td className="text-right font-semibold">
            <Rp nilai={jumlahkan(k.baris.map((b) => b.nilai))} />
          </td>
          {adaKeterangan && <td />}
        </tr>
      )}
    </>
  );
}
