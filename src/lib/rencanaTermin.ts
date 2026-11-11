import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import type { JenisNilai } from "@/prisma-klien/enums";
import { D, format, jumlahkan, terbesar, uang, type Desimal } from "@/lib/uang";
import { hitungPpn } from "@/lib/pengaturanPerusahaan";
import { tanggalIso } from "@/lib/waktu";

/*
 * Rencana termin penawaran dan pesanan (D2 §3.8): validasi dan hitung butir, nilai termasuk PPN, batas pembayaran per
 * butir, aturan ubah, dan progres per pesanan. Berkas ini bukan "use server": pembantu untuk aksi (P23, P25) dan
 * halaman. Tagihan termin bukan faktur dan tidak pernah menyentuh jurnal; pembayarannya berupa uang muka.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

export const MAKS_BUTIR_TERMIN = 4;
export const PANJANG_LABEL_TERMIN = 40;
const NILAI_TERMIN_MAKS = D("100000000000000");

/** Satu butir kiriman formulir (isian tersembunyi `rencanaTermin`, JSON larik). */
export type ButirTerminMasukan = { label?: unknown; mode?: unknown; nilai?: unknown; jatuhTempo?: unknown };

/** Butir hasil hitung, siap disimpan ke RencanaTermin. */
export type ButirTermin = { no: number; label: string; mode: JenisNilai; nilai: Desimal; jumlah: Desimal; persen: Desimal; jatuhTempo: Date | null };

/** Membaca isian `rencanaTermin`. Tidak ada, kosong, atau "[]" berarti tanpa termin. */
export function bacaRencanaTermin(dataFormulir: FormData, kunci = "rencanaTermin"): ButirTerminMasukan[] {
  const mentah = dataFormulir.get(kunci);
  const teks = typeof mentah === "string" ? mentah.trim() : "";
  if (!teks) return [];
  let hasil: unknown;
  try {
    hasil = JSON.parse(teks);
  } catch {
    throw new Error("Format rencana termin tidak valid");
  }
  if (!Array.isArray(hasil) || hasil.some((b) => typeof b !== "object" || b === null || Array.isArray(b))) throw new Error("Format rencana termin tidak valid");
  return hasil as ButirTerminMasukan[];
}

/** Tanggal "YYYY-MM-DD" dibaca jam 12.00 (pola aksi lama, mis. prive); kosong = null, salah = galat. */
function bacaTanggalButir(nilai: unknown, n: number): Date | null {
  const teks = typeof nilai === "string" ? nilai.trim() : nilai == null ? "" : String(nilai);
  if (!teks) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(teks);
  const tanggal = m ? new Date(`${teks}T12:00:00`) : null;
  if (!tanggal || Number.isNaN(tanggal.getTime()) || tanggal.getDate() !== Number(m![3]) || tanggal.getMonth() + 1 !== Number(m![2])) {
    throw new Error(`Jatuh tempo termin ${n} tidak valid`);
  }
  return tanggal;
}

/**
 * Menyelesaikan rencana termin terhadap basis (= total dokumen, DPP kontrak sebelum PPN). Butir terakhir selalu
 * menutup sisa (basis dikurangi butir sebelumnya), jadi jumlah semua butir tepat sama dengan basis.
 */
