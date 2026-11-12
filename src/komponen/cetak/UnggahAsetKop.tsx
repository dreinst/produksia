"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Ikon from "@/komponen/ui/Ikon";

/** Sama dengan BATAS_UKURAN_ASET_KOP (src/lib/cetak/kop.ts); server memeriksa ulang ukuran, format, dan dimensi. */
const BATAS_UKURAN = 2 * 1024 * 1024;

/**
 * Unggah satu gambar kop (D3 §7.1): pilih PNG atau JPEG, periksa ukuran di peramban, kirim ke
 * POST /api/cetak/kop/{kopId}/aset, lalu muat ulang data halaman. Galat dari jawaban JSON server ditampilkan apa adanya.
 */
export default function UnggahAsetKop({ kopId, jenis, label }: { kopId: string; jenis: string; label: string }) {
  const router = useRouter();
  const masukan = useRef<HTMLInputElement>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  async function unggah() {
    const berkas = masukan.current?.files?.[0];
    setGalat(null);
    if (!berkas) return setGalat("Pilih satu gambar");
    if (berkas.size > BATAS_UKURAN) return setGalat("Ukuran gambar maksimal 2 MB");
    const fd = new FormData();
    fd.set("jenis", jenis);
    fd.set("gambar", berkas);
    setSibuk(true);
    try {
      const jawab = await fetch(`/api/cetak/kop/${encodeURIComponent(kopId)}/aset`, { method: "POST", body: fd });
      const isi = (await jawab.json().catch(() => null)) as { ok?: boolean; galat?: string } | null;
      if (!jawab.ok || !isi?.ok) return setGalat(isi?.galat || (jawab.status === 413 ? "Ukuran gambar maksimal 2 MB" : "Terjadi kesalahan. Coba lagi."));
      if (masukan.current) masukan.current.value = "";
      router.refresh();
    } catch {
      setGalat("Koneksi terputus. Coba lagi.");
    } finally {
      setSibuk(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={masukan} type="file" accept="image/png,image/jpeg" aria-label={`Gambar ${label}`} className="text-xs max-w-[14rem]" />
        <button type="button" onClick={unggah} disabled={sibuk} className="tombol tombol-garis !py-1 !text-xs">
          <Ikon nama="upload" className="!text-[16px]" />
          {sibuk ? "Mengunggah…" : "Unggah"}
        </button>
      </div>
      {galat && (
        <p role="alert" className="text-xs text-rose-600">
          {galat}
        </p>
      )}
    </div>
  );
}
