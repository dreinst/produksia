import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import { nilaiBaris } from "@/lib/nilaiBaris";
import { D, type Desimal } from "@/lib/uang";
import { cariAtauBuatKategori, kategoriLainnya, kunciNama, muatPetaKategori, PANJANG_NAMA_KATEGORI, rapikanNama } from "@/lib/kategoriAnggaran";
import { kunciBarisProyek } from "@/lib/keuanganProyek";

/*
 * Sinkron anggaran proyek dari penawaran atau pesanan (D5 §3.6, padanan import/sync HKA): baris sumber, kunci baris
 * "{nama}|{bagian}|{n}" huruf kecil, tanda isi dokumen (16 karakter awal SHA-1), kategori baris baru, penerapan
 * sinkron di dalam transaksi pemanggil, dan status basi per dokumen. Bukan "use server"; hak diperiksa aksi.
 */

type Klien = PrismaClient | Prisma.TransactionClient;
export type JenisSumberAnggaran = "penawaran" | "pesanan";

export type BarisSumber = { kunci: string; nama: string; bagian: string; nilai: Desimal; akunBebanBarangId: string | null };

/** Kunci per baris: nama dan bagian huruf kecil, lalu urutan kemunculan pasangan itu (mulai 1). */
export function beriKunci(baris: readonly { nama: string; bagian: string; nilai: Desimal; akunBebanBarangId: string | null }[]): BarisSumber[] {
  const hitung = new Map<string, number>();
  return baris.map((b) => {
    const nama = rapikanNama(b.nama);
    const bagian = rapikanNama(b.bagian);
    const dasar = `${nama.toLowerCase()}|${bagian.toLowerCase()}`;
    const n = (hitung.get(dasar) ?? 0) + 1;
    hitung.set(dasar, n);
    return { kunci: `${dasar}|${n}`, nama, bagian, nilai: b.nilai, akunBebanBarangId: b.akunBebanBarangId };
  });
}

/** Tanda isi dokumen sumber: 16 karakter awal SHA-1 dari pasangan [kunci, nilai 2 desimal] semua baris. */
export function tandaSumber(baris: readonly BarisSumber[]): string {
  return createHash("sha1")
    .update(JSON.stringify(baris.map((b) => [b.kunci, b.nilai.toFixed(2)])))
    .digest("hex")
    .slice(0, 16);
}

export type DokumenSumber = { id: string; jenis: JenisSumberAnggaran; nomor: string; proyekId: string | null; perusahaanId: string; baris: BarisSumber[] };

const PILIH_BARIS = { nama: true, bagian: true, jumlah: true, harga: true, frekuensi: true, barang: { select: { nama: true, akunBebanId: true } } } as const;
const URUT_BARIS = [{ urutan: "asc" as const }, { id: "asc" as const }];

/**
 * Dokumen sumber beserta barisnya (urut `urutan` lalu id), atau null bila tidak ada. Nama baris = `nama` atau nama
 * barang; nilai penawaran = `subtotal`, pesanan = nilaiBaris (jumlah × frekuensi × harga).
 */
export async function muatBarisSumber(klien: Klien, jenis: JenisSumberAnggaran, id: string): Promise<DokumenSumber | null> {
  const kepala = { id: true, nomor: true, proyekId: true, perusahaanId: true } as const;
  const dok =
    jenis === "penawaran"
      ? await klien.penawaranPenjualan.findUnique({ where: { id }, select: { ...kepala, baris: { orderBy: URUT_BARIS, select: { ...PILIH_BARIS, subtotal: true } } } })
      : await klien.pesananPenjualan.findUnique({ where: { id }, select: { ...kepala, baris: { orderBy: URUT_BARIS, select: PILIH_BARIS } } });
  if (!dok) return null;
  const baris = beriKunci(
    dok.baris.map((b) => ({
      nama: b.nama?.trim() ? b.nama : b.barang.nama,
      bagian: b.bagian ?? "",
      nilai: "subtotal" in b ? D(b.subtotal as Desimal) : nilaiBaris(b),
      akunBebanBarangId: b.barang.akunBebanId,
    })),
  );
  return { id: dok.id, jenis, nomor: dok.nomor, proyekId: dok.proyekId, perusahaanId: dok.perusahaanId, baris };
}

/** Kolom sumber baris anggaran untuk satu jenis dokumen. */
const kolomSumber = (jenis: JenisSumberAnggaran) => (jenis === "penawaran" ? "sumberPenawaranId" : "sumberPesananId");

export type HasilSinkronAnggaran = { pertama: boolean; ditambah: number; diperbarui: number; dihapus: number; kategoriBaru: string[] };

