import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak, PANJANG_KATA_SANDI_MINIMUM } from "@/lib/otentikasi";
import { DAFTAR_PERAN, KETERANGAN_PERAN, LABEL_PERAN, peranTertinggi } from "@/lib/hakAkses";
import { buatPenggunaFormulir } from "@/lib/aksi/pengguna";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";

export default async function HalamanPengguna() {
  const saya = await wajibHak("pengguna.kelola");
  const daftarPengguna = await db.pengguna.findMany({
    select: { id: true, nama: true, namaPengguna: true, email: true, peran: true, aktif: true, dibuatPada: true, _count: { select: { sesi: true } } },
    orderBy: [{ peran: "asc" }, { nama: "asc" }],
  });
  const peranBolehDibuat = DAFTAR_PERAN.filter((p) => !peranTertinggi(p) || peranTertinggi(saya.peran));

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Administrasi" }, { label: "Pengaturan" }]}
        judul="Pengguna"
        subjudul="Akun yang bisa masuk ke sistem beserta perannya. Masuk memakai nama pengguna, bukan email."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <FormulirAksi aksi={buatPenggunaFormulir} className="kartu space-y-4 lg:col-span-1 self-start" pesanSukses="Pengguna ditambahkan.">
          <div>
            <h2 className="judul-kartu">Tambah pengguna</h2>
            <p className="subjudul-kartu">Beritahukan nama pengguna dan kata sandi awal secara langsung; pengguna bisa mengganti kata sandinya di Profil.</p>
          </div>
          <div className="bidang">
            <label className="label" htmlFor="nama">Nama lengkap</label>
            <input id="nama" name="nama" required className="isian" />
          </div>
          <div className="bidang">
            <label className="label" htmlFor="namaPengguna">Nama pengguna</label>
            <input id="namaPengguna" name="namaPengguna" required autoCapitalize="none" spellCheck={false} placeholder="mis. kasir2" className="isian" />
            <span className="petunjuk">Identitas masuk: 3–32 karakter huruf kecil/angka/titik/strip</span>
          </div>
          <div className="bidang">
            <label className="label" htmlFor="email">Email (opsional)</label>
            <input id="email" name="email" type="email" className="isian" />
          </div>
          <div className="bidang">
            <label className="label" htmlFor="kataSandi">Kata sandi awal</label>
            <input id="kataSandi" name="kataSandi" type="password" required minLength={PANJANG_KATA_SANDI_MINIMUM} autoComplete="new-password" className="isian" />
            <span className="petunjuk">Minimal {PANJANG_KATA_SANDI_MINIMUM} karakter, huruf + angka</span>
          </div>
          <div className="bidang">
            <label className="label" htmlFor="peran">Peran</label>
            <select id="peran" name="peran" defaultValue="KASIR" className="isian">
              {peranBolehDibuat.map((p) => (
                <option key={p} value={p}>
                  {LABEL_PERAN[p]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="tombol tombol-utama">
            Tambah pengguna
          </button>
        </FormulirAksi>

        <div className="lg:col-span-2 space-y-6">
          <div className="kartu kartu-tabel">
            <div className="bungkus-tabel">
              <table className="tabel min-w-[40rem]">
                <thead>
                  <tr>
                    <th>Nama</th>
                    <th>Nama pengguna</th>
                    <th>Email</th>
                    <th>Peran</th>
                    <th>Status</th>
                    <th className="text-right">Sesi aktif</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {daftarPengguna.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium text-slate-900">
                        {p.nama}
                        {p.id === saya.id && <span className="ml-2 lencana lencana-blue">Anda</span>}
                      </td>
                      <td className="font-mono text-slate-700">{p.namaPengguna}</td>
                      <td className="text-slate-500">{p.email ?? "—"}</td>
                      <td>{LABEL_PERAN[p.peran]}</td>
                      <td>
                        <span className={`lencana ${p.aktif ? "lencana-emerald" : "lencana-slate"}`}>{p.aktif ? "Aktif" : "Nonaktif"}</span>
                      </td>
                      <td className="text-right angka">{p._count.sesi}</td>
                      <td className="text-right">
                        <Link href={`/pengaturan/pengguna/${p.id}`} className="tombol-tautan">
                          Ubah
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="kartu space-y-3">
            <h2 className="judul-kartu">Arti tiap peran</h2>
            <p className="subjudul-kartu">Superadmin dan Pemilik setara (tingkat tertinggi); Admin tidak bisa menyentuh akun keduanya.</p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {DAFTAR_PERAN.map((p) => (
                <div key={p} className="ubin">
                  <dt className="font-semibold text-slate-900">{LABEL_PERAN[p]}</dt>
                  <dd className="text-xs text-slate-500 mt-0.5">{KETERANGAN_PERAN[p]}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
