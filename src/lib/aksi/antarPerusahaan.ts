"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHakAksi } from "@/lib/otentikasi";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { D, bacaUang, format, type Desimal } from "@/lib/uang";
import { pastikanAkunRinci } from "@/lib/baganAkun";
import { pastikanTahunTerbuka } from "@/lib/tutupBuku";
import { catatJurnal } from "@/lib/akuntansi";
import { akunAntarPerusahaan, pastikanAkunMilik } from "@/lib/perusahaan";
import { bacaProyekId } from "@/lib/proyek";
import { catatAktivitas } from "@/lib/log";
import type { JenisAntarPerusahaan } from "@/prisma-klien/enums";

/*
 * Transaksi antar perusahaan grup (D1 §3.8, §4.5, §6.1). Satu dokumen, dua jurnal JU-AP dalam satu transaksi basis
 * data: satu di buku pemberi (Piutang Antar Perusahaan), satu di buku penerima (Hutang Antar Perusahaan). Masing-masing
 * seimbang dan milik satu perusahaan, jadi neraca tiap perusahaan tetap seimbang; di gabungan keduanya tampil tanpa
 * eliminasi. Tanpa maker-checker (keputusan D1, HAK.md §9.2 no. 5): jurnal langsung dicatat dan haknya dibatasi
 * antar-perusahaan.buat. Ubah = hapus lalu buat ulang; hapus lewat hapusDokumen("antarPerusahaan") membalik keduanya.
 */

const PESAN_AKUN_BELUM_ADA =
  'Akun Piutang/Hutang Antar Perusahaan belum ada. Terapkan Bagan Akun Standar (akun 1-1750 dan 2-1550) lewat Pengaturan, Bagan Akun Standar, tombol "Terapkan ke sistem", atau atur pemetaan tambahan "piutang-antar-perusahaan" dan "hutang-antar-perusahaan" di Pengaturan, Pemetaan Akun';

const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

type BarisJurnalAp = { akunId: string; debit: Desimal; kredit: Desimal; keterangan: string };

function bacaTeks(dataFormulir: FormData, nama: string): string {
  return String(dataFormulir.get(nama) ?? "").trim();
}

async function bacaPerusahaan(id: string, peran: "pemberi" | "penerima") {
  const p = await db.perusahaan.findUnique({ where: { id }, select: { id: true, kode: true, nama: true, aktif: true } });
  if (!p) throw new Error(`Perusahaan ${peran} tidak ditemukan`);
  if (!p.aktif) throw new Error(`Perusahaan ${p.nama} sudah diarsipkan; transaksi antar perusahaan baru tidak bisa dicatat untuknya`);
  return p;
}

/** Proyek opsional milik perusahaan pihaknya (pemeriksaan sama dengan bacaProyekId). */
async function bacaProyekPihak(dataFormulir: FormData, nama: string, perusahaanId: string): Promise<string | null> {
  const isian = new FormData();
  isian.set("proyekId", bacaTeks(dataFormulir, nama));
  return bacaProyekId(isian, db, perusahaanId);
}

