"use client";

import { useEffect, useRef, useState } from "react";
import Ikon from "@/komponen/ui/Ikon";

type Props = {
  name: string;
  maksimal?: number;
  wajib?: boolean;
  /** Teks tombol. */
  label?: string;
};

const SISI_MAKS = 1280;

/** Kompresi di klien supaya foto HP (3-8 MB) muat di batas 1 MB server. Gagal dekode: kirim berkas asli. */
async function kompres(berkas: File): Promise<File> {
  try {
    const gambar = await createImageBitmap(berkas, { imageOrientation: "from-image" });
    const skala = Math.min(1, SISI_MAKS / Math.max(gambar.width, gambar.height));
    const kanvas = document.createElement("canvas");
    kanvas.width = Math.round(gambar.width * skala);
    kanvas.height = Math.round(gambar.height * skala);
    kanvas.getContext("2d")?.drawImage(gambar, 0, 0, kanvas.width, kanvas.height);
    gambar.close();
    const blob = await new Promise<Blob | null>((selesai) => kanvas.toBlob(selesai, "image/jpeg", 0.8));
    if (!blob) return berkas;
    return new File([blob], berkas.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return berkas;
  }
}

/** Input foto kamera untuk formulir aksi server: tombol besar, pratinjau, dan kompresi sebelum kirim. */
export default function PemilihFoto({ name, maksimal = 1, wajib, label = "Ambil foto" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const tombolRef = useRef<HTMLButtonElement>(null);
  const [daftar, setDaftar] = useState<{ berkas: File; url: string }[]>([]);
  const [memproses, setMemproses] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  const tulisKeInput = (berkas: File[]) => {
    const dt = new DataTransfer();
    for (const b of berkas) dt.items.add(b);
    if (inputRef.current) inputRef.current.files = dt.files;
  };

  // React me-reset formulir tiap aksi server selesai (juga saat gagal) dan itu mengosongkan input file,
  // padahal pratinjau masih tampil. Berkas ditulis ulang setelah reset bawaan berjalan (microtask) supaya
  // validasi required tetap lolos saat kirim ulang. Bila aksi sukses, FormulirAksi memasang ulang isian
  // sehingga komponen ini mulai kosong lagi.
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const tulisUlang = () => tulisKeInput(daftar.map((d) => d.berkas));
    const saatReset = () => queueMicrotask(tulisUlang);
    form.addEventListener("submit", tulisUlang);
    form.addEventListener("reset", saatReset);
    return () => {
      form.removeEventListener("submit", tulisUlang);
      form.removeEventListener("reset", saatReset);
    };
  }, [daftar]);

  const daftarTerakhir = useRef(daftar);
  useEffect(() => {
    daftarTerakhir.current = daftar;
  }, [daftar]);
  useEffect(() => () => daftarTerakhir.current.forEach((d) => URL.revokeObjectURL(d.url)), []);

  const saatPilih = async (dipilih: FileList | null) => {
    if (!dipilih?.length) return;
    const form = inputRef.current?.form;
    const tombolKirim = form?.querySelector<HTMLButtonElement>("button[type=submit]");
    setMemproses(true);
    if (tombolKirim) tombolKirim.disabled = true;
    try {
      const baru = await Promise.all(Array.from(dipilih).map(kompres));
      // Pilihan terbaru menang: maksimal 1 berarti ganti, lebih dari 1 berarti ditambah lalu dipotong dari depan.
      const semua = [...daftar, ...baru.map((b) => ({ berkas: b, url: URL.createObjectURL(b) }))];
      const gabungan = semua.slice(-maksimal);
      semua.slice(0, semua.length - gabungan.length).forEach((d) => URL.revokeObjectURL(d.url));
      setDaftar(gabungan);
      tulisKeInput(gabungan.map((d) => d.berkas));
      setGalat(null);
    } finally {
      setMemproses(false);
      if (tombolKirim) tombolKirim.disabled = false;
    }
  };

  const hapus = (i: number) => {
    URL.revokeObjectURL(daftar[i].url);
    const sisa = daftar.filter((_, idx) => idx !== i);
    setDaftar(sisa);
    tulisKeInput(sisa.map((d) => d.berkas));
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        name={name}
        accept="image/*"
        capture="environment"
        multiple={maksimal > 1}
        required={wajib}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => saatPilih(e.target.files)}
        // Input tersembunyi: gelembung validasi bawaan tidak terlihat, jadi pesan ditampilkan sendiri di bawah tombol.
        onInvalid={(e) => {
          e.preventDefault();
          setGalat("Foto wajib dilampirkan");
          tombolRef.current?.focus();
        }}
      />
      <button ref={tombolRef} type="button" className="tombol tombol-garis min-h-11 w-full" disabled={memproses} onClick={() => inputRef.current?.click()}>
        <Ikon nama="upload_file" className="!text-[18px]" /> {memproses ? "Memproses foto" : label}
        {maksimal > 1 && !memproses && <span className="redup text-xs">({daftar.length}/{maksimal})</span>}
      </button>
      {galat && <p role="alert" className="text-xs text-rose-600">{galat}</p>}
      {daftar.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {daftar.map((d, i) => (
            <li key={d.url} className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={d.url} alt="" className="h-16 w-16 rounded-lg object-cover border border-slate-200" />
              <span className="redup text-xs">{Math.round(d.berkas.size / 1024)} KB</span>
              <button type="button" className="tombol tombol-garis tombol-kecil min-h-11 min-w-11 px-2" aria-label="Hapus foto" onClick={() => hapus(i)}>
                <Ikon nama="close" className="!text-[16px]" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
