import type { ReactNode } from "react";
import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { periksaKonsistensiPerusahaan, periksaSinkron, type HasilSinkron, type Perbandingan } from "@/lib/sinkron";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import Ikon from "@/komponen/ui/Ikon";

const KOLOM: { kunci: Exclude<keyof HasilSinkron, "pemetaanAda" | "seimbang" | "totalDebit" | "totalKredit">; label: string }[] = [
  { kunci: "persediaan", label: "Persediaan" },
  { kunci: "piutang", label: "Piutang" },
  { kunci: "hutang", label: "Hutang" },
  { kunci: "barangBelumDitagih", label: "Barang belum ditagih" },
  { kunci: "barangTerkirim", label: "Barang terkirim" },
  { kunci: "uangMuka", label: "Uang muka" },
];

function Cocok() {
  return (
    <span className="inline-flex text-emerald-600" title="Cocok">
      <Ikon nama="check_circle" className="!text-[18px]" />
      <span className="sr-only">Cocok</span>
    </span>
  );
}

function SelPerbandingan({ hasil }: { hasil: Perbandingan }) {
  if (hasil.sinkron) return <Cocok />;
  return <span className="angka font-semibold text-rose-700" title={`Buku besar ${Number(hasil.bukuBesar).toLocaleString("id-ID")}, dokumen ${Number(hasil.dokumen).toLocaleString("id-ID")}`}>Rp {Number(hasil.selisih).toLocaleString("id-ID")}</span>;
}

function BarisSinkron({ label, hasil, tebal }: { label: ReactNode; hasil: HasilSinkron; tebal?: boolean }) {
  return (
    <tr className={tebal ? "bg-slate-50/70 font-semibold" : undefined}>
      <td>{label}</td>
      <td className="text-center">
        {hasil.seimbang ? <Cocok /> : <span className="angka font-semibold text-rose-700">Rp {Number(hasil.totalDebit.minus(hasil.totalKredit)).toLocaleString("id-ID")}</span>}
      </td>
      {hasil.pemetaanAda ? (
        KOLOM.map((k) => (
          <td key={k.kunci} className="text-center">
            <SelPerbandingan hasil={hasil[k.kunci]} />
          </td>
        ))
      ) : (
        <td colSpan={KOLOM.length} className="text-amber-700">Pemetaan akun belum diatur</td>
      )}
    </tr>
  );
}

/**
 * Integritas per perusahaan (D1 §7.2, R4, R6): periksaSinkron untuk tiap perusahaan aktif dan perusahaan arsip yang
 * punya jurnal, lalu gabungan; plus periksaKonsistensiPerusahaan yang dihitung langsung (tanpa simpanan beranda).
 * Biaya periksaSinkron dikali jumlah perusahaan, jadi hanya dijalankan di halaman ini.
 */
export default async function HalamanIntegritasPerusahaan() {
  await wajibHak("buku-besar.lihat");
  const daftar = await db.perusahaan.findMany({
    where: { OR: [{ aktif: true }, { jurnal: { some: {} } }] },
    orderBy: [{ urutan: "asc" }, { nama: "asc" }],
    select: { id: true, kode: true, nama: true, warna: true, aktif: true },
  });
  const [perPerusahaan, gabungan, konsistensi] = await Promise.all([
    Promise.all(daftar.map((p) => periksaSinkron(db, { perusahaanId: p.id }))),
    periksaSinkron(db),
    periksaKonsistensiPerusahaan(db),
  ]);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Pengaturan" }, { label: "Perusahaan & Pajak", href: "/pengaturan/perusahaan" }, { label: "Integritas" }]}
        judul="Integritas per Perusahaan"
        subjudul="Kecocokan buku besar dengan dokumen dan stok untuk tiap perusahaan, plus pemeriksaan bahwa setiap dokumen, jurnal, dan rujukannya berada di perusahaan yang sama."
        aksi={<Link href="/pengaturan/perusahaan" className="tombol tombol-garis">Kembali</Link>}
      />

      <div className="kartu kartu-tabel">
        <div className="kepala-kartu">
          <div>
            <h2 className="judul-kartu">Buku besar dan dokumen</h2>
            <p className="subjudul-kartu">Tanda centang berarti cocok (toleransi Rp 1 per pemeriksaan). Angka merah adalah selisih buku besar dikurangi dokumen.</p>
          </div>
        </div>
        <div className="bungkus-tabel">
          <table className="tabel min-w-[52rem]">
            <thead>
              <tr>
                <th>Perusahaan</th>
                <th className="text-center">Jurnal seimbang</th>
                {KOLOM.map((k) => (
                  <th key={k.kunci} className="text-center">{k.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {daftar.map((p, i) => (
                <BarisSinkron
                  key={p.id}
                  hasil={perPerusahaan[i]}
                  label={
                    <span className="flex flex-wrap items-center gap-2">
                      <LencanaPerusahaan kode={p.kode} warna={p.warna} nama={p.nama} />
                      <span>{p.nama}</span>
                      {!p.aktif && <span className="lencana lencana-slate">Diarsipkan</span>}
                    </span>
                  }
                />
              ))}
              <BarisSinkron label="Gabungan" hasil={gabungan} tebal />
            </tbody>
          </table>
        </div>
      </div>

      <div className="kartu space-y-3">
        <div>
          <h2 className="judul-kartu">Konsistensi perusahaan</h2>
          <p className="subjudul-kartu">Jumlah data yang perusahaannya tidak cocok dengan jurnal, induk, akun, gudang, proyek, barang, karyawan, atau data yang dilampirinya. Semua harus 0.</p>
        </div>
        {konsistensi.konsisten ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700">
            <Ikon nama="check_circle" className="!text-[18px]" />
            Semua dokumen dan jurnal konsisten per perusahaan
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm font-semibold text-rose-700">
            <Ikon nama="error" className="!text-[18px]" />
            {konsistensi.total} temuan
          </p>
        )}
        <ul className="divide-y divide-slate-100 text-sm">
          {konsistensi.rincian.map((r) => (
            <li key={r.kode} className="flex items-center justify-between gap-3 py-2">
              <span className={r.jumlah > 0 ? "text-rose-700" : "text-slate-600"}>{r.label}</span>
              <span className={`angka ${r.jumlah > 0 ? "font-semibold text-rose-700" : "text-slate-500"}`}>{r.jumlah}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
