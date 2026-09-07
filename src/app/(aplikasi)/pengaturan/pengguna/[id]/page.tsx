import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak, PANJANG_KATA_SANDI_MINIMUM } from "@/lib/otentikasi";
import { DAFTAR_PERAN, LABEL_PERAN } from "@/lib/hakAkses";
import { aturUlangKataSandiFormulir, hapusPenggunaFormulir, ubahPenggunaFormulir } from "@/lib/aksi/pengguna";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";

export default async function HalamanUbahPengguna({ params }: { params: Promise<{ id: string }> }) {
  const saya = await wajibHak("pengguna.kelola");
  const { id } = await params;
  const pengguna = await db.pengguna.findUnique({
    where: { id },
    select: { id: true, nama: true, email: true, peran: true, aktif: true, dibuatPada: true, karyawan: { select: { kode: true, nama: true } } },
  });
  if (!pengguna) notFound();

  const diriSendiri = pengguna.id === saya.id;
  const bolehSentuh = pengguna.peran !== "PEMILIK" || saya.peran === "PEMILIK";
  const peranTersedia = DAFTAR_PERAN.filter((p) => p !== "PEMILIK" || saya.peran === "PEMILIK" || pengguna.peran === "PEMILIK");

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Administrasi" }, { label: "Pengaturan" }, { label: "Pengguna", href: "/pengaturan/pengguna" }]}
        judul={pengguna.nama}
        subjudul={`${pengguna.email} · dibuat ${pengguna.dibuatPada.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })}`}
        aksi={
          <Link href="/pengaturan/pengguna" className="tombol tombol-garis">
            Kembali ke daftar
          </Link>
        }
      />

      {!bolehSentuh && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Akun berperan Pemilik hanya bisa diubah oleh Pemilik lain.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <FormulirAksi aksi={ubahPenggunaFormulir.bind(null, pengguna.id)} className="kartu space-y-4" pesanSukses="Perubahan disimpan.">
          <h2 className="judul-kartu">Data akun</h2>
          <div className="bidang">
            <label className="label" htmlFor="nama">Nama</label>
            <input id="nama" name="nama" defaultValue={pengguna.nama} required disabled={!bolehSentuh} className="isian" />
          </div>
          <div className="bidang">
            <label className="label" htmlFor="email">Email</label>
            <input id="email" value={pengguna.email} readOnly className="isian" />
            <span className="petunjuk">Email adalah identitas masuk dan tidak diubah dari sini</span>
          </div>
          <div className="bidang">
            <label className="label" htmlFor="peran">Peran</label>
            <select id="peran" name="peran" defaultValue={pengguna.peran} disabled={!bolehSentuh || diriSendiri} className="isian">
              {peranTersedia.map((p) => (
                <option key={p} value={p}>
                  {LABEL_PERAN[p]}
                </option>
              ))}
            </select>
            {diriSendiri && <span className="petunjuk">Peran akun sendiri tidak bisa diubah</span>}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input type="checkbox" name="aktif" defaultChecked={pengguna.aktif} disabled={!bolehSentuh || diriSendiri} className="h-4 w-4 rounded border-slate-300" />
            Akun aktif (boleh masuk)
          </label>
          {pengguna.karyawan && (
            <p className="text-xs text-slate-500">
              Terhubung ke karyawan {pengguna.karyawan.kode} · {pengguna.karyawan.nama}
            </p>
          )}
          <button type="submit" className="tombol tombol-utama" disabled={!bolehSentuh}>
            Simpan
          </button>
        </FormulirAksi>

        <div className="space-y-6">
          <FormulirAksi aksi={aturUlangKataSandiFormulir.bind(null, pengguna.id)} className="kartu space-y-4" pesanSukses="Kata sandi diatur ulang; sesi lama pengguna ini dikeluarkan.">
            <div>
              <h2 className="judul-kartu">Atur ulang kata sandi</h2>
              <p className="subjudul-kartu">Untuk pengguna yang lupa kata sandi. Beritahukan kata sandi baru secara langsung.</p>
            </div>
            <div className="bidang">
              <label className="label" htmlFor="kataSandiBaru">Kata sandi baru</label>
              <input id="kataSandiBaru" name="kataSandiBaru" type="password" required minLength={PANJANG_KATA_SANDI_MINIMUM} autoComplete="new-password" disabled={!bolehSentuh} className="isian" />
              <span className="petunjuk">Minimal {PANJANG_KATA_SANDI_MINIMUM} karakter, huruf + angka</span>
            </div>
            <button type="submit" className="tombol tombol-garis" disabled={!bolehSentuh}>
              Atur ulang
            </button>
          </FormulirAksi>

          {!diriSendiri && bolehSentuh && (
            <FormulirAksi
              aksi={hapusPenggunaFormulir.bind(null, pengguna.id)}
              className="kartu space-y-3 border-rose-100"
              pesanKonfirmasi={`Hapus akun ${pengguna.nama}? Riwayat transaksi tidak ikut terhapus.`}
            >
              <div>
                <h2 className="judul-kartu text-rose-700">Hapus akun</h2>
                <p className="subjudul-kartu">Lebih aman menonaktifkan akun daripada menghapusnya, kecuali akun dibuat keliru.</p>
              </div>
              <button type="submit" className="tombol tombol-bahaya">
                Hapus pengguna ini
              </button>
            </FormulirAksi>
          )}
        </div>
      </div>
    </div>
  );
}
