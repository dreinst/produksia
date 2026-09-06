import { db } from "@/lib/db";

const DEBIT_NORMAL = new Set(["ASET", "BEBAN"]);

export default async function TrialBalancePage() {
  const accounts = await db.account.findMany({
    include: { journalLines: true },
    orderBy: { code: "asc" },
  });

  const rows = accounts.map((a) => {
    const totalDebit = a.journalLines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = a.journalLines.reduce((s, l) => s + Number(l.credit), 0);
    const isDebitNormal = DEBIT_NORMAL.has(a.type);
    const balance = isDebitNormal ? totalDebit - totalCredit : totalCredit - totalDebit;
    return { ...a, totalDebit, totalCredit, balance };
  });

  const grandTotalDebit = rows.reduce((s, r) => s + r.totalDebit, 0);
  const grandTotalCredit = rows.reduce((s, r) => s + r.totalCredit, 0);

  return (
    <div className="space-y-6">
      <h1 className="page-title">Neraca Saldo</h1>

      <div className="card card-table"><div className="table-wrap">
        <table className="tbl min-w-[36rem]">
        <thead>
          <tr>
            <th>Kode</th>
            <th>Nama Akun</th>
            <th>Tipe</th>
            <th className="text-right num">Total Debit</th>
            <th className="text-right num">Total Kredit</th>
            <th className="text-right num">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .filter((r) => r.totalDebit > 0 || r.totalCredit > 0)
            .map((r) => (
              <tr key={r.id}>
                <td>{r.code}</td>
                <td>{r.name}</td>
                <td>{r.type}</td>
                <td className="text-right num">{r.totalDebit.toLocaleString("id-ID")}</td>
                <td className="text-right num">{r.totalCredit.toLocaleString("id-ID")}</td>
                <td className="text-right num font-semibold">{r.balance.toLocaleString("id-ID")}</td>
              </tr>
            ))}
          {rows.every((r) => r.totalDebit === 0 && r.totalCredit === 0) && (
            <tr>
              <td colSpan={6} className="empty">
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
            <td className="text-right num">{grandTotalDebit.toLocaleString("id-ID")}</td>
            <td className="text-right num">{grandTotalCredit.toLocaleString("id-ID")}</td>
            <td />
          </tr>
        </tfoot>
        </table>
      </div></div>

      {grandTotalDebit !== grandTotalCredit && (
        <p className="text-red-600 text-sm">
          Peringatan: total debit dan kredit tidak sama — ada jurnal yang tidak balance.
        </p>
      )}
    </div>
  );
}
