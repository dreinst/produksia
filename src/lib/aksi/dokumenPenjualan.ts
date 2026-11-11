"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { pastikanHak, wajibHakAksi, wajibMasukAksi } from "@/lib/otentikasi";
import { punyaHak, type Hak, type PenggunaSesi } from "@/lib/hakAkses";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { D, type Desimal } from "@/lib/uang";
import { ambilPengaturanPerusahaan, bacaTarifPpn } from "@/lib/pengaturanPerusahaan";
import { pastikanBarangMilik } from "@/lib/perusahaan";
import { bacaProyekId } from "@/lib/proyek";
import { BERKAS } from "@/lib/persetujuan";
import { tanggalIso } from "@/lib/waktu";
import { pastikanBarangLainLain, isiBarangLainLain } from "@/lib/barangLainLain";
import { pastikanLeadUntukPenawaran } from "@/lib/crm";
import {
  KOLOM_TEKS_PENAWARAN,
  LABEL_DOKUMEN_PENJUALAN,
  adaBarisBebas,
  bacaBarisDokumen,
  bacaBarisTampilan,
  bacaBerlakuSampai,
  bacaIsianTampilan,
  bacaKopSuratId,
  bacaModeDokumen,
  bacaNilaiAddOn,
  bacaRingkasanDokumen,
  bacaTampilanEvent,
  bacaTanggalIsian,
  bacaTeks,
  bacaTeksDokumen,
  barisBerbarang,
  barisNamaDiganti,
  catatLogPenjualan,
  dataBarisDokumen,
  jenisDokumenPenjualanSah,
  kunciBarisPesananPenjualan,
  pastikanKopSuratDokumen,
  periksaHakBarisBebas,
  periksaHargaNego,
  rapikanDaftarSeksi,
  rapikanTeks,
  ringkasPerubahan,
  type BarisDokumen,
  type JenisDokumenPenjualan,
} from "@/lib/dokumenPenjualan";
import { bacaRencanaTermin, dataButirTermin, kunciButirTermin, pastikanBatalTagihanTermin, pastikanRencanaPesananBolehDiubah, periksaBrutoRencana, selesaikanRencana } from "@/lib/rencanaTermin";
import { alokasiNomorCetak, bacaFormatNomor, bacaNomorCetakManual, setelNomorTerakhir, simpanNomorCetak, type JenisNomorCetak } from "@/lib/nomorCetak";
import type { StatusKomersial } from "@/prisma-klien/enums";

/*
 * Aksi dokumen penjualan sesudah simpan (D2 §6.2, P25): ubah penawaran draf, status komersial, tampilan cetak semua
 * dokumen, rencana termin, tagihan termin, pengaturan dokumen, dan format nomor cetak. Pembantu murni ada di
 * dokumenPenjualan.ts, rencanaTermin.ts, dan nomorCetak.ts. Tidak ada aksi di sini yang membuat atau mengubah jurnal.
 * Log memakai catatLogPenjualan (modul "penjualan"). Simpan PDF (simpanPdfDokumen) milik P31/P45.
 */

const LABEL_STATUS_KOMERSIAL: Record<StatusKomersial, string> = {
  DRAF: "Draf",
  TERKIRIM: "Terkirim",
  DITERIMA: "Diterima",
  DITOLAK: "Ditolak",
  KEDALUWARSA: "Kedaluwarsa",
};
const STATUS_KOMERSIAL = Object.keys(LABEL_STATUS_KOMERSIAL) as StatusKomersial[];

/** Hak ubah per jenis dokumen (D2 §3.12). Jenis yang tidak dikenal ditolak sebelum hak diperiksa. */
const HAK_UBAH: Record<JenisDokumenPenjualan, Hak> = {
  penawaran: "penawaran.ubah",
  pesanan: "pesanan.ubah",
  faktur: "faktur.ubah",
  penerimaan: "penerimaan.ubah",
  uangMuka: "uang-muka.ubah",
};

/** Jenis nomor cetak untuk kolom nomorCetak dokumen (pesanan tidak punya nomor cetak). */
const JENIS_NOMOR: Partial<Record<JenisDokumenPenjualan, JenisNomorCetak>> = {
  penawaran: "penawaran",
  faktur: "faktur",
  penerimaan: "kwitansi",
  uangMuka: "kwitansi-dp",
};

const JALUR: Record<JenisDokumenPenjualan, string> = {
  penawaran: "/penjualan/penawaran",
  pesanan: "/penjualan/pesanan",
  faktur: "/penjualan/faktur",
  penerimaan: "/penjualan/penerimaan",
  uangMuka: "/penjualan/uang-muka",
};

function hakUbah(jenis: string): Hak {
  if (!jenisDokumenPenjualanSah(jenis)) throw new Error("Jenis dokumen tidak dikenal");
  return HAK_UBAH[jenis];
}

/**
 * Sesi diperiksa lebih dulu, baru jenis dan hak (tinjauan P25 R3), supaya pemanggil tanpa sesi selalu mendapat
 * penolakan sesi, bukan pesan validasi jenis.
 */
