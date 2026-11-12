"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@/prisma-klien/client";
import { db } from "@/lib/db";
import { galatMasihDipakai, jalankanFormulir, kodeSqlState, type StatusFormulir } from "@/lib/statusFormulir";
import { BIDANG_PERUSAHAAN, ambilKonfigurasiEntitas, type KonfigurasiEntitas } from "@/lib/konfigurasiDataInduk";
import { wajibHakAksi } from "@/lib/otentikasi";
import { hakDataInduk, type PenggunaSesi } from "@/lib/hakAkses";
import { D, bacaUang, uang, type Desimal } from "@/lib/uang";
import { pastikanAkunRinci } from "@/lib/baganAkun";
import { catatJurnalPenyesuaianPersediaan } from "@/lib/akuntansi";
import { perbaruiHargaRata } from "@/lib/stok";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { dataLangsungDisetujui, persetujuanWajib } from "@/lib/persetujuan";
import { bacaFotoDariFormulir } from "@/lib/foto";
import { NILAI_BERSAMA, PERUSAHAAN_UTAMA, namaPerusahaan, pastikanAkunMilik, pastikanGudangMilik, pastikanPerusahaanAktif } from "@/lib/perusahaan";
import { LABEL_STATUS_PROYEK, statusProyekSah, validasiProyek } from "@/lib/proyek";
import { catatAktivitas } from "@/lib/log";

// Batas atas kolom uang/kuantitas Decimal(18,2) di skema (16 digit sebelum koma).
// Semua bidang "number" data induk adalah harga/kuantitas yang tidak boleh negatif.
const BATAS_NILAI = uang("9999999999999999.99");

type DelegasiPrisma = {
  create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  delete: (args: { where: { id: string } }) => Promise<unknown>;
};

function delegasi(model: string): DelegasiPrisma {
  return (db as unknown as Record<string, DelegasiPrisma>)[model];
}

type DelegasiValidasi = {
  count: (args: { where: Record<string, unknown> }) => Promise<number>;
};

function delegasiValidasi(model: string): DelegasiValidasi {
  return (db as unknown as Record<string, DelegasiValidasi>)[model];
}

type DelegasiBacaSatu = { findUnique: (args: { where: { id: string } }) => Promise<Record<string, unknown> | null> };

function delegasiBacaSatu(model: string): DelegasiBacaSatu {
  return (db as unknown as Record<string, DelegasiBacaSatu>)[model];
}

async function konfigurasiDenganHak(slug: string): Promise<{ config: KonfigurasiEntitas; pengguna: PenggunaSesi }> {
  const config = ambilKonfigurasiEntitas(slug);
  if (!config) throw new Error(`Entitas tidak dikenal: ${slug}`);
  const pengguna = await wajibHakAksi(hakDataInduk(slug).tulis);
  return { config, pengguna };
}

// Bagan akun menentukan struktur laporan keuangan, jadi perubahannya (termasuk hapus)
// dicatat ke jejak audit seperti operasi sensitif lain (bandingkan hapusDokumen.ts).
async function catatBaganAkun(pengguna: PenggunaSesi, aksi: string, nomor: string, keterangan: string) {
  await db.logAktivitas.create({
    data: { penggunaId: pengguna.id === "skrip-uji" ? null : pengguna.id, penggunaNama: pengguna.nama, aksi, jenis: "Bagan Akun", nomor, keterangan },
  });
}

/**
 * Membaca isian formulir sesuai konfigurasi entitas.
 * `untukUbah` = true → isian kosong pada bidang opsional ditulis sebagai null (mengosongkan nilai lama),
 * sedangkan saat membuat data baru bidang kosong dilewati saja (pakai default skema).
 */
async function bacaData(config: KonfigurasiEntitas, dataFormulir: FormData, untukUbah: boolean) {
  const data: Record<string, unknown> = {};
  for (const bidang of config.bidang) {
    if (bidang.virtual) continue; // ditangani terpisah oleh aksi server, bukan kolom Prisma sungguhan
    const mentah = dataFormulir.get(bidang.nama);
    const nilai = typeof mentah === "string" ? mentah.trim() : "";
    if (bidang.nama === BIDANG_PERUSAHAAN) {
      // D1 §3.5: isian yang tidak terkirim dilewati (pemanggil lama), "Bersama" = null, id diperiksa periksaPemilik
      // bersama nilai lamanya (pemilik arsip yang tidak diganti tetap boleh)
      if (!dataFormulir.has(bidang.nama)) continue;
      if (nilai === NILAI_BERSAMA) {
        if (!bidang.pilihanBersama) throw new Error(`${bidang.label} tidak valid`);
        data[bidang.nama] = null;
        continue;
      }
      if (nilai) {
        data[bidang.nama] = nilai;
        continue;
      }
    }
    if (bidang.jenis === "boolean") {
      data[bidang.nama] = mentah === "on";
      continue;
    }

    if (!nilai) {
      if (bidang.wajib) throw new Error(`${bidang.label} wajib diisi`);
      if (untukUbah) data[bidang.nama] = bidang.nilaiBawaan ?? null;
      continue;
    }
    if (bidang.jenis === "number") {
      if (Number.isNaN(Number(nilai))) throw new Error(`${bidang.label} harus berupa angka`);
      const angka = uang(nilai);
      if (angka.isNegative()) throw new Error(`${bidang.label} tidak boleh negatif`);
      if (angka.gt(BATAS_NILAI)) throw new Error(`${bidang.label} melebihi batas nilai yang wajar`);
      data[bidang.nama] = angka;
      continue;
    }
    if (bidang.jenis === "date") {
      const tanggal = new Date(`${nilai}T00:00:00`);
      if (Number.isNaN(tanggal.getTime())) throw new Error(`${bidang.label} harus berupa tanggal`);
      data[bidang.nama] = tanggal;
      continue;
    }
    // Bidang select relasi (mis. akunPendapatanId, kelompokId): filter opsi.where hanya membatasi
    // pilihan di UI. Di server, pastikan id benar-benar ada dan memenuhi opsi.where
    // (jenis/kelompok/model) supaya akun berjenis salah tidak lolos ke penjurnalan.
    if (bidang.jenis === "select" && bidang.opsi) {
      const { model, bidangNilai, where } = bidang.opsi;
      const cocok = await delegasiValidasi(model).count({ where: { [bidangNilai]: nilai, ...where } });
      if (cocok === 0) throw new Error(`${bidang.label} tidak valid`);
    }
    data[bidang.nama] = nilai;
  }
  return data;
}

