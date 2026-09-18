import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { daftarProyekAktif } from "@/lib/proyek";
import { LABEL_STATUS_PEMINJAMAN, petaSedangDiLuar, sisaBaris, statusPeminjaman, terlambat } from "@/lib/peminjaman";
import { formatTanggal, formatWaktu, tanggalIso } from "@/lib/waktu";
import {
  buatPeminjamanBarangFormulir,
  hapusFotoPeminjamanFormulir,
  kembalikanPeminjamanBarangFormulir,
  tautkanPenyesuaianPeminjamanFormulir,
  ubahPeminjamanBarangFormulir,
  unggahFotoPeminjamanFormulir,
} from "@/lib/aksi/peminjaman";
import FormulirAksi from "@/komponen/FormulirAksi";
import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import PemilihFoto from "@/komponen/ui/PemilihFoto";
import { NomorDokumen } from "@/komponen/ui/Lencana";
import EditorBarisPeminjaman, { EditorKembali, PemilihGudang } from "@/komponen/persediaan/EditorBarisPeminjaman";

const SERTAKAN = {
  baris: { include: { barang: { select: { kode: true, nama: true, satuan: true } } } },
  foto: { select: { id: true, tahap: true }, orderBy: { dibuatPada: "asc" as const } },
  proyek: { select: { nama: true } },
};

type Foto = { id: string; tahap: "KELUAR" | "KEMBALI" | null };

/** Label per tahap ("Keluar 1", "Kembali 2"); dipakai TautanFoto dan Kelola foto supaya nomornya sama. */
function labelFoto(foto: Foto[]): { id: string; label: string }[] {
  const nama = { KELUAR: "Keluar", KEMBALI: "Kembali" };
  const hitung = { KELUAR: 0, KEMBALI: 0 };
  return foto.map((f) => {
    const tahap = f.tahap ?? "KELUAR";
    hitung[tahap] += 1;
    return { id: f.id, label: `${nama[tahap]} ${hitung[tahap]}` };
  });
}