async function wajibHakJenisAksi(hak: (jenis: string) => Hak, jenis: string): Promise<PenggunaSesi> {
  const pengguna = await wajibMasukAksi();
  pastikanHak(pengguna, hak(jenis));
  return pengguna;
}

function segarkan(...jalur: string[]) {
  for (const j of jalur) revalidatePath(j);
}

// ---------- Ubah penawaran draf ----------

/**
 * Mengubah penawaran yang belum dikonversi (D2 §3.11): semua isian buatPenawaran dengan aturan yang sama. Perusahaan
 * tidak bisa diganti. Kunci teks yang tidak ada di formulir memakai nilai tersimpan; nomor cetak hanya berubah bila
 * diisi nomor manual baru; baris dan rencana termin diganti seluruhnya dan rencana diselesaikan ulang terhadap total
 * baru (KONTRAK-TAMBAHAN P23/P25).
 */
export async function ubahPenawaran(id: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("penawaran.ubah");
  const lama = await db.penawaranPenjualan.findUnique({ where: { id } });
  if (!lama) throw new Error("Penawaran tidak ditemukan");
  if (lama.status !== "DRAF") throw new Error("Penawaran yang sudah dikonversi tidak bisa diubah; ubah tampilannya saja");
  const perusahaanId = lama.perusahaanId;
  const isianPerusahaan = rapikanTeks(dataFormulir.get("perusahaanId"));
  if (isianPerusahaan && isianPerusahaan !== perusahaanId) throw new Error("Perusahaan penawaran tidak bisa diganti");
  // perusahaan arsip ditolak seperti perusahaanDokumenBaru di buat (tinjauan P25 R5)
  const perusahaan = await db.perusahaan.findUnique({ where: { id: perusahaanId }, select: { nama: true, aktif: true } });
  if (perusahaan && !perusahaan.aktif) throw new Error(`Perusahaan ${perusahaan.nama} sudah diarsipkan; penawarannya tidak bisa diubah`);

  // urutan pemeriksaan sama dengan buatPenawaran: pelanggan, baris, hak nego, barang, proyek
  const pelangganId = rapikanTeks(dataFormulir.get("pelangganId")) ?? "";
  if (!pelangganId) throw new Error("Pelanggan wajib dipilih");
  const mode = bacaModeDokumen(dataFormulir.get("mode"));
  const daftarBaris = bacaBarisDokumen(dataFormulir, { mode });
  await periksaHakBarisBebas(db, pengguna, daftarBaris);
  const berbarang = barisBerbarang(daftarBaris);
  await periksaHargaNego(db, pengguna, berbarang);
  await pastikanBarangMilik(db, berbarang.map((l) => l.barangId), perusahaanId);
  const proyekId = await bacaProyekId(dataFormulir, db, perusahaanId);

  const ringkasan = bacaRingkasanDokumen(dataFormulir, daftarBaris, "penawaran");
  if (ringkasan.fee.isNegative()) throw new Error("Management fee tidak boleh negatif");
  const [pengaturan, pengaturanDokumen] = await Promise.all([
    ambilPengaturanPerusahaan(db, perusahaanId),
    db.pengaturanDokumenPenjualan.findUnique({ where: { perusahaanId }, select: { tampilanEvent: true } }),
  ]);
  const ppnPersen = bacaTarifPpn(dataFormulir.get("ppnPersen"), pengaturan);
  const tampilanEvent = bacaTampilanEvent(dataFormulir.get("tampilanEvent"), pengaturanDokumen?.tampilanEvent ?? "RINCI");
  const rencana = selesaikanRencana(bacaRencanaTermin(dataFormulir), ringkasan.total);
  periksaBrutoRencana(rencana, ppnPersen);

  const teks = bacaTeksDokumen(dataFormulir, KOLOM_TEKS_PENAWARAN, { warisan: lama });
  const nilaiAddOn = dataFormulir.has("nilaiAddOn") ? bacaNilaiAddOn(dataFormulir.get("nilaiAddOn")) : lama.nilaiAddOn;
  // berlaku sampai yang tidak diubah boleh sudah lewat; tanggal baru tidak boleh sebelum hari ini (aturan buat)
  let berlakuSampai = lama.berlakuSampai;
  if (dataFormulir.has("berlakuSampai")) {
    const t = bacaBerlakuSampai(dataFormulir.get("berlakuSampai"), { saatBuat: false });
    const sama = (t ? tanggalIso(t) : null) === (lama.berlakuSampai ? tanggalIso(lama.berlakuSampai) : null);
    berlakuSampai = sama ? lama.berlakuSampai : bacaBerlakuSampai(dataFormulir.get("berlakuSampai"), { saatBuat: true });
  }
  // lead: kunci leadId yang ada di formulir mengganti tautan (kosong = lepas); lead baru diperiksa seperti saat buat
  const leadId = dataFormulir.has("leadId") ? rapikanTeks(dataFormulir.get("leadId")) : lama.leadId;
  if (leadId && leadId !== lama.leadId) pastikanHak(pengguna, "lead.lihat");
  // nomor cetak: otomatis tetap; nomor manual baru boleh mengganti (unik per perusahaan, kecuali dokumen ini)
  const isianNomor = rapikanTeks(dataFormulir.get("nomorCetak"));
  const nomorBaru = isianNomor && isianNomor !== lama.nomorCetak ? await bacaNomorCetakManual(db, { jenis: "penawaran", perusahaanId, isian: isianNomor, kecualiId: id }) : null;
  const nomorCetak = nomorBaru ?? lama.nomorCetak;

  await db.$transaction(async (tx) => {
    if (leadId && leadId !== lama.leadId) await pastikanLeadUntukPenawaran(tx, leadId, perusahaanId);
    const kopSuratId = dataFormulir.has("kopSuratId") ? await pastikanKopSuratDokumen(tx, bacaKopSuratId(dataFormulir), perusahaanId) : lama.kopSuratId;
    const baris = adaBarisBebas(daftarBaris) ? isiBarangLainLain(daftarBaris, await pastikanBarangLainLain(tx)) : (daftarBaris as (BarisDokumen & { barangId: string })[]);
    // bersyarat status DRAF: konversi yang berjalan bersamaan menang atau kalah utuh (klaimnya juga bersyarat)
    const { count } = await (nomorBaru ? simpanNomorCetak(nomorBaru, () => tulis()) : tulis());
    async function tulis() {
      return tx.penawaranPenjualan.updateMany({
        where: { id, status: "DRAF" },
        data: {
          pelangganId,
          proyekId,
          total: ringkasan.total,
          mode,
          tampilanEvent,
          jenisDiskon: ringkasan.jenisDiskon,
          nilaiDiskon: ringkasan.nilaiDiskon,
          diskon: ringkasan.diskon,
          jenisFee: ringkasan.jenisFee,
          nilaiFee: ringkasan.nilaiFee,
          fee: ringkasan.fee,
          ppnPersen,
          ...teks,
          nilaiAddOn,
          berlakuSampai,
          kopSuratId,
          leadId,
          nomorCetak,
        },
      });
    }
    if (count !== 1) throw new Error("Penawaran yang sudah dikonversi tidak bisa diubah; ubah tampilannya saja");
    await tx.barisPenawaranPenjualan.deleteMany({ where: { penawaranId: id } });
    await tx.barisPenawaranPenjualan.createMany({ data: dataBarisDokumen(baris).map((b) => ({ ...b, penawaranId: id })) });
    await tx.rencanaTermin.deleteMany({ where: { penawaranId: id } });
    if (rencana.length) await tx.rencanaTermin.createMany({ data: dataButirTermin(rencana, perusahaanId).map((b) => ({ ...b, penawaranId: id })) });
    await catatLogPenjualan(tx, pengguna, {
      aksi: "UBAH",
      jenis: LABEL_DOKUMEN_PENJUALAN.penawaran,
      nomor: lama.nomor,
      keterangan: "Penawaran draf diubah",
      entitasId: id,
      perusahaanId,
      meta: { totalLama: D(lama.total).toFixed(2), totalBaru: ringkasan.total.toFixed(2) },
    });
  });
  segarkan(JALUR.penawaran, `${JALUR.penawaran}/${id}`);
}

