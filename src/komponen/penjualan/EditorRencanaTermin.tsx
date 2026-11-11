"use client";

import { useState } from "react";
import Ikon from "@/komponen/ui/Ikon";
import { pratinjauTerminKlien } from "@/lib/hitungDokumenKlien";

/*
 * Editor rencana termin (D2 §3.8, §7.4). Butir terakhir selalu menutup sisa nilai kontrak, jadi jenis dan nilainya
 * tidak diisi. Angka pratinjau dari pratinjauTerminKlien (meniru selesaikanRencana dan brutoRencana server). Isian
 * tersembunyi `namaInput` berisi JSON [{ label, mode, nilai, jatuhTempo }] yang dibaca bacaRencanaTermin.
 */

export type ButirTerminAwal = { label: string; mode: "PERSEN" | "NOMINAL"; nilai: string; jatuhTempo: string };
type Butir = ButirTerminAwal & { kunci: number };

const MAKS = 4;
const PRESET: { label: string; butir: [string, string][] }[] = [
  { label: "Lunas 100%", butir: [["Pelunasan", ""]] },
  { label: "50 / 50", butir: [["DP", "50"], ["Pelunasan", ""]] },
  { label: "30 / 40 / 30", butir: [["DP", "30"], ["Termin 2", "40"], ["Pelunasan", ""]] },
  { label: "30 / 30 / 20 / 20", butir: [["DP", "30"], ["Termin 2", "30"], ["Termin 3", "20"], ["Pelunasan", ""]] },
];

const rupiah = (n: number) => n.toLocaleString("id-ID");
let urutKunci = 0;
const kunciBaru = () => ++urutKunci;

export default function EditorRencanaTermin({
  basis,
  ppnPersen,
  nilaiAwal = [],
  namaInput = "rencanaTermin",
}: {
  /** total dokumen sebelum PPN */
  basis: number;
  ppnPersen: number;
  nilaiAwal?: readonly ButirTerminAwal[];
  namaInput?: string;
}) {
  const [butir, setButir] = useState<Butir[]>(() => nilaiAwal.map((b) => ({ ...b, kunci: kunciBaru() })));
  // butir terakhir dikirim tanpa nilai dan berjenis persen: server menutup sisanya
  const kiriman = butir.map((b, i) => (i === butir.length - 1 ? { label: b.label, mode: "PERSEN", nilai: "", jatuhTempo: b.jatuhTempo } : { label: b.label, mode: b.mode, nilai: b.nilai, jatuhTempo: b.jatuhTempo }));
  const pratinjau = pratinjauTerminKlien(kiriman, basis, ppnPersen);

  const ubah = (i: number, patch: Partial<Butir>) => setButir((s) => s.map((b, k) => (k === i ? { ...b, ...patch } : b)));
  const pakaiPreset = (isi: [string, string][]) => setButir(isi.map(([label, nilai]) => ({ label, mode: "PERSEN", nilai, jatuhTempo: "", kunci: kunciBaru() })));
  const tambah = () =>
    setButir((s) => {
      if (s.length >= MAKS) return s;
      const baru: Butir = { label: `Termin ${s.length}`, mode: "PERSEN", nilai: "", jatuhTempo: "", kunci: kunciBaru() };
      if (s.length === 0) return [{ ...baru, label: "Pelunasan" }];
      return [...s.slice(0, -1), baru, s[s.length - 1]];
    });
  const hapus = (i: number) => setButir((s) => s.filter((_, k) => k !== i));

  return (
    <div className="space-y-3">
      <input type="hidden" name={namaInput} value={butir.length ? JSON.stringify(kiriman) : ""} />
      <div className="flex flex-wrap items-center gap-2">
        {PRESET.map((p) => (
          <button key={p.label} type="button" onClick={() => pakaiPreset(p.butir)} className="tombol tombol-garis tombol-kecil">
            {p.label}
          </button>
        ))}
        <button type="button" onClick={() => setButir([])} className="tombol tombol-lembut tombol-kecil">
          Tanpa termin
        </button>
      </div>

      {butir.length === 0 ? (
        <p className="petunjuk">Belum ada rencana termin: pelanggan membayar lewat uang muka bebas lalu faktur akhir. Pilih preset atau tambah termin (maksimal 4).</p>
      ) : (
        <div className="bungkus-tabel">
          <table className="tabel-polos min-w-[44rem]">
            <thead>
              <tr>
                <th className="w-8">No</th>
                <th>Label</th>
                <th className="w-36">Jenis</th>
                <th className="w-32">Nilai</th>
                <th className="w-36">Jatuh tempo</th>
                <th className="w-32 text-right">Nilai hasil</th>
                <th className="w-32 text-right">Termasuk PPN</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {butir.map((b, i) => {
                const terakhir = i === butir.length - 1;
                const hasil = pratinjau.butir[i];
                return (
                  <tr key={b.kunci}>
                    <td className="mono text-slate-500">{i + 1}</td>
                    <td>
                      <input className="isian isian-kecil" maxLength={40} value={b.label} placeholder={`Termin ${i + 1}`} onChange={(e) => ubah(i, { label: e.target.value })} aria-label={`Label termin ${i + 1}`} />
                    </td>
                    <td>
                      <select className="isian isian-kecil" value={terakhir ? "PERSEN" : b.mode} disabled={terakhir} onChange={(e) => ubah(i, { mode: e.target.value as Butir["mode"] })} aria-label={`Jenis termin ${i + 1}`}>
                        <option value="PERSEN">Persen</option>
                        <option value="NOMINAL">Rp sebelum PPN</option>
                      </select>
                    </td>
                    <td>
                      {terakhir ? (
                        <span className="text-slate-500">Sisa</span>
                      ) : (
                        <input type="number" min={0} step="0.01" className="isian isian-kecil" value={b.nilai} onChange={(e) => ubah(i, { nilai: e.target.value })} aria-label={`Nilai termin ${i + 1}`} />
                      )}
                    </td>
                    <td>
                      <input type="date" className="isian isian-kecil" value={b.jatuhTempo} onChange={(e) => ubah(i, { jatuhTempo: e.target.value })} aria-label={`Jatuh tempo termin ${i + 1}`} />
                    </td>
                    <td className="text-right angka">
                      {hasil ? (
                        <>
                          {rupiah(hasil.jumlah)}
                          <div className="text-xs text-slate-400">{rupiah(hasil.persen)}%</div>
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="text-right angka">{hasil ? rupiah(hasil.bruto) : "-"}</td>
                    <td>
                      <button type="button" onClick={() => hapus(i)} className="tombol-tautan-bahaya">
                        Hapus
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {butir.length > 0 && butir.length < MAKS ? (
          <button type="button" onClick={tambah} className="tombol-tautan">
            <Ikon nama="add" className="!text-[16px]" /> Tambah termin
          </button>
        ) : (
          <span />
        )}
        {pratinjau.galat && (
          <span role="alert" className="text-sm text-rose-600">
            {pratinjau.galat}
          </span>
        )}
      </div>
    </div>
  );
}
