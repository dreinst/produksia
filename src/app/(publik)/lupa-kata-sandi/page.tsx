import Link from "next/link";
import { redirect } from "next/navigation";
import { penggunaSaatIni } from "@/lib/otentikasi";
import { mintaAturUlangFormulir } from "@/lib/aksi/otentikasi";
import FormulirAksi from "@/komponen/FormulirAksi";
import Ikon from "@/komponen/ui/Ikon";

export default async function HalamanLupaKataSandi() {
  if (await penggunaSaatIni()) redirect("/profil");

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <FormulirAksi
          aksi={mintaAturUlangFormulir}
          className="kartu space-y-4"
          pesanSukses="Permintaan dikirim. Superadmin/Pemilik/Admin akan melihatnya di menu Pengguna dan memberimu tautan untuk membuat kata sandi baru — hubungi mereka langsung (WhatsApp/telepon) agar cepat ditangani."
        >
          <div>
            <h1 className="judul-kartu">Lupa kata sandi</h1>
            <p className="subjudul-kartu">
              Sistem ini tidak mengirim email. Masukkan nama penggunamu; permintaan akan muncul di daftar Pengguna untuk Superadmin/Pemilik/Admin, yang lalu membuatkan <strong>tautan sekali pakai</strong> (berlaku 24 jam) untuk mengganti kata sandi.
            </p>
          </div>
          <div className="bidang">
            <label className="label" htmlFor="namaPengguna">Nama pengguna</label>
            <input id="namaPengguna" name="namaPengguna" required autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus className="isian" />
          </div>
          <button type="submit" className="tombol tombol-utama w-full">
            <Ikon nama="lock" className="!text-[18px]" />
            Kirim permintaan
          </button>
        </FormulirAksi>
        <p className="text-center text-xs text-slate-400">
          <Link href="/masuk" className="text-blue-600 hover:underline">Kembali ke halaman masuk</Link>
        </p>
      </div>
    </div>
  );
}
