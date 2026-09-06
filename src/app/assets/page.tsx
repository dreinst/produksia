import Link from "next/link";
import { db } from "@/lib/db";

export default async function FixedAssetsPage() {
  const assets = await db.fixedAsset.findMany({
    include: { depreciations: true, assetAccount: true },
    orderBy: { code: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Daftar Aset Tetap</h1>
        <div className="space-x-3">
          <Link href="/assets/depreciation" className="text-sm text-blue-600 hover:underline">
            Jalankan Penyusutan →
          </Link>
          <Link href="/assets/new" className="bg-black text-white px-4 py-2 rounded text-sm">
            + Aset Baru
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <table className="w-full text-sm border-collapse min-w-[36rem]">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4">Kode</th>
            <th className="py-2 pr-4">Nama</th>
            <th className="py-2 pr-4">Tanggal Perolehan</th>
            <th className="py-2 pr-4 text-right">Harga Perolehan</th>
            <th className="py-2 pr-4 text-right">Akumulasi Penyusutan</th>
            <th className="py-2 pr-4 text-right">Nilai Buku</th>
            <th className="py-2 pr-4">Status</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => {
            const accumulated = a.depreciations.reduce((s, d) => s + Number(d.amount), 0);
            const bookValue = Number(a.acquisitionCost) - accumulated;
            return (
              <tr key={a.id} className="border-b">
                <td className="py-2 pr-4">{a.code}</td>
                <td className="py-2 pr-4">{a.name}</td>
                <td className="py-2 pr-4">{a.acquisitionDate.toLocaleDateString("id-ID")}</td>
                <td className="py-2 pr-4 text-right">{Number(a.acquisitionCost).toLocaleString("id-ID")}</td>
                <td className="py-2 pr-4 text-right">{accumulated.toLocaleString("id-ID")}</td>
                <td className="py-2 pr-4 text-right font-medium">{bookValue.toLocaleString("id-ID")}</td>
                <td className="py-2 pr-4">{a.status}</td>
              </tr>
            );
          })}
          {assets.length === 0 && (
            <tr>
              <td colSpan={7} className="py-4 text-zinc-500">
                Belum ada aset tetap.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div>
    </div>
  );
}
