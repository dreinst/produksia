import { db } from "@/lib/db";

const NORMAL_DEBIT = new Set(["ASET", "BEBAN"]);

export default async function TrialBalancePage() {
  const daftarAkun = await db.akun.findMany({
    include: { barisJurnal: true },
    orderBy: { kode: "asc" },
  });

  const isian = daftarAkun.map((a) => {
    const totalDebit = a.barisJurnal.reduce((s, l) => s + Number(l.debit), 0);
    const totalKredit = a.barisJurnal.reduce((s, l) => s + Number(l.kredit), 0);
    const isDebitNormal = NORMAL_DEBIT.has(a.jenis);
    const balance = isDebitNormal ? totalDebit - totalKredit : totalKredit - totalDebit;
    return { ...a, totalDebit, totalKredit, balance };
  });

  const grandTotalDebit = isian.reduce((s, r) => s + r.totalDebit, 0);
  const grandTotalCredit = isian.reduce((s, r) => s + r.totalKredit, 0);

  return (
    <div className="space-y-6">
      <h1 className="judul-halaman">Neraca Saldo</h1>

      <div className="kartu kartu-tabel"><div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            <th>Kode</th>
            <th>Nama Akun</th>
            <th>Tipe</th>
            <th className="text-right angka">Total Debit</th>
            <th className="text-right angka">Total Kredit</th>
            <th className="text-right angka">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {isian
            .filter((r) => r.totalDebit > 0 || r.totalKredit > 0)
            .map((r) => (
              <tr key={r.id}>
                <td>{r.kode}</td>
                <td>{r.nama}</td>
                <td>{r.jenis}</td>
                <td className="text-right angka">{r.totalDebit.toLocaleString("id-ID")}</td>
                <td className="text-right angka">{r.totalKredit.toLocaleString("id-ID")}</td>
                <td className="text-right angka font-semibold">{r.balance.toLocaleString("id-ID")}</td>
              </tr>
            ))}
          {isian.every((r) => r.totalDebit === 0 && r.totalKredit === 0) && (
            <tr>
              <td colSpan={6} className="kosong">
                Belum ada transaksi jurnal.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>
              Total
            </td>
            <td className="text-right angka">{grandTotalDebit.toLocaleString("id-ID")}</td>
            <td className="text-right angka">{grandTotalCredit.toLocaleString("id-ID")}</td>
            <td />
          </tr>
        </tfoot>
        </table>
      </div></div>

      {grandTotalDebit !== grandTotalCredit && (
        <p className="text-red-600 text-sm">
          Peringatan: total debit dan kredit tidak sama — ada jurnal yang tidak seimbang.
        </p>
      )}
    </div>
  );
}
