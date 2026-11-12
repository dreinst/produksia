import "dotenv/config";
// Skrip ini memanggil pustaka dan halaman di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import Link from "next/link";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { db } from "../src/lib/db";
import { HAK_BAWAAN, type Hak, type PenggunaSesi } from "../src/lib/hakAkses";
import { BATAS_CARI, cariPekerjaan, syaratNomorDokumen, tautanProyekCari, type KelompokCari } from "../src/lib/cariGlobal";
import { jadikanLingkupAktifFormulir } from "../src/lib/aksi/perusahaan";
import FormulirAksi from "../src/komponen/FormulirAksi";
import HalamanCari from "../src/app/(aplikasi)/cari/page";
import type { PeranPengguna } from "../src/prisma-klien/enums";
import { pastikan } from "./bantuan";

/*
 * Uji pencarian global "Pekerjaan & Berkas" (P46, D7 §3.6, HAK.md §7 no. 14, DESAIN G12 dan H5): batas minimal 2
 * karakter, kelompok per hak dengan PenggunaSesi sintetis, tautan Proyek per hak, Dokumen mitra, saringan berkas
 * (folder terbatas dan lampiran modul), lingkup utama lawan gabungan, batas 10 per kelompok, syaratNomorDokumen lewat
 * nomor cetak, dan halaman /cari. Semua data berawalan UJICG dibuat langsung lalu dibersihkan. Tanpa HakAksesPeran.
 */

const AWALAN = "UJICG";

function sintetis(peran: PeranPengguna, hak: readonly Hak[] = HAK_BAWAAN[peran] ?? []): PenggunaSesi {
  return { id: "skrip-uji-cg", nama: "Skrip Uji", namaPengguna: "skrip-uji-cg", email: null, nomorTelepon: null, peran, hak: [...hak] };
}

const kelompok = (hasil: KelompokCari[], jenis: KelompokCari["jenis"]) => hasil.find((k) => k.jenis === jenis) ?? null;
const judulDi = (hasil: KelompokCari[], jenis: KelompokCari["jenis"]) => kelompok(hasil, jenis)?.hasil.map((h) => h.judul) ?? [];

