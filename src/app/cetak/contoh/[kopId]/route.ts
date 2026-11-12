import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { penggunaSaatIni } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { kepalaDisposisi } from "@/lib/berkas";
import { GalatCetak, GalatIsiTerlaluTinggi, bacaOpsiCetak, renderPdfDokumenPenjualan } from "@/lib/cetak";
import { JENIS_DOKUMEN_CETAK, pilihKopDanTemplate, tataLetakHka } from "@/lib/cetak/kop";
import { DATA_CONTOH, KWITANSI_CONTOH, type NamaContoh } from "@/lib/cetak/contoh";
import type { DokumenCetakPenjualan, JenisCetakPenjualan, TampilanEventCetak } from "@/lib/cetak/tipe";
import type { JenisDokumenCetak, TataLetakCetak } from "@/prisma-klien/enums";

/*
 * Pratinjau template satu kop dengan data contoh (D3 §6.3 butir 2), dibuka dari halaman Kop & Template. Hak
 * pengaturan.tulis. Data contoh D'Pro dan HKA (src/lib/cetak/contoh.ts) diberi perusahaan dan kop milik kop ini, lalu
 * dirender penyaji yang sama dengan dokumen nyata, berstempel CONTOH. Identitas yang tercetak berasal dari kop dan
 * perusahaannya. Tanda tangan hanya bila kop punya gambarnya dan pengguna memegang tanda-tangan-cetak.buat. Tanpa log.
 */

export const runtime = "nodejs";

const teks = (status: number, pesan: string) => new Response(pesan, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });

const JENIS_CETAK = Object.fromEntries(Object.entries(JENIS_DOKUMEN_CETAK).map(([j, d]) => [d, j])) as Record<JenisDokumenCetak, JenisCetakPenjualan>;

/** Data contoh yang paling cocok untuk jenis dan tata letak terpilih. */
function namaContoh(jenis: JenisDokumenCetak, tataLetak: TataLetakCetak, gaya: string | null, tampilan: TampilanEventCetak | null): NamaContoh {
  if (jenis === "PENAWARAN") return "proposalDpro";
  if (jenis === "KWITANSI" || jenis === "KWITANSI_DP") {
    if (tataLetak === "KWITANSI_POLOS") return KWITANSI_CONTOH.SMARA;
    return KWITANSI_CONTOH[(gaya as keyof typeof KWITANSI_CONTOH | null) ?? "DPRO"] ?? KWITANSI_CONTOH.DPRO;
  }
  if (tataLetak === "DPRO_INVOICE") return "invoiceDpro";
  if (tataLetak === "KWITANSI_ENTITAS") return gaya === "NAWASENA" ? "invoiceTulisanNawasena" : "invoiceTulisanDpro";
  if (tataLetakHka(tataLetak) && jenis === "FAKTUR" && tampilan) return tampilan === "RINGKAS" ? "hkaEvoked" : "hkaNawasena";
  return "hkaStandar";
}

export async function GET(request: Request, { params }: { params: Promise<{ kopId: string }> }) {
  const { kopId } = await params;
  const url = new URL(request.url);
  const pengguna = await penggunaSaatIni();
  if (!pengguna) redirect(`/masuk?kembali=${encodeURIComponent(url.pathname + url.search)}`);
  if (!punyaHak(pengguna, "pengaturan.tulis")) return teks(403, "Anda tidak punya hak melihat pratinjau kop");
  const jenis = url.searchParams.get("jenis") ?? "";
  if (!Object.prototype.hasOwnProperty.call(JENIS_CETAK, jenis)) return teks(400, "Jenis dokumen contoh tidak dikenal");
  const jenisDok = jenis as JenisDokumenCetak;
  try {
    const opsi = bacaOpsiCetak(url.searchParams);
    const kop = await db.kopSurat.findUnique({ where: { id: kopId } });
    if (!kop || kop.dihapusPada) return teks(404, "Kop surat tidak ditemukan");
    const jenisCetak = JENIS_CETAK[jenisDok];
    const pilihan = await pilihKopDanTemplate(
      db,
      { jenis: jenisCetak, perusahaanId: kop.perusahaanId, kopSuratId: kop.id, judul: null, event: { mode: "STANDAR", tampilan: "RINCI", namaEvent: null, venue: null, tanggalEvent: null } },
      { kopId: kop.id },
    );
    const contoh = DATA_CONTOH[namaContoh(jenisDok, pilihan.tataLetak, kop.gayaEntitas, opsi.tampilan)];
    const data: DokumenCetakPenjualan = { ...contoh, jenis: jenisCetak, id: `contoh-${kop.id}`, perusahaanId: kop.perusahaanId, kopSuratId: kop.id, draf: false };
    const hasil = await renderPdfDokumenPenjualan(data, pengguna, { ...opsi, kopId: kop.id }, { stempel: "CONTOH" });
    return new Response(Buffer.from(hasil.isi), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": kepalaDisposisi("inline", `Contoh ${hasil.namaBerkas}`),
        "Content-Length": String(hasil.isi.byteLength),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof GalatCetak) return teks(e.status, e.message);
    if (e instanceof GalatIsiTerlaluTinggi) return teks(400, e.message);
    console.error("[cetak contoh]", e);
    return teks(500, "PDF gagal dibuat. Coba lagi atau hubungi admin.");
  }
}
