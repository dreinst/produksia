import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { LABEL_PERAN, PERAN_DAPAT_DIATUR, hakDataInduk, labelPeranPengguna, punyaHak } from "@/lib/hakAkses";
import { hitungModulProyek, penghitungTerlihat } from "@/lib/hitunganModulProyek";
import { PANJANG_NAMA_KLIEN_PROYEK, labelKlienProyek } from "@/lib/proyek";
import { formatTanggal } from "@/lib/waktu";
import { ubahTampilanProyekFormulir } from "@/lib/aksi/proyek";
import { bukaPembatasanProyekFormulir, simpanAksesBerkasProyekFormulir } from "@/lib/aksi/berkas";
import FormulirAksi from "@/komponen/FormulirAksi";
import LampiranBerkas from "@/komponen/berkas/LampiranBerkas";
import Ikon from "@/komponen/ui/Ikon";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import { LencanaStatus } from "@/komponen/ui/Lencana";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import PilihWarnaProyek from "@/komponen/proyek/PilihWarnaProyek";
import TitikWarnaProyek from "@/komponen/proyek/TitikWarnaProyek";

/*
 * Ringkasan satu proyek (D5 §7.2): pekerjaan per modul, tampilan dan klien, akses berkas proyek (D7 §3.3.7), dan berkas
 * proyek, tanpa angka keuangan. Halaman detail memakai perusahaan proyek itu sendiri, bukan lingkup aktif (D5 §4.7).
 * Kartu Dokumen mitra memberi jalan membuat talangan dan pembayaran bagi peran yang diberi hak dokumennya walau tidak
 * melihat halaman keuangan (D5 §7.2).
 */

function jadwal(mulai: Date | null, selesai: Date | null): string {
  if (mulai && selesai) return `${formatTanggal(mulai)} s.d. ${formatTanggal(selesai)}`;
  if (mulai) return formatTanggal(mulai);
  if (selesai) return formatTanggal(selesai);
  return "Tanpa jadwal";
}

// tinjauan P37 R2: aksi buat dokumen mitra mengalihkan ke sini bila pembuatnya tidak boleh membuka detail dokumen
const PESAN_TERSIMPAN: Record<string, string> = { talangan: "Talangan mitra tersimpan.", bayar: "Pembayaran ke mitra tersimpan." };

