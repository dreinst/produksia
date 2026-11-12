import "dotenv/config";
// Skrip ini memanggil aksi server dan route handler di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db";
import type { Prisma } from "../src/prisma-klien/client";
import type { PeranPengguna } from "../src/prisma-klien/enums";
import { hashKataSandi } from "../src/lib/kataSandi";
import { penggunaSaatIni } from "../src/lib/otentikasi";
import { aturPerusahaanAktif, simpanLingkupSesi } from "../src/lib/perusahaan";
import { kirimNotifikasi, penggunaDenganHak, ringkasNotifikasi, tandaiDibuka, tanpaSuperadminKecualiKosong } from "../src/lib/notifikasi";
import { beritahuPersetujuan, tautanDokumenPersetujuan } from "../src/lib/notifikasiPersetujuan";
import { AWALAN_KUNCI_FAKTUR, periksaPengingat, periksaPengingatTindakLanjut } from "../src/lib/pengingat";
import { bukaNotifikasi, tandaiNotifikasiDibaca, tandaiSemuaNotifikasiDibaca } from "../src/lib/aksi/notifikasi";
import { ajukanDokumen, setujuiDokumen, tolakDokumen } from "../src/lib/aksi/persetujuan";
import { buatKasKeluar, buatKasMasuk } from "../src/lib/aksi/jurnal";
import { buatPeminjamanBarang } from "../src/lib/aksi/peminjaman";
import { buatFaktur, buatPesanan } from "../src/lib/aksi/penjualan";
import { tanggalIso } from "../src/lib/waktu";
import { periksaSinkron } from "../src/lib/sinkron";
import { GET } from "../src/app/api/notifikasi/route";
import { aturPersetujuan, formulir, jalankan, sebagai } from "./bantuan";

/*
 * Uji notifikasi dan pengingat (D7 §9.4, D4 §9.1 bagian 10): kirimNotifikasi, penggunaDenganHak (termasuk peran
 * tambahan), notifikasi maker-checker beserta pembungkus SAVEPOINT (DESAIN G14), pengingat faktur dan tindak lanjut,
 * baca/buka/tandai, aturPerusahaanAktif, route GET /api/notifikasi, dan hapus pengguna. Data uji: pengguna ujin-*,
 * kode UJIN-*, perusahaan UJINA. Notifikasi dan log pengguna lain (mis. pemeriksa bawaan seed) dibuang menurut
 * penanda suite: nomor dokumen uji atau teks "UJIN", bukan rentang waktu, supaya data penulis lain tidak ikut terhapus.
 * periksaSinkron sebelum dan sesudah suite harus identik (DESAIN G15). Pemeriksa lokal melempar galat (bukan
 * process.exit) supaya blok finally selalu membersihkan data dan baris HakAksesPeran.
 */

function pastikan(kondisi: unknown, pesan: string): asserts kondisi {
  if (!kondisi) throw new Error(`[FAIL] ${pesan}`);
  console.log(`[ok] ${pesan}`);
}
async function harusDitolak(label: string, fn: () => Promise<unknown>, potongan: string) {
  let pesan: string | null = null;
  try {
    await fn();
  } catch (err) {
    pesan = (err as { message?: string })?.message ?? String(err);
  }
  pastikan(pesan !== null && pesan.includes(potongan), `${label} ditolak: "${pesan}"`);
}
async function denganEnv<T>(isian: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const lama = Object.fromEntries(Object.keys(isian).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(isian)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(lama)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

const P = "ujin-";
const JPEG_PALSU = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const KET_KAS = "Uji notifikasi kas";

const notif = (penggunaId: string, judul?: string) => db.notifikasi.findMany({ where: { penggunaId, ...(judul ? { judul } : {}) }, orderBy: { dibuatPada: "asc" } });
const sesiDari = async (namaPengguna: string) => {
  const s = await sebagai(namaPengguna, () => penggunaSaatIni());
  if (!s) throw new Error(`sesi ${namaPengguna} tidak terbaca`);
  return s;
};

/** Pemicu sementara yang membuat sisipan Notifikasi gagal di basis data (uji G14 lewat aksi nyata). */
const PEMICU_GAGAL = "ujin_notifikasi_gagal";
async function buangPemicuGagal() {
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PEMICU_GAGAL} ON "Notifikasi"`);
  await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${PEMICU_GAGAL}()`);
}

async function bersihkan() {
  await buangPemicuGagal();
  await db.hakAksesPeran.deleteMany({ where: { OR: [{ peran: "ADMIN", hak: { in: ["faktur.setujui", "kas-masuk.setujui"] } }] } });
  // dokumen uji: kas, faktur dan pesanan, peminjaman, beserta jurnalnya
  const kas = await db.dokumenKas.findMany({ where: { keterangan: { startsWith: KET_KAS } }, select: { id: true, jurnalId: true, nomor: true } });
  const faktur = await db.fakturPenjualan.findMany({ where: { pelanggan: { kode: "UJIN-CUST" } }, select: { id: true, jurnalId: true, nomor: true } });
  const pesanan = await db.pesananPenjualan.findMany({ where: { pelanggan: { kode: "UJIN-CUST" } }, select: { nomor: true } });
  const pinjam = await db.peminjamanBarang.findMany({ where: { gudang: { kode: "UJIN-WH" } }, select: { nomor: true } });
  const nomorUji = [...kas, ...faktur, ...pesanan, ...pinjam].map((d) => d.nomor);
  // notifikasi dan log suite ini untuk pengguna di luar ujin-* (pemeriksa bawaan seed); milik ujin-* ikut terhapus Cascade
  await db.notifikasi.deleteMany({ where: { OR: [{ judul: { contains: "UJIN" } }, ...nomorUji.flatMap((n) => [{ judul: { endsWith: ` ${n}` } }, { judul: { contains: ` ${n} ` } }])] } });
  await db.logAktivitas.deleteMany({ where: { OR: [{ nomor: { startsWith: "UJIN" } }, { nomor: { in: nomorUji } }] } });
  const jurnalIds = [...kas, ...faktur].map((d) => d.jurnalId).filter((x): x is string => !!x);
  await db.dokumenKas.deleteMany({ where: { id: { in: kas.map((k) => k.id) } } });
  await db.barisFakturPenjualan.deleteMany({ where: { faktur: { pelanggan: { kode: "UJIN-CUST" } } } });
  await db.fakturPenjualan.deleteMany({ where: { pelanggan: { kode: "UJIN-CUST" } } });
  await db.barisPesananPenjualan.deleteMany({ where: { pesanan: { pelanggan: { kode: "UJIN-CUST" } } } });
  await db.pesananPenjualan.deleteMany({ where: { pelanggan: { kode: "UJIN-CUST" } } });
  await db.barisJurnal.deleteMany({ where: { jurnalId: { in: jurnalIds } } });
  await db.jurnal.deleteMany({ where: { id: { in: jurnalIds } } });
  await db.foto.deleteMany({ where: { peminjaman: { gudang: { kode: "UJIN-WH" } } } });
  await db.barisPeminjamanBarang.deleteMany({ where: { peminjaman: { gudang: { kode: "UJIN-WH" } } } });
  await db.peminjamanBarang.deleteMany({ where: { gudang: { kode: "UJIN-WH" } } });
  // CRM uji
  await db.tindakLanjut.deleteMany({ where: { judul: { startsWith: "UJIN " } } });
  await db.lead.deleteMany({ where: { nama: { startsWith: "UJIN " } } });
  await db.tahapLead.deleteMany({ where: { nama: "UJIN Tahap" } });
  // data induk dan pengguna uji (notifikasi dan sesi pengguna uji ikut terhapus, Cascade)
  await db.barang.deleteMany({ where: { kode: { in: ["UJIN-BRG", "UJIN-JASA"] } } });
  await db.gudang.deleteMany({ where: { kode: "UJIN-WH" } });
  await db.pelanggan.deleteMany({ where: { kode: "UJIN-CUST" } });
  await db.akun.deleteMany({ where: { kode: { in: ["UJIN-KAS", "UJIN-PDPT"] } } });
  await db.pengguna.deleteMany({ where: { namaPengguna: { startsWith: P } } });
  await db.perusahaan.deleteMany({ where: { kode: "UJINA" } });
}

