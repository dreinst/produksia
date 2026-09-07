import Link from "next/link";
import { notFound } from "next/navigation";
import FormulirDataInduk from "@/komponen/data-induk/FormulirDataInduk";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import { ambilKonfigurasiEntitas } from "@/lib/konfigurasiDataInduk";
import { ambilDaftarOpsi, delegasiBaca } from "@/lib/dataInduk";
import { ubahDataIndukFormulir } from "@/lib/aksi/dataInduk";
import { wajibHak } from "@/lib/otentikasi";

export default async function HalamanUbahDataInduk({ params }: { params: Promise<{ entitas: string; id: string }> }) {
  const { entitas, id } = await params;
  const config = ambilKonfigurasiEntitas(entitas);
  if (!config) notFound();
  await wajibHak(entitas === "akun" ? "buku-besar.tulis" : "data-induk.tulis");

  const rekaman = await delegasiBaca(config.model).findUnique({ where: { id } });
  if (!rekaman) notFound();
  const daftarOpsi = await ambilDaftarOpsi(config);
  const judul = String(rekaman.nama ?? rekaman.kode ?? config.label);

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
    </div>
  );
}
