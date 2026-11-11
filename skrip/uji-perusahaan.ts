import "dotenv/config";
// Skrip ini memanggil pustaka dan aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { D } from "../src/lib/uang";
import {
  PERUSAHAAN_UTAMA,
  akunAntarPerusahaan,
  kunciPeriodeGaji,
  lingkupPerusahaan,
  pastikanAkunMilik as pastikanAkunMilikEksporUlang,
  saldoAntarPerusahaan,
  tentukanLingkup,
} from "../src/lib/perusahaan";
import { daftarAkunKasBank, pastikanAkunMilik } from "../src/lib/baganAkun";
import { PENGATURAN_BAWAAN, ambilPengaturanPerusahaan, idPengaturan } from "../src/lib/pengaturanPerusahaan";
import { kunciPeriodeGaji as kunciPeriodeGajiSdm, daftarKaryawanAktif } from "../src/lib/sdm";
import {
  LABEL_STATUS_PROYEK,
  STATUS_PROYEK,
  WARNA_PROYEK,
  bacaProyekId,
  daftarProyekAktif,
  daftarRingkasanProyek,
  labelKlienProyek,
  ringkasanProyek,
  validasiProyek,
} from "../src/lib/proyek";
import { ringkasanPajak, type RingkasanPajak } from "../src/lib/pajak";
import { muatMasukanKeuangan } from "../src/lib/keuanganProyek";
import { periksaSinkron } from "../src/lib/sinkron";
import { buatPenggajian } from "../src/lib/aksi/sdm";
import { catatPphFinal } from "../src/lib/aksi/pajak";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { formulir, harusDitolak, jalankan, pastikan } from "./bantuan";

/*
 * Uji pustaka perusahaan lanjutan (P10): D1 §9.1 kasus 1, 2, 3, 10, 11, kepemilikan akun (pastikanAkunMilik),
 * pengaturan pajak per perusahaan, pilihan kas/karyawan/proyek per perusahaan, status proyek D5 §3.1, PPh Final dan
 * penggajian per perusahaan, faktor DPP keuangan proyek, dan saldo antar perusahaan. Data uji berkode UJIPR dibuat
 * lewat db dan dihapus di awal dan di akhir; periksaSinkron(db) seimbang sebelum dan sesudah.
 */

const KODE = "UJIPR";
const PERIODE_GAJI = "2018-11"; // bulan lampau yang tidak dipakai suite lain
const PERIODE_GAJI_GABUNGAN = "2018-12";

/** Menjalankan fn dengan UJI_PERUSAHAAN (dan opsional UJI_PERAN) sementara; "semua" = gabungan. */
async function dengan<T>(isian: { perusahaan?: string; peran?: string }, fn: () => Promise<T>): Promise<T> {
  const lama = { perusahaan: process.env.UJI_PERUSAHAAN, peran: process.env.UJI_PERAN };
  const atur = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
  atur("UJI_PERUSAHAAN", isian.perusahaan);
  atur("UJI_PERAN", isian.peran);
  try {
    return await fn();
  } finally {
    atur("UJI_PERUSAHAAN", lama.perusahaan);
    atur("UJI_PERAN", lama.peran);
  }
}

const sama = (a: { toString(): string } | null | undefined, b: { toString(): string } | null | undefined) => D(a?.toString() ?? 0).equals(D(b?.toString() ?? 0));

/** Hapus jurnal langsung beserta barisnya (hanya jurnal buatan uji ini). */
async function hapusJurnalLangsung(jurnalIds: string[]) {
  if (jurnalIds.length === 0) return;
  await db.barisJurnal.deleteMany({ where: { jurnalId: { in: jurnalIds } } });
  await db.jurnal.deleteMany({ where: { id: { in: jurnalIds } } });
}

async function bersihkanData() {
  const pt = await db.perusahaan.findUnique({ where: { kode: KODE }, select: { id: true } });
  const akunUji = (await db.akun.findMany({ where: { kode: { startsWith: `${KODE}-` } }, select: { id: true } })).map((a) => a.id);
  // dokumen lewat hapusDokumen supaya jurnalnya ikut dibalik
  const gaji = await db.penggajian.findMany({ where: { OR: [{ bulan: { in: [PERIODE_GAJI, PERIODE_GAJI_GABUNGAN] }, baris: { some: { karyawan: { kode: { startsWith: `${KODE}-` } } } } }, ...(pt ? [{ perusahaanId: pt.id }] : [])] }, select: { id: true } });
  for (const g of gaji) await jalankan(`hapus penggajian uji ${g.id}`, () => hapusDokumen("penggajian", g.id));
  if (pt) for (const p of await db.pphFinalBulanan.findMany({ where: { perusahaanId: pt.id }, select: { id: true } })) await jalankan(`hapus PPh Final uji ${p.id}`, () => hapusDokumen("pphFinal", p.id));
  const jurnalUji = await db.jurnal.findMany({ where: { OR: [{ nomor: { startsWith: `${KODE}-` } }, ...(pt ? [{ perusahaanId: pt.id }] : []), { baris: { some: { akunId: { in: akunUji } } } }] }, select: { id: true } });
  await hapusJurnalLangsung(jurnalUji.map((j) => j.id));
  await db.pemetaanAkunTambahan.deleteMany({ where: { akun: { kode: { startsWith: `${KODE}-` } } } });
  await db.karyawan.deleteMany({ where: { kode: { startsWith: `${KODE}-` } } });
  await db.proyek.deleteMany({ where: { kode: { startsWith: `${KODE}-` } } });
  if (pt) await db.pengaturanPerusahaan.deleteMany({ where: { perusahaanId: pt.id } });
  await db.akun.deleteMany({ where: { kode: { startsWith: `${KODE}-` } } });
  if (pt) await db.perusahaan.delete({ where: { id: pt.id } });
  await db.logAktivitas.deleteMany({ where: { OR: [{ nomor: { startsWith: `${KODE}-` } }, { nomor: { in: nomorLog }, waktu: { gte: awalUji } }] } });
}

