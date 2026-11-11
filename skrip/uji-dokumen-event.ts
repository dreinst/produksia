import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { D, type Desimal } from "../src/lib/uang";
import { periksaSinkron } from "../src/lib/sinkron";
import { ringkasanPajak } from "../src/lib/pajak";
import { labaRugiKas } from "../src/lib/basisKas";
import { bacaPeriode } from "../src/lib/laporan";
import { KUNCI_AKUN_FEE } from "../src/lib/akuntansi";
import { hitungHak } from "../src/lib/hakAkses";
import { KODE_BARANG_LAIN } from "../src/lib/barangLainLain";
import { KOLOM_SALIN_BARIS, KOLOM_SALIN_PENAWARAN_KE_PESANAN } from "../src/lib/dokumenPenjualan";
import { periksaBrutoRencana, selesaikanRencana } from "../src/lib/rencanaTermin";
import { pratinjauTerminKlien } from "../src/lib/hitungDokumenKlien";
import { hashKataSandi } from "../src/lib/kataSandi";
import {
  buatPenawaran,
  konversiPenawaranKePesanan,
  buatPesanan,
  buatPengiriman,
  buatFaktur,
  buatPenerimaan,
  buatRetur,
  buatUangMuka,
} from "../src/lib/aksi/penjualan";
import { buatPenyesuaianPersediaan } from "../src/lib/aksi/persediaan";
import { hapusDokumen, type JenisDokumen } from "../src/lib/aksi/hapusDokumen";
import { ajukanDokumen, setujuiDokumen } from "../src/lib/aksi/persetujuan";
import { aturPersetujuan, formulir, harusDitolak, jalankan, pastikan, sebagai } from "./bantuan";

/*
 * P23: alur penuh dokumen penjualan mode event lewat aksi (D2 §9.2 uji-dokumen-event, angka D2 §4.1):
 *  1. data uji; 2. penolakan buatPenawaran (tanpa dokumen tersimpan); 3. mode STANDAR memaksa frekuensi dan seksi netral;
 *  4. penawaran EVENT tiga baris dengan baris bebas, diskon, fee, termin, teks; 5. konversi menyalin kolom, baris, termin;
 *  6. SJ mengurangi stok per unit (bukan per frekuensi); 7. uang muka termin dan batasnya; 8. faktur jalur ID dengan
 *  jurnal D2 §4.1 dan nomor cetak jalur langsung; 9. sinkron dan omzet pajak; 10. akun fee salah dan fee negatif;
 *  11. faktur lewat persetujuan; 12. retur jalur ID ber-fee; 13. pelunasan dan basis kas; 14. hak; 15. hapus berurutan.
 * Tambahan kontrak P23:
 *  16. dokumen di sesi tapussa (UJI_PERUSAHAAN) dan jurnalnya milik tapussa, rujukan milik perusahaan lain ditolak,
 *      nomor cetak per perusahaan saat dibuat;
 *  17. pengaturan pajak dari perusahaan dokumen, batas uang muka pesanan bertermin memakai nilai kontrak bruto pesanan
 *      (butir terakhir bisa dibayar penuh), pesanan tanpa termin memakai rumus lama, butir termin bruto 0 ditolak.
 * Semua data uji dihapus (dokumen lewat hapusDokumen), pemetaan fee dan HakAksesPeran dipulihkan, periksaSinkron sama.
 */

const AWALAN_KODE = "EVT";
const KODE_PERUSAHAAN_PKP = "UJEVTPKP";
const PENGAJU = "uji-evt-pengaju";
const PEMERIKSA = "uji-evt-pemeriksa";
const KUNCI_DERET = "ujievt";

const sama = (x: unknown, harap: number | string | Desimal) => D(x as Desimal).equals(D(harap));
const teks = (x: unknown) => D(x as Desimal).toFixed(2);

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
const diPerusahaan = <T>(perusahaanId: string, fn: () => Promise<T>) => denganEnv({ UJI_PERUSAHAAN: perusahaanId }, fn);

/** Debit dan kredit per akun satu jurnal. */
async function petaJurnal(jurnalId: string | null | undefined) {
  const peta = new Map<string, { debit: Desimal; kredit: Desimal }>();
  if (!jurnalId) return peta;
  for (const b of await db.barisJurnal.findMany({ where: { jurnalId } })) {
    const x = peta.get(b.akunId) ?? { debit: D(0), kredit: D(0) };
    peta.set(b.akunId, { debit: x.debit.plus(b.debit), kredit: x.kredit.plus(b.kredit) });
  }
  return peta;
}

/** Semua pelanggan uji (kode PLG-EVT...). */
const pelangganUji = async () => (await db.pelanggan.findMany({ where: { kode: { startsWith: `PLG-${AWALAN_KODE}` } }, select: { id: true } })).map((p) => p.id);

/** Cadangan bila suite berhenti di tengah: hapus langsung dokumen dan data induk uji beserta jurnalnya. */
async function bersihkan() {
  const pel = await pelangganUji();
  const jurnalIds: string[] = [];
  const kumpul = (xs: { jurnalId: string | null }[]) => jurnalIds.push(...xs.flatMap((x) => (x.jurnalId ? [x.jurnalId] : [])));
  const nomorDok: string[] = [];
  if (pel.length > 0) {
    const faktur = await db.fakturPenjualan.findMany({ where: { pelangganId: { in: pel } }, select: { id: true, nomor: true, jurnalId: true } });
    const fakturIds = faktur.map((f) => f.id);
    const retur = await db.returPenjualan.findMany({ where: { fakturId: { in: fakturIds } }, select: { id: true, nomor: true, jurnalId: true } });
    const terima = await db.penerimaanPenjualan.findMany({ where: { fakturId: { in: fakturIds } }, select: { id: true, nomor: true, jurnalId: true } });
    const um = await db.uangMukaPelanggan.findMany({ where: { pelangganId: { in: pel } }, select: { id: true, nomor: true, jurnalId: true } });
    const pesanan = await db.pesananPenjualan.findMany({ where: { pelangganId: { in: pel } }, select: { id: true, nomor: true } });
    const sj = await db.pengirimanPesanan.findMany({ where: { pesananId: { in: pesanan.map((p) => p.id) } }, select: { id: true, nomor: true, jurnalId: true } });
    const penawaran = await db.penawaranPenjualan.findMany({ where: { pelangganId: { in: pel } }, select: { id: true, nomor: true } });
    for (const xs of [faktur, retur, terima, um, sj]) kumpul(xs);
    nomorDok.push(...[faktur, retur, terima, um, pesanan, sj, penawaran].flatMap((xs) => xs.map((x) => x.nomor)));
    await db.barisReturPenjualan.deleteMany({ where: { returId: { in: retur.map((r) => r.id) } } });
    await db.returPenjualan.deleteMany({ where: { id: { in: retur.map((r) => r.id) } } });
    await db.penerimaanPenjualan.deleteMany({ where: { id: { in: terima.map((r) => r.id) } } });
    await db.pemakaianUangMuka.deleteMany({ where: { fakturId: { in: fakturIds } } });
    await db.barisFakturPenjualan.deleteMany({ where: { fakturId: { in: fakturIds } } });
    await db.fakturPenjualan.deleteMany({ where: { id: { in: fakturIds } } });
    await db.uangMukaPelanggan.deleteMany({ where: { id: { in: um.map((u) => u.id) } } });
    await db.barisPengiriman.deleteMany({ where: { pengirimanId: { in: sj.map((s) => s.id) } } });
    await db.pengirimanPesanan.deleteMany({ where: { id: { in: sj.map((s) => s.id) } } });
    await db.rencanaTermin.deleteMany({ where: { OR: [{ pesananId: { in: pesanan.map((p) => p.id) } }, { penawaran: { pelangganId: { in: pel } } }] } });
    await db.barisPesananPenjualan.deleteMany({ where: { pesananId: { in: pesanan.map((p) => p.id) } } });
    await db.pesananPenjualan.deleteMany({ where: { id: { in: pesanan.map((p) => p.id) } } });
    await db.barisPenawaranPenjualan.deleteMany({ where: { penawaranId: { in: penawaran.map((p) => p.id) } } });
    await db.penawaranPenjualan.deleteMany({ where: { id: { in: penawaran.map((p) => p.id) } } });
  }
  const barang = await db.barang.findMany({ where: { kode: { contains: `-${AWALAN_KODE}` } }, select: { id: true } });
  const ps = await db.penyesuaianPersediaan.findMany({ where: { baris: { some: { barangId: { in: barang.map((b) => b.id) } } } }, select: { id: true, nomor: true, jurnalId: true } });
  kumpul(ps);
  nomorDok.push(...ps.map((p) => p.nomor));
  await db.barisPenyesuaianPersediaan.deleteMany({ where: { penyesuaianId: { in: ps.map((p) => p.id) } } });
  await db.penyesuaianPersediaan.deleteMany({ where: { id: { in: ps.map((p) => p.id) } } });
  await db.barisJurnal.deleteMany({ where: { jurnalId: { in: jurnalIds } } });
  await db.jurnal.deleteMany({ where: { id: { in: jurnalIds } } });
  if (nomorDok.length > 0) await db.logAktivitas.deleteMany({ where: { nomor: { in: nomorDok } } });
  await db.stokBarang.deleteMany({ where: { barangId: { in: barang.map((b) => b.id) } } });
  await db.barang.deleteMany({ where: { id: { in: barang.map((b) => b.id) } } });
  await db.gudang.deleteMany({ where: { kode: { startsWith: `WH-${AWALAN_KODE}` } } });
  await db.pemetaanAkunTambahan.deleteMany({ where: { kunci: KUNCI_AKUN_FEE, akun: { kode: { startsWith: `UJI-${AWALAN_KODE}` } } } });
  await db.akun.deleteMany({ where: { kode: { startsWith: `UJI-${AWALAN_KODE}` } } });
  await db.proyek.deleteMany({ where: { kode: { startsWith: `PRJ-${AWALAN_KODE}` } } });
  await db.pelanggan.deleteMany({ where: { kode: { startsWith: `PLG-${AWALAN_KODE}` } } });
  await db.formatNomor.deleteMany({ where: { kunciDeret: { startsWith: KUNCI_DERET } } });
  await db.penghitungNomor.deleteMany({ where: { kunciDeret: { startsWith: KUNCI_DERET } } });
  const pkp = await db.perusahaan.findUnique({ where: { kode: KODE_PERUSAHAAN_PKP }, select: { id: true } });
  if (pkp) {
    await db.logAktivitas.deleteMany({ where: { perusahaanId: pkp.id } });
    await db.pengaturanPerusahaan.deleteMany({ where: { perusahaanId: pkp.id } });
    await db.perusahaan.delete({ where: { id: pkp.id } });
  }
  const pengguna = await db.pengguna.findMany({ where: { namaPengguna: { in: [PENGAJU, PEMERIKSA] } }, select: { id: true } });
  await db.notifikasi.deleteMany({ where: { penggunaId: { in: pengguna.map((p) => p.id) } } });
  await db.pengguna.deleteMany({ where: { id: { in: pengguna.map((p) => p.id) } } });
}

