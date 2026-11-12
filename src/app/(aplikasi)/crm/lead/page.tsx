import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { bacaParamDaftar } from "@/lib/daftar";
import { lingkupPerusahaan } from "@/lib/perusahaan";
import { daftarPenggunaCrm, periksaPengingatTindakLanjut, urutanLead, whereLead, type FilterLead as SaringanLead } from "@/lib/crm";
import { formatTanggal } from "@/lib/waktu";
import { pulihkanLeadFormulir } from "@/lib/aksi/crm";
import FormulirAksi from "@/komponen/FormulirAksi";
import FilterLead from "@/komponen/crm/FilterLead";
import Ikon from "@/komponen/ui/Ikon";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { LencanaStatus, Rp } from "@/komponen/ui/Lencana";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";

/*
 * Daftar lead (D4 §7.2, §3.10): saringan tahap, status, sumber, PIC, tag, urutan, dan arsip (hanya lead.hapus),
 * menurut lingkup perusahaan. Gabungan menambah kolom perusahaan.
 */

const satu = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim() || undefined : undefined);

export default async function HalamanLead({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("lead.lihat");
  await periksaPengingatTindakLanjut(pengguna.id).catch(() => 0);
  const boleh = (h: Parameters<typeof punyaHak>[1]) => punyaHak(pengguna, h);
  const param = await bacaParamDaftar(searchParams);
  const sp = await searchParams;
  const arsip = boleh("lead.hapus") && satu(sp.arsip) === "1";
  const saringan = { tahap: satu(sp.tahap), status: satu(sp.status), sumber: satu(sp.sumber), pic: satu(sp.pic), tag: satu(sp.tag), urut: satu(sp.urut) };
  const lingkup = await lingkupPerusahaan();
  const perusahaanId = lingkup.perusahaanId;
  const gabungan = perusahaanId === null;

  const f: SaringanLead = { q: param.q, ...saringan, arsip };
  const where = whereLead(f, { perusahaanId, penggunaId: pengguna.id });
  const [total, daftar, tahap, sumber, penggunaCrm] = await Promise.all([
    db.lead.count({ where }),
    db.lead.findMany({
      where,
      orderBy: urutanLead(saringan.urut),
      skip: param.lewati,
      take: param.ambil,
      include: {
        tahap: { select: { nama: true, jenis: true } },
        pic: { select: { nama: true } },
        perusahaan: { select: { kode: true, nama: true, warna: true } },
      },
    }),
    db.tahapLead.findMany({
      where: perusahaanId ? { perusahaanId } : {},
      orderBy: [{ perusahaan: { urutan: "asc" } }, { perusahaanId: "asc" }, { urutan: "asc" }],
      select: { id: true, nama: true, perusahaan: { select: { id: true, nama: true } } },
    }),
    db.sumberLead.findMany({ where: perusahaanId ? { perusahaanId } : {}, orderBy: [{ urutan: "asc" }, { nama: "asc" }], select: { nama: true } }),
    daftarPenggunaCrm(db),
  ]);
  const namaSumber = [...new Set(sumber.map((s) => s.nama))];
  const adaSaringan = Object.values(saringan).some((v) => v && v !== "terbaru") || !!param.q;
  const tambahan = { ...saringan, arsip: arsip ? "1" : undefined };
  const kolom = 8 + (gabungan ? 1 : 0) + (arsip ? 1 : 0);
  const tautanTag = (t: string) => `/crm/lead?${new URLSearchParams({ tag: t, ...(arsip ? { arsip: "1" } : {}) }).toString()}`;

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "CRM", href: "/crm/dasbor" }, { label: arsip ? "Arsip lead" : "Lead" }]}
        judul={arsip ? "Arsip lead" : "Lead"}
        subjudul="Pantau calon klien dari kontak pertama sampai closing."
        aksi={
          <>
            {boleh("lead.buat") && !arsip && (
              <Link href="/crm/lead/baru" className="tombol tombol-utama">
                <Ikon nama="person_add" className="!text-[18px]" />
                Lead baru
              </Link>
            )}
            <Link href="/crm/pipeline" className="tombol tombol-garis">
              <Ikon nama="view_kanban" className="!text-[18px]" />
              Lihat pipeline
            </Link>
            {boleh("lead.hapus") && (
              <Link href={arsip ? "/crm/lead" : "/crm/lead?arsip=1"} className="tombol tombol-garis">
                <Ikon nama={arsip ? "undo" : "archive"} className="!text-[18px]" />
                {arsip ? "Kembali ke lead aktif" : "Lihat arsip"}
              </Link>
            )}
          </>
        }
      />

      <FilterLead
        nilai={saringan}
        tahap={tahap.map((t) => ({ id: t.id, nama: t.nama, perusahaan: gabungan ? t.perusahaan : undefined }))}
        sumber={namaSumber}
        pengguna={penggunaCrm}
        tersembunyi={{ q: param.q || undefined, tag: saringan.tag, arsip: arsip ? "1" : undefined }}
        aturUlang={arsip ? "/crm/lead?arsip=1" : "/crm/lead"}
      />

      {saringan.tag && (
        <p className="text-sm">
          <Link href={`/crm/lead?${new URLSearchParams(Object.entries({ ...tambahan, tag: undefined, q: param.q || undefined }).filter((e): e is [string, string] => !!e[1])).toString()}`} className="tombol-tautan">
            Hapus filter tag: {saringan.tag}
          </Link>
        </p>
      )}

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari nama, perusahaan, telepon, email…" tambahan={tambahan} adaSaringan={adaSaringan} />
        <div className="bungkus-tabel">
          <table className="tabel min-w-[56rem]">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Perusahaan/usaha</th>
                {gabungan && <th>Perusahaan</th>}
                <th>Tahap</th>
                <th>Sumber</th>
                <th>PIC</th>
                <th className="text-right">Nilai</th>
                <th>Dibuat</th>
                {arsip && <th>Diarsipkan</th>}
                <th className="th-lekat" aria-label="Aksi" />
              </tr>
            </thead>
            <tbody>
              {daftar.length === 0 ? (
                <tr>
                  <td colSpan={kolom} className="text-center text-slate-500">
                    {adaSaringan ? "Lead tidak ditemukan. Ubah filter atau buat lead baru." : arsip ? "Belum ada lead terarsip." : "Belum ada lead."}
                  </td>
                </tr>
              ) : (
                daftar.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link href={`/crm/lead/${l.id}`} className="font-medium text-slate-900 hover:underline">
                        {l.nama}
                      </Link>
                      {l.tag.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {l.tag.map((t) => (
                            <Link key={t} href={tautanTag(t)} className="lencana lencana-slate hover:bg-slate-200">
                              {t}
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>{l.namaUsaha}</td>
                    {gabungan && (
                      <td>
                        <LencanaPerusahaan kode={l.perusahaan.kode} warna={l.perusahaan.warna} nama={l.perusahaan.nama} />
                      </td>
                    )}
                    <td>
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <LencanaStatus status={l.tahap.jenis} />
                        <span className="text-sm text-slate-700">{l.tahap.nama}</span>
                      </span>
                    </td>
                    <td>{l.sumber}</td>
                    <td>{l.pic?.nama ?? "-"}</td>
                    <td className="text-right">
                      <Rp nilai={l.nilaiEstimasi} />
                    </td>
                    <td>{formatTanggal(l.dibuatPada)}</td>
                    {arsip && <td>{l.dihapusPada ? `${formatTanggal(l.dihapusPada)}${l.dihapusOlehNama ? ` oleh ${l.dihapusOlehNama}` : ""}` : "-"}</td>}
                    <td className="td-lekat">
                      {arsip && (
                        <FormulirAksi aksi={pulihkanLeadFormulir.bind(null, l.id)}>
                          <button type="submit" className="tombol-tautan inline-flex items-center gap-1">
                            <Ikon nama="unarchive" className="!text-[16px]" />
                            Pulihkan
                          </button>
                        </FormulirAksi>
                      )}
                      {!arsip && (
                        <Link href={`/crm/lead/${l.id}`} className="tombol-tautan">
                          Buka
                        </Link>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
