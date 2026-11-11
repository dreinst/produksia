import "dotenv/config";
// Skrip ini memanggil pustaka dan merender komponen di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "../src/lib/db";
import { D } from "../src/lib/uang";
import { PERUSAHAAN_UTAMA, daftarPerusahaan, lingkupPerusahaan, saldoAntarPerusahaan, type Lingkup } from "../src/lib/perusahaan";
import { LABEL_STATUS_PROYEK, STATUS_PROYEK, daftarProyekAktif } from "../src/lib/proyek";
import { bacaFilterProyek, filterProyekSah, opsiFilterProyek, proyekBawaan, whereFilterProyek, whereFilterProyekLewat } from "../src/lib/filterProyek";
import FilterProyek from "../src/komponen/proyek/FilterProyek";
import LencanaProyek from "../src/komponen/proyek/LencanaProyek";
import TitikWarnaProyek from "../src/komponen/proyek/TitikWarnaProyek";
import KolomPerusahaan from "../src/komponen/KolomPerusahaan";
import CatatanGabungan from "../src/komponen/CatatanGabungan";
import Kanban, { type KartuKanban, type KolomKanban } from "../src/komponen/ui/Kanban";
import { LencanaStatus, NomorDokumen, labelSumberJurnal, labelStatus } from "../src/komponen/ui/Lencana";
import { pastikan } from "./bantuan";

/*
 * Uji komponen UI bersama P15 (D1 §7.1, D4 §7.4, §7.6, D5 §3.1, §3.13, §7.3, D6 §7.10, DESAIN F10, F17, L10):
 * - bacaFilterProyek, whereFilterProyek, proyekBawaan, filterProyekSah, opsiFilterProyek untuk nilai kosong, "tanpa",
 *   id, dan status proyek; proyekBawaan hanya memilih proyek aktif di lingkup pengguna (KASIR tanpa hak gabungan
 *   tidak mendapat proyek perusahaan lain);
 * - saldoAntarPerusahaan (sumber CatatanGabungan) nol pada data seed, selisih terbaca bila jurnal hanya satu sisi;
 * - render KolomPerusahaan, CatatanGabungan, FilterProyek, LencanaProyek, Kanban, dan Lencana (kunci lama tidak berubah);
 * - komponen klien tidak mengimpor basis data atau perusahaan.ts selain import type.
 * Data berkode UJIFP (satu perusahaan arsip, satu perusahaan aktif, dan proyeknya) dibuat lewat db dan dihapus di awal
 * dan di akhir.
 */

const KODE = "UJIFP";

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

class Batal extends Error {}

async function bersihkanData() {
  await db.proyek.deleteMany({ where: { kode: { startsWith: `${KODE}-` } } });
  await db.perusahaan.deleteMany({ where: { kode: { startsWith: KODE } } });
}

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

