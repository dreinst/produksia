import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { akunKeuanganProyek } from "@/lib/keuanganProyek";
import { PANJANG_NAMA_KATEGORI, pemetaanBawaanDilewati } from "@/lib/kategoriAnggaran";
import {
  hapusKategoriAnggaranFormulir,
  siapkanKategoriBawaanFormulir,
  simpanPemetaanKategoriFormulir,
  tambahKategoriAnggaranFormulir,
  ubahKategoriAnggaranFormulir,
} from "@/lib/aksi/kategoriAnggaran";
import FormulirAksi from "@/komponen/FormulirAksi";
import Ikon from "@/komponen/ui/Ikon";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";

/*
 * Kategori Anggaran Proyek (D5 §7.2): kategori dan pemetaan akun beban ke kategori. Kategori dan pemetaan berlaku
 * untuk semua perusahaan (bagan akun bersama), jadi halaman ini tidak mengikuti lingkup. Akun berkode pemetaan bawaan
 * yang dilewati karena jenis, bentuk, atau namanya berbeda dari bagan standar tampil sebagai daftar periksa.
 */

const MAKS_TINGKAT = 20;

export default async function HalamanKategoriAnggaran() {
  const pengguna = await wajibHak("kategori-anggaran.ubah");
  const [kategori, akunBeban, pemetaan, peran, dilewati] = await Promise.all([
    db.kategoriAnggaran.findMany({
      orderBy: [{ urutan: "asc" }, { nama: "asc" }],
      select: { id: true, nama: true, urutan: true, bawaan: true, akun: { orderBy: { akun: { kode: "asc" } }, select: { akun: { select: { kode: true, nama: true } } } }, _count: { select: { barisAnggaran: true } } },
    }),
    db.akun.findMany({ where: { jenis: "BEBAN" }, orderBy: { kode: "asc" }, select: { id: true, kode: true, nama: true, indukId: true, kelompok: true } }),
    db.akunKategoriAnggaran.findMany({ select: { akunId: true, kategoriId: true } }),
    akunKeuanganProyek(db),
    pemetaanBawaanDilewati(db),
  ]);
  const hutangLain = peran.hutangMitra
    ? await db.barisJurnal.count({ where: { akunId: peran.hutangMitra.id, jurnal: { sumber: { not: "MITRA_PROYEK" } } } })
    : 0;

  const namaKategori = new Map(kategori.map((k) => [k.id, k.nama]));
  const langsung = new Map(pemetaan.map((p) => [p.akunId, p.kategoriId]));
  const perId = new Map(akunBeban.map((a) => [a.id, a]));
  const kedalaman = (id: string) => {
    let n = 0;
    for (let a = perId.get(id); a?.indukId && perId.has(a.indukId) && n < MAKS_TINGKAT; a = perId.get(a.indukId)) n++;
    return n;
  };
  /** Kategori efektif dan akun asal pemetaannya (padanan penentuKategori, ditambah sumbernya untuk tampilan). */
  const efektif = (id: string): { kategori: string; dari: string | null } | null => {
    const dilihat = new Set<string>();
    for (let a = perId.get(id); a && !dilihat.has(a.id) && dilihat.size < MAKS_TINGKAT; a = a.indukId ? perId.get(a.indukId) : undefined) {
      dilihat.add(a.id);
      const k = langsung.get(a.id);
      if (k) return { kategori: namaKategori.get(k) ?? "-", dari: a.id === id ? null : a.kode };
    }
    return null;
  };
  const bagiHasilId = peran.bebanBagiHasil?.id ?? null;

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Administrasi" }, { label: "Pengaturan" }]}
        judul="Kategori Anggaran Proyek"
        subjudul="Kategori untuk anggaran proyek dan akun beban yang dihitung sebagai realisasinya. Satu akun hanya masuk satu kategori; akun kelompok berlaku untuk akun di bawahnya kecuali yang dipetakan sendiri."
        aksi={
          <FormulirAksi aksi={siapkanKategoriBawaanFormulir} pesanSukses="Kategori bawaan disiapkan.">
            <button type="submit" className="tombol tombol-garis">
              <Ikon nama="category" className="!text-[18px]" />
              Siapkan kategori bawaan
            </button>
          </FormulirAksi>
        }
      />

      {dilewati.length > 0 && (
        <section className="kartu space-y-3 border-amber-200 bg-amber-50/40" aria-labelledby="judul-periksa" role="status">
          <div>
            <h2 id="judul-periksa" className="judul-kartu flex items-center gap-2">
              <Ikon nama="error" className="!text-[20px] text-amber-700" />
              Perlu diperiksa
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Akun berikut memakai kode yang biasanya dipetakan otomatis, tetapi tidak dipetakan karena berbeda dari bagan standar. Bila memang sesuai, pilih kategorinya di Pemetaan akun beban.
            </p>
          </div>
          <div className="bungkus-tabel">
            <table className="tabel-polos min-w-[40rem]">
              <thead>
                <tr>
                  <th>Akun</th>
                  <th>Kategori bawaan</th>
                  <th>Alasan</th>
                </tr>
              </thead>
              <tbody>
                {dilewati.map((a) => (
                  <tr key={a.akunId}>
                    <td>
                      <span className="mono">{a.kode}</span> {a.nama}
                    </td>
                    <td>{a.kategori}</td>
                    <td className="text-sm text-slate-600">{a.alasan}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="kartu space-y-4" aria-labelledby="judul-kategori">
        <h2 id="judul-kategori" className="judul-kartu">
          Kategori
        </h2>
        <FormulirAksi aksi={tambahKategoriAnggaranFormulir} pesanSukses="Kategori ditambahkan." className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="kategori-baru" className="label">
              Nama kategori *
            </label>
            <input id="kategori-baru" name="nama" required maxLength={PANJANG_NAMA_KATEGORI} className="isian w-72" />
          </div>
          <button type="submit" className="tombol tombol-utama">
            <Ikon nama="add" className="!text-[18px]" />
            Tambah kategori
          </button>
        </FormulirAksi>
        <div className="bungkus-tabel">
          <table className="tabel-polos min-w-[48rem]">
            <thead>
              <tr>
                <th className="text-right">Urutan</th>
                <th>Nama</th>
                <th>Akun dipetakan</th>
                <th className="text-right">Dipakai</th>
                <th aria-label="Aksi" />
              </tr>
            </thead>
            <tbody>
              {kategori.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-sm text-slate-500">
                    Kategori anggaran belum disiapkan. Tekan Siapkan kategori bawaan.
                  </td>
                </tr>
              ) : (
                kategori.map((k) => (
                  <tr key={k.id}>
                    <td className="text-right angka text-slate-500">{k.urutan}</td>
                    <td>
                      <FormulirAksi aksi={ubahKategoriAnggaranFormulir.bind(null, k.id)} pesanSukses="Nama kategori disimpan." className="flex items-center gap-2">
                        <label htmlFor={`nama-${k.id}`} className="sr-only">
                          Nama kategori {k.nama}
                        </label>
                        <input id={`nama-${k.id}`} name="nama" defaultValue={k.nama} required maxLength={PANJANG_NAMA_KATEGORI} className="isian w-56" />
                        <button type="submit" className="tombol-tautan">
                          Ubah nama
                        </button>
                        {k.bawaan && <span className="lencana lencana-slate">Bawaan</span>}
                      </FormulirAksi>
                    </td>
                    <td className="text-sm text-slate-600">{k.akun.length ? k.akun.map((p) => `${p.akun.kode} ${p.akun.nama}`).join(", ") : "-"}</td>
                    <td className="text-right angka">{k._count.barisAnggaran.toLocaleString("id-ID")}</td>
                    <td className="text-right">
                      {!k.bawaan && k._count.barisAnggaran === 0 && (
                        <FormulirAksi aksi={hapusKategoriAnggaranFormulir.bind(null, k.id)} pesanKonfirmasi={`Hapus kategori ${k.nama}?`} pesanSukses="Kategori dihapus.">
                          <button type="submit" className="tombol-tautan text-rose-700">
                            Hapus
                          </button>
                        </FormulirAksi>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="kartu space-y-4" aria-labelledby="judul-pemetaan">
        <div>
          <h2 id="judul-pemetaan" className="judul-kartu">
            Pemetaan akun beban
          </h2>
          <p className="text-sm text-slate-500 mt-1">Akun yang tidak dipetakan sendiri mengikuti pemetaan akun induknya. Tanpa pemetaan sama sekali, biayanya masuk Belum dikategorikan.</p>
        </div>
        {akunBeban.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada akun beban di bagan akun.</p>
        ) : (
          <FormulirAksi aksi={simpanPemetaanKategoriFormulir} pesanSukses="Pemetaan disimpan" className="space-y-4">
            <div className="bungkus-tabel">
              <table className="tabel-polos min-w-[48rem]">
                <thead>
                  <tr>
                    <th>Akun</th>
                    <th>Kategori</th>
                    <th>Hasil</th>
                  </tr>
                </thead>
                <tbody>
                  {akunBeban.map((a) => {
                    const hasil = efektif(a.id);
                    return (
                      <tr key={a.id}>
                        <td style={{ paddingLeft: `${0.75 + kedalaman(a.id) * 1.25}rem` }}>
                          <span className="mono">{a.kode}</span> <span className={a.kelompok ? "font-semibold" : ""}>{a.nama}</span>
                        </td>
                        <td>
                          {a.id === bagiHasilId ? (
                            <span className="text-sm text-slate-500">Dikecualikan (bagi hasil mitra)</span>
                          ) : (
                            <>
                              <label htmlFor={`kategori-${a.id}`} className="sr-only">
                                Kategori akun {a.kode}
                              </label>
                              <select id={`kategori-${a.id}`} name={`kategori_${a.id}`} defaultValue={langsung.get(a.id) ?? ""} className="isian w-64">
                                <option value="">Ikuti induk / belum dipetakan</option>
                                {kategori.map((k) => (
                                  <option key={k.id} value={k.id}>
                                    {k.nama}
                                  </option>
                                ))}
                              </select>
                            </>
                          )}
                        </td>
                        <td className="text-sm">
                          {a.id === bagiHasilId ? (
                            <span className="text-slate-500">-</span>
                          ) : hasil ? (
                            <span>
                              {hasil.kategori}
                              {hasil.dari && <span className="text-slate-500"> (dari {hasil.dari})</span>}
                            </span>
                          ) : (
                            <span className="text-amber-700">Belum dikategorikan</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button type="submit" className="tombol tombol-utama w-fit">
              Simpan pemetaan
            </button>
          </FormulirAksi>
        )}
      </section>

      <section className="kartu space-y-3" aria-labelledby="judul-peran">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="judul-peran" className="judul-kartu">
            Akun peran keuangan proyek
          </h2>
          {punyaHak(pengguna, "pemetaan.tulis") && (
            <Link href="/pengaturan/pemetaan-akun" className="tombol-tautan">
              Atur di Pemetaan Akun
            </Link>
          )}
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="teks-label">Hutang Mitra Proyek</dt>
            <dd className="mt-1">{peran.hutangMitra ? <><span className="mono">{peran.hutangMitra.kode}</span> {peran.hutangMitra.nama}</> : <span className="text-amber-700">Belum ada akun kewajiban rinci yang sah</span>}</dd>
          </div>
          <div>
            <dt className="teks-label">Bagi Hasil Mitra Proyek</dt>
            <dd className="mt-1">{peran.bebanBagiHasil ? <><span className="mono">{peran.bebanBagiHasil.kode}</span> {peran.bebanBagiHasil.nama}</> : <span className="text-amber-700">Belum ada akun beban rinci yang sah</span>}</dd>
          </div>
        </dl>
        {hutangLain > 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">
            Akun Hutang Mitra Proyek punya {hutangLain.toLocaleString("id-ID")} baris jurnal yang bukan dari dokumen mitra proyek. Saldo hutang mitra di halaman Integritas bisa tidak cocok dengan dokumen mitra.
          </p>
        )}
      </section>
    </div>
  );
}
