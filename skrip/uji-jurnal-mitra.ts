import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import type { PrismaClient } from "../src/prisma-klien/client";
import { D } from "../src/lib/uang";
import { periksaSinkron } from "../src/lib/sinkron";
import { BERKAS } from "../src/lib/persetujuan";
import { tautanDokumenPersetujuan } from "../src/lib/notifikasiPersetujuan";
import { postingPembayaranMitra, postingTalanganMitra, sisaModalMitra } from "../src/lib/jurnalMitra";
import { ajukanDokumen, setujuiDokumen, tolakDokumen } from "../src/lib/aksi/persetujuan";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { harusDitolak, jalankan, pastikan, sebagai } from "./bantuan";

/*
 * Uji jurnal dan persetujuan dokumen mitra proyek (P33, D5 §3.10, §3.11, §4.1 sampai §4.6):
 *  1. BERKAS talanganMitra dan pembayaranMitra; data seed: periksaSinkron memuat hutangMitra nol dan cocok.
 *  2. Talangan diposting lewat BERKAS.posting: jurnal JU-TLM bersumber MITRA_PROYEK, milik perusahaan proyek
 *     (bukan utama), bertanda proyek, Dr beban / Cr 2-1700; posting ulang, perusahaan dokumen beda dari proyek, mitra
 *     proyek lain, dan akun Bagi Hasil sebagai beban talangan ditolak.
 *  3. Alur persetujuan lewat aksi bersama: ajukan (notifikasi ke pemegang talangan-mitra.setujui, bukan pengaju),
 *     setujui (jurnal, notifikasi hasil tanpa tautan karena halaman dokumen belum ada), tolak.
 *  4. Pembayaran MODAL sampai sisa modal, sisa yang dipesan draf, MODAL melebihi sisa ditolak saat disetujui (P-56),
 *     LABA ke 5-1700, hak setujui pembayaran (ADMIN ditolak).
 *  5. hutangMitra sinkron per perusahaan dan gabungan; jurnal manual ke akun hutang mitra membuat selisih (digulung
 *     balik); akun hutang mitra belum ada atau jenisnya salah memberi pesan yang menyebut cara memperbaikinya.
 *  6. hapusDokumen jenis mitra: talangan yang sudah dikembalikan sebagai modal ditolak, pembayaran lalu talangan
 *     dihapus dan jurnalnya dibalik, log HAPUS bermodul bagi-hasil, hak hapus (KASIR dan ADMIN ditolak).
 * Data uji berawalan UJM, dibersihkan di awal dan akhir. periksaSinkron(db) seimbang dan sama di awal dan akhir.
 */

const K = "UJM";
const sama = (a: unknown, b: number | string) => D(a as string).equals(D(b));
const hariIni = () => new Date(new Date().setHours(12, 0, 0, 0));

async function bersihkan() {
  const proyek = (await db.proyek.findMany({ where: { kode: { startsWith: K } }, select: { id: true } })).map((p) => p.id);
  const tlm = await db.talanganMitra.findMany({ where: { OR: [{ proyekId: { in: proyek } }, { nomor: { startsWith: `TLM-${K}` } }] }, select: { id: true, nomor: true, jurnalId: true } });
  const bym = await db.pembayaranMitra.findMany({ where: { OR: [{ proyekId: { in: proyek } }, { nomor: { startsWith: `BYM-${K}` } }] }, select: { id: true, nomor: true, jurnalId: true } });
  const jurnal = [...tlm, ...bym].flatMap((d) => (d.jurnalId ? [d.jurnalId] : []));
  await db.pembayaranMitra.deleteMany({ where: { id: { in: bym.map((d) => d.id) } } });
  await db.talanganMitra.deleteMany({ where: { id: { in: tlm.map((d) => d.id) } } });
  await db.barisJurnal.deleteMany({ where: { OR: [{ jurnalId: { in: jurnal } }, { jurnal: { proyekId: { in: proyek } } }] } });
  await db.jurnal.deleteMany({ where: { OR: [{ id: { in: jurnal } }, { proyekId: { in: proyek } }] } });
  await db.mitraProyek.deleteMany({ where: { proyekId: { in: proyek } } });
  await db.proyek.deleteMany({ where: { id: { in: proyek } } });
  // notifikasi dan log persetujuan atau hapus tetap ada sesudah dokumennya terhapus, jadi dicari lewat awalan nomor
  for (const awal of [`TLM-${K}-`, `BYM-${K}-`]) {
    await db.notifikasi.deleteMany({ where: { judul: { contains: awal } } });
    await db.logAktivitas.deleteMany({ where: { nomor: { startsWith: awal } } });
  }
}

