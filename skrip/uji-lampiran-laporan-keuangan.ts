import "dotenv/config";
// Skrip ini memanggil aksi server dan halaman server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { db } from "../src/lib/db";
import { periksaSinkron } from "../src/lib/sinkron";
import { simpanLaporanKeuanganKeBerkas } from "../src/lib/aksi/laporanKeuanganProyek";
import HalamanDetailKeuanganProyek from "../src/app/(aplikasi)/proyek/[id]/keuangan/page";
import LampiranBerkas, { NamaBerkas } from "../src/komponen/berkas/LampiranBerkas";
import { jalankan, pastikan } from "./bantuan";

/*
 * Uji daftar laporan keuangan proyek tersimpan di halaman keuangan proyek (sisa P38):
 *  1. Positif: sesudah Simpan PDF ke berkas, halaman memasang LampiranBerkas jenis laporan-keuangan-proyek untuk proyek
 *     itu (tanpa unggah manual) dan daftarnya memuat berkas yang baru disimpan; proyek lain tidak ikut.
 *  2. Hak akses: ADMIN (anggaran-proyek.lihat) melihat daftar; GUDANG ditolak halaman dan LampiranBerkas null.
 *  3. Negatif: folder KEUANGAN yang dibatasi ke peran lain menyembunyikan daftar dari ADMIN tanpa menyembunyikannya dari
 *     PEMILIK; berkas yang sudah dibuang ke Sampah tidak tampil.
 * Data uji berawalan LLK; berkas dan log uji dibuang, folder KEUANGAN dikembalikan, periksaSinkron sama di awal dan akhir.
 */

const K = "LLK";

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

function cariSemua(n: ReactNode, tipe: unknown, hasil: ReactElement<Record<string, unknown>>[] = []): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(n)) {
    for (const x of n) cariSemua(x, tipe, hasil);
    return hasil;
  }
  if (!isValidElement(n)) return hasil;
  if (n.type === tipe) hasil.push(n as ReactElement<Record<string, unknown>>);
  return cariSemua((n.props as { children?: ReactNode }).children, tipe, hasil);
}

/** Render halaman sebagai peran tertentu, lalu render LampiranBerkas yang dipasangnya; kembalikan id berkas yang terdaftar. */
async function daftarDiHalaman(peran: string, proyekId: string): Promise<{ props: Record<string, unknown> | null; idBerkas: string[] | null }> {
  return sebagaiPeran(peran, async () => {
    const halaman = await HalamanDetailKeuanganProyek({ params: Promise.resolve({ id: proyekId }), searchParams: Promise.resolve({}) });
    const el = cariSemua(halaman, LampiranBerkas)[0];
    if (!el) return { props: null, idBerkas: null };
    const hasil = await LampiranBerkas(el.props as Parameters<typeof LampiranBerkas>[0]);
    return { props: el.props, idBerkas: hasil === null ? null : cariSemua(hasil, NamaBerkas).map((e) => (e.props.b as { id: string }).id) };
  });
}

async function bersihkan() {
  const proyek = (await db.proyek.findMany({ where: { kode: { startsWith: `PRJ-${K}` } }, select: { id: true } })).map((p) => p.id);
  await db.berkas.deleteMany({ where: { jenisEntitas: "laporan-keuangan-proyek", entitasId: { in: proyek } } });
  await db.proyek.deleteMany({ where: { kode: { startsWith: `PRJ-${K}` } } });
}

