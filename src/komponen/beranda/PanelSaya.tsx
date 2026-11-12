import Link from "next/link";
import { db } from "@/lib/db";
import { peranTertinggi, punyaHak, type Hak, type PenggunaSesi } from "@/lib/hakAkses";
import { tindakLanjutSaya, tindakLanjutTerlambat } from "@/lib/crm";
import { ringkasanDesainBeranda, tugasLewatTenggat, SYARAT_TUGAS_AKTIF, type RingkasanDesainBeranda } from "@/lib/desain";
import { SYARAT_KONTEN_AKTIF, kontenSaya, type AlasanKontenSaya } from "@/lib/konten";
import { LABEL_PLATFORM, STATUS_DESAIN, STATUS_KONTEN, STATUS_PERSETUJUAN_KONTEN, TITIK_PLATFORM, kelasLencana, type GayaLabel } from "@/lib/labelPemasaran";
import { daftarPerusahaan, saringPerusahaan } from "@/lib/perusahaan";
import { formatTanggal, formatWaktu } from "@/lib/waktu";
import { LencanaStatus } from "@/komponen/ui/Lencana";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import Ikon from "@/komponen/ui/Ikon";

/*
 * Tab "Tugas Saya" (D7 §3.5, §7.4): tugas desain saya, konten saya, tindak lanjut saya, dan yang menunggu persetujuan
 * pengguna (dokumen maker-checker, konten, dan tinjauan desain). Tiap kartu hanya tampil bila relevan bagi hak
 * pengguna (kartuTugasSaya). Judul tugas, konten, dan tindak lanjut menaut ke laci atau lead-nya, dan baris konten
 * serta desain yang menunggu menaut ke daftar Perencana Konten dan Tugas Desain. Tiap tautan hanya dipasang bila
 * pengguna memegang hak lihat halaman tujuannya (KODE_MENUNGGU_PEMASARAN dan TAUTAN_MENUNGGU).
 */

type BarisMenunggu = { kode: string; label: string; jumlah: number };

/** Kode baris "menunggu" modul Pemasaran; sisanya dokumen maker-checker yang ditangani halaman /persetujuan. */
export const KODE_MENUNGGU_PEMASARAN: readonly string[] = ["konten", "desain"];

/** Tautan baris "menunggu" Pemasaran beserta hak lihat halaman tujuannya. */
export const TAUTAN_MENUNGGU: Readonly<Record<string, { href: string; hak: Hak }>> = {
  konten: { href: "/pemasaran/konten?tampilan=daftar&persetujuan=MENUNGGU", hak: "konten.lihat" },
  desain: { href: "/pemasaran/desain?tampilan=daftar&status=DITINJAU", hak: "tugas-desain.lihat" },
};

/** Judul baris sebagai tautan bila `href` ada, selain itu teks biasa dengan gaya yang sama. */
function JudulBaris({ href, judul }: { href: string | null; judul: string }) {
  if (!href) return <div className="font-medium text-slate-800 truncate" title={judul}>{judul}</div>;
  return (
    <Link href={href} className="block font-medium text-slate-800 truncate hover:text-blue-700 hover:underline" title={judul}>
      {judul}
    </Link>
  );
}

type SaringMenunggu = {
  statusPersetujuan: "MENUNGGU";
  perusahaanId?: string;
  OR: ({ diajukanOlehId: null } | { diajukanOlehId: { not: string } })[];
};

/**
 * Baris kartu "Menunggu persetujuan Anda": hak setujui yang membuka baris itu dan cara menghitungnya. Satu-satunya
 * sumber daftar hak setujui Tugas Saya; HAK_SETUJUI_TUGAS_SAYA (penentu kartu tampil) diturunkan dari sini.
 */