// ---------- Status komersial penawaran ----------

/** Status komersial penawaran (D2 §3.10). Penawaran yang sudah dikonversi terkunci di Diterima. */
export async function ubahStatusPenawaran(id: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("penawaran.ubah");
  const ke = rapikanTeks(dataFormulir.get("statusKomersial"));
  if (!ke || !(STATUS_KOMERSIAL as string[]).includes(ke)) throw new Error("Status komersial tidak dikenal");
  const statusKe = ke as StatusKomersial;

  await db.$transaction(async (tx) => {
    // kunci baris penawaran supaya bergiliran dengan konversi dan ubah status lain
    await tx.$queryRaw`SELECT 1 FROM "PenawaranPenjualan" WHERE "id" = ${id} FOR UPDATE`;
    const p = await tx.penawaranPenjualan.findUnique({ where: { id }, select: { nomor: true, status: true, statusKomersial: true, perusahaanId: true } });
    if (!p) throw new Error("Penawaran tidak ditemukan");
    if (p.status === "DIKONVERSI" && statusKe !== "DITERIMA") throw new Error("Penawaran sudah menjadi pesanan; statusnya tetap Diterima");
    if (p.statusKomersial === statusKe) return;
    await tx.penawaranPenjualan.update({ where: { id }, data: { statusKomersial: statusKe, statusKomersialPada: new Date() } });
    await catatLogPenjualan(tx, pengguna, {
      aksi: "UBAH_STATUS",
      jenis: LABEL_DOKUMEN_PENJUALAN.penawaran,
      nomor: p.nomor,
      keterangan: `Status komersial ${LABEL_STATUS_KOMERSIAL[p.statusKomersial]} menjadi ${LABEL_STATUS_KOMERSIAL[statusKe]}`,
      entitasId: id,
      perusahaanId: p.perusahaanId,
      meta: { dari: p.statusKomersial, ke: statusKe },
    });
  });
  segarkan(JALUR.penawaran, `${JALUR.penawaran}/${id}`);
}

