import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { HAK_BAWAAN, labelHak, punyaHak, type PenggunaSesi } from "../src/lib/hakAkses";
import type { PeranPengguna } from "../src/prisma-klien/enums";
import { periksaSinkron } from "../src/lib/sinkron";
import { tanggalIso } from "../src/lib/waktu";
import { JENIS_KONTEN_BAWAAN, PILAR_KONTEN_BAWAAN } from "../src/lib/labelPemasaran";
import { ambilPengaturanPemasaran, cariPemasaran, pilihanPenanggungJawab, rapikanDaftarPilihan, urlKembali } from "../src/lib/pemasaran";
import {
  ajukanKontenInternal,
  detailKonten,
  gridKalender,
  kartuKanbanKonten,
  kontenDaftar,
  kontenKalender,
  kontenKanban,
  ringkasanKontenBeranda,
} from "../src/lib/konten";
import { ajukanKonten, arsipkanKonten, buatKonten, kirimKeDesain, pindahStatusKonten, tinjauKonten, ubahKonten } from "../src/lib/aksi/konten";
import { simpanPengaturanPemasaran } from "../src/lib/aksi/pengaturanPemasaran";
import { formulir, harusDitolak, jalankan, pastikan, sebagai } from "./bantuan";

/*
 * Uji pustaka dan aksi Perencana Konten (P39, D6 §9.2 K1 sampai K22, pola D6 §9.1). Data uji berawalan "UJI-D6"
 * (judul konten, kode proyek), pengguna sementara uji-d6-sosmed, uji-d6-iklan, uji-d6-desainer, uji-d6-desainer2,
 * ditambah akun seed owner, admin, kasir, superadmin sebagai pelaku nyata. Pelaku tanpa hak tertentu memakai
 * PenggunaSesi buatan, bukan baris HakAksesPeran. Baris PengaturanPemasaran utama dan smara disalin di awal dan
 * dipulihkan di akhir. Aksi tinjauan desain milik P40 tidak dipakai di sini: K11 memasang status tugas lewat basis
 * data, dan pewarisan perusahaan tugas manual (K17) diuji uji-desain.ts.
 */

const AWALAN = "UJI-D6";
const PENGGUNA_UJI: [string, PeranPengguna][] = [
  ["uji-d6-sosmed", "SOSMED"],
  ["uji-d6-iklan", "IKLAN"],
  ["uji-d6-desainer", "DESAINER"],
  ["uji-d6-desainer2", "DESAINER"],
];
const KODE_PROYEK = { A: "UJI-D6-PRJ-A", S: "UJI-D6-PRJ-S" } as const;
const PERUSAHAAN_PENGATURAN = ["utama", "smara"];

/** Menghapus data uji D6 (sisa putaran yang terhenti, dan di akhir). `mulai` = log dan notifikasi sejak uji mulai. */
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
  await db.logAktivitas.deleteMany({ where: { OR: [{ entitasId: { in: semuaId }, modul: modulD6 }, ...(mulai ? [{ waktu: { gte: mulai }, modul: modulD6 }] : [])] } });
  await db.berkas.deleteMany({ where: { OR: [{ entitasId: { in: semuaId } }, { proyekId: { in: proyekIds } }] } });
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

