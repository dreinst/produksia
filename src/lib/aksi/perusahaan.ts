"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { sesiSaatIni, wajibHakAksi, wajibMasukAksi } from "@/lib/otentikasi";
import { PERUSAHAAN_UTAMA, aturPerusahaanAktif, simpanLingkupSesi } from "@/lib/perusahaan";
import { ambilPengaturanPerusahaan, idPengaturan } from "@/lib/pengaturanPerusahaan";
import { pastikanAkunRinci } from "@/lib/baganAkun";
import { catatAktivitas } from "@/lib/log";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { bacaUang, type Desimal } from "@/lib/uang";
import type { JenisPerusahaan } from "@/prisma-klien/enums";

/*
 * Aksi multi perusahaan (D1 §6.1): ganti lingkup, buat perusahaan, dan ubah perusahaan beserta pengaturan pajaknya.
 * Tidak ada hapus fisik: perusahaan diarsipkan lewat ubahPerusahaan (aktif mati). Bila baris Perusahaan yang punya
 * data dihapus langsung, PostgreSQL menolaknya dengan SQLSTATE 23001 dan jalankanFormulir menampilkan pesan "Data ini
 * masih dipakai ..." (statusFormulir.ts). Transaksi antar perusahaan menyusul di paket domainnya.
 */

/**
 * Mengganti lingkup perusahaan sesi ini. Isian "perusahaanId" = id perusahaan atau "semua" (gabungan).
 * Ganti lingkup bukan hak tersendiri: setiap pengguna yang masuk boleh, tapi "semua" butuh
 * perusahaan-gabungan.lihat. Tanpa log karena tidak mengubah data.
 */
export async function gantiPerusahaanAktif(dataFormulir: FormData) {
  const pengguna = await wajibMasukAksi();
  const pilihan = String(dataFormulir.get("perusahaanId") ?? "");
  const sesi = await sesiSaatIni();
  if (!sesi) throw new Error("Lingkup perusahaan hanya bisa diganti dari peramban yang sedang masuk");
  await simpanLingkupSesi(db, sesi.id, pilihan, pengguna);
  revalidatePath("/", "layout");
}

export async function gantiPerusahaanAktifFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => gantiPerusahaanAktif(dataFormulir));
}

/**
 * Tombol "Jadikan lingkup aktif" di hasil pencarian Perusahaan (D7 §3.6, P46): lingkup sesi diganti lewat
 * aturPerusahaanAktif (perusahaan harus ada dan aktif), lalu semua halaman dimuat ulang dengan lingkup baru.
 */
export async function jadikanLingkupAktif(perusahaanId: string) {
  await wajibMasukAksi();
  if (!(await aturPerusahaanAktif(perusahaanId))) throw new Error("Lingkup perusahaan hanya bisa diganti dari peramban yang sedang masuk");
  revalidatePath("/", "layout");
}

export async function jadikanLingkupAktifFormulir(perusahaanId: string): Promise<StatusFormulir> {
  return jalankanFormulir(() => jadikanLingkupAktif(perusahaanId));
}

// ---------- Buat dan ubah perusahaan (D1 §3.6, §3.7) ----------

const JENIS_PERUSAHAAN: readonly JenisPerusahaan[] = ["AGENSI", "MEREK", "KLIEN"];
const LABEL_JENIS: Record<JenisPerusahaan, string> = { AGENSI: "Agensi", MEREK: "Merek", KLIEN: "Klien" };

const KOLOM_AKUN_PAJAK = ["akunPpnKeluaranId", "akunPpnMasukanId", "akunPph23DimukaId", "akunPph23DipotongId", "akunBebanPphFinalId", "akunHutangPphFinalId"] as const;
type KolomAkunPajak = (typeof KOLOM_AKUN_PAJAK)[number];
type AkunPajak = Record<KolomAkunPajak, string | null>;
const LABEL_AKUN_PAJAK: Record<KolomAkunPajak, string> = {
  akunPpnKeluaranId: "akun PPN Keluaran",
  akunPpnMasukanId: "akun PPN Masukan",
  akunPph23DimukaId: "akun PPh 23 dibayar dimuka",
  akunPph23DipotongId: "akun Hutang PPh 23",
  akunBebanPphFinalId: "akun Beban PPh Final",
  akunHutangPphFinalId: "akun Hutang PPh Final",
};

