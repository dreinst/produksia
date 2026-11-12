import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { daftarPerusahaan, lingkupPerusahaan } from "@/lib/perusahaan";
import { SUMBER_BAWAAN } from "@/lib/crm";
import { SEKSI_BAWAAN } from "@/lib/dokumenPenjualan";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import Ikon from "@/komponen/ui/Ikon";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import PengaturanDaftarPemasaran from "@/komponen/pemasaran/PengaturanDaftarPemasaran";

/*
 * Daftar Pilihan (D7 §3.8, §7.7, D6 §7.9, DESAIN R11): satu halaman untuk daftar pilihan per perusahaan yang
 * datanya milik domain masing-masing. Jenis dan pilar konten memakai editor D6 (PengaturanDaftarPemasaran). Sumber
 * lead (D4) dan seksi baris dokumen (D2) hanya punya halaman sendiri, jadi di sini berupa ringkasan dengan tautan
 * "Ubah". Halaman ini tidak punya aksi server sendiri dan tidak menulis data (bawaan hanya ditampilkan).
 * ?perusahaan= memilih perusahaan aktif; kosong = lingkup aktif, gabungan = "Pilih perusahaan dulu", perusahaan arsip
 * atau id tak dikenal = kotak amber tanpa editor.
 */

export default async function HalamanDaftarPilihan({ searchParams }: { searchParams: Promise<{ perusahaan?: string | string[] }> }) {
  const pengguna = await wajibHak("pengaturan.tulis");
  const q = await searchParams;
  const pilihan = typeof q.perusahaan === "string" ? q.perusahaan : undefined;
  const [lingkup, aktif, semua] = await Promise.all([lingkupPerusahaan(), daftarPerusahaan(), daftarPerusahaan(true)]);
  // ?perusahaan= yang diisi tidak pernah jatuh ke lingkup: perusahaan arsip atau id tak dikenal memberi kotak amber
  // (perbaikan tinjauan P44 R1). Tanpa ?perusahaan= atau dengan nilai kosong, lingkup aktif dipakai; lingkup perusahaan
  // arsip juga diberi tahu.
  const diminta = pilihan || lingkup.perusahaanId || undefined;
  const p = diminta ? (aktif.find((x) => x.id === diminta) ?? null) : null;
  const arsip = diminta && !p ? (semua.find((x) => x.id === diminta) ?? null) : null;
  const tidakDikenal = !!pilihan && !p && !arsip;
  const bolehCrm = punyaHak(pengguna, "pengaturan-crm.ubah");

  const [sumber, dokumen] = p
    ? await Promise.all([
        bolehCrm ? db.sumberLead.findMany({ where: { perusahaanId: p.id }, orderBy: [{ urutan: "asc" }, { nama: "asc" }], select: { nama: true } }) : Promise.resolve([]),
        db.pengaturanDokumenPenjualan.findUnique({ where: { perusahaanId: p.id }, select: { daftarSeksi: true } }),
      ])
    : [[], null];
  const daftarSumber = sumber.length ? sumber.map((s) => s.nama) : [...SUMBER_BAWAAN];
  const daftarSeksi = dokumen?.daftarSeksi.length ? dokumen.daftarSeksi : [...SEKSI_BAWAAN];
  const qp = p ? `?perusahaan=${encodeURIComponent(p.id)}` : "";

  return (
    <div className="space-y-6 max-w-5xl">
      <KepalaHalaman
        jejak={[{ label: "Pengaturan" }, { label: "Daftar Pilihan" }]}
        judul="Daftar Pilihan"
        subjudul="Pilihan yang dipakai formulir modul: sumber lead, jenis dan pilar konten, serta seksi baris dokumen. Berlaku per perusahaan."
      />

      <nav className="flex flex-wrap gap-2" aria-label="Pilih perusahaan">
        {aktif.map((x) => (
          <Link
            key={x.id}
            href={`/pengaturan/daftar-pilihan?perusahaan=${encodeURIComponent(x.id)}`}
            aria-current={x.id === p?.id ? "true" : undefined}
            className={`flex items-center gap-2 rounded border px-3 py-1.5 text-sm ${x.id === p?.id ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-200 hover:bg-slate-50"}`}
          >
            <LencanaPerusahaan kode={x.kode} warna={x.warna} />
            <span>{x.nama}</span>
          </Link>
        ))}
      </nav>

      {arsip ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Perusahaan {arsip.nama} sudah diarsipkan. Aktifkan dulu untuk mengubah daftarnya, atau pilih perusahaan lain di atas.
        </p>
      ) : tidakDikenal ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Perusahaan tidak dikenal. Pilih perusahaan dari daftar di atas.</p>
      ) : !p ? (
        <div className="kartu text-sm text-slate-600">Pilih perusahaan dulu. Daftar pilihan diatur per perusahaan.</div>
      ) : (
        <>
          {bolehCrm && (
            <section className="kartu space-y-3" aria-labelledby="judul-sumber-lead">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h2 id="judul-sumber-lead" className="judul-kartu">
                    Sumber lead
                  </h2>
                  <p className="subjudul-kartu">
                    Pilihan sumber di formulir lead {p.nama}.{" "}
                    {sumber.length ? "" : "Belum diatur, jadi yang tampil adalah daftar bawaan. "}
                    Tahap pipeline diatur di{" "}
                    <Link href={`/crm/pengaturan${qp}`} className="tombol-tautan">
                      Pengaturan CRM
                    </Link>
                    .
                  </p>
                </div>
                <Link href={`/crm/pengaturan${qp}`} className="tombol tombol-garis">
                  <Ikon nama="edit" className="!text-[18px]" /> Ubah
                </Link>
              </div>
              <ul className="flex flex-wrap gap-2" aria-label="Sumber lead">
                {daftarSumber.map((n) => (
                  <li key={n} className="lencana lencana-slate">
                    {n}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="kartu space-y-3" aria-labelledby="judul-daftar-pemasaran">
            <div className="space-y-1">
              <h2 id="judul-daftar-pemasaran" className="judul-kartu">
                Jenis &amp; pilar konten
              </h2>
              <p className="subjudul-kartu">Pilihan jenis dan pilar di formulir Perencana Konten {p.nama}.</p>
            </div>
            <PengaturanDaftarPemasaran key={p.id} perusahaanId={p.id} />
          </section>

          <section className="kartu space-y-3" aria-labelledby="judul-seksi-dokumen">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 id="judul-seksi-dokumen" className="judul-kartu">
                  Seksi baris dokumen
                </h2>
                <p className="subjudul-kartu">
                  Pilihan seksi untuk mengelompokkan baris dokumen penjualan {p.nama}.{" "}
                  {dokumen?.daftarSeksi.length ? "" : "Belum diatur, jadi yang tampil adalah daftar bawaan."}
                </p>
              </div>
              <Link href={`/pengaturan/perusahaan/dokumen${qp}`} className="tombol tombol-garis">
                <Ikon nama="edit" className="!text-[18px]" /> Ubah
              </Link>
            </div>
            <ul className="flex flex-wrap gap-2" aria-label="Seksi baris dokumen">
              {daftarSeksi.map((n, i) => (
                <li key={`${i}-${n}`} className="lencana lencana-slate">
                  {n}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
