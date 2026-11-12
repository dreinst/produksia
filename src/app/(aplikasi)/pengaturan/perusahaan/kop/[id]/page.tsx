import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { asetBawaan, folderGaya } from "@/lib/cetak/aset";
import { JUDUL_BAWAAN, LABEL_JENIS_DOKUMEN, LABEL_UKURAN, TATA_LETAK_SAH } from "@/lib/cetak/kop";
import { hapusAsetKopFormulir, hapusKopSuratFormulir, simpanTemplateCetakFormulir, ubahKopSuratFormulir } from "@/lib/aksi/kopSurat";
import type { GayaEntitas, JenisAsetKop, JenisDokumenCetak, TataLetakCetak, UkuranKertas } from "@/prisma-klien/enums";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import Ikon from "@/komponen/ui/Ikon";
import UnggahAsetKop from "@/komponen/cetak/UnggahAsetKop";

/*
 * Ubah satu kop surat (D3 §7.2): gaya, kepala dan kaki, kontak, penimpa identitas, warna; gambar kop per slot (unggah
 * lewat POST /api/cetak/kop/[kopId]/aset); template per jenis dokumen dengan tautan pratinjau contoh; hapus kop. Hak
 * pengaturan.tulis untuk halaman dan semua aksinya.
 */

const LABEL_GAYA: Record<GayaEntitas, string> = { DPRO: "D'Pro", TAPUSSA: "Tapussa", BONANOVA: "Bonanova", SAHARA: "Sahara", NAWASENA: "Nawasena" };
const GAYA: readonly GayaEntitas[] = ["DPRO", "TAPUSSA", "BONANOVA", "SAHARA", "NAWASENA"];
const TATA_LETAK_UMUM: { nilai: TataLetakCetak; label: string }[] = [
  { nilai: "HKA_STANDAR", label: "Standar" },
  { nilai: "HKA_BERMEREK", label: "Bermerek" },
  { nilai: "HKA_SURAT", label: "Surat (SPH)" },
  { nilai: "HKA_MINIMAL", label: "Minimal" },
];
const LABEL_TATA_LETAK_TEMPLATE: Record<TataLetakCetak, string> = {
  HKA_STANDAR: "Standar (HKA)",
  HKA_BERMEREK: "Bermerek (HKA)",
  HKA_SURAT: "Surat / SPH (HKA)",
  HKA_MINIMAL: "Minimal (HKA)",
  DPRO_INVOICE: "Invoice D'Pro",
  DPRO_PROPOSAL: "Proposal anggaran D'Pro",
  KWITANSI_ENTITAS: "Kwitansi entitas",
  KWITANSI_POLOS: "Kwitansi polos",
};
const JENIS_TEMPLATE: { jenis: JenisDokumenCetak; label: string }[] = [
  { jenis: "PENAWARAN", label: "Penawaran" },
  { jenis: "TAGIHAN_TERMIN", label: "Tagihan termin" },
  { jenis: "FAKTUR", label: "Invoice (faktur)" },
  { jenis: "KWITANSI", label: "Kwitansi pelunasan" },
  { jenis: "KWITANSI_DP", label: "Kwitansi uang muka" },
];
const SLOT: { jenis: JenisAsetKop; label: string }[] = [
  { jenis: "KOP", label: "Kop atas" },
  { jenis: "KAKI", label: "Kaki" },
  { jenis: "WATERMARK", label: "Watermark" },
  { jenis: "LOGO", label: "Logo" },
  { jenis: "JUDUL_INVOICE", label: "Judul INVOICE" },
  { jenis: "JUDUL_KWITANSI", label: "Judul KWITANSI" },
  { jenis: "LABEL_PEMBAYARAN", label: "Label PAYMENT METHOD" },
  { jenis: "LABEL_SALAM", label: 'Label salam ("Hormat kami,")' },
  { jenis: "TANDA_TANGAN", label: "Tanda tangan (+ cap)" },
  { jenis: "STEMPEL", label: "Stempel / e-meterai" },
];
const UKURAN: UkuranKertas[] = ["A4", "A5", "A5_LANDSCAPE"];

