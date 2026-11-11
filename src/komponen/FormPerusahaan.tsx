import type { ReactNode } from "react";
import FormulirAksi from "@/komponen/FormulirAksi";
import type { StatusFormulir } from "@/lib/statusFormulir";

/*
 * Formulir identitas, kontak, rekening cetak, penanda tangan, dan pajak satu perusahaan (D1 §7.1). Komponen server
 * tanpa hook: dipakai halaman Perusahaan Baru (buatPerusahaanFormulir) dan halaman ubah (ubahPerusahaanFormulir.bind).
 * Isian pajak dan enam pilihan akun pajak dipindah dari halaman Perusahaan & Pajak lama dengan teks yang sama.
 */

export type OpsiAkunPajak = { id: string; kode: string; nama: string; jenis: string };

export type NilaiPerusahaan = {
  kode: string;
  nama: string;
  namaLegal: string | null;
  jenis: string;
  industri: string | null;
  warna: string | null;
  urutan: number;
  aktif: boolean;
  alamat: string | null;
  kota: string | null;
  telepon: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  namaBank: string | null;
  cabangBank: string | null;
  nomorRekening: string | null;
  atasNamaRekening: string | null;
  penandaTangan: string | null;
  jabatanPenandaTangan: string | null;
  npwp: string | null;
  infoPajak: string | null;
  catatan: string | null;
  pkp: boolean;
  tarifPpnPersen: number;
  terminHari: number;
  pphFinalPersen: number;
  akunPpnKeluaranId: string;
  akunPpnMasukanId: string;
  akunPph23DimukaId: string;
  akunPph23DipotongId: string;
  akunBebanPphFinalId: string;
  akunHutangPphFinalId: string;
};

type AkunPajakTersimpan = Record<"akunPpnKeluaranId" | "akunPpnMasukanId" | "akunPph23DimukaId" | "akunPph23DipotongId" | "akunBebanPphFinalId" | "akunHutangPphFinalId", string | null>;

/**
 * Nilai awal enam pilihan akun pajak: akun tersimpan, kalau kosong akun bagan standar yang ada di pilihan (sama dengan
 * halaman Perusahaan & Pajak lama).
 */
export function nilaiAkunPajak(tersimpan: AkunPajakTersimpan, daftar: OpsiAkunPajak[]): AkunPajakTersimpan & Record<keyof AkunPajakTersimpan, string> {
  const byKode = (kode: string) => daftar.find((a) => a.kode === kode)?.id ?? "";
  const pilih = (id: string | null, kode: string) => id ?? byKode(kode);
  return {
    akunPpnKeluaranId: pilih(tersimpan.akunPpnKeluaranId, "2-1330"),
    akunPpnMasukanId: pilih(tersimpan.akunPpnMasukanId, "1-1800"),
    akunPph23DimukaId: pilih(tersimpan.akunPph23DimukaId, "1-1900"),
    akunPph23DipotongId: pilih(tersimpan.akunPph23DipotongId, "2-1320"),
    akunBebanPphFinalId: pilih(tersimpan.akunBebanPphFinalId, "5-9100"),
    akunHutangPphFinalId: pilih(tersimpan.akunHutangPphFinalId, "2-1320"),
  };
}

function PilihAkunPajak({ nama, label, nilai, daftar, petunjuk }: { nama: string; label: string; nilai: string; daftar: OpsiAkunPajak[]; petunjuk: string }) {
  return (
    <div className="bidang">
      <label className="label" htmlFor={nama}>{label}</label>
      <select id={nama} name={nama} defaultValue={nilai} className="isian">
        <option value="">Tidak dipakai</option>
        {daftar.map((a) => (
          <option key={a.id} value={a.id}>
            {a.kode} - {a.nama}
          </option>
        ))}
      </select>
      <span className="petunjuk">{petunjuk}</span>
    </div>
  );
}

function Teks({ nama, label, nilai, petunjuk, wajib, maks, jenis = "text", lebar, placeholder }: { nama: string; label: string; nilai: string | null; petunjuk?: string; wajib?: boolean; maks?: number; jenis?: string; lebar?: boolean; placeholder?: string }) {
  return (
    <div className={`bidang${lebar ? " md:col-span-2" : ""}`}>
      <label className="label" htmlFor={nama}>{label}{wajib ? " *" : ""}</label>
      <input id={nama} name={nama} type={jenis} required={wajib} maxLength={maks} defaultValue={nilai ?? ""} placeholder={placeholder} className="isian" />
      {petunjuk && <span className="petunjuk">{petunjuk}</span>}
    </div>
  );
}

function Kelompok({ judul, keterangan, children }: { judul: string; keterangan?: string; children: ReactNode }) {
  return (
    <>
      <div className="md:col-span-2 border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
        <h2 className="judul-kartu">{judul}</h2>
        {keterangan && <p className="subjudul-kartu">{keterangan}</p>}
      </div>
      {children}
    </>
  );
}

