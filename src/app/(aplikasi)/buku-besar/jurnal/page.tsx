import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import { punyaHak, type Hak } from "@/lib/hakAkses";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { wajibHak } from "@/lib/otentikasi";
import Link from "next/link";
import { labelSumberJurnal } from "@/komponen/ui/Lencana";
import { db } from "@/lib/db";

export default async function HalamanJurnal({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("jurnal.lihat");
  const boleh = (hak: Hak) => punyaHak(pengguna, hak);
  const param = await bacaParamDaftar(searchParams);
  const where = param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { keterangan: cocokTeks(param.q) }] } : undefined;
  const [total, daftarJurnal] = await Promise.all([
    db.jurnal.count({ where }),
    db.jurnal.findMany({ where, include: { baris: { include: { akun: true } } }, orderBy: { tanggal: "desc" }, skip: param.lewati, take: param.ambil }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="judul-halaman">Jurnal Umum</h1>
        {boleh("jurnal.buat") && (
          <Link href="/buku-besar/jurnal/baru" className="tombol tombol-utama">
          + Jurnal Baru
        </Link>
        )}
      </div>

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari nomor / keterangan jurnal…" />
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
                <div className="flex items-center gap-3">
                  <div className="font-medium">{total.toLocaleString("id-ID")}</div>
                  {["MANUAL", "KAS_MASUK", "KAS_KELUAR"].includes(e.sumber) && <TombolHapusDokumen jenis="jurnal" id={e.id} nomor={e.nomor} boleh={boleh(e.sumber === "KAS_MASUK" ? "kas-masuk.hapus" : e.sumber === "KAS_KELUAR" ? "kas-keluar.hapus" : "jurnal.hapus")} />}
                </div>
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
        {daftarJurnal.length === 0 && <p className="redup">{param.q ? "Tidak ada jurnal yang cocok." : "Belum ada jurnal."}</p>}
      </div>
    </div>
  );
}
