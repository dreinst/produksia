import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import { Rp } from "@/komponen/ui/Lencana";
import {
  catatKursFormulir,
  hapusKursFormulir,
  hapusMataUangFormulir,
  jalankanPenilaianKursFormulir,
  tambahMataUangFormulir,
  terapkanMataUangStandarFormulir,
  ubahAktifMataUangFormulir,
} from "@/lib/aksi/mataUang";

/*
 * Pengaturan › Mata Uang & Kurs.
 *
 * IDR adalah mata uang fungsional: buku besar selalu rupiah. Halaman ini mengatur daftar mata uang
 * transaksi (yang boleh dipakai di faktur, pelanggan, pemasok) dan riwayat kursnya terhadap rupiah,
 * serta menjalankan penilaian kembali saldo piutang/hutang mata uang asing di akhir periode.
 */

const hariIni = () => new Date().toISOString().slice(0, 10);

export default async function HalamanMataUang() {
  await wajibHak("pengaturan.tulis");
  const [daftarMataUang, daftarKurs, pemetaan] = await Promise.all([
    db.mataUang.findMany({ orderBy: [{ fungsional: "desc" }, { kode: "asc" }], include: { _count: { select: { kurs: true } } } }),
    db.kursMataUang.findMany({ orderBy: [{ tanggal: "desc" }, { mataUangId: "asc" }], take: 50, include: { mataUang: true } }),
    db.pemetaanAkun.findUnique({ where: { id: "default" }, include: { selisihKurs: true } }),
  ]);
  const asing = daftarMataUang.filter((m) => !m.fungsional && m.aktif);

  return (
    <div className="space-y-6 max-w-4xl">
      <KepalaHalaman
        jejak={[{ label: "Pengaturan" }]}
        judul="Mata Uang & Kurs"
        subjudul="Rupiah adalah mata uang fungsional: buku besar selalu dicatat dalam IDR. Mata uang asing melekat pada dokumen dan saldo piutang/hutangnya, dengan kurs yang disimpan per dokumen."
      />

      {daftarMataUang.length === 0 && (
        <FormulirAksi aksi={terapkanMataUangStandarFormulir} pesanSukses="Mata uang standar ditambahkan." className="kartu flex flex-col gap-3">
          <h2 className="judul-kartu">Belum ada mata uang</h2>
          <p className="text-sm text-slate-600">
            Tambahkan daftar standar (IDR sebagai mata uang fungsional, plus USD, SGD, EUR, AUD, JPY). Yang tidak dipakai bisa dinonaktifkan.
          </p>
          <button type="submit" className="tombol tombol-utama w-fit">
            Terapkan Mata Uang Standar
          </button>
        </FormulirAksi>
      )}

      {/* ---------- Daftar mata uang ---------- */}
      <div className="kartu kartu-tabel">
        <div className="kepala-kartu">
          <h2 className="judul-kartu">Daftar mata uang</h2>
          <p className="subjudul-kartu">Mata uang fungsional (IDR) tidak bisa dinonaktifkan atau dihapus, dan kursnya selalu 1.</p>
        </div>
        <div className="bungkus-tabel">
          <table className="tabel min-w-[40rem]">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Nama</th>
                <th>Simbol</th>
                <th className="text-right">Desimal</th>
                <th className="text-right">Riwayat kurs</th>
                <th>Aktif</th>
                <th className="th-lekat" />
              </tr>
            </thead>
            <tbody>
              {daftarMataUang.map((m) => (
                <tr key={m.id}>
                  <td className="mono font-semibold">{m.kode}</td>
                  <td>
                    {m.nama}
                    {m.fungsional && <span className="lencana lencana-emerald ml-2">Fungsional</span>}
                  </td>
                  <td>{m.simbol || "-"}</td>
                  <td className="text-right angka">{m.desimal}</td>
                  <td className="text-right angka">{m._count.kurs}</td>
                  <td>
                    <FormulirAksi aksi={ubahAktifMataUangFormulir.bind(null, m.id)} pesanSukses="Tersimpan." className="flex items-center gap-2">
                      <input type="checkbox" name="aktif" defaultChecked={m.aktif} disabled={m.fungsional} aria-label={`Aktifkan ${m.kode}`} />
                      <button type="submit" className="tombol tombol-garis tombol-kecil" disabled={m.fungsional}>
                        Simpan
                      </button>
                    </FormulirAksi>
                  </td>
                  <td className="text-right td-lekat">
                    {!m.fungsional && (
                      <FormulirAksi aksi={hapusMataUangFormulir.bind(null, m.id)} pesanKonfirmasi={`Hapus mata uang ${m.kode}?`} className="inline">
                        <button type="submit" className="tombol-tautan-bahaya">
                          Hapus
                        </button>
                      </FormulirAksi>
                    )}
                  </td>
                </tr>
              ))}
              {daftarMataUang.length === 0 && (
                <tr>
                  <td colSpan={7} className="kosong">
                    Belum ada mata uang. Semua transaksi dianggap rupiah.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------- Tambah mata uang ---------- */}
      <FormulirAksi aksi={tambahMataUangFormulir} pesanSukses="Mata uang ditambahkan." className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        <h2 className="judul-kartu md:col-span-2">Tambah mata uang</h2>
        <div className="bidang">
          <label className="label" htmlFor="kode">
            Kode ISO 4217 *
          </label>
          <input id="kode" name="kode" required maxLength={3} className="isian mono" placeholder="USD" />
          <span className="petunjuk">Tiga huruf, misalnya USD, SGD, EUR.</span>
        </div>
        <div className="bidang">
          <label className="label" htmlFor="nama">
            Nama *
          </label>
          <input id="nama" name="nama" required className="isian" placeholder="Dolar Amerika Serikat" />
        </div>
        <div className="bidang">
          <label className="label" htmlFor="simbol">
            Simbol
          </label>
          <input id="simbol" name="simbol" className="isian" placeholder="$" />
        </div>
        <div className="bidang">
          <label className="label" htmlFor="desimal">
            Jumlah desimal
          </label>
          <input id="desimal" name="desimal" type="number" min={0} max={6} defaultValue={2} className="isian" />
          <span className="petunjuk">IDR dan JPY lazimnya 0, USD dan EUR 2.</span>
        </div>
        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama">
            Tambah Mata Uang
          </button>
        </div>
      </FormulirAksi>

      {/* ---------- Catat kurs ---------- */}
      <FormulirAksi aksi={catatKursFormulir} pesanSukses="Kurs tersimpan." className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <h2 className="judul-kartu">Catat kurs</h2>
          <p className="text-sm text-slate-500 mt-1">
            1 unit mata uang = berapa rupiah pada tanggal itu. Dokumen memakai kurs terakhir yang tercatat sampai tanggal dokumennya, dan
            menyimpannya sebagai kurs dokumen, sehingga jurnal lama tidak berubah saat kurs baru dimasukkan.
          </p>
        </div>
        <div className="bidang">
          <label className="label" htmlFor="mataUangId">
            Mata uang *
          </label>
          <select id="mataUangId" name="mataUangId" required className="isian" defaultValue="">
            <option value="">-</option>
            {asing.map((m) => (
              <option key={m.id} value={m.id}>
                {m.kode} - {m.nama}
              </option>
            ))}
          </select>
          {asing.length === 0 && <span className="petunjuk">Belum ada mata uang asing yang aktif.</span>}
        </div>
        <div className="bidang">
          <label className="label" htmlFor="tanggal">
            Tanggal *
          </label>
          <input id="tanggal" name="tanggal" type="date" required defaultValue={hariIni()} className="isian" />
        </div>
        <div className="bidang">
          <label className="label" htmlFor="kurs">
            Kurs ke rupiah *
          </label>
          <input id="kurs" name="kurs" type="number" step="0.000001" min={0} required className="isian" placeholder="16250" />
        </div>
        <div className="bidang">
          <label className="label" htmlFor="sumber">
            Sumber kurs
          </label>
          <input id="sumber" name="sumber" className="isian" placeholder="Kurs tengah BI / kurs pajak / kurs kontrak" />
        </div>
        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama">
            Simpan Kurs
          </button>
        </div>
      </FormulirAksi>

      {/* ---------- Riwayat kurs ---------- */}
      <div className="kartu kartu-tabel">
        <div className="kepala-kartu">
          <h2 className="judul-kartu">Riwayat kurs terbaru</h2>
          <p className="subjudul-kartu">50 catatan terakhir.</p>
        </div>
        <div className="bungkus-tabel">
          <table className="tabel min-w-[36rem]">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Mata uang</th>
                <th className="text-right">Kurs (Rp)</th>
                <th>Sumber</th>
                <th>Dicatat oleh</th>
                <th className="th-lekat" />
              </tr>
            </thead>
            <tbody>
              {daftarKurs.map((k) => (
                <tr key={k.id}>
                  <td className="whitespace-nowrap">{k.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                  <td className="mono">{k.mataUang.kode}</td>
                  <td className="text-right">
                    <Rp nilai={k.kurs} />
                  </td>
                  <td className="text-slate-500">{k.sumber ?? "-"}</td>
                  <td className="text-slate-500">{k.dicatatOleh ?? "-"}</td>
                  <td className="text-right td-lekat">
                    <FormulirAksi aksi={hapusKursFormulir.bind(null, k.id)} pesanKonfirmasi="Hapus catatan kurs ini?" className="inline">
                      <button type="submit" className="tombol-tautan-bahaya">
                        Hapus
                      </button>
                    </FormulirAksi>
                  </td>
                </tr>
              ))}
              {daftarKurs.length === 0 && (
                <tr>
                  <td colSpan={6} className="kosong">
                    Belum ada kurs yang dicatat.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------- Penilaian kembali ---------- */}
      <FormulirAksi
        aksi={jalankanPenilaianKursFormulir}
        pesanSukses="Penilaian kembali dijalankan. Periksa jurnal JU-SK di Buku Besar › Jurnal Umum."
        pesanKonfirmasi="Jalankan penilaian kembali? Satu jurnal JU-SK akan dicatat ke buku besar."
        className="kartu grid grid-cols-1 md:grid-cols-2 gap-4"
      >
        <div className="md:col-span-2">
          <h2 className="judul-kartu">Penilaian kembali piutang &amp; hutang mata uang asing</h2>
          <p className="text-sm text-slate-500 mt-1">
            Saldo faktur mata uang asing yang masih terbuka dinilai ulang dengan kurs pada tanggal yang dipilih. Selisihnya dicatat sebagai
            laba/rugi kurs belum terealisasi ke akun{" "}
            {pemetaan?.selisihKurs ? (
              <span className="mono">
                {pemetaan.selisihKurs.kode} {pemetaan.selisihKurs.nama}
              </span>
            ) : (
              <strong>Selisih Kurs (belum diatur di Pemetaan Akun)</strong>
            )}
            . Menjalankannya dua kali pada kurs yang sama tidak menambah jurnal baru.
          </p>
        </div>
        <div className="bidang">
          <label className="label" htmlFor="tanggal-penilaian">
            Tanggal penilaian *
          </label>
          <input id="tanggal-penilaian" name="tanggal" type="date" required defaultValue={hariIni()} className="isian" />
          <span className="petunjuk">Biasanya akhir bulan atau akhir tahun buku.</span>
        </div>
        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama" disabled={!pemetaan?.selisihKursId}>
            Jalankan Penilaian Kembali
          </button>
        </div>
      </FormulirAksi>
    </div>
  );
}
