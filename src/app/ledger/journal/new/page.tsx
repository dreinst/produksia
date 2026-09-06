import { db } from "@/lib/db";
import ActionForm from "@/components/ActionForm";
import { createManualJournalForm } from "@/lib/actions/journal";
import JournalLinesEditor from "@/components/ledger/JournalLinesEditor";

export default async function NewJournalPage() {
  const accounts = await db.account.findMany({ orderBy: { code: "asc" } });

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="page-title">Jurnal Umum Baru</h1>

      <ActionForm action={createManualJournalForm} className="card grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="field md:col-span-2">
          <label className="label">Keterangan</label>
          <input type="text" name="memo" className="input" />
        </div>

        <JournalLinesEditor accounts={accounts} />

        <div className="md:col-span-2">
          <button type="submit" className="btn btn-primary">
            Simpan Jurnal
          </button>
        </div>
      </ActionForm>
    </div>
  );
}
