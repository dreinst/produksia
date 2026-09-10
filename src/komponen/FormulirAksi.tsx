"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";
import type { StatusFormulir } from "@/lib/statusFormulir";

type Props = {
  aksi: (sebelumnya: StatusFormulir, dataFormulir: FormData) => Promise<StatusFormulir>;
  children: ReactNode;
  className?: string;
  /** Kalau diisi, tampil dialog konfirmasi sebelum kirim (dipakai untuk aksi hapus). */
  pesanKonfirmasi?: string;
  /** Pesan sukses untuk aksi yang TIDAK redirect (mis. simpan pengaturan). */
  pesanSukses?: string;
};

/**
 * Pembungkus <form> untuk aksi server:
 * - menampilkan pesan galat validasi dari server (via useActionState)
 * - menonaktifkan semua isian saat pengiriman berjalan (cegah dobel-klik)
 * - opsional: konfirmasi sebelum kirim
 */
export default function FormulirAksi({ aksi, children, className, pesanKonfirmasi, pesanSukses }: Props) {
  const [status, aksiFormulir, sedangProses] = useActionState(aksi, { galat: null });
  // Isian dibungkus <fieldset class="contents"> (agar bisa dinonaktifkan sekaligus), jadi jarak "space-y-*"
  // milik <form> tidak sampai ke isian. Diterjemahkan ke flex kolom + gap yang berlaku untuk anak fieldset.
  const kelas = className?.replace(/(^|\s)space-y-(\d+(?:\.\d+)?)(?=\s|$)/g, "$1flex flex-col gap-$2");

  return (
    <form
      action={aksiFormulir}
      className={kelas}
      onSubmit={(e) => {
        if (pesanKonfirmasi && !window.confirm(pesanKonfirmasi)) e.preventDefault();
      }}
      aria-busy={sedangProses}
    >
      {status.galat && (
        <div role="alert" className="muncul md:col-span-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {status.galat}
        </div>
      )}
      {pesanSukses && status.ok && !status.galat && (
        <div role="status" className="muncul md:col-span-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {pesanSukses}
        </div>
      )}
      <fieldset disabled={sedangProses} className="contents">
        {children}
      </fieldset>
    </form>
  );
}
