import Link from "next/link";
import { db } from "@/lib/db";

export default async function JournalPage() {
  const entries = await db.journalEntry.findMany({
    include: { lines: { include: { account: true } } },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Jurnal Umum</h1>
        <Link href="/ledger/journal/new" className="btn btn-primary">
          + Jurnal Baru
        </Link>
      </div>

      <div className="space-y-4">
        {entries.map((e) => {
          const total = e.lines.reduce((s, l) => s + Number(l.debit), 0);
          return (
            <div key={e.id} className="card">
              <div className="flex justify-between text-sm mb-2">
                <div>
                  <span className="font-medium">{e.no}</span> &middot; {e.date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })} &middot;{" "}
                  <span className="text-slate-500">{e.source}</span>
                </div>
                <div className="font-medium">{total.toLocaleString("id-ID")}</div>
              </div>
              {e.memo && <div className="text-sm text-slate-500 mb-2">{e.memo}</div>}
              <div className="card card-table"><div className="table-wrap">
                <table className="tbl-plain min-w-[36rem]">
                <tbody>
                  {e.lines.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td>
                        {l.account.code} - {l.account.name}
                      </td>
                      <td className="text-slate-500">{l.description}</td>
                      <td className="text-right num w-32">
                        {Number(l.debit) > 0 ? Number(l.debit).toLocaleString("id-ID") : ""}
                      </td>
                      <td className="text-right num w-32">
                        {Number(l.credit) > 0 ? Number(l.credit).toLocaleString("id-ID") : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div></div>
            </div>
          );
        })}
        {entries.length === 0 && <p className="muted">Belum ada jurnal.</p>}
      </div>
    </div>
  );
}