/** Isian teks opsional dan batas panjangnya (D1 §3.7). */
const TEKS_OPSIONAL = {
  namaLegal: { label: "Nama legal", maks: 200 },
  industri: { label: "Industri", maks: 200 },
  alamat: { label: "Alamat", maks: 1000 },
  kota: { label: "Kota", maks: 200 },
  telepon: { label: "Telepon", maks: 40 },
  website: { label: "Website", maks: 200 },
  instagram: { label: "Instagram", maks: 200 },
  infoPajak: { label: "Info pajak", maks: 1000 },
  namaBank: { label: "Nama bank", maks: 200 },
  cabangBank: { label: "Cabang bank", maks: 200 },
  nomorRekening: { label: "Nomor rekening", maks: 40 },
  atasNamaRekening: { label: "Atas nama rekening", maks: 200 },
  penandaTangan: { label: "Penanda tangan", maks: 200 },
  jabatanPenandaTangan: { label: "Jabatan penanda tangan", maks: 200 },
  catatan: { label: "Catatan", maks: 1000 },
} as const;
type KolomTeks = keyof typeof TEKS_OPSIONAL;

type Identitas = Record<KolomTeks, string | null> & {
  kode: string;
  nama: string;
  jenis: JenisPerusahaan;
  email: string | null;
  npwp: string | null;
  warna: string | null;
  urutan: number;
  aktif: boolean;
};
type Pajak = { pkp: boolean; tarifPpnPersen: Desimal; terminHari: number; pphFinalPersen: Desimal; akun: AkunPajak };

