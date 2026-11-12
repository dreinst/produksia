import "dotenv/config";
// Skrip ini memanggil pustaka di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { MAKS_HALAMAN, UKURAN_HALAMAN, bacaParamDaftar } from "../src/lib/daftar";
import { halanganPenawaranLead, pastikanBawaanCrm, rutePenawaranLead, tautanLeadTahap, whereLead } from "../src/lib/crm";
import { pastikan } from "./bantuan";

/*
 * Uji perbaikan tinjauan P32 untuk halaman CRM dan daftar:
 * - S1: tombol dan pengalihan "Buat penawaran" dari lead hanya bila formulir penawaran baru (P26) akan menerima lead
 *   itu (perusahaan lead = perusahaan lingkup aktif, atau gabungan/lingkup arsip, dan perusahaan lead aktif).
 * - R2: `?hal=` di luar 1..MAKS_HALAMAN atau bukan bilangan bulat aman dianggap halaman 1; input normal identik.
 * - R3: tautan "{n} lainnya" pipeline membawa saringan aktif, dan daftar yang dibuka berisi lead yang sama.
 * Data uji: perusahaan UJICRMHB (aktif) dan UJICRMHX (diarsipkan), pelanggan UJICRMH-P1, lead berawalan "UjiCRMH ".
 * Semuanya dihapus di akhir.
 */

const AWALAN = "UjiCRMH ";
const KODE_B = "UJICRMHB";
const KODE_X = "UJICRMHX";
const KODE_PELANGGAN = "UJICRMH-P1";

async function bersihkan() {
  const pIds = (await db.perusahaan.findMany({ where: { kode: { in: [KODE_B, KODE_X] } }, select: { id: true } })).map((p) => p.id);
  await db.lead.deleteMany({ where: { OR: [{ perusahaanId: { in: pIds } }, { nama: { startsWith: AWALAN } }] } });
  await db.pelanggan.deleteMany({ where: { kode: KODE_PELANGGAN } });
  await db.tahapLead.deleteMany({ where: { perusahaanId: { in: pIds } } });
  await db.sumberLead.deleteMany({ where: { perusahaanId: { in: pIds } } });
  await db.perusahaan.deleteMany({ where: { id: { in: pIds } } });
}

/** Salinan pencarian lead halaman penawaran baru (P26, `penjualan/penawaran/baru/page.tsx`) sebagai pembanding. */
async function diterimaFormulirPenawaran(leadId: string, perusahaanFormulirId: string | null) {
  const lead = await db.lead.findFirst({
    where: { id: leadId, dihapusPada: null, pelangganId: { not: null }, perusahaan: { aktif: true }, ...(perusahaanFormulirId ? { perusahaanId: perusahaanFormulirId } : {}) },
    select: { id: true },
  });
  return !!lead;
}

