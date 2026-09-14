import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { periksaSinkron } from "../src/lib/sinkron";
import { akunGajiBawaan } from "../src/lib/sdm";
import { buatPenggajian } from "../src/lib/aksi/sdm";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { hitungLabaRugi, bacaPeriode } from "../src/lib/laporan";
import { hitungArusKas } from "../src/lib/arusKas";
import { labaRugiKas } from "../src/lib/basisKas";
import { jalankan, formulir, pastikan, harusDitolak } from "./bantuan";

/*
 * Siklus SDM/Penggajian: proses gaji satu periode untuk beberapa karyawan (gaji pokok, tunjangan,
 * potongan), jurnal Dr Beban Gaji Pokok + Tunjangan / Cr Hutang Potongan / Cr Kas-Bank, dan terhubung
 * otomatis ke Laba Rugi (akrual & kas), Arus Kas, dan periksaSinkron tanpa kode tambahan di laporan itu.
 */
const n = (v: { toString(): string }) => Number(v);
const dekat = (a: number, b: number) => Math.abs(a - b) < 0.01;
async function saldo(akunId: string) {
  const agg = await db.barisJurnal.aggregate({ where: { akunId }, _sum: { debit: true, kredit: true } });
  return n(agg._sum.debit ?? 0) - n(agg._sum.kredit ?? 0);
}