export function selesaikanRencana(butir: readonly ButirTerminMasukan[], basisMentah: Desimal | number | string): ButirTermin[] {
  if (butir.length === 0) return [];
  if (butir.length > MAKS_BUTIR_TERMIN) throw new Error(`Rencana termin maksimal ${MAKS_BUTIR_TERMIN} butir`);
  const basis = uang(basisMentah);
  if (basis.lte(0)) throw new Error("Rencana termin butuh nilai kontrak di atas nol");
  const hasil: ButirTermin[] = [];
  let terpakai = D(0);
  butir.forEach((b, i) => {
    const n = i + 1;
    const terakhir = n === butir.length;
    const label = (typeof b.label === "string" ? b.label : b.label == null ? "" : String(b.label)).trim().replace(/\s+/g, " ");
    if (label.length > PANJANG_LABEL_TERMIN) throw new Error(`Label termin maksimal ${PANJANG_LABEL_TERMIN} karakter`);
    const modeMentah = b.mode == null || b.mode === "" ? "PERSEN" : b.mode;
    if (modeMentah !== "PERSEN" && modeMentah !== "NOMINAL") throw new Error(`Mode termin ${n} tidak dikenal`);
    const mode: JenisNilai = modeMentah;
    let nilai: Desimal;
    try {
      nilai = uang(b.nilai == null || b.nilai === "" ? 0 : (b.nilai as string | number));
    } catch {
      throw new Error(`Nilai termin ${n} tidak valid`);
    }
    if (nilai.isNegative()) throw new Error(`Nilai termin ${n} tidak boleh negatif`);
    if (nilai.gt(NILAI_TERMIN_MAKS)) throw new Error("Nilai termin terlalu besar");
    const jatuhTempo = bacaTanggalButir(b.jatuhTempo, n);
    let jumlah: Desimal;
    if (terakhir) jumlah = basis.minus(terpakai);
    else if (mode === "NOMINAL") jumlah = nilai;
    else {
      if (nilai.gt(100)) throw new Error(`Persen termin ${n} tidak boleh lebih dari 100`);
      jumlah = uang(basis.mul(nilai).div(100));
    }
    if (jumlah.lte(0)) throw new Error(terakhir ? "Termin sebelumnya sudah menutup seluruh nilai kontrak" : `Termin ${n} harus lebih dari nol`);
    terpakai = terpakai.plus(jumlah);
    hasil.push({ no: n, label: label || `Termin ${n}`, mode, nilai, jumlah, persen: uang(jumlah.div(basis).mul(100)), jatuhTempo });
  });
  return hasil;
}

/** Nilai butir termasuk PPN dokumen (tampilan, cetak, dan batas pembayaran); sama dengan with_tax HKA. */
export function brutoButir(jumlah: Desimal | number | string, ppnPersen: Desimal | number | string): Desimal {
  const j = uang(jumlah);
  return j.plus(hitungPpn(j, D(ppnPersen)));
}

/** Data Prisma butir baru (nested create di penawaran atau pesanan). perusahaanId selalu milik induk (D2 §10.6 no. 7). */
export function dataButirTermin(butir: readonly ButirTermin[], perusahaanId: string) {
  return butir.map((b) => ({ perusahaanId, no: b.no, label: b.label, mode: b.mode, nilai: b.nilai, jumlah: b.jumlah, persen: b.persen, jatuhTempo: b.jatuhTempo }));
}

/**
 * Salinan butir penawaran untuk pesanan hasil konversi (D2 §3.8, §3.9): jumlah dan persen disalin persis karena
 * basisnya sama; nomor cetak dan tanggal tagih tidak ikut.
 */
export function salinButirKePesanan(
  butir: readonly { perusahaanId: string; no: number; label: string; mode: JenisNilai; nilai: Desimal | number | string; jumlah: Desimal | number | string; persen: Desimal | number | string; jatuhTempo: Date | null }[],
) {
  return [...butir]
    .sort((a, b) => a.no - b.no)
    .map((b) => ({ perusahaanId: b.perusahaanId, no: b.no, label: b.label, mode: b.mode, nilai: D(b.nilai), jumlah: D(b.jumlah), persen: D(b.persen), jatuhTempo: b.jatuhTempo, nomorCetak: null, ditagihPada: null }));
}

/** Rencana termin pesanan hanya boleh diganti selama tidak satu butir pun sudah ditagih atau dibayar. */
export function pastikanRencanaPesananBolehDiubah(butir: readonly { label: string; ditagihPada: Date | null; jumlahUangMuka: number }[]) {
  const terkunci = butir.find((b) => b.ditagihPada || b.jumlahUangMuka > 0);
  if (terkunci) {
    throw new Error(`Termin ${terkunci.label} sudah ditagih atau dibayar; rencana tidak bisa diubah. Batalkan tagihannya atau hapus uang mukanya dulu`);
  }
}