const BARIS_MENUNGGU: readonly {
  kode: string;
  label: string;
  hak: Hak;
  hitung: (where: SaringMenunggu, perusahaanId: string | null, pengguna: PenggunaSesi) => Promise<number>;
}[] = [
  { kode: "faktur", label: "Faktur Penjualan", hak: "faktur.setujui", hitung: (where) => db.fakturPenjualan.count({ where }) },
  { kode: "faktur-pembelian", label: "Faktur Pembelian", hak: "faktur-pembelian.setujui", hitung: (where) => db.fakturPembelian.count({ where }) },
  { kode: "kas-masuk", label: "Kas Masuk", hak: "kas-masuk.setujui", hitung: (where) => db.dokumenKas.count({ where: { ...where, jenis: "MASUK" } }) },
  { kode: "kas-keluar", label: "Kas Keluar", hak: "kas-keluar.setujui", hitung: (where) => db.dokumenKas.count({ where: { ...where, jenis: "KELUAR" } }) },
  { kode: "penyesuaian", label: "Penyesuaian Stok", hak: "penyesuaian.setujui", hitung: (where) => db.penyesuaianPersediaan.count({ where }) },
  {
    kode: "peminjaman",
    label: "Peminjaman Barang",
    hak: "peminjaman.setujui",
    // Ajuan pengguna GUDANG hanya boleh disetujui Pemilik/Superadmin (pastikanBolehSetujui peminjaman di src/lib/persetujuan.ts),
    // jadi bagi peran lain tidak dihitung. Syarat ditambahkan lewat AND supaya OR pemisahan tugas tetap utuh.
    hitung: (where, _perusahaanId, pengguna) =>
      db.peminjamanBarang.count({
        where: peranTertinggi(pengguna.peran) ? where : { ...where, AND: [{ OR: [{ diajukanOlehId: null }, { diajukanOleh: { peran: { not: "GUDANG" } } }] }] },
      }),
  },
  { kode: "kerusakan", label: "Laporan Kerusakan Barang", hak: "kerusakan.setujui", hitung: (where) => db.laporanKerusakanBarang.count({ where }) },
  { kode: "aset", label: "Aset Tetap", hak: "aset.setujui", hitung: (where) => db.asetTetap.count({ where }) },
  { kode: "penggajian", label: "Penggajian", hak: "penggajian.setujui", hitung: (where) => db.penggajian.count({ where }) },
  {
    kode: "konten",
    label: "Konten media sosial",
    hak: "konten.setujui",
    hitung: (_where, perusahaanId) => db.konten.count({ where: { ...SYARAT_KONTEN_AKTIF, ...saringPerusahaan(perusahaanId), statusPersetujuan: "MENUNGGU" } }),
  },
  {
    kode: "desain",
    label: "Tinjauan desain",
    hak: "tugas-desain.setujui",
    hitung: (_where, perusahaanId) => db.tugasDesain.count({ where: { ...SYARAT_TUGAS_AKTIF, ...saringPerusahaan(perusahaanId), status: "DITINJAU" } }),
  },
];

/** Hak setujui yang dihitung kartu "Menunggu persetujuan Anda", diturunkan dari BARIS_MENUNGGU. */
export const HAK_SETUJUI_TUGAS_SAYA: readonly Hak[] = BARIS_MENUNGGU.map((b) => b.hak);

/**
 * Kartu tab Tugas Saya yang relevan bagi pengguna (murni, diuji langsung):
 * - tugas desain: pemegang tugas-desain.ubah (yang bisa ditugasi desain, D6 §3.2.1). Bila ia juga boleh membuat tugas
 *   (peminta, mis. SOSMED, ADMIN, PEMILIK), kartunya hanya tampil saat memang ada tugas aktif yang ditugaskan kepadanya,
 *   supaya peminta tidak mendapat kartu kosong. Pelaksana murni (DESAINER) selalu mendapat kartunya.
 * - konten saya: pemegang konten.ubah.
 * - tindak lanjut: pemegang lead.lihat.
 * - menunggu persetujuan: pemegang minimal satu hak di HAK_SETUJUI_TUGAS_SAYA.
 * jumlahTugasDesainSaya = tugas aktif yang ditugaskan ke pengguna (null bila belum dihitung).
 */