async function main() {
  const tag = Date.now();
  const sinkronAwal = await periksaSinkron(db);
  pastikan(sinkronAwal.seimbang, "buku besar seimbang sebelum uji");

  const gaji = await akunGajiBawaan(db);
  pastikan(gaji.bebanGaji?.kode === "5-2100", `akun Beban Gaji bawaan = 5-2100 (${gaji.bebanGaji?.kode})`);
  pastikan(gaji.bebanTunjangan?.kode === "5-2500", `akun Beban Tunjangan bawaan = 5-2500 (${gaji.bebanTunjangan?.kode})`);
  pastikan(gaji.hutangPotongan?.kode === "2-1310", `akun Hutang Potongan bawaan = 2-1310 (${gaji.hutangPotongan?.kode})`);

  const [kas, dept] = await Promise.all([
    db.akun.findFirstOrThrow({ where: { kasBank: true, kelompok: false }, orderBy: { kode: "asc" } }),
    db.departemen.create({ data: { nama: `Dept Uji ${tag}` } }),
  ]);
  const upahHarian = await db.akun.findUniqueOrThrow({ where: { kode: "5-2200" } }); // Upah Harian
  const andi = await db.karyawan.create({ data: { kode: `KRY-UJI-A-${tag}`, nama: "Andi Uji", departemenId: dept.id, jabatan: "Kru Event", status: "AKTIF", gajiPokok: 4000000, tunjangan: 500000 } });
  const budi = await db.karyawan.create({ data: { kode: `KRY-UJI-B-${tag}`, nama: "Budi Uji", departemenId: dept.id, jabatan: "Kru Lepas", status: "AKTIF", gajiPokok: 300000, tunjangan: 0, akunBebanId: upahHarian.id } });
  const nonaktif = await db.karyawan.create({ data: { kode: `KRY-UJI-C-${tag}`, nama: "Cinta Nonaktif", status: "NONAKTIF", gajiPokok: 1000000 } });

  const periodeUji = `2019-0${(tag % 8) + 1}`.slice(0, 7); // periode lampau unik & tidak dipakai suite lain
  let penggajianId: string | null = null;
  try {
    console.log("=== 1. Validasi tolak ===");
    await harusDitolak("periode salah format", () => buatPenggajian(formulir({ periode: "2026", akunKasId: kas.id, baris: [{ karyawanId: andi.id, gajiPokok: 1000, tunjangan: 0, potongan: 0 }] })), "Periode");
    await harusDitolak("tanpa baris", () => buatPenggajian(formulir({ periode: periodeUji, akunKasId: kas.id, baris: [] })), "karyawan");
    await harusDitolak("potongan melebihi gaji", () => buatPenggajian(formulir({ periode: periodeUji, akunKasId: kas.id, baris: [{ karyawanId: andi.id, gajiPokok: 100, tunjangan: 0, potongan: 500 }] })), "melebihi");

    console.log("=== 2. Proses gaji: Andi (Gaji Pokok + Tunjangan + potongan) & Budi (Upah Harian, akun sendiri) ===");
    const saldoGajiPokokAwal = await saldo(gaji.bebanGaji!.id);
    const saldoTunjanganAwal = await saldo(gaji.bebanTunjangan!.id);
    const saldoHutangAwal = await saldo(gaji.hutangPotongan!.id);
    const saldoUpahHarianAwal = await saldo(upahHarian.id);
    const saldoKasAwal = await saldo(kas.id);

    await jalankan("buatPenggajian", () =>
      buatPenggajian(
        formulir({
          periode: periodeUji,
          tanggal: `${periodeUji}-25`,
          akunKasId: kas.id,
          keterangan: "Uji penggajian",
          baris: [
            { karyawanId: andi.id, gajiPokok: 4000000, tunjangan: 500000, potongan: 150000, keteranganPotongan: "BPJS" },
            { karyawanId: budi.id, gajiPokok: 300000, tunjangan: 0, potongan: 0 },
          ],
        }),
      ),
    );
    const p = await db.penggajian.findUniqueOrThrow({ where: { periode: periodeUji }, include: { baris: true, jurnal: { include: { baris: true } } } });
    penggajianId = p.id;
    pastikan(p.baris.length === 2, `2 baris tersimpan (${p.baris.length})`);
    pastikan(dekat(n(p.totalGajiPokok), 4300000), `total gaji pokok 4.300.000 (${n(p.totalGajiPokok)})`);
    pastikan(dekat(n(p.totalTunjangan), 500000), `total tunjangan 500.000 (${n(p.totalTunjangan)})`);
    pastikan(dekat(n(p.totalPotongan), 150000), `total potongan 150.000 (${n(p.totalPotongan)})`);
    pastikan(dekat(n(p.totalDibayar), 4650000), `total dibayar 4.650.000 = 4.800.000 − 150.000 (${n(p.totalDibayar)})`);
    pastikan(!!p.jurnalId && p.jurnal!.sumber === "PENGGAJIAN", "jurnal tercatat dengan sumber PENGGAJIAN");
    const totalDebit = p.jurnal!.baris.reduce((s, b) => s + n(b.debit), 0);
    const totalKredit = p.jurnal!.baris.reduce((s, b) => s + n(b.kredit), 0);
    pastikan(dekat(totalDebit, totalKredit), `jurnal seimbang (${totalDebit} vs ${totalKredit})`);

    console.log("=== 3. Saldo akun: Gaji Pokok naik 4.000.000 (Andi saja, Budi ke Upah Harian) ===");
    pastikan(dekat((await saldo(gaji.bebanGaji!.id)) - saldoGajiPokokAwal, 4000000), "Beban Gaji Pokok (5-2100) bertambah 4.000.000 (Andi)");
    pastikan(dekat((await saldo(upahHarian.id)) - saldoUpahHarianAwal, 300000), "Beban Upah Harian (5-2200) bertambah 300.000 (Budi, akun sendiri)");
    pastikan(dekat((await saldo(gaji.bebanTunjangan!.id)) - saldoTunjanganAwal, 500000), "Beban Tunjangan (5-2500) bertambah 500.000");
    pastikan(dekat((await saldo(gaji.hutangPotongan!.id)) - saldoHutangAwal, -150000), "Hutang Potongan (2-1310) bertambah (kredit) 150.000");
    pastikan(dekat((await saldo(kas.id)) - saldoKasAwal, -4650000), "Kas berkurang 4.650.000");

    console.log("=== 4. Karyawan nonaktif tidak muncul di daftar aktif ===");
    const { daftarKaryawanAktif } = await import("../src/lib/sdm");
    const aktif = await daftarKaryawanAktif(db);
    pastikan(aktif.some((k) => k.id === andi.id) && !aktif.some((k) => k.id === nonaktif.id), "karyawan AKTIF muncul, NONAKTIF tidak");

    console.log("=== 5. Periode ganda ditolak ===");
    await harusDitolak(
      "periode sudah diproses",
      () => buatPenggajian(formulir({ periode: periodeUji, akunKasId: kas.id, baris: [{ karyawanId: andi.id, gajiPokok: 100, tunjangan: 0, potongan: 0 }] })),
      "sudah diproses",
    );

    console.log("=== 6. Terhubung ke Laba Rugi (akrual) dan Laba Rugi Basis Kas ===");
    const periodeLaporan = bacaPeriode({ dari: `${periodeUji}-01`, sampai: `${periodeUji}-28` });
    const lr = await hitungLabaRugi(db, periodeLaporan);
    pastikan(lr.bebanLain.some((b) => b.kode === "5-2100") || lr.bebanLain.some((b) => b.kode === "5-2000"), "Beban Gaji & Honor muncul di Laba Rugi (akrual)");
    const arus = await hitungArusKas(db, periodeLaporan);
    pastikan(arus.operasi.some((b) => b.kode === "5-2100" || b.kode === "5-2200" || b.kode === "5-2500"), "beban gaji muncul sebagai arus kas operasi keluar");
    // periode 2019 dipakai khusus uji ini (kode unik per run), jadi kasReport bulan itu murni dari jurnal penggajian ini:
    // Cr Kas 4.650.000 dipecah per akun lawan → Dr Beban (gross 4.800.000, "pengeluaran") dan Cr Hutang Potongan
    // (150.000, belum jadi kas keluar bulan ini → "penerimaan lain"); bersih -4.650.000, sama dengan kas yang keluar.
    const kasReport = await labaRugiKas(db, periodeLaporan);
    const pengeluaranGaji = kasReport.pengeluaran.filter((b) => ["5-2100", "5-2200", "5-2500"].includes(b.kode)).reduce((s, b) => s + n(b.jumlah), 0);
    const penerimaanHutangPotongan = kasReport.penerimaanLain.filter((b) => b.kode === "2-1310").reduce((s, b) => s + n(b.jumlah), 0);
    pastikan(dekat(pengeluaranGaji, 4800000), `pengeluaran gaji gross (Dr Beban) = 4.800.000 (${pengeluaranGaji})`);
    pastikan(dekat(penerimaanHutangPotongan, 150000), `potongan belum disetor (Cr Hutang) tampil di penerimaan lain = 150.000 (${penerimaanHutangPotongan})`);
    pastikan(dekat(pengeluaranGaji - penerimaanHutangPotongan, 4650000), "bersih pengeluaran − potongan belum disetor = kas yang benar-benar keluar 4.650.000");

    console.log("=== 7. Hapus membalik semuanya ===");
    await jalankan("hapus penggajian", () => hapusDokumen("penggajian", p.id));
    penggajianId = null;
    pastikan((await db.penggajian.count({ where: { id: p.id } })) === 0, "dokumen penggajian terhapus");
    pastikan((await db.barisPenggajian.count({ where: { penggajianId: p.id } })) === 0, "baris penggajian terhapus");
    pastikan((await db.jurnal.count({ where: { id: p.jurnalId! } })) === 0, "jurnal terhapus");
    pastikan(dekat(await saldo(kas.id), saldoKasAwal), "saldo kas kembali seperti semula");
    pastikan(dekat(await saldo(gaji.bebanGaji!.id), saldoGajiPokokAwal), "saldo Beban Gaji Pokok kembali seperti semula");
    const sinkronAkhir = await periksaSinkron(db);
    pastikan(sinkronAkhir.seimbang, "buku besar tetap seimbang setelah hapus");
    console.log("=== DONE, all penggajian checks passed ===");
  } finally {
    if (penggajianId) await hapusDokumen("penggajian", penggajianId).catch(() => {});
    await db.karyawan.deleteMany({ where: { id: { in: [andi.id, budi.id, nonaktif.id] } } });
    await db.departemen.delete({ where: { id: dept.id } }).catch(() => {});
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
