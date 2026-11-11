import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import type { Prisma } from "../src/prisma-klien/client";
import { periksaSinkron } from "../src/lib/sinkron";
import { hashKataSandi } from "../src/lib/kataSandi";
import { alokasiNomorCetak, isiPola, periodeReset } from "../src/lib/nomorCetak";
import { buatPenawaran, buatPesanan, buatFaktur, buatPenerimaan, buatUangMuka } from "../src/lib/aksi/penjualan";
import { simpanFormatNomor, hapusFormatNomor } from "../src/lib/aksi/dokumenPenjualan";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { ajukanDokumen, setujuiDokumen } from "../src/lib/aksi/persetujuan";
import { aturPersetujuan, formulir, harusDitolak, jalankan, pastikan, sebagai } from "./bantuan";

/*
 * P25: nomor cetak dokumen penjualan (D2 §9.2 uji-nomor-cetak): tanpa format, simpan format dan validasinya, nomor
 * terakhir, deret bersama penawaran dan faktur, faktur lewat persetujuan, nomor manual dan lompat bentrok, alokasi
 * serentak, reset bulanan dan tidak pernah, format nonaktif, kuitansi, per perusahaan, pencarian nomor cetak, dan
 * pembersihan FormatNomor serta PenghitungNomor uji. Perbaikan tinjauan P25 R2: simpan format memakai kunci penasihat
 * per (perusahaan, kunci deret), jadi tidak menunggu sisipan dokumen perusahaan (FOR KEY SHARE) dan dua simpan serentak
 * berkunci deret sama tetap berurutan.
 */

const K = "UJINC";
const DERET = "surat-uji";
const JENIS_UJI = ["penawaran", "faktur", "kwitansi", "kwitansi-dp"] as const;
const PENGAJU = "uji-nc-pengaju";
const PEMERIKSA = "uji-nc-pemeriksa";

