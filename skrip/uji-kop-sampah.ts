import "dotenv/config";
// Skrip ini memanggil aksi server dan route handler di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { db } from "../src/lib/db";
import { punyaHak, type PenggunaSesi } from "../src/lib/hakAkses";
import { penggunaSaatIni } from "../src/lib/otentikasi";
import { ambilBerkasTerlihat, daftarBerkasTerlihat } from "../src/lib/berkas";
import { buatKopSurat, hapusAsetKop } from "../src/lib/aksi/kopSurat";
import { POST as unggahPost } from "../src/app/api/cetak/kop/[kopId]/aset/route";
import { formulir, jalankan, pastikan } from "./bantuan";

/*
 * Uji berkas kop di Sampah (sisa P31 dan P33): slot gambar kop dicatat di Berkas.slotKop saat diunggah, sehingga
 * berkas yang sudah dilepas dari slotnya tetap bisa dinilai.
 *  1. Positif: pemegang pengaturan.tulis tanpa tanda-tangan-cetak.buat (KASIR sementara) melihat logo lama di Sampah
 *     (diganti dan dihapus) lewat ambilBerkasTerlihat dan daftar Sampah; PEMILIK melihat semuanya.
 *  2. Negatif: tanda tangan dan stempel di Sampah (diganti maupun dihapus) tetap tertutup bagi KASIR itu; berkas kop
 *     dengan slot tidak diketahui (null) tertutup; PEMILIK tetap melihatnya.
 *  3. Migrasi: pernyataan pemulihan di 20261115090000_berkas_slot_kop mengembalikan slot dari log kop dan dari
 *     pemasangan saat ini, lalu hasilnya sama dengan aturan di atas.
 * Data uji berawalan KSM; berkas dan kop uji dibuang permanen, log uji dibuang, baris HakAksesPeran KASIR dipulihkan.
 */

const K = "KSM";

/** PNG RGBA 8-bit buatan sendiri (pola uji-rute-cetak). */
function png(lebar: number, tinggi: number): Uint8Array {
  const tabel = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = tabel[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const potong = (jenis: string, isi: Buffer) => {
    const k = Buffer.alloc(8);
    k.writeUInt32BE(isi.length, 0);
    k.write(jenis, 4, "ascii");
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([k.subarray(4), isi])), 0);
    return Buffer.concat([k, isi, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lebar, 0);
  ihdr.writeUInt32BE(tinggi, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const piksel = Buffer.alloc(tinggi * (1 + lebar * 4), 0x80);
  for (let r = 0; r < tinggi; r++) piksel[r * (1 + lebar * 4)] = 0;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), potong("IHDR", ihdr), potong("IDAT", deflateSync(piksel)), potong("IEND", Buffer.alloc(0))]));
}

/** POST unggah aset kop (badan multipart diserialisasi dulu supaya Content-Length terisi). */
async function unggahAsetKop(kopId: string, jenis: string, isi: Uint8Array) {
  const fd = new FormData();
  fd.set("jenis", jenis);
  fd.set("gambar", new File([Buffer.from(isi)], "gambar.png", { type: "image/png" }));
  const r = new Response(fd);
  const badan = new Uint8Array(await r.arrayBuffer());
  const req = new Request(`http://localhost/api/cetak/kop/${kopId}/aset`, {
    method: "POST",
    body: badan,
    headers: { "content-type": r.headers.get("content-type") ?? "", "content-length": String(badan.byteLength), origin: "http://localhost", host: "localhost" },
  });
  const jawab = await unggahPost(req, { params: Promise.resolve({ kopId }) });
  return { status: jawab.status, isi: (await jawab.json()) as { ok: boolean; galat?: string } };
}

async function sebagaiPeran<T>(peran: string, fn: () => Promise<T>): Promise<T> {
  const lama = process.env.UJI_PERAN;
  process.env.UJI_PERAN = peran;
  try {
    return await fn();
  } finally {
    if (lama === undefined) delete process.env.UJI_PERAN;
    else process.env.UJI_PERAN = lama;
  }
}

async function bersihkan() {
  const kop = (await db.kopSurat.findMany({ where: { nama: { startsWith: K } }, select: { id: true } })).map((k) => k.id);
  await db.berkas.deleteMany({ where: { jenisEntitas: "kop-surat", entitasId: { in: kop } } });
  await db.kopSurat.deleteMany({ where: { id: { in: kop } } });
}

