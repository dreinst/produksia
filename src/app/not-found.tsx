import Link from "next/link";

/** Dirender tanpa kerangka aplikasi (bisa terjadi sebelum masuk), jadi dibuat mandiri & terpusat. */
export default function HalamanTidakDitemukan() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="kartu w-full max-w-md space-y-4 text-center">
        <p className="mono text-slate-400">404</p>
        <h1 className="judul-halaman">Halaman tidak ditemukan</h1>
        <p className="text-sm text-slate-600">Alamat yang kamu buka tidak ada atau datanya sudah dihapus.</p>
        <Link href="/" className="tombol tombol-utama">
          Ke Beranda
        </Link>
      </div>
    </div>
  );
}
