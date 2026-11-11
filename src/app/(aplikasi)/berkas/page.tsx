import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { bacaParamDaftar } from "@/lib/daftar";
import { daftarPerusahaan, lingkupPerusahaan } from "@/lib/perusahaan";
import { semuaHrefMenu } from "@/lib/menu";
import { formatTanggal } from "@/lib/waktu";
import {
  FOLDER_BAWAAN,
  bolehAksesBerkas,
  daftarBerkasTerlihat,
  daftarFolderTerlihat,
  ekstensiNama,
  jenisLampiran,
  keluargaDariMime,
  ruangTersembunyi,
  type BarisBerkas,
} from "@/lib/berkas";
import { buangBerkasFormulir, hapusPermanenBerkasFormulir, pulihkanBerkasFormulir, ubahBerkasFormulir } from "@/lib/aksi/berkas";
import FormulirAksi from "@/komponen/FormulirAksi";
import Ikon from "@/komponen/ui/Ikon";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import IkonBerkas, { ukuranBerkas } from "@/komponen/berkas/IkonBerkas";
import DialogPratinjauGambar from "@/komponen/berkas/DialogPratinjauGambar";
import FormulirTautanBagi, { type TautanAktifBerkas } from "@/komponen/berkas/FormulirTautanBagi";
import PemilihBerkas from "@/komponen/berkas/PemilihBerkas";
import { NamaBerkas, petaTautanAktif } from "@/komponen/berkas/LampiranBerkas";

const UKURAN_HALAMAN_BERKAS = 20;

type ParamMentah = Record<string, string | string[] | undefined>;
const satu = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v ?? "").trim();

/** Query string /berkas dari pasangan yang terisi. */
function tautanBerkas(isian: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(isian)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `/berkas?${s}` : "/berkas";
}

