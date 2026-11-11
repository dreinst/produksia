import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { PERUSAHAAN_UTAMA, daftarPerusahaan, lingkupPerusahaan, type RingkasPerusahaan } from "@/lib/perusahaan";
import { SEKSI_BAWAAN, TEKS_PEMBUKA_BAWAAN, TEKS_PENUTUP_BAWAAN } from "@/lib/dokumenPenjualan";
import { JENIS_NOMOR_CETAK, LABEL_JENIS_NOMOR_CETAK, NOMOR_TERAKHIR_MAKS, isiPola, periodeReset, type JenisNomorCetak } from "@/lib/nomorCetak";
import { hapusFormatNomorFormulir, simpanFormatNomorFormulir, simpanPengaturanDokumenPenjualanFormulir } from "@/lib/aksi/dokumenPenjualan";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";

/*
 * Pengaturan dokumen penjualan dan format nomor cetak per perusahaan (D2 §7.7). ?perusahaan= memilih perusahaan;
 * kosong = perusahaan lingkup aktif, gabungan = utama. Diakses dari kartu "Dokumen cetak" di halaman perusahaan, tanpa
 * menu sendiri. Server memvalidasi semua isian (simpanPengaturanDokumenPenjualan, simpanFormatNomor).
 */

const CONTOH_POLA: Partial<Record<JenisNomorCetak, string>> = {
  penawaran: "{SEQ3}/DPRO/P1/{ROMAN}/{YYYY}",
  faktur: "{SEQ3}/DPRO-INV2/{ROMAN}/{YYYY}",
  kwitansi: "{SEQ3}/KWI-SHR/{ROMAN}/{YYYY}",
  "kwitansi-dp": "{SEQ3}/KWI-DP/{ROMAN}/{YYYY}",
  "tagihan-termin": "{SEQ3}/NP-INV/{ROMAN}/{YYYY}",
};

const LABEL_RESET = { TAHUNAN: "Tahunan", BULANAN: "Bulanan", TIDAK_PERNAH: "Tidak pernah" } as const;