function bacaIdentitas(dataFormulir: FormData): Identitas {
  const teks = (k: string) => String(dataFormulir.get(k) ?? "").trim();
  const kode = teks("kode").toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(kode)) throw new Error("Kode perusahaan 2-12 huruf besar atau angka");
  const nama = teks("nama");
  if (!nama || nama.length > 120) throw new Error("Nama perusahaan wajib diisi (maks. 120 karakter)");
  const opsional = {} as Record<KolomTeks, string | null>;
  for (const [k, { label, maks }] of Object.entries(TEKS_OPSIONAL) as [KolomTeks, { label: string; maks: number }][]) {
    const v = teks(k);
    if (v.length > maks) throw new Error(`${label} maks. ${maks} karakter`);
    opsional[k] = v || null;
  }
  const email = teks("email") || null;
  if (email && (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error("Email perusahaan tidak valid");
  const npwp = teks("npwp") || null;
  // disimpan seperti diketik; yang diperiksa hanya jumlah digitnya
  if (npwp && (npwp.length > 40 || ![15, 16].includes(npwp.replace(/\D/g, "").length))) throw new Error("NPWP harus 15 atau 16 digit");
  const warna = teks("warna") || null;
  if (warna && !/^#[0-9A-Fa-f]{6}$/.test(warna)) throw new Error("Warna harus kode heksa #RRGGBB");
  const jenis = teks("jenis") || "AGENSI";
  if (!(JENIS_PERUSAHAAN as readonly string[]).includes(jenis)) throw new Error("Jenis perusahaan harus Agensi, Merek, atau Klien");
  const urutanMentah = teks("urutan");
  const urutan = urutanMentah === "" ? 0 : Number(urutanMentah);
  if (!Number.isInteger(urutan) || urutan < 0 || urutan > 999) throw new Error("Urutan harus bilangan bulat 0 sampai 999");
  return { ...opsional, kode, nama, jenis: jenis as JenisPerusahaan, email, npwp, warna, urutan, aktif: dataFormulir.get("aktif") === "on" };
}

/** Isian pajak dengan validasi yang sama dengan simpan pengaturan perusahaan lama (D1 §3.6). */
function bacaPajak(dataFormulir: FormData): Pajak {
  const teks = (k: string) => String(dataFormulir.get(k) ?? "").trim();
  const pkp = dataFormulir.get("pkp") === "on";
  const tarifPpnPersen = bacaUang(dataFormulir.get("tarifPpnPersen"), "Tarif PPN", { allowZero: true });
  if (tarifPpnPersen.gt(100)) throw new Error("Tarif PPN maksimal 100%");
  const terminHari = Number(teks("terminHari") || "14");
  if (!Number.isInteger(terminHari) || terminHari < 0 || terminHari > 365) throw new Error("Termin jatuh tempo harus 0 sampai 365 hari");
  const pphFinalPersen = bacaUang(dataFormulir.get("pphFinalPersen") ?? "0.5", "Tarif PPh Final", { allowZero: true });
  if (pphFinalPersen.gt(100)) throw new Error("Tarif PPh Final maksimal 100%");
  const akun = Object.fromEntries(KOLOM_AKUN_PAJAK.map((k) => [k, teks(k) || null])) as AkunPajak;
  return { pkp, tarifPpnPersen, terminHari, pphFinalPersen, akun };
}

function pastikanAkunPkp(pajak: Pajak) {
  if (pajak.pkp && (!pajak.akun.akunPpnKeluaranId || !pajak.akun.akunPpnMasukanId)) {
    throw new Error("Status PKP membutuhkan akun PPN Keluaran dan PPN Masukan");
  }
}

/**
 * Akun pajak harus ada, rinci, dan milik perusahaan itu atau bersama (KONTRAK-TAMBAHAN P19, PERBAIKAN-P13).
 * `perusahaanId` null = perusahaan yang baru dibuat, jadi hanya akun bersama yang boleh. Baris "default" (utama)
 * juga dipakai perusahaan lain yang belum punya baris pengaturan sendiri, jadi akun milik utama hanya boleh bila
 * semua perusahaan lain sudah punya pengaturan pajak sendiri (pasangan aturan ganti pemilik akun di dataInduk.ts).
 */
async function pastikanAkunPajakSah(akun: AkunPajak, perusahaanId: string | null): Promise<void> {
  const ids = [...new Set(Object.values(akun).filter((v): v is string => Boolean(v)))];
  if (ids.length === 0) return;
  const daftar = await db.akun.findMany({ where: { id: { in: ids } }, select: { id: true, kode: true, nama: true, perusahaanId: true }, orderBy: { kode: "asc" } });
  if (daftar.length !== ids.length) throw new Error("Akun pajak tidak ditemukan. Muat ulang halaman lalu pilih lagi.");
  await pastikanAkunRinci(db, ids);
  const lain = daftar.find((a) => a.perusahaanId !== null && a.perusahaanId !== perusahaanId);
  if (lain) {
    const peta = new Map((await db.perusahaan.findMany({ where: { id: { in: [lain.perusahaanId!, perusahaanId ?? ""] } }, select: { id: true, nama: true } })).map((p) => [p.id, p.nama]));
    const tujuan = perusahaanId ? `di pengaturan pajak ${peta.get(perusahaanId) ?? perusahaanId}` : "untuk perusahaan baru; pilih akun bersama";
    throw new Error(`Akun ${lain.kode} ${lain.nama} milik ${peta.get(lain.perusahaanId!) ?? lain.perusahaanId}, tidak bisa dipakai ${tujuan}`);
  }
  if (perusahaanId !== PERUSAHAAN_UTAMA) return;
  const milikUtama = daftar.find((a) => a.perusahaanId === PERUSAHAAN_UTAMA);
  if (!milikUtama) return;
  const tanpaPengaturan = await db.perusahaan.findMany({ where: { id: { not: PERUSAHAAN_UTAMA }, pengaturan: { is: null } }, select: { kode: true }, orderBy: [{ urutan: "asc" }, { kode: "asc" }] });
  if (tanpaPengaturan.length > 0) {
    throw new Error(
      `Akun ${milikUtama.kode} ${milikUtama.nama} milik perusahaan utama belum bisa menjadi akun pajak utama: ${tanpaPengaturan.map((p) => p.kode).join(", ")} belum punya pengaturan pajak sendiri dan masih memakai akun pajak utama. Simpan dulu pengaturan pajak perusahaan itu, atau pilih akun bersama.`,
    );
  }
}

async function pastikanKodeUnik(kode: string, kecualiId: string | null): Promise<void> {
  const ada = await db.perusahaan.findFirst({ where: { kode, ...(kecualiId ? { NOT: { id: kecualiId } } : {}) }, select: { id: true } });
  if (ada) throw new Error(`Kode ${kode} sudah dipakai`);
}

/** Dua simpan bersamaan dengan kode yang sama: unik kode menolak dengan P2002, pesannya disamakan dengan pemeriksaan awal. */
async function terjemahkanKodeGanda<T>(kode: string, kecualiId: string | null, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") await pastikanKodeUnik(kode, kecualiId);
    throw e;
  }
}

function revalidasiPerusahaan(id?: string) {
  revalidatePath("/pengaturan/perusahaan");
  if (id) revalidatePath(`/pengaturan/perusahaan/${id}`);
  revalidatePath("/persetujuan");
  revalidatePath("/", "layout");
}

/**
 * Membuat perusahaan beserta baris PengaturanPerusahaan ber-id perusahaan (D1 §3.7). Akun pajak yang dikosongkan
 * disalin dari baris "default" bila akun itu bersama (akun milik utama tidak boleh dipakai perusahaan lain).
 * tahunBuku dan wajibPersetujuan tidak disalin karena global.
 */
export async function buatPerusahaan(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("pengaturan.tulis");
  const identitas = bacaIdentitas(dataFormulir);
  const pajak = bacaPajak(dataFormulir);
  await pastikanKodeUnik(identitas.kode, null);
  const kosong = KOLOM_AKUN_PAJAK.filter((k) => !pajak.akun[k]);
  if (kosong.length > 0) {
    const bawaan = await db.pengaturanPerusahaan.findUnique({ where: { id: "default" } });
    const calon = kosong.map((k) => bawaan?.[k]).filter((v): v is string => Boolean(v));
    const bersama = new Set((await db.akun.findMany({ where: { id: { in: calon }, perusahaanId: null, kelompok: false }, select: { id: true } })).map((a) => a.id));
    for (const k of kosong) {
      const salinan = bawaan?.[k];
      if (salinan && bersama.has(salinan)) pajak.akun[k] = salinan;
    }
  }
  pastikanAkunPkp(pajak);
  await pastikanAkunPajakSah(pajak.akun, null);

  const idBaru = await terjemahkanKodeGanda(identitas.kode, null, () =>
    db.$transaction(async (tx) => {
      const p = await tx.perusahaan.create({ data: identitas, select: { id: true } });
      await tx.pengaturanPerusahaan.create({
        data: { id: idPengaturan(p.id), perusahaanId: p.id, nama: identitas.nama, pkp: pajak.pkp, tarifPpnPersen: pajak.tarifPpnPersen, terminHari: pajak.terminHari, pphFinalPersen: pajak.pphFinalPersen, ...pajak.akun },
      });
      await catatAktivitas(tx, pengguna, {
        aksi: "BUAT",
        jenis: "Perusahaan",
        nomor: identitas.kode,
        keterangan: `Perusahaan ${identitas.nama} dibuat${identitas.aktif ? "" : " (diarsipkan)"}`,
        modul: "perusahaan",
        entitasId: p.id,
        meta: { perusahaanId: p.id },
        perusahaanId: p.id,
      });
      return p.id;
    }),
  );
  revalidasiPerusahaan();
  redirect(`/pengaturan/perusahaan/${idBaru}`);
}

export async function buatPerusahaanFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatPerusahaan(dataFormulir));
}