export function kartuTugasSaya(pengguna: Pick<PenggunaSesi, "hak">, jumlahTugasDesainSaya: number | null) {
  const boleh = (h: Hak) => pengguna.hak.includes(h);
  return {
    desain: boleh("tugas-desain.ubah") && (!boleh("tugas-desain.buat") || (jumlahTugasDesainSaya ?? 0) > 0),
    konten: boleh("konten.ubah"),
    tindakLanjut: boleh("lead.lihat"),
    menunggu: HAK_SETUJUI_TUGAS_SAYA.some(boleh),
  };
}

/** Lencana alasan di kartu Konten saya; AKAN_TERBIT dan BELUM_SELESAI sudah terbaca dari tanggal dan lencana status. */
export const LENCANA_ALASAN: Partial<Record<AlasanKontenSaya, GayaLabel>> = {
  DITOLAK: { label: "Ditolak", warna: "rose" },
  LEWAT_TERBIT: { label: "Lewat tanggal terbit", warna: "rose" },
  BELUM_DIJADWALKAN: { label: "Perlu dijadwalkan", warna: "amber" },
  REVISI_DESAIN: { label: "Desain direvisi", warna: "amber" },
  DESAIN_SIAP: { label: "Desain siap, ajukan", warna: "emerald" },
};

/**
 * Jumlah dokumen maker-checker berstatus MENUNGGU yang boleh pengguna setujui dan bukan ajuannya sendiri
 * (pemisahan tugas, sama dengan pastikanBukanPengaju), ditambah konten yang menunggu persetujuan (konten.setujui) dan
 * tugas desain yang menunggu tinjauan (tugas-desain.setujui), dalam lingkup perusahaan (null = gabungan). Konten dan
 * desain tidak memakai pemisahan tugas karena penyetuju boleh meninjau ajuannya sendiri (D6 §3.1.4).
 */
export async function menungguPersetujuanSaya(pengguna: PenggunaSesi, perusahaanId: string | null): Promise<BarisMenunggu[]> {
  const where: SaringMenunggu = {
    statusPersetujuan: "MENUNGGU",
    ...saringPerusahaan(perusahaanId),
    OR: [{ diajukanOlehId: null }, { diajukanOlehId: { not: pengguna.id } }],
  };
  const jumlah = await Promise.all(BARIS_MENUNGGU.map((b) => (punyaHak(pengguna, b.hak) ? b.hitung(where, perusahaanId, pengguna) : Promise.resolve(0))));
  return BARIS_MENUNGGU.map(({ kode, label }, i) => ({ kode, label, jumlah: jumlah[i] })).filter((b) => b.jumlah > 0);
}

