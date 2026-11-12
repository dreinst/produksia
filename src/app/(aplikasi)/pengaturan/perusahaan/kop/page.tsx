import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { PERUSAHAAN_UTAMA, daftarPerusahaan, lingkupPerusahaan, type RingkasPerusahaan } from "@/lib/perusahaan";
import { formatTanggal } from "@/lib/waktu";
import { LABEL_TATA_LETAK, LABEL_UKURAN, PRESET_PERUSAHAAN } from "@/lib/cetak/kop";
import { buatKopSuratFormulir, hapusKopSuratFormulir, jadikanKopBawaanFormulir } from "@/lib/aksi/kopSurat";
import type { GayaEntitas } from "@/prisma-klien/enums";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";

/*
 * Daftar kop surat satu perusahaan (D3 §7.2). ?perusahaan= memilih perusahaan; kosong = lingkup aktif, gabungan =
 * utama. Tanpa menu sendiri: dibuka dari kartu "Dokumen cetak" di halaman perusahaan. Semua aksi lewat
 * src/lib/aksi/kopSurat.ts (pengaturan.tulis).
 */

const LABEL_GAYA: Record<GayaEntitas, string> = { DPRO: "D'Pro", TAPUSSA: "Tapussa", BONANOVA: "Bonanova", SAHARA: "Sahara", NAWASENA: "Nawasena" };

const PILIHAN_PRESET: { nilai: string; label: string }[] = [
  { nilai: "GENERIK", label: "Kosong (tata letak HKA)" },
  { nilai: "DPRO", label: "D'Pro (DPRO)" },
  { nilai: "TAPUSSA", label: "Tapussa Bhallika" },
  { nilai: "BONANOVA", label: "Bonanova Music" },
  { nilai: "SAHARA", label: "Sahara Food" },
  { nilai: "SMARA", label: "SMARA" },
  { nilai: "NAWASENA", label: "Nawasena Production" },
];

export default async function HalamanKopSurat({ searchParams }: { searchParams: Promise<{ perusahaan?: string | string[] }> }) {
  await wajibHak("pengaturan.tulis");
  const q = await searchParams;
  const pilihan = typeof q.perusahaan === "string" ? q.perusahaan : undefined;
  const [lingkup, semua] = await Promise.all([lingkupPerusahaan(), daftarPerusahaan(true)]);
  const p: RingkasPerusahaan =
    semua.find((x) => x.id === pilihan) ?? semua.find((x) => x.id === lingkup.perusahaanId) ?? semua.find((x) => x.id === PERUSAHAAN_UTAMA) ?? semua[0];

  const daftar = await db.kopSurat.findMany({
    where: { perusahaanId: p.id, dihapusPada: null },
    orderBy: [{ bawaan: "desc" }, { nama: "asc" }, { id: "asc" }],
    include: {
      template: { where: { jenis: { in: ["FAKTUR", "KWITANSI"] } }, select: { jenis: true, tataLetak: true, ukuran: true } },
      aset: { where: { jenis: "TANDA_TANGAN", berkas: { dihapusPada: null } }, select: { id: true } },
    },
  });
  const ringkasTemplate = (k: (typeof daftar)[number], jenis: "FAKTUR" | "KWITANSI") => {
    const t = k.template.find((x) => x.jenis === jenis);
    return t ? `${LABEL_TATA_LETAK[t.tataLetak]} ${LABEL_UKURAN[t.ukuran]}` : `${LABEL_TATA_LETAK[k.tataLetakUmum]} A4 (umum)`;
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <KepalaHalaman
        jejak={[{ label: "Pengaturan" }, { label: "Perusahaan & Pajak", href: "/pengaturan/perusahaan" }, { label: p.kode, href: `/pengaturan/perusahaan/${p.id}` }, { label: "Kop & Template" }]}
        judul="Kop & Template Cetak"
        subjudul={`Kop surat, gambar, tanda tangan, dan tata letak PDF untuk ${p.nama}. Identitas dan rekening bawaan diambil dari data perusahaan.`}
      />

      <nav className="flex flex-wrap gap-2" aria-label="Pilih perusahaan">
        {semua.map((x) => (
          <Link
            key={x.id}
            href={`/pengaturan/perusahaan/kop?perusahaan=${encodeURIComponent(x.id)}`}
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

      {p.aktif && (
        <FormulirAksi key={`baru-${p.id}`} aksi={buatKopSuratFormulir} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
          <input type="hidden" name="perusahaanId" value={p.id} />
          <div className="md:col-span-2">
            <h2 className="judul-kartu">Kop baru</h2>
          </div>
          <div className="bidang">
            <label className="label" htmlFor="nama">
              Nama kop *
            </label>
            <input id="nama" name="nama" required maxLength={80} className="isian" placeholder="mis. Kop utama" />
          </div>
          <div className="bidang">
            <label className="label" htmlFor="preset">
              Mulai dari
            </label>
            <select id="preset" name="preset" defaultValue={PRESET_PERUSAHAAN[p.id] ?? "GENERIK"} className="isian">
              {PILIHAN_PRESET.map((x) => (
                <option key={x.nilai} value={x.nilai}>
                  {x.label}
                </option>
              ))}
            </select>
            <span className="petunjuk">Preset mengisi gaya, warna, dan template sesuai dokumen D&apos;Pro. Gambar tanda tangan diunggah terpisah.</span>
          </div>
          <div className="md:col-span-2">
            <button type="submit" className="tombol tombol-utama w-full sm:w-auto min-h-11">
              Buat kop
            </button>
          </div>
        </FormulirAksi>
      )}

      <div className="kartu kartu-tabel">
        <div className="bungkus-tabel">
          <table className="tabel min-w-[44rem]">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Gaya</th>
                <th>Invoice</th>
                <th>Kwitansi</th>
                <th>Tanda tangan</th>
                <th>Diubah</th>
                <th className="th-lekat">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {daftar.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-slate-500">
                    Belum ada kop surat. Tanpa kop, dokumen dicetak polos dengan identitas perusahaan.
                  </td>
                </tr>
              ) : (
                daftar.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <span className="font-medium">{k.nama}</span>
                      {k.bawaan && <span className="lencana lencana-emerald ml-2">Bawaan</span>}
                    </td>
                    <td>
                      <span className="lencana lencana-slate">{k.gayaEntitas ? LABEL_GAYA[k.gayaEntitas] : "Generik"}</span>
                    </td>
                    <td>{ringkasTemplate(k, "FAKTUR")}</td>
                    <td>{ringkasTemplate(k, "KWITANSI")}</td>
                    <td>{k.aset.length ? "Ada" : "Belum"}</td>
                    <td>{formatTanggal(k.diubahPada)}</td>
                    <td className="td-lekat">
                      <div className="flex flex-wrap items-center gap-3">
                        <Link href={`/pengaturan/perusahaan/kop/${k.id}`} className="tombol-tautan">
                          Ubah
                        </Link>
                        {!k.bawaan && (
                          <FormulirAksi aksi={jadikanKopBawaanFormulir.bind(null, k.id)} pesanSukses={`${k.nama} menjadi kop bawaan.`}>
                            <button type="submit" className="tombol-tautan">
                              Jadikan bawaan
                            </button>
                          </FormulirAksi>
                        )}
                        <FormulirAksi aksi={hapusKopSuratFormulir.bind(null, k.id)} pesanKonfirmasi={`Hapus kop ${k.nama}? Dokumen yang memakai kop ini akan dicetak dengan kop bawaan perusahaan.`}>
                          <button type="submit" className="tombol-tautan-bahaya">
                            Hapus
                          </button>
                        </FormulirAksi>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