// ---------- Ubah tampilan ----------

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
type DokumenTampilan = { id: string; nomor: string; perusahaanId: string; nomorCetak?: string | null; statusPersetujuan?: string } & Record<string, unknown>;

async function bacaDokumenTampilan(tx: typeof db | Tx, jenis: JenisDokumenPenjualan, id: string): Promise<DokumenTampilan | null> {
  switch (jenis) {
    case "penawaran":
      return tx.penawaranPenjualan.findUnique({ where: { id } });
    case "pesanan":
      return tx.pesananPenjualan.findUnique({ where: { id } });
    case "faktur":
      return tx.fakturPenjualan.findUnique({ where: { id } });
    case "penerimaan":
      return tx.penerimaanPenjualan.findUnique({ where: { id } });
    case "uangMuka":
      return tx.uangMukaPelanggan.findUnique({ where: { id } });
  }
}

/**
 * Mengubah kolom tampilan dokumen (daftar putih KOLOM_TAMPILAN, D2 §3.11) dan teks baris. Kunci di luar daftar putih
 * diabaikan, jadi nilai uang tidak pernah tertulis. Nomor cetak manual unik per perusahaan; nomor cetak faktur yang
 * sudah disetujui hanya untuk pemegang faktur.setujui. Faktur dikunci seperti persetujuan supaya tidak berlomba
 * dengan posting nomor cetak.
 */
export async function ubahTampilanDokumen(jenis: JenisDokumenPenjualan, id: string, dataFormulir: FormData) {
  const pengguna = await wajibHakJenisAksi(hakUbah, jenis);
  const { kolom, data } = bacaIsianTampilan(jenis, dataFormulir);
  const barisIsian = jenis === "penawaran" || jenis === "pesanan" || jenis === "faktur" ? bacaBarisTampilan(dataFormulir) : [];
  const awal = await bacaDokumenTampilan(db, jenis, id);
  if (!awal) throw new Error(`${LABEL_DOKUMEN_PENJUALAN[jenis]} tidak ditemukan`);
  const jenisNomor = JENIS_NOMOR[jenis];
  if (kolom.includes("nomorCetak") && jenisNomor && data.nomorCetak !== null && data.nomorCetak !== awal.nomorCetak) {
    data.nomorCetak = await bacaNomorCetakManual(db, { jenis: jenisNomor, perusahaanId: awal.perusahaanId, isian: data.nomorCetak, kecualiId: id });
  }

  await db.$transaction(async (tx) => {
    if (jenis === "faktur") await BERKAS.faktur.kunci(tx, id);
    // baris pesanan dikunci urut id sebelum kepala dan barisnya ditulis, urutan yang sama dengan faktur dan surat jalan,
    // jadi urutan isian formulir (atau `urutan` yang ditukar) tidak bisa membuat deadlock (tinjauan perbaikan P27 R2)
    if (jenis === "pesanan" && barisIsian.length) await kunciBarisPesananPenjualan(tx, id, barisIsian.map((b) => b.id));
    const lama = await bacaDokumenTampilan(tx, jenis, id);
    if (!lama) throw new Error(`${LABEL_DOKUMEN_PENJUALAN[jenis]} tidak ditemukan`);
    const berubahNomor = kolom.includes("nomorCetak") && (data.nomorCetak ?? null) !== (lama.nomorCetak ?? null);
    if (jenis === "faktur" && berubahNomor && lama.statusPersetujuan === "DISETUJUI" && !punyaHak(pengguna, "faktur.setujui")) {
      throw new Error("Nomor cetak faktur yang sudah disetujui hanya bisa diubah pemegang hak setujui faktur");
    }
    // aturan jatuh tempo sama dengan buat faktur (tinjauan P25 R4)
    if (jenis === "faktur" && data.jatuhTempo instanceof Date && "tanggal" in lama && lama.tanggal instanceof Date && tanggalIso(data.jatuhTempo) < tanggalIso(lama.tanggal)) {
      throw new Error("Jatuh tempo tidak boleh sebelum tanggal faktur");
    }
    if (kolom.includes("kopSuratId")) data.kopSuratId = await pastikanKopSuratDokumen(tx, (data.kopSuratId as string | null) ?? null, lama.perusahaanId);
    if (kolom.length) {
      const tulis = () => perbaruiDokumen(tx, jenis, id, data);
      await (berubahNomor && data.nomorCetak ? simpanNomorCetak(String(data.nomorCetak), tulis) : tulis());
    }
    if (barisIsian.length) {
      const tersimpan = await bacaIdBaris(tx, jenis, id);
      const milik = new Map(tersimpan.map((b) => [b.id, b]));
      for (const b of barisIsian) if (!milik.has(b.id)) throw new Error("Baris tidak ditemukan di dokumen ini");
      // mengganti nama baris memakai aturan nego yang sama dengan buat (tinjauan P25 S1): nama barang katalog yang
      // diganti dan baris bebas (JASA-LAIN) butuh harga.nego; nama yang tidak berubah tidak diperiksa
      await periksaHakBarisBebas(tx, pengguna, barisNamaDiganti(barisIsian, milik));
      for (const b of barisIsian) if (Object.keys(b.data).length) await perbaruiBaris(tx, jenis, b.id, b.data);
    }
    if (!kolom.length && !barisIsian.length) return;
    await catatLogPenjualan(tx, pengguna, {
      aksi: "UBAH_TAMPILAN",
      jenis: LABEL_DOKUMEN_PENJUALAN[jenis],
      nomor: lama.nomor,
      keterangan: "Tampilan dokumen diubah",
      entitasId: id,
      perusahaanId: lama.perusahaanId,
      meta: { ...ringkasPerubahan(lama, data, kolom), ...(barisIsian.length ? { baris: barisIsian.length } : {}) },
    });
  });
  segarkan(JALUR[jenis], `${JALUR[jenis]}/${id}`);
}


