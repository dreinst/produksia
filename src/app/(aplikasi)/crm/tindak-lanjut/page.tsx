import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { daftarPerusahaan, lingkupPerusahaan } from "@/lib/perusahaan";
import { SYARAT_TINDAK_LANJUT_TERLIHAT, daftarPenggunaCrm, periksaPengingatTindakLanjut } from "@/lib/crm";
import { bacaWaktuLokal, tanggalIso } from "@/lib/waktu";
import type { Prisma } from "@/prisma-klien/client";
import type { StatusTindakLanjut } from "@/prisma-klien/enums";
import KolomPerusahaan from "@/komponen/KolomPerusahaan";
import PesanSuksesHalaman from "@/komponen/PesanSuksesHalaman";
import DaftarTindakLanjut from "@/komponen/crm/DaftarTindakLanjut";
import FormulirTindakLanjut from "@/komponen/crm/FormulirTindakLanjut";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";

/*
 * Tindak lanjut (D4 §7.2, §3.5): pengingat baru tanpa lead, saringan status (bawaan Menunggu), milik (bawaan saya),
 * dan jatuh tempo, paginasi 50. Tindak lanjut milik lead terarsip tidak tampil. Lingkup satu perusahaan menyaring
 * perusahaan tindak lanjut; gabungan menampilkan semua dengan lencana perusahaan.
 */

const STATUS: { nilai: string; label: string }[] = [
  { nilai: "MENUNGGU", label: "Menunggu" },
  { nilai: "SELESAI", label: "Selesai" },
  { nilai: "DIBATALKAN", label: "Dibatalkan" },
  { nilai: "semua", label: "Semua" },
];
const JATUH: { nilai: string; label: string }[] = [
  { nilai: "semua", label: "Semua" },
  { nilai: "terlambat", label: "Terlambat" },
  { nilai: "hari-ini", label: "Hari ini" },
  { nilai: "7-hari", label: "7 hari ke depan" },
];
const satu = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim() : "");