/** Halaman Berkas (D7 §7.2): folder terlihat, unggah umum, daftar berkas dengan aksi per baris, dan Sampah. */
export default async function HalamanBerkas({ searchParams }: { searchParams: Promise<ParamMentah> }) {
  const pengguna = await wajibHak("berkas.lihat");
  const param = await bacaParamDaftar(searchParams, UKURAN_HALAMAN_BERKAS);
  const mentah = await searchParams;
  const lingkup = await lingkupPerusahaan();
  const perusahaanId = lingkup.perusahaanId;

  const [folder, ruang, semuaProyek] = await Promise.all([
    daftarFolderTerlihat(db, pengguna, { perusahaanId }),
    ruangTersembunyi(db, pengguna),
    db.proyek.findMany({ where: { status: { not: "BATAL" } }, orderBy: { kode: "asc" }, select: { id: true, kode: true, nama: true, perusahaanId: true } }),
  ]);
  const proyekTerlihat = semuaProyek.filter((p) => !ruang || !ruang.proyek.includes(p.id));
  const proyekLingkup = proyekTerlihat.filter((p) => !perusahaanId || p.perusahaanId === perusahaanId);

  const sampah = satu(mentah.tampil) === "sampah";
  const sorot = satu(mentah.sorot);
  const folderParam = satu(mentah.folder);
  const folderAktif = folder.find((f) => f.kode === folderParam) ?? null;
  const proyekParam = satu(mentah.proyek);
  const proyekAktif = proyekParam === "tanpa" ? "tanpa" : (proyekTerlihat.find((p) => p.id === proyekParam)?.id ?? "");

  const { total, baris } = await daftarBerkasTerlihat(
    db,
    pengguna,
    sorot
      ? { id: sorot }
      : {
          folderKode: folderAktif?.kode,
          proyekId: proyekAktif === "tanpa" ? null : proyekAktif || undefined,
          q: param.q,
          perusahaanId,
          sampah,
        },
    { lewati: sorot ? 0 : param.lewati, ambil: param.ambil },
  );

  // "Menempel di": label entitas bertaut, atau "(sudah dihapus)" untuk lampiran yatim (D7 §3.3.15)
  const hrefMenu = new Set(semuaHrefMenu());
  const entitas = await Promise.all(
    baris.map(async (b) => {
      const j = jenisLampiran(b.jenisEntitas);
      if (!j || !b.entitasId) return null;
      const info = await j.baca(db, b.entitasId);
      const href = info ? j.tautan(b.entitasId, info) : null;
      // tautan hanya dirender bila rutenya sudah ada di menu (G19)
      return { label: j.label, nama: info?.label ?? null, href: href && hrefMenu.has(href.split("?")[0]) ? href : null };
    }),
  );
  const tautanAktif = sampah ? new Map<string, TautanAktifBerkas[]>() : await petaTautanAktif(pengguna, baris);

  const bolehUnggah = bolehAksesBerkas(pengguna, { jenisEntitas: null }, "unggah");
  const aksesPenuh = punyaHak(pengguna, "berkas.akses-penuh");
  const perusahaan = perusahaanId ? null : await daftarPerusahaan();
  const folderAwal = folderAktif?.kode ?? (folder.some((f) => f.kode === FOLDER_BAWAAN) ? FOLDER_BAWAAN : folder[0]?.kode);
  const tambahan = { folder: folderAktif?.kode, proyek: proyekAktif || undefined, tampil: sampah ? "sampah" : undefined };

  const kelasFolder = (aktif: boolean) => `flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm ${aktif ? "bg-blue-50 text-blue-800 font-semibold" : "text-slate-700 hover:bg-slate-50"}`;

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Berkas" }]}
        judul="Berkas"
        subjudul="Lampiran dokumen, konten, desain, materi iklan, dan bukti biaya. Disimpan di server Produksia dan ikut cadangan harian."
        aksi={
          aksesPenuh ? (
            <Link href="/pengaturan/berkas" className="tombol tombol-garis">
              <Ikon nama="lock" className="!text-[18px]" />
              Akses Berkas
            </Link>
          ) : undefined
        }
      />

      {bolehUnggah && !sampah && (
        <details className="kartu">
          <summary className="flex items-center gap-2 cursor-pointer font-semibold text-slate-900">
            <Ikon nama="upload" className="!text-[20px] text-blue-600" />
            Unggah berkas
          </summary>
          <div className="mt-4">
            <PemilihBerkas
              folder={folder.map((f) => ({ kode: f.kode, nama: f.nama }))}
              folderAwal={folderAwal}
              proyek={proyekLingkup}
              perusahaan={perusahaan?.map((p) => ({ id: p.id, nama: p.nama }))}
              perusahaanWajib={!perusahaanId}
            />
          </div>
        </details>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <nav className="kartu lg:col-span-3 space-y-1 self-start" aria-label="Folder berkas">
          <Link href="/berkas" className={kelasFolder(!folderAktif && !sampah && !sorot)}>
            <Ikon nama={!folderAktif && !sampah && !sorot ? "folder_open" : "folder"} className="!text-[20px]" />
            <span className="flex-1">Semua berkas</span>
          </Link>
          {folder.map((f) => {
            const aktif = folderAktif?.kode === f.kode && !sampah;
            return (
              <Link key={f.kode} href={tautanBerkas({ folder: f.kode })} className={kelasFolder(aktif)}>
                <Ikon nama={aktif ? "folder_open" : "folder"} className="!text-[20px]" />
                <span className="flex-1 min-w-0 truncate">{f.nama}</span>
                {f.terbatas && <Ikon nama="lock" className="!text-[16px] text-slate-400" />}
                <span className="mono text-[11px] text-slate-500">{f.jumlah.toLocaleString("id-ID")}</span>
              </Link>
            );
          })}
          <hr className="my-2 border-slate-100" />
          <Link href="/berkas?tampil=sampah" className={kelasFolder(sampah)}>
            <Ikon nama="delete" className="!text-[20px]" />
            <span className="flex-1">Sampah</span>
          </Link>
        </nav>

        <div className="lg:col-span-9 space-y-3 min-w-0">
          {sorot && baris.length > 0 && (
            <p role="status" className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
              Menampilkan 1 berkas dari pencarian.{" "}
              <Link href="/berkas" className="font-semibold underline">
                Tampilkan semua
              </Link>
            </p>
          )}
          {sampah && (
            <p role="status" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Berkas di Sampah tidak tampil di daftar dan lampiran. Tautan bagi berkas yang dibuang sudah dicabut.
            </p>
          )}
          <div className="kartu kartu-tabel">
            <KontrolDaftar param={param} total={total} placeholder="Cari nama berkas…" tambahan={tambahan} />
            {!sampah && !sorot && (
              <form method="get" className="flex flex-wrap items-center gap-2 px-5 md:px-6 py-3 border-b border-slate-100">
                {folderAktif && <input type="hidden" name="folder" value={folderAktif.kode} />}
                {param.q && <input type="hidden" name="q" value={param.q} />}
                <label htmlFor="saring-proyek" className="text-xs text-slate-500">
                  Proyek
                </label>
                <select id="saring-proyek" name="proyek" defaultValue={proyekAktif} className="isian isian-kecil max-w-xs">
                  <option value="">Semua proyek</option>
                  <option value="tanpa">Tanpa proyek</option>
                  {proyekLingkup.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.kode} · {p.nama}
                    </option>
                  ))}
                </select>
                <button type="submit" className="tombol tombol-garis tombol-kecil">
                  Terapkan
                </button>
              </form>
            )}
            <div className="bungkus-tabel">
              {sampah ? (
                <table className="tabel min-w-[44rem]">
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Folder</th>
                      <th>Dibuang</th>
                      <th className="th-lekat" />
                    </tr>
                  </thead>
                  <tbody>
                    {baris.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <span className="flex items-start gap-2">
                            <IkonBerkas tipeMime={b.tipeMime} />
                            <span className="font-medium text-slate-900 break-all">{b.namaBerkas}</span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap">{b.folder.nama}</td>
                        <td className="whitespace-nowrap text-slate-500">
                          {b.dihapusPada ? formatTanggal(b.dihapusPada) : "-"} · {b.dihapusOlehNama ?? "-"}
                        </td>
                        <td className="td-lekat whitespace-nowrap space-x-3">
                          {bolehAksesBerkas(pengguna, b, "hapus") && (
                            <FormulirAksi aksi={pulihkanBerkasFormulir.bind(null, b.id)} className="inline-block">
                              <button type="submit" className="tombol-tautan">
                                <Ikon nama="restore_from_trash" className="!text-[16px] align-[-3px]" /> Pulihkan
                              </button>
                            </FormulirAksi>
                          )}
                          {aksesPenuh && (
                            <FormulirAksi
                              aksi={hapusPermanenBerkasFormulir.bind(null, b.id)}
                              className="inline-block"
                              pesanKonfirmasi={`Hapus permanen ${b.namaBerkas}? Isi berkas dibuang dan tidak bisa dipulihkan.`}
                            >
                              <button type="submit" className="tombol-tautan-bahaya">
                                <Ikon nama="delete_forever" className="!text-[16px] align-[-3px]" /> Hapus permanen
                              </button>
                            </FormulirAksi>
                          )}
                        </td>
                      </tr>
                    ))}
                    {baris.length === 0 && (
                      <tr>
                        <td colSpan={4} className="kosong">
                          {param.q ? "Tidak ada berkas yang cocok dengan pencarian." : "Sampah kosong."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : (
                <table className="tabel min-w-[60rem]">
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Menempel di</th>
                      <th>Proyek</th>
                      <th>Folder</th>
                      <th className="text-right">Ukuran</th>
                      <th>Diunggah</th>
                      <th className="th-lekat" />
                    </tr>
                  </thead>
                  <tbody>
                    {baris.map((b, i) => {
                      const e = entitas[i];
                      return (
                        <tr key={b.id} className="align-top">
                          <td>
                            <span className="flex items-start gap-2">
                              <IkonBerkas tipeMime={b.tipeMime} />
                              <NamaBerkas b={b} />
                            </span>
                          </td>
                          <td className="text-slate-600">
                            {!e ? (
                              "-"
                            ) : (
                              <>
                                <span className="text-xs text-slate-500">{e.label}</span>{" "}
                                {e.nama === null ? (
                                  <span className="text-rose-600">(sudah dihapus)</span>
                                ) : e.href ? (
                                  <Link href={e.href} className="tombol-tautan">
                                    {e.nama}
                                  </Link>
                                ) : (
                                  <span>{e.nama}</span>
                                )}
                              </>
                            )}
                          </td>
                          <td className="mono whitespace-nowrap">{b.proyek?.kode ?? "-"}</td>
                          <td className="whitespace-nowrap">{b.folder.nama}</td>
                          <td className="text-right whitespace-nowrap angka">{ukuranBerkas(b.ukuran)}</td>
                          <td className="whitespace-nowrap text-slate-500">
                            {formatTanggal(b.dibuatPada)} · {b.diunggahOlehNama}
                          </td>
                          <td className="td-lekat">
                            <AksiBaris
                              b={b}
                              bolehUbah={bolehAksesBerkas(pengguna, b, "ubah")}
                              bolehBagikan={bolehAksesBerkas(pengguna, b, "bagikan")}
                              bolehBuang={bolehAksesBerkas(pengguna, b, "hapus")}
                              folder={folder}
                              proyek={proyekTerlihat.filter((p) => p.perusahaanId === b.perusahaanId)}
                              tautanAktif={tautanAktif.get(b.id) ?? []}
                            />
                          </td>
                        </tr>
                      );
                    })}
                    {baris.length === 0 && (
                      <tr>
                        <td colSpan={7} className="kosong">
                          {param.q || proyekAktif || sorot ? (
                            "Tidak ada berkas yang cocok dengan pencarian."
                          ) : (
                            <>
                              Belum ada berkas di sini.
                              <span className="block mt-1 text-xs">Unggahan dari dokumen, konten, dan tugas desain juga muncul di halaman ini.</span>
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Tombol per baris; tiap tombol hanya tampil bila bolehAksesBerkas untuk aksinya (D7 §7.2 no. 3). */
function AksiBaris({
  b,
  bolehUbah,
  bolehBagikan,
  bolehBuang,
  folder,
  proyek,
  tautanAktif,
}: {
  b: BarisBerkas;
  bolehUbah: boolean;
  bolehBagikan: boolean;
  bolehBuang: boolean;
  folder: { kode: string; nama: string }[];
  proyek: { id: string; kode: string; nama: string }[];
  tautanAktif: TautanAktifBerkas[];
}) {
  const keluarga = keluargaDariMime(b.tipeMime);
  const ekstensi = ekstensiNama(b.namaBerkas);
  const namaTanpaEkstensi = ekstensi ? b.namaBerkas.slice(0, -(ekstensi.length + 1)) : b.namaBerkas;
  // pilihan folder dan proyek selalu memuat nilai sekarang, walau proyeknya sudah batal
  const pilihanFolder = folder.some((f) => f.kode === b.folderKode) ? folder : [{ kode: b.folderKode, nama: b.folder.nama }, ...folder];
  const pilihanProyek = !b.proyekId || proyek.some((p) => p.id === b.proyekId) ? proyek : [{ id: b.proyekId, kode: b.proyek?.kode ?? "", nama: b.proyek?.nama ?? "" }, ...proyek];

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 whitespace-nowrap">
        {keluarga === "gambar" && <DialogPratinjauGambar id={b.id} nama={b.namaBerkas} />}
        {keluarga === "pdf" && (
          <a href={`/api/berkas/${b.id}`} target="_blank" rel="noopener noreferrer" className="tombol-tautan">
            <Ikon nama="open_in_new" className="!text-[16px] align-[-3px]" /> Buka
          </a>
        )}
        <a href={`/api/berkas/${b.id}?unduh=1`} className="tombol-tautan">
          <Ikon nama="download" className="!text-[16px] align-[-3px]" /> Unduh
        </a>
        {bolehBuang && (
          <FormulirAksi aksi={buangBerkasFormulir.bind(null, b.id)} className="inline-block" pesanKonfirmasi={`Buang ${b.namaBerkas} ke Sampah?`}>
            <button type="submit" className="tombol-tautan-bahaya">
              <Ikon nama="delete" className="!text-[16px] align-[-3px]" /> Buang
            </button>
          </FormulirAksi>
        )}
      </div>
      {bolehBagikan && (
        <details className="w-full text-right">
          <summary className="tombol-tautan cursor-pointer list-none">
            <Ikon nama="share" className="!text-[16px] align-[-3px]" /> Bagikan
          </summary>
          <div className="mt-2 w-80 ml-auto">
            <FormulirTautanBagi berkasId={b.id} tautanAktif={tautanAktif} />
          </div>
        </details>
      )}
      {bolehUbah && (
        <details className="w-full text-right">
          <summary className="tombol-tautan cursor-pointer list-none">
            <Ikon nama="drive_file_rename_outline" className="!text-[16px] align-[-3px]" /> Ubah
          </summary>
          <FormulirAksi aksi={ubahBerkasFormulir.bind(null, b.id)} pesanSukses="Perubahan berkas disimpan." className="mt-2 w-80 ml-auto space-y-3 text-left whitespace-normal">
            <div className="space-y-1">
              <label htmlFor={`nama-${b.id}`} className="label">
                Nama
              </label>
              <div className="flex items-center gap-1">
                <input id={`nama-${b.id}`} name="namaBerkas" defaultValue={namaTanpaEkstensi} maxLength={200} className="isian isian-kecil flex-1 min-w-0" />
                {ekstensi && <span className="mono text-xs text-slate-500">.{ekstensi}</span>}
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor={`folder-${b.id}`} className="label">
                Folder
              </label>
              <select id={`folder-${b.id}`} name="folderKode" defaultValue={b.folderKode} className="isian isian-kecil">
                {pilihanFolder.map((f) => (
                  <option key={f.kode} value={f.kode}>
                    {f.nama}
                  </option>
                ))}
              </select>
            </div>
            {!b.jenisEntitas && (
              <div className="space-y-1">
                <label htmlFor={`proyek-${b.id}`} className="label">
                  Proyek/Event
                </label>
                <select id={`proyek-${b.id}`} name="proyekId" defaultValue={b.proyekId ?? ""} className="isian isian-kecil">
                  <option value="">Tanpa proyek</option>
                  {pilihanProyek.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.kode} · {p.nama}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button type="submit" className="tombol tombol-utama tombol-kecil">
              Simpan
            </button>
          </FormulirAksi>
        </details>
      )}
    </div>
  );
}
