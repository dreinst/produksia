"use client";

import Link from "next/link";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-lg space-y-4">
      <h1 className="page-title">Terjadi kesalahan</h1>
      <p className="text-sm text-slate-600">
        Halaman ini gagal dimuat. Coba muat ulang; kalau masih gagal, catat kode berikut untuk pengecekan log
        server: <code className="font-mono text-xs">{error.digest ?? "-"}</code>
      </p>
      {process.env.NODE_ENV !== "production" && (
        <pre className="overflow-x-auto rounded border bg-slate-50 p-3 text-xs text-red-700">{error.message}</pre>
      )}
      <div className="flex gap-3">
        <button onClick={reset} className="btn btn-primary">
          Coba lagi
        </button>
        <Link href="/" className="btn btn-outline">
          Ke Dashboard
        </Link>
      </div>
    </div>
  );
}
