import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { persetujuanWajib } from "@/lib/persetujuan";
import { daftarAkunKasBank } from "@/lib/baganAkun";
import { ringkasanKeuanganProyek } from "@/lib/keuanganProyek";
import { tanggalIso } from "@/lib/waktu";
import { buatPembayaranMitraFormulir } from "@/lib/aksi/bagiHasil";
import FormulirAksi from "@/komponen/FormulirAksi";
import Ikon from "@/komponen/ui/Ikon";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import IsianBayarMitra, { type MitraIsianBayar } from "@/komponen/proyek/IsianBayarMitra";

/*
 * Formulir Pembayaran ke Mitra (D5 §7.2): pengembalian modal atau bagi laba. Angka hak dan terutang mitra (nilai bawaan
 * jenis dan jumlah) hanya dimuat untuk pemegang bagi-hasil.lihat; tanpa hak itu isian tetap bisa dipakai tanpa nilai
 * bawaan. Akun kas/bank disaring perusahaan proyek. Aksi buatPembayaranMitra memvalidasi ulang semuanya.
 */

export default async function HalamanBayarMitraBaru({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("pembayaran-mitra.buat");
  const { id } = await params;
  const sp = await searchParams;
  const proyek = await db.proyek.findUnique({ where: { id }, select: { id: true, kode: true, nama: true, perusahaanId: true } });
  if (!proyek) notFound();
  const keuangan = punyaHak(pengguna, "anggaran-proyek.lihat") ? `/proyek/${proyek.id}/keuangan` : null;
  const jejak = [{ label: "Keuangan Proyek", href: keuangan ? "/proyek/keuangan" : undefined }, { label: proyek.kode, href: keuangan ?? undefined }, { label: "Bayar mitra" }];
  const daftarMitra = await db.mitraProyek.findMany({ where: { proyekId: proyek.id }, orderBy: [{ urutan: "asc" }, { dibuatPada: "asc" }, { id: "asc" }], select: { id: true, nama: true } });

  if (daftarMitra.length === 0)
    return (
      <div className="space-y-6">
        <KepalaHalaman jejak={jejak} judul="Bayar Mitra" subjudul={`${proyek.kode} · ${proyek.nama}`} />
        <div className="kartu space-y-3">
          <p className="text-sm text-slate-700">Belum ada mitra di proyek ini.</p>
          {punyaHak(pengguna, "bagi-hasil.buat") && keuangan && punyaHak(pengguna, "bagi-hasil.lihat") && (
            <Link href={`${keuangan}?tab=bagi-hasil&mitraBaru=1`} className="tombol tombol-garis w-fit">
              <Ikon nama="add" className="!text-[18px]" />
              Tambah mitra
            </Link>
          )}
        </div>
      </div>
    );

  const lihatBagi = punyaHak(pengguna, "bagi-hasil.lihat");
  const bh = lihatBagi ? (await ringkasanKeuanganProyek(db, proyek.id, { denganBagiHasil: true }))?.bagiHasil ?? null : null;
  const angka = new Map((bh?.mitra ?? []).map((m) => [m.id, m]));
  const n = (v: { toString(): string }) => Number(v.toString());
  const mitra: MitraIsianBayar[] = daftarMitra.map((m) => {
    const b = angka.get(m.id);
    return {
      id: m.id,
      nama: m.nama,
      angka: b
        ? {
            modalKembali: n(b.modalKembali),
            dibayarModal: n(b.dibayarModal),
            modalTerutang: n(b.modalTerutang),
            sisaModal: Math.max(0, n(b.modalMasuk.minus(b.dibayarModal))),
            bagianLaba: n(b.realisasi),
            dibayarLaba: n(b.dibayarLaba),
            labaTerutang: n(b.labaTerutang),
          }
        : null,
    };
  });
  const akunKas = await daftarAkunKasBank(db, proyek.perusahaanId);
  const wajib = await persetujuanWajib(db);
  const mitraAwal = typeof sp.mitra === "string" ? sp.mitra : undefined;

  return (
    <div className="space-y-6">
      <KepalaHalaman jejak={jejak} judul="Bayar Mitra" subjudul="Pengembalian modal atau bagi laba ke mitra proyek. Uang keluar dari akun kas/bank yang dipilih." />
      {wajib && (
        <p role="status" className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Pembayaran dibuat sebagai draf dan baru masuk buku besar setelah disetujui pengguna lain.
        </p>
      )}
      <FormulirAksi aksi={buatPembayaranMitraFormulir.bind(null, proyek.id)} verifikasi={{ judul: "Periksa pembayaran ke mitra" }} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        <IsianBayarMitra mitra={mitra} mitraAwal={mitraAwal} />
        <div className="space-y-1">
          <label htmlFor="bayar-tanggal" className="label">
            Tanggal
          </label>
          <input id="bayar-tanggal" name="tanggal" type="date" defaultValue={tanggalIso(new Date())} className="isian" />
        </div>
        <div className="space-y-1">
          <label htmlFor="bayar-kas" className="label">
            Akun kas/bank *
          </label>
          <select id="bayar-kas" name="akunKasId" required defaultValue="" className="isian">
            <option value="" disabled>
              Pilih akun kas/bank
            </option>
            {akunKas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.kode} {a.nama}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1 md:col-span-2">
          <label htmlFor="bayar-catatan" className="label">
            Catatan (referensi transfer)
          </label>
          <textarea id="bayar-catatan" name="catatan" maxLength={1000} className="isian h-auto min-h-24 py-2" />
        </div>
        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama min-h-11 w-full sm:w-auto">
            <Ikon nama="account_balance_wallet" className="!text-[18px]" />
            Catat pembayaran
          </button>
        </div>
      </FormulirAksi>
    </div>
  );
}