async function denganEnv<T>(isian: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const lama = Object.fromEntries(Object.keys(isian).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(isian)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(lama)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Menjalankan komponen server secara rekursif; Link dan FormulirAksi (klien) tidak dijalankan, anaknya tetap dibaca. */
async function render(node: ReactNode): Promise<{ teks: string; href: string[] }> {
  const teks: string[] = [];
  const href: string[] = [];
  const jalan = async (n: ReactNode | Promise<ReactNode>): Promise<void> => {
    const v = await n;
    if (v === null || v === undefined || typeof v === "boolean") return;
    if (typeof v === "string" || typeof v === "number") return void teks.push(String(v));
    if (Array.isArray(v)) {
      for (const x of v) await jalan(x);
      return;
    }
    if (!isValidElement(v)) return;
    const el = v as ReactElement<Record<string, unknown>>;
    if (el.type === Link) href.push(String(el.props.href));
    if (el.type === Link || el.type === FormulirAksi) return jalan(el.props.children as ReactNode);
    if (typeof el.type === "function") return jalan((el.type as (p: unknown) => ReactNode | Promise<ReactNode>)(el.props));
    return jalan(el.props.children as ReactNode);
  };
  await jalan(node);
  return { teks: teks.join(""), href };
}

async function bersihkan() {
  const proyek = (await db.proyek.findMany({ where: { kode: { startsWith: AWALAN } }, select: { id: true } })).map((p) => p.id);
  await db.talanganMitra.deleteMany({ where: { nomor: { startsWith: AWALAN } } });
  await db.mitraProyek.deleteMany({ where: { proyekId: { in: proyek } } });
  await db.berkas.deleteMany({ where: { namaBerkas: { startsWith: AWALAN } } });
  await db.tugasDesain.deleteMany({ where: { judul: { startsWith: AWALAN } } });
  await db.konten.deleteMany({ where: { judul: { startsWith: AWALAN } } });
  await db.kampanye.deleteMany({ where: { nama: { startsWith: AWALAN } } });
  await db.lead.deleteMany({ where: { nama: { startsWith: AWALAN } } });
  await db.tahapLead.deleteMany({ where: { nama: { startsWith: AWALAN } } });
  await db.fakturPenjualan.deleteMany({ where: { nomor: { startsWith: AWALAN } } });
  await db.proyek.deleteMany({ where: { id: { in: proyek } } });
}

async function main() {
  await bersihkan();
  const jumlahHakAwal = await db.hakAksesPeran.count();
  try {
    console.log("=== 0. Data uji ===");
    const [utama, smara] = await Promise.all([db.perusahaan.findUniqueOrThrow({ where: { id: "utama" } }), db.perusahaan.findUniqueOrThrow({ where: { id: "smara" } })]);
    // tahap lead sementara per perusahaan (urutan besar supaya tidak bentrok dengan tahap yang ada), dihapus di akhir
    const tahap = async (perusahaanId: string) => (await db.tahapLead.create({ data: { perusahaanId, nama: `${AWALAN} Tahap`, urutan: 9999 } })).id;
    const prjU = await db.proyek.create({ data: { kode: `${AWALAN}-PRJ-U`, nama: `${AWALAN} Proyek utama`, perusahaanId: utama.id, namaKlien: "Klien Uji" } });
    const prjS = await db.proyek.create({ data: { kode: `${AWALAN}-PRJ-S`, nama: `${AWALAN} Proyek smara`, perusahaanId: smara.id } });
    const leadU = await db.lead.create({ data: { nama: `${AWALAN} Lead utama`, namaUsaha: "Usaha", telepon: "", whatsapp: "", sumber: "Instagram", tahapId: await tahap(utama.id), perusahaanId: utama.id, dibuatOlehNama: "Skrip Uji" } });
    const leadS = await db.lead.create({ data: { nama: `${AWALAN} Lead smara`, namaUsaha: "Usaha", telepon: "", whatsapp: "", sumber: "Instagram", tahapId: await tahap(smara.id), perusahaanId: smara.id, dibuatOlehNama: "Skrip Uji" } });
    const kontenU = await db.konten.create({ data: { judul: `${AWALAN} Konten utama`, perusahaanId: utama.id, dibuatOlehNama: "Skrip Uji" } });
    await db.konten.create({ data: { judul: `${AWALAN} Konten smara`, perusahaanId: smara.id, dibuatOlehNama: "Skrip Uji" } });
    await db.konten.createMany({ data: Array.from({ length: 12 }, (_, i) => ({ judul: `${AWALAN} Banyak ${i}`, perusahaanId: utama.id, dibuatOlehNama: "Skrip Uji" })) });
    const kampanye = await db.kampanye.create({ data: { nama: `${AWALAN} Kampanye utama`, perusahaanId: utama.id, dibuatOlehNama: "Skrip Uji" } });
    const tugas = await db.tugasDesain.create({ data: { judul: `${AWALAN} Tugas utama`, perusahaanId: utama.id, dibuatOlehNama: "Skrip Uji" } });
    const berkas = (namaBerkas: string, isian: { folderKode?: string; jenisEntitas?: string; entitasId?: string }) =>
      db.berkas.create({ data: { perusahaanId: utama.id, namaBerkas, tipeMime: "application/pdf", ukuran: 1, sha256: "0".repeat(64), diunggahOlehNama: "Skrip Uji", ...isian } });
    const bUmum = await berkas(`${AWALAN}-umum.pdf`, { folderKode: "DOKUMEN" });
    const bFaktur = await berkas(`${AWALAN}-faktur.pdf`, { folderKode: "FAKTUR" });
    const bPenawaran = await berkas(`${AWALAN}-penawaran.pdf`, { folderKode: "PENAWARAN", jenisEntitas: "penawaran", entitasId: "ujicg-tidak-ada" });
    const mitra = await db.mitraProyek.create({ data: { proyekId: prjU.id, nama: `${AWALAN} Mitra`, mode: "PERSEN", nilai: 5 } });
    const akunBeban = await db.akun.findFirstOrThrow({ where: { jenis: "BEBAN" } });
    const talangan = await db.talanganMitra.create({
      data: { nomor: `${AWALAN}-TLG-1`, tanggal: new Date(), perusahaanId: utama.id, proyekId: prjU.id, mitraId: mitra.id, akunBebanId: akunBeban.id, jumlah: 1000, deskripsi: "Uji", dicatatOlehNama: "Skrip Uji" },
    });
    const pelanggan = await db.pelanggan.findFirstOrThrow();
    const faktur = await db.fakturPenjualan.create({ data: { nomor: `${AWALAN}-FJ-1`, nomorCetak: "CG/INV/7731", pelangganId: pelanggan.id, perusahaanId: utama.id } });

    const pemilik = sintetis("PEMILIK");

    console.log("=== 1. Batas minimal dan bentuk ===");
    pastikan((await cariPekerjaan(pemilik, "U", null)).length === 0 && (await cariPekerjaan(pemilik, "  U ", null)).length === 0, "kata kunci di bawah 2 karakter: []");
    const gab = await cariPekerjaan(pemilik, AWALAN, null);
    pastikan(
      ["proyek", "dokumen-mitra", "lead", "konten", "tugas-desain", "kampanye", "berkas"].every((j) => kelompok(gab, j as KelompokCari["jenis"])),
      `PEMILIK gabungan: semua kelompok pekerjaan muncul (${gab.map((k) => k.jenis).join(", ")})`,
    );
    pastikan(gab.every((k) => k.hasil.length <= BATAS_CARI), "tiap kelompok paling banyak 10 hasil");
    pastikan(kelompok(gab, "konten")!.hasil.length === BATAS_CARI, "14 konten cocok: kelompok konten dipotong 10");
    pastikan(gab.every((k) => k.hasil.every((h) => k.jenis === "perusahaan" || h.href.startsWith("/"))), "setiap hasil (selain perusahaan) punya tautan internal");

    console.log("=== 2. Proyek per hak (HAK.md §7 no. 14) ===");
    const kasir = await cariPekerjaan(sintetis("KASIR"), `${AWALAN}-PRJ`, null);
    pastikan(kelompok(kasir, "proyek")?.hasil.some((h) => h.href === `/proyek/${prjU.id}`) === true, "KASIR melihat Proyek bertaut /proyek/{id}");
    pastikan(!kelompok(kasir, "lead") && !kelompok(kasir, "konten") && !kelompok(kasir, "berkas") && !kelompok(kasir, "dokumen-mitra"), "KASIR: tanpa Lead, Konten, Berkas, dan Dokumen mitra");
    const rek = await cariPekerjaan(sintetis("ADMIN", ["rekonsiliasi.lihat"]), `${AWALAN}-PRJ-U`, null);
    pastikan(sama(kelompok(rek, "proyek")?.hasil.map((h) => h.href), [`/rekonsiliasi/event/${prjU.id}`]), "hanya rekonsiliasi.lihat: tautan LPJ");
    const induk = await cariPekerjaan(sintetis("ADMIN", ["data-induk.lihat"]), `${AWALAN}-PRJ-U`, null);
    pastikan(sama(kelompok(induk, "proyek")?.hasil.map((h) => h.href), ["/data-induk/proyek"]), "hanya data-induk.lihat: tautan /data-induk/proyek");
    pastikan(tautanProyekCari({ hak: [] }, "x") === null && !kelompok(await cariPekerjaan(sintetis("ADMIN", ["lead.lihat"]), `${AWALAN}-PRJ`, null), "proyek"), "tanpa hak proyek: kelompok Proyek tidak ada");
    pastikan(kelompok(await cariPekerjaan(pemilik, "Klien Uji", null), "proyek")?.hasil.some((h) => h.id === prjU.id) === true, "proyek dicari juga lewat nama klien");

    console.log("=== 3. Kelompok per peran ===");
    const desainer = await cariPekerjaan(sintetis("DESAINER"), AWALAN, null);
    pastikan(!kelompok(desainer, "lead") && !kelompok(desainer, "kampanye"), "DESAINER: tanpa Lead dan Kampanye");
    pastikan(judulDi(desainer, "berkas").includes(bUmum.namaBerkas), "DESAINER: berkas folder umum terlihat");
    pastikan(!judulDi(desainer, "berkas").includes(bFaktur.namaBerkas) && !judulDi(desainer, "berkas").includes(bPenawaran.namaBerkas), "DESAINER: berkas folder Faktur dan lampiran penawaran tidak muncul");
    pastikan(judulDi(desainer, "konten").length > 0 && judulDi(desainer, "tugas-desain").includes(tugas.judul), "DESAINER: Konten dan Tugas desain");
    const iklan = await cariPekerjaan(sintetis("IKLAN"), AWALAN, null);
    pastikan(kelompok(iklan, "kampanye")?.hasil.some((h) => h.href === `/pemasaran/iklan/${kampanye.id}`) === true, "IKLAN melihat Kampanye bertaut detail");
    pastikan(!kelompok(iklan, "lead") && !kelompok(iklan, "dokumen-mitra"), "IKLAN: tanpa Lead dan Dokumen mitra");
    const sosmed = await cariPekerjaan(sintetis("SOSMED"), AWALAN, null);
    pastikan(!kelompok(sosmed, "kampanye") && !kelompok(sosmed, "dokumen-mitra") && !kelompok(sosmed, "lead"), "SOSMED: tanpa Kampanye, Dokumen mitra, dan Lead");
    pastikan(judulDi(gab, "berkas").includes(bFaktur.namaBerkas) && judulDi(gab, "berkas").includes(bPenawaran.namaBerkas), "PEMILIK: berkas Faktur dan lampiran penawaran terlihat");
    const lead = kelompok(gab, "lead")!;
    pastikan(lead.hasil.some((h) => h.href === `/crm/lead/${leadU.id}`), "Lead menaut /crm/lead/{id}");
    pastikan(kelompok(gab, "konten")!.hasil.every((h) => h.href.startsWith("/pemasaran/konten?konten=")) && kelompok(gab, "tugas-desain")!.hasil.some((h) => h.href === `/pemasaran/desain?tugas=${tugas.id}`), "Konten dan Tugas desain menaut lacinya");
    pastikan(kelompok(gab, "berkas")!.hasil.every((h) => h.href.startsWith("/berkas?sorot=")), "Berkas menaut /berkas?sorot={id}");

    console.log("=== 4. Dokumen mitra ===");
    const mitraP = kelompok(await cariPekerjaan(pemilik, `${AWALAN}-TLG`, null), "dokumen-mitra");
    pastikan(sama(mitraP?.hasil.map((h) => h.href), [`/proyek/${prjU.id}/keuangan/talangan/${talangan.id}`]), "PEMILIK: talangan menaut halaman dokumennya");
    const hanyaBayar = await cariPekerjaan(sintetis("ADMIN", ["pembayaran-mitra.lihat"]), `${AWALAN}-TLG`, null);
    pastikan(!kelompok(hanyaBayar, "dokumen-mitra"), "hanya pembayaran-mitra.lihat: talangan tidak muncul");
    const hanyaTalangan = await cariPekerjaan(sintetis("ADMIN", ["talangan-mitra.lihat"]), `${AWALAN}-TLG`, null);
    pastikan(kelompok(hanyaTalangan, "dokumen-mitra")?.hasil.length === 1, "hanya talangan-mitra.lihat: talangan muncul");
    pastikan(!kelompok(await cariPekerjaan(sintetis("KASIR"), `${AWALAN}-TLG`, null), "dokumen-mitra"), "KASIR tanpa hak dokumen mitra: kelompok tidak ada");

    console.log("=== 5. Lingkup ===");
    const lingkupUtama = await cariPekerjaan(pemilik, AWALAN, utama.id);
    pastikan(!judulDi(lingkupUtama, "lead").includes(leadS.nama) && judulDi(lingkupUtama, "lead").includes(leadU.nama), "lingkup utama: lead smara tidak dimuat");
    const kontenSmaraDiUtama = await cariPekerjaan(pemilik, `${AWALAN} Konten`, utama.id);
    pastikan(!judulDi(kontenSmaraDiUtama, "konten").includes(`${AWALAN} Konten smara`) && judulDi(kontenSmaraDiUtama, "konten").includes(kontenU.judul), "lingkup utama: konten smara tidak dimuat");
    pastikan(!judulDi(lingkupUtama, "proyek").some((j) => j.includes(prjS.kode)), "lingkup utama: proyek smara tidak dimuat");
    const kontenGab = await cariPekerjaan(pemilik, `${AWALAN} Konten`, null);
    pastikan(judulDi(kontenGab, "konten").includes(`${AWALAN} Konten smara`) && judulDi(gab, "lead").includes(leadS.nama), "gabungan: lead dan konten smara dimuat");
    const perusahaanCari = kelompok(await cariPekerjaan(pemilik, smara.nama, utama.id), "perusahaan");
    pastikan(perusahaanCari?.hasil.some((h) => h.id === smara.id && !h.lingkupAktif) === true, "kelompok Perusahaan: smara ditemukan, bukan lingkup aktif");
    pastikan(kelompok(await cariPekerjaan(sintetis("KASIR"), utama.kode, utama.id), "perusahaan")?.hasil.some((h) => h.id === utama.id && h.lingkupAktif) === true, "kelompok Perusahaan: lingkup aktif ditandai, terbuka bagi semua pengguna");
    const ganti = await jadikanLingkupAktifFormulir(smara.id);
    pastikan(!!ganti.galat, `Jadikan lingkup aktif tanpa sesi peramban ditolak jelas (${ganti.galat})`);

    console.log("=== 6. Nomor cetak dan halaman /cari ===");
    const lewatCetak = await db.fakturPenjualan.findMany({ where: syaratNomorDokumen("cg/inv/7731"), select: { id: true } });
    pastikan(lewatCetak.some((f) => f.id === faktur.id), "syaratNomorDokumen menemukan faktur uji lewat nomorCetak (tanpa beda huruf)");
    pastikan((await db.fakturPenjualan.findMany({ where: { nomor: { contains: "CG/INV/7731" } } })).length === 0, "nomor internal faktur uji tidak memuat nomor cetaknya");
    const halaman = await denganEnv({ UJI_PERAN: "PEMILIK", UJI_PERUSAHAAN: "semua" }, async () => render(await HalamanCari({ searchParams: Promise.resolve({ q: "CG/INV/7731" }) })));
    pastikan(halaman.href.includes(`/penjualan/faktur/${faktur.id}`) && halaman.teks.includes(faktur.nomor), "/cari?q=<nomor cetak>: faktur ditemukan dan menaut detailnya");
    const halamanKasir = await denganEnv({ UJI_PERAN: "KASIR", UJI_PERUSAHAAN: undefined }, async () => render(await HalamanCari({ searchParams: Promise.resolve({ q: AWALAN }) })));
    pastikan(halamanKasir.teks.includes("Pekerjaan & Berkas") && !halamanKasir.teks.includes(leadU.nama) && !halamanKasir.teks.includes(bUmum.namaBerkas) && halamanKasir.href.includes(`/proyek/${prjU.id}`), "/cari KASIR: kartu Pekerjaan & Berkas tanpa lead dan berkas, proyek menaut detail");
    const halamanDesainer = await denganEnv({ UJI_PERAN: "DESAINER", UJI_PERUSAHAAN: "semua" }, async () => render(await HalamanCari({ searchParams: Promise.resolve({ q: AWALAN }) })));
    pastikan(!halamanDesainer.teks.includes(kampanye.nama) && !halamanDesainer.teks.includes(bFaktur.namaBerkas) && !halamanDesainer.teks.includes(talangan.nomor), "/cari DESAINER: tanpa kampanye, berkas Faktur, dan dokumen mitra");
    const halamanSatu = await denganEnv({ UJI_PERAN: "PEMILIK", UJI_PERUSAHAAN: "semua" }, async () => render(await HalamanCari({ searchParams: Promise.resolve({ q: "U" }) })));
    pastikan(halamanSatu.teks.includes("Ketik minimal 2 karakter"), "/cari satu karakter: kartu Pekerjaan meminta minimal 2 karakter");
  } finally {
    await bersihkan();
    const sisa = await Promise.all([
      db.proyek.count({ where: { kode: { startsWith: AWALAN } } }),
      db.konten.count({ where: { judul: { startsWith: AWALAN } } }),
      db.lead.count({ where: { nama: { startsWith: AWALAN } } }),
      db.berkas.count({ where: { namaBerkas: { startsWith: AWALAN } } }),
      db.fakturPenjualan.count({ where: { nomor: { startsWith: AWALAN } } }),
    ]);
    pastikan(sisa.every((n) => n === 0), `data uji ${AWALAN} bersih (${sisa.join(", ")})`);
    pastikan((await db.hakAksesPeran.count()) === jumlahHakAwal, "HakAksesPeran tidak berubah");
  }
  console.log("\n=== DONE, all cari-global checks passed ===");
}

function sama(a: readonly unknown[] | undefined, b: readonly unknown[]): boolean {
  return !!a && a.length === b.length && a.every((x, i) => x === b[i]);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
