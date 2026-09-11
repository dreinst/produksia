"use client";

import { useActionState } from "react";
import { pratinjauMutasiFormulir, imporMutasiFormulir, type StatusPratinjau } from "@/lib/aksi/rekonsiliasi";
import type { StatusFormulir } from "@/lib/statusFormulir";
import Ikon from "@/komponen/ui/Ikon";

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

/** Dua langkah: pilih berkas lalu lihat pratinjau, kemudian simpan. */
export default function ImporMutasi({ daftarAkun, contohCsv }: { daftarAkun: Akun[]; contohCsv: string }) {
  const [status, aksiPratinjau, memuat] = useActionState<StatusPratinjau, FormData>(pratinjauMutasiFormulir, { galat: null });
  const [statusImpor, aksiImpor, mengimpor] = useActionState<StatusFormulir, FormData>(imporMutasiFormulir, { galat: null });
  const p = status.pratinjau;

  return (
    <div className="space-y-6">
      <form action={aksiPratinjau} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4" aria-busy={memuat}>
        <div className="md:col-span-2 flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0"><Ikon nama="upload_file" className="!text-[22px]" /></span>
          <div>
            <h2 className="judul-kartu">Langkah 1: pilih berkas mutasi</h2>
            <p className="subjudul-kartu">Berkas CSV atau HTML dari internet banking.</p>
          </div>
        </div>
        {status.galat && <div role="alert" className="md:col-span-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{status.galat}</div>}
        <div className="bidang">
          <label className="label" htmlFor="akunId">Rekening (akun kas/bank) *</label>
          <select id="akunId" name="akunId" required className="isian" defaultValue={daftarAkun[0]?.id ?? ""}>
            {daftarAkun.map((a) => (
              <option key={a.id} value={a.id}>{a.kode} - {a.nama}</option>
            ))}
          </select>
        </div>
        <div className="bidang md:col-span-2">
          <label className="label" htmlFor="berkas">Unggah berkas mutasi</label>
          <label htmlFor="berkas" className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 px-4 py-7 text-center cursor-pointer transition-colors hover:border-navy-terang hover:bg-slate-50">
            <span className="w-12 h-12 rounded-full bg-white border border-slate-200 flex items-center justify-center text-navy-terang"><Ikon nama="upload_file" className="!text-[26px]" /></span>
            <span className="text-sm font-semibold text-slate-700">Klik di sini untuk memilih berkas mutasi</span>
            <span className="text-xs text-slate-500">Ekspor rekening koran dari internet banking sebagai CSV/TSV/HTML, lalu pilih di sini. Maksimal 2 MB.</span>
          </label>
          <input id="berkas" name="berkas" type="file" accept=".csv,.txt,.tsv,.html,.htm,text/csv,text/html,text/plain" className="isian mt-2" />
        </div>
        <div className="bidang md:col-span-2">
          <label className="label" htmlFor="sudutPandang">Arti kolom Debit/Kredit</label>
          <select id="sudutPandang" name="sudutPandang" defaultValue="otomatis" className="isian">
            <option value="otomatis">Otomatis (disarankan)</option>
            <option value="bank">Rekening koran: Kredit = uang masuk</option>
            <option value="buku">Buku kas: Debit = uang masuk</option>
          </select>
          <span className="petunjuk">Biarkan otomatis. Sistem menyimpan uang masuk sebagai Debit kas/bank, sesuai jurnal.</span>
        </div>
        <div className="bidang md:col-span-2">
          <label className="label" htmlFor="isi"><span className="flex items-center gap-1.5"><Ikon nama="content_paste" className="!text-[16px] text-slate-400" /> Atau tempel isi mutasi di sini</span></label>
          <textarea id="isi" name="isi" rows={12} className="isian font-mono text-xs leading-relaxed min-h-[220px]" placeholder={contohCsv} />
          <span className="petunjuk">Tempel langsung dari Excel atau salinan rekening koran. Kolom yang dikenali: Tanggal, Keterangan, Referensi, Debit/Kredit (atau satu kolom Jumlah bertanda), Saldo. Baris pertama boleh berupa judul kolom; pemisah koma/titik-koma/tab dideteksi otomatis.</span>
        </div>
        <details className="md:col-span-2 text-sm">
          <summary className="cursor-pointer text-slate-600">Atur kolom sendiri (jika tajuk tidak dikenali)</summary>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            {KOLOM.map((k) => (
              <div key={k.kunci} className="bidang">
                <label className="label" htmlFor={`kolom_${k.kunci}`}>{k.label}</label>
                <input id={`kolom_${k.kunci}`} name={`kolom_${k.kunci}`} placeholder="otomatis" className="isian isian-kecil" defaultValue={p?.peta[k.kunci] === null ? "" : (p?.peta[k.kunci] ?? "")} />
              </div>
            ))}
          </div>
          <span className="petunjuk">Isi nomor kolom mulai dari 0. Tulis &ldquo;-&rdquo; untuk mengabaikan.</span>
        </details>
        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama" disabled={memuat}><Ikon nama="upload_file" className="!text-[18px]" /> {memuat ? "Membaca berkas" : "Baca berkas"}</button>
        </div>
      </form>

      {p && (
        <form action={aksiImpor} className="kartu space-y-4" aria-busy={mengimpor}>
          {statusImpor.galat && <div role="alert" className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{statusImpor.galat}</div>}
          {statusImpor.ok && !statusImpor.galat && <div role="status" className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Mutasi tersimpan. Lanjut ke Rekonsiliasi Kas/Bank.</div>}
          <input type="hidden" name="isi" value={p.isi} />
          <input type="hidden" name="namaBerkas" value={p.nama} />
          <input type="hidden" name="sudutPandang" value={p.sudutDiminta} />
          {KOLOM.map((k) => (
            <input key={k.kunci} type="hidden" name={`kolom_${k.kunci}`} value={p.peta[k.kunci] === null ? "-" : String(p.peta[k.kunci])} />
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="judul-kartu">Langkah 2: periksa lalu simpan</h2>
              <p className="subjudul-kartu">{p.nama}: {p.baris.length} baris, masuk Rp {angka(p.totalMasuk)}, keluar Rp {angka(p.totalKeluar)}{p.diabaikan.length ? `, ${p.diabaikan.length} baris dilewati` : ""}.</p>
              <p className={`text-xs mt-1 ${p.sudutPandang === "buku" ? "text-amber-700" : "text-slate-500"}`}>{p.keteranganSudut}</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <span>Simpan ke</span>
              <select name="akunId" required className="isian isian-kecil w-auto" defaultValue={p.akunId || (daftarAkun[0]?.id ?? "")} key={p.akunId}>
                {daftarAkun.map((a) => (
                  <option key={a.id} value={a.id}>{a.kode} - {a.nama}</option>
                ))}
              </select>
              <button type="submit" className="tombol tombol-utama tombol-kecil" disabled={mengimpor || p.baris.length === 0}><Ikon nama="save" className="!text-[16px]" /> {mengimpor ? "Menyimpan" : `Simpan ${p.baris.length} mutasi`}</button>
            </label>
          </div>
          <div className="bungkus-tabel">
            <table className="tabel text-xs">
              <thead><tr><th>Tanggal</th><th>Keterangan</th><th>Ref</th><th className="text-right">Masuk</th><th className="text-right">Keluar</th><th className="text-right">Saldo</th><th>Di buku</th></tr></thead>
              <tbody>
                {p.baris.slice(0, 200).map((b, i) => (
                  <tr key={i}><td className="whitespace-nowrap">{b.tanggal}</td><td>{b.keterangan}</td><td className="mono">{b.referensi ?? ""}</td><td className="text-right angka text-emerald-700">{b.masuk ? angka(b.masuk) : ""}</td><td className="text-right angka text-blue-700">{b.keluar ? angka(b.keluar) : ""}</td><td className="text-right angka text-slate-500">{b.saldo === null ? "" : angka(b.saldo)}</td><td className="whitespace-nowrap">{b.masuk ? <span className="lencana lencana-emerald">Dr {angka(b.masuk)}</span> : <span className="lencana lencana-blue">Cr {angka(b.keluar)}</span>}</td></tr>
                ))}
              </tbody>
            </table>
            {p.baris.length > 200 && <p className="text-xs text-slate-500 p-2">{p.baris.length - 200} baris lagi tidak ditampilkan.</p>}
          </div>
          {p.diabaikan.length > 0 && (
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer">Baris yang dilewati ({p.diabaikan.length})</summary>
              <ul className="list-disc pl-5 mt-2 space-y-1">{p.diabaikan.slice(0, 50).map((d) => <li key={d.nomor}>Baris {d.nomor}: {d.alasan}. <span className="font-mono">{d.isi.slice(0, 120)}</span></li>)}</ul>
            </details>
          )}
        </form>
      )}
    </div>
  );
}
