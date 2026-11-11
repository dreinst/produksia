"use server";

import { wajibHakAksi } from "@/lib/otentikasi";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { Prisma } from "@/prisma-klien/client";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { D, format, jumlahkan, type Desimal } from "@/lib/uang";
import { pastikanAkunMilik, pastikanAkunRinci } from "@/lib/baganAkun";
import { PERUSAHAAN_UTAMA } from "@/lib/perusahaan";
import { akhirTahun, barisJurnalPenutup, kunciTahunBuku, ringkasanPenutupan, ringkasanPenutupanPerPerusahaan } from "@/lib/tutupBuku";
import { dataLangsungDisetujui } from "@/lib/persetujuan";

const HALAMAN = "/buku-besar/tutup-buku";
const NOL = D(0);
/** Tutup buku membaca saldo semua perusahaan di satu transaksi; batas bawaan Prisma 5 detik bisa terlewati. */
const BATAS_WAKTU = 60_000;
/**
 * Opsi kedua transaksi tutup buku. Batas waktu yang sama karena buka kembali bisa menunggu tutup buku yang sedang
 * berjalan (tinjauan P14 R1). Isolasi READ COMMITTED ditulis eksplisit karena pola "kunci dulu, baru baca" di
 * kunciTahunBuku salah di REPEATABLE READ (tinjauan P14 R3).
 */
const OPSI_TRANSAKSI = { timeout: BATAS_WAKTU, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted };

function bacaTahun(dataFormulir: FormData): number {
  const tahun = Number(String(dataFormulir.get("tahun") ?? "").trim());
  if (!Number.isInteger(tahun) || tahun < 2000 || tahun > 2100) throw new Error("Tahun buku tidak valid");
  return tahun;
}

async function segarkan() {
  revalidatePath(HALAMAN);
  revalidatePath("/buku-besar/jurnal");
  revalidatePath("/buku-besar/neraca");
  revalidatePath("/buku-besar/neraca-saldo");
  revalidatePath("/", "layout");
}

/**
 * Menutup tahun buku untuk SEMUA perusahaan sekaligus (D1 §4.3, K4): untuk setiap perusahaan yang punya saldo
 * pendapatan/beban, akun-akun itu dinolkan ke Laba Ditahan lewat satu jurnal JU-TUTUP milik perusahaan itu bertanggal
 * 31 Desember. Satu baris TutupBuku (kunci tahun global, labaBersih = Σ semua perusahaan, jurnalId = JU-TUTUP utama)
 * dan satu baris TutupBukuPerusahaan per jurnal. Bila satu perusahaan gagal, tidak ada yang ditutup.
 * Bila tahun yang ditutup adalah tahun buku aktif, tahun buku maju satu tahun.
 */
