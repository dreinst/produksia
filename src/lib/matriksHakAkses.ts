import type { PeranPengguna } from "@/prisma-klien/enums";
import { DOKUMEN_HAK, HAK_LAIN, HAK_TERTINGGI_SAJA, LABEL_HAK_LAIN, PERAN_DAPAT_DIATUR, type AksiDokumen, type Hak, type KodeDokumen, type ModulDokumen } from "@/lib/hakAkses";

/*
 * Matriks Pengaturan › Hak Akses, tanpa basis data (dipakai halaman, aksi simpan, dan uji).
 * Aturan pokok: kotak yang dirender untuk sebuah peran sama dengan kotak yang diproses saat simpan
 * (kotakMatriks), dan peran yang tidak dirender di formulir tidak disentuh (bacaMatriksFormulir).
 */

export const LABEL_MODUL: Record<ModulDokumen, string> = {
  penjualan: "Penjualan",
  pembelian: "Pembelian",
  "kas-bank": "Kas & Bank",
  "buku-besar": "Buku Besar",
  persediaan: "Persediaan",
  "aset-tetap": "Aset Tetap",
  sdm: "SDM",
  crm: "CRM",
  pemasaran: "Pemasaran",
  proyek: "Keuangan Proyek",
  berkas: "Berkas",
};

export const AKSI_MATRIKS: readonly AksiDokumen[] = ["lihat", "buat", "ubah", "setujui", "hapus"];
export const SINGKATAN_AKSI: Record<AksiDokumen, string> = { lihat: "L", buat: "B", ubah: "U", setujui: "S", hapus: "H" };

export type SelMatriks = { aksi: AksiDokumen; hak: Hak; terkunci: boolean };
export type BarisDokumenMatriks = { kode: KodeDokumen; label: string; sel: SelMatriks[] };
export type KelompokMatriks = { modul: ModulDokumen; label: string; dokumen: BarisDokumenMatriks[] };

const terkunci = (hak: Hak) => HAK_TERTINGGI_SAJA.includes(hak);

/** Baris dokumen dikelompokkan per modul (urutan kemunculan modul di DOKUMEN_HAK); sel hanya untuk aksi yang dimiliki dokumen, urut AKSI_MATRIKS. */
export function barisMatriks(): KelompokMatriks[] {
  const daftarModul = [...new Set(DOKUMEN_HAK.map((d) => d.modul as ModulDokumen))];
  return daftarModul.map((modul) => ({
    modul,
    label: LABEL_MODUL[modul],
    dokumen: DOKUMEN_HAK.filter((d) => d.modul === modul).map((d) => ({
      kode: d.kode,
      label: d.label,
      sel: AKSI_MATRIKS.filter((a) => (d.aksi as readonly string[]).includes(a)).map((aksi) => {
        const hak = `${d.kode}.${aksi}` as Hak;
        return { aksi, hak, terkunci: terkunci(hak) };
      }),
    })),
  }));
}

/** HAK_LAIN tanpa hak-akses.kelola, dengan penanda terkunci untuk HAK_TERTINGGI_SAJA. */
export function barisHakLain(): { hak: Hak; label: string; terkunci: boolean }[] {
  return HAK_LAIN.filter((h) => h !== "hak-akses.kelola").map((h) => ({ hak: h, label: LABEL_HAK_LAIN[h], terkunci: terkunci(h) }));
}

/** Semua kotak yang dirender untuk setiap peran = semua sel di atas yang tidak terkunci. */
export function kotakMatriks(): Hak[] {
  return [
    ...barisMatriks().flatMap((k) => k.dokumen.flatMap((d) => d.sel.filter((s) => !s.terkunci).map((s) => s.hak))),
    ...barisHakLain().filter((b) => !b.terkunci).map((b) => b.hak),
  ];
}

/**
 * Kotak tercentang (kunci "PERAN|hak" bernilai "on") dan peran yang boleh diproses: anggota PERAN_DAPAT_DIATUR
 * yang dikirim sebagai isian tersembunyi `peranDirender`, atau punya minimal satu kotak tercentang.
 * Kunci berawalan peran di luar PERAN_DAPAT_DIATUR (mis. PEMILIK|...) diabaikan.
 */
export function bacaMatriksFormulir(dataFormulir: FormData): { peranDiproses: PeranPengguna[]; tercentang: Set<string> } {
  const tercentang = new Set<string>();
  for (const [kunci, nilai] of dataFormulir.entries()) if (kunci.includes("|") && nilai === "on") tercentang.add(kunci);
  const dirender = new Set(dataFormulir.getAll("peranDirender").map(String));
  const peranBercentang = new Set([...tercentang].map((k) => k.slice(0, k.indexOf("|"))));
  const peranDiproses = PERAN_DAPAT_DIATUR.filter((p) => dirender.has(p) || peranBercentang.has(p));
  return { peranDiproses, tercentang };
}
