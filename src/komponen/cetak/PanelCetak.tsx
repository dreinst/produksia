import { db } from "@/lib/db";
import { punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { UKURAN_SAH, kopPolos, pilihKopDanTemplate, type KopCetak } from "@/lib/cetak/kop";
import type { JenisCetakPenjualan, TampilanEventCetak } from "@/lib/cetak/tipe";
import type { StatusFormulir } from "@/lib/statusFormulir";
import type { UkuranKertas } from "@/prisma-klien/enums";
import FormulirCetak, { type OpsiKopCetak, type UkuranOpsi } from "@/komponen/cetak/FormulirCetak";

const KE_OPSI: Record<UkuranKertas, UkuranOpsi> = { A4: "A4", A5: "A5", A5_LANDSCAPE: "A5L" };

/**
 * Panel cetak satu dokumen penjualan (D3 §7.1), dipasang tombol cetak di halaman detail (P45). Memuat kop perusahaan
 * dokumen, lalu untuk tiap kop menghitung template efektif (pilihKopDanTemplate, aturan yang sama dengan penyaji):
 * ukuran sah, ukuran dan tanda tangan awal, dan apakah tampilan event bisa dipilih. Alasan tanpa tanda tangan: dokumen
 * draf, peran tanpa tanda-tangan-cetak.buat, atau kop tanpa gambar tanda tangan. Pemasang wajib memeriksa
 * HAK_CETAK_PENJUALAN[jenis] lebih dulu.
 */
export default async function PanelCetak({
  jenis,
  id,
  perusahaanId,
  kopSuratId,
  draf,
  modeEvent,
  tampilan,
  pengguna,
  aksiSimpan,
}: {
  jenis: JenisCetakPenjualan;
  id: string;
  perusahaanId: string;
  kopSuratId: string | null;
  draf: boolean;
  modeEvent: boolean;
  tampilan: TampilanEventCetak;
  pengguna: PenggunaSesi;
  aksiSimpan?: (s: StatusFormulir, fd: FormData) => Promise<StatusFormulir>;
}) {
  const dok = { jenis, perusahaanId, kopSuratId, judul: null, event: { mode: modeEvent ? ("EVENT" as const) : ("STANDAR" as const), tampilan, namaEvent: null, venue: null, tanggalEvent: null } };
  const [daftar, awal] = await Promise.all([
    db.kopSurat.findMany({ where: { perusahaanId, dihapusPada: null }, orderBy: [{ nama: "asc" }, { id: "asc" }] }),
    pilihKopDanTemplate(db, dok),
  ]);
  const adaTtd = new Set(
    daftar.length
      ? (
          await db.asetKopSurat.findMany({
            where: { kopSuratId: { in: daftar.map((k) => k.id) }, jenis: "TANDA_TANGAN", berkas: { dihapusPada: null, isiDihapusPada: null } },
            select: { kopSuratId: true },
          })
        ).map((a) => a.kopSuratId)
      : [],
  );
  const alasanUmum = draf ? "Dokumen masih draf, tanda tangan tidak dibubuhkan" : !punyaHak(pengguna, "tanda-tangan-cetak.buat") ? "Peran Anda tidak punya hak tanda tangan cetak" : null;

  const kops: KopCetak[] = daftar.length ? daftar : [kopPolos(perusahaanId)];
  const opsiKop: OpsiKopCetak[] = [];
  for (const kop of kops) {
    const p = kop.id ? await pilihKopDanTemplate(db, dok, { kopId: kop.id }) : awal;
    opsiKop.push({
      id: kop.id,
      nama: kop.nama,
      bawaan: kop.bawaan,
      ukuran: UKURAN_SAH[p.tataLetak].map((u) => KE_OPSI[u]),
      ukuranAwal: KE_OPSI[p.ukuran],
      ttdAwal: p.template.tandaTanganBawaan,
      alasanTanpaTtd: alasanUmum ?? (kop.id && adaTtd.has(kop.id) ? null : "Kop ini belum punya gambar tanda tangan"),
      tampilanEvent: p.tampilanEvent !== null,
    });
  }
  return <FormulirCetak aksi={`/cetak/${jenis}/${encodeURIComponent(id)}`} opsiKop={opsiKop} kopAwal={awal.kop.id} tampilanAwal={tampilan} aksiSimpan={aksiSimpan} />;
}
