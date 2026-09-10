import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { BAGAN_AKUN_STANDAR, KEPUTUSAN_KURASI, PEMETAAN_STANDAR, kedalamanAkun, type AsalAkun } from "@/lib/baganAkunStandar";
import { terapkanBaganAkunFormulir } from "@/lib/aksi/pengaturan";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import Ikon from "@/komponen/ui/Ikon";

const LABEL_ASAL: Record<AsalAkun, { label: string; kelas: string }> = {
  ASLI: { label: "Catatan asli", kelas: "lencana-slate" },
  USUL: { label: "Usulan standar", kelas: "lencana-blue" },
  KEPUTUSAN: { label: "Keputusan kurasi", kelas: "lencana-amber" },
};
const LABEL_JENIS: Record<string, string> = { ASET: "Aset", KEWAJIBAN: "Kewajiban", MODAL: "Ekuitas", PENDAPATAN: "Pendapatan", BEBAN: "Beban" };

export default async function HalamanBaganAkunStandar() {
  await wajibHak("pengaturan.tulis");
  const [daftarAda, pemetaan] = await Promise.all([
    db.akun.findMany({ select: { kode: true } }),
    db.pemetaanAkun.findUnique({ where: { id: "default" } }),
  ]);
  const kodeAda = new Set(daftarAda.map((a) => a.kode));
  const peta = new Map(BAGAN_AKUN_STANDAR.map((a) => [a.kode, a]));
  const belumAda = BAGAN_AKUN_STANDAR.filter((a) => !kodeAda.has(a.kode));
  const jumlahKelompok = BAGAN_AKUN_STANDAR.filter((a) => a.kelompok).length;
  const ringkasanAsal = (["ASLI", "USUL", "KEPUTUSAN"] as const).map((asal) => ({
    asal,
    jumlah: BAGAN_AKUN_STANDAR.filter((a) => a.asal === asal).length,
  }));

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Administrasi" }, { label: "Pengaturan" }]}
        judul="Bagan Akun Standar EO/WO"
        subjudul="Hasil kurasi catatan bagan akun usaha Event/Wedding Organizer. Terapkan untuk membuat akun yang belum ada — akun yang sudah ada tidak diubah."
        aksi={
          <Link href="/data-induk/akun" className="tombol tombol-garis">
            <Ikon nama="format_list_bulleted" className="!text-[18px]" />
            Daftar akun saat ini
          </Link>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <FormulirAksi aksi={terapkanBaganAkunFormulir} className="kartu space-y-4 self-start" pesanSukses="Bagan akun standar diterapkan.">
          <div>
            <h2 className="judul-kartu">Terapkan ke sistem</h2>
            <p className="subjudul-kartu">Idempoten: aman dijalankan berulang. Akun dibuat lengkap dengan induk, tanda kelompok, dan tanda kas/bank.</p>
          </div>
          <div className="ubin space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Akun dalam standar</span><span className="angka font-semibold">{BAGAN_AKUN_STANDAR.length}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">— akun kelompok (induk)</span><span className="angka">{jumlahKelompok}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">— akun rinci (bisa dijurnal)</span><span className="angka">{BAGAN_AKUN_STANDAR.length - jumlahKelompok}</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-1.5"><span className="text-slate-500">Sudah ada di sistem</span><span className="angka">{BAGAN_AKUN_STANDAR.length - belumAda.length}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Akan dibuat</span><span className={`angka font-semibold ${belumAda.length ? "text-blue-700" : "text-emerald-700"}`}>{belumAda.length}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Pemetaan akun</span><span className={pemetaan ? "text-emerald-700" : "text-amber-700"}>{pemetaan ? "sudah diatur" : `akan diisi (${Object.values(PEMETAAN_STANDAR).join(", ")})`}</span></div>
          </div>
          <button type="submit" className="tombol tombol-utama w-full" disabled={belumAda.length === 0 && Boolean(pemetaan)}>
            <Ikon nama="account_tree" className="!text-[18px]" />
            {belumAda.length === 0 ? (pemetaan ? "Semua akun sudah ada" : "Isi pemetaan akun") : `Buat ${belumAda.length} akun`}
          </button>
          <p className="text-xs text-slate-500">
            Setelah diterapkan, ganti nama <span className="mono">1-1210</span> sesuai bank & nomor rekening, dan tambah rekening lain sebagai anak <span className="mono">1-1200</span> lewat Data Induk → Bagan Akun.
          </p>
        </FormulirAksi>

        <div className="kartu lg:col-span-2 space-y-3">
          <div>
            <h2 className="judul-kartu">Keputusan atas butir yang semula menunggu konfirmasi</h2>
            <p className="subjudul-kartu">Diputuskan saat kurasi agar sistem bisa langsung dipakai; semuanya bisa diubah lewat Data Induk → Bagan Akun.</p>
          </div>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            {KEPUTUSAN_KURASI.map((k) => (
              <div key={k.butir} className="ubin">
                <dt className="font-semibold text-slate-900">{k.butir}</dt>
                <dd className="text-xs text-slate-600 mt-1 leading-relaxed">{k.keputusan}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="kartu kartu-tabel">
        <div className="kepala-kartu">
          <div>
            <h2 className="judul-kartu">Struktur bagan akun</h2>
            <p className="subjudul-kartu">Penomoran X-YZWW ala Accurate: digit pertama jenis, ratusan kelompok, puluhan akun rinci.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {ringkasanAsal.map((r) => (
              <span key={r.asal} className={`lencana ${LABEL_ASAL[r.asal].kelas}`}>
                {LABEL_ASAL[r.asal].label} · {r.jumlah}
              </span>
            ))}
          </div>
        </div>
        <div className="bungkus-tabel">
          <table className="tabel min-w-[56rem]">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Nama akun</th>
                <th>Jenis</th>
                <th>Tanda</th>
                <th>Asal</th>
                <th>Status</th>
                <th>Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {BAGAN_AKUN_STANDAR.map((a) => {
                const kedalaman = kedalamanAkun(a.kode, peta);
                const ada = kodeAda.has(a.kode);
                return (
                  <tr key={a.kode} className={a.kelompok ? "bg-slate-50/70" : undefined}>
                    <td className="mono">{a.kode}</td>
                    <td className={a.kelompok ? "font-semibold text-slate-900" : undefined} style={{ paddingLeft: `${0.75 + kedalaman * 1.25}rem` }}>
                      {a.nama}
                    </td>
                    <td className="text-slate-500">{LABEL_JENIS[a.jenis]}</td>
                    <td className="space-x-1 whitespace-nowrap">
                      {a.kelompok && <span className="lencana lencana-slate">Kelompok</span>}
                      {a.kasBank && <span className="lencana lencana-emerald">Kas/Bank</span>}
                      {Object.values(PEMETAAN_STANDAR).includes(a.kode as (typeof PEMETAAN_STANDAR)[keyof typeof PEMETAAN_STANDAR]) && (
                        <span className="lencana lencana-indigo">Pemetaan</span>
                      )}
                    </td>
                    <td>
                      <span className={`lencana ${LABEL_ASAL[a.asal].kelas}`}>{LABEL_ASAL[a.asal].label}</span>
                    </td>
                    <td>
                      {ada ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-semibold"><Ikon nama="check_circle" className="!text-[16px]" />Ada</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-blue-700 text-xs font-semibold"><Ikon nama="add" className="!text-[16px]" />Akan dibuat</span>
                      )}
                    </td>
                    <td className="text-xs text-slate-500 max-w-md">{a.keterangan ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
