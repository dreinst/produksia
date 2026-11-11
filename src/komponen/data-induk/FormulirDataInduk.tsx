import FormulirAksi from "@/komponen/FormulirAksi";
import type { KonfigurasiEntitas } from "@/lib/konfigurasiDataInduk";
import type { StatusFormulir } from "@/lib/statusFormulir";
import { NILAI_BERSAMA } from "@/lib/perusahaan";

export type DaftarOpsi = Record<string, { id: string; label: string }[]>;

/**
 * Formulir tambah/ubah data induk yang dibangun dari konfigurasi entitas.
 * `nilai` = record yang sedang diubah (kosongkan untuk tambah baru).
 * `kecualiId` = id yang disembunyikan dari pilihan induk (mencegah induk = diri sendiri).
 * `perusahaanBawaan` = lingkup perusahaan aktif, isian awal bidang `bawaanLingkup` saat menambah data (D1 §3.5).
 */
export default function FormulirDataInduk({
  config,
  daftarOpsi,
  aksi,
  nilai,
  kecualiId,
  perusahaanBawaan,
  labelTombol,
  className,
  children,
}: {
  config: KonfigurasiEntitas;
  daftarOpsi: DaftarOpsi;
  aksi: (sebelumnya: StatusFormulir, dataFormulir: FormData) => Promise<StatusFormulir>;
  nilai?: Record<string, unknown>;
  kecualiId?: string;
  perusahaanBawaan?: string | null;
  labelTombol: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const bacaAwal = (nama: string, bawaan?: string, bersama?: boolean) => {
    if (!nilai) return bawaan ?? "";
    const v = nilai[nama];
    // pemilik kosong pada bidang yang punya opsi "Bersama" berarti data bersama
    if (v === null && bersama) return NILAI_BERSAMA;
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v);
  };
  const awalanId = nilai ? `ubah-${config.slug}` : `tambah-${config.slug}`;

  return (
    <FormulirAksi aksi={aksi} className={className ?? "kartu grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl"}>
      {config.bidang.filter((bidang) => !(bidang.hanyaTambah && nilai)).map((bidang) => {
        const id = `${awalanId}-${bidang.nama}`;
        return (
          <div key={bidang.nama} className="bidang">
            <label className="label" htmlFor={id}>
              <span>
                {bidang.label}
                {bidang.wajib && <span className="text-rose-500"> *</span>}
              </span>
            </label>
            {bidang.jenis === "boolean" ? (
              <label className="flex items-center gap-2 h-9 text-sm text-slate-800" htmlFor={id}>
                <input id={id} type="checkbox" name={bidang.nama} defaultChecked={nilai?.[bidang.nama] === true} className="h-4 w-4 rounded border-slate-300" />
                Ya
              </label>
            ) : bidang.jenis === "select" ? (
              <select
                id={id}
                name={bidang.nama}
                defaultValue={bacaAwal(bidang.nama, (bidang.bawaanLingkup && perusahaanBawaan) || bidang.nilaiBawaan, !!bidang.pilihanBersama)}
                className="isian"
              >
                {!bidang.pilihanBersama && <option value="">-</option>}
                {(bidang.opsiStatis
                  ? bidang.opsiStatis.map((o) => ({ id: o, label: o }))
                  : (daftarOpsi[bidang.nama] ?? []).filter((o) => o.id !== kecualiId)
                ).map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
                {bidang.pilihanBersama && <option value={NILAI_BERSAMA}>{bidang.pilihanBersama}</option>}
              </select>
            ) : (
              <input
                id={id}
                type={bidang.jenis === "number" ? "number" : bidang.jenis === "date" ? "date" : "text"}
                step={bidang.jenis === "number" ? "0.01" : undefined}
                name={bidang.nama}
                required={bidang.wajib}
                defaultValue={bacaAwal(bidang.nama, bidang.nilaiBawaan)}
                className="isian"
              />
            )}
            {bidang.petunjuk && <span className="petunjuk">{bidang.petunjuk}</span>}
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
