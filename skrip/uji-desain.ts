import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { HAK_BAWAAN, punyaHak, type PenggunaSesi } from "../src/lib/hakAkses";
import { periksaSinkron } from "../src/lib/sinkron";
import { tanggalIso } from "../src/lib/waktu";
import { simpanBerkas } from "../src/lib/berkas";
import { PESAN_DESAINER_KONTEN_TIDAK_BERHAK, detailKonten } from "../src/lib/konten";
import { hakTautanPemasaran, kirimNotifikasiPemasaran, pastikanPenanggungJawab } from "../src/lib/pemasaran";
import {
  bacaBerkasRevisi,
  berkasHasilAktif,
  detailTugasDesain,
  galatUnikKunciKonten,
  kartuKanbanTugas,
  ringkasanDesainBeranda,
  tugasDaftar,
  tugasKanban,
} from "../src/lib/desain";
import { ajukanTinjauanDesain, arsipkanTugasDesain, buatTugasDesain, pindahStatusDesain, pindahStatusDesainDariPapan, tinjauDesain, ubahTugasDesain } from "../src/lib/aksi/desain";
import { ajukanKonten, buatKonten, kirimKeDesain, ubahKonten } from "../src/lib/aksi/konten";
import { buangBerkas, pulihkanBerkas } from "../src/lib/aksi/berkas";
import type { PeranPengguna } from "../src/prisma-klien/enums";
import { formulir, harusDitolak, jalankan, pastikan, sebagai } from "./bantuan";

/*
 * Uji pustaka dan aksi Tugas Desain (P40, D6 §9.3 D1 sampai D14, pola D6 §9.1), ditambah pewarisan perusahaan tugas
 * manual dari konten (K17 bagian tugas), brief dibaca langsung lewat detailTugasDesain (K9), dan dua penautan serentak
 * ke konten yang sama. Data uji berawalan "UJI-D6", pengguna sementara uji-d6-*, akun seed owner, owner2, admin, kasir,
 * superadmin. Berkas uji PNG 8 byte lewat simpanBerkas, dibuang lewat aksi berkas. Tanpa baris HakAksesPeran.
 */

const AWALAN = "UJI-D6";
const PENGGUNA_UJI: [string, PeranPengguna][] = [
  ["uji-d6-sosmed", "SOSMED"],
  ["uji-d6-iklan", "IKLAN"],
  ["uji-d6-desainer", "DESAINER"],
  ["uji-d6-desainer2", "DESAINER"],
];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function bersihkan(mulai: Date | null) {
  const konten = await db.konten.findMany({ where: { judul: { startsWith: AWALAN } }, select: { id: true } });
  const kampanye = await db.kampanye.findMany({ where: { nama: { startsWith: AWALAN } }, select: { id: true } });
  const kontenIds = konten.map((k) => k.id);
  const kampanyeIds = kampanye.map((k) => k.id);
  const tugas = await db.tugasDesain.findMany({ where: { OR: [{ kontenId: { in: kontenIds } }, { kampanyeId: { in: kampanyeIds } }, { judul: { contains: AWALAN } }] }, select: { id: true } });
  const tugasIds = tugas.map((t) => t.id);
  const proyek = await db.proyek.findMany({ where: { kode: { startsWith: "UJI-D6-PRJ" } }, select: { id: true } });
  const proyekIds = proyek.map((p) => p.id);
  const semuaId = [...kontenIds, ...kampanyeIds, ...tugasIds];
  await db.notifikasi.deleteMany({ where: { OR: [{ tautan: { in: semuaId.flatMap((id) => [`/pemasaran/konten?konten=${id}`, `/pemasaran/desain?tugas=${id}`, `/pemasaran/iklan/${id}`]) } }, ...(mulai ? [{ dibuatPada: { gte: mulai }, tautan: { startsWith: "/pemasaran/" } }] : [])] } });
  const modulD6 = { in: ["konten", "tugas-desain", "kampanye", "berkas"] };
  const berkas = await db.berkas.findMany({ where: { OR: [{ entitasId: { in: semuaId } }, { proyekId: { in: proyekIds } }] }, select: { id: true } });
  const berkasIds = berkas.map((b) => b.id);
  await db.logAktivitas.deleteMany({ where: { OR: [{ entitasId: { in: [...semuaId, ...berkasIds] }, modul: modulD6 }, ...(mulai ? [{ waktu: { gte: mulai }, modul: modulD6 }] : [])] } });
  await db.berkas.deleteMany({ where: { id: { in: berkasIds } } });
  if (kampanyeIds.length) {
    await db.metrikIklan.deleteMany({ where: { kampanyeId: { in: kampanyeIds } } });
    await db.iklan.deleteMany({ where: { setIklan: { kampanyeId: { in: kampanyeIds } } } });
    await db.setIklan.deleteMany({ where: { kampanyeId: { in: kampanyeIds } } });
  }
  await db.tugasDesain.deleteMany({ where: { id: { in: tugasIds } } });
  await db.konten.deleteMany({ where: { id: { in: kontenIds } } });
  await db.kampanye.deleteMany({ where: { id: { in: kampanyeIds } } });
  await db.proyek.deleteMany({ where: { id: { in: proyekIds } } });
  await db.pengguna.deleteMany({ where: { namaPengguna: { startsWith: "uji-d6-" } } });
}

/** Hasil Promise.allSettled dari aksi: sukses bila lolos atau berakhir revalidate/redirect (di luar HTTP). */
function aksiSukses(h: PromiseSettledResult<unknown>): boolean {
  if (h.status === "fulfilled") return true;
  const e = h.reason as { digest?: string; message?: string };
  return (e?.digest ?? "").startsWith("NEXT_REDIRECT") || (e?.message ?? "").includes("static generation store missing") || (e?.message ?? "").includes("outside a request scope");
}

