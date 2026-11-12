import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { daftarPerusahaan, lingkupPerusahaan } from "@/lib/perusahaan";
import { daftarPenggunaCrm, pastikanBawaanCrm, ringkasRupiah, whereLead } from "@/lib/crm";
import type { JenisTahapLead } from "@/prisma-klien/enums";
import FilterLead from "@/komponen/crm/FilterLead";
import PapanPipeline from "@/komponen/crm/PapanPipeline";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import type { KartuKanban, KolomKanban, NadaKanban } from "@/komponen/ui/Kanban";

/*
 * Pipeline lead (D4 §3.11, §7.2): satu perusahaan per papan karena tahap tiap perusahaan berbeda; gabungan memilih
 * lewat ?perusahaan= (bawaan perusahaan pertama). Ringkasan kolom dihitung dari SEMUA lead yang cocok saringan,
 * kartu paling banyak 100 terbaru per kolom dengan tautan sisanya ke daftar lead.
 */

const MAKS_KARTU = 100;
const NADA: Record<JenisTahapLead, NadaKanban> = { BERJALAN: "blue", MENANG: "emerald", KALAH: "rose" };
const satu = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim() || undefined : undefined);

export default async function HalamanPipeline({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("lead.lihat");
  const sp = await searchParams;
  const [lingkup, semua] = await Promise.all([lingkupPerusahaan(), daftarPerusahaan()]);
  const gabungan = lingkup.perusahaanId === null;
  const p = gabungan ? (semua.find((x) => x.id === satu(sp.perusahaan)) ?? semua[0]) : lingkup.perusahaan!;
  const saringan = { q: satu(sp.q), sumber: satu(sp.sumber), pic: satu(sp.pic) };

  await pastikanBawaanCrm(db, p.id);
  const where = whereLead(saringan, { perusahaanId: p.id, penggunaId: pengguna.id });
  const tahap = await db.tahapLead.findMany({ where: { perusahaanId: p.id }, orderBy: [{ urutan: "asc" }, { id: "asc" }], select: { id: true, nama: true, jenis: true } });
  const [ringkasan, perKolom, sumber, penggunaCrm] = await Promise.all([
    db.lead.groupBy({ by: ["tahapId"], where, _count: { _all: true }, _sum: { nilaiEstimasi: true } }),
    Promise.all(
      tahap.map((t) =>
        db.lead.findMany({
          where: { AND: [where, { tahapId: t.id }] },
          orderBy: [{ dibuatPada: "desc" }, { id: "desc" }],
          take: MAKS_KARTU,
          select: { id: true, nama: true, namaUsaha: true, nilaiEstimasi: true, tahapId: true, pic: { select: { nama: true } } },
        }),
      ),
    ),
    db.sumberLead.findMany({ where: { perusahaanId: p.id }, orderBy: [{ urutan: "asc" }, { nama: "asc" }], select: { nama: true } }),
    daftarPenggunaCrm(db),
  ]);
  const petaRingkasan = new Map(ringkasan.map((g) => [g.tahapId, { jumlah: g._count._all, nilai: g._sum.nilaiEstimasi?.toString() ?? "0" }]));

  const kolom: KolomKanban[] = tahap.map((t, i) => {
    const r = petaRingkasan.get(t.id) ?? { jumlah: 0, nilai: "0" };
    const sisa = r.jumlah - perKolom[i].length;
    return {
      id: t.id,
      judul: t.nama,
      ringkasan: `${r.jumlah.toLocaleString("id-ID")} · ${ringkasRupiah(r.nilai)}`,
      nada: NADA[t.jenis],
      lebihBanyak: sisa > 0 ? { jumlah: sisa, href: `/crm/lead?tahap=${encodeURIComponent(t.id)}` } : undefined,
    };
  });
  const kartu: KartuKanban[] = perKolom.flat().map((l) => ({
    id: l.id,
    kolomId: l.tahapId,
    judul: l.nama,
    subjudul: l.namaUsaha,
    baris: [ringkasRupiah(l.nilaiEstimasi.toString()), l.pic?.nama ?? "Tanpa PIC"],
    href: `/crm/lead/${l.id}`,
  }));

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "CRM", href: "/crm/dasbor" }, { label: "Pipeline" }]}
        judul="Pipeline"
        subjudul="Seret kartu untuk memindah tahap. Pindah ke tahap Kalah meminta alasan."
      />

      {gabungan && (
        <form method="get" className="kartu flex flex-col sm:flex-row sm:items-end gap-3 !p-4" aria-label="Pilih perusahaan">
          {Object.entries(saringan).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
          <div className="bidang">
            <label className="label" htmlFor="pipeline-perusahaan">
              Perusahaan
            </label>
            <select id="pipeline-perusahaan" name="perusahaan" defaultValue={p.id} className="isian isian-kecil">
              {semua.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.kode} - {x.nama}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="tombol tombol-garis tombol-kecil">
            Tampilkan
          </button>
        </form>
      )}

      <FilterLead
        ringkas
        nilai={saringan}
        sumber={sumber.map((s) => s.nama)}
        pengguna={penggunaCrm}
        tersembunyi={gabungan ? { perusahaan: p.id } : {}}
        aturUlang={gabungan ? `/crm/pipeline?perusahaan=${encodeURIComponent(p.id)}` : "/crm/pipeline"}
      />

      <PapanPipeline key={p.id} kolom={kolom} kartu={kartu} kolomKalah={tahap.filter((t) => t.jenis === "KALAH").map((t) => t.id)} bolehPindah={punyaHak(pengguna, "lead.ubah")} />
    </div>
  );
}
