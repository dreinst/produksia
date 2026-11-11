"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { wajibHakAksi, wajibMasukAksi } from "@/lib/otentikasi";
import { punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { jalankanFormulir, jalankanFormulirHasil, type StatusFormulir } from "@/lib/statusFormulir";
import { catatAktivitas } from "@/lib/log";
import {
  PESAN_BERKAS_TIDAK_ADA,
  ambilBerkasTerlihat,
  bacaNamaFolder,
  bersihkanNamaBerkas,
  bolehAksesBerkas,
  buangSatuBerkas,
  buatTautanBagiBerkas,
  catatLogBerkas,
  ekstensiNama,
  jenisLampiran,
  kodeFolderDariNama,
  kodeFolderUnik,
  rapikanPeranBoleh,
  ruangTersembunyi,
  type MetaBerkas,
} from "@/lib/berkas";

/*
 * Aksi berkas (D7 §6.3). Unggah tidak lewat aksi server (badan sampai 25 MB, aksi dibatasi 3 MB), tetapi lewat
 * POST /api/berkas. Pernyataan pertama tiap aksi: wajibMasukAksi (hak dinilai per berkas sesudahnya) atau
 * wajibHakAksi("berkas.akses-penuh").
 */

const teks = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const idTersimpan = (pengguna: PenggunaSesi) => (pengguna.id === "skrip-uji" ? null : pengguna.id);

function revalidasiBerkas(b?: Pick<MetaBerkas, "jenisEntitas" | "entitasId"> | null) {
  revalidatePath("/berkas");
  const j = jenisLampiran(b?.jenisEntitas);
  if (j && b?.entitasId) revalidatePath(j.tautan(b.entitasId).split("?")[0]);
}

function revalidasiPengaturan() {
  revalidatePath("/berkas");
  revalidatePath("/pengaturan/berkas");
}

/** Berkas aktif yang terlihat dan boleh dikenai aksi; selain itu galat dengan pesan yang tidak membocorkan keberadaan. */
async function berkasUntukAksi(pengguna: PenggunaSesi, id: string, aksi: "ubah" | "hapus" | "bagikan", pesanTanpaHak: string, opsi: { sampah?: boolean } = {}): Promise<MetaBerkas> {
  const b = await ambilBerkasTerlihat(db, pengguna, id, opsi);
  if (!b) throw new Error(opsi.sampah ? "Berkas tidak ditemukan di Sampah" : PESAN_BERKAS_TIDAK_ADA);
  if (!bolehAksesBerkas(pengguna, b, aksi)) throw new Error(pesanTanpaHak);
  return b;
}

// ---------- Ganti nama dan pindah (D7 §3.3.11) ----------

export async function ubahBerkas(id: string, dataFormulir: FormData) {
  const pengguna = await wajibMasukAksi();
  const b = await berkasUntukAksi(pengguna, id, "ubah", "Anda tidak punya hak mengubah berkas ini");
  const ruang = await ruangTersembunyi(db, pengguna);

  const namaMasukan = teks(dataFormulir, "namaBerkas");
  const namaBerkas = namaMasukan ? bersihkanNamaBerkas(namaMasukan, ekstensiNama(b.namaBerkas) || "bin") : b.namaBerkas;

  const folderMasukan = teks(dataFormulir, "folderKode");
  const folderKode = folderMasukan || b.folderKode;
  if (folderKode !== b.folderKode) {
    if (!(await db.folderBerkas.findUnique({ where: { kode: folderKode }, select: { kode: true } }))) throw new Error("Folder tidak dikenal");
    if (ruang?.folder.includes(folderKode)) throw new Error("Anda tidak punya akses ke folder itu");
  }

  let proyekId = b.proyekId;
  if (dataFormulir.has("proyekId")) {
    const masukan = teks(dataFormulir, "proyekId") || null;
    const j = jenisLampiran(b.jenisEntitas);
    if (j) {
      if (masukan !== b.proyekId) throw new Error(`Proyek lampiran mengikuti ${j.label}; ubah proyeknya di sana`);
    } else if (masukan !== b.proyekId) {
      if (masukan) {
        const p = await db.proyek.findUnique({ where: { id: masukan }, select: { perusahaanId: true } });
        if (!p || p.perusahaanId !== b.perusahaanId) throw new Error("Proyek tidak ditemukan");
        if (ruang?.proyek.includes(masukan)) throw new Error("Anda tidak punya akses ke proyek itu");
      }
      proyekId = masukan;
    }
  }

  if (namaBerkas === b.namaBerkas && folderKode === b.folderKode && proyekId === b.proyekId) return;
  await db.$transaction(async (tx) => {
    const baru = await tx.berkas.update({ where: { id: b.id }, data: { namaBerkas, folderKode, proyekId }, select: { id: true, namaBerkas: true, folderKode: true, proyekId: true, perusahaanId: true } });
    await catatLogBerkas(tx, pengguna, baru, "UBAH", { meta: { namaLama: b.namaBerkas, folderLama: b.folderKode, proyekLama: b.proyekId } });
  });
  revalidasiBerkas(b);
}

// ---------- Buang, pulihkan, hapus permanen (D7 §3.3.12) ----------

export async function buangBerkas(id: string) {
  const pengguna = await wajibMasukAksi();
  const b = await berkasUntukAksi(pengguna, id, "hapus", "Anda tidak punya hak membuang berkas ini");
  await db.$transaction((tx) => buangSatuBerkas(tx, b.id, pengguna));
  revalidasiBerkas(b);
}

export async function pulihkanBerkas(id: string) {
  const pengguna = await wajibMasukAksi();
  const b = await berkasUntukAksi(pengguna, id, "hapus", "Anda tidak punya hak memulihkan berkas ini", { sampah: true });
  await db.$transaction(async (tx) => {
    // tautan yang sudah dicabut saat dibuang tidak dihidupkan lagi
    const r = await tx.berkas.updateMany({ where: { id: b.id, dihapusPada: { not: null }, isiDihapusPada: null }, data: { dihapusPada: null, dihapusOlehId: null, dihapusOlehNama: null } });
    if (r.count === 0) throw new Error("Berkas tidak ditemukan di Sampah");
    await catatLogBerkas(tx, pengguna, b, "PULIHKAN");
  });
  revalidasiBerkas(b);
}

export async function hapusPermanenBerkas(id: string) {
  const pengguna = await wajibHakAksi("berkas.akses-penuh");
  const b = await db.berkas.findUnique({ where: { id }, select: { id: true, namaBerkas: true, folderKode: true, proyekId: true, perusahaanId: true, ukuran: true, dihapusPada: true, isiDihapusPada: true } });
  if (!b || b.isiDihapusPada) throw new Error(PESAN_BERKAS_TIDAK_ADA);
  if (!b.dihapusPada) throw new Error("Buang berkas ke Sampah dulu sebelum menghapus permanen");
  await db.$transaction(async (tx) => {
    await tx.isiBerkas.deleteMany({ where: { berkasId: b.id } });
    await tx.tautanBagiBerkas.deleteMany({ where: { berkasId: b.id } });
    await tx.berkas.update({ where: { id: b.id }, data: { isiDihapusPada: new Date() } });
    await catatLogBerkas(tx, pengguna, b, "HAPUS_PERMANEN", { meta: { ukuran: b.ukuran } });
  });
  revalidatePath("/berkas");
}

// ---------- Tautan bagi publik (D7 §3.3.13) ----------

/** Asal situs untuk tautan lengkap; kosong di luar permintaan HTTP (skrip uji). */
async function asalSitus(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (!host) return "";
    const proto = (h.get("x-forwarded-proto") ?? "http").split(",")[0].trim();
    return `${proto}://${host.split(",")[0].trim()}`;
  } catch {
    return "";
  }
}