async function main() {
  await bersihkan();
  const mulaiUji = new Date();
  const idLogAwal = new Set((await db.logAktivitas.findMany({ select: { id: true } })).map((l) => l.id));
  const berkasAwal = await db.berkas.count();
  const hakAwal = await db.hakAksesPeran.count();
  const sinkronAwal = await periksaSinkron(db);
  const folderAwal = await db.folderBerkas.findUniqueOrThrow({ where: { kode: "KEUANGAN" }, select: { terbatas: true, peranBoleh: true } });

  const prj = await db.proyek.create({ data: { kode: `PRJ-${K}`, nama: "Event Uji Lampiran Laporan" } });
  const prj2 = await db.proyek.create({ data: { kode: `PRJ-${K}2`, nama: "Event Uji Lampiran Laporan Lain" } });

  try {
    console.log("=== 1. Positif ===");
    let d = await daftarDiHalaman("PEMILIK", prj.id);
    pastikan(d.props?.jenisEntitas === "laporan-keuangan-proyek" && d.props.entitasId === prj.id && d.props.bolehUnggah === false, "halaman memasang LampiranBerkas laporan-keuangan-proyek untuk proyeknya, tanpa unggah manual");
    pastikan(d.idBerkas !== null && d.idBerkas.length === 0, "sebelum ada laporan tersimpan daftar kosong");
    await jalankan("PEMILIK simpan laporan proyek", () => simpanLaporanKeuanganKeBerkas(prj.id));
    const tersimpan = await db.berkas.findMany({ where: { jenisEntitas: "laporan-keuangan-proyek", entitasId: prj.id } });
    pastikan(tersimpan.length === 1, "satu berkas laporan tersimpan");
    d = await daftarDiHalaman("PEMILIK", prj.id);
    pastikan(d.idBerkas?.join() === tersimpan[0].id, "PEMILIK: daftar di halaman memuat laporan yang baru disimpan");
    pastikan((await daftarDiHalaman("PEMILIK", prj2.id)).idBerkas?.length === 0, "laporan proyek lain tidak ikut tampil di proyek ini");

    console.log("=== 2. Hak akses ===");
    pastikan((await daftarDiHalaman("ADMIN", prj.id)).idBerkas?.join() === tersimpan[0].id, "ADMIN (anggaran-proyek.lihat): daftar tampil");
    let digest = "";
    await daftarDiHalaman("GUDANG", prj.id).catch((e: unknown) => {
      digest = (e as { digest?: string }).digest ?? "";
    });
    pastikan(digest.startsWith("NEXT_REDIRECT") && digest.includes("tanpa-akses"), "GUDANG tanpa anggaran-proyek.lihat dialihkan ke halaman tanpa akses");
    pastikan((await sebagaiPeran("GUDANG", () => LampiranBerkas({ jenisEntitas: "laporan-keuangan-proyek", entitasId: prj.id }))) === null, "GUDANG: LampiranBerkas laporan tidak tampil");

    console.log("=== 3. Negatif ===");
    await db.folderBerkas.update({ where: { kode: "KEUANGAN" }, data: { terbatas: true, peranBoleh: ["PEMILIK"] } });
    pastikan((await daftarDiHalaman("ADMIN", prj.id)).idBerkas?.length === 0, "folder KEUANGAN dibatasi ke PEMILIK: ADMIN tidak melihat laporan");
    pastikan((await daftarDiHalaman("PEMILIK", prj.id)).idBerkas?.join() === tersimpan[0].id, "folder KEUANGAN dibatasi ke PEMILIK: PEMILIK tetap melihat laporan");
    await db.folderBerkas.update({ where: { kode: "KEUANGAN" }, data: { terbatas: folderAwal.terbatas, peranBoleh: folderAwal.peranBoleh } });
    await db.berkas.update({ where: { id: tersimpan[0].id }, data: { dihapusPada: new Date() } });
    pastikan((await daftarDiHalaman("PEMILIK", prj.id)).idBerkas?.length === 0, "laporan yang dibuang ke Sampah tidak tampil di daftar");
  } finally {
    await db.folderBerkas.update({ where: { kode: "KEUANGAN" }, data: { terbatas: folderAwal.terbatas, peranBoleh: folderAwal.peranBoleh } });
    await bersihkan();
    const logBaru = (await db.logAktivitas.findMany({ where: { waktu: { gte: mulaiUji } }, select: { id: true } })).map((l) => l.id).filter((id) => !idLogAwal.has(id));
    await db.logAktivitas.deleteMany({ where: { id: { in: logBaru } } });
  }

  console.log("=== 4. Bersih-bersih ===");
  pastikan((await db.berkas.count()) === berkasAwal, "berkas uji dihapus permanen");
  pastikan((await db.hakAksesPeran.count()) === hakAwal, "HakAksesPeran sama dengan awal");
  const folderAkhir = await db.folderBerkas.findUniqueOrThrow({ where: { kode: "KEUANGAN" }, select: { terbatas: true, peranBoleh: true } });
  pastikan(JSON.stringify(folderAkhir) === JSON.stringify(folderAwal), "folder KEUANGAN kembali seperti awal");
  pastikan(JSON.stringify(await periksaSinkron(db)) === JSON.stringify(sinkronAwal), "periksaSinkron sama dengan awal");
  console.log("=== DONE, all lampiran-laporan-keuangan checks passed ===");
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