async function denganEnv<T>(isian: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const lama: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(isian)) {
    lama[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(lama)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
const sebagaiPeran = <T>(peran: string, fn: () => Promise<T>) => denganEnv({ UJI_PERAN: peran, UJI_PENGGUNA: undefined }, fn);

/** Menjalankan `selagi` sementara transaksi lain memegang kunci dari `pegang`; transaksi itu commit sesudahnya. */
async function selagiTerkunci<T>(pegang: (tx: Prisma.TransactionClient) => Promise<unknown>, selagi: (pid: number) => Promise<T>): Promise<T> {
  let lepas!: () => void;
  let siap!: (pid: number) => void;
  const tahan = new Promise<void>((r) => (lepas = r));
  const terkunci = new Promise<number>((r) => (siap = r));
  const penahan = db.$transaction(
    async (tx) => {
      await pegang(tx);
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS "pid"`;
      siap(pid);
      await tahan;
    },
    { timeout: 60_000 },
  );
  const pid = await Promise.race([terkunci, penahan.then(() => -1)]);
  try {
    return await selagi(pid);
  } finally {
    lepas();
    await penahan;
  }
}

/** Menunggu sampai n sesi terhalang penahan, langsung atau berantai. */
async function tungguAntre(pidPenahan: number, n: number) {
  for (let t = 0; t < 400; t++) {
    const [{ antre }] = await db.$queryRaw<{ antre: number }[]>`
      WITH RECURSIVE rantai(pid) AS (
        SELECT a.pid FROM pg_stat_activity a WHERE ${pidPenahan}::int = ANY(pg_blocking_pids(a.pid))
        UNION
        SELECT a.pid FROM pg_stat_activity a JOIN rantai r ON r.pid = ANY(pg_blocking_pids(a.pid))
      )
      SELECT count(*)::int AS "antre" FROM rantai`;
    if (antre >= n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`antrean kunci tidak mencapai ${n}`);
}

/** revalidatePath di luar HTTP gagal sesudah transaksi selesai, jadi dianggap sukses (pola uji-baris-ganda). */
const hasilAksi = (k: Promise<unknown>) =>
  k.then(
    () => "ok",
    (e: unknown) => {
      const pesan = String((e as Error)?.message ?? e);
      return pesan.includes("static generation store missing") ? "ok" : pesan;
    },
  );

async function bersihkan() {
  const pel = await db.pelanggan.findMany({ where: { kode: { startsWith: `PLG-${K}` } }, select: { id: true } });
  const pelIds = pel.map((p) => p.id);
  if (pelIds.length) {
    aturPersetujuan(false);
    for (const t of await db.penerimaanPenjualan.findMany({ where: { pelangganId: { in: pelIds } }, select: { id: true } })) await jalankan("bersih penerimaan", () => hapusDokumen("penerimaan", t.id));
    for (const f of await db.fakturPenjualan.findMany({ where: { pelangganId: { in: pelIds } }, orderBy: { tanggal: "desc" }, select: { id: true } })) await jalankan("bersih faktur", () => hapusDokumen("faktur", f.id));
    for (const u of await db.uangMukaPelanggan.findMany({ where: { pelangganId: { in: pelIds } }, select: { id: true } })) await jalankan("bersih uang muka", () => hapusDokumen("uangMuka", u.id));
    for (const p of await db.pesananPenjualan.findMany({ where: { pelangganId: { in: pelIds } }, select: { id: true } })) await jalankan("bersih pesanan", () => hapusDokumen("pesanan", p.id));
    for (const p of await db.penawaranPenjualan.findMany({ where: { pelangganId: { in: pelIds } }, select: { id: true } })) await jalankan("bersih penawaran", () => hapusDokumen("penawaran", p.id));
  }
  await db.penghitungNomor.deleteMany({ where: { kunciDeret: { startsWith: DERET } } });
  await db.formatNomor.deleteMany({ where: { kunciDeret: { startsWith: DERET } } });
  const pt = await db.perusahaan.findUnique({ where: { kode: `${K}D2` }, select: { id: true } });
  if (pt) {
    await db.penghitungNomor.deleteMany({ where: { perusahaanId: pt.id } });
    await db.formatNomor.deleteMany({ where: { perusahaanId: pt.id } });
    await db.pengaturanDokumenPenjualan.deleteMany({ where: { perusahaanId: pt.id } });
    await db.perusahaan.delete({ where: { id: pt.id } });
  }
  await db.barang.deleteMany({ where: { kode: { startsWith: `JS-${K}` } } });
  await db.pelanggan.deleteMany({ where: { kode: { startsWith: `PLG-${K}` } } });
  await db.akun.deleteMany({ where: { kode: { startsWith: `UJI-${K}` } } });
  const pengguna = (await db.pengguna.findMany({ where: { namaPengguna: { in: [PENGAJU, PEMERIKSA] } }, select: { id: true } })).map((x) => x.id);
  await db.notifikasi.deleteMany({ where: { OR: [{ judul: { contains: K } }, { isi: { contains: K } }, { penggunaId: { in: pengguna } }] } });
  await db.logAktivitas.deleteMany({ where: { penggunaId: { in: pengguna } } });
  await db.pengguna.deleteMany({ where: { id: { in: pengguna } } });
}

async function main() {
  await bersihkan();
  aturPersetujuan(false);
  const mulaiUji = new Date();
  const sinkronAwal = await periksaSinkron(db);
  const jurnalAwal = await db.jurnal.count();
  // format milik pengguna untuk utama disimpan lalu dipulihkan persis
  const formatAwal = await db.formatNomor.findMany({ where: { perusahaanId: "utama", jenis: { in: [...JENIS_UJI] } } });
  const penghitungAwal = await db.penghitungNomor.findMany({ where: { perusahaanId: "utama" } });
  try {
    await db.formatNomor.deleteMany({ where: { perusahaanId: "utama", jenis: { in: [...JENIS_UJI] } } });
    await uji(mulaiUji);
  } finally {
    aturPersetujuan(false);
    await bersihkan();
    await db.formatNomor.deleteMany({ where: { perusahaanId: "utama", jenis: { in: [...JENIS_UJI] } } });
    for (const f of formatAwal) await db.formatNomor.create({ data: f });
    for (const h of penghitungAwal) await db.penghitungNomor.upsert({ where: { perusahaanId_kunciDeret_periode: { perusahaanId: h.perusahaanId, kunciDeret: h.kunciDeret, periode: h.periode } }, create: h, update: { nilai: h.nilai } });
    await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji }, OR: [{ penggunaNama: "Skrip Uji" }, { nomor: { contains: K } }] } });
  }
  pastikan((await db.formatNomor.count({ where: { kunciDeret: { startsWith: DERET } } })) === 0 && (await db.penghitungNomor.count({ where: { kunciDeret: { startsWith: DERET } } })) === 0, "FormatNomor dan PenghitungNomor uji terhapus");
  pastikan((await db.formatNomor.count({ where: { perusahaanId: "utama", jenis: { in: [...JENIS_UJI] } } })) === formatAwal.length, "format nomor utama milik pengguna dipulihkan");
  pastikan((await db.jurnal.count()) === jurnalAwal, "jumlah jurnal sama dengan sebelum uji");
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron seimbang dan sama dengan sebelum uji");
  console.log("=== DONE, all nomor-cetak checks passed ===");
}

async function uji(mulaiUji: Date) {
  const sekarang = new Date();
  const pola = (p: string, nilai: number, kode = "DPRO") => isiPola(p, { nilai, tanggal: sekarang, prefiks: "", kode, digit: 4 });
  const POLA_P = "{SEQ3}/{KODE}/P1/{ROMAN}/{YYYY}";
  const POLA_F = "{SEQ3}/{KODE}-INV2/{ROMAN}/{YYYY}";
  const penghitung = async (kunciDeret = DERET, perusahaanId = "utama") =>
    (await db.penghitungNomor.findUnique({ where: { perusahaanId_kunciDeret_periode: { perusahaanId, kunciDeret, periode: periodeReset("TAHUNAN", sekarang) } } }))?.nilai ?? 0;

  console.log("=== Data uji ===");
  const pelanggan = await db.pelanggan.create({ data: { kode: `PLG-${K}`, nama: "Klien Uji Nomor Cetak" } });
  const jasa = await db.barang.create({ data: { kode: `JS-${K}`, nama: "Jasa Uji Nomor Cetak", jenis: "JASA", satuan: "paket", hargaBeli: 0, hargaJual: 100_000, perusahaanId: null } });
  const kas = await db.akun.create({ data: { kode: `UJI-${K}-KAS`, nama: "Kas Uji Nomor Cetak", jenis: "ASET", kasBank: true } });
  await db.pengguna.create({ data: { namaPengguna: PENGAJU, nama: "Pengaju Uji Nomor", peran: "KASIR", kataSandiHash: await hashKataSandi("uji-nc-pengaju-123") } });
  await db.pengguna.create({ data: { namaPengguna: PEMERIKSA, nama: "Pemeriksa Uji Nomor", peran: "ADMIN", kataSandiHash: await hashKataSandi("uji-nc-pemeriksa-123") } });
  const pnw = (isian: Record<string, unknown> = {}) => buatPenawaran(formulir({ pelangganId: pelanggan.id, ppnPersen: 0, baris: [{ barangId: jasa.id, jumlah: 1, harga: 100_000 }], ...isian }));
  const penawaranTerakhir = () => db.penawaranPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id }, orderBy: [{ tanggal: "desc" }, { nomor: "desc" }] });
  const fmt = (isian: Record<string, unknown>) => simpanFormatNomor(formulir({ perusahaanId: "utama", kunciDeret: DERET, reset: "TAHUNAN", ...isian }));

  console.log("=== 1. Tanpa format ===");
  await jalankan("PNW tanpa format", () => pnw());
  const p1 = await penawaranTerakhir();
  pastikan(p1.nomorCetak === null && /^PNW-\d{4}-\d{4}$/.test(p1.nomor), `nomor cetak null, nomor internal ${p1.nomor}`);

  console.log("=== 2. Simpan format nomor dan validasinya ===");
  await sebagaiPeran("ADMIN", () => harusDitolak("ADMIN menyimpan format", () => fmt({ jenis: "penawaran", pola: POLA_P }), "tidak punya hak"));
  await jalankan("PEMILIK format penawaran", () => fmt({ jenis: "penawaran", pola: POLA_P }));
  await jalankan("PEMILIK format faktur (deret bersama)", () => fmt({ jenis: "faktur", pola: POLA_F }));
  const f1 = await db.formatNomor.findUniqueOrThrow({ where: { perusahaanId_jenis: { perusahaanId: "utama", jenis: "penawaran" } } });
  pastikan(f1.kunciDeret === DERET && f1.aktif && f1.reset === "TAHUNAN" && f1.pola === POLA_P, "format penawaran tersimpan aktif, deret surat-uji, reset tahunan");
  pastikan((await db.logAktivitas.count({ where: { aksi: "UBAH", jenis: "Format Nomor Cetak", modul: "penjualan", nomor: "DPRO/penawaran", waktu: { gte: mulaiUji } } })) === 1, "log UBAH Format Nomor Cetak bermodul penjualan");
  await harusDitolak("pola tanpa {SEQ}", () => fmt({ jenis: "penawaran", pola: "{KODE}/{YYYY}" }), "memuat {SEQ}");
  await harusDitolak("pola 61 karakter", () => fmt({ jenis: "penawaran", pola: `{SEQ}/{YYYY}${"x".repeat(50)}` }), "3-60 karakter");
  await harusDitolak("token tidak dikenal", () => fmt({ jenis: "penawaran", pola: "{SEQ}/{XX}/{YYYY}" }), "Token {XX} tidak dikenal");
  await harusDitolak("tahunan tanpa tahun", () => fmt({ jenis: "penawaran", pola: "{SEQ}/{KODE}" }), "reset tahunan wajib memuat");
  await harusDitolak("bulanan tanpa bulan", () => fmt({ jenis: "kwitansi", kunciDeret: `${DERET}-kw`, reset: "BULANAN", pola: "{SEQ}/{YYYY}" }), "reset bulanan wajib memuat");
  await harusDitolak("prefiks IN/V", () => fmt({ jenis: "penawaran", pola: POLA_P, prefiks: "IN/V" }), "Prefiks hanya huruf/angka");
  await harusDitolak("digit 9", () => fmt({ jenis: "penawaran", pola: POLA_P, digit: 9 }), "Digit urut harus bilangan bulat 3-8");
  await harusDitolak("jenis tidak dikenal", () => fmt({ jenis: "surat", pola: POLA_P }), "Jenis nomor cetak tidak dikenal");
  await harusDitolak("deret sama dengan reset berbeda (KONTRAK P28)", () => fmt({ jenis: "faktur", reset: "BULANAN", pola: "{SEQ3}/{MM}/{YYYY}" }), "wajib memakai reset yang sama");
  await harusDitolak("perusahaan tidak ada", () => simpanFormatNomor(formulir({ perusahaanId: "tidak-ada", jenis: "penawaran", pola: POLA_P })), "Perusahaan tidak ditemukan");

  console.log("=== 2b. Kunci simpan format (tinjauan P25 R2) ===");
  // sisipan dokumen perusahaan yang sedang berjalan memegang FOR KEY SHARE pada Perusahaan; simpan format tidak menunggunya
  const hasilKeyShare = await selagiTerkunci(
    (tx) => tx.$queryRaw`SELECT 1 FROM "Perusahaan" WHERE "id" = 'utama' FOR KEY SHARE`,
    () => Promise.race([hasilAksi(fmt({ jenis: "penawaran", pola: POLA_P })), new Promise<string>((r) => setTimeout(() => r("menunggu"), 5000))]),
  );
  pastikan(hasilKeyShare === "ok", `simpan format selesai selagi Perusahaan dipegang FOR KEY SHARE (${hasilKeyShare})`);
  // dua simpan serentak berkunci deret sama dengan reset berbeda: berurutan, jadi yang kedua ditolak aturan deret bersama
  const deretR2 = `${DERET}-r2`;
  const [hBulanan, hTahunan] = await selagiTerkunci(
    (tx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('format-nomor'), hashtext(${"utama/" + deretR2}))`,
    async (pid) => {
      const a = hasilAksi(fmt({ jenis: "kwitansi", kunciDeret: deretR2, reset: "BULANAN", pola: "KW-{YY}{MM}-{SEQ2}" }));
      await tungguAntre(pid, 1);
      const b = hasilAksi(fmt({ jenis: "kwitansi-dp", kunciDeret: deretR2, reset: "TAHUNAN", pola: "KDP-{YYYY}-{SEQ}" }));
      await tungguAntre(pid, 2);
      return [a, b];
    },
  ).then((x) => Promise.all(x));
  pastikan(hBulanan === "ok" && hTahunan.includes("wajib memakai reset yang sama"), `simpan serentak berkunci deret sama berurutan: yang kedua ditolak (${hBulanan} | ${hTahunan})`);
  pastikan((await db.formatNomor.count({ where: { perusahaanId: "utama", kunciDeret: deretR2 } })) === 1, "hanya satu format berderet sama tersimpan");
  await db.formatNomor.deleteMany({ where: { perusahaanId: "utama", kunciDeret: deretR2 } });

  console.log("=== 3. Nomor terakhir ===");
  await jalankan("nomor terakhir 70", () => fmt({ jenis: "penawaran", pola: POLA_P, nomorTerakhir: 70 }));
  await jalankan("PNW sesudah nomor terakhir 70", () => pnw());
  const p2 = await penawaranTerakhir();
  pastikan(p2.nomorCetak === pola(POLA_P, 71), `penawaran berikut ${pola(POLA_P, 71)} (${p2.nomorCetak})`);
  await harusDitolak("nomor terakhir 10 sesudahnya", () => fmt({ jenis: "penawaran", pola: POLA_P, nomorTerakhir: 10 }), "tidak boleh lebih kecil dari penghitung sekarang (71)");
  await harusDitolak("nomor terakhir bukan bilangan bulat", () => fmt({ jenis: "penawaran", pola: POLA_P, nomorTerakhir: "7,5" }), "bilangan bulat");

  console.log("=== 4. Faktur: deret bersama, persetujuan, draf dihapus ===");
  await jalankan("PSJ jasa 10", () => buatPesanan(formulir({ pelangganId: pelanggan.id, ppnPersen: 0, baris: [{ barangId: jasa.id, jumlah: 10, harga: 100_000 }] })));
  const psj = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id } });
  const fj = (jumlah: number) => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, baris: [{ barangId: jasa.id, jumlah, harga: 100_000 }] }));
  await jalankan("FJ1 persetujuan mati", () => fj(1));
  const fakturTerakhir = () => db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj.id }, orderBy: { nomor: "desc" } });
  const fj1 = await fakturTerakhir();
  pastikan(fj1.nomorCetak === pola(POLA_F, 72), `faktur memakai deret bersama: ${pola(POLA_F, 72)} (${fj1.nomorCetak})`);
  aturPersetujuan(true);
  await sebagai(PENGAJU, () => jalankan("FJ2 draf persetujuan", () => fj(1)));
  const fj2 = await fakturTerakhir();
  await sebagai(PENGAJU, () => jalankan("FJ3 draf yang nanti dihapus", () => fj(1)));
  const fj3 = await fakturTerakhir();
  pastikan(fj2.nomorCetak === null && fj3.nomorCetak === null && fj2.statusPersetujuan === "DRAFT", "faktur draf belum bernomor cetak");
  await jalankan("hapus FJ3 draf", () => hapusDokumen("faktur", fj3.id));
  await sebagai(PENGAJU, () => jalankan("ajukan FJ2", () => ajukanDokumen("faktur", fj2.id)));
  await sebagai(PEMERIKSA, () => jalankan("setujui FJ2", () => setujuiDokumen("faktur", fj2.id)));
  aturPersetujuan(false);
  // notifikasi persetujuan faktur uji dibuang supaya suite lain tidak terpengaruh
  await db.notifikasi.deleteMany({ where: { OR: [{ judul: { contains: fj2.nomor } }, { judul: { contains: fj3.nomor } }] } });
  pastikan((await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fj2.id } })).nomorCetak === pola(POLA_F, 73), `faktur disetujui mendapat ${pola(POLA_F, 73)}; draf yang dihapus tidak memakan nomor`);

  console.log("=== 5. Nomor manual dan lompat bentrok ===");
  await jalankan("PNW manual 064/DPRO/P1/VIII/2026", () => pnw({ nomorCetak: "064/DPRO/P1/VIII/2026" }));
  pastikan((await penawaranTerakhir()).nomorCetak === "064/DPRO/P1/VIII/2026" && (await penghitung()) === 73, "nomor manual tersimpan, penghitung tetap 73");
  await harusDitolak("nomor manual yang sama lagi", () => pnw({ nomorCetak: "064/DPRO/P1/VIII/2026" }), "sudah dipakai dokumen lain");
  await jalankan("PNW manual sama dengan nomor otomatis berikut (74)", () => pnw({ nomorCetak: pola(POLA_P, 74) }));
  await jalankan("PNW otomatis melompati nomor manual", () => pnw());
  pastikan((await penawaranTerakhir()).nomorCetak === pola(POLA_P, 75) && (await penghitung()) === 75, `alokasi melompati 74 yang bentrok: ${pola(POLA_P, 75)}, penghitung 75`);
  await db.penghitungNomor.update({ where: { perusahaanId_kunciDeret_periode: { perusahaanId: "utama", kunciDeret: DERET, periode: periodeReset("TAHUNAN", sekarang) } }, data: { nilai: 73 } });
  await jalankan("PNW otomatis sesudah penghitung dimundurkan ke 73", () => pnw());
  pastikan((await penawaranTerakhir()).nomorCetak === pola(POLA_P, 76) && (await penghitung()) === 76, `penghitung dimundurkan: 74 dan 75 terpakai, dapat ${pola(POLA_P, 76)}`);

  console.log("=== 6. Alokasi serentak ===");
  const sebelum = await penghitung();
  const hasil = await Promise.all(Array.from({ length: 5 }, () => db.$transaction((tx) => alokasiNomorCetak(tx, { perusahaanId: "utama", jenis: "penawaran", tanggal: sekarang }))));
  pastikan(new Set(hasil).size === 5 && hasil.every((h) => h !== null) && (await penghitung()) === sebelum + 5, `5 alokasi serentak memberi 5 nomor berbeda dan penghitung naik 5 (${hasil.join(", ")})`);

  console.log("=== 7. Reset bulanan, tidak pernah, nonaktif ===");
  await jalankan("format kwitansi bulanan", () => fmt({ jenis: "kwitansi", kunciDeret: `${DERET}-kw`, reset: "BULANAN", pola: "KW-{YY}{MM}-{SEQ2}" }));
  await jalankan("format kwitansi DP tidak pernah reset", () => fmt({ jenis: "kwitansi-dp", kunciDeret: `${DERET}-kdp`, reset: "TIDAK_PERNAH", pola: "KDP-{SEQ}" }));
  const kw = await db.$transaction((tx) => alokasiNomorCetak(tx, { perusahaanId: "utama", jenis: "kwitansi", tanggal: sekarang }));
  const periodeBulan = periodeReset("BULANAN", sekarang);
  pastikan(kw === isiPola("KW-{YY}{MM}-{SEQ2}", { nilai: 1, tanggal: sekarang, prefiks: "", kode: "DPRO", digit: 4 }) && (await db.penghitungNomor.count({ where: { kunciDeret: `${DERET}-kw`, periode: periodeBulan } })) === 1, `reset bulanan: periode ${periodeBulan}, nomor ${kw}`);
  const kdp = await db.$transaction((tx) => alokasiNomorCetak(tx, { perusahaanId: "utama", jenis: "kwitansi-dp", tanggal: sekarang }));
  pastikan(kdp === "KDP-0001" && (await db.penghitungNomor.count({ where: { kunciDeret: `${DERET}-kdp`, periode: "-" } })) === 1, `tidak pernah reset: periode "-", nomor ${kdp}`);

  console.log("=== 8. Kuitansi dan kuitansi DP bernomor saat dibuat ===");
  await jalankan("TRM atas FJ1", () => buatPenerimaan(formulir({ fakturId: fj1.id, akunId: kas.id, jumlah: 50_000 })));
  const trm = await db.penerimaanPenjualan.findFirstOrThrow({ where: { fakturId: fj1.id } });
  pastikan(trm.nomorCetak === isiPola("KW-{YY}{MM}-{SEQ2}", { nilai: 2, tanggal: trm.tanggal, prefiks: "", kode: "DPRO", digit: 4 }), `kuitansi bernomor saat dibuat (${trm.nomorCetak})`);
  await jalankan("UM pesanan", () => buatUangMuka(formulir({ pesananId: psj.id, akunId: kas.id, jumlah: 100_000 })));
  const um = await db.uangMukaPelanggan.findFirstOrThrow({ where: { pesananId: psj.id } });
  pastikan(um.nomorCetak === "KDP-0002", `kuitansi DP bernomor saat dibuat (${um.nomorCetak})`);
  await jalankan("format kwitansi DP dinonaktifkan", () => fmt({ jenis: "kwitansi-dp", kunciDeret: `${DERET}-kdp`, reset: "TIDAK_PERNAH", pola: "KDP-{SEQ}", aktif: "0" }));
  pastikan((await db.$transaction((tx) => alokasiNomorCetak(tx, { perusahaanId: "utama", jenis: "kwitansi-dp", tanggal: sekarang }))) === null, "format nonaktif: alokasi null");
  const fKdp = await db.formatNomor.findUniqueOrThrow({ where: { perusahaanId_jenis: { perusahaanId: "utama", jenis: "kwitansi-dp" } } });
  await jalankan("hapus format kwitansi DP", () => hapusFormatNomor(fKdp.id));
  pastikan((await db.formatNomor.count({ where: { id: fKdp.id } })) === 0 && (await db.penghitungNomor.count({ where: { kunciDeret: `${DERET}-kdp` } })) === 1, "hapus format membiarkan penghitungnya");
  await harusDitolak("hapus format yang sudah dihapus", () => hapusFormatNomor(fKdp.id), "Format nomor tidak ditemukan");
  await sebagaiPeran("ADMIN", () => harusDitolak("ADMIN menghapus format", () => hapusFormatNomor(f1.id), "tidak punya hak"));

  console.log("=== 9. Per perusahaan ===");
  const pt = await db.perusahaan.create({ data: { kode: `${K}D2`, nama: "PT Uji Nomor Cetak Dua", urutan: 96 } });
  await jalankan("format penawaran perusahaan kedua (pola sama)", () => simpanFormatNomor(formulir({ perusahaanId: pt.id, jenis: "penawaran", pola: POLA_P, kunciDeret: DERET })));
  await jalankan("PNW perusahaan kedua", () => pnw({ perusahaanId: pt.id }));
  const pPt = await db.penawaranPenjualan.findFirstOrThrow({ where: { perusahaanId: pt.id } });
  pastikan(pPt.nomorCetak === pola(POLA_P, 1, `${K}D2`), `perusahaan kedua mulai dari 001 (${pPt.nomorCetak})`);
  await jalankan("PNW perusahaan kedua dengan nomor cetak milik utama", () => pnw({ perusahaanId: pt.id, nomorCetak: p2.nomorCetak }));
  pastikan((await db.penawaranPenjualan.count({ where: { nomorCetak: p2.nomorCetak } })) === 2, "nomor cetak sama boleh di perusahaan berbeda");

  console.log("=== 10. Pencarian lewat nomor cetak ===");
  const cari = await db.penawaranPenjualan.findMany({ where: { perusahaanId: "utama", OR: [{ nomor: p2.nomorCetak! }, { nomorCetak: p2.nomorCetak! }] } });
  pastikan(cari.length === 1 && cari[0].id === p2.id, "kueri OR nomor atau nomor cetak menemukan penawaran dari nomor cetaknya");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
