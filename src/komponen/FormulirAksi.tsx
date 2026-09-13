"use client";

import { useActionState, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { StatusFormulir } from "@/lib/statusFormulir";
import type { Verifikasi } from "@/lib/verifikasi";
import DialogVerifikasi, { type RingkasanVerifikasi } from "@/komponen/ui/DialogVerifikasi";

type Props = {
  aksi: (sebelumnya: StatusFormulir, dataFormulir: FormData) => Promise<StatusFormulir>;
  children: ReactNode;
  className?: string;
  /** Kalau diisi, tampil dialog konfirmasi sebelum kirim (dipakai untuk aksi hapus). */
  pesanKonfirmasi?: string;
  /** Pesan sukses untuk aksi yang TIDAK redirect (mis. simpan pengaturan). */
  pesanSukses?: string;
  /** Kalau diisi, sebelum kirim tampil dialog ringkasan isian + peringatan (verifikasi singkat agar tidak salah input). */
  verifikasi?: Verifikasi;
};

const rupiah = (n: number) => n.toLocaleString("id-ID");

/** Ringkasan hidden "baris" (JSON dari editor baris): barang (jumlah × harga) atau jurnal (debit/kredit). */
function ringkasBaris(form: HTMLFormElement, mentah: string): string {
  let daftar: Record<string, unknown>[];
  try {
    daftar = JSON.parse(mentah);
  } catch {
    return "-";
  }
  if (!Array.isArray(daftar)) return "-";
  const teksOpsi = (id: unknown) => form.querySelector<HTMLOptionElement>(`option[value="${CSS.escape(String(id))}"]`)?.textContent?.trim() ?? String(id);
  const terisi = daftar.filter((b) => b.barangId || b.akunId);
  if (terisi.length === 0) return "-";
  if (terisi[0].barangId !== undefined) {
    const total = terisi.reduce((s, b) => s + Number(b.jumlah ?? 0) * Number(b.harga ?? 0), 0);
    const rinci = terisi.map((b) => `${rupiah(Number(b.jumlah ?? 0))} × ${teksOpsi(b.barangId)}${b.harga !== undefined ? ` @ ${rupiah(Number(b.harga))}` : ""}`);
    return `${rinci.join("\n")}${terisi.some((b) => b.harga !== undefined) ? `\nTotal Rp ${rupiah(total)}` : ""}`;
  }
  const debit = terisi.reduce((s, b) => s + Number(b.debit ?? 0), 0);
  const kredit = terisi.reduce((s, b) => s + Number(b.kredit ?? 0), 0);
  return `${terisi.length} baris · Debit Rp ${rupiah(debit)} · Kredit Rp ${rupiah(kredit)}`;
}

/** Membaca isian formulir menjadi ringkasan label → nilai, plus peringatan menurut aturan. */
function susunRingkasan(form: HTMLFormElement, v: Verifikasi): RingkasanVerifikasi {
  const baris: { label: string; nilai: string }[] = [];
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
    if (!el.name || el.disabled) continue;
    if (el instanceof HTMLInputElement && el.type === "hidden") {
      if (el.name === "baris") baris.push({ label: "Baris", nilai: ringkasBaris(form, el.value) });
      continue;
    }
    if (el instanceof HTMLInputElement && ["submit", "button", "checkbox", "radio"].includes(el.type)) continue;
    const label = (el.id && form.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.replace(/\s*\*\s*$/, "").trim()) || el.name;
    let nilai = "";
    if (el instanceof HTMLSelectElement) nilai = el.value ? (el.selectedOptions[0]?.textContent?.trim() ?? el.value) : "";
    else if (el instanceof HTMLInputElement && el.type === "number") nilai = el.value ? rupiah(Number(el.value)) : "";
    else if (el instanceof HTMLInputElement && el.type === "date") nilai = el.value ? new Date(`${el.value}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }) : "";
    else nilai = el.value;
    baris.push({ label, nilai: nilai || "-" });
  }
  const peringatan: string[] = [];
  for (const aturan of v.peringatan ?? []) {
    const el = form.elements.namedItem(aturan.bidang);
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
    if ("bilaKosong" in aturan) {
      if (!el.value) peringatan.push(aturan.bilaKosong);
    } else if (el instanceof HTMLSelectElement && el.selectedOptions[0]?.dataset[aturan.bilaAtribut.nama] === aturan.bilaAtribut.nilai) {
      peringatan.push(aturan.pesan);
    }
  }
  return { judul: v.judul ?? "Periksa sebelum disimpan", baris, peringatan };
}

/**
 * Pembungkus <form> untuk aksi server:
 * - menampilkan pesan galat validasi dari server (via useActionState)
 * - menonaktifkan semua isian saat pengiriman berjalan (cegah dobel-klik)
 * - opsional: konfirmasi sebelum kirim, atau dialog verifikasi (ringkasan isian + peringatan)
 */
export default function FormulirAksi({ aksi, children, className, pesanKonfirmasi, pesanSukses, verifikasi }: Props) {
  const [status, aksiFormulir, sedangProses] = useActionState(aksi, { galat: null });
  const [ringkasan, setRingkasan] = useState<RingkasanVerifikasi | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const sudahDiverifikasi = useRef(false);
  const pengirim = useRef<HTMLElement | null>(null);
  // Isian dibungkus <fieldset class="contents"> (agar bisa dinonaktifkan sekaligus), jadi jarak "space-y-*"
  // milik <form> tidak sampai ke isian. Diterjemahkan ke flex kolom + gap yang berlaku untuk anak fieldset.
  const kelas = className?.replace(/(^|\s)space-y-(\d+(?:\.\d+)?)(?=\s|$)/g, "$1flex flex-col gap-$2");

  return (
    <>
      <form
        ref={formRef}
        action={aksiFormulir}
        className={kelas}
        onSubmit={(e) => {
          if (pesanKonfirmasi && !window.confirm(pesanKonfirmasi)) {
            e.preventDefault();
            return;
          }
          if (verifikasi && !sudahDiverifikasi.current) {
            e.preventDefault();
            // tombol yang ditekan ikut dikirim ulang saat pengguna menekan "Ya, simpan" (mis. name="lanjut" value="faktur")
            pengirim.current = ((e.nativeEvent as SubmitEvent).submitter as HTMLElement | null) ?? null;
            setRingkasan(susunRingkasan(e.currentTarget, verifikasi));
            return;
          }
          sudahDiverifikasi.current = false;
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
      {ringkasan && (
        <DialogVerifikasi
          ringkasan={ringkasan}
          onBatal={() => setRingkasan(null)}
          onLanjut={() => {
            setRingkasan(null);
            sudahDiverifikasi.current = true;
            formRef.current?.requestSubmit(pengirim.current ?? undefined);
          }}
        />
      )}
    </>
  );
}