/**
 * Menerapkan sinkron satu dokumen sumber ke baris anggaran proyek (D5 §3.6 langkah 4 sampai 7) di transaksi pemanggil,
 * yang sudah mengunci baris proyek. Baris anggaran yang cocok per kunci hanya diperbarui kolom sumbernya (rencana,
 * uraian, kategori, vendor, dan catatan tidak disentuh); baris sumber tanpa pasangan menjadi baris baru berencana 0;
 * baris anggaran tanpa pasangan ditandai `dihapusDariSumber` dan tetap dihitung.
 */
export async function terapkanSinkronAnggaran(tx: Klien, proyekId: string, dok: DokumenSumber, waktu: Date): Promise<HasilSinkronAnggaran> {
  const kolom = kolomSumber(dok.jenis);
  const tanda = tandaSumber(dok.baris);
  const ada = await tx.barisAnggaranProyek.findMany({
    where: { proyekId, [kolom]: dok.id },
    orderBy: [{ dibuatPada: "asc" }, { id: "asc" }],
    select: { id: true, kunciSumber: true, nilaiAcuan: true },
  });
  const perKunci = new Map<string, (typeof ada)[number]>();
  for (const b of ada) if (b.kunciSumber && !perKunci.has(b.kunciSumber)) perKunci.set(b.kunciSumber, b);

  const dipakai = new Set<string>();
  const baru: BarisSumber[] = [];
  let diperbarui = 0;
  for (const s of dok.baris) {
    const cocok = perKunci.get(s.kunci);
    if (cocok && !dipakai.has(cocok.id)) {
      dipakai.add(cocok.id);
      const berubah = cocok.nilaiAcuan === null || !D(cocok.nilaiAcuan).equals(s.nilai);
      if (berubah) diperbarui++;
      await tx.barisAnggaranProyek.update({
        where: { id: cocok.id },
        data: { kunciSumber: s.kunci, tandaSumber: tanda, dihapusDariSumber: false, disinkronPada: waktu, ...(berubah ? { nilaiAcuan: s.nilai } : {}) },
      });
    } else baru.push(s);
  }
  const hilang = ada.filter((b) => !dipakai.has(b.id)).map((b) => b.id);
  if (hilang.length) await tx.barisAnggaranProyek.updateMany({ where: { id: { in: hilang } }, data: { dihapusDariSumber: true, tandaSumber: tanda, disinkronPada: waktu } });

  const kategoriBaru: string[] = [];
  if (baru.length) {
    const peta = await muatPetaKategori(tx);
    // bagian dokumen boleh sampai 80 karakter; nama kategori paling panjang 60. Kategori dari bagian dicari atau dibuat
    // urut kunci nama, supaya dua sinkron proyek berbeda yang sama-sama membuat kategori baru menunggu di indeks unik
    // namaKunci dengan urutan yang sama dan tidak saling mengunci (tinjauan P34 S1)
    const namaBagian = (s: BarisSumber) => [...s.bagian].slice(0, PANJANG_NAMA_KATEGORI).join("");
    const kategoriBagian = new Map<string, string>();
    const urutBagian = [...new Map(baru.filter((s) => s.bagian).map((s) => [kunciNama(namaBagian(s)), namaBagian(s)])).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [kunci, nama] of urutBagian) {
      const k = await cariAtauBuatKategori(tx, nama);
      if (k.baru) kategoriBaru.push(k.nama);
      kategoriBagian.set(kunci, k.id);
    }
    let lainnya: { id: string } | null = null;
    const data: Prisma.BarisAnggaranProyekCreateManyInput[] = [];
    for (const s of baru) {
      let kategoriId: string | null = null;
      if (s.bagian) kategoriId = kategoriBagian.get(kunciNama(namaBagian(s)))!;
      else if (s.akunBebanBarangId) kategoriId = peta.kategoriUntukAkun(s.akunBebanBarangId);
      if (!kategoriId) kategoriId = (lainnya ??= await kategoriLainnya(tx)).id;
      data.push({
        proyekId,
        kategoriId,
        deskripsi: [...s.nama].slice(0, 200).join("") || "-",
        rencana: 0,
        nilaiAcuan: s.nilai,
        [kolom]: dok.id,
        kunciSumber: s.kunci,
        tandaSumber: tanda,
        disinkronPada: waktu,
        dihapusDariSumber: false,
      });
    }
    await tx.barisAnggaranProyek.createMany({ data });
  }
  return { pertama: ada.length === 0, ditambah: baru.length, diperbarui, dihapus: hilang.length, kategoriBaru };
}