export async function buatTautanBagi(id: string, dataFormulir: FormData): Promise<{ tautan: string; kedaluwarsa: Date }> {
  const pengguna = await wajibMasukAksi();
  const { token, kedaluwarsa } = await buatTautanBagiBerkas(db, pengguna, id, teks(dataFormulir, "masaBerlaku"));
  revalidatePath("/berkas");
  return { tautan: `${await asalSitus()}/b/${token}`, kedaluwarsa };
}

export async function cabutTautanBagi(tautanId: string) {
  const pengguna = await wajibMasukAksi();
  const t = await db.tautanBagiBerkas.findUnique({ where: { id: tautanId }, select: { id: true, berkasId: true, dibuatOlehId: true, dicabutPada: true } });
  if (!t) throw new Error("Tautan tidak ditemukan");
  const pembuat = !!t.dibuatOlehId && t.dibuatOlehId === idTersimpan(pengguna);
  let boleh = pembuat || punyaHak(pengguna, "berkas.akses-penuh");
  if (!boleh) {
    const b = await ambilBerkasTerlihat(db, pengguna, t.berkasId);
    boleh = !!b && bolehAksesBerkas(pengguna, b, "hapus");
  }
  if (!boleh) throw new Error("Anda tidak punya hak mencabut tautan ini");
  if (t.dicabutPada) return;
  const b = await db.berkas.findUniqueOrThrow({ where: { id: t.berkasId }, select: { id: true, namaBerkas: true, folderKode: true, proyekId: true, perusahaanId: true } });
  await db.$transaction(async (tx) => {
    await tx.tautanBagiBerkas.updateMany({ where: { id: t.id, dicabutPada: null }, data: { dicabutPada: new Date(), dicabutOlehId: idTersimpan(pengguna) } });
    await catatLogBerkas(tx, pengguna, b, "CABUT", { meta: { tautanId: t.id } });
  });
  revalidatePath("/berkas");
}