export default async function HalamanTindakLanjut({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("lead.lihat");
  await periksaPengingatTindakLanjut(pengguna.id).catch(() => 0);
  const param = await bacaParamDaftar(searchParams, 50);
  const sp = await searchParams;
  const status = STATUS.some((s) => s.nilai === satu(sp.status)) ? satu(sp.status) : "MENUNGGU";
  const milik = satu(sp.milik) === "semua" ? "semua" : "saya";
  const jatuh = JATUH.some((j) => j.nilai === satu(sp.jatuh)) ? satu(sp.jatuh) : "semua";
  const [lingkup, perusahaanAktif, semuaPerusahaan] = await Promise.all([lingkupPerusahaan(), daftarPerusahaan(), daftarPerusahaan(true)]);
  const perusahaanId = lingkup.perusahaanId;
  const sekarang = new Date();

  const dan: Prisma.TindakLanjutWhereInput[] = [SYARAT_TINDAK_LANJUT_TERLIHAT];
  if (perusahaanId) dan.push({ perusahaanId });
  if (status !== "semua") dan.push({ status: status as StatusTindakLanjut });
  if (milik === "saya") dan.push({ ditugaskanKeId: pengguna.id });
  if (jatuh === "terlambat") dan.push({ status: "MENUNGGU", jatuhTempo: { lt: sekarang } });
  else if (jatuh === "hari-ini" || jatuh === "7-hari") {
    const awal = bacaWaktuLokal(`${tanggalIso(sekarang)}T00:00`) ?? sekarang;
    const akhir = new Date(awal.getTime() + (jatuh === "hari-ini" ? 1 : 8) * 86_400_000);
    dan.push({ jatuhTempo: { gte: jatuh === "hari-ini" ? awal : sekarang, lt: akhir } });
  }
  if (param.q) dan.push({ OR: [{ judul: cocokTeks(param.q) }, { catatan: cocokTeks(param.q) }, { lead: { nama: cocokTeks(param.q) } }, { lead: { namaUsaha: cocokTeks(param.q) } }] });
  const where: Prisma.TindakLanjutWhereInput = { AND: dan };

  const [total, daftar, penggunaCrm] = await Promise.all([
    db.tindakLanjut.count({ where }),
    db.tindakLanjut.findMany({
      where,
      orderBy: [{ jatuhTempo: "asc" }, { id: "asc" }],
      skip: param.lewati,
      take: param.ambil,
      include: { lead: { select: { nama: true, namaUsaha: true } }, ditugaskanKe: { select: { id: true, nama: true } } },
    }),
    daftarPenggunaCrm(db),
  ]);
  const petaPerusahaan = new Map(semuaPerusahaan.map((p) => [p.id, p]));
  const tambahan = { status: status === "MENUNGGU" ? undefined : status, milik: milik === "saya" ? undefined : milik, jatuh: jatuh === "semua" ? undefined : jatuh };
  const adaSaringan = !!param.q || status !== "MENUNGGU" || milik !== "saya" || jatuh !== "semua";

  return (
    <div className="space-y-6">
      <PesanSuksesHalaman />
      <KepalaHalaman jejak={[{ label: "CRM", href: "/crm/dasbor" }, { label: "Tindak Lanjut" }]} judul="Tindak Lanjut" subjudul="Pengingat telepon, pertemuan, dan kirim proposal untuk lead dan pelanggan." />

      {punyaHak(pengguna, "lead.buat") && (
        <details className="kartu" open={total === 0 && !adaSaringan}>
          <summary className="judul-kartu cursor-pointer">Pengingat baru</summary>
          <div className="mt-4">
            <FormulirTindakLanjut kolomPerusahaan={<KolomPerusahaan lingkup={lingkup} daftar={perusahaanAktif} />} pengguna={penggunaCrm} penggunaId={pengguna.id} />
          </div>
        </details>
      )}

      <form method="get" className="kartu flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 !p-4" aria-label="Saring tindak lanjut">
        {param.q && <input type="hidden" name="q" value={param.q} />}
        <div className="bidang">
          <label className="label" htmlFor="saring-status-tl">
            Status
          </label>
          <select id="saring-status-tl" name="status" defaultValue={status} className="isian isian-kecil">
            {STATUS.map((s) => (
              <option key={s.nilai} value={s.nilai}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="bidang">
          <label className="label" htmlFor="saring-milik-tl">
            Milik
          </label>
          <select id="saring-milik-tl" name="milik" defaultValue={milik} className="isian isian-kecil">
            <option value="saya">Saya</option>
            <option value="semua">Semua</option>
          </select>
        </div>
        <div className="bidang">
          <label className="label" htmlFor="saring-jatuh-tl">
            Jatuh tempo
          </label>
          <select id="saring-jatuh-tl" name="jatuh" defaultValue={jatuh} className="isian isian-kecil">
            {JATUH.map((j) => (
              <option key={j.nilai} value={j.nilai}>
                {j.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" className="tombol tombol-utama tombol-kecil">
            Terapkan
          </button>
          <Link href="/crm/tindak-lanjut" className="tombol-tautan text-sm">
            Atur ulang
          </Link>
        </div>
      </form>

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari judul, catatan, atau lead…" tambahan={tambahan} adaSaringan={adaSaringan} />
        <div className="px-5 md:px-6 pb-2">
          <DaftarTindakLanjut
            daftar={daftar.map((t) => {
              const p = perusahaanId ? null : petaPerusahaan.get(t.perusahaanId);
              return { ...t, perusahaan: p ? { kode: p.kode, nama: p.nama, warna: p.warna } : null };
            })}
            bolehUbah={punyaHak(pengguna, "lead.ubah")}
            bolehHapus={punyaHak(pengguna, "lead.hapus")}
            pengguna={penggunaCrm}
            sekarang={sekarang}
            kosong={adaSaringan ? "Tidak ada tindak lanjut yang cocok dengan saringan." : undefined}
          />
        </div>
      </div>
    </div>
  );
}
