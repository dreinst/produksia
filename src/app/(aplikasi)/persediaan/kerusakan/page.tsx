import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { daftarProyekAktif } from "@/lib/proyek";
import { formatWaktu } from "@/lib/waktu";
import {
  buatLaporanKerusakanFormulir,
  hapusFotoKerusakanFormulir,
  tautkanPenyesuaianKerusakanFormulir,
  ubahLaporanKerusakanFormulir,
  unggahFotoKerusakanFormulir,
} from "@/lib/aksi/kerusakan";
import FormulirAksi from "@/komponen/FormulirAksi";
import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import PemilihFoto from "@/komponen/ui/PemilihFoto";
import { NomorDokumen } from "@/komponen/ui/Lencana";
import { SelPersetujuan } from "@/komponen/KontrolPersetujuan";
import EditorBarisPeminjaman, { PemilihGudang } from "@/komponen/persediaan/EditorBarisPeminjaman";

const SERTAKAN = {
  baris: { include: { barang: { select: { kode: true, nama: true, satuan: true } } } },
  foto: { select: { id: true }, orderBy: { dibuatPada: "asc" as const } },
  proyek: { select: { nama: true } },
};

type Foto = { id: string };

function TautanFoto({ foto }: { foto: Foto[] }) {
  if (foto.length === 0) return <span className="text-slate-400">-</span>;
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
      {foto.map((f, i) => (
        <a key={f.id} href={`/api/foto/${f.id}`} target="_blank" rel="noopener" className="tombol-tautan whitespace-nowrap">
          Foto {i + 1}
        </a>
      ))}
    </span>
  );
}

type Proyek = { id: string; kode: string; nama: string };

/** Pilihan event opsional; disembunyikan bila belum ada proyek aktif. */
function PilihanProyek({ id, daftarProyek, nilai }: { id: string; daftarProyek: Proyek[]; nilai?: string | null }) {
  if (daftarProyek.length === 0) return null;
  return (
    <div className="bidang">
      <label className="label" htmlFor={id}>Event / proyek</label>
      <select id={id} name="proyekId" className="isian min-h-11" defaultValue={nilai ?? ""}>
        <option value="">-</option>
        {daftarProyek.map((p) => (
          <option key={p.id} value={p.id}>{p.kode} - {p.nama}</option>
        ))}
      </select>
    </div>
  );
}

type DokumenUbah = { id: string; namaPelapor: string; proyekId: string | null; keterangan: string | null };

/** Ubah metadata (bukan jumlah barang, tidak menyentuh stok): boleh selama tidak MENUNGGU. */
function FormUbahData({ p, daftarProyek }: { p: DokumenUbah; daftarProyek: Proyek[] }) {
  return (
    <details className="pt-1">
      <summary className="cursor-pointer text-xs font-semibold text-slate-600 py-3.5">Ubah data</summary>
      <FormulirAksi aksi={ubahLaporanKerusakanFormulir.bind(null, p.id)} pesanSukses="Perubahan disimpan." className="space-y-3 mt-2">
        <div className="bidang">
          <label className="label" htmlFor={`ubah-nama-${p.id}`}>Nama pelapor *</label>
          <input id={`ubah-nama-${p.id}`} name="namaPelapor" required defaultValue={p.namaPelapor} className="isian min-h-11" />
        </div>
        <PilihanProyek id={`ubah-proyek-${p.id}`} daftarProyek={daftarProyek} nilai={p.proyekId} />
        <div className="bidang">
          <label className="label" htmlFor={`ubah-ket-${p.id}`}>Jenis / penyebab kerusakan</label>
          <input id={`ubah-ket-${p.id}`} name="keterangan" defaultValue={p.keterangan ?? ""} className="isian min-h-11" />
        </div>
        <button type="submit" className="tombol tombol-garis w-full min-h-11">Simpan perubahan</button>
      </FormulirAksi>
    </details>
  );
}