async function buatPengguna(nama: string, peran: PeranPengguna, ekstra: { aktif?: boolean; peranTambahan?: PeranPengguna[] } = {}) {
  return db.pengguna.create({
    data: { nama, namaPengguna: `${P}${nama.toLowerCase().replace(/\s+/g, "-")}`, nomorTelepon: "+6281299990000", kataSandiHash: await hashKataSandi("rahasia123"), peran, ...ekstra },
  });
}

async function main() {
  await bersihkan();
  pastikan((await db.hakAksesPeran.count()) === 0, "HakAksesPeran kosong sebelum suite mulai");
  const sinkronAwal = JSON.stringify(await periksaSinkron(db));
  const idSeed = (await db.pengguna.findMany({ where: { NOT: { namaPengguna: { startsWith: P } } }, select: { id: true } })).map((p) => p.id);
  const mulaiUji = new Date();
  try {
    console.log("=== 0. Persiapan ===");
    const pemilik = await buatPengguna("Pemilik", "PEMILIK");
    const admin = await buatPengguna("Admin", "ADMIN");
    const kasir = await buatPengguna("Kasir", "KASIR");
    const desainer = await buatPengguna("Desainer", "DESAINER");
    const gudang = await buatPengguna("Gudang", "GUDANG");
    const nonaktif = await buatPengguna("Nonaktif", "ADMIN", { aktif: false });
    const kasirDesainer = await buatPengguna("Kasir Desainer", "KASIR", { peranTambahan: ["DESAINER"] });
    const superadmin = await buatPengguna("Superadmin", "SUPERADMIN");
    pastikan(kasirDesainer.namaPengguna === `${P}kasir-desainer`, "pengguna uji ujin-* dibuat");

    console.log("=== 1. kirimNotifikasi ===");
    const n1 = await kirimNotifikasi(db, { penggunaIds: [admin.id, admin.id, null, "", "skrip-uji", nonaktif.id, pemilik.id], kecuali: pemilik.id, judul: "  UJIN satu  ", jenis: "STATUS" });
    pastikan(n1 === 1 && (await notif(admin.id, "UJIN satu")).length === 1, "duplikat, null, kosong, skrip-uji, nonaktif, dan pelaku dibuang: 1 baris untuk admin");
    pastikan((await notif(nonaktif.id)).length === 0 && (await notif(pemilik.id)).length === 0, "nonaktif dan pelaku tidak menerima");
    pastikan((await kirimNotifikasi(db, { penggunaIds: [null, "skrip-uji"], judul: "UJIN kosong", jenis: "STATUS" })) === 0, "tanpa penerima sah: 0");
    for (const [t, harap] of [["https://luar.contoh/x", null], ["//x", null], ["crm", null], ["/\\x", null], ["/\t/x", null], ["/\\luar.contoh/x", null], ["/a\nb", null], ["/a\u007fb", null], ["/crm/lead/1", "/crm/lead/1"], [" /penjualan/faktur?q=1 ", "/penjualan/faktur?q=1"]] as const) {
      const judul = `UJIN tautan ${JSON.stringify(t)}`;
      await kirimNotifikasi(db, { penggunaIds: [admin.id], judul, tautan: t, jenis: "STATUS" });
      const [b] = await notif(admin.id, judul);
      pastikan(b.tautan === harap, `tautan ${JSON.stringify(t)} disimpan ${harap ?? "null"}`);
    }
    for (const t of ["/\\x", "/\t/x", "/a\u007fb"]) {
      await harusDitolak(`CHECK basis data untuk tautan ${JSON.stringify(t)}`, () => db.notifikasi.create({ data: { penggunaId: admin.id, judul: "UJIN tautan mentah", tautan: t, jenis: "STATUS" } }), "Notifikasi_tautan_tanpa_kendali");
    }
    pastikan((await notif(admin.id, "UJIN tautan mentah")).length === 0, "sisipan mentah bertautan berbahaya tidak tersimpan");
    await kirimNotifikasi(db, { penggunaIds: [admin.id], judul: `UJIN ${"j".repeat(195)}`, isi: "i".repeat(800), jenis: "STATUS" });
    const panjang = (await db.notifikasi.findFirstOrThrow({ where: { penggunaId: admin.id, judul: { startsWith: "UJIN jjj" } } }));
    pastikan(panjang.judul.length === 120 && panjang.judul.endsWith("…") && panjang.isi?.length === 500, "judul 200 karakter jadi 120 dengan …, isi 800 jadi 500");
    await harusDitolak("judul kosong", () => kirimNotifikasi(db, { penggunaIds: [admin.id], judul: "   ", jenis: "STATUS" }), "Judul notifikasi kosong");
    const k1 = await kirimNotifikasi(db, { penggunaIds: [admin.id], judul: "UJIN kunci", jenis: "JATUH_TEMPO", kunci: "ujin:kunci:1" });
    const k2 = await kirimNotifikasi(db, { penggunaIds: [admin.id], judul: "UJIN kunci", jenis: "JATUH_TEMPO", kunci: "ujin:kunci:1" });
    pastikan(k1 === 1 && k2 === 0 && (await notif(admin.id, "UJIN kunci")).length === 1, "kunci sama dua kali: kedua 0, total 1");
    await harusDitolak("transaksi dibatalkan", () => db.$transaction(async (tx) => {
      await kirimNotifikasi(tx, { penggunaIds: [admin.id], judul: "UJIN batal", jenis: "STATUS" });
      throw new Error("batal sengaja");
    }), "batal sengaja");
    pastikan((await notif(admin.id, "UJIN batal")).length === 0, "sisipan di transaksi yang dibatalkan tidak tersimpan");

    console.log("=== 2. penggunaDenganHak ===");
    const ids = async (hak: Parameters<typeof penggunaDenganHak>[1], opsi?: { tanpaSuperadmin?: boolean }) => new Set((await penggunaDenganHak(db, hak, opsi)).map((p) => p.id));
    const setujuiFaktur = await ids("faktur.setujui");
    pastikan(setujuiFaktur.has(pemilik.id) && setujuiFaktur.has(admin.id) && setujuiFaktur.has(superadmin.id), "faktur.setujui memuat pemilik, admin, superadmin");
    pastikan(![kasir, desainer, gudang, nonaktif, kasirDesainer].some((p) => setujuiFaktur.has(p.id)), "faktur.setujui tidak memuat kasir, desainer, gudang, nonaktif, kasir-desainer");
    await db.hakAksesPeran.create({ data: { peran: "ADMIN", hak: "faktur.setujui", boleh: false } });
    try {
      pastikan(!(await ids("faktur.setujui")).has(admin.id), "penyesuaian ADMIN faktur.setujui=false: admin tidak termuat");
    } finally {
      await db.hakAksesPeran.deleteMany({ where: { peran: "ADMIN", hak: "faktur.setujui" } });
    }
    pastikan((await ids("faktur.setujui")).has(admin.id) && (await db.hakAksesPeran.count()) === 0, "penyesuaian dihapus: admin termuat lagi");
    const ubahDesain = await ids("tugas-desain.ubah");
    pastikan(ubahDesain.has(desainer.id) && ubahDesain.has(kasirDesainer.id) && ubahDesain.has(admin.id) && !ubahDesain.has(kasir.id), "tugas-desain.ubah memuat desainer, kasir-desainer (lewat tambahan), admin; tidak memuat kasir");
    const gabungan = await ids("perusahaan-gabungan.lihat");
    pastikan(gabungan.has(desainer.id) && gabungan.has(gudang.id) && !gabungan.has(kasirDesainer.id) && !gabungan.has(kasir.id), "perusahaan-gabungan.lihat tidak datang dari peran tambahan (sama dengan hak sesi)");
    const sesiKasirDesainer = await sesiDari(`${P}kasir-desainer`);
    pastikan(sesiKasirDesainer.hak.includes("tugas-desain.ubah") && !sesiKasirDesainer.hak.includes("perusahaan-gabungan.lihat"), "hak sesi kasir-desainer sejalan dengan penggunaDenganHak");
    const tanpaSa = await ids("faktur.setujui", { tanpaSuperadmin: true });
    pastikan(!tanpaSa.has(superadmin.id) && tanpaSa.has(pemilik.id), "tanpaSuperadmin membuang Superadmin");
    const contoh = [{ id: "a", peran: "SUPERADMIN" as PeranPengguna }];
    pastikan(tanpaSuperadminKecualiKosong(contoh).length === 1 && tanpaSuperadminKecualiKosong([...contoh, { id: "b", peran: "PEMILIK" as PeranPengguna }]).map((p) => p.id).join() === "b", "tanpaSuperadmin tetap memuat Superadmin bila hasilnya jadi kosong");

    console.log("=== 3. Maker-checker ===");
    aturPersetujuan(true);
    const akunKas = await db.akun.create({ data: { kode: "UJIN-KAS", nama: "Kas Uji Notifikasi", jenis: "ASET", kasBank: true } });
    const akunPdpt = await db.akun.create({ data: { kode: "UJIN-PDPT", nama: "Pendapatan Uji Notifikasi", jenis: "PENDAPATAN" } });
    await sebagai(`${P}kasir`, () => jalankan("kasir membuat Kas Masuk (DRAFT)", () => buatKasMasuk(formulir({ akunKasId: akunKas.id, akunLawanId: akunPdpt.id, jumlah: 150000, keterangan: `${KET_KAS} masuk` }))));
    const km = await db.dokumenKas.findFirstOrThrow({ where: { keterangan: `${KET_KAS} masuk` } });
    pastikan(km.statusPersetujuan === "DRAFT", "Kas Masuk DRAFT");
    pastikan((await db.notifikasi.count({ where: { dibuatPada: { gte: mulaiUji }, judul: { contains: km.nomor } } })) === 0, "membuat DRAFT tidak memberi tahu siapa pun");
    await sebagai(`${P}kasir`, () => jalankan("kasir mengajukan Kas Masuk", () => ajukanDokumen("dokumenKas", km.id)));
    const judulAjukan = `Persetujuan diminta: Kas Masuk ${km.nomor}`;
    for (const p of [pemilik, admin]) {
      const [n, ...lebih] = await notif(p.id, judulAjukan);
      pastikan(n && lebih.length === 0 && n.jenis === "PERSETUJUAN" && n.tautan === "/persetujuan" && n.perusahaanId === km.perusahaanId && n.isi === "Diajukan oleh Kasir", `${p.namaPengguna} tepat 1 notifikasi "${judulAjukan}", tautan /persetujuan, perusahaan dokumen`);
    }
    for (const p of [kasir, desainer, superadmin]) pastikan((await notif(p.id, judulAjukan)).length === 0, `${p.namaPengguna} tidak mendapat permintaan persetujuan`);
    await sebagai(`${P}admin`, () => jalankan("admin menyetujui Kas Masuk", () => setujuiDokumen("dokumenKas", km.id)));
    const [nSetuju] = await notif(kasir.id, `Kas Masuk ${km.nomor} disetujui`);
    pastikan(nSetuju?.jenis === "HASIL_PERSETUJUAN" && nSetuju.tautan === "/kas-bank/masuk" && nSetuju.isi === "Disetujui oleh Admin", "kasir mendapat \"Kas Masuk ... disetujui\", tautan /kas-bank/masuk");
    pastikan((await notif(admin.id, `Kas Masuk ${km.nomor} disetujui`)).length === 0, "penyetuju tidak memberi tahu dirinya sendiri");

    await sebagai(`${P}kasir`, () => jalankan("kasir membuat Kas Keluar (DRAFT)", () => buatKasKeluar(formulir({ akunKasId: akunKas.id, akunLawanId: akunPdpt.id, jumlah: 50000, keterangan: `${KET_KAS} keluar` }))));
    const kk = await db.dokumenKas.findFirstOrThrow({ where: { keterangan: `${KET_KAS} keluar` } });
    await sebagai(`${P}kasir`, () => jalankan("kasir mengajukan Kas Keluar", () => ajukanDokumen("dokumenKas", kk.id)));
    pastikan((await notif(pemilik.id, `Persetujuan diminta: Kas Keluar ${kk.nomor}`)).length === 1, "pemilik mendapat permintaan Kas Keluar (label per jenis kas)");
    await sebagai(`${P}pemilik`, () => jalankan("pemilik menolak Kas Keluar", () => tolakDokumen("dokumenKas", kk.id, "Nominal salah")));
    const [nTolak] = await notif(kasir.id, `Kas Keluar ${kk.nomor} ditolak`);
    pastikan(nTolak?.isi === "Alasan: Nominal salah" && nTolak.tautan === "/kas-bank/keluar" && nTolak.jenis === "HASIL_PERSETUJUAN", "kasir mendapat \"Kas Keluar ... ditolak\", isi Alasan: Nominal salah, tautan /kas-bank/keluar");
    const logKm = (await db.logAktivitas.findMany({ where: { nomor: km.nomor, waktu: { gte: mulaiUji } }, orderBy: { waktu: "asc" } })).map((l) => l.aksi);
    const logKk = (await db.logAktivitas.findMany({ where: { nomor: kk.nomor, waktu: { gte: mulaiUji } }, orderBy: { waktu: "asc" } })).map((l) => l.aksi);
    pastikan(logKm.join() === "AJUKAN,SETUJUI" && logKk.join() === "AJUKAN,TOLAK", `log per nomor tetap hanya AJUKAN + SETUJUI/TOLAK (${logKm.join()} | ${logKk.join()})`);
    pastikan(tautanDokumenPersetujuan("faktur", "faktur") === "/penjualan/faktur" && tautanDokumenPersetujuan("dokumenKas", "kas-keluar") === "/kas-bank/keluar", "tautan dokumen per jenis");

    const wh = await db.gudang.create({ data: { kode: "UJIN-WH", nama: "Gudang Uji Notifikasi" } });
    const brg = await db.barang.create({ data: { kode: "UJIN-BRG", nama: "Barang Uji Notifikasi", jenis: "BARANG", hargaBeli: 0, hargaJual: 0 } });
    const fdPinjam = formulir({ gudangId: wh.id, namaPengambil: "Gudang Uji", nomorTelepon: "+6281234567890", baris: [{ barangId: brg.id, jumlah: 1 }] });
    fdPinjam.append("foto", new File([new Uint8Array(JPEG_PALSU)], "UJIN-bukti.jpg", { type: "image/jpeg" }));
    await sebagai(`${P}gudang`, () => jalankan("gudang membuat peminjaman (DRAFT)", () => buatPeminjamanBarang(fdPinjam)));
    const pj = await db.peminjamanBarang.findFirstOrThrow({ where: { gudangId: wh.id } });
    await sebagai(`${P}gudang`, () => jalankan("gudang mengajukan peminjaman", () => ajukanDokumen("peminjaman", pj.id)));
    const judulPj = `Persetujuan diminta: Peminjaman Barang ${pj.nomor}`;
    const [nPj] = await notif(pemilik.id, judulPj);
    pastikan(nPj?.tautan === "/persediaan/peminjaman", "peminjaman Gudang: pemilik dapat, tautan /persediaan/peminjaman");
    pastikan(punyaPeminjamanSetujui(await sesiDari(`${P}admin`)) && (await notif(admin.id, judulPj)).length === 0, "admin (punya peminjaman.setujui) tidak dapat karena hanya Pemilik/Superadmin yang boleh menyetujui pengajuan Gudang");
    const penerimaPj = await db.notifikasi.findMany({ where: { judul: judulPj }, select: { pengguna: { select: { peran: true } } } });
    pastikan(penerimaPj.length > 0 && penerimaPj.every((n) => n.pengguna.peran === "PEMILIK"), "semua penerima peminjaman Gudang berperan utama Pemilik (Superadmin dibuang karena ada Pemilik)");

    console.log("=== 3a. Pemilik tunggal mengajukan lewat ajukanDokumen: Superadmin tetap menerima ===");
    // Pemegang kas-masuk.setujui dibuat hanya pelaku (Pemilik uji) dan Superadmin: ADMIN dimatikan lewat HakAksesPeran,
    // Pemilik lain (termasuk bawaan seed) dinonaktifkan sementara dan dipulihkan di finally.
    const pemilikLain = (await db.pengguna.findMany({ where: { peran: "PEMILIK", aktif: true, id: { not: pemilik.id } }, select: { id: true } })).map((p) => p.id);
    await db.hakAksesPeran.create({ data: { peran: "ADMIN", hak: "kas-masuk.setujui", boleh: false } });
    await db.pengguna.updateMany({ where: { id: { in: pemilikLain } }, data: { aktif: false } });
    try {
      const pemegang = await penggunaDenganHak(db, "kas-masuk.setujui");
      pastikan(pemegang.some((p) => p.id === pemilik.id) && pemegang.every((p) => p.id === pemilik.id || p.peran === "SUPERADMIN"), "pemegang kas-masuk.setujui hanya Pemilik uji dan Superadmin");
      await sebagai(`${P}pemilik`, () => jalankan("pemilik membuat Kas Masuk (DRAFT)", () => buatKasMasuk(formulir({ akunKasId: akunKas.id, akunLawanId: akunPdpt.id, jumlah: 70000, keterangan: `${KET_KAS} tunggal` }))));
      const kmT = await db.dokumenKas.findFirstOrThrow({ where: { keterangan: `${KET_KAS} tunggal` } });
      await sebagai(`${P}pemilik`, () => jalankan("pemilik tunggal mengajukan Kas Masuk", () => ajukanDokumen("dokumenKas", kmT.id)));
      const judulT = `Persetujuan diminta: Kas Masuk ${kmT.nomor}`;
      const penerimaT = await db.notifikasi.findMany({ where: { judul: judulT }, select: { penggunaId: true, isi: true, pengguna: { select: { peran: true } } } });
      pastikan((await notif(superadmin.id, judulT)).length === 1 && (await notif(pemilik.id, judulT)).length === 0, "Superadmin uji menerima permintaan, pelaku tidak");
      pastikan(penerimaT.length > 0 && penerimaT.every((n) => n.pengguna.peran === "SUPERADMIN" && n.isi === "Diajukan oleh Pemilik"), `semua penerima Superadmin (${penerimaT.length}), isi "Diajukan oleh Pemilik"`);
    } finally {
      await db.pengguna.updateMany({ where: { id: { in: pemilikLain } }, data: { aktif: true } });
      await db.hakAksesPeran.deleteMany({ where: { peran: "ADMIN", hak: "kas-masuk.setujui" } });
    }
    pastikan((await db.pengguna.count({ where: { id: { in: pemilikLain }, aktif: true } })) === pemilikLain.length && (await db.hakAksesPeran.count()) === 0, "Pemilik lain aktif lagi dan HakAksesPeran kosong");

    console.log("=== 3b. Galat notifikasi tidak menggagalkan transaksi (SAVEPOINT) ===");
    const pelakuPemilik = await sesiDari(`${P}pemilik`);
    const hasilGagal = await db.$transaction(async (tx) => {
      const rusak = new Proxy(tx, {
        get(t, k) {
          if (k === "notifikasi") return { createMany: async () => t.$executeRawUnsafe("SELECT 1/0") };
          const v = Reflect.get(t, k, t);
          return typeof v === "function" ? v.bind(t) : v;
        },
      }) as Prisma.TransactionClient;
      const jumlah = await beritahuPersetujuan(rusak, { aksi: "SETUJUI", jenis: "faktur", id: "tidak-ada", pelaku: pelakuPemilik, nomor: "UJIN-G14", pengajuId: admin.id });
      await tx.logAktivitas.create({ data: { penggunaNama: "Uji", aksi: "UJIN", jenis: "Uji", nomor: "UJIN-G14", keterangan: "sesudah galat notifikasi" } });
      return jumlah;
    });
    pastikan(hasilGagal === 0 && (await db.logAktivitas.count({ where: { nomor: "UJIN-G14" } })) === 1, "galat SQL di notifikasi dibatalkan ke SAVEPOINT; kueri sesudahnya dan commit tetap jalan");
    pastikan((await notif(admin.id, "Faktur Penjualan UJIN-G14 disetujui")).length === 0, "notifikasi yang gagal tidak tersimpan");
    const hasilBaik = await db.$transaction((tx) => beritahuPersetujuan(tx, { aksi: "SETUJUI", jenis: "faktur", id: "tidak-ada", pelaku: pelakuPemilik, nomor: "UJIN-G14", pengajuId: admin.id }));
    const [nBaik] = await notif(admin.id, "Faktur Penjualan UJIN-G14 disetujui");
    pastikan(hasilBaik === 1 && nBaik?.perusahaanId === null && nBaik.tautan === "/penjualan/faktur", "kontrol: tanpa galat, notifikasi tersimpan (dokumen tidak ada: perusahaan null)");

    console.log("=== 3c. Sisipan notifikasi gagal di basis data saat setujuiDokumen: dokumen tetap disetujui (G14) ===");
    await sebagai(`${P}kasir`, () => jalankan("kasir membuat Kas Masuk G14", () => buatKasMasuk(formulir({ akunKasId: akunKas.id, akunLawanId: akunPdpt.id, jumlah: 30000, keterangan: `${KET_KAS} g14` }))));
    const kmG = await db.dokumenKas.findFirstOrThrow({ where: { keterangan: `${KET_KAS} g14` } });
    await sebagai(`${P}kasir`, () => jalankan("kasir mengajukan Kas Masuk G14", () => ajukanDokumen("dokumenKas", kmG.id)));
    await db.$executeRawUnsafe(`CREATE FUNCTION ${PEMICU_GAGAL}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'notifikasi uji gagal'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER ${PEMICU_GAGAL} BEFORE INSERT ON "Notifikasi" FOR EACH ROW WHEN (NEW."penggunaId" = '${kasir.id}') EXECUTE FUNCTION ${PEMICU_GAGAL}()`);
    try {
      await harusDitolak("kontrol: pemicu menolak sisipan notifikasi untuk kasir", () => kirimNotifikasi(db, { penggunaIds: [kasir.id], judul: "UJIN pemicu", jenis: "STATUS" }), "notifikasi uji gagal");
      await sebagai(`${P}admin`, () => jalankan("admin menyetujui Kas Masuk G14 saat sisipan notifikasi gagal", () => setujuiDokumen("dokumenKas", kmG.id)));
    } finally {
      await buangPemicuGagal();
    }
    const kmGSetelah = await db.dokumenKas.findUniqueOrThrow({ where: { id: kmG.id } });
    pastikan(kmGSetelah.statusPersetujuan === "DISETUJUI" && !!kmGSetelah.jurnalId && kmGSetelah.disetujuiOlehId === admin.id, "Kas Masuk G14 tetap DISETUJUI dengan jurnal dan penyetuju");
    pastikan((await db.logAktivitas.count({ where: { nomor: kmG.nomor, aksi: "SETUJUI", waktu: { gte: mulaiUji } } })) === 1, "log SETUJUI Kas Masuk G14 tercatat");
    pastikan((await notif(kasir.id, `Kas Masuk ${kmG.nomor} disetujui`)).length === 0, "notifikasi hasil yang gagal tidak tersimpan");
    pastikan((await kirimNotifikasi(db, { penggunaIds: [kasir.id], judul: "UJIN pemicu", jenis: "STATUS" })) === 1, "pemicu sudah dibuang: sisipan untuk kasir berhasil lagi");

    console.log("=== 3d. Tautan antrean Laporan Kerusakan ===");
    const pelakuGudang = await sesiDari(`${P}gudang`);
    const jumlahKr = await db.$transaction((tx) => beritahuPersetujuan(tx, { aksi: "AJUKAN", jenis: "kerusakan", id: "tidak-ada", pelaku: pelakuGudang, nomor: "UJIN-KR", pengajuId: gudang.id }));
    const nKr = await db.notifikasi.findMany({ where: { judul: { endsWith: " UJIN-KR" } } });
    const nKrPemilik = nKr.find((n) => n.penggunaId === pemilik.id);
    pastikan(jumlahKr > 0 && nKrPemilik?.tautan === "/persediaan/kerusakan" && nKrPemilik.judul.startsWith("Persetujuan diminta: ") && nKr.every((n) => n.tautan === "/persediaan/kerusakan" && n.penggunaId !== gudang.id), "pengajuan Laporan Kerusakan menautkan ke /persediaan/kerusakan, pelaku tidak menerima");
    aturPersetujuan(false);

    console.log("=== 4. Pengingat faktur ===");
    const pelanggan = await db.pelanggan.create({ data: { kode: "UJIN-CUST", nama: "Pelanggan Uji Notifikasi" } });
    const jasa = await db.barang.create({ data: { kode: "UJIN-JASA", nama: "Jasa Uji Notifikasi", jenis: "JASA", hargaBeli: 0, hargaJual: 100000 } });
    await sebagai(`${P}kasir`, () => jalankan("kasir membuat pesanan jasa 10", () => buatPesanan(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: jasa.id, jumlah: 10, harga: 100000 }] }))));
    const pesanan = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id } });
    const fakturBaru = async (label: string) => {
      const sebelum = new Set((await db.fakturPenjualan.findMany({ where: { pelangganId: pelanggan.id }, select: { id: true } })).map((f) => f.id));
      await sebagai(`${P}kasir`, () => jalankan(`kasir membuat faktur ${label}`, () => buatFaktur(formulir({ pesananId: pesanan.id, baris: [{ barangId: jasa.id, jumlah: 1, harga: 100000 }] }))));
      const f = (await db.fakturPenjualan.findMany({ where: { pelangganId: pelanggan.id } })).find((x) => !sebelum.has(x.id));
      if (!f) throw new Error(`faktur ${label} tidak terbuat`);
      return f;
    };
    const sekarang = new Date();
    const hariIni = tanggalIso(sekarang);
    const geserHari = (n: number) => tanggalIso(new Date(sekarang.getTime() + n * 86_400_000));
    const f1 = await fakturBaru("F1");
    pastikan(f1.diajukanOlehId === kasir.id && f1.statusPersetujuan === "DISETUJUI", "faktur F1 disetujui langsung, pengaju = kasir");
    await db.fakturPenjualan.update({ where: { id: f1.id }, data: { jatuhTempo: new Date(`${geserHari(-1)}T12:00:00+07:00`) } });
    const sesiKasir = await sesiDari(`${P}kasir`);
    const kunciF = (id: string) => db.notifikasi.findMany({ where: { penggunaId: kasir.id, kunci: `${AWALAN_KUNCI_FAKTUR}${id}` } });
    pastikan((await periksaPengingat(sesiKasir, { paksa: true })) === 1, "F1 jatuh tempo kemarin: 1 pengingat");
    const [nF1] = await kunciF(f1.id);
    pastikan(nF1?.jenis === "JATUH_TEMPO" && nF1.judul === "Faktur jatuh tempo" && nF1.tautan === "/penjualan/faktur" && nF1.perusahaanId === f1.perusahaanId && !!nF1.isi?.startsWith(`${f1.nomor} · Pelanggan Uji Notifikasi · jatuh tempo`), "isi, tautan, kunci, dan perusahaan pengingat F1");
    pastikan((await periksaPengingat(sesiKasir, { paksa: true })) === 0 && (await kunciF(f1.id)).length === 1, "dipanggil lagi: tetap 1 (sekali per faktur)");
    const f2 = await fakturBaru("F2");
    await db.fakturPenjualan.update({ where: { id: f2.id }, data: { jatuhTempo: new Date(`${geserHari(-3)}T09:00:00+07:00`) } });
    pastikan((await periksaPengingat(sesiKasir)) === 0 && (await kunciF(f2.id)).length === 0, "tanpa paksa dalam 60 detik: tidak memeriksa (F2 belum diingatkan)");
    pastikan((await periksaPengingat(sesiKasir, { paksa: true })) === 1 && (await kunciF(f2.id)).length === 1, "dengan paksa: F2 diingatkan");
    const f3 = await fakturBaru("F3");
    await db.fakturPenjualan.update({ where: { id: f3.id }, data: { jatuhTempo: new Date(`${geserHari(1)}T12:00:00+07:00`) } });
    const f4 = await fakturBaru("F4");
    await db.fakturPenjualan.update({ where: { id: f4.id }, data: { jatuhTempo: new Date(`${geserHari(-2)}T12:00:00+07:00`), status: "LUNAS" } });
    const f5 = await fakturBaru("F5");
    await db.fakturPenjualan.update({ where: { id: f5.id }, data: { jatuhTempo: new Date(`${hariIni}T12:00:00+07:00`) } });
    pastikan((await periksaPengingat(sesiKasir, { paksa: true })) === 1, "F3 besok tidak, F4 lunas tidak, F5 hari ini 12.00 WIB ya");
    pastikan((await kunciF(f3.id)).length === 0 && (await kunciF(f4.id)).length === 0 && (await kunciF(f5.id)).length === 1, "pengingat F3/F4/F5 sesuai");
    const f6 = await fakturBaru("F6");
    await db.fakturPenjualan.update({ where: { id: f6.id }, data: { jatuhTempo: new Date(`${geserHari(-1)}T08:00:00+07:00`) } });
    const kasirTanpaFaktur = { ...sesiKasir, hak: sesiKasir.hak.filter((h) => h !== "faktur.lihat") };
    pastikan((await periksaPengingat(kasirTanpaFaktur, { paksa: true })) === 0 && (await kunciF(f6.id)).length === 0, "pengaju tanpa faktur.lihat: tidak ada pengingat");
    pastikan((await periksaPengingat(sesiKasir, { paksa: true })) === 1 && (await kunciF(f6.id)).length === 1, "kontrol: dengan faktur.lihat, F6 diingatkan");
    const sesiAdmin = await sesiDari(`${P}admin`);
    pastikan((await periksaPengingat(sesiAdmin, { paksa: true })) === 0, "pengguna yang bukan pengaju faktur tidak diingatkan");
    pastikan((await periksaPengingat({ ...sesiKasir, id: "skrip-uji" }, { paksa: true })) === 0, "pengguna skrip-uji diabaikan");
    const f7 = await fakturBaru("F7");
    await db.fakturPenjualan.update({ where: { id: f7.id }, data: { jatuhTempo: new Date(`${geserHari(-2)}T12:00:00+07:00`), status: "DIBATALKAN" } });
    pastikan((await periksaPengingat(sesiKasir, { paksa: true })) === 0 && (await kunciF(f7.id)).length === 0, "F7 DIBATALKAN: tidak diingatkan");
    // batas 50 per pemeriksaan (DESAIN R-15): 51 faktur jatuh tempo dibuat langsung tanpa baris dan jurnal
    const contohF = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: f6.id } });
    await db.fakturPenjualan.createMany({
      data: Array.from({ length: 51 }, (_, i) => ({
        nomor: `UJIN-FB-${String(i).padStart(2, "0")}`, pelangganId: pelanggan.id, perusahaanId: contohF.perusahaanId, status: contohF.status,
        statusPersetujuan: "DISETUJUI" as const, diajukanOlehId: kasir.id, jatuhTempo: new Date(`${geserHari(-5)}T12:00:00+07:00`),
      })),
    });
    pastikan((await periksaPengingat(sesiKasir, { paksa: true })) === 50, "51 faktur jatuh tempo: pemeriksaan pertama tepat 50 (BATAS_PENGINGAT)");
    pastikan((await periksaPengingat(sesiKasir, { paksa: true })) === 1, "pemeriksaan kedua: sisanya 1");
    pastikan((await periksaPengingat(sesiKasir, { paksa: true })) === 0 && (await db.notifikasi.count({ where: { penggunaId: kasir.id, kunci: { startsWith: AWALAN_KUNCI_FAKTUR } } })) === 55, "pemeriksaan ketiga: 0, total kunci faktur kasir 55 (F1, F2, F5, F6, dan 51)");

    console.log("=== 4b. Pengingat tindak lanjut (D4 §3.5) ===");
    const tahap = await db.tahapLead.create({ data: { perusahaanId: "utama", nama: "UJIN Tahap", urutan: 99 } });
    const lead = (nama: string, perusahaanId = "utama") => db.lead.create({ data: { perusahaanId, nama, namaUsaha: "Usaha UJIN", telepon: "0812", whatsapp: "62812", sumber: "Uji", tahapId: tahap.id, dibuatOlehNama: "Uji" } });
    const leadAktif = await lead("UJIN Lead Aktif");
    const leadArsip = await lead("UJIN Lead Arsip");
    await db.lead.update({ where: { id: leadArsip.id }, data: { dihapusPada: new Date() } });
    const kini = new Date();
    const jam = (n: number) => new Date(kini.getTime() + n * 3_600_000);
    const tl = (judul: string, jatuhTempo: Date, ekstra: Partial<Prisma.TindakLanjutUncheckedCreateInput> = {}) =>
      db.tindakLanjut.create({ data: { judul, jatuhTempo, ditugaskanKeId: admin.id, dibuatOlehNama: "Uji", ...ekstra } });
    const judulTl = "Tindak lanjut jatuh tempo";
    const tlAdmin = () => db.notifikasi.findMany({ where: { penggunaId: admin.id, judul: judulTl }, orderBy: { dibuatPada: "asc" } });
    const t1 = await tl("UJIN T1", jam(-1));
    pastikan((await periksaPengingatTindakLanjut(admin.id, kini, { paksa: true })) === 1, "T1 lewat 1 jam: 1 notifikasi");
    const [nT1] = await tlAdmin();
    pastikan(nT1?.jenis === "TINDAK_LANJUT" && nT1.isi === "UJIN T1" && nT1.tautan === "/crm/tindak-lanjut" && nT1.perusahaanId === "utama", "isi judul, tautan /crm/tindak-lanjut tanpa lead, perusahaan tindak lanjut");
    pastikan((await db.tindakLanjut.findUniqueOrThrow({ where: { id: t1.id } })).diingatkanPada?.getTime() === kini.getTime(), "diingatkanPada T1 terisi");
    pastikan((await periksaPengingatTindakLanjut(admin.id, kini, { paksa: true })) === 0, "dipanggil lagi: 0");
    const t2 = await tl("UJIN T2", jam(-2), { leadId: leadAktif.id });
    const serentak = await Promise.all([periksaPengingatTindakLanjut(admin.id, kini, { paksa: true }), periksaPengingatTindakLanjut(admin.id, kini, { paksa: true })]);
    const nT2 = (await tlAdmin()).filter((n) => n.isi?.startsWith("UJIN T2"));
    pastikan(serentak[0] + serentak[1] === 1 && nT2.length === 1, `T2 dengan dua panggilan serentak: total tepat 1 (${serentak.join("+")})`);
    pastikan(nT2[0].isi === "UJIN T2 · UJIN Lead Aktif" && nT2[0].tautan === `/crm/lead/${leadAktif.id}`, "isi memuat nama lead, tautan ke lead");
    void t2;
    const t3 = await tl("UJIN T3", jam(24));
    pastikan((await periksaPengingatTindakLanjut(admin.id, kini, { paksa: true })) === 0, "T3 besok: tidak diingatkan");
    await db.tindakLanjut.update({ where: { id: t1.id }, data: { jatuhTempo: jam(-0.5), diingatkanPada: null } });
    pastikan((await periksaPengingatTindakLanjut(admin.id, kini, { paksa: true })) === 1, "jatuh tempo T1 diubah (diingatkanPada dikosongkan): diingatkan lagi (1)");
    await tl("UJIN T4", jam(-3), { status: "SELESAI", selesaiPada: kini });
    await tl("UJIN T6", jam(-3), { leadId: leadArsip.id });
    pastikan((await periksaPengingatTindakLanjut(admin.id, kini, { paksa: true })) === 0, "T4 SELESAI dan T6 milik lead terarsip: tidak diingatkan");
    await tl("UJIN T5", jam(-1));
    pastikan((await periksaPengingatTindakLanjut(admin.id, kini)) === 0, "T5 dengan panggilan tanpa paksa segera sesudahnya: 0 (pembatas 60 detik)");
    pastikan((await periksaPengingatTindakLanjut(admin.id, kini, { paksa: true })) === 1, "T5 dengan paksa: 1");
    pastikan((await periksaPengingatTindakLanjut(null, kini, { paksa: true })) === 0 && (await periksaPengingatTindakLanjut("skrip-uji", kini, { paksa: true })) === 0, "null dan skrip-uji: 0");
    await tl("UJIN T7", jam(-1), { ditugaskanKeId: nonaktif.id });
    pastikan((await periksaPengingatTindakLanjut(nonaktif.id, kini, { paksa: true })) === 0 && (await notif(nonaktif.id)).length === 0, "penerima nonaktif tidak mendapat notifikasi");
    const t8 = await tl("UJIN T8", jam(-1));
    pastikan(sesiAdmin.hak.includes("lead.lihat"), "admin memegang lead.lihat");
    const adminTanpaLead = { ...sesiAdmin, hak: sesiAdmin.hak.filter((h) => h !== "lead.lihat") };
    pastikan((await periksaPengingat(adminTanpaLead, { paksa: true, sekarang: kini })) === 0 && (await db.tindakLanjut.findUniqueOrThrow({ where: { id: t8.id } })).diingatkanPada === null, "periksaPengingat untuk penerima tanpa lead.lihat: T8 tidak diingatkan");
    pastikan((await periksaPengingat(sesiAdmin, { paksa: true, sekarang: kini })) === 1 && (await tlAdmin()).some((n) => n.isi === "UJIN T8"), "kontrol: dengan lead.lihat, T8 diingatkan lewat periksaPengingat");
    void t3;

    console.log("=== 5. Baca dan buka ===");
    const ringkas = await ringkasNotifikasi(db, admin.id, 8);
    const belumAdmin = await db.notifikasi.count({ where: { penggunaId: admin.id, dibaca: false } });
    pastikan(ringkas.belumDibaca === belumAdmin && belumAdmin > 8 && ringkas.terbaru.length === 8, `ringkasNotifikasi admin: belumDibaca ${belumAdmin}, terbaru 8`);
    pastikan(ringkas.terbaru.every((n, i) => i === 0 || ringkas.terbaru[i - 1].dibuatPada >= n.dibuatPada), "terbaru urut paling baru dulu");
    const namaUtama = (await db.perusahaan.findUniqueOrThrow({ where: { id: "utama" } })).nama;
    pastikan(ringkas.terbaru.some((n) => n.perusahaan?.nama === namaUtama), "nama perusahaan terisi untuk notifikasi berperusahaan");
    pastikan((await ringkasNotifikasi(db, "skrip-uji", 8)).belumDibaca === 0, "skrip-uji: ringkasan kosong");
    const idAdmin = nT1.id;
    await sebagai(`${P}kasir`, () => tandaiNotifikasiDibaca(idAdmin));
    pastikan(!(await db.notifikasi.findUniqueOrThrow({ where: { id: idAdmin } })).dibaca, "kasir menandai notifikasi admin: tidak berubah, tanpa galat");
    await sebagai(`${P}admin`, () => tandaiNotifikasiDibaca(idAdmin));
    const dibacaAdmin = await db.notifikasi.findUniqueOrThrow({ where: { id: idAdmin } });
    pastikan(dibacaAdmin.dibaca && !!dibacaAdmin.dibacaPada, "admin menandai miliknya: dibaca, dibacaPada terisi");
    const belumKasirSebelum = await db.notifikasi.count({ where: { penggunaId: kasir.id, dibaca: false } });
    await sebagai(`${P}admin`, () => jalankan("admin tandai semua dibaca", () => tandaiSemuaNotifikasiDibaca()));
    pastikan((await db.notifikasi.count({ where: { penggunaId: admin.id, dibaca: false } })) === 0, "semua notifikasi admin dibaca");
    pastikan(belumKasirSebelum > 0 && (await db.notifikasi.count({ where: { penggunaId: kasir.id, dibaca: false } })) === belumKasirSebelum, "notifikasi kasir tidak tersentuh");
    const milikKasir = nSetuju.id;
    pastikan((await sebagai(`${P}admin`, () => bukaNotifikasi(milikKasir))).tautan === null && !(await db.notifikasi.findUniqueOrThrow({ where: { id: milikKasir } })).dibaca, "admin membuka notifikasi kasir: { tautan: null }, tidak berubah");
    pastikan((await sebagai(`${P}admin`, () => bukaNotifikasi("tidak-ada"))).tautan === null, "id tidak ada: { tautan: null } tanpa galat");
    await sebagai(`${P}kasir`, () => jalankan("kasir membuka notifikasinya", () => bukaNotifikasi(milikKasir)));
    pastikan((await db.notifikasi.findUniqueOrThrow({ where: { id: milikKasir } })).dibaca, "bukaNotifikasi menandai dibaca");
    const dibuka = await tandaiDibuka(db, kasir.id, nTolak.id);
    pastikan(dibuka?.tautan === "/kas-bank/keluar" && dibuka.perusahaanId === kk.perusahaanId && (await db.notifikasi.findUniqueOrThrow({ where: { id: nTolak.id } })).dibaca, "tandaiDibuka (inti bukaNotifikasi) mengembalikan tautan dan perusahaan, lalu menandai dibaca");
    // notifikasi perusahaan lain dari lingkup utama: di luar HTTP tidak ada sesi peramban, jadi lingkup tidak diganti dan tidak gagal
    await kirimNotifikasi(db, { penggunaIds: [kasir.id], judul: "UJIN lingkup lain", jenis: "STATUS", tautan: "/penjualan/faktur", perusahaanId: "tapussa" });
    const [nLain] = await notif(kasir.id, "UJIN lingkup lain");
    await denganEnv({ UJI_PERUSAHAAN: "utama" }, () => sebagai(`${P}kasir`, () => jalankan("buka notifikasi perusahaan lain (tanpa sesi peramban)", () => bukaNotifikasi(nLain.id))));
    pastikan((await db.notifikasi.findUniqueOrThrow({ where: { id: nLain.id } })).dibaca, "notifikasi perusahaan lain tetap terbuka; penggantian lingkup lewat bukaNotifikasi dilewati di luar HTTP (diuji langsung di bawah)");

    console.log("=== 5b. aturPerusahaanAktif ===");
    const arsip = await db.perusahaan.create({ data: { kode: "UJINA", nama: "PT Uji Notifikasi Arsip", aktif: false, urutan: 97 } });
    const sesiBaru = async (penggunaId: string) => (await db.sesi.create({ data: { tokenHash: randomBytes(32).toString("hex"), penggunaId, kedaluwarsa: new Date(Date.now() + 3_600_000) } })).id;
    const sesiAdminId = await sesiBaru(admin.id);
    const sesiKasirId = await sesiBaru(kasir.id);
    const lingkupSesi = async (id: string) => (await db.sesi.findUniqueOrThrow({ where: { id } })).perusahaanAktifId;
    pastikan((await sebagai(`${P}admin`, () => aturPerusahaanAktif("tapussa", { sesiId: sesiAdminId }))) && (await lingkupSesi(sesiAdminId)) === "tapussa", "admin: lingkup sesi menjadi tapussa");
    pastikan((await sebagai(`${P}admin`, () => aturPerusahaanAktif(null, { sesiId: sesiAdminId }))) && (await lingkupSesi(sesiAdminId)) === null, "admin: null = gabungan");
    await harusDitolak("admin memilih perusahaan arsip", () => sebagai(`${P}admin`, () => aturPerusahaanAktif(arsip.id, { sesiId: sesiAdminId })), "sudah diarsipkan");
    await harusDitolak("simpanLingkupSesi perusahaan arsip (pembanding)", () => simpanLingkupSesi(db, sesiAdminId, arsip.id, sesiAdmin), "sudah diarsipkan");
    await harusDitolak("perusahaan tidak ada", () => sebagai(`${P}admin`, () => aturPerusahaanAktif("tidak-ada", { sesiId: sesiAdminId })), "Perusahaan tidak ditemukan");
    // notifikasi yang merujuk perusahaan arsip tetap bisa dibuka; penggantian lingkup yang ditolak tidak menggagalkannya
    await kirimNotifikasi(db, { penggunaIds: [kasir.id], judul: "UJIN perusahaan arsip", jenis: "STATUS", tautan: "/penjualan/faktur", perusahaanId: arsip.id });
    const [nArsip] = await notif(kasir.id, "UJIN perusahaan arsip");
    await denganEnv({ UJI_PERUSAHAAN: "utama" }, () => sebagai(`${P}kasir`, () => jalankan("kasir membuka notifikasi milik perusahaan arsip", () => bukaNotifikasi(nArsip.id))));
    pastikan((await db.notifikasi.findUniqueOrThrow({ where: { id: nArsip.id } })).dibaca && (await tandaiDibuka(db, kasir.id, nArsip.id))?.tautan === "/penjualan/faktur", "notifikasi perusahaan arsip terbuka tanpa galat dan tautannya tetap");
    pastikan((await lingkupSesi(sesiAdminId)) === null, "penolakan tidak mengubah lingkup sesi");
    await harusDitolak("kasir memilih gabungan", () => sebagai(`${P}kasir`, () => aturPerusahaanAktif(null, { sesiId: sesiKasirId })), "tidak punya hak");
    pastikan((await sebagai(`${P}kasir`, () => aturPerusahaanAktif("tapussa", { sesiId: sesiKasirId }))) && (await lingkupSesi(sesiKasirId)) === "tapussa", "kasir boleh memilih perusahaan aktif");
    await harusDitolak("sesi milik pengguna lain", () => sebagai(`${P}kasir`, () => aturPerusahaanAktif("utama", { sesiId: sesiAdminId })), "Sesi tidak ditemukan");
    pastikan((await sebagai(`${P}admin`, () => aturPerusahaanAktif("utama"))) === false, "tanpa sesi peramban (di luar HTTP): false tanpa perubahan");
    await harusDitolak("tanpa pengguna masuk", () => denganEnv({ UJI_TANPA_SESI: undefined }, () => aturPerusahaanAktif("utama")), "Sesi sudah berakhir");

    console.log("=== 6. Rute GET /api/notifikasi ===");
    const jawab = await denganEnv({ UJI_PENGGUNA: undefined, UJI_PERAN: undefined }, () => GET());
    const isi = (await jawab.json()) as { ok: boolean; belumDibaca: number; terbaru: unknown[] };
    pastikan(jawab.status === 200 && isi.ok === true && isi.belumDibaca === 0 && isi.terbaru.length === 0 && jawab.headers.get("cache-control") === "private, no-store", "pintu uji (skrip-uji): { ok: true, belumDibaca: 0, terbaru: [] }, private no-store");
    const jawabKasir = await sebagai(`${P}kasir`, () => GET());
    const isiKasir = (await jawabKasir.json()) as { ok: boolean; belumDibaca: number; terbaru: { id: string; dibuatPada: string; perusahaan: { nama: string } | null }[] };
    pastikan(isiKasir.ok && isiKasir.belumDibaca === (await db.notifikasi.count({ where: { penggunaId: kasir.id, dibaca: false } })) && isiKasir.terbaru.length > 0 && typeof isiKasir.terbaru[0].dibuatPada === "string", "pengguna nyata: jumlah belum dibaca dan daftar terbaru");
    const tanpaSesi = await denganEnv({ UJI_TANPA_SESI: undefined }, () => GET());
    pastikan(tanpaSesi.status === 401 && ((await tanpaSesi.json()) as { ok: boolean }).ok === false, "tanpa sesi: 401 { ok: false }");

    console.log("=== 7. Hapus pengguna ===");
    await kirimNotifikasi(db, { penggunaIds: [desainer.id], judul: "UJIN untuk desainer", jenis: "PENUGASAN" });
    pastikan((await notif(desainer.id)).length === 1, "desainer punya notifikasi");
    await db.pengguna.delete({ where: { id: desainer.id } });
    pastikan((await db.notifikasi.count({ where: { penggunaId: desainer.id } })) === 0, "hapus pengguna berhasil tanpa P2003, notifikasinya ikut terhapus");
  } finally {
    aturPersetujuan(false);
    await bersihkan();
  }
  pastikan((await db.pengguna.count({ where: { namaPengguna: { startsWith: P } } })) === 0, "pengguna uji terhapus");
  pastikan((await db.notifikasi.count({ where: { judul: { contains: "UJIN" } } })) === 0 && (await db.logAktivitas.count({ where: { nomor: { startsWith: "UJIN" } } })) === 0, "notifikasi dan log berpenanda UJIN terhapus");
  pastikan((await db.notifikasi.count({ where: { dibuatPada: { gte: mulaiUji }, penggunaId: { in: idSeed } } })) === 0, "notifikasi pemeriksa bawaan seed dari suite ini terhapus lewat nomor dokumen uji");
  pastikan(JSON.stringify(await periksaSinkron(db)) === sinkronAwal, "periksaSinkron sesudah bersih identik dengan sebelum suite (G15)");
  pastikan((await db.hakAksesPeran.count()) === 0, "tidak ada HakAksesPeran tertinggal");
  console.log("=== DONE, semua pemeriksaan notifikasi lulus ===");
}

function punyaPeminjamanSetujui(p: { hak: readonly string[] }) {
  return p.hak.includes("peminjaman.setujui");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
