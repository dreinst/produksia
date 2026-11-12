import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { lingkupPerusahaan, perusahaanFormulir } from "@/lib/perusahaan";
import { daftarPenggunaCrm, halanganPenawaranLead, pasanganFieldTambahan } from "@/lib/crm";
import { formatTanggal, formatWaktu } from "@/lib/waktu";
import { arsipkanLeadFormulir, pindahTahapLeadFormulir, pulihkanLeadFormulir, tambahCatatanLeadFormulir } from "@/lib/aksi/crm";
import FormulirAksi from "@/komponen/FormulirAksi";
import PesanSuksesHalaman from "@/komponen/PesanSuksesHalaman";
import DaftarTindakLanjut from "@/komponen/crm/DaftarTindakLanjut";
import FormulirTindakLanjut from "@/komponen/crm/FormulirTindakLanjut";
import LinimasaLead from "@/komponen/crm/LinimasaLead";
import LencanaStatusKomersial from "@/komponen/penjualan/LencanaStatusKomersial";
import Ikon from "@/komponen/ui/Ikon";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import { LencanaPersetujuan, LencanaStatus, Rp } from "@/komponen/ui/Lencana";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";

/*
 * Detail lead (D4 §7.2): kepala dengan tahap dan aksi, kolom kiri (pindah tahap, rincian, dokumen penjualan), kolom
 * kanan (pengingat tindak lanjut, riwayat aktivitas). Lead terarsip tetap bisa dibuka pemegang lead.lihat, dengan
 * spanduk arsip; semua formulir ubah disembunyikan. Lead perusahaan lain boleh dibuka (D4 §3.13 no. 5).
 */

