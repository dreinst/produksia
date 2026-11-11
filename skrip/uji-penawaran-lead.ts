import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { pastikanBawaanCrm } from "../src/lib/crm";
import { buatPenawaran, konversiPenawaranKePesanan } from "../src/lib/aksi/penjualan";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { formulir, harusDitolak, jalankan, pastikan } from "./bantuan";

/*
 * P23: penawaran dari lead CRM (D4 §3.8, §8 no. 15, §9.1 bagian 12):
 * - leadId terisi: hak lead.lihat diperiksa sesudah proyek (urutan pesan lama tetap), lead dikunci dan diperiksa di
 *   transaksi penawaran (ada, tidak terarsip, perusahaan sama), leadId tersimpan, aktivitas PENAWARAN_DIBUAT tercatat;
 * - leadId kosong: perilaku lama (leadId null, tanpa aktivitas);
 * - konversi menyalin leadId ke pesanan tanpa memindah tahap lead; hapus penawaran tidak menyentuh lead.
 * Data uji (lead, pelanggan, jasa, dokumen) dihapus; tahap dan sumber bawaan hanya dihapus bila dibuat suite ini.
 */

const K = "PNL";
const PERUSAHAAN = ["utama", "tapussa"] as const;

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

async function bersihkan() {
  const pel = (await db.pelanggan.findMany({ where: { kode: { startsWith: `PLG-${K}` } }, select: { id: true } })).map((p) => p.id);
  if (pel.length > 0) {
    const pesanan = await db.pesananPenjualan.findMany({ where: { pelangganId: { in: pel } }, select: { id: true } });
    await db.rencanaTermin.deleteMany({ where: { OR: [{ pesananId: { in: pesanan.map((p) => p.id) } }, { penawaran: { pelangganId: { in: pel } } }] } });
    await db.barisPesananPenjualan.deleteMany({ where: { pesananId: { in: pesanan.map((p) => p.id) } } });
    await db.pesananPenjualan.deleteMany({ where: { id: { in: pesanan.map((p) => p.id) } } });
    await db.barisPenawaranPenjualan.deleteMany({ where: { penawaran: { pelangganId: { in: pel } } } });
    await db.penawaranPenjualan.deleteMany({ where: { pelangganId: { in: pel } } });
  }
  await db.lead.deleteMany({ where: { namaUsaha: { startsWith: `UJI ${K}` } } });
  await db.barang.deleteMany({ where: { kode: { startsWith: `JS-${K}` } } });
  await db.pelanggan.deleteMany({ where: { kode: { startsWith: `PLG-${K}` } } });
}

async function main() {
  await bersihkan();
  const mulaiUji = new Date();
  const jurnalAwal = await db.jurnal.count();
  // tahap dan sumber bawaan dibuat bila belum ada; dihapus lagi di akhir hanya bila suite ini yang membuatnya
  const tahapAwal = new Map<string, number>();
  for (const p of PERUSAHAAN) tahapAwal.set(p, (await db.tahapLead.count({ where: { perusahaanId: p } })) + (await db.sumberLead.count({ where: { perusahaanId: p } })));
  try {
    await uji();
  } finally {
    await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji }, penggunaNama: "Skrip Uji" } });
    await bersihkan();
    for (const p of PERUSAHAAN) {
      if (tahapAwal.get(p) === 0 && (await db.lead.count({ where: { perusahaanId: p } })) === 0) {
        await db.tahapLead.deleteMany({ where: { perusahaanId: p } });
        await db.sumberLead.deleteMany({ where: { perusahaanId: p } });
      }
    }
  }
  for (const p of PERUSAHAAN) {
    const sekarang = (await db.tahapLead.count({ where: { perusahaanId: p } })) + (await db.sumberLead.count({ where: { perusahaanId: p } }));
    pastikan(tahapAwal.get(p) !== 0 || sekarang === 0, `tahap dan sumber lead ${p} buatan suite ini sudah dihapus`);
  }
  pastikan((await db.jurnal.count()) === jurnalAwal, "penawaran dari lead tidak membuat jurnal");
  console.log("=== DONE, all penawaran-lead checks passed ===");
}

