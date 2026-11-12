"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { wajibHakAksi } from "@/lib/otentikasi";
import { catatAktivitas } from "@/lib/log";
import { galatMasihDipakai, jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { akunKeuanganProyek } from "@/lib/keuanganProyek";
import { bacaNamaKategori, kunciNama, terapkanKategoriAnggaranBawaan } from "@/lib/kategoriAnggaran";

/*
 * Aksi kategori anggaran proyek dan pemetaan akun beban (D5 §3.4, §6.2), hak `kategori-anggaran.ubah` (DESAIN H2).
 * Kategori dan pemetaan global untuk semua perusahaan, jadi log tanpa perusahaan. Halaman pemakainya
 * /pengaturan/kategori-anggaran dibuat paket halaman proyek; aksi di sini tidak me-redirect.
 */

const MODUL = "anggaran-proyek" as const;
const JENIS = "Kategori Anggaran";

function revalidasi(pemetaan = false) {
  revalidatePath("/pengaturan/kategori-anggaran");
  if (pemetaan) revalidatePath("/proyek/keuangan");
}

/** P2002 pada namaKunci: nama kategori sudah dipakai (balapan antara pemeriksaan dan tulis). */
function namaBentrok(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === "P2002";
}

async function pastikanNamaBebas(nama: string, kecualiId?: string) {
  const ada = await db.kategoriAnggaran.findUnique({ where: { namaKunci: kunciNama(nama) }, select: { id: true, nama: true } });
  if (ada && ada.id !== kecualiId) throw new Error(`Kategori ${ada.nama} sudah ada`);
}

export async function tambahKategoriAnggaran(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("kategori-anggaran.ubah");
  const nama = bacaNamaKategori(dataFormulir.get("nama"));
  await pastikanNamaBebas(nama);
  try {
    await db.$transaction(async (tx) => {
      const k = await tx.kategoriAnggaran.create({ data: { nama, namaKunci: kunciNama(nama) } });
      await catatAktivitas(tx, pengguna, { aksi: "BUAT", jenis: JENIS, nomor: nama, keterangan: `Kategori anggaran ${nama} ditambahkan`, modul: MODUL, entitasId: k.id });
    });
  } catch (e) {
    if (namaBentrok(e)) throw new Error(`Kategori ${nama} sudah ada`);
    throw e;
  }
  revalidasi();
}

export async function tambahKategoriAnggaranFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => tambahKategoriAnggaran(dataFormulir));
}

/** Ganti nama (kategori bawaan juga boleh); keunikan dicek ulang. */
export async function ubahKategoriAnggaran(id: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("kategori-anggaran.ubah");
  const nama = bacaNamaKategori(dataFormulir.get("nama"));
  const lama = await db.kategoriAnggaran.findUnique({ where: { id: String(id ?? "") }, select: { id: true, nama: true } });
  if (!lama) throw new Error("Kategori tidak ditemukan");
  if (lama.nama === nama) return;
  await pastikanNamaBebas(nama, lama.id);
  try {
    await db.$transaction(async (tx) => {
      await tx.kategoriAnggaran.update({ where: { id: lama.id }, data: { nama, namaKunci: kunciNama(nama) } });
      await catatAktivitas(tx, pengguna, { aksi: "UBAH", jenis: JENIS, nomor: nama, keterangan: `Kategori anggaran ${lama.nama} diganti nama menjadi ${nama}`, modul: MODUL, entitasId: lama.id, meta: { nama: { dari: lama.nama, ke: nama } } });
    });
  } catch (e) {
    if (namaBentrok(e)) throw new Error(`Kategori ${nama} sudah ada`);
    throw e;
  }
  revalidasi(true);
}

export async function ubahKategoriAnggaranFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahKategoriAnggaran(id, dataFormulir));
}

/** Hapus kategori yang bukan bawaan dan tidak dipakai baris anggaran; pemetaannya ikut terhapus (Cascade). */
export async function hapusKategoriAnggaran(id: string) {
  const pengguna = await wajibHakAksi("kategori-anggaran.ubah");
  const k = await db.kategoriAnggaran.findUnique({ where: { id: String(id ?? "") }, select: { id: true, nama: true, bawaan: true, _count: { select: { barisAnggaran: true, akun: true } } } });
  if (!k) throw new Error("Kategori tidak ditemukan");
  if (k.bawaan) throw new Error("Kategori bawaan tidak bisa dihapus; ganti namanya bila perlu");
  const pesanDipakai = (n: number) => `Kategori ${k.nama} dipakai ${n} baris anggaran; pindahkan barisnya dulu`;
  if (k._count.barisAnggaran > 0) throw new Error(pesanDipakai(k._count.barisAnggaran));
  try {
    await db.$transaction(async (tx) => {
      await tx.kategoriAnggaran.delete({ where: { id: k.id } });
      await catatAktivitas(tx, pengguna, { aksi: "HAPUS", jenis: JENIS, nomor: k.nama, keterangan: `Kategori anggaran ${k.nama} dihapus`, modul: MODUL, entitasId: k.id, meta: { pemetaanAkun: k._count.akun } });
    });
  } catch (e) {
    // baris anggaran ditambahkan di antara pemeriksaan dan hapus (FK Restrict)
    if (galatMasihDipakai(e)) throw new Error(pesanDipakai(await db.barisAnggaranProyek.count({ where: { kategoriId: k.id } })));
    throw e;
  }
  revalidasi(true);
}

