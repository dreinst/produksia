/** Kredit pembuat dan pengelola: dipakai di halaman publik (masuk, lupa/atur ulang kata sandi) dan di bawah kanvas aplikasi. */
export default function KakiHalaman({ className = "" }: { className?: string }) {
  return (
    <footer className={`flex items-center justify-center gap-3 text-[11px] text-slate-400 ${className}`}>
      <span>Made by dreinst</span>
      <span aria-hidden="true" className="h-3.5 w-px bg-slate-300" />
      <span className="flex items-center gap-2">
        Organized by
        {/* eslint-disable-next-line @next/next/no-img-element -- vector logo, tanpa optimasi */}
        <img src="/logo/dpro-ringkas.svg?v=2" alt="D'PRO" className="h-4 w-auto shrink-0 opacity-70" />
      </span>
    </footer>
  );
}
