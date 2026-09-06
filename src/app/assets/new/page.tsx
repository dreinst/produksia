import { db } from "@/lib/db";
import ActionForm from "@/components/ActionForm";
import { createFixedAssetForm } from "@/lib/actions/fixedAssets";

export default async function NewFixedAssetPage() {
  const accounts = await db.account.findMany({ orderBy: { code: "asc" } });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-xl font-semibold">Aset Tetap Baru</h1>

      <ActionForm action={createFixedAssetForm} className="grid grid-cols-1 md:grid-cols-2 gap-4 border rounded-lg p-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Kode *</label>
          <input type="text" name="code" required className="border rounded px-2 py-1" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Nama Aset *</label>
          <input type="text" name="name" required className="border rounded px-2 py-1" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Tanggal Perolehan</label>
          <input type="date" name="acquisitionDate" defaultValue={today} className="border rounded px-2 py-1" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Harga Perolehan *</label>
          <input type="number" name="acquisitionCost" step="0.01" min={0} required className="border rounded px-2 py-1" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Nilai Sisa (Salvage)</label>
          <input type="number" name="salvageValue" step="0.01" min={0} defaultValue={0} className="border rounded px-2 py-1" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Umur Ekonomis (bulan) *</label>
          <input type="number" name="usefulLifeMonths" min={1} required className="border rounded px-2 py-1" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Akun Aset (Aset Tetap) *</label>
          <select name="assetAccountId" required className="border rounded px-2 py-1">
            <option value="">-</option>
            {accounts.filter((a) => a.type === "ASET").map((a) => (
              <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Akun Beban Penyusutan *</label>
          <select name="depreciationExpenseAccountId" required className="border rounded px-2 py-1">
            <option value="">-</option>
            {accounts.filter((a) => a.type === "BEBAN").map((a) => (
              <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 md:col-span-2">
          <label className="text-sm font-medium">Akun Akumulasi Penyusutan (kontra-aset) *</label>
          <select name="accumulatedDepreciationAccountId" required className="border rounded px-2 py-1">
            <option value="">-</option>
            {accounts.filter((a) => a.type === "ASET").map((a) => (
              <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <button type="submit" className="bg-black text-white px-4 py-2 rounded text-sm">
            Simpan Aset
          </button>
        </div>
      </ActionForm>
    </div>
  );
}
