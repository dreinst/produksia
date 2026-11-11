import { db } from "@/lib/db";
import { saldoAntarPerusahaan } from "@/lib/perusahaan";
import { formatTanggal } from "@/lib/waktu";
import Ikon from "@/komponen/ui/Ikon";
import { Rp } from "@/komponen/ui/Lencana";

/**
 * Catatan laporan gabungan (D1 §4.6, §7.1): penjumlahan semua perusahaan tanpa eliminasi, dengan saldo Piutang dan
 * Hutang Antar Perusahaan per tanggal `sampai`. Halaman merendernya hanya saat lingkup gabungan (Neraca, Neraca Saldo,
 * Laba Rugi, Arus Kas, Perubahan Modal; Laba Rugi dan Arus Kas memakai periode.sampai). Jumlah perusahaan = perusahaan
 * aktif ditambah perusahaan arsip yang masih punya jurnal, karena jurnal keduanya ikut dijumlah. Akun antar perusahaan
 * yang tidak bisa dipakai tidak menggagalkan halaman; alasannya ditampilkan (kolom `masalah`). Selama ada masalah,
 * saldo akun yang bermasalah terbaca nol, jadi selisihnya tidak diberi peringatan satu sisi (tinjauan P15 butir 9).
 */
export default async function CatatanGabungan({ sampai }: { sampai: Date }) {
  const [saldo, jumlah] = await Promise.all([
    saldoAntarPerusahaan(db, sampai),
    db.perusahaan.count({ where: { OR: [{ aktif: true }, { jurnal: { some: {} } }] } }),
  ]);
  const bermasalah = saldo.masalah.length > 0;
  const berselisih = !bermasalah && !saldo.selisih.isZero();

  return (
    <div className="kartu flex gap-3 !py-4 text-sm text-slate-600" role="note">
      <Ikon nama="hub" className="!text-[20px] text-slate-400 shrink-0 mt-0.5" />
      <div className="space-y-1">
        <p>
          {`Laporan gabungan = penjumlahan ${jumlah} perusahaan. Transaksi antar perusahaan belum dieliminasi. Saldo per ${formatTanggal(sampai)}: `}
          Piutang Antar Perusahaan Rp <Rp nilai={saldo.piutang} />, Hutang Antar Perusahaan Rp <Rp nilai={saldo.hutang} />, selisih{" "}
          <span className={berselisih ? "lencana lencana-amber" : ""}>
            Rp <Rp nilai={saldo.selisih} />
          </span>
          .
        </p>
        {berselisih && <p className="text-amber-700">Ada transaksi antar perusahaan yang hanya dicatat di satu sisi; periksa jurnal kedua akun itu.</p>}
        {bermasalah && <p>Selisih belum bisa dihitung karena akun antar perusahaan bermasalah.</p>}
        {saldo.masalah.map((m) => (
          <p key={m} className="flex gap-1.5 text-rose-700">
            <Ikon nama="error" className="!text-[16px] shrink-0 mt-0.5" />
            <span>{m}</span>
          </p>
        ))}
      </div>
    </div>
  );
}
