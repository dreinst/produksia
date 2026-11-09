import Link from "next/link";
import { labelTab, type TabBeranda as KodeTab } from "@/lib/beranda";

/** Baris tab beranda; hanya dirender pemanggil bila tab yang boleh lebih dari satu. */
export default function TabBeranda({ daftar, aktif }: { daftar: readonly KodeTab[]; aktif: KodeTab }) {
  return (
    <nav aria-label="Tab beranda" className="flex flex-wrap gap-2">
      {daftar.map((kode) => (
        <Link
          key={kode}
          href={`/?tab=${kode}`}
          className={`tombol tombol-kecil ${kode === aktif ? "tombol-utama" : "tombol-garis"}`}
          aria-current={kode === aktif ? "page" : undefined}
        >
          {labelTab(kode)}
        </Link>
      ))}
    </nav>
  );
}
