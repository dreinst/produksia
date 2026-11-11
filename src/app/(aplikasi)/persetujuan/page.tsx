import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { wajibMasuk } from "@/lib/otentikasi";
import { punyaHak, type Hak, type PenggunaSesi } from "@/lib/hakAkses";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import { NomorDokumen, Rp } from "@/komponen/ui/Lencana";
import { SelPersetujuan } from "@/komponen/KontrolPersetujuan";
import { persetujuanWajib, type JenisPersetujuan } from "@/lib/persetujuan";
import type { StatusPersetujuan } from "@/prisma-klien/enums";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import { lingkupPerusahaan, saringPerusahaan } from "@/lib/perusahaan";

/*
 * Kotak masuk persetujuan: semua dokumen yang masih DRAFT / MENUNGGU / DITOLAK dari jenis dokumen
 * yang sudah tersambung ke alur maker-checker. Dokumen DISETUJUI tidak muncul di sini; jejaknya
 * ada di daftar modulnya masing-masing dan di Pengaturan › Log Aktivitas.
 */

type Baris = {
  jenis: JenisPersetujuan;
  kode: string;
  label: string;
  id: string;
  nomor: string;
  tanggal: Date;
  keterangan: string;
  nilai: number;
  status: string;
  diajukanOlehId: string | null;
  diajukanOleh: string | null;
  catatanPenolakan: string | null;
  perusahaan: { kode: string; nama: string; warna: string | null };
};

const BELUM_SELESAI = { statusPersetujuan: { in: ["DRAFT", "MENUNGGU", "DITOLAK"] satisfies StatusPersetujuan[] } };
const nama = (p: { nama: string } | null | undefined) => p?.nama ?? null;
const PERUSAHAAN = { perusahaan: { select: { kode: true, nama: true, warna: true } } } as const;

/**
 * Jumlah dokumen MENUNGGU milik perusahaan di luar lingkup tunggal yang jenisnya boleh dilihat pengguna (tinjauan P18
 * R1). Hanya angka, jadi tidak membocorkan isi dokumen; hak lihat tetap per jenis seperti daftar di halaman ini.
 */
async function hitungMenungguLain(lp: string, bolehLihat: (kode: string) => boolean): Promise<number> {
  const where = { statusPersetujuan: "MENUNGGU" as const, perusahaanId: { not: lp } };
  const nol = Promise.resolve(0);
  const hitungan = await Promise.all([
    bolehLihat("faktur") ? db.fakturPenjualan.count({ where }) : nol,
    bolehLihat("faktur-pembelian") ? db.fakturPembelian.count({ where }) : nol,
    bolehLihat("kas-masuk") ? db.dokumenKas.count({ where: { ...where, jenis: "MASUK" } }) : nol,
    bolehLihat("kas-keluar") ? db.dokumenKas.count({ where: { ...where, jenis: "KELUAR" } }) : nol,
    bolehLihat("penyesuaian") ? db.penyesuaianPersediaan.count({ where }) : nol,
    bolehLihat("peminjaman") ? db.peminjamanBarang.count({ where }) : nol,
    bolehLihat("kerusakan") ? db.laporanKerusakanBarang.count({ where }) : nol,
    bolehLihat("aset") ? db.asetTetap.count({ where }) : nol,
    bolehLihat("penggajian") ? db.penggajian.count({ where }) : nol,
  ]);
  return hitungan.reduce((a, b) => a + b, 0);
}