export async function tutupTahun(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("tutup-buku.buat");
  const tahun = bacaTahun(dataFormulir);
  if (tahun > new Date().getFullYear()) throw new Error(`Tahun ${tahun} belum berjalan; tutup buku hanya untuk tahun yang sudah/sedang berjalan`);
  if (await db.tutupBuku.findUnique({ where: { tahun } })) throw new Error(`Tahun buku ${tahun} sudah ditutup`);
  const pemetaan = await db.pemetaanAkun.findUnique({ where: { id: "default" }, include: { labaDitahan: true } });
  if (!pemetaan?.labaDitahanId || !pemetaan.labaDitahan) throw new Error("Pemetaan akun 'Laba Ditahan' belum diatur (Pengaturan > Pemetaan Akun)");
  await pastikanAkunRinci(db, [pemetaan.labaDitahanId]);
  const labaDitahanId = pemetaan.labaDitahanId;

  await db.$transaction(async (tx) => {
    // Kunci eksklusif tahun (tinjauan P12 R3): menunggu transaksi jurnal tahun ini yang sedang berjalan, lalu memeriksa
    // ulang di dalam transaksi supaya klik ganda berakhir dengan pesan "sudah ditutup", bukan galat unik.
    await kunciTahunBuku(tx, tahun, true);
    if (await tx.tutupBuku.findUnique({ where: { tahun }, select: { id: true } })) throw new Error(`Tahun buku ${tahun} sudah ditutup`);
    let labaTotal = NOL;
    let jumlahAkun = 0;
    let jurnalUtamaId: string | null = null;
    const rincian: { perusahaanId: string; labaBersih: Desimal; jurnalId: string }[] = [];
    for (const { perusahaan: p, ringkasan } of await ringkasanPenutupanPerPerusahaan(tx, tahun)) {
      const baris = barisJurnalPenutup(ringkasan, labaDitahanId);
      labaTotal = labaTotal.plus(ringkasan.labaBersih);
      jumlahAkun += ringkasan.pendapatan.length + ringkasan.beban.length;
      if (baris.length === 0) continue; // perusahaan tanpa saldo pendapatan/beban: tanpa jurnal penutup
      const utama = p.id === PERUSAHAAN_UTAMA;
      try {
        await pastikanAkunRinci(tx, baris.map((b) => b.akunId));
        // jurnal penutup dibuat langsung (bukan catatJurnal), jadi kepemilikan akun diperiksa sendiri (kontrak P11)
        await pastikanAkunMilik(tx, baris.map((b) => b.akunId), p.id);
      } catch (e) {
        // pesan utama sama dengan sebelumnya; perusahaan lain disebut supaya pemilik tahu buku mana yang bermasalah
        throw utama ? e : new Error(`Tutup buku ${p.kode} ${p.nama}: ${(e as Error).message}`);
      }
      if (!jumlahkan(baris.map((b) => b.debit)).equals(jumlahkan(baris.map((b) => b.kredit)))) {
        throw new Error(`Jurnal penutup ${p.kode} tidak seimbang. Laporkan ke pengembang`);
      }
      const nomor = await nomorDokumenBerikutnya(tx.jurnal, "JU-TUTUP");
      const jurnal = await tx.jurnal.create({
        data: {
          nomor,
          tanggal: akhirTahun(tahun),
          keterangan: `Jurnal penutup tahun buku ${tahun}${utama ? "" : ` ${p.kode}`} (laba bersih ${format(ringkasan.labaBersih)})`,
          sumber: "PENUTUP",
          perusahaanId: p.id,
          baris: { create: baris },
        },
      });
      if (utama) jurnalUtamaId = jurnal.id;
      rincian.push({ perusahaanId: p.id, labaBersih: ringkasan.labaBersih, jurnalId: jurnal.id });
    }
    // Pengaman: setiap jurnal milik tepat satu perusahaan, jadi Σ per perusahaan harus sama dengan gabungan
    const gabungan = await ringkasanPenutupan(tx, tahun);
    if (!gabungan.labaBersih.equals(labaTotal)) throw new Error("Laba per perusahaan tidak sama dengan laba gabungan. Laporkan ke pengembang");
    // Tutup buku belum ikut alur persetujuan; haknya sendiri sudah dibatasi ke Pemilik/Superadmin
    await tx.tutupBuku.create({
      data: { tahun, labaBersih: labaTotal, penggunaNama: pengguna.nama, jurnalId: jurnalUtamaId, ...dataLangsungDisetujui(pengguna), rincianPerusahaan: { create: rincian } },
    });

    // Tahun buku aktif ikut maju bila yang ditutup adalah tahun yang sedang dibuka
    const pengaturan = await tx.pengaturanPerusahaan.findUnique({ where: { id: "default" } });
    const tahunAktif = pengaturan?.tahunBuku ?? new Date().getFullYear();
    if (tahunAktif === tahun) {
      await tx.pengaturanPerusahaan.upsert({ where: { id: "default" }, create: { id: "default", tahunBuku: tahun + 1 }, update: { tahunBuku: tahun + 1 } });
    }
    await tx.logAktivitas.create({
      data: {
        penggunaId: pengguna.id === "skrip-uji" ? null : pengguna.id,
        penggunaNama: pengguna.nama,
        aksi: "TUTUP",
        jenis: "Tutup Buku",
        nomor: `TAHUN ${tahun}`,
        keterangan: `Laba bersih ${format(labaTotal)} dipindahkan ke ${pemetaan.labaDitahan!.kode} ${pemetaan.labaDitahan!.nama}; ${jumlahAkun} akun dinolkan; ${rincian.length} perusahaan`,
      },
    });
  }, OPSI_TRANSAKSI);
  await segarkan();
}

/**
 * Membuka kembali tahun yang sudah ditutup: semua jurnal penutup tahun itu (satu per perusahaan) dihapus, transaksi
 * tahun itu bisa dicatat lagi. Tutup buku lama tanpa baris rincian tetap terbuka lewat TutupBuku.jurnalId.
 */
export async function bukaKembaliTahun(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("tutup-buku.buat");
  const tahun = bacaTahun(dataFormulir);
  const sebelum = await db.tutupBuku.findUnique({ where: { tahun }, select: { id: true } });
  if (!sebelum) throw new Error(`Tahun buku ${tahun} tidak dalam keadaan ditutup`);

  await db.$transaction(async (tx) => {
    // Kunci yang sama dengan tutupTahun; dibaca ulang di dalam transaksi supaya klik ganda memberi pesan yang sama
    await kunciTahunBuku(tx, tahun, true);
    const tutup = await tx.tutupBuku.findUnique({ where: { tahun }, include: { rincianPerusahaan: { select: { jurnalId: true } } } });
    if (!tutup) throw new Error(`Tahun buku ${tahun} tidak dalam keadaan ditutup`);
    const jurnalIds = [...new Set([tutup.jurnalId, ...tutup.rincianPerusahaan.map((r) => r.jurnalId)].filter((id): id is string => !!id))];
    // TutupBuku dihapus lebih dulu: baris rincian ikut terhapus (onDelete Cascade) sehingga jurnalnya bebas dihapus
    await tx.tutupBuku.delete({ where: { id: tutup.id } });
    if (jurnalIds.length > 0) {
      await tx.barisJurnal.deleteMany({ where: { jurnalId: { in: jurnalIds } } });
      await tx.jurnal.deleteMany({ where: { id: { in: jurnalIds } } });
    }
    const pengaturan = await tx.pengaturanPerusahaan.findUnique({ where: { id: "default" } });
    if (pengaturan?.tahunBuku === tahun + 1) {
      await tx.pengaturanPerusahaan.update({ where: { id: "default" }, data: { tahunBuku: tahun } });
    }
    await tx.logAktivitas.create({
      data: { penggunaId: pengguna.id === "skrip-uji" ? null : pengguna.id, penggunaNama: pengguna.nama, aksi: "BUKA", jenis: "Tutup Buku", nomor: `TAHUN ${tahun}`, keterangan: "Jurnal penutup dihapus; tahun buku dibuka kembali" },
    });
  }, OPSI_TRANSAKSI);
  await segarkan();
}

export async function tutupTahunFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => tutupTahun(dataFormulir));
}
export async function bukaKembaliTahunFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => bukaKembaliTahun(dataFormulir));
}
