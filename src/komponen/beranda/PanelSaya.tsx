import Link from "next/link";
import { db } from "@/lib/db";
import { punyaHak, type Hak, type PenggunaSesi } from "@/lib/hakAkses";
import { tindakLanjutSaya, tindakLanjutTerlambat } from "@/lib/crm";
import { daftarPerusahaan, saringPerusahaan } from "@/lib/perusahaan";
import { formatWaktu } from "@/lib/waktu";
import { LencanaStatus } from "@/komponen/ui/Lencana";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import Ikon from "@/komponen/ui/Ikon";

/*
 * Tab "Tugas Saya" (D7 §3.5, §7.4): tindak lanjut saya dan dokumen yang menunggu persetujuan pengguna.
 * Kartu tugas desain saya serta konten/desain yang menunggu persetujuan ditambahkan paket pemasaran.
 */

type BarisMenunggu = { kode: string; label: string; jumlah: number };

/**
 * Jumlah dokumen maker-checker berstatus MENUNGGU yang boleh pengguna setujui dan bukan ajuannya sendiri
 * (pemisahan tugas, sama dengan pastikanBukanPengaju), dalam lingkup perusahaan (null = gabungan).
 */
export async function menungguPersetujuanSaya(pengguna: PenggunaSesi, perusahaanId: string | null): Promise<BarisMenunggu[]> {
  const where = {
    statusPersetujuan: "MENUNGGU" as const,
    ...saringPerusahaan(perusahaanId),
    OR: [{ diajukanOlehId: null }, { diajukanOlehId: { not: pengguna.id } }],
  };
  const boleh = (h: Hak) => punyaHak(pengguna, h);
  const nol = Promise.resolve(0);
  const daftar: [string, string, Promise<number>][] = [
    ["faktur", "Faktur Penjualan", boleh("faktur.setujui") ? db.fakturPenjualan.count({ where }) : nol],
    ["faktur-pembelian", "Faktur Pembelian", boleh("faktur-pembelian.setujui") ? db.fakturPembelian.count({ where }) : nol],
    ["kas-masuk", "Kas Masuk", boleh("kas-masuk.setujui") ? db.dokumenKas.count({ where: { ...where, jenis: "MASUK" } }) : nol],
    ["kas-keluar", "Kas Keluar", boleh("kas-keluar.setujui") ? db.dokumenKas.count({ where: { ...where, jenis: "KELUAR" } }) : nol],
    ["penyesuaian", "Penyesuaian Stok", boleh("penyesuaian.setujui") ? db.penyesuaianPersediaan.count({ where }) : nol],
    ["peminjaman", "Peminjaman Barang", boleh("peminjaman.setujui") ? db.peminjamanBarang.count({ where }) : nol],
    ["kerusakan", "Laporan Kerusakan Barang", boleh("kerusakan.setujui") ? db.laporanKerusakanBarang.count({ where }) : nol],
    ["aset", "Aset Tetap", boleh("aset.setujui") ? db.asetTetap.count({ where }) : nol],
    ["penggajian", "Penggajian", boleh("penggajian.setujui") ? db.penggajian.count({ where }) : nol],
  ];
  const jumlah = await Promise.all(daftar.map((d) => d[2]));
  return daftar.map(([kode, label], i) => ({ kode, label, jumlah: jumlah[i] })).filter((b) => b.jumlah > 0);
}

export default async function PanelSaya({ pengguna, perusahaanId }: { pengguna: PenggunaSesi; perusahaanId: string | null }) {
  const bolehLead = punyaHak(pengguna, "lead.lihat");
  const sekarang = new Date();
  const [tindakLanjut, menunggu, perusahaan] = await Promise.all([
    bolehLead ? tindakLanjutSaya(db, pengguna.id, 10, perusahaanId) : Promise.resolve([]),
    menungguPersetujuanSaya(pengguna, perusahaanId),
    perusahaanId === null ? daftarPerusahaan(true) : Promise.resolve([]),
  ]);
  const petaPerusahaan = new Map(perusahaan.map((p) => [p.id, p]));
  const totalMenunggu = menunggu.reduce((s, b) => s + b.jumlah, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-7">
      {bolehLead && (
        <div className="kartu">
          <div className="kepala-kartu">
            <div>
              <h2 className="judul-kartu">Tindak lanjut saya</h2>
              <p className="subjudul-kartu">Pengingat CRM yang ditugaskan ke Anda, urut jatuh tempo.</p>
            </div>
          </div>
          {tindakLanjut.length === 0 ? (
            <p className="text-sm text-slate-500">Tidak ada tindak lanjut yang menunggu.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {tindakLanjut.map((t) => {
                const p = petaPerusahaan.get(t.perusahaanId);
                return (
                  <li key={t.id} className="py-2.5 flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800 truncate">{t.judul}</div>
                      <div className="text-xs text-slate-500 truncate">
                        {t.namaLead ? `${t.namaLead}${t.namaUsahaLead ? `, ${t.namaUsahaLead}` : ""}` : "Tanpa lead"} · {formatWaktu(t.jatuhTempo)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {p && <LencanaPerusahaan kode={p.kode} warna={p.warna} nama={p.nama} />}
                      {tindakLanjutTerlambat(t, sekarang) && <LencanaStatus status="TERLAMBAT" />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="kartu">
        <div className="kepala-kartu">
          <div>
            <h2 className="judul-kartu">Menunggu persetujuan Anda</h2>
            <p className="subjudul-kartu">Dokumen yang diajukan pengguna lain dan boleh Anda setujui.</p>
          </div>
          {totalMenunggu > 0 && <span className="lencana lencana-amber">{totalMenunggu} dokumen</span>}
        </div>
        {menunggu.length === 0 ? (
          <p className="text-sm text-slate-500">Tidak ada yang menunggu persetujuan Anda.</p>
        ) : (
          <>
            <ul className="divide-y divide-slate-100 text-sm">
              {menunggu.map((b) => (
                <li key={b.kode} className="py-2 flex items-center justify-between gap-3">
                  <span className="text-slate-600">{b.label}</span>
                  <span className="angka font-semibold text-slate-800">{b.jumlah.toLocaleString("id-ID")}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <Link href="/persetujuan" className="tombol tombol-lembut tombol-kecil">
                <Ikon nama="fact_check" className="!text-[18px] text-slate-500" />
                Buka Persetujuan
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
