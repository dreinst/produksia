import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import FormulirAksi from "@/komponen/FormulirAksi";
import { PERINGATAN_TANPA_EVENT } from "@/lib/verifikasi";
import { buatPesananPembelianFormulir } from "@/lib/aksi/pembelian";
import EditorBarisBarang from "@/komponen/penjualan/EditorBarisBarang";
import KolomPerusahaan from "@/komponen/KolomPerusahaan";
import { PERUSAHAAN_UTAMA, daftarPerusahaan, lingkupPerusahaan, perusahaanFormulir, saringMilikAtauBersama, saringPerusahaan } from "@/lib/perusahaan";

export default async function HalamanPesananPembelianBaru() {
  await wajibHak("pesanan-pembelian.buat");
  // Dokumen akar (D1 §7.4 butir 2): lingkup satu perusahaan = barang milik perusahaan itu atau bersama dan proyeknya;
  // gabungan = semua pilihan, yang berpemilik diberi akhiran kode perusahaan. Server tetap memvalidasi (P13).
  // Lingkup perusahaan arsip diperlakukan seperti gabungan karena dokumennya dibuat untuk perusahaan aktif lain.
  const lingkup = await lingkupPerusahaan();
  const p = perusahaanFormulir(lingkup);
  const [daftarPemasok, daftarBarang, daftarProyek, perusahaanAktif] = await Promise.all([
    db.pemasok.findMany({ orderBy: { nama: "asc" } }),
    db.barang.findMany({ where: saringMilikAtauBersama(p), include: { perusahaan: { select: { kode: true } } }, orderBy: { nama: "asc" } }),
    // sama dengan daftarProyekAktif(db, p), ditambah kode perusahaan untuk akhiran di gabungan
    db.proyek.findMany({ where: { status: { notIn: ["BATAL", "DIARSIP"] }, ...saringPerusahaan(p) }, orderBy: { kode: "asc" }, select: { id: true, kode: true, nama: true, perusahaan: { select: { kode: true } } } }),
    daftarPerusahaan(),
  ]);
  const akhiran = (milik: { kode: string } | null | undefined) => (!p && milik ? ` · ${milik.kode}` : "");

  const opsiBarang = daftarBarang.map((i) => ({
    id: i.id,
    kode: i.kode,
    nama: `${i.nama}${akhiran(i.perusahaan)}`,
    hargaBawaan: Number(i.hargaBeli),
  }));

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="judul-halaman">Pesanan Pembelian Baru</h1>

      <FormulirAksi aksi={buatPesananPembelianFormulir} verifikasi={{ judul: "Periksa pesanan pembelian", peringatan: [PERINGATAN_TANPA_EVENT] }} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* pola formulir akar halaman lama (KONTRAK-TAMBAHAN): utama hanya isian tersembunyi supaya tampilan peran lama
            tetap sama; lingkup lain bidang baca saja; gabungan dan lingkup arsip pilihan wajib */}
        {lingkup.perusahaanId === PERUSAHAAN_UTAMA && p ? (
          <input type="hidden" name="perusahaanId" value={p} />
        ) : (
          <>
            <KolomPerusahaan lingkup={lingkup} daftar={perusahaanAktif} />
            <div className="hidden md:block" />
          </>
        )}
        <div className="bidang">
          <label className="label" htmlFor="pemasokId">Pemasok *</label>
          <select id="pemasokId" name="pemasokId" required className="isian">
            <option value="">-</option>
            {daftarPemasok.map((s) => (
              <option key={s.id} value={s.id}>
                {s.kode} - {s.nama}
              </option>
            ))}
          </select>
        </div>
        <div className="bidang">
          <label className="label" htmlFor="proyekId">Proyek / Event</label>
          <select id="proyekId" name="proyekId" className="isian" defaultValue="">
            <option value="">Tanpa event</option>
            {daftarProyek.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.kode} - {pr.nama}
                {akhiran(pr.perusahaan)}
              </option>
            ))}
          </select>
          <span className="petunjuk">Dipakai untuk Laba Rugi per event dan LPJ. Ikut ke semua dokumen turunannya.</span>
        </div>

        <div />

        <EditorBarisBarang daftarBarang={opsiBarang} />

        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama">
            Simpan Pesanan
          </button>
        </div>
      </FormulirAksi>
    </div>
  );
}
