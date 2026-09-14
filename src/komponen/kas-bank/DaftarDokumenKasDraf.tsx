import { db } from "@/lib/db";
import type { PenggunaSesi } from "@/lib/hakAkses";
import { NomorDokumen, Rp } from "@/komponen/ui/Lencana";
import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import { SelPersetujuan } from "@/komponen/KontrolPersetujuan";
import type { StatusPersetujuan } from "@/prisma-klien/enums";

/**
 * Kas Masuk / Kas Keluar yang belum masuk buku besar (draf, menunggu, atau ditolak).
 * Dokumen yang sudah disetujui tidak tampil di sini: begitu disetujui, jurnal KM/KK-nya dibuat
 * dan barisnya muncul di tabel jurnal halaman yang sama.
 */
export default async function DaftarDokumenKasDraf({
  jenis,
  pengguna,
  bolehHapus,
}: {
  jenis: "MASUK" | "KELUAR";
  pengguna: PenggunaSesi;
  bolehHapus: boolean;
}) {
  const daftar = await db.dokumenKas.findMany({
    where: { jenis, statusPersetujuan: { in: ["DRAFT", "MENUNGGU", "DITOLAK"] satisfies StatusPersetujuan[] } },
    include: { akunKas: true, akunLawan: true, proyek: { select: { kode: true } }, diajukanOleh: { select: { nama: true } } },
    orderBy: { tanggal: "desc" },
  });
  if (daftar.length === 0) return null;

  const kode = jenis === "MASUK" ? "kas-masuk" : "kas-keluar";
  return (
    <div className="kartu kartu-tabel">
      <div className="kepala-kartu">
        <h2 className="judul-kartu">Menunggu persetujuan ({daftar.length})</h2>
        <p className="subjudul-kartu">Belum masuk buku besar. Jurnal {jenis === "MASUK" ? "KM" : "KK"} dibuat saat dokumen disetujui pengguna lain.</p>
      </div>
      <div className="bungkus-tabel">
        <table className="tabel min-w-[44rem]">
          <thead>
            <tr>
              <th>No</th>
              <th>Tanggal</th>
              <th>Akun Kas/Bank</th>
              <th>Akun Lawan</th>
              <th className="text-right">Jumlah</th>
              <th>Keterangan</th>
              <th>Event</th>
              <th>Diajukan oleh</th>
              <th>Status &amp; tindakan</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {daftar.map((d) => (
              <tr key={d.id}>
                <td>
                  <NomorDokumen nomor={d.nomor} />
                </td>
                <td className="text-slate-500 whitespace-nowrap">
                  {d.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                </td>
                <td>
                  {d.akunKas.kode} - {d.akunKas.nama}
                </td>
                <td>
                  {d.akunLawan.kode} - {d.akunLawan.nama}
                </td>
                <td className="text-right">
                  <Rp nilai={d.jumlah} />
                </td>
                <td className="text-slate-600">{d.keterangan ?? "-"}</td>
                <td className="text-slate-500">{d.proyek?.kode ?? "-"}</td>
                <td className="text-slate-500">{d.diajukanOleh?.nama ?? d.dibuatOleh}</td>
                <td>
                  <SelPersetujuan
                    jenis="dokumenKas"
                    kode={kode}
                    id={d.id}
                    nomor={d.nomor}
                    status={d.statusPersetujuan}
                    diajukanOlehId={d.diajukanOlehId}
                    pengguna={pengguna}
                    catatanPenolakan={d.catatanPenolakan}
                  />
                </td>
                <td className="text-right">
                  <TombolHapusDokumen jenis="dokumenKas" id={d.id} nomor={d.nomor} boleh={bolehHapus} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