/**
 * Kunci dokumen sumber FOR SHARE (tinjauan P34 S1). Wajib menjadi perintah pertama transaksi sinkron, sebelum
 * kunciBarisProyek: sisipan baris anggaran ber-sumberPenawaranId/sumberPesananId mengambil FOR KEY SHARE dokumen itu,
 * jadi tanpa kunci di depan sinkron bisa saling mengunci dengan hapus dokumen (yang memegang dokumen lalu mengosongkan
 * kolom sumber baris anggaran). FOR SHARE juga membuat sinkron bergiliran dengan ubah dokumen, sehingga isi yang
 * dibaca tidak basi. Urutan seluruh jalur: dokumen sumber, Proyek, MitraProyek.
 */
export async function kunciDokumenSumber(tx: Prisma.TransactionClient, jenis: JenisSumberAnggaran, id: string): Promise<void> {
  if (jenis === "penawaran") await tx.$queryRaw`SELECT 1 FROM "PenawaranPenjualan" WHERE "id" = ${id} FOR SHARE`;
  else await tx.$queryRaw`SELECT 1 FROM "PesananPenjualan" WHERE "id" = ${id} FOR SHARE`;
}

/**
 * Isi transaksi sinkron satu dokumen sumber (D5 §3.6): kunci dokumen sumber, kunci baris proyek, baca ulang dokumen
 * (isi dan pemiliknya bisa berubah sejak pemeriksaan di luar transaksi), lalu terapkanSinkronAnggaran. Dipisah dari
 * aksi supaya uji serentak bisa menjalankannya dengan klien transaksi yang ditahan.
 */
export async function sinkronDokumenDalamTransaksi(
  tx: Prisma.TransactionClient,
  proyek: { id: string; kode: string },
  sumber: { jenis: JenisSumberAnggaran; id: string },
  waktu: Date,
): Promise<HasilSinkronAnggaran & { dok: DokumenSumber }> {
  await kunciDokumenSumber(tx, sumber.jenis, sumber.id);
  await kunciBarisProyek(tx, proyek.id);
  const dok = await muatBarisSumber(tx, sumber.jenis, sumber.id);
  if (!dok) throw new Error("Dokumen tidak ditemukan");
  if (dok.proyekId !== proyek.id) throw new Error(`Dokumen ${dok.nomor} bukan milik proyek ${proyek.kode}`);
  if (dok.baris.length === 0) throw new Error(`Dokumen ${dok.nomor} tidak punya baris`);
  return { ...(await terapkanSinkronAnggaran(tx, proyek.id, dok, waktu)), dok };
}

export type StatusSinkronDokumen = { jenis: JenisSumberAnggaran; id: string; nomor: string; jumlahBaris: number; basi: boolean };

/**
 * Status sinkron per dokumen sumber yang punya baris anggaran di proyek ini (padanan _sync_state HKA). Kunci peta
 * "{jenis}:{id}". `basi` = ada baris anggaran yang tandanya berbeda dari tanda dokumen sekarang. Tanpa baris impor =
 * peta kosong. Dokumen yang sudah pindah ke proyek lain tidak dicantumkan, karena sinkronnya pasti ditolak "bukan milik
 * proyek" (tinjauan P34 R1); baris anggarannya tetap ada dan tetap dihitung.
 */
export async function statusSinkronAnggaran(klien: Klien, proyekId: string): Promise<Map<string, StatusSinkronDokumen>> {
  const baris = await klien.barisAnggaranProyek.findMany({
    where: { proyekId, OR: [{ sumberPenawaranId: { not: null } }, { sumberPesananId: { not: null } }] },
    select: { sumberPenawaranId: true, sumberPesananId: true, tandaSumber: true },
  });
  const perDok = new Map<string, { jenis: JenisSumberAnggaran; id: string; tanda: Set<string | null>; jumlah: number }>();
  for (const b of baris) {
    const [jenis, id] = b.sumberPenawaranId ? (["penawaran", b.sumberPenawaranId] as const) : (["pesanan", b.sumberPesananId!] as const);
    const k = `${jenis}:${id}`;
    const isi = perDok.get(k) ?? { jenis, id, tanda: new Set<string | null>(), jumlah: 0 };
    isi.tanda.add(b.tandaSumber);
    isi.jumlah++;
    perDok.set(k, isi);
  }
  const hasil = new Map<string, StatusSinkronDokumen>();
  for (const [k, isi] of perDok) {
    const dok = await muatBarisSumber(klien, isi.jenis, isi.id);
    if (!dok || dok.proyekId !== proyekId) continue;
    const tanda = tandaSumber(dok.baris);
    hasil.set(k, { jenis: isi.jenis, id: isi.id, nomor: dok.nomor, jumlahBaris: isi.jumlah, basi: [...isi.tanda].some((t) => t !== tanda) });
  }
  return hasil;
}