export async function buatTransaksiAntarPerusahaan(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("antar-perusahaan.buat");

  const jenisTeks = bacaTeks(dataFormulir, "jenis");
  if (jenisTeks !== "TAGIH" && jenisTeks !== "LUNAS") throw new Error("Jenis transaksi antar perusahaan harus Tagih atau Lunas");
  const jenis: JenisAntarPerusahaan = jenisTeks;

  const pemberiId = bacaTeks(dataFormulir, "pemberiId");
  const penerimaId = bacaTeks(dataFormulir, "penerimaId");
  if (!pemberiId) throw new Error("Perusahaan pemberi wajib dipilih");
  if (!penerimaId) throw new Error("Perusahaan penerima wajib dipilih");
  if (pemberiId === penerimaId) throw new Error("Perusahaan pemberi dan penerima harus berbeda");
  const pemberi = await bacaPerusahaan(pemberiId, "pemberi");
  const penerima = await bacaPerusahaan(penerimaId, "penerima");

  const tanggalTeks = bacaTeks(dataFormulir, "tanggal");
  if (!POLA_TANGGAL.test(tanggalTeks)) throw new Error("Tanggal wajib diisi dengan format YYYY-MM-DD");
  const tanggal = new Date(`${tanggalTeks}T12:00:00`);
  if (Number.isNaN(tanggal.getTime())) throw new Error("Tanggal tidak valid");
  const akhirHariIni = new Date();
  akhirHariIni.setHours(23, 59, 59, 999);
  if (tanggal > akhirHariIni) throw new Error("Tanggal tidak boleh di masa depan");

  const jumlah = bacaUang(dataFormulir.get("jumlah"), "Jumlah");

  const keterangan = bacaTeks(dataFormulir, "keterangan");
  if (keterangan.length < 3 || keterangan.length > 300) throw new Error("Keterangan wajib diisi, 3 sampai 300 karakter");

  const akunPemberiId = bacaTeks(dataFormulir, "akunPemberiId");
  const akunPenerimaId = bacaTeks(dataFormulir, "akunPenerimaId");
  if (!akunPemberiId) throw new Error("Akun lawan di buku pemberi wajib dipilih");
  if (!akunPenerimaId) throw new Error("Akun lawan di buku penerima wajib dipilih");
  const akunLawan = await db.akun.findMany({ where: { id: { in: [akunPemberiId, akunPenerimaId] } }, select: { id: true, kode: true } });
  if (!akunLawan.some((a) => a.id === akunPemberiId) || !akunLawan.some((a) => a.id === akunPenerimaId)) throw new Error("Akun lawan tidak ditemukan");
  await pastikanAkunRinci(db, [akunPemberiId, akunPenerimaId]);
  await pastikanAkunMilik(db, [akunPemberiId], pemberiId);
  await pastikanAkunMilik(db, [akunPenerimaId], penerimaId);

  const proyekPemberiId = await bacaProyekPihak(dataFormulir, "proyekPemberiId", pemberiId);
  const proyekPenerimaId = await bacaProyekPihak(dataFormulir, "proyekPenerimaId", penerimaId);

  // syarat sistem: kedua akun antar perusahaan ada (melempar galat bila akunnya ada tetapi tidak sah)
  const { piutang, hutang } = await akunAntarPerusahaan(db);
  if (!piutang || !hutang) throw new Error(PESAN_AKUN_BELUM_ADA);
  if ([akunPemberiId, akunPenerimaId].some((id) => id === piutang.id || id === hutang.id)) {
    throw new Error("Akun lawan tidak boleh akun antar perusahaan; sistem sudah menambahkannya");
  }

  const NOL = D(0);
  await db.$transaction(async (tx) => {
    await pastikanTahunTerbuka(tx, tanggal);
    const nomor = await nomorDokumenBerikutnya(tx.transaksiAntarPerusahaan, "AP");
    const ket = `Antar perusahaan ${nomor}: ${keterangan}`;
    const baris = (akunId: string, debit: boolean, lawan: string): BarisJurnalAp => ({
      akunId,
      debit: debit ? jumlah : NOL,
      kredit: debit ? NOL : jumlah,
      keterangan: `${ket} (${lawan})`,
    });
    const tagih = jenis === "TAGIH";
    // TAGIH: pemberi Dr Piutang AP / Cr akun pemberi; penerima Dr akun penerima / Cr Hutang AP. LUNAS: kebalikannya.
    const barisPemberi = [baris(piutang.id, tagih, penerima.kode), baris(akunPemberiId, !tagih, penerima.kode)];
    const barisPenerima = [baris(akunPenerimaId, tagih, pemberi.kode), baris(hutang.id, !tagih, pemberi.kode)];
    const jurnalPemberi = await catatJurnal(tx, "JU-AP", ket, "ANTAR_PERUSAHAAN", barisPemberi, { tanggal, proyekId: proyekPemberiId, perusahaanId: pemberiId });
    const jurnalPenerima = await catatJurnal(tx, "JU-AP", ket, "ANTAR_PERUSAHAAN", barisPenerima, { tanggal, proyekId: proyekPenerimaId, perusahaanId: penerimaId });
    if (!jurnalPemberi || !jurnalPenerima) throw new Error("Jurnal antar perusahaan gagal dibuat. Laporkan ke pengembang");
    const dokumen = await tx.transaksiAntarPerusahaan.create({
      data: {
        nomor,
        tanggal,
        jenis,
        pemberiId,
        penerimaId,
        jumlah,
        keterangan,
        akunPemberiId,
        akunPenerimaId,
        proyekPemberiId,
        proyekPenerimaId,
        jurnalPemberiId: jurnalPemberi.id,
        jurnalPenerimaId: jurnalPenerima.id,
        dicatatOlehId: pengguna.id === "skrip-uji" ? null : pengguna.id,
        dicatatOlehNama: pengguna.nama,
      },
    });
    // milik dua perusahaan, jadi tanpa perusahaanId (catatan tingkat sistem terlihat di kedua lingkup); keduanya di meta
    await catatAktivitas(tx, pengguna, {
      aksi: "CATAT",
      jenis: "Transaksi Antar Perusahaan",
      nomor,
      keterangan: `${jenis} ${pemberi.kode} → ${penerima.kode} ${format(jumlah)}; jurnal ${jurnalPemberi.nomor}, ${jurnalPenerima.nomor}`,
      modul: "antar-perusahaan",
      entitasId: dokumen.id,
      meta: { pemberiId, penerimaId },
    });
  });

  revalidatePath("/buku-besar/antar-perusahaan");
  revalidatePath("/buku-besar/jurnal");
  revalidatePath("/");
  redirect("/buku-besar/antar-perusahaan");
}

export async function buatTransaksiAntarPerusahaanFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatTransaksiAntarPerusahaan(dataFormulir));
}
