import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { D, type Desimal } from "../src/lib/uang";
import { periksaSinkron } from "../src/lib/sinkron";
import { KODE_BARANG_LAIN } from "../src/lib/barangLainLain";
import { buatPesanan, buatPengiriman, buatFaktur, buatRetur } from "../src/lib/aksi/penjualan";
import { buatPenyesuaianPersediaan } from "../src/lib/aksi/persediaan";
import { hapusDokumen, type JenisDokumen } from "../src/lib/aksi/hapusDokumen";
import { aturPersetujuan, formulir, harusDitolak, jalankan, pastikan } from "./bantuan";

/*
 * P23: barang yang sama di beberapa baris dokumen penjualan (D2 §9.2 uji-baris-ganda, perbaikan pencocokan per id):
 *  1. pesanan EVENT dengan barang sama di dua seksi dan dua baris bebas; 2. SJ per baris; 3. faktur jalur ID hanya
 *  menyentuh baris pesanan dan baris SJ-nya; 4. kiriman rakitan ditolak; 5. faktur kedua menutup semua baris;
 *  6. retur jalur ID memakai harga baris faktur itu, jalur lama hanya bila barang tunggal di faktur; 7. hapus faktur
 *  jalur ID hanya membalik barisnya; 8. jalur lama pada pesanan bergaya lama tetap lolos dan hapusnya sama dengan
 *  cabang lama; 9. bersih-bersih dan sinkron.
 */

const K = "GND";
const sama = (x: unknown, harap: number | string) => D(x as Desimal).equals(D(harap));

async function bersihkan() {
  const pel = (await db.pelanggan.findMany({ where: { kode: { startsWith: `PLG-${K}` } }, select: { id: true } })).map((p) => p.id);
  const jurnalIds: string[] = [];
  const kumpul = (xs: { jurnalId: string | null }[]) => jurnalIds.push(...xs.flatMap((x) => (x.jurnalId ? [x.jurnalId] : [])));
  if (pel.length > 0) {
    const faktur = await db.fakturPenjualan.findMany({ where: { pelangganId: { in: pel } }, select: { id: true, jurnalId: true } });
    const fakturIds = faktur.map((f) => f.id);
    const retur = await db.returPenjualan.findMany({ where: { fakturId: { in: fakturIds } }, select: { id: true, jurnalId: true } });
    const pesanan = await db.pesananPenjualan.findMany({ where: { pelangganId: { in: pel } }, select: { id: true } });
    const sj = await db.pengirimanPesanan.findMany({ where: { pesananId: { in: pesanan.map((p) => p.id) } }, select: { id: true, jurnalId: true } });
    for (const xs of [faktur, retur, sj]) kumpul(xs);
    await db.barisReturPenjualan.deleteMany({ where: { returId: { in: retur.map((r) => r.id) } } });
    await db.returPenjualan.deleteMany({ where: { id: { in: retur.map((r) => r.id) } } });
    await db.barisFakturPenjualan.deleteMany({ where: { fakturId: { in: fakturIds } } });
    await db.fakturPenjualan.deleteMany({ where: { id: { in: fakturIds } } });
    await db.barisPengiriman.deleteMany({ where: { pengirimanId: { in: sj.map((s) => s.id) } } });
    await db.pengirimanPesanan.deleteMany({ where: { id: { in: sj.map((s) => s.id) } } });
    await db.rencanaTermin.deleteMany({ where: { pesananId: { in: pesanan.map((p) => p.id) } } });
    await db.barisPesananPenjualan.deleteMany({ where: { pesananId: { in: pesanan.map((p) => p.id) } } });
    await db.pesananPenjualan.deleteMany({ where: { id: { in: pesanan.map((p) => p.id) } } });
  }
  const barang = await db.barang.findMany({ where: { kode: { startsWith: `BRG-${K}` } }, select: { id: true } });
  const ps = await db.penyesuaianPersediaan.findMany({ where: { baris: { some: { barangId: { in: barang.map((b) => b.id) } } } }, select: { id: true, jurnalId: true } });
  kumpul(ps);
  await db.barisPenyesuaianPersediaan.deleteMany({ where: { penyesuaianId: { in: ps.map((p) => p.id) } } });
  await db.penyesuaianPersediaan.deleteMany({ where: { id: { in: ps.map((p) => p.id) } } });
  await db.barisJurnal.deleteMany({ where: { jurnalId: { in: jurnalIds } } });
  await db.jurnal.deleteMany({ where: { id: { in: jurnalIds } } });
  await db.stokBarang.deleteMany({ where: { barangId: { in: barang.map((b) => b.id) } } });
  await db.barang.deleteMany({ where: { id: { in: barang.map((b) => b.id) } } });
  await db.gudang.deleteMany({ where: { kode: `WH-${K}` } });
  await db.akun.deleteMany({ where: { kode: { startsWith: `UJI-${K}` } } });
  await db.pelanggan.deleteMany({ where: { kode: { startsWith: `PLG-${K}` } } });
}

