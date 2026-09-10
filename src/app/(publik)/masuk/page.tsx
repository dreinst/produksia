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
    <div className="min-h-screen lg:grid lg:grid-cols-[1.1fr_1fr]">
      <div className="aurora" aria-hidden="true" />
      {/* Panel merek: navy bergradasi dengan cahaya aurora dan pola grid halus */}
      <section className="relative hidden lg:flex flex-col justify-between overflow-hidden text-white p-12 xl:p-16" style={{ background: "linear-gradient(160deg, #143563 0%, #0b2141 55%, #071a35 100%)" }} aria-label="Tentang Produksia">
        <div className="aurora-gelap" aria-hidden="true" />
        <div className="pola-grid absolute inset-0 opacity-70" aria-hidden="true" style={{ maskImage: "radial-gradient(circle at 30% 20%, #000 0%, transparent 70%)" }} />
        <div className="relative animasi-masuk">
          <Logo tinggi={40} varian="gelap" />
        </div>
        <div className="relative animasi-masuk space-y-8 max-w-md">
          <div className="space-y-3">
            <h2 className="font-heading text-3xl xl:text-4xl font-bold leading-tight tracking-tight">Satu buku untuk semua event.</h2>
            <p className="text-sm xl:text-base text-slate-300 leading-relaxed">Penawaran, pesanan, kas, stok, dan laporan keuangan terhubung dalam satu jurnal yang selalu seimbang.</p>
          </div>
          <ul className="space-y-3 text-sm">
            {[
              { ikon: "fact_check", teks: "Rekonsiliasi kas/bank dan LPJ per event" },
              { ikon: "monitoring", teks: "Laba rugi per event, arus kas, pajak & SPT" },
              { ikon: "shield", teks: "Hak akses per dokumen untuk tiap peran" },
            ].map((b) => (
              <li key={b.teks} className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white/10 border border-white/15 text-orange-300 shrink-0"><Ikon nama={b.ikon} className="!text-[18px]" /></span>
                <span className="text-slate-200">{b.teks}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative animasi-masuk flex items-center gap-2 text-[11px] text-slate-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
          Buku besar dicek otomatis: Σ debit = Σ kredit
        </div>
      </section>

      <div className="flex items-center justify-center p-4 sm:p-8">
      <div className="animasi-masuk w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2 lg:items-start">
          <Logo tinggi={40} className="lg:hidden" />
          <span className="text-[10px] font-semibold tracking-[0.16em] text-slate-400 uppercase lg:hidden">Sistem Akuntansi Terpadu</span>
          <h1 className="hidden lg:block font-heading text-2xl font-bold tracking-tight text-slate-900">Selamat datang kembali</h1>
        </div>

        {pemasanganAwal ? (
          <FormulirAksi aksi={buatPemilikPertamaFormulir} className="kartu space-y-4">
            <div>
              <h2 className="judul-kartu">Pemasangan awal</h2>
              <p className="subjudul-kartu">
                Basis data belum punya pengguna. Buat akun <strong>Pemilik</strong> pertama; akun lain (termasuk Superadmin) bisa ditambah dari menu Pengguna.
              </p>
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
          <FormulirAksi aksi={masukFormulir} className="kartu space-y-4">
            <div>
              <h2 className="judul-kartu">Masuk</h2>
              <p className="subjudul-kartu">Gunakan nama pengguna dan kata sandi yang diberikan Superadmin, Pemilik, atau Admin.</p>
            </div>
            <input type="hidden" name="kembali" value={kembali ?? "/"} />
            <div className="bidang">
              <label className="label" htmlFor="namaPengguna">Nama pengguna</label>
              <input id="namaPengguna" name="namaPengguna" required autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus className="isian" />
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

        <p className="text-center text-xs text-slate-400">
          <Link href="/lupa-kata-sandi" className="text-blue-600 hover:underline">Lupa kata sandi?</Link> Superadmin/Pemilik/Admin akan memberimu tautan atur ulang.
        </p>
      </div>
      </div>
    </div>
  );
}
