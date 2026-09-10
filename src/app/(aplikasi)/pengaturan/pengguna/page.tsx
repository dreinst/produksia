import Link from "next/link";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { wajibHak, PANJANG_KATA_SANDI_MINIMUM } from "@/lib/otentikasi";
import { DAFTAR_PERAN, KETERANGAN_PERAN, LABEL_PERAN, peranTertinggi } from "@/lib/hakAkses";
import { buatPenggunaFormulir, buatTautanAturUlangFormulir, tolakPermintaanAturUlangFormulir } from "@/lib/aksi/pengguna";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";

export default async function HalamanPengguna() {
  const saya = await wajibHak("pengguna.kelola");
  const daftarPengguna = await db.pengguna.findMany({
    select: { id: true, nama: true, namaPengguna: true, email: true, peran: true, aktif: true, dibuatPada: true, _count: { select: { sesi: true } } },
    orderBy: [{ peran: "asc" }, { nama: "asc" }],
  });
  const peranBolehDibuat = DAFTAR_PERAN.filter((p) => !peranTertinggi(p) || peranTertinggi(saya.peran));
  const permintaan = await db.permintaanAturUlang.findMany({
    where: { status: { in: ["MENUNGGU", "TAUTAN"] } },
    include: { pengguna: { select: { nama: true, namaPengguna: true, peran: true } } },
    orderBy: { dibuatPada: "asc" },
  });
  const kepala = await headers();
  const asal = `${kepala.get("x-forwarded-proto") ?? "http"}://${kepala.get("host") ?? "localhost:3000"}`;
  const bolehTangani = (peran: (typeof DAFTAR_PERAN)[number]) => !peranTertinggi(peran) || peranTertinggi(saya.peran);
  const waktu = (d: Date) => d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Administrasi" }, { label: "Pengaturan" }]}
        judul="Pengguna"
        subjudul="Akun yang bisa masuk ke sistem."
        lencana={permintaan.length ? <span className="lencana lencana-amber">{permintaan.length} permintaan lupa kata sandi</span> : undefined}
      />

      {permintaan.length > 0 && (
        <div className="kartu space-y-3 border-amber-200">
          <div>
            <h2 className="judul-kartu">Permintaan atur ulang kata sandi</h2>
            <p className="subjudul-kartu">Buat tautan sekali pakai (berlaku 24 jam), lalu berikan langsung ke orangnya.</p>
          </div>
          <ul className="divide-y divide-slate-100">
            {permintaan.map((p) => (
              <li key={p.id} className="py-3 flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-semibold text-slate-900">{p.pengguna.nama}</span> <span className="font-mono text-slate-500"></span> · {LABEL_PERAN[p.pengguna.peran]} · diminta {waktu(p.dibuatPada)}
                    {p.status === "TAUTAN" && p.kedaluwarsa && <span className="ml-2 lencana lencana-blue">tautan dibuat, berlaku s.d. {waktu(p.kedaluwarsa)}</span>}
                  </div>
                  {bolehTangani(p.pengguna.peran) ? (
                    <div className="flex items-center gap-2">
                      <FormulirAksi aksi={buatTautanAturUlangFormulir.bind(null, p.id)}>
                        <button type="submit" className="tombol tombol-utama tombol-kecil">{p.status === "TAUTAN" ? "Buat tautan baru" : "Buat tautan"}</button>
                      </FormulirAksi>
                      <FormulirAksi aksi={tolakPermintaanAturUlangFormulir.bind(null, p.id)} pesanKonfirmasi={`Tolak permintaan ${p.pengguna.nama}?`}>
                        <button type="submit" className="tombol tombol-garis tombol-kecil">Tolak</button>
                      </FormulirAksi>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">Hanya Superadmin/Pemilik yang bisa menangani</span>
                  )}
                </div>
                {p.status === "TAUTAN" && p.token && (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-xs">
                    <span className="text-slate-500 shrink-0">Berikan tautan ini:</span>
                    <input readOnly value={`${asal}/atur-ulang/${p.token}`} className="isian isian-kecil font-mono flex-1" aria-label={`Tautan atur ulang ${p.pengguna.namaPengguna}`} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <FormulirAksi aksi={buatPenggunaFormulir} className="kartu space-y-4 lg:col-span-1 self-start" pesanSukses="Pengguna ditambahkan.">
          <div>
            <h2 className="judul-kartu">Tambah pengguna</h2>
            <p className="subjudul-kartu">Beritahukan nama pengguna dan kata sandi awal. Kata sandi bisa diganti di Profil.</p>
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
                      <td className="text-slate-500">{p.email ?? "-"}</td>
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
            <p className="subjudul-kartu">Superadmin dan Pemilik setara. Admin tidak bisa mengubah akun keduanya.</p>
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
