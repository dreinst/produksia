"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { StatusFormulir } from "@/lib/statusFormulir";
import type { Verifikasi } from "@/lib/verifikasi";
import DialogVerifikasi, { type RingkasanVerifikasi } from "@/komponen/ui/DialogVerifikasi";
import { umumkanPesanSukses } from "@/komponen/PesanSuksesHalaman";
import { subtotalKlien, type AngkaKlien } from "@/lib/hitungDokumenKlien";

type Props = {
  aksi: (sebelumnya: StatusFormulir, dataFormulir: FormData) => Promise<StatusFormulir>;
  children: ReactNode;
  className?: string;
  /** Kalau diisi, tampil dialog konfirmasi sebelum kirim (dipakai untuk aksi hapus). */
  pesanKonfirmasi?: string;
  /** Pesan sukses untuk aksi yang TIDAK redirect (mis. simpan pengaturan). */
  pesanSukses?: string;
  /**
   * Pesan sukses untuk aksi yang ikut melenyapkan formulir ini (mis. baris terhapus sesudah revalidasi). Ditampilkan
   * oleh <PesanSuksesHalaman /> yang dipasang halaman di luar baris.
   */
  pesanSuksesHalaman?: string;
  /** Kalau diisi, sebelum kirim tampil dialog ringkasan isian + peringatan (verifikasi singkat agar tidak salah input). */
  verifikasi?: Verifikasi;
  /**
   * Alamat tujuan sesudah aksi yang TIDAK redirect berhasil (mis. halaman ubah kembali ke detail). Dipakai formulir
   * berisi <select> terkendali: React mengatur ulang formulir sesudah aksi, sehingga pilihan terkendali tampil kembali ke
   * opsi pertama walau state-nya benar.
   */
  alihkanKe?: string;
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
  // baris bebas penjualan (barangId kosong, bernama) ikut diringkas; JSON lama tidak punya `nama` sehingga hasilnya sama
  const terisi = daftar.filter((b) => b.barangId || b.akunId || b.karyawanId || b.nama);
  if (terisi.length === 0) return "-";
  if (terisi[0].barangId !== undefined) {
    // Formulir penawaran/pesanan penjualan baru (PenyusunDokumenPenjualan, bertanda isian jenisFee): jumlah baris hanya
    // subtotal sebelum diskon, fee, dan PPN, jadi labelnya "Subtotal baris", dan angkanya dihitung dalam sen bulat lewat
    // hitungDokumenKlien seperti server. Baris berkunci frekuensi atau nama di formulir lain dibulatkan per baris ke sen.
    // JSON lama tetap memakai hitungan semula.
    const penyusunBaru = form.elements.namedItem("jenisFee") !== null;
    const nilai = (b: Record<string, unknown>) => {
      const v = Number(b.jumlah ?? 0) * Number(b.frekuensi || 1) * Number(b.harga ?? 0);
      return b.frekuensi !== undefined || b.nama !== undefined ? Math.round(v * 100) / 100 : v;
    };
    const total = penyusunBaru
      ? subtotalKlien(terisi.map((b) => ({ jumlah: b.jumlah as AngkaKlien, harga: b.harga as AngkaKlien, frekuensi: b.frekuensi as AngkaKlien })))
      : terisi.reduce((s, b) => s + nilai(b), 0);
    const nama = (b: Record<string, unknown>) => (b.barangId ? teksOpsi(b.barangId) : String(b.nama));
    const frek = (b: Record<string, unknown>) => (b.frekuensi ? ` × ${b.frekuensi}${b.satuanFrekuensi ? ` ${b.satuanFrekuensi}` : ""}` : "");
    const rinci = terisi.map((b) => `${rupiah(Number(b.jumlah ?? 0))} × ${nama(b)}${frek(b)}${b.harga !== undefined ? ` @ ${rupiah(Number(b.harga))}` : ""}`);
    return `${rinci.join("\n")}${terisi.some((b) => b.harga !== undefined) ? `\n${penyusunBaru ? "Subtotal baris" : "Total"} Rp ${rupiah(total)}` : ""}`;
  }
  if (terisi[0].karyawanId !== undefined) {
    const diterima = (b: Record<string, unknown>) => Number(b.gajiPokok ?? 0) + Number(b.tunjangan ?? 0) - Number(b.potongan ?? 0);
    const total = terisi.reduce((s, b) => s + diterima(b), 0);
    const rinci = terisi.map((b) => `${teksOpsi(b.karyawanId)}: Rp ${rupiah(diterima(b))}`);
    return `${rinci.join("\n")}\nTotal diterima Rp ${rupiah(total)}`;
  }
  const debit = terisi.reduce((s, b) => s + Number(b.debit ?? 0), 0);
  const kredit = terisi.reduce((s, b) => s + Number(b.kredit ?? 0), 0);
  return `${terisi.length} baris · Debit Rp ${rupiah(debit)} · Kredit Rp ${rupiah(kredit)}`;
}

/** Ringkasan hidden "rencanaTermin" (JSON editor termin penjualan): jumlah butir. */
function ringkasTermin(mentah: string): string {
  try {
    const daftar = JSON.parse(mentah);
    return Array.isArray(daftar) ? `Rencana termin: ${daftar.length} butir` : "-";
  } catch {
    return "-";
  }
}

/** Membaca isian formulir menjadi ringkasan label → nilai, plus peringatan menurut aturan. */
function susunRingkasan(form: HTMLFormElement, v: Verifikasi): RingkasanVerifikasi {
  const baris: { label: string; nilai: string }[] = [];
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
    if (!el.name || el.disabled) continue;
    if (el instanceof HTMLInputElement && el.type === "hidden") {
      if (el.name === "baris") baris.push({ label: "Baris", nilai: ringkasBaris(form, el.value) });
      else if (el.name === "rencanaTermin" && el.value) baris.push({ label: "Termin", nilai: ringkasTermin(el.value) });
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
export default function FormulirAksi({ aksi, children, className, pesanKonfirmasi, pesanSukses, pesanSuksesHalaman, verifikasi, alihkanKe }: Props) {
  // Tanpa pesanSuksesHalaman, aksi server dipakai langsung seperti semula.
  const aksiDipakai = pesanSuksesHalaman
    ? async (sebelumnya: StatusFormulir, dataFormulir: FormData) => {
        // alamat dicatat sebelum await: pesan dibuang bila pengguna sudah pindah halaman saat aksi berjalan
        const alamatAwal = umumkanPesanSukses(null);
        const hasil = await aksi(sebelumnya, dataFormulir);
        if (hasil.ok && !hasil.galat) umumkanPesanSukses(pesanSuksesHalaman, alamatAwal);
        return hasil;
      }
    : aksi;
  const [status, aksiFormulir, sedangProses] = useActionState(aksiDipakai, { galat: null });
  const [ringkasan, setRingkasan] = useState<RingkasanVerifikasi | null>(null);
  // Aksi sukses tanpa redirect: isian dipasang ulang (ganti key) supaya state komponen klien
  // (mis. pratinjau foto, editor baris) ikut kosong seperti input biasa yang direset React.
  const [statusTerakhir, setStatusTerakhir] = useState(status);
  const [kunciIsian, setKunciIsian] = useState(0);
  if (status !== statusTerakhir) {
    setStatusTerakhir(status);
    if (status.ok) setKunciIsian((k) => k + 1);
  }
  const router = useRouter();
  useEffect(() => {
    if (alihkanKe && status.ok && !status.galat) router.push(alihkanKe);
  }, [status, alihkanKe, router]);
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
        <fieldset key={kunciIsian} disabled={sedangProses} className="contents">
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