async function main() {
  await bersihkanData();
  const awalHakAksesPeran = await db.hakAksesPeran.count();

  console.log("=== 1. bacaFilterProyek dan whereFilterProyek ===");
  pastikan(bacaFilterProyek({}) === "" && bacaFilterProyek({ proyek: "" }) === "" && bacaFilterProyek({ proyek: "   " }) === "", "tanpa parameter atau kosong = semua proyek");
  pastikan(bacaFilterProyek({ proyek: "tanpa" }) === "tanpa" && bacaFilterProyek({ proyek: " tanpa " }) === "tanpa", "nilai tanpa = dokumen tanpa proyek");
  pastikan(bacaFilterProyek({ proyek: "cmabc123" }) === "cmabc123" && bacaFilterProyek({ proyek: ["cmx", "cmy"] }) === "cmx", "id proyek dibaca apa adanya, larik memakai nilai pertama");
  pastikan(bacaFilterProyek({ proyek: "a b'; --" }) === "" && bacaFilterProyek({ proyek: "x".repeat(65) }) === "", "nilai yang bukan bentuk id dianggap semua proyek");
  pastikan(JSON.stringify(whereFilterProyek("")) === "{}", "whereFilterProyek semua = penyaring kosong");
  pastikan(JSON.stringify(whereFilterProyek("tanpa")) === JSON.stringify({ proyekId: null }), "whereFilterProyek tanpa = proyekId null");
  pastikan(JSON.stringify(whereFilterProyek("cmabc123")) === JSON.stringify({ proyekId: "cmabc123" }), "whereFilterProyek id = proyekId itu");

  console.log("=== 2. Data uji ===");
  const pt = await db.perusahaan.create({ data: { kode: KODE, nama: "PT Uji Filter Proyek", urutan: 97, warna: "#123456" } });
  const arsip = await db.perusahaan.create({ data: { kode: `${KODE}A`, nama: "PT Uji Filter Arsip", urutan: 98, aktif: false } });
  const proyekBaru = (kode: string, status: string, perusahaanId: string, warna: string | null = null) =>
    db.proyek.create({ data: { kode: `${KODE}-${kode}`, nama: `Event ${kode}`, status, perusahaanId, warna } });
  const pJalan = await proyekBaru("JALAN", "BERJALAN", pt.id, "#2563eb");
  const pTunda = await proyekBaru("TUNDA", "DITUNDA", pt.id);
  const pArsip = await proyekBaru("ARSIP", "DIARSIP", pt.id);
  const pBatal = await proyekBaru("BATAL", "BATAL", pt.id);
  const pUtama = await proyekBaru("UTAMA", "BERJALAN", PERUSAHAAN_UTAMA);
  pastikan(true, "perusahaan uji, perusahaan arsip, dan lima proyek uji dibuat");

  console.log("=== 3. Penyaring di kueri ===");
  const semua = await db.jurnal.count();
  const tanpa = await db.jurnal.count({ where: { proyekId: null } });
  pastikan((await db.jurnal.count({ where: whereFilterProyek("") })) === semua, `semua proyek tidak menyaring jurnal (${semua})`);
  pastikan((await db.jurnal.count({ where: whereFilterProyek("tanpa") })) === tanpa, `tanpa proyek = jurnal tanpa proyek (${tanpa})`);
  const proyekSeed = await db.jurnal.findFirst({ where: { proyekId: { not: null } }, select: { proyekId: true } });
  if (proyekSeed?.proyekId) {
    const id = proyekSeed.proyekId;
    pastikan((await db.jurnal.count({ where: whereFilterProyek(id) })) === (await db.jurnal.count({ where: { proyekId: id } })), "id proyek menyaring jurnal proyek itu");
  } else {
    pastikan((await db.jurnal.count({ where: whereFilterProyek(pJalan.id) })) === 0, "id proyek tanpa jurnal menghasilkan nol jurnal");
  }
  pastikan(
    (await db.fakturPembelian.count({ where: { pesanan: whereFilterProyek("tanpa") } })) === (await db.fakturPembelian.count({ where: { pesanan: { proyekId: null } } })),
    "penyaring lewat relasi induk (faktur pembelian ke pesanan) sama dengan kueri langsung",
  );
  // relasi induk opsional: faktur penjualan tanpa pesanan ikut "Tanpa proyek" (tinjauan P15 butir 10B)
  pastikan(JSON.stringify(whereFilterProyekLewat("pesanan", "pesananId", "")) === "{}", "whereFilterProyekLewat semua = penyaring kosong");
  pastikan(
    JSON.stringify(whereFilterProyekLewat("pesanan", "pesananId", "tanpa")) === JSON.stringify({ OR: [{ pesananId: null }, { pesanan: { proyekId: null } }] }) &&
      JSON.stringify(whereFilterProyekLewat("pesanan", "pesananId", "cmabc123")) === JSON.stringify({ pesanan: { proyekId: "cmabc123" } }),
    "whereFilterProyekLewat tanpa = tanpa induk atau induk tanpa proyek; id = induk berproyek itu",
  );
  const fjTanpa = (await db.fakturPenjualan.count({ where: { pesananId: null } })) + (await db.fakturPenjualan.count({ where: { pesanan: { proyekId: null } } }));
  pastikan((await db.fakturPenjualan.count({ where: whereFilterProyekLewat("pesanan", "pesananId", "tanpa") })) === fjTanpa, `faktur penjualan tanpa proyek mencakup faktur tanpa pesanan (${fjTanpa})`);
  pastikan((await filterProyekSah(db, pJalan.id)) === pJalan.id, "filterProyekSah: id proyek yang ada dipertahankan");
  pastikan((await filterProyekSah(db, "cmtidakada000")) === "", "filterProyekSah: id proyek yang tidak ada dianggap semua");
  pastikan((await filterProyekSah(db, "tanpa")) === "tanpa" && (await filterProyekSah(db, "")) === "", "filterProyekSah: semua dan tanpa tidak berubah");

  console.log("=== 4. Opsi menurut status (D5 §3.1) ===");
  const daftarUji = [pJalan, pTunda, pArsip, pBatal].map((p) => ({ id: p.id, kode: p.kode, nama: p.nama, status: p.status }));
  const opsiSemua = opsiFilterProyek(daftarUji, "").map((p) => p.id);
  pastikan(opsiSemua.length === 2 && opsiSemua[0] === pJalan.id && opsiSemua[1] === pTunda.id, "proyek diarsipkan dan batal tidak ditawarkan, urutan dipertahankan");
  pastikan(opsiFilterProyek(daftarUji, pArsip.id).some((p) => p.id === pArsip.id) && !opsiFilterProyek(daftarUji, pArsip.id).some((p) => p.id === pBatal.id), "proyek diarsipkan yang sedang terpilih tetap ditawarkan");
  pastikan(STATUS_PROYEK.every((s) => labelStatus(s) === LABEL_STATUS_PROYEK[s]), "label lencana status proyek sama dengan LABEL_STATUS_PROYEK");

  console.log("=== 5. proyekBawaan memilih proyek aktif lingkup ===");
  const aktifPt = await daftarProyekAktif(db, pt.id);
  pastikan(proyekBawaan({ proyek: pJalan.id }, aktifPt) === pJalan.id && proyekBawaan({ proyek: pTunda.id }, aktifPt) === pTunda.id, "proyek berjalan dan ditunda milik lingkup dipakai sebagai bawaan");
  pastikan(proyekBawaan({ proyek: pArsip.id }, aktifPt) === null && proyekBawaan({ proyek: pBatal.id }, aktifPt) === null, "proyek diarsipkan atau batal tidak menjadi bawaan");
  pastikan(proyekBawaan({ proyek: pUtama.id }, aktifPt) === null, "proyek perusahaan lain tidak menjadi bawaan");
  pastikan(proyekBawaan({ proyek: "tanpa" }, aktifPt) === null && proyekBawaan({}, aktifPt) === null && proyekBawaan({ proyek: "" }) === null, "semua dan tanpa proyek tidak memberi bawaan");
  pastikan(proyekBawaan({ proyek: pArsip.id }) === pArsip.id, "tanpa daftar pilihan, id dikembalikan apa adanya (kontrak D5)");
  const bawaanLingkup = (peran: string | undefined, perusahaan: string | undefined, id: string) =>
    dengan({ peran, perusahaan }, async () => proyekBawaan({ proyek: id }, await daftarProyekAktif(db, (await lingkupPerusahaan()).perusahaanId)));
  pastikan((await bawaanLingkup(undefined, pt.id, pJalan.id)) === pJalan.id && (await bawaanLingkup(undefined, pt.id, pUtama.id)) === null, "PEMILIK di lingkup perusahaan uji: hanya proyek perusahaan itu");
  pastikan((await bawaanLingkup(undefined, "semua", pJalan.id)) === pJalan.id && (await bawaanLingkup(undefined, "semua", pUtama.id)) === pUtama.id, "PEMILIK di gabungan: proyek aktif semua perusahaan");
  pastikan((await bawaanLingkup("KASIR", "semua", pJalan.id)) === null && (await bawaanLingkup("KASIR", "semua", pUtama.id)) === pUtama.id, "KASIR yang meminta gabungan tetap berlingkup utama: proyek perusahaan lain tidak terpilih");

  console.log("=== 6. Saldo antar perusahaan untuk CatatanGabungan ===");
  const sekarang = new Date();
  const saldo = await saldoAntarPerusahaan(db, sekarang);
  pastikan(saldo.piutang.isZero() && saldo.hutang.isZero() && saldo.selisih.isZero() && saldo.masalah.length === 0, `data seed: piutang ${saldo.piutang}, hutang ${saldo.hutang}, selisih ${saldo.selisih}, tanpa masalah akun`);
  const akunPiutang = await db.akun.findUnique({ where: { kode: "1-1750" }, select: { id: true } });
  const akunLawan = await db.akun.findFirst({ where: { jenis: "MODAL", kelompok: false, perusahaanId: null }, select: { id: true } });
  if (akunPiutang && akunLawan) {
    let satuSisi = saldo;
    try {
      await db.$transaction(async (tx) => {
        await tx.jurnal.create({
          data: {
            nomor: `${KODE}-JU-1`,
            tanggal: new Date(sekarang.getTime() - 24 * 60 * 60 * 1000),
            keterangan: `${KODE} satu sisi`,
            perusahaanId: PERUSAHAAN_UTAMA,
            baris: { create: [{ akunId: akunPiutang.id, debit: 250_000, kredit: 0 }, { akunId: akunLawan.id, debit: 0, kredit: 250_000 }] },
          },
        });
        satuSisi = await saldoAntarPerusahaan(tx, sekarang);
        throw new Batal();
      });
    } catch (e) {
      if (!(e instanceof Batal)) throw e;
    }
    pastikan(satuSisi.piutang.equals(D(250_000)) && satuSisi.hutang.isZero() && satuSisi.selisih.equals(D(250_000)), "jurnal piutang antar perusahaan tanpa pasangan: selisih 250.000 (dibatalkan)");
  } else {
    pastikan(true, "akun 1-1750 atau akun modal bersama tidak ada, kasus selisih dilewati");
  }
  const catatan = html(await CatatanGabungan({ sampai: sekarang }));
  const jumlahPerusahaan = await db.perusahaan.count({ where: { OR: [{ aktif: true }, { jurnal: { some: {} } }] } });
  pastikan(catatan.includes(`Laporan gabungan = penjumlahan ${jumlahPerusahaan} perusahaan. Transaksi antar perusahaan belum dieliminasi.`), `CatatanGabungan menyebut ${jumlahPerusahaan} perusahaan (perusahaan arsip tanpa jurnal tidak dihitung)`);
  pastikan(catatan.includes("Piutang Antar Perusahaan Rp") && catatan.includes("selisih") && !catatan.includes("lencana-amber") && !catatan.includes("hanya dicatat di satu sisi"), "CatatanGabungan data seed: selisih nol tanpa peringatan");
  // akun antar perusahaan bermasalah: tanpa kalimat satu sisi dan tanpa amber (tinjauan P15 butir 9)
  // piutang antar perusahaan wajib akun Aset rinci tanpa pemilik; akun pendapatan pasti ditolak
  const akunBerpemilik = await db.akun.findFirst({ where: { jenis: "PENDAPATAN", kelompok: false }, select: { id: true } });
  const petaPiutang = await db.pemetaanAkunTambahan.findUnique({ where: { kunci: "piutang-antar-perusahaan" } });
  if (akunBerpemilik) {
    if (petaPiutang) await db.pemetaanAkunTambahan.update({ where: { id: petaPiutang.id }, data: { akunId: akunBerpemilik.id } });
    else await db.pemetaanAkunTambahan.create({ data: { kunci: "piutang-antar-perusahaan", label: "Piutang Antar Perusahaan", akunId: akunBerpemilik.id, dibuatOleh: KODE } });
    try {
      const salah = await saldoAntarPerusahaan(db, sekarang);
      const catatanSalah = html(await CatatanGabungan({ sampai: sekarang }));
      pastikan(
        salah.masalah.length > 0 && catatanSalah.includes("Selisih belum bisa dihitung karena akun antar perusahaan bermasalah") && !catatanSalah.includes("lencana-amber") && !catatanSalah.includes("hanya dicatat di satu sisi"),
        "CatatanGabungan dengan akun antar perusahaan bermasalah: alasan tampil tanpa peringatan satu sisi",
      );
    } finally {
      if (petaPiutang) await db.pemetaanAkunTambahan.update({ where: { id: petaPiutang.id }, data: { akunId: petaPiutang.akunId } });
      else await db.pemetaanAkunTambahan.deleteMany({ where: { kunci: "piutang-antar-perusahaan", dibuatOleh: KODE } });
    }
  } else {
    pastikan(true, "tidak ada akun pendapatan, kasus akun bermasalah dilewati");
  }

  console.log("=== 7. KolomPerusahaan ===");
  const daftar = await daftarPerusahaan(true);
  const ringkasPt = daftar.find((p) => p.id === pt.id)!;
  const ringkasArsip = daftar.find((p) => p.id === arsip.id)!;
  const lingkupSatu: Lingkup = { perusahaanId: pt.id, perusahaan: ringkasPt, bolehGabungan: true };
  const satu = html(createElement(KolomPerusahaan, { lingkup: lingkupSatu, daftar: await daftarPerusahaan() }));
  pastikan(satu.includes(`type="hidden" name="perusahaanId" value="${pt.id}"`) && satu.includes("PT Uji Filter Proyek") && satu.includes("Ganti lewat pemilih perusahaan di bilah samping") && !satu.includes("<select"), "lingkup satu perusahaan: isian tersembunyi dan tampilan baca saja");
  const gabungan = html(createElement(KolomPerusahaan, { lingkup: { perusahaanId: null, perusahaan: null, bolehGabungan: true }, daftar }));
  pastikan(gabungan.includes('<select id="perusahaanId" name="perusahaanId" required=""') && gabungan.includes("Pilih perusahaan…") && gabungan.includes("Perusahaan *"), "lingkup gabungan: pilihan perusahaan wajib");
  pastikan(gabungan.includes(`value="${pt.id}"`) && !gabungan.includes(`value="${arsip.id}"`) && !gabungan.includes('type="hidden"'), "pilihan hanya perusahaan aktif, tanpa isian tersembunyi");
  const lingkupArsip = html(createElement(KolomPerusahaan, { lingkup: { perusahaanId: arsip.id, perusahaan: ringkasArsip, bolehGabungan: true }, daftar }));
  pastikan(lingkupArsip.includes("<select") && !lingkupArsip.includes(`value="${arsip.id}"`) && lingkupArsip.includes("PT Uji Filter Arsip sudah diarsipkan"), "lingkup perusahaan arsip: pilihan wajib, perusahaan arsip tidak dikirim diam-diam");
  const namaLain = html(createElement(KolomPerusahaan, { lingkup: lingkupSatu, daftar, nama: "perusahaanPemberiId", label: "Perusahaan pemberi" }));
  pastikan(namaLain.includes('name="perusahaanPemberiId"') && namaLain.includes("Perusahaan pemberi"), "nama dan label isian bisa diganti");
  // selaluPilih (tinjauan P15 butir 3): pilihan wajib walau lingkup satu perusahaan, bawaan perusahaan lingkup
  const penerima = html(createElement(KolomPerusahaan, { lingkup: lingkupSatu, daftar, nama: "penerimaId", label: "Perusahaan penerima", selaluPilih: true }));
  pastikan(
    penerima.includes('<select id="penerimaId" name="penerimaId" required=""') && penerima.includes(`value="${pt.id}" selected=""`) && penerima.includes("Perusahaan penerima *") && !penerima.includes('type="hidden"'),
    "selaluPilih: lingkup satu perusahaan tetap berupa pilihan wajib dengan perusahaan lingkup terpilih",
  );
  const penerimaGabungan = html(createElement(KolomPerusahaan, { lingkup: { perusahaanId: null, perusahaan: null, bolehGabungan: true }, daftar, nama: "penerimaId", selaluPilih: true }));
  pastikan(penerimaGabungan.includes('value="" selected=""') && !penerimaGabungan.includes(`value="${arsip.id}"`), "selaluPilih di gabungan: belum ada yang terpilih, perusahaan arsip tidak ditawarkan");

  console.log("=== 8. FilterProyek, LencanaProyek, TitikWarnaProyek ===");
  const filter = html(createElement(FilterProyek, { nilai: "", daftar: daftarUji, tambahan: { q: "abc", hal: "3", proyek: "lama", kosong: undefined } }));
  pastikan(filter.includes('method="get"') && filter.includes('name="proyek"') && filter.includes(">Semua proyek<") && filter.includes(">Tanpa proyek<"), "FilterProyek: formulir GET dengan pilihan semua dan tanpa proyek");
  pastikan(filter.includes(`${KODE}-JALAN - Event JALAN<`) && filter.includes(`${KODE}-TUNDA - Event TUNDA · Ditunda<`) && !filter.includes(`${KODE}-ARSIP`) && !filter.includes(`${KODE}-BATAL`), "FilterProyek: akhiran status selain Berjalan, tanpa proyek arsip dan batal");
  pastikan(filter.includes('type="hidden" name="q" value="abc"') && !filter.includes('name="hal"') && !filter.includes('value="lama"') && !filter.includes('name="kosong"'), "FilterProyek: parameter tambahan dipertahankan kecuali halaman, proyek, dan nilai kosong");
  const filterArsip = html(createElement(FilterProyek, { nilai: pArsip.id, daftar: daftarUji }));
  pastikan(filterArsip.includes(`${KODE}-ARSIP - Event ARSIP · Diarsipkan`) && filterArsip.includes(`value="${pArsip.id}" selected=""`), "FilterProyek: proyek arsip yang terpilih tetap tampil dan terpilih");
  const filterHilang = html(createElement(FilterProyek, { nilai: "cmtidakada000", daftar: daftarUji }));
  pastikan(filterHilang.includes('value="cmtidakada000" selected=""') && filterHilang.includes(">Proyek di luar lingkup<"), "FilterProyek: id di luar daftar tetap terlihat sebagai saringan aktif (tinjauan P15 butir 4)");
  pastikan(!filter.includes("Proyek di luar lingkup") && filter.includes('value="" selected=""'), "FilterProyek tanpa saringan: tanpa pilihan di luar lingkup");
  pastikan(filter.includes('type="submit"') && filter.includes("sr-only focus:not-sr-only") && !filter.includes("<noscript"), "FilterProyek: tombol Terapkan muncul saat fokus untuk papan ketik (tinjauan P15 butir 5)");
  const lencana = html(createElement(LencanaProyek, { proyek: { kode: pJalan.kode, nama: pJalan.nama, warna: pJalan.warna } }));
  pastikan(lencana.includes("background-color:#2563eb") && lencana.includes(">Event JALAN<") && lencana.includes(`title="${KODE}-JALAN Event JALAN"`), "LencanaProyek: titik warna proyek, nama, dan kode sebagai judul");
  pastikan(html(createElement(LencanaProyek, { proyek: null })) === "", "LencanaProyek tidak dirender untuk dokumen tanpa proyek");
  pastikan(html(createElement(TitikWarnaProyek, {})).includes("background-color:#71717a"), "TitikWarnaProyek: tanpa warna memakai abu-abu bawaan");

  console.log("=== 9. Lencana (F17, B-23) ===");
  const LAMA: Record<string, [string, string]> = {
    DRAF: ["lencana-amber", "Draf"],
    DIKONVERSI: ["lencana-slate", "Dikonversi"],
    SEBAGIAN: ["lencana-amber", "Sebagian"],
    DIPROSES: ["lencana-blue", "Diproses"],
    LUNAS: ["lencana-emerald", "Lunas"],
    DIBATALKAN: ["lencana-rose", "Dibatalkan"],
    TERCATAT: ["lencana-emerald", "Tercatat"],
    AKTIF: ["lencana-emerald", "Aktif"],
    DIJUAL: ["lencana-slate", "Dijual"],
    DIHAPUS: ["lencana-rose", "Dihapus"],
    OPEN: ["lencana-blue", "Berjalan"],
    TERLAMBAT: ["lencana-rose", "Terlambat"],
  };
  const lencanaStatus = (s: string) => html(createElement(LencanaStatus, { status: s }));
  pastikan(Object.entries(LAMA).every(([s, [cls, label]]) => lencanaStatus(s) === `<span class="lencana ${cls}">${label}</span>`), "LencanaStatus kunci lama tampil persis sama");
  const BARU: Record<string, [string, string]> = {
    BERJALAN: ["lencana-blue", "Berjalan"],
    SELESAI: ["lencana-emerald", "Selesai"],
    MENUNGGU: ["lencana-amber", "Menunggu"],
    MENANG: ["lencana-emerald", "Menang"],
    KALAH: ["lencana-rose", "Kalah"],
    DITUNDA: ["lencana-amber", "Ditunda"],
    DIARSIP: ["lencana-slate", "Diarsipkan"],
    BATAL: ["lencana-rose", "Batal"],
    LEBIH_BAYAR: ["lencana-rose", "Lebih bayar"],
    DIBAYAR_SEBAGIAN: ["lencana-blue", "Sebagian dibayar"],
    PERLU_DIBAYAR: ["lencana-amber", "Perlu dibayar"],
    BELUM_ADA_HAK: ["lencana-slate", "Belum ada hak"],
  };
  pastikan(Object.entries(BARU).every(([s, [cls, label]]) => lencanaStatus(s) === `<span class="lencana ${cls}">${label}</span>`), "kunci D4 §7.6, status proyek D5 §3.1, dan status bayar mitra D5 §3.13 berlabel Indonesia");
  pastikan(lencanaStatus("KODE_LAIN") === '<span class="lencana lencana-slate">KODE_LAIN</span>' && labelStatus("KODE_LAIN") === "KODE_LAIN", "kode tidak dikenal tetap tampil mentah abu-abu");
  pastikan(labelSumberJurnal("ANTAR_PERUSAHAAN") === "Antar perusahaan" && labelSumberJurnal("MITRA_PROYEK") === "Mitra proyek" && labelSumberJurnal("PENJUALAN") === "Penjualan", "label sumber jurnal antar perusahaan dan mitra proyek");
  const nomor = (n: string) => html(createElement(NomorDokumen, { nomor: n }));
  pastikan(nomor("AP-2026-0001").includes("bg-indigo-50 text-indigo-700\">AP<") && nomor("TLM-2026-0001").includes("bg-amber-50 text-amber-700\">TLM<") && nomor("BYM-2026-0001").includes("bg-rose-50 text-rose-700\">BYM<"), "lencana dokumen AP, TLM, dan BYM berwarna");
  pastikan(nomor("JU-TLM-2026-0001").includes(">JU<") && nomor("FJ-2026-0001").includes("bg-blue-50 text-blue-700\">FJ<"), "jurnal JU-TLM tetap berlencana JU dan lencana lama tidak berubah");

  console.log("=== 10. Kanban ===");
  const kolom: KolomKanban[] = [
    { id: "baru", judul: "Baru", nada: "blue", ringkasan: "2 lead" },
    { id: "menang", judul: "Menang", nada: "emerald" },
    { id: "kalah", judul: "Kalah", nada: "rose", lebihBanyak: { jumlah: 3, href: "/contoh?tahap=kalah" } },
  ];
  const kartu: KartuKanban[] = [
    { id: "k1", kolomId: "baru", judul: "Lead satu", subjudul: "PT Contoh", titik: "bg-pink-500", baris: ["Rp 1.000.000"], href: "/contoh/k1", lencana: [{ teks: "Instagram", nada: "amber" }] },
    { id: "k2", kolomId: "baru", judul: "Lead dua" },
  ];
  const pindah = async () => ({ galat: null });
  const papan = html(createElement(Kanban, { kolom, kartu, bolehPindah: true, pindah, kosong: "Belum ada lead" }));
  pastikan(papan.includes('aria-label="Baru"') && papan.includes('aria-label="Menang"') && papan.includes('aria-label="Kalah"') && papan.includes("2 lead"), "Kanban: satu kolom per tahap dengan ringkasan");
  pastikan(papan.includes('href="/contoh/k1"') && papan.includes("PT Contoh") && papan.includes("bg-pink-500") && papan.includes("Rp 1.000.000") && papan.includes('class="lencana lencana-amber">Instagram<'), "Kanban: kartu bertaut dengan subjudul, titik, baris, dan lencana");
  pastikan((papan.match(/Belum ada lead/g) ?? []).length === 2, "Kanban: teks kolom kosong di kolom tanpa kartu");
  pastikan((papan.match(/draggable="true"/g) ?? []).length === 2 && (papan.match(/aria-label="Pindah ke tahap"/g) ?? []).length === 2 && papan.includes("drag_indicator"), "Kanban boleh pindah: kartu bisa diseret dan punya pilihan Pindah ke tahap");
  pastikan((papan.match(/<button type="button" disabled="" class="tombol tombol-garis tombol-kecil shrink-0">Pindah<\/button>/g) ?? []).length === 2, "Kanban: tombol Pindah terpisah dan nonaktif sampai tujuan dipilih (tinjauan P15 butir 2)");
  pastikan(papan.includes('role="status" aria-live="polite" class="sr-only"') && !papan.includes('role="alert"'), "Kanban: wilayah status selalu terpasang, alert hanya saat galat (tinjauan P15 butir 6)");
  pastikan(!papan.includes('class="ml-auto text-xs text-slate-500 angka"'), "Kanban: angka jumlah kartu mati secara bawaan (tinjauan P15 butir 8)");
  const papanJumlah = html(createElement(Kanban, { kolom, kartu, bolehPindah: true, pindah, tampilkanJumlah: true }));
  pastikan(papanJumlah.includes('class="ml-auto text-xs text-slate-500 angka">2<') && papanJumlah.includes('class="ml-auto text-xs text-slate-500 angka">3<'), "Kanban tampilkanJumlah: jumlah kartu ditambah kartu lainnya");
  pastikan(papan.includes('href="/contoh?tahap=kalah"') && papan.includes("3 lainnya"), "Kanban: tautan kartu lainnya di kolom yang terpotong");
  const papanBaca = html(createElement(Kanban, { kolom, kartu, bolehPindah: false, pindah }));
  pastikan(!papanBaca.includes('draggable="true"') && !papanBaca.includes("Pindah ke tahap") && !papanBaca.includes(">Pindah<") && !papanBaca.includes("drag_indicator") && papanBaca.includes("Belum ada kartu"), "Kanban tanpa hak pindah: tanpa seret dan pilihan pindah, teks kosong bawaan");

  console.log("=== 11. Komponen klien tanpa impor server (L10) ===");
  const terlarang = /^\s*import\s+(?!type\b)[^;]*from\s+["'](@\/lib\/db|@\/prisma-klien\/client|@\/lib\/perusahaan)["']/m;
  for (const berkas of ["src/komponen/ui/Kanban.tsx", "src/komponen/proyek/FilterProyek.tsx", "src/lib/filterProyek.ts", "src/komponen/ui/Lencana.tsx"]) {
    const isi = readFileSync(berkas, "utf8");
    pastikan(!terlarang.test(isi), `${berkas} tidak mengimpor basis data atau perusahaan.ts selain import type`);
  }

  console.log("=== 12. Bersih-bersih ===");
  await bersihkanData();
  pastikan((await db.proyek.count({ where: { kode: { startsWith: `${KODE}-` } } })) === 0 && (await db.perusahaan.count({ where: { kode: { startsWith: KODE } } })) === 0, "proyek dan perusahaan uji terhapus");
  pastikan((await db.hakAksesPeran.count()) === awalHakAksesPeran, "HakAksesPeran tidak berubah");

  console.log("=== DONE, all filter-proyek checks passed ===");
}

main()
  .catch(async (galat) => {
    console.error("TEST FAILED", galat);
    await bersihkanData().catch((e) => console.error("bersih-bersih gagal", e));
    process.exit(1);
  })
  .finally(() => db.$disconnect());
