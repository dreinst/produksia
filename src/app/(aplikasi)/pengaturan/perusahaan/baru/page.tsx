import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { buatPerusahaanFormulir } from "@/lib/aksi/perusahaan";
import FormPerusahaan, { nilaiAkunPajak } from "@/komponen/FormPerusahaan";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";

/**
 * Perusahaan baru (D1 §7.2). Nilai awal pajak dari pengaturan utama. Pilihan akun pajak hanya akun bersama, karena
 * perusahaan yang belum ada tidak punya akun sendiri; akun yang dikosongkan disalin dari baris "default" oleh aksi.
 */
export default async function HalamanPerusahaanBaru() {
  await wajibHak("pengaturan.tulis");
  const [pengaturan, daftarAkun, urutanTerakhir] = await Promise.all([
    ambilPengaturanPerusahaan(db),
    db.akun.findMany({
      where: { kelompok: false, jenis: { in: ["ASET", "KEWAJIBAN", "BEBAN"] }, perusahaanId: null },
      orderBy: { kode: "asc" },
      select: { id: true, kode: true, nama: true, jenis: true },
    }),
    db.perusahaan.aggregate({ _max: { urutan: true } }),
  ]);
  const bersama = new Set(daftarAkun.map((a) => a.id));
  // akun pajak utama yang bukan akun bersama tidak ditawarkan (aksi juga tidak menyalinnya)
  const akunUtama = Object.fromEntries(
    (["akunPpnKeluaranId", "akunPpnMasukanId", "akunPph23DimukaId", "akunPph23DipotongId", "akunBebanPphFinalId", "akunHutangPphFinalId"] as const).map((k) => [k, pengaturan[k] && bersama.has(pengaturan[k]) ? pengaturan[k] : null]),
  ) as Parameters<typeof nilaiAkunPajak>[0];

  return (
    <div className="space-y-6 max-w-3xl">
      <KepalaHalaman
        jejak={[{ label: "Pengaturan" }, { label: "Perusahaan & Pajak", href: "/pengaturan/perusahaan" }, { label: "Baru" }]}
        judul="Perusahaan Baru"
        subjudul="Entitas baru dengan pembukuan sendiri. Pajak dan akun pajak awal diambil dari pengaturan perusahaan utama."
        aksi={<Link href="/pengaturan/perusahaan" className="tombol tombol-garis">Kembali</Link>}
      />
      <FormPerusahaan
        aksi={buatPerusahaanFormulir}
        tombol="Simpan Perusahaan"
        daftarAkun={daftarAkun}
        nilai={{
          kode: "",
          nama: "",
          namaLegal: null,
          jenis: "AGENSI",
          industri: null,
          warna: null,
          urutan: Math.min((urutanTerakhir._max.urutan ?? 0) + 1, 999),
          aktif: true,
          alamat: null,
          kota: null,
          telepon: null,
          email: null,
          website: null,
          instagram: null,
          namaBank: null,
          cabangBank: null,
          nomorRekening: null,
          atasNamaRekening: null,
          penandaTangan: null,
          jabatanPenandaTangan: null,
          npwp: null,
          infoPajak: null,
          catatan: null,
          pkp: pengaturan.pkp,
          tarifPpnPersen: Number(pengaturan.tarifPpnPersen),
          terminHari: pengaturan.terminHari,
          pphFinalPersen: Number(pengaturan.pphFinalPersen),
          ...nilaiAkunPajak(akunUtama, daftarAkun),
        }}
      />
    </div>
  );
}