// ---------- Pemilik perusahaan data induk (D1 §3.5) ----------

const ENTITAS_BERPEMILIK = new Set(["akun", "barang", "gudang", "proyek", "karyawan"]);

type DataLama = { perusahaanId: string | null; kode: string; jenis?: string; status?: string };

/** Kode perusahaan (urut) untuk pesan galat. */
async function daftarKodePerusahaan(ids: (string | null)[]): Promise<string> {
  const unik = [...new Set(ids.filter((x): x is string => !!x))];
  const daftar = await db.perusahaan.findMany({ where: { id: { in: unik } }, select: { kode: true }, orderBy: { kode: "asc" } });
  return daftar.map((p) => p.kode).join(", ");
}

const KOLOM_PEMETAAN_AKUN = [
  "piutangUsahaId", "persediaanId", "hppId", "pendapatanPenjualanId", "utangUsahaId", "bebanJasaId", "barangBelumDitagihId",
  "selisihPersediaanId", "barangTerkirimId", "uangMukaPelangganId", "labaDitahanId", "diskonPenjualanId", "pendapatanLainId", "selisihKursId",
] as const;

const KOLOM_AKUN_PAJAK = ["akunPpnKeluaranId", "akunPpnMasukanId", "akunPph23DimukaId", "akunPph23DipotongId", "akunBebanPphFinalId", "akunHutangPphFinalId"] as const;

const KOLOM_AKUN_BARANG = ["akunPendapatanId", "akunPersediaanId", "akunHppId", "akunBebanId"] as const;

/**
 * Selain jurnal, akun juga dirujuk pengaturan yang berlaku untuk perusahaan lain (tinjauan P13 butir 1). Akun yang
 * dirujuk pemetaan akun atau pemetaan tambahan (global), pengaturan pajak perusahaan lain (perusahaan tanpa baris
 * pengaturan memakai akun baris "default" milik utama), akun khusus barang atau karyawan yang bukan milik `baru`
 * (termasuk jasa bersama), atau dokumen kas perusahaan lain yang belum disetujui tidak bisa diberi pemilik. Tanpa
 * pemeriksaan ini galatnya baru muncul saat perusahaan lain mencatat transaksi.
 * Hal yang sama berlaku untuk draf penyesuaian stok dan penggajian perusahaan lain, serta aset tetap aktif (draf
 * maupun sudah disetujui) perusahaan lain, karena akun penyusutannya baru masuk jurnal saat penyusutan berjalan
 * (tinjauan P15 butir 1).
 */
