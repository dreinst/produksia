import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { daftarPerusahaan, lingkupPerusahaan } from "@/lib/perusahaan";
import {
  DAFTAR_MODUL_LOG,
  LABEL_LOG_TANPA_MODUL,
  MODUL_LOG,
  NILAI_MODUL_UMUM,
  NILAI_TANPA_AKUN,
  NILAI_TINGKAT_SISTEM,
  adaSaringanLog,
  bacaSaringanLog,
  gayaAksiLog,
  labelModulLog,
  paramSaringanLog,
  saringLogLingkup,
  syaratLogTerlihat,
  syaratSaringanLog,
} from "@/lib/log";
import { punyaHak } from "@/lib/hakAkses";
import { ruangTersembunyi } from "@/lib/berkas";
import type { Prisma } from "@/prisma-klien/client";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";

/** Rincian meta log sebagai pasangan kunci dan nilai. */
function pasanganMeta(meta: Prisma.JsonValue): [string, string][] {
  const teks = (v: Prisma.JsonValue) => (v === null ? "-" : typeof v === "string" ? v : JSON.stringify(v));
  if (meta !== null && typeof meta === "object" && !Array.isArray(meta)) return Object.entries(meta).map(([k, v]) => [k, teks(v ?? null)]);
  return [["nilai", teks(meta)]];
}

