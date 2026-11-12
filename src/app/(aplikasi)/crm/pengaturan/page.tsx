import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { daftarPerusahaan, lingkupPerusahaan } from "@/lib/perusahaan";
import { LABEL_JENIS_TAHAP, JENIS_TAHAP, pastikanBawaanCrm } from "@/lib/crm";
import { geserTahapLeadFormulir, hapusSumberLeadFormulir, hapusTahapLeadFormulir, tambahSumberLeadFormulir, tambahTahapLeadFormulir, ubahTahapLeadFormulir } from "@/lib/aksi/crm";
import FormulirAksi from "@/komponen/FormulirAksi";
import PesanSuksesHalaman from "@/komponen/PesanSuksesHalaman";
import Ikon from "@/komponen/ui/Ikon";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";

/*
 * Pengaturan CRM per perusahaan (D4 §7.2, §3.2, DESAIN R3): tahap pipeline (ubah nama dan jenis, geser, hapus,
 * tambah) dan sumber lead (tambah, hapus). ?perusahaan= memilih perusahaan aktif; kosong = lingkup aktif, gabungan =
 * perusahaan pertama. Invarian tahap diperiksa ulang di server (periksaInvarianTahap).
 */

export default async function HalamanPengaturanCrm({ searchParams }: { searchParams: Promise<{ perusahaan?: string | string[] }> }) {
  await wajibHak("pengaturan-crm.ubah");
  const q = await searchParams;
  const pilihan = typeof q.perusahaan === "string" ? q.perusahaan : undefined;
  const [lingkup, aktif] = await Promise.all([lingkupPerusahaan(), daftarPerusahaan()]);
  const p = aktif.find((x) => x.id === pilihan) ?? aktif.find((x) => x.id === lingkup.perusahaanId) ?? aktif[0];

  await pastikanBawaanCrm(db, p.id);
  const [tahap, pakaiAktif, pakaiArsip, sumber, pakaiSumber] = await Promise.all([
    db.tahapLead.findMany({ where: { perusahaanId: p.id }, orderBy: [{ urutan: "asc" }, { id: "asc" }] }),
    db.lead.groupBy({ by: ["tahapId"], where: { perusahaanId: p.id, dihapusPada: null }, _count: { _all: true } }),
    db.lead.groupBy({ by: ["tahapId"], where: { perusahaanId: p.id, dihapusPada: { not: null } }, _count: { _all: true } }),
    db.sumberLead.findMany({ where: { perusahaanId: p.id }, orderBy: [{ urutan: "asc" }, { nama: "asc" }] }),
    db.lead.groupBy({ by: ["sumber"], where: { perusahaanId: p.id }, _count: { _all: true } }),
  ]);
  const jumlah = (daftar: { tahapId: string; _count: { _all: number } }[], id: string) => daftar.find((g) => g.tahapId === id)?._count._all ?? 0;
  const jumlahSumber = new Map(pakaiSumber.map((g) => [g.sumber, g._count._all]));

  return (
    <div className="space-y-6 max-w-5xl">
      <PesanSuksesHalaman />
      <KepalaHalaman jejak={[{ label: "Pengaturan" }, { label: "Pengaturan CRM" }]} judul="Pengaturan CRM" subjudul={`Tahap pipeline dan sumber lead untuk ${p.nama}.`} />

      {aktif.length > 1 && (
        <nav className="flex flex-wrap gap-2" aria-label="Pilih perusahaan">
          {aktif.map((x) => (
            <Link
              key={x.id}
              href={`/crm/pengaturan?perusahaan=${encodeURIComponent(x.id)}`}
              aria-current={x.id === p.id ? "true" : undefined}
              className={`flex items-center gap-2 rounded border px-3 py-1.5 text-sm ${x.id === p.id ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-200 hover:bg-slate-50"}`}
            >
              <LencanaPerusahaan kode={x.kode} warna={x.warna} />
              <span>{x.nama}</span>
            </Link>
          ))}
        </nav>
      )}

      <div className="kartu kartu-tabel">
        <div className="px-5 md:px-6 pt-5 space-y-1">
          <h2 className="judul-kartu">Tahap pipeline</h2>
          <p className="subjudul-kartu">
            Tahap pertama menjadi tahap awal lead baru dan harus berjenis Berjalan. Pipeline wajib punya minimal satu tahap Menang dan satu tahap Kalah. Tahap yang masih dipakai lead tidak bisa dihapus dan jenisnya tidak bisa diubah.
          </p>
        </div>
        <div className="bungkus-tabel">
          <table className="tabel min-w-[48rem]">
            <thead>
              <tr>
                <th>No</th>
                <th>Nama dan jenis</th>
                <th>Dipakai</th>
                <th>Urutan</th>
                <th className="th-lekat" aria-label="Hapus" />
              </tr>
            </thead>
            <tbody>
              {tahap.map((t, i) => {
                const a = jumlah(pakaiAktif, t.id);
                const r = jumlah(pakaiArsip, t.id);
                return (
                  <tr key={t.id}>
                    <td className="angka">{t.urutan}</td>
                    <td>
                      <FormulirAksi key={`${t.id}-${t.nama}-${t.jenis}`} aksi={ubahTahapLeadFormulir.bind(null, t.id)} pesanSukses="Tahap disimpan" className="flex flex-wrap items-center gap-2">
                        <label className="sr-only" htmlFor={`ubah-tahap-${t.id}-nama`}>
                          Nama tahap
                        </label>
                        <input id={`ubah-tahap-${t.id}-nama`} name="nama" required maxLength={60} defaultValue={t.nama} className="isian isian-kecil w-44" />
                        <label className="sr-only" htmlFor={`ubah-tahap-${t.id}-jenis`}>
                          Jenis tahap
                        </label>
                        <select id={`ubah-tahap-${t.id}-jenis`} name="jenis" defaultValue={t.jenis} className="isian isian-kecil w-32">
                          {JENIS_TAHAP.map((j) => (
                            <option key={j} value={j}>
                              {LABEL_JENIS_TAHAP[j]}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="tombol tombol-garis tombol-kecil">
                          Simpan
                        </button>
                      </FormulirAksi>
                    </td>
                    <td className="text-sm whitespace-nowrap">
                      {a.toLocaleString("id-ID")} lead
                      {r > 0 && <span className="redup">, {r.toLocaleString("id-ID")} terarsip</span>}
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <FormulirAksi aksi={geserTahapLeadFormulir.bind(null, t.id, "naik")}>
                          <button type="submit" className="tombol tombol-garis tombol-kecil !px-2" aria-label="Naikkan" disabled={i === 0}>
                            <Ikon nama="arrow_upward" className="!text-[16px]" />
                          </button>
                        </FormulirAksi>
                        <FormulirAksi aksi={geserTahapLeadFormulir.bind(null, t.id, "turun")}>
                          <button type="submit" className="tombol tombol-garis tombol-kecil !px-2" aria-label="Turunkan" disabled={i === tahap.length - 1}>
                            <Ikon nama="arrow_downward" className="!text-[16px]" />
                          </button>
                        </FormulirAksi>
                      </div>
                    </td>
                    <td className="td-lekat">
                      <FormulirAksi aksi={hapusTahapLeadFormulir.bind(null, t.id)} pesanKonfirmasi={`Hapus tahap ${t.nama}?`} pesanSuksesHalaman="Tahap dihapus">
                        <button type="submit" className="tombol-tautan-bahaya inline-flex items-center gap-1" aria-label={`Hapus tahap ${t.nama}`}>
                          <Ikon nama="delete" className="!text-[16px]" />
                        </button>
                      </FormulirAksi>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <FormulirAksi key={`tahap-baru-${p.id}`} aksi={tambahTahapLeadFormulir} pesanSukses="Tahap ditambahkan" className="flex flex-col sm:flex-row sm:items-end gap-3 px-5 md:px-6 py-4 border-t border-slate-100">
          <input type="hidden" name="perusahaanId" value={p.id} />
          <div className="bidang">
            <label className="label" htmlFor="tahap-baru-nama">
              Nama tahap baru *
            </label>
            <input id="tahap-baru-nama" name="nama" required maxLength={60} className="isian isian-kecil" />
          </div>
          <div className="bidang">
            <label className="label" htmlFor="tahap-baru-jenis">
              Jenis
            </label>
            <select id="tahap-baru-jenis" name="jenis" defaultValue="BERJALAN" className="isian isian-kecil">
              {JENIS_TAHAP.map((j) => (
                <option key={j} value={j}>
                  {LABEL_JENIS_TAHAP[j]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="tombol tombol-utama tombol-kecil">
            <Ikon nama="add" className="!text-[16px]" />
            Tambah tahap
          </button>
        </FormulirAksi>
      </div>

      <div className="kartu kartu-tabel">
        <div className="px-5 md:px-6 pt-5 space-y-1">
          <h2 className="judul-kartu">Sumber lead</h2>
          <p className="subjudul-kartu">Menghapus sumber tidak mengubah lead yang sudah memakainya; teks sumber di lead tetap.</p>
        </div>
        <div className="bungkus-tabel">
          <table className="tabel min-w-[32rem]">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Dipakai</th>
                <th className="th-lekat" aria-label="Hapus" />
              </tr>
            </thead>
            <tbody>
              {sumber.map((s) => (
                <tr key={s.id}>
                  <td>{s.nama}</td>
                  <td className="text-sm">{(jumlahSumber.get(s.nama) ?? 0).toLocaleString("id-ID")} lead</td>
                  <td className="td-lekat">
                    <FormulirAksi aksi={hapusSumberLeadFormulir.bind(null, s.id)} pesanKonfirmasi={`Hapus sumber ${s.nama}?`} pesanSuksesHalaman="Sumber dihapus">
                      <button type="submit" className="tombol-tautan-bahaya inline-flex items-center gap-1" aria-label={`Hapus sumber ${s.nama}`}>
                        <Ikon nama="delete" className="!text-[16px]" />
                      </button>
                    </FormulirAksi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <FormulirAksi key={`sumber-baru-${p.id}`} aksi={tambahSumberLeadFormulir} pesanSukses="Sumber ditambahkan" className="flex flex-col sm:flex-row sm:items-end gap-3 px-5 md:px-6 py-4 border-t border-slate-100">
          <input type="hidden" name="perusahaanId" value={p.id} />
          <div className="bidang">
            <label className="label" htmlFor="sumber-baru-nama">
              Nama sumber baru *
            </label>
            <input id="sumber-baru-nama" name="nama" required maxLength={60} className="isian isian-kecil" />
          </div>
          <button type="submit" className="tombol tombol-utama tombol-kecil">
            <Ikon nama="add" className="!text-[16px]" />
            Tambah sumber
          </button>
        </FormulirAksi>
      </div>
    </div>
  );
}
