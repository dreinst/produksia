import { db } from "@/lib/db";
import { punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { ruangTersembunyi, syaratBerkasTerlihat } from "@/lib/berkas";
import LampiranBerkas from "@/komponen/berkas/LampiranBerkas";
import TombolCetakDokumen from "@/komponen/penjualan/TombolCetakDokumen";

export type ButirTagihan = { id: string; no: number; label: string; nomorCetak: string | null; ditagihPada: Date | null };

/**
 * Tagihan termin per butir di halaman detail pesanan: tombol Cetak (panel P31 dengan Simpan PDF ke Lampiran, hanya
 * untuk butir yang sudah ditagih) dan daftar lampiran butir itu (jenis lampiran `rencana-termin`). Butir yang belum
 * ditagih hanya tampil bila masih punya berkas yang terlihat bagi pengguna, misalnya sesudah tagihannya dibatalkan.
 * Hak dan lingkup dibaca ulang di sini: panel cetak butuh pesanan.lihat, daftar lampiran memakai syarat berkas terlihat
 * (hak lihat jenis, folder terbatas, proyek terbatas), jadi berkas yang tersembunyi tidak ikut menampilkan butirnya.
 */
export default async function TagihanTerminTersimpan({ butir, pengguna }: { butir: readonly ButirTagihan[]; pengguna: PenggunaSesi }) {
  if (!punyaHak(pengguna, "pesanan.lihat") || butir.length === 0) return null;
  const ruang = await ruangTersembunyi(db, pengguna);
  const adaBerkas = new Set(
    (
      await db.berkas.findMany({
        where: { AND: [syaratBerkasTerlihat(pengguna, ruang), { jenisEntitas: "rencana-termin", entitasId: { in: butir.map((b) => b.id) } }] },
        select: { entitasId: true },
        distinct: ["entitasId"],
      })
    ).map((b) => b.entitasId),
  );
  const tampil = butir.filter((b) => b.ditagihPada || adaBerkas.has(b.id));
  if (tampil.length === 0) return null;
  return (
    <section className="space-y-4" aria-label="Tagihan termin tersimpan">
      <h2 className="judul-kartu">Tagihan termin dan lampirannya</h2>
      {tampil.map((b) => (
        <div key={b.id} className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-900">
              Butir {b.no}: {b.label}
              {b.nomorCetak && <span className="mono ml-2 text-[11px] text-slate-500">{b.nomorCetak}</span>}
            </p>
            {b.ditagihPada && <TombolCetakDokumen jenis="tagihan-termin" id={b.id} pengguna={pengguna} />}
          </div>
          <LampiranBerkas jenisEntitas="rencana-termin" entitasId={b.id} judul={`Lampiran tagihan ${b.label}`} kosong="Belum ada PDF tagihan yang disimpan." />
        </div>
      ))}
    </section>
  );
}
