import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { PERUSAHAAN_UTAMA, saldoAntarPerusahaan } from "@/lib/perusahaan";
import { simpanPengaturanUmumFormulir } from "@/lib/aksi/pengaturan";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import Ikon from "@/komponen/ui/Ikon";

const LABEL_JENIS: Record<string, string> = { AGENSI: "Agensi", MEREK: "Merek", KLIEN: "Klien" };

/**
 * Perusahaan & Pajak (D1 §7.2): daftar perusahaan grup, pengaturan umum yang berlaku untuk semua perusahaan (tahun
 * buku dan wajib persetujuan), akun antar perusahaan, dan tautan integritas. Nama, pajak, dan akun pajak tiap
 * perusahaan (termasuk utama) diubah di /pengaturan/perusahaan/[id].
 */
export default async function HalamanPengaturanPerusahaan() {
  const pengguna = await wajibHak("pengaturan.tulis");
  const [daftar, pengaturanUtama, tersimpan, barisPengaturan, antar] = await Promise.all([
    db.perusahaan.findMany({
      orderBy: [{ urutan: "asc" }, { nama: "asc" }],
      select: { id: true, kode: true, nama: true, namaLegal: true, jenis: true, npwp: true, warna: true, aktif: true },
    }),
    ambilPengaturanPerusahaan(db),
    db.pengaturanPerusahaan.findUnique({ where: { id: "default" } }),
    db.pengaturanPerusahaan.findMany({ select: { perusahaanId: true, pkp: true, terminHari: true } }),
    saldoAntarPerusahaan(db, new Date()),
  ]);
  // perusahaan tanpa baris pengaturan memakai bawaan: non-PKP, termin 14 hari (D1 §3.6)
  const pajakPer = new Map(barisPengaturan.map((b) => [b.perusahaanId, b]));
  const pajak = (id: string) => (id === PERUSAHAAN_UTAMA ? pengaturanUtama : (pajakPer.get(id) ?? { pkp: false, terminHari: 14 }));
  const bolehPemetaan = punyaHak(pengguna, "pemetaan.tulis");
  const bolehIntegritas = punyaHak(pengguna, "buku-besar.lihat");

  return (
    <div className="space-y-6 max-w-5xl">
      <KepalaHalaman
        jejak={[{ label: "Administrasi" }, { label: "Pengaturan" }]}
        judul="Perusahaan & Pajak"
        subjudul="Entitas grup D'Pro, pajak tiap perusahaan, dan pengaturan umum yang berlaku untuk semua perusahaan."
        aksi={
          <Link className="tombol tombol-utama" href="/pengaturan/perusahaan/baru">
            + Perusahaan
          </Link>
        }
      />

      <div className="kartu kartu-tabel">
        <div className="kepala-kartu">
          <div>
            <h2 className="judul-kartu">Daftar perusahaan</h2>
            <p className="subjudul-kartu">Nama, status PKP, tarif PPN, termin faktur, dan akun pajak tiap perusahaan diubah lewat tombol Ubah.</p>
          </div>
        </div>
        <div className="bungkus-tabel">
          <table className="tabel min-w-[44rem]">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Nama</th>
                <th>Jenis</th>
                <th>NPWP</th>
                <th>PKP</th>
                <th className="text-right">Termin</th>
                <th>Status</th>
                <th className="th-lekat" />
              </tr>
            </thead>
            <tbody>
              {daftar.map((p) => {
                const pj = pajak(p.id);
                // utama: nama dari baris pengaturan "default", sama dengan kartu bilah samping
                const nama = p.id === PERUSAHAAN_UTAMA ? pengaturanUtama.nama : p.nama;
                return (
                  <tr key={p.id}>
                    <td><LencanaPerusahaan kode={p.kode} warna={p.warna} nama={nama} /></td>
                    <td>
                      <div className="font-semibold text-slate-900">{nama}</div>
                      {p.namaLegal && <div className="text-xs text-slate-500">{p.namaLegal}</div>}
                    </td>
                    <td>{LABEL_JENIS[p.jenis] ?? p.jenis}</td>
                    <td className="mono text-slate-600">{p.npwp ?? "-"}</td>
                    <td>{pj.pkp ? "Ya" : "Tidak"}</td>
                    <td className="text-right angka">{pj.terminHari} hari</td>
                    <td>
                      <span className={`lencana ${p.aktif ? "lencana-emerald" : "lencana-slate"}`}>{p.aktif ? "Aktif" : "Diarsipkan"}</span>
                    </td>
                    <td className="text-right td-lekat">
                      <Link href={`/pengaturan/perusahaan/${p.id}`} className="tombol-tautan" aria-label={`Ubah ${p.kode}`}>
                        Ubah
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {daftar.length === 0 && (
                <tr>
                  <td colSpan={8} className="kosong">Belum ada perusahaan</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <FormulirAksi aksi={simpanPengaturanUmumFormulir} className="kartu grid grid-cols-1 gap-4" pesanSukses="Pengaturan umum tersimpan.">
          <div>
            <h2 className="judul-kartu">Pengaturan umum (semua perusahaan)</h2>
            <p className="subjudul-kartu">Tahun buku dan alur persetujuan berlaku sama untuk semua perusahaan.</p>
          </div>

          <div className="bidang">
            <label className="label" htmlFor="tahunBuku">Tahun buku yang dibuka</label>
            <input id="tahunBuku" name="tahunBuku" type="number" min={2000} max={2100} defaultValue={tersimpan?.tahunBuku ?? ""} placeholder={String(new Date().getFullYear())} className="isian" />
            <span className="petunjuk">Bawaan periode laporan & pintasan; kosongkan untuk mengikuti tahun kalender. Bisa diganti cepat dari kartu perusahaan di sidebar</span>
          </div>

          <div className="bidang">
            <label className="label" htmlFor="mataUang">Mata uang</label>
            <input id="mataUang" value="Rupiah (IDR)" readOnly className="isian bg-slate-50" />
            <span className="petunjuk">Sistem berjalan satu mata uang</span>
          </div>

          <label className="flex items-start gap-3 ubin cursor-pointer">
            <input type="checkbox" name="wajibPersetujuan" defaultChecked={tersimpan?.wajibPersetujuan ?? true} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
            <span className="text-sm">
              <span className="font-semibold text-slate-900">Wajib persetujuan (maker-checker)</span>
              <span className="block text-xs text-slate-500 mt-0.5">
                Bila aktif, Faktur Penjualan, Faktur Pembelian, Kas Masuk/Keluar, Penyesuaian Stok, Aset Tetap, dan Penggajian dibuat sebagai
                draf lebih dulu; jurnalnya baru masuk buku besar setelah diajukan dan disetujui pengguna LAIN (pembuat tidak boleh menyetujui
                dokumennya sendiri). Mematikannya menghapus pengendalian pemisahan tugas: dokumen langsung dibukukan oleh pembuatnya.
              </span>
            </span>
          </label>

          <div>
            <button type="submit" className="tombol tombol-utama">
              Simpan Pengaturan Umum
            </button>
          </div>
        </FormulirAksi>

        <div className="space-y-6">
          <div className="kartu space-y-3">
            <div>
              <h2 className="judul-kartu">Akun antar perusahaan</h2>
              <p className="subjudul-kartu">Dipakai jurnal transaksi antar perusahaan dan catatan laporan gabungan.</p>
            </div>
            <dl className="space-y-1.5 text-sm">
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-slate-500">Piutang Antar Perusahaan:</dt>
                <dd className="font-semibold text-slate-900">{antar.akunPiutang ?? "belum ada"}</dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-slate-500">Hutang Antar Perusahaan:</dt>
                <dd className="font-semibold text-slate-900">{antar.akunHutang ?? "belum ada"}</dd>
              </div>
            </dl>
            {antar.masalah.map((m) => (
              <p key={m} className="flex gap-1.5 text-sm text-rose-700">
                <Ikon nama="error" className="!text-[16px] shrink-0 mt-0.5" />
                <span>{m}</span>
              </p>
            ))}
            {bolehPemetaan && (
              <Link href="/pengaturan/pemetaan-akun" className="tombol-tautan">
                Atur di Pemetaan Akun
              </Link>
            )}
          </div>

          {bolehIntegritas && (
            <div className="kartu space-y-3">
              <div>
                <h2 className="judul-kartu">Integritas</h2>
                <p className="subjudul-kartu">Kecocokan buku besar dengan dokumen untuk tiap perusahaan, dan pemeriksaan data yang tercampur antar perusahaan.</p>
              </div>
              <Link href="/pengaturan/perusahaan/integritas" className="tombol tombol-garis">
                <Ikon nama="fact_check" className="!text-[18px]" />
                Periksa integritas per perusahaan
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