async function perbaruiDokumen(tx: Tx, jenis: JenisDokumenPenjualan, id: string, data: Record<string, unknown>): Promise<void> {
  if (jenis === "penawaran") await tx.penawaranPenjualan.update({ where: { id }, data });
  else if (jenis === "pesanan") await tx.pesananPenjualan.update({ where: { id }, data });
  else if (jenis === "faktur") await tx.fakturPenjualan.update({ where: { id }, data });
  else if (jenis === "penerimaan") await tx.penerimaanPenjualan.update({ where: { id }, data });
  else await tx.uangMukaPelanggan.update({ where: { id }, data });
}

function bacaIdBaris(tx: Tx, jenis: JenisDokumenPenjualan, id: string): Promise<{ id: string; barangId: string; nama: string | null }[]> {
  const select = { id: true, barangId: true, nama: true } as const;
  if (jenis === "penawaran") return tx.barisPenawaranPenjualan.findMany({ where: { penawaranId: id }, select });
  if (jenis === "pesanan") return tx.barisPesananPenjualan.findMany({ where: { pesananId: id }, select });
  if (jenis === "faktur") return tx.barisFakturPenjualan.findMany({ where: { fakturId: id }, select });
  return Promise.resolve([]);
}

function perbaruiBaris(tx: Tx, jenis: JenisDokumenPenjualan, id: string, data: Record<string, unknown>) {
  if (jenis === "penawaran") return tx.barisPenawaranPenjualan.update({ where: { id }, data });
  if (jenis === "pesanan") return tx.barisPesananPenjualan.update({ where: { id }, data });
  return tx.barisFakturPenjualan.update({ where: { id }, data });
}

// ---------- Rencana termin ----------

/**
 * Mengganti seluruh rencana termin (D2 §3.8): penawaran selama DRAF; pesanan selama tidak satu butir pun ditagih atau
 * dibayar. Basis = total dokumen. Butir pesanan dikunci FOR UPDATE lebih dulu, jadi pembayaran atau penerbitan tagihan
 * yang berjalan bersamaan menunggu lalu melihat rencana baru.
 */
export async function ubahRencanaTermin(jenis: "penawaran" | "pesanan", id: string, dataFormulir: FormData) {
  const pengguna = await wajibHakJenisAksi((j) => {
    if (j !== "penawaran" && j !== "pesanan") throw new Error("Rencana termin hanya ada di penawaran dan pesanan");
    return j === "penawaran" ? "penawaran.ubah" : "pesanan.ubah";
  }, jenis);
  const masukan = bacaRencanaTermin(dataFormulir);

  await db.$transaction(async (tx) => {
    let dok: { nomor: string; total: Desimal; ppnPersen: Desimal; perusahaanId: string };
    if (jenis === "penawaran") {
      await tx.$queryRaw`SELECT 1 FROM "PenawaranPenjualan" WHERE "id" = ${id} FOR UPDATE`;
      const p = await tx.penawaranPenjualan.findUnique({ where: { id }, select: { nomor: true, status: true, total: true, ppnPersen: true, perusahaanId: true } });
      if (!p) throw new Error("Penawaran tidak ditemukan");
      if (p.status !== "DRAF") throw new Error("Rencana termin penawaran yang sudah dikonversi tidak bisa diubah; ubah di pesanannya");
      dok = p;
    } else {
      await tx.$queryRaw`SELECT 1 FROM "RencanaTermin" WHERE "pesananId" = ${id} ORDER BY "id" FOR UPDATE`;
      const p = await tx.pesananPenjualan.findUnique({
        where: { id },
        select: { nomor: true, total: true, ppnPersen: true, perusahaanId: true, rencanaTermin: { select: { label: true, ditagihPada: true, _count: { select: { uangMuka: true } } } } },
      });
      if (!p) throw new Error("Pesanan tidak ditemukan");
      pastikanRencanaPesananBolehDiubah(p.rencanaTermin.map((b) => ({ label: b.label, ditagihPada: b.ditagihPada, jumlahUangMuka: b._count.uangMuka })));
      dok = p;
    }
    const rencana = selesaikanRencana(masukan, dok.total);
    periksaBrutoRencana(rencana, dok.ppnPersen);
    const induk = jenis === "penawaran" ? { penawaranId: id } : { pesananId: id };
    await tx.rencanaTermin.deleteMany({ where: induk });
    if (rencana.length) await tx.rencanaTermin.createMany({ data: dataButirTermin(rencana, dok.perusahaanId).map((b) => ({ ...b, ...induk })) });
    await catatLogPenjualan(tx, pengguna, {
      aksi: "UBAH_TERMIN",
      jenis: LABEL_DOKUMEN_PENJUALAN[jenis],
      nomor: dok.nomor,
      keterangan: rencana.length ? `Rencana termin diganti (${rencana.length} butir)` : "Rencana termin dikosongkan",
      entitasId: id,
      perusahaanId: dok.perusahaanId,
      meta: { jumlahButir: rencana.length },
    });
  });
  segarkan(JALUR[jenis], `${JALUR[jenis]}/${id}`);
}