// ---------- Akses folder per peran (D7 §3.3.6) ----------

export async function simpanAksesFolder(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("berkas.akses-penuh");
  const kodeDirender = [...new Set(dataFormulir.getAll("folderDirender").map((v) => String(v).trim()).filter(Boolean))];
  if (kodeDirender.length === 0) return;
  const folder = await db.folderBerkas.findMany({ where: { kode: { in: kodeDirender } }, select: { kode: true, terbatas: true, peranBoleh: true } });
  const peta = new Map(folder.map((f) => [f.kode, f]));
  const perubahan = kodeDirender.map((kode) => {
    const lama = peta.get(kode);
    if (!lama) throw new Error(`Folder tidak dikenal: ${kode}`);
    const terbatas = dataFormulir.get(`terbatas|${kode}`) === "on";
    const peranBoleh = rapikanPeranBoleh(dataFormulir.getAll(`peran|${kode}`));
    const berubah = terbatas !== lama.terbatas || peranBoleh.join(",") !== [...lama.peranBoleh].join(",");
    return { kode, terbatas, peranBoleh, berubah };
  });
  await db.$transaction(async (tx) => {
    for (const p of perubahan.filter((x) => x.berubah)) {
      await tx.folderBerkas.update({ where: { kode: p.kode }, data: { terbatas: p.terbatas, peranBoleh: p.peranBoleh } });
      await catatAktivitas(tx, pengguna, {
        aksi: "UBAH",
        jenis: "Akses Folder Berkas",
        nomor: p.kode,
        keterangan: p.terbatas ? `Terbatas untuk ${p.peranBoleh.length ? p.peranBoleh.join(", ") : "akses penuh saja"}` : "Terbuka",
        modul: "berkas",
        meta: { folder: p.kode, proyekId: null, terbatas: p.terbatas, peranBoleh: p.peranBoleh },
      });
    }
  });
  revalidasiPengaturan();
}