async function main() {
  await bersihkan();
  const mulaiUji = new Date();
  const sinkronAwal = await periksaSinkron(db);
  const jurnalAwal = await db.jurnal.count();
  const akun = async (kode: string) => db.akun.findUniqueOrThrow({ where: { kode } });
  const [kas, hutangMitra, bagiHasil, beban] = await Promise.all([akun("1-1100"), akun("2-1700"), akun("5-1700"), akun("5-1200")]);
  const [owner, admin, kasir] = await Promise.all(["owner", "admin", "kasir"].map((n) => db.pengguna.findUniqueOrThrow({ where: { namaPengguna: n } })));
  const P = "tapussa";
  let nomorKe = 0;
  const nomor = (awalan: "TLM" | "BYM") => `${awalan}-${K}-${String(++nomorKe).padStart(3, "0")}`;

  try {
    console.log("=== 1. Struktur dan data seed ===");
    pastikan(BERKAS.talanganMitra.label === "Talangan Mitra" && BERKAS.talanganMitra.kode === "talangan-mitra", "BERKAS talanganMitra: label dan kode hak");
    pastikan(BERKAS.pembayaranMitra.label === "Pembayaran ke Mitra" && BERKAS.pembayaranMitra.kode === "pembayaran-mitra", "BERKAS pembayaranMitra: label dan kode hak");
    pastikan(tautanDokumenPersetujuan("talanganMitra", "talangan-mitra") === null && tautanDokumenPersetujuan("pembayaranMitra", "pembayaran-mitra") === null, "tautan dokumen mitra null selama halamannya belum ada");
    pastikan(sinkronAwal.seimbang && sinkronAwal.hutangMitra.sinkron && sinkronAwal.hutangMitra.bukuBesar.isZero() && sinkronAwal.hutangMitra.dokumen.isZero(), `periksaSinkron awal seimbang, hutangMitra nol dan cocok (${sinkronAwal.hutangMitra.bukuBesar} / ${sinkronAwal.hutangMitra.dokumen})`);
    const lamaCocok = (["persediaan", "piutang", "hutang", "barangBelumDitagih", "barangTerkirim", "uangMuka"] as const).every((k) => sinkronAwal[k].sinkron);
    pastikan(lamaCocok, "butir sinkron lama tetap cocok");

    const proyek = await db.proyek.create({ data: { kode: `${K}-PRY`, nama: "Proyek Uji Jurnal Mitra", perusahaanId: P } });
    const proyekLain = await db.proyek.create({ data: { kode: `${K}-PRY2`, nama: "Proyek Uji Jurnal Mitra Lain", perusahaanId: P } });
    const mitra = await db.mitraProyek.create({ data: { proyekId: proyek.id, nama: "Mitra Uji A", nilai: 40 } });
    const mitraLain = await db.mitraProyek.create({ data: { proyekId: proyekLain.id, nama: "Mitra Uji Lain", nilai: 10 } });
    const talangan = (jumlah: number, tambahan: Partial<{ perusahaanId: string; mitraId: string; akunBebanId: string; statusPersetujuan: "DRAFT" | "MENUNGGU"; vendor: string }> = {}) =>
      db.talanganMitra.create({
        data: { nomor: nomor("TLM"), tanggal: hariIni(), perusahaanId: P, proyekId: proyek.id, mitraId: mitra.id, akunBebanId: beban.id, jumlah, deskripsi: "Sewa sound", dicatatOlehId: admin.id, dicatatOlehNama: admin.nama, ...tambahan },
      });
    const pembayaran = (jenis: "MODAL" | "LABA", jumlah: number, tambahan: Partial<{ statusPersetujuan: "DRAFT" | "MENUNGGU" | "DITOLAK"; catatan: string }> = {}) =>
      db.pembayaranMitra.create({ data: { nomor: nomor("BYM"), tanggal: hariIni(), perusahaanId: P, proyekId: proyek.id, mitraId: mitra.id, jenis, jumlah, akunKasId: kas.id, dicatatOlehId: admin.id, dicatatOlehNama: admin.nama, ...tambahan } });
    const jurnalDok = async (jurnalId: string | null) => (jurnalId ? db.jurnal.findUniqueOrThrow({ where: { id: jurnalId }, include: { baris: { orderBy: { debit: "desc" } } } }) : null);

    console.log("=== 2. Posting talangan lewat BERKAS ===");
    const t1 = await talangan(1_000_000, { statusPersetujuan: "MENUNGGU", vendor: "PT Suara" });
    await db.$transaction((tx) => BERKAS.talanganMitra.posting(tx, t1.id));
    const t1b = await db.talanganMitra.findUniqueOrThrow({ where: { id: t1.id } });
    const j1 = await jurnalDok(t1b.jurnalId);
    pastikan(
      j1 && j1.perusahaanId === P && j1.proyekId === proyek.id && j1.sumber === "MITRA_PROYEK" && j1.nomor.startsWith("JU-TLM") && j1.keterangan === `Talangan Mitra ${t1.nomor} Mitra Uji A: Sewa sound`,
      `jurnal talangan ${j1?.nomor}: perusahaan proyek (${j1?.perusahaanId}), bertanda proyek, sumber MITRA_PROYEK, keterangan bernomor`,
    );
    pastikan(
      j1!.baris.length === 2 && j1!.baris[0].akunId === beban.id && sama(j1!.baris[0].debit, 1_000_000) && j1!.baris[0].keterangan === "Sewa sound (PT Suara)" && j1!.baris[1].akunId === hutangMitra.id && sama(j1!.baris[1].kredit, 1_000_000) && j1!.baris[1].keterangan === "Hutang ke mitra Mitra Uji A",
      "baris jurnal talangan: Dr beban (uraian dan vendor) / Cr 2-1700 Hutang ke mitra",
    );
    await harusDitolak("posting ulang talangan", () => db.$transaction((tx) => postingTalanganMitra(tx, t1.id)), "sudah dijurnal");
    // dokumen yang statusnya belum disetujui tidak dihitung invarian, jadi t1 dijadikan DISETUJUI seperti sesudah setujui
    await db.talanganMitra.update({ where: { id: t1.id }, data: { statusPersetujuan: "DISETUJUI" } });
    const tBeda = await talangan(10_000, { perusahaanId: "utama", statusPersetujuan: "MENUNGGU" });
    await harusDitolak("talangan berperusahaan beda dari proyek", () => db.$transaction((tx) => postingTalanganMitra(tx, tBeda.id)), "berbeda dari proyek");
    const tMitraLain = await talangan(10_000, { mitraId: mitraLain.id, statusPersetujuan: "MENUNGGU" });
    await harusDitolak("talangan dengan mitra proyek lain", () => db.$transaction((tx) => postingTalanganMitra(tx, tMitraLain.id)), "bukan mitra proyek");
    const tBagi = await talangan(10_000, { akunBebanId: bagiHasil.id, statusPersetujuan: "MENUNGGU" });
    await harusDitolak("talangan ke akun Bagi Hasil Mitra Proyek", () => db.$transaction((tx) => postingTalanganMitra(tx, tBagi.id)), "tidak boleh dipakai untuk talangan");
    for (const d of [tBeda, tMitraLain, tBagi]) await db.talanganMitra.delete({ where: { id: d.id } });
    pastikan((await db.jurnal.count()) === jurnalAwal + 1, "posting yang ditolak tidak meninggalkan jurnal");

    console.log("=== 3. Alur persetujuan talangan lewat aksi bersama ===");
    const t2 = await talangan(500_000);
    await sebagai("admin", () => jalankan("admin mengajukan talangan", () => ajukanDokumen("talanganMitra", t2.id)));
    const notif = (penggunaId: string, judul: string) => db.notifikasi.findMany({ where: { penggunaId, judul, dibuatPada: { gte: mulaiUji } } });
    const judulAjukan = `Persetujuan diminta: Talangan Mitra ${t2.nomor}`;
    const [nOwner, ...lebihOwner] = await notif(owner.id, judulAjukan);
    pastikan(nOwner && !lebihOwner.length && nOwner.tautan === "/persetujuan" && nOwner.perusahaanId === P && nOwner.jenis === "PERSETUJUAN", "pemegang talangan-mitra.setujui (owner) mendapat satu permintaan, tautan /persetujuan, perusahaan dokumen");
    pastikan((await notif(admin.id, judulAjukan)).length === 0 && (await notif(kasir.id, judulAjukan)).length === 0, "pengaju dan KASIR (tanpa hak setujui) tidak mendapat permintaan");
    await sebagai("admin", () => harusDitolak("admin menyetujui talangannya sendiri", () => setujuiDokumen("talanganMitra", t2.id), "tidak boleh menyetujui"));
    await sebagai("owner", () => jalankan("owner menyetujui talangan", () => setujuiDokumen("talanganMitra", t2.id)));
    const t2b = await db.talanganMitra.findUniqueOrThrow({ where: { id: t2.id } });
    const j2 = await jurnalDok(t2b.jurnalId);
    pastikan(t2b.statusPersetujuan === "DISETUJUI" && t2b.disetujuiOlehId === owner.id && j2?.perusahaanId === P && sama(j2.baris[0].debit, 500_000), "talangan disetujui: jurnal milik perusahaan proyek");
    const [nHasil] = await notif(admin.id, `Talangan Mitra ${t2.nomor} disetujui`);
    pastikan(nHasil?.jenis === "HASIL_PERSETUJUAN" && nHasil.tautan === null && nHasil.isi === `Disetujui oleh ${owner.nama}`, "pengaju mendapat hasil persetujuan tanpa tautan");
    const logSetuju = await db.logAktivitas.findFirst({ where: { nomor: t2.nomor, aksi: "SETUJUI" } });
    pastikan(logSetuju?.keterangan?.includes(`Mitra Uji A, 500.000, proyek ${proyek.kode}`), `log setujui memuat ringkasan (${logSetuju?.keterangan})`);
    const t3 = await talangan(70_000);
    await sebagai("admin", () => jalankan("admin mengajukan talangan kedua", () => ajukanDokumen("talanganMitra", t3.id)));
    await sebagai("owner", () => jalankan("owner menolak talangan kedua", () => tolakDokumen("talanganMitra", t3.id, "Bukti belum ada")));
    pastikan((await db.talanganMitra.findUniqueOrThrow({ where: { id: t3.id } })).statusPersetujuan === "DITOLAK" && (await db.talanganMitra.findUniqueOrThrow({ where: { id: t3.id } })).jurnalId === null, "talangan ditolak tanpa jurnal");

    console.log("=== 4. Pembayaran ke mitra ===");
    pastikan(sama(await sisaModalMitra(db, mitra.id, { hanyaDisetujui: true }), 1_500_000), "sisa modal = talangan disetujui 1.500.000 (yang ditolak tidak dihitung)");
    const b1 = await pembayaran("MODAL", 1_000_000, { catatan: "TRF 001" });
    await sebagai("admin", () => jalankan("admin mengajukan pengembalian modal", () => ajukanDokumen("pembayaranMitra", b1.id)));
    await sebagai("admin", () => harusDitolak("ADMIN tanpa pembayaran-mitra.setujui", () => setujuiDokumen("pembayaranMitra", b1.id), "Pembayaran ke Mitra"));
    pastikan(sama(await sisaModalMitra(db, mitra.id, { hanyaDisetujui: false }), 500_000) && sama(await sisaModalMitra(db, mitra.id, { hanyaDisetujui: true }), 1_500_000), "draf pengembalian memesan sisa (500.000), sisa disetujui tetap 1.500.000");
    pastikan(sama(await sisaModalMitra(db, mitra.id, { hanyaDisetujui: false, kecualiPembayaranId: b1.id }), 1_500_000), "kecualiPembayaranId mengecualikan dokumen itu");
    await sebagai("owner", () => jalankan("owner menyetujui pengembalian modal", () => setujuiDokumen("pembayaranMitra", b1.id)));
    const j3 = await jurnalDok((await db.pembayaranMitra.findUniqueOrThrow({ where: { id: b1.id } })).jurnalId);
    pastikan(
      j3 && j3.nomor.startsWith("JU-BYM") && j3.perusahaanId === P && j3.proyekId === proyek.id && j3.keterangan === `Pembayaran ke Mitra ${b1.nomor} Mitra Uji A (pengembalian modal)` && j3.baris[0].akunId === hutangMitra.id && j3.baris[0].keterangan === "Pengembalian modal Mitra Uji A" && j3.baris[1].akunId === kas.id && j3.baris[1].keterangan === "Bayar Mitra Uji A: TRF 001",
      "jurnal pengembalian modal: Dr 2-1700 / Cr kas, keterangan D5",
    );
    const b2 = await pembayaran("MODAL", 600_000);
    await sebagai("admin", () => jalankan("admin mengajukan pengembalian modal melebihi sisa", () => ajukanDokumen("pembayaranMitra", b2.id)));
    await sebagai("owner", () => harusDitolak("pengembalian modal 600.000 melebihi sisa 500.000", () => setujuiDokumen("pembayaranMitra", b2.id), "Pengembalian modal melebihi sisa modal Mitra Uji A (Rp 500.000). Kelebihannya catat sebagai bagi laba"));
    const b2b = await db.pembayaranMitra.findUniqueOrThrow({ where: { id: b2.id } });
    pastikan(b2b.statusPersetujuan === "MENUNGGU" && b2b.jurnalId === null, "pengembalian yang ditolak tetap MENUNGGU tanpa jurnal");
    await sebagai("owner", () => jalankan("owner menolak pengembalian berlebih", () => tolakDokumen("pembayaranMitra", b2.id, "Melebihi sisa modal")));
    const b3 = await pembayaran("LABA", 250_000, { statusPersetujuan: "MENUNGGU" });
    await db.$transaction((tx) => postingPembayaranMitra(tx, b3.id));
    await db.pembayaranMitra.update({ where: { id: b3.id }, data: { statusPersetujuan: "DISETUJUI" } });
    const j4 = await jurnalDok((await db.pembayaranMitra.findUniqueOrThrow({ where: { id: b3.id } })).jurnalId);
    pastikan(j4 && !!j4.keterangan?.endsWith("(bagi laba)") && j4.baris[0].akunId === bagiHasil.id && sama(j4.baris[0].debit, 250_000) && j4.baris[1].akunId === kas.id, "bagi laba: Dr 5-1700 Bagi Hasil Mitra Proyek / Cr kas, tidak dibatasi sisa modal");

    console.log("=== 5. Invarian hutangMitra ===");
    const s1 = await periksaSinkron(db);
    pastikan(s1.seimbang && s1.hutangMitra.sinkron && sama(s1.hutangMitra.bukuBesar, 500_000) && sama(s1.hutangMitra.dokumen, 500_000), `gabungan: hutang mitra 1.500.000 - 1.000.000 = 500.000 cocok (${s1.hutangMitra.bukuBesar} / ${s1.hutangMitra.dokumen})`);
    const sP = await periksaSinkron(db, { perusahaanId: P });
    const sU = await periksaSinkron(db, { perusahaanId: "utama" });
    pastikan(sP.hutangMitra.sinkron && sama(sP.hutangMitra.dokumen, 500_000) && sU.hutangMitra.sinkron && sU.hutangMitra.dokumen.isZero() && sU.hutangMitra.bukuBesar.isZero(), "lingkup: hutang mitra di perusahaan proyek, utama nol");
    const GULUNG = "gulung balik uji";
    const gulung = async (kerja: (tx: PrismaClient) => Promise<void>) => {
      try {
        await db.$transaction(async (tx) => {
          await kerja(tx as unknown as PrismaClient);
          throw new Error(GULUNG);
        });
      } catch (e) {
        if ((e as Error).message !== GULUNG) throw e;
      }
    };
    await gulung(async (tx) => {
      await tx.jurnal.create({
        data: {
          nomor: `JU-${K}-MANUAL`, tanggal: hariIni(), keterangan: "Jurnal manual uji ke hutang mitra", sumber: "MANUAL", perusahaanId: P, statusPersetujuan: "DISETUJUI",
          baris: { create: [{ akunId: kas.id, debit: 100_000, kredit: 0, keterangan: "uji" }, { akunId: hutangMitra.id, debit: 0, kredit: 100_000, keterangan: "uji" }] },
        },
      });
      const s = await periksaSinkron(tx);
      pastikan(!s.hutangMitra.sinkron && sama(s.hutangMitra.selisih, 100_000) && s.seimbang, `jurnal manual ke akun hutang mitra membuat selisih 100.000 (${s.hutangMitra.selisih})`);
    });
    pastikan((await periksaSinkron(db)).hutangMitra.sinkron, "sesudah digulung balik hutangMitra cocok lagi");
    const tAkun = await talangan(10_000, { statusPersetujuan: "MENUNGGU" });
    await gulung(async (tx) => {
      await tx.pemetaanAkunTambahan.deleteMany({ where: { kunci: "hutang-mitra-proyek" } });
      await tx.akun.update({ where: { id: hutangMitra.id }, data: { kode: `2-1700-${K}` } });
      const s = await periksaSinkron(tx);
      pastikan(s.hutangMitra.sinkron && s.hutangMitra.bukuBesar.isZero() && s.hutangMitra.dokumen.isZero(), "tanpa akun Hutang Mitra Proyek: hutangMitra kosong (0 = 0)");
      const pesan = await postingTalanganMitra(tx as never, tAkun.id).then(() => "lolos", (e: Error) => e.message);
      pastikan(pesan.startsWith("Akun Hutang Mitra Proyek belum ada. Terapkan Bagan Akun Standar (akun 2-1700)"), `posting tanpa akun hutang mitra: ${pesan}`);
      await tx.pemetaanAkunTambahan.create({ data: { kunci: "hutang-mitra-proyek", label: "Hutang Mitra Proyek", akunId: kas.id, dibuatOleh: "Skrip Uji" } });
      const pesanSalah = await postingTalanganMitra(tx as never, tAkun.id).then(() => "lolos", (e: Error) => e.message);
      pastikan(pesanSalah === "Akun 1-1100 tidak bisa dipakai sebagai Hutang Mitra Proyek: harus akun Kewajiban rinci", `pemetaan ke akun ASET: ${pesanSalah}`);
    });
    await db.talanganMitra.delete({ where: { id: tAkun.id } });

    console.log("=== 6. Hapus dokumen mitra ===");
    await sebagai("kasir", () => harusDitolak("KASIR hapus talangan", () => hapusDokumen("talanganMitra", t2.id), "Talangan Mitra"));
    await sebagai("admin", () => harusDitolak("ADMIN hapus pembayaran (tanpa pembayaran-mitra.hapus)", () => hapusDokumen("pembayaranMitra", b1.id), "Pembayaran ke Mitra"));
    await jalankan("hapus talangan 500.000 (sisa modal tetap 0)", () => hapusDokumen("talanganMitra", t2.id));
    pastikan((await db.jurnal.count({ where: { id: t2b.jurnalId! } })) === 0, "jurnal talangan ikut dihapus");
    await harusDitolak("hapus talangan yang sudah dikembalikan sebagai modal", () => hapusDokumen("talanganMitra", t1.id), `${t1.nomor} sudah dikembalikan sebagai modal ke Mitra Uji A lewat ${b1.nomor}. Hapus pengembalian modalnya dulu`);
    pastikan((await periksaSinkron(db)).hutangMitra.sinkron, "hutangMitra cocok sesudah hapus talangan");
    await jalankan("hapus pengembalian modal", () => hapusDokumen("pembayaranMitra", b1.id));
    await jalankan("hapus talangan pertama", () => hapusDokumen("talanganMitra", t1.id));
    await jalankan("hapus bagi laba", () => hapusDokumen("pembayaranMitra", b3.id));
    await jalankan("hapus draf talangan ditolak", () => hapusDokumen("talanganMitra", t3.id));
    await jalankan("hapus pengembalian ditolak", () => hapusDokumen("pembayaranMitra", b2.id));
    const logHapus = await db.logAktivitas.findMany({ where: { aksi: "HAPUS", nomor: { in: [t1.nomor, t2.nomor, t3.nomor, b1.nomor, b2.nomor, b3.nomor] }, waktu: { gte: mulaiUji } } });
    pastikan(logHapus.length === 6 && logHapus.every((l) => l.modul === "bagi-hasil" && l.perusahaanId === P && !!l.entitasId), "enam log HAPUS bermodul bagi-hasil dengan perusahaan dan entitas");
    pastikan(logHapus.find((l) => l.nomor === t1.nomor)?.keterangan === "Talangan 1.000.000 dari Mitra Uji A dibatalkan; beban dan hutang mitra dibalik", "keterangan hapus talangan");
    pastikan(logHapus.find((l) => l.nomor === b1.nomor)?.keterangan === "Pembayaran modal 1.000.000 ke Mitra Uji A dibatalkan; kas dan hutang mitra dibalik", "keterangan hapus pengembalian modal");
    pastikan(logHapus.find((l) => l.nomor === t3.nomor)?.keterangan === "Draf talangan dihapus (status DITOLAK); belum ada jurnal", "keterangan hapus draf");
    pastikan((await db.talanganMitra.count({ where: { proyekId: proyek.id } })) + (await db.pembayaranMitra.count({ where: { proyekId: proyek.id } })) === 0, "semua dokumen mitra uji terhapus");
    pastikan((await db.jurnal.count()) === jurnalAwal, "jumlah jurnal kembali seperti awal");
  } finally {
    await bersihkan();
  }
  const sinkronAkhir = await periksaSinkron(db);
  pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron seimbang dan sama dengan sebelum uji");
  pastikan((await db.notifikasi.count({ where: { dibuatPada: { gte: mulaiUji }, judul: { contains: `-${K}-` } } })) === 0, "notifikasi uji dibersihkan");
  pastikan((await db.logAktivitas.count({ where: { OR: [{ nomor: { startsWith: `TLM-${K}-` } }, { nomor: { startsWith: `BYM-${K}-` } }] } })) === 0, "log uji dibersihkan");
  console.log("=== DONE, all jurnal-mitra checks passed ===");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