// ---------- Tagihan termin ----------

/**
 * Menerbitkan tagihan termin satu butir pesanan (D2 §6.2): ditagihPada diisi bila kosong, nomor cetak diisi bila kosong
 * (manual atau otomatis "tagihan-termin", ditulis bersyarat nomorCetak null), jatuh tempo diperbarui bila diisi.
 * Terbit ulang tanpa perubahan tidak mengubah apa pun. Tidak ada jurnal.
 */
export async function terbitkanTagihanTermin(rencanaTerminId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("pesanan.ubah");
  const awal = await db.rencanaTermin.findUnique({ where: { id: rencanaTerminId }, select: { perusahaanId: true, pesananId: true, nomorCetak: true } });
  if (!awal) throw new Error("Termin tidak ditemukan");
  if (!awal.pesananId) throw new Error("Tagihan termin diterbitkan dari pesanan");
  const jatuhTempo = bacaTanggalIsian(dataFormulir.get("jatuhTempo"), "Jatuh tempo tidak valid");
  const isianNomor = rapikanTeks(dataFormulir.get("nomorCetak"));
  const manual = !awal.nomorCetak && isianNomor ? await bacaNomorCetakManual(db, { jenis: "tagihan-termin", perusahaanId: awal.perusahaanId, isian: isianNomor, kecualiId: rencanaTerminId }) : null;

  await db.$transaction(async (tx) => {
    const k = await kunciButirTermin(tx, rencanaTerminId);
    if (!k) throw new Error("Termin tidak ditemukan");
    const b = k.butir;
    if (!b.pesananId) throw new Error("Tagihan termin diterbitkan dari pesanan");
    const { jatuhTempo: jatuhTempoLama } = await tx.rencanaTermin.findUniqueOrThrow({ where: { id: b.id }, select: { jatuhTempo: true } });
    const sekarang = new Date();
    let nomorCetak = b.nomorCetak;
    if (!nomorCetak) {
      nomorCetak = manual ?? (await alokasiNomorCetak(tx, { perusahaanId: awal.perusahaanId, jenis: "tagihan-termin", tanggal: b.ditagihPada ?? sekarang }));
      if (nomorCetak) {
        const nomor = nomorCetak;
        const { count } = await simpanNomorCetak(nomor, () => tx.rencanaTermin.updateMany({ where: { id: b.id, nomorCetak: null }, data: { nomorCetak: nomor } }));
        if (count !== 1) throw new Error(`Termin ${b.label} sudah diproses orang lain. Muat ulang halaman lalu periksa statusnya`);
      }
    }
    const ubahJatuhTempo = jatuhTempo && (!jatuhTempoLama || tanggalIso(jatuhTempoLama) !== tanggalIso(jatuhTempo));
    if (!b.ditagihPada || ubahJatuhTempo) {
      await tx.rencanaTermin.update({ where: { id: b.id }, data: { ditagihPada: b.ditagihPada ?? sekarang, ...(ubahJatuhTempo ? { jatuhTempo } : {}) } });
    }
    if (b.ditagihPada && !ubahJatuhTempo && nomorCetak === b.nomorCetak) return;
    const pesanan = await tx.pesananPenjualan.findUniqueOrThrow({ where: { id: b.pesananId }, select: { nomor: true } });
    await catatLogPenjualan(tx, pengguna, {
      aksi: "TERBITKAN",
      jenis: "Tagihan Termin",
      nomor: pesanan.nomor,
      keterangan: `Tagihan ${b.label} diterbitkan${nomorCetak ? ` dengan nomor ${nomorCetak}` : ""}`,
      entitasId: b.id,
      perusahaanId: awal.perusahaanId,
      meta: { no: b.no, label: b.label, nomorCetak },
    });
  });
  segarkan(JALUR.pesanan, `${JALUR.pesanan}/${awal.pesananId}`);
}

/**
 * Membatalkan tagihan termin (D2 §6.2): ditagihPada dan nomorCetak dikosongkan (lubang nomor diterima). Ditolak bila
 * butir sudah dibayar. Pemeriksaan dan penulisan di satu transaksi lewat pastikanBatalTagihanTermin (kunci butir).
 */
