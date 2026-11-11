import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { LABEL_PERAN, PERAN_DAPAT_DIATUR, labelPeranPengguna } from "@/lib/hakAkses";
import { PANJANG_NAMA_FOLDER, ringkasPenyimpanan } from "@/lib/berkas";
import { formatTanggal } from "@/lib/waktu";
import {
  buatFolderBerkasFormulir,
  bukaPembatasanProyekFormulir,
  hapusFolderBerkasFormulir,
  simpanAksesBerkasProyekFormulir,
  simpanAksesFolderFormulir,
  ubahFolderBerkasFormulir,
} from "@/lib/aksi/berkas";
import FormulirAksi from "@/komponen/FormulirAksi";
import Ikon from "@/komponen/ui/Ikon";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";

type ParamMentah = Record<string, string | string[] | undefined>;

const MB = (byte: number) => (byte / 1_048_576).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const daftarPeran = (peran: readonly string[]) => (peran.length ? peran.map((p) => LABEL_PERAN[p as keyof typeof LABEL_PERAN] ?? p).join(", ") : "-");

/** Akses Berkas (D7 §7.6): pembatasan folder per peran, folder buatan, pembatasan berkas per proyek, dan penyimpanan. */
export default async function HalamanAksesBerkas({ searchParams }: { searchParams: Promise<ParamMentah> }) {
  await wajibHak("berkas.akses-penuh");
  const mentah = (await searchParams).proyek;
  const proyekParam = (Array.isArray(mentah) ? mentah[0] : mentah ?? "").trim();

  const [penyimpanan, folder, hitunganFolder, semuaProyek, terbatas] = await Promise.all([
    ringkasPenyimpanan(db),
    db.folderBerkas.findMany({ orderBy: [{ urutan: "asc" }, { kode: "asc" }], select: { kode: true, nama: true, sistem: true, terbatas: true, peranBoleh: true } }),
    // berkas yang sudah dihapus permanen tidak dihitung: tidak tampil di mana pun dan tidak menahan folder
    db.berkas.groupBy({ by: ["folderKode"], where: { isiDihapusPada: null }, _count: { _all: true } }),
    db.proyek.findMany({ orderBy: { kode: "asc" }, select: { id: true, kode: true, nama: true, status: true } }),
    db.aksesBerkasProyek.findMany({
      select: { proyekId: true, peranBoleh: true, diubahPada: true, proyek: { select: { kode: true, nama: true } }, _count: { select: { pengguna: true } } },
      orderBy: { proyek: { kode: "asc" } },
    }),
  ]);
  const jumlahFolder = new Map(hitunganFolder.map((h) => [h.folderKode, h._count._all]));
  const proyekPilih = semuaProyek.find((p) => p.id === proyekParam) ?? null;
  const [akses, penggunaAktif] = proyekPilih
    ? await Promise.all([
        db.aksesBerkasProyek.findUnique({ where: { proyekId: proyekPilih.id }, select: { peranBoleh: true, pengguna: { select: { penggunaId: true } } } }),
        db.pengguna.findMany({ where: { aktif: true }, orderBy: [{ nama: "asc" }, { id: "asc" }], select: { id: true, nama: true, peran: true, peranTambahan: true } }),
      ])
    : [null, []];
  const penggunaTerpilih = new Set(akses?.pengguna.map((p) => p.penggunaId) ?? []);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Administrasi" }, { label: "Pengaturan" }]}
        judul="Akses Berkas"
        subjudul="Folder dan proyek yang dibatasi tidak terlihat oleh peran lain: berkasnya tidak muncul di Berkas, pencarian, lampiran, maupun log aktivitas. Pemilik dan Superadmin selalu punya akses."
        lencana={
          <span className="lencana lencana-slate">
            Terpakai {MB(penyimpanan.totalByte)} MB · {penyimpanan.jumlah.toLocaleString("id-ID")} berkas
          </span>
        }
        aksi={
          <Link href="/berkas" className="tombol tombol-garis">
            <Ikon nama="folder" className="!text-[18px]" />
            Berkas
          </Link>
        }
      />

      <section className="kartu space-y-4" aria-labelledby="judul-akses-folder">
        <div>
          <h2 id="judul-akses-folder" className="judul-kartu">
            Akses folder per peran
          </h2>
          <p className="text-sm text-slate-500 mt-1">Centang Terbatas untuk menyembunyikan isi folder, lalu pilih peran yang tetap boleh membukanya.</p>
        </div>
        <FormulirAksi aksi={simpanAksesFolderFormulir} pesanSukses="Akses folder tersimpan." className="space-y-4">
          <div className="bungkus-tabel">
            <table className="tabel-polos min-w-[56rem]">
              <thead>
                <tr>
                  <th>Folder</th>
                  <th className="text-center">Terbatas</th>
                  {PERAN_DAPAT_DIATUR.map((p) => (
                    <th key={p} className="text-center text-xs">
                      {LABEL_PERAN[p]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {folder.map((f) => (
                  <tr key={f.kode}>
                    <td>
                      <input type="hidden" name="folderDirender" value={f.kode} />
                      <span className="font-medium text-slate-900">{f.nama}</span>
                      {f.sistem && <span className="lencana lencana-slate ml-2">Folder sistem</span>}
                      {f.terbatas && f.peranBoleh.length === 0 && <span className="block text-xs text-amber-700">Hanya Pemilik dan Superadmin</span>}
                    </td>
                    <td className="text-center">
                      <input type="checkbox" name={`terbatas|${f.kode}`} defaultChecked={f.terbatas} aria-label={`${f.nama} terbatas`} className="h-4 w-4 rounded border-slate-300" />
                    </td>
                    {PERAN_DAPAT_DIATUR.map((p) => (
                      <td key={p} className="text-center">
                        <input
                          type="checkbox"
                          name={`peran|${f.kode}`}
                          value={p}
                          defaultChecked={f.peranBoleh.includes(p)}
                          aria-label={`${f.nama} untuk ${LABEL_PERAN[p]}`}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="petunjuk">Peran yang dicentang hanya berlaku bila folder Terbatas. Pemilik dan Superadmin selalu bisa membuka semua folder.</p>
          <button type="submit" className="tombol tombol-utama w-fit">
            <Ikon nama="lock" className="!text-[18px]" />
            Simpan akses folder
          </button>
        </FormulirAksi>
      </section>

      <section className="kartu space-y-4" aria-labelledby="judul-folder">
        <h2 id="judul-folder" className="judul-kartu">
          Folder
        </h2>
        <FormulirAksi aksi={buatFolderBerkasFormulir} pesanSukses="Folder ditambahkan." className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="folder-baru" className="label">
              Tambah folder
            </label>
            <input id="folder-baru" name="nama" required maxLength={PANJANG_NAMA_FOLDER} placeholder="Nama folder" className="isian w-64" />
          </div>
          <button type="submit" className="tombol tombol-utama">
            <Ikon nama="add" className="!text-[18px]" />
            Tambah
          </button>
        </FormulirAksi>
        <div className="bungkus-tabel">
          <table className="tabel-polos min-w-[36rem]">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Kode</th>
                <th className="text-right">Berkas</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {folder.map((f) => (
                <tr key={f.kode}>
                  <td>
                    <FormulirAksi aksi={ubahFolderBerkasFormulir.bind(null, f.kode)} className="flex items-center gap-2">
                      <input name="nama" defaultValue={f.nama} required maxLength={PANJANG_NAMA_FOLDER} aria-label={`Nama folder ${f.nama}`} className="isian isian-kecil w-56" />
                      <button type="submit" className="tombol tombol-garis tombol-kecil">
                        <Ikon nama="drive_file_rename_outline" className="!text-[16px]" />
                        Ganti nama
                      </button>
                    </FormulirAksi>
                  </td>
                  <td className="mono text-xs text-slate-500">
                    {f.kode}
                    {f.sistem && <span className="lencana lencana-slate ml-2">Folder sistem</span>}
                  </td>
                  <td className="text-right angka">{(jumlahFolder.get(f.kode) ?? 0).toLocaleString("id-ID")}</td>
                  <td className="text-right">
                    {!f.sistem && (
                      <FormulirAksi aksi={hapusFolderBerkasFormulir.bind(null, f.kode)} pesanKonfirmasi={`Hapus folder ${f.nama}? Folder harus kosong.`}>
                        <button type="submit" className="tombol-tautan-bahaya">
                          <Ikon nama="delete" className="!text-[16px] align-[-3px]" /> Hapus
                        </button>
                      </FormulirAksi>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="kartu space-y-4" aria-labelledby="judul-akses-proyek">
        <div>
          <h2 id="judul-akses-proyek" className="judul-kartu">
            Akses berkas per proyek
          </h2>
          <p className="text-sm text-slate-500 mt-1">Semua berkas proyek yang dibatasi, termasuk lampiran dokumen, hanya terbuka bagi peran dan pengguna yang dipilih.</p>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="pilih-proyek" className="label">
              Proyek/Event
            </label>
            <select id="pilih-proyek" name="proyek" defaultValue={proyekPilih?.id ?? ""} className="isian w-72">
              <option value="">Pilih proyek</option>
              {semuaProyek.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.kode} · {p.nama}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="tombol tombol-garis">
            Pilih
          </button>
        </form>

        {proyekPilih && (
          <div className="rounded-lg border border-slate-200 p-4 space-y-4">
            <p className="text-sm font-semibold text-slate-900">
              <span className="mono">{proyekPilih.kode}</span> · {proyekPilih.nama}
              {akses ? <span className="lencana lencana-amber ml-2">Terbatas</span> : <span className="lencana lencana-slate ml-2">Terbuka</span>}
            </p>
            <FormulirAksi key={proyekPilih.id} aksi={simpanAksesBerkasProyekFormulir.bind(null, proyekPilih.id)} pesanSukses="Pembatasan proyek tersimpan." className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="label">Peran</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {PERAN_DAPAT_DIATUR.map((p) => (
                    <label key={p} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="peran" value={p} defaultChecked={akses?.peranBoleh.includes(p) ?? false} className="h-4 w-4 rounded border-slate-300" />
                      {LABEL_PERAN[p]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="label">Pengguna</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-72 overflow-y-auto">
                  {penggunaAktif.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="pengguna" value={u.id} defaultChecked={penggunaTerpilih.has(u.id)} className="h-4 w-4 rounded border-slate-300" />
                      <span className="min-w-0">
                        {u.nama} <span className="text-xs text-slate-500">· {labelPeranPengguna(u)}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="petunjuk">Tidak ada yang dipilih: hanya Pemilik dan Superadmin yang bisa membuka berkas proyek ini.</p>
              <button type="submit" className="tombol tombol-utama w-fit">
                <Ikon nama="lock" className="!text-[18px]" />
                Simpan pembatasan
              </button>
            </FormulirAksi>
            {akses && (
              <FormulirAksi aksi={bukaPembatasanProyekFormulir.bind(null, proyekPilih.id)} pesanSukses="Pembatasan proyek dibuka.">
                <button type="submit" className="tombol tombol-garis w-fit">
                  Buka pembatasan
                </button>
              </FormulirAksi>
            )}
          </div>
        )}

        <div className="space-y-2">
          <h3 className="teks-label">Proyek terbatas</h3>
          <div className="bungkus-tabel">
            <table className="tabel-polos min-w-[40rem]">
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Nama</th>
                  <th>Peran</th>
                  <th className="text-right">Pengguna</th>
                  <th>Diubah</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {terbatas.map((a) => (
                  <tr key={a.proyekId}>
                    <td className="mono">{a.proyek.kode}</td>
                    <td>{a.proyek.nama}</td>
                    <td className="text-xs">{daftarPeran(a.peranBoleh)}</td>
                    <td className="text-right angka">{a._count.pengguna.toLocaleString("id-ID")}</td>
                    <td className="whitespace-nowrap text-slate-500">{formatTanggal(a.diubahPada)}</td>
                    <td className="text-right">
                      <Link href={`/pengaturan/berkas?proyek=${a.proyekId}`} className="tombol-tautan">
                        Atur
                      </Link>
                    </td>
                  </tr>
                ))}
                {terbatas.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-sm text-slate-400">
                      Belum ada proyek yang dibatasi.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="kartu space-y-2" aria-labelledby="judul-penyimpanan">
        <h2 id="judul-penyimpanan" className="judul-kartu">
          Penyimpanan
        </h2>
        <p className="text-sm text-slate-600">
          Berkas disimpan di basis data PostgreSQL dan ikut cadangan harian (30 salinan penuh). Batas 25 MB per berkas. Isi berkas di Sampah baru dibuang saat dihapus permanen.
        </p>
      </section>
    </div>
  );
}
