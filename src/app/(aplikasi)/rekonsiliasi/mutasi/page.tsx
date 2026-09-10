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
  const [daftarAkun, berkas, cocok] = await Promise.all([
    daftarAkunKasBank(),
    db.mutasiBank.groupBy({ by: ["akunId", "berkas"], _count: { _all: true }, _min: { tanggal: true }, _max: { tanggal: true } }),
    db.mutasiBank.groupBy({ by: ["akunId", "berkas"], where: { barisJurnalId: { not: null } }, _count: { _all: true } }),
  ]);
  const namaAkun = new Map(daftarAkun.map((a) => [a.id, `${a.kode} - ${a.nama}`]));
  const jumlahCocok = new Map(cocok.map((c) => [`${c.akunId}|${c.berkas}`, c._count._all]));

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Rekonsiliasi" }]}
        judul="Impor Mutasi Rekening"
        subjudul="Masukkan mutasi rekening koran ke sistem, lalu cocokkan dengan buku."
        aksi={<Link href="/rekonsiliasi/kas-bank" className="tombol tombol-garis">Ke Rekonsiliasi Kas/Bank</Link>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ImporMutasi daftarAkun={daftarAkun.map((a) => ({ id: a.id, kode: a.kode, nama: a.nama }))} contohCsv={CONTOH_CSV} />
        </div>
        <div className="space-y-6">
          <div className="kartu space-y-2 text-sm">
            <h2 className="judul-kartu">Format berkas</h2>
            <ul className="list-disc pl-5 space-y-1 text-slate-600">
              <li>Baris pertama berisi nama kolom: Tanggal, Keterangan, Debit, Kredit, Saldo. Referensi boleh ada.</li>
              <li>Boleh juga satu kolom Jumlah: positif uang masuk, negatif uang keluar.</li>
              <li>Format angka dan tanggal Indonesia atau Inggris sama-sama dibaca.</li>
              <li>Baris yang sudah pernah diimpor tidak akan masuk dua kali.</li>
            </ul>
            <pre className="text-[11px] bg-slate-50 border border-slate-200 rounded p-2 overflow-x-auto">{CONTOH_CSV}</pre>
          </div>
          <div className="kartu kartu-tabel">
            <div className="kepala-kartu"><h2 className="judul-kartu">Berkas yang sudah diimpor</h2></div>
            <div className="bungkus-tabel">
              <table className="tabel text-xs">
                <thead><tr><th>Rekening</th><th>Berkas</th><th className="text-right">Baris</th><th className="text-right">Cocok</th><th>Rentang</th><th /></tr></thead>
                <tbody>
                  {berkas.map((b) => (
                    <tr key={`${b.akunId}|${b.berkas}`}>
                      <td>{namaAkun.get(b.akunId) ?? b.akunId}</td>
                      <td className="mono">{b.berkas}</td>
                      <td className="text-right angka">{b._count._all}</td>
                      <td className="text-right angka">{jumlahCocok.get(`${b.akunId}|${b.berkas}`) ?? 0}</td>
                      <td className="whitespace-nowrap text-slate-500">{b._min.tanggal?.toLocaleDateString("id-ID")} s.d. {b._max.tanggal?.toLocaleDateString("id-ID")}</td>
                      <td className="text-right">
                        <FormulirAksi aksi={hapusMutasiFormulir} pesanKonfirmasi={`Hapus ${b._count._all} mutasi dari ${b.berkas}?`} className="inline">
                          <input type="hidden" name="akunId" value={b.akunId} />
                          <input type="hidden" name="berkas" value={b.berkas} />
                          <button type="submit" className="tombol-tautan-bahaya">Hapus</button>
                        </FormulirAksi>
                      </td>
                    </tr>
                  ))}
                  {berkas.length === 0 && <tr><td colSpan={6} className="kosong">Belum ada.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
