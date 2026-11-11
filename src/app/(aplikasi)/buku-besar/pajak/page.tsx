import type { ReactNode } from "react";
import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { ambilPengaturanPerusahaan, type PengaturanPajak } from "@/lib/pengaturanPerusahaan";
import { adaAngkaPajak, ringkasanPajak, ringkasanPajakGabungan, type RingkasanPajak } from "@/lib/pajak";
import { PERUSAHAAN_UTAMA, lingkupPerusahaan } from "@/lib/perusahaan";
import { catatPphFinalFormulir } from "@/lib/aksi/pajak";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import CatatanGabungan from "@/komponen/CatatanGabungan";
import { akhirTahun } from "@/lib/tutupBuku";

const angka = (v: { toString(): string }) => Number(v).toLocaleString("id-ID");
const NAMA_BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

const lencanaPajak = (p: PengaturanPajak) => (
  <span className={`lencana ${p.pkp ? "lencana-blue" : "lencana-slate"}`}>{p.pkp ? `PKP · PPN ${angka(p.tarifPpnPersen)}%` : "Non-PKP"}</span>
);

/** Tautan langsung ke isian pajak perusahaan itu, karena akun pajak sekarang diatur per perusahaan (tinjauan P19 temuan 4). */
const peringatanAkun = (perusahaanId: string, nama: string) => (
  <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
    Akun PPh Final {nama} belum diatur. Buka <Link href={`/pengaturan/perusahaan/${encodeURIComponent(perusahaanId)}`} className="font-semibold underline">Perusahaan &amp; Pajak, {nama}</Link>.
  </div>
);

/**
 * Tabel per masa pajak SATU perusahaan. Tombol Catat mengirim perusahaanId tersembunyi, jadi angka di konfirmasi
 * sama dengan yang dibukukan catatPphFinal (pengaturan, omzet, dan tarif perusahaan itu). `namaPerusahaan` hanya
 * diisi di gabungan, untuk membedakan konfirmasi antar perusahaan. Perusahaan yang diarsipkan (`aktif` false) tidak
 * mendapat tombol Catat karena catatPphFinal menolaknya; Hapus tetap ada.
 */