/** Nomor dokumen yang dibuat uji ini; log BUAT/CATAT/HAPUS-nya dihapus di akhir (log lain tidak disentuh). */
const nomorLog: string[] = [];
const awalUji = new Date();

async function main() {
  await bersihkanData();
  const awalHakAksesPeran = await db.hakAksesPeran.count();
  const sinkronAwal = await periksaSinkron(db);
  pastikan(sinkronAwal.seimbang, "buku besar seimbang sebelum uji");
  const jumlahJurnalAwal = await db.jurnal.count();
  const sekarang = new Date();
  const tahun = sekarang.getFullYear();
  const bulan = sekarang.getMonth() + 1;
  const bulanIni = `${tahun}-${String(bulan).padStart(2, "0")}`;
  const pajakUtama0 = await ringkasanPajak(db, tahun, D("0.5"), PERUSAHAAN_UTAMA);

  console.log("=== 1. tentukanLingkup (D1 §9.1 kasus 1) ===");
  const ada = new Set(["utama", "tapussa"]);
  pastikan(tentukanLingkup({ pilihan: "tapussa", bolehGabungan: false, adaIds: ada }) === "tapussa", "pilihan ada: id itu");
  pastikan(tentukanLingkup({ pilihan: "tidak-ada", bolehGabungan: true, adaIds: ada }) === null, "pilihan tidak ada + boleh gabungan: gabungan");
  pastikan(tentukanLingkup({ pilihan: "tidak-ada", bolehGabungan: false, adaIds: ada }) === "utama", "pilihan tidak ada + tidak boleh gabungan: utama");
  pastikan(tentukanLingkup({ pilihan: null, bolehGabungan: true, adaIds: ada }) === null && tentukanLingkup({ pilihan: null, bolehGabungan: false, adaIds: ada }) === "utama", "tanpa pilihan: gabungan bila boleh, utama bila tidak");

  console.log("=== 2. Perusahaan, akun, karyawan, proyek uji ===");
  const pt = await db.perusahaan.create({ data: { kode: KODE, nama: "PT Uji Perusahaan Lanjutan", urutan: 96 } });
  const U = pt.id;
  pastikan((await dengan({}, lingkupPerusahaan)).perusahaanId === "utama", "lingkup tanpa UJI_PERUSAHAAN: utama (D1 §9.1 kasus 2)");
  pastikan((await dengan({ perusahaan: "semua" }, lingkupPerusahaan)).perusahaanId === null, "UJI_PERUSAHAAN=semua: gabungan");
  pastikan((await dengan({ perusahaan: U }, lingkupPerusahaan)).perusahaanId === U, "UJI_PERUSAHAAN=perusahaan uji: perusahaan uji");
  pastikan((await dengan({ perusahaan: "semua", peran: "KASIR" }, lingkupPerusahaan)).perusahaanId === "utama", "UJI_PERUSAHAAN=semua + KASIR: utama");

  const akunBaru = (kode: string, nama: string, jenis: "ASET" | "BEBAN" | "KEWAJIBAN", perusahaanId: string | null, kasBank = false) =>
    db.akun.create({ data: { kode: `${KODE}-${kode}`, nama, jenis, kasBank, perusahaanId } });
  const kasU = await akunBaru("KAS-U", "Kas Uji Perusahaan", "ASET", U, true);
  const kasUt = await akunBaru("KAS-UT", "Kas Uji Utama", "ASET", PERUSAHAAN_UTAMA, true);
  const kasBersama = await akunBaru("KAS-B", "Kas Uji Bersama", "ASET", null, true);
  const bebanUt = await akunBaru("BEBAN-UT", "Beban Uji Utama", "BEBAN", PERUSAHAAN_UTAMA);
  const karyawanU = await db.karyawan.create({ data: { kode: `${KODE}-KRY-U`, nama: "Karyawan Uji Perusahaan", gajiPokok: 2_000_000, perusahaanId: U } });
  const karyawanUt = await db.karyawan.create({ data: { kode: `${KODE}-KRY-UT`, nama: "Karyawan Uji Utama", gajiPokok: 1_500_000 } });
  const proyekU = await db.proyek.create({ data: { kode: `${KODE}-PRJ-U`, nama: "Event Uji Perusahaan", perusahaanId: U } });
  const proyekArsip = await db.proyek.create({ data: { kode: `${KODE}-PRJ-ARSIP`, nama: "Event Uji Diarsipkan", status: "DIARSIP", perusahaanId: U } });
  const proyekBatal = await db.proyek.create({ data: { kode: `${KODE}-PRJ-BATAL`, nama: "Event Uji Batal", status: "BATAL", perusahaanId: U } });
  const proyekDitunda = await db.proyek.create({ data: { kode: `${KODE}-PRJ-TUNDA`, nama: "Event Uji Ditunda", status: "DITUNDA", perusahaanId: U, namaKlien: "Klien Bebas" } });
  const proyekUt = await db.proyek.create({ data: { kode: `${KODE}-PRJ-UT`, nama: "Event Uji Utama" } });

  console.log("=== 3. pastikanAkunMilik (D1 §3.4) ===");
  pastikan(pastikanAkunMilikEksporUlang === pastikanAkunMilik, "perusahaan.ts mengekspor ulang pastikanAkunMilik dari baganAkun.ts");
  await pastikanAkunMilik(db, [kasU.id, kasBersama.id], U);
  await pastikanAkunMilik(db, [kasUt.id, kasBersama.id, bebanUt.id], PERUSAHAAN_UTAMA);
  await pastikanAkunMilik(db, [], U);
  pastikan(true, "akun milik sendiri dan akun bersama diterima; daftar kosong diterima");
  await harusDitolak("akun milik utama di pembukuan perusahaan uji", () => pastikanAkunMilik(db, [kasBersama.id, kasUt.id], U), `Akun ${KODE}-KAS-UT Kas Uji Utama milik `);
  await harusDitolak("akun milik perusahaan uji di pembukuan utama", () => pastikanAkunMilik(db, [kasU.id], PERUSAHAAN_UTAMA), `tidak bisa dipakai di pembukuan`);
  const namaUtama = (await db.perusahaan.findUniqueOrThrow({ where: { id: PERUSAHAAN_UTAMA } })).nama;
  await harusDitolak("pesan lengkap D1 §3.1", () => pastikanAkunMilik(db, [kasUt.id], U), `Akun ${KODE}-KAS-UT Kas Uji Utama milik ${namaUtama}, tidak bisa dipakai di pembukuan ${pt.nama}`);

  console.log("=== 4. Pilihan kas, karyawan, dan proyek per perusahaan ===");
  const kasSemua = (await daftarAkunKasBank()).map((a) => a.id);
  const kasLingkupU = (await daftarAkunKasBank(db, U)).map((a) => a.id);
  const kasLingkupUt = (await daftarAkunKasBank(db, PERUSAHAAN_UTAMA)).map((a) => a.id);
  pastikan([kasU.id, kasUt.id, kasBersama.id].every((id) => kasSemua.includes(id)), "daftarAkunKasBank tanpa perusahaan: semua akun kas (perilaku lama)");
  pastikan(kasLingkupU.includes(kasU.id) && kasLingkupU.includes(kasBersama.id) && !kasLingkupU.includes(kasUt.id), "daftarAkunKasBank perusahaan uji: milik sendiri dan bersama, tanpa milik utama");
  pastikan(kasLingkupUt.includes(kasUt.id) && kasLingkupUt.includes(kasBersama.id) && !kasLingkupUt.includes(kasU.id), "daftarAkunKasBank utama: tanpa akun milik perusahaan uji");
  pastikan((await daftarAkunKasBank(db, null)).length === kasSemua.length, "perusahaanId null = semua");
  const karyawanSemua = (await daftarKaryawanAktif()).map((k) => k.id);
  const karyawanLingkupU = (await daftarKaryawanAktif(db, U)).map((k) => k.id);
  pastikan(karyawanSemua.includes(karyawanU.id) && karyawanSemua.includes(karyawanUt.id), "daftarKaryawanAktif tanpa perusahaan: semua");
  pastikan(karyawanLingkupU.length === 1 && karyawanLingkupU[0] === karyawanU.id, "daftarKaryawanAktif perusahaan uji: hanya karyawannya");
  const proyekAktifU = (await daftarProyekAktif(db, U)).map((p) => p.id);
  const proyekAktifSemua = (await daftarProyekAktif()).map((p) => p.id);
  pastikan(proyekAktifU.includes(proyekU.id) && proyekAktifU.includes(proyekDitunda.id) && !proyekAktifU.includes(proyekArsip.id) && !proyekAktifU.includes(proyekBatal.id) && !proyekAktifU.includes(proyekUt.id), "daftarProyekAktif perusahaan uji: tanpa DIARSIP, BATAL, dan proyek utama");
  pastikan(proyekAktifSemua.includes(proyekUt.id) && proyekAktifSemua.includes(proyekU.id) && !proyekAktifSemua.includes(proyekArsip.id), "daftarProyekAktif tanpa perusahaan: semua perusahaan, tetap tanpa DIARSIP");
  pastikan((await bacaProyekId(formulir({ proyekId: proyekU.id }), db, U)) === proyekU.id && (await bacaProyekId(formulir({ proyekId: proyekUt.id }))) === proyekUt.id && (await bacaProyekId(formulir({}), db, U)) === null, "bacaProyekId: proyek milik sendiri, tanpa perusahaan, dan kosong diterima");
  await harusDitolak("bacaProyekId proyek perusahaan lain", () => bacaProyekId(formulir({ proyekId: proyekUt.id }), db, U), `Proyek ${KODE}-PRJ-UT milik ${namaUtama}; pilih proyek ${pt.nama}`);
  await harusDitolak("bacaProyekId proyek tidak ada", () => bacaProyekId(formulir({ proyekId: "tidak-ada" }), db, U), "Proyek/event tidak ditemukan");
  const ringkasLpj = await daftarRingkasanProyek(db, U);
  pastikan(ringkasLpj.length === 4 && ringkasLpj.every((p) => p.kode.startsWith(`${KODE}-PRJ-`) && p.kode !== `${KODE}-PRJ-UT`), "daftarRingkasanProyek perusahaan uji: hanya proyeknya (termasuk arsip dan batal)");
  pastikan((await daftarRingkasanProyek()).some((p) => p.id === proyekUt.id), "daftarRingkasanProyek tanpa perusahaan: semua");

  console.log("=== 5. Status proyek D5 §3.1 ===");
  pastikan(STATUS_PROYEK.join() === "BERJALAN,DITUNDA,SELESAI,DIARSIP,BATAL" && STATUS_PROYEK.every((s) => !!LABEL_STATUS_PROYEK[s]) && LABEL_STATUS_PROYEK.DIARSIP === "Diarsipkan", "STATUS_PROYEK dan LABEL_STATUS_PROYEK");
  pastikan(WARNA_PROYEK.length === 8 && WARNA_PROYEK.every((w) => /^#[0-9a-f]{6}$/.test(w)), "WARNA_PROYEK delapan warna #rrggbb");
  const mulai = new Date("2026-05-10T00:00:00"), selesai = new Date("2026-05-09T00:00:00");
  await harusDitolak("tanggal selesai sebelum mulai", async () => validasiProyek({ tanggalMulai: mulai, tanggalSelesai: selesai }), "Tanggal selesai tidak boleh sebelum tanggal mulai");
  await harusDitolak("status tidak dikenal", async () => validasiProyek({ status: "AKTIF" }), "Status proyek tidak dikenal");
  await harusDitolak("nama klien 161 karakter", async () => validasiProyek({ namaKlien: "k".repeat(161) }), "Nama klien maksimal 160 karakter");
  validasiProyek({});
  validasiProyek({ status: "DITUNDA", tanggalMulai: mulai, tanggalSelesai: mulai, namaKlien: "k".repeat(160) });
  validasiProyek({ status: null, tanggalMulai: null, tanggalSelesai: selesai, namaKlien: null });
  pastikan(true, "validasiProyek menerima data sah, tanggal sama, bidang kosong, dan status null (bawaan ubah)");
  pastikan(labelKlienProyek({ pelanggan: { nama: "PT Pelanggan" }, namaKlien: "Klien Bebas" }) === "PT Pelanggan" && labelKlienProyek({ pelanggan: null, namaKlien: "Klien Bebas" }) === "Klien Bebas" && labelKlienProyek({ namaKlien: null }) === null, "labelKlienProyek: pelanggan dulu, lalu nama klien");

  console.log("=== 6. Pengaturan per perusahaan (D1 §3.6, §9.1 kasus 3) ===");
  pastikan(idPengaturan(PERUSAHAAN_UTAMA) === "default" && idPengaturan(U) === U, "idPengaturan: utama = default, lain = perusahaanId");
  const barisDefault = await db.pengaturanPerusahaan.findUniqueOrThrow({ where: { id: "default" } });
  const utamaTanpaArg = await ambilPengaturanPerusahaan();
  const utamaDenganArg = await ambilPengaturanPerusahaan(db, PERUSAHAAN_UTAMA);
  pastikan(utamaTanpaArg.perusahaanId === "utama" && utamaTanpaArg.nama === barisDefault.nama && utamaTanpaArg.terminHari === barisDefault.terminHari && utamaTanpaArg.akunBebanPphFinalId === barisDefault.akunBebanPphFinalId, "tanpa argumen: baris default milik utama");
  pastikan(JSON.stringify(utamaTanpaArg) === JSON.stringify(utamaDenganArg), "(db, utama) sama dengan tanpa argumen");
  pastikan(PENGATURAN_BAWAAN.perusahaanId === "utama", "PENGATURAN_BAWAAN milik utama");
  pastikan((await db.pengaturanPerusahaan.count({ where: { perusahaanId: "tapussa" } })) === 0, "tapussa belum punya baris pengaturan");
  const tapussa = await ambilPengaturanPerusahaan(db, "tapussa");
  pastikan(tapussa.perusahaanId === "tapussa" && tapussa.nama === "Tapussa Bhallika" && !tapussa.pkp && tapussa.terminHari === PENGATURAN_BAWAAN.terminHari && sama(tapussa.tarifPpnPersen, 11) && sama(tapussa.pphFinalPersen, "0.5"), "tapussa tanpa baris: nama perusahaan, non-PKP, bawaan PPN 11%, termin 14, PPh Final 0,5%");
  pastikan(
    tapussa.akunPpnKeluaranId === barisDefault.akunPpnKeluaranId && tapussa.akunPpnMasukanId === barisDefault.akunPpnMasukanId && tapussa.akunPph23DimukaId === barisDefault.akunPph23DimukaId && tapussa.akunPph23DipotongId === barisDefault.akunPph23DipotongId && tapussa.akunBebanPphFinalId === barisDefault.akunBebanPphFinalId && tapussa.akunHutangPphFinalId === barisDefault.akunHutangPphFinalId,
    "tapussa tanpa baris: enam akun pajak = akun baris default",
  );
  pastikan(tapussa.tahunBuku === utamaTanpaArg.tahunBuku, "tahun buku global dari baris default");
  await harusDitolak("pengaturan perusahaan yang tidak ada", () => ambilPengaturanPerusahaan(db, "tidak-ada"), "Perusahaan tidak ditemukan");
  await db.pengaturanPerusahaan.create({
    data: {
      id: idPengaturan(U),
      perusahaanId: U,
      nama: pt.nama,
      terminHari: 30,
      pphFinalPersen: 0.5,
      tahunBuku: 1999, // kolom global: harus diabaikan untuk perusahaan selain utama
      akunBebanPphFinalId: barisDefault.akunBebanPphFinalId,
      akunHutangPphFinalId: barisDefault.akunHutangPphFinalId,
    },
  });
  const pengaturanU = await ambilPengaturanPerusahaan(db, U);
  pastikan(pengaturanU.perusahaanId === U && pengaturanU.terminHari === 30 && pengaturanU.tahunBuku === utamaTanpaArg.tahunBuku, "perusahaan uji dengan baris: termin 30, tahun buku tetap global");
  pastikan(JSON.stringify(await ambilPengaturanPerusahaan()) === JSON.stringify(utamaTanpaArg), "baris perusahaan lain tidak mengubah pengaturan utama");

  console.log("=== 7. Faktor DPP keuangan proyek dari pengaturan perusahaan proyek ===");
  pastikan(sama(muatFaktor(await muatMasukanKeuangan(db, [proyekU.id]), proyekU.id), 1), "perusahaan uji non-PKP: faktor DPP 1");
  await db.pengaturanPerusahaan.update({ where: { id: idPengaturan(U) }, data: { pkp: true, tarifPpnPersen: 11 } });
  pastikan(sama(muatFaktor(await muatMasukanKeuangan(db, [proyekU.id]), proyekU.id), D(100).div(111)), "perusahaan uji PKP 11%: faktor DPP 100/111");
  await db.pengaturanPerusahaan.update({ where: { id: idPengaturan(U) }, data: { pkp: false } });
  const faktorUtama = muatFaktor(await muatMasukanKeuangan(db, [proyekUt.id]), proyekUt.id);
  pastikan(sama(faktorUtama, utamaTanpaArg.pkp ? D(100).div(D(100).plus(utamaTanpaArg.tarifPpnPersen)) : 1), "proyek utama: faktor DPP dari baris default");

  console.log("=== 8. Penggajian per perusahaan (D1 §9.1 kasus 10) ===");
  pastikan(kunciPeriodeGaji(PERUSAHAAN_UTAMA, "2026-11") === "2026-11" && kunciPeriodeGaji(U, "2026-11") === `2026-11@${U}` && kunciPeriodeGajiSdm === kunciPeriodeGaji, "kunciPeriodeGaji (perusahaanId, bulan), diekspor juga dari sdm.ts");
  const barisGaji = (k: { id: string }, pokok: number) => [{ karyawanId: k.id, gajiPokok: pokok, tunjangan: 0, potongan: 0 }];
  await dengan({}, () => jalankan("penggajian utama", () => buatPenggajian(formulir({ periode: PERIODE_GAJI, akunKasId: kasUt.id, baris: barisGaji(karyawanUt, 1_500_000) }))));
  await dengan({ perusahaan: U }, () => jalankan("penggajian perusahaan uji bulan yang sama", () => buatPenggajian(formulir({ periode: PERIODE_GAJI, akunKasId: kasU.id, proyekId: proyekU.id, baris: barisGaji(karyawanU, 2_000_000) }))));
  const gajiUt = await db.penggajian.findUniqueOrThrow({ where: { periode: PERIODE_GAJI }, include: { jurnal: true } });
  const gajiU = await db.penggajian.findUniqueOrThrow({ where: { perusahaanId_bulan: { perusahaanId: U, bulan: PERIODE_GAJI } }, include: { jurnal: { include: { baris: true } } } });
  nomorLog.push(gajiUt.nomor, gajiU.nomor);
  pastikan(gajiUt.perusahaanId === "utama" && gajiUt.bulan === PERIODE_GAJI && gajiUt.jurnal?.perusahaanId === "utama", "findUnique({ periode }) tetap menemukan penggajian utama (kompatibilitas uji lama)");
  pastikan(gajiU.periode === `${PERIODE_GAJI}@${U}` && gajiU.bulan === PERIODE_GAJI && gajiU.perusahaanId === U && gajiU.proyekId === proyekU.id, "penggajian perusahaan uji: periode berkunci, bulan, perusahaan, proyek");
  pastikan(gajiU.jurnal?.perusahaanId === U && gajiU.jurnal.keterangan === `Penggajian ${PERIODE_GAJI}` && gajiU.jurnal.baris.every((b) => !b.keterangan?.includes("@")), "jurnal gaji milik perusahaan uji, keterangan memakai bulan tanpa kunci internal");
  await dengan({ perusahaan: U }, () => harusDitolak("penggajian ganda di perusahaan uji", () => buatPenggajian(formulir({ periode: PERIODE_GAJI, akunKasId: kasU.id, baris: barisGaji(karyawanU, 100) })), `Penggajian periode ${PERIODE_GAJI} sudah diproses`));
  await dengan({}, () => harusDitolak("penggajian ganda di utama", () => buatPenggajian(formulir({ periode: PERIODE_GAJI, akunKasId: kasUt.id, baris: barisGaji(karyawanUt, 100) })), `Penggajian periode ${PERIODE_GAJI} sudah diproses`));
  const periodeLain = PERIODE_GAJI_GABUNGAN;
  await dengan({ perusahaan: U }, () => harusDitolak("karyawan utama di penggajian perusahaan uji", () => buatPenggajian(formulir({ periode: periodeLain, akunKasId: kasU.id, baris: barisGaji(karyawanUt, 100) })), `Karyawan ${KODE}-KRY-UT - Karyawan Uji Utama terdaftar di ${namaUtama}, bukan ${pt.nama}`));
  await dengan({ perusahaan: U }, () => harusDitolak("akun kas milik utama di penggajian perusahaan uji", () => buatPenggajian(formulir({ periode: periodeLain, akunKasId: kasUt.id, baris: barisGaji(karyawanU, 100) })), `Akun ${KODE}-KAS-UT Kas Uji Utama milik ${namaUtama}`));
  await dengan({ perusahaan: U }, () => harusDitolak("proyek utama di penggajian perusahaan uji", () => buatPenggajian(formulir({ periode: periodeLain, akunKasId: kasU.id, proyekId: proyekUt.id, baris: barisGaji(karyawanU, 100) })), `Proyek ${KODE}-PRJ-UT milik ${namaUtama}`));
  await dengan({ perusahaan: "semua" }, () => harusDitolak("gabungan dengan karyawan dua perusahaan", () => buatPenggajian(formulir({ periode: periodeLain, akunKasId: kasBersama.id, baris: [...barisGaji(karyawanU, 100), ...barisGaji(karyawanUt, 100)] })), "Satu penggajian hanya untuk karyawan satu perusahaan"));
  await dengan({ perusahaan: "semua" }, () => jalankan("gabungan tanpa isian: perusahaan dari karyawan", () => buatPenggajian(formulir({ periode: periodeLain, akunKasId: kasBersama.id, baris: barisGaji(karyawanU, 100_000) }))));
  const gajiGabungan = await db.penggajian.findUniqueOrThrow({ where: { perusahaanId_bulan: { perusahaanId: U, bulan: periodeLain } }, include: { jurnal: true } });
  nomorLog.push(gajiGabungan.nomor);
  pastikan(gajiGabungan.perusahaanId === U && gajiGabungan.jurnal?.perusahaanId === U && (await db.penggajian.count({ where: { bulan: periodeLain } })) === 1, "penggajian gabungan masuk perusahaan karyawan, jurnalnya juga");
  await dengan({ perusahaan: "semua" }, () => harusDitolak("gabungan dengan isian perusahaan: aturan biasa", () => buatPenggajian(formulir({ periode: periodeLain, perusahaanId: U, akunKasId: kasU.id, baris: barisGaji(karyawanU, 100) })), "sudah diproses"));
  await jalankan("hapus penggajian gabungan", () => hapusDokumen("penggajian", gajiGabungan.id));

  console.log("=== 9. PPh Final per perusahaan (D1 §9.1 kasus 11) ===");
  const omzetU = 2_000_000;
  const jurnalOmzet = await db.jurnal.create({
    data: {
      nomor: `${KODE}-JU-OMZET`,
      tanggal: sekarang,
      keterangan: "Omzet uji perusahaan",
      sumber: "MANUAL",
      perusahaanId: U,
      baris: {
        create: [
          { akunId: kasU.id, debit: omzetU, kredit: 0 },
          { akunId: (await db.akun.findUniqueOrThrow({ where: { kode: "4-1100" } })).id, debit: 0, kredit: omzetU },
        ],
      },
    },
  });
  const pajakU0 = await ringkasanPajak(db, tahun, D("0.5"), U);
  pastikan(sama(pajakU0.bulan[bulan - 1].omzet, omzetU) && sama(pajakU0.bulan[bulan - 1].omzetFaktur, 0) && pajakU0.bulan[bulan - 1].tercatat === null, "ringkasanPajak perusahaan uji: omzet dari jurnalnya saja");
  pastikan(samaRingkasan(await ringkasanPajak(db, tahun, D("0.5"), PERUSAHAAN_UTAMA), pajakUtama0), "ringkasanPajak utama tidak terpengaruh omzet perusahaan uji");
  await dengan({ perusahaan: "semua" }, () => harusDitolak("PPh Final di gabungan tanpa perusahaan", () => catatPphFinal(formulir({ periode: bulanIni })), "Pilih perusahaan untuk dokumen ini"));
  await dengan({ perusahaan: U }, () => jalankan("PPh Final perusahaan uji bulan ini", () => catatPphFinal(formulir({ periode: bulanIni }))));
  const pphU = await db.pphFinalBulanan.findUniqueOrThrow({ where: { perusahaanId_periode: { perusahaanId: U, periode: bulanIni } }, include: { jurnal: true } });
  nomorLog.push(pphU.jurnal!.nomor);
  pastikan(sama(pphU.omzet, omzetU) && sama(pphU.jumlah, 10_000) && pphU.jurnal?.perusahaanId === U && pphU.jurnal.nomor.startsWith("JU-PPHF"), "PPh Final perusahaan uji: 0,5% x 2.000.000 = 10.000, jurnal milik perusahaan uji");
  const pajakU1 = await ringkasanPajak(db, tahun, D("0.5"), U);
  const tercatatU = pajakU1.bulan[bulan - 1].tercatat;
  pastikan(tercatatU?.id === pphU.id && sama(tercatatU.jumlah, 10_000) && tercatatU.jumlahCatatan === 1 && tercatatU.nomorJurnal === pphU.jurnal!.nomor, "ringkasanPajak perusahaan uji: catatan tunggal dengan nomor jurnal");
  pastikan(samaRingkasan(await ringkasanPajak(db, tahun, D("0.5"), PERUSAHAAN_UTAMA), pajakUtama0), "ringkasanPajak utama tetap sama setelah PPh Final perusahaan uji");
  const gabungan = await ringkasanPajak(db, tahun, D("0.5"));
  const bulanUtama = pajakUtama0.bulan[bulan - 1], bulanGab = gabungan.bulan[bulan - 1];
  pastikan(sama(bulanGab.omzet, bulanUtama.omzet.plus(omzetU)), "gabungan: omzet = utama + perusahaan uji");
  pastikan(
    bulanUtama.tercatat
      ? bulanGab.tercatat?.jumlahCatatan === 2 && bulanGab.tercatat.nomorJurnal === null && sama(bulanGab.tercatat.jumlah, bulanUtama.tercatat.jumlah.plus(10_000))
      : bulanGab.tercatat?.jumlahCatatan === 1 && bulanGab.tercatat.nomorJurnal === pphU.jurnal!.nomor,
    `gabungan: catatan PPh Final per periode dijumlah (${bulanGab.tercatat?.jumlahCatatan} catatan)`,
  );
  await dengan({ perusahaan: U }, () => harusDitolak("PPh Final ganda di perusahaan uji", () => catatPphFinal(formulir({ periode: bulanIni })), `PPh Final periode ${bulanIni} sudah dicatat`));
  await dengan({ perusahaan: "semua" }, () => harusDitolak("PPh Final gabungan dengan isian perusahaan uji", () => catatPphFinal(formulir({ periode: bulanIni, perusahaanId: U })), "sudah dicatat"));
  pastikan(!(await db.pphFinalBulanan.findMany({ where: { periode: bulanIni } })).some((p) => p.perusahaanId !== U && p.perusahaanId !== "utama"), "tidak ada catatan PPh Final di perusahaan lain");
  // akun PPh Final milik perusahaan lain ditolak sebelum jurnal dibuat
  await db.pengaturanPerusahaan.update({ where: { id: idPengaturan(U) }, data: { akunBebanPphFinalId: bebanUt.id } });
  const bulanLalu = new Date(tahun, bulan - 2, 15);
  const periodeLalu = `${bulanLalu.getFullYear()}-${String(bulanLalu.getMonth() + 1).padStart(2, "0")}`;
  await dengan({ perusahaan: U }, () => harusDitolak("akun beban PPh Final milik utama", () => catatPphFinal(formulir({ periode: periodeLalu })), `Akun ${KODE}-BEBAN-UT Beban Uji Utama milik ${namaUtama}`));
  await db.pengaturanPerusahaan.update({ where: { id: idPengaturan(U) }, data: { akunBebanPphFinalId: barisDefault.akunBebanPphFinalId } });
  await jalankan("hapus PPh Final perusahaan uji", () => hapusDokumen("pphFinal", pphU.id));
  await hapusJurnalLangsung([jurnalOmzet.id]);

  console.log("=== 10. Akun dan saldo antar perusahaan (D1 §3.1, §4.6) ===");
  const peta = await db.pemetaanAkunTambahan.findMany({ where: { kunci: { in: ["piutang-antar-perusahaan", "hutang-antar-perusahaan"] } } });
  const standarAda = (await db.akun.count({ where: { kode: { in: ["1-1750", "2-1550"] } } })) > 0;
  if (peta.length === 0 && !standarAda) {
    const kosong = await akunAntarPerusahaan(db);
    const saldoKosong = await saldoAntarPerusahaan(db, sekarang);
    pastikan(kosong.piutang === null && kosong.hutang === null && saldoKosong.akunPiutang === null && saldoKosong.selisih.isZero(), "tanpa pemetaan dan akun standar: null dan saldo nol");
  }
  const pap = await akunBaru("PAP", "Piutang Antar Perusahaan Uji", "ASET", null);
  const hap = await akunBaru("HAP", "Hutang Antar Perusahaan Uji", "KEWAJIBAN", null);
  const petaLama = new Map(peta.map((p) => [p.kunci, p.akunId]));
  for (const [kunci, akun] of [["piutang-antar-perusahaan", pap], ["hutang-antar-perusahaan", hap]] as const) {
    await db.pemetaanAkunTambahan.upsert({ where: { kunci }, create: { kunci, label: kunci, akunId: akun.id, dibuatOleh: "uji-perusahaan" }, update: { akunId: akun.id } });
  }
  try {
    const akunAp = await akunAntarPerusahaan(db);
    pastikan(akunAp.piutang?.id === pap.id && akunAp.hutang?.id === hap.id, "akunAntarPerusahaan: pemetaan tambahan didahulukan");
    const awal = await saldoAntarPerusahaan(db, sekarang);
    pastikan(awal.piutang.isZero() && awal.hutang.isZero() && awal.selisih.isZero() && awal.akunPiutang === `${KODE}-PAP Piutang Antar Perusahaan Uji`, "saldo awal nol, label kode dan nama");
    const kemarin = new Date(sekarang.getTime() - 24 * 60 * 60 * 1000), besok = new Date(sekarang.getTime() + 24 * 60 * 60 * 1000);
    const jurnalAp = async (nomor: string, tanggal: Date, perusahaanId: string, debit: string, kredit: string, nilai: number) =>
      db.jurnal.create({ data: { nomor: `${KODE}-${nomor}`, tanggal, keterangan: "Antar perusahaan uji", sumber: "MANUAL", perusahaanId, baris: { create: [{ akunId: debit, debit: nilai, kredit: 0 }, { akunId: kredit, debit: 0, kredit: nilai }] } } });
    await jurnalAp("AP-1", kemarin, PERUSAHAAN_UTAMA, pap.id, kasUt.id, 300_000);
    await jurnalAp("AP-2", kemarin, U, bebanUt.id, hap.id, 300_000);
    const seimbang = await saldoAntarPerusahaan(db, sekarang);
    pastikan(sama(seimbang.piutang, 300_000) && sama(seimbang.hutang, 300_000) && seimbang.selisih.isZero(), "TAGIH dicatat di kedua sisi: piutang = hutang = 300.000, selisih 0");
    await jurnalAp("AP-3", besok, PERUSAHAAN_UTAMA, pap.id, kasUt.id, 50_000);
    pastikan((await saldoAntarPerusahaan(db, sekarang)).selisih.isZero() && sama((await saldoAntarPerusahaan(db, besok)).selisih, 50_000), "jurnal sesudah tanggal batas tidak dihitung; satu sisi menghasilkan selisih");
    pastikan((await saldoAntarPerusahaan(db, new Date(kemarin.getTime() - 24 * 60 * 60 * 1000))).piutang.isZero(), "sebelum transaksi: nol");
  } finally {
    for (const kunci of ["piutang-antar-perusahaan", "hutang-antar-perusahaan"]) {
      const lama = petaLama.get(kunci);
      if (lama) await db.pemetaanAkunTambahan.update({ where: { kunci }, data: { akunId: lama } });
      else await db.pemetaanAkunTambahan.deleteMany({ where: { kunci } });
    }
  }

  console.log("=== 11. LPJ: sumber beban lain ===");
  const lpj0 = await ringkasanProyek(db, proyekU.id);
  pastikan(lpj0 !== null && lpj0.pengeluaran.totalBebanLain.isZero(), "proyek uji dengan jurnal gaji saja: beban lain 0");
  for (const [i, sumber] of (["ANTAR_PERUSAHAAN", "MITRA_PROYEK", "PENJUALAN"] as const).entries()) {
    await db.jurnal.create({ data: { nomor: `${KODE}-LPJ-${i}`, tanggal: sekarang, keterangan: `Beban ${sumber}`, sumber, perusahaanId: U, proyekId: proyekU.id, baris: { create: [{ akunId: bebanUt.id, debit: 1000 * (i + 1), kredit: 0 }, { akunId: kasU.id, debit: 0, kredit: 1000 * (i + 1) }] } } });
  }
  const lpj1 = await ringkasanProyek(db, proyekU.id);
  pastikan(sama(lpj1!.pengeluaran.totalBebanLain, 3000) && lpj1!.pengeluaran.bebanLain.length === 2 && sama(lpj1!.labaRugi.totalBeban.minus(lpj0!.labaRugi.totalBeban), 6000), "beban ANTAR_PERUSAHAAN dan MITRA_PROYEK tampil sebagai beban lain; PENJUALAN tidak (tetap masuk laba rugi)");

  console.log("=== 12. Bersih-bersih ===");
  await bersihkanData();
  pastikan((await db.perusahaan.count({ where: { kode: KODE } })) === 0 && (await db.akun.count({ where: { kode: { startsWith: `${KODE}-` } } })) === 0 && (await db.karyawan.count({ where: { kode: { startsWith: `${KODE}-` } } })) === 0, "perusahaan, akun, dan karyawan uji terhapus");
  pastikan((await db.jurnal.count()) === jumlahJurnalAwal, "jumlah jurnal kembali ke awal");
  pastikan((await db.hakAksesPeran.count()) === awalHakAksesPeran, "tidak ada baris HakAksesPeran baru");
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron sama dengan sebelum uji");
  pastikan(samaRingkasan(await ringkasanPajak(db, tahun, D("0.5"), PERUSAHAAN_UTAMA), pajakUtama0), "ringkasanPajak utama sama dengan sebelum uji");
  console.log("=== DONE, all perusahaan checks passed ===");
}

function muatFaktor(peta: Awaited<ReturnType<typeof muatMasukanKeuangan>>, proyekId: string) {
  const m = peta.get(proyekId);
  if (!m) throw new Error(`masukan keuangan ${proyekId} tidak ada`);
  return m.faktorDppUangMuka;
}

/** Ringkasan pajak sama per bulan: omzet, omzet faktur, PPN, PPh 23, dan catatan PPh Final. */
function samaRingkasan(a: RingkasanPajak, b: RingkasanPajak): boolean {
  return a.bulan.every((x, i) => {
    const y = b.bulan[i];
    return (
      sama(x.omzet, y.omzet) && sama(x.omzetFaktur, y.omzetFaktur) && sama(x.ppnKeluaran, y.ppnKeluaran) && sama(x.ppnMasukan, y.ppnMasukan) &&
      sama(x.pph23DipotongKlien, y.pph23DipotongKlien) && sama(x.pph23KitaPotong, y.pph23KitaPotong) &&
      x.tercatat?.id === y.tercatat?.id && sama(x.tercatat?.jumlah, y.tercatat?.jumlah) && x.tercatat?.nomorJurnal === y.tercatat?.nomorJurnal
    );
  });
}

main()
  .catch(async (galat) => {
    console.error(galat);
    await bersihkanData().catch((e) => console.error("bersih-bersih gagal", e));
    process.exit(1);
  })
  .finally(() => db.$disconnect());