async function uji() {
  console.log("=== Data uji ===");
  for (const p of PERUSAHAAN) await pastikanBawaanCrm(db, p);
  const tahapAwal = async (perusahaanId: string) => db.tahapLead.findFirstOrThrow({ where: { perusahaanId }, orderBy: { urutan: "asc" } });
  const [tahapU, tahapT] = await Promise.all([tahapAwal("utama"), tahapAwal("tapussa")]);
  const pelanggan = await db.pelanggan.create({ data: { kode: `PLG-${K}`, nama: "Klien Uji Penawaran Lead" } });
  const jasa = await db.barang.create({ data: { kode: `JS-${K}`, nama: "Jasa Uji Penawaran Lead", jenis: "JASA", satuan: "paket", hargaBeli: 0, hargaJual: 100_000, perusahaanId: null } });
  const lead = (nama: string, perusahaanId: string, tahapId: string, lain: { dihapusPada?: Date } = {}) =>
    db.lead.create({ data: { perusahaanId, nama, namaUsaha: `UJI ${K} ${nama}`, telepon: "081234567890", whatsapp: "081234567890", sumber: "Instagram", tahapId, pelangganId: pelanggan.id, dibuatOlehNama: "Skrip Uji", ...lain } });
  const leadA = await lead("Lead A", "utama", tahapU.id);
  const leadArsip = await lead("Lead Arsip", "utama", tahapU.id, { dihapusPada: new Date() });
  const leadT = await lead("Lead Tapussa", "tapussa", tahapT.id);
  const baris = [{ barangId: jasa.id, jumlah: 1, harga: 100_000 }];
  const jumlahPenawaran = () => db.penawaranPenjualan.count({ where: { pelangganId: pelanggan.id } });
  const aktivitas = (leadId: string) => db.aktivitasLead.findMany({ where: { leadId, jenis: "PENAWARAN_DIBUAT" }, orderBy: { dibuatPada: "asc" } });

  console.log("=== 12a. Penawaran dari lead ===");
  await jalankan("PNW dari lead A", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, leadId: leadA.id, baris })));
  const pnwA = await db.penawaranPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id, leadId: leadA.id } });
  const aktA = await aktivitas(leadA.id);
  const metaA = aktA[0]?.meta as { nomor?: string; penawaranId?: string } | undefined;
  pastikan(pnwA.perusahaanId === "utama" && aktA.length === 1 && metaA?.nomor === pnwA.nomor && metaA?.penawaranId === pnwA.id && aktA[0].penggunaNama === "Skrip Uji", `leadId tersimpan dan aktivitas PENAWARAN_DIBUAT memuat nomor ${pnwA.nomor}`);

  console.log("=== 12b. Lead terarsip, tidak ada, dan perusahaan berbeda ditolak ===");
  const sebelum = await jumlahPenawaran();
  await harusDitolak("lead terarsip", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, leadId: leadArsip.id, baris })), "Lead tidak ditemukan atau sudah diarsipkan");
  await harusDitolak("lead tidak ada", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, leadId: "lead-tidak-ada", baris })), "Lead tidak ditemukan atau sudah diarsipkan");
  await harusDitolak("lead tapussa untuk penawaran utama", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, leadId: leadT.id, baris })), "Lead milik Tapussa Bhallika; penawaran harus atas nama perusahaan yang sama");
  pastikan((await jumlahPenawaran()) === sebelum && (await aktivitas(leadArsip.id)).length === 0 && (await aktivitas(leadT.id)).length === 0, "penolakan tidak menyimpan penawaran maupun aktivitas");

  console.log("=== 12c. Hak lead.lihat ===");
  await sebagaiPeran("KASIR", () => harusDitolak("KASIR dengan leadId", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, leadId: leadA.id, baris })), "tidak punya hak"));
  await sebagaiPeran("KASIR", () => harusDitolak("KASIR dengan leadId dan proyek tidak ada: galat proyek lebih dulu", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, leadId: leadA.id, proyekId: "tidak-ada", baris })), "Proyek/event tidak ditemukan"));
  pastikan((await jumlahPenawaran()) === sebelum, "penawaran KASIR berlead tidak tersimpan");
  await sebagaiPeran("ADMIN", () => jalankan("ADMIN (punya lead.lihat) membuat penawaran dari lead A", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, leadId: leadA.id, baris }))));
  pastikan((await aktivitas(leadA.id)).length === 2, "penawaran ADMIN dari lead A menambah aktivitas kedua");

  console.log("=== 12d. Tanpa leadId: perilaku lama ===");
  const aktivitasSemua = await db.aktivitasLead.count();
  await sebagaiPeran("KASIR", () => jalankan("KASIR tanpa leadId", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, baris }))));
  await jalankan("leadId spasi saja", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, leadId: "   ", baris })));
  const tanpaLead = await db.penawaranPenjualan.findMany({ where: { pelangganId: pelanggan.id, leadId: null } });
  pastikan(tanpaLead.length === 2 && tanpaLead.every((p) => p.perusahaanId === "utama" && p.status === "DRAF" && p.statusPersetujuan === "DISETUJUI") && (await db.aktivitasLead.count()) === aktivitasSemua, "tanpa leadId: leadId null, tanpa aktivitas lead");

  console.log("=== 12e. Lead perusahaan lain dengan penawaran perusahaan yang sama ===");
  await jalankan("PNW tapussa dari lead tapussa", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, perusahaanId: "tapussa", leadId: leadT.id, baris })));
  const pnwT = await db.penawaranPenjualan.findFirstOrThrow({ where: { leadId: leadT.id } });
  pastikan(pnwT.perusahaanId === "tapussa" && (await aktivitas(leadT.id)).length === 1, "penawaran tapussa dari lead tapussa tersimpan dengan aktivitas");
  await denganEnv({ UJI_PERUSAHAAN: "tapussa" }, () => jalankan("PNW di sesi tapussa dari lead tapussa (tanpa isian perusahaan)", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, leadId: leadT.id, baris }))));
  pastikan((await db.penawaranPenjualan.count({ where: { leadId: leadT.id, perusahaanId: "tapussa" } })) === 2, "lingkup tapussa memberi perusahaan penawaran yang cocok dengan lead");

  console.log("=== 12f. Konversi dan hapus ===");
  const tahapSebelum = (await db.lead.findUniqueOrThrow({ where: { id: leadA.id } })).tahapId;
  await jalankan("konversi PNW berlead", () => konversiPenawaranKePesanan(pnwA.id));
  const psj = await db.pesananPenjualan.findFirstOrThrow({ where: { penawaranId: pnwA.id } });
  pastikan(psj.leadId === leadA.id && (await db.lead.findUniqueOrThrow({ where: { id: leadA.id } })).tahapId === tahapSebelum, "pesanan menyalin leadId; tahap lead tidak berpindah");
  await jalankan("hapus pesanan", () => hapusDokumen("pesanan", psj.id));
  for (const p of await db.penawaranPenjualan.findMany({ where: { pelangganId: pelanggan.id }, select: { id: true, nomor: true } })) await jalankan(`hapus ${p.nomor}`, () => hapusDokumen("penawaran", p.id));
  const leadSesudah = await db.lead.findUniqueOrThrow({ where: { id: leadA.id } });
  pastikan(leadSesudah.dihapusPada === null && (await aktivitas(leadA.id)).length === 2, "hapus penawaran tidak menyentuh lead; linimasa tetap");
  pastikan((await jumlahPenawaran()) === 0, "semua penawaran uji terhapus");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