function TabelMasaPajak(p: { r: RingkasanPajak; pengaturan: PengaturanPajak; perusahaanId: string; namaPerusahaan?: string; aktif: boolean; tahun: number; bolehTulis: boolean; bolehHapus: boolean }) {
  const { r, pengaturan, tahun } = p;
  const sekarang = new Date();
  const akunSiap = !!pengaturan.akunBebanPphFinalId && !!pengaturan.akunHutangPphFinalId;
  const bulanBerjalan = (b: number) => new Date(tahun, b - 1, 1) <= sekarang;
  return (
    <div className="bungkus-tabel">
      <table className="tabel min-w-[64rem]">
        <thead>
          <tr>
            <th>Masa</th>
            <th className="text-right">Omzet bruto</th>
            <th className="text-right">Di luar faktur</th>
            <th className="text-right">PPN keluaran</th>
            <th className="text-right">PPN masukan</th>
            <th className="text-right">PPN kurang/(lebih)</th>
            <th className="text-right">PPh 23 dipotong klien</th>
            <th className="text-right">PPh 23 kita potong</th>
            <th className="text-right">PPh Final {angka(pengaturan.pphFinalPersen)}%</th>
            <th>Status PPh Final</th>
          </tr>
        </thead>
        <tbody>
          {r.bulan.map((b) => (
            <tr key={b.periode} className={!bulanBerjalan(b.bulan) ? "text-slate-400" : undefined}>
              <td className="whitespace-nowrap">{NAMA_BULAN[b.bulan - 1]} <span className="mono text-xs text-slate-400">{b.periode}</span></td>
              <td className="text-right angka">{angka(b.omzet)}</td>
              <td className="text-right angka text-slate-500">{b.omzetLain.isZero() ? "" : angka(b.omzetLain)}</td>
              <td className="text-right angka">{angka(b.ppnKeluaran)}</td>
              <td className="text-right angka">{angka(b.ppnMasukan)}</td>
              <td className={`text-right angka ${b.ppnKurangBayar.lt(0) ? "text-emerald-700" : ""}`}>{angka(b.ppnKurangBayar)}</td>
              <td className="text-right angka">{angka(b.pph23DipotongKlien)}</td>
              <td className="text-right angka">{angka(b.pph23KitaPotong)}</td>
              <td className="text-right angka font-semibold">{angka(b.pphFinal)}</td>
              <td className="whitespace-nowrap">
                {b.tercatat ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="lencana lencana-emerald">Tercatat {angka(b.tercatat.jumlah)}</span>
                    <span className="mono text-xs text-slate-500">{b.tercatat.nomorJurnal ?? "-"}</span>
                    <TombolHapusDokumen jenis="pphFinal" id={b.tercatat.id} nomor={b.tercatat.nomorJurnal ?? b.periode} boleh={p.bolehHapus} />
                  </span>
                ) : b.omzet.gt(0) && bulanBerjalan(b.bulan) && p.bolehTulis && p.aktif ? (
                  <FormulirAksi aksi={catatPphFinalFormulir} pesanKonfirmasi={`Catat PPh Final ${b.periode}${p.namaPerusahaan ? ` ${p.namaPerusahaan}` : ""} sebesar Rp ${angka(b.pphFinal)} (Dr Beban PPh Final / Cr Hutang PPh Final)?`}>
                    <input type="hidden" name="periode" value={b.periode} />
                    <input type="hidden" name="perusahaanId" value={p.perusahaanId} />
                    <button type="submit" className="tombol tombol-garis tombol-kecil" disabled={!akunSiap}>Catat</button>
                  </FormulirAksi>
                ) : (
                  <span className="text-xs text-slate-400">{!b.omzet.gt(0) ? "tanpa omzet" : !p.aktif && p.bolehTulis && bulanBerjalan(b.bulan) ? "perusahaan diarsipkan" : "-"}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td>Total {tahun}</td>
            <td className="text-right angka">{angka(r.total.omzet)}</td>
            <td className="text-right angka text-slate-500">{angka(r.total.omzetLain)}</td>
            <td className="text-right angka">{angka(r.total.ppnKeluaran)}</td>
            <td className="text-right angka">{angka(r.total.ppnMasukan)}</td>
            <td className="text-right angka">{angka(r.total.ppnKurangBayar)}</td>
            <td className="text-right angka">{angka(r.total.pph23DipotongKlien)}</td>
            <td className="text-right angka">{angka(r.total.pph23KitaPotong)}</td>
            <td className="text-right angka">{angka(r.total.pphFinal)}</td>
            <td className="text-xs text-slate-500">tercatat {angka(r.totalPphFinalTercatat)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default async function HalamanPajak({ searchParams }: { searchParams: Promise<{ tahun?: string }> }) {
  const pengguna = await wajibHak("buku-besar.lihat");
  const bolehTulis = punyaHak(pengguna, "pph-final.buat");
  const bolehHapus = punyaHak(pengguna, "pph-final.hapus");
  const { tahun: tahunParam } = await searchParams;
  const lingkup = await lingkupPerusahaan();
  // tahun buku global (baris default); pengaturan pajak lain dibaca per perusahaan
  const global = await ambilPengaturanPerusahaan(db);
  const tahun = Number(tahunParam) >= 2000 && Number(tahunParam) <= 2100 ? Number(tahunParam) : global.tahunBuku;
  const navigasiTahun = (
    <span className="flex items-center gap-2">
      <Link href={`/buku-besar/pajak?tahun=${tahun - 1}`} className="tombol tombol-garis tombol-kecil">‹ {tahun - 1}</Link>
      <Link href={`/buku-besar/pajak?tahun=${tahun + 1}`} className="tombol tombol-garis tombol-kecil">{tahun + 1} ›</Link>
    </span>
  );

  if (lingkup.perusahaanId === null) return <HalamanPajakGabungan tahun={tahun} navigasiTahun={navigasiTahun} bolehTulis={bolehTulis} bolehHapus={bolehHapus} />;

  const perusahaanId = lingkup.perusahaanId;
  const pengaturan = perusahaanId === PERUSAHAAN_UTAMA ? global : await ambilPengaturanPerusahaan(db, perusahaanId);
  const r = await ringkasanPajak(db, tahun, pengaturan.pphFinalPersen, perusahaanId);
  const akunSiap = !!pengaturan.akunBebanPphFinalId && !!pengaturan.akunHutangPphFinalId;

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Buku Besar" }]}
        judul="Ringkasan Pajak & SPT"
        subjudul={`Tahun ${tahun}. Omzet, PPN, PPh 23, dan PPh Final ${angka(pengaturan.pphFinalPersen)}% per bulan.`}
        lencana={lencanaPajak(pengaturan)}
        aksi={navigasiTahun}
      />

      {!akunSiap && peringatanAkun(perusahaanId, pengaturan.nama)}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="kartu p-5"><div className="teks-label">Omzet bruto usaha {tahun}</div><div className="font-heading text-lg font-bold angka mt-1">Rp {angka(r.total.omzet)}</div><div className="text-xs text-slate-500">Faktur − retur {angka(r.total.omzetFaktur)}{r.total.omzetLain.isZero() ? "" : ` · di luar faktur ${angka(r.total.omzetLain)}`}</div></div>
        <div className="kartu p-5"><div className="teks-label">PPN kurang (lebih) bayar</div><div className="font-heading text-lg font-bold angka mt-1">Rp {angka(r.total.ppnKurangBayar)}</div><div className="text-xs text-slate-500">Keluaran {angka(r.total.ppnKeluaran)} − masukan {angka(r.total.ppnMasukan)}</div></div>
        <div className="kartu p-5"><div className="teks-label">PPh 23 dipotong klien / kita potong</div><div className="font-heading text-lg font-bold angka mt-1">Rp {angka(r.total.pph23DipotongKlien)} / {angka(r.total.pph23KitaPotong)}</div></div>
        <div className="kartu p-5"><div className="teks-label">PPh Final {angka(pengaturan.pphFinalPersen)}% (tercatat)</div><div className="font-heading text-lg font-bold angka mt-1">Rp {angka(r.total.pphFinal)} <span className="text-sm text-slate-500">({angka(r.totalPphFinalTercatat)})</span></div></div>
      </div>

      <div className="kartu kartu-tabel">
        <div className="kepala-kartu"><h2 className="judul-kartu">Per masa pajak</h2></div>
        <TabelMasaPajak r={r} pengaturan={pengaturan} perusahaanId={perusahaanId} aktif={lingkup.perusahaan?.aktif ?? true} tahun={tahun} bolehTulis={bolehTulis} bolehHapus={bolehHapus} />
      </div>

      <CatatanPajak pphFinalPersen={angka(pengaturan.pphFinalPersen)} />
    </div>
  );
}

/**
 * Lingkup gabungan: ringkasan dijumlah dari semua perusahaan (PPh Final = jumlah PPh Final per perusahaan), lalu satu
 * tabel per perusahaan yang punya angka pajak tahun itu, ditambah utama. Catat dan Hapus dilakukan per perusahaan.
 */
async function HalamanPajakGabungan(p: { tahun: number; navigasiTahun: ReactNode; bolehTulis: boolean; bolehHapus: boolean }) {
  const { tahun } = p;
  const g = await ringkasanPajakGabungan(db, tahun);
  const tampil = g.perPerusahaan.filter((x) => x.perusahaan.id === PERUSAHAAN_UTAMA || adaAngkaPajak(x.ringkasan));
  const tarif = [...new Set(tampil.map((x) => angka(x.pengaturan.pphFinalPersen)))];
  const labelTarif = tarif.length === 1 ? `${tarif[0]}%` : "per perusahaan";
  const sekarang = new Date();
  const sampaiCatatan = akhirTahun(tahun) < sekarang ? akhirTahun(tahun) : sekarang;
  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Buku Besar" }]}
        judul="Ringkasan Pajak & SPT"
        subjudul={`Tahun ${tahun}. Semua perusahaan: omzet, PPN, PPh 23, dan PPh Final per bulan, dihitung per perusahaan.`}
        lencana={<span className="lencana lencana-slate">Gabungan</span>}
        aksi={p.navigasiTahun}
      />

      {/* saldo antar perusahaan per akhir tahun itu, atau hari ini untuk tahun berjalan (D1 §7.4, KONTRAK-TAMBAHAN P17) */}
      <CatatanGabungan sampai={sampaiCatatan} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="kartu p-5"><div className="teks-label">Omzet bruto usaha {tahun}</div><div className="font-heading text-lg font-bold angka mt-1">Rp {angka(g.total.omzet)}</div><div className="text-xs text-slate-500">Faktur − retur {angka(g.total.omzetFaktur)}{g.total.omzetLain.isZero() ? "" : ` · di luar faktur ${angka(g.total.omzetLain)}`}</div></div>
        <div className="kartu p-5"><div className="teks-label">PPN kurang (lebih) bayar</div><div className="font-heading text-lg font-bold angka mt-1">Rp {angka(g.total.ppnKurangBayar)}</div><div className="text-xs text-slate-500">Keluaran {angka(g.total.ppnKeluaran)} − masukan {angka(g.total.ppnMasukan)}</div></div>
        <div className="kartu p-5"><div className="teks-label">PPh 23 dipotong klien / kita potong</div><div className="font-heading text-lg font-bold angka mt-1">Rp {angka(g.total.pph23DipotongKlien)} / {angka(g.total.pph23KitaPotong)}</div></div>
        <div className="kartu p-5"><div className="teks-label">PPh Final {labelTarif} (tercatat)</div><div className="font-heading text-lg font-bold angka mt-1">Rp {angka(g.total.pphFinal)} <span className="text-sm text-slate-500">({angka(g.totalPphFinalTercatat)})</span></div><div className="text-xs text-slate-500">Jumlah PPh Final tiap perusahaan</div></div>
      </div>

      {tampil.map(({ perusahaan, pengaturan, ringkasan }) => (
        <div key={perusahaan.id} className="kartu kartu-tabel">
          <div className="kepala-kartu">
            <h2 className="judul-kartu">{perusahaan.kode} · {perusahaan.nama}</h2>
            {lencanaPajak(pengaturan)}
          </div>
          {!(pengaturan.akunBebanPphFinalId && pengaturan.akunHutangPphFinalId) && <div className="px-4 pb-3">{peringatanAkun(perusahaan.id, perusahaan.nama)}</div>}
          <TabelMasaPajak r={ringkasan} pengaturan={pengaturan} perusahaanId={perusahaan.id} namaPerusahaan={perusahaan.nama} aktif={perusahaan.aktif} tahun={tahun} bolehTulis={p.bolehTulis} bolehHapus={p.bolehHapus} />
        </div>
      ))}

      <CatatanPajak pphFinalPersen={labelTarif === "per perusahaan" ? null : tarif[0]} />
    </div>
  );
}

function CatatanPajak({ pphFinalPersen }: { pphFinalPersen: string | null }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-sm">
      <div className="kartu space-y-2">
        <h2 className="judul-kartu">Cara pakai untuk SPT</h2>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
          <li><strong>PPh Final UMKM</strong> ({pphFinalPersen ? `${pphFinalPersen}%` : "tarif tiap perusahaan"} dari omzet): klik <em>Catat</em> tiap akhir bulan. Setor lewat <Link href="/kas-bank/keluar/baru" className="text-blue-600 hover:underline">Kas Keluar</Link> ke akun Hutang PPh Final paling lambat tanggal 15 bulan berikutnya.</li>
          <li><strong>PPN</strong> (hanya PKP): kurang/(lebih) bayar = PPN penjualan dikurangi PPN pembelian. Lapor di SPT Masa PPN, setor lewat Kas Keluar.</li>
          <li><strong>PPh 23</strong>: potongan dari klien jadi kredit pajak (minta bukti potong). Potongan ke vendor wajib disetor dan dilaporkan.</li>
        </ul>
      </div>
      <div className="kartu space-y-2">
        <h2 className="judul-kartu">Catatan</h2>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
          <li>Omzet bruto usaha = seluruh akun pendapatan usaha di buku besar bulan itu (faktur − retur, ditambah pendapatan yang dicatat lewat Kas Masuk atau jurnal umum), <strong>sebelum diskon</strong> (PP 55/2022 Pasal 60), tanpa kelompok Pendapatan Lain-lain seperti bunga bank (sudah kena pajak final sendiri). Bukan kas yang diterima.</li>
          <li>Kolom &quot;Di luar faktur&quot; menunjukkan omzet yang tidak lewat faktur; periksa apakah seharusnya dibuatkan faktur (wajib bila PKP).</li>
          <li>Bila dokumen bulan itu berubah setelah dicatat, hapus catatan PPh Final lalu catat ulang.</li>
          <li>Tahun yang sudah ditutup bukunya tidak bisa dicatat atau dihapus.</li>
          <li>Batas omzet UMKM Rp 4,8 miliar/tahun tidak dihitung otomatis.</li>
        </ul>
      </div>
    </div>
  );
}
