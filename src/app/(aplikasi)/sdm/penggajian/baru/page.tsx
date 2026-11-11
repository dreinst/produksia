import { wajibHak } from "@/lib/otentikasi";
import { daftarAkunKasBank } from "@/lib/baganAkun";
import { daftarKaryawanAktif, akunGajiBawaan } from "@/lib/sdm";
import { daftarProyekAktif } from "@/lib/proyek";
import { buatPenggajianFormulir } from "@/lib/aksi/sdm";
import { PERINGATAN_TANPA_EVENT } from "@/lib/verifikasi";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import EditorBarisPenggajian from "@/komponen/sdm/EditorBarisPenggajian";
import KolomPerusahaan from "@/komponen/KolomPerusahaan";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import { db } from "@/lib/db";
import { PERUSAHAAN_UTAMA, daftarPerusahaan, lingkupPerusahaan, perusahaanFormulir } from "@/lib/perusahaan";

export default async function HalamanPenggajianBaru({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await wajibHak("penggajian.buat");
  // Satu proses gaji = karyawan satu perusahaan (D1 §2.4.3, KONTRAK-TAMBAHAN P18). Lingkup satu perusahaan aktif:
  // perusahaan lingkup (utama hanya isian tersembunyi, pola formulir halaman lama). Gabungan dan lingkup arsip:
  // pemilih perusahaan (GET ?perusahaan=) dulu, supaya daftar karyawan, akun kas, dan event yang terisi awal milik
  // perusahaan itu saja. Server tetap memvalidasi (pastikanKaryawanMilik, pastikanAkunMilik).
  const [lingkup, semuaPerusahaan, sp] = await Promise.all([lingkupPerusahaan(), daftarPerusahaan(), searchParams]);
  const p = perusahaanFormulir(lingkup);
  const mentah = Array.isArray(sp.perusahaan) ? sp.perusahaan[0] : sp.perusahaan;
  const dipilih = p ? null : (semuaPerusahaan.find((x) => x.id === mentah) ?? null);
  const pf = p ?? dipilih?.id ?? null;
  const [daftarAkunKas, daftarKaryawan, daftarProyek, gaji] = pf
    ? await Promise.all([daftarAkunKasBank(db, pf), daftarKaryawanAktif(db, pf), daftarProyekAktif(db, pf), akunGajiBawaan()])
    : [[], [], [], await akunGajiBawaan()];
  const bulanIni = new Date().toISOString().slice(0, 7);
  const hariIni = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6 max-w-5xl">
      <KepalaHalaman
        jejak={[{ label: "SDM" }, { label: "Penggajian", href: "/sdm/penggajian" }]}
        judul="Proses Gaji Baru"
        subjudul="Satu proses per bulan untuk semua karyawan aktif yang diikutkan. Jurnal: Dr Beban Gaji Pokok + Tunjangan / Cr Hutang Potongan (bila ada) / Cr Kas-Bank."
      />

      {!gaji.bebanGaji && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Akun Beban Gaji belum ada. Terapkan Bagan Akun Standar di Pengaturan → Bagan Akun Standar (akun 5-2100 Gaji Pokok), atau atur sendiri di Pengaturan → Pemetaan Akun → Pemetaan tambahan (&quot;bebanGaji&quot;).
        </div>
      )}

      {!p && (
        <form method="get" className="kartu flex flex-wrap items-end gap-3 max-w-2xl">
          <div className="bidang flex-1 min-w-[16rem]">
            <label className="label" htmlFor="pilih-perusahaan">Perusahaan *</label>
            <select id="pilih-perusahaan" name="perusahaan" required defaultValue={dipilih?.id ?? ""} className="isian">
              <option value="">Pilih perusahaan…</option>
              {semuaPerusahaan.map((x) => (
                <option key={x.id} value={x.id}>{`${x.kode} - ${x.nama}`}</option>
              ))}
            </select>
            <span className="petunjuk">
              {lingkup.perusahaan && !lingkup.perusahaan.aktif ? `${lingkup.perusahaan.nama} sudah diarsipkan. ` : ""}
              Satu proses gaji untuk karyawan satu perusahaan.{" "}
              {dipilih ? `Formulir di bawah untuk ${dipilih.nama}. Ganti perusahaan lalu tekan Tampilkan karyawan.` : "Karyawan, akun kas, dan event di bawah mengikuti perusahaan yang dipilih."}
            </span>
          </div>
          <button type="submit" className="tombol tombol-garis">Tampilkan karyawan</button>
        </form>
      )}

      {pf && (
      <FormulirAksi
        aksi={buatPenggajianFormulir}
        className="kartu grid grid-cols-1 md:grid-cols-2 gap-4"
        verifikasi={{ judul: "Periksa proses gaji", peringatan: [PERINGATAN_TANPA_EVENT] }}
      >
        {dipilih ? (
          // tinjauan P18 R2: perusahaan formulir tampil di dalam formulir, supaya tidak tertukar dengan pemilih di atas
          <>
            <div className="bidang">
              <input type="hidden" name="perusahaanId" value={dipilih.id} />
              <span className="label">Perusahaan</span>
              <div className="isian flex items-center gap-2 bg-slate-50 text-slate-700" aria-readonly="true">
                <LencanaPerusahaan kode={dipilih.kode} warna={dipilih.warna} />
                <span className="truncate">{dipilih.nama}</span>
              </div>
            </div>
            <div className="hidden md:block" />
          </>
        ) : lingkup.perusahaanId === PERUSAHAAN_UTAMA ? (
          <input type="hidden" name="perusahaanId" value={pf} />
        ) : (
          <>
            <KolomPerusahaan lingkup={lingkup} daftar={semuaPerusahaan} />
            <div className="hidden md:block" />
          </>
        )}
        <div className="bidang">
          <label className="label" htmlFor="periode">Periode *</label>
          <input id="periode" name="periode" type="month" required defaultValue={bulanIni} max={bulanIni} className="isian" />
          <span className="petunjuk">Satu proses per bulan; koreksi = hapus lalu proses ulang.</span>
        </div>
        <div className="bidang">
          <label className="label" htmlFor="tanggal">Tanggal pembayaran *</label>
          <input id="tanggal" name="tanggal" type="date" required defaultValue={hariIni} max={hariIni} className="isian" />
        </div>
        <div className="bidang">
          <label className="label" htmlFor="akunKasId">Dibayar dari *</label>
          <select id="akunKasId" name="akunKasId" required className="isian">
            <option value="">-</option>
            {daftarAkunKas.map((a) => (
              <option key={a.id} value={a.id}>{a.kode} - {a.nama}</option>
            ))}
          </select>
        </div>
        <div className="bidang">
          <label className="label" htmlFor="proyekId">Proyek / Event</label>
          <select id="proyekId" name="proyekId" className="isian" defaultValue="">
            <option value="">Tanpa event</option>
            {daftarProyek.map((p) => (
              <option key={p.id} value={p.id}>{p.kode} - {p.nama}</option>
            ))}
          </select>
          <span className="petunjuk">Isi bila gaji ini seluruhnya beban satu event (mis. kru lepas khusus event itu).</span>
        </div>
        <div className="bidang md:col-span-2">
          <label className="label" htmlFor="keterangan">Keterangan</label>
          <input id="keterangan" name="keterangan" className="isian" placeholder="mis. Gaji bulan berjalan" />
        </div>

        <EditorBarisPenggajian
          daftarKaryawan={daftarKaryawan.map((k) => ({ id: k.id, kode: k.kode, nama: k.nama, jabatan: k.jabatan, gajiPokok: Number(k.gajiPokok), tunjangan: Number(k.tunjangan) }))}
        />

        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama">
            Proses Gaji
          </button>
        </div>
      </FormulirAksi>
      )}
    </div>
  );
}
