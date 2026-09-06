/** Ikon Material Symbols (Outlined). Nama ikon: https://fonts.google.com/icons */
export default function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}
