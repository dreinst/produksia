import { db } from "@/lib/db";
import { DocNo } from "@/components/ui/Badges";
import ActionForm from "@/components/ActionForm";
import { createCashInForm } from "@/lib/actions/journal";

export default async function CashInPage() {
  const [accounts, entries] = await Promise.all([
    db.account.findMany({ orderBy: { code: "asc" } }),
    db.journalEntry.findMany({
      where: { source: "KAS_MASUK" },
      include: { lines: { include: { account: true } } },
      orderBy: { date: "desc" },
    }),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="page-title">Kas Masuk</h1>

      <ActionForm action={createCashInForm} className="card grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
        <div className="field">
          <label className="label">Akun Kas/Bank Penerima *</label>
          <select name="cashAccountId" required className="input">
            <option value="">-</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} - {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="label">Akun Lawan (sumber dana) *</label>
          <select name="counterAccountId" required className="input">
            <option value="">-</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} - {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="label">Jumlah *</label>
          <input type="number" name="amount" step="0.01" min={0} required className="input" />
        </div>

        <div className="field">
          <label className="label">Keterangan</label>
          <input type="text" name="description" className="input" />
        </div>

        <div className="md:col-span-2">
          <button type="submit" className="btn btn-primary">
            Catat Kas Masuk
          </button>
        </div>
      </ActionForm>

      <div className="card card-table"><div className="table-wrap">
        <table className="tbl min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            <th>Tanggal</th>
            <th>Akun Kas/Bank</th>
            <th>Dari Akun</th>
            <th className="text-right num">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const cashLine = e.lines.find((l) => Number(l.debit) > 0);
            const counterLine = e.lines.find((l) => Number(l.credit) > 0);
            return (
              <tr key={e.id}>
                <td><DocNo no={e.no} /></td>
                <td className="text-slate-500 whitespace-nowrap">{e.date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td>{cashLine?.account.name}</td>
                <td>{counterLine?.account.name}</td>
                <td className="text-right num">
                  {Number(cashLine?.debit ?? 0).toLocaleString("id-ID")}
                </td>
              </tr>
            );
          })}
          {entries.length === 0 && (
            <tr>
              <td colSpan={5} className="empty">
                Belum ada kas masuk.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