function TautanFoto({ foto }: { foto: Foto[] }) {
  if (foto.length === 0) return <span className="text-slate-400">-</span>;
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
      {labelFoto(foto).map((f) => (
        <a key={f.id} href={`/api/foto/${f.id}`} target="_blank" rel="noopener" className="tombol-tautan whitespace-nowrap">
          {f.label}
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

export default async function HalamanPeminjamanBarang({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("peminjaman.lihat");
  const bolehBuat = punyaHak(pengguna, "peminjaman.buat");
  const bolehHapus = punyaHak(pengguna, "peminjaman.hapus");
  const bolehTautkan = punyaHak(pengguna, "penyesuaian.setujui");
  const param = await bacaParamDaftar(searchParams);
  const paramGudang = (await searchParams).gudang;
  const gudangDipilih = Array.isArray(paramGudang) ? paramGudang[0] : paramGudang;

  const whereRiwayat = {
    ditutupPada: { not: null },
    ...(param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { namaPengambil: cocokTeks(param.q) }, { keterangan: cocokTeks(param.q) }] } : {}),
  };
  const [daftarGudang, daftarProyek, daftarBarang, daftarStok, petaDiLuar, saranNama, terbuka, totalRiwayat, riwayat, daftarPs] = await Promise.all([
    db.gudang.findMany({ orderBy: { kode: "asc" }, select: { id: true, kode: true, nama: true } }),
    // Tanpa cek hak data-induk: GUDANG tidak punya hak Proyek, tetapi kru perlu menandai event yang dilayani.
    daftarProyekAktif(),
    db.barang.findMany({ where: { jenis: "BARANG" }, orderBy: { kode: "asc" }, select: { id: true, kode: true, nama: true, satuan: true, warna: true } }),
    db.stokBarang.findMany({ select: { gudangId: true, barangId: true, jumlah: true } }),
    petaSedangDiLuar(db),
    db.peminjamanBarang.findMany({ select: { namaPengambil: true }, orderBy: { waktuKeluar: "desc" }, take: 50 }),
    db.peminjamanBarang.findMany({ where: { ditutupPada: null }, include: SERTAKAN, orderBy: { waktuKeluar: "desc" } }),
    db.peminjamanBarang.count({ where: whereRiwayat }),
    db.peminjamanBarang.findMany({ where: whereRiwayat, include: SERTAKAN, orderBy: { waktuKeluar: "desc" }, skip: param.lewati, take: param.ambil }),
    bolehTautkan ? db.penyesuaianPersediaan.findMany({ where: { statusPersetujuan: "DISETUJUI" }, select: { id: true, nomor: true, gudangId: true, keterangan: true }, orderBy: { nomor: "desc" } }) : Promise.resolve([]),
  ]);

  const gudangId = daftarGudang.find((g) => g.id === gudangDipilih)?.id ?? daftarGudang[0]?.id ?? "";
  const stokGudang = new Map(daftarStok.filter((s) => s.gudangId === gudangId).map((s) => [s.barangId, Number(s.jumlah)]));
  const barangEditor = daftarBarang.map((b) => ({ ...b, tersedia: (stokGudang.get(b.id) ?? 0) - (petaDiLuar.get(`${gudangId}:${b.id}`) ?? 0) }));
  const namaUnik = [...new Set(saranNama.map((s) => s.namaPengambil))];

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Persediaan" }, { label: "Stok per Gudang", href: "/persediaan" }]}
        judul="Peminjaman Barang"
        subjudul="Catatan loading in / loading out barang ke event. Stok akuntansi tidak berubah; yang sedang di luar dihitung terpisah."
      />

      {bolehBuat && (
        <div className="kartu">
          <div className="kepala-kartu">
            <h2 className="judul-kartu">Ambil barang</h2>
          </div>
          {daftarGudang.length === 0 ? (
            <p className="redup">Belum ada gudang. Tambahkan gudang di Data Induk terlebih dulu.</p>
          ) : (
            <FormulirAksi aksi={buatPeminjamanBarangFormulir} className="space-y-4">
              <datalist id="saran-nama-pengambil">
                {namaUnik.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
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
                  <label className="label" htmlFor="namaPengambil">Nama pengambil *</label>
                  <input id="namaPengambil" name="namaPengambil" required list="saran-nama-pengambil" className="isian min-h-11" placeholder="Nama kru yang membawa barang" />
                </div>
                <PilihanProyek id="proyekId" daftarProyek={daftarProyek} />
                <div className="bidang">
                  <label className="label" htmlFor="rencanaKembali">Rencana kembali</label>
                  <input id="rencanaKembali" name="rencanaKembali" type="date" className="isian min-h-11" />
                </div>
              </div>
              <EditorBarisPeminjaman daftarBarang={barangEditor} />
              <div className="bidang">
                <label className="label" htmlFor="keterangan">Keterangan</label>
                <input id="keterangan" name="keterangan" className="isian min-h-11" placeholder="mis. Sound system untuk panggung utama" />
              </div>
              <div className="bidang">
                <span className="label">Foto barang keluar *</span>
                <PemilihFoto name="foto" maksimal={3} wajib label="Ambil foto barang keluar" />
                <span className="petunjuk">Maksimal 3 foto, dikompresi otomatis di HP.</span>
              </div>
              <button type="submit" className="tombol tombol-utama w-full min-h-11">Catat keluar</button>
            </FormulirAksi>
          )}
        </div>
      )}

      <div className="kartu">
        <div className="kepala-kartu">
          <h2 className="judul-kartu">Sedang di luar</h2>
          <span className="text-xs text-slate-500">{terbuka.length} dokumen terbuka</span>
        </div>
        {terbuka.length === 0 ? (
          <p className="redup">Tidak ada barang yang sedang di luar.</p>
        ) : (
          <div className="space-y-4">
            {terbuka.map((p) => {
              const barisSisa = p.baris.map((b) => ({ barangId: b.barangId, kode: b.barang.kode, nama: b.barang.nama, satuan: b.barang.satuan, sisa: sisaBaris(b) })).filter((b) => b.sisa > 0);
              return (
                <div key={p.id} className="rounded-xl border border-slate-200 p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="space-y-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <NomorDokumen nomor={p.nomor} />
                      {terlambat(p) && <span className="lencana lencana-rose">Terlambat</span>}
                    </div>
                    <div className="text-slate-600">
                      Keluar {formatWaktu(p.waktuKeluar)} · <span className="font-medium text-slate-900">{p.namaPengambil}</span>
                      {p.proyek && <> · {p.proyek.nama}</>}
                    </div>
                    <div className="text-xs text-slate-500">
                      Rencana kembali {p.rencanaKembali ? formatTanggal(p.rencanaKembali) : "-"} · dicatat oleh {p.dicatatOlehNama}
                      {p.keterangan && <> · {p.keterangan}</>}
                    </div>
                    <ul className="space-y-0.5">
                      {p.baris.map((b) => (
                        <li key={b.id}>
                          <span className="mono">{b.barang.kode}</span> <span className="text-slate-700">({b.barang.nama})</span>{" "}
                          <span className="angka">{Number(b.jumlah).toLocaleString("id-ID")}</span> {b.barang.satuan}, kembali <span className="angka">{Number(b.jumlahKembali).toLocaleString("id-ID")}</span>, sisa{" "}
                          <span className="angka font-semibold">{sisaBaris(b).toLocaleString("id-ID")}</span>
                        </li>
                      ))}
                    </ul>
                    <TautanFoto foto={p.foto} />
                    {bolehBuat && (
                      <details className="pt-1">
                        <summary className="cursor-pointer text-xs font-semibold text-slate-600 py-3.5">Ubah data</summary>
                        <FormulirAksi aksi={ubahPeminjamanBarangFormulir.bind(null, p.id)} pesanSukses="Perubahan disimpan." className="space-y-3 mt-2">
                          <div className="bidang">
                            <label className="label" htmlFor={`ubah-nama-${p.id}`}>Nama pengambil *</label>
                            <input id={`ubah-nama-${p.id}`} name="namaPengambil" required list="saran-nama-pengambil" defaultValue={p.namaPengambil} className="isian min-h-11" />
                          </div>
                          <PilihanProyek id={`ubah-proyek-${p.id}`} daftarProyek={daftarProyek} nilai={p.proyekId} />
                          <div className="bidang">
                            <label className="label" htmlFor={`ubah-rencana-${p.id}`}>Rencana kembali</label>
                            <input id={`ubah-rencana-${p.id}`} name="rencanaKembali" type="date" defaultValue={p.rencanaKembali ? tanggalIso(p.rencanaKembali) : ""} className="isian min-h-11" />
                          </div>
                          <div className="bidang">
                            <label className="label" htmlFor={`ubah-ket-${p.id}`}>Keterangan</label>
                            <input id={`ubah-ket-${p.id}`} name="keterangan" defaultValue={p.keterangan ?? ""} className="isian min-h-11" />
                          </div>
                          <button type="submit" className="tombol tombol-garis w-full min-h-11">Simpan perubahan</button>
                        </FormulirAksi>
                      </details>
                    )}
                  </div>

                  {bolehBuat && (
                    <FormulirAksi aksi={kembalikanPeminjamanBarangFormulir.bind(null, p.id)} pesanSukses="Pengembalian dicatat." className="space-y-3 lg:border-l lg:border-slate-100 lg:pl-4">
                      <div className="text-xs font-semibold text-slate-600">Kembalikan</div>
                      {/* key ikut sisa supaya isian dimulai ulang dari sisa terbaru setelah pengembalian sebagian */}
                      <EditorKembali key={barisSisa.map((b) => `${b.barangId}:${b.sisa}`).join(",")} baris={barisSisa} />
                      <div className="bidang">
                        <span className="label">Foto barang kembali *</span>
                        <PemilihFoto name="foto" maksimal={3} wajib label="Ambil foto barang kembali" />
                      </div>
                      <div className="bidang">
                        <label className="label" htmlFor={`catatan-${p.id}`}>Catatan</label>
                        <input id={`catatan-${p.id}`} name="catatan" className="isian min-h-11" placeholder="Wajib bila ditutup dengan selisih" />
                      </div>
                      <label className="flex items-center gap-2 text-sm min-h-11">
                        <input type="checkbox" name="tutupDenganSelisih" value="1" className="h-5 w-5" />
                        Tutup dengan selisih (barang yang tidak kembali dianggap hilang)
                      </label>
                      <button type="submit" className="tombol tombol-utama w-full min-h-11">Catat kembali</button>
                    </FormulirAksi>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="kartu kartu-tabel">
        <div className="kepala-kartu">
          <h2 className="judul-kartu">Riwayat</h2>
        </div>
        <KontrolDaftar param={param} total={totalRiwayat} placeholder="Cari nomor / pengambil / keterangan…" tambahan={{ gudang: gudangDipilih }} />

        {/* Mobile (< md): kartu per dokumen */}
        <div className="md:hidden divide-y divide-slate-100">
          {riwayat.map((p) => {
            const status = statusPeminjaman(p);
            return (
              <div key={p.id} className="p-4 space-y-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <NomorDokumen nomor={p.nomor} />
                  <span className={`lencana ${LABEL_STATUS_PEMINJAMAN[status].kelas}`}>{LABEL_STATUS_PEMINJAMAN[status].label}</span>
                </div>
                <div className="text-slate-600">
                  {formatWaktu(p.waktuKeluar)} · <span className="font-medium text-slate-900">{p.namaPengambil}</span>
                  {p.proyek && <> · {p.proyek.nama}</>}
                </div>
                <div className="text-xs text-slate-500">
                  {p.baris.map((b) => (
                    <span key={b.id} className="inline-block mr-2 whitespace-nowrap">
                      <span className="mono">{b.barang.kode}</span> × <span className="angka">{Number(b.jumlah).toLocaleString("id-ID")}</span>
                      {sisaBaris(b) > 0 && <span className="text-rose-700"> (sisa {sisaBaris(b).toLocaleString("id-ID")})</span>}
                    </span>
                  ))}
                </div>
                {p.catatanKembali && <div className="text-xs text-slate-500">Catatan: {p.catatanKembali}</div>}
                <TautanFoto foto={p.foto} />
                <AksiRiwayat p={p} status={status} daftarPs={daftarPs} bolehTautkan={bolehTautkan} bolehHapus={bolehHapus} />
              </div>
            );
          })}
          {riwayat.length === 0 && <p className="p-4 text-center redup">{param.q ? "Tidak ada yang cocok dengan pencarian." : "Belum ada riwayat."}</p>}
        </div>

        {/* Desktop (md+): tabel */}
        <div className="hidden md:block bungkus-tabel">
          <table className="tabel min-w-[56rem]">
            <thead>
              <tr>
                <th>No</th>
                <th>Keluar</th>
                <th>Pengambil</th>
                <th>Event</th>
                <th>Barang</th>
                <th>Status</th>
                <th>Foto</th>
                <th className="th-lekat" />
              </tr>
            </thead>
            <tbody>
              {riwayat.map((p) => {
                const status = statusPeminjaman(p);
                return (
                  <tr key={p.id}>
                    <td><NomorDokumen nomor={p.nomor} /></td>
                    <td className="text-slate-500 whitespace-nowrap">{formatWaktu(p.waktuKeluar)}</td>
                    <td>
                      <div className="font-medium text-slate-900">{p.namaPengambil}</div>
                      {p.catatanKembali && <div className="text-xs text-slate-500">{p.catatanKembali}</div>}
                    </td>
                    <td className="text-slate-600">{p.proyek?.nama ?? "-"}</td>
                    <td className="text-slate-600 text-xs">
                      {p.baris.map((b) => (
                        <span key={b.id} className="inline-block mr-2 whitespace-nowrap">
                          <span className="mono">{b.barang.kode}</span> × <span className="angka">{Number(b.jumlah).toLocaleString("id-ID")}</span> {b.barang.satuan}
                          {sisaBaris(b) > 0 && <span className="text-rose-700"> (sisa {sisaBaris(b).toLocaleString("id-ID")})</span>}
                        </span>
                      ))}
                    </td>
                    <td><span className={`lencana ${LABEL_STATUS_PEMINJAMAN[status].kelas}`}>{LABEL_STATUS_PEMINJAMAN[status].label}</span></td>
                    <td><TautanFoto foto={p.foto} /></td>
                    <td className="text-right td-lekat">
                      <AksiRiwayat p={p} status={status} daftarPs={daftarPs} bolehTautkan={bolehTautkan} bolehHapus={bolehHapus} />
                    </td>
                  </tr>
                );
              })}
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

/** Aksi di baris Riwayat: tautkan PS (SELISIH), kelola foto bukti dan hapus (Admin ke atas). */
function AksiRiwayat({
  p,
  status,
  daftarPs,
  bolehTautkan,
  bolehHapus,
}: {
  p: { id: string; nomor: string; gudangId: string; foto: Foto[] };
  status: keyof typeof LABEL_STATUS_PEMINJAMAN;
  daftarPs: { id: string; nomor: string; gudangId: string; keterangan: string | null }[];
  bolehTautkan: boolean;
  bolehHapus: boolean;
}) {
  return (
    <div className="flex flex-col items-start md:items-end gap-2">
      {status === "SELISIH" && bolehTautkan && (
        <FormulirAksi aksi={tautkanPenyesuaianPeminjamanFormulir.bind(null, p.id)} pesanSukses="Penyesuaian ditautkan." className="flex items-center gap-2">
          <select name="penyesuaianId" required className="isian isian-kecil min-h-11 md:min-h-0" aria-label="Penyesuaian stok yang disetujui">
            <option value="">Pilih PS</option>
            {/* Hanya PS gudang dokumen ini; PS gudang lain tidak mengurangi stok gudang yang kehilangan barang */}
            {daftarPs.filter((ps) => ps.gudangId === p.gudangId).map((ps) => (
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
            {labelFoto(p.foto).map((f) => (
              <div key={f.id} className="flex items-center gap-3">
                <a href={`/api/foto/${f.id}`} target="_blank" rel="noopener" className="tombol-tautan min-h-11 md:min-h-0 inline-flex items-center">{f.label}</a>
                <FormulirAksi aksi={hapusFotoPeminjamanFormulir.bind(null, f.id)} pesanKonfirmasi="Hapus foto bukti ini?" className="inline">
                  <button type="submit" className="tombol-tautan-bahaya min-h-11 md:min-h-0">Hapus</button>
                </FormulirAksi>
              </div>
            ))}
            <FormulirAksi aksi={unggahFotoPeminjamanFormulir.bind(null, p.id, "KEMBALI")} pesanSukses="Foto ditambahkan." className="space-y-2">
              <PemilihFoto name="foto" maksimal={3} wajib label="Tambah foto bukti" />
              <button type="submit" className="tombol tombol-garis tombol-kecil min-h-11 md:min-h-0 w-full md:w-auto">Unggah</button>
            </FormulirAksi>
          </div>
        </details>
      )}
      <TombolHapusDokumen jenis="peminjamanBarang" id={p.id} nomor={p.nomor} boleh={bolehHapus} className="min-h-11 md:min-h-0" pesanKonfirmasi={`Hapus ${p.nomor}? Dokumen, baris, dan foto buktinya ikut terhapus. Stok tidak berubah. Tindakan ini dicatat di log aktivitas.`} />
    </div>
  );
}
