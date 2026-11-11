import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { D, type Desimal } from "../src/lib/uang";
import { periksaSinkron } from "../src/lib/sinkron";
import { buatPenawaran, konversiPenawaranKePesanan, buatPesanan, buatFaktur, buatPenerimaan, buatUangMuka } from "../src/lib/aksi/penjualan";
import { ubahPenawaran, ubahRencanaTermin, ubahStatusPenawaran, ubahTampilanDokumen, simpanPengaturanDokumenPenjualan } from "../src/lib/aksi/dokumenPenjualan";
import { KODE_BARANG_LAIN } from "../src/lib/barangLainLain";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { aturPersetujuan, formulir, harusDitolak, jalankan, pastikan } from "./bantuan";

/*
 * P25: ubah setelah simpan (D2 §9.2 uji-tampilan-dokumen): daftar putih ubahTampilanDokumen dan lognya, validasi teks
 * dan kop, teks baris, nomor cetak faktur disetujui, ubahPenawaran draf (baris, total, rencana termin diselesaikan
 * ulang), status komersial dan konversi, pengaturan dokumen penjualan, hak per jenis, dan bersih-bersih.
 * Perbaikan tinjauan P25: ganti nama baris lewat tampilan butuh harga.nego seperti buat (S1), sesi diperiksa sebelum
 * jenis (R3), jatuh tempo tidak sebelum tanggal faktur (R4), dan penawaran perusahaan arsip tidak bisa diubah (R5).
 */

const K = "UJITMP";
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
  await db.kopSurat.deleteMany({ where: { nama: { startsWith: K } } });
  await db.barang.deleteMany({ where: { kode: { startsWith: `JS-${K}` } } });
  await db.pelanggan.deleteMany({ where: { kode: { startsWith: `PLG-${K}` } } });
  await db.akun.deleteMany({ where: { kode: { startsWith: `UJI-${K}` } } });
}

async function main() {
  await bersihkan();
  aturPersetujuan(false);
  const mulaiUji = new Date();
  const sinkronAwal = await periksaSinkron(db);
  const jurnalAwal = await db.jurnal.count();
  const pengaturanAwal = await db.pengaturanDokumenPenjualan.findUnique({ where: { perusahaanId: "utama" } });
  const lainLainAwal = await db.barang.findUnique({ where: { kode: KODE_BARANG_LAIN }, select: { id: true } });
  const hakAwal = await db.hakAksesPeran.count();
  try {
    await uji(mulaiUji);
  } finally {
    await bersihkan();
    // pengaturan dokumen utama dipulihkan persis (atau dihapus bila sebelumnya tidak ada)
    if (pengaturanAwal) {
      const { syaratPembayaran, tampilanEvent, daftarSeksi, teksPembukaPenawaran, teksPenutupPenawaran } = pengaturanAwal;
      await db.pengaturanDokumenPenjualan.update({ where: { perusahaanId: "utama" }, data: { syaratPembayaran, tampilanEvent, daftarSeksi, teksPembukaPenawaran, teksPenutupPenawaran } });
    } else await db.pengaturanDokumenPenjualan.deleteMany({ where: { perusahaanId: "utama" } });
    await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji }, penggunaNama: "Skrip Uji" } });
    // Barang JASA-LAIN yang dibuat baris bebas suite ini dibuang lagi bila tidak dipakai dokumen lain
    if (!lainLainAwal) {
      const dipakai =
        (await db.barisPenawaranPenjualan.count({ where: { barang: { kode: KODE_BARANG_LAIN } } })) +
        (await db.barisPesananPenjualan.count({ where: { barang: { kode: KODE_BARANG_LAIN } } })) +
        (await db.barisFakturPenjualan.count({ where: { barang: { kode: KODE_BARANG_LAIN } } }));
      if (dipakai === 0) await db.barang.deleteMany({ where: { kode: KODE_BARANG_LAIN } });
    }
  }
  pastikan((await db.hakAksesPeran.count()) === hakAwal, "HakAksesPeran sama dengan sebelum uji");
  pastikan((await db.jurnal.count()) === jurnalAwal, "jumlah jurnal sama dengan sebelum uji");
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron seimbang dan sama dengan sebelum uji");
  console.log("=== DONE, all tampilan-dokumen checks passed ===");
}

