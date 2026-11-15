import "dotenv/config";
// Skrip ini memanggil aksi server dan komponen server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { db } from "../src/lib/db";
import type { Hak, PenggunaSesi } from "../src/lib/hakAkses";
import { penggunaSaatIni } from "../src/lib/otentikasi";
import { periksaSinkron } from "../src/lib/sinkron";
import { ubahRencanaTermin, terbitkanTagihanTermin } from "../src/lib/aksi/dokumenPenjualan";
import { simpanPdfDokumen } from "../src/lib/aksi/pdfPenjualan";
import { buatPenawaran, konversiPenawaranKePesanan } from "../src/lib/aksi/penjualan";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import TagihanTerminTersimpan from "../src/komponen/penjualan/TagihanTerminTersimpan";
import TombolCetakDokumen from "../src/komponen/penjualan/TombolCetakDokumen";
import LampiranBerkas from "../src/komponen/berkas/LampiranBerkas";
import PanelCetak from "../src/komponen/cetak/PanelCetak";
import { aturPersetujuan, formulir, harusDitolak, jalankan, pastikan } from "./bantuan";

/*
 * Uji tagihan termin tersimpan di halaman detail pesanan (sisa P45): komponen TagihanTerminTersimpan memasang
 * TombolCetakDokumen (panel Cetak dengan Simpan PDF ke Lampiran) dan LampiranBerkas jenis rencana-termin per butir.
 *  1. Positif: butir yang sudah ditagih mendapat tombol Cetak dan daftar lampiran; PDF yang disimpan lewat aksi masuk
 *     ke lampiran butir itu (tag DOKUMEN); butir yang belum ditagih tersembunyi sampai punya berkas.
 *  2. Negatif: tanpa hak lihat pesanan komponen tidak menampilkan apa pun; tanpa hak unggah panel tanpa Simpan;
 *     butir kosong atau butir yang tidak ada tidak menampilkan apa pun.
 *  3. Hak akses: GUDANG tidak dapat menyimpan PDF tagihan termin dan LampiranBerkas butir tidak tampil baginya.
 * Data uji berawalan LTM; berkas uji dihapus permanen, periksaSinkron sama di awal dan akhir. Tidak ada baris
 * HakAksesPeran yang dibuat: pengguna tanpa hak tertentu dibentuk langsung sebagai PenggunaSesi.
 */

const K = "LTM";

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

const tanpaHak = (p: PenggunaSesi, ...buang: Hak[]): PenggunaSesi => ({ ...p, hak: p.hak.filter((h) => !buang.includes(h)) });

/** Semua elemen bertipe tertentu di pohon hasil komponen async (renderToStaticMarkup tidak bisa merender komponen async). */
function cariSemua(n: ReactNode, tipe: unknown, hasil: ReactElement<Record<string, unknown>>[] = []): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(n)) {
    for (const x of n) cariSemua(x, tipe, hasil);
    return hasil;
  }
  if (!isValidElement(n)) return hasil;
  if (n.type === tipe) hasil.push(n as ReactElement<Record<string, unknown>>);
  return cariSemua((n.props as { children?: ReactNode }).children, tipe, hasil);
}

async function bersihkan() {
  const pelanggan = { pelanggan: { kode: `CUST-${K}` } };
  const terbaru = { orderBy: [{ tanggal: "desc" as const }, { nomor: "desc" as const }], select: { id: true, nomor: true } };
  const pnw = await db.penawaranPenjualan.findMany({ where: pelanggan, ...terbaru });
  const psj = await db.pesananPenjualan.findMany({ where: pelanggan, ...terbaru });
  const termin = await db.rencanaTermin.findMany({ where: { OR: [{ pesanan: pelanggan }, { penawaran: pelanggan }] }, select: { id: true } });
  await db.berkas.deleteMany({ where: { entitasId: { in: [...pnw, ...psj, ...termin].map((d) => d.id) } } });
  for (const d of psj) await jalankan(`hapus ${d.nomor}`, () => hapusDokumen("pesanan", d.id)).catch((e: unknown) => console.warn(`[bersih] ${d.nomor}: ${(e as Error).message}`));
  for (const d of pnw) await jalankan(`hapus ${d.nomor}`, () => hapusDokumen("penawaran", d.id)).catch((e: unknown) => console.warn(`[bersih] ${d.nomor}: ${(e as Error).message}`));
  await db.barang.deleteMany({ where: { kode: { startsWith: `JSA-${K}` } } });
  await db.pelanggan.deleteMany({ where: { kode: `CUST-${K}` } });
}

