import { db } from "@/lib/db";
import ActionForm from "@/components/ActionForm";
import { createFixedAssetForm } from "@/lib/actions/fixedAssets";

export default async function NewFixedAssetPage() {
  const accounts = await db.account.findMany({ orderBy: { code: "asc" } });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="page-title">Aset Tetap Baru</h1>

      <ActionForm action={createFixedAssetForm} className="card grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="field">
          <label className="label">Kode *</label>
          <input type="text" name="code" required className="input" />
        </div>

        <div className="field">
          <label className="label">Nama Aset *</label>
          <input type="text" name="name" required className="input" />
        </div>

        <div className="field">
          <label className="label">Tanggal Perolehan</label>
          <input type="date" name="acquisitionDate" defaultValue={today} className="input" />
        </div>

        <div className="field">
          <label className="label">Harga Perolehan *</label>
          <input type="number" name="acquisitionCost" step="0.01" min={0} required className="input" />
        </div>

        <div className="field">
          <label className="label">Nilai Sisa (Salvage)</label>
          <input type="number" name="salvageValue" step="0.01" min={0} defaultValue={0} className="input" />
        </div>

        <div className="field">
          <label className="label">Umur Ekonomis (bulan) *</label>
          <input type="number" name="usefulLifeMonths" min={1} required className="input" />
        </div>

        <div className="field">
          <label className="label">Akun Aset (Aset Tetap) *</label>
          <select name="assetAccountId" required className="input">
            <option value="">-</option>
            {accounts.filter((a) => a.type === "ASET").map((a) => (
              <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="label">Akun Beban Penyusutan *</label>
          <select name="depreciationExpenseAccountId" required className="input">
            <option value="">-</option>
            {accounts.filter((a) => a.type === "BEBAN").map((a) => (
              <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
            ))}
          </select>
        </div>

        <div className="field md:col-span-2">
          <label className="label">Akun Akumulasi Penyusutan (kontra-aset) *</label>
          <select name="accumulatedDepreciationAccountId" required className="input">
            <option value="">-</option>
            {accounts.filter((a) => a.type === "ASET").map((a) => (
              <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <button type="submit" className="btn btn-primary">
            Simpan Aset
          </button>
        </div>
      </ActionForm>
    </div>
  );
}
