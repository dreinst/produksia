import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";

export default async function HalamanLogAktivitas({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await wajibHak("log-aktivitas.lihat");
  const param = await bacaParamDaftar(searchParams);
  const where = param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { jenis: cocokTeks(param.q) }, { penggunaNama: cocokTeks(param.q) }, { keterangan: cocokTeks(param.q) }] } : undefined;
  const [total, daftar] = await Promise.all([
    db.logAktivitas.count({ where }),
    db.logAktivitas.findMany({ where, orderBy: { waktu: "desc" }, skip: param.lewati, take: param.ambil }),
  ]);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Administrasi" }, { label: "Pengaturan" }]}
        judul="Log Aktivitas"
        subjudul="Jejak audit tindakan yang mengubah data secara tidak biasa: penghapusan dokumen, penutupan buku, dan sebagainya."
      />
      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari nomor / jenis / pengguna…" />
        <div className="bungkus-tabel">
          <table className="tabel min-w-[40rem]">
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Pengguna</th>
                <th>Aksi</th>
                <th>Dokumen</th>
                <th>Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {daftar.map((l) => (
                <tr key={l.id}>
                  <td className="text-slate-500 whitespace-nowrap">{l.waktu.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{l.penggunaNama}</td>
                  <td><span className="lencana lencana-rose">{l.aksi}</span></td>
                  <td>
                    <span className="text-slate-500">{l.jenis}</span> <span className="mono font-semibold">{l.nomor}</span>
                  </td>
                  <td className="text-slate-600">{l.keterangan ?? "-"}</td>
                </tr>
              ))}
              {daftar.length === 0 && (
                <tr>
                  <td colSpan={5} className="kosong">{param.q ? "Tidak ada yang cocok." : "Belum ada aktivitas tercatat."}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
