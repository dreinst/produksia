/** Ikon Material Symbols (Outlined). Nama ikon: https://fonts.google.com/icons */
export default function Ikon({ nama, className = "" }: { nama: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {nama}
    </span>
  );
}
