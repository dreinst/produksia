import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { HAK_BAWAAN, punyaHak, type PenggunaSesi } from "../src/lib/hakAkses";
import { periksaKonsistensiPerusahaan, periksaSinkron } from "../src/lib/sinkron";
import { tanggalIso } from "../src/lib/waktu";
import { D } from "../src/lib/uang";
import { simpanBerkas } from "../src/lib/berkas";
import { aturanHasil, dasarHasil, daftarKampanye, kampanyeLengkap, ringkasanIklan, totalMetrik, turunanMetrik, urlTujuanSah, type BarisMetrik } from "../src/lib/iklan";
import {
  arsipkanKampanye,
  buatIklan,
  buatKampanye,
  buatSetIklan,
  catatMetrikIklan,
  hapusIklan,
  hapusMetrikIklan,
  hapusSetIklan,
  ubahIklan,
  ubahKampanye,
  ubahMetrikIklan,
  ubahSetIklan,
} from "../src/lib/aksi/iklan";
import { buangBerkas } from "../src/lib/aksi/berkas";
import type { PeranPengguna } from "../src/prisma-klien/enums";
import { formulir, harusDitolak, jalankan, pastikan, sebagai } from "./bantuan";

/*
 * Uji pustaka dan aksi Perencana Iklan Meta (P41, D6 §9.4 I1 sampai I9, pola D6 §9.1), ditambah pemeriksaan konsistensi
 * kreatif iklan terhadap perusahaan kampanye (KONTRAK-TAMBAHAN P41). Data uji berawalan "UJI-D6" (kampanye, proyek),
 * pengguna sementara uji-d6-*, akun seed owner dan admin. Berkas uji PNG 8 byte lewat simpanBerkas. Tanpa jurnal,
 * tanpa notifikasi, tanpa baris HakAksesPeran.
 */

const AWALAN = "UJI-D6";
const PENGGUNA_UJI: [string, PeranPengguna][] = [
  ["uji-d6-sosmed", "SOSMED"],
  ["uji-d6-iklan", "IKLAN"],
  ["uji-d6-desainer", "DESAINER"],
];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BATAL = "batal-uji-konsistensi";

async function bersihkan(mulai: Date | null) {
  const kampanye = await db.kampanye.findMany({ where: { nama: { startsWith: AWALAN } }, select: { id: true } });
  const kampanyeIds = kampanye.map((k) => k.id);
  const proyek = await db.proyek.findMany({ where: { kode: { startsWith: "UJI-D6-PRJ" } }, select: { id: true } });
  const proyekIds = proyek.map((p) => p.id);
  const berkas = await db.berkas.findMany({ where: { OR: [{ entitasId: { in: kampanyeIds } }, { proyekId: { in: proyekIds } }, { namaBerkas: { startsWith: "uji-d6-" } }] }, select: { id: true } });
  const berkasIds = berkas.map((b) => b.id);
  const modulD6 = { in: ["konten", "tugas-desain", "kampanye", "berkas"] };
  const setIds = (await db.setIklan.findMany({ where: { kampanyeId: { in: kampanyeIds } }, select: { id: true } })).map((s) => s.id);
  const iklanIds = (await db.iklan.findMany({ where: { setIklanId: { in: setIds } }, select: { id: true } })).map((i) => i.id);
  const metrikIds = (await db.metrikIklan.findMany({ where: { kampanyeId: { in: kampanyeIds } }, select: { id: true } })).map((m) => m.id);
  await db.logAktivitas.deleteMany({ where: { OR: [{ entitasId: { in: [...kampanyeIds, ...berkasIds, ...setIds, ...iklanIds, ...metrikIds] }, modul: modulD6 }, ...(mulai ? [{ waktu: { gte: mulai }, modul: modulD6 }] : [])] } });
  await db.metrikIklan.deleteMany({ where: { id: { in: metrikIds } } });
  await db.iklan.deleteMany({ where: { id: { in: iklanIds } } });
  await db.setIklan.deleteMany({ where: { id: { in: setIds } } });
  await db.berkas.deleteMany({ where: { id: { in: berkasIds } } });
  await db.tugasDesain.deleteMany({ where: { kampanyeId: { in: kampanyeIds } } });
  await db.kampanye.deleteMany({ where: { id: { in: kampanyeIds } } });
  await db.proyek.deleteMany({ where: { id: { in: proyekIds } } });
  await db.pengguna.deleteMany({ where: { namaPengguna: { startsWith: "uji-d6-" } } });
}

const sama = (a: { equals: (b: string) => boolean; toFixed: (n: number) => string } | null, b: string) => a !== null && a.equals(b);

