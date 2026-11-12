import type { JenisAsetKop } from "@/prisma-klien/enums";
import { db } from "@/lib/db";
import { punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { dariDataPenjualan } from "@/lib/cetak/dariDataPenjualan";
import { desimalDokumen, namaBerkasAman, type NilaiAngka } from "@/lib/cetak/format";
import { GalatCetak, SLOT_TATA_LETAK, identitasCetak, muatAsetKop, pilihKopDanTemplate, tataLetakHka, temaKop } from "@/lib/cetak/kop";
import { buatPerekam, type Perekam } from "@/lib/cetak/mesin/kanvas";
import type { MasukanTataLetak } from "@/lib/cetak/tataLetak/blok";
import { renderDokumen } from "@/lib/cetak/tataLetak";
import type { DokumenCetak, DokumenCetakPenjualan, HasilPdf, OpsiCetak, TampilanEventCetak } from "@/lib/cetak/tipe";
import type { Prisma, PrismaClient } from "@/prisma-klien/client";

/*
 * Penyaji cetak dokumen penjualan (D3 §6.2): satu-satunya pintu dari data D2 ke PDF. Dipakai rute GET /cetak/[jenis]/[id]
 * dan pratinjau contoh (P31), serta aksi simpan PDF D2 (P45). Tidak memeriksa hak lihat dokumen: pemanggil wajib
 * memeriksa HAK_CETAK_PENJUALAN lebih dulu. Hak tanda-tangan-cetak.buat diperiksa di sini (D3 §3.3). Juga mengekspor
 * mesin dan format untuk laporan keuangan proyek (D5).
 */

export { GalatCetak } from "@/lib/cetak/kop";
export type { HasilPdf, OpsiCetak } from "@/lib/cetak/tipe";
export { KanvasCetak, KERTAS, GalatIsiTerlaluTinggi, buatPerekam, type Perekam } from "@/lib/cetak/mesin/kanvas";
export { gambarTabel, type BarisTabel, type SelTabel } from "@/lib/cetak/mesin/tabel";
export { bersihkanTeks, formatAngka, formatJumlah, formatRupiah, formatTanggalPanjang, formatTanggalPendek, namaBerkasAman } from "@/lib/cetak/format";
export { terbilangRupiah } from "@/lib/cetak/terbilang";
export { jalurFont } from "@/lib/cetak/aset";

type KlienDb = PrismaClient | Prisma.TransactionClient;

const PESAN_UKURAN = "Ukuran kertas tidak dikenal";
const UKURAN_OPSI: Record<string, NonNullable<OpsiCetak["ukuran"]>> = { A4: "A4", A5: "A5", A5L: "A5L", A5_LANDSCAPE: "A5L" };
const TAMPILAN_OPSI: Record<string, TampilanEventCetak> = { RINCI: "RINCI", RINGKAS: "RINGKAS" };

/** Nilai terakhir sebuah kunci (pola isian tersembunyi "0" lalu kotak centang "1"). */
function terakhir(sumber: URLSearchParams | FormData, kunci: string): string | null {
  const semua = sumber.getAll(kunci);
  const v = semua[semua.length - 1];
  return typeof v === "string" ? v.trim() : null;
}

/**
 * Baca opsi cetak dari query rute GET atau FormData aksi simpan PDF (D3 §6.2): `kop` (id kop), `ukuran` (A4, A5, A5L;
 * kosong = template), `ttd` (nilai terakhir: 1/on/true atau 0/false), `tampilan` (rinci/ringkas). Nilai yang tidak
 * dikenal menjadi GalatCetak 400.
 */
export function bacaOpsiCetak(sumber: URLSearchParams | FormData): OpsiCetak {
  const kop = terakhir(sumber, "kop") || null;
  const u = terakhir(sumber, "ukuran")?.toUpperCase() || null;
  if (u !== null && !(u in UKURAN_OPSI)) throw new GalatCetak(400, PESAN_UKURAN);
  const t = terakhir(sumber, "ttd");
  let ttd: boolean | null = null;
  if (t !== null && t !== "") {
    if (["1", "on", "true", "ya"].includes(t.toLowerCase())) ttd = true;
    else if (["0", "off", "false", "tidak"].includes(t.toLowerCase())) ttd = false;
    else throw new GalatCetak(400, "Pilihan tanda tangan tidak dikenal");
  }
  const tp = terakhir(sumber, "tampilan")?.toUpperCase() || null;
  if (tp !== null && !(tp in TAMPILAN_OPSI)) throw new GalatCetak(400, "Tampilan event tidak dikenal");
  return { kopId: kop, ukuran: u ? UKURAN_OPSI[u] : null, ttd, tampilan: tp ? TAMPILAN_OPSI[tp] : null };
}

/** Semua nilai uang dokumen, untuk jumlah desimal cetak (desimalDokumen, D3 §3.4). */
function nilaiUang(d: DokumenCetak): NilaiAngka[] {
  const r = d.ringkasan;
  const kt = d.konteksTermin;
  return [
    ...[...d.baris, ...d.lampiranItem].flatMap((b) => [b.harga, b.nilai]),
    r.subtotal,
    r.diskon,
    r.fee,
    r.dpp,
    r.ppn,
    r.total,
    r.uangMuka,
    r.terbayar,
    r.retur,
    r.sisa,
    ...(r.addOn ? [r.addOn.nilai] : []),
    ...d.skemaTermin.map((t) => t.jumlahBruto),
    ...d.uangMukaDipakai.map((u) => u.jumlah),
    ...(kt ? [kt.jumlah, kt.jumlahBruto, kt.nilaiKontrakBruto, ...(kt.dibayarSebelumnya ? [kt.dibayarSebelumnya] : []), kt.sisaSetelahTermin] : []),
    ...(d.kwitansi ? [d.kwitansi.jumlah, d.kwitansi.potonganPajak] : []),
  ];
}

const SLOT_BERNILAI_HUKUM: readonly string[] = ["TANDA_TANGAN", "STEMPEL"];

/**
 * Pilih kop dan template, siapkan identitas, tema, dan aset, lalu render PDF (D3 §3.1, §3.3). Tanda tangan dan
 * stempel hanya diminta bila `ttd` (atau template.tandaTanganBawaan saat ttd kosong) DAN pengguna memegang
 * tanda-tangan-cetak.buat; tata letak sendiri menolak draf dan kop tanpa gambarnya. `HasilPdf.tandaTangan` = gambar
 * tanda tangan atau stempel benar-benar tergambar. Galat: GalatCetak (kop atau perusahaan tidak cocok) dan
 * GalatIsiTerlaluTinggi (isi tidak muat); keduanya aman ditampilkan.
 */
export async function renderPdfDokumenPenjualan(
  data: DokumenCetakPenjualan,
  pengguna: PenggunaSesi,
  opsi: Partial<OpsiCetak> = {},
  tambahan: { perekam?: Perekam; stempel?: string; klien?: KlienDb } = {},
): Promise<HasilPdf> {
  const klien = tambahan.klien ?? db;
  const perekam = tambahan.perekam ?? buatPerekam();
  const dok = dariDataPenjualan(data);
  const perusahaan = await klien.perusahaan.findUnique({
    where: { id: dok.perusahaanId },
    select: {
      nama: true,
      namaLegal: true,
      alamat: true,
      kota: true,
      telepon: true,
      email: true,
      website: true,
      instagram: true,
      npwp: true,
      namaBank: true,
      cabangBank: true,
      nomorRekening: true,
      atasNamaRekening: true,
      penandaTangan: true,
      jabatanPenandaTangan: true,
    },
  });
  if (!perusahaan) throw new GalatCetak(404, "Perusahaan penerbit dokumen tidak ditemukan");
  const pilihan = await pilihKopDanTemplate(klien, dok, opsi, perekam);
  const tandaTangan = (opsi.ttd ?? pilihan.template.tandaTanganBawaan) && punyaHak(pengguna, "tanda-tangan-cetak.buat");
  const slot: JenisAsetKop[] = [...SLOT_TATA_LETAK[pilihan.tataLetak]];
  if (tandaTangan && !dok.draf) slot.push("TANDA_TANGAN", ...(tataLetakHka(pilihan.tataLetak) ? (["STEMPEL"] as const) : []));
  const aset = await muatAsetKop(klien, pilihan.kop, slot, perekam);

  const m: MasukanTataLetak = {
    dok,
    identitas: identitasCetak(pilihan.kop, perusahaan),
    judul: pilihan.judul,
    ukuran: pilihan.ukuran,
    tandaTangan,
    perekam,
    stempel: tambahan.stempel,
    tema: { ...temaKop(pilihan.kop), gayaAngka: pilihan.gayaAngka, desimal: desimalDokumen(nilaiUang(dok)), aset },
  };
  const gambarSebelum = perekam.gambar.length;
  const isi = await renderDokumen(m, { tataLetak: pilihan.tataLetak, tampilanEvent: pilihan.tampilanEvent, judulBerkas: pilihan.judulBerkas });
  return {
    isi,
    namaBerkas: namaBerkasAman(pilihan.judulBerkas, dok.nomorTampil, dok.draf),
    judul: pilihan.judul,
    ukuran: pilihan.ukuran,
    tataLetak: pilihan.tataLetak,
    kopSuratId: pilihan.kop.id,
    tandaTangan: perekam.gambar.slice(gambarSebelum).some((g) => SLOT_BERNILAI_HUKUM.includes(g.slot ?? "")),
  };
}