export async function batalkanTagihanTermin(rencanaTerminId: string) {
  const pengguna = await wajibHakAksi("pesanan.ubah");
  const pesananId = await db.$transaction(async (tx) => {
    const b = await pastikanBatalTagihanTermin(tx, rencanaTerminId);
    if (!b.ditagihPada && !b.nomorCetak) return b.pesananId;
    await tx.rencanaTermin.update({ where: { id: b.id }, data: { ditagihPada: null, nomorCetak: null } });
    const pesanan = await tx.pesananPenjualan.findUniqueOrThrow({ where: { id: b.pesananId! }, select: { nomor: true, perusahaanId: true } });
    await catatLogPenjualan(tx, pengguna, {
      aksi: "BATAL",
      jenis: "Tagihan Termin",
      nomor: pesanan.nomor,
      keterangan: `Tagihan ${b.label} dibatalkan${b.nomorCetak ? `; nomor ${b.nomorCetak} dilepas` : ""}`,
      entitasId: b.id,
      perusahaanId: pesanan.perusahaanId,
      meta: { nomorCetakLama: b.nomorCetak },
    });
    return b.pesananId;
  });
  segarkan(JALUR.pesanan, `${JALUR.pesanan}/${pesananId}`);
}

// ---------- Pengaturan dokumen dan format nomor ----------

async function bacaPerusahaanIsian(dataFormulir: FormData) {
  const perusahaanId = rapikanTeks(dataFormulir.get("perusahaanId"));
  if (!perusahaanId) throw new Error("Perusahaan wajib dipilih");
  const p = await db.perusahaan.findUnique({ where: { id: perusahaanId }, select: { id: true, kode: true } });
  if (!p) throw new Error("Perusahaan tidak ditemukan");
  return p;
}

/** Pengaturan dokumen penjualan per perusahaan (D2 §6.2): syarat pembayaran, tampilan event, seksi, teks penawaran. */
export async function simpanPengaturanDokumenPenjualan(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("pengaturan.tulis");
  const p = await bacaPerusahaanIsian(dataFormulir);
  const data = {
    syaratPembayaran: bacaTeks(dataFormulir.get("syaratPembayaran"), "syaratPembayaran"),
    tampilanEvent: bacaTampilanEvent(dataFormulir.get("tampilanEvent"), "RINCI"),
    daftarSeksi: rapikanDaftarSeksi(String(dataFormulir.get("daftarSeksi") ?? "")),
    teksPembukaPenawaran: bacaTeks(dataFormulir.get("teksPembukaPenawaran"), "teksPembuka"),
    teksPenutupPenawaran: bacaTeks(dataFormulir.get("teksPenutupPenawaran"), "teksPenutup"),
  };
  await db.$transaction(async (tx) => {
    await tx.pengaturanDokumenPenjualan.upsert({ where: { perusahaanId: p.id }, create: { perusahaanId: p.id, ...data }, update: data });
    await catatLogPenjualan(tx, pengguna, {
      aksi: "UBAH",
      jenis: "Pengaturan Dokumen Penjualan",
      nomor: p.kode,
      keterangan: `Pengaturan dokumen penjualan disimpan (${data.daftarSeksi.length} seksi)`,
      entitasId: p.id,
      perusahaanId: p.id,
    });
  });
  segarkan("/pengaturan");
}

/** Isian boolean formulir: nilai terakhir (kotak centang sesudah isian tersembunyi); tidak ada = bawaan. */
function bacaCentang(dataFormulir: FormData, kunci: string, bawaan: boolean): boolean {
  const semua = dataFormulir.getAll(kunci);
  if (semua.length === 0) return bawaan;
  const v = String(semua[semua.length - 1]).trim().toLowerCase();
  if (["1", "true", "on", "ya"].includes(v)) return true;
  if (["0", "false", "off", "tidak", ""].includes(v)) return false;
  throw new Error(`Isian ${kunci} tidak valid`);
}

/**
 * Format nomor cetak per perusahaan dan jenis (D2 §3.7). Jenis berkunci deret sama wajib memakai reset yang sama
 * (KONTRAK-TAMBAHAN P28). nomorTerakhir menyetel penghitung periode berjalan, tidak boleh mundur.
 */
