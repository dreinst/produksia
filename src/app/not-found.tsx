import Link from "next/link";

export default function NotFound() {
  return (
    <div className="max-w-lg space-y-4">
      <h1 className="judul-halaman">Halaman tidak ditemukan</h1>
      <p className="text-sm text-slate-600">Alamat yang kamu buka tidak ada atau datanya sudah dihapus.</p>
      <Link href="/" className="tombol tombol-utama">
        Ke Beranda
      </Link>
    </div>
  );
}
