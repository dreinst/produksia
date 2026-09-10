import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { daftarAkunKasBank } from "@/lib/baganAkun";
import { CONTOH_CSV } from "@/lib/mutasiBank";
import { hapusMutasiFormulir } from "@/lib/aksi/rekonsiliasi";
import ImporMutasi from "@/komponen/rekonsiliasi/ImporMutasi";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";

export default async function HalamanImporMutasi() {
  await wajibHak("rekonsiliasi.tulis");
  const [daftarAkun, berkas] = await Promise.all([
    daftarAkunKasBank(),
    db.mutasiBank.groupBy({ by: ["akunId", "berkas"], _count: { _all: true }, _min: { tanggal: true, diimporPada: true }, _max: { tanggal: true } }),
  ]);
  const namaAkun = new Map(daftarAkun.map((a) => [a.id, `${a.kode} - ${a.nama}`]));
  const cocok = await db.mutasiBank.groupBy({ by: ["akunId", "berkas"], where: { barisJurnalId: { not: null } }, _count: { _all: true } });
  const jumlahCocok = new Map(cocok.map((c) => [`${c.akunId}|${c.berkas}`, c._count._all]));

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Rekonsiliasi" }]}
        judul="Impor Mutasi Rekening"
        subjudul="Unggah mutasi rekening koran yang sudah rapi (CSV atau HTML tabel dari internet banking). Baris yang sama tidak diimpor dua kali; setelah itu cocokkan dengan buku di Rekonsiliasi Kas/Bank."
        aksi={<Link href="/rekonsiliasi/kas-bank" className="tombol tombol-garis">Ke Rekonsiliasi Kas/Bank</Link>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ImporMutasi daftarAkun={daftarAkun.map((a) => ({ id: a.id, kode: a.kode, nama: a.nama }))} contohCsv={CONTOH_CSV} />
        </div>
        <div className="space-y-6">
          <div className="kartu space-y-2 text-sm">
            <h2 className="judul-kartu">Format yang diterima</h2>
            <ul className="list-disc pl-5 space-y-1 text-slate-600">
              <li><strong>Tajuk kolom</strong> (baris pertama): <code>Tanggal</code>, <code>Keterangan</code>, <code>Referensi</code> (opsional), lalu <code>Debit</code> &amp; <code>Kredit</code> terpisah <em>atau</em> satu kolom <code>Jumlah</code> bertanda (−/DB = keluar), <code>Saldo</code> (opsional). Nama Inggris (Date, Description, Debit/Credit, Amount, Balance) juga dikenali.</li>
              <li><strong>Pembatas</strong> CSV dideteksi otomatis (<code>;</code> <code>,</code> tab). Angka boleh <code>1.234.567,89</code> atau <code>1,234,567.89</code>; tanggal <code>dd/mm/yyyy</code>, <code>yyyy-mm-dd</code>, atau <code>05 Sep 2026</code>.</li>
              <li><strong>HTML</strong>: file hasil “simpan sebagai” dari internet banking yang berisi <code>&lt;table&gt;</code>; tabel dengan baris terbanyak dipakai.</li>
              <li>Arah dilihat dari <strong>sudut rekening</strong>: kredit rekening = uang masuk ke kita.</li>
            </ul>
            <pre className="text-[11px] bg-slate-50 border border-slate-200 rounded p-2 overflow-x-auto">{CONTOH_CSV}</pre>
          </div>
          <div className="kartu kartu-tabel">
            <div className="kepala-kartu"><h2 className="judul-kartu">Berkas yang sudah diimpor</h2></div>
            <div className="bungkus-tabel">
              <table className="tabel text-xs">
                <thead><tr><th>Akun</th><th>Berkas</th><th className="text-right">Baris</th><th className="text-right">Cocok</th><th>Rentang</th><th /></tr></thead>
                <tbody>
                  {berkas.map((b) => (
                    <tr key={`${b.akunId}|${b.berkas}`}>
                      <td>{namaAkun.get(b.akunId) ?? b.akunId}</td>
                      <td className="mono">{b.berkas}</td>
                      <td className="text-right angka">{b._count._all}</td>
                      <td className="text-right angka">{jumlahCocok.get(`${b.akunId}|${b.berkas}`) ?? 0}</td>
                      <td className="whitespace-nowrap text-slate-500">{b._min.tanggal?.toLocaleDateString("id-ID")} – {b._max.tanggal?.toLocaleDateString("id-ID")}</td>
                      <td className="text-right">
                        <FormulirAksi aksi={hapusMutasiFormulir} pesanKonfirmasi={`Hapus ${b._count._all} mutasi dari ${b.berkas}? Pencocokannya ikut dilepas.`} className="inline">
                          <input type="hidden" name="akunId" value={b.akunId} />
                          <input type="hidden" name="berkas" value={b.berkas} />
                          <button type="submit" className="tombol-tautan-bahaya">Hapus</button>
                        </FormulirAksi>
                      </td>
                    </tr>
                  ))}
                  {berkas.length === 0 && <tr><td colSpan={6} className="kosong">Belum ada mutasi yang diimpor.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
