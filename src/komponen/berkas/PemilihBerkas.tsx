"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Ikon from "@/komponen/ui/Ikon";
import { EKSTENSI_DITERIMA } from "@/lib/tipeBerkas";
import { ukuranBerkas } from "@/komponen/berkas/IkonBerkas";

/** Sama dengan BATAS_UKURAN_BERKAS di src/lib/berkas.ts (25 MB); server tetap memeriksa ulang. */
const BATAS_UKURAN = 26_214_400;
const MAKS_PER_PILIHAN = 20;
const ACCEPT = EKSTENSI_DITERIMA.map((e) => `.${e}`).join(",");

type Pilihan = { id: string; kode: string; nama: string; perusahaanId?: string };
type Butir = { kunci: string; berkas: File; status: "siap" | "kebesaran" | "unggah" | "selesai" | "gagal"; kemajuan: number; galat?: string };

/** Kirim satu berkas ke POST /api/berkas lewat XMLHttpRequest supaya kemajuan unggah bisa ditampilkan. */
function kirim(fd: FormData, kemajuan: (persen: number) => void): Promise<{ ok: boolean; galat?: string }> {
  return new Promise((selesai) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/berkas");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) kemajuan(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      const isi = xhr.response as { ok?: boolean; galat?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && isi?.ok) selesai({ ok: true });
      else selesai({ ok: false, galat: isi?.galat || (xhr.status === 413 ? "Ukuran berkas maksimal 25 MB" : "Terjadi kesalahan. Coba lagi.") });
    };
    xhr.onerror = () => selesai({ ok: false, galat: "Koneksi terputus. Coba lagi." });
    xhr.send(fd);
  });
}

/**
 * Pemilih dan pengunggah berkas (D7 §7.3): berkas dipilih banyak sekaligus (paling banyak 20), yang melebihi 25 MB
 * ditandai dan tidak diunggah, lalu dikirim satu per satu. Galat tiap berkas berasal dari jawaban JSON server.
 */
