import { db } from "@/lib/db";
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
      <h1 className="text-xl font-semibold">Kas Masuk</h1>

      <ActionForm action={createCashInForm} className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl border rounded-lg p-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Akun Kas/Bank Penerima *</label>
          <select name="cashAccountId" required className="border rounded px-2 py-1">
            <option value="">-</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} - {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Akun Lawan (sumber dana) *</label>
          <select name="counterAccountId" required className="border rounded px-2 py-1">
            <option value="">-</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} - {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Jumlah *</label>
          <input type="number" name="amount" step="0.01" min={0} required className="border rounded px-2 py-1" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Keterangan</label>
          <input type="text" name="description" className="border rounded px-2 py-1" />
        </div>

        <div className="md:col-span-2">
          <button type="submit" className="bg-black text-white px-4 py-2 rounded text-sm">
            Catat Kas Masuk
          </button>
        </div>
      </ActionForm>

      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <table className="w-full text-sm border-collapse min-w-[36rem]">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4">No</th>
            <th className="py-2 pr-4">Tanggal</th>
            <th className="py-2 pr-4">Akun Kas/Bank</th>
            <th className="py-2 pr-4">Dari Akun</th>
            <th className="py-2 pr-4 text-right">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const cashLine = e.lines.find((l) => Number(l.debit) > 0);
            const counterLine = e.lines.find((l) => Number(l.credit) > 0);
            return (
              <tr key={e.id} className="border-b">
                <td className="py-2 pr-4">{e.no}</td>
                <td className="py-2 pr-4">{e.date.toLocaleDateString("id-ID")}</td>
                <td className="py-2 pr-4">{cashLine?.account.name}</td>
                <td className="py-2 pr-4">{counterLine?.account.name}</td>
                <td className="py-2 pr-4 text-right">
                  {Number(cashLine?.debit ?? 0).toLocaleString("id-ID")}
                </td>
              </tr>
            );
          })}
          {entries.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-zinc-500">
                Belum ada kas masuk.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div>
    </div>
  );
}
