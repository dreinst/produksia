import { punyaHak } from "@/lib/hakAkses";
import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import { daftarAkunKasBank } from "@/lib/baganAkun";
import { NomorDokumen } from "@/komponen/ui/Lencana";
import DaftarDokumenKasDraf from "@/komponen/kas-bank/DaftarDokumenKasDraf";
import FormulirAksi from "@/komponen/FormulirAksi";
import KolomPerusahaan from "@/komponen/KolomPerusahaan";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import { PERUSAHAAN_UTAMA, daftarPerusahaan, lingkupPerusahaan, perusahaanFormulir, saringMilikAtauBersama } from "@/lib/perusahaan";
import { PERINGATAN_PENDAPATAN_TANPA_FAKTUR, PERINGATAN_TANPA_EVENT } from "@/lib/verifikasi";
import { buatKasMasukFormulir } from "@/lib/aksi/jurnal";

export default async function HalamanKasMasuk({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("kas-masuk.lihat");
  const bolehHapus = punyaHak(pengguna, "kas-masuk.hapus");
  const bolehBuat = punyaHak(pengguna, "kas-masuk.buat");
  const param = await bacaParamDaftar(searchParams);
  // Lingkup perusahaan (D1 §7.4, §8.4): satu perusahaan = jurnal miliknya, akun milik perusahaan itu atau bersama, dan
  // proyeknya; gabungan = kueri lama ditambah kolom Perusahaan, pilihan berpemilik diberi akhiran kode perusahaan.
  const lingkup = await lingkupPerusahaan();
  const p = lingkup.perusahaanId;
  // pilihan formulir: lingkup perusahaan arsip diperlakukan seperti gabungan (tinjauan P17 butir 4); daftar tetap memakai p
  const pf = perusahaanFormulir(lingkup);
  const cari = { sumber: "KAS_MASUK" as const, ...(param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { keterangan: cocokTeks(param.q) }] } : {}) };
  const where = p ? { AND: [cari, { perusahaanId: p }] } : cari;
  const [daftarAkunKas, daftarAkun, total, daftarJurnal, daftarProyek, semuaPerusahaan] = await Promise.all([
    daftarAkunKasBank(db, pf),
    db.akun.findMany({ where: { kelompok: false, ...saringMilikAtauBersama(pf) }, orderBy: { kode: "asc" } }),
    db.jurnal.count({ where }),
    db.jurnal.findMany({ where, include: { baris: { include: { akun: true } }, perusahaan: { select: { kode: true, nama: true, warna: true } } }, orderBy: { tanggal: "desc" }, skip: param.lewati, take: param.ambil }),
    db.proyek.findMany({ where: { status: { notIn: ["BATAL", "DIARSIP"] }, ...(pf ? { perusahaanId: pf } : {}) }, orderBy: { kode: "asc" }, select: { id: true, kode: true, nama: true, perusahaanId: true } }),
    daftarPerusahaan(true),
  ]);
  const kodePerusahaan = new Map(semuaPerusahaan.map((x) => [x.id, x.kode]));
  const akhiran = (milik: string | null) => (!pf && milik ? ` · ${kodePerusahaan.get(milik) ?? milik}` : "");

  return (
    <div className="space-y-8">
      <h1 className="judul-halaman">Kas Masuk</h1>

      {bolehBuat && (
      <FormulirAksi aksi={buatKasMasukFormulir} verifikasi={{ judul: "Periksa kas masuk", peringatan: [PERINGATAN_PENDAPATAN_TANPA_FAKTUR, PERINGATAN_TANPA_EVENT] }} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
        {/* utama: hanya isian tersembunyi supaya formulir peran lama tetap sama (penyimpangan P17); lingkup lain dan
            gabungan: KolomPerusahaan (pilihan wajib di gabungan, supaya Pemilik bisa mencatat lagi) */}
        {pf === PERUSAHAAN_UTAMA ? (
          <input type="hidden" name="perusahaanId" value={pf} />
        ) : (
          <>
            <KolomPerusahaan lingkup={lingkup} daftar={semuaPerusahaan.filter((x) => x.aktif)} />
            <div className="hidden md:block" />
          </>
        )}
        <div className="bidang">
          <label className="label" htmlFor="akunKasId">Akun Kas/Bank Penerima *</label>
          <select id="akunKasId" name="akunKasId" required className="isian">
            <option value="">-</option>
            {daftarAkunKas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.kode} - {a.nama}
                {akhiran(a.perusahaanId)}
              </option>
            ))}
          </select>
        </div>

        <div className="bidang">
          <label className="label" htmlFor="akunLawanId">Akun Lawan (sumber dana) *</label>
          <select id="akunLawanId" name="akunLawanId" required className="isian">
            <option value="">-</option>
            {daftarAkun.map((a) => (
              <option key={a.id} value={a.id} data-jenis={a.jenis}>
                {a.kode} - {a.nama}
                {akhiran(a.perusahaanId)}
              </option>
            ))}
          </select>
        </div>

        <div className="bidang">
          <label className="label" htmlFor="jumlah">Jumlah *</label>
          <input id="jumlah" type="number" name="jumlah" step="0.01" min={0} required className="isian" />
        </div>

        <div className="bidang">
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

        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama">
            Catat Kas Masuk
          </button>
        </div>
      </FormulirAksi>
      )}

      <DaftarDokumenKasDraf jenis="MASUK" pengguna={pengguna} bolehHapus={bolehHapus} perusahaanId={p} />

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari nomor KM / keterangan…" />
        <div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            {!p && <th>Perusahaan</th>}
            <th>Tanggal</th>
            <th>Akun Kas/Bank</th>
            <th>Dari Akun</th>
            <th className="text-right angka">Jumlah</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {daftarJurnal.map((e) => {
            const cashLine = e.baris.find((l) => Number(l.debit) > 0);
            const counterLine = e.baris.find((l) => Number(l.kredit) > 0);
            return (
              <tr key={e.id}>
                <td><NomorDokumen nomor={e.nomor} /></td>
                {!p && <td><LencanaPerusahaan kode={e.perusahaan.kode} warna={e.perusahaan.warna} nama={e.perusahaan.nama} /></td>}
                <td className="text-slate-500 whitespace-nowrap">{e.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td>{cashLine?.akun.nama}</td>
                <td>{counterLine?.akun.nama}</td>
                <td className="text-right angka">
                  {Number(cashLine?.debit ?? 0).toLocaleString("id-ID")}
                </td>
                <td className="text-right"><TombolHapusDokumen jenis="jurnal" id={e.id} nomor={e.nomor} boleh={bolehHapus} /></td>
              </tr>
            );
          })}
          {daftarJurnal.length === 0 && (
            <tr>
              <td colSpan={p ? 6 : 7} className="kosong">
                {param.q ? "Tidak ada yang cocok dengan pencarian." : "Belum ada kas masuk."}
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