export async function hapusKategoriAnggaranFormulir(id: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => hapusKategoriAnggaran(id));
}

/**
 * Pemetaan akun beban ke kategori (D5 §3.4): isian `kategori_{akunId}` = id kategori, atau kosong untuk menghapus
 * pemetaan (akun mengikuti pemetaan induknya). Hanya akun yang isiannya dikirim yang diproses. Akun harus berjenis
 * BEBAN (rinci maupun kelompok); akun Bagi Hasil Mitra Proyek ditolak. Semua perubahan dalam satu transaksi dengan
 * kunci advisory, dan log UBAH_PEMETAAN hanya bila ada yang berubah.
 */
export async function simpanPemetaanKategori(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("kategori-anggaran.ubah");
  const isian = new Map<string, string>();
  for (const [k, v] of dataFormulir.entries()) {
    if (!k.startsWith("kategori_") || typeof v !== "string") continue;
    isian.set(k.slice("kategori_".length), v.trim());
  }
  if (isian.size === 0) return;
  const akunIds = [...isian.keys()];
  const kategoriIds = [...new Set([...isian.values()].filter(Boolean))];
  const [akun, kategori, peran] = await Promise.all([
    db.akun.findMany({ where: { id: { in: akunIds } }, select: { id: true, kode: true, nama: true, jenis: true } }),
    db.kategoriAnggaran.findMany({ where: { id: { in: kategoriIds } }, select: { id: true, nama: true } }),
    akunKeuanganProyek(db),
  ]);
  const akunPer = new Map(akun.map((a) => [a.id, a]));
  const namaKategori = new Map(kategori.map((k) => [k.id, k.nama]));
  for (const [akunId, kategoriId] of isian) {
    const a = akunPer.get(akunId);
    if (!a) throw new Error("Akun tidak ditemukan");
    if (a.jenis !== "BEBAN") throw new Error(`Akun ${a.kode} ${a.nama} bukan akun beban`);
    if (!kategoriId) continue;
    if (!namaKategori.has(kategoriId)) throw new Error("Kategori tidak ditemukan");
    if (peran.bebanBagiHasil?.id === akunId) throw new Error(`Akun ${a.kode} ${a.nama} dikecualikan dari biaya aktual dan tidak dipetakan ke kategori`);
  }

  const berubah = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('kategori-anggaran'), 0)`;
    const lama = new Map(
      (await tx.akunKategoriAnggaran.findMany({ where: { akunId: { in: akunIds } }, select: { akunId: true, kategori: { select: { id: true, nama: true } } } })).map((p) => [p.akunId, p.kategori]),
    );
    const daftar: { akun: string; dari: string | null; ke: string | null }[] = [];
    for (const [akunId, kategoriId] of isian) {
      const sebelum = lama.get(akunId) ?? null;
      if ((sebelum?.id ?? "") === kategoriId) continue;
      const a = akunPer.get(akunId)!;
      if (kategoriId) await tx.akunKategoriAnggaran.upsert({ where: { akunId }, create: { akunId, kategoriId }, update: { kategoriId } });
      else await tx.akunKategoriAnggaran.delete({ where: { akunId } });
      daftar.push({ akun: a.kode, dari: sebelum?.nama ?? null, ke: kategoriId ? namaKategori.get(kategoriId)! : null });
    }
    if (daftar.length) {
      await catatAktivitas(tx, pengguna, {
        aksi: "UBAH_PEMETAAN",
        jenis: JENIS,
        nomor: "Pemetaan akun",
        keterangan: `Pemetaan akun beban ke kategori anggaran diubah: ${daftar.length} akun`,
        modul: MODUL,
        meta: { berubah: daftar },
      });
    }
    return daftar.length;
  });
  if (berubah) revalidasi(true);
}

export async function simpanPemetaanKategoriFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => simpanPemetaanKategori(dataFormulir));
}

/** Tombol "Siapkan kategori bawaan": terapkanKategoriAnggaranBawaan, log BUAT bila ada yang dibuat. */
export async function siapkanKategoriBawaan() {
  const pengguna = await wajibHakAksi("kategori-anggaran.ubah");
  const hasil = await db.$transaction(async (tx) => {
    const h = await terapkanKategoriAnggaranBawaan(tx);
    if (h.kategoriDibuat || h.pemetaanDibuat) {
      await catatAktivitas(tx, pengguna, {
        aksi: "BUAT",
        jenis: JENIS,
        nomor: "Kategori bawaan",
        keterangan: `Kategori bawaan disiapkan: ${h.kategoriDibuat} kategori dan ${h.pemetaanDibuat} pemetaan akun dibuat`,
        modul: MODUL,
        meta: h,
      });
    }
    return h;
  });
  revalidasi(true);
  return hasil;
}

export async function siapkanKategoriBawaanFormulir(): Promise<StatusFormulir> {
  return jalankanFormulir(async () => {
    await siapkanKategoriBawaan();
  });
}
