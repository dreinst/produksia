import "dotenv/config";
// Skrip ini memanggil aksi server dan route handler di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { deflateSync } from "node:zlib";
import { db } from "../src/lib/db";
import { punyaHak, type Hak } from "../src/lib/hakAkses";
import { penggunaSaatIni } from "../src/lib/otentikasi";
import { ambilBerkasTerlihat, bacaUntukDikirim } from "../src/lib/berkas";
import { kampanyeLengkap } from "../src/lib/iklan";
import { buatIklan, ubahIklan } from "../src/lib/aksi/iklan";
import { buatKopSurat, hapusAsetKop } from "../src/lib/aksi/kopSurat";
import { POST as unggahPost } from "../src/app/api/cetak/kop/[kopId]/aset/route";
import { formulir, harusDitolak, jalankan, pastikan } from "./bantuan";

/*
 * Uji kreatif iklan dari gambar kop di slot tanda tangan dan stempel (sisa P43, tinjauan P41 R3). Pelaku yang memegang
 * pengaturan.tulis dan kampanye.buat tetapi tidak memegang tanda-tangan-cetak.buat tidak boleh menautkan gambar tanda
 * tangan atau stempel sebagai kreatif iklan, dan pembaca kampanye tanpa hak itu tidak boleh melihat nama atau isinya.
 *  1. Positif: logo dan gambar kop yang sedang terpasang boleh menjadi kreatif bagi pelaku tanpa hak tanda tangan;
 *     pemegang tanda-tangan-cetak.buat (PEMILIK) boleh menautkan tanda tangan.
 *  2. Negatif: tanda tangan dan stempel (terpasang, diganti, atau dihapus ke Sampah) ditolak
 *     dengan satu pesan yang sama; ubah iklan ke gambar itu juga ditolak; gambar kop yang sudah dibuang ditolak.
 *  3. Pembaca: iklan berkreatif tanda tangan yang ditautkan PEMILIK tampil "tersembunyi" tanpa nama bagi pembaca tanpa
 *     hak tanda tangan, dan unduh lewat /api/berkas menghasilkan 404.
 * Data uji berawalan UJI-IKK; kop, berkas, kampanye, dan log uji dibuang; baris HakAksesPeran KASIR dipulihkan.
 */

const K = "UJI-IKK";
const PESAN = "Berkas kreatif tidak ditemukan";

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

const HAK_TAMBAHAN: Hak[] = ["pengaturan.tulis", "kampanye.buat", "kampanye.ubah", "kampanye.lihat"];

async function bersihkan() {
  const kampanye = (await db.kampanye.findMany({ where: { nama: { startsWith: K } }, select: { id: true } })).map((k) => k.id);
  const set = (await db.setIklan.findMany({ where: { kampanyeId: { in: kampanye } }, select: { id: true } })).map((s) => s.id);
  await db.iklan.deleteMany({ where: { setIklanId: { in: set } } });
  await db.setIklan.deleteMany({ where: { id: { in: set } } });
  await db.kampanye.deleteMany({ where: { id: { in: kampanye } } });
  const kop = (await db.kopSurat.findMany({ where: { nama: { startsWith: K } }, select: { id: true } })).map((k) => k.id);
  await db.berkas.deleteMany({ where: { jenisEntitas: "kop-surat", entitasId: { in: kop } } });
  await db.kopSurat.deleteMany({ where: { id: { in: kop } } });
}