async function pastikanAkunTanpaRujukanLain(id: string, kode: string, baru: string): Promise<void> {
  const milik = `tidak bisa dijadikan milik ${await namaPerusahaan(db, baru)}`;
  const belumDisetujui = { NOT: { perusahaanId: baru }, statusPersetujuan: { not: "DISETUJUI" as const } };
  const [pemetaan, tambahan, pengaturan, barang, karyawan, kas, penyesuaian, gaji, aset] = await Promise.all([
    db.pemetaanAkun.count({ where: { OR: KOLOM_PEMETAAN_AKUN.map((k) => ({ [k]: id })) } }),
    db.pemetaanAkunTambahan.findFirst({ where: { akunId: id }, select: { kunci: true } }),
    db.pengaturanPerusahaan.findMany({ where: { OR: KOLOM_AKUN_PAJAK.map((k) => ({ [k]: id })) }, select: { id: true, perusahaanId: true } }),
    db.barang.findFirst({ where: { AND: [{ OR: KOLOM_AKUN_BARANG.map((k) => ({ [k]: id })) }, { OR: [{ perusahaanId: null }, { perusahaanId: { not: baru } }] }] }, select: { kode: true, perusahaanId: true }, orderBy: { kode: "asc" } }),
    db.karyawan.findFirst({ where: { akunBebanId: id, NOT: { perusahaanId: baru } }, select: { kode: true, perusahaanId: true }, orderBy: { kode: "asc" } }),
    db.dokumenKas.findFirst({ where: { OR: [{ akunKasId: id }, { akunLawanId: id }], NOT: { perusahaanId: baru }, statusPersetujuan: { not: "DISETUJUI" } }, select: { nomor: true, perusahaanId: true }, orderBy: { nomor: "asc" } }),
    db.penyesuaianPersediaan.findFirst({ where: { akunLawanId: id, ...belumDisetujui }, select: { nomor: true, perusahaanId: true }, orderBy: { nomor: "asc" } }),
    db.penggajian.findFirst({ where: { akunKasId: id, ...belumDisetujui }, select: { nomor: true, perusahaanId: true }, orderBy: { nomor: "asc" } }),
    db.asetTetap.findFirst({
      where: { OR: [{ akunAsetId: id }, { akunBebanPenyusutanId: id }, { akunAkumulasiPenyusutanId: id }, { akunPembayaranId: id }], NOT: { perusahaanId: baru }, status: "AKTIF" },
      select: { kode: true, perusahaanId: true },
      orderBy: { kode: "asc" },
    }),
  ]);
  if (pemetaan > 0 || tambahan) throw new Error(`Akun ${kode} dipakai pemetaan akun${tambahan ? ` tambahan ${tambahan.kunci}` : ""} yang berlaku untuk semua perusahaan; ${milik}`);
  const pajakLain = pengaturan.filter((p) => p.perusahaanId !== baru).map((p) => p.perusahaanId);
  // baris "default" juga dipakai perusahaan lain yang belum punya baris pengaturan sendiri
  if (pajakLain.length === 0 && pengaturan.some((p) => p.id === "default")) {
    const tanpaPengaturan = await db.perusahaan.findMany({ where: { id: { not: PERUSAHAAN_UTAMA }, pengaturan: { is: null } }, select: { id: true } });
    pajakLain.push(...tanpaPengaturan.map((p) => p.id));
  }
  if (pajakLain.length > 0) throw new Error(`Akun ${kode} dipakai pengaturan pajak ${await daftarKodePerusahaan(pajakLain)}; ${milik}`);
  if (barang) throw new Error(`Akun ${kode} dipakai akun khusus barang ${barang.kode} ${barang.perusahaanId ? `milik ${await daftarKodePerusahaan([barang.perusahaanId])}` : "bersama"}; ${milik}`);
  if (karyawan) throw new Error(`Akun ${kode} dipakai akun beban karyawan ${karyawan.kode} di ${await daftarKodePerusahaan([karyawan.perusahaanId])}; ${milik}`);
  if (kas) throw new Error(`Akun ${kode} dipakai dokumen kas ${kas.nomor} ${await daftarKodePerusahaan([kas.perusahaanId])} yang belum disetujui; ${milik}`);
  if (penyesuaian) throw new Error(`Akun ${kode} dipakai penyesuaian stok ${penyesuaian.nomor} ${await daftarKodePerusahaan([penyesuaian.perusahaanId])} yang belum disetujui; ${milik}`);
  if (gaji) throw new Error(`Akun ${kode} dipakai penggajian ${gaji.nomor} ${await daftarKodePerusahaan([gaji.perusahaanId])} yang belum disetujui; ${milik}`);
  if (aset) throw new Error(`Akun ${kode} dipakai aset tetap ${aset.kode} ${await daftarKodePerusahaan([aset.perusahaanId])}; ${milik}`);
}

/**
 * Ganti pemilik hanya bila aman (D1 §3.5 butir 2, D5 §4.7). `baru` null = dijadikan bersama. Melempar galat yang
 * menyebut perusahaan yang sudah memakai data ini.
 */