async function main() {
  await bersihkan();
  try {
    console.log("=== 1. R2: bacaParamDaftar ===");
    const baca = (p: Record<string, string | string[] | undefined>, ukuran?: number) => bacaParamDaftar(Promise.resolve(p), ukuran);
    const normal: [Record<string, string | string[] | undefined>, number | undefined, { q: string; hal: number; ambil: number; lewati: number }][] = [
      [{}, undefined, { q: "", hal: 1, ambil: UKURAN_HALAMAN, lewati: 0 }],
      [{ q: "  budi ", hal: "2" }, undefined, { q: "budi", hal: 2, ambil: 25, lewati: 25 }],
      [{ hal: "3" }, 50, { q: "", hal: 3, ambil: 50, lewati: 100 }],
      [{ hal: ["4", "9"], q: ["a", "b"] }, undefined, { q: "a", hal: 4, ambil: 25, lewati: 75 }],
      [{ hal: "1" }, undefined, { q: "", hal: 1, ambil: 25, lewati: 0 }],
      [{ hal: String(MAKS_HALAMAN) }, 50, { q: "", hal: MAKS_HALAMAN, ambil: 50, lewati: (MAKS_HALAMAN - 1) * 50 }],
    ];
    for (const [p, u, harap] of normal) {
      const hasil = await baca(p, u);
      pastikan(JSON.stringify(hasil) === JSON.stringify(harap), `normal ${JSON.stringify(p)}: ${JSON.stringify(hasil)}`);
    }
    for (const hal of ["", "0", "-1", "1.5", "abc", "Infinity", "NaN", String(MAKS_HALAMAN + 1), "1e300", "9007199254740993", String(2 ** 63)]) {
      const hasil = await baca({ hal }, 50);
      pastikan(hasil.hal === 1 && hasil.lewati === 0, `hal=${JSON.stringify(hal)} dianggap halaman 1`);
    }
    // hal terbesar yang diterima tetap aman untuk Prisma (skip muat 64 bit) dan memberi daftar kosong
    const maks = await baca({ hal: String(MAKS_HALAMAN) }, 50);
    const kosong = await db.lead.findMany({ skip: maks.lewati, take: maks.ambil, select: { id: true } });
    pastikan(kosong.length === 0, `findMany skip ${maks.lewati} tidak melempar dan kosong`);

    console.log("=== 2. S1: halanganPenawaranLead (murni) ===");
    const B = (await db.perusahaan.create({ data: { kode: KODE_B, nama: "PT Uji CRMH B", urutan: 96 } })).id;
    const X = (await db.perusahaan.create({ data: { kode: KODE_X, nama: "PT Uji CRMH X", urutan: 96 } })).id;
    const pB = { id: B, nama: "PT Uji CRMH B", aktif: true };
    const pX = { id: X, nama: "PT Uji CRMH X", aktif: false };
    pastikan(halanganPenawaranLead(pB, B) === null, "lead B di lingkup B: boleh");
    pastikan(halanganPenawaranLead(pB, null) === null, "lead B di gabungan atau lingkup arsip: boleh");
    pastikan(halanganPenawaranLead(pB, "utama") === "Ganti perusahaan aktif ke PT Uji CRMH B untuk membuat penawaran", "lead B di lingkup utama: ganti perusahaan aktif");
    for (const f of [X, null, "utama"]) {
      pastikan(halanganPenawaranLead(pX, f) === "Perusahaan PT Uji CRMH X sudah diarsipkan, jadi penawaran dari lead ini tidak bisa dibuat", `lead perusahaan arsip (formulir ${f}): ditolak`);
    }

    console.log("=== 3. S1: rutePenawaranLead sama dengan penerimaan formulir penawaran baru ===");
    await pastikanBawaanCrm(db, B);
    await pastikanBawaanCrm(db, X);
    const tahap = async (p: string) => (await db.tahapLead.findFirstOrThrow({ where: { perusahaanId: p }, orderBy: { urutan: "asc" } })).id;
    const pelanggan = await db.pelanggan.create({ data: { kode: KODE_PELANGGAN, nama: "PT Uji CRMH Pelanggan" } });
    const buat = async (p: string, nama: string, sumber = "Instagram", picId: string | null = null) =>
      db.lead.create({
        data: { perusahaanId: p, nama: AWALAN + nama, namaUsaha: `PT ${nama}`, telepon: "0811", whatsapp: "0811", sumber, picId, tahapId: await tahap(p), pelangganId: pelanggan.id, dibuatOlehNama: "Uji" },
      });
    await db.perusahaan.update({ where: { id: X }, data: { aktif: true } });
    const leadB = await buat(B, "B1");
    const leadX = await buat(X, "X1");
    await db.perusahaan.update({ where: { id: X }, data: { aktif: false } });
    const rute = `/penjualan/penawaran/baru?leadId=${encodeURIComponent(leadB.id)}`;
    const kasus: [string, string, string | null, boolean][] = [
      ["lead B, lingkup B", leadB.id, B, true],
      ["lead B, gabungan", leadB.id, null, true],
      ["lead B, lingkup utama", leadB.id, "utama", false],
      ["lead X arsip, gabungan", leadX.id, null, false],
      ["lead X arsip, lingkup utama", leadX.id, "utama", false],
    ];
    for (const [label, id, f, boleh] of kasus) {
      const r = await rutePenawaranLead(db, id, f);
      pastikan(boleh ? r === (id === leadB.id ? rute : null) : r === null, `${label}: rute ${r ?? "null (tetap di detail lead)"}`);
      pastikan((await diterimaFormulirPenawaran(id, f)) === boleh, `${label}: formulir penawaran baru ${boleh ? "menerima" : "menolak"} lead, sama dengan rute`);
    }
    pastikan((await rutePenawaranLead(db, "tidak-ada", null)) === null, "lead tidak ada: null");

    console.log("=== 4. R3: tautan {n} lainnya pipeline membawa saringan ===");
    pastikan(tautanLeadTahap("t1", {}) === "/crm/lead?tahap=t1", "tanpa saringan: hanya tahap (sama dengan sebelumnya)");
    pastikan(tautanLeadTahap("t1", { q: "budi & co", sumber: "Meta Ads", pic: "saya" }) === "/crm/lead?tahap=t1&q=budi+%26+co&sumber=Meta+Ads&pic=saya", "q, sumber, dan pic ikut dan dikodekan");
    pastikan(tautanLeadTahap("t1", { q: undefined, sumber: "", pic: "x" }) === "/crm/lead?tahap=t1&pic=x", "saringan kosong tidak ikut");
    // daftar lead yang dibuka tautan (q, sumber, pic, tahap dari URL) berisi lead yang sama dengan kolom pipeline
    const owner = await db.pengguna.findUniqueOrThrow({ where: { namaPengguna: "owner" }, select: { id: true } });
    await buat(B, "Cocok 1", "Instagram", owner.id);
    await buat(B, "Cocok 2", "Instagram", owner.id);
    await buat(B, "Lain sumber", "Website", owner.id);
    await buat(B, "Lain pic", "Instagram", null);
    const tahapB = await tahap(B);
    const saringan = { q: "Cocok", sumber: "Instagram", pic: owner.id };
    const kolom = await db.lead.count({ where: { AND: [whereLead(saringan, { perusahaanId: B, penggunaId: owner.id }), { tahapId: tahapB }] } });
    const url = new URL(tautanLeadTahap(tahapB, saringan), "http://x");
    const sp = Object.fromEntries(url.searchParams);
    const param = await bacaParamDaftar(Promise.resolve(sp));
    const daftar = await db.lead.count({ where: whereLead({ q: param.q, tahap: sp.tahap, sumber: sp.sumber, pic: sp.pic, arsip: false }, { perusahaanId: B, penggunaId: owner.id }) });
    const tanpaSaringan = await db.lead.count({ where: whereLead({ tahap: tahapB, arsip: false }, { perusahaanId: B, penggunaId: owner.id }) });
    pastikan(kolom === 2 && daftar === kolom && tanpaSaringan > kolom, `daftar dari tautan = ${daftar} lead, sama dengan kolom (${kolom}); tautan lama tanpa saringan memberi ${tanpaSaringan}`);
  } finally {
    await bersihkan();
  }
  pastikan((await db.perusahaan.count({ where: { kode: { in: [KODE_B, KODE_X] } } })) === 0 && (await db.lead.count({ where: { nama: { startsWith: AWALAN } } })) === 0, "data uji terhapus");
}

main()
  .then(() => console.log("SELESAI uji-crm-halaman"))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
