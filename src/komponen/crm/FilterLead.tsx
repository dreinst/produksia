import Link from "next/link";

/*
 * Saringan lead (D4 §7.3), formulir GET tanpa JavaScript dengan gaya FilterPeriode. Dipakai daftar lead (lengkap) dan
 * pipeline (ringkas: cari, sumber, dan PIC; tahap dan status sudah menjadi kolom papan). Nilai yang dipertahankan
 * (q, tag, arsip, perusahaan) dikirim sebagai isian tersembunyi.
 */

export type NilaiFilterLead = { q?: string; tahap?: string; status?: string; sumber?: string; pic?: string; urut?: string };
export type OpsiTahapFilter = { id: string; nama: string; perusahaan?: { id: string; nama: string } };

const STATUS = [
  { nilai: "BERJALAN", label: "Berjalan" },
  { nilai: "MENANG", label: "Menang" },
  { nilai: "KALAH", label: "Kalah" },
];
const URUT = [
  { nilai: "terbaru", label: "Terbaru" },
  { nilai: "terlama", label: "Terlama" },
  { nilai: "nilai", label: "Nilai tertinggi" },
  { nilai: "nama", label: "Nama A-Z" },
];

export default function FilterLead({
  nilai,
  tahap = [],
  sumber,
  pengguna,
  tersembunyi = {},
  aturUlang,
  ringkas = false,
}: {
  nilai: NilaiFilterLead;
  /** tahap lingkup; di gabungan berisi perusahaan sehingga dikelompokkan per perusahaan */
  tahap?: OpsiTahapFilter[];
  sumber: string[];
  pengguna: { id: string; nama: string }[];
  tersembunyi?: Record<string, string | undefined>;
  /** alamat "Atur ulang" (tanpa saringan) */
  aturUlang: string;
  ringkas?: boolean;
}) {
  const kelompok = new Map<string, { nama: string; tahap: OpsiTahapFilter[] }>();
  for (const t of tahap) {
    const k = t.perusahaan?.id ?? "";
    const isi = kelompok.get(k) ?? { nama: t.perusahaan?.nama ?? "", tahap: [] };
    isi.tahap.push(t);
    kelompok.set(k, isi);
  }
  const berkelompok = kelompok.size > 1;
  const sumberTampil = nilai.sumber && !sumber.includes(nilai.sumber) ? [...sumber, nilai.sumber] : sumber;

  return (
    <form method="get" className="kartu flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 !p-4" aria-label="Saring lead">
      {Object.entries(tersembunyi).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {/* mode ringkas (pipeline) tidak punya KontrolDaftar, jadi kotak cari ada di sini */}
      {ringkas && (
        <div className="bidang">
          <label className="label" htmlFor="saring-q">
            Cari
          </label>
          <input id="saring-q" type="search" name="q" defaultValue={nilai.q ?? ""} placeholder="Nama, perusahaan, telepon, email…" className="isian isian-kecil" />
        </div>
      )}
      {!ringkas && (
        <>
          <div className="bidang">
            <label className="label" htmlFor="saring-tahap">
              Tahap
            </label>
            <select id="saring-tahap" name="tahap" defaultValue={nilai.tahap ?? ""} className="isian isian-kecil">
              <option value="">Semua tahap</option>
              {berkelompok
                ? [...kelompok.entries()].map(([k, g]) => (
                    <optgroup key={k} label={g.nama}>
                      {g.tahap.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nama}
                        </option>
                      ))}
                    </optgroup>
                  ))
                : tahap.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nama}
                    </option>
                  ))}
            </select>
          </div>
          <div className="bidang">
            <label className="label" htmlFor="saring-status">
              Status
            </label>
            <select id="saring-status" name="status" defaultValue={nilai.status ?? ""} className="isian isian-kecil">
              <option value="">Semua status</option>
              {STATUS.map((s) => (
                <option key={s.nilai} value={s.nilai}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      <div className="bidang">
        <label className="label" htmlFor="saring-sumber">
          Sumber
        </label>
        <select id="saring-sumber" name="sumber" defaultValue={nilai.sumber ?? ""} className="isian isian-kecil">
          <option value="">Semua sumber</option>
          {sumberTampil.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor="saring-pic">
          PIC
        </label>
        <select id="saring-pic" name="pic" defaultValue={nilai.pic ?? ""} className="isian isian-kecil">
          <option value="">Semua PIC</option>
          <option value="saya">Saya</option>
          <option value="tanpa">Tanpa PIC</option>
          {pengguna.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nama}
            </option>
          ))}
        </select>
      </div>
      {!ringkas && (
        <div className="bidang">
          <label className="label" htmlFor="saring-urut">
            Urutkan
          </label>
          <select id="saring-urut" name="urut" defaultValue={nilai.urut ?? "terbaru"} className="isian isian-kecil">
            {URUT.map((u) => (
              <option key={u.nilai} value={u.nilai}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" className="tombol tombol-utama tombol-kecil">
          Terapkan
        </button>
        <Link href={aturUlang} className="tombol-tautan text-sm">
          Atur ulang
        </Link>
      </div>
    </form>
  );
}