export default async function HalamanRingkasanProyek({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tersimpan?: string | string[] }> }) {
  const pengguna = await wajibHak("proyek.lihat");
  const boleh = (h: Parameters<typeof punyaHak>[1]) => punyaHak(pengguna, h);
  const { id } = await params;
  const tersimpan = (await searchParams).tersimpan;
  const pesanTersimpan = typeof tersimpan === "string" ? (PESAN_TERSIMPAN[tersimpan] ?? null) : null;
  const aksesPenuh = boleh("berkas.akses-penuh");
  const proyek = await db.proyek.findUnique({
    where: { id },
    select: {
      id: true,
      kode: true,
      nama: true,
      status: true,
      warna: true,
      namaKlien: true,
      tanggalMulai: true,
      tanggalSelesai: true,
      pelanggan: { select: { nama: true } },
      perusahaan: { select: { kode: true, nama: true, warna: true, aktif: true } },
    },
  });
  if (!proyek) notFound();
  const penghitung = penghitungTerlihat((h) => boleh(h));
  const [hitungan, akses, penggunaAktif] = await Promise.all([
    hitungModulProyek(db, [proyek.id], penghitung),
    aksesPenuh ? db.aksesBerkasProyek.findUnique({ where: { proyekId: proyek.id }, select: { peranBoleh: true, pengguna: { select: { penggunaId: true } } } }) : null,
    aksesPenuh ? db.pengguna.findMany({ where: { aktif: true }, orderBy: [{ nama: "asc" }, { id: "asc" }], select: { id: true, nama: true, peran: true, peranTambahan: true } }) : [],
  ]);
  const hitung = hitungan.get(proyek.id) ?? {};
  const klien = labelKlienProyek(proyek);
  const ubahTampilan = boleh(hakDataInduk("proyek").tulis);
  const penggunaTerpilih = new Set(akses?.pengguna.map((p) => p.penggunaId) ?? []);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Proyek & Event", href: "/proyek" }, { label: proyek.kode }]}
        judul={proyek.nama}
        subjudul={`${proyek.kode} · ${klien ?? "Tanpa klien"} · ${proyek.perusahaan.nama} · ${jadwal(proyek.tanggalMulai, proyek.tanggalSelesai)}`}
        lencana={
          <span className="flex items-center gap-2">
            <TitikWarnaProyek warna={proyek.warna} />
            <LencanaStatus status={proyek.status} />
            <LencanaPerusahaan kode={proyek.perusahaan.kode} warna={proyek.perusahaan.warna} nama={proyek.perusahaan.nama} />
            {aksesPenuh && akses && (
              <span className="lencana lencana-amber inline-flex items-center gap-1">
                <Ikon nama="lock" className="!text-[14px]" />
                Berkas dibatasi
              </span>
            )}
          </span>
        }
        aksi={
          <>
            {boleh("anggaran-proyek.lihat") && (
              <Link href={`/proyek/${proyek.id}/keuangan`} className="tombol tombol-garis">
                <Ikon nama="savings" className="!text-[18px]" />
                Keuangan
              </Link>
            )}
            {boleh("rekonsiliasi.lihat") && (
              <Link href={`/rekonsiliasi/event/${proyek.id}`} className="tombol tombol-garis">
                <Ikon nama="fact_check" className="!text-[18px]" />
                LPJ
              </Link>
            )}
            {ubahTampilan && boleh(hakDataInduk("proyek").lihat) && (
              <Link href={`/data-induk/proyek/${proyek.id}`} className="tombol tombol-garis">
                <Ikon nama="edit_note" className="!text-[18px]" />
                Ubah data proyek
              </Link>
            )}
          </>
        }
      />

      {pesanTersimpan && (
        <p role="status" className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {pesanTersimpan}
        </p>
      )}

      {penghitung.length > 0 && (
        <section className="kartu space-y-4" aria-labelledby="judul-modul">
          <h2 id="judul-modul" className="judul-kartu">
            Pekerjaan per modul
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {penghitung.map((h) => {
              const n = hitung[h.kunci] ?? { total: 0, terbuka: 0 };
              const isi = (
                <>
                  <div className="teks-label">{h.label}</div>
                  <div className="font-heading text-2xl font-bold angka mt-1 text-slate-900">{n.terbuka.toLocaleString("id-ID")}</div>
                  <div className="text-xs text-slate-500">terbuka, dari {n.total.toLocaleString("id-ID")}</div>
                </>
              );
              return h.tautan ? (
                <Link key={h.kunci} href={h.tautan(proyek.id)} className="rounded-lg border border-slate-200 p-3 hover:border-slate-400">
                  {isi}
                </Link>
              ) : (
                <div key={h.kunci} className="rounded-lg border border-slate-200 p-3">
                  {isi}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {(boleh("talangan-mitra.buat") || boleh("pembayaran-mitra.buat")) && (
        <section className="kartu space-y-3" aria-labelledby="judul-dokumen-mitra">
          <h2 id="judul-dokumen-mitra" className="judul-kartu flex items-center gap-2">
            <Ikon nama="handshake" className="!text-[20px] text-slate-500" />
            Dokumen mitra
          </h2>
          {/* tinjauan P37 S2: dokumen mitra tidak bisa dicatat untuk perusahaan yang diarsipkan */}
          {proyek.perusahaan.aktif ? (
            <div className="flex flex-wrap gap-3">
              {boleh("talangan-mitra.buat") && (
                <Link href={`/proyek/${proyek.id}/keuangan/talangan/baru`} className="tombol tombol-garis">
                  <Ikon nama="add" className="!text-[18px]" />
                  Catat talangan mitra
                </Link>
              )}
              {boleh("pembayaran-mitra.buat") && (
                <Link href={`/proyek/${proyek.id}/keuangan/bayar/baru`} className="tombol tombol-garis">
                  <Ikon nama="account_balance_wallet" className="!text-[18px]" />
                  Bayar mitra
                </Link>
              )}
            </div>
          ) : (
            <p role="status" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Perusahaan {proyek.perusahaan.nama} sudah diarsipkan; aktifkan dulu untuk mencatat dokumen mitra.
            </p>
          )}
        </section>
      )}

      <section className="kartu space-y-4" aria-labelledby="judul-tampilan">
        <h2 id="judul-tampilan" className="judul-kartu flex items-center gap-2">
          <Ikon nama="palette" className="!text-[20px] text-slate-500" />
          Tampilan &amp; klien
        </h2>
        {ubahTampilan ? (
          <FormulirAksi aksi={ubahTampilanProyekFormulir.bind(null, proyek.id)} pesanSukses="Tampilan proyek disimpan" className="space-y-4">
            <PilihWarnaProyek nilai={proyek.warna} />
            <div className="space-y-1 max-w-xl">
              <label htmlFor="nama-klien" className="label">
                Nama klien (teks bebas)
              </label>
              <input id="nama-klien" name="namaKlien" defaultValue={proyek.namaKlien ?? ""} maxLength={PANJANG_NAMA_KLIEN_PROYEK} className="isian" />
              <p className="petunjuk">Dipakai bila proyek belum ditautkan ke data Pelanggan.</p>
            </div>
            <button type="submit" className="tombol tombol-utama w-fit">
              Simpan tampilan
            </button>
          </FormulirAksi>
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="teks-label">Warna</dt>
              <dd className="mt-1 flex items-center gap-2">
                <TitikWarnaProyek warna={proyek.warna} />
                {proyek.warna ? <span className="mono">{proyek.warna}</span> : "Tanpa warna"}
              </dd>
            </div>
            <div>
              <dt className="teks-label">Klien</dt>
              <dd className="mt-1">{klien ?? "Tanpa klien"}</dd>
            </div>
          </dl>
        )}
      </section>

      {aksesPenuh && (
        <section className="kartu space-y-4" aria-labelledby="judul-akses">
          <div>
            <h2 id="judul-akses" className="judul-kartu flex items-center gap-2">
              <Ikon nama="lock" className="!text-[20px] text-slate-500" />
              Akses berkas proyek
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Berkas proyek ini (termasuk PDF penawaran, faktur, dan kuitansinya) tidak terlihat oleh siapa pun selain yang dipilih: di halaman Berkas, pencarian, lampiran, dan log aktivitas.
            </p>
          </div>
          <p className="text-sm">{akses ? <span className="lencana lencana-amber">Terbatas</span> : <span className="lencana lencana-slate">Terbuka</span>}</p>
          <FormulirAksi aksi={simpanAksesBerkasProyekFormulir.bind(null, proyek.id)} pesanSukses="Pembatasan proyek tersimpan." className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="label">Peran yang boleh</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {PERAN_DAPAT_DIATUR.map((p) => (
                  <label key={p} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="peran" value={p} defaultChecked={akses?.peranBoleh.includes(p) ?? false} className="h-4 w-4 rounded border-slate-300" />
                    {LABEL_PERAN[p]}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="label">Pengguna yang boleh</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-72 overflow-y-auto">
                {penggunaAktif.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="pengguna" value={u.id} defaultChecked={penggunaTerpilih.has(u.id)} className="h-4 w-4 rounded border-slate-300" />
                    <span className="min-w-0">
                      {u.nama} <span className="text-xs text-slate-500">· {labelPeranPengguna(u)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="petunjuk">Tidak ada yang dipilih: hanya Pemilik dan Superadmin yang bisa membuka berkas proyek ini.</p>
            <button type="submit" className="tombol tombol-utama w-fit">
              <Ikon nama="lock" className="!text-[18px]" />
              Simpan pembatasan
            </button>
          </FormulirAksi>
          {akses && (
            <FormulirAksi aksi={bukaPembatasanProyekFormulir.bind(null, proyek.id)} pesanSukses="Pembatasan proyek dibuka.">
              <button type="submit" className="tombol tombol-garis w-fit">
                Buka pembatasan
              </button>
            </FormulirAksi>
          )}
        </section>
      )}

      <LampiranBerkas jenisEntitas="proyek" entitasId={proyek.id} judul="Berkas proyek" kosong="Belum ada berkas untuk proyek ini." />
    </div>
  );
}