async function main() {
  await bersihkan(null);
  const mulaiUji = new Date();
  const jumlahJurnalAwal = await db.jurnal.count();
  const hakAwal = await db.hakAksesPeran.count();
  const sinkronAwal = await periksaSinkron(db);
  pastikan(sinkronAwal.seimbang, "periksaSinkron seimbang sebelum uji");
  const salinanPengaturan = await db.pengaturanPemasaran.findMany({ where: { perusahaanId: { in: PERUSAHAAN_PENGATURAN } } });
  await db.pengaturanPemasaran.deleteMany({ where: { perusahaanId: "smara" } });

  for (const [namaPengguna, peran] of PENGGUNA_UJI) {
    await db.pengguna.create({ data: { namaPengguna, nama: `Uji D6 ${namaPengguna.slice(7)}`, kataSandiHash: "uji", peran, nomorTelepon: "+620000000000" } });
  }
  const ambil = (namaPengguna: string) => db.pengguna.findUniqueOrThrow({ where: { namaPengguna }, select: { id: true, nama: true, namaPengguna: true, peran: true } });
  const [sosmed, iklan, desainer, desainer2, owner, owner2, kasir, superadmin] = await Promise.all(
    ["uji-d6-sosmed", "uji-d6-iklan", "uji-d6-desainer", "uji-d6-desainer2", "owner", "owner2", "kasir", "superadmin"].map(ambil),
  );
  const proyekA = await db.proyek.create({ data: { kode: KODE_PROYEK.A, nama: "Event Uji D6 A" } });
  const proyekS = await db.proyek.create({ data: { kode: KODE_PROYEK.S, nama: "Event Uji D6 SMARA", perusahaanId: "smara" } });

  const SOS = "uji-d6-sosmed";
  const IKL = "uji-d6-iklan";
  const DSN = "uji-d6-desainer";
  const jumlahNotif = (penggunaId: string, judul: string) => db.notifikasi.count({ where: { penggunaId, judul, dibuatPada: { gte: mulaiUji } } });
  const jumlahLog = (modul: string, aksi: string, entitasId?: string) => db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, modul, aksi, ...(entitasId ? { entitasId } : {}) } });
  const kontenBernama = (judul: string) => db.konten.findFirstOrThrow({ where: { judul } });
  /** Formulir ubah: isi konten sekarang ditambah perubahan. */
  const formUbah = async (id: string, o: Record<string, string | null> = {}) => {
    const k = await db.konten.findUniqueOrThrow({ where: { id } });
    return formulir({
      judul: k.judul,
      platform: k.platform,
      jenisKonten: k.jenisKonten,
      pilar: k.pilar,
      caption: k.caption,
      cta: k.cta,
      tagar: k.tagar,
      tanggalTerbit: k.tanggalTerbit ? tanggalIso(k.tanggalTerbit) : null,
      jamTerbit: k.jamTerbit,
      status: k.status,
      smmId: k.smmId,
      desainerId: k.desainerId,
      proyekId: k.proyekId,
      briefDesain: k.briefDesain,
      catatan: k.catatan,
      ...o,
    });
  };

  try {
    console.log("=== K1. Hak bawaan ===");
    const AKSI = ["lihat", "buat", "ubah", "setujui", "hapus"] as const;
    const hakKonten = (p: PeranPengguna) => AKSI.filter((a) => punyaHak(p, `konten.${a}`));
    pastikan(JSON.stringify(hakKonten("SOSMED")) === JSON.stringify(["lihat", "buat", "ubah", "hapus"]) && !punyaHak("SOSMED", "kampanye.lihat"), "SOSMED: konten lihat/buat/ubah/hapus, tanpa setujui dan tanpa kampanye.lihat");
    pastikan(JSON.stringify(hakKonten("IKLAN")) === '["lihat"]' && JSON.stringify(hakKonten("DESAINER")) === '["lihat"]', "IKLAN dan DESAINER hanya konten.lihat");
    pastikan(punyaHak("ADMIN", "konten.lihat") && !punyaHak("ADMIN", "konten.buat"), "ADMIN: konten.lihat ya, konten.buat tidak");
    pastikan(punyaHak("PEMILIK", "konten.setujui") && punyaHak("SUPERADMIN", "konten.setujui"), "PEMILIK dan SUPERADMIN memegang konten.setujui");
    pastikan((["KASIR", "GUDANG", "KRU", "GUEST"] as const).every((p) => hakKonten(p).length === 0), "KASIR, GUDANG, KRU, GUEST tanpa konten.*");
    pastikan(labelHak("konten.setujui") === "Perencana Konten Media Sosial · setujui", `labelHak konten.setujui = "${labelHak("konten.setujui")}"`);

    console.log("=== K2. Penolakan hak ===");
    await sebagai("kasir", () => harusDitolak("buatKonten sebagai kasir", () => buatKonten(formulir({ judul: `${AWALAN} kasir` })), "tidak punya hak"));
    await sebagai(SOS, () => harusDitolak("tinjauKonten sebagai SOSMED", () => tinjauKonten("tidak-ada", formulir({ keputusan: "SETUJUI" })), "tidak punya hak"));
    await sebagai(IKL, () => harusDitolak("arsipkanKonten sebagai IKLAN", () => arsipkanKonten("tidak-ada"), "tidak punya hak"));

    console.log("=== K3. Penolakan isian ===");
    const dasar = { perusahaanId: "utama", judul: `${AWALAN} K3` };
    const tolakBuat = (label: string, o: Record<string, string>, pesan: string) => sebagai(SOS, () => harusDitolak(label, () => buatKonten(formulir({ ...dasar, ...o })), pesan));
    await tolakBuat("judul kosong", { judul: "  " }, "Judul konten wajib diisi");
    await tolakBuat("judul 201 karakter", { judul: `${AWALAN} ${"x".repeat(194)}` }, "maksimal 200");
    await tolakBuat("platform myspace", { platform: "myspace" }, "Platform tidak dikenal");
    await tolakBuat("tanggal 2026-02-30", { tanggalTerbit: "2026-02-30" }, "Tanggal terbit tidak valid");
    await tolakBuat("tanggal 2026-13-45", { tanggalTerbit: "2026-13-45" }, "Tanggal terbit tidak valid");
    await tolakBuat("jam 25:00", { tanggalTerbit: "2026-12-10", jamTerbit: "25:00" }, "Jam terbit tidak valid");
    await tolakBuat("jam tanpa tanggal", { jamTerbit: "10:00" }, "Isi tanggal terbit dulu");
    await tolakBuat("caption 5001 karakter", { caption: "c".repeat(5001) }, "maksimal 5000");
    await tolakBuat("status DITINJAU", { status: "DITINJAU" }, "Gunakan tombol Ajukan persetujuan");
    await tolakBuat("status DISETUJUI tanpa konten.setujui", { status: "DISETUJUI" }, "Hanya penyetuju");
    await tolakBuat("status TERJADWAL tanpa persetujuan", { status: "TERJADWAL" }, "Konten harus disetujui");
    await tolakBuat("status tidak dikenal", { status: "VIRAL" }, "Status tidak dikenal");
    await tolakBuat("SMM kasir", { smmId: kasir.id }, "Social Media Manager harus pengguna aktif");
    await tolakBuat("desainer kasir", { desainerId: kasir.id }, "Desainer harus pengguna aktif");
    await tolakBuat("SMM tidak ada", { smmId: "tidak-ada" }, "Social Media Manager harus pengguna aktif");
    await tolakBuat("proyek SMARA untuk konten utama", { proyekId: proyekS.id }, "milik");
    pastikan((await db.konten.count({ where: { judul: { startsWith: AWALAN } } })) === 0, "tidak ada konten uji yang tersimpan dari isian yang ditolak");

    console.log("=== K4. Buat sukses ===");
    const JUDUL_K4 = `${AWALAN} Reels promo Desember`;
    await sebagai(SOS, () =>
      jalankan("SOSMED membuat konten", () =>
        buatKonten(formulir({ perusahaanId: "utama", judul: JUDUL_K4, platform: "INSTAGRAM", jenisKonten: "Reels", pilar: "Promosi", caption: "Promo akhir tahun #uji", tagar: "#dpro #uji", tanggalTerbit: "2026-12-10", jamTerbit: "10:00", smmId: sosmed.id, desainerId: desainer.id, proyekId: proyekA.id, kembali: "tampilan=kanban&bulan=2026-12&jahat=https://x" })),
      ),
    );
    const k4 = await kontenBernama(JUDUL_K4);
    pastikan(k4.status === "IDE" && k4.statusPersetujuan === "TIDAK_ADA" && k4.perusahaanId === "utama" && k4.dibuatOlehId === sosmed.id && k4.dibuatOlehNama === sosmed.nama, "konten K4: IDE, TIDAK_ADA, utama, dibuat oleh SOSMED");
    pastikan(tanggalIso(k4.tanggalTerbit!) === "2026-12-10" && k4.jamTerbit === "10:00" && k4.proyekId === proyekA.id && k4.smmId === sosmed.id && k4.desainerId === desainer.id, "tanggal, jam, proyek, SMM, desainer tersimpan");
    pastikan((await jumlahLog("konten", "BUAT", k4.id)) === 1, "log BUAT konten 1");
    pastikan((await jumlahNotif(desainer.id, "Tugas konten baru")) === 1 && (await jumlahNotif(sosmed.id, "Tugas konten baru")) === 0, "N1 ke desainer 1, ke SOSMED 0 (pelaku)");
    const notifK4 = await db.notifikasi.findFirstOrThrow({ where: { penggunaId: desainer.id, judul: "Tugas konten baru", dibuatPada: { gte: mulaiUji } } });
    pastikan(notifK4.tautan === `/pemasaran/konten?konten=${k4.id}` && notifK4.isi === JUDUL_K4 && notifK4.jenis === "PENUGASAN" && notifK4.perusahaanId === "utama", "N1: tautan laci konten, isi judul, jenis PENUGASAN, perusahaan konten");
    pastikan(urlKembali(formulir({ kembali: "tampilan=kanban&bulan=2026-12&jahat=https://x&q=promo" }), "/pemasaran/konten", { konten: "abc" }) === "/pemasaran/konten?tampilan=kanban&bulan=2026-12&q=promo&konten=abc", "urlKembali hanya meneruskan kunci tampilan yang dikenal");
    pastikan(urlKembali(formulir({}), "/pemasaran/konten") === "/pemasaran/konten", "urlKembali tanpa kembali dan tambah = rute dasar");

    console.log("=== K5. Ubah: SMM diganti ===");
    await sebagai(SOS, async () => jalankan("SMM diganti ke owner", async () => ubahKonten(k4.id, await formUbah(k4.id, { smmId: owner.id }))));
    pastikan((await db.konten.findUniqueOrThrow({ where: { id: k4.id } })).smmId === owner.id, "SMM tersimpan owner");
    pastikan((await jumlahNotif(owner.id, "Tugas konten baru")) === 1 && (await jumlahNotif(desainer.id, "Tugas konten baru")) === 1, "N1 ke owner 1, desainer tetap 1 (tidak bertambah)");
    pastikan((await jumlahLog("konten", "UBAH", k4.id)) === 1, "log UBAH 1");
    await sebagai(SOS, async () => jalankan("ubah tanpa perubahan", async () => ubahKonten(k4.id, await formUbah(k4.id))));
    pastikan((await jumlahLog("konten", "UBAH", k4.id)) === 1, "ubah tanpa perubahan tidak menulis log UBAH");
    await sebagai(SOS, async () => harusDitolak("ubah konten tidak ada", async () => ubahKonten("tidak-ada", await formUbah(k4.id)), "Konten tidak ditemukan"));
    await sebagai(SOS, async () => harusDitolak("ubah ke DITINJAU lewat formulir", async () => ubahKonten(k4.id, await formUbah(k4.id, { status: "DITINJAU" })), "Gunakan tombol Ajukan persetujuan"));
    await sebagai(SOS, async () => harusDitolak("lanjut tidak dikenal", async () => ubahKonten(k4.id, await formUbah(k4.id, { lanjut: "terbit" })), "Tindak lanjut tidak dikenal"));

    console.log("=== K6. Pindah status bebas ===");
    await sebagai(SOS, () => jalankan("IDE ke DRAF", () => pindahStatusKonten(k4.id, "DRAF")));
    const logStatus = await db.logAktivitas.findFirstOrThrow({ where: { waktu: { gte: mulaiUji }, modul: "konten", aksi: "STATUS", entitasId: k4.id } });
    const metaStatus = logStatus.meta as { dari?: string; ke?: string };
    pastikan((await db.konten.findUniqueOrThrow({ where: { id: k4.id } })).status === "DRAF" && metaStatus.dari === "IDE" && metaStatus.ke === "DRAF", "status DRAF, log STATUS meta dari IDE ke DRAF");
    await sebagai(SOS, () => jalankan("DRAF ke DRAF", () => pindahStatusKonten(k4.id, "DRAF")));
    pastikan((await jumlahLog("konten", "STATUS", k4.id)) === 1, "pindah ke status yang sama tidak menambah log");
    await sebagai(SOS, () => harusDitolak("pindah ke status tidak dikenal", () => pindahStatusKonten(k4.id, "VIRAL"), "Status tidak dikenal"));
    await sebagai(SOS, () => harusDitolak("SOSMED pindah ke DISETUJUI", () => pindahStatusKonten(k4.id, "DISETUJUI"), "Hanya penyetuju"));
    await sebagai(SOS, () => harusDitolak("SOSMED pindah ke TERBIT tanpa persetujuan", () => pindahStatusKonten(k4.id, "TERBIT"), "Konten harus disetujui"));
    await sebagai(DSN, () => harusDitolak("DESAINER pindah status", () => pindahStatusKonten(k4.id, "IDE"), "tidak punya hak"));

    console.log("=== K7. Kirim ke desain ===");
    await sebagai(DSN, () => harusDitolak("DESAINER kirim ke desain", () => kirimKeDesain(k4.id, formulir({})), "tidak punya hak"));
    await sebagai(IKL, () => harusDitolak("kirim konten palsu", () => kirimKeDesain("tidak-ada", formulir({})), "Konten tidak ditemukan"));
    await sebagai(IKL, () => harusDitolak("kirim dengan prioritas tidak dikenal", () => kirimKeDesain(k4.id, formulir({ prioritas: "SANGAT" })), "Prioritas tidak dikenal"));
    await sebagai(IKL, () => harusDitolak("kirim dengan desainer kasir", () => kirimKeDesain(k4.id, formulir({ desainerId: kasir.id })), "Desainer harus pengguna aktif"));
    await sebagai(IKL, () => jalankan("IKLAN kirim ke desain", () => kirimKeDesain(k4.id, formulir({ deskripsi: "Ukuran 1080x1920" }))));
    const tugas = await db.tugasDesain.findFirstOrThrow({ where: { kontenId: k4.id, diarsipkanPada: null } });
    pastikan(tugas.judul === `Desain: ${JUDUL_K4}` && tanggalIso(tugas.tenggat!) === "2026-12-08", `tugas: judul "Desain: ...", tenggat 2026-12-08 (${tugas.tenggat && tanggalIso(tugas.tenggat)})`);
    pastikan(tugas.status === "DITUGASKAN" && tugas.sumber === "KONTEN" && tugas.kunciKontenAktif === k4.id && tugas.proyekId === proyekA.id && tugas.perusahaanId === "utama" && tugas.desainerId === desainer.id && tugas.deskripsi === "Ukuran 1080x1920", "tugas DITUGASKAN, sumber KONTEN, kunci aktif, proyek A, utama, desainer konten, instruksi tambahan");
    pastikan((await db.konten.findUniqueOrThrow({ where: { id: k4.id } })).status === "DESAIN", "konten DRAF naik ke DESAIN");
    pastikan((await jumlahNotif(desainer.id, "Tugas desain baru untuk Anda")) === 1, "N5 ke desainer");
    const logBuatTugas = await db.logAktivitas.findFirstOrThrow({ where: { waktu: { gte: mulaiUji }, modul: "tugas-desain", aksi: "BUAT", entitasId: tugas.id } });
    pastikan((logBuatTugas.meta as { dariKonten?: string }).dariKonten === k4.id && (await jumlahLog("tugas-desain", "TUGASKAN", tugas.id)) === 1, "log BUAT tugas meta.dariKonten dan TUGASKAN");

    console.log("=== K8. Kirim kedua ===");
    await sebagai(IKL, () => harusDitolak("kirim kedua", () => kirimKeDesain(k4.id, formulir({})), "Konten ini sudah punya tugas desain"));
    await sebagai(SOS, async () => harusDitolak("Simpan & kirim ke desain kedua", async () => ubahKonten(k4.id, await formUbah(k4.id, { lanjut: "desain" })), "Konten ini sudah punya tugas desain"));
    pastikan((await db.tugasDesain.count({ where: { kontenId: k4.id, diarsipkanPada: null } })) === 1, "tugas aktif konten tetap 1");

    console.log("=== K9. Brief dibaca langsung ===");
    await sebagai(SOS, async () => jalankan("ubah brief desain", async () => ubahKonten(k4.id, await formUbah(k4.id, { briefDesain: "Logo besar, latar navy" }))));
    const tugasBrief = await db.tugasDesain.findUniqueOrThrow({ where: { id: tugas.id }, select: { deskripsi: true, konten: { select: { briefDesain: true } } } });
    pastikan(tugasBrief.konten?.briefDesain === "Logo besar, latar navy" && tugasBrief.deskripsi === "Ukuran 1080x1920", "tugas membaca brief konten terbaru tanpa salinan");

    console.log("=== K10. Ajukan ditahan desain ===");
    await sebagai(SOS, () => harusDitolak("ajukan saat desain belum disetujui", () => ajukanKonten(k4.id, formulir({})), "Desain konten ini harus disetujui dulu"));
    await sebagai(SOS, () => harusDitolak("pindah ke DITINJAU saat desain belum disetujui", () => pindahStatusKonten(k4.id, "DITINJAU"), "Desain konten ini harus disetujui dulu"));
    await sebagai(SOS, async () => harusDitolak("Simpan & ajukan saat desain belum disetujui", async () => ubahKonten(k4.id, await formUbah(k4.id, { lanjut: "ajukan" })), "Desain konten ini harus disetujui dulu"));
    const tanpaLihatDesain: PenggunaSesi = { id: sosmed.id, nama: sosmed.nama, namaPengguna: sosmed.namaPengguna, email: null, nomorTelepon: null, peran: "SOSMED", hak: HAK_BAWAAN.SOSMED.filter((h) => !h.startsWith("tugas-desain.")) };
    pastikan(!punyaHak(tanpaLihatDesain, "tugas-desain.lihat"), "pelaku buatan tanpa tugas-desain.lihat");
    await harusDitolak(
      "ajukanKontenInternal tanpa tugas-desain.lihat",
      () => db.$transaction(async (tx) => ajukanKontenInternal(tx, (await tx.konten.findUniqueOrThrow({ where: { id: k4.id } })), tanpaLihatDesain, null)),
      "Desain konten ini harus disetujui dulu",
    );
    pastikan((await db.konten.findUniqueOrThrow({ where: { id: k4.id } })).statusPersetujuan === "TIDAK_ADA", "konten tidak diajukan");

    console.log("=== K11. Desain disetujui lalu ajukan ===");
    // aksi tinjauan desain milik P40 (uji-desain); di sini status tugas dipasang langsung
    await db.tugasDesain.update({ where: { id: tugas.id }, data: { status: "DISETUJUI" } });
    await sebagai(SOS, () => jalankan("SOSMED ajukan dengan catatan", () => ajukanKonten(k4.id, formulir({ catatan: "mohon dicek" }))));
    const k11 = await db.konten.findUniqueOrThrow({ where: { id: k4.id }, include: { riwayat: { orderBy: { dibuatPada: "desc" } } } });
    pastikan(k11.status === "DITINJAU" && k11.statusPersetujuan === "MENUNGGU" && k11.riwayat[0]?.aksi === "DIAJUKAN" && k11.riwayat[0]?.masukan === "mohon dicek" && k11.riwayat[0]?.penggunaId === sosmed.id, "DITINJAU, MENUNGGU, riwayat DIAJUKAN dengan catatan dan pengaju");
    const logAjukan = await db.logAktivitas.findFirstOrThrow({ where: { waktu: { gte: mulaiUji }, modul: "konten", aksi: "AJUKAN", entitasId: k4.id } });
    pastikan((logAjukan.meta as { dari?: string }).dari === "DESAIN" && logAjukan.perusahaanId === "utama", "log AJUKAN meta.dari DESAIN");
    pastikan((await jumlahNotif(owner.id, "Persetujuan konten diminta")) === 1 && (await jumlahNotif(owner2.id, "Persetujuan konten diminta")) === 1, "N2 ke owner dan owner2 (PEMILIK) masing-masing 1");
    pastikan((await jumlahNotif(superadmin.id, "Persetujuan konten diminta")) === 0 && (await jumlahNotif(sosmed.id, "Persetujuan konten diminta")) === 0, "N2 tidak ke superadmin dan tidak ke pengaju");
    await sebagai(SOS, () => harusDitolak("ajukan lagi", () => ajukanKonten(k4.id, formulir({})), "Konten ini sudah menunggu persetujuan"));
    await sebagai(SOS, () => harusDitolak("catatan pengajuan 1001 karakter", () => ajukanKonten(k4.id, formulir({ catatan: "x".repeat(1001) })), "Catatan pengajuan maksimal 1000"));

    console.log("=== K12. Tinjau tolak ===");
    await sebagai("owner", () => harusDitolak("tolak tanpa masukan", () => tinjauKonten(k4.id, formulir({ keputusan: "TOLAK" })), "Isi masukan"));
    await sebagai("owner", () => harusDitolak("keputusan tidak dikenal", () => tinjauKonten(k4.id, formulir({ keputusan: "REVISI", masukan: "x" })), "Keputusan tidak dikenal"));
    await sebagai("owner", () => jalankan("owner menolak", () => tinjauKonten(k4.id, formulir({ keputusan: "TOLAK", masukan: "logo kurang besar" }))));
    const k12 = await db.konten.findUniqueOrThrow({ where: { id: k4.id }, include: { riwayat: { orderBy: { dibuatPada: "desc" }, take: 1 } } });
    pastikan(k12.status === "DRAF" && k12.statusPersetujuan === "DITOLAK" && k12.riwayat[0]?.aksi === "DITOLAK" && k12.riwayat[0]?.masukan === "logo kurang besar", "DRAF, DITOLAK, riwayat DITOLAK dengan masukan");
    const notifTolak = await db.notifikasi.findMany({ where: { judul: "Konten ditolak", dibuatPada: { gte: mulaiUji } } });
    pastikan(notifTolak.length === 1 && notifTolak[0].penggunaId === sosmed.id && notifTolak[0].isi === `${JUDUL_K4}: logo kurang besar`, "N4 hanya ke pembuat (SMM owner dilewati sebagai pelaku), isi judul: masukan");
    pastikan((await jumlahLog("konten", "TOLAK", k4.id)) === 1, "log TOLAK");
    await sebagai("owner", () => harusDitolak("tinjau lagi", () => tinjauKonten(k4.id, formulir({ keputusan: "SETUJUI" })), "tidak sedang menunggu persetujuan"));

    console.log("=== K13. Ajukan ulang lalu setuju ===");
    await sebagai(SOS, () => jalankan("ajukan dari DITOLAK", () => ajukanKonten(k4.id, formulir({}))));
    pastikan((await db.konten.findUniqueOrThrow({ where: { id: k4.id } })).statusPersetujuan === "MENUNGGU", "MENUNGGU lagi");
    await sebagai("owner", () => jalankan("owner menyetujui", () => tinjauKonten(k4.id, formulir({ keputusan: "SETUJUI" }))));
    const k13 = await db.konten.findUniqueOrThrow({ where: { id: k4.id } });
    pastikan(k13.status === "DISETUJUI" && k13.statusPersetujuan === "DISETUJUI", "DISETUJUI dan persetujuan DISETUJUI");
    pastikan((await jumlahNotif(sosmed.id, "Konten disetujui")) === 1, "N3 ke SOSMED (pembuat)");

    console.log("=== K14. Jadwal dan terbit ===");
    await sebagai(SOS, () => jalankan("ke TERJADWAL", () => pindahStatusKonten(k4.id, "TERJADWAL")));
    await sebagai(SOS, () => jalankan("ke TERBIT", () => pindahStatusKonten(k4.id, "TERBIT")));
    pastikan((await db.konten.findUniqueOrThrow({ where: { id: k4.id } })).status === "TERBIT", "TERBIT sesudah disetujui");

    console.log("=== K15. Tarik otomatis ===");
    await sebagai(SOS, () => jalankan("ajukan dari TERBIT", () => ajukanKonten(k4.id, formulir({}))));
    await sebagai(SOS, () => jalankan("DITINJAU ke DRAF", () => pindahStatusKonten(k4.id, "DRAF")));
    const k15 = await db.konten.findUniqueOrThrow({ where: { id: k4.id }, include: { riwayat: { orderBy: { dibuatPada: "desc" }, take: 1 } } });
    pastikan(k15.status === "DRAF" && k15.statusPersetujuan === "TIDAK_ADA" && k15.riwayat[0]?.aksi === "DITARIK", "DRAF, TIDAK_ADA, riwayat DITARIK");
    pastikan((await jumlahLog("konten", "TARIK", k4.id)) === 1, "log TARIK");
    await sebagai("owner", () => harusDitolak("tinjau sesudah ditarik", () => tinjauKonten(k4.id, formulir({ keputusan: "SETUJUI" })), "tidak sedang menunggu persetujuan"));

    console.log("=== K16. Setujui langsung ===");
    const riwayatSetuju = () => db.riwayatPersetujuanKonten.count({ where: { kontenId: k4.id, aksi: "DISETUJUI" } });
    const sebelumK16 = await riwayatSetuju();
    await sebagai("owner", () => jalankan("owner DRAF ke DISETUJUI", () => pindahStatusKonten(k4.id, "DISETUJUI")));
    const k16 = await db.konten.findUniqueOrThrow({ where: { id: k4.id } });
    pastikan(k16.status === "DISETUJUI" && k16.statusPersetujuan === "DISETUJUI" && (await riwayatSetuju()) === sebelumK16 + 1, "setujui langsung: persetujuan DISETUJUI, riwayat DISETUJUI bertambah");
    pastikan((await jumlahNotif(sosmed.id, "Konten disetujui")) === 2, "N3 ke SOSMED bertambah 1");
    await sebagai("owner", () => jalankan("owner menerbitkan langsung", () => pindahStatusKonten(k4.id, "TERJADWAL")));

    console.log("=== K16b. Mundur ke Ide, Draf, atau Desain mencabut persetujuan ===");
    const JUDUL_MUNDUR = `${AWALAN} Konten mundur`;
    await sebagai(SOS, () => jalankan("buat konten untuk uji mundur", () => buatKonten(formulir({ perusahaanId: "utama", judul: JUDUL_MUNDUR, status: "DRAF", tanggalTerbit: "2026-12-22" }))));
    const kM = await kontenBernama(JUDUL_MUNDUR);
    const riwayatM = (aksi: "DISETUJUI" | "DITARIK") => db.riwayatPersetujuanKonten.count({ where: { kontenId: kM.id, aksi } });
    await sebagai("owner", () => jalankan("owner menyetujui langsung", () => pindahStatusKonten(kM.id, "DISETUJUI")));
    // negatif: pindah maju tidak menyentuh persetujuan
    await sebagai(SOS, () => jalankan("ke TERJADWAL sesudah disetujui", () => pindahStatusKonten(kM.id, "TERJADWAL")));
    pastikan((await db.konten.findUniqueOrThrow({ where: { id: kM.id } })).statusPersetujuan === "DISETUJUI" && (await riwayatM("DITARIK")) === 0, "maju ke TERJADWAL: persetujuan tetap DISETUJUI, tanpa riwayat DITARIK");
    // positif: mundur ke Draf
    await sebagai(SOS, () => jalankan("SOSMED memundurkan ke DRAF", () => pindahStatusKonten(kM.id, "DRAF")));
    const kM1 = await db.konten.findUniqueOrThrow({ where: { id: kM.id }, include: { riwayat: { orderBy: [{ dibuatPada: "desc" }, { id: "desc" }], take: 1 } } });
    pastikan(kM1.status === "DRAF" && kM1.statusPersetujuan === "TIDAK_ADA", "mundur ke DRAF: persetujuan menjadi TIDAK_ADA");
    pastikan(kM1.riwayat[0]?.aksi === "DITARIK" && kM1.riwayat[0].penggunaId === sosmed.id && /dicabut/.test(kM1.riwayat[0].masukan ?? "") && (await riwayatM("DISETUJUI")) === 1, "riwayat DITARIK paling baru oleh pelaku, riwayat DISETUJUI lama tetap sebagai jejak");
    pastikan((await jumlahLog("konten", "CABUT_SETUJU", kM.id)) === 1, "log CABUT_SETUJU 1");
    // negatif: tanpa penyetuju tidak bisa menjadwalkan sebelum disetujui ulang
    await sebagai(SOS, () => harusDitolak("jadwalkan sesudah dimundurkan", () => pindahStatusKonten(kM.id, "TERJADWAL"), "harus disetujui"));
    // mundur ke Draf berikutnya (persetujuan sudah TIDAK_ADA) tidak menambah riwayat DITARIK
    await sebagai(SOS, () => jalankan("DRAF ke IDE", () => pindahStatusKonten(kM.id, "IDE")));
    pastikan((await riwayatM("DITARIK")) === 1 && (await jumlahLog("konten", "CABUT_SETUJU", kM.id)) === 1, "mundur ke IDE tanpa persetujuan: tidak ada riwayat atau log pencabutan baru");
    // diajukan dan disetujui ulang membuka jalan ke TERJADWAL
    await sebagai(SOS, () => jalankan("ajukan ulang", () => ajukanKonten(kM.id, formulir({}))));
    await sebagai("owner", () => jalankan("owner menyetujui ulang", () => tinjauKonten(kM.id, formulir({ keputusan: "SETUJUI" }))));
    await sebagai(SOS, () => jalankan("ke TERJADWAL sesudah disetujui ulang", () => pindahStatusKonten(kM.id, "TERJADWAL")));
    pastikan((await db.konten.findUniqueOrThrow({ where: { id: kM.id } })).status === "TERJADWAL" && (await riwayatM("DISETUJUI")) === 2, "dijadwalkan sesudah persetujuan ulang");
    // mundur ke IDE juga mencabut, lewat formulir ubah
    await sebagai(SOS, () => jalankan("formulir ubah status ke IDE", async () => ubahKonten(kM.id, await formUbah(kM.id, { status: "IDE" }))));
    const kM2 = await db.konten.findUniqueOrThrow({ where: { id: kM.id } });
    pastikan(kM2.status === "IDE" && kM2.statusPersetujuan === "TIDAK_ADA" && (await riwayatM("DITARIK")) === 2, "mundur ke IDE lewat formulir ubah juga mencabut persetujuan");
    // mundur ke DESAIN juga mencabut: visual bisa diganti di tahap itu, jadi tidak boleh langsung dijadwalkan lagi
    await sebagai("owner", () => jalankan("owner menyetujui langsung lagi", () => pindahStatusKonten(kM.id, "DISETUJUI")));
    await sebagai(SOS, () => jalankan("SOSMED memundurkan ke DESAIN", () => pindahStatusKonten(kM.id, "DESAIN")));
    const kM3 = await db.konten.findUniqueOrThrow({ where: { id: kM.id } });
    pastikan(kM3.status === "DESAIN" && kM3.statusPersetujuan === "TIDAK_ADA" && (await riwayatM("DITARIK")) === 3, "mundur ke DESAIN mencabut persetujuan");
    await sebagai(SOS, () => harusDitolak("jadwalkan sesudah dimundurkan ke DESAIN", () => pindahStatusKonten(kM.id, "TERJADWAL"), "harus disetujui"));
    await db.riwayatPersetujuanKonten.deleteMany({ where: { kontenId: kM.id } });
    await db.konten.delete({ where: { id: kM.id } });

    console.log("=== K17. Multi perusahaan ===");
    const JUDUL_S = `${AWALAN} Konten SMARA`;
    await sebagai(SOS, () => jalankan("buat konten SMARA dengan proyek S", () => buatKonten(formulir({ perusahaanId: "smara", judul: JUDUL_S, proyekId: proyekS.id, status: "DRAF", tanggalTerbit: "2026-12-20" }))));
    const kS = await kontenBernama(JUDUL_S);
    pastikan(kS.perusahaanId === "smara" && kS.proyekId === proyekS.id, "konten SMARA berproyek S");
    await sebagai(SOS, () => harusDitolak("proyek A untuk konten SMARA", async () => ubahKonten(kS.id, await formUbah(kS.id, { proyekId: proyekA.id })), "milik"));
    const param = { q: AWALAN, lewati: 0, ambil: 25 };
    const idsUtama = (await kontenDaftar(db, {}, param, "utama")).baris.map((b) => b.id);
    const daftarGabungan = await kontenDaftar(db, {}, param, null);
    const idsGabungan = daftarGabungan.baris.map((b) => b.id);
    pastikan(idsUtama.includes(k4.id) && !idsUtama.includes(kS.id), "kontenDaftar utama memuat K4 tanpa konten SMARA");
    pastikan(idsGabungan.includes(k4.id) && idsGabungan.includes(kS.id) && daftarGabungan.baris.find((b) => b.id === kS.id)?.perusahaan.kode === "SMARA", "kontenDaftar gabungan memuat keduanya beserta perusahaan");
    await sebagai(IKL, () => jalankan("kirim konten SMARA ke desain", () => kirimKeDesain(kS.id, formulir({ desainerId: desainer.id }))));
    const tugasS = await db.tugasDesain.findFirstOrThrow({ where: { kontenId: kS.id } });
    pastikan(tugasS.perusahaanId === "smara" && tugasS.proyekId === proyekS.id && tugasS.tenggat && tanggalIso(tugasS.tenggat) === "2026-12-18", "tugas dari konten SMARA mewarisi perusahaan dan proyek konten");
    const notifS = await db.notifikasi.findFirstOrThrow({ where: { penggunaId: desainer.id, judul: "Tugas desain baru untuk Anda", tautan: `/pemasaran/desain?tugas=${tugasS.id}` } });
    pastikan(notifS.perusahaanId === "smara", "notifikasi tugas SMARA berperusahaan smara");
    pastikan((await db.konten.findUniqueOrThrow({ where: { id: kS.id } })).desainerId === desainer.id, "desainer konten diisi dari kirim ke desain bila masih kosong");

    console.log("=== K18. Fungsi baca halaman ===");
    const grid12 = gridKalender("2026-12");
    pastikan(grid12.length === 42 && grid12[0] === "2026-11-30" && grid12[41] === "2027-01-10", `gridKalender 2026-12: ${grid12[0]} sampai ${grid12[41]}`);
    pastikan(gridKalender("2026-11")[0] === "2026-10-26", "gridKalender 2026-11 mulai 2026-10-26");
    pastikan(gridKalender("2026-06")[0] === "2026-06-01", "gridKalender bulan yang mulai Senin");
    const kalender = await kontenKalender(db, { bulan: "2026-12" }, "utama");
    pastikan(kalender.sel.length === 42 && !!kalender.sel.find((s) => s.tanggal === "2026-12-10")?.konten.some((k) => k.id === k4.id), "kontenKalender memuat K4 di sel 2026-12-10");
    pastikan(!kalender.sel.some((s) => s.konten.some((k) => k.id === kS.id)), "kontenKalender utama tanpa konten SMARA");
    const JUDUL_TANPA = `${AWALAN} Ide tanpa tanggal`;
    await sebagai(SOS, () => jalankan("buat konten tanpa tanggal", () => buatKonten(formulir({ perusahaanId: "utama", judul: JUDUL_TANPA, platform: "TIKTOK", caption: "kalimat-unik-k18" }))));
    const kTanpa = await kontenBernama(JUDUL_TANPA);
    const kalender2 = await kontenKalender(db, { bulan: "2026-12" }, "utama");
    pastikan(kalender2.tanpaTanggal === (await db.konten.count({ where: { perusahaanId: "utama", diarsipkanPada: null, tanggalTerbit: null } })), "kontenKalender menghitung konten tanpa tanggal");
    const kanban = await kontenKanban(db, { bulan: "2026-12" }, "utama");
    pastikan(kanban.length === 7 && !!kanban.find((k) => k.status === "IDE")?.konten.some((k) => k.id === kTanpa.id) && !!kanban.find((k) => k.status === "TERJADWAL")?.konten.some((k) => k.id === k4.id), "kontenKanban memuat konten tanpa tanggal (IDE) dan K4 (TERJADWAL)");
    const kanbanNov = await kontenKanban(db, { bulan: "2026-11" }, "utama");
    pastikan(!kanbanNov.some((k) => k.konten.some((x) => x.id === k4.id)) && kanbanNov.some((k) => k.konten.some((x) => x.id === kTanpa.id)), "kanban bulan lain tanpa K4 tetapi tetap memuat konten tanpa tanggal");
    const kanbanTiktok = await kontenKanban(db, { bulan: "2026-12", platform: "TIKTOK" }, "utama");
    pastikan(kanbanTiktok.every((k) => k.konten.every((x) => x.platform === "TIKTOK")) && kanbanTiktok.some((k) => k.konten.some((x) => x.id === kTanpa.id)), "saringan platform");
    const cari = await kontenDaftar(db, {}, { q: "kalimat-unik-k18", lewati: 0, ambil: 25 }, "utama");
    pastikan(cari.total === 1 && cari.baris[0].id === kTanpa.id, "kontenDaftar mencari caption");
    const daftarProyek = await kontenDaftar(db, { proyek: proyekA.id }, param, "utama");
    const daftarTanpaProyek = await kontenDaftar(db, { proyek: "tanpa" }, param, "utama");
    pastikan(daftarProyek.baris.every((b) => b.proyek?.id === proyekA.id) && daftarProyek.baris.some((b) => b.id === k4.id) && daftarTanpaProyek.baris.some((b) => b.id === kTanpa.id) && !daftarTanpaProyek.baris.some((b) => b.id === k4.id), "saringan proyek dan tanpa proyek");
    const urut = (await kontenDaftar(db, {}, param, null)).baris;
    pastikan(urut.findIndex((b) => b.id === k4.id) < urut.findIndex((b) => b.id === kS.id) && urut.findIndex((b) => b.id === kS.id) < urut.findIndex((b) => b.id === kTanpa.id), "urut tanggal terbit naik, yang belum dijadwalkan terakhir");
    const sesiPemilik: PenggunaSesi = { id: owner.id, nama: owner.nama, namaPengguna: "owner", email: null, nomorTelepon: null, peran: "PEMILIK", hak: HAK_BAWAAN.PEMILIK };
    const detail = await detailKonten(db, k4.id, sesiPemilik);
    pastikan(!!detail && detail.riwayat.length >= 6 && detail.riwayat.every((r, i, a) => i === 0 || a[i - 1].dibuatPada >= r.dibuatPada) && detail.riwayat[0].aksi === "DISETUJUI", "detailKonten: riwayat urut terbaru dulu");
    pastikan(detail?.tugasAktif?.id === tugas.id && detail.tugasAktif.desainer?.id === desainer.id && detail.proyek?.kode === KODE_PROYEK.A && detail.smm?.id === owner.id, "detailKonten memuat tugas aktif, desainer, proyek, SMM");
    pastikan((await detailKonten(db, "tidak-ada", sesiPemilik)) === null, "detailKonten id tidak ada = null");
    // perbaikan tinjauan P41 R4: tugas aktif (desainer, revisi) hanya bagi pemegang tugas-desain.lihat
    const tanpaLihatTugas: PenggunaSesi = { ...sesiPemilik, hak: HAK_BAWAAN.PEMILIK.filter((h) => !h.startsWith("tugas-desain.")) };
    const detailTanpaHak = await detailKonten(db, k4.id, tanpaLihatTugas);
    pastikan(!!detailTanpaHak && detailTanpaHak.tugasAktif === null && detailTanpaHak.adaTugasAktif && detail?.adaTugasAktif === true, "detailKonten tanpa tugas-desain.lihat: tugasAktif null, adaTugasAktif tetap benar (R4)");
    await sebagai(SOS, () => jalankan("ajukan konten tanpa tanggal", () => ajukanKonten(kTanpa.id, formulir({}))));
    const ringkasan = await ringkasanKontenBeranda(db, "utama");
    pastikan(ringkasan.menungguPersetujuan === (await db.konten.count({ where: { perusahaanId: "utama", diarsipkanPada: null, statusPersetujuan: "MENUNGGU" } })) && ringkasan.menungguPersetujuan >= 1, "ringkasanKontenBeranda menghitung menunggu persetujuan");
    const ringkasTanpa = (await kontenDaftar(db, {}, { q: JUDUL_TANPA, lewati: 0, ambil: 1 }, "utama")).baris[0];
    const kartu = kartuKanbanKonten(ringkasTanpa, { lihatDesain: true, href: (id) => `/pemasaran/konten?tampilan=kanban&konten=${id}` });
    pastikan(kartu.kolomId === "DITINJAU" && kartu.titik === "bg-slate-900" && kartu.subjudul === "TikTok" && kartu.lencana?.[0]?.teks === "Menunggu persetujuan" && kartu.baris?.includes("Belum dijadwalkan") && kartu.href?.endsWith(kTanpa.id), "kartuKanbanKonten: kolom status, titik platform, lencana menunggu, belum dijadwalkan");
    const ringkasK4 = (await kontenDaftar(db, {}, { q: JUDUL_K4, lewati: 0, ambil: 1 }, "utama")).baris[0];
    const kartuDesain = kartuKanbanKonten(ringkasK4, { lihatDesain: true, href: (id) => id });
    const kartuTanpaDesain = kartuKanbanKonten(ringkasK4, { lihatDesain: false, href: (id) => id });
    pastikan(kartuDesain.lencana?.some((l) => l.teks === "Desain: Disetujui" && l.nada === "emerald") === true && !kartuTanpaDesain.lencana?.some((l) => l.teks.startsWith("Desain")), "lencana desain hanya bagi pembaca yang boleh melihat tugas desain");
    pastikan(kartuDesain.subjudul === "Instagram · Reels" && kartuDesain.baris?.[0] === `${KODE_PROYEK.A} Event Uji D6 A` && kartuDesain.baris?.[1] === "10 Des 2026 10:00", `kartu K4: subjudul dan baris (${kartuDesain.baris?.join(" | ")})`);
    const ownerSesi: PenggunaSesi = { id: owner.id, nama: owner.nama, namaPengguna: "owner", email: null, nomorTelepon: null, peran: "PEMILIK", hak: HAK_BAWAAN.PEMILIK };
    const kasirSesi: PenggunaSesi = { ...ownerSesi, id: kasir.id, peran: "KASIR", hak: HAK_BAWAAN.KASIR };
    const hasilCari = await cariPemasaran(db, AWALAN, ownerSesi, "utama");
    pastikan(!!hasilCari.konten?.some((k) => k.id === k4.id && k.tautan === `/pemasaran/konten?konten=${k4.id}`) && !hasilCari.konten?.some((k) => k.id === kS.id) && !!hasilCari.tugas?.some((t) => t.id === tugas.id), "cariPemasaran owner utama: konten dan tugas utama, tanpa SMARA");
    const cariKasir = await cariPemasaran(db, AWALAN, kasirSesi, null);
    pastikan(cariKasir.konten === null && cariKasir.tugas === null && cariKasir.kampanye === null, "cariPemasaran KASIR: semua kelompok null (tanpa hak lihat)");

    console.log("=== K19. Pengaturan daftar ===");
    await sebagai(SOS, () => harusDitolak("SOSMED simpan daftar", () => simpanPengaturanPemasaran(formulir({ perusahaanId: "utama", jenisKonten: "Feed" })), "tidak punya hak"));
    await sebagai("owner", () => jalankan("owner simpan daftar utama", () => simpanPengaturanPemasaran(formulir({ perusahaanId: "utama", jenisKonten: "  Reels \nreels\n\nFeed   Foto\n", pilarKonten: "Edukasi\n" }))));
    const pengaturan = await ambilPengaturanPemasaran(db, "utama");
    pastikan(JSON.stringify(pengaturan.jenisKonten) === '["Reels","Feed Foto"]' && JSON.stringify(pengaturan.pilarKonten) === '["Edukasi"]', `daftar dirapikan: ${JSON.stringify(pengaturan)}`);
    pastikan((await db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, modul: "konten", aksi: "UBAH", jenis: "Pengaturan Pemasaran", entitasId: "utama" } })) === 1, "log UBAH Pengaturan Pemasaran");
    const limaPuluhSatu = Array.from({ length: 51 }, (_, i) => `Butir ${i + 1}`).join("\n");
    await sebagai("owner", () => harusDitolak("51 butir", () => simpanPengaturanPemasaran(formulir({ perusahaanId: "utama", jenisKonten: limaPuluhSatu })), "Maksimal 50 butir"));
    await sebagai("owner", () => harusDitolak("tanpa perusahaan", () => simpanPengaturanPemasaran(formulir({ jenisKonten: "Feed" })), "Pilih perusahaan"));
    await sebagai("owner", () => harusDitolak("perusahaan tidak ada", () => simpanPengaturanPemasaran(formulir({ perusahaanId: "tidak-ada", jenisKonten: "Feed" })), "Perusahaan tidak ditemukan"));
    pastikan(rapikanDaftarPilihan(`${"a".repeat(70)}\nA${"a".repeat(69)}`).length === 1 && rapikanDaftarPilihan("x".repeat(70))[0].length === 60, "butir dipotong 60 karakter sebelum dibandingkan");
    const bawaanSmara = await ambilPengaturanPemasaran(db, "smara");
    pastikan(JSON.stringify(bawaanSmara.jenisKonten) === JSON.stringify(JENIS_KONTEN_BAWAAN) && bawaanSmara.jenisKonten.length === 6 && bawaanSmara.pilarKonten.length === 5 && JSON.stringify(bawaanSmara.pilarKonten) === JSON.stringify(PILAR_KONTEN_BAWAAN), "SMARA tanpa baris: bawaan 6 jenis dan 5 pilar");
    const pilihanSmm = await pilihanPenanggungJawab(db, "konten.ubah");
    pastikan(pilihanSmm.some((p) => p.id === sosmed.id) && pilihanSmm.some((p) => p.id === owner.id) && !pilihanSmm.some((p) => p.id === superadmin.id) && !pilihanSmm.some((p) => p.id === kasir.id) && !pilihanSmm.some((p) => p.id === iklan.id), "pilihanPenanggungJawab konten.ubah: SOSMED dan PEMILIK, tanpa SUPERADMIN, KASIR, IKLAN");
    const pilihanDesainer = await pilihanPenanggungJawab(db, "tugas-desain.ubah");
    pastikan(pilihanDesainer.some((p) => p.id === desainer.id) && !pilihanDesainer.some((p) => p.id === iklan.id), "pilihanPenanggungJawab tugas-desain.ubah: DESAINER ya, IKLAN tidak");

    console.log("=== K20. Arsip ===");
    await sebagai(IKL, () => harusDitolak("IKLAN arsip", () => arsipkanKonten(k4.id), "tidak punya hak"));
    await sebagai(SOS, () => jalankan("SOSMED arsip K4", () => arsipkanKonten(k4.id)));
    const k20 = await db.konten.findUniqueOrThrow({ where: { id: k4.id } });
    pastikan(!!k20.diarsipkanPada && k20.diarsipkanOlehNama === sosmed.nama && (await jumlahLog("konten", "ARSIP", k4.id)) === 1, "diarsipkanPada terisi, log ARSIP");
    pastikan((await detailKonten(db, k4.id, ownerSesi)) === null && !(await kontenDaftar(db, {}, param, null)).baris.some((b) => b.id === k4.id), "detailKonten null, tidak muncul di daftar");
    pastikan(!(await kontenKalender(db, { bulan: "2026-12" }, "utama")).sel.some((s) => s.konten.some((k) => k.id === k4.id)) && !(await cariPemasaran(db, AWALAN, ownerSesi, null)).konten?.some((k) => k.id === k4.id), "konten arsip tidak di kalender dan pencarian");
    const tugasSesudahArsip = await db.tugasDesain.findUniqueOrThrow({ where: { id: tugas.id } });
    pastikan(tugasSesudahArsip.kontenId === k4.id && !tugasSesudahArsip.diarsipkanPada, "tugas tertaut tetap ada dengan kontenId sama");
    await sebagai(SOS, () => harusDitolak("ajukan konten arsip", () => ajukanKonten(k4.id, formulir({})), "Konten tidak ditemukan"));
    await sebagai(SOS, () => harusDitolak("arsip kedua", () => arsipkanKonten(k4.id), "Konten tidak ditemukan"));
    await sebagai(IKL, () => harusDitolak("kirim konten arsip ke desain", () => kirimKeDesain(k4.id, formulir({})), "Konten tidak ditemukan"));

    console.log("=== K21. Hapus pengguna aman ===");
    const JUDUL_K21 = `${AWALAN} Konten desainer dua`;
    await sebagai(SOS, () => jalankan("konten dengan desainer2", () => buatKonten(formulir({ perusahaanId: "utama", judul: JUDUL_K21, desainerId: desainer2.id }))));
    const k21 = await kontenBernama(JUDUL_K21);
    pastikan(k21.desainerId === desainer2.id, "desainer2 terpasang");
    await db.pengguna.delete({ where: { id: desainer2.id } });
    pastikan((await db.konten.findUniqueOrThrow({ where: { id: k21.id } })).desainerId === null, "hapus pengguna: desainerId konten menjadi null tanpa galat FK");

    console.log("=== K22. Tanpa efek akuntansi ===");
    pastikan((await db.jurnal.count()) === jumlahJurnalAwal, "tidak ada jurnal yang dibuat modul Pemasaran");
    const sinkronAkhir = await periksaSinkron(db);
    pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron seimbang dan sama dengan awal");
    pastikan((await db.hakAksesPeran.count()) === hakAwal, "tidak ada baris HakAksesPeran baru");
  } finally {
    console.log("=== Bersih-bersih ===");
    await bersihkan(mulaiUji);
    await db.pengaturanPemasaran.deleteMany({ where: { perusahaanId: { in: PERUSAHAAN_PENGATURAN } } });
    for (const p of salinanPengaturan) await db.pengaturanPemasaran.create({ data: { perusahaanId: p.perusahaanId, jenisKonten: p.jenisKonten, pilarKonten: p.pilarKonten, diubahOlehNama: p.diubahOlehNama } });
  }
  pastikan((await db.konten.count({ where: { judul: { startsWith: AWALAN } } })) === 0 && (await db.pengguna.count({ where: { namaPengguna: { startsWith: "uji-d6-" } } })) === 0, "data uji D6 bersih");
  console.log("\nSEMUA UJI KONTEN LULUS");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
