/** Kredit pembuat dan pengelola: dipakai di halaman publik (masuk, lupa/atur ulang kata sandi) dan di bawah kanvas aplikasi. */
export default function KakiHalaman({ className = "" }: { className?: string }) {
  return (
    <footer className={`flex flex-col items-center gap-2 text-center text-[11px] text-slate-400 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- PNG statis kecil, tanpa optimasi */}
      <img src="/logo/dpro-logo.png" alt="D'Production Event Organizer" className="h-9 w-auto" />
      <p>Dibuat oleh Dreinst dan dikelola oleh D&rsquo;Production Event Organizer</p>
    </footer>
  );
}
