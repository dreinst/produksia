import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { penggunaSaatIni, PANJANG_KATA_SANDI_MINIMUM } from "@/lib/otentikasi";
import { buatPemilikPertamaFormulir, masukFormulir } from "@/lib/aksi/otentikasi";
import FormulirAksi from "@/komponen/FormulirAksi";
import Ikon from "@/komponen/ui/Ikon";

export default async function HalamanMasuk({ searchParams }: { searchParams: Promise<{ kembali?: string }> }) {
  const { kembali } = await searchParams;
  if (await penggunaSaatIni()) redirect("/");
  const pemasanganAwal = (await db.pengguna.count()) === 0;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-heading font-bold text-lg">
            A
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-heading font-bold text-xl text-slate-900 tracking-tight">
              Accurate <span className="text-blue-600">Copy</span>
            </span>
            <span className="text-[10px] font-semibold tracking-[0.12em] text-slate-400 uppercase mt-1">Sistem Akuntansi Terpadu</span>
          </span>
        </div>

        {pemasanganAwal ? (
          <FormulirAksi aksi={buatPemilikPertamaFormulir} className="kartu space-y-4">
            <div>
              <h1 className="judul-kartu">Pemasangan awal</h1>
              <p className="subjudul-kartu">
                Basis data belum punya pengguna. Buat akun <strong>Pemilik</strong> pertama; akun lain bisa ditambah dari menu Pengguna.
              </p>
            </div>
            <div className="bidang">
              <label className="label" htmlFor="nama">Nama</label>
              <input id="nama" name="nama" required autoComplete="name" className="isian" />
            </div>
            <div className="bidang">
              <label className="label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" required autoComplete="username" className="isian" />
            </div>
            <div className="bidang">
              <label className="label" htmlFor="kataSandi">Kata sandi</label>
              <input id="kataSandi" name="kataSandi" type="password" required minLength={PANJANG_KATA_SANDI_MINIMUM} autoComplete="new-password" className="isian" />
              <span className="petunjuk">Minimal {PANJANG_KATA_SANDI_MINIMUM} karakter, memuat huruf dan angka</span>
            </div>
            <div className="bidang">
              <label className="label" htmlFor="ulangiKataSandi">Ulangi kata sandi</label>
              <input id="ulangiKataSandi" name="ulangiKataSandi" type="password" required autoComplete="new-password" className="isian" />
            </div>
            <button type="submit" className="tombol tombol-utama w-full">
              <Ikon nama="verified_user" className="!text-[18px]" />
              Buat akun Pemilik &amp; masuk
            </button>
          </FormulirAksi>
        ) : (
          <FormulirAksi aksi={masukFormulir} className="kartu space-y-4">
            <div>
              <h1 className="judul-kartu">Masuk</h1>
              <p className="subjudul-kartu">Gunakan email dan kata sandi yang diberikan pemilik atau admin.</p>
            </div>
            <input type="hidden" name="kembali" value={kembali ?? "/"} />
            <div className="bidang">
              <label className="label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" required autoComplete="username" autoFocus className="isian" />
            </div>
            <div className="bidang">
              <label className="label" htmlFor="kataSandi">Kata sandi</label>
              <input id="kataSandi" name="kataSandi" type="password" required autoComplete="current-password" className="isian" />
            </div>
            <button type="submit" className="tombol tombol-utama w-full">
              <Ikon nama="lock" className="!text-[18px]" />
              Masuk
            </button>
          </FormulirAksi>
        )}

        <p className="text-center text-xs text-slate-400">Lupa kata sandi? Minta Pemilik/Admin mengatur ulang lewat menu Pengguna.</p>
      </div>
    </div>
  );
}