export default function FormPerusahaan({
  aksi,
  nilai,
  daftarAkun,
  utama = false,
  pesanSukses,
  tombol,
  lencanaPajak,
}: {
  aksi: (sebelumnya: StatusFormulir, dataFormulir: FormData) => Promise<StatusFormulir>;
  nilai: NilaiPerusahaan;
  daftarAkun: OpsiAkunPajak[];
  /** perusahaan utama: kotak aktif tidak bisa dimatikan */
  utama?: boolean;
  pesanSukses?: string;
  tombol: string;
  /** penanda "Tersimpan"/"Masih bawaan" untuk pengaturan pajak */
  lencanaPajak?: ReactNode;
}) {
  const aset = daftarAkun.filter((a) => a.jenis === "ASET");
  const kewajiban = daftarAkun.filter((a) => a.jenis === "KEWAJIBAN");
  const beban = daftarAkun.filter((a) => a.jenis === "BEBAN");
  return (
    <FormulirAksi aksi={aksi} pesanSukses={pesanSukses} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
      <Kelompok judul="Identitas">
        <Teks nama="kode" label="Kode" nilai={nilai.kode} wajib maks={12} petunjuk="2-12 huruf besar atau angka; tampil di lencana dan kolom Perusahaan" />
        <Teks nama="nama" label="Nama perusahaan" nilai={nilai.nama} wajib maks={120} petunjuk="Tampil di sidebar dan dokumen" />
        <Teks nama="namaLegal" label="Nama legal" nilai={nilai.namaLegal} maks={200} petunjuk="Nama badan hukum, mis. CV atau PT; kosong = sama dengan nama" />
        <div className="bidang">
          <label className="label" htmlFor="jenis">Jenis</label>
          <select id="jenis" name="jenis" defaultValue={nilai.jenis} className="isian">
            <option value="AGENSI">Agensi</option>
            <option value="MEREK">Merek</option>
            <option value="KLIEN">Klien</option>
          </select>
        </div>
        <Teks nama="industri" label="Industri" nilai={nilai.industri} maks={200} />
        <Teks nama="warna" label="Warna merek" nilai={nilai.warna} maks={7} placeholder="#0B2144" petunjuk="Kode heksa #RRGGBB untuk titik warna lencana perusahaan" />
        <div className="bidang">
          <label className="label" htmlFor="urutan">Urutan tampil</label>
          <input id="urutan" name="urutan" type="number" min={0} max={999} step={1} defaultValue={nilai.urutan} className="isian" />
          <span className="petunjuk">Urutan di pemilih perusahaan dan tabel</span>
        </div>
        <label className={`flex items-start gap-3 ubin ${utama ? "" : "cursor-pointer"}`}>
          {/* kotak yang dinonaktifkan tidak ikut terkirim, jadi utama mengirim isian tersembunyi */}
          {utama && <input type="hidden" name="aktif" value="on" />}
          <input type="checkbox" name={utama ? undefined : "aktif"} defaultChecked={nilai.aktif} disabled={utama} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
          <span className="text-sm">
            <span className="font-semibold text-slate-900">Aktif</span>
            <span className="block text-xs text-slate-500 mt-0.5">
              {utama ? "Perusahaan utama tidak bisa diarsipkan" : "Dimatikan = diarsipkan: tidak bisa dipakai dokumen baru, pembukuannya tetap tampil di laporan"}
            </span>
          </span>
        </label>
      </Kelompok>

      <Kelompok judul="Kontak">
        <Teks nama="alamat" label="Alamat" nilai={nilai.alamat} maks={1000} lebar />
        <Teks nama="kota" label="Kota" nilai={nilai.kota} maks={200} />
        <Teks nama="telepon" label="Telepon" nilai={nilai.telepon} maks={40} jenis="tel" />
        <Teks nama="email" label="Email" nilai={nilai.email} maks={200} jenis="email" />
        <Teks nama="website" label="Website" nilai={nilai.website} maks={200} />
        <Teks nama="instagram" label="Instagram" nilai={nilai.instagram} maks={200} />
      </Kelompok>

      <Kelompok judul="Rekening & penanda tangan untuk cetak" keterangan="Dipakai teks dokumen cetak. Bukan akun buku besar.">
        <Teks nama="namaBank" label="Nama bank" nilai={nilai.namaBank} maks={200} />
        <Teks nama="cabangBank" label="Cabang bank" nilai={nilai.cabangBank} maks={200} />
        <Teks nama="nomorRekening" label="Nomor rekening" nilai={nilai.nomorRekening} maks={40} />
        <Teks nama="atasNamaRekening" label="Atas nama rekening" nilai={nilai.atasNamaRekening} maks={200} />
        <Teks nama="penandaTangan" label="Penanda tangan" nilai={nilai.penandaTangan} maks={200} />
        <Teks nama="jabatanPenandaTangan" label="Jabatan penanda tangan" nilai={nilai.jabatanPenandaTangan} maks={200} />
      </Kelompok>

      <Kelompok judul="Pajak" keterangan="Status PKP, tarif PPN, termin faktur, dan akun pajak yang dipakai jurnal otomatis perusahaan ini.">
        {lencanaPajak && <div className="md:col-span-2 -mt-2">{lencanaPajak}</div>}
        <Teks nama="npwp" label="NPWP" nilai={nilai.npwp} maks={40} petunjuk="15 atau 16 digit; tanda baca boleh" />
        <Teks nama="infoPajak" label="Info pajak" nilai={nilai.infoPajak} maks={1000} petunjuk="Keterangan pajak bebas untuk dokumen" />

        <div className="bidang">
          <label className="label" htmlFor="terminHari">Termin jatuh tempo faktur (hari)</label>
          <input id="terminHari" name="terminHari" type="number" min={0} max={365} defaultValue={nilai.terminHari} className="isian" />
          <span className="petunjuk">TOP bawaan: tanggal faktur + termin</span>
        </div>

        <div className="bidang">
          <label className="label" htmlFor="tarifPpnPersen">Tarif PPN (%)</label>
          <input id="tarifPpnPersen" name="tarifPpnPersen" type="number" min={0} max={100} step="0.01" defaultValue={nilai.tarifPpnPersen} className="isian" />
          <span className="petunjuk">Dipakai sebagai bawaan faktur bila PKP; per faktur bisa dipilih 0%</span>
        </div>

        <label className="md:col-span-2 flex items-start gap-3 ubin cursor-pointer">
          <input type="checkbox" name="pkp" defaultChecked={nilai.pkp} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
          <span className="text-sm">
            <span className="font-semibold text-slate-900">Pengusaha Kena Pajak (PKP)</span>
            <span className="block text-xs text-slate-500 mt-0.5">Bila aktif, Faktur Penjualan memungut PPN (Cr PPN Keluaran) dan Faktur Pembelian mencatat PPN Masukan. Non-PKP: faktur selalu tanpa PPN.</span>
          </span>
        </label>

        <PilihAkunPajak nama="akunPpnKeluaranId" label="Akun PPN Keluaran (kewajiban)" nilai={nilai.akunPpnKeluaranId} daftar={kewajiban} petunjuk="Dikredit saat Faktur Penjualan, didebit saat Retur Penjualan" />
        <PilihAkunPajak nama="akunPpnMasukanId" label="Akun PPN Masukan (aset)" nilai={nilai.akunPpnMasukanId} daftar={aset} petunjuk="Didebit saat Faktur Pembelian, dikredit saat Retur Pembelian" />
        <PilihAkunPajak nama="akunPph23DimukaId" label="Akun PPh 23 dibayar dimuka (aset)" nilai={nilai.akunPph23DimukaId} daftar={aset} petunjuk="PPh 23 yang dipotong klien saat membayar kita (isian di Penerimaan)" />
        <PilihAkunPajak nama="akunPph23DipotongId" label="Akun Hutang PPh 23 (kewajiban)" nilai={nilai.akunPph23DipotongId} daftar={kewajiban} petunjuk="PPh 23 yang kita potong saat membayar vendor (isian di Pembayaran)" />

        <div className="bidang">
          <label className="label" htmlFor="pphFinalPersen">Tarif PPh Final UMKM (% dari omzet)</label>
          <input id="pphFinalPersen" name="pphFinalPersen" type="number" min={0} max={100} step="0.01" defaultValue={nilai.pphFinalPersen} className="isian" />
          <span className="petunjuk">PP 55/2022: 0,5% dari peredaran bruto bulanan; dihitung & dijurnal dari Buku Besar › Pajak & SPT</span>
        </div>
        <div className="bidang md:col-span-1" />
        <PilihAkunPajak nama="akunBebanPphFinalId" label="Akun Beban PPh Final (beban)" nilai={nilai.akunBebanPphFinalId} daftar={beban} petunjuk="Didebit saat PPh Final bulanan dicatat" />
        <PilihAkunPajak nama="akunHutangPphFinalId" label="Akun Hutang PPh Final (kewajiban)" nilai={nilai.akunHutangPphFinalId} daftar={kewajiban} petunjuk="Dikredit saat PPh Final dicatat; dilunasi lewat Kas Keluar saat setor ke DJP" />
      </Kelompok>

      <div className="bidang md:col-span-2 border-t border-slate-100 pt-4">
        <label className="label" htmlFor="catatan">Catatan</label>
        <textarea id="catatan" name="catatan" maxLength={1000} rows={3} defaultValue={nilai.catatan ?? ""} className="isian" />
      </div>

      <div className="md:col-span-2">
        <button type="submit" className="tombol tombol-utama">
          {tombol}
        </button>
      </div>
    </FormulirAksi>
  );
}