export default async function HalamanPengaturanDokumen({ searchParams }: { searchParams: Promise<{ perusahaan?: string | string[] }> }) {
  await wajibHak("pengaturan.tulis");
  const q = await searchParams;
  const pilihan = typeof q.perusahaan === "string" ? q.perusahaan : undefined;
  const [lingkup, semua] = await Promise.all([lingkupPerusahaan(), daftarPerusahaan(true)]);
  const p: RingkasPerusahaan =
    semua.find((x) => x.id === pilihan) ?? semua.find((x) => x.id === lingkup.perusahaanId) ?? semua.find((x) => x.id === PERUSAHAAN_UTAMA) ?? semua[0];

  const hariIni = new Date();
  const [pengaturan, daftarFormat] = await Promise.all([
    db.pengaturanDokumenPenjualan.findUnique({ where: { perusahaanId: p.id } }),
    db.formatNomor.findMany({ where: { perusahaanId: p.id } }),
  ]);
  const penghitung = daftarFormat.length
    ? await db.penghitungNomor.findMany({
        where: { perusahaanId: p.id, OR: daftarFormat.map((f) => ({ kunciDeret: f.kunciDeret, periode: periodeReset(f.reset, hariIni) })) },
        select: { kunciDeret: true, periode: true, nilai: true },
      })
    : [];
  const nilaiPenghitung = (kunciDeret: string, periode: string) => penghitung.find((x) => x.kunciDeret === kunciDeret && x.periode === periode)?.nilai ?? 0;

  return (
    <div className="space-y-6 max-w-5xl">
      <KepalaHalaman
        jejak={[{ label: "Pengaturan" }, { label: "Perusahaan & Pajak", href: "/pengaturan/perusahaan" }, { label: p.kode, href: `/pengaturan/perusahaan/${p.id}` }, { label: "Dokumen & nomor cetak" }]}
        judul="Dokumen & Nomor Cetak"
        subjudul={`Bawaan teks dokumen penjualan dan format nomor cetak untuk ${p.nama}.`}
      />

      <nav className="flex flex-wrap gap-2" aria-label="Pilih perusahaan">
        {semua.map((x) => (
          <Link
            key={x.id}
            href={`/pengaturan/perusahaan/dokumen?perusahaan=${encodeURIComponent(x.id)}`}
            aria-current={x.id === p.id ? "true" : undefined}
            className={`flex items-center gap-2 rounded border px-3 py-1.5 text-sm ${x.id === p.id ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-200 hover:bg-slate-50"}`}
          >
            <LencanaPerusahaan kode={x.kode} warna={x.warna} />
            <span>
              {x.nama}
              {x.aktif ? "" : " (diarsipkan)"}
            </span>
          </Link>
        ))}
      </nav>

      <FormulirAksi key={`bawaan-${p.id}`} aksi={simpanPengaturanDokumenPenjualanFormulir} pesanSukses="Bawaan dokumen tersimpan." className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        <input type="hidden" name="perusahaanId" value={p.id} />
        <div className="md:col-span-2">
          <h2 className="judul-kartu">Bawaan dokumen penjualan</h2>
          <p className="subjudul-kartu">Isian awal formulir penawaran, pesanan, dan faktur baru. Dokumen yang sudah ada tidak berubah.</p>
        </div>
        <div className="bidang md:col-span-2">
          <label className="label" htmlFor="syaratPembayaran">
            Syarat pembayaran
          </label>
          <textarea id="syaratPembayaran" name="syaratPembayaran" rows={3} maxLength={3000} defaultValue={pengaturan?.syaratPembayaran ?? ""} className="isian" />
        </div>
        <div className="bidang">
          <label className="label" htmlFor="tampilanEvent">
            Tampilan event bawaan
          </label>
          <select id="tampilanEvent" name="tampilanEvent" defaultValue={pengaturan?.tampilanEvent ?? "RINCI"} className="isian">
            <option value="RINCI">Rinci: satu halaman</option>
            <option value="RINGKAS">Ringkas: ringkasan + lampiran RAB</option>
          </select>
        </div>
        <div className="bidang">
          <label className="label" htmlFor="daftarSeksi">
            Daftar seksi baris
          </label>
          <textarea id="daftarSeksi" name="daftarSeksi" rows={5} defaultValue={pengaturan?.daftarSeksi.join("\n") ?? ""} placeholder={SEKSI_BAWAAN.join("\n")} className="isian" />
          <span className="petunjuk">Satu seksi per baris. Kosong = daftar bawaan.</span>
        </div>
        <div className="bidang md:col-span-2">
          <label className="label" htmlFor="teksPembukaPenawaran">
            Paragraf pembuka penawaran
          </label>
          <textarea id="teksPembukaPenawaran" name="teksPembukaPenawaran" rows={3} maxLength={3000} defaultValue={pengaturan?.teksPembukaPenawaran ?? ""} placeholder={TEKS_PEMBUKA_BAWAAN} className="isian" />
          <span className="petunjuk">Kosong = teks bawaan</span>
        </div>
        <div className="bidang md:col-span-2">
          <label className="label" htmlFor="teksPenutupPenawaran">
            Paragraf penutup penawaran
          </label>
          <textarea id="teksPenutupPenawaran" name="teksPenutupPenawaran" rows={3} maxLength={3000} defaultValue={pengaturan?.teksPenutupPenawaran ?? ""} placeholder={TEKS_PENUTUP_BAWAAN} className="isian" />
          <span className="petunjuk">Kosong = teks bawaan</span>
        </div>
        <p className="petunjuk md:col-span-2">
          Management fee dicatat ke akun pemetaan tambahan &quot;Pendapatan Fee Manajemen&quot; (Pengaturan › <Link href="/pengaturan/pemetaan-akun" className="text-blue-600 hover:underline">Pemetaan Akun</Link>). Bila belum diatur, fee masuk akun pendapatan penjualan bawaan. Akun fee harus akun rinci berjenis Pendapatan di luar kelompok Diskon Penjualan dan Pendapatan Lain-lain; akun lain baru ditolak saat faktur ber-fee dicatat.
        </p>
        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama">
            Simpan bawaan
          </button>
        </div>
      </FormulirAksi>

      <section className="kartu space-y-4" aria-label="Format nomor cetak">
        <div>
          <h2 className="judul-kartu">Format nomor cetak</h2>
          <p className="subjudul-kartu">
            Nomor tampil di dokumen cetak, terpisah dari nomor internal. Jenis tanpa format atau dengan format nonaktif memakai nomor internal.
          </p>
        </div>
        <p className="petunjuk">
          Token: {"{SEQ3}"} urut 3 digit · {"{SEQ2}"} 2 digit · {"{SEQ}"} sesuai Digit · {"{YYYY}"} tahun · {"{YY}"} 2 digit tahun · {"{MM}"} bulan · {"{ROMAN}"} bulan romawi · {"{PREFIX}"} prefiks · {"{KODE}"} kode.
          Jenis yang deretnya sama berbagi urutan nomor dan wajib memakai reset yang sama.
        </p>
        <div className="space-y-4">
          {JENIS_NOMOR_CETAK.map((jenis) => {
            const f = daftarFormat.find((x) => x.jenis === jenis) ?? null;
            const label = LABEL_JENIS_NOMOR_CETAK[jenis];
            const awalan = `fmt-${jenis}`;
            const berikut = f
              ? isiPola(f.pola, { nilai: nilaiPenghitung(f.kunciDeret, periodeReset(f.reset, hariIni)) + 1, tanggal: hariIni, prefiks: f.prefiks, kode: f.kode || p.kode, digit: f.digit })
              : null;
            return (
              <div key={`${p.id}-${jenis}`} className="ubin space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-sm">
                    {label}
                    {f && !f.aktif && <span className="lencana lencana-slate ml-2">Nonaktif</span>}
                    {!f && <span className="lencana lencana-slate ml-2">Belum diatur</span>}
                  </h3>
                  {berikut && (
                    <span className="text-xs text-slate-500">
                      Nomor berikutnya: <span className="mono text-slate-800">{berikut}</span>
                    </span>
                  )}
                </div>
                <FormulirAksi aksi={simpanFormatNomorFormulir} pesanSukses={`Format nomor ${label} tersimpan.`} className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <input type="hidden" name="perusahaanId" value={p.id} />
                  <input type="hidden" name="jenis" value={jenis} />
                  <div className="bidang md:col-span-2">
                    <label className="label" htmlFor={`${awalan}-pola`}>
                      Pola *
                    </label>
                    <input id={`${awalan}-pola`} name="pola" required maxLength={60} defaultValue={f?.pola ?? ""} placeholder={CONTOH_POLA[jenis]} className="isian mono" />
                  </div>
                  <div className="bidang">
                    <label className="label" htmlFor={`${awalan}-prefiks`}>
                      Prefiks
                    </label>
                    <input id={`${awalan}-prefiks`} name="prefiks" maxLength={8} defaultValue={f?.prefiks ?? ""} className="isian mono" />
                  </div>
                  <div className="bidang">
                    <label className="label" htmlFor={`${awalan}-kode`}>
                      Kode
                    </label>
                    <input id={`${awalan}-kode`} name="kode" maxLength={12} defaultValue={f?.kode ?? ""} placeholder={p.kode} className="isian mono" />
                  </div>
                  <div className="bidang">
                    <label className="label" htmlFor={`${awalan}-digit`}>
                      Digit
                    </label>
                    <input id={`${awalan}-digit`} name="digit" type="number" min={3} max={8} step={1} defaultValue={f?.digit ?? 4} className="isian" />
                  </div>
                  <div className="bidang">
                    <label className="label" htmlFor={`${awalan}-kunciDeret`}>
                      Deret
                    </label>
                    <input id={`${awalan}-kunciDeret`} name="kunciDeret" maxLength={40} defaultValue={f?.kunciDeret ?? jenis} className="isian mono" />
                    <span className="petunjuk">Jenis yang deretnya sama berbagi urutan nomor</span>
                  </div>
                  <div className="bidang">
                    <label className="label" htmlFor={`${awalan}-reset`}>
                      Reset
                    </label>
                    <select id={`${awalan}-reset`} name="resetNomor" defaultValue={f?.reset ?? "TAHUNAN"} className="isian">
                      {(Object.keys(LABEL_RESET) as (keyof typeof LABEL_RESET)[]).map((r) => (
                        <option key={r} value={r}>
                          {LABEL_RESET[r]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="bidang">
                    <label className="label" htmlFor={`${awalan}-nomorTerakhir`}>
                      Nomor terakhir
                    </label>
                    <input id={`${awalan}-nomorTerakhir`} name="nomorTerakhir" type="number" min={0} max={NOMOR_TERAKHIR_MAKS} step={1} className="isian" />
                    <span className="petunjuk">Isi bila melanjutkan nomor manual, mis. 80</span>
                  </div>
                  <div className="md:col-span-4 flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      {/* isian tersembunyi lebih dulu: kotak tidak dicentang mengirim aktif=0 (bacaCentang membaca nilai terakhir) */}
                      <input type="hidden" name="aktif" value="0" />
                      <input type="checkbox" name="aktif" value="1" defaultChecked={f?.aktif ?? true} /> Aktif
                    </label>
                    <button type="submit" className="tombol tombol-utama tombol-kecil">
                      Simpan format
                    </button>
                  </div>
                </FormulirAksi>
                {f && (
                  <FormulirAksi aksi={hapusFormatNomorFormulir.bind(null, f.id)} pesanKonfirmasi={`Hapus format nomor ${label}? Dokumen berikutnya memakai nomor internal.`} className="inline">
                    <button type="submit" className="tombol-tautan-bahaya text-sm">
                      Hapus format
                    </button>
                  </FormulirAksi>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
