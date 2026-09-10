import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { bacaPeriode } from "@/lib/laporan";
import FilterPeriode from "@/komponen/ui/FilterPeriode";

const NORMAL_DEBIT = new Set(["ASET", "BEBAN"]);
const LABEL_JENIS: Record<string, string> = { ASET: "Aset", KEWAJIBAN: "Kewajiban", MODAL: "Ekuitas", PENDAPATAN: "Pendapatan", BEBAN: "Beban" };

type BarisNeraca = {
  id: string;
  kode: string;
  nama: string;
  jenis: string;
  kelompok: boolean;
  indukId: string | null;
  totalDebit: number;
  totalKredit: number;
  saldo: number;
};

export default async function HalamanNeracaSaldo({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await wajibHak("buku-besar.lihat");
  const pengaturan = await ambilPengaturanPerusahaan(db);
  const periode = bacaPeriode(await searchParams, pengaturan.tahunBuku);
  const daftarAkun = await db.akun.findMany({
    // neraca saldo sebelum penutupan: jurnal penutup tahun (JU-TUTUP) tidak disertakan
    include: { barisJurnal: { where: { jurnal: { tanggal: { gte: periode.dari, lte: periode.sampai }, sumber: { not: "PENUTUP" } } }, select: { debit: true, kredit: true } } },
    orderBy: { kode: "asc" },
  });

  // Saldo akun rinci dari jurnalnya; akun kelompok = jumlah seluruh keturunannya
  const dasar: BarisNeraca[] = daftarAkun.map((a) => {
    const totalDebit = a.barisJurnal.reduce((s, l) => s + Number(l.debit), 0);
    const totalKredit = a.barisJurnal.reduce((s, l) => s + Number(l.kredit), 0);
    const saldo = NORMAL_DEBIT.has(a.jenis) ? totalDebit - totalKredit : totalKredit - totalDebit;
    return { id: a.id, kode: a.kode, nama: a.nama, jenis: a.jenis, kelompok: a.kelompok, indukId: a.indukId, totalDebit, totalKredit, saldo };
  });
  const byId = new Map(dasar.map((a) => [a.id, a]));
  const anak = new Map<string, BarisNeraca[]>();
  for (const a of dasar) if (a.indukId) anak.set(a.indukId, [...(anak.get(a.indukId) ?? []), a]);

  const subtotal = (a: BarisNeraca): { totalDebit: number; totalKredit: number; saldo: number } => {
    if (!a.kelompok) return a;
    return (anak.get(a.id) ?? []).reduce(
      (acc, x) => {
        const s = subtotal(x);
        return { totalDebit: acc.totalDebit + s.totalDebit, totalKredit: acc.totalKredit + s.totalKredit, saldo: acc.saldo + s.saldo };
      },
      { totalDebit: 0, totalKredit: 0, saldo: 0 },
    );
  };
  const kedalaman = (a: BarisNeraca) => {
    let d = 0;
    let x: BarisNeraca | undefined = a;
    while (x?.indukId) {
      x = byId.get(x.indukId);
      d++;
    }
    return d;
  };

  const isian = dasar.map((a) => ({ ...a, ...subtotal(a), kedalaman: kedalaman(a) })).filter((r) => r.totalDebit > 0 || r.totalKredit > 0);
  const rinci = isian.filter((r) => !r.kelompok);
  const grandTotalDebit = rinci.reduce((s, r) => s + r.totalDebit, 0);
  const grandTotalKredit = rinci.reduce((s, r) => s + r.totalKredit, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="judul-halaman">Neraca Saldo</h1>
        <p className="subjudul-halaman">Mutasi {periode.dariTeks} s.d. {periode.sampaiTeks}, sebelum jurnal penutup tahun. Akun kelompok (baris tebal) menampilkan subtotal keturunannya; total bawah hanya menjumlahkan akun rinci.</p>
      </div>
      <FilterPeriode dari={periode.dariTeks} sampai={periode.sampaiTeks} tahunBuku={pengaturan.tahunBuku} />

      <div className="kartu kartu-tabel"><div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            <th>Kode</th>
            <th>Nama Akun</th>
            <th>Jenis</th>
            <th className="text-right angka">Total Debit</th>
            <th className="text-right angka">Total Kredit</th>
            <th className="text-right angka">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {isian.map((r) => (
            <tr key={r.id} className={r.kelompok ? "bg-slate-50/70" : undefined}>
              <td className="mono">{r.kode}</td>
              <td className={r.kelompok ? "font-semibold text-slate-900" : undefined} style={{ paddingLeft: `${0.75 + r.kedalaman * 1.25}rem` }}>
                {r.nama}
              </td>
              <td className="text-slate-500">{LABEL_JENIS[r.jenis] ?? r.jenis}</td>
              <td className={`text-right angka ${r.kelompok ? "text-slate-500" : ""}`}>{r.totalDebit.toLocaleString("id-ID")}</td>
              <td className={`text-right angka ${r.kelompok ? "text-slate-500" : ""}`}>{r.totalKredit.toLocaleString("id-ID")}</td>
              <td className="text-right angka font-semibold">{r.saldo.toLocaleString("id-ID")}</td>
            </tr>
          ))}
          {isian.length === 0 && (
            <tr>
              <td colSpan={6} className="kosong">
                Belum ada transaksi jurnal.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>Total (akun rinci)</td>
            <td className="text-right angka">{grandTotalDebit.toLocaleString("id-ID")}</td>
            <td className="text-right angka">{grandTotalKredit.toLocaleString("id-ID")}</td>
            <td />
          </tr>
        </tfoot>
        </table>
      </div></div>

      {grandTotalDebit !== grandTotalKredit && (
        <p className="text-red-600 text-sm">
          Total debit dan kredit tidak sama. Ada jurnal yang tidak seimbang.
        </p>
      )}
    </div>
  );
}
