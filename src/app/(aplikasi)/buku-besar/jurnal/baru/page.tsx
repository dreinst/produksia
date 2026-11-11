import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import FormulirAksi from "@/komponen/FormulirAksi";
import { PERINGATAN_TANPA_EVENT } from "@/lib/verifikasi";
import { buatJurnalManualFormulir } from "@/lib/aksi/jurnal";
import EditorBarisJurnal from "@/komponen/buku-besar/EditorBarisJurnal";
import KolomPerusahaan from "@/komponen/KolomPerusahaan";
import { PERUSAHAAN_UTAMA, daftarPerusahaan, lingkupPerusahaan, perusahaanFormulir, saringMilikAtauBersama } from "@/lib/perusahaan";

export default async function HalamanJurnalBaru() {
  await wajibHak("jurnal.buat");
  // Dokumen akar (D1 §7.4 butir 2, §8.4): lingkup satu perusahaan = akun milik perusahaan itu atau bersama dan
  // proyeknya; gabungan = semua, yang berpemilik diberi akhiran kode perusahaan. Server tetap memvalidasi (P13).
  const lingkup = await lingkupPerusahaan();
  // lingkup perusahaan arsip diperlakukan seperti gabungan (tinjauan P17 butir 4)
  const p = perusahaanFormulir(lingkup);
  const [akun, daftarProyek, semuaPerusahaan] = await Promise.all([
    db.akun.findMany({ where: { kelompok: false, ...saringMilikAtauBersama(p) }, orderBy: { kode: "asc" }, select: { id: true, kode: true, nama: true, perusahaanId: true } }),
    db.proyek.findMany({ where: { status: { notIn: ["BATAL", "DIARSIP"] }, ...(p ? { perusahaanId: p } : {}) }, orderBy: { kode: "asc" }, select: { id: true, kode: true, nama: true, perusahaanId: true } }),
    daftarPerusahaan(true),
  ]);
  const kodePerusahaan = new Map(semuaPerusahaan.map((x) => [x.id, x.kode]));
  const akhiran = (milik: string | null) => (!p && milik ? ` · ${kodePerusahaan.get(milik) ?? milik}` : "");
  const daftarAkun = akun.map((a) => ({ id: a.id, kode: a.kode, nama: `${a.nama}${akhiran(a.perusahaanId)}` }));

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="judul-halaman">Jurnal Umum Baru</h1>

      <FormulirAksi aksi={buatJurnalManualFormulir} verifikasi={{ judul: "Periksa jurnal umum", peringatan: [PERINGATAN_TANPA_EVENT] }} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* utama: hanya isian tersembunyi supaya formulir peran lama tetap sama (penyimpangan P17); lingkup lain dan
            gabungan: KolomPerusahaan (pilihan wajib di gabungan, supaya Pemilik bisa mencatat lagi) */}
        {p === PERUSAHAAN_UTAMA ? (
          <input type="hidden" name="perusahaanId" value={p} />
        ) : (
          <>
            <KolomPerusahaan lingkup={lingkup} daftar={semuaPerusahaan.filter((x) => x.aktif)} />
            <div className="hidden md:block" />
          </>
        )}
        <div className="bidang md:col-span-2">
          <label className="label" htmlFor="keterangan">Keterangan</label>
          <input id="keterangan" type="text" name="keterangan" className="isian" />
        </div>
        <div className="bidang">
          <label className="label" htmlFor="proyekId">Proyek / Event</label>
          <select id="proyekId" name="proyekId" className="isian" defaultValue="">
            <option value="">Tanpa event</option>
            {daftarProyek.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.kode} - {pr.nama}
                {akhiran(pr.perusahaanId)}
              </option>
            ))}
          </select>
          <span className="petunjuk">Dipakai untuk Laba Rugi per event dan LPJ. Ikut ke semua dokumen turunannya.</span>
        </div>

        <EditorBarisJurnal daftarAkun={daftarAkun} />

        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama">
            Simpan Jurnal
          </button>
        </div>
      </FormulirAksi>
    </div>
  );
}
