import "dotenv/config";
// Skrip ini memanggil halaman dan aksi di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { db } from "../src/lib/db";
import { SUMBER_BAWAAN } from "../src/lib/crm";
import { SEKSI_BAWAAN } from "../src/lib/dokumenPenjualan";
import FormulirAksi from "../src/komponen/FormulirAksi";
import PesanSuksesHalaman from "../src/komponen/PesanSuksesHalaman";
import HalamanDaftarPilihan from "../src/app/(aplikasi)/pengaturan/daftar-pilihan/page";
import { pastikan } from "./bantuan";

/*
 * Daftar Pilihan (P44 e.12): editor tertanam Sumber lead dan Seksi baris dokumen. Editor memakai aksi dan hak halaman
 * asalnya, jadi uji ini memeriksa (1) halaman memasang editor hanya bagi yang berhak, (2) isian yang dikirim editor
 * lewat aksi yang terpasang di formulirnya mengubah data seperti halaman asal, (3) isian bawaan dokumen lainnya tidak
 * ikut terhapus saat menyimpan seksi, (4) hak ditegakkan oleh aksi, bukan hanya oleh tampilan.
 * Data uji: perusahaan UJDP, dibuat dan dihapus di sini. Penyesuaian hak ADMIN sementara di HakAksesPeran dikembalikan di finally.
 */

const ID = "ujdp-satu";
const KODE = "UJDP";

async function dengan<T>(isian: { peran: string }, fn: () => Promise<T>): Promise<T> {
  const lama = process.env.UJI_PERAN;
  process.env.UJI_PERAN = isian.peran;
  try {
    return await fn();
  } finally {
    if (lama === undefined) delete process.env.UJI_PERAN;
    else process.env.UJI_PERAN = lama;
  }
}

type Isian = { name: string; value: string; type: string };
type FormTelusur = { aksi: (s: unknown, fd: FormData) => Promise<{ galat: string | null }>; pesanKonfirmasi?: string; pesanSuksesHalaman?: string; isian: Isian[] };
type Hasil = { teks: string; form: FormTelusur[]; tautan: string[] };

/** Menelusuri keluaran halaman: komponen server dijalankan, FormulirAksi dicatat beserta isian di dalamnya. */
async function telusuri(node: ReactNode | Promise<ReactNode>): Promise<Hasil> {
  const hasil: Hasil = { teks: "", form: [], tautan: [] };
  const jalan = async (n: ReactNode | Promise<ReactNode>, form: FormTelusur | null): Promise<string> => {
    const v = await n;
    if (v === null || v === undefined || typeof v === "boolean") return "";
    if (typeof v === "string" || typeof v === "number") return String(v);
    if (Array.isArray(v)) return (await Promise.all(v.map((x) => jalan(x, form)))).join("");
    if (!isValidElement(v)) return "";
    const el = v as ReactElement<Record<string, unknown>>;
    const anak = () => jalan(el.props.children as ReactNode, form);
    if (el.type === Link) {
      hasil.tautan.push(String(el.props.href));
      return anak();
    }
    if (el.type === PesanSuksesHalaman) return "";
    if (el.type === FormulirAksi) {
      const f: FormTelusur = { aksi: el.props.aksi as FormTelusur["aksi"], pesanKonfirmasi: el.props.pesanKonfirmasi as string | undefined, pesanSuksesHalaman: el.props.pesanSuksesHalaman as string | undefined, isian: [] };
      hasil.form.push(f);
      return jalan(el.props.children as ReactNode, f);
    }
    if (el.type === "input" || el.type === "textarea") {
      form?.isian.push({ name: String(el.props.name ?? ""), value: String(el.props.value ?? el.props.defaultValue ?? ""), type: el.type === "input" ? String(el.props.type ?? "text") : "textarea" });
    }
    if (typeof el.type === "function") return jalan((el.type as (p: unknown) => ReactNode | Promise<ReactNode>)(el.props), form);
    return anak();
  };
  hasil.teks = await jalan(node, null);
  return hasil;
}

