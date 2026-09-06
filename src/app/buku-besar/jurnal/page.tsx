import Link from "next/link";
import { labelSumberJurnal } from "@/komponen/ui/Lencana";
import { db } from "@/lib/db";

export default async function JournalPage() {
  const daftarJurnal = await db.jurnal.findMany({
    include: { baris: { include: { akun: true } } },
    orderBy: { tanggal: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="judul-halaman">Jurnal Umum</h1>
        <Link href="/buku-besar/jurnal/baru" className="tombol tombol-utama">
          + Jurnal Baru
        </Link>
      </div>

      <div className="space-y-4">
        {daftarJurnal.map((e) => {
          const total = e.baris.reduce((s, l) => s + Number(l.debit), 0);
          return (
            <div key={e.id} className="kartu">
              <div className="flex justify-between text-sm mb-2">
                <div>
                  <span className="font-medium">{e.nomor}</span> &middot; {e.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })} &middot;{" "}
                  <span className="text-slate-500">{labelSumberJurnal(e.sumber)}</span>
                </div>
                <div className="font-medium">{total.toLocaleString("id-ID")}</div>
              </div>
              {e.keterangan && <div className="text-sm text-slate-500 mb-2">{e.keterangan}</div>}
              <div className="kartu kartu-tabel"><div className="bungkus-tabel">
                <table className="tabel-polos min-w-[36rem]">
                <tbody>
                  {e.baris.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td>
                        {l.akun.kode} - {l.akun.nama}
                      </td>
                      <td className="text-slate-500">{l.keterangan}</td>
                      <td className="text-right angka w-32">
                        {Number(l.debit) > 0 ? Number(l.debit).toLocaleString("id-ID") : ""}
                      </td>
                      <td className="text-right angka w-32">
                        {Number(l.kredit) > 0 ? Number(l.kredit).toLocaleString("id-ID") : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div></div>
            </div>
          );
        })}
        {daftarJurnal.length === 0 && <p className="redup">Belum ada jurnal.</p>}
      </div>
    </div>
  );
}
