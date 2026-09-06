import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import FormulirAksi from "@/komponen/FormulirAksi";
import { ambilKonfigurasiEntitas, ambilNilai } from "@/lib/konfigurasiDataInduk";
import { buatDataIndukFormulir, hapusDataIndukFormulir } from "@/lib/aksi/dataInduk";

type DelegasiPrisma = {
  findMany: (args?: { include?: Record<string, boolean> }) => Promise<Record<string, unknown>[]>;
};

function delegasi(model: string): DelegasiPrisma {
  return (db as unknown as Record<string, DelegasiPrisma>)[model];
}

export default async function MasterEntityPage({
  params,
}: {
  params: Promise<{ entitas: string }>;
}) {
  const { entitas } = await params;
  const config = ambilKonfigurasiEntitas(entitas);
  if (!config) notFound();

  const include: Record<string, boolean> = {};
  for (const col of config.kolom) {
    if (col.key.includes(".")) include[col.key.split(".")[0]] = true;
  }

  const records = await delegasi(config.model).findMany(
    Object.keys(include).length ? { include } : undefined,
  );

  const daftarOpsi: Record<string, { id: string; label: string }[]> = {};
  for (const bidang of config.bidang) {
    if (bidang.opsi) {
      const isian = await delegasi(bidang.opsi.model).findMany();
      daftarOpsi[bidang.nama] = isian.map((r) => ({
        id: String(r[bidang.opsi!.bidangNilai]),
        label: String(r[bidang.opsi!.bidangLabel]),
      }));
    }
  }

  const buatTerikatFormulir = buatDataIndukFormulir.bind(null, entitas);

  return (
    <div className="space-y-8">
      <h1 className="judul-halaman">{config.label}</h1>

      <FormulirAksi aksi={buatTerikatFormulir} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
        {config.bidang.map((bidang) => (
          <div key={bidang.nama} className="bidang">
            <label className="label">
              {bidang.label}
              {bidang.wajib && <span className="text-red-500"> *</span>}
            </label>
            {bidang.jenis === "select" ? (
              <select
                name={bidang.nama}
                defaultValue={bidang.nilaiBawaan ?? ""}
                className="isian"
              >
                <option value="">-</option>
                {(bidang.opsiStatis
                  ? bidang.opsiStatis.map((o) => ({ id: o, label: o }))
                  : daftarOpsi[bidang.nama] ?? []
                ).map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={bidang.jenis === "number" ? "number" : "text"}
                step={bidang.jenis === "number" ? "0.01" : undefined}
                name={bidang.nama}
                required={bidang.wajib}
                defaultValue={bidang.nilaiBawaan}
                className="isian"
              />
            )}
          </div>
        ))}
        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama">
            Tambah {config.label}
          </button>
        </div>
      </FormulirAksi>

      <div className="kartu kartu-tabel"><div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            {config.kolom.map((col) => (
              <th key={col.key} className={config.bidang.find((f) => f.nama === col.key)?.jenis === "number" ? "text-right" : undefined}>
                {col.label}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {records.map((rec) => (
            <tr key={String(rec.id)}>
              {config.kolom.map((col) => {
                const isNumber = config.bidang.find((f) => f.nama === col.key)?.jenis === "number";
                const raw = ambilNilai(rec, col.key);
                return (
                  <td key={col.key} className={isNumber ? "text-right angka" : undefined}>
                    {isNumber ? Number(String(raw ?? 0)).toLocaleString("id-ID") : String(raw ?? "")}
                  </td>
                );
              })}
              <td>
                <FormulirAksi
                  aksi={hapusDataIndukFormulir.bind(null, entitas, String(rec.id))}
                  pesanKonfirmasi={`Hapus ${config.label} ini? Tindakan tidak bisa dibatalkan.`}
                >
                  <button type="submit" className="tombol-tautan-bahaya">
                    Hapus
                  </button>
                </FormulirAksi>
              </td>
            </tr>
          ))}
          {records.length === 0 && (
            <tr>
              <td colSpan={config.kolom.length + 1} className="kosong">
                Belum ada data.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
