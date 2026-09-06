"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";
import type { FormState } from "@/lib/formState";

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  /** Kalau diisi, tampil dialog konfirmasi sebelum submit (dipakai untuk aksi hapus). */
  confirmMessage?: string;
  /** Pesan sukses untuk action yang TIDAK redirect (mis. simpan pengaturan). */
  successMessage?: string;
};

/**
 * Pembungkus <form> untuk server action:
 * - menampilkan pesan error validasi dari server (via useActionState)
 * - menonaktifkan semua input saat submit berjalan (cegah dobel-klik)
 * - opsional: konfirmasi sebelum submit
 */
export default function ActionForm({ action, children, className, confirmMessage, successMessage }: Props) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault();
      }}
      aria-busy={pending}
    >
      {state.error && (
        <div
          role="alert"
          className="md:col-span-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
        >
          {state.error}
        </div>
      )}
      {successMessage && state.ok && !state.error && (
        <div
          role="status"
          className="md:col-span-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
        >
          {successMessage}
        </div>
      )}
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
    </form>
  );
}