export default async function HalamanKerusakanBarang({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("kerusakan.lihat");
  const bolehBuat = punyaHak(pengguna, "kerusakan.buat");
  const bolehHapus = punyaHak(pengguna, "kerusakan.hapus");
  const bolehTautkan = punyaHak(pengguna, "penyesuaian.setujui");
  const param = await bacaParamDaftar(searchParams);
  const paramGudang = (await searchParams).gudang;
  const gudangDipilih = Array.isArray(paramGudang) ? paramGudang[0] : paramGudang;

  const whereRiwayat = {
    statusPersetujuan: "DISETUJUI" as const,
    ...(param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { namaPelapor: cocokTeks(param.q) }, { keterangan: cocokTeks(param.q) }] } : {}),
  };
  const [daftarGudang, daftarProyek, daftarBarang, daftarStok, diajukan, totalRiwayat, riwayat, daftarPs] = await Promise.all([
    db.gudang.findMany({ orderBy: { kode: "asc" }, select: { id: true, kode: true, nama: true } }),
    daftarProyekAktif(),
    db.barang.findMany({ where: { jenis: "BARANG" }, orderBy: { kode: "asc" }, select: { id: true, kode: true, nama: true, satuan: true, warna: true } }),
    db.stokBarang.findMany({ select: { gudangId: true, barangId: true, jumlah: true } }),
    db.laporanKerusakanBarang.findMany({ where: { statusPersetujuan: { in: ["DRAFT", "MENUNGGU", "DITOLAK"] } }, include: SERTAKAN, orderBy: { waktuLapor: "desc" } }),
    db.laporanKerusakanBarang.count({ where: whereRiwayat }),
    db.laporanKerusakanBarang.findMany({ where: whereRiwayat, include: SERTAKAN, orderBy: { waktuLapor: "desc" }, skip: param.lewati, take: param.ambil }),
    bolehTautkan ? db.penyesuaianPersediaan.findMany({ where: { statusPersetujuan: "DISETUJUI" }, select: { id: true, nomor: true, gudangId: true, keterangan: true }, orderBy: { nomor: "desc" } }) : Promise.resolve([]),
  ]);

  const gudangId = daftarGudang.find((g) => g.id === gudangDipilih)?.id ?? daftarGudang[0]?.id ?? "";
  const stokGudang = new Map(daftarStok.filter((s) => s.gudangId === gudangId).map((s) => [s.barangId, Number(s.jumlah)]));
  const barangEditor = daftarBarang.map((b) => ({ ...b, tersedia: stokGudang.get(b.id) ?? 0 }));

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Persediaan" }, { label: "Stok per Gudang", href: "/persediaan" }]}
        judul="Laporan Kerusakan Barang"
        subjudul="Barang yang tidak bisa dipakai/dijual lagi. Stok baru berkurang PERMANEN setelah Gudang menyetujui laporan; tidak ada alur kembali."
      />

      {bolehBuat && (
        <div className="kartu">
          <div className="kepala-kartu">
            <h2 className="judul-kartu">Lapor barang rusak</h2>
          </div>
          {daftarGudang.length === 0 ? (
            <p className="redup">Belum ada gudang. Tambahkan gudang di Data Induk terlebih dulu.</p>
          ) : (
            <FormulirAksi aksi={buatLaporanKerusakanFormulir} pesanSukses="Dicatat sebagai draf. Klik “Ajukan” di bawah untuk mengirimnya ke Gudang." className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {daftarGudang.length > 1 ? (
                  <div className="bidang">
                    <label className="label" htmlFor="gudangId">Gudang *</label>
                    <PemilihGudang daftarGudang={daftarGudang} gudangId={gudangId} />
                  </div>
                ) : (
                  <input type="hidden" name="gudangId" value={gudangId} />
                )}
                <div className="bidang">
                  <label className="label" htmlFor="namaPelapor">Nama pelapor *</label>
                  <input id="namaPelapor" name="namaPelapor" required className="isian min-h-11" placeholder="Nama kru/staf yang melapor" />
                </div>
                <PilihanProyek id="proyekId" daftarProyek={daftarProyek} />
                <div className="bidang">
                  <label className="label" htmlFor="keterangan">Jenis / penyebab kerusakan</label>
                  <input id="keterangan" name="keterangan" className="isian min-h-11" placeholder="mis. Basah kehujanan, jatuh saat loading" />
                </div>
              </div>
              <EditorBarisPeminjaman daftarBarang={barangEditor} labelJumlah="Jumlah rusak" />
              <div className="bidang">
                <span className="label">Foto bukti kondisi rusak *</span>
                <PemilihFoto name="foto" maksimal={3} wajib label="Ambil foto barang rusak" />
                <span className="petunjuk">Maksimal 3 foto, dikompresi otomatis di HP.</span>
              </div>
              <button type="submit" className="tombol tombol-utama w-full min-h-11">Catat</button>
            </FormulirAksi>
          )}
        </div>
      )}

      <div className="kartu">
        <div className="kepala-kartu">
          <h2 className="judul-kartu">Menunggu persetujuan</h2>
          <span className="text-xs text-slate-500">{diajukan.length} laporan</span>
        </div>
        {diajukan.length === 0 ? (
          <p className="redup">Tidak ada laporan yang menunggu.</p>
        ) : (
          <div className="space-y-4">
            {diajukan.map((k) => (
              <div key={k.id} className="rounded-xl border border-slate-200 p-4 space-y-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <NomorDokumen nomor={k.nomor} />
                    <span className="text-slate-600">
                      <span className="font-medium text-slate-900">{k.namaPelapor}</span>
                      {k.proyek && <> · {k.proyek.nama}</>}
                    </span>
                  </div>
                  <SelPersetujuan
                    jenis="kerusakan"
                    kode="kerusakan"
                    id={k.id}
                    nomor={k.nomor}
                    status={k.statusPersetujuan}
                    diajukanOlehId={k.diajukanOlehId}
                    pengguna={pengguna}
                    catatanPenolakan={k.catatanPenolakan}
                  />
                </div>
                {k.keterangan && <div className="text-xs text-slate-500">{k.keterangan}</div>}
                <ul className="space-y-0.5">
                  {k.baris.map((b) => (
                    <li key={b.id}>
                      <span className="mono">{b.barang.kode}</span> <span className="text-slate-700">({b.barang.nama})</span>{" "}
                      <span className="angka">{Number(b.jumlah).toLocaleString("id-ID")}</span> {b.barang.satuan}
                    </li>
                  ))}
                </ul>
                <TautanFoto foto={k.foto} />
                {bolehBuat && k.statusPersetujuan !== "MENUNGGU" && <FormUbahData p={k} daftarProyek={daftarProyek} />}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="kartu kartu-tabel">
        <div className="kepala-kartu">
          <h2 className="judul-kartu">Riwayat</h2>
        </div>
        <KontrolDaftar param={param} total={totalRiwayat} placeholder="Cari nomor / pelapor / keterangan…" tambahan={{ gudang: gudangDipilih }} />

        {/* Mobile (< md): kartu per dokumen */}
        <div className="md:hidden divide-y divide-slate-100">
          {riwayat.map((k) => (
            <div key={k.id} className="p-4 space-y-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <NomorDokumen nomor={k.nomor} />
                {k.penyesuaianId && <span className="lencana lencana-slate">Ditautkan</span>}
              </div>
              <div className="text-slate-600">
                {formatWaktu(k.waktuLapor)} · <span className="font-medium text-slate-900">{k.namaPelapor}</span>
                {k.proyek && <> · {k.proyek.nama}</>}
              </div>
              {k.keterangan && <div className="text-xs text-slate-500">{k.keterangan}</div>}
              <div className="text-xs text-slate-500">
                {k.baris.map((b) => (
                  <span key={b.id} className="inline-block mr-2 whitespace-nowrap">
                    <span className="mono">{b.barang.kode}</span> × <span className="angka">{Number(b.jumlah).toLocaleString("id-ID")}</span>
                  </span>
                ))}
              </div>
              <TautanFoto foto={k.foto} />
              <AksiRiwayat k={k} daftarPs={daftarPs} bolehTautkan={bolehTautkan} bolehHapus={bolehHapus} />
            </div>
          ))}
          {riwayat.length === 0 && <p className="p-4 text-center redup">{param.q ? "Tidak ada yang cocok dengan pencarian." : "Belum ada riwayat."}</p>}
        </div>

        {/* Desktop (md+): tabel */}
        <div className="hidden md:block bungkus-tabel">
          <table className="tabel min-w-[52rem]">
            <thead>
              <tr>
                <th>No</th>
                <th>Dilaporkan</th>
                <th>Pelapor</th>
                <th>Event</th>
                <th>Barang</th>
                <th>Status</th>
                <th>Foto</th>
                <th className="th-lekat" />
              </tr>
            </thead>
            <tbody>
              {riwayat.map((k) => (
                <tr key={k.id}>
                  <td><NomorDokumen nomor={k.nomor} /></td>
                  <td className="text-slate-500 whitespace-nowrap">{formatWaktu(k.waktuLapor)}</td>
                  <td>
                    <div className="font-medium text-slate-900">{k.namaPelapor}</div>
                    {k.keterangan && <div className="text-xs text-slate-500">{k.keterangan}</div>}
                  </td>
                  <td className="text-slate-600">{k.proyek?.nama ?? "-"}</td>
                  <td className="text-slate-600 text-xs">
                    {k.baris.map((b) => (
                      <span key={b.id} className="inline-block mr-2 whitespace-nowrap">
                        <span className="mono">{b.barang.kode}</span> × <span className="angka">{Number(b.jumlah).toLocaleString("id-ID")}</span> {b.barang.satuan}
                      </span>
                    ))}
                  </td>
                  <td>{k.penyesuaianId ? <span className="lencana lencana-slate">Ditautkan</span> : <span className="lencana lencana-emerald">Disetujui</span>}</td>
                  <td><TautanFoto foto={k.foto} /></td>
                  <td className="text-right td-lekat">
                    <AksiRiwayat k={k} daftarPs={daftarPs} bolehTautkan={bolehTautkan} bolehHapus={bolehHapus} />
                  </td>
                </tr>
              ))}
              {riwayat.length === 0 && (
                <tr>
                  <td colSpan={8} className="kosong">{param.q ? "Tidak ada yang cocok dengan pencarian." : "Belum ada riwayat."}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Aksi di baris Riwayat: tautkan PS (opsional, jejak akuntansi tambahan), kelola foto bukti dan hapus (Admin ke atas). */
function AksiRiwayat({
  k,
  daftarPs,
  bolehTautkan,
  bolehHapus,
}: {
  k: { id: string; nomor: string; gudangId: string; penyesuaianId: string | null; foto: Foto[] };
  daftarPs: { id: string; nomor: string; gudangId: string; keterangan: string | null }[];
  bolehTautkan: boolean;
  bolehHapus: boolean;
}) {
  return (
    <div className="flex flex-col items-start md:items-end gap-2">
      {!k.penyesuaianId && bolehTautkan && (
        <FormulirAksi aksi={tautkanPenyesuaianKerusakanFormulir.bind(null, k.id)} pesanSukses="Penyesuaian ditautkan." className="flex items-center gap-2">
          <select name="penyesuaianId" required className="isian isian-kecil min-h-11 md:min-h-0" aria-label="Penyesuaian stok yang disetujui">
            <option value="">Pilih PS</option>
            {daftarPs.filter((ps) => ps.gudangId === k.gudangId).map((ps) => (
              <option key={ps.id} value={ps.id}>{ps.nomor}{ps.keterangan ? ` (${ps.keterangan})` : ""}</option>
            ))}
          </select>
          <button type="submit" className="tombol tombol-garis tombol-kecil min-h-11 md:min-h-0">Tautkan</button>
        </FormulirAksi>
      )}
      {bolehHapus && (
        <details className="text-left w-full md:w-auto">
          <summary className="cursor-pointer text-xs text-slate-500 py-3.5 md:py-0 md:text-right">Kelola foto</summary>
          <div className="mt-2 space-y-2 text-xs">
            {k.foto.map((f, i) => (
              <div key={f.id} className="flex items-center gap-3">
                <a href={`/api/foto/${f.id}`} target="_blank" rel="noopener" className="tombol-tautan min-h-11 md:min-h-0 inline-flex items-center">Foto {i + 1}</a>
                <FormulirAksi aksi={hapusFotoKerusakanFormulir.bind(null, f.id)} pesanKonfirmasi="Hapus foto bukti ini?" className="inline">
                  <button type="submit" className="tombol-tautan-bahaya min-h-11 md:min-h-0">Hapus</button>
                </FormulirAksi>
              </div>
            ))}
            <FormulirAksi aksi={unggahFotoKerusakanFormulir.bind(null, k.id)} pesanSukses="Foto ditambahkan." className="space-y-2">
              <PemilihFoto name="foto" maksimal={3} wajib label="Tambah foto bukti" />
              <button type="submit" className="tombol tombol-garis tombol-kecil min-h-11 md:min-h-0 w-full md:w-auto">Unggah</button>
            </FormulirAksi>
          </div>
        </details>
      )}
      <TombolHapusDokumen jenis="laporanKerusakan" id={k.id} nomor={k.nomor} boleh={bolehHapus} className="min-h-11 md:min-h-0" pesanKonfirmasi={`Hapus ${k.nomor}? Dokumen dan foto buktinya ikut terhapus. Stok yang sudah dikurangi akan dikembalikan. Tindakan ini dicatat di log aktivitas.`} />
    </div>
  );
}