export default async function HalamanLogAktivitas({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("log-aktivitas.lihat");
  const param = await bacaParamDaftar(searchParams);
  const lingkup = await lingkupPerusahaan();
  const saringan = bacaSaringanLog(await searchParams);
  // di lingkup satu perusahaan, saringan perusahaan tidak ditampilkan, jadi tidak boleh ikut menyaring diam-diam
  if (lingkup.perusahaanId) saringan.perusahaan = null;
  const modulBoleh = DAFTAR_MODUL_LOG.filter((m) => {
    const h = MODUL_LOG[m].hakLihat;
    return !h || punyaHak(pengguna, h);
  });
  // modul yang tidak boleh dilihat tidak punya pilihan di formulir; jangan biarkan ia menyaring diam-diam dari URL
  if (saringan.modul && saringan.modul !== NILAI_MODUL_UMUM && !modulBoleh.includes(saringan.modul)) saringan.modul = null;

  // log berkas di folder atau proyek yang tersembunyi bagi pengguna ikut tersembunyi (D7 §3.7.4)
  const ruang = await ruangTersembunyi(db, pengguna);
  const dasar: Prisma.LogAktivitasWhereInput = { AND: [syaratLogTerlihat(pengguna, ruang), saringLogLingkup(lingkup.perusahaanId)] };
  const cari: Prisma.LogAktivitasWhereInput = param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { jenis: cocokTeks(param.q) }, { penggunaNama: cocokTeks(param.q) }, { keterangan: cocokTeks(param.q) }] } : {};
  const where: Prisma.LogAktivitasWhereInput = { AND: [dasar, syaratSaringanLog(saringan), cari] };
  const [total, daftar, kelompokAksi, daftarPengguna, perusahaan] = await Promise.all([
    db.logAktivitas.count({ where }),
    db.logAktivitas.findMany({ where, orderBy: { waktu: "desc" }, skip: param.lewati, take: param.ambil }),
    db.logAktivitas.groupBy({ by: ["aksi"], where: dasar, orderBy: { aksi: "asc" } }),
    db.pengguna.findMany({ select: { id: true, nama: true }, orderBy: { nama: "asc" } }),
    lingkup.perusahaanId ? Promise.resolve([]) : daftarPerusahaan(true),
  ]);

  const daftarAksi = kelompokAksi.map((k) => k.aksi);
  if (saringan.aksi && !daftarAksi.includes(saringan.aksi)) daftarAksi.push(saringan.aksi);
  const disaring = adaSaringanLog(saringan);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Administrasi" }, { label: "Pengaturan" }]}
        judul="Log Aktivitas"
        subjudul="Jejak audit: penghapusan dan persetujuan dokumen, penutupan buku, hak akses, berkas, masuk, dan aktivitas modul."
      />
      <div className="kartu kartu-tabel">
        <form method="get" className="kepala-kartu sm:!items-end">
          {param.q && <input type="hidden" name="q" value={param.q} />}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 flex-1">
            <div className="bidang">
              <label className="label" htmlFor="saring-modul">Modul</label>
              <select id="saring-modul" name="modul" className="isian isian-kecil" defaultValue={saringan.modul ?? ""}>
                <option value="">Semua</option>
                <option value={NILAI_MODUL_UMUM}>{LABEL_LOG_TANPA_MODUL}</option>
                {modulBoleh.map((m) => (
                  <option key={m} value={m}>{MODUL_LOG[m].label}</option>
                ))}
              </select>
            </div>
            <div className="bidang">
              <label className="label" htmlFor="saring-aksi">Aksi</label>
              <select id="saring-aksi" name="aksi" className="isian isian-kecil" defaultValue={saringan.aksi ?? ""}>
                <option value="">Semua</option>
                {daftarAksi.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div className="bidang">
              <label className="label" htmlFor="saring-pengguna">Pengguna</label>
              <select id="saring-pengguna" name="pengguna" className="isian isian-kecil" defaultValue={saringan.pengguna ?? ""}>
                <option value="">Semua</option>
                {daftarPengguna.map((p) => (
                  <option key={p.id} value={p.id}>{p.nama}</option>
                ))}
                <option value={NILAI_TANPA_AKUN}>Tanpa akun (skrip/terhapus)</option>
              </select>
            </div>
            {!lingkup.perusahaanId && (
              <div className="bidang">
                <label className="label" htmlFor="saring-perusahaan">Perusahaan</label>
                <select id="saring-perusahaan" name="perusahaan" className="isian isian-kecil" defaultValue={saringan.perusahaan ?? ""}>
                  <option value="">Semua</option>
                  {perusahaan.map((p) => (
                    <option key={p.id} value={p.id}>{p.nama}{p.aktif ? "" : " (arsip)"}</option>
                  ))}
                  <option value={NILAI_TINGKAT_SISTEM}>Tingkat sistem</option>
                </select>
              </div>
            )}
            <div className="bidang">
              <label className="label" htmlFor="saring-dari">Dari</label>
              <input id="saring-dari" type="date" name="dari" defaultValue={saringan.dari ?? ""} className="isian isian-kecil" />
            </div>
            <div className="bidang">
              <label className="label" htmlFor="saring-sampai">Sampai</label>
              <input id="saring-sampai" type="date" name="sampai" defaultValue={saringan.sampai ?? ""} className="isian isian-kecil" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" className="tombol tombol-utama tombol-kecil">Saring</button>
            {disaring && (
              <Link href={param.q ? `/pengaturan/log-aktivitas?q=${encodeURIComponent(param.q)}` : "/pengaturan/log-aktivitas"} className="tombol tombol-garis tombol-kecil">
                Hapus saringan
              </Link>
            )}
          </div>
        </form>
        {lingkup.perusahaan && (
          <p className="px-5 md:px-6 pt-3 text-xs text-slate-500">
            Lingkup {lingkup.perusahaan.nama}: catatan perusahaan ini, termasuk catatan tanpa perusahaan.
          </p>
        )}
        <KontrolDaftar param={param} total={total} placeholder="Cari nomor / jenis / pengguna…" tambahan={paramSaringanLog(saringan)} />
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
                  <td><span className={l.modul === null ? "lencana lencana-rose" : gayaAksiLog(l.aksi, l.modul)}>{l.aksi}</span></td>
                  <td>
                    {l.modul !== null && <span className="lencana lencana-slate mr-1.5">{labelModulLog(l.modul)}</span>}
                    <span className="text-slate-500">{l.jenis}</span> <span className="mono font-semibold">{l.nomor}</span>
                  </td>
                  <td className="text-slate-600">
                    {l.keterangan ?? "-"}
                    {l.meta !== null && (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-slate-500">Rincian</summary>
                        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                          {pasanganMeta(l.meta).map(([k, v]) => (
                            <div key={k} className="contents">
                              <dt className="text-slate-500">{k}</dt>
                              <dd className="mono break-all">{v}</dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
              {daftar.length === 0 && (
                <tr>
                  <td colSpan={5} className="kosong">{param.q || disaring ? "Tidak ada yang cocok." : "Belum ada aktivitas tercatat."}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