async function main() {
  await bersihkan();
  aturPersetujuan(false);
  const berkasAwal = await db.berkas.count();
  const hakAwal = await db.hakAksesPeran.count();
  const jurnalAwal = await db.jurnal.count();
  const sinkronAwal = await periksaSinkron(db);

  const pelanggan = await db.pelanggan.create({ data: { kode: `CUST-${K}`, nama: "Klien Uji Lampiran Termin" } });
  const jasa = await db.barang.create({ data: { kode: `JSA-${K}-1`, nama: "Jasa Uji Lampiran Termin", jenis: "JASA", hargaBeli: 0, hargaJual: 1_000_000 } });

  try {
    const pemilik = (await penggunaSaatIni())!;
    await jalankan("PNW 4.000.000", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: jasa.id, jumlah: 4, harga: 1_000_000 }] })));
    const pnw = await db.penawaranPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id } });
    await jalankan("konversi ke PSJ", () => konversiPenawaranKePesanan(pnw.id));
    const psj = await db.pesananPenjualan.findFirstOrThrow({ where: { penawaranId: pnw.id } });
    await jalankan("rencana termin DP 40% + Pelunasan", () => ubahRencanaTermin("pesanan", psj.id, formulir({ rencanaTermin: [{ label: "DP", nilai: 40 }, { label: "Pelunasan" }] })));
    const butirLunas0 = await db.rencanaTermin.findFirstOrThrow({ where: { pesananId: psj.id, no: 2 } });
    await jalankan("terbitkan tagihan Pelunasan", () => terbitkanTagihanTermin(butirLunas0.id, formulir({})));
    const butir = () => db.rencanaTermin.findMany({ where: { pesananId: psj.id }, orderBy: { no: "asc" }, select: { id: true, no: true, label: true, nomorCetak: true, ditagihPada: true } });
    const [butirDp, butirLunas] = await butir();
    const rakit = async (p: PenggunaSesi) => TagihanTerminTersimpan({ butir: await butir(), pengguna: p });
    const idLampiran = (n: ReactNode) => cariSemua(n, LampiranBerkas).map((e) => e.props.entitasId);
    const idTombol = (n: ReactNode) => cariSemua(n, TombolCetakDokumen).map((e) => e.props.id);

    console.log("=== 1. Positif ===");
    let p = await rakit(pemilik);
    pastikan(idTombol(p).join() === butirLunas.id && idLampiran(p).join() === butirLunas.id, "PEMILIK: hanya butir yang sudah ditagih mendapat tombol Cetak dan daftar lampiran");
    const tombol = cariSemua(p, TombolCetakDokumen)[0];
    pastikan(tombol.props.jenis === "tagihan-termin" && (tombol.props.pengguna as PenggunaSesi).id === pemilik.id, "tombol Cetak berjenis tagihan-termin");
    const lampiran = cariSemua(p, LampiranBerkas)[0];
    pastikan(lampiran.props.jenisEntitas === "rencana-termin", "daftar lampiran memakai jenis rencana-termin");

    await jalankan("PEMILIK simpan PDF tagihan termin", () => simpanPdfDokumen("tagihan-termin", butirLunas.id, formulir({ ukuran: "A4", ttd: "1" })));
    const berkas = await db.berkas.findMany({ where: { jenisEntitas: "rencana-termin", entitasId: butirLunas.id }, include: { isi: true } });
    pastikan(berkas.length === 1 && berkas[0].tag === "DOKUMEN" && berkas[0].tipeMime === "application/pdf" && Buffer.from(berkas[0].isi!.isi).subarray(0, 5).toString("latin1") === "%PDF-", "PDF tagihan tersimpan sebagai berkas DOKUMEN di lampiran butir");
    const panel = await TombolCetakDokumen({ jenis: "tagihan-termin", id: butirLunas.id, pengguna: pemilik });
    pastikan(!!panel && cariSemua(panel, PanelCetak).some((e) => typeof e.props.aksiSimpan === "function"), "panel tagihan termin memuat aksi Simpan PDF ke Lampiran bagi PEMILIK");

    // butir yang belum ditagih muncul bila sudah punya berkas yang terlihat
    pastikan(!idLampiran(await rakit(pemilik)).includes(butirDp.id), "butir yang belum ditagih dan tanpa berkas tidak tampil");
    await db.berkas.updateMany({ where: { id: berkas[0].id }, data: { entitasId: butirDp.id } });
    p = await rakit(pemilik);
    pastikan(idLampiran(p).includes(butirDp.id) && !idTombol(p).includes(butirDp.id), "butir belum ditagih yang punya berkas tampil tanpa tombol Cetak");
    await db.berkas.updateMany({ where: { id: berkas[0].id }, data: { entitasId: butirLunas.id } });

    console.log("=== 2. Negatif ===");
    pastikan((await rakit(tanpaHak(pemilik, "pesanan.lihat"))) === null, "tanpa pesanan.lihat: komponen tidak menampilkan apa pun");
    pastikan((await TagihanTerminTersimpan({ butir: [], pengguna: pemilik })) === null, "tanpa butir: tidak menampilkan apa pun");
    const tanpaUnggah = tanpaHak(pemilik, "pesanan.buat", "pesanan.ubah", "berkas.buat", "berkas.akses-penuh");
    const tUnggah = await TombolCetakDokumen({ jenis: "tagihan-termin", id: butirLunas.id, pengguna: tanpaUnggah });
    pastikan(!!tUnggah && cariSemua(tUnggah, PanelCetak).every((e) => e.props.aksiSimpan === undefined), "tanpa hak unggah: panel tanpa Simpan PDF ke Lampiran");
    pastikan((await TombolCetakDokumen({ jenis: "tagihan-termin", id: "tidak-ada", pengguna: pemilik })) === null, "butir tidak ada: tombol tidak tampil");

    console.log("=== 3. Hak akses ===");
    await sebagaiPeran("GUDANG", () => harusDitolak("GUDANG simpan PDF tagihan termin", () => simpanPdfDokumen("tagihan-termin", butirLunas.id, formulir({})), "tidak punya hak"));
    pastikan((await db.berkas.count({ where: { entitasId: butirLunas.id } })) === 1, "penolakan tidak menyimpan berkas");
    const gudang = await sebagaiPeran("GUDANG", async () => (await penggunaSaatIni())!);
    pastikan((await rakit(gudang)) === null, "GUDANG: komponen tidak menampilkan apa pun");
    pastikan((await sebagaiPeran("GUDANG", () => LampiranBerkas({ jenisEntitas: "rencana-termin", entitasId: butirLunas.id }))) === null, "GUDANG: LampiranBerkas butir tidak tampil");
    pastikan((await sebagaiPeran("PEMILIK", () => LampiranBerkas({ jenisEntitas: "rencana-termin", entitasId: butirLunas.id }))) !== null, "PEMILIK: LampiranBerkas butir tampil");
  } finally {
    await bersihkan();
  }

  console.log("=== 4. Bersih-bersih ===");
  pastikan((await db.berkas.count()) === berkasAwal, "berkas uji dihapus permanen");
  pastikan((await db.jurnal.count()) === jurnalAwal, "jumlah jurnal kembali seperti awal");
  pastikan((await db.hakAksesPeran.count()) === hakAwal, "HakAksesPeran sama dengan awal");
  pastikan(JSON.stringify(await periksaSinkron(db)) === JSON.stringify(sinkronAwal), "periksaSinkron sama dengan awal");
  console.log("=== DONE, all lampiran-termin checks passed ===");
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
