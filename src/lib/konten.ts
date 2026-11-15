import type { Konten, Prisma, PrismaClient } from "@/prisma-klien/client";
import type { PlatformKonten, PrioritasDesain, StatusKonten, StatusPersetujuanKonten, StatusTugasDesain } from "@/prisma-klien/enums";
import {
  HARI_TENGGAT_DESAIN,
  LABEL_PLATFORM,
  STATUS_DESAIN,
  STATUS_KONTEN,
  URUTAN_PLATFORM,
  URUTAN_STATUS_KONTEN,
  TITIK_PLATFORM,
  nadaKanban,
} from "@/lib/labelPemasaran";
import { saringPerusahaan } from "@/lib/perusahaan";
import { SYARAT_TUGAS_AKTIF } from "@/lib/desain";
import { bacaWaktuLokal, formatTanggal, tanggalIso } from "@/lib/waktu";
import { punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { cocokTeks, type ParamDaftar } from "@/lib/daftar";
import { potongAman } from "@/lib/tipeBerkas";
import type { KartuKanban, KolomKanban } from "@/komponen/ui/Kanban";
import {
  JENIS_LOG_KONTEN,
  JENIS_LOG_TUGAS,
  catatLogPemasaran,
  enumWajib,
  geserHari,
  idTersimpan,
  jamOpsional,
  kirimNotifikasiPemasaran,
  pastikanPenanggungJawab,
  penerimaMenurutHak,
  tanggalDariIso,
  tanggalOpsional,
  tautanKonten,
  tautanTugasDesain,
  teksOpsional,
  teksWajib,
} from "@/lib/pemasaran";

/*
 * Pustaka konten media sosial (D6 §6.1). Bukan "use server". Berisi fungsi baca beranda (ringkasanKontenBeranda untuk
 * tab Pemasaran, kontenSaya untuk tab Tugas Saya, dari paket dashboard), penjaga dan efek status konten (D6 §3.1.2),
 * ajukan dan tinjau persetujuan, kirim ke desain (menulis TugasDesain lewat Prisma, L4), pembaca isian formulir, serta
 * fungsi baca halaman Perencana Konten (kalender, kanban, daftar, laci). Fungsi yang menulis selalu menerima tx dari
 * aksi, supaya data, riwayat, log, dan notifikasi tersimpan di satu transaksi.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

/** Konten aktif = belum diarsipkan (D6 §3.0 no. 6). */
export const SYARAT_KONTEN_AKTIF = { diarsipkanPada: null } satisfies Prisma.KontenWhereInput;

/** Jumlah hari ke depan untuk daftar "konten mendatang" beranda (S04 §6.1). */
export const HARI_KONTEN_MENDATANG = 14;

/** "2026-11-09" + n hari, dihitung dengan Date.UTC supaya bebas zona proses. */
export function geserTanggalIso(iso: string, hari: number): string {
  const [th, bl, tg] = iso.split("-").map(Number);
  return new Date(Date.UTC(th, bl - 1, tg + hari)).toISOString().slice(0, 10);
}

/** Awal hari (00.00 jam dinding ZONA_WAKTU) untuk tanggal ISO. */
export function awalHariLokal(iso: string): Date {
  const d = bacaWaktuLokal(`${iso}T00:00`);
  if (!d) throw new Error(`Tanggal tidak valid: ${iso}`);
  return d;
}

export type KontenMendatang = {
  id: string;
  judul: string;
  platform: PlatformKonten;
  status: StatusKonten;
  statusPersetujuan: StatusPersetujuanKonten;
  tanggalTerbit: Date;
  jamTerbit: string | null;
  perusahaanId: string;
};

export type RingkasanKontenBeranda = {
  /** Semua status urut kanban, termasuk yang nol. */
  perStatus: { status: StatusKonten; jumlah: number }[];
  menungguPersetujuan: number;
  /** Paling banyak 10 konten dengan hari ini ≤ tanggal terbit ≤ hari ini + 14 (ZONA_WAKTU), urut tanggal naik. */
  mendatang: KontenMendatang[];
};

/**
 * Ringkasan konten untuk panel beranda (D6 §6.6, S04 §6.1). perusahaanId null/undefined = gabungan.
 * Konten arsip tidak ikut. Daftar mendatang memuat status apa pun (termasuk TERBIT), seperti HKA.
 */
export async function ringkasanKontenBeranda(klien: Klien, perusahaanId?: string | null): Promise<RingkasanKontenBeranda> {
  const where = { ...SYARAT_KONTEN_AKTIF, ...saringPerusahaan(perusahaanId) };
  const hariIni = tanggalIso(new Date());
  const dari = awalHariLokal(hariIni);
  const sampai = awalHariLokal(geserTanggalIso(hariIni, HARI_KONTEN_MENDATANG + 1));
  const [kelompok, menungguPersetujuan, mendatang] = await Promise.all([
    klien.konten.groupBy({ by: ["status"], where, _count: { _all: true } }),
    klien.konten.count({ where: { ...where, statusPersetujuan: "MENUNGGU" } }),
    klien.konten.findMany({
      where: { ...where, tanggalTerbit: { gte: dari, lt: sampai } },
      orderBy: [{ tanggalTerbit: "asc" }, { jamTerbit: { sort: "asc", nulls: "last" } }, { judul: "asc" }],
      take: 10,
      select: { id: true, judul: true, platform: true, status: true, statusPersetujuan: true, tanggalTerbit: true, jamTerbit: true, perusahaanId: true },
    }),
  ]);
  const jumlah = new Map(kelompok.map((k) => [k.status, k._count._all]));
  return {
    perStatus: URUTAN_STATUS_KONTEN.map((status) => ({ status, jumlah: jumlah.get(status) ?? 0 })),
    menungguPersetujuan,
    mendatang: mendatang.map((k) => ({ ...k, tanggalTerbit: k.tanggalTerbit! })),
  };
}

/** Alasan konten masuk kartu "Konten saya" di tab Tugas Saya, urut dari yang paling mendesak. */
export type AlasanKontenSaya = "DITOLAK" | "LEWAT_TERBIT" | "REVISI_DESAIN" | "DESAIN_SIAP" | "AKAN_TERBIT" | "BELUM_DIJADWALKAN" | "BELUM_SELESAI";
export const URUTAN_ALASAN_KONTEN_SAYA: readonly AlasanKontenSaya[] = [
  "DITOLAK", "LEWAT_TERBIT", "REVISI_DESAIN", "DESAIN_SIAP", "AKAN_TERBIT", "BELUM_DIJADWALKAN", "BELUM_SELESAI",
];

/** Status konten yang masih harus dikerjakan penanggung jawabnya (belum masuk desain atau tinjauan). */
const STATUS_KONTEN_BELUM_SELESAI: readonly StatusKonten[] = ["IDE", "DRAF"];
/** Status tugas desain yang berarti desainnya sudah bisa dipakai untuk mengajukan konten (D6 §3.2.2). */
const STATUS_DESAIN_SIAP: readonly StatusTugasDesain[] = ["DISETUJUI", "SELESAI"];
/** Status konten yang sudah boleh terbit tetapi belum diterbitkan; penerbitan dicatat manual (D6 §3.1). */
const STATUS_KONTEN_SIAP_TERBIT: readonly StatusKonten[] = ["DISETUJUI", "TERJADWAL"];

export type KontenSaya = Omit<KontenMendatang, "tanggalTerbit"> & {
  tanggalTerbit: Date | null;
  /** Status tugas desain aktif konten ini (paling banyak satu, D6 §3.2.1), null bila tidak ada. */
  statusDesain: StatusTugasDesain | null;
  alasan: AlasanKontenSaya[];
};

/**
 * Alasan sebuah konten perlu perhatian penanggung jawabnya: ditolak penyetuju, sudah Disetujui/Terjadwal tetapi tanggal
 * terbitnya sebelum `dari` (awal hari ini) dan belum ditandai Terbit, desainnya sedang direvisi, desainnya sudah
 * disetujui sementara konten masih di tahap Desain (siap diajukan), akan terbit dalam rentang [dari, sampai) dan belum
 * terbit, sudah Disetujui tanpa tanggal terbit, atau masih Ide/Draf. Kosong = tidak perlu tindakan. Murni, diuji langsung.
 */
export function alasanKontenSaya(
  k: { status: StatusKonten; statusPersetujuan: StatusPersetujuanKonten; tanggalTerbit: Date | null; statusDesain: StatusTugasDesain | null },
  dari: Date,
  sampai: Date,
): AlasanKontenSaya[] {
  const alasan: AlasanKontenSaya[] = [];
  if (k.statusPersetujuan === "DITOLAK") alasan.push("DITOLAK");
  if (STATUS_KONTEN_SIAP_TERBIT.includes(k.status) && k.tanggalTerbit && k.tanggalTerbit < dari) alasan.push("LEWAT_TERBIT");
  if (k.statusDesain === "REVISI") alasan.push("REVISI_DESAIN");
  if (k.status === "DESAIN" && k.statusDesain !== null && STATUS_DESAIN_SIAP.includes(k.statusDesain)) alasan.push("DESAIN_SIAP");
  if (k.status !== "TERBIT" && k.tanggalTerbit && k.tanggalTerbit >= dari && k.tanggalTerbit < sampai) alasan.push("AKAN_TERBIT");
  if (k.status === "DISETUJUI" && !k.tanggalTerbit) alasan.push("BELUM_DIJADWALKAN");
  if (STATUS_KONTEN_BELUM_SELESAI.includes(k.status)) alasan.push("BELUM_SELESAI");
  return alasan;
}

/**
 * Konten yang alasannya hanya AKAN_TERBIT sementara persetujuannya masih MENUNGGU: yang harus bertindak penyetuju,
 * bukan penanggung jawab konten. Di kartu Konten saya diurutkan paling akhir (sesudah BELUM_SELESAI), supaya ide dan
 * draf tanpa tanggal milik pengguna sendiri tidak terdesak keluar dari batas baris. Murni, diuji langsung.
 */
export function menungguPenyetujuSaja(k: { statusPersetujuan: StatusPersetujuanKonten; alasan: readonly AlasanKontenSaya[] }): boolean {
  return k.statusPersetujuan === "MENUNGGU" && k.alasan.length > 0 && k.alasan.every((a) => a === "AKAN_TERBIT");
}

/**
 * Konten yang ditangani pengguna (sebagai Social Media Manager konten itu, atau pembuatnya bila SMM belum diisi) dan
 * perlu tindakan menurut alasanKontenSaya, termasuk yang tanggal terbitnya sudah lewat tetapi belum ditandai Terbit dan
 * yang akan terbit 14 hari ke depan. Hanya konten aktif dalam
 * lingkup perusahaan (null/undefined = gabungan). Urut alasan paling mendesak (yang hanya menunggu penyetuju paling akhir,
 * lihat menungguPenyetujuSaja), lalu tanggal terbit (kosong terakhir).
 * `total` = semua konten yang memenuhi syarat; `baris` paling banyak `batas`.
 */
export async function kontenSaya(klien: Klien, penggunaId: string, perusahaanId?: string | null, batas = 10): Promise<{ total: number; baris: KontenSaya[] }> {
  const hariIni = tanggalIso(new Date());
  const dari = awalHariLokal(hariIni);
  const sampai = awalHariLokal(geserTanggalIso(hariIni, HARI_KONTEN_MENDATANG + 1));
  const tugasAktif = SYARAT_TUGAS_AKTIF;
  const where: Prisma.KontenWhereInput = {
    ...SYARAT_KONTEN_AKTIF,
    ...saringPerusahaan(perusahaanId),
    AND: [
      { OR: [{ smmId: penggunaId }, { smmId: null, dibuatOlehId: penggunaId }] },
      {
        OR: [
          { statusPersetujuan: "DITOLAK" },
          { status: { in: [...STATUS_KONTEN_SIAP_TERBIT] }, tanggalTerbit: { lt: dari } },
          { status: "DISETUJUI", tanggalTerbit: null },
          { status: { in: [...STATUS_KONTEN_BELUM_SELESAI] } },
          { tugasDesain: { some: { ...tugasAktif, status: "REVISI" } } },
          { status: "DESAIN", tugasDesain: { some: { ...tugasAktif, status: { in: [...STATUS_DESAIN_SIAP] } } } },
          { status: { not: "TERBIT" }, tanggalTerbit: { gte: dari, lt: sampai } },
        ],
      },
    ],
  };
  const daftar = await klien.konten.findMany({
    where,
    select: {
      id: true, judul: true, platform: true, status: true, statusPersetujuan: true, tanggalTerbit: true, jamTerbit: true, perusahaanId: true,
      tugasDesain: { where: tugasAktif, select: { status: true }, orderBy: { dibuatPada: "desc" }, take: 1 },
    },
  });
  const baris: KontenSaya[] = daftar.map(({ tugasDesain, ...k }) => {
    const statusDesain = tugasDesain[0]?.status ?? null;
    return { ...k, statusDesain, alasan: alasanKontenSaya({ ...k, statusDesain }, dari, sampai) };
  });
  const peringkat = (k: KontenSaya) =>
    menungguPenyetujuSaja(k) ? URUTAN_ALASAN_KONTEN_SAYA.length : Math.min(...k.alasan.map((a) => URUTAN_ALASAN_KONTEN_SAYA.indexOf(a)), URUTAN_ALASAN_KONTEN_SAYA.length);
  baris.sort(
    (a, b) =>
      peringkat(a) - peringkat(b) ||
      (a.tanggalTerbit?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.tanggalTerbit?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
      a.judul.localeCompare(b.judul, "id"),
  );
  return { total: baris.length, baris: baris.slice(0, batas) };
}

// ---------- Penjaga dan efek status (D6 §3.1.2 sampai §3.1.5) ----------

/** Status tugas desain yang berarti desain sudah boleh dipakai untuk mengajukan konten. */
const STATUS_DESAIN_BOLEH_AJUKAN: readonly StatusTugasDesain[] = ["DISETUJUI", "SELESAI"];

export const PESAN_KONTEN_TIDAK_ADA = "Konten tidak ditemukan";
export const PESAN_KONTEN_BERUBAH = "Konten ini baru saja diubah orang lain. Muat ulang halaman lalu coba lagi";
export const PESAN_SUDAH_MENUNGGU = "Konten ini sudah menunggu persetujuan";
export const PESAN_TIDAK_MENUNGGU = "Konten ini tidak sedang menunggu persetujuan";
export const PESAN_DESAIN_BELUM_DISETUJUI = "Desain konten ini harus disetujui dulu sebelum konten diajukan";
export const PESAN_SUDAH_ADA_TUGAS = "Konten ini sudah punya tugas desain";
export const PESAN_DESAINER_KONTEN_TIDAK_BERHAK = "Desainer konten ini sudah tidak aktif atau tidak berhak mengerjakan tugas desain. Pilih desainer";

/** Jalur perubahan status: formulir buat/ubah, atau papan kanban dan tombol pindah. */
export type JalurStatusKonten = "formulir" | "papan";

/**
 * Penjaga status konten (D6 §3.1.2), diperiksa berurutan. `konten` null = konten baru (persetujuan dianggap TIDAK_ADA).
 * Hanya dipanggil bila status benar-benar berubah (D6 §3.0 no. 9). Di jalur papan, tujuan DITINJAU tidak ditolak di sini
 * karena pemanggil mengalihkannya ke ajukanKontenInternal.
 */
export function cekStatusKonten(
  pengguna: PenggunaSesi,
  ke: string,
  konten: { status: StatusKonten; statusPersetujuan: StatusPersetujuanKonten } | null,
  jalur: JalurStatusKonten,
): asserts ke is StatusKonten {
  if (!(URUTAN_STATUS_KONTEN as readonly string[]).includes(ke)) throw new Error("Status tidak dikenal");
  if (ke === "DITINJAU") {
    if (jalur === "formulir" && konten?.status !== "DITINJAU") throw new Error("Gunakan tombol Ajukan persetujuan untuk mengirim konten ke tinjauan");
    return;
  }
  const bolehSetujui = punyaHak(pengguna, "konten.setujui");
  if (ke === "DISETUJUI" && !bolehSetujui) throw new Error("Hanya penyetuju yang boleh menandai konten disetujui");
  if ((ke === "TERJADWAL" || ke === "TERBIT") && (konten?.statusPersetujuan ?? "TIDAK_ADA") !== "DISETUJUI" && !bolehSetujui) {
    throw new Error("Konten harus disetujui sebelum dijadwalkan atau diterbitkan");
  }
}

/** Kunci baris konten (FOR UPDATE) lalu baca ulang. null bila tidak ada atau sudah diarsipkan. */
export async function kunciKonten(tx: Klien, id: string): Promise<Konten | null> {
  await tx.$queryRaw`SELECT 1 FROM "Konten" WHERE "id" = ${id} FOR UPDATE`;
  return tx.konten.findFirst({ where: { id, ...SYARAT_KONTEN_AKTIF } });
}

/** Kunci konten aktif; melempar "Konten tidak ditemukan" bila tidak ada atau sudah diarsipkan. */
export async function kunciKontenAktif(tx: Klien, id: string): Promise<Konten> {
  const k = await kunciKonten(tx, id);
  if (!k) throw new Error(PESAN_KONTEN_TIDAK_ADA);
  return k;
}

const labelStatus = (s: StatusKonten) => STATUS_KONTEN[s].label;

async function tulisRiwayat(tx: Klien, kontenId: string, aksi: "DIAJUKAN" | "DISETUJUI" | "DITOLAK" | "DITARIK", masukan: string | null, pengguna: PenggunaSesi) {
  await tx.riwayatPersetujuanKonten.create({ data: { kontenId, aksi, masukan, penggunaId: idTersimpan(pengguna), penggunaNama: pengguna.nama } });
}

const logKonten = (tx: Klien, pengguna: PenggunaSesi, konten: Pick<Konten, "id" | "judul" | "perusahaanId">, aksi: string, keterangan: string, meta?: Prisma.InputJsonValue) =>
  catatLogPemasaran(tx, pengguna, { modul: "konten", aksi, jenis: JENIS_LOG_KONTEN, label: konten.judul, entitasId: konten.id, keterangan, meta, perusahaanId: konten.perusahaanId });

/** Ubah status bersyarat keadaan lama (D6 §3.0 no. 7); 0 baris = sudah diubah orang lain. */
async function ubahBersyarat(tx: Klien, konten: Pick<Konten, "id" | "status" | "statusPersetujuan">, data: { status: StatusKonten; statusPersetujuan?: StatusPersetujuanKonten }, pesan = PESAN_KONTEN_BERUBAH) {
  const { count } = await tx.konten.updateMany({ where: { id: konten.id, status: konten.status, statusPersetujuan: konten.statusPersetujuan, ...SYARAT_KONTEN_AKTIF }, data });
  if (count !== 1) throw new Error(pesan);
}

/** N3: konten disetujui, ke SMM dan pembuat konten. */
async function beritahuDisetujui(tx: Klien, pengguna: PenggunaSesi, konten: Pick<Konten, "id" | "judul" | "perusahaanId" | "smmId" | "dibuatOlehId">, masukan: string | null) {
  await kirimNotifikasiPemasaran(tx, {
    penerima: [konten.smmId, konten.dibuatOlehId],
    pelaku: pengguna,
    judul: "Konten disetujui",
    isi: masukan ? `${konten.judul}: ${masukan}` : konten.judul,
    tautan: tautanKonten(konten.id),
    jenis: "HASIL_PERSETUJUAN",
    perusahaanId: konten.perusahaanId,
  });
}

/**
 * Tinjauan konten yang sedang MENUNGGU (D6 §3.1.4 langkah 4): SETUJUI memasang status dan persetujuan DISETUJUI,
 * TOLAK memasang status DRAF dan persetujuan DITOLAK. Riwayat, log, dan notifikasi N3 atau N4 di tx yang sama.
 * Validasi keputusan dan masukan dilakukan aksi.
 */
export async function tinjauKontenInternal(tx: Klien, konten: Konten, pengguna: PenggunaSesi, keputusan: "SETUJUI" | "TOLAK", masukan: string | null): Promise<void> {
  const setuju = keputusan === "SETUJUI";
  const { count } = await tx.konten.updateMany({
    where: { id: konten.id, statusPersetujuan: "MENUNGGU", ...SYARAT_KONTEN_AKTIF },
    data: setuju ? { status: "DISETUJUI", statusPersetujuan: "DISETUJUI" } : { status: "DRAF", statusPersetujuan: "DITOLAK" },
  });
  if (count !== 1) throw new Error(PESAN_TIDAK_MENUNGGU);
  await tulisRiwayat(tx, konten.id, setuju ? "DISETUJUI" : "DITOLAK", masukan, pengguna);
  await logKonten(tx, pengguna, konten, setuju ? "SETUJUI" : "TOLAK", setuju ? `Disetujui${masukan ? `: ${masukan}` : ""}` : `Ditolak: ${masukan ?? ""}`, { masukan });
  if (setuju) await beritahuDisetujui(tx, pengguna, konten, masukan);
  else {
    await kirimNotifikasiPemasaran(tx, {
      penerima: [konten.smmId, konten.dibuatOlehId],
      pelaku: pengguna,
      judul: "Konten ditolak",
      isi: `${konten.judul}: ${masukan ?? ""}`,
      tautan: tautanKonten(konten.id),
      jenis: "HASIL_PERSETUJUAN",
      perusahaanId: konten.perusahaanId,
    });
  }
}

/**
 * Efek perubahan status konten (D6 §3.1.2, tabel efek). Prasyarat: `ke` berbeda dari status sekarang, bukan DITINJAU,
 * dan sudah lolos cekStatusKonten. Keluar dari tinjauan saat menunggu menarik pengajuan otomatis, kecuali penyetuju yang
 * memindah ke Disetujui (sama dengan tinjauan setuju). Penyetuju yang memasang Disetujui tanpa pengajuan mencatat
 * "setujui langsung". Konten yang persetujuannya Disetujui lalu dimundurkan ke Ide atau Draf kehilangan persetujuannya
 * (TIDAK_ADA) dengan riwayat DITARIK, jadi harus diajukan dan disetujui ulang.
 */
export async function terapkanStatusKonten(tx: Klien, konten: Konten, ke: StatusKonten, pengguna: PenggunaSesi): Promise<void> {
  if (ke === konten.status) return;
  if (ke === "DITINJAU") throw new Error("Gunakan tombol Ajukan persetujuan untuk mengirim konten ke tinjauan");
  const bolehSetujui = punyaHak(pengguna, "konten.setujui");
  if (konten.statusPersetujuan === "MENUNGGU") {
    if (ke === "DISETUJUI" && bolehSetujui) return tinjauKontenInternal(tx, konten, pengguna, "SETUJUI", null);
    await ubahBersyarat(tx, konten, { status: ke, statusPersetujuan: "TIDAK_ADA" });
    await tulisRiwayat(tx, konten.id, "DITARIK", null, pengguna);
    await logKonten(tx, pengguna, konten, "TARIK", `Pengajuan ditarik karena status dipindah ke ${labelStatus(ke)}`, { dari: konten.status, ke });
    return;
  }
  if (ke === "DISETUJUI" && bolehSetujui) {
    await ubahBersyarat(tx, konten, { status: "DISETUJUI", statusPersetujuan: "DISETUJUI" });
    await tulisRiwayat(tx, konten.id, "DISETUJUI", null, pengguna);
    await logKonten(tx, pengguna, konten, "SETUJUI", `Disetujui langsung dari ${labelStatus(konten.status)}`, { masukan: null, dari: konten.status });
    await beritahuDisetujui(tx, pengguna, konten, null);
    return;
  }
  if ((ke === "IDE" || ke === "DRAF" || ke === "DESAIN") && konten.statusPersetujuan === "DISETUJUI") {
    // Mundur ke Ide, Draf, atau Desain mencabut persetujuan: isi atau visualnya bisa berubah lagi di tahap itu, jadi konten
    // harus diajukan dan disetujui ulang sebelum bisa dijadwalkan (tinjauan sisa pekerjaan, temuan 1).
    // Riwayat DISETUJUI lama tetap ada sebagai jejak, tetapi entri DITARIK di atasnya menandai bahwa sudah tidak berlaku.
    await ubahBersyarat(tx, konten, { status: ke, statusPersetujuan: "TIDAK_ADA" });
    await tulisRiwayat(tx, konten.id, "DITARIK", `Persetujuan dicabut karena konten dimundurkan ke ${labelStatus(ke)}`, pengguna);
    await logKonten(tx, pengguna, konten, "CABUT_SETUJU", `Persetujuan dicabut karena status dipindah dari ${labelStatus(konten.status)} ke ${labelStatus(ke)}`, { dari: konten.status, ke });
    return;
  }
  await ubahBersyarat(tx, konten, { status: ke });
  await logKonten(tx, pengguna, konten, "STATUS", `Status ${labelStatus(konten.status)} ke ${labelStatus(ke)}`, { dari: konten.status, ke });
}

/**
 * Ajukan persetujuan (D6 §3.1.3 langkah 2 sampai 5), dipakai semua jalur (tombol, formulir "Simpan & ajukan", papan).
 * Penjaga desain diperiksa dari tugas aktif konten tanpa memandang hak pelaku (S04 §11.1 no. 5). Boleh dari status apa pun.
 */
export async function ajukanKontenInternal(tx: Klien, konten: Konten, pengguna: PenggunaSesi, catatan: string | null): Promise<void> {
  if (konten.statusPersetujuan === "MENUNGGU") throw new Error(PESAN_SUDAH_MENUNGGU);
  const tugas = await tx.tugasDesain.findUnique({ where: { kunciKontenAktif: konten.id }, select: { status: true } });
  if (tugas && !STATUS_DESAIN_BOLEH_AJUKAN.includes(tugas.status)) throw new Error(PESAN_DESAIN_BELUM_DISETUJUI);
  const { count } = await tx.konten.updateMany({
    where: { id: konten.id, statusPersetujuan: { not: "MENUNGGU" }, ...SYARAT_KONTEN_AKTIF },
    data: { status: "DITINJAU", statusPersetujuan: "MENUNGGU" },
  });
  if (count !== 1) throw new Error(PESAN_SUDAH_MENUNGGU);
  await tulisRiwayat(tx, konten.id, "DIAJUKAN", catatan, pengguna);
  await logKonten(tx, pengguna, konten, "AJUKAN", catatan ? `Diajukan untuk persetujuan: ${catatan}` : "Diajukan untuk persetujuan", { dari: konten.status });
  await kirimNotifikasiPemasaran(tx, {
    penerima: await penerimaMenurutHak(tx, "konten.setujui"),
    pelaku: pengguna,
    judul: "Persetujuan konten diminta",
    isi: konten.judul,
    tautan: tautanKonten(konten.id),
    jenis: "PERSETUJUAN",
    perusahaanId: konten.perusahaanId,
  });
}

/** N1 (D6 §3.4): SMM atau desainer konten yang baru diisi atau diganti (tidak kosong) diberi tahu. */
export async function beritahuPenugasanKonten(
  tx: Klien,
  pengguna: PenggunaSesi,
  konten: Pick<Konten, "id" | "judul" | "perusahaanId" | "smmId" | "desainerId">,
  lama: Pick<Konten, "smmId" | "desainerId"> | null,
): Promise<void> {
  const penerima = [konten.smmId !== lama?.smmId ? konten.smmId : null, konten.desainerId !== lama?.desainerId ? konten.desainerId : null];
  await kirimNotifikasiPemasaran(tx, { penerima, pelaku: pengguna, judul: "Tugas konten baru", isi: konten.judul, tautan: tautanKonten(konten.id), jenis: "PENUGASAN", perusahaanId: konten.perusahaanId });
}

export type IsianKirimDesain = {
  /** kosong = desainer konten */
  desainerId: string | null;
  /** kosong = tanggal terbit konten dikurangi HARI_TENGGAT_DESAIN hari */
  tenggat: Date | null;
  prioritas: PrioritasDesain;
  deskripsi: string | null;
};

const URUTAN_PRIORITAS_DESAIN: readonly PrioritasDesain[] = ["RENDAH", "SEDANG", "TINGGI", "MENDESAK"];

/**
 * Isian "Kirim ke desain" (D6 §3.1.5 langkah 3). `awalan` = "" untuk formulir kecil kirimKeDesain, "desain" untuk bagian
 * lipat formulir konten (isian desainDesainerId, desainTenggat, desainPrioritas, desainDeskripsi).
 */
export function bacaIsianKirimDesain(fd: FormData, awalan: "" | "desain" = ""): IsianKirimDesain {
  const n = (k: string) => (awalan ? `${awalan}${k[0].toUpperCase()}${k.slice(1)}` : k);
  return {
    desainerId: String(fd.get(n("desainerId")) ?? "").trim() || null,
    tenggat: tanggalOpsional(fd, n("tenggat"), "Tenggat"),
    prioritas: enumWajib(fd, n("prioritas"), URUTAN_PRIORITAS_DESAIN, "SEDANG", "Prioritas"),
    deskripsi: teksOpsional(fd, n("deskripsi"), "Instruksi tambahan", 5000),
  };
}

/** Tenggat bawaan tugas dari konten: tanggal terbit dikurangi 2 hari, dihitung dari tanggal ISO (bukan jam server). */
export function tenggatBawaanDesain(tanggalTerbit: Date | null): Date | null {
  return tanggalTerbit ? tanggalDariIso(geserHari(tanggalIso(tanggalTerbit), -HARI_TENGGAT_DESAIN)) : null;
}

/**
 * Kirim ke desain (D6 §3.1.5 langkah 2 sampai 7) di tx pemanggil, sesudah konten dikunci. Membuat TugasDesain lewat
 * Prisma (desain.ts tidak diimpor balik, L4), menaikkan konten Ide/Draf ke Desain, mengisi desainer konten bila kosong,
 * mencatat log tugas BUAT dan TUGASKAN, dan mengirim N5. Mengembalikan id tugas.
 */
export async function buatTugasDariKonten(tx: Klien, konten: Konten, pengguna: PenggunaSesi, isian: IsianKirimDesain): Promise<string> {
  if (await tx.tugasDesain.findUnique({ where: { kunciKontenAktif: konten.id }, select: { id: true } })) throw new Error(PESAN_SUDAH_ADA_TUGAS);
  // Isian kosong memakai desainer konten. Bila desainer itu sudah tidak aktif atau tidak berhak, pesannya menunjuk
  // isian yang harus diisi, bukan pesan umum penanggung jawab (perbaikan tinjauan P41 R7).
  const desainerId = isian.desainerId
    ? await pastikanPenanggungJawab(tx, isian.desainerId, "tugas-desain.ubah", "Desainer")
    : await pastikanPenanggungJawab(tx, konten.desainerId, "tugas-desain.ubah", "Desainer").catch(() => {
        throw new Error(PESAN_DESAINER_KONTEN_TIDAK_BERHAK);
      });
  const tugas = await tx.tugasDesain.create({
    data: {
      perusahaanId: konten.perusahaanId,
      judul: potongAman(`Desain: ${konten.judul}`, 200),
      deskripsi: isian.deskripsi,
      prioritas: isian.prioritas,
      tenggat: isian.tenggat ?? tenggatBawaanDesain(konten.tanggalTerbit),
      status: desainerId ? "DITUGASKAN" : "PERMINTAAN",
      desainerId,
      kontenId: konten.id,
      kunciKontenAktif: konten.id,
      proyekId: konten.proyekId,
      sumber: "KONTEN",
      jumlahRevisi: 0,
      dibuatOlehNama: pengguna.nama,
    },
    select: { id: true, judul: true, perusahaanId: true },
  });
  if (konten.status === "IDE" || konten.status === "DRAF") {
    await ubahBersyarat(tx, konten, { status: "DESAIN" });
    await logKonten(tx, pengguna, konten, "STATUS", `Status ${labelStatus(konten.status)} ke ${labelStatus("DESAIN")} karena dikirim ke desain`, { dari: konten.status, ke: "DESAIN" });
  }
  if (!konten.desainerId && desainerId) await tx.konten.update({ where: { id: konten.id }, data: { desainerId } });
  const logTugas = (aksi: string, keterangan: string, meta: Prisma.InputJsonValue) =>
    catatLogPemasaran(tx, pengguna, { modul: "tugas-desain", aksi, jenis: JENIS_LOG_TUGAS, label: tugas.judul, entitasId: tugas.id, keterangan, meta, perusahaanId: tugas.perusahaanId });
  await logTugas("BUAT", `Dibuat dari konten ${konten.judul}`, { dariKonten: konten.id });
  if (desainerId) {
    await logTugas("TUGASKAN", "Desainer ditugaskan", { desainerId });
    await kirimNotifikasiPemasaran(tx, { penerima: [desainerId], pelaku: pengguna, judul: "Tugas desain baru untuk Anda", isi: tugas.judul, tautan: tautanTugasDesain(tugas.id), jenis: "PENUGASAN", perusahaanId: tugas.perusahaanId });
  }
  return tugas.id;
}

/**
 * Catatan konten yang baru dibuat (D6 §6.2 buatKonten): log BUAT; bila dibuat langsung Disetujui oleh penyetuju, riwayat
 * DISETUJUI, log SETUJUI, dan N3; lalu N1 untuk SMM dan desainer.
 */
export async function catatKontenBaru(tx: Klien, konten: Konten, pengguna: PenggunaSesi): Promise<void> {
  await logKonten(tx, pengguna, konten, "BUAT", `Konten dibuat berstatus ${labelStatus(konten.status)}`);
  if (konten.statusPersetujuan === "DISETUJUI") {
    await tulisRiwayat(tx, konten.id, "DISETUJUI", null, pengguna);
    await logKonten(tx, pengguna, konten, "SETUJUI", "Disetujui saat dibuat", { masukan: null });
    await beritahuDisetujui(tx, pengguna, konten, null);
  }
  await beritahuPenugasanKonten(tx, pengguna, konten, null);
}

/** Catatan ubah isian konten: log UBAH dengan daftar bidang yang berubah. */
export async function catatUbahKonten(tx: Klien, konten: Konten, pengguna: PenggunaSesi, bidang: readonly string[]): Promise<void> {
  await logKonten(tx, pengguna, konten, "UBAH", `Diubah: ${bidang.join(", ")}`, { bidang: [...bidang] });
}

// ---------- Isian formulir konten (D6 §3.1.1) ----------

export type IsianKonten = {
  judul: string;
  platform: PlatformKonten;
  jenisKonten: string | null;
  pilar: string | null;
  caption: string | null;
  cta: string | null;
  tagar: string | null;
  tanggalTerbit: Date | null;
  jamTerbit: string | null;
  /** status mentah dari formulir (null bila tidak dikirim), divalidasi cekStatusKonten bila berubah */
  status: string | null;
  smmId: string | null;
  desainerId: string | null;
  briefDesain: string | null;
  catatan: string | null;
};

/**
 * Pembaca isian konten tanpa kueri. Ubah konten mengganti semua isian (seperti PUT HKA); kosong menjadi null. Status
 * yang tidak dikirim bernilai null: pemanggil memakai IDE saat buat dan status sekarang saat ubah.
 */
export function bacaIsianKonten(fd: FormData): IsianKonten {
  const tanggalTerbit = tanggalOpsional(fd, "tanggalTerbit", "Tanggal terbit");
  const jamTerbit = jamOpsional(fd, "jamTerbit");
  if (jamTerbit && !tanggalTerbit) throw new Error("Isi tanggal terbit dulu sebelum jam terbit");
  return {
    judul: teksWajib(fd, "judul", "Judul konten", 200),
    platform: enumWajib(fd, "platform", URUTAN_PLATFORM, "INSTAGRAM", "Platform"),
    jenisKonten: teksOpsional(fd, "jenisKonten", "Jenis konten", 60),
    pilar: teksOpsional(fd, "pilar", "Pilar konten", 60),
    caption: teksOpsional(fd, "caption", "Caption", 5000),
    cta: teksOpsional(fd, "cta", "CTA", 500),
    tagar: teksOpsional(fd, "tagar", "Tagar", 1000),
    tanggalTerbit,
    jamTerbit,
    status: String(fd.get("status") ?? "").trim() || null,
    smmId: String(fd.get("smmId") ?? "").trim() || null,
    desainerId: String(fd.get("desainerId") ?? "").trim() || null,
    briefDesain: teksOpsional(fd, "briefDesain", "Brief desain", 5000),
    catatan: teksOpsional(fd, "catatan", "Catatan", 5000),
  };
}

/**
 * Penanggung jawab konten (D6 §3.1.1): SMM harus memegang konten.ubah, desainer tugas-desain.ubah. Nilai yang sama
 * dengan konten lama tidak diperiksa ulang, supaya konten lama tetap bisa diubah walau hak orangnya sudah berubah.
 */
export async function pastikanPenanggungJawabKonten(tx: Klien, isian: Pick<IsianKonten, "smmId" | "desainerId">, lama: Pick<Konten, "smmId" | "desainerId"> | null): Promise<{ smmId: string | null; desainerId: string | null }> {
  const smmId = isian.smmId && isian.smmId === lama?.smmId ? isian.smmId : await pastikanPenanggungJawab(tx, isian.smmId, "konten.ubah", "Social Media Manager");
  const desainerId = isian.desainerId && isian.desainerId === lama?.desainerId ? isian.desainerId : await pastikanPenanggungJawab(tx, isian.desainerId, "tugas-desain.ubah", "Desainer");
  return { smmId, desainerId };
}

// ---------- Fungsi baca halaman Perencana Konten (D6 §6.6) ----------

export type SaringanKonten = {
  /** "YYYY-MM"; kosong = bulan berjalan (ZONA_WAKTU) */
  bulan?: string;
  platform?: PlatformKonten | "";
  status?: StatusKonten | "";
  persetujuan?: StatusPersetujuanKonten | "";
  /** "" atau undefined = semua, "tanpa" = konten tanpa proyek, selain itu id proyek */
  proyek?: string;
};

const POLA_BULAN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Bulan berjalan "YYYY-MM" menurut ZONA_WAKTU. */
export function bulanBerjalan(sekarang: Date = new Date()): string {
  return tanggalIso(sekarang).slice(0, 7);
}

/** "2026-12" + n bulan. */
export function geserBulan(bulan: string, n: number): string {
  const m = POLA_BULAN.exec(bulan);
  if (!m) throw new Error(`Bulan tidak valid: ${bulan}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + n, 1)).toISOString().slice(0, 7);
}

type ParamMentah = Record<string, string | string[] | undefined>;
const satu = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v ?? "").trim();

/** Saringan dari query string halaman; nilai tidak dikenal diabaikan (dianggap kosong). */
export function bacaSaringanKonten(p: ParamMentah): SaringanKonten {
  const pilih = <T extends string>(nilai: string, daftar: readonly T[]): T | "" => ((daftar as readonly string[]).includes(nilai) ? (nilai as T) : "");
  const bulan = satu(p.bulan);
  return {
    bulan: POLA_BULAN.test(bulan) ? bulan : bulanBerjalan(),
    platform: pilih(satu(p.platform), URUTAN_PLATFORM),
    status: pilih(satu(p.status), URUTAN_STATUS_KONTEN),
    persetujuan: pilih(satu(p.persetujuan), ["TIDAK_ADA", "MENUNGGU", "DISETUJUI", "DITOLAK"] as const),
    proyek: satu(p.proyek).slice(0, 100),
  };
}

/**
 * 42 tanggal "YYYY-MM-DD" kisi kalender bulan `bulan` ("YYYY-MM"): mulai Senin pada atau sebelum tanggal 1, dihitung
 * dengan Date.UTC supaya bebas zona proses.
 */
export function gridKalender(bulan: string): string[] {
  const m = POLA_BULAN.exec(bulan);
  if (!m) throw new Error(`Bulan tidak valid: ${bulan}`);
  const awal = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  const mundur = (awal.getUTCDay() + 6) % 7; // Senin = 0
  return Array.from({ length: 42 }, (_, i) => new Date(Date.UTC(awal.getUTCFullYear(), awal.getUTCMonth(), 1 - mundur + i)).toISOString().slice(0, 10));
}

function whereKonten(s: SaringanKonten, perusahaanId: string | null | undefined): Prisma.KontenWhereInput {
  const where: Prisma.KontenWhereInput = { ...SYARAT_KONTEN_AKTIF, ...saringPerusahaan(perusahaanId) };
  if (s.platform) where.platform = s.platform;
  if (s.status) where.status = s.status;
  if (s.persetujuan) where.statusPersetujuan = s.persetujuan;
  if (s.proyek === "tanpa") where.proyekId = null;
  else if (s.proyek) where.proyekId = s.proyek;
  return where;
}

const PILIH_KONTEN_RINGKAS = {
  id: true,
  judul: true,
  platform: true,
  jenisKonten: true,
  pilar: true,
  status: true,
  statusPersetujuan: true,
  tanggalTerbit: true,
  jamTerbit: true,
  perusahaanId: true,
  dibuatPada: true,
  perusahaan: { select: { id: true, kode: true, nama: true, warna: true } },
  proyek: { select: { id: true, kode: true, nama: true, warna: true } },
  smm: { select: { id: true, nama: true } },
  tugasDesain: { where: SYARAT_TUGAS_AKTIF, select: { id: true, status: true }, take: 1 },
} satisfies Prisma.KontenSelect;

type BarisKontenMentah = Prisma.KontenGetPayload<{ select: typeof PILIH_KONTEN_RINGKAS }>;

/** Baris konten ringkas untuk kalender, kanban, dan daftar. `tugasAktif` = tugas desain aktif (paling banyak satu). */
export type KontenRingkas = Omit<BarisKontenMentah, "tugasDesain"> & { tugasAktif: { id: string; status: StatusTugasDesain } | null };

const ringkas = ({ tugasDesain, ...k }: BarisKontenMentah): KontenRingkas => ({ ...k, tugasAktif: tugasDesain[0] ?? null });

const URUTAN_TANGGAL: Prisma.KontenOrderByWithRelationInput[] = [
  { tanggalTerbit: { sort: "asc", nulls: "last" } },
  { jamTerbit: { sort: "asc", nulls: "first" } },
  { dibuatPada: "desc" },
  { id: "asc" },
];

export type SelKalender = { tanggal: string; konten: KontenRingkas[] };

/**
 * Konten kalender (D6 §6.6): konten aktif yang tanggal terbitnya di dalam 42 hari kisi bulan, tersaring platform,
 * status, persetujuan, dan proyek, dikelompokkan per tanggal (ZONA_WAKTU). `tanpaTanggal` = jumlah konten tersaring
 * yang belum dijadwalkan (catatan bawah kalender).
 */
export async function kontenKalender(klien: Klien, saringan: SaringanKonten, perusahaanId?: string | null): Promise<{ sel: SelKalender[]; tanpaTanggal: number }> {
  const grid = gridKalender(saringan.bulan || bulanBerjalan());
  const where = whereKonten(saringan, perusahaanId);
  const [daftar, tanpaTanggal] = await Promise.all([
    klien.konten.findMany({ where: { ...where, tanggalTerbit: { gte: awalHariLokal(grid[0]), lt: awalHariLokal(geserTanggalIso(grid[41], 1)) } }, orderBy: URUTAN_TANGGAL, select: PILIH_KONTEN_RINGKAS }),
    klien.konten.count({ where: { ...where, tanggalTerbit: null } }),
  ]);
  const perTanggal = new Map<string, KontenRingkas[]>(grid.map((t) => [t, []]));
  for (const k of daftar) perTanggal.get(tanggalIso(k.tanggalTerbit!))?.push(ringkas(k));
  return { sel: grid.map((tanggal) => ({ tanggal, konten: perTanggal.get(tanggal)! })), tanpaTanggal };
}

/** Batas kartu per kolom papan (risiko D6 §10.3 no. 12); sisanya lewat tautan ke tampilan Daftar. */
export const BATAS_KARTU_KOLOM = 100;

export type KolomKonten = { status: StatusKonten; jumlah: number; konten: KontenRingkas[] };

/**
 * Konten papan kanban (D6 §6.6): konten bertanggal di bulan terpilih ditambah konten tanpa tanggal, dikelompokkan per
 * status urut kolom. Tiap kolom paling banyak BATAS_KARTU_KOLOM kartu; `jumlah` = semua konten kolom itu.
 */
export async function kontenKanban(klien: Klien, saringan: SaringanKonten, perusahaanId?: string | null): Promise<KolomKonten[]> {
  const bulan = saringan.bulan || bulanBerjalan();
  const where = whereKonten(saringan, perusahaanId);
  const daftar = await klien.konten.findMany({
    where: { AND: [where, { OR: [{ tanggalTerbit: null }, { tanggalTerbit: { gte: awalHariLokal(`${bulan}-01`), lt: awalHariLokal(`${geserBulan(bulan, 1)}-01`) } }] }] },
    orderBy: URUTAN_TANGGAL,
    select: PILIH_KONTEN_RINGKAS,
  });
  return URUTAN_STATUS_KONTEN.map((status) => {
    const isi = daftar.filter((k) => k.status === status);
    return { status, jumlah: isi.length, konten: isi.slice(0, BATAS_KARTU_KOLOM).map(ringkas) };
  });
}

/** Kolom papan konten: id = kunci status, judul = label dan jumlah (D6 §7.2 no. 4). */
export function kolomKanbanKonten(kolom: readonly KolomKonten[], hrefDaftar?: (status: StatusKonten) => string): KolomKanban[] {
  return kolom.map((k) => ({
    id: k.status,
    judul: `${STATUS_KONTEN[k.status].label} (${k.jumlah.toLocaleString("id-ID")})`,
    nada: nadaKanban(STATUS_KONTEN[k.status].warna),
    ...(k.jumlah > k.konten.length && hrefDaftar ? { lebihBanyak: { jumlah: k.jumlah - k.konten.length, href: hrefDaftar(k.status) } } : {}),
  }));
}

/** Tanggal dan jam terbit untuk tampilan, mis. "10 Des 2026 10:00"; null bila belum dijadwalkan. */
export function teksTerbit(k: { tanggalTerbit: Date | null; jamTerbit: string | null }): string | null {
  return k.tanggalTerbit ? `${formatTanggal(k.tanggalTerbit)}${k.jamTerbit ? ` ${k.jamTerbit}` : ""}` : null;
}

/**
 * Kartu kanban konten (D6 §7.2 no. 4): subjudul platform dan jenis, baris proyek dan tanggal terbit, lencana persetujuan
 * menunggu dan status desain (hanya bila pembaca boleh melihat tugas desain), titik warna platform. Murni.
 */
export function kartuKanbanKonten(k: KontenRingkas, opsi: { lihatDesain: boolean; href: (id: string) => string }): KartuKanban {
  const lencana: NonNullable<KartuKanban["lencana"]> = [];
  if (k.statusPersetujuan === "MENUNGGU") lencana.push({ teks: "Menunggu persetujuan", nada: "amber" });
  if (opsi.lihatDesain && k.tugasAktif) lencana.push({ teks: `Desain: ${STATUS_DESAIN[k.tugasAktif.status].label}`, nada: nadaKanban(STATUS_DESAIN[k.tugasAktif.status].warna) });
  const baris = [k.proyek ? `${k.proyek.kode} ${k.proyek.nama}` : null, teksTerbit(k) ?? "Belum dijadwalkan"].filter((x): x is string => !!x);
  return {
    id: k.id,
    kolomId: k.status,
    judul: k.judul,
    subjudul: [LABEL_PLATFORM[k.platform], k.jenisKonten].filter(Boolean).join(" · "),
    baris,
    href: opsi.href(k.id),
    ...(lencana.length ? { lencana } : {}),
    titik: TITIK_PLATFORM[k.platform],
  };
}

/**
 * Daftar konten (D6 §6.6) dipaginasi param (25 per halaman), cari judul, caption, dan tagar, urut tanggal terbit naik
 * (belum dijadwalkan terakhir) lalu dibuat terbaru.
 */
export async function kontenDaftar(klien: Klien, saringan: SaringanKonten, param: Pick<ParamDaftar, "q" | "lewati" | "ambil">, perusahaanId?: string | null): Promise<{ total: number; baris: KontenRingkas[] }> {
  const where = whereKonten(saringan, perusahaanId);
  const q = param.q.trim();
  const syarat: Prisma.KontenWhereInput = q ? { AND: [where, { OR: [{ judul: cocokTeks(q) }, { caption: cocokTeks(q) }, { tagar: cocokTeks(q) }] }] } : where;
  const [total, baris] = await Promise.all([
    klien.konten.count({ where: syarat }),
    klien.konten.findMany({ where: syarat, orderBy: URUTAN_TANGGAL, skip: param.lewati, take: param.ambil, select: PILIH_KONTEN_RINGKAS }),
  ]);
  return { total, baris: baris.map(ringkas) };
}

/** Jumlah riwayat dan revisi yang dimuat laci konten (D6 §3.1.7, §6.6). */
export const BATAS_RIWAYAT_KONTEN = 100;
export const BATAS_REVISI_DI_KONTEN = 20;

const PILIH_DETAIL_KONTEN = {
  perusahaan: { select: { id: true, kode: true, nama: true, warna: true } },
  proyek: { select: { id: true, kode: true, nama: true, warna: true } },
  smm: { select: { id: true, nama: true } },
  desainer: { select: { id: true, nama: true } },
  riwayat: { orderBy: [{ dibuatPada: "desc" }, { id: "desc" }], take: BATAS_RIWAYAT_KONTEN },
  tugasDesain: {
    where: SYARAT_TUGAS_AKTIF,
    take: 1,
    select: {
      id: true,
      judul: true,
      status: true,
      prioritas: true,
      tenggat: true,
      jumlahRevisi: true,
      catatanRevisi: true,
      desainer: { select: { id: true, nama: true } },
      revisi: { orderBy: [{ dibuatPada: "desc" }, { id: "desc" }], take: BATAS_REVISI_DI_KONTEN },
    },
  },
} satisfies Prisma.KontenInclude;

type DetailKontenMentah = Prisma.KontenGetPayload<{ include: typeof PILIH_DETAIL_KONTEN }>;
export type DetailKonten = Omit<DetailKontenMentah, "tugasDesain"> & {
  /** tugas desain aktif; null bila tidak ada ATAU pembaca tidak memegang tugas-desain.lihat (D6 §3.1.7) */
  tugasAktif: DetailKontenMentah["tugasDesain"][number] | null;
  /** benar bila konten punya tugas desain aktif, apa pun hak pembacanya (penjaga ajukan dan kirim ke desain) */
  adaTugasAktif: boolean;
  /**
   * benar bila konten tanpa tugas aktif atau desainnya sudah Disetujui/Selesai, apa pun hak pembacanya. Penjaga tombol
   * "Simpan & ajukan persetujuan", sama dengan ajukanKontenInternal (perbaikan tinjauan P43 R5). Tanpa data tugas.
   */
  desainSudahBeres: boolean;
};

/**
 * Laci konten (D6 §6.6): konten beserta perusahaan, proyek, SMM, desainer, riwayat persetujuan (terbaru dulu, 100), dan
 * tugas desain aktif (dengan desainer dan 20 revisi terbaru) yang hanya diisi bila `pengguna` memegang
 * tugas-desain.lihat (perbaikan tinjauan P41 R4). null bila tidak ada atau sudah diarsipkan.
 */
export async function detailKonten(klien: Klien, id: string, pengguna: PenggunaSesi): Promise<DetailKonten | null> {
  const k = await klien.konten.findFirst({ where: { id, ...SYARAT_KONTEN_AKTIF }, include: PILIH_DETAIL_KONTEN });
  if (!k) return null;
  const { tugasDesain, ...sisa } = k;
  const tugas = tugasDesain[0] ?? null;
  return {
    ...sisa,
    tugasAktif: tugas && punyaHak(pengguna, "tugas-desain.lihat") ? tugas : null,
    adaTugasAktif: !!tugas,
    desainSudahBeres: !tugas || STATUS_DESAIN_BOLEH_AJUKAN.includes(tugas.status),
  };
}
