import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { D, type Desimal } from "../src/lib/uang";
import { periksaSinkron } from "../src/lib/sinkron";
import { isiPola } from "../src/lib/nomorCetak";
import { progresTermin } from "../src/lib/rencanaTermin";
import { dataCetakPenjualan } from "../src/lib/dataCetakPenjualan";
import { buatPenawaran, konversiPenawaranKePesanan, buatUangMuka, buatFaktur, buatPenerimaan } from "../src/lib/aksi/penjualan";
import { ubahRencanaTermin, terbitkanTagihanTermin, batalkanTagihanTermin, simpanFormatNomor } from "../src/lib/aksi/dokumenPenjualan";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { aturPersetujuan, formulir, harusDitolak, jalankan, pastikan } from "./bantuan";

/*
 * P25: rencana termin, tagihan termin, dan data cetak (D2 §9.2 uji-termin): ubah rencana penawaran dan pesanan,
 * terbitkan dan batalkan tagihan dengan nomor cetak tagihan-termin, penjaga sudah ditagih atau dibayar, progres
 * termin, uang muka termin dan tanpa termin, faktur final FIFO, dataCetakPenjualan untuk kelima jenis (uang berupa
 * string, draf sesuai status), hak, dan bersih-bersih.
 */

const K = "UJITRM";
const DERET = "surat-uji-trm";
const s2 = (x: unknown) => D(x as Desimal).toFixed(2);

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
  if (pel.length) {
    aturPersetujuan(false);
    for (const t of await db.penerimaanPenjualan.findMany({ where: { pelangganId: { in: pel } }, select: { id: true } })) await jalankan("bersih penerimaan", () => hapusDokumen("penerimaan", t.id));
    for (const f of await db.fakturPenjualan.findMany({ where: { pelangganId: { in: pel } }, orderBy: { tanggal: "desc" }, select: { id: true } })) await jalankan("bersih faktur", () => hapusDokumen("faktur", f.id));
    for (const u of await db.uangMukaPelanggan.findMany({ where: { pelangganId: { in: pel } }, select: { id: true } })) await jalankan("bersih uang muka", () => hapusDokumen("uangMuka", u.id));
    for (const p of await db.pesananPenjualan.findMany({ where: { pelangganId: { in: pel } }, select: { id: true } })) await jalankan("bersih pesanan", () => hapusDokumen("pesanan", p.id));
    for (const p of await db.penawaranPenjualan.findMany({ where: { pelangganId: { in: pel } }, select: { id: true } })) await jalankan("bersih penawaran", () => hapusDokumen("penawaran", p.id));
  }
  await db.penghitungNomor.deleteMany({ where: { kunciDeret: DERET } });
  await db.formatNomor.deleteMany({ where: { kunciDeret: DERET } });
  await db.barang.deleteMany({ where: { kode: { startsWith: `JS-${K}` } } });
  await db.proyek.deleteMany({ where: { kode: { startsWith: `PRJ-${K}` } } });
  await db.pelanggan.deleteMany({ where: { kode: { startsWith: `PLG-${K}` } } });
  await db.akun.deleteMany({ where: { kode: { startsWith: `UJI-${K}` } } });
}

async function main() {
  await bersihkan();
  aturPersetujuan(false);
  const mulaiUji = new Date();
  const sinkronAwal = await periksaSinkron(db);
  const jurnalAwal = await db.jurnal.count();
  const formatAwal = await db.formatNomor.findUnique({ where: { perusahaanId_jenis: { perusahaanId: "utama", jenis: "tagihan-termin" } } });
  try {
    await db.formatNomor.deleteMany({ where: { perusahaanId: "utama", jenis: "tagihan-termin" } });
    await uji(mulaiUji);
  } finally {
    await bersihkan();
    await db.formatNomor.deleteMany({ where: { perusahaanId: "utama", jenis: "tagihan-termin" } });
    if (formatAwal) await db.formatNomor.create({ data: formatAwal });
    await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji }, penggunaNama: "Skrip Uji" } });
  }
  pastikan((await db.formatNomor.count({ where: { kunciDeret: DERET } })) === 0 && (await db.penghitungNomor.count({ where: { kunciDeret: DERET } })) === 0, "FormatNomor dan PenghitungNomor uji terhapus");
  pastikan((await db.jurnal.count()) === jurnalAwal, "jumlah jurnal sama dengan sebelum uji");
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron seimbang dan sama dengan sebelum uji");
  console.log("=== DONE, all termin checks passed ===");
}