async function main() {
  await bersihkan(null);
  const mulaiUji = new Date();
  const jumlahJurnalAwal = await db.jurnal.count();
  const notifAwal = await db.notifikasi.count();
  const hakAwal = await db.hakAksesPeran.count();
  const sinkronAwal = await periksaSinkron(db);
  pastikan(sinkronAwal.seimbang, "periksaSinkron seimbang sebelum uji");

  for (const [namaPengguna, peran] of PENGGUNA_UJI) {
    await db.pengguna.create({ data: { namaPengguna, nama: `Uji D6 ${namaPengguna.slice(7)}`, kataSandiHash: "uji", peran, nomorTelepon: "+620000000000" } });
  }
  const ambil = (namaPengguna: string) => db.pengguna.findUniqueOrThrow({ where: { namaPengguna }, select: { id: true, nama: true, namaPengguna: true, peran: true } });
  const iklanP = await ambil("uji-d6-iklan");
  const ownerP = await ambil("owner");
  const sesi = (p: { id: string; nama: string; namaPengguna: string; peran: PeranPengguna }): PenggunaSesi => ({ ...p, email: null, nomorTelepon: null, hak: HAK_BAWAAN[p.peran] });
  const IKL = "uji-d6-iklan";
  const proyekA = await db.proyek.create({ data: { kode: "UJI-D6-PRJ-A", nama: "Event Uji D6 A" } });
  const proyekB = await db.proyek.create({ data: { kode: "UJI-D6-PRJ-B", nama: "Event Uji D6 B" } });
  const proyekS = await db.proyek.create({ data: { kode: "UJI-D6-PRJ-S", nama: "Event Uji D6 SMARA", perusahaanId: "smara" } });
  const jumlahLog = (aksi: string, jenis: string, entitasId?: string) => db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, modul: "kampanye", aksi, jenis, ...(entitasId ? { entitasId } : {}) } });
  const kampanyeBernama = (nama: string) => db.kampanye.findFirstOrThrow({ where: { nama } });
  const formKampanye = (o: Record<string, string>) => formulir({ perusahaanId: "utama", nama: `${AWALAN}-IKL tolak`, tujuan: "PROSPEK", anggaran: "0", ...o });
  const unggah = async (nama: string, o: { jenisEntitas?: string; entitasId?: string; perusahaanId?: string }) => {
    const h = await simpanBerkas(db, sesi(ownerP), { berkas: new File([PNG], nama), ...o });
    if (!h.ok) throw new Error(`unggah ${nama} gagal: ${h.status} ${h.galat}`);
    return h.nilai;
  };
  const LAP1 = { tanggal: "2026-09-18", belanja: "2500000", tayangan: "120000", klik: "2400", leads: "48", pendapatan: "9000000", jangkauan: "80000" };
  const LAP2 = { tanggal: "2026-09-19", belanja: "3100000", tayangan: "150000", klik: "3300", leads: "61", pendapatan: "12500000", jangkauan: "95000" };

  try {
    console.log("=== I1. Rumus murni ===");
    const m1: BarisMetrik = { belanja: 2500000, jangkauan: 0, tayangan: 120000, klik: 2400, leads: 48, konversi: 0, pendapatan: 9000000 };
    const m2: BarisMetrik = { belanja: 3100000, jangkauan: 0, tayangan: 150000, klik: 3300, leads: 61, konversi: 0, pendapatan: 12500000 };
    const t1 = turunanMetrik(m1, "PROSPEK");
    pastikan(t1.ctr.equals("2.00") && t1.cpc.equals("1041.67") && t1.cpm.equals("20833.33") && t1.cpr.equals("52083.33") && t1.roas.equals("3.60"), `laporan HKA 1: ${t1.ctr} ${t1.cpc} ${t1.cpm} ${t1.cpr} ${t1.roas}`);
    const t2 = turunanMetrik(m2, "PROSPEK");
    pastikan(t2.ctr.equals("2.20") && t2.cpc.equals("939.39") && t2.cpm.equals("20666.67") && t2.cpr.equals("50819.67") && t2.roas.equals("4.03"), `laporan HKA 2: ${t2.ctr} ${t2.cpc} ${t2.cpm} ${t2.cpr} ${t2.roas}`);
    const tot = totalMetrik([m1, m2], "PROSPEK");
    pastikan(tot.ctr.equals("2.11") && tot.cpc.equals("982.46") && tot.cpm.equals("20740.74") && sama(tot.cpr, "51376.15") && tot.roas.equals("3.84"), `total HKA: ${tot.ctr} ${tot.cpc} ${tot.cpm} ${tot.cpr} ${tot.roas}`);
    const nol = turunanMetrik({ belanja: 0, jangkauan: 0, tayangan: 0, klik: 0, leads: 0, konversi: 0, pendapatan: 0 }, "PROSPEK");
    pastikan([nol.ctr, nol.cpc, nol.cpm, nol.cpr, nol.roas].every((x) => x.isZero()), "semua penyebut nol: semua 0");
    pastikan(turunanMetrik({ ...m1, ctrManual: 5 }, "PROSPEK").ctr.equals("5.00") && totalMetrik([{ ...m1, ctrManual: 5 }, m2], "PROSPEK").ctr.equals("2.11"), "ctrManual 5 menimpa baris, total mengabaikan manual");
    pastikan(turunanMetrik({ ...m1, belanja: 1, klik: 8 }, "PROSPEK").cpc.equals("0.13"), "pembulatan setengah ke atas: 1/8 = 0.13");
    pastikan(turunanMetrik({ ...m1, belanja: 50000 }, "INTERAKSI").cpr.isZero() && turunanMetrik({ ...m1, belanja: 50000, hasil: 100 }, "INTERAKSI").cpr.equals("500.00"), "INTERAKSI: tanpa hasil CPR 0, hasil 100 belanja 50.000 = 500.00");
    pastikan(turunanMetrik({ ...m1, jangkauan: 1000, belanja: 10000 }, "KESADARAN").cpr.equals("10.00") && turunanMetrik({ ...m1, konversi: 4, belanja: 10000 }, "PENJUALAN").cpr.equals("2500.00") && turunanMetrik({ ...m1, belanja: 2400 }, "TRAFFIC").cpr.equals("1.00"), "KESADARAN pakai jangkauan, PENJUALAN konversi, TRAFFIC klik");
    pastikan(totalMetrik([m1, m2], ["PROSPEK", "TRAFFIC"]).cpr === null, "total lintas tujuan: CPR null");
    pastikan(urlTujuanSah("https://dpro.id/promo") && urlTujuanSah("http://x.id") && !urlTujuanSah("javascript:alert(1)") && !urlTujuanSah("ftp://x.id") && !urlTujuanSah("dpro.id"), "urlTujuanSah hanya http dan https");

    // perbaikan tinjauan P41 R8: aturanHasil dan dasarHasil dari satu peta; INTERAKSI tanpa hitungan otomatis
    const dasarUji = { jangkauan: 1, klik: 2, leads: 3, konversi: 4 };
    pastikan(aturanHasil("INTERAKSI") === null && dasarHasil(dasarUji, "INTERAKSI") === 0, "R8: INTERAKSI tanpa aturan hasil otomatis, dasar 0");
    pastikan((["PROSPEK", "PENJUALAN", "PROMOSI_APLIKASI", "TRAFFIC", "KESADARAN"] as const).every((t) => dasarHasil(dasarUji, t) === dasarUji[aturanHasil(t) as keyof typeof dasarUji]), "R8: aturanHasil sejalan dengan dasarHasil untuk semua tujuan lain");

    console.log("=== I2. Hak bawaan ===");
    const AKSI = ["lihat", "buat", "ubah", "hapus"] as const;
    const hak = (p: PeranPengguna) => JSON.stringify(AKSI.filter((a) => punyaHak(p, `kampanye.${a}`)));
    pastikan(hak("IKLAN") === JSON.stringify(AKSI), "IKLAN: kampanye lihat/buat/ubah/hapus");
    pastikan(hak("SOSMED") === "[]" && hak("DESAINER") === "[]", "SOSMED dan DESAINER tanpa kampanye.*");
    pastikan(hak("ADMIN") === '["lihat"]', "ADMIN: kampanye.lihat saja");
    pastikan((["KASIR", "GUDANG", "KRU", "GUEST"] as const).every((p) => hak(p) === "[]"), "KASIR, GUDANG, KRU, GUEST tanpa kampanye.*");

    console.log("=== I3. Penolakan kampanye ===");
    await sebagai("uji-d6-desainer", () => harusDitolak("DESAINER buat kampanye", () => buatKampanye(formKampanye({})), "tidak punya hak"));
    await sebagai("admin", () => harusDitolak("admin buat kampanye", () => buatKampanye(formKampanye({})), "tidak punya hak"));
    const tolak = (label: string, o: Record<string, string>, pesan: string) => sebagai(IKL, () => harusDitolak(label, () => buatKampanye(formKampanye(o)), pesan));
    await tolak("nama kosong", { nama: " " }, "Nama kampanye wajib diisi");
    await tolak("tujuan VIRAL", { tujuan: "VIRAL" }, "Tujuan kampanye tidak dikenal");
    await tolak("status tidak dikenal", { status: "SELESAI_SEMUA" }, "Status kampanye tidak dikenal");
    await tolak("anggaran -1", { anggaran: "-1" }, "Anggaran tidak boleh negatif");
    await tolak("tanggal mulai tidak valid", { tanggalMulai: "2026-02-30" }, "Tanggal mulai tidak valid");
    await tolak("selesai sebelum mulai", { tanggalMulai: "2026-10-10", tanggalSelesai: "2026-10-09" }, "Tanggal selesai tidak boleh sebelum tanggal mulai");
    await tolak("proyek SMARA untuk kampanye utama", { proyekId: proyekS.id }, "milik");
    pastikan((await db.kampanye.count({ where: { nama: { startsWith: AWALAN } } })) === 0, "tidak ada kampanye uji dari isian yang ditolak");

    console.log("=== I4. Set iklan dan iklan ===");
    const NAMA_1 = `${AWALAN}-IKL-1 Prospek wedding`;
    await sebagai(IKL, () => jalankan("IKLAN buat kampanye 1 (tanggal sama boleh)", () => buatKampanye(formKampanye({ nama: NAMA_1, tujuan: "PROSPEK", anggaran: "10000000", tanggalMulai: "2026-09-18", tanggalSelesai: "2026-09-18", proyekId: proyekA.id }))));
    const k1 = await kampanyeBernama(NAMA_1);
    pastikan(k1.perusahaanId === "utama" && k1.proyekId === proyekA.id && k1.status === "DIRENCANAKAN" && k1.anggaran.equals("10000000") && k1.dibuatOlehNama === iklanP.nama, "kampanye 1 tersimpan: utama, proyek A, DIRENCANAKAN, anggaran");
    pastikan((await jumlahLog("BUAT", "Kampanye Iklan", k1.id)) === 1, "log BUAT kampanye");
    const kLain = await db.kampanye.create({ data: { nama: `${AWALAN} Kampanye lain`, dibuatOlehNama: "Skrip Uji" } });
    const setLain = await db.setIklan.create({ data: { kampanyeId: kLain.id, nama: "Set kampanye lain" } });
    await sebagai(IKL, () => harusDitolak("set iklan tanpa nama", () => buatSetIklan(k1.id, formulir({ nama: "" })), "Nama set iklan wajib diisi"));
    await sebagai(IKL, () => harusDitolak("gender X", () => buatSetIklan(k1.id, formulir({ nama: "Set A", gender: "X" })), "Gender tidak dikenal"));
    await sebagai(IKL, () => harusDitolak("usia 21 karakter", () => buatSetIklan(k1.id, formulir({ nama: "Set A", usia: "1".repeat(21) })), "Usia maksimal 20"));
    await sebagai(IKL, () => harusDitolak("set iklan kampanye palsu", () => buatSetIklan("tidak-ada", formulir({ nama: "Set A" })), "Kampanye tidak ditemukan"));
    await sebagai(IKL, () => jalankan("set iklan sukses", () => buatSetIklan(k1.id, formulir({ nama: "Set A Jakarta", audiens: "Calon pengantin", lokasi: "Jakarta", usia: "22-40", gender: "PEREMPUAN", penempatan: "Feed, Stories", anggaran: "5000000" }))));
    const setA = await db.setIklan.findFirstOrThrow({ where: { kampanyeId: k1.id } });
    pastikan(setA.gender === "PEREMPUAN" && setA.usia === "22-40" && setA.anggaran.equals("5000000") && (await jumlahLog("BUAT", "Set Iklan", setA.id)) === 1, "set iklan tersimpan, log BUAT Set Iklan");
    await sebagai(IKL, () => jalankan("ubah set iklan", () => ubahSetIklan(setA.id, formulir({ nama: "Set A Jakarta", usia: "25-40", gender: "PEREMPUAN", anggaran: "5000000", kampanyeId: kLain.id }))));
    const setA2 = await db.setIklan.findUniqueOrThrow({ where: { id: setA.id } });
    pastikan(setA2.usia === "25-40" && setA2.kampanyeId === k1.id && setA2.audiens === null, "ubah set iklan: isian diganti, kampanye tidak bisa dipindah lewat isian");
    const formIklan = (o: Record<string, string>) => formulir({ setIklanId: setA.id, nama: "Iklan carousel", judulIklan: "Paket wedding", cta: "Kirim pesan", ...o });
    await sebagai(IKL, () => harusDitolak("iklan tanpa set", () => buatIklan(k1.id, formIklan({ setIklanId: "" })), "Set iklan wajib dipilih"));
    await sebagai(IKL, () => harusDitolak("iklan dengan set kampanye lain", () => buatIklan(k1.id, formIklan({ setIklanId: setLain.id })), "Set iklan ini bukan milik kampanye tersebut"));
    await sebagai(IKL, () => harusDitolak("iklan tanpa nama", () => buatIklan(k1.id, formIklan({ nama: "" })), "Nama iklan wajib diisi"));
    await sebagai(IKL, () => harusDitolak("URL javascript", () => buatIklan(k1.id, formIklan({ urlTujuan: "javascript:alert(1)" })), "URL tujuan harus diawali http:// atau https://"));
    const berkasSmara = await unggah("uji-d6-kreatif-smara.png", { perusahaanId: "smara" });
    const berkasBuang = await unggah("uji-d6-kreatif-buang.png", { jenisEntitas: "kampanye", entitasId: k1.id });
    await sebagai("owner", () => jalankan("buang berkas kreatif", () => buangBerkas(berkasBuang.id)));
    const lampiran = await unggah("uji-d6-kreatif.png", { jenisEntitas: "kampanye", entitasId: k1.id });
    pastikan(lampiran.perusahaanId === "utama" && lampiran.proyekId === proyekA.id, "lampiran kampanye mewarisi perusahaan dan proyek kampanye");
    const pesanKreatif = "Berkas kreatif tidak ditemukan";
    await sebagai(IKL, () => harusDitolak("kreatif berkas SMARA", () => buatIklan(k1.id, formIklan({ berkasKreatifId: berkasSmara.id })), pesanKreatif));
    await sebagai(IKL, () => harusDitolak("kreatif berkas yang dibuang", () => buatIklan(k1.id, formIklan({ berkasKreatifId: berkasBuang.id })), pesanKreatif));
    await sebagai(IKL, () => harusDitolak("kreatif berkas tidak ada", () => buatIklan(k1.id, formIklan({ berkasKreatifId: "tidak-ada" })), pesanKreatif));
    await sebagai(IKL, () => jalankan("iklan dengan kreatif lampiran kampanye", () => buatIklan(k1.id, formIklan({ berkasKreatifId: lampiran.id, urlTujuan: "https://dpro.id/wedding", teksUtama: "Paket lengkap" }))));
    const iklan1 = await db.iklan.findFirstOrThrow({ where: { setIklanId: setA.id } });
    pastikan(iklan1.berkasKreatifId === lampiran.id && iklan1.urlTujuan === "https://dpro.id/wedding" && (await jumlahLog("BUAT", "Iklan", iklan1.id)) === 1, "iklan tersimpan dengan kreatif, log BUAT Iklan");
    await sebagai(IKL, () => harusDitolak("ubah iklan pindah ke set kampanye lain", () => ubahIklan(iklan1.id, formIklan({ setIklanId: setLain.id, berkasKreatifId: lampiran.id })), "Set iklan ini bukan milik kampanye tersebut"));
    await sebagai(IKL, () => jalankan("buat set B lalu pindahkan iklan ke sana", () => buatSetIklan(k1.id, formulir({ nama: "Set B Bandung" }))));
    const setB = await db.setIklan.findFirstOrThrow({ where: { kampanyeId: k1.id, nama: "Set B Bandung" } });
    await sebagai(IKL, () => jalankan("ubah iklan ke set B", () => ubahIklan(iklan1.id, formIklan({ setIklanId: setB.id, berkasKreatifId: lampiran.id, urlTujuan: "https://dpro.id/wedding" }))));
    pastikan((await db.iklan.findUniqueOrThrow({ where: { id: iklan1.id } })).setIklanId === setB.id && (await jumlahLog("UBAH", "Iklan", iklan1.id)) === 1, "iklan pindah ke set lain di kampanye yang sama, log UBAH");
    const anakInduk = async (k: Parameters<typeof periksaKonsistensiPerusahaan>[0]) => (await periksaKonsistensiPerusahaan(k)).rincian.find((r) => r.kode === "BERKAS_ENTITAS")!.jumlah;
    const awalKons = await anakInduk(db);
    await db
      .$transaction(async (tx) => {
        await tx.iklan.update({ where: { id: iklan1.id }, data: { berkasKreatifId: berkasSmara.id } });
        pastikan((await anakInduk(tx)) === awalKons + 1, "kreatif milik perusahaan lain: BERKAS_ENTITAS bertambah 1");
        throw new Error(BATAL);
      })
      .catch((e: Error) => {
        if (e.message !== BATAL) throw e;
      });
    pastikan((await anakInduk(db)) === awalKons, "data bersih: BERKAS_ENTITAS kembali");

    console.log("=== I5. Laporan harian ===");
    await sebagai(IKL, () => jalankan("catat laporan 1", () => catatMetrikIklan(k1.id, formulir(LAP1))));
    await sebagai(IKL, () => jalankan("catat laporan 2", () => catatMetrikIklan(k1.id, formulir(LAP2))));
    const lengkap = await kampanyeLengkap(db, k1.id, sesi(ownerP));
    pastikan(!!lengkap && lengkap.laporan.length === 2 && tanggalIso(lengkap.laporan[0].tanggal) === "2026-09-19", "kampanyeLengkap memuat dua laporan, tanggal terbaru dulu");
    const tk = lengkap!.total;
    pastikan(tk.ctr.equals("2.11") && tk.cpc.equals("982.46") && tk.cpm.equals("20740.74") && sama(tk.cpr, "51376.15") && tk.roas.equals("3.84") && tk.belanja.equals("5600000") && tk.jangkauan === 175000, "total kampanyeLengkap sama dengan I1");
    pastikan(lengkap!.laporan[1].turunan.ctr.equals("2.00") && !lengkap!.laporan[1].manual.ctr && lengkap!.laporan[1].dicatatOlehNama === iklanP.nama, "turunan per baris dan penanda manual");
    pastikan(lengkap!.setIklan.length === 2 && lengkap!.setIklan[0].id === setA.id && lengkap!.iklan.length === 1 && lengkap!.iklan[0].berkasKreatif?.namaBerkas === "uji-d6-kreatif.png" && lengkap!.iklan[0].setIklan.id === setB.id, "kampanyeLengkap memuat set iklan urut dibuat dan iklan dengan nama kreatif");
    // perbaikan tinjauan P41 R4: nama kreatif hanya bila berkasnya terlihat bagi pembaca, tugas desain hanya bagi tugas-desain.lihat
    const tanpaLihatBerkas: PenggunaSesi = { ...sesi(ownerP), hak: HAK_BAWAAN.PEMILIK.filter((h) => !h.startsWith("kampanye.") && !h.startsWith("tugas-desain.")) };
    const lengkapTerbatas = (await kampanyeLengkap(db, k1.id, tanpaLihatBerkas))!;
    pastikan(lengkapTerbatas.iklan[0].berkasKreatif === null && lengkapTerbatas.iklan[0].kreatifTersembunyi && !lengkap!.iklan[0].kreatifTersembunyi && lengkapTerbatas.tugasDesain.length === 0, "R4: kreatif yang tidak terlihat tidak dikirim, tugas desain kosong tanpa hak");
    pastikan((await jumlahLog("BUAT", "Laporan Iklan")) === 2 && (await db.logAktivitas.count({ where: { waktu: { gte: mulaiUji }, modul: "kampanye", jenis: "Laporan Iklan", nomor: "2026-09-18" } })) === 1, "log BUAT Laporan Iklan berlabel tanggal ISO");
    await sebagai(IKL, () => harusDitolak("laporan ganda di tanggal sama", () => catatMetrikIklan(k1.id, formulir({ ...LAP1, belanja: "1" })), "Laporan tanggal 18 Sep 2026 untuk kampanye ini sudah ada"));
    await sebagai(IKL, () => harusDitolak("tanggal kosong", () => catatMetrikIklan(k1.id, formulir({ ...LAP1, tanggal: "" })), "Tanggal laporan wajib diisi"));
    await sebagai(IKL, () => harusDitolak("tanggal tidak valid", () => catatMetrikIklan(k1.id, formulir({ ...LAP1, tanggal: "2026-09-31" })), "Tanggal laporan tidak valid"));
    await sebagai(IKL, () => harusDitolak("belanja -5", () => catatMetrikIklan(k1.id, formulir({ ...LAP1, tanggal: "2026-09-20", belanja: "-5" })), "Belanja tidak boleh negatif"));
    await sebagai(IKL, () => harusDitolak("pendapatan -1", () => catatMetrikIklan(k1.id, formulir({ ...LAP1, tanggal: "2026-09-20", pendapatan: "-1" })), "Pendapatan tidak boleh negatif"));
    await sebagai(IKL, () => harusDitolak("tayangan 1.5", () => catatMetrikIklan(k1.id, formulir({ ...LAP1, tanggal: "2026-09-20", tayangan: "1.5" })), "Tayangan harus bilangan bulat"));
    await sebagai(IKL, () => harusDitolak("klik -1", () => catatMetrikIklan(k1.id, formulir({ ...LAP1, tanggal: "2026-09-20", klik: "-1" })), "Klik harus bilangan bulat"));
    await sebagai(IKL, () => harusDitolak("tayangan terlalu besar", () => catatMetrikIklan(k1.id, formulir({ ...LAP1, tanggal: "2026-09-20", tayangan: "3000000000" })), "Tayangan terlalu besar"));
    await sebagai(IKL, () => harusDitolak("CTR manual negatif", () => catatMetrikIklan(k1.id, formulir({ ...LAP1, tanggal: "2026-09-20", ctrManual: "-1" })), "CTR tidak boleh negatif"));
    const lap1 = await db.metrikIklan.findFirstOrThrow({ where: { kampanyeId: k1.id, belanja: D(2500000) } });
    const lap2 = await db.metrikIklan.findFirstOrThrow({ where: { kampanyeId: k1.id, belanja: D(3100000) } });
    await sebagai(IKL, () => harusDitolak("ubah laporan 1 ke tanggal laporan 2", () => ubahMetrikIklan(lap1.id, formulir({ ...LAP1, tanggal: "2026-09-19" })), "Laporan tanggal 19 Sep 2026 untuk kampanye ini sudah ada"));
    await sebagai(IKL, () => jalankan("ubah laporan 1 dengan CTR manual kosong dan klik baru", () => ubahMetrikIklan(lap1.id, formulir({ ...LAP1, klik: "3000", ctrManual: "" }))));
    const sesudahKlik = (await kampanyeLengkap(db, k1.id, sesi(ownerP)))!.laporan.find((l) => l.id === lap1.id)!;
    pastikan(sesudahKlik.turunan.ctr.equals("2.50") && sesudahKlik.ctrManual === null, "CTR dihitung ulang dari klik baru (jebakan formulir HKA tidak terjadi)");
    await sebagai(IKL, () => jalankan("ubah laporan 1 dengan CTR manual 9", () => ubahMetrikIklan(lap1.id, formulir({ ...LAP1, klik: "3000", ctrManual: "9" }))));
    const lengkapManual = (await kampanyeLengkap(db, k1.id, sesi(ownerP)))!;
    const barisManual = lengkapManual.laporan.find((l) => l.id === lap1.id)!;
    pastikan(barisManual.turunan.ctr.equals("9.00") && barisManual.manual.ctr && lengkapManual.total.ctr.equals("2.33"), `CTR manual 9.00 di baris, total tetap dari jumlah (${lengkapManual.total.ctr})`);
    await sebagai(IKL, () => jalankan("kembalikan klik laporan 1", () => ubahMetrikIklan(lap1.id, formulir({ ...LAP1, ctrManual: "" }))));
    const jumlahUbahLap = await jumlahLog("UBAH", "Laporan Iklan", lap1.id);
    await sebagai(IKL, () => jalankan("ubah laporan tanpa perubahan", () => ubahMetrikIklan(lap1.id, formulir({ ...LAP1, ctrManual: "" }))));
    pastikan((await jumlahLog("UBAH", "Laporan Iklan", lap1.id)) === jumlahUbahLap && jumlahUbahLap === 3, "ubah laporan tanpa perubahan tidak menulis log");
    await sebagai(IKL, () => jalankan("catat laporan 3 lalu hapus", () => catatMetrikIklan(k1.id, formulir({ ...LAP1, tanggal: "2026-09-20", hasil: "7" }))));
    const lap3 = await db.metrikIklan.findFirstOrThrow({ where: { kampanyeId: k1.id, tanggal: { gte: new Date("2026-09-20T00:00:00Z") } } });
    pastikan(lap3.hasil === 7, "hasil manual tersimpan");
    await sebagai("uji-d6-sosmed", () => harusDitolak("SOSMED hapus laporan", () => hapusMetrikIklan(lap3.id), "tidak punya hak"));
    await sebagai(IKL, () => jalankan("hapus laporan 3", () => hapusMetrikIklan(lap3.id)));
    pastikan((await db.metrikIklan.count({ where: { id: lap3.id } })) === 0 && (await jumlahLog("HAPUS", "Laporan Iklan", lap3.id)) === 1, "laporan 3 terhapus fisik, log HAPUS");
    pastikan(!!lap2, "laporan 2 tetap");
    const serentak = await sebagai(IKL, () => Promise.allSettled([1, 2].map((n) => catatMetrikIklan(k1.id, formulir({ ...LAP1, tanggal: "2026-09-22", belanja: String(n) })))));
    const sukses = (h: PromiseSettledResult<unknown>) => h.status === "fulfilled" || ((h.reason as Error)?.message ?? "").includes("static generation store missing");
    const ditolak = serentak.filter((h) => !sukses(h)).map((h) => ((h as PromiseRejectedResult).reason as Error).message);
    pastikan(serentak.filter(sukses).length === 1 && ditolak.length === 1 && ditolak[0].includes("Laporan tanggal 22 Sep 2026"), `dua laporan serentak bertanggal sama: satu sukses, satu ditolak (${ditolak.join(" | ")})`);
    const lapSerentak = await db.metrikIklan.findMany({ where: { kampanyeId: k1.id, tanggal: { gte: new Date("2026-09-21T00:00:00Z") } } });
    pastikan(lapSerentak.length === 1, "hanya satu laporan tanggal 22 tersimpan");
    await sebagai(IKL, () => jalankan("hapus laporan serentak", () => hapusMetrikIklan(lapSerentak[0].id)));

    console.log("=== I6. Ringkasan ===");
    const NAMA_2 = `${AWALAN}-IKL-2 Traffic katalog`;
    await sebagai(IKL, () => jalankan("buat kampanye 2", () => buatKampanye(formKampanye({ nama: NAMA_2, tujuan: "TRAFFIC", anggaran: "2500000.50", proyekId: proyekB.id, status: "AKTIF" }))));
    const k2 = await kampanyeBernama(NAMA_2);
    await sebagai(IKL, () => jalankan("laporan kampanye 2", () => catatMetrikIklan(k2.id, formulir({ tanggal: "2026-09-18", belanja: "100000", tayangan: "10000", klik: "500", pendapatan: "0" }))));
    const ringkas = await ringkasanIklan(db, { q: `${AWALAN}-IKL` });
    pastikan(ringkas.jumlahKampanye === 2 && ringkas.aktif === 1 && ringkas.anggaranRencana.equals("12500000.50") && ringkas.total.cpr === null, `ringkasanIklan: 2 kampanye, 1 aktif, anggaran ${ringkas.anggaranRencana}, CPR null`);
    pastikan(ringkas.perKampanye[0].id === k2.id && ringkas.perKampanye[1].id === k1.id, "perKampanye urut dibuat terbaru dulu");
    const ringkasA = await ringkasanIklan(db, { q: `${AWALAN}-IKL`, proyek: proyekA.id });
    pastikan(ringkasA.jumlahKampanye === 1 && sama(ringkasA.total.cpr, "51376.15"), `ringkasanIklan proyek A: CPR ${ringkasA.total.cpr}`);
    const daftar = await daftarKampanye(db, {}, { q: `${AWALAN}-IKL`, lewati: 0, ambil: 25 }, "utama");
    const barisK1 = daftar.baris.find((b) => b.id === k1.id)!;
    pastikan(daftar.total === 2 && daftar.baris[0].id === k2.id && sama(barisK1.total.cpr, "51376.15") && barisK1.total.belanja.equals("5600000") && barisK1.proyek?.kode === "UJI-D6-PRJ-A" && barisK1.perusahaan.kode === "DPRO", "daftarKampanye: total per kampanye, proyek, perusahaan");
    const daftarStatus = await daftarKampanye(db, { status: "AKTIF" }, { q: AWALAN, lewati: 0, ambil: 25 }, null);
    pastikan(daftarStatus.total === 1 && daftarStatus.baris[0].id === k2.id && daftarStatus.baris[0].total.cpr?.equals("200.00") === true, "daftarKampanye saringan status; CPR TRAFFIC dari klik");
    const halaman2 = await daftarKampanye(db, {}, { q: `${AWALAN}-IKL`, lewati: 1, ambil: 1 }, "utama");
    pastikan(halaman2.total === 2 && halaman2.baris.length === 1 && halaman2.baris[0].id === k1.id, "daftarKampanye dipaginasi");
    await sebagai(IKL, () => jalankan("ubah kampanye 2: status dan proyek", () => ubahKampanye(k2.id, formKampanye({ nama: NAMA_2, tujuan: "TRAFFIC", anggaran: "2500000.50", proyekId: proyekA.id, status: "DIJEDA" }))));
    pastikan((await jumlahLog("STATUS", "Kampanye Iklan", k2.id)) === 1 && (await jumlahLog("UBAH", "Kampanye Iklan", k2.id)) === 1, "ubah kampanye: log STATUS dan UBAH (proyek)");
    const lampiranK2 = await unggah("uji-d6-lampiran-k2.png", { jenisEntitas: "kampanye", entitasId: k2.id });
    await sebagai(IKL, () => jalankan("ubah proyek kampanye 2 ke B", () => ubahKampanye(k2.id, formKampanye({ nama: NAMA_2, tujuan: "TRAFFIC", anggaran: "2500000.50", proyekId: proyekB.id, status: "DIJEDA" }))));
    pastikan((await db.berkas.findUniqueOrThrow({ where: { id: lampiranK2.id } })).proyekId === proyekB.id, "lampiran kampanye ikut pindah proyek");
    await sebagai(IKL, () => harusDitolak("ubah kampanye ke proyek SMARA", () => ubahKampanye(k2.id, formKampanye({ nama: NAMA_2, proyekId: proyekS.id })), "milik"));
    await sebagai("admin", () => harusDitolak("admin ubah kampanye", () => ubahKampanye(k2.id, formKampanye({ nama: NAMA_2 })), "tidak punya hak"));

    console.log("=== I7. Hapus dan arsip ===");
    await sebagai(IKL, () => harusDitolak("hapus set yang masih punya iklan", () => hapusSetIklan(setB.id), "Hapus atau pindahkan iklan"));
    await sebagai("uji-d6-sosmed", () => harusDitolak("SOSMED hapus iklan", () => hapusIklan(iklan1.id), "tidak punya hak"));
    await sebagai(IKL, () => jalankan("hapus iklan", () => hapusIklan(iklan1.id)));
    await sebagai(IKL, () => jalankan("hapus set B", () => hapusSetIklan(setB.id)));
    pastikan((await db.setIklan.count({ where: { id: setB.id } })) === 0 && (await jumlahLog("HAPUS", "Iklan", iklan1.id)) === 1 && (await jumlahLog("HAPUS", "Set Iklan", setB.id)) === 1, "iklan dan set terhapus fisik, log HAPUS");
    await sebagai(IKL, () => harusDitolak("hapus set yang sudah dihapus", () => hapusSetIklan(setB.id), "Set iklan tidak ditemukan"));
    await sebagai("uji-d6-sosmed", () => harusDitolak("SOSMED arsip kampanye", () => arsipkanKampanye(k1.id), "tidak punya hak"));
    await sebagai(IKL, () => jalankan("IKLAN arsip kampanye 1", () => arsipkanKampanye(k1.id)));
    const k1Arsip = await db.kampanye.findUniqueOrThrow({ where: { id: k1.id } });
    pastikan(!!k1Arsip.diarsipkanPada && k1Arsip.diarsipkanOlehNama === iklanP.nama && (await jumlahLog("ARSIP", "Kampanye Iklan", k1.id)) === 1, "kampanye diarsipkan, log ARSIP");
    pastikan((await kampanyeLengkap(db, k1.id, sesi(ownerP))) === null, "kampanyeLengkap kampanye arsip = null");
    const ringkasArsip = await ringkasanIklan(db, { q: `${AWALAN}-IKL` });
    pastikan(ringkasArsip.jumlahKampanye === 1 && ringkasArsip.total.belanja.equals("100000"), "kampanye arsip dan laporannya tidak ikut ringkasan");
    await sebagai(IKL, () => harusDitolak("laporan untuk kampanye arsip", () => catatMetrikIklan(k1.id, formulir({ ...LAP1, tanggal: "2026-09-21" })), "Kampanye tidak ditemukan"));
    await sebagai(IKL, () => harusDitolak("set iklan untuk kampanye arsip", () => buatSetIklan(k1.id, formulir({ nama: "Set C" })), "Kampanye tidak ditemukan"));
    await sebagai(IKL, () => harusDitolak("ubah set iklan kampanye arsip", () => ubahSetIklan(setA.id, formulir({ nama: "Set A" })), "Kampanye tidak ditemukan"));
    await sebagai(IKL, () => harusDitolak("ubah laporan kampanye arsip", () => ubahMetrikIklan(lap2.id, formulir(LAP2)), "Kampanye tidak ditemukan"));
    await sebagai(IKL, () => harusDitolak("ubah kampanye arsip", () => ubahKampanye(k1.id, formKampanye({ nama: NAMA_1 })), "Kampanye tidak ditemukan"));
    await sebagai(IKL, () => harusDitolak("arsip kedua", () => arsipkanKampanye(k1.id), "Kampanye tidak ditemukan"));

    console.log("=== I8. Multi perusahaan ===");
    const NAMA_S = `${AWALAN}-SMARA Awareness`;
    await sebagai(IKL, () => jalankan("buat kampanye SMARA", () => buatKampanye(formKampanye({ perusahaanId: "smara", nama: NAMA_S, tujuan: "KESADARAN", proyekId: proyekS.id }))));
    const kS = await kampanyeBernama(NAMA_S);
    pastikan(kS.perusahaanId === "smara" && kS.proyekId === proyekS.id, "kampanye SMARA berproyek S");
    pastikan(!(await ringkasanIklan(db, {}, "utama")).perKampanye.some((k) => k.id === kS.id), "kampanye SMARA tidak di ringkasan utama");
    pastikan((await ringkasanIklan(db, {}, null)).perKampanye.some((k) => k.id === kS.id) && (await ringkasanIklan(db, {}, "smara")).perKampanye.some((k) => k.id === kS.id), "kampanye SMARA di ringkasan gabungan dan SMARA");
    pastikan(!(await daftarKampanye(db, {}, { q: AWALAN, lewati: 0, ambil: 25 }, "utama")).baris.some((b) => b.id === kS.id), "daftarKampanye utama tanpa kampanye SMARA");
    const setS = await db.setIklan.create({ data: { kampanyeId: kS.id, nama: "Set SMARA" } });
    await sebagai(IKL, () => harusDitolak("kreatif lampiran kampanye utama untuk iklan SMARA", () => buatIklan(kS.id, formulir({ setIklanId: setS.id, nama: "Iklan SMARA", berkasKreatifId: lampiranK2.id })), pesanKreatif));
    await sebagai(IKL, () => jalankan("kreatif berkas SMARA untuk iklan SMARA", () => buatIklan(kS.id, formulir({ setIklanId: setS.id, nama: "Iklan SMARA", berkasKreatifId: berkasSmara.id }))));

    console.log("=== I9. Tanpa efek akuntansi ===");
    pastikan((await db.jurnal.count()) === jumlahJurnalAwal, "tidak ada jurnal yang dibuat modul iklan");
    pastikan((await db.notifikasi.count()) === notifAwal, "modul iklan tidak mengirim notifikasi");
    const sinkronAkhir = await periksaSinkron(db);
    pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron seimbang dan sama dengan awal");
    pastikan((await periksaKonsistensiPerusahaan(db)).rincian.find((r) => r.kode === "BERKAS_ENTITAS")!.jumlah === awalKons, "konsistensi berkas tetap");
    pastikan((await db.hakAksesPeran.count()) === hakAwal, "tidak ada baris HakAksesPeran baru");
  } finally {
    console.log("=== Bersih-bersih ===");
    await bersihkan(mulaiUji);
  }
  pastikan((await db.kampanye.count({ where: { nama: { startsWith: AWALAN } } })) === 0 && (await db.pengguna.count({ where: { namaPengguna: { startsWith: "uji-d6-" } } })) === 0, "data uji D6 bersih");
  console.log("\nSEMUA UJI IKLAN LULUS");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