async function pastikanGantiPemilikAman(slug: string, id: string, lama: DataLama, baru: string | null): Promise<void> {
  if (slug === "akun") {
    if (baru === null) return; // menjadi akun bersama selalu boleh
    const jurnal = await db.jurnal.findMany({ where: { perusahaanId: { not: baru }, baris: { some: { akunId: id } } }, distinct: ["perusahaanId"], select: { perusahaanId: true } });
    if (jurnal.length > 0) throw new Error(`Akun ${lama.kode} sudah dipakai jurnal ${await daftarKodePerusahaan(jurnal.map((j) => j.perusahaanId))}; tidak bisa dijadikan milik ${await namaPerusahaan(db, baru)}`);
    await pastikanAkunTanpaRujukanLain(id, lama.kode, baru);
    return;
  }
  if (slug === "barang") {
    const ada = { where: { barangId: id } };
    const jumlah = await Promise.all([
      db.stokBarang.count({ where: { barangId: id, jumlah: { not: 0 } } }),
      db.barisPenawaranPenjualan.count(ada),
      db.barisPesananPenjualan.count(ada),
      db.barisPengiriman.count(ada),
      db.barisFakturPenjualan.count(ada),
      db.barisReturPenjualan.count(ada),
      db.barisPesananPembelian.count(ada),
      db.barisPenerimaanBarang.count(ada),
      db.barisFakturPembelian.count(ada),
      db.barisReturPembelian.count(ada),
      db.barisPindahBarang.count(ada),
      db.barisPenyesuaianPersediaan.count(ada),
      db.barisPeminjamanBarang.count(ada),
      db.barisKerusakanBarang.count(ada),
    ]);
    if (jumlah.some((n) => n > 0)) throw new Error("Pemilik barang tidak bisa diganti setelah barang punya stok atau transaksi; daftarkan barang baru untuk perusahaan lain");
    return;
  }
  if (slug === "gudang") {
    if (baru === null) return; // gudang bersama boleh menyimpan barang dan dokumen perusahaan mana pun
    const lain = { perusahaanId: { not: baru } };
    const [stok, ...dokumen] = await Promise.all([
      db.stokBarang.findMany({ where: { gudangId: id, jumlah: { not: 0 }, barang: { NOT: { perusahaanId: baru } } }, select: { barang: { select: { perusahaanId: true } } } }),
      db.pengirimanPesanan.findMany({ where: { gudangId: id, ...lain }, select: { perusahaanId: true }, distinct: ["perusahaanId"] }),
      db.returPenjualan.findMany({ where: { gudangId: id, ...lain }, select: { perusahaanId: true }, distinct: ["perusahaanId"] }),
      db.penerimaanBarang.findMany({ where: { gudangId: id, ...lain }, select: { perusahaanId: true }, distinct: ["perusahaanId"] }),
      db.returPembelian.findMany({ where: { gudangId: id, ...lain }, select: { perusahaanId: true }, distinct: ["perusahaanId"] }),
      db.penyesuaianPersediaan.findMany({ where: { gudangId: id, ...lain }, select: { perusahaanId: true }, distinct: ["perusahaanId"] }),
      db.pindahBarang.findMany({ where: { OR: [{ gudangAsalId: id }, { gudangTujuanId: id }], ...lain }, select: { perusahaanId: true }, distinct: ["perusahaanId"] }),
      db.peminjamanBarang.findMany({ where: { gudangId: id, ...lain }, select: { perusahaanId: true }, distinct: ["perusahaanId"] }),
      db.laporanKerusakanBarang.findMany({ where: { gudangId: id, ...lain }, select: { perusahaanId: true }, distinct: ["perusahaanId"] }),
    ]);
    const pemakai = [...stok.map((s) => s.barang.perusahaanId), ...dokumen.flat().map((d) => d.perusahaanId)];
    if (pemakai.length > 0) throw new Error(`Gudang ${lama.kode} masih dipakai stok atau dokumen ${await daftarKodePerusahaan(pemakai)}; tidak bisa dijadikan milik ${await namaPerusahaan(db, baru)}`);
    return;
  }
  if (slug === "proyek") {
    if (baru === null) throw new Error("Perusahaan pemilik event wajib diisi");
    // dokumen akar berproyek, jurnal, dokumen mitra, dan data pemasaran ikut perusahaan proyek; PJ dan BR boleh lintas
    // perusahaan (D1 §3.3 catatan B) sehingga tidak dihitung
    const lain = { proyekId: id, perusahaanId: { not: baru } };
    const pilih = { select: { perusahaanId: true }, distinct: ["perusahaanId" as const] };
    const [ap, ...dokumen] = await Promise.all([
      db.transaksiAntarPerusahaan.findMany({ where: { OR: [{ proyekPemberiId: id, pemberiId: { not: baru } }, { proyekPenerimaId: id, penerimaId: { not: baru } }] }, select: { pemberiId: true, penerimaId: true, proyekPemberiId: true } }),
      db.penawaranPenjualan.findMany({ where: lain, ...pilih }),
      db.pesananPenjualan.findMany({ where: lain, ...pilih }),
      db.pesananPembelian.findMany({ where: lain, ...pilih }),
      db.jurnal.findMany({ where: lain, ...pilih }),
      db.dokumenKas.findMany({ where: lain, ...pilih }),
      db.penggajian.findMany({ where: lain, ...pilih }),
      db.talanganMitra.findMany({ where: lain, ...pilih }),
      db.pembayaranMitra.findMany({ where: lain, ...pilih }),
      db.konten.findMany({ where: lain, ...pilih }),
      db.tugasDesain.findMany({ where: lain, ...pilih }),
      db.kampanye.findMany({ where: lain, ...pilih }),
      db.berkas.findMany({ where: lain, ...pilih }),
    ]);
    const pemakai = [...ap.map((t) => (t.proyekPemberiId === id ? t.pemberiId : t.penerimaId)), ...dokumen.flat().map((d) => d.perusahaanId)];
    if (pemakai.length > 0) throw new Error(`Proyek ${lama.kode} sudah punya jurnal atau dokumen ${await daftarKodePerusahaan(pemakai)}; perusahaan pemilik event tidak bisa diganti ke ${await namaPerusahaan(db, baru)}`);
    // baris anggaran yang diimpor dari dokumen yang kemudian pindah proyek tetap menunjuk dokumen itu (tinjauan P34 R1)
    const sumberLain = { perusahaanId: { not: baru }, barisAnggaranProyek: { some: { proyekId: id } } };
    const sumber = (await Promise.all([db.penawaranPenjualan.findMany({ where: sumberLain, ...pilih }), db.pesananPenjualan.findMany({ where: sumberLain, ...pilih })])).flat();
    if (sumber.length > 0) throw new Error(`Proyek ${lama.kode} punya baris anggaran yang bersumber dokumen ${await daftarKodePerusahaan(sumber.map((d) => d.perusahaanId))}; perusahaan pemilik event tidak bisa diganti ke ${await namaPerusahaan(db, baru)}`);
    return;
  }
  if (slug === "karyawan") {
    if (baru === null) throw new Error("Perusahaan pemberi kerja wajib diisi");
    const gaji = await db.penggajian.findMany({ where: { perusahaanId: { not: baru }, baris: { some: { karyawanId: id } } }, distinct: ["perusahaanId"], select: { perusahaanId: true } });
    if (gaji.length > 0) throw new Error(`Karyawan ${lama.kode} sudah masuk penggajian ${await daftarKodePerusahaan(gaji.map((g) => g.perusahaanId))}; tidak bisa dipindah ke ${await namaPerusahaan(db, baru)}`);
  }
}

/**
 * Aturan pemilik perusahaan untuk lima entitas berpemilik (D1 §3.5). `lama` null = data baru. Isian pemilik harus
 * perusahaan yang ada; perusahaan arsip hanya boleh bila pemiliknya tidak diganti. Barang jenis BARANG wajib punya
 * pemilik (diperiksa sebelum CHECK basis data). Ganti pemilik diperiksa pastikanGantiPemilikAman.
 */
async function periksaPemilik(slug: string, id: string | null, data: Record<string, unknown>, lama: DataLama | null): Promise<void> {
  if (!ENTITAS_BERPEMILIK.has(slug)) return;
  const baru = data[BIDANG_PERUSAHAAN] as string | null | undefined;
  if (typeof baru === "string" && baru !== lama?.perusahaanId) {
    const p = await db.perusahaan.findUnique({ where: { id: baru }, select: { nama: true, aktif: true } });
    if (!p) throw new Error("Perusahaan tidak ditemukan");
    if (!p.aktif) throw new Error(`Perusahaan ${p.nama} sudah diarsipkan; pilih perusahaan yang aktif`);
  }
  if (slug === "barang") {
    const jenisAkhir = (data.jenis as string | undefined) ?? lama?.jenis ?? "BARANG";
    const pemilikAkhir = baru !== undefined ? baru : lama ? lama.perusahaanId : PERUSAHAAN_UTAMA;
    if (jenisAkhir === "BARANG" && pemilikAkhir === null) throw new Error("Barang jenis BARANG wajib milik satu perusahaan");
  }
  if (lama && id && baru !== undefined && baru !== lama.perusahaanId) await pastikanGantiPemilikAman(slug, id, lama, baru);
  await periksaAkunKhusus(slug, data, lama, baru);
}

