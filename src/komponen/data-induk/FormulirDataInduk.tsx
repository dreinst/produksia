import FormulirAksi from "@/komponen/FormulirAksi";
import type { KonfigurasiEntitas } from "@/lib/konfigurasiDataInduk";
import type { StatusFormulir } from "@/lib/statusFormulir";

export type DaftarOpsi = Record<string, { id: string; label: string }[]>;

/**
 * Formulir tambah/ubah data induk yang dibangun dari konfigurasi entitas.
 * `nilai` = record yang sedang diubah (kosongkan untuk tambah baru).
 * `kecualiId` = id yang disembunyikan dari pilihan induk (mencegah induk = diri sendiri).
 */
export default function FormulirDataInduk({
  config,
  daftarOpsi,
  aksi,
  nilai,
  kecualiId,
  labelTombol,
  className,
  children,
}: {
  config: KonfigurasiEntitas;
  daftarOpsi: DaftarOpsi;
  aksi: (sebelumnya: StatusFormulir, dataFormulir: FormData) => Promise<StatusFormulir>;
  nilai?: Record<string, unknown>;
  kecualiId?: string;
  labelTombol: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const bacaAwal = (nama: string, bawaan?: string) => {
    if (!nilai) return bawaan ?? "";
    const v = nilai[nama];
    return v === null || v === undefined ? "" : String(v);
  };
  const awalanId = nilai ? `ubah-${config.slug}` : `tambah-${config.slug}`;

  return (
    <FormulirAksi aksi={aksi} className={className ?? "kartu grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl"}>
      {config.bidang.map((bidang) => {
        const id = `${awalanId}-${bidang.nama}`;
        return (
          <div key={bidang.nama} className="bidang">
            <label className="label" htmlFor={id}>
              <span>
                {bidang.label}
                {bidang.wajib && <span className="text-rose-500"> *</span>}
              </span>
            </label>
            {bidang.jenis === "select" ? (
              <select id={id} name={bidang.nama} defaultValue={bacaAwal(bidang.nama, bidang.nilaiBawaan)} className="isian">
                <option value="">-</option>
                {(bidang.opsiStatis
                  ? bidang.opsiStatis.map((o) => ({ id: o, label: o }))
                  : (daftarOpsi[bidang.nama] ?? []).filter((o) => o.id !== kecualiId)
                ).map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                type={bidang.jenis === "number" ? "number" : "text"}
                step={bidang.jenis === "number" ? "0.01" : undefined}
                name={bidang.nama}
                required={bidang.wajib}
                defaultValue={bacaAwal(bidang.nama, bidang.nilaiBawaan)}
                className="isian"
              />
            )}
          </div>
        );
      })}
      <div className="md:col-span-2 flex flex-wrap items-center gap-3">
        <button type="submit" className="tombol tombol-utama">
          {labelTombol}
        </button>
        {children}
      </div>
    </FormulirAksi>
  );
}