async function main() {
  await bersihkan();
  aturPersetujuan(false);
  const mulaiUji = new Date();
  const tahun = mulaiUji.getFullYear();
  const sinkronAwal = await periksaSinkron(db);
  const jurnalAwal = await db.jurnal.count();
  const hakAwal = await db.hakAksesPeran.findMany({ orderBy: [{ peran: "asc" }, { hak: "asc" }] });
  const lainLainAwal = await db.barang.findUnique({ where: { kode: KODE_BARANG_LAIN }, select: { id: true } });
  const feeAwal = await db.pemetaanAkunTambahan.findUnique({ where: { kunci: KUNCI_AKUN_FEE } });
  if (feeAwal) await db.pemetaanAkunTambahan.delete({ where: { id: feeAwal.id } });
  const hakNegoKasirAwal = await db.hakAksesPeran.findUnique({ where: { peran_hak: { peran: "KASIR", hak: "harga.nego" } } });

  try {
    await uji(mulaiUji, tahun);
  } finally {
    aturPersetujuan(false);
    // log hapus dan persetujuan dokumen uji (nomor dokumen dipakai ulang pada putaran berikutnya)
    await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji }, penggunaNama: { in: ["Skrip Uji", "Pengaju Uji Event", "Pemeriksa Uji Event"] } } });
    if (hakNegoKasirAwal) await db.hakAksesPeran.upsert({ where: { peran_hak: { peran: "KASIR", hak: "harga.nego" } }, create: hakNegoKasirAwal, update: { boleh: hakNegoKasirAwal.boleh } });
    else await db.hakAksesPeran.deleteMany({ where: { peran: "KASIR", hak: "harga.nego" } });
    await bersihkan();
    if (!lainLainAwal) {
      const dipakai =
        (await db.barisPenawaranPenjualan.count({ where: { barang: { kode: KODE_BARANG_LAIN } } })) +
        (await db.barisPesananPenjualan.count({ where: { barang: { kode: KODE_BARANG_LAIN } } })) +
        (await db.barisFakturPenjualan.count({ where: { barang: { kode: KODE_BARANG_LAIN } } }));
      if (dipakai === 0) await db.barang.deleteMany({ where: { kode: KODE_BARANG_LAIN } });
    }
    if (feeAwal) await db.pemetaanAkunTambahan.create({ data: feeAwal });
  }

  const feeAkhir = await db.pemetaanAkunTambahan.findUnique({ where: { kunci: KUNCI_AKUN_FEE } });
  pastikan(JSON.stringify(feeAkhir) === JSON.stringify(feeAwal), "pemetaan Pendapatan Fee Manajemen kembali seperti sebelum uji");
  const hakAkhir = await db.hakAksesPeran.findMany({ orderBy: [{ peran: "asc" }, { hak: "asc" }] });
  pastikan(JSON.stringify(hakAkhir) === JSON.stringify(hakAwal), "HakAksesPeran sama dengan sebelum uji");
  pastikan(lainLainAwal !== null || (await db.barang.count({ where: { kode: KODE_BARANG_LAIN } })) === 0, "Barang JASA-LAIN buatan suite ini sudah dihapus");
  pastikan((await db.jurnal.count()) === jurnalAwal, "jumlah jurnal sama dengan sebelum uji");
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron seimbang dan sama dengan sebelum uji");
  console.log("=== DONE, all dokumen-event checks passed ===");
}