/**
 * Akun khusus barang dan karyawan harus milik pemilik data induknya atau bersama, supaya jurnal otomatis yang memakainya
 * tidak ditolak catatJurnal (tinjauan P13 butir 3). Jasa bersama hanya boleh memakai akun bersama. Nilai akhir = isian
 * formulir bila terkirim, selain itu nilai lama.
 */
async function periksaAkunKhusus(slug: string, data: Record<string, unknown>, lama: DataLama | null, baru: string | null | undefined): Promise<void> {
  if (slug !== "barang" && slug !== "karyawan") return;
  const kolom: readonly string[] = slug === "barang" ? KOLOM_AKUN_BARANG : ["akunBebanId"];
  const akunIds = kolom.map((k) => (k in data ? data[k] : (lama as Record<string, unknown> | null)?.[k])).filter((x): x is string => typeof x === "string" && x !== "");
  if (akunIds.length === 0) return;
  const pemilikAkhir = baru !== undefined ? baru : lama ? lama.perusahaanId : PERUSAHAAN_UTAMA;
  if (pemilikAkhir) {
    await pastikanAkunMilik(db, akunIds, pemilikAkhir);
    return;
  }
  const berpemilik = await db.akun.findFirst({ where: { id: { in: akunIds }, perusahaanId: { not: null } }, select: { kode: true, nama: true, perusahaanId: true }, orderBy: { kode: "asc" } });
  if (berpemilik) throw new Error(`Akun ${berpemilik.kode} ${berpemilik.nama} milik ${await namaPerusahaan(db, berpemilik.perusahaanId!)}; jasa bersama hanya bisa memakai akun khusus bersama`);
}

const PANJANG_DESKRIPSI_BARANG = 3000;

/** Validasi khusus per entitas yang tidak bisa dinyatakan lewat konfigurasi bidang. */
function validasiKhusus(slug: string, data: Record<string, unknown>): void {
  if (slug === "proyek") validasiProyek(data);
  if (slug === "barang" && typeof data.deskripsi === "string" && data.deskripsi.length > PANJANG_DESKRIPSI_BARANG) {
    throw new Error(`Deskripsi katalog maksimal ${PANJANG_DESKRIPSI_BARANG} karakter`);
  }
}

/**
 * Jumlah Awal di formulir Barang (bidang virtual, lihat konfigurasiDataInduk.ts): kalau diisi,
 * barang dibuat SEKALIGUS dengan satu Penyesuaian Stok berjurnal, di transaksi yang sama, jadi
 * barang baru langsung punya stok tanpa membuka formulir Penyesuaian Stok terpisah — TANPA
 * memutus jejak audit (tetap berjurnal, tetap ikut alur persetujuan bila alur itu menyala).
 * Mengembalikan true kalau ditangani di sini (barang sudah dibuat, pemanggil tidak perlu apa-apa lagi).
 */
async function buatBarangDenganJumlahAwal(pengguna: PenggunaSesi, data: Record<string, unknown>, dataFormulir: FormData): Promise<boolean> {
  const jumlahAwalMentah = dataFormulir.get("jumlahAwal");
  if (typeof jumlahAwalMentah !== "string" || !jumlahAwalMentah.trim()) return false;
  const jumlahAwal = bacaUang(jumlahAwalMentah, "Jumlah Awal", { allowZero: true });
  if (jumlahAwal.isZero()) return false;
  if (data.jenis === "JASA") throw new Error("Jasa tidak punya stok; kosongkan Jumlah Awal");

  const gudangAwalId = String(dataFormulir.get("gudangAwalId") ?? "");
  const akunLawanAwalId = String(dataFormulir.get("akunLawanAwalId") ?? "");
  if (!gudangAwalId) throw new Error("Gudang untuk Jumlah Awal wajib dipilih");
  if (!akunLawanAwalId) throw new Error("Akun Lawan Jumlah Awal wajib dipilih (mis. Modal)");
  await pastikanAkunRinci(db, [akunLawanAwalId]);

  const hargaSatuan = (data.hargaBeli as Desimal | undefined) ?? D(0);
  if (hargaSatuan.lte(0)) throw new Error("Isi Harga Beli lebih dulu untuk menghitung nilai Jumlah Awal");

  const perluPersetujuan = await persetujuanWajib(db);
  const nomor = await nomorDokumenBerikutnya(db.penyesuaianPersediaan, "PS");

  await db.$transaction(async (tx) => {
    const barang = await tx.barang.create({ data: data as Prisma.BarangCreateInput });
    // dokumen penyesuaian mewarisi pemilik barang (D1 §3.3); BARANG selalu punya pemilik (periksaPemilik dan CHECK)
    const perusahaanId = barang.perusahaanId ?? PERUSAHAAN_UTAMA;
    await pastikanGudangMilik(tx, [gudangAwalId], perusahaanId);
    await pastikanAkunMilik(tx, [akunLawanAwalId], perusahaanId);
    if (!perluPersetujuan) {
      await tx.stokBarang.upsert({
        where: { barangId_gudangId: { barangId: barang.id, gudangId: gudangAwalId } },
        create: { barangId: barang.id, gudangId: gudangAwalId, jumlah: jumlahAwal },
        update: { jumlah: jumlahAwal },
      });
      await perbaruiHargaRata(tx, barang.id, jumlahAwal, hargaSatuan, true);
    }
    const keterangan = `Jumlah awal saat barang ${barang.kode} dibuat`;
    const penyesuaian = await tx.penyesuaianPersediaan.create({
      data: {
        nomor,
        gudangId: gudangAwalId,
        akunLawanId: akunLawanAwalId,
        keterangan,
        // dokumen milik pemilik barang, jadi jurnalnya sama di mode langsung dan saat disetujui (tinjauan P11 butir 1)
        perusahaanId,
        ...(perluPersetujuan ? { statusPersetujuan: "DRAFT" } : dataLangsungDisetujui(pengguna)),
        baris: { create: [{ barangId: barang.id, jumlahSebelum: D(0), jumlahSesudah: jumlahAwal, hargaSatuan }] },
      },
    });
    if (perluPersetujuan) return;
    // jurnal stok awal milik pemilik barang (P11); BARANG selalu punya pemilik (CHECK basis data)
    const jurnal = await catatJurnalPenyesuaianPersediaan(tx, { nomor, akunLawanId: akunLawanAwalId, keterangan, perusahaanId }, [{ barangId: barang.id, selisih: jumlahAwal, hargaSatuan }]);
    if (jurnal) await tx.penyesuaianPersediaan.update({ where: { id: penyesuaian.id }, data: { jurnalId: jurnal.id } });
  });

  revalidatePath("/persediaan");
  revalidatePath("/persediaan/penyesuaian");
  if (perluPersetujuan) revalidatePath("/persetujuan");
  return true;
}