const tampil = (v: unknown) => (v === null || v === undefined || v === "" ? "-" : String(v));

/**
 * Mengubah identitas, rekening, penanda tangan, status, dan pengaturan pajak satu perusahaan (D1 §6.1). Pengaturan
 * ditulis lewat upsert berkunci idPengaturan, jadi utama selalu baris "default", dan nama ikut disalin ke sana
 * (kartu bilah samping lingkup utama membaca nama dari baris itu). Utama tidak bisa diarsipkan.
 */
export async function ubahPerusahaan(id: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("pengaturan.tulis");
  const lama = await db.perusahaan.findUnique({ where: { id } });
  if (!lama) throw new Error("Perusahaan tidak ditemukan");
  const identitas = bacaIdentitas(dataFormulir);
  if (id === PERUSAHAAN_UTAMA && !identitas.aktif) throw new Error("Perusahaan utama tidak bisa diarsipkan");
  const pajak = bacaPajak(dataFormulir);
  pastikanAkunPkp(pajak);
  await pastikanKodeUnik(identitas.kode, id);
  await pastikanAkunPajakSah(pajak.akun, id);

  // ringkasan perubahan untuk log, dibanding pengaturan efektif sebelum simpan (termasuk bawaan bila belum ada baris)
  const pajakLama = await ambilPengaturanPerusahaan(db, id);
  const akunDisebut = [...new Set(KOLOM_AKUN_PAJAK.flatMap((k) => [pajak.akun[k], pajakLama[k]]).filter((v): v is string => Boolean(v)))];
  const kodeAkun = new Map((await db.akun.findMany({ where: { id: { in: akunDisebut } }, select: { id: true, kode: true } })).map((a) => [a.id, a.kode]));
  const ubahan: string[] = [];
  const banding = (label: string, a: unknown, b: unknown) => {
    if (tampil(a) !== tampil(b)) ubahan.push(`${label} ${tampil(a)} → ${tampil(b)}`);
  };
  if (lama.aktif !== identitas.aktif) ubahan.push(identitas.aktif ? "diaktifkan" : "diarsipkan");
  banding("kode", lama.kode, identitas.kode);
  banding("nama", id === PERUSAHAAN_UTAMA ? pajakLama.nama : lama.nama, identitas.nama);
  banding("jenis", LABEL_JENIS[lama.jenis], LABEL_JENIS[identitas.jenis]);
  banding("email", lama.email, identitas.email);
  banding("NPWP", lama.npwp, identitas.npwp);
  banding("warna", lama.warna, identitas.warna);
  banding("urutan", lama.urutan, identitas.urutan);
  for (const k of Object.keys(TEKS_OPSIONAL) as KolomTeks[]) {
    if (tampil(lama[k]) === tampil(identitas[k])) continue;
    // teks panjang cukup disebut berubah
    if (TEKS_OPSIONAL[k].maks > 200) ubahan.push(`${TEKS_OPSIONAL[k].label.toLowerCase()} diubah`);
    else banding(TEKS_OPSIONAL[k].label.toLowerCase(), lama[k], identitas[k]);
  }
  banding("PKP:", pajakLama.pkp ? "Ya" : "Tidak", pajak.pkp ? "Ya" : "Tidak");
  banding("PPN %", pajakLama.tarifPpnPersen.toString(), pajak.tarifPpnPersen.toString());
  banding("termin", pajakLama.terminHari, pajak.terminHari);
  banding("PPh Final %", pajakLama.pphFinalPersen.toString(), pajak.pphFinalPersen.toString());
  for (const k of KOLOM_AKUN_PAJAK) {
    const a = pajakLama[k];
    const b = pajak.akun[k];
    banding(LABEL_AKUN_PAJAK[k], a ? (kodeAkun.get(a) ?? a) : null, b ? (kodeAkun.get(b) ?? b) : null);
  }

  const dataPajak = { nama: identitas.nama, pkp: pajak.pkp, tarifPpnPersen: pajak.tarifPpnPersen, terminHari: pajak.terminHari, pphFinalPersen: pajak.pphFinalPersen, ...pajak.akun };
  await terjemahkanKodeGanda(identitas.kode, id, () =>
    db.$transaction(async (tx) => {
      await tx.perusahaan.update({ where: { id }, data: identitas });
      await tx.pengaturanPerusahaan.upsert({
        where: { id: idPengaturan(id) },
        create: { id: idPengaturan(id), perusahaanId: id, ...dataPajak },
        update: dataPajak,
      });
      await catatAktivitas(tx, pengguna, {
        aksi: "UBAH",
        jenis: "Perusahaan",
        nomor: identitas.kode,
        keterangan: ubahan.length > 0 ? ubahan.join("; ") : "Disimpan tanpa perubahan",
        modul: "perusahaan",
        entitasId: id,
        meta: { perusahaanId: id },
        perusahaanId: id,
      });
    }),
  );
  revalidasiPerusahaan(id);
}

export async function ubahPerusahaanFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahPerusahaan(id, dataFormulir));
}
