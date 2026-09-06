import Link from "next/link";
import { StatusBadge } from "@/components/ui/Badges";
import { db } from "@/lib/db";

export default async function FixedAssetsPage() {
  const assets = await db.fixedAsset.findMany({
    include: { depreciations: true, assetAccount: true },
    orderBy: { code: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Daftar Aset Tetap</h1>
        <div className="space-x-3">
          <Link href="/assets/depreciation" className="btn-link">
            Jalankan Penyusutan →
          </Link>
          <Link href="/assets/new" className="btn btn-primary">
            + Aset Baru
          </Link>
        </div>
      </div>

      <div className="card card-table"><div className="table-wrap">
        <table className="tbl min-w-[36rem]">
        <thead>
          <tr>
            <th>Kode</th>
            <th>Nama</th>
            <th>Tanggal Perolehan</th>
            <th className="text-right num">Harga Perolehan</th>
            <th className="text-right num">Akumulasi Penyusutan</th>
            <th className="text-right num">Nilai Buku</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => {
            const accumulated = a.depreciations.reduce((s, d) => s + Number(d.amount), 0);
            const bookValue = Number(a.acquisitionCost) - accumulated;
            return (
              <tr key={a.id}>
                <td>{a.code}</td>
                <td>{a.name}</td>
                <td>{a.acquisitionDate.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td className="text-right num">{Number(a.acquisitionCost).toLocaleString("id-ID")}</td>
                <td className="text-right num">{accumulated.toLocaleString("id-ID")}</td>
                <td className="text-right num font-semibold">{bookValue.toLocaleString("id-ID")}</td>
                <td><StatusBadge status={a.status} /></td>
              </tr>
            );
          })}
          {assets.length === 0 && (
            <tr>
              <td colSpan={7} className="empty">
                Belum ada aset tetap.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