async function main() {
  await bersihkan(null);
  const mulaiUji = new Date();
  const jumlahJurnalAwal = await db.jurnal.count();
  const hakAwal = await db.hakAksesPeran.count();
  const sinkronAwal = await periksaSinkron(db);
  pastikan(sinkronAwal.seimbang, "periksaSinkron seimbang sebelum uji");

  for (const [namaPengguna, peran] of PENGGUNA_UJI) {
    await db.pengguna.create({ data: { namaPengguna, nama: `Uji D6 ${namaPengguna.slice(7)}`, kataSandiHash: "uji", peran, nomorTelepon: "+620000000000" } });
  }
  const ambil = (namaPengguna: string) => db.pengguna.findUniqueOrThrow({ where: { namaPengguna }, select: { id: true, nama: true, namaPengguna: true, peran: true } });
  const [sosmed, , desainer, desainer2, owner, owner2, kasir, superadmin] = await Promise.all(
    ["uji-d6-sosmed", "uji-d6-iklan", "uji-d6-desainer", "uji-d6-desainer2", "owner", "owner2", "kasir", "superadmin"].map(ambil),
  );
  const sesi = (p: { id: string; nama: string; namaPengguna: string; peran: PeranPengguna }): PenggunaSesi => ({ ...p, email: null, nomorTelepon: null, hak: HAK_BAWAAN[p.peran] });
  const proyekA = await db.proyek.create({ data: { kode: "UJI-D6-PRJ-A", nama: "Event Uji D6 A" } });
  const proyekB = await db.proyek.create({ data: { kode: "UJI-D6-PRJ-B", nama: "Event Uji D6 B" } });
  const proyekS = await db.proyek.create({ data: { kode: "UJI-D6-PRJ-S", nama: "Event Uji D6 SMARA", perusahaanId: "smara" } });
  // kampanye uji dibuat langsung (aksi kampanye milik P41)
  const kampanyeU = await db.kampanye.create({ data: { nama: `${AWALAN} Kampanye utama`, proyekId: proyekA.id, dibuatOlehNama: "Skrip Uji" } });
  const kampanyeS = await db.kampanye.create({ data: { nama: `${AWALAN} Kampanye SMARA`, perusahaanId: "smara", dibuatOlehNama: "Skrip Uji" } });

  const SOS = "uji-d6-sosmed";
  const IKL = "uji-d6-iklan";
  const DSN = "uji-d6-desainer";
  const jumlahNotif = (penggunaId: string, judul: string) => db.notifikasi.count({ where: { penggunaId, judul, dibuatPada: { gte: mulaiUji } } });
  const jumlahLog = (modul: string, aksi: string, entitasId?: string) => db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, modul, aksi, ...(entitasId ? { entitasId } : {}) } });
  const tugasBernama = (judul: string) => db.tugasDesain.findFirstOrThrow({ where: { judul } });
  const kontenBaru = async (judul: string, o: Record<string, string> = {}) => {
    await sebagai(SOS, () => jalankan(`buat konten ${judul}`, () => buatKonten(formulir({ perusahaanId: "utama", judul, status: "DRAF", smmId: owner.id, ...o }))));
    return db.konten.findFirstOrThrow({ where: { judul } });
  };
  const formTugas = (o: Record<string, string | null | undefined>) => formulir({ perusahaanId: "utama", prioritas: "SEDANG", ...o });
  /** Formulir ubah tugas: isi tugas sekarang ditambah perubahan. */
  const formUbahTugas = async (id: string, o: Record<string, string | null> = {}) => {
    const t = await db.tugasDesain.findUniqueOrThrow({ where: { id } });
    return formulir({ judul: t.judul, deskripsi: t.deskripsi, prioritas: t.prioritas, tenggat: t.tenggat ? tanggalIso(t.tenggat) : null, desainerId: t.desainerId, kontenId: t.kontenId, kampanyeId: t.kampanyeId, proyekId: t.proyekId, status: t.status, ...o });
  };
  const unggah = async (p: PenggunaSesi, nama: string, jenisEntitas: string, entitasId: string, tag: string) => {
    const h = await simpanBerkas(db, p, { berkas: new File([PNG], nama), jenisEntitas, entitasId, tag });
    if (!h.ok) throw new Error(`unggah ${nama} gagal: ${h.status} ${h.galat}`);
    return h.nilai;
  };

  try {
    console.log("=== D1. Hak bawaan ===");
    const AKSI = ["lihat", "buat", "ubah", "setujui", "hapus"] as const;
    const hak = (p: PeranPengguna) => JSON.stringify(AKSI.filter((a) => punyaHak(p, `tugas-desain.${a}`)));
    pastikan(hak("DESAINER") === '["lihat","ubah"]', "DESAINER: tugas-desain lihat/ubah");
    pastikan(hak("SOSMED") === '["lihat","buat","ubah","setujui"]', "SOSMED: lihat/buat/ubah/setujui, tanpa hapus");
    pastikan(hak("IKLAN") === '["lihat","buat"]', "IKLAN: lihat/buat");
    pastikan(hak("ADMIN") === '["lihat","buat","ubah"]', "ADMIN: lihat/buat/ubah");
    pastikan(hak("PEMILIK") === JSON.stringify(AKSI) && hak("SUPERADMIN") === JSON.stringify(AKSI), "PEMILIK dan SUPERADMIN: semua");
    pastikan((["KASIR", "GUDANG", "KRU", "GUEST"] as const).every((p) => hak(p) === "[]"), "KASIR, GUDANG, KRU, GUEST tanpa tugas-desain.*");

    console.log("=== D2. Penolakan buat ===");
    const kontenD2 = await kontenBaru(`${AWALAN} Konten D2`);
    await sebagai(DSN, () => harusDitolak("DESAINER buat tugas", () => buatTugasDesain(formTugas({ judul: `${AWALAN} T` })), "tidak punya hak"));
    const tolak = (label: string, o: Record<string, string>, pesan: string) => sebagai(IKL, () => harusDitolak(label, () => buatTugasDesain(formTugas({ judul: `${AWALAN} T tolak`, ...o })), pesan));
    await tolak("judul kosong", { judul: " " }, "Judul tugas wajib diisi");
    await tolak("judul 201 karakter", { judul: "x".repeat(201) }, "Judul tugas maksimal 200 karakter");
    await tolak("prioritas SANGAT", { prioritas: "SANGAT" }, "Prioritas tidak dikenal");
    await tolak("tenggat 2026-13-01", { tenggat: "2026-13-01" }, "Tenggat tidak valid");
    await tolak("desainer kasir", { desainerId: kasir.id }, "Desainer harus pengguna aktif");
    await tolak("konten palsu", { kontenId: "tidak-ada" }, "Konten terkait tidak ditemukan");
    await tolak("kampanye palsu", { kampanyeId: "tidak-ada" }, "Kampanye terkait tidak ditemukan");
    await tolak("IKLAN status DISETUJUI", { status: "DISETUJUI" }, "Hanya peninjau");
    await tolak("IKLAN status SELESAI", { status: "SELESAI" }, "Hanya peninjau");
    await tolak("status DITINJAU", { status: "DITINJAU" }, "Gunakan tombol Ajukan untuk ditinjau");
    await tolak("status REVISI", { status: "REVISI" }, "Hanya peninjau yang boleh meminta revisi");
    await sebagai(SOS, () => harusDitolak("peninjau buat berstatus REVISI", () => buatTugasDesain(formTugas({ judul: `${AWALAN} T tolak`, status: "REVISI" })), "Gunakan formulir tinjauan"));
    await tolak("status tidak dikenal", { status: "VIRAL" }, "Status tidak dikenal");
    await tolak("konten utama + kampanye SMARA", { kontenId: kontenD2.id, kampanyeId: kampanyeS.id }, "harus milik perusahaan yang sama");
    await tolak("proyek SMARA untuk tugas utama", { proyekId: proyekS.id }, "milik");
    pastikan((await db.tugasDesain.count({ where: { judul: { startsWith: AWALAN } } })) === 0, "tidak ada tugas uji dari isian yang ditolak");

    console.log("=== D3. Buat manual dengan desainer ===");
    const JUDUL_T1 = `${AWALAN} T1 Banner booth`;
    await sebagai(IKL, () => jalankan("IKLAN buat tugas dengan desainer", () => buatTugasDesain(formTugas({ judul: JUDUL_T1, desainerId: desainer.id, deskripsi: "Banner 3x1 meter deskripsi-unik-d13", tenggat: "2026-12-01", kembali: "tampilan=daftar&saya=1" }))));
    const t1 = await tugasBernama(JUDUL_T1);
    pastikan(t1.status === "DITUGASKAN" && t1.sumber === "MANUAL" && t1.perusahaanId === "utama" && t1.desainerId === desainer.id && t1.kunciKontenAktif === null && tanggalIso(t1.tenggat!) === "2026-12-01", "T1: DITUGASKAN, MANUAL, utama, desainer, tenggat");
    pastikan((await jumlahLog("tugas-desain", "BUAT", t1.id)) === 1 && (await jumlahLog("tugas-desain", "TUGASKAN", t1.id)) === 1, "log BUAT dan TUGASKAN");
    pastikan((await jumlahNotif(desainer.id, "Tugas desain baru untuk Anda")) === 1, "N5 ke desainer 1");

    console.log("=== D4. Taut konten ===");
    const kontenD4 = await kontenBaru(`${AWALAN} Konten D4 Carousel`, { briefDesain: "Brief D4 awal", caption: "Caption D4", proyekId: proyekA.id, tanggalTerbit: "2026-12-15" });
    pastikan(kontenD4.status === "DRAF", "konten D4 DRAF");
    const JUDUL_T2 = `${AWALAN} T2 Carousel`;
    await sebagai(IKL, () => jalankan("tugas manual menaut konten", () => buatTugasDesain(formTugas({ judul: JUDUL_T2, kontenId: kontenD4.id, desainerId: desainer.id }))));
    const t2 = await tugasBernama(JUDUL_T2);
    pastikan(t2.kontenId === kontenD4.id && t2.kunciKontenAktif === kontenD4.id && t2.proyekId === proyekA.id, "T2 menaut konten, kunci aktif, proyek diwarisi konten");
    pastikan((await db.konten.findUniqueOrThrow({ where: { id: kontenD4.id } })).status === "DESAIN" && (await jumlahLog("konten", "STATUS", kontenD4.id)) === 1, "konten naik ke DESAIN dengan log STATUS konten");
    await sebagai(IKL, () => harusDitolak("tugas kedua untuk konten sama", () => buatTugasDesain(formTugas({ judul: `${AWALAN} T2 kedua`, kontenId: kontenD4.id })), "Konten ini sudah punya tugas desain"));
    await sebagai(DSN, async () => harusDitolak("ubah T1 menaut konten yang sama", async () => ubahTugasDesain(t1.id, await formUbahTugas(t1.id, { kontenId: kontenD4.id })), "Konten ini sudah punya tugas desain"));
    const kontenSerentak = await kontenBaru(`${AWALAN} Konten serentak`);
    const serentak = await sebagai(IKL, () =>
      Promise.allSettled([1, 2].map((n) => buatTugasDesain(formTugas({ judul: `${AWALAN} T serentak ${n}`, kontenId: kontenSerentak.id })))),
    );
    const ditolakSerentak = serentak.filter((h) => !aksiSukses(h)).map((h) => (h as PromiseRejectedResult).reason?.message ?? "");
    pastikan(serentak.filter(aksiSukses).length === 1 && ditolakSerentak.length === 1 && ditolakSerentak[0].includes("Konten ini sudah punya tugas desain"), `dua penautan serentak: satu sukses, satu ditolak (${ditolakSerentak.join(" | ")})`);
    pastikan((await db.tugasDesain.count({ where: { kontenId: kontenSerentak.id, diarsipkanPada: null } })) === 1, "konten serentak tetap satu tugas aktif");
    const kontenSmara = await kontenBaru(`${AWALAN} Konten SMARA`, { perusahaanId: "smara", proyekId: proyekS.id });
    const JUDUL_TS = `${AWALAN} T SMARA`;
    await sebagai(IKL, () => jalankan("buat tugas dari konten SMARA dengan isian perusahaan utama", () => buatTugasDesain(formTugas({ judul: JUDUL_TS, kontenId: kontenSmara.id, perusahaanId: "utama" }))));
    const tS = await tugasBernama(JUDUL_TS);
    pastikan(tS.perusahaanId === "smara" && tS.proyekId === proyekS.id && tS.status === "PERMINTAAN", "tugas mewarisi perusahaan dan proyek konten SMARA (isian perusahaan diabaikan)");
    await sebagai(DSN, async () => harusDitolak("ubah T1 menaut konten SMARA", async () => ubahTugasDesain(t1.id, await formUbahTugas(t1.id, { kontenId: kontenSmara.id })), "Konten terkait milik perusahaan lain"));
    await sebagai(DSN, async () => harusDitolak("ubah T1 menaut kampanye SMARA", async () => ubahTugasDesain(t1.id, await formUbahTugas(t1.id, { kampanyeId: kampanyeS.id })), "tidak punya hak melihat kampanye"));
    await sebagai("owner", async () => harusDitolak("owner ubah T1 menaut kampanye SMARA", async () => ubahTugasDesain(t1.id, await formUbahTugas(t1.id, { kampanyeId: kampanyeS.id })), "Kampanye terkait milik perusahaan lain"));
    const JUDUL_TK = `${AWALAN} T dari kampanye`;
    await sebagai(IKL, () => jalankan("buat tugas dari kampanye", () => buatTugasDesain(formTugas({ judul: JUDUL_TK, kampanyeId: kampanyeU.id }))));
    const tK = await tugasBernama(JUDUL_TK);
    pastikan(tK.kampanyeId === kampanyeU.id && tK.proyekId === proyekA.id && tK.perusahaanId === "utama", "tugas dari kampanye mewarisi proyek kampanye");

    console.log("=== D5. Pindah status T1 ===");
    await sebagai(DSN, () => jalankan("DESAINER DITUGASKAN ke DIKERJAKAN", () => pindahStatusDesain(t1.id, "DIKERJAKAN")));
    pastikan((await db.tugasDesain.findUniqueOrThrow({ where: { id: t1.id } })).status === "DIKERJAKAN" && (await jumlahNotif(desainer.id, "Tugas desain dipindah ke Dikerjakan")) === 0, "DIKERJAKAN, tanpa notifikasi ke pelaku sendiri");
    const logStatusT1 = await db.logAktivitas.findFirstOrThrow({ where: { waktu: { gte: mulaiUji }, modul: "tugas-desain", aksi: "STATUS", entitasId: t1.id } });
    pastikan((logStatusT1.meta as { dari?: string; ke?: string }).dari === "DITUGASKAN" && (logStatusT1.meta as { ke?: string }).ke === "DIKERJAKAN", "log STATUS meta dari dan ke");
    await sebagai(DSN, () => harusDitolak("DESAINER ke SELESAI", () => pindahStatusDesain(t1.id, "SELESAI"), "Hanya peninjau"));
    await sebagai(DSN, () => harusDitolak("DESAINER ke DISETUJUI", () => pindahStatusDesain(t1.id, "DISETUJUI"), "Hanya peninjau"));
    await sebagai(DSN, () => harusDitolak("DESAINER ke REVISI", () => pindahStatusDesain(t1.id, "REVISI", "x"), "Hanya peninjau yang boleh meminta revisi"));
    await sebagai(SOS, () => harusDitolak("SOSMED ke REVISI tanpa catatan", () => pindahStatusDesain(t1.id, "REVISI"), "Catatan revisi wajib diisi"));
    await sebagai(SOS, () => harusDitolak("SOSMED ke REVISI catatan 3001", () => pindahStatusDesain(t1.id, "REVISI", "x".repeat(3001)), "Catatan revisi maksimal 3000"));
    await sebagai(IKL, () => harusDitolak("IKLAN pindah status", () => pindahStatusDesain(t1.id, "DIKERJAKAN"), "tidak punya hak"));
    await sebagai(DSN, () => harusDitolak("status tidak dikenal", () => pindahStatusDesain(t1.id, "VIRAL"), "Status tidak dikenal"));
    // versi papan: transaksi selesai lebih dulu, revalidasi di luar HTTP menjadi galat yang dikembalikan, bukan dilempar
    await sebagai(SOS, () => pindahStatusDesainDariPapan(t1.id, "REVISI", "warna kurang kontras"));
    const t1Rev = await db.tugasDesain.findUniqueOrThrow({ where: { id: t1.id }, include: { revisi: true } });
    pastikan(t1Rev.status === "REVISI" && t1Rev.jumlahRevisi === 1 && t1Rev.catatanRevisi === "warna kurang kontras" && t1Rev.revisi.length === 1 && t1Rev.revisi[0].nomorRevisi === 1 && t1Rev.revisi[0].keputusan === "MINTA_REVISI", "seret ke Revisi: RevisiDesain #1 MINTA_REVISI dengan catatan");
    pastikan((await jumlahNotif(desainer.id, "Revisi desain #1 diminta")) === 1, "N9 ke desainer");
    await sebagai(SOS, () => jalankan("SOSMED kembali ke DIKERJAKAN", () => pindahStatusDesain(t1.id, "DIKERJAKAN")));
    pastikan((await jumlahNotif(desainer.id, "Tugas desain dipindah ke Dikerjakan")) === 1, "N7 ke desainer");
    await sebagai(DSN, () => jalankan("pindah ke status yang sama", () => pindahStatusDesain(t1.id, "DIKERJAKAN")));
    pastikan((await jumlahLog("tugas-desain", "STATUS", t1.id)) === 2, "pindah ke status yang sama tidak menambah log");

    console.log("=== D6. Ajukan tinjauan T2 ===");
    const desainerSesi = sesi(desainer);
    const iklanSesi = sesi({ ...(await ambil("uji-d6-iklan")) });
    await sebagai(DSN, () => harusDitolak("ajukan tanpa berkas hasil", () => ajukanTinjauanDesain(t2.id), "Unggah minimal satu berkas hasil"));
    const referensi = await unggah(iklanSesi, "referensi.png", "tugas-desain", t2.id, "REFERENSI");
    pastikan(referensi.proyekId === proyekA.id && referensi.perusahaanId === "utama", "berkas referensi mewarisi proyek dan perusahaan tugas");
    await sebagai(DSN, () => harusDitolak("ajukan dengan berkas REFERENSI saja", () => ajukanTinjauanDesain(t2.id), "Unggah minimal satu berkas hasil"));
    await sebagai(DSN, () => harusDitolak("pindah ke DITINJAU tanpa berkas hasil", () => pindahStatusDesain(t2.id, "DITINJAU"), "Unggah minimal satu berkas hasil"));
    await sebagai(DSN, async () => harusDitolak("Simpan & ajukan tanpa berkas hasil", async () => ubahTugasDesain(t2.id, await formUbahTugas(t2.id, { lanjut: "tinjau" })), "Unggah minimal satu berkas hasil"));
    await sebagai(DSN, () => harusDitolak("ajukan tugas PERMINTAAN tanpa desainer", () => ajukanTinjauanDesain(tK.id), "Tugaskan desainer dulu"));
    await sebagai(IKL, () => harusDitolak("IKLAN ajukan tinjauan", () => ajukanTinjauanDesain(t2.id), "tidak punya hak"));
    const hasil1 = await unggah(desainerSesi, "hasil-1.png", "hasil-desain", t2.id, "HASIL");
    await sebagai(DSN, () => jalankan("DESAINER ajukan", () => ajukanTinjauanDesain(t2.id)));
    pastikan((await db.tugasDesain.findUniqueOrThrow({ where: { id: t2.id } })).status === "DITINJAU" && (await jumlahLog("tugas-desain", "AJUKAN", t2.id)) === 1, "DITINJAU, log AJUKAN");
    pastikan((await jumlahNotif(sosmed.id, "Desain siap ditinjau")) === 1 && (await jumlahNotif(owner.id, "Desain siap ditinjau")) === 1 && (await jumlahNotif(owner2.id, "Desain siap ditinjau")) === 1, "N6 ke SOSMED, owner, owner2");
    pastikan((await jumlahNotif(superadmin.id, "Desain siap ditinjau")) === 0 && (await jumlahNotif(desainer.id, "Desain siap ditinjau")) === 0, "N6 tidak ke superadmin dan tidak ke desainer pengaju");
    await sebagai(DSN, () => harusDitolak("ajukan lagi", () => ajukanTinjauanDesain(t2.id), "sudah menunggu tinjauan"));

    console.log("=== D7. Tinjau minta revisi ===");
    await sebagai(DSN, () => harusDitolak("DESAINER tinjau", () => tinjauDesain(t2.id, formulir({ keputusan: "SETUJUI" })), "tidak punya hak"));
    await sebagai(SOS, () => harusDitolak("tinjau tugas yang belum DITINJAU", () => tinjauDesain(t1.id, formulir({ keputusan: "SETUJUI" })), "Pindahkan tugas ke Ditinjau dulu"));
    await sebagai(SOS, () => harusDitolak("REVISI tanpa catatan", () => tinjauDesain(t2.id, formulir({ keputusan: "REVISI" })), "Catatan revisi wajib diisi"));
    await sebagai(SOS, () => harusDitolak("keputusan tidak dikenal", () => tinjauDesain(t2.id, formulir({ keputusan: "TOLAK", catatan: "x" })), "Keputusan tidak dikenal"));
    await sebagai(SOS, () => jalankan("SOSMED minta revisi", () => tinjauDesain(t2.id, formulir({ keputusan: "REVISI", catatan: "perbesar logo" }))));
    const t2Rev = await db.tugasDesain.findUniqueOrThrow({ where: { id: t2.id }, include: { revisi: { orderBy: { dibuatPada: "desc" } } } });
    const r1 = t2Rev.revisi[0];
    pastikan(r1.nomorRevisi === 1 && r1.keputusan === "MINTA_REVISI" && r1.peninjauId === sosmed.id && JSON.stringify(bacaBerkasRevisi(r1.berkasSebelumnya)) === "[]" && JSON.stringify(bacaBerkasRevisi(r1.berkasBaru)) === JSON.stringify([{ id: hasil1.id, nama: "hasil-1.png" }]), "RevisiDesain #1 MINTA_REVISI: sebelumnya [], baru [hasil-1.png]");
    pastikan(t2Rev.status === "REVISI" && t2Rev.jumlahRevisi === 1 && t2Rev.catatanRevisi === "perbesar logo", "tugas REVISI, jumlahRevisi 1, catatanRevisi");
    const notifRevisi = await db.notifikasi.findFirstOrThrow({ where: { penggunaId: desainer.id, judul: "Revisi desain #1 diminta", tautan: `/pemasaran/desain?tugas=${t2.id}` } });
    pastikan(notifRevisi.isi === `${JUDUL_T2}: perbesar logo` && notifRevisi.jenis === "REVISI", "N9 isi judul: catatan, jenis REVISI");
    const kontenD7 = await detailKonten(db, kontenD4.id, sesi(owner));
    pastikan(kontenD7?.tugasAktif?.catatanRevisi === "perbesar logo" && kontenD7.tugasAktif.revisi[0]?.catatan === "perbesar logo", "detailKonten memuat catatan revisi tugas aktif");

    console.log("=== D8. Tinjau setuju ===");
    const hasil2 = await unggah(desainerSesi, "hasil-2.png", "hasil-desain", t2.id, "HASIL");
    await sebagai(DSN, () => jalankan("DESAINER ajukan lagi", () => ajukanTinjauanDesain(t2.id)));
    await sebagai(SOS, () => jalankan("SOSMED setujui", () => tinjauDesain(t2.id, formulir({ keputusan: "SETUJUI" }))));
    const t2Setuju = await db.tugasDesain.findUniqueOrThrow({ where: { id: t2.id }, include: { revisi: { orderBy: { dibuatPada: "desc" } } } });
    const r2 = t2Setuju.revisi[0];
    pastikan(r2.nomorRevisi === 1 && r2.keputusan === "DISETUJUI" && JSON.stringify(bacaBerkasRevisi(r2.berkasSebelumnya)) === JSON.stringify([{ id: hasil1.id, nama: "hasil-1.png" }]) && JSON.stringify(bacaBerkasRevisi(r2.berkasBaru)) === JSON.stringify([{ id: hasil1.id, nama: "hasil-1.png" }, { id: hasil2.id, nama: "hasil-2.png" }]), "#1 DISETUJUI: sebelumnya [hasil-1], baru [hasil-1, hasil-2]");
    pastikan(t2Setuju.status === "DISETUJUI" && t2Setuju.catatanRevisi === null && t2Setuju.jumlahRevisi === 1, "tugas DISETUJUI, catatanRevisi null");
    pastikan((await jumlahNotif(desainer.id, "Desain disetujui")) === 1, "N8 ke desainer");
    pastikan((await jumlahNotif(owner.id, "Desain untuk konten Anda sudah disetujui")) === 1 && (await jumlahNotif(sosmed.id, "Desain untuk konten Anda sudah disetujui")) === 0, "N10 ke SMM (owner); pembuat konten dilewati karena dia peninjaunya");
    const detailT2 = await detailTugasDesain(db, t2.id, sesi(owner));
    pastikan(detailT2?.konten?.briefDesain === "Brief D4 awal" && detailT2.konten.smm?.id === owner.id && !detailT2.kontenDiarsipkan && detailT2.revisi.length === 2 && detailT2.desainer?.id === desainer.id, "detailTugasDesain: brief dan SMM konten, dua revisi");
    await sebagai(SOS, async () => jalankan("ubah brief konten", async () => ubahKonten(kontenD4.id, formulir({ judul: kontenD4.judul, status: "DESAIN", smmId: owner.id, proyekId: proyekA.id, tanggalTerbit: "2026-12-15", caption: "Caption D4", briefDesain: "Brief D4 baru" }))));
    pastikan((await detailTugasDesain(db, t2.id, sesi(owner)))?.konten?.briefDesain === "Brief D4 baru", "brief dibaca langsung dari konten (K9 lewat detailTugasDesain)");
    await sebagai(SOS, () => jalankan("ajukan konten terkait", () => ajukanKonten(kontenD4.id, formulir({}))));
    pastikan((await db.konten.findUniqueOrThrow({ where: { id: kontenD4.id } })).statusPersetujuan === "MENUNGGU", "konten terkait bisa diajukan sesudah desain disetujui");

    console.log("=== D9. Selesai dan setuju langsung ===");
    await sebagai(SOS, () => jalankan("SOSMED T2 ke SELESAI", () => pindahStatusDesain(t2.id, "SELESAI")));
    pastikan((await jumlahNotif(desainer.id, "Tugas desain dipindah ke Selesai")) === 1, "N7 Selesai ke desainer");
    await sebagai("owner", () => jalankan("owner T1 langsung DISETUJUI", () => pindahStatusDesain(t1.id, "DISETUJUI")));
    const t1Setuju = await db.tugasDesain.findUniqueOrThrow({ where: { id: t1.id }, include: { revisi: { orderBy: { dibuatPada: "desc" } } } });
    pastikan(t1Setuju.status === "DISETUJUI" && t1Setuju.revisi[0].nomorRevisi === 1 && t1Setuju.revisi[0].keputusan === "DISETUJUI" && t1Setuju.revisi[0].peninjauId === owner.id, "setujui langsung T1 mencatat #1 DISETUJUI (nomor = jumlah revisi)");
    pastikan((await jumlahNotif(desainer.id, "Desain disetujui")) === 2, "N8 setujui langsung");
    const JUDUL_T3 = `${AWALAN} T3 langsung disetujui`;
    await sebagai("owner", () => jalankan("owner buat T3 langsung DISETUJUI", () => buatTugasDesain(formTugas({ judul: JUDUL_T3, desainerId: desainer2.id, status: "DISETUJUI" }))));
    const t3 = await db.tugasDesain.findFirstOrThrow({ where: { judul: JUDUL_T3 }, include: { revisi: true } });
    pastikan(t3.status === "DISETUJUI" && t3.revisi.length === 1 && t3.revisi[0].nomorRevisi === 0 && t3.revisi[0].keputusan === "DISETUJUI", "T3 dibuat langsung disetujui tercatat #0");
    pastikan((await jumlahNotif(desainer2.id, "Desain disetujui")) === 1 && (await jumlahNotif(desainer2.id, "Tugas desain baru untuk Anda")) === 1, "T3: N5 dan N8 ke desainer2");

    console.log("=== D10. Pewarisan proyek ===");
    const kontenD10 = await kontenBaru(`${AWALAN} Konten D10`, { proyekId: proyekA.id });
    const JUDUL_T10 = `${AWALAN} T10 warisan`;
    await sebagai(IKL, () => jalankan("tugas tertaut konten tanpa proyek", () => buatTugasDesain(formTugas({ judul: JUDUL_T10, kontenId: kontenD10.id }))));
    const t10 = await tugasBernama(JUDUL_T10);
    pastikan(t10.proyekId === proyekA.id, "tugas mewarisi proyek A dari konten");
    const refT10 = await unggah(iklanSesi, "ref-t10.png", "tugas-desain", t10.id, "REFERENSI");
    const kontenD10b = await kontenBaru(`${AWALAN} Konten D10 b`, { proyekId: proyekA.id });
    const JUDUL_T10B = `${AWALAN} T10 proyek sendiri`;
    await sebagai(IKL, () => jalankan("tugas tertaut konten dengan proyek sendiri", () => buatTugasDesain(formTugas({ judul: JUDUL_T10B, kontenId: kontenD10b.id, proyekId: proyekB.id }))));
    const ubahProyekKonten = (k: { id: string; judul: string }, proyekId: string) =>
      sebagai(SOS, () => jalankan(`ubah proyek ${k.judul}`, async () => ubahKonten(k.id, formulir({ judul: k.judul, status: "DESAIN", smmId: owner.id, proyekId }))));
    await ubahProyekKonten(kontenD10, proyekB.id);
    pastikan((await db.tugasDesain.findUniqueOrThrow({ where: { id: t10.id } })).proyekId === proyekB.id, "proyek tugas warisan ikut B");
    pastikan((await db.berkas.findUniqueOrThrow({ where: { id: refT10.id } })).proyekId === proyekB.id, "lampiran tugas warisan ikut pindah proyek");
    await ubahProyekKonten(kontenD10b, "");
    pastikan((await db.tugasDesain.findUniqueOrThrow({ where: { id: (await tugasBernama(JUDUL_T10B)).id } })).proyekId === proyekB.id, "tugas yang proyeknya sengaja beda tidak ikut");
    await sebagai(DSN, async () => jalankan("ubah proyek T10 ke A", async () => ubahTugasDesain(t10.id, await formUbahTugas(t10.id, { proyekId: proyekA.id }))));
    pastikan((await db.berkas.findUniqueOrThrow({ where: { id: refT10.id } })).proyekId === proyekA.id, "ubah proyek tugas memindah lampirannya");
    await sebagai(DSN, async () => jalankan("ubah T10 dengan desainer saat PERMINTAAN", async () => ubahTugasDesain(t10.id, await formUbahTugas(t10.id, { desainerId: desainer.id }))));
    const t10b = await db.tugasDesain.findUniqueOrThrow({ where: { id: t10.id } });
    pastikan(t10b.status === "DITUGASKAN" && (await jumlahLog("tugas-desain", "TUGASKAN", t10.id)) === 1 && (await jumlahNotif(desainer.id, "Tugas desain dipindah ke Ditugaskan")) === 0, "ubah dengan desainer saat Permintaan: Ditugaskan, TUGASKAN, tanpa N7");
    await sebagai(DSN, async () => harusDitolak("ubah ke DITINJAU lewat formulir", async () => ubahTugasDesain(t10.id, await formUbahTugas(t10.id, { status: "DITINJAU" })), "Gunakan tombol Ajukan untuk ditinjau"));
    await sebagai(DSN, async () => harusDitolak("ubah tugas tidak ada", async () => ubahTugasDesain("tidak-ada", await formUbahTugas(t10.id)), "Tugas desain tidak ditemukan"));

    console.log("=== D11. Riwayat tahan hapus berkas ===");
    await sebagai(DSN, () => harusDitolak("DESAINER membuang berkas hasil", () => buangBerkas(hasil1.id), "tidak punya hak"));
    await sebagai("owner", () => jalankan("owner membuang hasil-1.png", () => buangBerkas(hasil1.id)));
    const detailD11 = await detailTugasDesain(db, t2.id, sesi(owner));
    const revisi1 = detailD11!.revisi.find((r) => r.keputusan === "MINTA_REVISI")!;
    pastikan(bacaBerkasRevisi(revisi1.berkasBaru).some((b) => b.nama === "hasil-1.png"), "revisi #1 masih menampilkan nama hasil-1.png");
    pastikan((await berkasHasilAktif(db, t2.id)).length === 1, "berkas hasil aktif tinggal 1");
    await sebagai("owner", () => jalankan("owner memulihkan hasil-1.png", () => pulihkanBerkas(hasil1.id)));
    pastikan((await berkasHasilAktif(db, t2.id)).length === 2, "sesudah dipulihkan kembali 2");

    console.log("=== D12. Arsip ===");
    const kontenD12 = await kontenBaru(`${AWALAN} Konten D12`);
    const JUDUL_T12 = `${AWALAN} T12 diarsip`;
    await sebagai(IKL, () => jalankan("tugas untuk konten D12", () => buatTugasDesain(formTugas({ judul: JUDUL_T12, kontenId: kontenD12.id, desainerId: desainer.id }))));
    const t12 = await tugasBernama(JUDUL_T12);
    await sebagai(SOS, () => harusDitolak("ajukan konten D12 saat desain belum disetujui", () => ajukanKonten(kontenD12.id, formulir({})), "Desain konten ini harus disetujui dulu"));
    await sebagai(SOS, () => harusDitolak("SOSMED arsip tugas", () => arsipkanTugasDesain(t12.id), "tidak punya hak"));
    await sebagai("owner", () => jalankan("owner arsip T12", () => arsipkanTugasDesain(t12.id)));
    const t12Arsip = await db.tugasDesain.findUniqueOrThrow({ where: { id: t12.id } });
    pastikan(!!t12Arsip.diarsipkanPada && t12Arsip.kunciKontenAktif === null && t12Arsip.kontenId === kontenD12.id && (await jumlahLog("tugas-desain", "ARSIP", t12.id)) === 1, "arsip: kunci dilepas, kontenId tetap, log ARSIP");
    pastikan((await detailTugasDesain(db, t12.id, sesi(owner))) === null, "detailTugasDesain tugas arsip = null");
    await sebagai("owner", () => harusDitolak("arsip kedua", () => arsipkanTugasDesain(t12.id), "Tugas desain tidak ditemukan"));
    await sebagai(DSN, () => harusDitolak("pindah status tugas arsip", () => pindahStatusDesain(t12.id, "DIKERJAKAN"), "Tugas desain tidak ditemukan"));
    await sebagai(SOS, () => jalankan("ajukan konten D12 tanpa syarat desain lama", () => ajukanKonten(kontenD12.id, formulir({}))));
    await sebagai(IKL, () => jalankan("kirim konten D12 ke desain lagi", () => kirimKeDesain(kontenD12.id, formulir({}))));
    pastikan((await db.tugasDesain.count({ where: { kontenId: kontenD12.id, diarsipkanPada: null } })) === 1, "konten D12 punya tugas aktif baru");

    console.log("=== D13. Fungsi baca ===");
    const papanSaya = await tugasKanban(db, { saya: true }, desainer.id, "utama");
    const semuaPapanSaya = papanSaya.flatMap((k) => k.tugas);
    pastikan(papanSaya.length === 7 && semuaPapanSaya.length > 0 && semuaPapanSaya.every((t) => t.desainer?.id === desainer.id), "tugasKanban saya hanya memuat tugas desainer itu");
    pastikan(!!papanSaya.find((k) => k.status === "SELESAI")?.tugas.some((t) => t.id === t2.id), "kolom SELESAI memuat T2");
    // T2 dibuat seolah selesai 40 hari lalu (diubahPada diisi lewat SQL supaya @updatedAt tidak menimpanya)
    const diubahT2 = (await db.tugasDesain.findUniqueOrThrow({ where: { id: t2.id } })).diubahPada;
    await db.$executeRaw`UPDATE "TugasDesain" SET "diubahPada" = ${new Date(Date.now() - 40 * 86_400_000)} WHERE "id" = ${t2.id}`;
    const papanLama = await tugasKanban(db, { saya: true }, desainer.id, "utama");
    pastikan(!papanLama.find((k) => k.status === "SELESAI")?.tugas.some((t) => t.id === t2.id) && papanLama.find((k) => k.status === "DISETUJUI")!.tugas.some((t) => t.id === t1.id), "kolom SELESAI hanya 30 hari terakhir");
    await db.$executeRaw`UPDATE "TugasDesain" SET "diubahPada" = ${diubahT2} WHERE "id" = ${t2.id}`;
    const papanSmara = await tugasKanban(db, {}, desainer.id, "smara");
    pastikan(papanSmara.flatMap((k) => k.tugas).every((t) => t.perusahaanId === "smara") && papanSmara.some((k) => k.tugas.some((t) => t.id === tS.id)), "tugasKanban per perusahaan");
    const cariDeskripsi = await tugasDaftar(db, {}, { q: "deskripsi-unik-d13", lewati: 0, ambil: 25 }, desainer.id, "utama");
    pastikan(cariDeskripsi.total === 1 && cariDeskripsi.baris[0].id === t1.id, "tugasDaftar mencari deskripsi");
    const daftarProyekB = await tugasDaftar(db, { proyek: proyekB.id }, { q: AWALAN, lewati: 0, ambil: 25 }, desainer.id, null);
    pastikan(daftarProyekB.baris.length > 0 && daftarProyekB.baris.every((t) => t.proyek?.id === proyekB.id), "tugasDaftar saringan proyek");
    const daftarStatus = await tugasDaftar(db, { status: "DISETUJUI", prioritas: "SEDANG" }, { q: AWALAN, lewati: 0, ambil: 25 }, desainer.id, null);
    pastikan(daftarStatus.baris.some((t) => t.id === t1.id) && daftarStatus.baris.every((t) => t.status === "DISETUJUI" && t.prioritas === "SEDANG"), "tugasDaftar saringan status dan prioritas");
    const ringkasan = await ringkasanDesainBeranda(db, desainer.id, "utama");
    const aktifUtama = { diarsipkanPada: null, perusahaanId: "utama" };
    pastikan(ringkasan.ditugaskanKeSaya === (await db.tugasDesain.count({ where: { ...aktifUtama, desainerId: desainer.id, status: { not: "SELESAI" } } })) && ringkasan.ditugaskanKeSaya > 0, "ringkasanDesainBeranda ditugaskanKeSaya");
    pastikan(ringkasan.revisiSaya === (await db.tugasDesain.count({ where: { ...aktifUtama, desainerId: desainer.id, status: "REVISI" } })) && ringkasan.menungguTinjauan === (await db.tugasDesain.count({ where: { ...aktifUtama, status: "DITINJAU" } })), "ringkasanDesainBeranda revisiSaya dan menungguTinjauan");
    const barisT2 = (await tugasDaftar(db, {}, { q: JUDUL_T2, lewati: 0, ambil: 1 }, desainer.id, "utama")).baris[0];
    const kartu = kartuKanbanTugas(barisT2, { href: (id) => `/pemasaran/desain?tugas=${id}` });
    pastikan(kartu.kolomId === "SELESAI" && kartu.subjudul === "Perencana · Instagram · terbit 15 Des 2026" && kartu.lencana?.[0]?.teks === "Sedang" && kartu.baris?.includes(`${desainer.nama} · Rev 1`) && kartu.href === `/pemasaran/desain?tugas=${t2.id}`, `kartuKanbanTugas T2 (${kartu.subjudul} | ${kartu.baris?.join(" | ")})`);
    const barisT1 = (await tugasDaftar(db, {}, { q: JUDUL_T1, lewati: 0, ambil: 1 }, desainer.id, "utama")).baris[0];
    pastikan(kartuKanbanTugas({ ...barisT1, status: "DIKERJAKAN" }, { href: (id) => id, sekarang: new Date("2026-12-05T12:00:00") }).baris?.includes("Lewat tenggat 01 Des 2026") === true && kartuKanbanTugas(barisT1, { href: (id) => id, sekarang: new Date("2026-12-05T12:00:00") }).baris?.includes("Tenggat 01 Des 2026") === true, "kartu menandai lewat tenggat hanya bila belum disetujui");

    console.log("=== D15. Perbaikan tinjauan P41 ===");
    // S1: melepas konten yang kuncinya dipegang tugas butuh tugas-desain.hapus atau tugas-desain.setujui
    const kontenS1 = await kontenBaru(`${AWALAN} Konten S1`);
    const JUDUL_S1 = `${AWALAN} S1 lepas konten`;
    await sebagai(IKL, () => jalankan("tugas untuk konten S1", () => buatTugasDesain(formTugas({ judul: JUDUL_S1, kontenId: kontenS1.id, desainerId: desainer.id }))));
    const tS1 = await tugasBernama(JUDUL_S1);
    await sebagai(DSN, async () => harusDitolak("DESAINER melepas konten tugas", async () => ubahTugasDesain(tS1.id, await formUbahTugas(tS1.id, { kontenId: "" })), "Hanya peninjau desain"));
    await sebagai(SOS, () => harusDitolak("konten S1 tetap tertahan penjaga desain", () => ajukanKonten(kontenS1.id, formulir({})), "Desain konten ini harus disetujui dulu"));
    const kontenS1b = await kontenBaru(`${AWALAN} Konten S1b`);
    await sebagai(DSN, async () => harusDitolak("DESAINER mengganti konten tugas", async () => ubahTugasDesain(tS1.id, await formUbahTugas(tS1.id, { kontenId: kontenS1b.id })), "Hanya peninjau desain"));
    pastikan((await db.tugasDesain.findUniqueOrThrow({ where: { id: tS1.id } })).kunciKontenAktif === kontenS1.id, "kunci konten S1 tetap dipegang tugas");
    // S1: tugas Disetujui dipindah ke konten lain kembali Ditugaskan dengan log STATUS dan N7
    await sebagai("owner", () => jalankan("owner setujui tugas S1 langsung", () => pindahStatusDesain(tS1.id, "DISETUJUI")));
    const n7Awal = await jumlahNotif(desainer.id, "Tugas desain dipindah ke Ditugaskan");
    await sebagai(SOS, async () => jalankan("SOSMED (peninjau) memindah tugas Disetujui ke konten S1b", async () => ubahTugasDesain(tS1.id, await formUbahTugas(tS1.id, { kontenId: kontenS1b.id }))));
    const tS1Pindah = await db.tugasDesain.findUniqueOrThrow({ where: { id: tS1.id } });
    pastikan(tS1Pindah.status === "DITUGASKAN" && tS1Pindah.kunciKontenAktif === kontenS1b.id, "tugas Disetujui yang dipindah ke konten lain kembali Ditugaskan");
    pastikan((await jumlahNotif(desainer.id, "Tugas desain dipindah ke Ditugaskan")) === n7Awal + 1, "N7 ke desainer saat tugas kembali Ditugaskan");
    const logStatusS1 = async () => (await db.logAktivitas.findMany({ where: { modul: "tugas-desain", aksi: "STATUS", entitasId: tS1.id, waktu: { gte: mulaiUji } }, select: { meta: true } })).map((l) => l.meta as { dari?: string; ke?: string });
    pastikan((await logStatusS1()).some((m) => m.dari === "DISETUJUI" && m.ke === "DITUGASKAN"), "log STATUS Disetujui ke Ditugaskan");
    await sebagai(SOS, () => jalankan("konten S1 bebas sesudah dilepas peninjau", () => ajukanKonten(kontenS1.id, formulir({}))));
    // S2: status Permintaan dari formulir untuk tugas yang bukan Permintaan mengikuti jalur biasa (log sebenarnya).
    // Sejak perbaikan tinjauan P43 R2, Permintaan dengan desainer terisi ditolak di formulir dan papan, jadi asersi
    // semula (ADMIN menyimpan Permintaan dengan desainer tetap terisi, lalu N7) diganti penolakan itu ditambah jalur
    // yang mengosongkan desainer.
    await sebagai("owner", () => jalankan("owner setujui tugas S1 lagi", () => pindahStatusDesain(tS1.id, "DISETUJUI")));
    await sebagai("admin", async () =>
      harusDitolak("ADMIN mengirim status Permintaan dengan desainer terisi", async () => ubahTugasDesain(tS1.id, await formUbahTugas(tS1.id, { status: "PERMINTAAN" })), "Kosongkan desainer"),
    );
    await sebagai("owner", () => harusDitolak("papan ke Permintaan dengan desainer terisi", () => pindahStatusDesain(tS1.id, "PERMINTAAN"), "Kosongkan desainer"));
    pastikan((await db.tugasDesain.findUniqueOrThrow({ where: { id: tS1.id } })).status === "DISETUJUI", "R2: tugas tetap Disetujui sesudah ditolak");
    await sebagai("admin", async () => jalankan("ADMIN mengembalikan ke Permintaan dengan desainer dikosongkan", async () => ubahTugasDesain(tS1.id, await formUbahTugas(tS1.id, { status: "PERMINTAAN", desainerId: "" }))));
    const tS1Permintaan = await db.tugasDesain.findUniqueOrThrow({ where: { id: tS1.id } });
    pastikan(tS1Permintaan.status === "PERMINTAAN" && tS1Permintaan.desainerId === null, "S2: tugas Disetujui tidak otomatis menjadi Ditugaskan");
    pastikan((await logStatusS1()).some((m) => m.dari === "DISETUJUI" && m.ke === "PERMINTAAN") && !(await logStatusS1()).some((m) => m.ke === "DITUGASKAN" && m.dari === "PERMINTAAN"), "S2: log STATUS memakai status lama sebenarnya");
    await sebagai("admin", async () => jalankan("simpan ulang tanpa perubahan", async () => ubahTugasDesain(tS1.id, await formUbahTugas(tS1.id))));
    pastikan((await db.tugasDesain.findUniqueOrThrow({ where: { id: tS1.id } })).status === "PERMINTAAN", "R2: simpan ulang tidak membalik status");
    // R1: galat unik kunciKontenAktif dari adapter pg dikenali
    let galatUnik: unknown = null;
    await db.tugasDesain.create({ data: { judul: `${AWALAN} R1 ganda`, kontenId: kontenS1b.id, kunciKontenAktif: kontenS1b.id, dibuatOlehNama: "Skrip Uji" } }).catch((e) => (galatUnik = e));
    pastikan(galatUnikKunciKonten(galatUnik) && !galatUnikKunciKonten(new Error("lain")), "R1: P2002 kunciKontenAktif dikenali lewat meta adapter");
    // R4: brief konten dan kampanye hanya bagi pemegang hak lihatnya
    const JUDUL_R4 = `${AWALAN} R4 kampanye`;
    await sebagai("owner", () => jalankan("tugas dengan kampanye", () => buatTugasDesain(formTugas({ judul: JUDUL_R4, kampanyeId: kampanyeU.id }))));
    const tR4 = await tugasBernama(JUDUL_R4);
    pastikan((await detailTugasDesain(db, tR4.id, sesi(desainer)))?.kampanye === null && (await detailTugasDesain(db, tR4.id, sesi(owner)))?.kampanye?.id === kampanyeU.id, "R4: DESAINER (tanpa kampanye.lihat) tidak menerima kampanye");
    const tanpaKonten: PenggunaSesi = { ...sesi(owner), hak: HAK_BAWAAN.PEMILIK.filter((h) => !h.startsWith("konten.")) };
    const detailR4 = await detailTugasDesain(db, tS1.id, tanpaKonten);
    pastikan(detailR4?.konten === null && detailR4.kontenId === kontenS1b.id && (await detailTugasDesain(db, tS1.id, sesi(owner)))?.konten?.id === kontenS1b.id, "R4: tanpa konten.lihat brief tidak ikut, kontenId tetap");
    // R5: penerima notifikasi disaring hak lihat tautannya
    pastikan(hakTautanPemasaran("/pemasaran/konten?konten=x") === "konten.lihat" && hakTautanPemasaran("/pemasaran/desain?tugas=x") === "tugas-desain.lihat" && hakTautanPemasaran("/crm") === null, "R5: hak tautan Pemasaran");
    const BATAL = new Error("batal");
    let jumlahR5 = -1;
    await db
      .$transaction(async (tx) => {
        jumlahR5 = await kirimNotifikasiPemasaran(tx, { penerima: [kasir.id, desainer.id], pelaku: sesi(owner), judul: `${AWALAN} R5`, tautan: `/pemasaran/konten?konten=${kontenS1.id}`, jenis: "STATUS", perusahaanId: "utama" });
        throw BATAL;
      })
      .catch((e) => {
        if (e !== BATAL) throw e;
      });
    pastikan(jumlahR5 === 1, "R5: KASIR (tanpa konten.lihat) tidak menerima notifikasi konten, desainer menerima");
    // R6: Superadmin ditolak sebagai penanggung jawab baru
    await harusDitolak("Superadmin sebagai desainer", () => pastikanPenanggungJawab(db, superadmin.id, "tugas-desain.ubah", "Desainer"), "Desainer harus pengguna aktif");
    await sebagai(IKL, () => harusDitolak("tugas dengan desainer Superadmin", () => buatTugasDesain(formTugas({ judul: `${AWALAN} R6`, desainerId: superadmin.id })), "Desainer harus pengguna aktif"));
    // R7: kirim ke desain dengan desainer kosong dan desainer konten yang tidak lagi berhak
    const kontenR7 = await kontenBaru(`${AWALAN} Konten R7`);
    await db.konten.update({ where: { id: kontenR7.id }, data: { desainerId: kasir.id } });
    await sebagai(IKL, () => harusDitolak("kirim ke desain, desainer konten tidak berhak", () => kirimKeDesain(kontenR7.id, formulir({})), PESAN_DESAINER_KONTEN_TIDAK_BERHAK));
    await sebagai(IKL, () => jalankan("kirim ke desain dengan desainer dipilih", () => kirimKeDesain(kontenR7.id, formulir({ desainerId: desainer.id }))));
    pastikan((await db.tugasDesain.findFirstOrThrow({ where: { kunciKontenAktif: kontenR7.id } })).desainerId === desainer.id, "R7: desainer pilihan dipakai");

    console.log("=== D14. Tanpa efek akuntansi ===");
    pastikan((await db.jurnal.count()) === jumlahJurnalAwal, "tidak ada jurnal yang dibuat modul Pemasaran");
    const sinkronAkhir = await periksaSinkron(db);
    pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron seimbang dan sama dengan awal");
    pastikan((await db.hakAksesPeran.count()) === hakAwal, "tidak ada baris HakAksesPeran baru");
  } finally {
    console.log("=== Bersih-bersih ===");
    await bersihkan(mulaiUji);
  }
  pastikan((await db.tugasDesain.count({ where: { judul: { contains: AWALAN } } })) === 0 && (await db.pengguna.count({ where: { namaPengguna: { startsWith: "uji-d6-" } } })) === 0, "data uji D6 bersih");
  console.log("\nSEMUA UJI DESAIN LULUS");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