async function uji(mulaiUji: Date, tahun: number) {
  const m = await db.pemetaanAkun.findUniqueOrThrow({ where: { id: "default" } });
  const akunKode = async (kode: string) => db.akun.findUniqueOrThrow({ where: { kode } });
  const [k4000, k4900] = await Promise.all([akunKode("4-1000"), akunKode("4-9000")]);
  const jurnalAwal = await db.jurnal.count();

  console.log("=== 1. Data uji ===");
  const gudang = await db.gudang.create({ data: { kode: `WH-${AWALAN_KODE}`, nama: "Gudang Uji Event" } });
  const sound = await db.barang.create({ data: { kode: `BRG-${AWALAN_KODE}-SOUND`, nama: "Sound System Uji", jenis: "BARANG", satuan: "unit", hargaBeli: 1_000_000, hargaJual: 2_000_000 } });
  const kamar = await db.barang.create({ data: { kode: `JS-${AWALAN_KODE}-KAMAR`, nama: "Kamar Twin Uji", jenis: "JASA", satuan: "kamar", hargaBeli: 0, hargaJual: 650_000 } });
  const kru = await db.barang.create({ data: { kode: `JS-${AWALAN_KODE}-KRU`, nama: "Kru Lapangan Uji", jenis: "JASA", satuan: "orang", hargaBeli: 0, hargaJual: 100_000 } });
  const pelanggan = await db.pelanggan.create({ data: { kode: `PLG-${AWALAN_KODE}`, nama: "Klien Uji Event" } });
  const proyek = await db.proyek.create({ data: { kode: `PRJ-${AWALAN_KODE}`, nama: "Event Uji Dokumen", pelangganId: pelanggan.id } });
  const akunFee = await db.akun.create({ data: { kode: `UJI-${AWALAN_KODE}-FEE`, nama: "Pendapatan Fee Uji Event", jenis: "PENDAPATAN", indukId: k4000.id } });
  const akunLain = await db.akun.create({ data: { kode: `UJI-${AWALAN_KODE}-LAIN`, nama: "Pendapatan Lain Uji Event", jenis: "PENDAPATAN", indukId: k4900.id } });
  const kas = await db.akun.create({ data: { kode: `UJI-${AWALAN_KODE}-KAS`, nama: "Kas Uji Event", jenis: "ASET", kasBank: true } });
  const modal = await db.akun.create({ data: { kode: `UJI-${AWALAN_KODE}-MODAL`, nama: "Modal Uji Event", jenis: "MODAL" } });
  await db.pemetaanAkunTambahan.create({ data: { kunci: KUNCI_AKUN_FEE, label: "Pendapatan Fee Manajemen", dibuatOleh: "uji", akunId: akunFee.id } });
  await jalankan("PS saldo awal sound 5 @ 1.000.000", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudang.id, akunLawanId: modal.id, baris: [{ barangId: sound.id, jumlahSesudah: 5, hargaSatuan: 1_000_000 }] })));
  const stok = async (barangId: string, gudangId = gudang.id) => D((await db.stokBarang.findUnique({ where: { barangId_gudangId: { barangId, gudangId } } }))?.jumlah ?? 0);
  pastikan((await stok(sound.id)).equals(5), "stok awal sound 5");
  await db.pengguna.create({ data: { namaPengguna: PENGAJU, nama: "Pengaju Uji Event", peran: "KASIR", kataSandiHash: await hashKataSandi("uji-evt-pengaju-123") } });
  await db.pengguna.create({ data: { namaPengguna: PEMERIKSA, nama: "Pemeriksa Uji Event", peran: "ADMIN", kataSandiHash: await hashKataSandi("uji-evt-pemeriksa-123") } });

  const barisEvent = [
    { barangId: sound.id, jumlah: 1, frekuensi: 3, satuanFrekuensi: "hari", harga: 2_000_000, bagian: "Produksi" },
    { barangId: kamar.id, jumlah: 25, frekuensi: 3, satuanFrekuensi: "malam", harga: 650_000, bagian: "Akomodasi", deskripsi: "- Twin share\n-- sarapan" },
    { nama: "Dokumentasi", jumlah: 1, frekuensi: 1, satuanFrekuensi: "event", harga: 7_000_000, bagian: "Produksi", keterangan: "foto dan video" },
  ];
  const isianEvent = {
    pelangganId: pelanggan.id,
    proyekId: proyek.id,
    mode: "EVENT",
    baris: barisEvent,
    jenisDiskon: "NOMINAL",
    nilaiDiskon: 890_000,
    jenisFee: "PERSEN",
    nilaiFee: 10,
    ppnPersen: 0,
    rencanaTermin: [{ label: "DP", mode: "PERSEN", nilai: 30 }, { label: "Pelunasan" }],
    perihal: "Penawaran Event Uji",
    teksPembuka: "Bersama ini kami sampaikan anggaran.",
    teksPenutup: "Terima kasih.",
    catatan: "- harga belum termasuk tiket pesawat",
    namaEvent: "Gathering Uji",
    venue: "Hotel Uji",
    tanggalEvent: "27-30 Agustus",
  };
  const jumlahPenawaran = () => db.penawaranPenjualan.count({ where: { pelangganId: pelanggan.id } });

  console.log("=== 2. Penolakan buatPenawaran ===");
  const tolakPnw = (label: string, ubah: Record<string, unknown>, potongan: string) => harusDitolak(label, () => buatPenawaran(formulir({ ...isianEvent, ...ubah })), potongan);
  await tolakPnw("frekuensi 0", { baris: [{ ...barisEvent[0], frekuensi: 0 }] }, "frekuensi harus lebih dari 0");
  await tolakPnw("frekuensi 1.000.001", { baris: [{ ...barisEvent[0], frekuensi: 1_000_001 }] }, "frekuensi maksimal 1.000.000");
  await tolakPnw("diskon persen 101", { jenisDiskon: "PERSEN", nilaiDiskon: 101 }, "Persen diskon tidak boleh lebih dari 100");
  await tolakPnw("diskon nominal melebihi subtotal", { nilaiDiskon: 61_750_001 }, "melebihi subtotal penawaran");
  await tolakPnw("fee persen 101", { nilaiFee: 101 }, "Persen management fee");
  await tolakPnw("fee nominal negatif", { jenisFee: "NOMINAL", nilaiFee: -1 }, "Management fee tidak boleh negatif");
  await tolakPnw("fee persen negatif", { nilaiFee: -5 }, "Management fee tidak boleh negatif");
  await tolakPnw("nama 201 karakter", { baris: [{ ...barisEvent[2], nama: "x".repeat(201) }] }, "nama maksimal 200");
  await tolakPnw("deskripsi 3001 karakter", { baris: [{ ...barisEvent[1], deskripsi: "y".repeat(3001) }] }, "deskripsi maksimal 3000");
  await tolakPnw("satuan frekuensi 21 karakter", { baris: [{ ...barisEvent[1], satuanFrekuensi: "z".repeat(21) }] }, "satuan frekuensi maksimal 20");
  await tolakPnw("rencana termin 5 butir", { rencanaTermin: [{}, {}, {}, {}, {}] }, "maksimal 4");
  await tolakPnw("email tujuan tidak valid", { kepadaEmail: "a@b" }, "Email tujuan tidak valid");
  await tolakPnw("kop surat tidak ada", { kopSuratId: "tidak-ada" }, "Kop surat tidak ditemukan");
  await tolakPnw("berlaku sampai kemarin", { berlakuSampai: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10) }, "tidak boleh sebelum hari ini");
  await tolakPnw("mode tidak dikenal", { mode: "KONSER" }, "Mode dokumen tidak dikenal");
  await tolakPnw("PPN 11% di perusahaan non-PKP (pengaturan perusahaan dokumen)", { ppnPersen: 11 }, "belum PKP");
  await db.hakAksesPeran.upsert({ where: { peran_hak: { peran: "KASIR", hak: "harga.nego" } }, create: { peran: "KASIR", hak: "harga.nego", boleh: false }, update: { boleh: false } });
  await sebagaiPeran("KASIR", () => tolakPnw("baris bebas oleh KASIR tanpa harga.nego", {}, "Baris bebas (tanpa barang katalog) butuh hak"));
  await db.hakAksesPeran.delete({ where: { peran_hak: { peran: "KASIR", hak: "harga.nego" } } });
  pastikan((await jumlahPenawaran()) === 0, "semua penolakan tidak menyimpan penawaran");

  console.log("=== 3. Mode STANDAR memaksa frekuensi dan seksi netral; fee tetap boleh ===");
  await jalankan("PNW STANDAR kamar 2 × (frek 3 dikirim) @ 650.000 fee 5%", () =>
    buatPenawaran(formulir({ pelangganId: pelanggan.id, mode: "STANDAR", baris: [{ barangId: kamar.id, jumlah: 2, frekuensi: 3, satuanFrekuensi: "malam", bagian: "Akomodasi", harga: 650_000 }], jenisFee: "PERSEN", nilaiFee: 5, ppnPersen: 0 })),
  );
  const pnwStandar = await db.penawaranPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id }, include: { baris: true } });
  const bs = pnwStandar.baris[0];
  pastikan(sama(bs.frekuensi, 1) && bs.bagian === null && bs.satuanFrekuensi === null && sama(bs.subtotal, 1_300_000), `STANDAR: frekuensi 1, seksi kosong, nilai baris 1.300.000 (${teks(bs.frekuensi)}, ${bs.bagian}, ${teks(bs.subtotal)})`);
  pastikan(pnwStandar.mode === "STANDAR" && sama(pnwStandar.fee, 65_000) && sama(pnwStandar.total, 1_365_000) && pnwStandar.perusahaanId === "utama", `fee 5% di mode STANDAR tersimpan dan masuk total (${teks(pnwStandar.fee)}, ${teks(pnwStandar.total)})`);

  console.log("=== 4. Penawaran EVENT tiga baris (angka D2 §4.1) ===");
  await jalankan("PNW EVENT sound, kamar, dokumentasi", () => buatPenawaran(formulir(isianEvent)));
  const pnw = await db.penawaranPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id, mode: "EVENT" }, include: { baris: { orderBy: { urutan: "asc" }, include: { barang: true } }, rencanaTermin: { orderBy: { no: "asc" } } } });
  pastikan(pnw.nomor.startsWith("PNW-") && pnw.perusahaanId === "utama" && pnw.proyekId === proyek.id && pnw.nomorCetak === null, `nomor ${pnw.nomor}, perusahaan utama, proyek, tanpa nomor cetak (tanpa format)`);
  pastikan(pnw.baris.map((b) => teks(b.subtotal)).join() === "6000000.00,48750000.00,7000000.00" && pnw.baris.map((b) => b.urutan).join() === "0,1,2", `nilai baris 6.000.000 / 48.750.000 / 7.000.000, urutan 0,1,2 (${pnw.baris.map((b) => teks(b.subtotal)).join()})`);
  pastikan(sama(pnw.diskon, 890_000) && sama(pnw.fee, 6_086_000) && sama(pnw.total, 66_946_000) && sama(pnw.nilaiFee, 10) && pnw.jenisFee === "PERSEN", `diskon 890.000, fee 6.086.000, total 66.946.000 (${teks(pnw.diskon)}, ${teks(pnw.fee)}, ${teks(pnw.total)})`);
  const b3 = pnw.baris[2];
  pastikan(b3.barang.kode === KODE_BARANG_LAIN && b3.barang.jenis === "JASA" && sama(b3.barang.hargaJual, 0) && b3.barang.perusahaanId === null && b3.nama === "Dokumentasi", "baris bebas memakai Barang JASA-LAIN (jasa bersama, harga 0) dengan nama Dokumentasi");
  pastikan(pnw.baris[0].bagian === "Produksi" && pnw.baris[1].satuanFrekuensi === "malam" && sama(pnw.baris[1].frekuensi, 3) && pnw.baris[1].deskripsi === "- Twin share\n-- sarapan", "seksi, satuan frekuensi, frekuensi, dan deskripsi baris tersimpan");
  pastikan(pnw.rencanaTermin.map((t) => `${t.label}:${teks(t.jumlah)}:${teks(t.persen)}`).join() === "DP:20083800.00:30.00,Pelunasan:46862200.00:70.00" && pnw.rencanaTermin.every((t) => t.perusahaanId === "utama" && t.pesananId === null), `termin DP 20.083.800 (30%) dan Pelunasan 46.862.200 (70%) (${pnw.rencanaTermin.map((t) => teks(t.jumlah)).join()})`);
  pastikan(pnw.perihal === "Penawaran Event Uji" && pnw.catatan === "- harga belum termasuk tiket pesawat" && pnw.namaEvent === "Gathering Uji" && pnw.venue === "Hotel Uji" && pnw.tanggalEvent === "27-30 Agustus" && pnw.syaratPembayaran === null, "teks surat dan event tersimpan; server tidak menambah teks sendiri");

  console.log("=== 5. Konversi ke pesanan ===");
  await db.penawaranPenjualan.update({ where: { id: pnwStandar.id }, data: { statusKomersial: "DITOLAK" } });
  await harusDitolak("konversi penawaran berstatus Ditolak", () => konversiPenawaranKePesanan(pnwStandar.id), "berstatus Ditolak; ubah statusnya dulu");
  await db.penawaranPenjualan.update({ where: { id: pnwStandar.id }, data: { statusKomersial: "KEDALUWARSA" } });
  await harusDitolak("konversi penawaran berstatus Kedaluwarsa", () => konversiPenawaranKePesanan(pnwStandar.id), "berstatus Kedaluwarsa");
  await db.penawaranPenjualan.update({ where: { id: pnwStandar.id }, data: { statusKomersial: "DRAF" } });
  await jalankan("konversi PNW EVENT ke PSJ", () => konversiPenawaranKePesanan(pnw.id));
  await harusDitolak("konversi ganda", () => konversiPenawaranKePesanan(pnw.id), "sudah dikonversi");
  const psj = await db.pesananPenjualan.findFirstOrThrow({ where: { penawaranId: pnw.id }, include: { baris: { orderBy: { urutan: "asc" } }, rencanaTermin: { orderBy: { no: "asc" } } } });
  const kolomBeda = KOLOM_SALIN_PENAWARAN_KE_PESANAN.filter((k) => String(psj[k]) !== String(pnw[k]));
  pastikan(kolomBeda.length === 0, `pesanan menyalin ${KOLOM_SALIN_PENAWARAN_KE_PESANAN.length} kolom penawaran (beda: ${kolomBeda.join(", ") || "tidak ada"})`);
  const barisBeda = psj.baris.flatMap((b, i) => KOLOM_SALIN_BARIS.filter((k) => String(b[k]) !== String(pnw.baris[i][k])));
  pastikan(psj.baris.length === 3 && barisBeda.length === 0, `baris pesanan menyalin frekuensi, seksi, nama, deskripsi (beda: ${barisBeda.join(", ") || "tidak ada"})`);
  pastikan(psj.rencanaTermin.length === 2 && psj.rencanaTermin.every((t, i) => t.penawaranId === null && t.pesananId === psj.id && t.nomorCetak === null && t.ditagihPada === null && sama(t.jumlah, pnw.rencanaTermin[i].jumlah) && sama(t.persen, pnw.rencanaTermin[i].persen)), "dua butir termin disalin ke pesanan (pesananId terisi, penawaranId null)");
  pastikan((await db.rencanaTermin.count({ where: { penawaranId: pnw.id } })) === 2, "butir termin penawaran tetap ada");
  const pnwSesudah = await db.penawaranPenjualan.findUniqueOrThrow({ where: { id: pnw.id } });
  pastikan(pnwSesudah.status === "DIKONVERSI" && pnwSesudah.statusKomersial === "DITERIMA" && pnwSesudah.statusKomersialPada !== null, "penawaran DIKONVERSI dan status komersial Diterima");
  const [bpSound, bpKamar, bpDok] = psj.baris;

  // pesanan kedua (bagian 7, 10, 11): jasa 2 × 3 hari @ 100.000, fee nominal 50.000, termin 50% + sisa
  await jalankan("PSJ EVENT kedua kru 2 × 3 hari, fee nominal 50.000", () =>
    buatPesanan(formulir({ pelangganId: pelanggan.id, mode: "EVENT", baris: [{ barangId: kru.id, jumlah: 2, frekuensi: 3, satuanFrekuensi: "hari", harga: 100_000 }], jenisFee: "NOMINAL", nilaiFee: 50_000, ppnPersen: 0, rencanaTermin: [{ label: "DP", nilai: 50 }, { label: "Sisa" }] })),
  );
  const psj2 = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id, penawaranId: null }, include: { baris: true, rencanaTermin: { orderBy: { no: "asc" } } } });
  pastikan(sama(psj2.total, 650_000) && sama(psj2.fee, 50_000) && psj2.rencanaTermin.length === 2, `pesanan kedua total 650.000 dengan fee nominal 50.000 dan dua butir termin (${teks(psj2.total)})`);

  console.log("=== 6. Surat jalan sound 1 unit ===");
  await harusDitolak("SJ: barang tidak sesuai baris pesanan", () => buatPengiriman(formulir({ pesananId: psj.id, gudangId: gudang.id, baris: [{ barisPesananId: bpSound.id, barangId: kamar.id, jumlah: 1 }] })), "Barang tidak sesuai baris pesanan");
  pastikan((await stok(sound.id)).equals(5), "SJ yang ditolak tidak mengubah stok");
  await jalankan("SJ sound 1 unit", () => buatPengiriman(formulir({ pesananId: psj.id, gudangId: gudang.id, baris: [{ barisPesananId: bpSound.id, barangId: sound.id, jumlah: 1 }] })));
  const sj = await db.pengirimanPesanan.findFirstOrThrow({ where: { pesananId: psj.id }, include: { baris: true } });
  pastikan((await stok(sound.id)).equals(4), `stok sound 5 → 4, bukan 2 (${await stok(sound.id)})`);
  pastikan(sj.baris.length === 1 && sama(sj.baris[0].jumlah, 1) && sama(sj.baris[0].hargaPokok, 1_000_000) && sj.perusahaanId === "utama", "baris SJ jumlah 1, harga pokok 1.000.000, milik utama");
  const jSj = await petaJurnal(sj.jurnalId);
  pastikan(sama(jSj.get(m.persediaanId)?.kredit ?? 0, 1_000_000), "JU-SJ Cr Persediaan 1.000.000");

  console.log("=== 7. Uang muka termin DP ===");
  const [termin1] = psj.rencanaTermin;
  await jalankan("UM termin DP 20.083.800", () => buatUangMuka(formulir({ pesananId: psj.id, akunId: kas.id, rencanaTerminId: termin1.id, jumlah: 20_083_800, terimaDari: "Bapak Uji", keperluan: "DP event uji" })));
  const um1 = await db.uangMukaPelanggan.findFirstOrThrow({ where: { pesananId: psj.id } });
  pastikan(um1.rencanaTerminId === termin1.id && um1.perusahaanId === "utama" && um1.terimaDari === "Bapak Uji" && um1.keperluan === "DP event uji" && um1.nomorCetak === null, "UM menaut butir DP, milik utama, menyimpan teks kuitansi");
  await harusDitolak("UM termin DP tambahan 1 rupiah", () => buatUangMuka(formulir({ pesananId: psj.id, akunId: kas.id, rencanaTerminId: termin1.id, jumlah: 1 })), "Pembayaran melebihi nilai termin DP");
  await harusDitolak("UM dengan butir termin pesanan lain", () => buatUangMuka(formulir({ pesananId: psj.id, akunId: kas.id, rencanaTerminId: psj2.rencanaTermin[0].id, jumlah: 1 })), "Termin tidak ditemukan di pesanan ini");
  await harusDitolak("UM tanpa termin melebihi sisa kontrak", () => buatUangMuka(formulir({ pesananId: psj.id, akunId: kas.id, jumlah: 46_862_201 })), "maks 46.862.200");
  pastikan((await db.uangMukaPelanggan.count({ where: { pesananId: psj.id } })) === 1, "penolakan UM tidak menyimpan dokumen");

  console.log("=== 8. Faktur jalur ID (persetujuan mati), nomor cetak jalur langsung ===");
  const pajakSebelum = await ringkasanPajak(db, tahun, D("0.5"));
  await db.formatNomor.create({ data: { perusahaanId: "utama", jenis: "faktur", pola: "UJIEVT-{SEQ3}/{YYYY}", kunciDeret: `${KUNCI_DERET}-faktur`, reset: "TAHUNAN" } });
  await harusDitolak("faktur campuran baris berid dan tanpa id", () => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, baris: [{ barisPesananId: bpSound.id, jumlah: 1 }, { barangId: kamar.id, jumlah: 1, harga: 650_000 }] })), "semuanya memakai baris pesanan");
  await harusDitolak("faktur jalur lama pada pesanan EVENT", () => buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, baris: [{ barangId: kamar.id, jumlah: 1, harga: 650_000 }] })), "wajib dibuat dari komposer faktur");
  await harusDitolak("faktur dengan isian perusahaan lain", () => buatFaktur(formulir({ pesananId: psj.id, perusahaanId: "tapussa", ppnPersen: 0, baris: [{ barisPesananId: bpSound.id, jumlah: 1 }] })), "milik perusahaan lain");
  await jalankan("FJ jalur ID tiga baris penuh, harga rakitan 1 rupiah, DP 20.083.800", () =>
    buatFaktur(formulir({ pesananId: psj.id, ppnPersen: 0, uangMuka: 20_083_800, baris: [{ barisPesananId: bpSound.id, barangId: sound.id, jumlah: 1, harga: 1 }, { barisPesananId: bpKamar.id, jumlah: 25 }, { barisPesananId: bpDok.id, jumlah: 1 }] })),
  );
  const fj = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj.id }, include: { baris: { orderBy: { urutan: "asc" } } } });
  pastikan(sama(fj.baris[0].harga, 2_000_000) && sama(fj.baris[0].frekuensi, 3) && fj.baris.every((b, i) => b.barisPesananId === psj.baris[i].id) && fj.baris[2].nama === "Dokumentasi", "harga dan frekuensi dari baris pesanan (harga rakitan diabaikan), barisPesananId terisi");
  pastikan(sama(fj.fee, 6_086_000) && sama(fj.diskon, 890_000) && sama(fj.dpp, 66_946_000) && sama(fj.total, 66_946_000) && sama(fj.uangMuka, 20_083_800), `faktur fee 6.086.000, diskon warisan 890.000, dpp = total 66.946.000, DP 20.083.800 (${teks(fj.fee)}, ${teks(fj.diskon)}, ${teks(fj.total)})`);
  pastikan(fj.mode === "EVENT" && fj.jenisFee === "PERSEN" && sama(fj.nilaiFee, 10) && fj.namaEvent === "Gathering Uji" && fj.perihal === "Penawaran Event Uji" && fj.catatan === pnw.catatan && fj.perusahaanId === "utama", "mode, fee, event, dan teks surat diwarisi pesanan; faktur milik utama");
  pastikan(fj.nomorCetak === `UJIEVT-001/${tahun}`, `nomor cetak faktur jalur langsung dialokasikan (${fj.nomorCetak})`);
  const jFj = await petaJurnal(fj.jurnalId);
  const cek = (akunId: string | null | undefined, sisi: "debit" | "kredit", harap: number) => sama(jFj.get(akunId ?? "")?.[sisi] ?? 0, harap);
  pastikan(cek(m.piutangUsahaId, "debit", 46_862_200) && cek(m.uangMukaPelangganId, "debit", 20_083_800) && cek(m.diskonPenjualanId, "debit", 890_000), "JU-FJ Dr Piutang 46.862.200, Dr Uang Muka 20.083.800, Dr Diskon 890.000");
  pastikan(cek(m.pendapatanPenjualanId, "kredit", 61_750_000) && cek(akunFee.id, "kredit", 6_086_000) && cek(m.hppId, "debit", 1_000_000) && cek(m.barangTerkirimId, "kredit", 1_000_000), "JU-FJ Cr Pendapatan 61.750.000, Cr fee 6.086.000, Dr HPP 1.000.000, Cr Barang Terkirim 1.000.000");
  const totalD = [...jFj.values()].reduce((s, x) => s.plus(x.debit), D(0));
  const totalK = [...jFj.values()].reduce((s, x) => s.plus(x.kredit), D(0));
  pastikan(totalD.equals(68_836_000) && totalK.equals(68_836_000), `jurnal FJ seimbang 68.836.000 (${teks(totalD)} / ${teks(totalK)})`);
  const akunPendapatan = new Set((await db.akun.findMany({ where: { jenis: "PENDAPATAN" }, select: { id: true } })).map((a) => a.id));
  const bersihPendapatan = [...jFj.entries()].filter(([id]) => akunPendapatan.has(id)).reduce((s, [, x]) => s.plus(x.kredit).minus(x.debit), D(0));
  pastikan(bersihPendapatan.equals(D(fj.dpp)), `Σ (kredit − debit) akun PENDAPATAN = dpp (${teks(bersihPendapatan)})`);
  const bpSesudah = await db.barisPesananPenjualan.findMany({ where: { pesananId: psj.id } });
  pastikan(bpSesudah.every((b) => D(b.jumlahDifaktur).equals(b.jumlah)), "setiap baris pesanan difaktur penuh");
  pastikan((await db.barisPengiriman.findUniqueOrThrow({ where: { id: sj.baris[0].id } })).jumlahDifaktur.equals(1), "baris SJ sound dikonsumsi faktur");

  console.log("=== 9. Sinkron dan omzet pajak ===");
  const s9 = await periksaSinkron(db);
  pastikan(s9.seimbang && s9.persediaan.sinkron && s9.piutang.sinkron && s9.uangMuka.sinkron && s9.barangTerkirim.sinkron, "periksaSinkron: seimbang, persediaan, piutang, uang muka, barang terkirim sinkron");
  const pajakSesudah = await ringkasanPajak(db, tahun, D("0.5"));
  pastikan(D(pajakSesudah.total.omzetLain).equals(pajakSebelum.total.omzetLain) && D(pajakSesudah.total.omzetFaktur).minus(pajakSebelum.total.omzetFaktur).equals(67_836_000), `omzetLain tetap, omzetFaktur naik 67.836.000 (${teks(D(pajakSesudah.total.omzetFaktur).minus(pajakSebelum.total.omzetFaktur))})`);

  console.log("=== 10. Akun fee salah dan fee negatif ditolak ===");
  await db.pemetaanAkunTambahan.update({ where: { kunci: KUNCI_AKUN_FEE }, data: { akunId: akunLain.id } });
  await harusDitolak("faktur pesanan kedua dengan akun fee di bawah 4-9000", () => buatFaktur(formulir({ pesananId: psj2.id, ppnPersen: 0, baris: [{ barisPesananId: psj2.baris[0].id, jumlah: 2 }] })), "tidak boleh berada di kelompok Diskon Penjualan atau Pendapatan Lain-lain");
  await db.pemetaanAkunTambahan.update({ where: { kunci: KUNCI_AKUN_FEE }, data: { akunId: akunFee.id } });
  await db.pesananPenjualan.update({ where: { id: psj2.id }, data: { fee: -1 } });
  await harusDitolak("faktur sebagian dengan fee pesanan negatif", () => buatFaktur(formulir({ pesananId: psj2.id, ppnPersen: 0, baris: [{ barisPesananId: psj2.baris[0].id, jumlah: 1 }] })), "Management fee tidak boleh negatif");
  await db.pesananPenjualan.update({ where: { id: psj2.id }, data: { fee: 50_000 } });
  pastikan((await db.fakturPenjualan.count({ where: { pesananId: psj2.id } })) === 0 && sama((await db.barisPesananPenjualan.findUniqueOrThrow({ where: { id: psj2.baris[0].id } })).jumlahDifaktur, 0), "faktur yang ditolak tidak tersimpan dan tidak mengonsumsi baris pesanan");

  console.log("=== 11. Faktur lewat alur persetujuan ===");
  aturPersetujuan(true);
  await sebagai(PENGAJU, () => jalankan("KASIR membuat faktur draf pesanan kedua", () => buatFaktur(formulir({ pesananId: psj2.id, ppnPersen: 0, baris: [{ barisPesananId: psj2.baris[0].id, jumlah: 2 }] }))));
  const fj2 = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psj2.id } });
  pastikan(fj2.statusPersetujuan === "DRAFT" && fj2.jurnalId === null && fj2.nomorCetak === null && sama(fj2.total, 650_000) && sama(fj2.fee, 50_000), "faktur draf tanpa jurnal dan tanpa nomor cetak, total 650.000 dengan fee 50.000");
  await sebagai(PENGAJU, () => jalankan("KASIR mengajukan faktur", () => ajukanDokumen("faktur", fj2.id)));
  await sebagai(PEMERIKSA, () => jalankan("ADMIN menyetujui faktur", () => setujuiDokumen("faktur", fj2.id)));
  aturPersetujuan(false);
  const fj2b = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fj2.id } });
  const jFj2 = await petaJurnal(fj2b.jurnalId);
  pastikan(fj2b.statusPersetujuan === "DISETUJUI" && sama(jFj2.get(m.pendapatanPenjualanId)?.kredit ?? 0, 600_000) && sama(jFj2.get(akunFee.id)?.kredit ?? 0, 50_000) && sama(jFj2.get(m.piutangUsahaId)?.debit ?? 0, 650_000), "setelah disetujui: Cr pendapatan 600.000 (frekuensi ikut), Cr fee 50.000, Dr piutang 650.000");
  pastikan(fj2b.nomorCetak === `UJIEVT-002/${tahun}`, `nomor cetak faktur dialokasikan saat disetujui (${fj2b.nomorCetak})`);

  console.log("=== 12. Retur jalur ID 5 kamar ===");
  const bfKamar = fj.baris[1];
  await harusDitolak("retur sound 2 unit (difaktur 1)", () => buatRetur(formulir({ fakturId: fj.id, gudangId: gudang.id, baris: [{ barisFakturId: fj.baris[0].id, jumlah: 2 }] })), "melebihi yang bisa diretur (maks 1");
  await harusDitolak("retur baris faktur lain", () => buatRetur(formulir({ fakturId: fj.id, gudangId: gudang.id, baris: [{ barisFakturId: fj2.id, jumlah: 1 }] })), "Baris faktur tidak ditemukan di faktur ini");
  await db.fakturPenjualan.update({ where: { id: fj.id }, data: { fee: -6_086_000 } });
  await harusDitolak("retur dengan fee faktur negatif", () => buatRetur(formulir({ fakturId: fj.id, gudangId: gudang.id, baris: [{ barisFakturId: bfKamar.id, jumlah: 5 }] })), "Management fee tidak boleh negatif");
  await db.fakturPenjualan.update({ where: { id: fj.id }, data: { fee: 6_086_000 } });
  await jalankan("RJ 5 kamar", () => buatRetur(formulir({ fakturId: fj.id, gudangId: gudang.id, alasan: "kamar batal", baris: [{ barisFakturId: bfKamar.id, barangId: kamar.id, jumlah: 5 }] })));
  const rj = await db.returPenjualan.findFirstOrThrow({ where: { fakturId: fj.id }, include: { baris: true } });
  pastikan(sama(rj.diskon, "140526.32") && sama(rj.fee, "960947.37") && sama(rj.dpp, "10570421.05") && sama(rj.total, "10570421.05") && rj.baris[0].barisFakturId === bfKamar.id && rj.perusahaanId === "utama", `retur diskon 140.526,32, fee 960.947,37, dpp = total 10.570.421,05 (${teks(rj.diskon)}, ${teks(rj.fee)}, ${teks(rj.total)})`);
  const jRj = await petaJurnal(rj.jurnalId);
  pastikan(sama(jRj.get(akunFee.id)?.debit ?? 0, "960947.37") && sama(jRj.get(m.pendapatanPenjualanId)?.debit ?? 0, 9_750_000) && sama(jRj.get(m.diskonPenjualanId ?? "")?.kredit ?? 0, "140526.32") && sama(jRj.get(m.piutangUsahaId)?.kredit ?? 0, "10570421.05"), "JU-RJ Dr pendapatan 9.750.000, Dr fee 960.947,37, Cr diskon 140.526,32, Cr piutang 10.570.421,05");
  pastikan((await stok(sound.id)).equals(4), "retur jasa tidak mengubah stok");

  console.log("=== 13. Pelunasan dan basis kas ===");
  await harusDitolak("bayar melebihi sisa", () => buatPenerimaan(formulir({ fakturId: fj.id, akunId: kas.id, jumlah: "36291778.96" })), "melebihi sisa tagihan");
  await jalankan("TRM pelunasan 36.291.778,95", () => buatPenerimaan(formulir({ fakturId: fj.id, akunId: kas.id, jumlah: "36291778.95", terimaDari: "Bapak Uji", keperluan: "Pelunasan event uji" })));
  const trm = await db.penerimaanPenjualan.findFirstOrThrow({ where: { fakturId: fj.id } });
  pastikan((await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fj.id } })).status === "LUNAS" && trm.perusahaanId === "utama" && trm.keperluan === "Pelunasan event uji", "faktur LUNAS; penerimaan milik utama dengan teks kuitansi");
  const periode = bacaPeriode({ dari: `${tahun}-01-01`, sampai: `${tahun}-12-31` });
  const k = await labaRugiKas(db, periode);
  const bagianFee = k.pendapatan.find((b) => b.id === akunFee.id);
  pastikan(!!bagianFee && bagianFee.jumlah.gt(0), `basis kas: akun fee uji menerima bagian kas (${bagianFee ? teks(bagianFee.jumlah) : "tidak ada"})`);
  const n = (v: Desimal) => Number(v);
  const dekat = (a: number, b: number) => Math.abs(a - b) < 0.01;
  pastikan(dekat(n(k.totalPendapatan) + n(k.ppnTitipan) + n(k.totalPenerimaanLain) - n(k.totalPengeluaran), n(k.surplus)) && dekat(n(k.totalDariPelanggan), n(k.totalPendapatan) + n(k.ppnTitipan)), "invarian basis kas tetap (pendapatan + PPN titipan + penerimaan lain − pengeluaran = surplus; kas pelanggan = pendapatan + PPN titipan)");

  console.log("=== 14. Hak ===");
  const pnwKecil = { pelangganId: pelanggan.id, baris: [{ barangId: kamar.id, jumlah: 1, harga: 650_000 }] };
  await sebagaiPeran("GUDANG", () => harusDitolak("GUDANG membuat penawaran", () => buatPenawaran(formulir(pnwKecil)), "tidak punya hak"));
  const sebelumKasir = await jumlahPenawaran();
  await sebagaiPeran("KASIR", () => jalankan("KASIR membuat penawaran", () => buatPenawaran(formulir(pnwKecil))));
  pastikan((await jumlahPenawaran()) === sebelumKasir + 1, "penawaran KASIR tersimpan");
  // tinjauan P23 S2: JASA-LAIN dan nama barang katalog yang diganti juga butuh harga.nego
  const lainLain = await db.barang.findUniqueOrThrow({ where: { kode: KODE_BARANG_LAIN } });
  await db.hakAksesPeran.upsert({ where: { peran_hak: { peran: "KASIR", hak: "harga.nego" } }, create: { peran: "KASIR", hak: "harga.nego", boleh: false }, update: { boleh: false } });
  await sebagaiPeran("KASIR", async () => {
    await harusDitolak("KASIR tanpa harga.nego memakai barangId JASA-LAIN", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: lainLain.id, nama: "Sound system 10 kW", jumlah: 1, harga: 1 }] })), "Baris bebas (tanpa barang katalog) butuh hak");
    await harusDitolak("KASIR tanpa harga.nego mengganti nama barang katalog", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: kamar.id, nama: "Sound system 10 kW", jumlah: 1, harga: 650_000 }] })), "Mengganti nama barang Kamar Twin Uji butuh hak");
    await jalankan("KASIR tanpa harga.nego memakai nama katalog yang sama", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: kamar.id, nama: " Kamar  Twin Uji ", jumlah: 1, harga: 650_000 }] })));
  });
  await db.hakAksesPeran.delete({ where: { peran_hak: { peran: "KASIR", hak: "harga.nego" } } });
  pastikan((await jumlahPenawaran()) === sebelumKasir + 2, "hanya penawaran dengan nama katalog yang sama yang tersimpan");
  await sebagaiPeran("KASIR", () => jalankan("KASIR dengan harga.nego bawaan mengganti nama barang katalog", () => buatPenawaran(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: kamar.id, nama: "Kamar Twin Deluxe", jumlah: 1, harga: 650_000 }] }))));
  pastikan((await jumlahPenawaran()) === sebelumKasir + 3, "pemegang harga.nego boleh mengganti nama barang katalog");
  pastikan(hitungHak("KASIR").includes("faktur.ubah") && !hitungHak("GUDANG").includes("pesanan.ubah") && !hitungHak("KRU").includes("penawaran.lihat"), "KASIR punya faktur.ubah; GUDANG tanpa pesanan.ubah; KRU tanpa penawaran.lihat");
  const dokJual = /^(penawaran|pesanan|faktur|penerimaan|uang-muka)\./;
  pastikan((["SOSMED", "IKLAN", "DESAINER"] as const).every((p) => !hitungHak(p).some((h) => dokJual.test(h))), "SOSMED, IKLAN, DESAINER tanpa kunci dokumen penjualan");

  await bagianPerusahaanLain({ kas, modal, pelanggan, proyek, sound, tahun });
  await bagianPajakDanTermin({ kas, pelanggan });

  console.log("=== 15. Hapus berurutan lewat hapusDokumen ===");
  const hapus = (jenis: JenisDokumen, id: string, label: string) => jalankan(`hapus ${label}`, () => hapusDokumen(jenis, id));
  await hapus("penerimaan", trm.id, "penerimaan pelunasan");
  await hapus("returPenjualan", rj.id, "retur");
  await hapus("faktur", fj.id, "faktur jalur ID");
  pastikan((await db.barisPesananPenjualan.findMany({ where: { pesananId: psj.id } })).every((b) => D(b.jumlahDifaktur).isZero()) && D((await db.barisPengiriman.findUniqueOrThrow({ where: { id: sj.baris[0].id } })).jumlahDifaktur).isZero(), "hapus faktur jalur ID: jumlahDifaktur baris pesanan dan baris SJ kembali 0");
  pastikan(sama((await db.uangMukaPelanggan.findUniqueOrThrow({ where: { id: um1.id } })).jumlahDipakai, 0), "uang muka termin kembali tidak terpakai");
  await hapus("uangMuka", um1.id, "uang muka termin");
  await hapus("pengiriman", sj.id, "surat jalan");
  pastikan((await stok(sound.id)).equals(5), "stok sound kembali 5");
  await hapus("pesanan", psj.id, "pesanan event");
  pastikan((await db.rencanaTermin.count({ where: { pesananId: psj.id } })) === 0, "butir termin pesanan ikut terhapus");
  await hapus("penawaran", pnw.id, "penawaran event");
  await hapus("faktur", fj2.id, "faktur hasil persetujuan");
  // notifikasi persetujuan (diminta, disetujui) untuk faktur uji dibuang supaya suite lain tidak terpengaruh
  await db.notifikasi.deleteMany({ where: { judul: { contains: fj2.nomor } } });
  await hapus("pesanan", psj2.id, "pesanan kedua");
  for (const p of await db.penawaranPenjualan.findMany({ where: { pelangganId: pelanggan.id }, select: { id: true, nomor: true } })) await hapus("penawaran", p.id, `penawaran ${p.nomor}`);
  const ps = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { baris: { some: { barangId: sound.id } } } });
  await hapus("penyesuaian", ps.id, "PS saldo awal sound");
  pastikan((await db.logAktivitas.count({ where: { aksi: "HAPUS", waktu: { gte: mulaiUji }, nomor: { in: [fj.nomor, rj.nomor, trm.nomor, um1.nomor, sj.nomor, psj.nomor, pnw.nomor] } } })) === 7, "log HAPUS tercatat untuk tujuh dokumen alur utama");
  pastikan((await db.jurnal.count()) === jurnalAwal, "jumlah jurnal kembali seperti sebelum alur");
  const s15 = await periksaSinkron(db);
  pastikan(s15.seimbang && s15.persediaan.sinkron && s15.piutang.sinkron && s15.uangMuka.sinkron, "periksaSinkron sinkron sesudah semua dokumen dihapus");
}

