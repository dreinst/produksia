import Link from "next/link";
import { notFound } from "next/navigation";
import FormulirAksi from "@/komponen/FormulirAksi";
import FormulirDataInduk from "@/komponen/data-induk/FormulirDataInduk";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import PemilihFoto from "@/komponen/ui/PemilihFoto";
import { ambilKonfigurasiEntitas } from "@/lib/konfigurasiDataInduk";
import { ambilDaftarOpsi, delegasiBaca } from "@/lib/dataInduk";
import { hapusFotoBarangFormulir, ubahDataIndukFormulir, unggahFotoBarangFormulir } from "@/lib/aksi/dataInduk";
import { wajibHak } from "@/lib/otentikasi";
import { hakDataInduk } from "@/lib/hakAkses";
import { db } from "@/lib/db";

export default async function HalamanUbahDataInduk({ params }: { params: Promise<{ entitas: string; id: string }> }) {
  const { entitas, id } = await params;
  const config = ambilKonfigurasiEntitas(entitas);
  if (!config) notFound();
  await wajibHak(hakDataInduk(entitas).tulis);

  const rekaman = await delegasiBaca(config.model).findUnique({ where: { id } });
  if (!rekaman) notFound();
  const daftarOpsi = await ambilDaftarOpsi(config);
  const judul = String(rekaman.nama ?? rekaman.kode ?? config.label);
  // Hanya id & ukuran; isi (Bytes) dilayani terpisah lewat /api/foto/[id]
  const daftarFoto = config.slug === "barang" ? await db.foto.findMany({ where: { barangId: id }, select: { id: true, ukuran: true, urutan: true }, orderBy: { urutan: "asc" } }) : null;

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Data Induk" }, { label: config.label, href: `/data-induk/${entitas}` }]}
        judul={`Ubah ${config.label}`}
        subjudul={judul}
        aksi={
          <Link href={`/data-induk/${entitas}`} className="tombol tombol-garis">
            Batal
          </Link>
        }
      />

      <FormulirDataInduk
        config={config}
        daftarOpsi={daftarOpsi}
        nilai={rekaman}
        kecualiId={id}
        aksi={ubahDataIndukFormulir.bind(null, entitas, id)}
        labelTombol="Simpan perubahan"
      >
        <span className="text-xs text-slate-500">Bidang yang dikosongkan akan dihapus nilainya.</span>
      </FormulirDataInduk>

      {daftarFoto && (
        <div id="foto" className="kartu">
          <div className="kepala-kartu">
            <h2 className="judul-kartu">Foto barang</h2>
          </div>
          {daftarFoto.length > 0 ? (
            <div className="mb-4 flex flex-wrap gap-4">
              {daftarFoto.map((f) => (
                <div key={f.id} className="flex flex-col items-center gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element -- foto privat dari API berhak akses, bukan aset statis */}
                  <img src={`/api/foto/${f.id}`} alt="" loading="lazy" className="h-20 w-20 object-cover rounded-lg border" />
                  <span className="text-xs text-slate-500">{Math.round(f.ukuran / 1000)} KB</span>
                  <FormulirAksi aksi={hapusFotoBarangFormulir.bind(null, f.id)} pesanKonfirmasi="Hapus foto ini?" className="inline">
                    <button type="submit" className="tombol-tautan-bahaya">
                      Hapus
                    </button>
                  </FormulirAksi>
                </div>
              ))}
            </div>
          ) : (
            <p className="petunjuk mb-4">Belum ada foto.</p>
          )}
          <FormulirAksi aksi={unggahFotoBarangFormulir.bind(null, id)} pesanSukses="Foto tersimpan" className="space-y-3">
            <PemilihFoto name="foto" maksimal={3} wajib label="Pilih / ambil foto" />
            <button type="submit" className="tombol tombol-utama w-full sm:w-auto min-h-11">
              Unggah foto
            </button>
          </FormulirAksi>
        </div>
      )}
    </div>
  );
}
