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
      <h1 className="text-xl font-semibold">Neraca Saldo</h1>

      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <table className="w-full text-sm border-collapse min-w-[36rem]">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4">Kode</th>
            <th className="py-2 pr-4">Nama Akun</th>
            <th className="py-2 pr-4">Tipe</th>
            <th className="py-2 pr-4 text-right">Total Debit</th>
            <th className="py-2 pr-4 text-right">Total Kredit</th>
            <th className="py-2 pr-4 text-right">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .filter((r) => r.totalDebit > 0 || r.totalCredit > 0)
            .map((r) => (
              <tr key={r.id} className="border-b">
                <td className="py-2 pr-4">{r.code}</td>
                <td className="py-2 pr-4">{r.name}</td>
                <td className="py-2 pr-4">{r.type}</td>
                <td className="py-2 pr-4 text-right">{r.totalDebit.toLocaleString("id-ID")}</td>
                <td className="py-2 pr-4 text-right">{r.totalCredit.toLocaleString("id-ID")}</td>
                <td className="py-2 pr-4 text-right font-medium">{r.balance.toLocaleString("id-ID")}</td>
              </tr>
            ))}
          {rows.every((r) => r.totalDebit === 0 && r.totalCredit === 0) && (
            <tr>
              <td colSpan={6} className="py-4 text-zinc-500">
                Belum ada transaksi jurnal.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t font-semibold">
            <td className="py-2 pr-4" colSpan={3}>
              Total
            </td>
            <td className="py-2 pr-4 text-right">{grandTotalDebit.toLocaleString("id-ID")}</td>
            <td className="py-2 pr-4 text-right">{grandTotalCredit.toLocaleString("id-ID")}</td>
            <td className="py-2 pr-4" />
          </tr>
        </tfoot>
        </table>
      </div>

      {grandTotalDebit !== grandTotalCredit && (
        <p className="text-red-600 text-sm">
          Peringatan: total debit dan kredit tidak sama — ada jurnal yang tidak balance.
        </p>
      )}
    </div>
  );
}