/** Tagihan termin hanya bisa dibatalkan selama belum ada uang muka untuk butir itu. */
export function pastikanTagihanBolehDibatalkan(butir: { label: string; jumlahUangMuka: number }) {
  if (butir.jumlahUangMuka > 0) throw new Error(`Termin ${butir.label} sudah dibayar; hapus uang mukanya dulu`);
}

/**
 * Batas pembayaran satu butir (murni): butir harus milik pesanan uang muka, dan Σ uang muka butir + jumlah baru tidak
 * boleh melebihi nilai butir termasuk PPN. Batas lama per pesanan tetap diperiksa aksi uang muka.
 */
export function periksaBatasTermin(p: {
  butir: { pesananId: string | null; label: string; jumlah: Desimal | number | string };
  pesananId: string;
  ppnPersen: Desimal | number | string;
  sudahDibayar: Desimal | number | string;
  jumlahBaru: Desimal | number | string;
}): { bruto: Desimal; sisa: Desimal } {
  if (p.butir.pesananId !== p.pesananId) throw new Error("Termin tidak ditemukan di pesanan ini");
  const bruto = brutoButir(p.butir.jumlah, p.ppnPersen);
  const sisa = terbesar(bruto.minus(D(p.sudahDibayar)), D(0));
  if (D(p.jumlahBaru).gt(sisa)) throw new Error(`Pembayaran melebihi nilai termin ${p.butir.label} (sisa ${format(sisa)})`);
  return { bruto, sisa };
}

/**
 * Batas pembayaran butir di dalam transaksi uang muka: baris butir dikunci (FOR UPDATE) supaya dua pembayaran
 * bersamaan untuk butir yang sama tidak sama-sama lolos, lalu Σ uang muka butir dibaca ulang. PPN memakai tarif
 * pesanan. Mengembalikan butir untuk keterangan (label).
 */
export async function pastikanPembayaranTermin(tx: Klien, p: { rencanaTerminId: string; pesananId: string; jumlah: Desimal }) {
  await tx.$queryRaw`SELECT 1 FROM "RencanaTermin" WHERE "id" = ${p.rencanaTerminId} FOR UPDATE`;
  const butir = await tx.rencanaTermin.findUnique({
    where: { id: p.rencanaTerminId },
    select: { id: true, no: true, label: true, jumlah: true, pesananId: true, pesanan: { select: { ppnPersen: true } } },
  });
  if (!butir || !butir.pesanan) throw new Error("Termin tidak ditemukan di pesanan ini");
  const dibayar = await tx.uangMukaPelanggan.aggregate({ where: { rencanaTerminId: butir.id }, _sum: { jumlah: true } });
  periksaBatasTermin({ butir, pesananId: p.pesananId, ppnPersen: butir.pesanan.ppnPersen, sudahDibayar: dibayar._sum.jumlah ?? 0, jumlahBaru: p.jumlah });
  return butir;
}

export type StatusButirTermin = "Belum ditagih" | "Ditagih" | "Dibayar sebagian" | "Lunas";

export type ButirProgres = {
  id: string;
  no: number;
  label: string;
  jumlah: Desimal;
  persen: Desimal;
  bruto: Desimal;
  dibayar: Desimal;
  sisa: Desimal;
  status: StatusButirTermin;
  lewatJatuhTempo: boolean;
  jatuhTempo: Date | null;
  ditagihPada: Date | null;
  nomorCetak: string | null;
};

export type ProgresTermin = { nilaiKontrakBruto: Desimal; butir: ButirProgres[]; dpTanpaTermin: Desimal; totalDiterima: Desimal; belumDibayar: Desimal };