export async function buatDataInduk(slug: string, dataFormulir: FormData) {
  const { config, pengguna } = await konfigurasiDenganHak(slug);
  const data = await bacaData(config, dataFormulir, false);
  validasiKhusus(slug, data);
  await periksaPemilik(slug, null, data, null);
  if (slug !== "barang" || !(await buatBarangDenganJumlahAwal(pengguna, data, dataFormulir))) {
    await delegasi(config.model).create({ data });
  }
  if (slug === "akun") await catatBaganAkun(pengguna, "BUAT", String(data.kode ?? ""), `Akun ${String(data.kode ?? "")} — ${String(data.nama ?? "")} dibuat`);
  revalidatePath(`/data-induk/${slug}`);
}

export async function ubahDataInduk(slug: string, id: string, dataFormulir: FormData) {
  const { config, pengguna } = await konfigurasiDenganHak(slug);
  const data = await bacaData(config, dataFormulir, true);
  if ("indukId" in data && data.indukId === id) throw new Error("Data tidak bisa menjadi induk dirinya sendiri");
  validasiKhusus(slug, data);
  const lama = ENTITAS_BERPEMILIK.has(slug) ? ((await delegasiBacaSatu(config.model).findUnique({ where: { id } })) as DataLama | null) : null;
  await periksaPemilik(slug, id, data, lama);
  if (slug === "proyek" && lama && typeof data.status === "string" && data.status !== lama.status) {
    // log perubahan status proyek (D5 §3.1) di transaksi yang sama dengan perubahannya
    const dari = lama.status ?? "", ke = data.status;
    const label = (x: string) => (statusProyekSah(x) ? LABEL_STATUS_PROYEK[x] : x);
    await db.$transaction(async (tx) => {
      await tx.proyek.update({ where: { id }, data: data as Prisma.ProyekUncheckedUpdateInput });
      await catatAktivitas(tx, pengguna, {
        aksi: "UBAH_STATUS",
        jenis: "Proyek",
        nomor: String(data.kode ?? lama.kode),
        keterangan: `Status ${label(dari)} menjadi ${label(ke)}`,
        modul: "proyek",
        entitasId: id,
        meta: { dari, ke },
        perusahaanId: (data[BIDANG_PERUSAHAAN] as string | undefined) ?? lama.perusahaanId,
      });
    });
  } else {
    await delegasi(config.model).update({ where: { id }, data });
  }
  if (slug === "akun") await catatBaganAkun(pengguna, "UBAH", String(data.kode ?? ""), `Akun ${String(data.kode ?? "")} — ${String(data.nama ?? "")} diubah`);
  revalidatePath(`/data-induk/${slug}`);
  redirect(`/data-induk/${slug}`);
}

/** SQLSTATE kebuntuan (40P01), gagal serialisasi (40001), dan kunci tidak tersedia (55P03). */
const SQLSTATE_PROYEK_DIPAKAI = new Set(["40P01", "40001", "55P03"]);

/**
 * Galat basis data yang berarti proyek sedang atau masih dipakai transaksi lain (P2034 deadlock/konflik, P2003 FK, dan
 * P2028 batas waktu transaksi interaktif habis karena menunggu kunci jalur lain, tinjauan P37 R3). Galat dari kueri
 * mentah datang sebagai P2010 dengan SQLSTATE di meta adapter pg, jadi SQLSTATE dibaca lewat kodeSqlState
 * (tinjauan P44 S1).
 */
function galatProyekDipakai(e: unknown): boolean {
  const g = (e ?? {}) as { code?: unknown; meta?: unknown };
  return g.code === "P2034" || g.code === "P2028" || SQLSTATE_PROYEK_DIPAKAI.has(kodeSqlState(g) ?? "") || galatMasihDipakai(e);
}