async function main() {
  await bersihkan();
  const mulaiUji = new Date();
  const idLogAwal = new Set((await db.logAktivitas.findMany({ select: { id: true } })).map((l) => l.id));
  const berkasAwal = await db.berkas.count();
  const hakAwal = await db.hakAksesPeran.count();
  const lama = new Map<Hak, { boleh: boolean } | null>();
  for (const hak of HAK_TAMBAHAN) {
    const kunci = { peran_hak: { peran: "KASIR" as const, hak } };
    lama.set(hak, await db.hakAksesPeran.findUnique({ where: kunci }));
    await db.hakAksesPeran.upsert({ where: kunci, create: { peran: "KASIR", hak, boleh: true }, update: { boleh: true } });
  }

  try {
    const pemilik = (await penggunaSaatIni())!;
    const kasir = (await sebagaiPeran("KASIR", () => penggunaSaatIni()))!;
    pastikan(HAK_TAMBAHAN.every((h) => punyaHak(kasir, h)) && !punyaHak(kasir, "tanda-tangan-cetak.buat") && punyaHak(pemilik, "tanda-tangan-cetak.buat"), "KASIR sementara memegang pengaturan.tulis dan hak kampanye tanpa tanda-tangan-cetak.buat; PEMILIK memegangnya");

    await jalankan("kop uji", () => buatKopSurat(formulir({ perusahaanId: "utama", nama: `${K} Kop`, preset: "DPRO" })));
    const kop = await db.kopSurat.findFirstOrThrow({ where: { nama: `${K} Kop`, dihapusPada: null } });
    const berkasSlot = async (jenis: string) => (await db.asetKopSurat.findUniqueOrThrow({ where: { kopSuratId_jenis: { kopSuratId: kop.id, jenis: jenis as "LOGO" } } })).berkasId;
    const unggahOk = async (jenis: string, lebar: number) => {
      const r = await unggahAsetKop(kop.id, jenis, png(lebar, 16));
      pastikan(r.status === 200, `PEMILIK unggah ${jenis} ${lebar}px (${r.status} ${r.isi.galat ?? ""})`);
      return berkasSlot(jenis);
    };
    const ttdLama = await unggahOk("TANDA_TANGAN", 20);
    const ttd = await unggahOk("TANDA_TANGAN", 24);
    const stempelLama = await unggahOk("STEMPEL", 20);
    const stempelDihapus = await unggahOk("STEMPEL", 24);
    await jalankan("PEMILIK hapus stempel", () => hapusAsetKop(kop.id, "STEMPEL"));
    const stempel = await unggahOk("STEMPEL", 28);
    const logo = await unggahOk("LOGO", 20);
    const kopGambar = await unggahOk("KOP", 20);
    const kakiDibuang = await unggahOk("KAKI", 20);
    await jalankan("PEMILIK hapus kaki", () => hapusAsetKop(kop.id, "KAKI"));
    const kampanye = await db.kampanye.create({ data: { nama: `${K} Kampanye`, dibuatOlehNama: "Skrip Uji" } });
    const set = await db.setIklan.create({ data: { kampanyeId: kampanye.id, nama: "Set uji" } });
    const formIklan = (o: Record<string, string>) => formulir({ setIklanId: set.id, nama: `${K} Iklan`, judulIklan: "Judul", cta: "Kirim pesan", ...o });
    const kreatifIklan = async (nama: string) => (await db.iklan.findFirstOrThrow({ where: { setIklanId: set.id, nama } })).berkasKreatifId;

    console.log("=== 1. Positif ===");
    await sebagaiPeran("KASIR", () => jalankan("KASIR: kreatif logo kop yang terpasang", () => buatIklan(kampanye.id, formIklan({ nama: `${K} logo`, berkasKreatifId: logo }))));
    pastikan((await kreatifIklan(`${K} logo`)) === logo, "iklan berkreatif logo tersimpan");
    await sebagaiPeran("KASIR", () => jalankan("KASIR: kreatif gambar kop yang terpasang", () => buatIklan(kampanye.id, formIklan({ nama: `${K} kop`, berkasKreatifId: kopGambar }))));
    await jalankan("PEMILIK: kreatif tanda tangan terpasang", () => buatIklan(kampanye.id, formIklan({ nama: `${K} ttd pemilik`, berkasKreatifId: ttd })));
    pastikan((await kreatifIklan(`${K} ttd pemilik`)) === ttd, "pemegang tanda-tangan-cetak.buat boleh menautkan tanda tangan");

    console.log("=== 2. Negatif: pelaku tanpa tanda-tangan-cetak.buat ===");
    const tolak = (label: string, id: string) => sebagaiPeran("KASIR", () => harusDitolak(label, () => buatIklan(kampanye.id, formIklan({ nama: `${K} tolak`, berkasKreatifId: id })), PESAN));
    await tolak("KASIR kreatif tanda tangan terpasang", ttd);
    await tolak("KASIR kreatif tanda tangan lama di Sampah", ttdLama);
    await tolak("KASIR kreatif stempel terpasang", stempel);
    await tolak("KASIR kreatif stempel lama di Sampah (diganti)", stempelLama);
    await tolak("KASIR kreatif stempel di Sampah (dihapus)", stempelDihapus);
    await tolak("KASIR kreatif gambar kaki yang sudah dibuang", kakiDibuang);
    pastikan((await db.iklan.count({ where: { setIklanId: set.id, nama: `${K} tolak` } })) === 0, "penolakan tidak menyimpan iklan");
    const iklanLogo = await db.iklan.findFirstOrThrow({ where: { setIklanId: set.id, nama: `${K} logo` } });
    await sebagaiPeran("KASIR", () => harusDitolak("KASIR ubah iklan ke tanda tangan", () => ubahIklan(iklanLogo.id, formIklan({ nama: `${K} logo`, berkasKreatifId: ttd })), PESAN));
    await sebagaiPeran("KASIR", () => harusDitolak("KASIR ubah iklan ke stempel", () => ubahIklan(iklanLogo.id, formIklan({ nama: `${K} logo`, berkasKreatifId: stempel })), PESAN));
    pastikan((await kreatifIklan(`${K} logo`)) === logo, "ubah yang ditolak tidak mengganti kreatif");

    console.log("=== 3. Pembaca tanpa hak tanda tangan ===");
    const iklanPemilik = (await db.iklan.findFirstOrThrow({ where: { setIklanId: set.id, nama: `${K} ttd pemilik` } })).id;
    const detailKasir = await kampanyeLengkap(db, kampanye.id, kasir);
    const barisKasir = detailKasir?.iklan.find((i) => i.id === iklanPemilik);
    pastikan(!!barisKasir && barisKasir.berkasKreatif === null && barisKasir.kreatifTersembunyi === true, "pembaca tanpa hak tanda tangan: kreatif tanda tangan tersembunyi tanpa nama");
    const barisLogo = detailKasir?.iklan.find((i) => i.id === iklanLogo.id);
    pastikan(!!barisLogo && barisLogo.berkasKreatif?.id === logo && !barisLogo.kreatifTersembunyi, "pembaca yang sama tetap melihat kreatif logo");
    const detailPemilik = await kampanyeLengkap(db, kampanye.id, pemilik);
    pastikan(detailPemilik?.iklan.find((i) => i.id === iklanPemilik)?.berkasKreatif?.id === ttd, "pemegang hak tanda tangan melihat kreatif tanda tangan");
    pastikan((await ambilBerkasTerlihat(db, kasir, ttd)) === null && (await bacaUntukDikirim(db, kasir, ttd, { unduh: false, ifNoneMatch: null })).status === 404, "unduh /api/berkas gambar tanda tangan 404 bagi pembaca tanpa hak");
    pastikan((await bacaUntukDikirim(db, kasir, logo, { unduh: false, ifNoneMatch: null })).status === 200, "unduh logo tetap 200 bagi pembaca itu");
  } finally {
    for (const hak of HAK_TAMBAHAN) {
      const kunci = { peran_hak: { peran: "KASIR" as const, hak } };
      const awal = lama.get(hak);
      if (awal) await db.hakAksesPeran.update({ where: kunci, data: { boleh: awal.boleh } });
      else await db.hakAksesPeran.deleteMany({ where: { peran: "KASIR", hak } });
    }
    await bersihkan();
    const logBaru = (await db.logAktivitas.findMany({ where: { waktu: { gte: mulaiUji } }, select: { id: true } })).map((l) => l.id).filter((id) => !idLogAwal.has(id));
    await db.logAktivitas.deleteMany({ where: { id: { in: logBaru } } });
  }

  console.log("=== 4. Bersih-bersih ===");
  pastikan((await db.berkas.count()) === berkasAwal, "berkas uji dihapus permanen");
  pastikan((await db.hakAksesPeran.count()) === hakAwal, "HakAksesPeran sama dengan awal");
  console.log("=== DONE, all iklan-kop checks passed ===");
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