/** Pernyataan UPDATE dari migrasi (tanpa ALTER TABLE), dipisah di titik koma akhir pernyataan. */
function pernyataanPemulihan(): string[] {
  const sql = readFileSync(join(process.cwd(), "prisma/migrations/20261115090000_berkas_slot_kop/migration.sql"), "utf8");
  const tanpaKomentar = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  return tanpaKomentar.split(";").map((s) => s.trim()).filter((s) => s.startsWith("UPDATE"));
}

async function main() {
  await bersihkan();
  const mulaiUji = new Date();
  const idLogAwal = new Set((await db.logAktivitas.findMany({ select: { id: true } })).map((l) => l.id));
  const berkasAwal = await db.berkas.count();
  const hakAwal = await db.hakAksesPeran.count();
  const kunciKasir = { peran_hak: { peran: "KASIR" as const, hak: "pengaturan.tulis" } };
  const hakKasirLama = await db.hakAksesPeran.findUnique({ where: kunciKasir });
  await db.hakAksesPeran.upsert({ where: kunciKasir, create: { peran: "KASIR", hak: "pengaturan.tulis", boleh: true }, update: { boleh: true } });

  try {
    const pemilik = (await penggunaSaatIni())!;
    const kasir = (await sebagaiPeran("KASIR", () => penggunaSaatIni()))!;
    pastikan(punyaHak(kasir, "pengaturan.tulis") && !punyaHak(kasir, "tanda-tangan-cetak.buat"), "KASIR sementara memegang pengaturan.tulis tanpa tanda-tangan-cetak.buat");

    await jalankan("kop uji", () => buatKopSurat(formulir({ perusahaanId: "utama", nama: `${K} Kop`, preset: "DPRO" })));
    const kop = await db.kopSurat.findFirstOrThrow({ where: { nama: `${K} Kop`, dihapusPada: null } });
    const berkasSlot = async (jenis: string) => (await db.asetKopSurat.findUniqueOrThrow({ where: { kopSuratId_jenis: { kopSuratId: kop.id, jenis: jenis as "LOGO" } } })).berkasId;
    const unggahOk = async (peran: string, jenis: string, lebar: number) => {
      const r = await sebagaiPeran(peran, () => unggahAsetKop(kop.id, jenis, png(lebar, 16)));
      pastikan(r.status === 200, `${peran} unggah ${jenis} ${lebar}px (${r.status} ${r.isi.galat ?? ""})`);
      return berkasSlot(jenis);
    };

    console.log("=== 0. Slot tercatat saat unggah ===");
    const ttd1 = await unggahOk("PEMILIK", "TANDA_TANGAN", 20);
    const ttd2 = await unggahOk("PEMILIK", "TANDA_TANGAN", 24);
    const stempel = await unggahOk("PEMILIK", "STEMPEL", 20);
    const logo1 = await unggahOk("KASIR", "LOGO", 20);
    const logo2 = await unggahOk("KASIR", "LOGO", 24);
    const kopAsli = await unggahOk("KASIR", "KOP", 20);
    const slot = async (id: string) => (await db.berkas.findUniqueOrThrow({ where: { id }, select: { slotKop: true } })).slotKop;
    pastikan((await slot(ttd1)) === "TANDA_TANGAN" && (await slot(ttd2)) === "TANDA_TANGAN" && (await slot(stempel)) === "STEMPEL", "slotKop tanda tangan dan stempel tercatat");
    pastikan((await slot(logo1)) === "LOGO" && (await slot(logo2)) === "LOGO" && (await slot(kopAsli)) === "KOP", "slotKop logo dan kop tercatat");
    await jalankan("PEMILIK hapus stempel", () => sebagaiPeran("PEMILIK", () => hapusAsetKop(kop.id, "STEMPEL")));
    await jalankan("KASIR hapus logo", () => sebagaiPeran("KASIR", () => hapusAsetKop(kop.id, "LOGO")));
    const dihapus = async (id: string) => (await db.berkas.findUniqueOrThrow({ where: { id }, select: { dihapusPada: true } })).dihapusPada !== null;
    pastikan((await dihapus(ttd1)) && (await dihapus(stempel)) && (await dihapus(logo1)) && (await dihapus(logo2)) && !(await dihapus(ttd2)) && !(await dihapus(kopAsli)), "ganti dan hapus melepas berkas lama ke Sampah");
    pastikan((await slot(logo2)) === "LOGO" && (await slot(stempel)) === "STEMPEL", "slotKop tetap sesudah berkas dilepas");

    const lihatSampah = async (p: PenggunaSesi, id: string) => (await ambilBerkasTerlihat(db, p, id, { sampah: true })) !== null;
    const diDaftarSampah = async (p: PenggunaSesi, id: string) => (await daftarBerkasTerlihat(db, p, { id, sampah: true })).total === 1;

    console.log("=== 1. Positif: logo di Sampah terbuka bagi pemegang pengaturan.tulis ===");
    pastikan((await lihatSampah(kasir, logo1)) && (await lihatSampah(kasir, logo2)), "KASIR: logo lama (diganti) dan logo dihapus terlihat di Sampah");
    pastikan((await diDaftarSampah(kasir, logo1)) && (await diDaftarSampah(kasir, logo2)), "KASIR: daftar Sampah memuat kedua logo");
    pastikan((await ambilBerkasTerlihat(db, kasir, kopAsli)) !== null, "KASIR: gambar kop yang terpasang tetap terlihat");

    console.log("=== 2. Negatif: tanda tangan dan stempel tetap tertutup ===");
    pastikan(!(await lihatSampah(kasir, ttd1)) && !(await lihatSampah(kasir, stempel)), "KASIR: tanda tangan lama dan stempel dihapus tertutup di Sampah");
    pastikan(!(await diDaftarSampah(kasir, ttd1)) && !(await diDaftarSampah(kasir, stempel)), "KASIR: daftar Sampah tanpa tanda tangan dan stempel");
    pastikan((await ambilBerkasTerlihat(db, kasir, ttd2)) === null, "KASIR: tanda tangan yang terpasang tetap tertutup");
    pastikan((await lihatSampah(pemilik, ttd1)) && (await lihatSampah(pemilik, stempel)) && (await lihatSampah(pemilik, logo1)) && (await diDaftarSampah(pemilik, ttd1)), "PEMILIK melihat semua berkas kop di Sampah");
    await db.berkas.update({ where: { id: logo1 }, data: { slotKop: null } });
    pastikan(!(await lihatSampah(kasir, logo1)) && !(await diDaftarSampah(kasir, logo1)) && (await lihatSampah(pemilik, logo1)), "slot tidak diketahui (null): tertutup bagi KASIR, terbuka bagi PEMILIK");

    console.log("=== 3. Pemulihan slot dari log dan pemasangan ===");
    await db.berkas.updateMany({ where: { id: { in: [ttd1, ttd2, stempel, logo1, logo2, kopAsli] } }, data: { slotKop: null } });
    for (const s of pernyataanPemulihan()) await db.$executeRawUnsafe(s);
    pastikan((await slot(ttd1)) === "TANDA_TANGAN" && (await slot(ttd2)) === "TANDA_TANGAN" && (await slot(stempel)) === "STEMPEL", "pemulihan: slot tanda tangan dan stempel kembali");
    pastikan((await slot(logo1)) === "LOGO" && (await slot(logo2)) === "LOGO" && (await slot(kopAsli)) === "KOP", "pemulihan: slot logo dan kop kembali");
    pastikan((await lihatSampah(kasir, logo1)) && (await lihatSampah(kasir, logo2)) && !(await lihatSampah(kasir, ttd1)) && !(await lihatSampah(kasir, stempel)), "sesudah pemulihan: logo terbuka, tanda tangan dan stempel tertutup bagi KASIR");
  } finally {
    if (hakKasirLama) await db.hakAksesPeran.update({ where: kunciKasir, data: { boleh: hakKasirLama.boleh } });
    else await db.hakAksesPeran.deleteMany({ where: { peran: "KASIR", hak: "pengaturan.tulis" } });
    await bersihkan();
    const logBaru = (await db.logAktivitas.findMany({ where: { waktu: { gte: mulaiUji } }, select: { id: true } })).map((l) => l.id).filter((id) => !idLogAwal.has(id));
    await db.logAktivitas.deleteMany({ where: { id: { in: logBaru } } });
  }

  console.log("=== 4. Bersih-bersih ===");
  pastikan((await db.berkas.count()) === berkasAwal, "berkas uji dihapus permanen");
  pastikan((await db.hakAksesPeran.count()) === hakAwal, "HakAksesPeran sama dengan awal");
  console.log("=== DONE, all kop-sampah checks passed ===");
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