export default function PemilihBerkas({
  jenisEntitas,
  entitasId,
  tag,
  folder,
  folderAwal,
  proyek,
  perusahaan,
  perusahaanWajib,
}: {
  jenisEntitas?: string;
  entitasId?: string;
  tag?: string;
  folder?: { kode: string; nama: string }[];
  folderAwal?: string;
  proyek?: Pilihan[];
  perusahaan?: { id: string; nama: string }[];
  perusahaanWajib?: boolean;
}) {
  const router = useRouter();
  const masukan = useRef<HTMLInputElement>(null);
  const [daftar, setDaftar] = useState<Butir[]>([]);
  const [peringatan, setPeringatan] = useState<string | null>(null);
  const [berjalan, setBerjalan] = useState(false);
  const [folderKode, setFolderKode] = useState(folderAwal ?? "");
  const [perusahaanId, setPerusahaanId] = useState("");
  const [proyekId, setProyekId] = useState("");

  const proyekTampil = (proyek ?? []).filter((p) => !perusahaanWajib || !p.perusahaanId || p.perusahaanId === perusahaanId);
  const siap = daftar.filter((b) => b.status === "siap" || b.status === "gagal");
  const ubahButir = (kunci: string, ubah: Partial<Butir>) => setDaftar((d) => d.map((b) => (b.kunci === kunci ? { ...b, ...ubah } : b)));

  function pilih(berkas: FileList | null) {
    if (!berkas || berkas.length === 0) return;
    const semua = Array.from(berkas);
    setPeringatan(semua.length > MAKS_PER_PILIHAN ? `Paling banyak ${MAKS_PER_PILIHAN} berkas sekali pilih; ${semua.length - MAKS_PER_PILIHAN} berkas sisanya tidak diambil.` : null);
    const waktu = Date.now();
    setDaftar(
      semua.slice(0, MAKS_PER_PILIHAN).map((f, i) => ({
        kunci: `${waktu}-${i}-${f.name}`,
        berkas: f,
        status: f.size > BATAS_UKURAN ? "kebesaran" : "siap",
        kemajuan: 0,
      })),
    );
    if (masukan.current) masukan.current.value = "";
  }

  async function unggah() {
    if (perusahaanWajib && !perusahaanId) {
      setPeringatan("Pilih perusahaan untuk berkas ini");
      return;
    }
    setPeringatan(null);
    setBerjalan(true);
    let berhasil = 0;
    for (const b of siap) {
      ubahButir(b.kunci, { status: "unggah", kemajuan: 0, galat: undefined });
      const fd = new FormData();
      fd.set("berkas", b.berkas);
      if (folderKode) fd.set("folderKode", folderKode);
      if (jenisEntitas) fd.set("jenisEntitas", jenisEntitas);
      if (entitasId) fd.set("entitasId", entitasId);
      if (tag) fd.set("tag", tag);
      if (proyekId) fd.set("proyekId", proyekId);
      if (perusahaanId) fd.set("perusahaanId", perusahaanId);
      const hasil = await kirim(fd, (persen) => ubahButir(b.kunci, { kemajuan: persen }));
      if (hasil.ok) berhasil++;
      ubahButir(b.kunci, hasil.ok ? { status: "selesai", kemajuan: 100 } : { status: "gagal", galat: hasil.galat });
    }
    setBerjalan(false);
    if (berhasil > 0) router.refresh();
  }

  return (
    <div className="space-y-3">
      {(folder || proyek || perusahaan) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {perusahaan && (
            <div className="space-y-1">
              <label htmlFor="unggah-perusahaan" className="label">
                Perusahaan{perusahaanWajib ? " *" : ""}
              </label>
              <select
                id="unggah-perusahaan"
                className="isian"
                value={perusahaanId}
                disabled={berjalan}
                onChange={(e) => {
                  setPerusahaanId(e.target.value);
                  setProyekId("");
                }}
              >
                <option value="">{perusahaanWajib ? "Pilih perusahaan" : "Perusahaan aktif"}</option>
                {perusahaan.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nama}
                  </option>
                ))}
              </select>
            </div>
          )}
          {folder && (
            <div className="space-y-1">
              <label htmlFor="unggah-folder" className="label">Folder</label>
              <select id="unggah-folder" className="isian" value={folderKode} disabled={berjalan} onChange={(e) => setFolderKode(e.target.value)}>
                {folder.map((f) => (
                  <option key={f.kode} value={f.kode}>
                    {f.nama}
                  </option>
                ))}
              </select>
            </div>
          )}
          {proyek && (
            <div className="space-y-1">
              <label htmlFor="unggah-proyek" className="label">Proyek/Event</label>
              <select id="unggah-proyek" className="isian" value={proyekId} disabled={berjalan || (perusahaanWajib && !perusahaanId)} onChange={(e) => setProyekId(e.target.value)}>
                <option value="">Tanpa proyek</option>
                {proyekTampil.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.kode} · {p.nama}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      <input ref={masukan} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => pilih(e.target.files)} aria-label="Pilih berkas" />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="tombol tombol-garis min-h-11" disabled={berjalan} onClick={() => masukan.current?.click()}>
          <Ikon nama="upload" className="!text-[18px]" />
          Pilih berkas
        </button>
        {siap.length > 0 && (
          <button type="button" className="tombol tombol-utama min-h-11" disabled={berjalan} onClick={unggah}>
            <Ikon nama="upload" className="!text-[18px]" />
            {berjalan ? "Mengunggah…" : `Unggah ${siap.length} berkas`}
          </button>
        )}
        <span className="text-xs text-slate-500">Maksimal 25 MB per berkas.</span>
      </div>
      {peringatan && (
        <p role="alert" className="text-xs text-rose-600">
          {peringatan}
        </p>
      )}

      {daftar.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
          {daftar.map((b) => (
            <li key={b.kunci} className="px-3 py-2 space-y-1">
              <div className="flex items-center justify-between gap-3">
                <bdi className="min-w-0 truncate">{b.berkas.name}</bdi>
                <span className={`shrink-0 text-xs ${b.status === "kebesaran" || b.status === "gagal" ? "text-rose-600" : b.status === "selesai" ? "text-emerald-700" : "text-slate-500"}`}>
                  {ukuranBerkas(b.berkas.size)}
                  {b.status === "kebesaran" && " · Melebihi 25 MB"}
                  {b.status === "selesai" && " · Berkas diunggah."}
                </span>
              </div>
              {(b.status === "unggah" || b.status === "selesai") && (
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={b.kemajuan} aria-valuemin={0} aria-valuemax={100} aria-label={`Kemajuan unggah ${b.berkas.name}`}>
                  <div className={`h-full ${b.status === "selesai" ? "bg-emerald-500" : "bg-blue-600"}`} style={{ width: `${b.kemajuan}%` }} />
                </div>
              )}
              {b.status === "gagal" && b.galat && (
                <p role="alert" className="text-xs text-rose-600">
                  {b.galat}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