export async function simpanFormatNomor(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("pengaturan.tulis");
  const p = await bacaPerusahaanIsian(dataFormulir);
  const f = bacaFormatNomor({
    jenis: dataFormulir.get("jenis"),
    pola: dataFormulir.get("pola"),
    prefiks: dataFormulir.get("prefiks"),
    kode: dataFormulir.get("kode"),
    digit: dataFormulir.get("digit"),
    kunciDeret: dataFormulir.get("kunciDeret"),
    // "resetNomor" dipakai halaman pengaturan: isian bernama "reset" menimpa method form.reset() di peramban, sehingga
    // reset formulir React sesudah aksi gagal. Kunci lama "reset" tetap diterima.
    reset: dataFormulir.get("resetNomor") ?? dataFormulir.get("reset"),
  });
  const aktif = bacaCentang(dataFormulir, "aktif", true);
  const teksTerakhir = rapikanTeks(dataFormulir.get("nomorTerakhir"));
  let nomorTerakhir: number | null = null;
  if (teksTerakhir !== null) {
    if (!/^\d+$/.test(teksTerakhir)) throw new Error("Nomor terakhir harus bilangan bulat 0 atau lebih");
    nomorTerakhir = Number(teksTerakhir);
  }

  await db.$transaction(async (tx) => {
    // kunci penasihat per (perusahaan, kunci deret) supaya dua simpan format serentak berkunci deret sama tidak lolos
    // pemeriksaan reset deret bersama. Bukan FOR UPDATE pada Perusahaan, karena itu menahan setiap sisipan dokumen
    // perusahaan (FOR KEY SHARE) dan bisa deadlock dengan alokasi nomor cetak (tinjauan P25 R2).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('format-nomor'), hashtext(${p.id + "/" + f.kunciDeret}))`;
    const lain = await tx.formatNomor.findFirst({ where: { perusahaanId: p.id, kunciDeret: f.kunciDeret, NOT: { jenis: f.jenis }, reset: { not: f.reset } }, select: { jenis: true, reset: true } });
    if (lain) throw new Error(`Format ${lain.jenis} memakai kunci deret ${f.kunciDeret} dengan reset ${lain.reset}; jenis dengan kunci deret sama wajib memakai reset yang sama`);
    const lama = await tx.formatNomor.findUnique({ where: { perusahaanId_jenis: { perusahaanId: p.id, jenis: f.jenis } }, select: { pola: true } });
    const data = { pola: f.pola, prefiks: f.prefiks, kode: f.kode, digit: f.digit, kunciDeret: f.kunciDeret, reset: f.reset, aktif };
    await tx.formatNomor.upsert({ where: { perusahaanId_jenis: { perusahaanId: p.id, jenis: f.jenis } }, create: { perusahaanId: p.id, jenis: f.jenis, ...data }, update: data });
    if (nomorTerakhir !== null) await setelNomorTerakhir(tx, { perusahaanId: p.id, kunciDeret: f.kunciDeret, reset: f.reset, nilai: nomorTerakhir });
    await catatLogPenjualan(tx, pengguna, {
      aksi: "UBAH",
      jenis: "Format Nomor Cetak",
      nomor: `${p.kode}/${f.jenis}`,
      keterangan: `Format nomor ${f.jenis} disimpan: ${f.pola}${aktif ? "" : " (nonaktif)"}`,
      entitasId: p.id,
      perusahaanId: p.id,
      meta: { polaLama: lama?.pola ?? null, polaBaru: f.pola, nomorTerakhir },
    });
  });
  segarkan("/pengaturan");
}

/** Menghapus format nomor; penghitung dibiarkan supaya nomor tidak terulang bila format dipasang lagi. */
export async function hapusFormatNomor(id: string) {
  const pengguna = await wajibHakAksi("pengaturan.tulis");
  await db.$transaction(async (tx) => {
    const f = await tx.formatNomor.findUnique({ where: { id }, include: { perusahaan: { select: { kode: true } } } });
    if (!f) throw new Error("Format nomor tidak ditemukan");
    await tx.formatNomor.delete({ where: { id } });
    await catatLogPenjualan(tx, pengguna, {
      aksi: "HAPUS",
      jenis: "Format Nomor Cetak",
      nomor: `${f.perusahaan.kode}/${f.jenis}`,
      keterangan: `Format nomor ${f.jenis} dihapus (${f.pola}); penghitung dibiarkan`,
      entitasId: f.perusahaanId,
      perusahaanId: f.perusahaanId,
      meta: { pola: f.pola, kunciDeret: f.kunciDeret },
    });
  });
  segarkan("/pengaturan");
}

// ---------- Varian untuk <FormulirAksi> ----------

export async function ubahPenawaranFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahPenawaran(id, dataFormulir));
}
export async function ubahStatusPenawaranFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahStatusPenawaran(id, dataFormulir));
}
export async function ubahTampilanDokumenFormulir(jenis: JenisDokumenPenjualan, id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahTampilanDokumen(jenis, id, dataFormulir));
}
export async function ubahRencanaTerminFormulir(jenis: "penawaran" | "pesanan", id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahRencanaTermin(jenis, id, dataFormulir));
}
export async function terbitkanTagihanTerminFormulir(rencanaTerminId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => terbitkanTagihanTermin(rencanaTerminId, dataFormulir));
}
// Dipakai lewat .bind(null, id); argumen (prevState, dataFormulir) dari useActionState sengaja diabaikan
export async function batalkanTagihanTerminFormulir(rencanaTerminId: string) {
  return jalankanFormulir(() => batalkanTagihanTermin(rencanaTerminId));
}
export async function simpanPengaturanDokumenPenjualanFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => simpanPengaturanDokumenPenjualan(dataFormulir));
}
export async function simpanFormatNomorFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => simpanFormatNomor(dataFormulir));
}
export async function hapusFormatNomorFormulir(id: string) {
  return jalankanFormulir(() => hapusFormatNomor(id));
}
