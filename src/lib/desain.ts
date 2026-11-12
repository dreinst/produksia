import type { Prisma, PrismaClient, TugasDesain } from "@/prisma-klien/client";
import type { PrioritasDesain, StatusTugasDesain } from "@/prisma-klien/enums";
import { LABEL_PLATFORM, PRIORITAS_DESAIN, STATUS_DESAIN, URUTAN_PRIORITAS, URUTAN_STATUS_DESAIN, nadaKanban } from "@/lib/labelPemasaran";
import { saringPerusahaan } from "@/lib/perusahaan";
import { formatTanggal, tanggalIso } from "@/lib/waktu";
import { punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { daftarBerkasAktifEntitas } from "@/lib/berkas";
import { cocokTeks, type ParamDaftar } from "@/lib/daftar";
import type { KartuKanban, KolomKanban } from "@/komponen/ui/Kanban";
import {
  JENIS_LOG_KONTEN,
  JENIS_LOG_TUGAS,
  catatLogPemasaran,
  enumWajib,
  idTersimpan,
  kirimNotifikasiPemasaran,
  pastikanPenanggungJawab,
  penerimaMenurutHak,
  tanggalOpsional,
  tautanKonten,
  tautanTugasDesain,
  teksOpsional,
  teksWajib,
} from "@/lib/pemasaran";

/*
 * Pustaka tugas desain (D6 §6.1). Bukan "use server". Berisi fungsi baca beranda dari paket dashboard
 * (ringkasanDesainBeranda, tugasLewatTenggat), penjaga dan efek status tugas (D6 §3.2.2), ajukan tinjauan dengan syarat
 * minimal satu berkas hasil aktif, setujui dan minta revisi dengan nomor revisi serta salinan nama berkas, pewarisan
 * perusahaan dan proyek dari konten atau kampanye, pembaca isian, dan fungsi baca halaman Tugas Desain. Berkas ini
 * tidak mengimpor konten.ts (L4): konten dibaca dan dinaikkan statusnya lewat Prisma langsung.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

/** Tugas aktif = belum diarsipkan (D6 §3.0 no. 6). */
export const SYARAT_TUGAS_AKTIF = { diarsipkanPada: null } satisfies Prisma.TugasDesainWhereInput;

/** Status yang dianggap sudah beres untuk tanda "Lewat tenggat" dan syarat pengajuan konten. */
const STATUS_BERES: readonly StatusTugasDesain[] = ["DISETUJUI", "SELESAI"];

/** Lewat tenggat = tenggat sebelum hari ini (ZONA_WAKTU) dan status belum Disetujui/Selesai (D6 §3.2.5). */
export function tugasLewatTenggat(t: { tenggat: Date | null; status: StatusTugasDesain }, sekarang: Date = new Date()): boolean {
  return !!t.tenggat && tanggalIso(t.tenggat) < tanggalIso(sekarang) && !STATUS_BERES.includes(t.status);
}

export type TugasSaya = {
  id: string;
  judul: string;
  status: StatusTugasDesain;
  prioritas: PrioritasDesain;
  tenggat: Date | null;
  jumlahRevisi: number;
  perusahaanId: string;
};

export type RingkasanDesainBeranda = {
  /** Tugas yang ditugaskan ke pengguna dan belum Selesai (Disetujui ikut dihitung, seperti HKA). */
  ditugaskanKeSaya: number;
  /** Paling banyak 10 tugas itu, urut tenggat naik, tanpa tenggat paling akhir. */
  tugasSaya: TugasSaya[];
  /** Tugas pengguna yang berstatus Revisi. */
  revisiSaya: number;
  /** Semua tugas dalam lingkup yang berstatus Ditinjau. */
  menungguTinjauan: number;
  /** Semua status urut kanban, termasuk yang nol. */
  perStatus: { status: StatusTugasDesain; jumlah: number }[];
};

/**
 * Ringkasan tugas desain untuk beranda (D6 §6.6, S04 §6.2). perusahaanId null/undefined = gabungan.
 * Tugas arsip tidak ikut.
 */
export async function ringkasanDesainBeranda(klien: Klien, penggunaId: string, perusahaanId?: string | null): Promise<RingkasanDesainBeranda> {
  const where = { ...SYARAT_TUGAS_AKTIF, ...saringPerusahaan(perusahaanId) };
  const milikSaya = { ...where, desainerId: penggunaId, status: { not: "SELESAI" as const } };
  const [ditugaskanKeSaya, tugasSaya, revisiSaya, menungguTinjauan, kelompok] = await Promise.all([
    klien.tugasDesain.count({ where: milikSaya }),
    klien.tugasDesain.findMany({
      where: milikSaya,
      orderBy: [{ tenggat: { sort: "asc", nulls: "last" } }, { dibuatPada: "asc" }],
      take: 10,
      select: { id: true, judul: true, status: true, prioritas: true, tenggat: true, jumlahRevisi: true, perusahaanId: true },
    }),
    klien.tugasDesain.count({ where: { ...where, desainerId: penggunaId, status: "REVISI" } }),
    klien.tugasDesain.count({ where: { ...where, status: "DITINJAU" } }),
    klien.tugasDesain.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);
  const jumlah = new Map(kelompok.map((k) => [k.status, k._count._all]));
  return {
    ditugaskanKeSaya,
    tugasSaya,
    revisiSaya,
    menungguTinjauan,
    perStatus: URUTAN_STATUS_DESAIN.map((status) => ({ status, jumlah: jumlah.get(status) ?? 0 })),
  };
}

// ---------- Penjaga dan efek status (D6 §3.2.2 sampai §3.2.4) ----------

export const PESAN_TUGAS_TIDAK_ADA = "Tugas desain tidak ditemukan";
export const PESAN_TUGAS_BERUBAH = "Tugas desain ini baru saja diubah orang lain. Muat ulang halaman lalu coba lagi";
export const PESAN_KONTEN_SUDAH_ADA_TUGAS = "Konten ini sudah punya tugas desain";
export const PESAN_CATATAN_REVISI_WAJIB = "Catatan revisi wajib diisi";
export const PESAN_BERKAS_HASIL_WAJIB = "Unggah minimal satu berkas hasil sebelum mengajukan tinjauan";

/**
 * Galat unik indeks kunciKontenAktif (dua penautan serentak ke konten yang sama). Adapter pg Prisma 7 tidak mengisi
 * meta.target; nama indeks ada di meta.driverAdapterError, jadi seluruh meta yang dicocokkan (perbaikan tinjauan P41 R1).
 */
export function galatUnikKunciKonten(galat: unknown): boolean {
  const e = galat as { code?: string; meta?: unknown } | null;
  return e?.code === "P2002" && JSON.stringify(e.meta ?? {}).includes("kunciKontenAktif");
}

/** Jalur perubahan status: formulir buat/ubah, atau papan kanban dan tombol pindah. */
export type JalurStatusDesain = "formulir" | "papan";

/**
 * Penjaga status tugas desain (D6 §3.2.2), diperiksa berurutan. Hanya dipanggil bila status benar-benar berubah. Di jalur
 * papan, tujuan DITINJAU dialihkan pemanggil ke ajukan tinjauan, dan tujuan REVISI butuh catatan dari dialog kolom Revisi.
 * Formulir buat/ubah tidak pernah memasang Ditinjau atau Revisi; keduanya punya jalurnya sendiri.
 */
export function cekStatusDesain(pengguna: PenggunaSesi, ke: string, jalur: JalurStatusDesain, catatan?: string | null): asserts ke is StatusTugasDesain {
  if (!(URUTAN_STATUS_DESAIN as readonly string[]).includes(ke)) throw new Error("Status tidak dikenal");
  const peninjau = punyaHak(pengguna, "tugas-desain.setujui");
  if ((ke === "DISETUJUI" || ke === "SELESAI") && !peninjau) throw new Error("Hanya peninjau yang boleh menyetujui atau menyelesaikan tugas desain");
  if (ke === "REVISI") {
    if (!peninjau) throw new Error("Hanya peninjau yang boleh meminta revisi");
    if (jalur === "formulir") throw new Error("Gunakan formulir tinjauan untuk meminta revisi");
    if (!catatan?.trim()) throw new Error(PESAN_CATATAN_REVISI_WAJIB);
  }
  if (ke === "DITINJAU" && jalur === "formulir") throw new Error("Gunakan tombol Ajukan untuk ditinjau");
}

/** Kunci baris tugas (FOR UPDATE) lalu baca ulang; melempar bila tidak ada atau sudah diarsipkan. */
export async function kunciTugasAktif(tx: Klien, id: string): Promise<TugasDesain> {
  await tx.$queryRaw`SELECT 1 FROM "TugasDesain" WHERE "id" = ${id} FOR UPDATE`;
  const t = await tx.tugasDesain.findFirst({ where: { id, ...SYARAT_TUGAS_AKTIF } });
  if (!t) throw new Error(PESAN_TUGAS_TIDAK_ADA);
  return t;
}

const labelStatusDesain = (s: StatusTugasDesain) => STATUS_DESAIN[s].label;

const logTugas = (tx: Klien, pengguna: PenggunaSesi, tugas: Pick<TugasDesain, "id" | "judul" | "perusahaanId">, aksi: string, keterangan: string, meta?: Prisma.InputJsonValue) =>
  catatLogPemasaran(tx, pengguna, { modul: "tugas-desain", aksi, jenis: JENIS_LOG_TUGAS, label: tugas.judul, entitasId: tugas.id, keterangan, meta, perusahaanId: tugas.perusahaanId });

const beritahuDesainer = (tx: Klien, pengguna: PenggunaSesi, tugas: Pick<TugasDesain, "id" | "perusahaanId" | "desainerId">, judul: string, isi: string, jenis: "PENUGASAN" | "STATUS" | "HASIL_PERSETUJUAN" | "REVISI") =>
  kirimNotifikasiPemasaran(tx, { penerima: [tugas.desainerId], pelaku: pengguna, judul, isi, tautan: tautanTugasDesain(tugas.id), jenis, perusahaanId: tugas.perusahaanId });

/** Ubah bersyarat status lama (D6 §3.0 no. 7); 0 baris = sudah diubah orang lain. */
async function ubahTugasBersyarat(tx: Klien, tugas: Pick<TugasDesain, "id" | "status">, data: Prisma.TugasDesainUpdateManyMutationInput, pesan = PESAN_TUGAS_BERUBAH) {
  const { count } = await tx.tugasDesain.updateMany({ where: { id: tugas.id, status: tugas.status, ...SYARAT_TUGAS_AKTIF }, data });
  if (count !== 1) throw new Error(pesan);
}

/** Satu berkas di riwayat revisi: nama disalin supaya riwayat tetap terbaca walau berkasnya dibuang (D6 §3.2.4 no. 6). */
export type BerkasRevisi = { id: string; nama: string };

/** Membaca kolom JSON berkasSebelumnya/berkasBaru; nilai yang rusak diabaikan. */
export function bacaBerkasRevisi(json: Prisma.JsonValue): BerkasRevisi[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((b) => (b && typeof b === "object" && !Array.isArray(b) && typeof b.id === "string" && typeof b.nama === "string" ? [{ id: b.id, nama: b.nama }] : []));
}

/** Berkas hasil aktif tugas (lampiran hasil-desain bertag HASIL), tanpa melihat hak pembaca, urut unggah naik. */
export async function berkasHasilAktif(klien: Klien, tugasId: string): Promise<BerkasRevisi[]> {
  return (await daftarBerkasAktifEntitas(klien, "hasil-desain", tugasId, { tag: "HASIL" })).map((b) => ({ id: b.id, nama: b.namaBerkas }));
}

/** Baris revisi baru: berkas sebelumnya = berkas baru baris terakhir, berkas baru = hasil aktif sekarang. */
async function tulisRevisi(tx: Klien, tugas: TugasDesain, pengguna: PenggunaSesi, keputusan: "DISETUJUI" | "MINTA_REVISI", nomor: number, catatan: string | null) {
  const [hasil, terakhir] = await Promise.all([
    berkasHasilAktif(tx, tugas.id),
    tx.revisiDesain.findFirst({ where: { tugasId: tugas.id }, orderBy: [{ dibuatPada: "desc" }, { id: "desc" }], select: { berkasBaru: true } }),
  ]);
  await tx.revisiDesain.create({
    data: { tugasId: tugas.id, nomorRevisi: nomor, keputusan, catatan, berkasSebelumnya: bacaBerkasRevisi(terakhir?.berkasBaru ?? []), berkasBaru: hasil, peninjauId: idTersimpan(pengguna), peninjauNama: pengguna.nama },
  });
}

/**
 * Setujui desain (D6 §3.2.4), dari tinjauan atau "setujui langsung" (papan, formulir, buat). Nomor = jumlah revisi
 * (persetujuan pertama tanpa revisi tercatat #0). N8 ke desainer, N10 ke SMM dan pembuat konten aktif yang tertaut.
 */
export async function setujuiDesainInternal(tx: Klien, tugas: TugasDesain, pengguna: PenggunaSesi, catatan: string | null): Promise<void> {
  const nomor = tugas.jumlahRevisi;
  await ubahTugasBersyarat(tx, tugas, { status: "DISETUJUI", jumlahRevisi: nomor, catatanRevisi: catatan || null });
  await tulisRevisi(tx, tugas, pengguna, "DISETUJUI", nomor, catatan || null);
  await logTugas(tx, pengguna, tugas, "SETUJUI", catatan ? `Desain disetujui: ${catatan}` : "Desain disetujui", { nomor });
  await beritahuDesainer(tx, pengguna, tugas, "Desain disetujui", catatan ? `${tugas.judul}: ${catatan}` : tugas.judul, "HASIL_PERSETUJUAN");
  if (tugas.kontenId) {
    const konten = await tx.konten.findFirst({ where: { id: tugas.kontenId, diarsipkanPada: null }, select: { id: true, judul: true, smmId: true, dibuatOlehId: true, perusahaanId: true } });
    if (konten) {
      await kirimNotifikasiPemasaran(tx, {
        penerima: [konten.smmId, konten.dibuatOlehId],
        pelaku: pengguna,
        judul: "Desain untuk konten Anda sudah disetujui",
        isi: konten.judul,
        tautan: tautanKonten(konten.id),
        jenis: "STATUS",
        perusahaanId: konten.perusahaanId,
      });
    }
  }
}

/**
 * Minta revisi (D6 §3.2.4), dari tinjauan atau seret ke kolom Revisi. Nomor = jumlah revisi + 1, catatan wajib, N9 ke
 * desainer. Tugas yang masih Permintaan belum dikerjakan siapa pun, jadi tidak bisa direvisi.
 */
export async function mintaRevisiInternal(tx: Klien, tugas: TugasDesain, pengguna: PenggunaSesi, catatan: string | null): Promise<void> {
  const isi = catatan?.trim();
  if (!isi) throw new Error(PESAN_CATATAN_REVISI_WAJIB);
  if (tugas.status === "PERMINTAAN") throw new Error("Tugaskan desainer dulu sebelum meminta revisi");
  const nomor = tugas.jumlahRevisi + 1;
  await ubahTugasBersyarat(tx, tugas, { status: "REVISI", jumlahRevisi: nomor, catatanRevisi: isi });
  await tulisRevisi(tx, tugas, pengguna, "MINTA_REVISI", nomor, isi);
  await logTugas(tx, pengguna, tugas, "REVISI", `Revisi #${nomor} diminta: ${isi}`, { nomor });
  await beritahuDesainer(tx, pengguna, tugas, `Revisi desain #${nomor} diminta`, `${tugas.judul}: ${isi}`, "REVISI");
}

/**
 * Ajukan untuk ditinjau (D6 §3.2.3 langkah 2 sampai 4), dipakai semua jalur. Syarat berkas hasil diperiksa di server,
 * jadi seret kanban tidak bisa melewatinya. N6 ke pemegang tugas-desain.setujui.
 */
export async function ajukanTinjauanInternal(tx: Klien, tugas: TugasDesain, pengguna: PenggunaSesi): Promise<void> {
  if (tugas.status === "DITINJAU") throw new Error("Tugas ini sudah menunggu tinjauan");
  if (tugas.status === "DISETUJUI" || tugas.status === "SELESAI") throw new Error("Tugas ini sudah disetujui");
  if (tugas.status === "PERMINTAAN" || !tugas.desainerId) throw new Error("Tugaskan desainer dulu sebelum mengajukan tinjauan");
  if ((await berkasHasilAktif(tx, tugas.id)).length === 0) throw new Error(PESAN_BERKAS_HASIL_WAJIB);
  await ubahTugasBersyarat(tx, tugas, { status: "DITINJAU" });
  await logTugas(tx, pengguna, tugas, "AJUKAN", "Diajukan untuk ditinjau", { dari: tugas.status, ke: "DITINJAU" });
  await kirimNotifikasiPemasaran(tx, {
    penerima: await penerimaMenurutHak(tx, "tugas-desain.setujui"),
    pelaku: pengguna,
    judul: "Desain siap ditinjau",
    isi: tugas.judul,
    tautan: tautanTugasDesain(tugas.id),
    jenis: "PERSETUJUAN",
    perusahaanId: tugas.perusahaanId,
  });
}

/**
 * Efek perubahan status tugas (D6 §3.2.2, tabel aturan otomatis). Prasyarat: `ke` berbeda dari status sekarang dan lolos
 * cekStatusDesain. Ditinjau lewat ajukan, Disetujui lewat setujui langsung, Revisi lewat minta revisi; status lain
 * mencatat STATUS dan N7 ke desainer.
 */
export async function terapkanStatusDesain(tx: Klien, tugas: TugasDesain, ke: StatusTugasDesain, pengguna: PenggunaSesi, catatan: string | null = null): Promise<void> {
  if (ke === tugas.status) return;
  if (ke === "DITINJAU") return ajukanTinjauanInternal(tx, tugas, pengguna);
  if (ke === "DISETUJUI") return setujuiDesainInternal(tx, tugas, pengguna, null);
  if (ke === "REVISI") return mintaRevisiInternal(tx, tugas, pengguna, catatan);
  await ubahTugasBersyarat(tx, tugas, { status: ke });
  await logTugas(tx, pengguna, tugas, "STATUS", `Status ${labelStatusDesain(tugas.status)} ke ${labelStatusDesain(ke)}`, { dari: tugas.status, ke });
  await beritahuDesainer(tx, pengguna, tugas, `Tugas desain dipindah ke ${labelStatusDesain(ke)}`, tugas.judul, "STATUS");
}

// ---------- Isian, rujukan, dan pewarisan (D6 §3.2.1, §3.2.5) ----------

export type IsianTugas = {
  judul: string;
  deskripsi: string | null;
  prioritas: PrioritasDesain;
  tenggat: Date | null;
  desainerId: string | null;
  kontenId: string | null;
  kampanyeId: string | null;
  /** status mentah (null bila tidak dikirim) */
  status: string | null;
};

/** Pembaca isian tugas desain tanpa kueri. Ubah mengganti semua isian; kosong menjadi null. */
export function bacaIsianTugas(fd: FormData): IsianTugas {
  const id = (k: string) => String(fd.get(k) ?? "").trim() || null;
  return {
    judul: teksWajib(fd, "judul", "Judul tugas", 200),
    deskripsi: teksOpsional(fd, "deskripsi", "Deskripsi", 5000),
    prioritas: enumWajib(fd, "prioritas", URUTAN_PRIORITAS, "SEDANG", "Prioritas"),
    tenggat: tanggalOpsional(fd, "tenggat", "Tenggat"),
    desainerId: id("desainerId"),
    kontenId: id("kontenId"),
    kampanyeId: id("kampanyeId"),
    status: id("status"),
  };
}

export type RujukanTugas = {
  konten: { id: string; judul: string; status: string; perusahaanId: string; proyekId: string | null } | null;
  kampanye: { id: string; nama: string; perusahaanId: string; proyekId: string | null } | null;
};

/**
 * Konten dan kampanye terkait (D6 §3.2.1): harus aktif; pelaku harus memegang hak lihat modulnya; keduanya satu
 * perusahaan; konten belum punya tugas aktif lain (`tugasId` = tugas yang sedang diubah). Konten yang baru ditaut
 * dikunci FOR UPDATE supaya tidak berlomba dengan kirim ke desain. Nilai yang sama dengan tugas lama tidak diperiksa
 * ulang. `perusahaanId` diisi saat ubah: induk harus milik perusahaan tugas.
 */
export async function bacaRujukanTugas(
  tx: Klien,
  pengguna: PenggunaSesi,
  isian: Pick<IsianTugas, "kontenId" | "kampanyeId">,
  opsi: { lama?: Pick<TugasDesain, "id" | "kontenId" | "kampanyeId" | "perusahaanId"> } = {},
): Promise<RujukanTugas> {
  const { lama } = opsi;
  let konten: RujukanTugas["konten"] = null;
  let kampanye: RujukanTugas["kampanye"] = null;
  if (isian.kontenId) {
    const baru = isian.kontenId !== lama?.kontenId;
    if (baru && !punyaHak(pengguna, "konten.lihat")) throw new Error("Anda tidak punya hak melihat konten untuk menautkannya");
    if (baru) await tx.$queryRaw`SELECT 1 FROM "Konten" WHERE "id" = ${isian.kontenId} FOR UPDATE`;
    konten = await tx.konten.findFirst({ where: { id: isian.kontenId, ...(baru ? { diarsipkanPada: null } : {}) }, select: { id: true, judul: true, status: true, perusahaanId: true, proyekId: true } });
    if (!konten) throw new Error("Konten terkait tidak ditemukan");
    if (baru) {
      if (lama && konten.perusahaanId !== lama.perusahaanId) throw new Error("Konten terkait milik perusahaan lain");
      const aktif = await tx.tugasDesain.findUnique({ where: { kunciKontenAktif: konten.id }, select: { id: true } });
      if (aktif && aktif.id !== lama?.id) throw new Error(PESAN_KONTEN_SUDAH_ADA_TUGAS);
    }
  }
  if (isian.kampanyeId) {
    const baru = isian.kampanyeId !== lama?.kampanyeId;
    if (baru && !punyaHak(pengguna, "kampanye.lihat")) throw new Error("Anda tidak punya hak melihat kampanye untuk menautkannya");
    kampanye = await tx.kampanye.findFirst({ where: { id: isian.kampanyeId, ...(baru ? { diarsipkanPada: null } : {}) }, select: { id: true, nama: true, perusahaanId: true, proyekId: true } });
    if (!kampanye) throw new Error("Kampanye terkait tidak ditemukan");
    if (baru && lama && kampanye.perusahaanId !== lama.perusahaanId) throw new Error("Kampanye terkait milik perusahaan lain");
  }
  if (konten && kampanye && konten.perusahaanId !== kampanye.perusahaanId) throw new Error("Konten dan kampanye terkait harus milik perusahaan yang sama");
  return { konten, kampanye };
}

/** Desainer tugas: pengguna aktif yang memegang tugas-desain.ubah; nilai sama dengan tugas lama tidak diperiksa ulang. */
export async function pastikanDesainerTugas(tx: Klien, desainerId: string | null, lama?: Pick<TugasDesain, "desainerId">): Promise<string | null> {
  if (desainerId && desainerId === lama?.desainerId) return desainerId;
  return pastikanPenanggungJawab(tx, desainerId, "tugas-desain.ubah", "Desainer");
}

/**
 * Konten yang baru ditaut tugas naik dari Ide/Draf ke Desain (D6 §3.2.1, juga lewat ubah tugas), dengan log STATUS
 * konten. Konten berstatus lain tidak diubah.
 */
export async function naikkanKontenKeDesain(tx: Klien, pengguna: PenggunaSesi, konten: NonNullable<RujukanTugas["konten"]>): Promise<void> {
  if (konten.status !== "IDE" && konten.status !== "DRAF") return;
  const { count } = await tx.konten.updateMany({ where: { id: konten.id, status: konten.status as "IDE" | "DRAF", diarsipkanPada: null }, data: { status: "DESAIN" } });
  if (count !== 1) return;
  const dari = konten.status === "IDE" ? "Ide" : "Draf";
  await catatLogPemasaran(tx, pengguna, { modul: "konten", aksi: "STATUS", jenis: JENIS_LOG_KONTEN, label: konten.judul, entitasId: konten.id, keterangan: `Status ${dari} ke Desain karena ditautkan ke tugas desain`, meta: { dari: konten.status, ke: "DESAIN" }, perusahaanId: konten.perusahaanId });
}

/** Catatan penugasan desainer (D6 §3.2.2): log TUGASKAN dan N5 bila desainer diisi atau diganti ke orang lain. */
export async function catatPenugasanDesainer(tx: Klien, pengguna: PenggunaSesi, tugas: TugasDesain, desainerLama: string | null): Promise<void> {
  if (!tugas.desainerId || tugas.desainerId === desainerLama) return;
  await logTugas(tx, pengguna, tugas, "TUGASKAN", "Desainer ditugaskan", { desainerId: tugas.desainerId });
  await beritahuDesainer(tx, pengguna, tugas, "Tugas desain baru untuk Anda", tugas.judul, "PENUGASAN");
}

/** Log BUAT, UBAH, STATUS, dan ARSIP tugas (dipakai aksi). */
export async function catatLogTugas(tx: Klien, pengguna: PenggunaSesi, tugas: TugasDesain, aksi: "BUAT" | "UBAH" | "STATUS" | "ARSIP", keterangan: string, meta?: Prisma.InputJsonValue): Promise<void> {
  await logTugas(tx, pengguna, tugas, aksi, keterangan, meta);
}

// ---------- Fungsi baca halaman Tugas Desain (D6 §6.6) ----------

export type SaringanTugas = {
  /** "" atau undefined = semua, "tanpa" = tanpa proyek, selain itu id proyek */
  proyek?: string;
  prioritas?: PrioritasDesain | "";
  status?: StatusTugasDesain | "";
  /** hanya tugas yang desainernya pembaca */
  saya?: boolean;
};

type ParamMentah = Record<string, string | string[] | undefined>;
const satu = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v ?? "").trim();

/** Saringan dari query string halaman; nilai tidak dikenal diabaikan. */
export function bacaSaringanTugas(p: ParamMentah): SaringanTugas {
  const pilih = <T extends string>(nilai: string, daftar: readonly T[]): T | "" => ((daftar as readonly string[]).includes(nilai) ? (nilai as T) : "");
  return { proyek: satu(p.proyek).slice(0, 100), prioritas: pilih(satu(p.prioritas), URUTAN_PRIORITAS), status: pilih(satu(p.status), URUTAN_STATUS_DESAIN), saya: satu(p.saya) === "1" };
}

function whereTugas(s: SaringanTugas, penggunaId: string, perusahaanId: string | null | undefined): Prisma.TugasDesainWhereInput {
  const where: Prisma.TugasDesainWhereInput = { ...SYARAT_TUGAS_AKTIF, ...saringPerusahaan(perusahaanId) };
  if (s.proyek === "tanpa") where.proyekId = null;
  else if (s.proyek) where.proyekId = s.proyek;
  if (s.prioritas) where.prioritas = s.prioritas;
  if (s.status) where.status = s.status;
  if (s.saya) where.desainerId = penggunaId;
  return where;
}

const PILIH_TUGAS_RINGKAS = {
  id: true,
  judul: true,
  deskripsi: true,
  status: true,
  prioritas: true,
  tenggat: true,
  jumlahRevisi: true,
  perusahaanId: true,
  diubahPada: true,
  dibuatPada: true,
  perusahaan: { select: { id: true, kode: true, nama: true, warna: true } },
  proyek: { select: { id: true, kode: true, nama: true, warna: true } },
  desainer: { select: { id: true, nama: true } },
  konten: { select: { id: true, judul: true, platform: true, tanggalTerbit: true, jamTerbit: true, diarsipkanPada: true } },
  kampanye: { select: { id: true, nama: true, diarsipkanPada: true } },
} satisfies Prisma.TugasDesainSelect;

export type TugasRingkas = Prisma.TugasDesainGetPayload<{ select: typeof PILIH_TUGAS_RINGKAS }>;

const URUTAN_TUGAS: Prisma.TugasDesainOrderByWithRelationInput[] = [{ tenggat: { sort: "asc", nulls: "last" } }, { dibuatPada: "desc" }, { id: "asc" }];

/** Kolom Selesai papan hanya memuat tugas yang selesai 30 hari terakhir (menurut diubahPada). */
export const HARI_KOLOM_SELESAI = 30;
/** Batas kartu per kolom papan; sisanya lewat tampilan Daftar. */
export const BATAS_KARTU_KOLOM_TUGAS = 100;

export type KolomTugas = { status: StatusTugasDesain; jumlah: number; tugas: TugasRingkas[] };

/** Papan tugas desain (D6 §6.6): tugas aktif tersaring per status; kolom SELESAI hanya 30 hari terakhir. */
export async function tugasKanban(klien: Klien, saringan: SaringanTugas, penggunaId: string, perusahaanId?: string | null): Promise<KolomTugas[]> {
  const batasSelesai = new Date(Date.now() - HARI_KOLOM_SELESAI * 86_400_000);
  const where = whereTugas({ ...saringan, status: "" }, penggunaId, perusahaanId);
  const daftar = await klien.tugasDesain.findMany({
    where: { AND: [where, { OR: [{ status: { not: "SELESAI" } }, { diubahPada: { gte: batasSelesai } }] }] },
    orderBy: URUTAN_TUGAS,
    select: PILIH_TUGAS_RINGKAS,
  });
  return URUTAN_STATUS_DESAIN.map((status) => {
    const isi = daftar.filter((t) => t.status === status);
    return { status, jumlah: isi.length, tugas: isi.slice(0, BATAS_KARTU_KOLOM_TUGAS) };
  });
}

/** Kolom papan tugas: id = kunci status, judul = label dan jumlah. */
export function kolomKanbanTugas(kolom: readonly KolomTugas[], hrefDaftar?: (status: StatusTugasDesain) => string): KolomKanban[] {
  return kolom.map((k) => ({
    id: k.status,
    judul: `${STATUS_DESAIN[k.status].label} (${k.jumlah.toLocaleString("id-ID")})`,
    nada: nadaKanban(STATUS_DESAIN[k.status].warna),
    ...(k.jumlah > k.tugas.length && hrefDaftar ? { lebihBanyak: { jumlah: k.jumlah - k.tugas.length, href: hrefDaftar(k.status) } } : {}),
  }));
}

/**
 * Kartu kanban tugas (D6 §7.4 no. 3): subjudul perencana bila tertaut konten aktif, baris proyek, tenggat (dengan tanda
 * lewat tenggat), desainer dan nomor revisi, lencana prioritas. Murni.
 */
export function kartuKanbanTugas(t: TugasRingkas, opsi: { href: (id: string) => string; sekarang?: Date }): KartuKanban {
  const konten = t.konten && !t.konten.diarsipkanPada ? t.konten : null;
  const subjudul = konten ? ["Perencana", LABEL_PLATFORM[konten.platform], konten.tanggalTerbit ? `terbit ${formatTanggal(konten.tanggalTerbit)}` : null].filter(Boolean).join(" · ") : undefined;
  const tenggat = t.tenggat ? `${tugasLewatTenggat(t, opsi.sekarang) ? "Lewat tenggat" : "Tenggat"} ${formatTanggal(t.tenggat)}` : null;
  const orang = [t.desainer?.nama ?? "Belum ditugaskan", t.jumlahRevisi > 0 ? `Rev ${t.jumlahRevisi}` : null].filter(Boolean).join(" · ");
  return {
    id: t.id,
    kolomId: t.status,
    judul: t.judul,
    ...(subjudul ? { subjudul } : {}),
    baris: [t.proyek ? `${t.proyek.kode} ${t.proyek.nama}` : null, tenggat, orang].filter((x): x is string => !!x),
    href: opsi.href(t.id),
    lencana: [{ teks: PRIORITAS_DESAIN[t.prioritas].label, nada: nadaKanban(PRIORITAS_DESAIN[t.prioritas].warna) }],
  };
}

/** Daftar tugas (D6 §6.6) dipaginasi, cari judul dan deskripsi, urut tenggat naik (tanpa tenggat terakhir). */
export async function tugasDaftar(klien: Klien, saringan: SaringanTugas, param: Pick<ParamDaftar, "q" | "lewati" | "ambil">, penggunaId: string, perusahaanId?: string | null): Promise<{ total: number; baris: TugasRingkas[] }> {
  const where = whereTugas(saringan, penggunaId, perusahaanId);
  const q = param.q.trim();
  const syarat: Prisma.TugasDesainWhereInput = q ? { AND: [where, { OR: [{ judul: cocokTeks(q) }, { deskripsi: cocokTeks(q) }] }] } : where;
  const [total, baris] = await Promise.all([
    klien.tugasDesain.count({ where: syarat }),
    klien.tugasDesain.findMany({ where: syarat, orderBy: URUTAN_TUGAS, skip: param.lewati, take: param.ambil, select: PILIH_TUGAS_RINGKAS }),
  ]);
  return { total, baris };
}

export const BATAS_REVISI_TUGAS = 100;

const PILIH_DETAIL_TUGAS = {
  perusahaan: { select: { id: true, kode: true, nama: true, warna: true } },
  proyek: { select: { id: true, kode: true, nama: true, warna: true } },
  desainer: { select: { id: true, nama: true } },
  kampanye: { select: { id: true, nama: true, perusahaanId: true, diarsipkanPada: true } },
  konten: {
    select: {
      id: true,
      judul: true,
      platform: true,
      jenisKonten: true,
      pilar: true,
      tanggalTerbit: true,
      jamTerbit: true,
      briefDesain: true,
      caption: true,
      cta: true,
      tagar: true,
      catatan: true,
      status: true,
      perusahaanId: true,
      diarsipkanPada: true,
      smm: { select: { id: true, nama: true } },
    },
  },
  revisi: { orderBy: [{ dibuatPada: "desc" }, { id: "desc" }], take: BATAS_REVISI_TUGAS },
} satisfies Prisma.TugasDesainInclude;

type DetailTugasMentah = Prisma.TugasDesainGetPayload<{ include: typeof PILIH_DETAIL_TUGAS }>;
export type DetailTugasDesain = Omit<DetailTugasMentah, "konten" | "kampanye"> & {
  /**
   * konten aktif yang tertaut (brief dibaca langsung, tanpa salinan); null bila tanpa konten, sudah diarsipkan, atau
   * pembaca tidak memegang konten.lihat
   */
  konten: NonNullable<DetailTugasMentah["konten"]> | null;
  /** benar bila tugas tertaut konten yang sudah diarsipkan ("Konten terkait sudah diarsipkan."); false tanpa konten.lihat */
  kontenDiarsipkan: boolean;
  /** kampanye tertaut; null bila tanpa kampanye atau pembaca tidak memegang kampanye.lihat */
  kampanye: DetailTugasMentah["kampanye"];
};

/**
 * Laci tugas desain (D6 §6.6): tugas beserta desainer, proyek, kampanye, konten aktif (seluruh isian brief dan SMM), dan
 * riwayat revisi (terbaru dulu, 100). Brief konten hanya bagi pemegang konten.lihat dan kampanye hanya bagi pemegang
 * kampanye.lihat (D6 §3.6, perbaikan tinjauan P41 R4); kontenId dan kampanyeId tugas tetap ada untuk formulir ubah.
 * null bila tidak ada atau sudah diarsipkan.
 */
export async function detailTugasDesain(klien: Klien, id: string, pengguna: PenggunaSesi): Promise<DetailTugasDesain | null> {
  const t = await klien.tugasDesain.findFirst({ where: { id, ...SYARAT_TUGAS_AKTIF }, include: PILIH_DETAIL_TUGAS });
  if (!t) return null;
  const lihatKonten = punyaHak(pengguna, "konten.lihat");
  const kontenDiarsipkan = lihatKonten && !!t.konten?.diarsipkanPada;
  return {
    ...t,
    konten: lihatKonten && t.konten && !t.konten.diarsipkanPada ? t.konten : null,
    kontenDiarsipkan,
    kampanye: punyaHak(pengguna, "kampanye.lihat") ? t.kampanye : null,
  };
}
