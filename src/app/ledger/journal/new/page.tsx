import { db } from "@/lib/db";
import ActionForm from "@/components/ActionForm";
import { createManualJournalForm } from "@/lib/actions/journal";
import JournalLinesEditor from "@/components/ledger/JournalLinesEditor";

export default async function NewJournalPage() {
  const accounts = await db.account.findMany({ orderBy: { code: "asc" } });

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-xl font-semibold">Jurnal Umum Baru</h1>

      <ActionForm action={createManualJournalForm} className="grid grid-cols-1 md:grid-cols-2 gap-4 border rounded-lg p-4">
        <div className="md:col-span-2 flex flex-col gap-1">
          <label className="text-sm font-medium">Keterangan</label>
          <input type="text" name="memo" className="border rounded px-2 py-1" />
        </div>

        <JournalLinesEditor accounts={accounts} />

        <div className="md:col-span-2">
          <button type="submit" className="bg-black text-white px-4 py-2 rounded text-sm">
            Simpan Jurnal
          </button>
        </div>
      </ActionForm>
    </div>
  );
}
