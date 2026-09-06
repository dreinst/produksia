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
      <h1 className="page-title">Buku Besar</h1>

      <div className="flex items-center gap-2">
        <label className="label">Akun:</label>
        <AccountSelect accounts={accounts} selectedId={account?.id} />
      </div>

      {account && (
        <div className="card card-table"><div className="table-wrap">
          <table className="tbl min-w-[36rem]">
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>No Jurnal</th>
              <th>Keterangan</th>
              <th className="text-right num">Debit</th>
              <th className="text-right num">Kredit</th>
              <th className="text-right num">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td>{l.journalEntry.date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td>{l.journalEntry.no}</td>
                <td>{l.description || l.journalEntry.memo || "-"}</td>
                <td className="text-right num">
                  {Number(l.debit) > 0 ? Number(l.debit).toLocaleString("id-ID") : ""}
                </td>
                <td className="text-right num">
                  {Number(l.credit) > 0 ? Number(l.credit).toLocaleString("id-ID") : ""}
                </td>
                <td className="text-right num font-semibold">{l.runningBalance.toLocaleString("id-ID")}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  Belum ada mutasi untuk akun ini.
                </td>
              </tr>
            )}
          </tbody>
          </table>
        </div></div>
      )}
    </div>
  );
}