const halaman = (peran: string, perusahaan = ID) => dengan({ peran }, async () => telusuri(await HalamanDaftarPilihan({ searchParams: Promise.resolve({ perusahaan }) })));
const dataForm = (f: FormTelusur, timpa: Record<string, string> = {}) => {
  const fd = new FormData();
  for (const i of f.isian) fd.set(i.name, i.name in timpa ? timpa[i.name] : i.value);
  return fd;
};
/** Mengirim formulir seperti peramban: aksi yang terpasang, dijalankan sebagai peran. console.error dibungkam (revalidatePath di luar permintaan HTTP). */
async function kirim(peran: string, f: FormTelusur, timpa: Record<string, string> = {}) {
  const galatAsli = console.error;
  console.error = () => {};
  try {
    return await dengan({ peran }, () => f.aksi(null, dataForm(f, timpa)));
  } finally {
    console.error = galatAsli;
  }
}
const formSumberBaru = (h: Hasil) => h.form.find((f) => f.isian.some((i) => i.name === "nama" && !f.pesanKonfirmasi));
const formHapusSumber = (h: Hasil) => h.form.filter((f) => f.pesanKonfirmasi?.startsWith("Hapus sumber"));
const formSeksi = (h: Hasil) => h.form.find((f) => f.isian.some((i) => i.name === "daftarSeksi"));
const namaSumber = async () => (await db.sumberLead.findMany({ where: { perusahaanId: ID }, orderBy: { urutan: "asc" } })).map((s) => s.nama);

async function digestHalaman(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return String((e as { digest?: string })?.digest ?? (e as Error)?.message ?? e);
  }
  return "";
}

async function bersihkan() {
  await db.logAktivitas.deleteMany({ where: { perusahaanId: ID } });
  await db.sumberLead.deleteMany({ where: { perusahaanId: ID } });
  await db.tahapLead.deleteMany({ where: { perusahaanId: ID } });
  await db.pengaturanDokumenPenjualan.deleteMany({ where: { perusahaanId: ID } });
  await db.perusahaan.deleteMany({ where: { id: ID } });
}