export default async function PanelSaya({ pengguna, perusahaanId }: { pengguna: PenggunaSesi; perusahaanId: string | null }) {
  const awal = kartuTugasSaya(pengguna, null);
  const sekarang = new Date();
  const [desainMentah, konten, tindakLanjut, menunggu, perusahaan] = await Promise.all([
    punyaHak(pengguna, "tugas-desain.ubah") ? ringkasanDesainBeranda(db, pengguna.id, perusahaanId) : Promise.resolve(null),
    awal.konten ? kontenSaya(db, pengguna.id, perusahaanId) : Promise.resolve(null),
    awal.tindakLanjut ? tindakLanjutSaya(db, pengguna.id, 10, perusahaanId) : Promise.resolve([]),
    awal.menunggu ? menungguPersetujuanSaya(pengguna, perusahaanId) : Promise.resolve([]),
    perusahaanId === null ? daftarPerusahaan(true) : Promise.resolve([]),
  ]);
  const kartu = kartuTugasSaya(pengguna, desainMentah?.ditugaskanKeSaya ?? null);
  const desain: RingkasanDesainBeranda | null = kartu.desain ? desainMentah : null;
  const petaPerusahaan = new Map(perusahaan.map((p) => [p.id, p]));
  const totalMenunggu = menunggu.reduce((s, b) => s + b.jumlah, 0);
  const adaDokumen = menunggu.some((b) => !KODE_MENUNGGU_PEMASARAN.includes(b.kode));
  const adaKartu = !!desain || kartu.konten || kartu.tindakLanjut || kartu.menunggu;
  const lihatTugas = punyaHak(pengguna, "tugas-desain.lihat");
  const lihatKonten = punyaHak(pengguna, "konten.lihat");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-7">
      {!adaKartu && (
        <div className="kartu lg:col-span-2">
          <p className="text-sm text-slate-500">Tidak ada tugas untuk Anda saat ini.</p>
        </div>
      )}
      {desain && (
        <div className="kartu">
          <div className="kepala-kartu">
            <div>
              <h2 className="judul-kartu">Tugas desain saya</h2>
              <p className="subjudul-kartu">Tugas yang ditugaskan ke Anda dan belum selesai, urut tenggat.</p>
            </div>
            {desain.revisiSaya > 0 && <span className="lencana lencana-rose">Revisi untuk Anda: {desain.revisiSaya.toLocaleString("id-ID")}</span>}
          </div>
          {desain.tugasSaya.length === 0 ? (
            <p className="text-sm text-slate-500">Tidak ada tugas desain aktif.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {desain.tugasSaya.map((t) => {
                const p = petaPerusahaan.get(t.perusahaanId);
                const lewat = tugasLewatTenggat(t, sekarang);
                return (
                  <li key={t.id} className="py-2.5 flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <JudulBaris href={lihatTugas ? `/pemasaran/desain?tugas=${t.id}` : null} judul={t.judul} />
                      <div className={`text-xs truncate ${lewat ? "text-rose-600 font-medium" : "text-slate-500"}`}>
                        {t.tenggat ? `Tenggat ${formatTanggal(t.tenggat)}` : "Tanpa tenggat"}
                        {lewat ? " · Lewat tenggat" : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {p && <LencanaPerusahaan kode={p.kode} warna={p.warna} nama={p.nama} />}
                      <span className={kelasLencana(STATUS_DESAIN[t.status].warna)}>{STATUS_DESAIN[t.status].label}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {desain.ditugaskanKeSaya > desain.tugasSaya.length && (
            <p className="text-xs text-slate-500 mt-3">{desain.ditugaskanKeSaya.toLocaleString("id-ID")} tugas aktif, menampilkan {desain.tugasSaya.length}.</p>
          )}
        </div>
      )}

      {konten && (
        <div className="kartu">
          <div className="kepala-kartu">
            <div>
              <h2 className="judul-kartu">Konten saya</h2>
              <p className="subjudul-kartu">Konten yang Anda tangani dan perlu tindakan, termasuk yang lewat tanggal terbit dan yang terbit 14 hari ke depan.</p>
            </div>
            {konten.total > 0 && <span className="lencana lencana-blue">{konten.total.toLocaleString("id-ID")} konten</span>}
          </div>
          {konten.baris.length === 0 ? (
            <p className="text-sm text-slate-500">Tidak ada konten yang perlu tindakan.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {konten.baris.map((k) => {
                const p = petaPerusahaan.get(k.perusahaanId);
                return (
                  <li key={k.id} className="py-2.5 text-sm space-y-1">
                    <JudulBaris href={lihatKonten ? `/pemasaran/konten?konten=${k.id}` : null} judul={k.judul} />
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <div className="text-xs text-slate-500 flex items-center gap-1.5 whitespace-nowrap">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TITIK_PLATFORM[k.platform]}`} aria-hidden="true" />
                        {LABEL_PLATFORM[k.platform]} · {k.tanggalTerbit ? `Terbit ${formatTanggal(k.tanggalTerbit)}` : "Belum dijadwalkan"}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {p && <LencanaPerusahaan kode={p.kode} warna={p.warna} nama={p.nama} />}
                        <span className={kelasLencana(STATUS_KONTEN[k.status].warna)}>{STATUS_KONTEN[k.status].label}</span>
                        {/* seperti PanelPemasaran; Ditolak sudah tampil lewat lencana alasan, jadi di sini hanya Menunggu persetujuan */}
                        {k.statusPersetujuan === "MENUNGGU" && STATUS_PERSETUJUAN_KONTEN.MENUNGGU && (
                          <span className={kelasLencana(STATUS_PERSETUJUAN_KONTEN.MENUNGGU.warna)}>{STATUS_PERSETUJUAN_KONTEN.MENUNGGU.label}</span>
                        )}
                        {k.alasan.map((a) => {
                          const gaya = LENCANA_ALASAN[a];
                          return gaya ? <span key={a} className={kelasLencana(gaya.warna)}>{gaya.label}</span> : null;
                        })}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {konten.total > konten.baris.length && (
            <p className="text-xs text-slate-500 mt-3">{konten.total.toLocaleString("id-ID")} konten perlu tindakan, menampilkan {konten.baris.length}.</p>
          )}
        </div>
      )}

      {kartu.tindakLanjut && (
        <div className="kartu">
          <div className="kepala-kartu">
            <div>
              <h2 className="judul-kartu">Tindak lanjut saya</h2>
              <p className="subjudul-kartu">Pengingat CRM yang ditugaskan ke Anda, urut jatuh tempo.</p>
            </div>
          </div>
          {tindakLanjut.length === 0 ? (
            <p className="text-sm text-slate-500">Tidak ada tindak lanjut yang menunggu.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {tindakLanjut.map((t) => {
                const p = petaPerusahaan.get(t.perusahaanId);
                return (
                  <li key={t.id} className="py-2.5 flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <JudulBaris href={t.leadId ? `/crm/lead/${t.leadId}` : "/crm/tindak-lanjut"} judul={t.judul} />
                      <div className="text-xs text-slate-500 truncate">
                        {t.namaLead ? `${t.namaLead}${t.namaUsahaLead ? `, ${t.namaUsahaLead}` : ""}` : "Tanpa lead"} · {formatWaktu(t.jatuhTempo)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {p && <LencanaPerusahaan kode={p.kode} warna={p.warna} nama={p.nama} />}
                      {tindakLanjutTerlambat(t, sekarang) && <LencanaStatus status="TERLAMBAT" />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {kartu.menunggu && (
        <div className="kartu">
          <div className="kepala-kartu">
            <div>
              <h2 className="judul-kartu">Menunggu persetujuan Anda</h2>
              <p className="subjudul-kartu">Dokumen, konten, dan desain yang menunggu keputusan Anda.</p>
            </div>
            {totalMenunggu > 0 && <span className="lencana lencana-amber">{totalMenunggu.toLocaleString("id-ID")} menunggu</span>}
          </div>
          {menunggu.length === 0 ? (
            <p className="text-sm text-slate-500">Tidak ada yang menunggu persetujuan Anda.</p>
          ) : (
            <>
              <ul className="divide-y divide-slate-100 text-sm">
                {menunggu.map((b) => {
                  const tautan = TAUTAN_MENUNGGU[b.kode];
                  return (
                  <li key={b.kode} className="py-2 flex items-center justify-between gap-3">
                    {tautan && punyaHak(pengguna, tautan.hak) ? (
                      <Link href={tautan.href} className="tombol-tautan">
                        {b.label}
                      </Link>
                    ) : (
                      <span className="text-slate-600">{b.label}</span>
                    )}
                    <span className="angka font-semibold text-slate-800">{b.jumlah.toLocaleString("id-ID")}</span>
                  </li>
                  );
                })}
              </ul>
              {adaDokumen && (
                <div className="mt-4">
                  <Link href="/persetujuan" className="tombol tombol-lembut tombol-kecil">
                    <Ikon nama="fact_check" className="!text-[18px] text-slate-500" />
                    Buka Persetujuan
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