/**
 * Hapus proyek. Perilaku main dipertahankan: jurnal dan dokumen lama yang menautkan proyek dikosongkan proyeknya oleh
 * basis data (SET NULL), sedangkan mitra, baris anggaran, dan pembatasan berkas ikut terhapus (CASCADE di skema).
 * Penolakan hanya untuk anak yang FK-nya RESTRICT: talangan mitra, pembayaran ke mitra, dan berkas (D7 §3.3.7 no. 5).
 *
 * Urutan kunci (catatan orkestrator sesudah P35 dan P36, tinjauan P36 R1): pesanan lalu penawaran penjualan yang menaut
 * proyek dikunci urut id lebih dulu, karena SET NULL akan menulis baris itu. Kuncinya FOR UPDATE, sehingga hapus juga
 * menunggu FOR KEY SHARE yang diambil sisipan anak pesanan (surat jalan, faktur, uang muka, termin) sampai jalur itu
 * selesai. FOR NO KEY UPDATE (tinjauan P37 R3) sempat dipakai, tetapi membentuk kebuntuan dengan buatPengiriman: SJ
 * memegang KEY SHARE pesanan dan Proyek lalu mengubah status pesanan, sementara hapus memegang pesanan dan menunggu
 * Proyek (tinjauan P44 S1). Bila menunggu melewati batas waktu transaksi, P2028 menjadi "Proyek masih dipakai".
 * Sinkron anggaran memegang dokumen sumber (FOR SHARE) sebelum Proyek, jadi hapus harus memakai urutan yang sama: dokumen, lalu Proyek. Pesanan
 * dikunci sebelum penawaran seperti hapus pesanan (kepala pesanan lalu penawaran asal). Sesudah itu baris Proyek FOR
 * UPDATE, lalu anak RESTRICT dihitung di dalam transaksi. Baris mitra lalu dikunci FOR UPDATE SKIP LOCKED. Mitra yang sedang dipegang
 * jalur dokumen mitra (kunci mitra lalu sisipan ber-proyekId) tidak ditunggu, karena menunggunya lewat cascade
 * membentuk siklus kunci (P33 S1). Hapus langsung ditolak "Proyek masih dipakai" dan jalur itu tetap selesai.
 */
async function hapusProyek(id: string) {
  try {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "PesananPenjualan" WHERE "proyekId" = ${id} ORDER BY "id" FOR UPDATE`;
      await tx.$queryRaw`SELECT 1 FROM "PenawaranPenjualan" WHERE "proyekId" = ${id} ORDER BY "id" FOR UPDATE`;
      const [p] = await tx.$queryRaw<{ kode: string }[]>`SELECT "kode" FROM "Proyek" WHERE "id" = ${id} FOR UPDATE`;
      if (!p) throw new Error("Data tidak ditemukan (mungkin sudah dihapus).");
      // berurutan: transaksi interaktif tidak boleh menjalankan kueri bersamaan
      const anak: [string, number][] = [
        ["talangan mitra", await tx.talanganMitra.count({ where: { proyekId: id } })],
        ["pembayaran ke mitra", await tx.pembayaranMitra.count({ where: { proyekId: id } })],
        ["berkas", await tx.berkas.count({ where: { proyekId: id } })],
      ];
      const ada = anak.filter(([, n]) => n > 0);
      if (ada.length) throw new Error(`Proyek ${p.kode} masih punya ${ada.map(([nama, n]) => `${n} ${nama}`).join(", ")}; hapus atau pindahkan data itu dulu`);
      const jumlahMitra = await tx.mitraProyek.count({ where: { proyekId: id } });
      if (jumlahMitra > 0) {
        const terkunci = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "MitraProyek" WHERE "proyekId" = ${id} FOR UPDATE SKIP LOCKED`;
        if (terkunci.length !== jumlahMitra) throw new Error("Proyek masih dipakai; muat ulang lalu coba lagi");
      }
      await tx.proyek.delete({ where: { id } });
    });
  } catch (e) {
    if (galatProyekDipakai(e)) throw new Error("Proyek masih dipakai; muat ulang lalu coba lagi");
    throw e;
  }
}

export async function hapusDataInduk(slug: string, id: string) {
  const { config, pengguna } = await konfigurasiDenganHak(slug);
  // Ambil identitas akun sebelum dihapus agar jejak audit tetap bermakna
  const jejakAkun = slug === "akun" ? await db.akun.findUnique({ where: { id }, select: { kode: true, nama: true } }) : null;
  if (slug === "proyek") await hapusProyek(String(id ?? ""));
  else await delegasi(config.model).delete({ where: { id } });
  if (slug === "akun") await catatBaganAkun(pengguna, "HAPUS", jejakAkun?.kode ?? id, jejakAkun ? `Akun ${jejakAkun.kode} — ${jejakAkun.nama} dihapus` : `Akun ${id} dihapus`);
  revalidatePath(`/data-induk/${slug}`);
}

// ---------- Varian untuk <FormulirAksi> (mengembalikan pesan error, bukan throw) ----------

export async function buatDataIndukFormulir(slug: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatDataInduk(slug, dataFormulir));
}
export async function ubahDataIndukFormulir(slug: string, id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahDataInduk(slug, id, dataFormulir));
}
// Dipakai lewat .bind(null, slug, id); argumen (prevState, dataFormulir) dari useActionState sengaja diabaikan
export async function hapusDataIndukFormulir(slug: string, id: string) {
  return jalankanFormulir(() => hapusDataInduk(slug, id));
}

// ---------- Foto barang (galeri di halaman ubah Barang & Jasa) ----------

function revalidasiFotoBarang(barangId: string) {
  revalidatePath("/data-induk/barang");
  revalidatePath(`/data-induk/barang/${barangId}`);
}

// ---------- Stok barang (kartu "Stok Barang" di halaman Ubah Barang & Jasa) ----------