// ---------- Folder buatan (D7 §3.3.17) ----------

async function pastikanNamaFolderUnik(nama: string, kecuali?: string) {
  const sama = await db.folderBerkas.findFirst({ where: { nama: { equals: nama, mode: "insensitive" }, ...(kecuali ? { kode: { not: kecuali } } : {}) }, select: { kode: true } });
  if (sama) throw new Error(`Folder ${nama} sudah ada`);
}

export async function buatFolderBerkas(dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("berkas.akses-penuh");
  const nama = bacaNamaFolder(dataFormulir.get("nama"));
  await pastikanNamaFolderUnik(nama);
  const semua = await db.folderBerkas.findMany({ select: { kode: true, urutan: true } });
  const kode = kodeFolderUnik(kodeFolderDariNama(nama), new Set(semua.map((f) => f.kode)));
  const urutan = Math.max(0, ...semua.map((f) => f.urutan)) + 1;
  await db.$transaction(async (tx) => {
    await tx.folderBerkas.create({ data: { kode, nama, urutan, sistem: false } });
    await catatAktivitas(tx, pengguna, { aksi: "BUAT", jenis: "Folder Berkas", nomor: kode, keterangan: nama, modul: "berkas", meta: { folder: kode, proyekId: null } });
  });
  revalidasiPengaturan();
}

export async function ubahFolderBerkas(kode: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("berkas.akses-penuh");
  const folder = await db.folderBerkas.findUnique({ where: { kode }, select: { kode: true, nama: true } });
  if (!folder) throw new Error("Folder tidak dikenal");
  const nama = bacaNamaFolder(dataFormulir.get("nama"));
  if (nama === folder.nama) return;
  await pastikanNamaFolderUnik(nama, kode);
  await db.$transaction(async (tx) => {
    await tx.folderBerkas.update({ where: { kode }, data: { nama } });
    await catatAktivitas(tx, pengguna, { aksi: "UBAH", jenis: "Folder Berkas", nomor: kode, keterangan: `${folder.nama} menjadi ${nama}`, modul: "berkas", meta: { folder: kode, proyekId: null, namaLama: folder.nama } });
  });
  revalidasiPengaturan();
}

export async function hapusFolderBerkas(kode: string) {
  const pengguna = await wajibHakAksi("berkas.akses-penuh");
  const folder = await db.folderBerkas.findUnique({ where: { kode }, select: { kode: true, nama: true, sistem: true } });
  if (!folder) throw new Error("Folder tidak dikenal");
  if (folder.sistem) throw new Error("Folder sistem tidak bisa dihapus");
  const isi = await db.berkas.count({ where: { folderKode: kode } });
  if (isi > 0) throw new Error(`Folder masih berisi ${isi} berkas; pindahkan atau hapus permanen dulu`);
  await db.$transaction(async (tx) => {
    await tx.folderBerkas.delete({ where: { kode } });
    await catatAktivitas(tx, pengguna, { aksi: "HAPUS", jenis: "Folder Berkas", nomor: kode, keterangan: folder.nama, modul: "berkas", meta: { folder: kode, proyekId: null } });
  });
  revalidasiPengaturan();
}

// ---------- Akses berkas per proyek (D7 §3.3.7) ----------