export default async function HalamanDetailLead({ params }: { params: Promise<{ id: string }> }) {
  const pengguna = await wajibHak("lead.lihat");
  const boleh = (h: Parameters<typeof punyaHak>[1]) => punyaHak(pengguna, h);
  const { id } = await params;
  const lead = await db.lead.findUnique({
    where: { id },
    include: {
      tahap: { select: { id: true, nama: true, jenis: true } },
      pic: { select: { nama: true } },
      perusahaan: { select: { id: true, kode: true, nama: true, warna: true, aktif: true } },
      pelanggan: { select: { kode: true, nama: true } },
    },
  });
  if (!lead) notFound();
  const terarsip = !!lead.dihapusPada;
  const sekarang = new Date();
  const lihatPenawaran = boleh("penawaran.lihat");

  const [lingkup, tahap, aktivitas, tindakLanjut, penawaran, penggunaCrm] = await Promise.all([
    lingkupPerusahaan(),
    db.tahapLead.findMany({ where: { perusahaanId: lead.perusahaanId }, orderBy: [{ urutan: "asc" }, { id: "asc" }], select: { id: true, nama: true, jenis: true } }),
    db.aktivitasLead.findMany({ where: { leadId: id }, orderBy: [{ dibuatPada: "desc" }, { id: "desc" }], take: 300 }),
    db.tindakLanjut.findMany({
      where: { leadId: id },
      orderBy: [{ jatuhTempo: "asc" }, { id: "asc" }],
      take: 100,
      include: { ditugaskanKe: { select: { id: true, nama: true } } },
    }),
    lihatPenawaran
      ? db.penawaranPenjualan.findMany({
          where: { leadId: id },
          orderBy: [{ tanggal: "desc" }, { id: "desc" }],
          take: 50,
          select: {
            id: true,
            nomor: true,
            nomorCetak: true,
            tanggal: true,
            total: true,
            statusKomersial: true,
            pesanan: { select: { id: true, nomor: true, faktur: { select: { id: true, nomor: true, status: true, statusPersetujuan: true }, orderBy: { tanggal: "asc" } } } },
          },
        })
      : Promise.resolve([]),
    daftarPenggunaCrm(db),
  ]);

  const bolehUbah = boleh("lead.ubah") && !terarsip;
  const bolehKonversi = boleh("lead.ubah") && boleh("data-induk.tulis");
  const ruteKonversi = `/crm/lead/${id}/konversi`;
  const nilai = Number(lead.nilaiEstimasi.toString()).toLocaleString("id-ID");
  const field = pasanganFieldTambahan(lead.fieldTambahan);
  const rincian: [string, string][] = [
    ["Telepon", lead.telepon],
    ["WhatsApp", lead.whatsapp],
    ["Email", lead.email ?? "-"],
    ["Instagram", lead.instagram ?? "-"],
    ["Situs web", lead.website ?? "-"],
    ["Sumber lead", lead.sumber || "-"],
    ["PIC", lead.pic?.nama ?? "-"],
    ["Industri", lead.industri ?? "-"],
    ["Lokasi", lead.lokasi ?? "-"],
    ["Tag", lead.tag.length ? lead.tag.join(", ") : "-"],
    ["Pelanggan", lead.pelanggan ? `Sudah dikonversi (${lead.pelanggan.kode})` : "Belum"],
    ...field.map(([k, v]) => [k, v || "-"] as [string, string]),
  ];

  // Buat penawaran (D4 §3.8): berpelanggan langsung ke formulir; belum lewat konversi bila boleh; selain itu nonaktif.
  // Formulir penawaran baru hanya menerima lead perusahaan lingkup aktif (tinjauan P32 S1), jadi lead perusahaan
  // lain atau perusahaan arsip mendapat tombol nonaktif dengan keterangan.
  const halangan = halanganPenawaranLead(lead.perusahaan, perusahaanFormulir(lingkup));
  const tombolPenawaran = !boleh("penawaran.buat") ? null : halangan && (lead.pelangganId || bolehKonversi) ? (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="tombol tombol-garis opacity-60 cursor-not-allowed" aria-disabled="true" title={halangan}>
        <Ikon nama="request_quote" className="!text-[18px]" />
        Buat penawaran
      </span>
      <span className="text-xs text-amber-700">{halangan}</span>
    </span>
  ) : lead.pelangganId ? (
    <Link href={`/penjualan/penawaran/baru?leadId=${encodeURIComponent(id)}`} className="tombol tombol-garis">
      <Ikon nama="request_quote" className="!text-[18px]" />
      Buat penawaran
    </Link>
  ) : bolehKonversi ? (
    <Link href={`${ruteKonversi}?lanjut=penawaran`} className="tombol tombol-garis">
      <Ikon nama="request_quote" className="!text-[18px]" />
      Buat penawaran
    </Link>
  ) : (
    <span className="tombol tombol-garis opacity-60 cursor-not-allowed" aria-disabled="true" title="Lead belum menjadi pelanggan. Minta pemegang hak data induk mengonversinya dulu">
      <Ikon nama="request_quote" className="!text-[18px]" />
      Buat penawaran
    </span>
  );

  return (
    <div className="space-y-6">
      <PesanSuksesHalaman />
      <KepalaHalaman
        jejak={[{ label: "CRM", href: "/crm/dasbor" }, { label: "Lead", href: "/crm/lead" }, { label: lead.nama }]}
        judul={lead.nama}
        subjudul={`${lead.namaUsaha} · Rp ${nilai}`}
        lencana={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <LencanaStatus status={lead.tahap.jenis} />
            <span className="lencana lencana-slate">{lead.tahap.nama}</span>
            {lead.perusahaanId !== lingkup.perusahaanId && <LencanaPerusahaan kode={lead.perusahaan.kode} warna={lead.perusahaan.warna} nama={lead.perusahaan.nama} />}
          </span>
        }
        aksi={
          terarsip ? undefined : (
            <>
              {boleh("lead.ubah") && (
                <Link href={`/crm/lead/${id}/ubah`} className="tombol tombol-garis">
                  <Ikon nama="edit_note" className="!text-[18px]" />
                  Ubah
                </Link>
              )}
              {lead.pelanggan ? (
                <span className="text-sm text-slate-600">Pelanggan {lead.pelanggan.kode}</span>
              ) : (
                bolehKonversi && (
                  <Link href={ruteKonversi} className="tombol tombol-garis">
                    <Ikon nama="how_to_reg" className="!text-[18px]" />
                    Jadikan pelanggan
                  </Link>
                )
              )}
              {tombolPenawaran}
              {boleh("lead.hapus") && (
                <FormulirAksi aksi={arsipkanLeadFormulir.bind(null, id)} pesanKonfirmasi={`Arsipkan lead ${lead.nama}? Lead dan tindak lanjutnya disembunyikan dari daftar, bisa dipulihkan.`}>
                  <button type="submit" className="tombol tombol-garis">
                    <Ikon nama="archive" className="!text-[18px]" />
                    Arsipkan
                  </button>
                </FormulirAksi>
              )}
            </>
          )
        }
      />

      {terarsip && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>
            Diarsipkan {formatTanggal(lead.dihapusPada!)}
            {lead.dihapusOlehNama ? ` oleh ${lead.dihapusOlehNama}` : ""}
          </span>
          {boleh("lead.hapus") && (
            <FormulirAksi aksi={pulihkanLeadFormulir.bind(null, id)}>
              <button type="submit" className="tombol tombol-garis tombol-kecil">
                <Ikon nama="unarchive" className="!text-[16px]" />
                Pulihkan
              </button>
            </FormulirAksi>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          {bolehUbah && (
            <div className="kartu space-y-3">
              <h2 className="judul-kartu">Pindah tahap</h2>
              <FormulirAksi aksi={pindahTahapLeadFormulir.bind(null, id)} pesanSukses="Tahap diperbarui" className="space-y-3">
                <div className="bidang">
                  <label className="label" htmlFor="pindah-tahapId">
                    Tahap
                  </label>
                  <select id="pindah-tahapId" name="tahapId" defaultValue={lead.tahapId} className="isian">
                    {tahap.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nama}
                        {t.jenis !== "BERJALAN" ? ` (${t.jenis === "MENANG" ? "Menang" : "Kalah"})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="bidang">
                  <label className="label" htmlFor="pindah-alasan">
                    Alasan
                  </label>
                  <textarea id="pindah-alasan" name="alasan" maxLength={1000} className="isian h-auto min-h-16 py-2" />
                  <span className="petunjuk">Wajib untuk tahap Kalah, opsional untuk Menang</span>
                </div>
                <button type="submit" className="tombol tombol-utama w-full sm:w-auto min-h-11">
                  Pindahkan
                </button>
              </FormulirAksi>
            </div>
          )}

          <div className="kartu space-y-3">
            <h2 className="judul-kartu">Rincian</h2>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
              {rincian.map(([k, v], i) => (
                <div key={`${k}-${i}`} className="contents">
                  <dt className="text-slate-500 break-words">{k}</dt>
                  <dd className="text-slate-800 break-words">{v}</dd>
                </div>
              ))}
            </dl>
            {lead.alasanMenangKalah && <p className="text-sm text-slate-700 break-words">Alasan menang/kalah: {lead.alasanMenangKalah}</p>}
            <div className="space-y-1">
              <p className="teks-label">Catatan</p>
              <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{lead.catatan || "-"}</p>
            </div>
          </div>

          {lihatPenawaran && (
            <div className="kartu space-y-3">
              <h2 className="judul-kartu">Dokumen penjualan</h2>
              {penawaran.length === 0 ? (
                <p className="text-sm text-slate-500">Belum ada penawaran.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {penawaran.map((p) => (
                    <li key={p.id} className="py-2.5 space-y-1 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link href={`/penjualan/penawaran/${p.id}`} className="font-medium text-slate-900 hover:underline">
                          {p.nomorCetak ?? p.nomor}
                        </Link>
                        <LencanaStatusKomersial status={p.statusKomersial} />
                      </div>
                      <div className="text-xs text-slate-500">
                        {formatTanggal(p.tanggal)} · Rp <Rp nilai={p.total} />
                      </div>
                      {p.pesanan && (
                        <div className="text-xs text-slate-600 space-y-0.5">
                          {boleh("pesanan.lihat") ? (
                            <Link href={`/penjualan/pesanan/${p.pesanan.id}`} className="tombol-tautan">
                              Pesanan {p.pesanan.nomor}
                            </Link>
                          ) : (
                            <span>Sudah menjadi pesanan</span>
                          )}
                          {boleh("faktur.lihat") &&
                            p.pesanan.faktur.map((f) => (
                              <div key={f.id} className="flex flex-wrap items-center gap-1.5">
                                <Link href={`/penjualan/faktur/${f.id}`} className="tombol-tautan">
                                  {f.nomor}
                                </Link>
                                <LencanaStatus status={f.status} />
                                <LencanaPersetujuan status={f.statusPersetujuan} />
                              </div>
                            ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="kartu space-y-4">
            <h2 className="judul-kartu">Pengingat tindak lanjut</h2>
            {boleh("lead.buat") && !terarsip && <FormulirTindakLanjut leadId={id} pengguna={penggunaCrm} penggunaId={pengguna.id} />}
            <DaftarTindakLanjut
              daftar={tindakLanjut}
              tampilLead={false}
              bolehUbah={bolehUbah}
              bolehHapus={boleh("lead.hapus") && !terarsip}
              pengguna={penggunaCrm}
              sekarang={sekarang}
              kosong="Belum ada pengingat untuk lead ini."
            />
          </div>

          <div className="kartu space-y-4">
            <h2 className="judul-kartu">Riwayat aktivitas</h2>
            {bolehUbah && (
              <FormulirAksi aksi={tambahCatatanLeadFormulir.bind(null, id)} pesanSukses="Catatan ditambahkan" className="space-y-2">
                <label className="sr-only" htmlFor="catatan-isi">
                  Catatan
                </label>
                <textarea id="catatan-isi" name="isi" required maxLength={5000} placeholder="Tulis catatan…" className="isian h-auto min-h-20 py-2" />
                <div>
                  <button type="submit" className="tombol tombol-utama tombol-kecil">
                    Tambah catatan
                  </button>
                </div>
              </FormulirAksi>
            )}
            <LinimasaLead daftar={aktivitas} />
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Dibuat {formatWaktu(lead.dibuatPada)} oleh {lead.dibuatOlehNama}
      </p>
    </div>
  );
}