/**
 * Ubah "Stok saat ini" langsung dari halaman Barang & Jasa: di belakang layar ini membuat satu
 * Penyesuaian Stok berjurnal (jumlahSebelum = stok saat ini di gudang terpilih, jumlahSesudah = nilai
 * yang diisi), pola yang sama dengan Jumlah Awal saat barang baru dibuat (lihat
 * buatBarangDenganJumlahAwal di atas) — supaya koreksi stok cepat TANPA memutus jejak audit.
 */
export async function ubahStokBarang(barangId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("stok-induk.tulis");
  const gudangId = String(dataFormulir.get("gudangId") ?? "");
  if (!gudangId) throw new Error("Gudang wajib dipilih");
  const stokBaru = bacaUang(String(dataFormulir.get("stok") ?? ""), "Stok", { allowZero: true });

  const barang = await db.barang.findUnique({ where: { id: barangId }, select: { kode: true, jenis: true, hargaBeli: true, perusahaanId: true } });
  if (!barang) throw new Error("Barang tidak ditemukan");
  if (barang.jenis !== "BARANG") throw new Error("Jasa tidak punya stok");

  const existing = await db.stokBarang.findUnique({ where: { barangId_gudangId: { barangId, gudangId } } });
  const jumlahSebelum = D(existing?.jumlah ?? 0);
  const selisih = stokBaru.minus(jumlahSebelum);
  if (selisih.isZero()) throw new Error(`Stok ${barang.kode} di gudang ini sudah ${jumlahSebelum}, tidak ada perubahan`);

  const akunLawanId = String(dataFormulir.get("akunLawanId") ?? "");
  if (!akunLawanId) throw new Error("Akun Lawan Penyesuaian wajib dipilih (mis. Selisih Persediaan)");
  await pastikanAkunRinci(db, [akunLawanId]);

  const hargaSatuan = D(barang.hargaBeli);
  if (selisih.gt(0) && hargaSatuan.lte(0)) throw new Error("Isi Harga Beli barang ini lebih dulu untuk menghitung nilai penyesuaian stok");
  // dokumen koreksi stok milik pemilik barang (D1 §3.3): gudang dan akun lawan harus milik perusahaan itu atau bersama
  const perusahaanId = barang.perusahaanId ?? PERUSAHAAN_UTAMA;
  await pastikanPerusahaanAktif(db, perusahaanId);
  await pastikanGudangMilik(db, [gudangId], perusahaanId);
  await pastikanAkunMilik(db, [akunLawanId], perusahaanId);

  const perluPersetujuan = await persetujuanWajib(db);
  const nomor = await nomorDokumenBerikutnya(db.penyesuaianPersediaan, "PS");
  const keterangan = `Koreksi stok ${barang.kode} dari halaman Barang & Jasa`;

  await db.$transaction(async (tx) => {
    if (!perluPersetujuan) {
      await tx.stokBarang.upsert({
        where: { barangId_gudangId: { barangId, gudangId } },
        create: { barangId, gudangId, jumlah: stokBaru },
        update: { jumlah: stokBaru },
      });
      if (selisih.gt(0)) await perbaruiHargaRata(tx, barangId, selisih, hargaSatuan, true);
    }
    const penyesuaian = await tx.penyesuaianPersediaan.create({
      data: {
        nomor,
        gudangId,
        akunLawanId,
        keterangan,
        perusahaanId,
        ...(perluPersetujuan ? { statusPersetujuan: "DRAFT" as const } : dataLangsungDisetujui(pengguna)),
        baris: { create: [{ barangId, jumlahSebelum, jumlahSesudah: stokBaru, hargaSatuan }] },
      },
    });
    if (perluPersetujuan) return;
    // jurnal koreksi stok milik pemilik barang (P11)
    const jurnal = await catatJurnalPenyesuaianPersediaan(tx, { nomor, akunLawanId, keterangan, perusahaanId }, [{ barangId, selisih, hargaSatuan }]);
    if (jurnal) await tx.penyesuaianPersediaan.update({ where: { id: penyesuaian.id }, data: { jurnalId: jurnal.id } });
  });

  revalidatePath("/persediaan");
  revalidatePath("/persediaan/penyesuaian");
  revalidatePath(`/data-induk/barang/${barangId}`);
  if (perluPersetujuan) revalidatePath("/persetujuan");
}

export async function ubahStokBarangFormulir(barangId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahStokBarang(barangId, dataFormulir));
}

export async function unggahFotoBarangFormulir(barangId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(async () => {
    await wajibHakAksi("stok-induk.tulis");
    const daftarFoto = await bacaFotoDariFormulir(dataFormulir, "foto", { maksimal: 3, wajib: true });
    const barang = await db.barang.findUnique({ where: { id: barangId }, select: { _count: { select: { foto: true } } } });
    if (!barang) throw new Error("Barang tidak ditemukan");
    const mulai = barang._count.foto;
    await db.foto.createMany({ data: daftarFoto.map((f, i) => ({ barangId, urutan: mulai + i, tipe: f.tipe, ukuran: f.ukuran, isi: f.isi })) });
    revalidasiFotoBarang(barangId);
  });
}

// Dipakai lewat .bind(null, fotoId); argumen useActionState diabaikan seperti hapusDataIndukFormulir
export async function hapusFotoBarangFormulir(fotoId: string) {
  return jalankanFormulir(async () => {
    await wajibHakAksi("stok-induk.tulis");
    const foto = await db.foto.findUnique({ where: { id: fotoId }, select: { barangId: true } });
    // Foto bukti peminjaman (barangId null) punya aksi hapus sendiri dengan hak berbeda
    if (!foto?.barangId) throw new Error("Foto barang tidak ditemukan");
    await db.foto.delete({ where: { id: fotoId } });
    revalidasiFotoBarang(foto.barangId);
  });
}
