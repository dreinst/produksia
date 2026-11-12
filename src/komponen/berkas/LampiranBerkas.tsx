import { db } from "@/lib/db";
import { penggunaSaatIni } from "@/lib/otentikasi";
import { punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { formatTanggal } from "@/lib/waktu";
import { bolehAksesBerkas, daftarBerkasTerlihat, keluargaDariMime, type JenisEntitas, type MetaBerkas } from "@/lib/berkas";
import { buangBerkasFormulir } from "@/lib/aksi/berkas";
import type { TagBerkas } from "@/prisma-klien/enums";
import FormulirAksi from "@/komponen/FormulirAksi";
import PesanSuksesHalaman, { SaluranPesanSukses } from "@/komponen/PesanSuksesHalaman";
import Ikon from "@/komponen/ui/Ikon";
import IkonBerkas, { ukuranBerkas } from "@/komponen/berkas/IkonBerkas";
import DialogPratinjauGambar from "@/komponen/berkas/DialogPratinjauGambar";
import FormulirTautanBagi, { DaftarTautanAktif, type TautanAktifBerkas } from "@/komponen/berkas/FormulirTautanBagi";
import PemilihBerkas from "@/komponen/berkas/PemilihBerkas";

/*
 * Lampiran satu entitas (D7 §7.3). Komponen server; dipasang domain pemilik halaman detail (D2/D3 dokumen, D5 biaya
 * proyek, D6 laci konten, tugas, dan kampanye). Pembantu di bawah juga dipakai halaman /berkas.
 */

const MAKS_LAMPIRAN = 100;

/**
 * Tautan bagi aktif per berkas beserta boleh-tidaknya pengguna mencabut (pembuat, hak hapus berkas, atau akses penuh).
 * Dimuat untuk berkas yang boleh dibagikan ATAU dihapus pengguna, karena pemegang hak hapus boleh mencabut tautan.
 */
export async function petaTautanAktif(pengguna: PenggunaSesi, berkas: readonly Pick<MetaBerkas, "id" | "jenisEntitas">[]): Promise<Map<string, TautanAktifBerkas[]>> {
  const peta = new Map<string, TautanAktifBerkas[]>();
  const bisaBagikan = berkas.filter((b) => bolehAksesBerkas(pengguna, b, "bagikan") || bolehAksesBerkas(pengguna, b, "hapus"));
  if (bisaBagikan.length === 0) return peta;
  const tautan = await db.tautanBagiBerkas.findMany({
    where: { berkasId: { in: bisaBagikan.map((b) => b.id) }, dicabutPada: null, kedaluwarsa: { gt: new Date() } },
    select: { id: true, berkasId: true, dibuatOlehId: true, dibuatOlehNama: true, kedaluwarsa: true, jumlahUnduh: true },
    orderBy: [{ dibuatPada: "desc" }, { id: "asc" }],
  });
  const aksesPenuh = punyaHak(pengguna, "berkas.akses-penuh");
  for (const t of tautan) {
    const b = bisaBagikan.find((x) => x.id === t.berkasId)!;
    const bolehCabut = aksesPenuh || (!!t.dibuatOlehId && t.dibuatOlehId === pengguna.id) || bolehAksesBerkas(pengguna, b, "hapus");
    const daftar = peta.get(t.berkasId) ?? [];
    daftar.push({ id: t.id, dibuatOlehNama: t.dibuatOlehNama, kedaluwarsa: t.kedaluwarsa, jumlahUnduh: t.jumlahUnduh, bolehCabut });
    peta.set(t.berkasId, daftar);
  }
  return peta;
}

/**
 * Nama berkas sebagai pemicu: gambar membuka pratinjau, PDF membuka tab baru, jenis lain teks biasa. Nama selalu di
 * <bdi> supaya karakter arah teks di nama tidak memengaruhi teks di sekitarnya. Penyamaran ekstensi di dalam nama
 * itu sendiri (mis. U+202E) dicegah bersihkanNamaBerkas saat nama disimpan, bukan oleh <bdi>.
 */
export function NamaBerkas({ b }: { b: Pick<MetaBerkas, "id" | "namaBerkas" | "tipeMime"> }) {
  const keluarga = keluargaDariMime(b.tipeMime);
  if (keluarga === "gambar") return <DialogPratinjauGambar id={b.id} nama={b.namaBerkas} label={b.namaBerkas} tanpaIkon className="text-left font-medium text-slate-900 hover:text-blue-700 hover:underline break-all" />;
  if (keluarga === "pdf")
    return (
      <a href={`/api/berkas/${b.id}`} target="_blank" rel="noopener noreferrer" className="font-medium text-slate-900 hover:text-blue-700 hover:underline break-all">
        <bdi>{b.namaBerkas}</bdi>
      </a>
    );
  return (
    <span className="font-medium text-slate-900 break-all">
      <bdi>{b.namaBerkas}</bdi>
    </span>
  );
}

/** Tautan aktif untuk pemegang hak hapus tanpa hak bagikan: hanya daftar dan tombol Cabut, tanpa formulir pembuatan. */
export function TautanAktifSaja({ tautanAktif, className = "", lebar = "w-72 sm:w-80" }: { tautanAktif: TautanAktifBerkas[]; className?: string; lebar?: string }) {
  return (
    <details className={className}>
      <summary className="tombol-tautan cursor-pointer list-none">
        <Ikon nama="share" className="!text-[16px] align-[-3px]" /> Tautan aktif ({tautanAktif.length.toLocaleString("id-ID")})
      </summary>
      <div className={`mt-2 ${lebar}`}>
        <DaftarTautanAktif tautanAktif={tautanAktif} />
      </div>
    </details>
  );
}

export default async function LampiranBerkas({
  jenisEntitas,
  entitasId,
  judul = "Lampiran",
  tag,
  bolehUnggah = true,
  kosong = "Belum ada lampiran.",
}: {
  jenisEntitas: JenisEntitas;
  entitasId: string;
  judul?: string;
  tag?: TagBerkas;
  /** penyaring tambahan dari domain (mis. dokumen yang sudah final) */
  bolehUnggah?: boolean;
  kosong?: string;
}) {
  const pengguna = await penggunaSaatIni();
  if (!pengguna || !bolehAksesBerkas(pengguna, { jenisEntitas }, "lihat")) return null;
  const { total, baris } = await daftarBerkasTerlihat(db, pengguna, { jenisEntitas, entitasId, tag }, { lewati: 0, ambil: MAKS_LAMPIRAN });
  const tautan = await petaTautanAktif(pengguna, baris);
  const unggah = bolehUnggah && bolehAksesBerkas(pengguna, { jenisEntitas }, "unggah");

  // saluran pesan sukses per kartu: halaman atau laci yang memasang beberapa kartu tidak menampilkan pesan Buang dan
  // Cabut berlipat (perbaikan tinjauan P43 R3)
  return (
    <SaluranPesanSukses saluran={`lampiran:${jenisEntitas}:${entitasId}:${tag ?? ""}`}>
    <section className="kartu space-y-4" aria-label={judul}>
      <div className="flex items-center gap-2">
        <Ikon nama="attach_file" className="!text-[20px] text-slate-500" />
        <h2 className="judul-kartu">{judul}</h2>
        <span className="lencana lencana-slate">{total.toLocaleString("id-ID")}</span>
      </div>
      <PesanSuksesHalaman />
      {baris.length === 0 ? (
        <p className="text-sm text-slate-500">{kosong}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {baris.map((b) => {
            const aktif = tautan.get(b.id) ?? [];
            return (
              <li key={b.id} className="py-2.5 flex flex-col sm:flex-row sm:items-start gap-2">
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  <IkonBerkas tipeMime={b.tipeMime} className="mt-0.5" />
                  <div className="min-w-0 text-sm">
                    <NamaBerkas b={b} />
                    <p className="text-xs text-slate-500">
                      {ukuranBerkas(b.ukuran)} · {formatTanggal(b.dibuatPada)} · {b.diunggahOlehNama}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-start gap-3 text-sm shrink-0">
                  <a href={`/api/berkas/${b.id}?unduh=1`} className="tombol-tautan">
                    <Ikon nama="download" className="!text-[16px] align-[-3px]" /> Unduh
                  </a>
                  {bolehAksesBerkas(pengguna, b, "bagikan") ? (
                    <details>
                      <summary className="tombol-tautan cursor-pointer list-none">
                        <Ikon nama="share" className="!text-[16px] align-[-3px]" /> Bagikan
                      </summary>
                      <div className="mt-2 w-72 sm:w-80">
                        <FormulirTautanBagi berkasId={b.id} tautanAktif={aktif} />
                      </div>
                    </details>
                  ) : (
                    aktif.length > 0 && <TautanAktifSaja tautanAktif={aktif} />
                  )}
                  {bolehAksesBerkas(pengguna, b, "hapus") && (
                    <FormulirAksi aksi={buangBerkasFormulir.bind(null, b.id)} pesanKonfirmasi={`Buang ${b.namaBerkas} ke Sampah?`} pesanSuksesHalaman="Berkas dipindah ke Sampah.">
                      <button type="submit" className="tombol-tautan-bahaya">
                        <Ikon nama="delete" className="!text-[16px] align-[-3px]" /> Buang
                      </button>
                    </FormulirAksi>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {unggah && <PemilihBerkas jenisEntitas={jenisEntitas} entitasId={entitasId} tag={tag} />}
    </section>
    </SaluranPesanSukses>
  );
}
