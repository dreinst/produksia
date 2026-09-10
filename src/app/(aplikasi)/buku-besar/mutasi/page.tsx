import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import PilihAkun from "@/komponen/buku-besar/PilihAkun";

const NORMAL_DEBIT = new Set(["ASET", "BEBAN"]);

export default async function HalamanBukuBesarMutasi({
  searchParams,
}: {
  searchParams: Promise<{ akunId?: string }>;
}) {
  await wajibHak("buku-besar.lihat");
  const { akunId } = await searchParams;

  const daftarAkun = await db.akun.findMany({ where: { kelompok: false }, orderBy: { kode: "asc" } });
  const akun = akunId ? daftarAkun.find((a) => a.id === akunId) : daftarAkun[0];

  const daftarBaris = akun
    ? await db.barisJurnal.findMany({
        where: { akunId: akun.id },
        include: { jurnal: true },
        orderBy: { jurnal: { tanggal: "asc" } },
      })
    : [];

  const isDebitNormal = akun ? NORMAL_DEBIT.has(akun.jenis) : true;
  // saldo berjalan: akumulasi tanpa mutasi variabel luar (aturan lint react-hooks/immutability)
  const isian = daftarBaris.reduce<(typeof daftarBaris[number] & { runningBalance: number })[]>((acc, l) => {
    const sebelumnya = acc.length ? acc[acc.length - 1].runningBalance : 0;
    const delta = isDebitNormal ? Number(l.debit) - Number(l.kredit) : Number(l.kredit) - Number(l.debit);
    acc.push({ ...l, runningBalance: sebelumnya + delta });
    return acc;
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="judul-halaman">Buku Besar</h1>

      <div className="flex items-center gap-2">
        <label className="label" htmlFor="akunId">Akun:</label>
        <PilihAkun daftarAkun={daftarAkun} idTerpilih={akun?.id} />
      </div>

      {akun && (
        <div className="kartu kartu-tabel"><div className="bungkus-tabel">
          <table className="tabel min-w-[36rem]">
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>No Jurnal</th>
              <th>Keterangan</th>
              <th className="text-right angka">Debit</th>
              <th className="text-right angka">Kredit</th>
              <th className="text-right angka">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {isian.map((l) => (
              <tr key={l.id}>
                <td>{l.jurnal.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td>{l.jurnal.nomor}</td>
                <td>{l.keterangan || l.jurnal.keterangan || "-"}</td>
                <td className="text-right angka">
                  {Number(l.debit) > 0 ? Number(l.debit).toLocaleString("id-ID") : ""}
                </td>
                <td className="text-right angka">
                  {Number(l.kredit) > 0 ? Number(l.kredit).toLocaleString("id-ID") : ""}
                </td>
                <td className="text-right angka font-semibold">{l.runningBalance.toLocaleString("id-ID")}</td>
              </tr>
            ))}
            {isian.length === 0 && (
              <tr>
                <td colSpan={6} className="kosong">
                  Belum ada mutasi untuk akun ini.
                </td>
              </tr>
            )}
          </tbody>
          </table>
        </div></div>
      )}
    </div>
  );
}