/** Bagian 16: dokumen dibuat di sesi tapussa (UJI_PERUSAHAAN) beserta jurnalnya milik tapussa; nomor cetak per perusahaan. */
async function bagianPerusahaanLain(d: { kas: { id: string }; modal: { id: string }; pelanggan: { id: string }; proyek: { id: string }; sound: { id: string }; tahun: number }) {
  console.log("=== 16. Sesi tapussa: dokumen dan jurnal milik tapussa ===");
  const T = "tapussa";
  const gudangT = await db.gudang.create({ data: { kode: `WH-${AWALAN_KODE}-TPS`, nama: "Gudang Uji Tapussa", perusahaanId: T } });
  const gudangU = await db.gudang.create({ data: { kode: `WH-${AWALAN_KODE}-U`, nama: "Gudang Uji Utama", perusahaanId: "utama" } });
  const barangT = await db.barang.create({ data: { kode: `BRG-${AWALAN_KODE}-TPS`, nama: "Barang Uji Tapussa", jenis: "BARANG", satuan: "pcs", hargaBeli: 100_000, hargaJual: 150_000, perusahaanId: T } });
  const kasT = await db.akun.create({ data: { kode: `UJI-${AWALAN_KODE}-KAS-TPS`, nama: "Kas Uji Tapussa", jenis: "ASET", kasBank: true, perusahaanId: T } });
  const kasU = await db.akun.create({ data: { kode: `UJI-${AWALAN_KODE}-KAS-U`, nama: "Kas Uji Utama", jenis: "ASET", kasBank: true, perusahaanId: "utama" } });
  const proyekT = await db.proyek.create({ data: { kode: `PRJ-${AWALAN_KODE}-TPS`, nama: "Event Uji Tapussa", perusahaanId: T } });
  const pelangganT = await db.pelanggan.create({ data: { kode: `PLG-${AWALAN_KODE}-TPS`, nama: "Klien Uji Tapussa" } });
  const pola = (jenis: string, kode: string, deret: string) => db.formatNomor.create({ data: { perusahaanId: T, jenis, pola: `{KODE}/UJIEVT-${kode}/{SEQ3}/{YYYY}`, kunciDeret: `${KUNCI_DERET}-tps-${deret}`, reset: "TAHUNAN" } });
  await pola("penawaran", "S", "surat");
  await pola("faktur", "S", "surat");
  await pola("kwitansi", "K", "kw");
  await pola("kwitansi-dp", "DP", "dp");
  const jurnalAwalT = await db.jurnal.count({ where: { perusahaanId: T } });

  await diPerusahaan(T, async () => {
    await jalankan("PS saldo awal barang tapussa 10 @ 100.000", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudangT.id, akunLawanId: d.modal.id, baris: [{ barangId: barangT.id, jumlahSesudah: 10, hargaSatuan: 100_000 }] })));
    await harusDitolak("PNW di sesi tapussa dengan barang milik utama", () => buatPenawaran(formulir({ pelangganId: pelangganT.id, baris: [{ barangId: d.sound.id, jumlah: 1, harga: 2_000_000 }] })), "milik D'Production");
    await harusDitolak("PNW di sesi tapussa dengan proyek milik utama", () => buatPenawaran(formulir({ pelangganId: pelangganT.id, proyekId: d.proyek.id, baris: [{ barangId: barangT.id, jumlah: 1, harga: 150_000 }] })), "pilih proyek Tapussa");
    await harusDitolak("PNW nomor cetak manual dengan karakter kendali", () => buatPenawaran(formulir({ pelangganId: pelangganT.id, nomorCetak: "PNW‮1", baris: [{ barangId: barangT.id, jumlah: 1, harga: 150_000 }] })), "karakter yang tidak diizinkan");
    await jalankan("PNW tapussa 4 @ 150.000, termin 50% + sisa", () =>
      buatPenawaran(formulir({ pelangganId: pelangganT.id, proyekId: proyekT.id, ppnPersen: 0, baris: [{ barangId: barangT.id, jumlah: 4, harga: 150_000 }], rencanaTermin: [{ label: "DP", nilai: 50 }, { label: "Pelunasan" }] })),
    );
  });
  const pnwT = await db.penawaranPenjualan.findFirstOrThrow({ where: { pelangganId: pelangganT.id }, include: { rencanaTermin: true } });
  pastikan(pnwT.perusahaanId === T && pnwT.rencanaTermin.every((t) => t.perusahaanId === T) && pnwT.nomorCetak === `TAPUSSA/UJIEVT-S/001/${d.tahun}`, `penawaran dan termin milik tapussa, nomor cetak saat dibuat (${pnwT.nomorCetak})`);
  await diPerusahaan(T, () => jalankan("konversi tapussa", () => konversiPenawaranKePesanan(pnwT.id)));
  const psjT = await db.pesananPenjualan.findFirstOrThrow({ where: { penawaranId: pnwT.id }, include: { baris: true, rencanaTermin: { orderBy: { no: "asc" } } } });
  pastikan(psjT.perusahaanId === T && psjT.proyekId === proyekT.id && psjT.rencanaTermin.every((t) => t.perusahaanId === T), "pesanan mewarisi perusahaan dan proyek penawaran");

  // dokumen anak dibuat di sesi utama tetap milik tapussa (mewarisi induk, bukan lingkup)
  await harusDitolak("SJ pesanan tapussa dari gudang milik utama", () => buatPengiriman(formulir({ pesananId: psjT.id, gudangId: gudangU.id, baris: [{ barisPesananId: psjT.baris[0].id, barangId: barangT.id, jumlah: 1 }] })), "milik D'Production");
  await jalankan("SJ tapussa 4", () => buatPengiriman(formulir({ pesananId: psjT.id, gudangId: gudangT.id, baris: [{ barisPesananId: psjT.baris[0].id, barangId: barangT.id, jumlah: 4 }] })));
  await harusDitolak("UM pesanan tapussa ke kas milik utama", () => buatUangMuka(formulir({ pesananId: psjT.id, akunId: kasU.id, jumlah: 100_000 })), "tidak bisa dipakai di pembukuan Tapussa");
  await harusDitolak("UM dengan isian perusahaan utama", () => buatUangMuka(formulir({ pesananId: psjT.id, perusahaanId: "utama", akunId: kasT.id, jumlah: 100_000 })), "milik perusahaan lain");
  await jalankan("UM termin DP tapussa 300.000", () => buatUangMuka(formulir({ pesananId: psjT.id, akunId: kasT.id, rencanaTerminId: psjT.rencanaTermin[0].id, jumlah: 300_000 })));
  await jalankan("FJ tapussa jalur lama 4 @ 150.000, DP 300.000", () => buatFaktur(formulir({ pesananId: psjT.id, ppnPersen: 0, uangMuka: 300_000, baris: [{ barangId: barangT.id, jumlah: 4, harga: 150_000 }] })));
  const fjT = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psjT.id }, include: { baris: true } });
  await jalankan("TRM tapussa 100.000 nomor manual", () => buatPenerimaan(formulir({ fakturId: fjT.id, akunId: kasT.id, jumlah: 100_000, nomorCetak: "KW-UJIEVT-MANUAL" })));
  await harusDitolak("TRM nomor manual yang sama", () => buatPenerimaan(formulir({ fakturId: fjT.id, akunId: kasT.id, jumlah: 50_000, nomorCetak: "KW-UJIEVT-MANUAL" })), "sudah dipakai dokumen lain");
  await harusDitolak("TRM tapussa ke kas milik utama", () => buatPenerimaan(formulir({ fakturId: fjT.id, akunId: kasU.id, jumlah: 50_000 })), "tidak bisa dipakai di pembukuan Tapussa");
  await harusDitolak("RJ tapussa ke gudang milik utama", () => buatRetur(formulir({ fakturId: fjT.id, gudangId: gudangU.id, baris: [{ barangId: barangT.id, jumlah: 1 }] })), "milik D'Production");
  await jalankan("RJ tapussa 1 unit jalur lama", () => buatRetur(formulir({ fakturId: fjT.id, gudangId: gudangT.id, baris: [{ barangId: barangT.id, jumlah: 1 }] })));
  await jalankan("TRM tapussa sisa 50.000 nomor otomatis", () => buatPenerimaan(formulir({ fakturId: fjT.id, akunId: kasT.id, jumlah: 50_000 })));

  const sjT = await db.pengirimanPesanan.findFirstOrThrow({ where: { pesananId: psjT.id } });
  const umT = await db.uangMukaPelanggan.findFirstOrThrow({ where: { pesananId: psjT.id } });
  const trmT = await db.penerimaanPenjualan.findMany({ where: { fakturId: fjT.id }, orderBy: { nomor: "asc" } });
  const rjT = await db.returPenjualan.findFirstOrThrow({ where: { fakturId: fjT.id }, include: { baris: true } });
  const fjT2 = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fjT.id } });
  const dokT = [sjT, umT, fjT2, rjT, ...trmT];
  pastikan(dokT.every((x) => x.perusahaanId === T), `SJ, UM, FJ, RJ, dan dua TRM milik tapussa (${dokT.map((x) => x.perusahaanId).join(", ")})`);
  const jurnalIds = dokT.map((x) => x.jurnalId).filter((x): x is string => !!x);
  const jurnalT = await db.jurnal.findMany({ where: { id: { in: jurnalIds } }, select: { perusahaanId: true, proyekId: true } });
  pastikan(jurnalT.length === 6 && jurnalT.every((j) => j.perusahaanId === T && j.proyekId === proyekT.id), `enam jurnal (SJ, UM, FJ, RJ, 2 TRM) milik tapussa dan bertanda proyek tapussa (${jurnalT.length})`);
  pastikan(fjT2.nomorCetak === `TAPUSSA/UJIEVT-S/002/${d.tahun}` && umT.nomorCetak === `TAPUSSA/UJIEVT-DP/001/${d.tahun}`, `faktur memakai deret surat bersama penawaran (${fjT2.nomorCetak}), kuitansi DP bernomor (${umT.nomorCetak})`);
  pastikan(trmT.map((t) => t.nomorCetak).sort().join() === `KW-UJIEVT-MANUAL,TAPUSSA/UJIEVT-K/001/${d.tahun}`, `kuitansi manual dipakai apa adanya dan penghitung tidak naik (${trmT.map((t) => t.nomorCetak).join(", ")})`);
  pastikan(rjT.baris[0].barisFakturId === fjT.baris[0].id && fjT.baris[0].barisPesananId === psjT.baris[0].id, "retur jalur lama mengisi barisFakturId, faktur jalur lama mengisi barisPesananId");
  pastikan(fjT2.status === "LUNAS", "faktur tapussa lunas (DP + TRM + retur)");
  const sT = await periksaSinkron(db, { perusahaanId: T });
  pastikan(sT.seimbang && sT.persediaan.sinkron && sT.piutang.sinkron && sT.uangMuka.sinkron && sT.barangTerkirim.sinkron, "periksaSinkron tapussa: seimbang dan sinkron");
  pastikan((await db.jurnal.count({ where: { perusahaanId: T } })) === jurnalAwalT + 7, "tapussa bertambah tujuh jurnal (PS, SJ, UM, FJ, RJ, 2 TRM)");

  const hapus = (jenis: JenisDokumen, id: string, label: string) => jalankan(`hapus ${label}`, () => hapusDokumen(jenis, id));
  for (const t of trmT) await hapus("penerimaan", t.id, `TRM tapussa ${t.nomor}`);
  await hapus("returPenjualan", rjT.id, "RJ tapussa");
  await hapus("faktur", fjT.id, "FJ tapussa");
  await hapus("uangMuka", umT.id, "UM tapussa");
  await hapus("pengiriman", sjT.id, "SJ tapussa");
  await hapus("pesanan", psjT.id, "PSJ tapussa");
  await hapus("penawaran", pnwT.id, "PNW tapussa");
  const psT = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { baris: { some: { barangId: barangT.id } } } });
  pastikan(psT.perusahaanId === T, "PS saldo awal milik tapussa (pemilik barang)");
  await hapus("penyesuaian", psT.id, "PS tapussa");
  pastikan((await db.jurnal.count({ where: { perusahaanId: T } })) === jurnalAwalT, "jurnal tapussa kembali seperti sebelum bagian ini");
  void d.kas;
}

