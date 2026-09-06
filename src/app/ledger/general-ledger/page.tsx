import { db } from "@/lib/db";
import AccountSelect from "@/components/ledger/AccountSelect";

const DEBIT_NORMAL = new Set(["ASET", "BEBAN"]);

export default async function GeneralLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string }>;
}) {
  const { accountId } = await searchParams;

  const accounts = await db.account.findMany({ orderBy: { code: "asc" } });
  const account = accountId ? accounts.find((a) => a.id === accountId) : accounts[0];

  const lines = account
    ? await db.journalLine.findMany({
        where: { accountId: account.id },
        include: { journalEntry: true },
        orderBy: { journalEntry: { date: "asc" } },
      })
    : [];

  const isDebitNormal = account ? DEBIT_NORMAL.has(account.type) : true;
  // saldo berjalan: akumulasi tanpa mutasi variabel luar (aturan lint react-hooks/immutability)
  const rows = lines.reduce<(typeof lines[number] & { runningBalance: number })[]>((acc, l) => {
    const prev = acc.length ? acc[acc.length - 1].runningBalance : 0;
    const delta = isDebitNormal ? Number(l.debit) - Number(l.credit) : Number(l.credit) - Number(l.debit);
    acc.push({ ...l, runningBalance: prev + delta });
    return acc;
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Buku Besar</h1>

      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Akun:</label>
        <AccountSelect accounts={accounts} selectedId={account?.id} />
      </div>

      {account && (
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <table className="w-full text-sm border-collapse min-w-[36rem]">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-4">Tanggal</th>
              <th className="py-2 pr-4">No Jurnal</th>
              <th className="py-2 pr-4">Keterangan</th>
              <th className="py-2 pr-4 text-right">Debit</th>
              <th className="py-2 pr-4 text-right">Kredit</th>
              <th className="py-2 pr-4 text-right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="border-b">
                <td className="py-2 pr-4">{l.journalEntry.date.toLocaleDateString("id-ID")}</td>
                <td className="py-2 pr-4">{l.journalEntry.no}</td>
                <td className="py-2 pr-4">{l.description || l.journalEntry.memo || "-"}</td>
                <td className="py-2 pr-4 text-right">
                  {Number(l.debit) > 0 ? Number(l.debit).toLocaleString("id-ID") : ""}
                </td>
                <td className="py-2 pr-4 text-right">
                  {Number(l.credit) > 0 ? Number(l.credit).toLocaleString("id-ID") : ""}
                </td>
                <td className="py-2 pr-4 text-right font-medium">{l.runningBalance.toLocaleString("id-ID")}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-zinc-500">
                  Belum ada mutasi untuk akun ini.
                </td>
              </tr>
            )}
          </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
