import Link from "next/link";
import { db } from "@/lib/db";
import { punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { daftarPerusahaan } from "@/lib/perusahaan";
import { formatWaktu } from "@/lib/waktu";
import type { Prisma } from "@/prisma-klien/client";
import KartuKpi from "@/komponen/ui/KartuKpi";

const TUJUH_HARI_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Warna lencana aksi log. Halaman Pengaturan › Log Aktivitas lama memakai rose untuk semua aksi, jadi tidak ada
 * pemetaan lama yang bisa diikuti; di sini BUAT hijau, UBAH biru, HAPUS merah, aksi lain abu-abu.
 */
const WARNA_AKSI_LOG: Record<string, string> = { BUAT: "lencana-emerald", UBAH: "lencana-blue", HAPUS: "lencana-rose" };
export function kelasLencanaAksiLog(aksi: string): string {
  return `lencana ${WARNA_AKSI_LOG[aksi] ?? "lencana-slate"}`;
}

/**
 * Log dalam lingkup: satu perusahaan = log perusahaan itu ditambah log tingkat sistem (perusahaanId null).
 * Pencatat lama belum mengisi perusahaanId, jadi catatan tanpa perusahaan bisa berasal dari perusahaan lain;
 * karena itu panel menandainya di subjudul.
 * Daftar terbaru hanya memuat catatan tanpa modul (akuntansi dan umum), yang memang terbuka bagi pemegang
 * log-aktivitas.lihat; catatan modul baru menunggu aturan visibilitas per modul (D7 §3.7.4).
 */
function saringLogLingkup(perusahaanId: string | null): Prisma.LogAktivitasWhereInput {
  return perusahaanId ? { OR: [{ perusahaanId }, { perusahaanId: null }] } : {};
}

export async function muatRingkasanSistem(perusahaanId: string | null, sekarang: Date = new Date()) {
  const sejak = new Date(sekarang.getTime() - TUJUH_HARI_MS);
  const lingkup = saringLogLingkup(perusahaanId);
  const [perusahaan, pengguna, penggunaAktif, logAuth, masuk7Hari, aktivitas7Hari, terbaru] = await Promise.all([
    daftarPerusahaan(false, db),
    db.pengguna.count(),
    db.pengguna.count({ where: { aktif: true } }),
    // pencatatan MASUK modul auth (D7 §3.7.3) belum dibangun; selama belum ada satu pun, angka masuk tidak bermakna
    db.logAktivitas.count({ where: { modul: "auth" } }),
    db.logAktivitas.count({ where: { AND: [lingkup, { aksi: "MASUK", modul: "auth", waktu: { gte: sejak } }] } }),
    db.logAktivitas.count({ where: { AND: [lingkup, { waktu: { gte: sejak } }] } }),
    db.logAktivitas.findMany({
      where: { AND: [lingkup, { modul: null }] },
      orderBy: [{ waktu: "desc" }, { id: "desc" }],
      take: 8,
      select: { id: true, waktu: true, penggunaNama: true, aksi: true, jenis: true, nomor: true, keterangan: true },
    }),
  ]);
  return { perusahaanAktif: perusahaan.length, pengguna, penggunaAktif, pencatatanMasukAktif: logAuth > 0, masuk7Hari, aktivitas7Hari, terbaru };
}

/** Tab "Sistem" beranda (D7 §3.5): butuh pengguna.kelola dan log-aktivitas.lihat. */
export default async function PanelSistem({ pengguna, perusahaanId }: { pengguna: PenggunaSesi; perusahaanId: string | null }) {
  if (!punyaHak(pengguna, "pengguna.kelola") || !punyaHak(pengguna, "log-aktivitas.lihat")) return null;
  const data = await muatRingkasanSistem(perusahaanId);

  return (
    <div className="space-y-7">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <KartuKpi judul="Perusahaan aktif" ikon="domain" nilai={data.perusahaanAktif} awalan="" />
        <KartuKpi judul="Pengguna" ikon="group" nilai={data.pengguna} awalan="" sub={`${data.penggunaAktif.toLocaleString("id-ID")} aktif`} />
        {data.pencatatanMasukAktif ? (
          <KartuKpi judul="Masuk 7 hari" ikon="person" nilai={data.masuk7Hari} awalan="" />
        ) : (
          <KartuKpi judul="Masuk 7 hari" ikon="person" nilai="Belum dicatat" sub="Pencatatan masuk belum aktif" />
        )}
        <KartuKpi
          judul="Aktivitas 7 hari"
          ikon="history"
          nilai={data.aktivitas7Hari}
          awalan=""
          sub={perusahaanId ? "Termasuk catatan tanpa perusahaan" : undefined}
        />
      </div>

      <div className="kartu">
        <div className="kepala-kartu">
          <div>
            <h2 className="judul-kartu">Aktivitas terbaru</h2>
            <p className="subjudul-kartu">
              {perusahaanId ? "Delapan catatan terakhir, termasuk catatan tanpa perusahaan." : "Delapan catatan terakhir di log aktivitas."}
            </p>
          </div>
          <Link href="/pengaturan/log-aktivitas" className="tombol tombol-lembut tombol-kecil">Buka log aktivitas</Link>
        </div>
        {data.terbaru.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada aktivitas tercatat.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.terbaru.map((l) => (
              <li key={l.id} className="py-2.5 flex flex-wrap items-start justify-between gap-x-3 gap-y-1 text-sm">
                <div className="min-w-0">
                  <div className="text-slate-800">
                    <span className={`${kelasLencanaAksiLog(l.aksi)} mr-2`}>{l.aksi}</span>
                    <span className="text-slate-500">{l.jenis}</span> <span className="mono font-semibold">{l.nomor}</span>
                  </div>
                  {l.keterangan && <div className="text-xs text-slate-500 truncate">{l.keterangan}</div>}
                </div>
                <div className="text-xs text-slate-400 whitespace-nowrap">{l.penggunaNama} · {formatWaktu(l.waktu)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
