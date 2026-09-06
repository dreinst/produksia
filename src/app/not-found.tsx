import Link from "next/link";

export default function NotFound() {
  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">Halaman tidak ditemukan</h1>
      <p className="text-sm text-zinc-600">Alamat yang kamu buka tidak ada atau datanya sudah dihapus.</p>
      <Link href="/" className="inline-block rounded bg-black px-4 py-2 text-sm text-white">
        Ke Dashboard
      </Link>
    </div>
  );
}