async function main() {
  await bersihkan();
  const awalAdmin = await db.hakAksesPeran.findMany({ where: { peran: "ADMIN", hak: { in: ["pengaturan.tulis", "pengaturan-crm.ubah"] } } });
  const hakAwal = await db.hakAksesPeran.count();
  await db.perusahaan.create({ data: { id: ID, kode: KODE, nama: "PT Uji Daftar Pilihan" } });
  try {
    console.log("=== 1. Halaman memasang editor bagi yang berhak ===");
    const h0 = await halaman("PEMILIK");
    pastikan(h0.teks.includes("Sumber lead") && h0.teks.includes("Seksi baris dokumen") && h0.teks.includes("Jenis & pilar konten"), "PEMILIK: tiga bagian tampil");
    pastikan(!!formSumberBaru(h0) && !!formSeksi(h0), "PEMILIK: formulir tambah sumber dan simpan seksi terpasang");
    pastikan(formHapusSumber(h0).length === 0 && SUMBER_BAWAAN.every((n) => h0.teks.includes(n)), "belum diatur: daftar sumber bawaan tampil tanpa tombol hapus");
    pastikan(h0.tautan.includes(`/crm/pengaturan?perusahaan=${ID}`) && h0.tautan.includes(`/pengaturan/perusahaan/dokumen?perusahaan=${ID}`), "tautan ke Pengaturan CRM dan Dokumen & Nomor Cetak tetap ada");
    pastikan(SEKSI_BAWAAN.every((n) => h0.teks.includes(n)) && (formSeksi(h0)!.isian.find((i) => i.name === "daftarSeksi")?.value ?? "x") === "", "seksi belum diatur: daftar bawaan tampil, textarea kosong (kosong = bawaan)");
    pastikan((await db.sumberLead.count({ where: { perusahaanId: ID } })) === 0, "membuka halaman tidak menulis data (bawaan hanya ditampilkan)");

    console.log("=== 2. Hak halaman ===");
    pastikan((await digestHalaman(() => halaman("KASIR"))).includes("NEXT_REDIRECT"), "KASIR dialihkan (tanpa pengaturan.tulis)");
    pastikan((await digestHalaman(() => halaman("ADMIN"))).includes("NEXT_REDIRECT"), "ADMIN bawaan dialihkan (tanpa pengaturan.tulis)");
    await db.hakAksesPeran.upsert({ where: { peran_hak: { peran: "ADMIN", hak: "pengaturan.tulis" } }, create: { peran: "ADMIN", hak: "pengaturan.tulis", boleh: true }, update: { boleh: true } });
    const hAdmin = await halaman("ADMIN");
    pastikan(hAdmin.teks.includes("Seksi baris dokumen") && !!formSeksi(hAdmin), "ADMIN dengan pengaturan.tulis: editor seksi terpasang");
    pastikan(!hAdmin.teks.includes("Sumber lead") && !formSumberBaru(hAdmin) && !hAdmin.tautan.some((t) => t.startsWith("/crm/pengaturan")), "ADMIN tanpa pengaturan-crm.ubah: tidak ada bagian, editor, maupun tautan Sumber lead");
    const sumberAdmin = formSumberBaru(h0)!;
    const galatAdmin = await kirim("ADMIN", sumberAdmin, { nama: "Sumber Ilegal" });
    pastikan(/tidak punya hak/.test(galatAdmin.galat ?? "") && (await db.sumberLead.count({ where: { perusahaanId: ID } })) === 0, "aksi tambah sumber menolak ADMIN tanpa pengaturan-crm.ubah walau formulirnya dikirim langsung");

    console.log("=== 3. Sumber lead: tambah dan hapus lewat editor ===");
    await kirim("PEMILIK", formSumberBaru(h0)!, { nama: "Podcast" });
    const sesudahTambah = await namaSumber();
    pastikan(sesudahTambah.length === SUMBER_BAWAAN.length + 1 && SUMBER_BAWAAN.every((n) => sesudahTambah.includes(n)) && sesudahTambah.at(-1) === "Podcast", "menambah sumber pertama menyalin bawaan lebih dulu, lalu menambah Podcast di akhir");
    const h1 = await halaman("PEMILIK");
    pastikan(formHapusSumber(h1).length === sesudahTambah.length && h1.teks.includes("Podcast") && !h1.teks.includes("Belum diatur, jadi yang tampil adalah daftar bawaan. Tahap"), "sesudah diatur: tiap sumber punya tombol hapus dan keterangan belum diatur hilang");
    const dup = await kirim("PEMILIK", formSumberBaru(h1)!, { nama: " podcast " });
    pastikan(/sudah ada/.test(dup.galat ?? "") && (await namaSumber()).length === sesudahTambah.length, "nama ganda (tanpa beda huruf) ditolak");
    const kosong = await kirim("PEMILIK", formSumberBaru(h1)!, { nama: "   " });
    pastikan(kosong.galat !== null && (await namaSumber()).length === sesudahTambah.length, "nama kosong ditolak");
    const hapusPodcast = formHapusSumber(h1).find((f) => f.pesanKonfirmasi === "Hapus sumber Podcast?")!;
    pastikan(!!hapusPodcast && hapusPodcast.pesanSuksesHalaman === "Sumber dihapus", "tombol hapus Podcast: konfirmasi dan pesan sukses halaman");
    const hapusDitolak = await kirim("ADMIN", hapusPodcast);
    pastikan(/tidak punya hak/.test(hapusDitolak.galat ?? "") && (await namaSumber()).includes("Podcast"), "aksi hapus sumber menolak ADMIN tanpa pengaturan-crm.ubah");
    await kirim("PEMILIK", hapusPodcast);
    pastikan(!(await namaSumber()).includes("Podcast") && (await namaSumber()).length === SUMBER_BAWAAN.length, "PEMILIK menghapus Podcast; sumber lain utuh");
    pastikan((await db.logAktivitas.count({ where: { perusahaanId: ID, jenis: "Sumber Lead", aksi: "BUAT", nomor: "Podcast" } })) === 1 && (await db.logAktivitas.count({ where: { perusahaanId: ID, jenis: "Sumber Lead", aksi: "HAPUS", nomor: "Podcast" } })) === 1, "log BUAT dan HAPUS Sumber Lead tercatat seperti dari Pengaturan CRM");
    const h2 = await halaman("PEMILIK");
    // sisakan satu sumber: hapus sampai tinggal satu, yang terakhir ditolak
    let sisa = h2;
    while ((await namaSumber()).length > 1) {
      await kirim("PEMILIK", formHapusSumber(sisa)[0]);
      sisa = await halaman("PEMILIK");
    }
    const terakhir = await kirim("PEMILIK", formHapusSumber(sisa)[0]);
    pastikan(/Minimal satu sumber/.test(terakhir.galat ?? "") && (await namaSumber()).length === 1, "sumber terakhir tidak bisa dihapus");

    console.log("=== 4. Seksi baris dokumen: simpan lewat editor ===");
    // bawaan dokumen lain yang harus selamat
    await db.pengaturanDokumenPenjualan.upsert({
      where: { perusahaanId: ID },
      create: { perusahaanId: ID, syaratPembayaran: "Termin 50% di muka\nSisa saat acara selesai", tampilanEvent: "RINGKAS", teksPembukaPenawaran: "Dengan hormat,\nBerikut penawaran kami.", teksPenutupPenawaran: "Terima kasih." },
      update: {},
    });
    const h3 = await halaman("PEMILIK");
    const fSeksi = formSeksi(h3)!;
    pastikan(fSeksi.isian.find((i) => i.name === "perusahaanId")?.value === ID, "editor seksi mengirim perusahaan yang sedang dipilih");
    await kirim("PEMILIK", fSeksi, { daftarSeksi: "Panggung\n  Audio  \npanggung\n\nLighting" });
    const d1 = await db.pengaturanDokumenPenjualan.findUniqueOrThrow({ where: { perusahaanId: ID } });
    pastikan(JSON.stringify(d1.daftarSeksi) === JSON.stringify(["Panggung", "Audio", "Lighting"]), `seksi dirapikan seperti halaman asal (tanpa ganda, tanpa baris kosong): ${JSON.stringify(d1.daftarSeksi)}`);
    pastikan(
      d1.syaratPembayaran === "Termin 50% di muka\nSisa saat acara selesai" && d1.tampilanEvent === "RINGKAS" && d1.teksPembukaPenawaran === "Dengan hormat,\nBerikut penawaran kami." && d1.teksPenutupPenawaran === "Terima kasih.",
      "syarat pembayaran, tampilan event, paragraf pembuka dan penutup tidak berubah saat menyimpan seksi",
    );
    pastikan((await db.logAktivitas.count({ where: { perusahaanId: ID, jenis: "Pengaturan Dokumen Penjualan", aksi: "UBAH" } })) === 1, "log UBAH Pengaturan Dokumen Penjualan tercatat");
    const h4 = await halaman("PEMILIK");
    pastikan(["Panggung", "Audio", "Lighting"].every((n) => h4.teks.includes(n)) && formSeksi(h4)!.isian.find((i) => i.name === "daftarSeksi")?.value === "Panggung\nAudio\nLighting", "halaman menampilkan seksi baru di daftar dan di textarea");

    console.log("=== 5. Seksi: hak dan kosong = bawaan ===");
    const tolak = await kirim("KASIR", fSeksi, { daftarSeksi: "Seksi Ilegal" });
    pastikan(/tidak punya hak/.test(tolak.galat ?? "") && JSON.stringify((await db.pengaturanDokumenPenjualan.findUniqueOrThrow({ where: { perusahaanId: ID } })).daftarSeksi) === JSON.stringify(["Panggung", "Audio", "Lighting"]), "aksi simpan seksi menolak KASIR; data tidak berubah");
    await kirim("PEMILIK", formSeksi(h4)!, { daftarSeksi: "" });
    const d2 = await db.pengaturanDokumenPenjualan.findUniqueOrThrow({ where: { perusahaanId: ID } });
    pastikan(d2.daftarSeksi.length === 0 && d2.syaratPembayaran === d1.syaratPembayaran && d2.tampilanEvent === "RINGKAS", "mengosongkan textarea mengembalikan ke bawaan tanpa menyentuh isian dokumen lain");
    const h5 = await halaman("PEMILIK");
    pastikan(SEKSI_BAWAAN.every((n) => h5.teks.includes(n)), "daftar seksi bawaan tampil lagi");
    // tanpa baris pengaturan sama sekali: menyimpan seksi membuat baris dengan bawaan skema
    await db.pengaturanDokumenPenjualan.deleteMany({ where: { perusahaanId: ID } });
    const h6 = await halaman("PEMILIK");
    await kirim("PEMILIK", formSeksi(h6)!, { daftarSeksi: "Venue" });
    const d3 = await db.pengaturanDokumenPenjualan.findUniqueOrThrow({ where: { perusahaanId: ID } });
    pastikan(JSON.stringify(d3.daftarSeksi) === '["Venue"]' && d3.tampilanEvent === "RINCI" && d3.syaratPembayaran === null && d3.teksPembukaPenawaran === null, "perusahaan tanpa baris pengaturan: baris dibuat dengan seksi baru dan bawaan lain kosong");
  } finally {
    await bersihkan();
    await db.hakAksesPeran.deleteMany({ where: { peran: "ADMIN", hak: { in: ["pengaturan.tulis", "pengaturan-crm.ubah"] } } });
    for (const r of awalAdmin) await db.hakAksesPeran.create({ data: { peran: r.peran, hak: r.hak, boleh: r.boleh } });
  }
  pastikan((await db.hakAksesPeran.count()) === hakAwal && (await db.perusahaan.count({ where: { id: ID } })) === 0, "penyesuaian hak ADMIN dikembalikan dan perusahaan uji dihapus");
  console.log("=== DONE, all daftar pilihan checks passed ===");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