async function main() {
  await bersihkan();
  aturPersetujuan(false);
  const mulaiUji = new Date();
  const sinkronAwal = await periksaSinkron(db);
  const jurnalAwal = await db.jurnal.count();
  const lainLainAwal = await db.barang.findUnique({ where: { kode: KODE_BARANG_LAIN }, select: { id: true } });
  try {
    await uji();
  } finally {
    await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji }, penggunaNama: "Skrip Uji" } });
    await bersihkan();
    if (!lainLainAwal) {
      const dipakai =
        (await db.barisPenawaranPenjualan.count({ where: { barang: { kode: KODE_BARANG_LAIN } } })) +
        (await db.barisPesananPenjualan.count({ where: { barang: { kode: KODE_BARANG_LAIN } } })) +
        (await db.barisFakturPenjualan.count({ where: { barang: { kode: KODE_BARANG_LAIN } } }));
      if (dipakai === 0) await db.barang.deleteMany({ where: { kode: KODE_BARANG_LAIN } });
    }
  }
  pastikan(lainLainAwal !== null || (await db.barang.count({ where: { kode: KODE_BARANG_LAIN } })) === 0, "Barang JASA-LAIN buatan suite ini sudah dihapus");
  pastikan((await db.jurnal.count()) === jurnalAwal, "jumlah jurnal sama dengan sebelum uji");
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron seimbang dan sama dengan sebelum uji");
  console.log("=== DONE, all baris-ganda checks passed ===");
}

