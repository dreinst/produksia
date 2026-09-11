import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { penggunaSaatIni, PANJANG_KATA_SANDI_MINIMUM } from "@/lib/otentikasi";
import { buatPemilikPertamaFormulir, masukFormulir } from "@/lib/aksi/otentikasi";
import FormulirAksi from "@/komponen/FormulirAksi";
import Logo from "@/komponen/ui/Logo";
import Ikon from "@/komponen/ui/Ikon";

export default async function HalamanMasuk({ searchParams }: { searchParams: Promise<{ kembali?: string }> }) {
  const { kembali } = await searchParams;
  if (await penggunaSaatIni()) redirect("/");
  const pemasanganAwal = (await db.pengguna.count()) === 0;

  return (
    <div className="latar-masuk min-h-screen flex items-center justify-center p-4 sm:p-8">
      <div className="animasi-masuk w-full max-w-sm flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2">
          <Logo tinggi={40} />
          <span className="text-[10px] font-semibold tracking-[0.16em] text-slate-400 uppercase">Sistem Akuntansi Terpadu</span>
        </div>

        {pemasanganAwal ? (
          <FormulirAksi aksi={buatPemilikPertamaFormulir} className="kartu flex flex-col gap-5">
            <div>
              <h1 className="judul-kartu">Pemasangan awal</h1>
              <p className="subjudul-kartu">
                Basis data belum punya pengguna. Buat akun <strong>Pemilik</strong> pertama; akun lain (termasuk Superadmin) bisa ditambah dari menu Pengguna.
              </p>
            </div>
            <div className="bidang">
              <label className="label" htmlFor="kunciPemasangan">Kunci pemasangan server</label>
              <input id="kunciPemasangan" name="kunciPemasangan" autoComplete="off" autoCapitalize="none" spellCheck={false} className="isian" />
              <span className="petunjuk">Dari admin server (env KUNCI_PEMASANGAN). Wajib di produksi.</span>
            </div>
            <div className="bidang">
              <label className="label" htmlFor="nama">Nama</label>
              <input id="nama" name="nama" required autoComplete="name" className="isian" />
            </div>
            <div className="bidang">
              <label className="label" htmlFor="namaPengguna">Nama pengguna</label>
              <input id="namaPengguna" name="namaPengguna" required autoComplete="username" autoCapitalize="none" spellCheck={false} className="isian" />
              <span className="petunjuk">Dipakai untuk masuk; huruf kecil/angka/titik/strip, mis. <code>owner</code></span>
            </div>
            <div className="bidang">
              <label className="label" htmlFor="email">Email (opsional)</label>
              <input id="email" name="email" type="email" autoComplete="email" className="isian" />
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
          <FormulirAksi aksi={masukFormulir} className="kartu flex flex-col gap-5">
            <h1 className="judul-kartu">Masuk</h1>
            <input type="hidden" name="kembali" value={kembali ?? "/"} />
            <div className="bidang">
              <label className="label" htmlFor="namaPengguna">Nama pengguna</label>
              <input id="namaPengguna" name="namaPengguna" required autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus className="isian" />
            </div>
            <div className="bidang">
              <label className="label" htmlFor="kataSandi">Kata sandi</label>
              <input id="kataSandi" name="kataSandi" type="password" required autoComplete="current-password" className="isian" />
            </div>
            <button type="submit" className="tombol tombol-utama w-full mt-1">
              <Ikon nama="lock" className="!text-[18px]" />
              Masuk
            </button>
          </FormulirAksi>
        )}

        <p className="text-center text-xs">
          <Link href="/lupa-kata-sandi" className="text-slate-500 hover:text-navy hover:underline">Lupa kata sandi?</Link>
        </p>
      </div>
    </div>
  );
}
