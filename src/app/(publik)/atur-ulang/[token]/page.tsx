import Link from "next/link";
import { PANJANG_KATA_SANDI_MINIMUM } from "@/lib/otentikasi";
import { pakaiTautanAturUlangFormulir, periksaTautanAturUlang } from "@/lib/aksi/otentikasi";
import FormulirAksi from "@/komponen/FormulirAksi";
import Ikon from "@/komponen/ui/Ikon";

export default async function HalamanAturUlang({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const permintaan = await periksaTautanAturUlang(token);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {!permintaan ? (
          <div className="kartu space-y-3">
            <h1 className="judul-kartu">Tautan tidak berlaku</h1>
            <p className="text-sm text-slate-600">Tautan atur ulang ini sudah dipakai, kedaluwarsa (24 jam), atau dibatalkan. Minta tautan baru ke Superadmin/Pemilik lewat halaman lupa kata sandi.</p>
            <Link href="/lupa-kata-sandi" className="tombol tombol-utama">Minta tautan baru</Link>
          </div>
        ) : (
          <FormulirAksi aksi={pakaiTautanAturUlangFormulir.bind(null, token)} className="kartu space-y-4">
            <div>
              <h1 className="judul-kartu">Kata sandi baru</h1>
              <p className="subjudul-kartu">
                Untuk akun <strong>{permintaan.pengguna.nama}</strong> (<span className="font-mono">@{permintaan.pengguna.namaPengguna}</span>). Setelah disimpan kamu langsung masuk dan semua sesi lama dikeluarkan.
              </p>
            </div>
            <div className="bidang">
              <label className="label" htmlFor="kataSandiBaru">Kata sandi baru</label>
              <input id="kataSandiBaru" name="kataSandiBaru" type="password" required minLength={PANJANG_KATA_SANDI_MINIMUM} autoComplete="new-password" autoFocus className="isian" />
              <span className="petunjuk">Minimal {PANJANG_KATA_SANDI_MINIMUM} karakter, memuat huruf dan angka</span>
            </div>
            <div className="bidang">
              <label className="label" htmlFor="ulangiKataSandi">Ulangi kata sandi</label>
              <input id="ulangiKataSandi" name="ulangiKataSandi" type="password" required autoComplete="new-password" className="isian" />
            </div>
            <button type="submit" className="tombol tombol-utama w-full">
              <Ikon nama="verified_user" className="!text-[18px]" />
              Simpan &amp; masuk
            </button>
          </FormulirAksi>
        )}
      </div>
    </div>
  );
}
