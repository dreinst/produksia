import Link from "next/link";
import { notFound } from "next/navigation";
import FormulirAksi from "@/komponen/FormulirAksi";
import FormulirDataInduk from "@/komponen/data-induk/FormulirDataInduk";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { ambilKonfigurasiEntitas, ambilNilai } from "@/lib/konfigurasiDataInduk";
import { ambilDaftarOpsi, delegasiBaca, includeUntukKolom, wherePencarian } from "@/lib/dataInduk";
import { bacaParamDaftar } from "@/lib/daftar";
import { buatDataIndukFormulir, hapusDataIndukFormulir } from "@/lib/aksi/dataInduk";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";

export default async function HalamanDataInduk({
  params,
  searchParams,
}: {
  params: Promise<{ entitas: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const pengguna = await wajibHak("data-induk.lihat");
  const { entitas } = await params;
  const config = ambilKonfigurasiEntitas(entitas);
  if (!config) notFound();
  // Bagan akun ikut aturan buku besar; entitas lain cukup hak data induk
  const bolehTulis = punyaHak(pengguna, entitas === "akun" ? "buku-besar.tulis" : "data-induk.tulis");

  const param = await bacaParamDaftar(searchParams);
  const where = wherePencarian(config, param.q);
  const delegasi = delegasiBaca(config.model);
  const kolomUrut = config.bidang.some((b) => b.nama === "kode") ? "kode" : "nama";
  const [total, daftar] = await Promise.all([
    delegasi.count({ where }),
    delegasi.findMany({ where, include: includeUntukKolom(config), orderBy: [{ [kolomUrut]: "asc" }], skip: param.lewati, take: param.ambil }),
  ]);
  const daftarOpsi = bolehTulis ? await ambilDaftarOpsi(config) : {};

  return (
    <div className="space-y-8">
      <h1 className="judul-halaman">{config.label}</h1>

      {bolehTulis && (
        <FormulirDataInduk
          config={config}
          daftarOpsi={daftarOpsi}
          aksi={buatDataIndukFormulir.bind(null, entitas)}
          labelTombol={`Tambah ${config.label}`}
        />
      )}

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder={`Cari ${config.label.toLowerCase()}…`} />
        <div className="bungkus-tabel">
          <table className="tabel min-w-[36rem]">
            <thead>
              <tr>
                {config.kolom.map((kolom) => (
                  <th key={kolom.key} className={config.bidang.find((b) => b.nama === kolom.key)?.jenis === "number" ? "text-right" : undefined}>
                    {kolom.label}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {daftar.map((rekaman) => (
                <tr key={String(rekaman.id)}>
                  {config.kolom.map((kolom) => {
                    const angka = config.bidang.find((b) => b.nama === kolom.key)?.jenis === "number";
                    const mentah = ambilNilai(rekaman, kolom.key);
                    return (
                      <td key={kolom.key} className={angka ? "text-right angka" : undefined}>
                        {angka ? Number(String(mentah ?? 0)).toLocaleString("id-ID") : typeof mentah === "boolean" ? (mentah ? "Ya" : "–") : String(mentah ?? "")}
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap text-right">
                    {bolehTulis ? (
                      <div className="inline-flex items-center gap-3">
                        <Link href={`/data-induk/${entitas}/${rekaman.id}`} className="tombol-tautan">
                          Ubah
                        </Link>
                        <FormulirAksi
                          aksi={hapusDataIndukFormulir.bind(null, entitas, String(rekaman.id))}
                          pesanKonfirmasi={`Hapus ${config.label} ini? Tindakan tidak bisa dibatalkan.`}
                          className="inline"
                        >
                          <button type="submit" className="tombol-tautan-bahaya">
                            Hapus
                          </button>
                        </FormulirAksi>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">hanya lihat</span>
                    )}
                  </td>
                </tr>
              ))}
              {daftar.length === 0 && (
                <tr>
                  <td colSpan={config.kolom.length + 1} className="kosong">
                    {param.q ? "Tidak ada data yang cocok." : "Belum ada data."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
