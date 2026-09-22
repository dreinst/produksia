import { wajibMasuk, PANJANG_KATA_SANDI_MINIMUM } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import { KETERANGAN_PERAN, LABEL_PERAN, inisialNama } from "@/lib/hakAkses";
import { gantiKataSandiFormulir, hapusFotoProfilFormulir, ubahFotoProfilFormulir } from "@/lib/aksi/otentikasi";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import PemilihFoto from "@/komponen/ui/PemilihFoto";

export default async function HalamanProfil() {
  const pengguna = await wajibMasuk();
  const foto = await db.foto.findUnique({ where: { penggunaId: pengguna.id }, select: { id: true } });

  return (
    <div className="space-y-6">
      <KepalaHalaman jejak={[{ label: "Akun" }]} judul="Profil Saya" subjudul="Identitas akun dan penggantian kata sandi." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="kartu space-y-4">
          <div className="flex items-center gap-4">
            {foto ? (
              // eslint-disable-next-line @next/next/no-img-element -- foto privat dari API berhak akses, bukan aset statis
              <img src={`/api/foto/${foto.id}`} alt="" className="w-14 h-14 rounded-full object-cover border" />
            ) : (
              <span className="w-14 h-14 rounded-full bg-navy text-white flex items-center justify-center font-heading font-bold text-lg">
                {inisialNama(pengguna.nama)}
              </span>
            )}
            <div className="min-w-0">
              <div className="font-heading font-bold text-slate-900 truncate">{pengguna.nama}</div>
              <div className="text-sm text-slate-500 truncate"><span className="font-mono">@{pengguna.namaPengguna}</span></div>
            </div>
          </div>
          <div className="ubin space-y-1">
            <div className="teks-label">Peran</div>
            <div className="text-sm font-semibold text-slate-900">{LABEL_PERAN[pengguna.peran]}</div>
            <div className="text-xs text-slate-500">{KETERANGAN_PERAN[pengguna.peran]}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="ubin space-y-1">
              <div className="teks-label">Email</div>
              <div className="text-sm text-slate-700">{pengguna.email ?? "-"}</div>
            </div>
            <div className="ubin space-y-1">
              <div className="teks-label">Nomor WhatsApp</div>
              <div className="text-sm text-slate-700">{pengguna.nomorTelepon ?? "-"}</div>
            </div>
          </div>
          <p className="text-xs text-slate-500">Nama, nama pengguna, email, nomor WhatsApp, dan peran hanya bisa diubah oleh Superadmin/Pemilik lewat menu Pengguna. Foto profil boleh kamu ubah sendiri di bawah.</p>

          <div className="pt-2 border-t border-slate-100 space-y-3">
            <h2 className="judul-kartu">Foto profil</h2>
            <FormulirAksi aksi={ubahFotoProfilFormulir} pesanSukses="Foto profil diperbarui." className="space-y-3">
              <PemilihFoto name="foto" maksimal={1} wajib label="Pilih / ambil foto" />
              <button type="submit" className="tombol tombol-utama w-full sm:w-auto min-h-11">{foto ? "Ganti foto" : "Unggah foto"}</button>
            </FormulirAksi>
            {foto && (
              <FormulirAksi aksi={hapusFotoProfilFormulir} pesanKonfirmasi="Hapus foto profil?" className="inline">
                <button type="submit" className="tombol-tautan-bahaya">Hapus foto</button>
              </FormulirAksi>
            )}
          </div>
        </div>

        <FormulirAksi aksi={gantiKataSandiFormulir} className="kartu space-y-4" pesanSukses="Kata sandi diganti. Perangkat lain otomatis keluar.">
          <div>
            <h2 className="judul-kartu">Ganti kata sandi</h2>
            <p className="subjudul-kartu">Setelah diganti, semua sesi di perangkat lain akan dikeluarkan.</p>
          </div>
          <div className="bidang">
            <label className="label" htmlFor="kataSandiLama">Kata sandi lama</label>
            <input id="kataSandiLama" name="kataSandiLama" type="password" required autoComplete="current-password" className="isian" />
          </div>
          <div className="bidang">
            <label className="label" htmlFor="kataSandiBaru">Kata sandi baru</label>
            <input id="kataSandiBaru" name="kataSandiBaru" type="password" required minLength={PANJANG_KATA_SANDI_MINIMUM} autoComplete="new-password" className="isian" />
            <span className="petunjuk">Minimal {PANJANG_KATA_SANDI_MINIMUM} karakter, memuat huruf dan angka</span>
          </div>
          <div className="bidang">
            <label className="label" htmlFor="ulangiKataSandi">Ulangi kata sandi baru</label>
            <input id="ulangiKataSandi" name="ulangiKataSandi" type="password" required autoComplete="new-password" className="isian" />
          </div>
          <button type="submit" className="tombol tombol-utama">
            Simpan kata sandi
          </button>
        </FormulirAksi>
      </div>
    </div>
  );
}