export async function simpanAksesBerkasProyek(proyekId: string, dataFormulir: FormData) {
  const pengguna = await wajibHakAksi("berkas.akses-penuh");
  const proyek = await db.proyek.findUnique({ where: { id: proyekId }, select: { id: true, kode: true, perusahaanId: true } });
  if (!proyek) throw new Error("Proyek tidak ditemukan");
  const peranBoleh = rapikanPeranBoleh(dataFormulir.getAll("peran"));
  const penggunaIds = [...new Set(dataFormulir.getAll("pengguna").map((v) => String(v).trim()).filter(Boolean))];
  if (penggunaIds.length) {
    const ada = await db.pengguna.count({ where: { id: { in: penggunaIds }, aktif: true } });
    if (ada !== penggunaIds.length) throw new Error("Pengguna terpilih tidak ditemukan atau nonaktif");
  }
  await db.$transaction(async (tx) => {
    await tx.aksesBerkasProyek.upsert({
      where: { proyekId },
      create: { proyekId, peranBoleh, diubahOlehId: idTersimpan(pengguna) },
      update: { peranBoleh, diubahOlehId: idTersimpan(pengguna) },
    });
    await tx.aksesBerkasProyekPengguna.deleteMany({ where: { proyekId } });
    if (penggunaIds.length) await tx.aksesBerkasProyekPengguna.createMany({ data: penggunaIds.map((penggunaId) => ({ proyekId, penggunaId })) });
    await catatAktivitas(tx, pengguna, {
      aksi: "UBAH",
      jenis: "Akses Berkas Proyek",
      nomor: proyek.kode,
      keterangan: peranBoleh.length || penggunaIds.length ? `Terbatas untuk ${[...peranBoleh, `${penggunaIds.length} pengguna`].join(", ")}` : "Terbatas untuk akses penuh saja",
      modul: "berkas",
      perusahaanId: proyek.perusahaanId,
      meta: { folder: null, proyekId, terbatas: true, peranBoleh, jumlahPengguna: penggunaIds.length },
    });
  });
  revalidasiPengaturan();
}

export async function bukaPembatasanProyek(proyekId: string) {
  const pengguna = await wajibHakAksi("berkas.akses-penuh");
  const proyek = await db.proyek.findUnique({ where: { id: proyekId }, select: { id: true, kode: true, perusahaanId: true } });
  if (!proyek) throw new Error("Proyek tidak ditemukan");
  await db.$transaction(async (tx) => {
    const r = await tx.aksesBerkasProyek.deleteMany({ where: { proyekId } });
    if (r.count === 0) return;
    await catatAktivitas(tx, pengguna, {
      aksi: "UBAH",
      jenis: "Akses Berkas Proyek",
      nomor: proyek.kode,
      keterangan: "Pembatasan dibuka",
      modul: "berkas",
      perusahaanId: proyek.perusahaanId,
      meta: { folder: null, proyekId, terbatas: false },
    });
  });
  revalidasiPengaturan();
}

// ---------- Versi formulir (useActionState) ----------

export async function ubahBerkasFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahBerkas(id, dataFormulir));
}
export async function buangBerkasFormulir(id: string) {
  return jalankanFormulir(() => buangBerkas(id));
}
export async function pulihkanBerkasFormulir(id: string) {
  return jalankanFormulir(() => pulihkanBerkas(id));
}
export async function hapusPermanenBerkasFormulir(id: string) {
  return jalankanFormulir(() => hapusPermanenBerkas(id));
}
export async function buatTautanBagiFormulir(id: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulirHasil(() => buatTautanBagi(id, dataFormulir));
}
export async function cabutTautanBagiFormulir(tautanId: string) {
  return jalankanFormulir(() => cabutTautanBagi(tautanId));
}
export async function simpanAksesFolderFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => simpanAksesFolder(dataFormulir));
}
export async function buatFolderBerkasFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatFolderBerkas(dataFormulir));
}
export async function ubahFolderBerkasFormulir(kode: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => ubahFolderBerkas(kode, dataFormulir));
}
export async function hapusFolderBerkasFormulir(kode: string) {
  return jalankanFormulir(() => hapusFolderBerkas(kode));
}
export async function simpanAksesBerkasProyekFormulir(proyekId: string, _sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => simpanAksesBerkasProyek(proyekId, dataFormulir));
}
export async function bukaPembatasanProyekFormulir(proyekId: string) {
  return jalankanFormulir(() => bukaPembatasanProyek(proyekId));
}