type KolomIsian = { nama: string; label: string; maks: number; placeholder?: string | null; textarea?: boolean };

function Isian({ k, nilai }: { k: KolomIsian; nilai: string | null }) {
  return (
    <div className={`bidang${k.textarea ? " md:col-span-2" : ""}`}>
      <label className="label" htmlFor={k.nama}>
        {k.label}
      </label>
      {k.textarea ? (
        <textarea id={k.nama} name={k.nama} defaultValue={nilai ?? ""} maxLength={k.maks} placeholder={k.placeholder ?? undefined} className="isian h-auto min-h-24 py-2" />
      ) : (
        <input id={k.nama} name={k.nama} defaultValue={nilai ?? ""} maxLength={k.maks} placeholder={k.placeholder ?? undefined} className="isian" />
      )}
    </div>
  );
}

export default async function HalamanUbahKopSurat({ params }: { params: Promise<{ id: string }> }) {
  await wajibHak("pengaturan.tulis");
  const { id } = await params;
  const kop = await db.kopSurat.findUnique({
    where: { id },
    include: {
      perusahaan: true,
      template: true,
      aset: { where: { berkas: { dihapusPada: null } }, select: { jenis: true, berkasId: true, lebarPx: true, tinggiPx: true } },
    },
  });
  if (!kop || kop.dihapusPada) notFound();
  const p = kop.perusahaan;
  const labelGaya = kop.gayaEntitas ? LABEL_GAYA[kop.gayaEntitas] : "Generik";

  const kelompokKepala: KolomIsian[] = [
    { nama: "judulMerek", label: "Judul merek", maks: 60, placeholder: p.nama },
    { nama: "teksKepala", label: "Tagline kepala", maks: 120 },
    { nama: "facebook", label: "Facebook", maks: 60 },
    { nama: "alamatKaki", label: "Alamat di pita kaki", maks: 200 },
    { nama: "teksKaki", label: "Teks kaki", maks: 150 },
  ];
  const kelompokKontak: KolomIsian[] = [
    { nama: "teksSalam", label: "Salam penutup", maks: 120, placeholder: "Hormat kami," },
    { nama: "namaKontak", label: "Nama kontak (Nb. proposal)", maks: 80, placeholder: p.penandaTangan },
    { nama: "teleponKontak", label: "Telepon kontak", maks: 40, placeholder: p.telepon },
    { nama: "singkatanBank", label: "Singkatan bank (kwitansi)", maks: 20, placeholder: p.namaBank },
    { nama: "catatanBank", label: "Catatan rekening", maks: 120 },
  ];
  const kelompokPenimpa: KolomIsian[] = [
    { nama: "namaLegal", label: "Nama legal", maks: 200, placeholder: p.namaLegal ?? p.nama },
    { nama: "alamat", label: "Alamat", maks: 1000, placeholder: p.alamat, textarea: true },
    { nama: "kota", label: "Kota", maks: 200, placeholder: p.kota },
    { nama: "telepon", label: "Telepon", maks: 40, placeholder: p.telepon },
    { nama: "email", label: "Email", maks: 200, placeholder: p.email },
    { nama: "website", label: "Website", maks: 200, placeholder: p.website },
    { nama: "instagram", label: "Instagram", maks: 200, placeholder: p.instagram },
    { nama: "npwp", label: "NPWP", maks: 40, placeholder: p.npwp },
    { nama: "namaBank", label: "Nama bank", maks: 200, placeholder: p.namaBank },
    { nama: "cabangBank", label: "Cabang", maks: 200, placeholder: p.cabangBank },
    { nama: "nomorRekening", label: "Nomor rekening", maks: 40, placeholder: p.nomorRekening },
    { nama: "atasNamaRekening", label: "Atas nama", maks: 200, placeholder: p.atasNamaRekening },
    { nama: "penandaTangan", label: "Penanda tangan", maks: 200, placeholder: p.penandaTangan },
    { nama: "jabatanPenandaTangan", label: "Jabatan", maks: 200, placeholder: p.jabatanPenandaTangan },
  ];
  const warna = [
    { nama: "warnaAksen", label: "Warna aksen (kepala tabel)" },
    { nama: "warnaUtama", label: "Warna utama (judul, garis)" },
    { nama: "warnaSekunder", label: "Warna sekunder (baris total)" },
    { nama: "warnaLembut", label: "Warna latar lembut" },
    { nama: "warnaTinta", label: "Warna teks" },
  ] as const;
  const nilaiKop = kop as unknown as Record<string, string | null>;
  const template = new Map(kop.template.map((t) => [t.jenis, t]));
  const aset = new Map(kop.aset.map((a) => [a.jenis, a]));
  const hapusKop = (
    <FormulirAksi aksi={hapusKopSuratFormulir.bind(null, kop.id)} pesanKonfirmasi={`Hapus kop ${kop.nama}? Dokumen yang memakai kop ini akan dicetak dengan kop bawaan perusahaan.`}>
      <button type="submit" className="tombol tombol-bahaya">
        <Ikon nama="delete" className="!text-[18px]" />
        Hapus kop
      </button>
    </FormulirAksi>
  );

  return (
    <div className="space-y-6 max-w-5xl">
      <KepalaHalaman
        jejak={[
          { label: "Pengaturan" },
          { label: "Perusahaan & Pajak", href: "/pengaturan/perusahaan" },
          { label: p.kode, href: `/pengaturan/perusahaan/${p.id}` },
          { label: "Kop & Template", href: `/pengaturan/perusahaan/kop?perusahaan=${encodeURIComponent(p.id)}` },
          { label: kop.nama },
        ]}
        judul={kop.nama}
        subjudul={`${p.nama} · gaya ${labelGaya}`}
        lencana={kop.bawaan ? <span className="lencana lencana-emerald">Bawaan</span> : undefined}
      />

      <FormulirAksi aksi={ubahKopSuratFormulir.bind(null, kop.id)} pesanSukses="Kop surat tersimpan." className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        <input type="hidden" name="kotakTampil" value="1" />
        <div className="md:col-span-2">
          <h2 className="judul-kartu">Gaya, kop, dan penimpa identitas</h2>
        </div>
        <p className="teks-label md:col-span-2">Gaya</p>
        <div className="bidang">
          <label className="label" htmlFor="nama">
            Nama kop *
          </label>
          <input id="nama" name="nama" required maxLength={80} defaultValue={kop.nama} className="isian" />
        </div>
        <div className="bidang">
          <label className="label" htmlFor="gayaEntitas">
            Gaya entitas
          </label>
          <select id="gayaEntitas" name="gayaEntitas" defaultValue={kop.gayaEntitas ?? ""} className="isian">
            <option value="">Generik</option>
            {GAYA.map((g) => (
              <option key={g} value={g}>
                {LABEL_GAYA[g]}
              </option>
            ))}
          </select>
        </div>
        <div className="bidang">
          <label className="label" htmlFor="tataLetakUmum">
            Tata letak umum
          </label>
          <select id="tataLetakUmum" name="tataLetakUmum" defaultValue={kop.tataLetakUmum} className="isian">
            {TATA_LETAK_UMUM.map((t) => (
              <option key={t.nilai} value={t.nilai}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <p className="teks-label md:col-span-2">Kepala &amp; kaki</p>
        {kelompokKepala.map((k) => (
          <Isian key={k.nama} k={k} nilai={nilaiKop[k.nama]} />
        ))}
        <p className="teks-label md:col-span-2">Salam &amp; kontak</p>
        {kelompokKontak.map((k) => (
          <Isian key={k.nama} k={k} nilai={nilaiKop[k.nama]} />
        ))}
        <div className="md:col-span-2">
          <p className="teks-label">Penimpa identitas</p>
          <span className="petunjuk">Kosongkan untuk memakai data perusahaan.</span>
        </div>
        {kelompokPenimpa.map((k) => (
          <Isian key={k.nama} k={k} nilai={nilaiKop[k.nama]} />
        ))}
        <p className="teks-label md:col-span-2">Warna &amp; tampilan</p>
        {warna.map((w) => (
          <div key={w.nama} className="bidang">
            <label className="label" htmlFor={w.nama}>
              {w.label}
            </label>
            <input id={w.nama} name={w.nama} type="color" defaultValue={(nilaiKop[w.nama] ?? "#111111").toLowerCase()} className="isian h-11 w-24 p-1" />
          </div>
        ))}
        <div className="bidang md:col-span-2 flex flex-wrap gap-6">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" name="tampilLogo" defaultChecked={kop.tampilLogo} />
            Tampilkan logo (tata letak Standar)
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" name="tampilWatermark" defaultChecked={kop.tampilWatermark} />
            Watermark logo pudar
          </label>
        </div>
        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama w-full sm:w-auto min-h-11">
            Simpan kop
          </button>
        </div>
      </FormulirAksi>

      <div className="kartu kartu-tabel">
        <div className="kepala-kartu">
          <div>
            <h2 className="judul-kartu">Gambar kop</h2>
            <p className="subjudul-kartu">
              Kop dan kaki selebar halaman (2480 px untuk A4) menempel tepi kertas. Tanda tangan sebaiknya PNG transparan rasio sekitar 1000:560 dan boleh berisi cap; hanya tercetak pada dokumen yang sudah disetujui, oleh peran yang berhak. Semua gambar disimpan privat.
            </p>
          </div>
        </div>
        <div className="bungkus-tabel">
          <table className="tabel min-w-[44rem]">
            <thead>
              <tr>
                <th>Gambar</th>
                <th>Sumber</th>
                <th>Pratinjau</th>
                <th>Ukuran</th>
                <th className="th-lekat">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {SLOT.map((s) => {
                const unggahan = aset.get(s.jenis);
                const bawaan = !unggahan && kop.gayaEntitas && asetBawaan(kop.gayaEntitas, s.jenis) ? kop.gayaEntitas : null;
                const src = unggahan ? `/api/berkas/${unggahan.berkasId}` : bawaan ? `/cetak/aset-bawaan/${folderGaya(bawaan)}/${s.jenis}` : null;
                return (
                  <tr key={s.jenis}>
                    <td>{s.label}</td>
                    <td>
                      {unggahan ? (
                        <span className="lencana lencana-emerald">Unggahan</span>
                      ) : bawaan ? (
                        <span className="lencana lencana-blue">Bawaan {LABEL_GAYA[bawaan]}</span>
                      ) : (
                        <span className="lencana lencana-slate">Kosong</span>
                      )}
                    </td>
                    <td>
                      {src ? (
                        // eslint-disable-next-line @next/next/no-img-element -- gambar kop privat dari rute berhak akses, bukan aset statis
                        <img src={src} alt={`Pratinjau ${s.label}`} className="h-10 w-auto max-w-[12rem] object-contain" loading="lazy" />
                      ) : (
                        <span className="redup">-</span>
                      )}
                    </td>
                    <td className="angka">{unggahan ? `${unggahan.lebarPx} × ${unggahan.tinggiPx} px` : "-"}</td>
                    <td className="td-lekat">
                      <div className="flex flex-col items-start gap-2">
                        <UnggahAsetKop kopId={kop.id} jenis={s.jenis} label={s.label} />
                        {unggahan && (
                          <FormulirAksi aksi={hapusAsetKopFormulir.bind(null, kop.id, s.jenis)} pesanKonfirmasi={`Hapus unggahan ${s.label}? Berkasnya dipindah ke Sampah.`}>
                            <button type="submit" className="tombol-tautan-bahaya">
                              Hapus unggahan
                            </button>
                          </FormulirAksi>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <FormulirAksi aksi={simpanTemplateCetakFormulir.bind(null, kop.id)} pesanSukses="Template tersimpan." className="kartu kartu-tabel">
        <div className="kepala-kartu">
          <div>
            <h2 className="judul-kartu">Template per jenis dokumen</h2>
            <p className="subjudul-kartu">Tata letak kosong mengikuti tata letak umum kop. Contoh dibuka di tab baru dengan data contoh berstempel CONTOH.</p>
          </div>
        </div>
        <div className="bungkus-tabel">
          <table className="tabel min-w-[56rem]">
            <thead>
              <tr>
                <th>Dokumen</th>
                <th>Tata letak</th>
                <th>Ukuran</th>
                <th>Format angka</th>
                <th>Judul</th>
                <th>Tanda tangan</th>
                <th>Contoh</th>
              </tr>
            </thead>
            <tbody>
              {JENIS_TEMPLATE.map(({ jenis, label }) => {
                const t = template.get(jenis);
                return (
                  <tr key={jenis}>
                    <td>{label}</td>
                    <td>
                      <select name={`tataLetak_${jenis}`} defaultValue={t?.tataLetak ?? ""} aria-label={`Tata letak ${label}`} className="isian">
                        <option value="">Ikuti tata letak umum</option>
                        {TATA_LETAK_SAH[jenis].map((x) => (
                          <option key={x} value={x}>
                            {LABEL_TATA_LETAK_TEMPLATE[x]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select name={`ukuran_${jenis}`} defaultValue={t?.ukuran ?? "A4"} aria-label={`Ukuran ${label}`} className="isian">
                        {UKURAN.map((u) => (
                          <option key={u} value={u}>
                            {LABEL_UKURAN[u]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select name={`gayaAngka_${jenis}`} defaultValue={t?.gayaAngka ?? ""} aria-label={`Format angka ${label}`} className="isian">
                        <option value="">Bawaan</option>
                        <option value="TITIK">Titik (1.234.567)</option>
                        <option value="KOMA">Koma (1,234,567)</option>
                      </select>
                    </td>
                    <td>
                      <input name={`judul_${jenis}`} defaultValue={t?.judul ?? ""} maxLength={60} placeholder={JUDUL_BAWAAN[jenis]} aria-label={`Judul ${label}`} className="isian" />
                    </td>
                    <td className="text-center">
                      <input type="hidden" name={`ttd_${jenis}`} value="0" />
                      <input type="checkbox" name={`ttd_${jenis}`} value="1" defaultChecked={t?.tandaTanganBawaan ?? true} aria-label={`Tanda tangan ${label}`} />
                    </td>
                    <td>
                      <a href={`/cetak/contoh/${kop.id}?jenis=${jenis}`} target="_blank" rel="noopener" className="tombol-tautan inline-flex items-center gap-1" title={`Contoh ${LABEL_JENIS_DOKUMEN[jenis].toLocaleLowerCase("id-ID")}`}>
                        <Ikon nama="open_in_new" className="!text-[16px]" />
                        Lihat contoh
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="p-4">
          <button type="submit" className="tombol tombol-utama w-full sm:w-auto min-h-11">
            Simpan template
          </button>
        </div>
      </FormulirAksi>

      <div className="kartu space-y-2 border-rose-200">
        <h2 className="judul-kartu">Hapus kop</h2>
        <p className="text-sm text-slate-600">Kop yang dihapus tidak bisa dipilih lagi. Dokumen yang memakainya dicetak dengan kop bawaan perusahaan.</p>
        {hapusKop}
      </div>

      <p className="text-sm">
        <Link href={`/pengaturan/perusahaan/kop?perusahaan=${encodeURIComponent(p.id)}`} className="tombol-tautan">
          Kembali ke daftar kop
        </Link>
      </p>
    </div>
  );
}