async function uji() {
  console.log("=== 1. Data dan pesanan EVENT dengan barang sama di dua seksi ===");
  const gudang = await db.gudang.create({ data: { kode: `WH-${K}`, nama: "Gudang Uji Baris Ganda" } });
  const barang = await db.barang.create({ data: { kode: `BRG-${K}`, nama: "Lampu Uji Baris Ganda", jenis: "BARANG", satuan: "unit", hargaBeli: 50_000, hargaJual: 100_000 } });
  const pelanggan = await db.pelanggan.create({ data: { kode: `PLG-${K}`, nama: "Klien Uji Baris Ganda" } });
  const modal = await db.akun.create({ data: { kode: `UJI-${K}-MODAL`, nama: "Modal Uji Baris Ganda", jenis: "MODAL" } });
  await jalankan("PS saldo awal 10 @ 50.000", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudang.id, akunLawanId: modal.id, baris: [{ barangId: barang.id, jumlahSesudah: 10, hargaSatuan: 50_000 }] })));
  const stok = async () => D((await db.stokBarang.findUnique({ where: { barangId_gudangId: { barangId: barang.id, gudangId: gudang.id } } }))?.jumlah ?? 0);

  // pesanan bergaya lama (STANDAR, barang tunggal) untuk bagian 4 dan 8
  await jalankan("PSJ lama STANDAR 4 @ 100.000", () => buatPesanan(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: barang.id, jumlah: 4, harga: 100_000 }] })));
  const psjLama = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id }, include: { baris: true } });
  await jalankan("PSJ EVENT: A 2 @ 100.000 (Hari 1), B 3 @ 200.000 (Hari 2), dua baris bebas", () =>
    buatPesanan(
      formulir({
        pelangganId: pelanggan.id,
        mode: "EVENT",
        ppnPersen: 0,
        baris: [
          { barangId: barang.id, jumlah: 2, harga: 100_000, bagian: "Hari 1" },
          { barangId: barang.id, jumlah: 3, harga: 200_000, bagian: "Hari 2" },
          { nama: "Sewa genset", jumlah: 1, harga: 500_000, bagian: "Produksi" },
          { nama: "Transport kru", jumlah: 1, harga: 300_000, bagian: "Transportasi" },
        ],
      }),
    ),
  );
  const psj = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id, mode: "EVENT" }, include: { baris: { orderBy: { urutan: "asc" }, include: { barang: true } } } });
  const [bA, bB, bC, bD] = psj.baris;
  pastikan(psj.baris.length === 4 && bA.barangId === bB.barangId && bA.bagian === "Hari 1" && bB.bagian === "Hari 2", "baris A dan B memakai barang yang sama di dua seksi");
  pastikan(bC.barang.kode === KODE_BARANG_LAIN && bD.barangId === bC.barangId && bC.nama === "Sewa genset" && bD.nama === "Transport kru", "baris C dan D sama-sama JASA-LAIN dengan nama berbeda");
  pastikan(sama(psj.total, 1_600_000), `total pesanan 200.000 + 600.000 + 500.000 + 300.000 = 1.600.000 (${psj.total})`);

  console.log("=== 2. SJ per baris ===");
  await jalankan("SJ A 2 dan B 3", () => buatPengiriman(formulir({ pesananId: psj.id, gudangId: gudang.id, baris: [{ barisPesananId: bA.id, barangId: barang.id, jumlah: 2 }, { barisPesananId: bB.id, barangId: barang.id, jumlah: 3 }] })));
  const sj = await db.pengirimanPesanan.findFirstOrThrow({ where: { pesananId: psj.id }, include: { baris: true } });
  const sjA = sj.baris.find((b) => b.barisPesananId === bA.id)!;
  const sjB = sj.baris.find((b) => b.barisPesananId === bB.id)!;
  pastikan((await stok()).equals(5) && sama(sjA.jumlah, 2) && sama(sjB.jumlah, 3), "stok 10 → 5, baris SJ A 2 dan B 3");
  const difakturSj = async (id: string) => D((await db.barisPengiriman.findUniqueOrThrow({ where: { id } })).jumlahDifaktur);
  const difakturBp = async (id: string) => D((await db.barisPesananPenjualan.findUniqueOrThrow({ where: { id } })).jumlahDifaktur);

  console.log("=== 3. Faktur 1 jalur ID: baris A saja ===");
  await jalankan("FJ1 A 2", () => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, baris: [{ barisPesananId: bA.id, barangId: barang.id, jumlah: 2 }] })));
  const fj1 = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj.id }, include: { baris: true } });
  pastikan((await difakturBp(bA.id)).equals(2) && (await difakturBp(bB.id)).isZero(), "baris pesanan A difaktur 2, B tetap 0 (tidak menumpuk di baris pertama)");
  pastikan(sama(fj1.baris[0].nilaiTransit, 100_000) && fj1.baris[0].barisPesananId === bA.id && sama(fj1.total, 200_000), "nilai transit faktur 1 = 2 × harga pokok SJ baris A");
  pastikan((await difakturSj(sjA.id)).equals(2) && (await difakturSj(sjB.id)).isZero(), "faktur 1 hanya mengonsumsi baris SJ A");

  console.log("=== 4. Kiriman rakitan ditolak ===");
  await harusDitolak("dua baris B @ 3 (kumulatif 6)", () => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, baris: [{ barisPesananId: bB.id, jumlah: 3 }, { barisPesananId: bB.id, jumlah: 3 }] })), "melebihi sisa yang belum ditagih (sisa 3, diminta 6)");
  await harusDitolak("baris pesanan lain", () => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, baris: [{ barisPesananId: psjLama.baris[0].id, jumlah: 1 }] })), "Baris pesanan tidak ditemukan di pesanan ini");
  await harusDitolak("campuran berid dan tanpa id", () => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, baris: [{ barisPesananId: bB.id, jumlah: 1 }, { barangId: barang.id, jumlah: 1, harga: 200_000 }] })), "semuanya memakai baris pesanan");
  await harusDitolak("jalur lama pada pesanan ini", () => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, baris: [{ barangId: barang.id, jumlah: 1, harga: 200_000 }] })), "wajib dibuat dari komposer faktur");
  pastikan((await db.fakturPenjualan.count({ where: { pesananId: psj.id } })) === 1 && (await difakturBp(bB.id)).isZero(), "kiriman yang ditolak tidak menyimpan faktur");

  console.log("=== 5. Faktur 2: B 3, C 1, D 1 ===");
  await jalankan("FJ2 B 3, C 1, D 1", () => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, baris: [{ barisPesananId: bB.id, jumlah: 3 }, { barisPesananId: bC.id, jumlah: 1 }, { barisPesananId: bD.id, jumlah: 1 }] })));
  const fj2 = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj.id, NOT: { id: fj1.id } }, include: { baris: { orderBy: { urutan: "asc" } } } });
  pastikan(sama(fj2.total, 1_400_000) && fj2.baris.map((b) => b.barisPesananId).join() === [bB.id, bC.id, bD.id].join() && fj2.baris[1].nama === "Sewa genset", "faktur 2 total 1.400.000, satu baris faktur per baris pesanan");
  const barisPsj = await db.barisPesananPenjualan.findMany({ where: { pesananId: psj.id } });
  // ekspresi daftar pesanan (src/app/(aplikasi)/penjualan/pesanan/page.tsx): difaktur semua
  const difakturSemua = barisPsj.every((l) => Number(l.jumlahDifaktur) >= Number(l.jumlah));
  pastikan(difakturSemua, "daftar pesanan menganggap pesanan difaktur semua");
  pastikan(sama(fj2.baris[0].nilaiTransit, 150_000) && (await difakturSj(sjB.id)).equals(3) && (await difakturSj(sjA.id)).equals(2), "faktur 2 mengonsumsi baris SJ B saja (transit 150.000)");

  console.log("=== 6. Retur jalur ID dan jalur lama ===");
  const fbB = fj2.baris[0];
  await jalankan("RJ1 jalur ID baris B 1 unit", () => buatRetur(formulir({ fakturId: fj2.id, gudangId: gudang.id, baris: [{ barisFakturId: fbB.id, barangId: barang.id, jumlah: 1 }] })));
  const rj1 = await db.returPenjualan.findFirstOrThrow({ where: { fakturId: fj2.id }, include: { baris: true } });
  pastikan(sama(rj1.total, 200_000) && rj1.baris[0].barisFakturId === fbB.id, `retur baris B bernilai 200.000, bukan 100.000 milik baris A (${rj1.total})`);
  await harusDitolak("retur baris B 3 lagi", () => buatRetur(formulir({ fakturId: fj2.id, gudangId: gudang.id, baris: [{ barisFakturId: fbB.id, jumlah: 3 }] })), "maks 2");
  await jalankan("RJ2 jalur lama barang tunggal di faktur 2", () => buatRetur(formulir({ fakturId: fj2.id, gudangId: gudang.id, baris: [{ barangId: barang.id, jumlah: 1 }] })));
  const rj2 = await db.returPenjualan.findFirstOrThrow({ where: { fakturId: fj2.id, NOT: { id: rj1.id } }, include: { baris: true } });
  pastikan(sama(rj2.total, 200_000) && rj2.baris[0].barisFakturId === fbB.id, "retur jalur lama mengisi barisFakturId baris B dan memakai harganya");
  pastikan((await stok()).equals(7), "dua retur barang menambah stok 5 → 7");
  // pesanan lama yang rusak (barang ganda di STANDAR): jalur lama ditolak, jalur ID lolos; retur jalur lama atas faktur gabungan ditolak
  await jalankan("PSJ STANDAR barang ganda 1 @ 100.000 + 1 @ 150.000", () => buatPesanan(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: barang.id, jumlah: 1, harga: 100_000 }, { barangId: barang.id, jumlah: 1, harga: 150_000 }] })));
  const psj3 = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id, mode: "STANDAR", total: 250_000 }, include: { baris: { orderBy: { urutan: "asc" } } } });
  await harusDitolak("jalur lama pada pesanan STANDAR berbarang ganda", () => buatFaktur(formulir({ pesananId: psj3.id, ppnPersen: 0, baris: [{ barangId: barang.id, jumlah: 1, harga: 100_000 }] })), "wajib dibuat dari komposer faktur");
  await jalankan("FJ3 gabungan A' dan B' jalur ID", () => buatFaktur(formulir({ pesananId: psj3.id, ppnPersen: 0, baris: psj3.baris.map((b) => ({ barisPesananId: b.id, jumlah: 1 })) })));
  const fj3 = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj3.id } });
  pastikan(sama(fj3.total, 250_000), "faktur gabungan 250.000");
  await harusDitolak("retur jalur lama atas faktur gabungan", () => buatRetur(formulir({ fakturId: fj3.id, gudangId: gudang.id, baris: [{ barangId: barang.id, jumlah: 1 }] })), "pilih baris faktur yang diretur");

  console.log("=== 7. Hapus faktur 2 hanya membalik baris B, C, D ===");
  await jalankan("hapus RJ2", () => hapusDokumen("returPenjualan", rj2.id));
  await jalankan("hapus RJ1", () => hapusDokumen("returPenjualan", rj1.id));
  await jalankan("hapus FJ2", () => hapusDokumen("faktur", fj2.id));
  pastikan((await difakturBp(bA.id)).equals(2) && (await difakturBp(bB.id)).isZero() && (await difakturBp(bC.id)).isZero() && (await difakturBp(bD.id)).isZero(), "baris A tetap 2; B, C, D kembali 0");
  pastikan((await difakturSj(sjB.id)).isZero() && (await difakturSj(sjA.id)).equals(2), "baris SJ B kembali 0; baris SJ A tidak tersentuh");
  pastikan((await stok()).equals(5), "stok kembali 5 sesudah retur dihapus");

  console.log("=== 8. Jalur lama pada pesanan bergaya lama ===");
  const bpLama = psjLama.baris[0];
  await jalankan("SJ pesanan lama 4", () => buatPengiriman(formulir({ pesananId: psjLama.id, gudangId: gudang.id, baris: [{ barisPesananId: bpLama.id, barangId: barang.id, jumlah: 4 }] })));
  const sjLama = await db.pengirimanPesanan.findFirstOrThrow({ where: { pesananId: psjLama.id }, include: { baris: true } });
  const putaran = async (cabangLama: boolean) => {
    await jalankan(`FJ jalur lama 3 @ 100.000 (${cabangLama ? "lalu dihapus lewat cabang lama" : "lalu dihapus lewat cabang id"})`, () => buatFaktur(formulir({ pesananId: psjLama.id, ppnPersen: 0, baris: [{ barangId: barang.id, jumlah: 3, harga: 100_000 }] })));
    const f = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psjLama.id }, include: { baris: true } });
    pastikan(f.baris[0].barisPesananId === bpLama.id && sama(f.baris[0].frekuensi, 1) && sama(f.baris[0].nilaiTransit, 150_000), "jalur lama mengisi barisPesananId, frekuensi 1, transit 3 × 50.000");
    const sesudahBuat = [await difakturBp(bpLama.id), await difakturSj(sjLama.baris[0].id)].map(String).join();
    // baris faktur lama (sebelum migrasi) tidak punya barisPesananId: hapus memakai kode lama per barangId
    if (cabangLama) await db.barisFakturPenjualan.updateMany({ where: { fakturId: f.id }, data: { barisPesananId: null } });
    await jalankan(`hapus faktur lama (${cabangLama ? "cabang barangId" : "cabang id"})`, () => hapusDokumen("faktur", f.id));
    return { sesudahBuat, sesudahHapus: [await difakturBp(bpLama.id), await difakturSj(sjLama.baris[0].id)].map(String).join() };
  };
  const cabangId = await putaran(false);
  const cabangLama = await putaran(true);
  pastikan(cabangId.sesudahBuat === "3,3" && JSON.stringify(cabangId) === JSON.stringify(cabangLama) && cabangId.sesudahHapus === "0,0", `hapus cabang id sama dengan cabang lama (${JSON.stringify(cabangId)} vs ${JSON.stringify(cabangLama)})`);

  console.log("=== 9. Bersih-bersih ===");
  const hapus = (jenis: JenisDokumen, id: string, label: string) => jalankan(`hapus ${label}`, () => hapusDokumen(jenis, id));
  await hapus("faktur", fj3.id, "FJ3");
  await hapus("faktur", fj1.id, "FJ1");
  await hapus("pengiriman", sj.id, "SJ pesanan EVENT");
  await hapus("pengiriman", sjLama.id, "SJ pesanan lama");
  await hapus("pesanan", psj.id, "pesanan EVENT");
  await hapus("pesanan", psj3.id, "pesanan barang ganda");
  await hapus("pesanan", psjLama.id, "pesanan lama");
  const ps = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { baris: { some: { barangId: barang.id } } } });
  await hapus("penyesuaian", ps.id, "PS saldo awal");
  const s = await periksaSinkron(db);
  pastikan(s.seimbang && s.persediaan.sinkron && s.piutang.sinkron && s.barangTerkirim.sinkron, "periksaSinkron sinkron sesudah dokumen uji dihapus");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
