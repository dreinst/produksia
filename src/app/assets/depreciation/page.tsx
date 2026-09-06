import { db } from "@/lib/db";
import ActionForm from "@/components/ActionForm";
import { runMonthlyDepreciationForm } from "@/lib/actions/fixedAssets";

export default async function DepreciationPage() {
  const depreciations = await db.fixedAssetDepreciation.findMany({
    include: { asset: true },
    orderBy: { period: "desc" },
  });

  const currentMonth = new Date().toISOString().slice(0, 7);

  return (
    <div className="space-y-8">
      <h1 className="page-title">Penyusutan Aset Tetap</h1>

      <ActionForm action={runMonthlyDepreciationForm} className="card flex items-end gap-3 max-w-md">
        <div className="field flex-1">
          <label className="label">Periode (bulan)</label>
          <input type="month" name="period" defaultValue={currentMonth} required className="input" />
        </div>
        <button type="submit" className="btn btn-primary">
          Jalankan Penyusutan
        </button>
      </ActionForm>
      <p className="text-xs text-slate-500 -mt-4">
        Menghitung penyusutan garis lurus untuk semua aset AKTIF yang belum disusutkan pada periode ini, lalu membuat satu jurnal otomatis.
      </p>

      <div className="card card-table"><div className="table-wrap">
        <table className="tbl min-w-[36rem]">
        <thead>
          <tr>
            <th>Periode</th>
            <th>Aset</th>
            <th className="text-right num">Jumlah Penyusutan</th>
          </tr>
        </thead>
        <tbody>
          {depreciations.map((d) => (
            <tr key={d.id}>
              <td>{d.period.toLocaleDateString("id-ID", { year: "numeric", month: "long" })}</td>
              <td>{d.asset.name}</td>
              <td className="text-right num">{Number(d.amount).toLocaleString("id-ID")}</td>
            </tr>
          ))}
          {depreciations.length === 0 && (
            <tr>
              <td colSpan={3} className="empty">
                Belum ada penyusutan yang dijalankan.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
