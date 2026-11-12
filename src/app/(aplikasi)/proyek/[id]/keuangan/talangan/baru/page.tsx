import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { persetujuanWajib } from "@/lib/persetujuan";
import { lingkupPerusahaan } from "@/lib/perusahaan";
import { muatPetaKategori } from "@/lib/kategoriAnggaran";
import { NAMA_TANPA_KATEGORI, akunKeuanganProyek } from "@/lib/keuanganProyek";
import { tanggalIso } from "@/lib/waktu";
import { buatTalanganMitraFormulir } from "@/lib/aksi/bagiHasil";
import FormulirAksi from "@/komponen/FormulirAksi";
import Ikon from "@/komponen/ui/Ikon";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import { BidangPerusahaanProyek, PesanPerusahaanDiarsipkan } from "@/komponen/proyek/PerusahaanDokumenMitra";

/*
 * Formulir Talangan Mitra (D5 §7.2): biaya proyek yang dibayar mitra dengan uangnya sendiri. Akun beban dikelompokkan
 * per kategori anggaran, tanpa akun kelompok dan akun Bagi Hasil Mitra Proyek, dan hanya akun milik perusahaan proyek
 * atau akun bersama. Aksi buatTalanganMitra memvalidasi ulang semuanya di server.
 */

export default async function HalamanTalanganBaru({ params }: { params: Promise<{ id: string }> }) {
  const pengguna = await wajibHak("talangan-mitra.buat");
  const { id } = await params;
  const proyek = await db.proyek.findUnique({ where: { id }, select: { id: true, kode: true, nama: true, perusahaanId: true, perusahaan: { select: { kode: true, nama: true, warna: true, aktif: true } } } });
  if (!proyek) notFound();
  const mitra = await db.mitraProyek.findMany({ where: { proyekId: proyek.id }, orderBy: [{ urutan: "asc" }, { dibuatPada: "asc" }, { id: "asc" }], select: { id: true, nama: true } });
  const keuangan = punyaHak(pengguna, "anggaran-proyek.lihat") ? `/proyek/${proyek.id}/keuangan` : null;
  const jejak = [{ label: "Keuangan Proyek", href: keuangan ? "/proyek/keuangan" : undefined }, { label: proyek.kode, href: keuangan ?? undefined }, { label: "Catat talangan" }];

  // tinjauan P37 S2: perusahaan proyek yang diarsipkan tidak menerima dokumen mitra baru, jadi formulir tidak dijalankan
  if (!proyek.perusahaan.aktif)
    return (
      <div className="space-y-6">
        <KepalaHalaman jejak={jejak} judul="Catat Talangan Mitra" subjudul={`${proyek.kode} · ${proyek.nama}`} />
        <PesanPerusahaanDiarsipkan perusahaan={proyek.perusahaan} />
      </div>
    );
  const bedaLingkup = (await lingkupPerusahaan()).perusahaanId !== proyek.perusahaanId;

  if (mitra.length === 0)
    return (
      <div className="space-y-6">
        <KepalaHalaman jejak={jejak} judul="Catat Talangan Mitra" subjudul={`${proyek.kode} · ${proyek.nama}`} />
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

  const bagiHasil = (await akunKeuanganProyek(db)).bebanBagiHasil?.id ?? null;
  const akun = await db.akun.findMany({
    where: { jenis: "BEBAN", kelompok: false, OR: [{ perusahaanId: proyek.perusahaanId }, { perusahaanId: null }], ...(bagiHasil ? { id: { not: bagiHasil } } : {}) },
    orderBy: { kode: "asc" },
    select: { id: true, kode: true, nama: true },
  });
  const peta = await muatPetaKategori(db);
  const kelompok = new Map<string, { id: string; kode: string; nama: string }[]>();
  for (const a of akun) {
    const k = peta.kategoriUntukAkun(a.id);
    const nama = k ? (peta.namaKategori.get(k) ?? NAMA_TANPA_KATEGORI) : NAMA_TANPA_KATEGORI;
    kelompok.set(nama, [...(kelompok.get(nama) ?? []), a]);
  }
  const urutanKelompok = [...kelompok.keys()].sort((a, b) => (a === NAMA_TANPA_KATEGORI ? 1 : b === NAMA_TANPA_KATEGORI ? -1 : a.localeCompare(b, "id")));
  const wajib = await persetujuanWajib(db);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={jejak}
        judul="Catat Talangan Mitra"
        subjudul="Biaya proyek yang dibayar mitra dengan uangnya sendiri. Biaya ini dikembalikan ke mitra sebagai modal sebelum laba dibagi."
      />
      {wajib && (
        <p role="status" className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Talangan dibuat sebagai draf dan baru masuk buku besar setelah disetujui pengguna lain.
        </p>
      )}
      <FormulirAksi aksi={buatTalanganMitraFormulir.bind(null, proyek.id)} verifikasi={{ judul: "Periksa talangan mitra" }} pesanSukses="Talangan mitra tersimpan" className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        {bedaLingkup && <BidangPerusahaanProyek perusahaan={proyek.perusahaan} />}
        <div className="space-y-1">
          <label htmlFor="talangan-mitra" className="label">
            Mitra *
          </label>
          <select id="talangan-mitra" name="mitraId" required className="isian">
            {mitra.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nama}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="talangan-tanggal" className="label">
            Tanggal
          </label>
          <input id="talangan-tanggal" name="tanggal" type="date" defaultValue={tanggalIso(new Date())} className="isian" />
        </div>
        <div className="space-y-1">
          <label htmlFor="talangan-akun" className="label">
            Akun beban *
          </label>
          <select id="talangan-akun" name="akunBebanId" required defaultValue="" className="isian">
            <option value="" disabled>
              Pilih akun beban
            </option>
            {urutanKelompok.map((k) => (
              <optgroup key={k} label={k}>
                {kelompok.get(k)!.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.kode} {a.nama}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="talangan-jumlah" className="label">
            Jumlah (Rp) *
          </label>
          <input id="talangan-jumlah" name="jumlah" type="number" min="0.01" step="0.01" required className="isian angka" />
        </div>
        <div className="space-y-1">
          <label htmlFor="talangan-uraian" className="label">
            Uraian *
          </label>
          <input id="talangan-uraian" name="deskripsi" required maxLength={200} className="isian" />
        </div>
        <div className="space-y-1">
          <label htmlFor="talangan-vendor" className="label">
            Vendor
          </label>
          <input id="talangan-vendor" name="vendor" maxLength={120} className="isian" />
        </div>
        <div className="space-y-1 md:col-span-2">
          <label htmlFor="talangan-catatan" className="label">
            Catatan
          </label>
          <textarea id="talangan-catatan" name="catatan" maxLength={1000} className="isian h-auto min-h-24 py-2" />
        </div>
        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama min-h-11 w-full sm:w-auto">
            <Ikon nama="handshake" className="!text-[18px]" />
            Simpan talangan
          </button>
        </div>
      </FormulirAksi>
    </div>
  );
}