export default async function HalamanPersetujuan() {
  const pengguna: PenggunaSesi = await wajibMasuk();
  // Gudang murni input/output stok; kotak masuk Persetujuan di luar fokusnya (permintaan pemilik).
  // Persetujuan Peminjaman Barang & Laporan Kerusakan Barangnya sendiri ada langsung di halaman masing-masing.
  if (pengguna.peran === "GUDANG" || pengguna.peran === "KRU" || pengguna.peran === "GUEST") {
    redirect(pengguna.peran === "GUDANG" ? "/data-induk/barang" : "/persediaan/peminjaman");
  }
  const bolehLihat = (kode: string) => punyaHak(pengguna, `${kode}.lihat` as Hak) || punyaHak(pengguna, `${kode}.setujui` as Hak);
  // Lingkup perusahaan (D1 §7.4, §8.4): satu perusahaan = dokumennya saja; gabungan = semua dengan kolom Perusahaan
  const { perusahaanId: lp } = await lingkupPerusahaan();
  const where = { ...BELUM_SELESAI, ...saringPerusahaan(lp) };

  const [wajib, faktur, fakturBeli, kas, penyesuaian, peminjaman, kerusakan, aset, penggajian] = await Promise.all([
    persetujuanWajib(db),
    db.fakturPenjualan.findMany({ where, include: { ...PERUSAHAAN, pelanggan: true, diajukanOleh: true }, orderBy: { tanggal: "desc" } }),
    db.fakturPembelian.findMany({ where, include: { ...PERUSAHAAN, pemasok: true, diajukanOleh: true }, orderBy: { tanggal: "desc" } }),
    db.dokumenKas.findMany({ where, include: { ...PERUSAHAAN, akunKas: true, akunLawan: true, diajukanOleh: true }, orderBy: { tanggal: "desc" } }),
    db.penyesuaianPersediaan.findMany({ where, include: { ...PERUSAHAAN, gudang: true, baris: true, diajukanOleh: true }, orderBy: { tanggal: "desc" } }),
    db.peminjamanBarang.findMany({ where, include: { ...PERUSAHAAN, gudang: true, baris: true, diajukanOleh: true }, orderBy: { waktuKeluar: "desc" } }),
    db.laporanKerusakanBarang.findMany({ where, include: { ...PERUSAHAAN, gudang: true, baris: true, diajukanOleh: true }, orderBy: { waktuLapor: "desc" } }),
    db.asetTetap.findMany({ where, include: { ...PERUSAHAAN, diajukanOleh: true }, orderBy: { tanggalPerolehan: "desc" } }),
    db.penggajian.findMany({ where, include: { ...PERUSAHAAN, baris: true, diajukanOleh: true }, orderBy: { tanggal: "desc" } }),
  ]);

  const daftar: Baris[] = [
    ...faktur.map((f) => ({
      jenis: "faktur" as const, kode: "faktur", label: "Faktur Penjualan", id: f.id, nomor: f.nomor, tanggal: f.tanggal,
      keterangan: f.pelanggan.nama, nilai: Number(f.total), status: f.statusPersetujuan,
      diajukanOlehId: f.diajukanOlehId, diajukanOleh: nama(f.diajukanOleh), catatanPenolakan: f.catatanPenolakan, perusahaan: f.perusahaan,
    })),
    ...fakturBeli.map((f) => ({
      jenis: "fakturPembelian" as const, kode: "faktur-pembelian", label: "Faktur Pembelian", id: f.id, nomor: f.nomor, tanggal: f.tanggal,
      keterangan: f.pemasok.nama, nilai: Number(f.total), status: f.statusPersetujuan,
      diajukanOlehId: f.diajukanOlehId, diajukanOleh: nama(f.diajukanOleh), catatanPenolakan: f.catatanPenolakan, perusahaan: f.perusahaan,
    })),
    ...kas.map((d) => ({
      jenis: "dokumenKas" as const, kode: d.jenis === "MASUK" ? "kas-masuk" : "kas-keluar",
      label: d.jenis === "MASUK" ? "Kas Masuk" : "Kas Keluar", id: d.id, nomor: d.nomor, tanggal: d.tanggal,
      keterangan: `${d.keterangan ?? "-"} (${d.akunKas.kode} ↔ ${d.akunLawan.kode})`, nilai: Number(d.jumlah), status: d.statusPersetujuan,
      diajukanOlehId: d.diajukanOlehId, diajukanOleh: nama(d.diajukanOleh), catatanPenolakan: d.catatanPenolakan, perusahaan: d.perusahaan,
    })),
    ...penyesuaian.map((p) => ({
      jenis: "penyesuaian" as const, kode: "penyesuaian", label: "Penyesuaian Stok", id: p.id, nomor: p.nomor, tanggal: p.tanggal,
      keterangan: `${p.baris.length} baris di gudang ${p.gudang.nama}`,
      nilai: p.baris.reduce((s, b) => s + (Number(b.jumlahSesudah) - Number(b.jumlahSebelum)) * Number(b.hargaSatuan), 0),
      status: p.statusPersetujuan, diajukanOlehId: p.diajukanOlehId, diajukanOleh: nama(p.diajukanOleh), catatanPenolakan: p.catatanPenolakan, perusahaan: p.perusahaan,
    })),
    ...peminjaman.map((p) => ({
      jenis: "peminjaman" as const, kode: "peminjaman", label: "Peminjaman Barang", id: p.id, nomor: p.nomor, tanggal: p.waktuKeluar,
      keterangan: `${p.namaPengambil}, ${p.baris.length} barang di ${p.gudang.nama}`, nilai: 0,
      status: p.statusPersetujuan, diajukanOlehId: p.diajukanOlehId, diajukanOleh: nama(p.diajukanOleh), catatanPenolakan: p.catatanPenolakan, perusahaan: p.perusahaan,
    })),
    ...kerusakan.map((k) => ({
      jenis: "kerusakan" as const, kode: "kerusakan", label: "Laporan Kerusakan Barang", id: k.id, nomor: k.nomor, tanggal: k.waktuLapor,
      keterangan: `${k.namaPelapor}, ${k.baris.length} barang di ${k.gudang.nama}`, nilai: 0,
      status: k.statusPersetujuan, diajukanOlehId: k.diajukanOlehId, diajukanOleh: nama(k.diajukanOleh), catatanPenolakan: k.catatanPenolakan, perusahaan: k.perusahaan,
    })),
    ...aset.map((a) => ({
      jenis: "aset" as const, kode: "aset", label: "Aset Tetap", id: a.id, nomor: a.kode, tanggal: a.tanggalPerolehan,
      keterangan: a.nama, nilai: Number(a.hargaPerolehan), status: a.statusPersetujuan,
      diajukanOlehId: a.diajukanOlehId, diajukanOleh: nama(a.diajukanOleh), catatanPenolakan: a.catatanPenolakan, perusahaan: a.perusahaan,
    })),
    ...penggajian.map((g) => ({
      jenis: "penggajian" as const, kode: "penggajian", label: "Penggajian", id: g.id, nomor: g.nomor, tanggal: g.tanggal,
      keterangan: `Periode ${g.bulan}, ${g.baris.length} karyawan`, nilai: Number(g.totalDibayar), status: g.statusPersetujuan,
      diajukanOlehId: g.diajukanOlehId, diajukanOleh: nama(g.diajukanOleh), catatanPenolakan: g.catatanPenolakan, perusahaan: g.perusahaan,
    })),
  ]
    .filter((b) => bolehLihat(b.kode))
    .sort((a, b) => (a.status === b.status ? b.tanggal.getTime() - a.tanggal.getTime() : a.status === "MENUNGGU" ? -1 : 1));

  const menunggu = daftar.filter((b) => b.status === "MENUNGGU").length;
  const menungguLain = lp ? await hitungMenungguLain(lp, bolehLihat) : 0;

  return (
    <div className="space-y-6">
      <KepalaHalaman
        judul="Persetujuan Dokumen"
        subjudul="Dokumen yang belum masuk buku besar. Jurnal baru dicatat setelah dokumen disetujui, dan pembuat dokumen tidak boleh menyetujui dokumennya sendiri."
      />

      {!wajib && (
        <div role="status" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Alur persetujuan sedang <strong>dimatikan</strong> di Pengaturan › Perusahaan &amp; Pajak. Dokumen baru langsung dibukukan tanpa pemeriksa.
        </div>
      )}

      <div className="kartu kartu-tabel">
        <div className="kepala-kartu">
          <h2 className="judul-kartu">{menunggu} dokumen menunggu persetujuan</h2>
          <p className="subjudul-kartu">Total {daftar.length} dokumen belum selesai (draf, menunggu, atau ditolak).</p>
          {menungguLain > 0 && (
            <p className="text-sm redup">Ada {menungguLain} dokumen menunggu di perusahaan lain. Ganti lingkup lewat pemilih perusahaan.</p>
          )}
        </div>
        <div className="bungkus-tabel">
          <table className="tabel min-w-[52rem]">
            <thead>
              <tr>
                <th>No</th>
                {!lp && <th>Perusahaan</th>}
                <th>Jenis</th>
                <th>Tanggal</th>
                <th>Keterangan</th>
                <th className="text-right">Nilai (Rp)</th>
                <th>Diajukan oleh</th>
                <th>Status &amp; tindakan</th>
              </tr>
            </thead>
            <tbody>
              {daftar.map((b) => (
                <tr key={`${b.jenis}-${b.id}`}>
                  <td>
                    <NomorDokumen nomor={b.nomor} />
                  </td>
                  {!lp && (
                    <td>
                      <LencanaPerusahaan kode={b.perusahaan.kode} warna={b.perusahaan.warna} nama={b.perusahaan.nama} />
                    </td>
                  )}
                  <td className="text-slate-600">{b.label}</td>
                  <td className="text-slate-500 whitespace-nowrap">
                    {b.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                  </td>
                  <td className="text-slate-600">{b.keterangan}</td>
                  <td className="text-right">
                    <Rp nilai={b.nilai} />
                  </td>
                  <td className="text-slate-500">{b.diajukanOleh ?? "-"}</td>
                  <td>
                    <SelPersetujuan
                      jenis={b.jenis}
                      kode={b.kode}
                      id={b.id}
                      nomor={b.nomor}
                      status={b.status}
                      diajukanOlehId={b.diajukanOlehId}
                      pengguna={pengguna}
                      catatanPenolakan={b.catatanPenolakan}
                    />
                  </td>
                </tr>
              ))}
              {daftar.length === 0 && (
                <tr>
                  <td colSpan={lp ? 7 : 8} className="kosong">
                    Tidak ada dokumen yang menunggu persetujuan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