type Uang = Desimal | number | string;

/**
 * Progres termin satu pesanan (D2 §3.8, dihitung, tidak disimpan). Semua uang muka pesanan dihitung, termasuk yang
 * belum disetujui, sama dengan batas pembayaran butir. Penerimaan faktur dihitung jumlah ditambah potongan pajak,
 * yaitu nilai piutang yang lunas (rumus sisa faktur lama). Lewat jatuh tempo dibandingkan per hari di ZONA_WAKTU.
 */
export function hitungProgresTermin(
  m: {
    total: Uang;
    ppnPersen: Uang;
    butir: readonly { id: string; no: number; label: string; jumlah: Uang; persen: Uang; jatuhTempo: Date | null; ditagihPada: Date | null; nomorCetak: string | null }[];
    uangMuka: readonly { jumlah: Uang; rencanaTerminId: string | null }[];
    penerimaan: readonly { jumlah: Uang; potonganPajak: Uang }[];
  },
  hariIni: Date = new Date(),
): ProgresTermin {
  const nol = D(0);
  const total = D(m.total);
  const nilaiKontrakBruto = total.plus(hitungPpn(total, D(m.ppnPersen)));
  const hari = tanggalIso(hariIni);
  const butir = [...m.butir]
    .sort((a, b) => a.no - b.no)
    .map((b): ButirProgres => {
      const bruto = brutoButir(b.jumlah, m.ppnPersen);
      const dibayar = jumlahkan(m.uangMuka.filter((u) => u.rencanaTerminId === b.id).map((u) => u.jumlah));
      const sisa = terbesar(bruto.minus(dibayar), nol);
      const status: StatusButirTermin = sisa.isZero() ? "Lunas" : dibayar.gt(0) ? "Dibayar sebagian" : b.ditagihPada ? "Ditagih" : "Belum ditagih";
      const lewatJatuhTempo = !!b.jatuhTempo && sisa.gt(0) && tanggalIso(b.jatuhTempo) < hari;
      return { id: b.id, no: b.no, label: b.label, jumlah: D(b.jumlah), persen: D(b.persen), bruto, dibayar, sisa, status, lewatJatuhTempo, jatuhTempo: b.jatuhTempo, ditagihPada: b.ditagihPada, nomorCetak: b.nomorCetak };
    });
  const dpTanpaTermin = jumlahkan(m.uangMuka.filter((u) => !u.rencanaTerminId).map((u) => u.jumlah));
  const totalDiterima = jumlahkan(m.uangMuka.map((u) => u.jumlah)).plus(jumlahkan(m.penerimaan.map((p) => D(p.jumlah).plus(D(p.potonganPajak)))));
  return { nilaiKontrakBruto, butir, dpTanpaTermin, totalDiterima, belumDibayar: terbesar(nilaiKontrakBruto.minus(totalDiterima), nol) };
}

/** Progres termin pesanan dari basis data; null bila pesanan tidak ada. */
export async function progresTermin(klien: Klien, pesananId: string, hariIni: Date = new Date()): Promise<ProgresTermin | null> {
  const pesanan = await klien.pesananPenjualan.findUnique({
    where: { id: pesananId },
    select: {
      total: true,
      ppnPersen: true,
      rencanaTermin: { select: { id: true, no: true, label: true, jumlah: true, persen: true, jatuhTempo: true, ditagihPada: true, nomorCetak: true } },
      uangMuka: { select: { jumlah: true, rencanaTerminId: true } },
      faktur: { select: { penerimaan: { select: { jumlah: true, potonganPajak: true } } } },
    },
  });
  if (!pesanan) return null;
  return hitungProgresTermin(
    { total: pesanan.total, ppnPersen: pesanan.ppnPersen, butir: pesanan.rencanaTermin, uangMuka: pesanan.uangMuka, penerimaan: pesanan.faktur.flatMap((f) => f.penerimaan) },
    hariIni,
  );
}
