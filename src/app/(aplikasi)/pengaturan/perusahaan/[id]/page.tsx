import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { PERUSAHAAN_UTAMA, saringMilikAtauBersama } from "@/lib/perusahaan";
import { ubahPerusahaanFormulir } from "@/lib/aksi/perusahaan";
import FormPerusahaan, { nilaiAkunPajak } from "@/komponen/FormPerusahaan";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";

/**
 * Ubah satu perusahaan (D1 §7.2): identitas, kontak, rekening cetak, penanda tangan, dan pajak. Untuk utama, isian
 * nama, pajak, dan akun pajak sama dengan halaman Perusahaan & Pajak lama dan tetap tersimpan di baris "default".
 */
export default async function HalamanUbahPerusahaan({ params }: { params: Promise<{ id: string }> }) {
  const pengguna = await wajibHak("pengaturan.tulis");
  const { id } = await params;
  const perusahaan = await db.perusahaan.findUnique({ where: { id }, include: { pengaturan: { select: { id: true } } } });
  if (!perusahaan) notFound();
  const utama = id === PERUSAHAAN_UTAMA;
  const [pengaturan, semuaAkun, tanpaPengaturan] = await Promise.all([
    ambilPengaturanPerusahaan(db, id),
    // akun pajak milik perusahaan ini atau bersama; akun perusahaan lain ditolak saat simpan
    db.akun.findMany({
      where: { kelompok: false, jenis: { in: ["ASET", "KEWAJIBAN", "BEBAN"] }, ...saringMilikAtauBersama(id) },
      orderBy: { kode: "asc" },
      select: { id: true, kode: true, nama: true, jenis: true, perusahaanId: true },
    }),
    // perusahaan lain (termasuk arsip) yang masih memakai baris "default"; aturannya sama dengan pastikanAkunPajakSah
    utama ? db.perusahaan.count({ where: { id: { not: PERUSAHAAN_UTAMA }, pengaturan: { is: null } } }) : Promise.resolve(0),
  ]);
  // Selama baris "default" masih dipakai perusahaan lain, server menolak akun milik utama sebagai akun pajak utama.
  // Pilihan dibatasi ke akun bersama ditambah akun yang sedang tersimpan (tinjauan P19 temuan 3).
  const hanyaBersama = utama && tanpaPengaturan > 0;
  const idTersimpan = new Set<string | null>([
    pengaturan.akunPpnKeluaranId,
    pengaturan.akunPpnMasukanId,
    pengaturan.akunPph23DimukaId,
    pengaturan.akunPph23DipotongId,
    pengaturan.akunBebanPphFinalId,
    pengaturan.akunHutangPphFinalId,
  ]);
  const daftarAkun = semuaAkun
    .filter((a) => !hanyaBersama || a.perusahaanId === null || idTersimpan.has(a.id))
    .map((a) => ({ id: a.id, kode: a.kode, nama: a.nama, jenis: a.jenis }));
  const tersimpan = Boolean(perusahaan.pengaturan);

  return (
    <div className="space-y-6 max-w-3xl">
      <KepalaHalaman
        jejak={[{ label: "Pengaturan" }, { label: "Perusahaan & Pajak", href: "/pengaturan/perusahaan" }, { label: perusahaan.kode }]}
        judul={perusahaan.nama}
        subjudul={perusahaan.namaLegal ?? undefined}
        lencana={
          <span className="flex flex-wrap items-center gap-2">
            <LencanaPerusahaan kode={perusahaan.kode} warna={perusahaan.warna} nama={perusahaan.nama} />
            <span className={`lencana ${perusahaan.aktif ? "lencana-emerald" : "lencana-slate"}`}>{perusahaan.aktif ? "Aktif" : "Diarsipkan"}</span>
          </span>
        }
        aksi={<Link href="/pengaturan/perusahaan" className="tombol tombol-garis">Kembali</Link>}
      />

      <FormPerusahaan
        aksi={ubahPerusahaanFormulir.bind(null, id)}
        pesanSukses="Perusahaan tersimpan."
        tombol="Simpan Perusahaan"
        utama={utama}
        daftarAkun={daftarAkun}
        lencanaPajak={
          <>
            <span className={`lencana ${tersimpan ? "lencana-emerald" : "lencana-amber"}`}>{tersimpan ? "Tersimpan" : "Masih bawaan"}</span>
            {hanyaBersama && (
              <p className="petunjuk mt-2">
                Pilihan akun pajak hanya berisi akun bersama, karena {tanpaPengaturan} perusahaan lain belum punya pengaturan pajak sendiri dan masih memakai akun pajak utama. Akun milik utama bisa dipilih sesudah semua perusahaan menyimpan pengaturan pajaknya.
              </p>
            )}
          </>
        }
        nilai={{
          ...perusahaan,
          // utama: nama dari baris pengaturan "default", sama dengan kartu bilah samping dan halaman lama
          nama: utama ? pengaturan.nama : perusahaan.nama,
          pkp: pengaturan.pkp,
          tarifPpnPersen: Number(pengaturan.tarifPpnPersen),
          terminHari: pengaturan.terminHari,
          pphFinalPersen: Number(pengaturan.pphFinalPersen),
          ...nilaiAkunPajak(pengaturan, daftarAkun),
        }}
      />

      {/* tautan pengaturan cetak lain ditambahkan paket pemiliknya (P32, P44) saat halamannya ada */}
      <div className="kartu space-y-2">
        <h2 className="judul-kartu">Dokumen cetak</h2>
        <ul className="text-sm space-y-1">
          <li>
            <Link href={`/pengaturan/perusahaan/dokumen?perusahaan=${encodeURIComponent(perusahaan.id)}`} className="tombol-tautan">
              Dokumen &amp; nomor cetak
            </Link>
            <span className="redup"> · bawaan teks dokumen penjualan dan format nomor cetak</span>
          </li>
          <li>
            <Link href={`/pengaturan/perusahaan/kop?perusahaan=${encodeURIComponent(perusahaan.id)}`} className="tombol-tautan">
              Kop &amp; Template
            </Link>
            <span className="redup"> · kop surat, gambar, tanda tangan, dan tata letak PDF</span>
          </li>
          {punyaHak(pengguna, "pengaturan-crm.ubah") && (
            <li>
              <Link href={`/crm/pengaturan?perusahaan=${encodeURIComponent(perusahaan.id)}`} className="tombol-tautan">
                Pengaturan CRM
              </Link>
              <span className="redup"> · tahap pipeline dan sumber lead</span>
            </li>
          )}
          {perusahaan.aktif && (
            <li>
              <Link href={`/pengaturan/daftar-pilihan?perusahaan=${encodeURIComponent(perusahaan.id)}`} className="tombol-tautan">
                Daftar Pilihan
              </Link>
              <span className="redup"> · sumber lead, jenis dan pilar konten, seksi baris dokumen</span>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
