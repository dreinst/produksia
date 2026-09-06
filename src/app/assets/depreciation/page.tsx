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
      <h1 className="text-xl font-semibold">Penyusutan Aset Tetap</h1>

      <ActionForm action={runMonthlyDepreciationForm} className="flex items-end gap-3 max-w-md border rounded-lg p-4">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-sm font-medium">Periode (bulan)</label>
          <input type="month" name="period" defaultValue={currentMonth} required className="border rounded px-2 py-1" />
        </div>
        <button type="submit" className="bg-black text-white px-4 py-2 rounded text-sm">
          Jalankan Penyusutan
        </button>
      </ActionForm>
      <p className="text-xs text-zinc-500 -mt-4">
        Menghitung penyusutan garis lurus untuk semua aset AKTIF yang belum disusutkan pada periode ini, lalu membuat satu jurnal otomatis.
      </p>

      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <table className="w-full text-sm border-collapse min-w-[36rem]">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4">Periode</th>
            <th className="py-2 pr-4">Aset</th>
            <th className="py-2 pr-4 text-right">Jumlah Penyusutan</th>
          </tr>
        </thead>
        <tbody>
          {depreciations.map((d) => (
            <tr key={d.id} className="border-b">
              <td className="py-2 pr-4">{d.period.toLocaleDateString("id-ID", { year: "numeric", month: "long" })}</td>
              <td className="py-2 pr-4">{d.asset.name}</td>
              <td className="py-2 pr-4 text-right">{Number(d.amount).toLocaleString("id-ID")}</td>
            </tr>
          ))}
          {depreciations.length === 0 && (
            <tr>
              <td colSpan={3} className="py-4 text-zinc-500">
                Belum ada penyusutan yang dijalankan.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div>
    </div>
  );
}
