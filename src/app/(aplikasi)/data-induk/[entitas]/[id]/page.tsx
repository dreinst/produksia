import Link from "next/link";
import { notFound } from "next/navigation";
import FormulirAksi from "@/komponen/FormulirAksi";
import FormulirDataInduk from "@/komponen/data-induk/FormulirDataInduk";
import FormLaporKerusakanInline from "@/komponen/persediaan/FormLaporKerusakanInline";
import { PemilihGudang } from "@/komponen/persediaan/EditorBarisPeminjaman";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import PemilihFoto from "@/komponen/ui/PemilihFoto";
import { ambilKonfigurasiEntitas } from "@/lib/konfigurasiDataInduk";
import { ambilDaftarOpsi, delegasiBaca } from "@/lib/dataInduk";
import { hapusFotoBarangFormulir, ubahDataIndukFormulir, ubahStokBarangFormulir, unggahFotoBarangFormulir } from "@/lib/aksi/dataInduk";
import { buatLaporanKerusakanFormulir } from "@/lib/aksi/kerusakan";
import { wajibHak } from "@/lib/otentikasi";
import { hakDataInduk, punyaHak } from "@/lib/hakAkses";
import { db } from "@/lib/db";

export default async function HalamanUbahDataInduk({
  params,
  searchParams,
}: {
  params: Promise<{ entitas: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { entitas, id } = await params;
  const config = ambilKonfigurasiEntitas(entitas);
  if (!config) notFound();
  const pengguna = await wajibHak(hakDataInduk(entitas).tulis);

  const rekaman = await delegasiBaca(config.model).findUnique({ where: { id } });
  if (!rekaman) notFound();
  const daftarOpsi = await ambilDaftarOpsi(config);
  const judul = String(rekaman.nama ?? rekaman.kode ?? config.label);
  // Hanya id & ukuran; isi (Bytes) dilayani terpisah lewat /api/foto/[id]
  const daftarFoto = config.slug === "barang" ? await db.foto.findMany({ where: { barangId: id }, select: { id: true, ukuran: true, urutan: true }, orderBy: { urutan: "asc" } }) : null;
  const bolehLaporKerusakan = config.slug === "barang" && rekaman.jenis === "BARANG" && punyaHak(pengguna, "kerusakan.buat");
  // "Stok" & "Lapor barang rusak" sama-sama butuh stok per gudang barang ini; satu kueri dipakai berdua.
  const daftarGudangStok = config.slug === "barang" && rekaman.jenis === "BARANG"
    ? await db.gudang.findMany({
        orderBy: { kode: "asc" },
        select: { id: true, kode: true, nama: true, stok: { where: { barangId: id }, select: { jumlah: true } } },
      })
    : [];
  const paramGudang = (await searchParams).gudang;
  const gudangDipilih = Array.isArray(paramGudang) ? paramGudang[0] : paramGudang;
  const gudangId = daftarGudangStok.find((g) => g.id === gudangDipilih)?.id ?? daftarGudangStok[0]?.id ?? "";
  const stokSaatIni = daftarGudangStok.find((g) => g.id === gudangId)?.stok[0]?.jumlah;
  const daftarAkun = daftarGudangStok.length > 0 ? await db.akun.findMany({ where: { kelompok: false }, orderBy: { kode: "asc" }, select: { id: true, kode: true, nama: true } }) : [];

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Data Induk" }, { label: config.label, href: `/data-induk/${entitas}` }]}
        judul={`Ubah ${config.label}`}
        subjudul={judul}
        aksi={
          <Link href={`/data-induk/${entitas}`} className="tombol tombol-garis">
            Batal
          </Link>
        }
      />

      <FormulirDataInduk
        config={config}
        daftarOpsi={daftarOpsi}
        nilai={rekaman}
        kecualiId={id}
        aksi={ubahDataIndukFormulir.bind(null, entitas, id)}
        labelTombol="Simpan perubahan"
      >
        <span className="text-xs text-slate-500">Bidang yang dikosongkan akan dihapus nilainya.</span>
      </FormulirDataInduk>

      {daftarGudangStok.length > 0 && (
        <div id="stok" className="kartu">
          <div className="kepala-kartu">
            <h2 className="judul-kartu">Stok Barang</h2>
            <p className="subjudul-kartu">Ubah angka di bawah untuk mengoreksi stok; otomatis membuat Penyesuaian Stok berjurnal di belakang layar, jadi jejak akuntansinya tetap ada.</p>
          </div>
          <FormulirAksi aksi={ubahStokBarangFormulir.bind(null, id)} pesanSukses="Stok diperbarui lewat Penyesuaian Stok otomatis." className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {daftarGudangStok.length > 1 ? (
                <div className="bidang">
                  <label className="label" htmlFor="gudangId">Gudang *</label>
                  <PemilihGudang daftarGudang={daftarGudangStok} gudangId={gudangId} />
                </div>
              ) : (
                <input type="hidden" name="gudangId" value={gudangId} />
              )}
              <div className="bidang">
                <label className="label" htmlFor="stok">Stok saat ini *</label>
                <input id="stok" name="stok" type="number" min={0} step="0.01" required defaultValue={stokSaatIni?.toString() ?? "0"} className="isian min-h-11" />
              </div>
              <div className="bidang">
                <label className="label" htmlFor="akunLawanId">Akun Lawan Penyesuaian *</label>
                <select id="akunLawanId" name="akunLawanId" required defaultValue="" className="isian min-h-11">
                  <option value="">-</option>
                  {daftarAkun.map((a) => (
                    <option key={a.id} value={a.id}>{a.kode} - {a.nama}</option>
                  ))}
                </select>
                <span className="petunjuk">Mis. &ldquo;Modal&rdquo; untuk saldo awal, &ldquo;Selisih Persediaan&rdquo; untuk koreksi opname.</span>
              </div>
            </div>
            <button type="submit" className="tombol tombol-utama w-full sm:w-auto min-h-11">Simpan stok</button>
          </FormulirAksi>
        </div>
      )}

      {daftarFoto && (
        <div id="foto" className="kartu">
          <div className="kepala-kartu">
            <h2 className="judul-kartu">Foto barang</h2>
          </div>
          {daftarFoto.length > 0 ? (
            <div className="mb-4 flex flex-wrap gap-4">
              {daftarFoto.map((f) => (
                <div key={f.id} className="flex flex-col items-center gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element -- foto privat dari API berhak akses, bukan aset statis */}
                  <img src={`/api/foto/${f.id}`} alt="" loading="lazy" className="h-20 w-20 object-cover rounded-lg border" />
                  <span className="text-xs text-slate-500">{Math.round(f.ukuran / 1000)} KB</span>
                  <FormulirAksi aksi={hapusFotoBarangFormulir.bind(null, f.id)} pesanKonfirmasi="Hapus foto ini?" className="inline">
                    <button type="submit" className="tombol-tautan-bahaya">
                      Hapus
                    </button>
                  </FormulirAksi>
                </div>
              ))}
            </div>
          ) : (
            <p className="petunjuk mb-4">Belum ada foto.</p>
          )}
          <FormulirAksi aksi={unggahFotoBarangFormulir.bind(null, id)} pesanSukses="Foto tersimpan" className="space-y-3">
            <PemilihFoto name="foto" maksimal={3} wajib label="Pilih / ambil foto" />
            <button type="submit" className="tombol tombol-utama w-full sm:w-auto min-h-11">
              Unggah foto
            </button>
          </FormulirAksi>
        </div>
      )}

      {bolehLaporKerusakan && (
        <div className="kartu">
          <div className="kepala-kartu">
            <h2 className="judul-kartu">Lapor barang rusak</h2>
            <p className="subjudul-kartu">Ketemu barang ini rusak saat cek stok? Lapor langsung di sini, tanpa pindah halaman. Menunggu persetujuan sebelum stok berkurang.</p>
          </div>
          {daftarGudangStok.length === 0 ? (
            <p className="redup">Belum ada gudang. Tambahkan gudang di Data Induk terlebih dulu.</p>
          ) : (
            <FormulirAksi aksi={buatLaporanKerusakanFormulir} pesanSukses="Dicatat sebagai draf. Klik “Ajukan” di halaman Laporan Kerusakan Barang untuk mengirimnya ke persetujuan." className="space-y-4">
              <input type="hidden" name="namaPelapor" value={pengguna.nama} />
              <FormLaporKerusakanInline
                barangId={id}
                daftarGudang={daftarGudangStok.map((g) => ({ id: g.id, kode: g.kode, nama: g.nama, tersedia: Number(g.stok[0]?.jumlah ?? 0) }))}
              />
            </FormulirAksi>
          )}
        </div>
      )}
    </div>
  );
}