async function uji(mulaiUji: Date) {
  const pelanggan = await db.pelanggan.create({ data: { kode: `PLG-${K}`, nama: "Klien Uji Tampilan" } });
  const jasa = await db.barang.create({ data: { kode: `JS-${K}`, nama: "Jasa Uji Tampilan", jenis: "JASA", satuan: "paket", hargaBeli: 0, hargaJual: 100_000, perusahaanId: null } });
  const kas = await db.akun.create({ data: { kode: `UJI-${K}-KAS`, nama: "Kas Uji Tampilan", jenis: "ASET", kasBank: true } });
  const kopUtama = await db.kopSurat.create({ data: { perusahaanId: "utama", nama: `${K} Kop Utama` } });
  const kopLain = await db.kopSurat.create({ data: { perusahaanId: "tapussa", nama: `${K} Kop Tapussa` } });
  const log = (aksi: string, entitasId: string) => db.logAktivitas.findMany({ where: { aksi, entitasId, modul: "penjualan", waktu: { gte: mulaiUji } }, orderBy: { waktu: "asc" } });

  // dokumen dasar: pesanan, faktur, penerimaan, uang muka
  await jalankan("PSJ dua baris", () => buatPesanan(formulir({ pelangganId: pelanggan.id, ppnPersen: 0, perihal: "Lama", baris: [{ barangId: jasa.id, jumlah: 2, harga: 100_000 }, { barangId: jasa.id, jumlah: 1, harga: 150_000 }] })));
  const psj = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id }, include: { baris: { orderBy: { urutan: "asc" } } } });
  await jalankan("UM pesanan", () => buatUangMuka(formulir({ pesananId: psj.id, akunId: kas.id, jumlah: 50_000 })));
  const um = await db.uangMukaPelanggan.findFirstOrThrow({ where: { pesananId: psj.id } });
  await jalankan("FJ jalur ID baris pertama", () => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, baris: [{ barisPesananId: psj.baris[0].id, jumlah: 2 }] })));
  const fj = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj.id }, include: { baris: true } });
  await jalankan("TRM", () => buatPenerimaan(formulir({ fakturId: fj.id, akunId: kas.id, jumlah: 10_000 })));
  const trm = await db.penerimaanPenjualan.findFirstOrThrow({ where: { fakturId: fj.id } });

  console.log("=== 1. Daftar putih ubahTampilanDokumen ===");
  await jalankan("faktur: perihal, judul cetak, kiriman total dan diskon", () => ubahTampilanDokumen("faktur", fj.id, formulir({ perihal: "Baru", judulCetak: "PROFORMA INVOICE", total: 1, diskon: 5 })));
  const fj1 = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fj.id } });
  pastikan(fj1.perihal === "Baru" && fj1.judulCetak === "PROFORMA INVOICE" && s2(fj1.total) === s2(fj.total) && s2(fj1.diskon) === s2(fj.diskon), "perihal dan judul berubah; total dan diskon tidak (daftar putih)");
  const [l1] = await log("UBAH_TAMPILAN", fj.id);
  const meta1 = l1?.meta as { kolom?: string[]; dari?: Record<string, unknown>; ke?: Record<string, unknown> } | undefined;
  pastikan(JSON.stringify(meta1?.kolom) === JSON.stringify(["perihal", "judulCetak"]) && meta1?.dari?.perihal === "Lama" && meta1?.ke?.perihal === "Baru", `log UBAH_TAMPILAN meta.kolom = perihal, judulCetak (${JSON.stringify(meta1?.kolom)})`);
  await jalankan("faktur: jatuh tempo dan tampilan event kosong diabaikan", () => ubahTampilanDokumen("faktur", fj.id, formulir({ jatuhTempo: "", tampilanEvent: "" })));
  pastikan((await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fj.id } })).jatuhTempo?.getTime() === fj.jatuhTempo?.getTime(), "jatuh tempo kosong tidak mengosongkan kolom");
  await jalankan("faktur: jatuh tempo baru", () => ubahTampilanDokumen("faktur", fj.id, formulir({ jatuhTempo: "2030-01-15" })));
  pastikan((await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fj.id } })).jatuhTempo?.getDate() === 15, "jatuh tempo faktur diubah");
  // tinjauan P25 R4: aturan yang sama dengan buat faktur
  await harusDitolak("faktur: jatuh tempo sebelum tanggal faktur", () => ubahTampilanDokumen("faktur", fj.id, formulir({ jatuhTempo: "2020-01-01" })), "Jatuh tempo tidak boleh sebelum tanggal faktur");
  pastikan((await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fj.id } })).jatuhTempo?.getDate() === 15, "jatuh tempo yang ditolak tidak tersimpan");

  console.log("=== 2. Validasi teks dan kop ===");
  await harusDitolak("perihal 201 karakter", () => ubahTampilanDokumen("faktur", fj.id, formulir({ perihal: "p".repeat(201) })), "Perihal maksimal 200 karakter");
  await harusDitolak("email tujuan salah", () => ubahTampilanDokumen("pesanan", psj.id, formulir({ kepadaEmail: "bukan-email" })), "Email tujuan tidak valid");
  await harusDitolak("kop perusahaan lain", () => ubahTampilanDokumen("faktur", fj.id, formulir({ kopSuratId: kopLain.id })), "bukan milik perusahaan dokumen");
  await jalankan("kop milik perusahaan dokumen", () => ubahTampilanDokumen("faktur", fj.id, formulir({ kopSuratId: kopUtama.id })));
  pastikan((await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fj.id } })).kopSuratId === kopUtama.id, "kop faktur diganti");
  await harusDitolak("jenis tidak dikenal", () => ubahTampilanDokumen("retur" as never, fj.id, formulir({ perihal: "x" })), "Jenis dokumen tidak dikenal");
  await harusDitolak("dokumen tidak ada", () => ubahTampilanDokumen("faktur", "tidak-ada", formulir({ perihal: "x" })), "Faktur Penjualan tidak ditemukan");
  // tinjauan P25 R3: tanpa sesi selalu ditolak sesi lebih dulu, termasuk untuk jenis yang tidak dikenal
  await denganEnv({ UJI_TANPA_SESI: undefined }, async () => {
    await harusDitolak("tanpa sesi, jenis tampilan tidak dikenal", () => ubahTampilanDokumen("retur" as never, fj.id, formulir({ perihal: "x" })), "Sesi sudah berakhir");
    await harusDitolak("tanpa sesi, rencana termin faktur", () => ubahRencanaTermin("faktur" as never, fj.id, formulir({})), "Sesi sudah berakhir");
  });
  await harusDitolak("rencana termin untuk faktur (dengan sesi)", () => ubahRencanaTermin("faktur" as never, fj.id, formulir({})), "Rencana termin hanya ada di penawaran dan pesanan");

  console.log("=== 3. Teks baris ===");
  const bf = fj.baris[0];
  await jalankan("baris faktur: nama dan deskripsi, harga diabaikan", () => ubahTampilanDokumen("faktur", fj.id, formulir({ baris: [{ id: bf.id, nama: "Paket Dokumentasi", deskripsi: "- foto\n- video", harga: 1 }] })));
  const bf1 = await db.barisFakturPenjualan.findUniqueOrThrow({ where: { id: bf.id } });
  pastikan(bf1.nama === "Paket Dokumentasi" && bf1.deskripsi === "- foto\n- video" && s2(bf1.harga) === s2(bf.harga) && s2(bf1.subtotal) === s2(bf.subtotal), "nama dan deskripsi baris berubah; harga dan nilai tetap");
  await harusDitolak("id baris dokumen lain", () => ubahTampilanDokumen("faktur", fj.id, formulir({ baris: [{ id: psj.baris[0].id, nama: "x" }] })), "Baris tidak ditemukan di dokumen ini");
  await jalankan("baris pesanan: urutan dan seksi", () => ubahTampilanDokumen("pesanan", psj.id, formulir({ baris: [{ id: psj.baris[1].id, urutan: 0 }, { id: psj.baris[0].id, urutan: 1, keterangan: "hari pertama" }] })));
  const bp = await db.barisPesananPenjualan.findMany({ where: { pesananId: psj.id }, orderBy: { urutan: "asc" } });
  pastikan(bp[0].id === psj.baris[1].id && bp[1].keterangan === "hari pertama", "urutan dan keterangan baris pesanan diubah");

  console.log("=== 3b. Ganti nama baris tanpa harga.nego (tinjauan P25 S1) ===");
  await jalankan("PSJ dengan baris bebas oleh PEMILIK", () => buatPesanan(formulir({ pelangganId: pelanggan.id, ppnPersen: 0, perihal: "Bebas", baris: [{ barangId: jasa.id, jumlah: 1, harga: 100_000 }, { nama: "Transport kru", jumlah: 1, harga: 50_000 }] })));
  const psjBebas = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id, perihal: "Bebas" }, include: { baris: { orderBy: { urutan: "asc" } } } });
  const [bKatalog, bBebas] = psjBebas.baris;
  const hakNegoKasirAwal = await db.hakAksesPeran.findUnique({ where: { peran_hak: { peran: "KASIR", hak: "harga.nego" } } });
  await db.hakAksesPeran.upsert({ where: { peran_hak: { peran: "KASIR", hak: "harga.nego" } }, create: { peran: "KASIR", hak: "harga.nego", boleh: false }, update: { boleh: false } });
  try {
    await sebagaiPeran("KASIR", async () => {
      await harusDitolak("KASIR tanpa nego mengganti nama baris katalog faktur", () => ubahTampilanDokumen("faktur", fj.id, formulir({ baris: [{ id: bf.id, nama: "Sound system 10 kW" }] })), "Mengganti nama barang Jasa Uji Tampilan butuh hak");
      await harusDitolak("KASIR tanpa nego mengganti nama baris katalog pesanan", () => ubahTampilanDokumen("pesanan", psjBebas.id, formulir({ baris: [{ id: bKatalog.id, nama: "Sound system 10 kW" }] })), "Mengganti nama barang Jasa Uji Tampilan butuh hak");
      await harusDitolak("KASIR tanpa nego mengganti nama baris bebas", () => ubahTampilanDokumen("pesanan", psjBebas.id, formulir({ baris: [{ id: bBebas.id, nama: "Sound system 10 kW" }] })), "Baris bebas (tanpa barang katalog) butuh hak");
      await jalankan("KASIR tanpa nego mengirim nama yang sama dengan deskripsi baru", () => ubahTampilanDokumen("faktur", fj.id, formulir({ baris: [{ id: bf.id, nama: "Paket Dokumentasi", deskripsi: "oleh kasir" }] })));
      await jalankan("KASIR tanpa nego mengembalikan nama ke nama katalog", () => ubahTampilanDokumen("pesanan", psjBebas.id, formulir({ baris: [{ id: bKatalog.id, nama: "Jasa Uji Tampilan" }, { id: bBebas.id, nama: "Transport kru", keterangan: "oleh kasir" }] })));
    });
  } finally {
    if (hakNegoKasirAwal) await db.hakAksesPeran.update({ where: { peran_hak: { peran: "KASIR", hak: "harga.nego" } }, data: { boleh: hakNegoKasirAwal.boleh } });
    else await db.hakAksesPeran.deleteMany({ where: { peran: "KASIR", hak: "harga.nego" } });
  }
  const bf2 = await db.barisFakturPenjualan.findUniqueOrThrow({ where: { id: bf.id } });
  const [bKatalog2, bBebas2] = await db.barisPesananPenjualan.findMany({ where: { pesananId: psjBebas.id }, orderBy: { urutan: "asc" } });
  pastikan(bf2.nama === "Paket Dokumentasi" && bf2.deskripsi === "oleh kasir", `nama yang tidak berubah tidak diperiksa; deskripsi tersimpan (${bf2.nama})`);
  pastikan(bKatalog2.nama === "Jasa Uji Tampilan" && bBebas2.nama === "Transport kru" && bBebas2.keterangan === "oleh kasir", "nama katalog dan nama baris bebas yang sama diterima");
  await sebagaiPeran("KASIR", () => jalankan("KASIR dengan nego bawaan mengganti nama baris bebas", () => ubahTampilanDokumen("pesanan", psjBebas.id, formulir({ baris: [{ id: bBebas.id, nama: "Transport kru dan alat" }] }))));
  pastikan((await db.barisPesananPenjualan.findUniqueOrThrow({ where: { id: bBebas.id } })).nama === "Transport kru dan alat", "pemegang harga.nego tetap boleh mengganti nama");

  console.log("=== 4. Nomor cetak faktur yang sudah disetujui ===");
  await sebagaiPeran("KASIR", () => harusDitolak("KASIR mengubah nomor cetak faktur disetujui", () => ubahTampilanDokumen("faktur", fj.id, formulir({ nomorCetak: `${K}/INV/1` })), "hanya bisa diubah pemegang hak setujui faktur"));
  await sebagaiPeran("KASIR", () => jalankan("KASIR mengubah perihal faktur (tanpa nomor cetak)", () => ubahTampilanDokumen("faktur", fj.id, formulir({ perihal: "Oleh kasir", nomorCetak: fj1.nomorCetak ?? "" }))));
  pastikan((await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fj.id } })).perihal === "Oleh kasir", "kasir boleh mengubah teks faktur disetujui");
  await jalankan("PEMILIK mengubah nomor cetak faktur", () => ubahTampilanDokumen("faktur", fj.id, formulir({ nomorCetak: `${K}/INV/1` })));
  pastikan((await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fj.id } })).nomorCetak === `${K}/INV/1`, "nomor cetak faktur diganti pemilik");
  await jalankan("PNW dengan nomor cetak manual", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, ppnPersen: 0, nomorCetak: `${K}/PNW/1`, baris: [{ barangId: jasa.id, jumlah: 1, harga: 100_000 }] })));
  await jalankan("nomor cetak kuitansi", () => ubahTampilanDokumen("penerimaan", trm.id, formulir({ nomorCetak: `${K}/KW/1`, terimaDari: "Bapak Uji" })));
  await harusDitolak("nomor cetak kuitansi bentrok", async () => {
    await buatPenerimaan(formulir({ fakturId: fj.id, akunId: kas.id, jumlah: 10_000, nomorCetak: `${K}/KW/2` })).catch((e) => {
      if (!String((e as { digest?: string })?.digest ?? "").startsWith("NEXT_REDIRECT") && !String((e as Error).message).includes("static generation")) throw e;
    });
    const trm2 = await db.penerimaanPenjualan.findFirstOrThrow({ where: { nomorCetak: `${K}/KW/2` } });
    await ubahTampilanDokumen("penerimaan", trm2.id, formulir({ nomorCetak: `${K}/KW/1` }));
  }, "sudah dipakai dokumen lain");

  console.log("=== 5. ubahPenawaran draf ===");
  await jalankan("PNW draf dengan termin", () =>
    buatPenawaran(formulir({ pelangganId: pelanggan.id, ppnPersen: 0, perihal: "Draf", baris: [{ barangId: jasa.id, jumlah: 1, harga: 100_000 }], rencanaTermin: [{ label: "DP", nilai: 50 }, { label: "Pelunasan" }] })),
  );
  const pnw = await db.penawaranPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id, perihal: "Draf" } });
  await jalankan("ubah penawaran: tiga unit, fee 10%", () =>
    ubahPenawaran(pnw.id, formulir({ pelangganId: pelanggan.id, ppnPersen: 0, jenisFee: "PERSEN", nilaiFee: 10, baris: [{ barangId: jasa.id, jumlah: 3, harga: 100_000 }], rencanaTermin: [{ label: "DP", nilai: 50 }, { label: "Pelunasan" }] })),
  );
  const pnw1 = await db.penawaranPenjualan.findUniqueOrThrow({ where: { id: pnw.id }, include: { baris: true, rencanaTermin: { orderBy: { no: "asc" } } } });
  pastikan(pnw1.nomor === pnw.nomor && s2(pnw1.total) === "330000.00" && pnw1.baris.length === 1 && s2(pnw1.baris[0].jumlah) === "3.00" && pnw1.perihal === "Draf", `baris dan total berubah (330.000), nomor tetap, teks yang tidak dikirim tetap (${s2(pnw1.total)})`);
  pastikan(pnw1.rencanaTermin.map((t) => s2(t.jumlah)).join() === "165000.00,165000.00", "rencana termin dihitung ulang dari total baru");
  const [lUbah] = await log("UBAH", pnw.id);
  pastikan((lUbah?.meta as { totalLama?: string; totalBaru?: string })?.totalBaru === "330000.00" && (lUbah?.meta as { totalLama?: string }).totalLama === "100000.00", "log UBAH dengan totalLama dan totalBaru");
  await harusDitolak("ubah penawaran: perusahaan diganti", () => ubahPenawaran(pnw.id, formulir({ perusahaanId: "tapussa", pelangganId: pelanggan.id, baris: [{ barangId: jasa.id, jumlah: 1, harga: 100_000 }] })), "Perusahaan penawaran tidak bisa diganti");
  await harusDitolak("ubah penawaran: fee persen 101", () => ubahPenawaran(pnw.id, formulir({ pelangganId: pelanggan.id, nilaiFee: 101, baris: [{ barangId: jasa.id, jumlah: 1, harga: 100_000 }] })), "Persen management fee");
  await harusDitolak("ubah penawaran: nomor cetak milik penawaran lain", () => ubahPenawaran(pnw.id, formulir({ pelangganId: pelanggan.id, nomorCetak: `${K}/PNW/1`, baris: [{ barangId: jasa.id, jumlah: 1, harga: 100_000 }] })), "sudah dipakai dokumen lain");
  // tinjauan P25 R5: penawaran draf milik perusahaan arsip tidak bisa diubah, seperti buat yang menolak perusahaan arsip
  await jalankan("PNW draf tapussa", () => buatPenawaran(formulir({ perusahaanId: "tapussa", pelangganId: pelanggan.id, ppnPersen: 0, perihal: "Arsip", baris: [{ barangId: jasa.id, jumlah: 1, harga: 100_000 }] })));
  const pnwArsip = await db.penawaranPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id, perihal: "Arsip" } });
  const tapussa = await db.perusahaan.findUniqueOrThrow({ where: { id: "tapussa" }, select: { nama: true, aktif: true } });
  await db.perusahaan.update({ where: { id: "tapussa" }, data: { aktif: false } });
  try {
    await harusDitolak("ubah penawaran perusahaan arsip", () => ubahPenawaran(pnwArsip.id, formulir({ pelangganId: pelanggan.id, ppnPersen: 0, baris: [{ barangId: jasa.id, jumlah: 2, harga: 100_000 }] })), `Perusahaan ${tapussa.nama} sudah diarsipkan; penawarannya tidak bisa diubah`);
  } finally {
    await db.perusahaan.update({ where: { id: "tapussa" }, data: { aktif: tapussa.aktif } });
  }
  pastikan(s2((await db.penawaranPenjualan.findUniqueOrThrow({ where: { id: pnwArsip.id } })).total) === "100000.00", "penawaran perusahaan arsip tetap seperti semula");
  await jalankan("ubah penawaran sesudah perusahaan aktif lagi", () => ubahPenawaran(pnwArsip.id, formulir({ pelangganId: pelanggan.id, ppnPersen: 0, baris: [{ barangId: jasa.id, jumlah: 2, harga: 100_000 }] })));
  await sebagaiPeran("GUDANG", () => harusDitolak("GUDANG mengubah penawaran", () => ubahPenawaran(pnw.id, formulir({ pelangganId: pelanggan.id, baris: [{ barangId: jasa.id, jumlah: 1, harga: 100_000 }] })), "tidak punya hak"));

  console.log("=== 6. Status komersial ===");
  await jalankan("DRAF ke TERKIRIM", () => ubahStatusPenawaran(pnw.id, formulir({ statusKomersial: "TERKIRIM" })));
  await jalankan("TERKIRIM ke DITOLAK", () => ubahStatusPenawaran(pnw.id, formulir({ statusKomersial: "DITOLAK" })));
  await harusDitolak("konversi saat Ditolak", () => konversiPenawaranKePesanan(pnw.id), "berstatus Ditolak");
  await jalankan("ke KEDALUWARSA", () => ubahStatusPenawaran(pnw.id, formulir({ statusKomersial: "KEDALUWARSA" })));
  await harusDitolak("konversi saat Kedaluwarsa", () => konversiPenawaranKePesanan(pnw.id), "berstatus Kedaluwarsa");
  await harusDitolak("status tidak dikenal", () => ubahStatusPenawaran(pnw.id, formulir({ statusKomersial: "BATAL" })), "Status komersial tidak dikenal");
  await jalankan("kembali ke TERKIRIM", () => ubahStatusPenawaran(pnw.id, formulir({ statusKomersial: "TERKIRIM" })));
  await jalankan("konversi", () => konversiPenawaranKePesanan(pnw.id));
  await harusDitolak("ganti status sesudah dikonversi", () => ubahStatusPenawaran(pnw.id, formulir({ statusKomersial: "DITOLAK" })), "statusnya tetap Diterima");
  await harusDitolak("ubah penawaran yang sudah dikonversi", () => ubahPenawaran(pnw.id, formulir({ pelangganId: pelanggan.id, baris: [{ barangId: jasa.id, jumlah: 1, harga: 100_000 }] })), "Penawaran yang sudah dikonversi tidak bisa diubah");
  const logStatus = await log("UBAH_STATUS", pnw.id);
  pastikan(logStatus.map((l) => { const m = l.meta as { dari: string; ke: string }; return `${m.dari}>${m.ke}`; }).join() === "DRAF>TERKIRIM,TERKIRIM>DITOLAK,DITOLAK>KEDALUWARSA,KEDALUWARSA>TERKIRIM", `log UBAH_STATUS dengan meta dari dan ke (${logStatus.length})`);
  await jalankan("ubah tampilan penawaran yang sudah dikonversi", () => ubahTampilanDokumen("penawaran", pnw.id, formulir({ judulCetak: "PROPOSAL", nilaiAddOn: 25_000, keteranganAddOn: "opsional" })));
  const pnw2 = await db.penawaranPenjualan.findUniqueOrThrow({ where: { id: pnw.id } });
  pastikan(pnw2.judulCetak === "PROPOSAL" && s2(pnw2.nilaiAddOn) === "25000.00" && s2(pnw2.total) === "330000.00", "tampilan penawaran dikonversi tetap bisa diubah; add on tidak mengubah total");

  console.log("=== 7. Hak per jenis ===");
  await sebagaiPeran("GUDANG", () => harusDitolak("GUDANG mengubah tampilan pesanan", () => ubahTampilanDokumen("pesanan", psj.id, formulir({ perihal: "x" })), "tidak punya hak"));
  await sebagaiPeran("KASIR", () => jalankan("KASIR mengubah tampilan penerimaan", () => ubahTampilanDokumen("penerimaan", trm.id, formulir({ keperluan: "Pelunasan sebagian" }))));
  await sebagaiPeran("KASIR", () => jalankan("KASIR mengubah tampilan uang muka", () => ubahTampilanDokumen("uangMuka", um.id, formulir({ judulCetak: "KWITANSI DP", catatan: "diabaikan" }))));
  pastikan((await db.penerimaanPenjualan.findUniqueOrThrow({ where: { id: trm.id } })).keperluan === "Pelunasan sebagian" && (await db.uangMukaPelanggan.findUniqueOrThrow({ where: { id: um.id } })).judulCetak === "KWITANSI DP", "penerimaan dan uang muka diubah KASIR; catatan uang muka di luar daftar putih diabaikan");

  console.log("=== 8. Pengaturan dokumen penjualan ===");
  await sebagaiPeran("ADMIN", () => harusDitolak("ADMIN menyimpan pengaturan dokumen", () => simpanPengaturanDokumenPenjualan(formulir({ perusahaanId: "utama" })), "tidak punya hak"));
  await jalankan("PEMILIK menyimpan pengaturan dokumen", () =>
    simpanPengaturanDokumenPenjualan(formulir({ perusahaanId: "utama", syaratPembayaran: "DP 50%", tampilanEvent: "RINGKAS", daftarSeksi: "Venue\n  venue \nKonsumsi\n\nTalent  /  Artis", teksPembukaPenawaran: "Dengan hormat," })),
  );
  const pd = await db.pengaturanDokumenPenjualan.findUniqueOrThrow({ where: { perusahaanId: "utama" } });
  pastikan(pd.daftarSeksi.join("|") === "Venue|Konsumsi|Talent / Artis" && pd.tampilanEvent === "RINGKAS" && pd.syaratPembayaran === "DP 50%" && pd.teksPembukaPenawaran === "Dengan hormat,", `seksi dirapikan dan duplikat dibuang (${pd.daftarSeksi.join("|")})`);
  await harusDitolak("syarat pembayaran 3001 karakter", () => simpanPengaturanDokumenPenjualan(formulir({ perusahaanId: "utama", syaratPembayaran: "s".repeat(3001) })), "maksimal 3000");
  await harusDitolak("tampilan event tidak dikenal", () => simpanPengaturanDokumenPenjualan(formulir({ perusahaanId: "utama", tampilanEvent: "SEDANG" })), "Tampilan event tidak dikenal");
  pastikan((await db.logAktivitas.count({ where: { aksi: "UBAH", jenis: "Pengaturan Dokumen Penjualan", modul: "penjualan", waktu: { gte: mulaiUji } } })) === 1, "log UBAH Pengaturan Dokumen Penjualan");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