/** Bagian 17: pengaturan pajak dari perusahaan dokumen, batas uang muka bertermin, butir termin bruto 0. */
async function bagianPajakDanTermin(d: { kas: { id: string }; pelanggan: { id: string } }) {
  console.log("=== 17. Pengaturan pajak perusahaan dokumen dan batas uang muka bertermin ===");
  const pkp = await db.perusahaan.create({ data: { kode: KODE_PERUSAHAAN_PKP, nama: "PT Uji Event PKP", urutan: 97 } });
  const bawaan = await db.pengaturanPerusahaan.findUniqueOrThrow({ where: { id: "default" } });
  await db.pengaturanPerusahaan.create({ data: { id: pkp.id, perusahaanId: pkp.id, nama: "PT Uji Event PKP", pkp: true, tarifPpnPersen: 11, akunPpnKeluaranId: bawaan.akunPpnKeluaranId } });
  const jasaB = await db.barang.create({ data: { kode: `JS-${AWALAN_KODE}-BERSAMA`, nama: "Jasa Bersama Uji Event", jenis: "JASA", satuan: "paket", hargaBeli: 0, hargaJual: 1, perusahaanId: null } });

  await harusDitolak("pesanan PPN 11% di utama (non-PKP)", () => buatPesanan(formulir({ pelangganId: d.pelanggan.id, ppnPersen: 11, baris: [{ barangId: jasaB.id, jumlah: 1, harga: 1_000_000 }] })), "belum PKP");
  // pesanan bertermin dengan PPN pesanan 12% (berbeda dari tarif pengaturan 11%): batas uang muka = nilai kontrak bruto pesanan
  await jalankan("PSJ PKP bertermin 20.000.001, PPN 12%", () =>
    buatPesanan(formulir({ pelangganId: d.pelanggan.id, perusahaanId: pkp.id, ppnPersen: 12, baris: [{ barangId: jasaB.id, jumlah: 1, harga: "20000001" }], rencanaTermin: [{ label: "DP", nilai: 50 }, { label: "Pelunasan" }] })),
  );
  const psjB = await db.pesananPenjualan.findFirstOrThrow({ where: { perusahaanId: pkp.id, total: "20000001" }, include: { rencanaTermin: { orderBy: { no: "asc" } } } });
  pastikan(sama(psjB.ppnPersen, 12) && psjB.rencanaTermin.length === 2, "pesanan PKP menyimpan PPN 12% dan dua butir termin");
  await jalankan("UM termin DP 11.200.000,56", () => buatUangMuka(formulir({ pesananId: psjB.id, akunId: d.kas.id, rencanaTerminId: psjB.rencanaTermin[0].id, jumlah: "11200000.56" })));
  await jalankan("UM termin pelunasan penuh 11.200.000,56", () => buatUangMuka(formulir({ pesananId: psjB.id, akunId: d.kas.id, rencanaTerminId: psjB.rencanaTermin[1].id, jumlah: "11200000.56" })));
  await harusDitolak("UM tambahan 0,01 sesudah kontrak bruto lunas", () => buatUangMuka(formulir({ pesananId: psjB.id, akunId: d.kas.id, jumlah: "0.01" })), "maks 0");
  const umB = await db.uangMukaPelanggan.findMany({ where: { pesananId: psjB.id } });
  pastikan(umB.length === 2 && umB.every((u) => u.perusahaanId === pkp.id) && umB.reduce((s, u) => s.plus(u.jumlah), D(0)).equals(D("22400001.12")), "dua UM termin = nilai kontrak bruto 22.400.001,12 (rumus lama dengan tarif 11% hanya 22.200.001,11)");
  // pesanan tanpa termin: rumus lama dari pengaturan perusahaan pesanan (tarif 11%), bukan PPN pesanan
  await jalankan("PSJ PKP tanpa termin 1.000.000, PPN 12%", () => buatPesanan(formulir({ pelangganId: d.pelanggan.id, perusahaanId: pkp.id, ppnPersen: 12, baris: [{ barangId: jasaB.id, jumlah: 1, harga: 1_000_000 }] })));
  const psjC = await db.pesananPenjualan.findFirstOrThrow({ where: { perusahaanId: pkp.id, total: 1_000_000 }, include: { baris: true } });
  await harusDitolak("UM pesanan tanpa termin melebihi total + PPN tarif pengaturan", () => buatUangMuka(formulir({ pesananId: psjC.id, akunId: d.kas.id, jumlah: 1_110_001 })), "maks 1.110.000");
  // faktur memakai pengaturan perusahaan pesanan: PPN 11% sah, jurnal PPN keluaran milik perusahaan PKP
  await jalankan("FJ PKP PPN 11%", () => buatFaktur(formulir({ pesananId: psjC.id, ppnPersen: 11, baris: [{ barisPesananId: psjC.baris[0].id, jumlah: 1 }] })));
  const fjC = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: psjC.id } });
  const jC = await db.jurnal.findUniqueOrThrow({ where: { id: fjC.jurnalId! }, include: { baris: true } });
  pastikan(fjC.perusahaanId === pkp.id && sama(fjC.ppn, 110_000) && jC.perusahaanId === pkp.id && jC.baris.some((b) => b.akunId === bawaan.akunPpnKeluaranId && sama(b.kredit, 110_000)), "faktur PKP: PPN 110.000, jurnal milik perusahaan PKP dengan Cr PPN Keluaran");
  pastikan(fjC.jatuhTempo !== null && Math.round((fjC.jatuhTempo.getTime() - fjC.tanggal.getTime()) / 86_400_000) === 14, "jatuh tempo dari termin hari pengaturan perusahaan dokumen");
  await harusDitolak("TRM potongan PPh 23 tanpa akun di pengaturan perusahaan faktur", () => buatPenerimaan(formulir({ fakturId: fjC.id, akunId: d.kas.id, jumlah: 100_000, potonganPajak: 2_000 })), "belum diatur untuk PT Uji Event PKP");

  // butir termin bernilai termasuk PPN 0 (tinjauan P22 R2): server dan pratinjau klien memberi pesan sama
  const butirKecil = [{ mode: "NOMINAL", nilai: "0.05" }, { mode: "NOMINAL", nilai: "0.01" }, { mode: "NOMINAL", nilai: "0.05" }, {}];
  await harusDitolak("PSJ termin dengan butir terakhir bruto 0", () => buatPesanan(formulir({ pelangganId: d.pelanggan.id, perusahaanId: pkp.id, ppnPersen: 11, baris: [{ barangId: jasaB.id, jumlah: 1, harga: "0.12" }], rencanaTermin: butirKecil })), "Termin 4 terlalu kecil setelah PPN dibulatkan");
  pastikan(pratinjauTerminKlien(butirKecil, "0.12", 11).galat === "Termin 4 terlalu kecil setelah PPN dibulatkan", "pratinjau klien memberi pesan yang sama");
  let galatServer = "";
  try {
    periksaBrutoRencana(selesaikanRencana(butirKecil, D("0.12")), 11);
  } catch (e) {
    galatServer = (e as Error).message;
  }
  pastikan(galatServer === "Termin 4 terlalu kecil setelah PPN dibulatkan", "periksaBrutoRencana menolak butir bruto 0");
  pastikan(pratinjauTerminKlien([{ nilai: 30 }, {}], 10_000_000, 11).galat === null, "rencana biasa tetap lolos di klien");

  const hapus = (jenis: JenisDokumen, id: string, label: string) => jalankan(`hapus ${label}`, () => hapusDokumen(jenis, id));
  await hapus("faktur", fjC.id, "FJ PKP");
  for (const u of umB) await hapus("uangMuka", u.id, `UM PKP ${u.nomor}`);
  await hapus("pesanan", psjB.id, "PSJ PKP bertermin");
  await hapus("pesanan", psjC.id, "PSJ PKP tanpa termin");
  pastikan((await db.jurnal.count({ where: { perusahaanId: pkp.id } })) === 0, "jurnal perusahaan PKP uji habis");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