const uangString = (x: unknown): boolean => typeof x === "string" && /^-?\d+\.\d{2}$/.test(x);

async function uji(mulaiUji: Date) {
  const pelanggan = await db.pelanggan.create({ data: { kode: `PLG-${K}`, nama: "Klien Uji Termin", alamat: "Jl. Uji 1" } });
  const proyek = await db.proyek.create({ data: { kode: `PRJ-${K}`, nama: "Event Uji Termin", pelangganId: pelanggan.id, tanggalMulai: new Date("2026-08-27T12:00:00"), tanggalSelesai: new Date("2026-08-30T12:00:00") } });
  const jasa = await db.barang.create({ data: { kode: `JS-${K}`, nama: "Paket Event Uji", jenis: "JASA", satuan: "paket", hargaBeli: 0, hargaJual: 10_000_000, perusahaanId: null } });
  const kas = await db.akun.create({ data: { kode: `UJI-${K}-KAS`, nama: "Kas Uji Termin", jenis: "ASET", kasBank: true } });
  const butir = async (where: { penawaranId?: string; pesananId?: string }) => db.rencanaTermin.findMany({ where, orderBy: { no: "asc" } });
  const ringkas = (xs: { label: string; jumlah: unknown; persen: unknown }[]) => xs.map((b) => `${b.label}:${s2(b.jumlah)}:${s2(b.persen)}`).join();

  console.log("=== 1. Penawaran dengan rencana dan ubah rencana penawaran ===");
  await jalankan("PNW 1 x 10.000.000 dengan termin DP 30%, Termin 2 40%, Pelunasan", () =>
    buatPenawaran(formulir({ pelangganId: pelanggan.id, proyekId: proyek.id, ppnPersen: 0, namaEvent: "Gathering Termin", baris: [{ barangId: jasa.id, jumlah: 1, harga: 10_000_000 }], rencanaTermin: [{ label: "DP", nilai: 30 }, { label: "Termin 2", nilai: 40 }, { label: "Pelunasan" }] })),
  );
  const pnw = await db.penawaranPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id } });
  pastikan(ringkas(await butir({ penawaranId: pnw.id })) === "DP:3000000.00:30.00,Termin 2:4000000.00:40.00,Pelunasan:3000000.00:30.00", "termin penawaran 3/4/3 juta");
  await jalankan("ubah rencana penawaran ke 50% + sisa", () => ubahRencanaTermin("penawaran", pnw.id, formulir({ rencanaTermin: [{ label: "DP", nilai: 50 }, { label: "Pelunasan" }] })));
  pastikan(ringkas(await butir({ penawaranId: pnw.id })) === "DP:5000000.00:50.00,Pelunasan:5000000.00:50.00", "rencana penawaran diganti 5/5 juta");
  pastikan((await db.logAktivitas.count({ where: { aksi: "UBAH_TERMIN", modul: "penjualan", entitasId: pnw.id, waktu: { gte: mulaiUji } } })) === 1, "log UBAH_TERMIN bermodul penjualan");
  await harusDitolak("rencana 5 butir", () => ubahRencanaTermin("penawaran", pnw.id, formulir({ rencanaTermin: [{}, {}, {}, {}, {}] })), "maksimal 4");
  await sebagaiPeran("GUDANG", () => harusDitolak("GUDANG mengubah rencana penawaran", () => ubahRencanaTermin("penawaran", pnw.id, formulir({ rencanaTermin: [] })), "tidak punya hak"));

  console.log("=== 2. Konversi dan ubah rencana pesanan ===");
  await jalankan("konversi", () => konversiPenawaranKePesanan(pnw.id));
  const psj = await db.pesananPenjualan.findFirstOrThrow({ where: { penawaranId: pnw.id } });
  await harusDitolak("ubah rencana penawaran yang sudah dikonversi", () => ubahRencanaTermin("penawaran", pnw.id, formulir({ rencanaTermin: [] })), "sudah dikonversi");
  await jalankan("ubah rencana pesanan ke DP 30%, Termin 2 40%, Pelunasan", () => ubahRencanaTermin("pesanan", psj.id, formulir({ rencanaTermin: [{ label: "DP", nilai: 30 }, { label: "Termin 2", nilai: 40 }, { label: "Pelunasan" }] })));
  const [t1, t2, t3] = await butir({ pesananId: psj.id });
  pastikan(ringkas([t1, t2, t3]) === "DP:3000000.00:30.00,Termin 2:4000000.00:40.00,Pelunasan:3000000.00:30.00" && [t1, t2, t3].every((b) => b.perusahaanId === psj.perusahaanId && b.penawaranId === null), "rencana pesanan 3/4/3 juta milik perusahaan pesanan");

  console.log("=== 3. Terbitkan tagihan termin ===");
  await jalankan("format tagihan-termin", () => simpanFormatNomor(formulir({ perusahaanId: "utama", jenis: "tagihan-termin", pola: "{SEQ3}/{KODE}/TGH/{ROMAN}/{YYYY}", kunciDeret: DERET, reset: "TAHUNAN" })));
  await jalankan("terbitkan termin 1", () => terbitkanTagihanTermin(t1.id, formulir({})));
  const t1a = await db.rencanaTermin.findUniqueOrThrow({ where: { id: t1.id } });
  const harapNomor = isiPola("{SEQ3}/{KODE}/TGH/{ROMAN}/{YYYY}", { nilai: 1, tanggal: t1a.ditagihPada!, prefiks: "", kode: "DPRO", digit: 4 });
  pastikan(t1a.ditagihPada !== null && t1a.nomorCetak === harapNomor, `termin 1 ditagih dengan nomor ${harapNomor} (${t1a.nomorCetak})`);
  await jalankan("terbitkan ulang termin 1", () => terbitkanTagihanTermin(t1.id, formulir({ nomorCetak: "MANUAL-LAIN" })));
  const t1b = await db.rencanaTermin.findUniqueOrThrow({ where: { id: t1.id } });
  pastikan(t1b.nomorCetak === harapNomor && t1b.ditagihPada?.getTime() === t1a.ditagihPada!.getTime(), "terbit ulang idempoten: nomor dan tanggal tagih tetap");
  pastikan((await db.logAktivitas.count({ where: { aksi: "TERBITKAN", modul: "penjualan", entitasId: t1.id, waktu: { gte: mulaiUji } } })) === 1, "log TERBITKAN satu kali (terbit ulang tanpa perubahan tidak dicatat)");
  const pnwTermin = await db.rencanaTermin.findFirstOrThrow({ where: { penawaranId: pnw.id } });
  await harusDitolak("terbitkan termin penawaran", () => terbitkanTagihanTermin(pnwTermin.id, formulir({})), "Tagihan termin diterbitkan dari pesanan");
  await harusDitolak("jatuh tempo tidak valid", () => terbitkanTagihanTermin(t2.id, formulir({ jatuhTempo: "2026-02-31" })), "Jatuh tempo tidak valid");
  await sebagaiPeran("GUDANG", () => harusDitolak("GUDANG menerbitkan tagihan", () => terbitkanTagihanTermin(t2.id, formulir({})), "tidak punya hak"));

  console.log("=== 4. Rencana pesanan terkunci sesudah ditagih ===");
  await harusDitolak("ubah rencana pesanan sesudah termin 1 ditagih", () => ubahRencanaTermin("pesanan", psj.id, formulir({ rencanaTermin: [{ label: "DP", nilai: 50 }, { label: "Pelunasan" }] })), "sudah ditagih atau dibayar");

  console.log("=== 5. Pembayaran termin dan batal tagihan ===");
  await jalankan("UM termin 1 = 3.000.000", () => buatUangMuka(formulir({ pesananId: psj.id, akunId: kas.id, jumlah: 3_000_000, rencanaTerminId: t1.id })));
  await harusDitolak("UM termin 1 tambahan", () => buatUangMuka(formulir({ pesananId: psj.id, akunId: kas.id, jumlah: 1, rencanaTerminId: t1.id })), "melebihi nilai termin");
  await harusDitolak("batalkan tagihan termin 1 yang sudah dibayar", () => batalkanTagihanTermin(t1.id), "sudah dibayar");
  await jalankan("terbitkan termin 2 dengan nomor manual", () => terbitkanTagihanTermin(t2.id, formulir({ nomorCetak: `TGH-${K}-2` })));
  pastikan((await db.rencanaTermin.findUniqueOrThrow({ where: { id: t2.id } })).nomorCetak === `TGH-${K}-2`, "termin 2 memakai nomor manual");
  await harusDitolak("nomor manual termin yang sudah dipakai", () => terbitkanTagihanTermin(t3.id, formulir({ nomorCetak: `TGH-${K}-2` })), "sudah dipakai dokumen lain");
  await jalankan("batalkan tagihan termin 2", () => batalkanTagihanTermin(t2.id));
  const t2b = await db.rencanaTermin.findUniqueOrThrow({ where: { id: t2.id } });
  pastikan(t2b.ditagihPada === null && t2b.nomorCetak === null, "batal tagihan: tanggal tagih dan nomor dilepas");
  const logBatal = await db.logAktivitas.findFirstOrThrow({ where: { aksi: "BATAL", entitasId: t2.id, waktu: { gte: mulaiUji } } });
  pastikan(logBatal.modul === "penjualan" && (logBatal.meta as { nomorCetakLama?: string }).nomorCetakLama === `TGH-${K}-2`, "log BATAL bermodul penjualan dengan nomor cetak lama");

  console.log("=== 6. Progres termin ===");
  const kemarin = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await db.rencanaTermin.update({ where: { id: t3.id }, data: { jatuhTempo: new Date(`${kemarin}T12:00:00`) } });
  const pr = (await progresTermin(db, psj.id))!;
  pastikan(pr.butir.map((b) => b.status).join() === "Lunas,Belum ditagih,Belum ditagih" && s2(pr.belumDibayar) === "7000000.00" && pr.butir[2].lewatJatuhTempo, `progres: Lunas, Belum ditagih, Belum ditagih; belum dibayar 7.000.000; termin 3 lewat jatuh tempo (${pr.butir.map((b) => b.status).join()})`);

  console.log("=== 7. Uang muka tanpa termin ===");
  await jalankan("UM tanpa termin 1.000.000", () => buatUangMuka(formulir({ pesananId: psj.id, akunId: kas.id, jumlah: 1_000_000 })));
  pastikan(s2((await progresTermin(db, psj.id))!.dpTanpaTermin) === "1000000.00", "dpTanpaTermin 1.000.000");

  console.log("=== 8. Faktur final memakai uang muka FIFO ===");
  const barisPsj = await db.barisPesananPenjualan.findFirstOrThrow({ where: { pesananId: psj.id } });
  await jalankan("FJ final dengan uang muka 4.000.000", () => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, uangMuka: 4_000_000, baris: [{ barisPesananId: barisPsj.id, jumlah: 1 }] })));
  const fj = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj.id }, include: { pemakaianUangMuka: { include: { uangMuka: true } } } });
  const umTermin = await db.uangMukaPelanggan.findFirstOrThrow({ where: { rencanaTerminId: t1.id } });
  pastikan(fj.pemakaianUangMuka.length === 2 && fj.pemakaianUangMuka.some((p) => p.uangMukaId === umTermin.id && s2(p.jumlah) === "3000000.00"), "pemakaian uang muka menunjuk UM termin 1 dan UM tanpa termin");
  const cFj = (await dataCetakPenjualan("faktur", fj.id))!;
  pastikan(cFj.uangMukaDipakai.map((u) => u.labelTermin ?? "null").join() === "DP,null" && cFj.ringkasan.uangMuka === "4000000.00" && cFj.ringkasan.sisa === "6000000.00", `data cetak faktur: uang muka dipotong berlabel DP dan null, sisa 6.000.000 (${cFj.uangMukaDipakai.map((u) => u.labelTermin).join()}, ${cFj.ringkasan.sisa})`);
  pastikan(cFj.draf === false && cFj.referensi === (pnw.nomorCetak ?? pnw.nomor) && cFj.event.tanggalEvent === "27-30 Agustus 2026" && cFj.tanggalKedua?.label === "Jatuh tempo", "faktur disetujui bukan draf; referensi nomor penawaran asal; tanggal event dari proyek; jatuh tempo");

  console.log("=== 9. Data cetak tagihan termin dan kelima jenis ===");
  const cT1 = (await dataCetakPenjualan("tagihan-termin", t1.id))!;
  pastikan(cT1.konteksTermin?.nilaiKontrakBruto === "10000000.00" && cT1.konteksTermin.sisaSetelahTermin === "7000000.00" && cT1.konteksTermin.jumlahButir === 3 && cT1.konteksTermin.dibayarSebelumnya === "1000000.00" && cT1.draf === false && cT1.nomorTampil === harapNomor, `tagihan termin 1: kontrak 10.000.000, sisa sesudah termin 7.000.000, dibayar sebelumnya = UM tanpa termin (${JSON.stringify(cT1.konteksTermin)})`);
  const cT2 = (await dataCetakPenjualan("tagihan-termin", t2.id))!;
  pastikan(cT2.draf === true && cT2.nomorTampil === `${psj.nomor}/T2` && cT2.baris.length === 0 && cT2.ringkasan.total === "4000000.00", "tagihan termin 2 yang dibatalkan dicetak DRAF dengan nomor internal");
  pastikan((await dataCetakPenjualan("tagihan-termin", pnwTermin.id)) === null && (await dataCetakPenjualan("faktur", "tidak-ada")) === null, "butir penawaran dan dokumen tidak ada: null");
  await jalankan("TRM pelunasan sebagian 1.000.000 + PPh 23 0", () => buatPenerimaan(formulir({ fakturId: fj.id, akunId: kas.id, jumlah: 1_000_000, keperluan: "" })));
  const trm = await db.penerimaanPenjualan.findFirstOrThrow({ where: { fakturId: fj.id } });
  const cPnw = (await dataCetakPenjualan("penawaran", pnw.id))!;
  const cKw = (await dataCetakPenjualan("kwitansi", trm.id))!;
  const cKdp = (await dataCetakPenjualan("kwitansi-dp", umTermin.id))!;
  pastikan(cPnw.termin.map((t) => `${t.label}:${t.jumlahBruto}`).join() === "DP:5000000.00,Pelunasan:5000000.00" && cPnw.event.namaEvent === "Gathering Termin" && cPnw.kepada.nama === pelanggan.nama && cPnw.kepada.alamat === "Jl. Uji 1", "data cetak penawaran: skema termin, event, tujuan dari data induk pelanggan");
  pastikan(cKw.kwitansi?.jumlah === "1000000.00" && cKw.kwitansi.keperluan === `Pembayaran ${fj.nomor}` && cKw.baris.length === 1 && cKw.ringkasan.terbayar === "5000000.00", "kuitansi: jumlah, keperluan bawaan, lampiran baris faktur, terbayar = uang muka + penerimaan");
  pastikan(cKdp.kwitansi?.keperluan === "Pembayaran DP Gathering Termin" && cKdp.kwitansi.jumlah === "3000000.00" && cKdp.baris.length === 1 && cKdp.termin.length === 3, "kuitansi DP bertermin: keperluan bawaan, lampiran baris pesanan, skema termin");
  for (const c of [cPnw, cFj, cKw, cKdp, cT1]) {
    const uang = [...Object.entries(c.ringkasan).filter(([k]) => !["jenisDiskon", "jenisFee", "addOn"].includes(k)).map(([, v]) => v), ...c.baris.flatMap((b) => [b.jumlah, b.harga, b.subtotal, b.frekuensi]), ...c.termin.flatMap((t) => [t.jumlah, t.jumlahBruto, t.persen])];
    pastikan(uang.every(uangString), `data cetak ${c.jenis}: semua uang berupa string dua desimal`);
  }
  await db.fakturPenjualan.update({ where: { id: fj.id }, data: { statusPersetujuan: "MENUNGGU" } });
  pastikan((await dataCetakPenjualan("faktur", fj.id))!.draf === true, "faktur belum disetujui dicetak DRAF");
  await db.fakturPenjualan.update({ where: { id: fj.id }, data: { statusPersetujuan: "DISETUJUI" } });
  await db.penawaranPenjualan.update({ where: { id: pnw.id }, data: { status: "DIBATALKAN" } });
  pastikan((await dataCetakPenjualan("penawaran", pnw.id))!.draf === true, "penawaran berstatus dibatalkan dicetak DRAF (D3 §10.1)");
  await db.penawaranPenjualan.update({ where: { id: pnw.id }, data: { status: "DIKONVERSI" } });

  console.log("=== 10. Sinkron dan hapus berurutan ===");
  pastikan((await periksaSinkron(db)).seimbang, "periksaSinkron seimbang");
  await jalankan("hapus TRM", () => hapusDokumen("penerimaan", trm.id));
  await jalankan("hapus faktur", () => hapusDokumen("faktur", fj.id));
  for (const u of await db.uangMukaPelanggan.findMany({ where: { pesananId: psj.id } })) await jalankan(`hapus ${u.nomor}`, () => hapusDokumen("uangMuka", u.id));
  await jalankan("hapus pesanan", () => hapusDokumen("pesanan", psj.id));
  pastikan((await db.rencanaTermin.count({ where: { pesananId: psj.id } })) === 0, "butir termin pesanan ikut terhapus");
  await jalankan("hapus penawaran", () => hapusDokumen("penawaran", pnw.id));
  pastikan((await db.rencanaTermin.count({ where: { penawaranId: pnw.id } })) === 0, "butir termin penawaran ikut terhapus");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
