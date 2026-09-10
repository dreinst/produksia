"use client";

import { useActionState } from "react";
import { pratinjauMutasiFormulir, imporMutasiFormulir, type StatusPratinjau } from "@/lib/aksi/rekonsiliasi";
import type { StatusFormulir } from "@/lib/statusFormulir";

type Akun = { id: string; kode: string; nama: string };
const angka = (n: number) => n.toLocaleString("id-ID");
const KOLOM: { kunci: "tanggal" | "keterangan" | "referensi" | "masuk" | "keluar" | "jumlah" | "saldo"; label: string }[] = [
  { kunci: "tanggal", label: "Tanggal" },
  { kunci: "keterangan", label: "Keterangan" },
  { kunci: "referensi", label: "Referensi" },
  { kunci: "masuk", label: "Kredit / masuk" },
  { kunci: "keluar", label: "Debit / keluar" },
  { kunci: "jumlah", label: "Jumlah bertanda" },
  { kunci: "saldo", label: "Saldo" },
];

/** Dua tahap: (1) unggah/tempel → pratinjau & pemetaan kolom; (2) konfirmasi → simpan ke MutasiBank. */
export default function ImporMutasi({ daftarAkun, contohCsv }: { daftarAkun: Akun[]; contohCsv: string }) {
  const [status, aksiPratinjau, memuat] = useActionState<StatusPratinjau, FormData>(pratinjauMutasiFormulir, { galat: null });
  const [statusImpor, aksiImpor, mengimpor] = useActionState<StatusFormulir, FormData>(imporMutasiFormulir, { galat: null });
  const p = status.pratinjau;

  return (
    <div className="space-y-6">
      <form action={aksiPratinjau} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4" aria-busy={memuat}>
        {status.galat && <div role="alert" className="md:col-span-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{status.galat}</div>}
        <div className="bidang">
          <label className="label" htmlFor="akunId">Akun kas/bank *</label>
          <select id="akunId" name="akunId" required className="isian" defaultValue={daftarAkun[0]?.id ?? ""}>
            {daftarAkun.map((a) => (
              <option key={a.id} value={a.id}>{a.kode} - {a.nama}</option>
            ))}
          </select>
        </div>
        <div className="bidang">
          <label className="label" htmlFor="berkas">Berkas mutasi (CSV / TSV / HTML)</label>
          <input id="berkas" name="berkas" type="file" accept=".csv,.txt,.tsv,.html,.htm,text/csv,text/html,text/plain" className="isian" />
          <span className="petunjuk">Ekspor “mutasi rekening” dari internet banking (CSV atau HTML/XLS berisi tabel), maks 2 MB</span>
        </div>
        <div className="bidang md:col-span-2">
          <label className="label" htmlFor="isi">…atau tempel isi mutasi (baris tajuk + data)</label>
          <textarea id="isi" name="isi" rows={5} className="isian font-mono text-xs" placeholder={contohCsv} />
        </div>
        <details className="md:col-span-2 text-sm">
          <summary className="cursor-pointer text-slate-600">Pemetaan kolom manual (bila tajuk tidak dikenali)</summary>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            {KOLOM.map((k) => (
              <div key={k.kunci} className="bidang">
                <label className="label" htmlFor={`kolom_${k.kunci}`}>{k.label}</label>
                <input id={`kolom_${k.kunci}`} name={`kolom_${k.kunci}`} placeholder="otomatis" className="isian isian-kecil" defaultValue={p?.peta[k.kunci] === null ? "" : (p?.peta[k.kunci] ?? "")} />
              </div>
            ))}
          </div>
          <span className="petunjuk">Isi nomor urut kolom mulai 0, atau “-” untuk mengabaikan. Kosong = deteksi otomatis dari nama tajuk.</span>
        </details>
        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama" disabled={memuat}>{memuat ? "Membaca…" : "Baca & pratinjau"}</button>
        </div>
      </form>

      {p && (
        <form action={aksiImpor} className="kartu space-y-4" aria-busy={mengimpor}>
          {statusImpor.galat && <div role="alert" className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{statusImpor.galat}</div>}
          {statusImpor.ok && !statusImpor.galat && <div role="status" className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Mutasi tersimpan. Buka Rekonsiliasi Kas/Bank untuk mencocokkan.</div>}
          <input type="hidden" name="isi" value={p.isi} />
          <input type="hidden" name="namaBerkas" value={p.nama} />
          {KOLOM.map((k) => (
            <input key={k.kunci} type="hidden" name={`kolom_${k.kunci}`} value={p.peta[k.kunci] === null ? "-" : String(p.peta[k.kunci])} />
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="judul-kartu">Pratinjau {p.nama} <span className="lencana lencana-slate">{p.format.toUpperCase()}</span></h2>
              <p className="subjudul-kartu">{p.baris.length} baris terbaca · masuk Rp {angka(p.totalMasuk)} · keluar Rp {angka(p.totalKeluar)}{p.diabaikan.length ? ` · ${p.diabaikan.length} baris diabaikan` : ""}. Tajuk: {p.tajuk.join(" | ")}</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <span>Simpan ke akun</span>
              <select name="akunId" required className="isian isian-kecil w-auto" defaultValue={p.akunId || (daftarAkun[0]?.id ?? "")} key={p.akunId}>
                {daftarAkun.map((a) => (
                  <option key={a.id} value={a.id}>{a.kode} - {a.nama}</option>
                ))}
              </select>
              <button type="submit" className="tombol tombol-utama tombol-kecil" disabled={mengimpor || p.baris.length === 0}>{mengimpor ? "Menyimpan…" : `Impor ${p.baris.length} mutasi`}</button>
            </label>
          </div>
          <div className="bungkus-tabel">
            <table className="tabel text-xs">
              <thead><tr><th>Tanggal</th><th>Keterangan</th><th>Ref</th><th className="text-right">Masuk</th><th className="text-right">Keluar</th><th className="text-right">Saldo</th></tr></thead>
              <tbody>
                {p.baris.slice(0, 200).map((b, i) => (
                  <tr key={i}><td className="whitespace-nowrap">{b.tanggal}</td><td>{b.keterangan}</td><td className="mono">{b.referensi ?? ""}</td><td className="text-right angka text-emerald-700">{b.masuk ? angka(b.masuk) : ""}</td><td className="text-right angka text-rose-700">{b.keluar ? angka(b.keluar) : ""}</td><td className="text-right angka text-slate-500">{b.saldo === null ? "" : angka(b.saldo)}</td></tr>
                ))}
              </tbody>
            </table>
            {p.baris.length > 200 && <p className="text-xs text-slate-500 p-2">… {p.baris.length - 200} baris lagi tidak ditampilkan.</p>}
          </div>
          {p.diabaikan.length > 0 && (
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer">Baris yang diabaikan ({p.diabaikan.length})</summary>
              <ul className="list-disc pl-5 mt-2 space-y-1">{p.diabaikan.slice(0, 50).map((d) => <li key={d.nomor}>Baris {d.nomor}: {d.alasan} — <span className="font-mono">{d.isi.slice(0, 120)}</span></li>)}</ul>
            </details>
          )}
        </form>
      )}
    </div>
  );
}
