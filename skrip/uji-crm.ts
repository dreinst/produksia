import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { D } from "../src/lib/uang";
import { DAFTAR_PERAN, HAK_BAWAAN, punyaHak } from "../src/lib/hakAkses";
import { periksaSinkron } from "../src/lib/sinkron";
import { bacaWaktuLokal, nilaiWaktuLokal } from "../src/lib/waktu";
import * as pengingat from "../src/lib/pengingat";
import {
  LABEL_JENIS_AKTIVITAS,
  SUMBER_BAWAAN,
  TAHAP_BAWAAN,
  bacaFieldTambahan,
  bacaTag,
  bedaLead,
  bulanTerakhir,
  cariLead,
  cariPelangganMirip,
  catatAktivitasLead,
  daftarPenggunaCrm,
  kodePelangganBerikutnya,
  pastikanBawaanCrm,
  pastikanLeadUntukPenawaran,
  periksaPengingatTindakLanjut,
  statistikCrm,
  teksAktivitas,
  teksFieldTambahan,
  urutanLead,
  whereLead,
} from "../src/lib/crm";
import {
  arsipkanLead,
  buatLead,
  buatTindakLanjut,
  geserTahapLead,
  hapusSumberLead,
  hapusTahapLead,
  hapusTindakLanjut,
  konversiLeadKePelanggan,
  pindahTahapLead,
  pindahTahapLeadDariPapan,
  pulihkanLead,
  tambahCatatanLead,
  tambahSumberLead,
  tambahTahapLead,
  tautkanLeadKePelanggan,
  ubahLead,
  ubahStatusTindakLanjut,
  ubahTahapLead,
  ubahTindakLanjut,
} from "../src/lib/aksi/crm";
import type { JenisAktivitasLead } from "../src/prisma-klien/enums";
import { formulir, harusDitolak, jalankan, pastikan, sebagai } from "./bantuan";

/*
 * Uji pustaka dan aksi CRM (P22, D4 §9.1 kecuali bagian 10 pengingat di uji-notifikasi.ts dan bagian 12 penawaran dari
 * lead di uji-penawaran-lead.ts P23). Data uji: perusahaan UJICRMB dan UJICRMC, pengguna nonaktif uji-crm-nonaktif,
 * karyawan KRY-UJICRM (bila admin belum punya karyawan), pelanggan UJICRM-P1, lead dan tindak lanjut berawalan
 * "UjiCRM ". Pengguna seed owner, owner2, admin, dan kasir dipakai sebagai pelaku nyata. Semua data uji, notifikasi
 * untuk pengguna seed sejak uji mulai, dan log modul crm sejak uji mulai dihapus di akhir. CRM tidak membuat jurnal.
 * Bagian 17b (perbaikan tinjauan P22) memakai perusahaan UJICRMR1 sampai UJICRMR4 dan penyesuaian hak sementara
 * ADMIN tanpa lead.lihat, keduanya dibuang lagi.
 */

const AWALAN = "UjiCRM ";
const KODE_B = "UJICRMB";
const KODE_C = "UJICRMC";
/** Perusahaan baru per putaran uji serentak buatLead dan pengaturan (tinjauan P22 R1). */
const AWALAN_KODE_R1 = "UJICRMR";
const KODE_P1 = "UJICRM-P1";
const NONAKTIF = "uji-crm-nonaktif";
const KODE_KARYAWAN = "KRY-UJICRM";

/** Membersihkan semua data uji (di awal untuk sisa putaran yang terhenti, dan di akhir). */
async function bersihkan(mulai: Date | null) {
  const perusahaan = await db.perusahaan.findMany({ where: { OR: [{ kode: { in: [KODE_B, KODE_C] } }, { kode: { startsWith: AWALAN_KODE_R1 } }] }, select: { id: true } });
  const pIds = perusahaan.map((p) => p.id);
  const lead = await db.lead.findMany({ where: { OR: [{ perusahaanId: { in: pIds } }, { nama: { startsWith: AWALAN } }] }, select: { id: true, pelangganId: true } });
  const leadIds = lead.map((l) => l.id);
  await db.tindakLanjut.deleteMany({ where: { OR: [{ perusahaanId: { in: pIds } }, { leadId: { in: leadIds } }, { judul: { startsWith: AWALAN } }] } });
  await db.lead.deleteMany({ where: { id: { in: leadIds } } });
  await db.pelanggan.deleteMany({ where: { OR: [{ kode: KODE_P1 }, { namaKontak: { startsWith: AWALAN } }] } });
  await db.karyawan.deleteMany({ where: { kode: KODE_KARYAWAN } });
  await db.notifikasi.deleteMany({ where: { perusahaanId: { in: pIds } } });
  if (mulai) {
    const seed = await db.pengguna.findMany({ where: { namaPengguna: { in: ["owner", "owner2", "admin", "kasir", "superadmin"] } }, select: { id: true } });
    await db.notifikasi.deleteMany({ where: { penggunaId: { in: seed.map((p) => p.id) }, dibuatPada: { gte: mulai } } });
    await db.logAktivitas.deleteMany({ where: { modul: "crm", waktu: { gte: mulai } } });
  }
  await db.pengguna.deleteMany({ where: { namaPengguna: NONAKTIF } });
  await db.perusahaan.deleteMany({ where: { id: { in: pIds } } });
  // penyesuaian hak bagian 17b (ADMIN tanpa lead.lihat) bila putaran sebelumnya terhenti di tengah
  await db.hakAksesPeran.deleteMany({ where: { peran: "ADMIN", hak: "lead.lihat" } });
}

async function main() {
  await bersihkan(null);
  const mulaiUji = new Date();
  const ambil = async (namaPengguna: string) => db.pengguna.findUniqueOrThrow({ where: { namaPengguna }, select: { id: true, nama: true } });
  const [owner, owner2, admin, kasir] = await Promise.all([ambil("owner"), ambil("owner2"), ambil("admin"), ambil("kasir")]);
  const B = (await db.perusahaan.create({ data: { kode: KODE_B, nama: "PT Uji CRM B", urutan: 97 } })).id;
  const C = (await db.perusahaan.create({ data: { kode: KODE_C, nama: "PT Uji CRM C", urutan: 98 } })).id;
  const nonaktif = await db.pengguna.create({ data: { namaPengguna: NONAKTIF, nama: "Uji CRM Nonaktif", peran: "ADMIN", aktif: false, kataSandiHash: "-" } });
  const karyawanAdmin = (await db.karyawan.findUnique({ where: { penggunaId: admin.id }, select: { id: true } })) ?? (await db.karyawan.create({ data: { kode: KODE_KARYAWAN, nama: "Uji CRM Sales", penggunaId: admin.id } }));
  const tahapUtamaAwal = await db.tahapLead.findMany({ where: { perusahaanId: "utama" }, orderBy: { urutan: "asc" }, select: { nama: true, urutan: true } });

  const jumlahAktivitas = (leadId: string, jenis?: JenisAktivitasLead) => db.aktivitasLead.count({ where: { leadId, ...(jenis ? { jenis } : {}) } });
  const jumlahNotif = (penggunaId: string, judulAwal: string) => db.notifikasi.count({ where: { penggunaId, judul: { startsWith: judulAwal }, dibuatPada: { gte: mulaiUji } } });
  const leadBernama = (nama: string) => db.lead.findFirstOrThrow({ where: { nama: AWALAN + nama }, include: { tahap: true } });
  const tahapB = async (nama: string) => db.tahapLead.findFirstOrThrow({ where: { perusahaanId: B, nama } });
  const formLead = (o: Record<string, string> = {}) =>
    formulir({ perusahaanId: B, nama: `${AWALAN}A`, namaUsaha: "PT Uji Lead A", telepon: "+62 811 1111 2222", whatsapp: "0811 1111 2222", sumber: "Instagram", picId: admin.id, nilaiEstimasi: "25000000", ...o });
  /** Formulir ubah yang mengirim ulang isi lead sekarang (opsional kosong = ""). */
  const formUbah = async (leadId: string, o: Record<string, string> = {}) => {
    const l = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
    return formulir({
      nama: l.nama,
      namaUsaha: l.namaUsaha,
      telepon: l.telepon,
      whatsapp: l.whatsapp,
      email: l.email ?? "",
      instagram: l.instagram ?? "",
      website: l.website ?? "",
      industri: l.industri ?? "",
      lokasi: l.lokasi ?? "",
      sumber: l.sumber,
      picId: "",
      nilaiEstimasi: l.nilaiEstimasi.toString(),
      catatan: l.catatan ?? "",
      tag: l.tag.join(", "),
      fieldTambahan: teksFieldTambahan(l.fieldTambahan),
      ...o,
    });
  };

  try {
    console.log("=== 0. Awal ===");
    const sinkronAwal = await periksaSinkron(db);
    const jurnalAwal = await db.jurnal.count();
    pastikan(sinkronAwal.seimbang, "periksaSinkron seimbang sebelum uji");
    pastikan(periksaPengingatTindakLanjut === pengingat.periksaPengingatTindakLanjut, "crm.ts mengekspor ulang periksaPengingatTindakLanjut dari pengingat.ts (fungsi yang sama)");

    console.log("=== 1. Hak bawaan dan hak aksi ===");
    for (const peran of DAFTAR_PERAN) {
      const harap = peran === "SUPERADMIN" || peran === "PEMILIK" || peran === "ADMIN";
      pastikan((["lead.lihat", "lead.buat", "lead.ubah", "lead.hapus"] as const).every((h) => punyaHak(peran, h) === harap), `${peran}: lead.* ${harap ? "ada" : "tidak ada"}`);
      pastikan(punyaHak(peran, "pengaturan-crm.ubah") === (peran === "SUPERADMIN" || peran === "PEMILIK"), `${peran}: pengaturan-crm.ubah sesuai`);
    }
    pastikan(HAK_BAWAAN.KRU.length === 2 && HAK_BAWAAN.GUEST.length === 2, "bawaan KRU dan GUEST tetap 2 hak");
    await harusDitolak("KASIR buat lead", () => sebagai("kasir", () => buatLead(formLead())), "tidak punya hak");
    process.env.UJI_PERAN = "ADMIN";
    try {
      await harusDitolak("ADMIN tambah tahap", () => tambahTahapLead(formulir({ perusahaanId: B, nama: "Tahap ADMIN", jenis: "BERJALAN" })), "tidak punya hak");
    } finally {
      delete process.env.UJI_PERAN;
    }
    await harusDitolak("KASIR konversi lead", () => sebagai("kasir", () => konversiLeadKePelanggan("tidak-ada", formulir({}))), "tidak punya hak");
    await harusDitolak("KASIR arsipkan lead", () => sebagai("kasir", () => arsipkanLead("tidak-ada")), "tidak punya hak");
    await harusDitolak("KASIR buat tindak lanjut", () => sebagai("kasir", () => buatTindakLanjut(formulir({ perusahaanId: B, judul: `${AWALAN}x`, jatuhTempo: "2026-11-09T10:00" }))), "tidak punya hak");
    pastikan((await db.lead.count({ where: { perusahaanId: B } })) === 0 && (await db.tahapLead.count({ where: { perusahaanId: B } })) === 0, "penolakan hak tidak menulis apa pun");
    pastikan((await daftarPenggunaCrm(db)).some((p) => p.id === admin.id) && !(await daftarPenggunaCrm(db)).some((p) => p.id === kasir.id || p.id === nonaktif.id), "daftarPenggunaCrm memuat admin, tanpa kasir dan pengguna nonaktif");

    console.log("=== 2. Bawaan perusahaan ===");
    await pastikanBawaanCrm(db, B);
    await Promise.all([pastikanBawaanCrm(db, B), pastikanBawaanCrm(db, B)]);
    const daftarTahapB = await db.tahapLead.findMany({ where: { perusahaanId: B }, orderBy: { urutan: "asc" } });
    pastikan(daftarTahapB.length === 9 && daftarTahapB.every((t, i) => t.urutan === i + 1 && t.nama === TAHAP_BAWAAN[i].nama && t.jenis === TAHAP_BAWAAN[i].jenis), "9 tahap bawaan urutan 1-9 dengan jenis D4 §3.2, tetap 9 sesudah panggilan serentak");
    pastikan((await db.sumberLead.count({ where: { perusahaanId: B } })) === SUMBER_BAWAAN.length, "7 sumber bawaan, tetap 7 sesudah panggilan serentak");
    await pastikanBawaanCrm(db, C);
    const kalahB = await tahapB("Kalah");
    const tahapC1 = await db.tahapLead.findFirstOrThrow({ where: { perusahaanId: C, urutan: 1 } });

    console.log("=== 3. Validasi buat lead ===");
    const buatSebagaiOwner = (fd: FormData) => sebagai("owner", () => buatLead(fd));
    const kasus: [string, Record<string, string>, string][] = [
      ["nama kosong", { nama: "   " }, "Nama kontak wajib diisi"],
      ["nama usaha kosong", { namaUsaha: "" }, "Perusahaan/usaha wajib diisi"],
      ["telepon 2 karakter", { telepon: "12" }, "Telepon wajib diisi, 3-40 karakter"],
      ["WhatsApp kosong", { whatsapp: "" }, "WhatsApp wajib diisi, 3-40 karakter"],
      ["sumber kosong", { sumber: "" }, "Sumber lead wajib dipilih"],
      ["sumber belum ada", { sumber: "TikTok" }, 'Sumber lead "TikTok" tidak ada di daftar sumber perusahaan ini'],
      ["email salah", { email: "a@b" }, "Format email tidak valid"],
      ["nilai negatif", { nilaiEstimasi: "-1" }, "Perkiraan nilai deal tidak boleh negatif"],
      ["nilai bukan angka", { nilaiEstimasi: "abc" }, "Perkiraan nilai deal tidak valid"],
      ["nilai terlalu besar", { nilaiEstimasi: "99999999999999999" }, "Perkiraan nilai deal terlalu besar"],
      ["tahap perusahaan lain", { tahapId: tahapC1.id }, "Tahap tidak ditemukan di pipeline perusahaan ini"],
      ["tahap Kalah", { tahapId: kalahB.id }, "Lead baru hanya boleh di tahap berjenis Berjalan"],
      ["PIC kasir", { picId: kasir.id }, `PIC ${kasir.nama} belum punya hak melihat lead`],
      ["PIC nonaktif", { picId: nonaktif.id }, "PIC tidak ditemukan atau sudah nonaktif"],
      ["21 tag", { tag: Array.from({ length: 21 }, (_, i) => `t${i}`).join(",") }, "Tag maksimal 20"],
      ["tag 41 karakter", { tag: "x".repeat(41) }, "lebih dari 40 karakter"],
      ["field tambahan tanpa titik dua", { fieldTambahan: "tanpa titik dua" }, "Field tambahan baris 1 harus berformat Nama: Nilai"],
      ["perusahaan tidak ada", { perusahaanId: "tidak-ada" }, "Perusahaan tidak ditemukan"],
    ];
    for (const [label, o, pesan] of kasus) await harusDitolak(label, () => buatSebagaiOwner(formLead(o)), pesan);
    pastikan((await db.lead.count({ where: { perusahaanId: B } })) === 0, "tidak ada lead tertulis dari isian yang ditolak");

    console.log("=== 4. Buat lead sukses ===");
    await jalankan("owner membuat lead A (PIC admin)", () =>
      buatSebagaiOwner(formLead({ tag: "VIP, vip ,  Event  Besar", fieldTambahan: "Anggaran: 50 jt\n\nJumlah peserta: 200\n", email: "lead.a@contoh.id", catatan: "Klien lama" })),
    );
    const leadA = await leadBernama("A");
    pastikan(leadA.tahap.nama === "Lead Baru" && leadA.perusahaanId === B && leadA.picId === admin.id && leadA.dibuatOlehId === owner.id, "lead A di tahap Lead Baru milik B, PIC admin, dibuat owner");
    pastikan(JSON.stringify(leadA.tag) === '["vip","event besar"]', "tag dirapikan, huruf kecil, tanpa duplikat");
    pastikan(JSON.stringify(leadA.fieldTambahan) === '{"Anggaran":"50 jt","Jumlah peserta":"200"}', "field tambahan dua pasangan, baris kosong dilewati");
    pastikan(leadA.nilaiEstimasi.equals(25_000_000) && leadA.sumber === "Instagram", "nilai estimasi 25.000.000, sumber nama baku");
    pastikan((await jumlahAktivitas(leadA.id, "DIBUAT")) === 1 && (await jumlahAktivitas(leadA.id)) === 1, "satu aktivitas DIBUAT");
    pastikan((await jumlahNotif(admin.id, "Lead baru untuk Anda")) === 1 && (await jumlahNotif(owner.id, "Lead baru untuk Anda")) === 0, "notifikasi Lead baru untuk Anda ke admin, tidak ke owner (pembuat)");
    await jalankan("PIC bawaan (kosong) = pembuat", () => buatSebagaiOwner(formLead({ nama: `${AWALAN}B`, namaUsaha: "PT Uji Lead B", picId: "", sumber: "website" })));
    await jalankan("tanpa PIC (-)", () => buatSebagaiOwner(formLead({ nama: `${AWALAN}C`, namaUsaha: "PT Uji Lead C", picId: "-" })));
    const leadB = await leadBernama("B");
    const leadC = await leadBernama("C");
    pastikan(leadB.picId === owner.id && leadB.sumber === "Website" && leadC.picId === null, "PIC bawaan = owner; sumber dicocokkan tanpa beda huruf besar; tanpa PIC = null");
    pastikan((await jumlahNotif(owner.id, "Lead baru untuk Anda")) === 0 && (await jumlahNotif(admin.id, "Lead baru untuk Anda")) === 1, "PIC bawaan dan tanpa PIC tidak memberi notifikasi");
    await jalankan("skrip-uji (tanpa pengguna nyata) membuat lead tanpa PIC bawaan", () => buatLead(formLead({ nama: `${AWALAN}D`, namaUsaha: "PT Uji Lead D", picId: "" })));
    pastikan((await leadBernama("D")).picId === null && (await leadBernama("D")).dibuatOlehId === null, "pembuat semu tidak menjadi PIC dan dibuatOlehId null");

    console.log("=== 5. Ubah lead ===");
    await jalankan("ubah telepon dan PIC ke owner2", async () => sebagai("owner", async () => ubahLead(leadA.id, await formUbah(leadA.id, { telepon: "021-555-0101", picId: owner2.id }))));
    const diubah = await db.aktivitasLead.findFirstOrThrow({ where: { leadId: leadA.id, jenis: "DIUBAH" } });
    pastikan(JSON.stringify((diubah.meta as { bidang?: unknown }).bidang) === '["telepon","picId"]', "aktivitas DIUBAH meta.bidang = telepon, picId");
    pastikan((await jumlahNotif(owner2.id, "Lead dialihkan ke Anda")) === 1, "notifikasi Lead dialihkan ke Anda ke owner2");
    const aktivitasSebelum = await jumlahAktivitas(leadA.id);
    await jalankan("kirim ulang formulir sama persis", async () => sebagai("owner", async () => ubahLead(leadA.id, await formUbah(leadA.id))));
    const lA = await db.lead.findUniqueOrThrow({ where: { id: leadA.id } });
    await jalankan("kirim ulang dengan tag dan field tambahan urutan terbalik", async () =>
      sebagai("owner", async () => ubahLead(leadA.id, await formUbah(leadA.id, { tag: [...lA.tag].reverse().join(","), fieldTambahan: "Jumlah peserta: 200\nAnggaran: 50 jt" }))),
    );
    pastikan((await jumlahAktivitas(leadA.id)) === aktivitasSebelum, "tanpa perubahan semu: aktivitas tidak bertambah");
    pastikan(bedaLead({ ...lA, email: "" }, { ...lA, email: null }).length === 0 && bedaLead(lA, { ...lA, nilaiEstimasi: "25000000.00" }).length === 0, "bedaLead: kosong = null, nilai Decimal sama");
    await db.sumberLead.deleteMany({ where: { perusahaanId: B, nama: "Instagram" } });
    await jalankan("ubah lead bersumber Instagram (sudah dihapus dari daftar) tanpa mengganti sumber", async () => sebagai("owner", async () => ubahLead(leadA.id, await formUbah(leadA.id, { industri: "Perhotelan" }))));
    pastikan((await db.lead.findUniqueOrThrow({ where: { id: leadA.id } })).sumber === "Instagram", "sumber lama tetap diterima");
    await harusDitolak("ganti sumber ke yang tidak ada", async () => sebagai("owner", async () => ubahLead(leadA.id, await formUbah(leadA.id, { sumber: "Tidak Ada" }))), "tidak ada di daftar sumber");
    await harusDitolak("ubah lead tidak ada", async () => sebagai("owner", async () => ubahLead("tidak-ada", await formUbah(leadA.id))), "Lead tidak ditemukan");

    console.log("=== 6. Pindah tahap ===");
    const pindah = (leadId: string, tahapId: string, alasan = "") => sebagai("owner", () => pindahTahapLead(leadId, formulir({ tahapId, alasan })));
    const [dihubungi, negosiasi, menangB, pertemuan, proposal] = await Promise.all([tahapB("Dihubungi"), tahapB("Negosiasi"), tahapB("Menang"), tahapB("Pertemuan"), tahapB("Proposal")]);
    await jalankan("ke Dihubungi", () => pindah(leadA.id, dihubungi.id));
    pastikan((await jumlahAktivitas(leadA.id, "TAHAP_DIUBAH")) === 1 && (await jumlahNotif(owner2.id, "Deal")) === 0, "TAHAP_DIUBAH tanpa notifikasi");
    const n6 = await jumlahAktivitas(leadA.id);
    await jalankan("ke tahap yang sama", () => pindah(leadA.id, dihubungi.id));
    pastikan((await jumlahAktivitas(leadA.id)) === n6, "tahap sama: tidak menulis apa pun");
    await harusDitolak("ke Kalah tanpa alasan", () => pindah(leadA.id, kalahB.id, "   "), "Isi alasan deal ini kalah");
    pastikan((await db.lead.findUniqueOrThrow({ where: { id: leadA.id } })).tahapId === dihubungi.id, "tahap tidak berubah sesudah ditolak");
    await harusDitolak("alasan 1001 karakter", () => pindah(leadA.id, kalahB.id, "x".repeat(1001)), "Alasan maksimal 1000 karakter");
    await jalankan("ke Kalah dengan alasan", () => pindah(leadA.id, kalahB.id, "  Budget tidak cukup  "));
    let l6 = await db.lead.findUniqueOrThrow({ where: { id: leadA.id } });
    pastikan(l6.alasanMenangKalah === "Budget tidak cukup" && l6.ditutupPada !== null && (await jumlahAktivitas(leadA.id, "KALAH")) === 1, "Kalah: alasan dipangkas, ditutupPada terisi, aktivitas KALAH");
    pastikan((await jumlahNotif(owner2.id, "Deal kalah: ")) === 1, "notifikasi Deal kalah ke PIC owner2");
    await jalankan("kembali ke Negosiasi", () => pindah(leadA.id, negosiasi.id));
    l6 = await db.lead.findUniqueOrThrow({ where: { id: leadA.id } });
    pastikan(l6.alasanMenangKalah === null && l6.ditutupPada === null, "kembali Berjalan: alasan dan ditutupPada dikosongkan");
    await jalankan("ke Menang tanpa alasan", () => pindah(leadA.id, menangB.id));
    l6 = await db.lead.findUniqueOrThrow({ where: { id: leadA.id } });
    pastikan(l6.ditutupPada !== null && l6.alasanMenangKalah === null && (await jumlahNotif(owner2.id, "Deal menang: ")) === 1, "Menang: ditutupPada terisi, notifikasi Deal menang ke PIC");
    await harusDitolak("ke tahap perusahaan lain", () => pindah(leadA.id, tahapC1.id), "Tahap tidak ditemukan di pipeline perusahaan ini");
    await harusDitolak("lead tidak ada", () => pindah("tidak-ada", dihubungi.id), "Lead tidak ditemukan");
    const papanOk = await sebagai("owner", () => pindahTahapLeadDariPapan(leadB.id, dihubungi.id, ""));
    pastikan((await db.lead.findUniqueOrThrow({ where: { id: leadB.id } })).tahapId === dihubungi.id && !(papanOk.galat ?? "").includes("Isi alasan"), "jalur papan: pindah ke tahap Berjalan berhasil (revalidasi di luar HTTP diabaikan)");
    const papanKalah = await sebagai("owner", () => pindahTahapLeadDariPapan(leadB.id, kalahB.id, ""));
    pastikan(papanKalah.galat?.includes("Isi alasan") === true && (await db.lead.findUniqueOrThrow({ where: { id: leadB.id } })).tahapId === dihubungi.id, "jalur papan: Kalah tanpa alasan ditolak di server");
    await jalankan("lead C ke Pertemuan (untuk uji ganti nama tahap)", () => pindah(leadC.id, pertemuan.id));

    console.log("=== 7. Catatan ===");
    await harusDitolak("catatan kosong", () => sebagai("owner", () => tambahCatatanLead(leadA.id, formulir({ isi: "   " }))), "Catatan tidak boleh kosong");
    await harusDitolak("catatan 5001 karakter", () => sebagai("owner", () => tambahCatatanLead(leadA.id, formulir({ isi: "x".repeat(5001) }))), "Catatan maksimal 5000 karakter");
    await jalankan("catatan sah", () => sebagai("owner", () => tambahCatatanLead(leadA.id, formulir({ isi: "  Klien minta revisi  \n" }))));
    pastikan((await db.aktivitasLead.findFirstOrThrow({ where: { leadId: leadA.id, jenis: "CATATAN" } })).isi === "Klien minta revisi", "aktivitas CATATAN dipangkas");

    console.log("=== 8. Waktu lokal ===");
    const tanpaZona = !process.env.ZONA_WAKTU || process.env.ZONA_WAKTU === "Asia/Jakarta";
    const w = bacaWaktuLokal("2026-11-09T14:30");
    pastikan(w !== null && (!tanpaZona || w.toISOString() === "2026-11-09T07:30:00.000Z") && nilaiWaktuLokal(w) === "2026-11-09T14:30", "bacaWaktuLokal 14.30 WIB = 07.30 UTC, balik sama");
    pastikan(bacaWaktuLokal("2026-02-30T10:00") === null && bacaWaktuLokal("2026-11-09 14:30") === null, "tanggal tidak ada dan format tanpa T ditolak (null)");

    console.log("=== 9. Tindak lanjut ===");
    const buatTL = (o: Record<string, string>) => sebagai("owner", () => buatTindakLanjut(formulir({ judul: `${AWALAN}TL`, jatuhTempo: "2026-11-10T09:00", ...o })));
    await harusDitolak("judul kosong", () => buatTL({ judul: " ", leadId: leadA.id }), "Judul pengingat wajib diisi");
    await harusDitolak("jatuh tempo bulan 13", () => buatTL({ jatuhTempo: "2026-13-01T10:00", leadId: leadA.id }), "Tanggal/jam tindak lanjut tidak valid");
    await harusDitolak("jatuh tempo tahun 1999", () => buatTL({ jatuhTempo: "1999-12-31T10:00", leadId: leadA.id }), "Tanggal/jam tindak lanjut tidak valid");
    await harusDitolak("penerima kasir", () => buatTL({ leadId: leadA.id, ditugaskanKeId: kasir.id }), `Penerima tindak lanjut ${kasir.nama} belum punya hak melihat lead`);
    await harusDitolak("penerima nonaktif", () => buatTL({ leadId: leadA.id, ditugaskanKeId: nonaktif.id }), "Penerima tindak lanjut tidak ditemukan atau sudah nonaktif");
    await harusDitolak("skrip-uji tanpa penerima", () => buatTindakLanjut(formulir({ judul: `${AWALAN}TL`, jatuhTempo: "2026-11-10T09:00", leadId: leadA.id })), "Pilih penerima tindak lanjut");
    await harusDitolak("lead tidak ada", () => buatTL({ leadId: "tidak-ada", ditugaskanKeId: admin.id }), "Lead tidak ditemukan");
    await jalankan("TL berlead untuk admin (isian perusahaan utama diabaikan)", () => buatTL({ judul: `${AWALAN}TL Lead A`, leadId: leadA.id, perusahaanId: "utama", ditugaskanKeId: admin.id }));
    const tl1 = await db.tindakLanjut.findFirstOrThrow({ where: { judul: `${AWALAN}TL Lead A` } });
    pastikan(tl1.perusahaanId === B && tl1.status === "MENUNGGU" && tl1.ditugaskanKeId === admin.id && tl1.dibuatOlehId === owner.id, "perusahaan TL = perusahaan lead (B)");
    pastikan((await jumlahAktivitas(leadA.id, "TINDAK_LANJUT_DIJADWALKAN")) === 1 && (await jumlahNotif(admin.id, "Tindak lanjut untuk Anda")) === 1, "aktivitas TINDAK_LANJUT_DIJADWALKAN dan notifikasi ke admin");
    await jalankan("TL tanpa lead di utama, penerima bawaan pembuat", () => buatTL({ judul: `${AWALAN}TL Umum`, perusahaanId: "utama" }));
    const tl2 = await db.tindakLanjut.findFirstOrThrow({ where: { judul: `${AWALAN}TL Umum` } });
    pastikan(tl2.perusahaanId === "utama" && tl2.leadId === null && tl2.ditugaskanKeId === owner.id && (await jumlahNotif(owner.id, "Tindak lanjut untuk Anda")) === 0, "TL tanpa lead milik utama, penerima owner sendiri tanpa notifikasi");
    const statusTL = (id: string, s: string) => sebagai("owner", () => ubahStatusTindakLanjut(id, s));
    await jalankan("tandai SELESAI", () => statusTL(tl1.id, "SELESAI"));
    pastikan((await db.tindakLanjut.findUniqueOrThrow({ where: { id: tl1.id } })).selesaiPada !== null && (await jumlahAktivitas(leadA.id, "TINDAK_LANJUT_STATUS")) === 1, "SELESAI mengisi selesaiPada dan aktivitas TINDAK_LANJUT_STATUS");
    await jalankan("SELESAI lagi", () => statusTL(tl1.id, "SELESAI"));
    pastikan((await jumlahAktivitas(leadA.id, "TINDAK_LANJUT_STATUS")) === 1, "status sama: tanpa aktivitas baru");
    await harusDitolak("status X", () => statusTL(tl1.id, "X"), "Status tindak lanjut tidak dikenal");
    await jalankan("kembali MENUNGGU", () => statusTL(tl1.id, "MENUNGGU"));
    pastikan((await db.tindakLanjut.findUniqueOrThrow({ where: { id: tl1.id } })).selesaiPada === null, "MENUNGGU mengosongkan selesaiPada");
    await jalankan("TL tanpa lead DIBATALKAN (tanpa aktivitas)", () => statusTL(tl2.id, "DIBATALKAN"));
    await db.tindakLanjut.update({ where: { id: tl1.id }, data: { diingatkanPada: new Date() } });
    const ubahTL = (id: string, o: Record<string, string>) => sebagai("owner", () => ubahTindakLanjut(id, formulir({ judul: `${AWALAN}TL Lead A`, jatuhTempo: "2026-11-10T09:00", ...o })));
    await jalankan("ubah TL dengan jatuh tempo sama", () => ubahTL(tl1.id, { catatan: "Bawa brosur" }));
    pastikan((await db.tindakLanjut.findUniqueOrThrow({ where: { id: tl1.id } })).diingatkanPada !== null, "jatuh tempo sama: diingatkanPada tetap");
    await jalankan("ubah TL: penerima ke owner2 dan jatuh tempo baru", () => ubahTL(tl1.id, { ditugaskanKeId: owner2.id, jatuhTempo: "2026-11-11T09:00" }));
    const tl1b = await db.tindakLanjut.findUniqueOrThrow({ where: { id: tl1.id } });
    pastikan(tl1b.ditugaskanKeId === owner2.id && tl1b.diingatkanPada === null && tl1b.catatan === null, "jatuh tempo berubah mengosongkan diingatkanPada; penerima owner2");
    pastikan((await jumlahNotif(owner2.id, "Tindak lanjut dialihkan ke Anda")) === 1, "notifikasi Tindak lanjut dialihkan ke Anda ke owner2");
    await harusDitolak("ubah TL tidak ada", () => ubahTL("tidak-ada", {}), "Tindak lanjut tidak ditemukan");
    await harusDitolak("KASIR hapus TL", () => sebagai("kasir", () => hapusTindakLanjut(tl2.id)), "tidak punya hak");
    const logHapusAwal = await db.logAktivitas.count({ where: { modul: "crm", aksi: "HAPUS", jenis: "Tindak Lanjut" } });
    await jalankan("hapus TL tanpa lead", () => sebagai("owner", () => hapusTindakLanjut(tl2.id)));
    pastikan((await db.tindakLanjut.count({ where: { id: tl2.id } })) === 0 && (await db.logAktivitas.count({ where: { modul: "crm", aksi: "HAPUS", jenis: "Tindak Lanjut", nomor: `${AWALAN}TL Umum`, keterangan: { contains: "tanpa lead" } } })) === logHapusAwal + 1, "hapus TL: baris hilang dan log HAPUS tanpa lead");

    console.log("=== 11. Konversi ke pelanggan ===");
    const p1 = await db.pelanggan.create({ data: { kode: KODE_P1, nama: "PT Uji Mirip Sejahtera", telepon: "0812-3333-4444" } });
    const buatLeadK = (nama: string, o: Record<string, string>) => jalankan(`lead ${nama}`, () => buatSebagaiOwner(formLead({ nama: AWALAN + nama, ...o })));
    await buatLeadK("K1", { namaUsaha: "CV Konversi Uji Satu", telepon: "+62 811 7777 1001", whatsapp: "0811 7777 1002", lokasi: "Bandung", email: "k1@contoh.id", sumber: "Website" });
    await buatLeadK("K2", { namaUsaha: "CV Konversi Uji Dua", telepon: "0811 7777 2001", whatsapp: "0811 7777 2002", sumber: "Website" });
    await buatLeadK("K3", { namaUsaha: " pt uji  mirip SEJAHTERA ", telepon: "0811 7777 3001", whatsapp: "0811 7777 3002", sumber: "Website" });
    await buatLeadK("K4", { namaUsaha: "CV Lain Sama Sekali", telepon: "+62 812 3333 4444", whatsapp: "0811 7777 4002", sumber: "Website" });
    await buatLeadK("K5", { namaUsaha: "CV Konversi Uji Lima", telepon: "0811 7777 5001", whatsapp: "0811 7777 5002", sumber: "Website" });
    const [k1, k2, k3, k4, k5] = await Promise.all(["K1", "K2", "K3", "K4", "K5"].map(leadBernama));
    const jumlahPelanggan = () => db.pelanggan.count();
    const konversi = (leadId: string, o: Record<string, string> = {}) => sebagai("owner", () => konversiLeadKePelanggan(leadId, formulir(o)));
    const awalPelanggan = await jumlahPelanggan();
    await jalankan("konversi K1", () => konversi(k1.id));
    const k1b = await db.lead.findUniqueOrThrow({ where: { id: k1.id }, include: { pelanggan: true } });
    const plg = k1b.pelanggan!;
    pastikan(/^PLG-\d{4}-\d{4}$/.test(plg.kode) && plg.nama === "CV Konversi Uji Satu" && plg.namaKontak === `${AWALAN}K1` && plg.telepon === "+62 811 7777 1001" && plg.alamat === "Bandung" && plg.email === "k1@contoh.id", "pelanggan baru: kode PLG-YYYY-NNNN, nama usaha, kontak, telepon (bukan WhatsApp), alamat, email");
    pastikan(plg.penjualId === karyawanAdmin.id && k1b.dikonversiPada !== null && (await jumlahPelanggan()) === awalPelanggan + 1, "penjual = karyawan PIC admin; lead dikonversi; pelanggan bertambah 1");
    const aktKonversi = await db.aktivitasLead.findFirstOrThrow({ where: { leadId: k1.id, jenis: "DIKONVERSI" } });
    pastikan((aktKonversi.meta as { baru?: unknown }).baru === true && (await db.logAktivitas.count({ where: { modul: "crm", aksi: "KONVERSI", entitasId: k1.id } })) === 1, "aktivitas DIKONVERSI baru dan satu log KONVERSI");
    await jalankan("konversi K1 lagi (idempoten)", () => konversi(k1.id));
    pastikan((await jumlahPelanggan()) === awalPelanggan + 1 && (await jumlahAktivitas(k1.id, "DIKONVERSI")) === 1, "konversi ulang tidak membuat pelanggan baru");
    // satu sebagai() di luar Promise.all: sebagai() bersarang serentak memulihkan UJI_PENGGUNA dengan urutan yang salah
    await sebagai("owner", () =>
      Promise.all([
        jalankan("konversi K2 serentak (1)", () => konversiLeadKePelanggan(k2.id, formulir({}))),
        jalankan("konversi K2 serentak (2)", () => konversiLeadKePelanggan(k2.id, formulir({}))),
      ]),
    );
    pastikan(process.env.UJI_PENGGUNA === undefined, "UJI_PENGGUNA dipulihkan sesudah konversi serentak");
    const plgK2 = await db.pelanggan.findMany({ where: { namaKontak: `${AWALAN}K2` } });
    pastikan(plgK2.length === 1 && (await db.lead.findUniqueOrThrow({ where: { id: k2.id } })).pelangganId === plgK2[0].id && (await jumlahAktivitas(k2.id, "DIKONVERSI")) === 1, "dua konversi serentak: tepat satu pelanggan, lead menunjuknya");
    pastikan((await kodePelangganBerikutnya(db)).startsWith("PLG-") && plgK2[0].kode !== plg.kode, "kode otomatis tidak bentrok");
    pastikan((await cariPelangganMirip(db, k3)).some((p) => p.kode === KODE_P1) && (await cariPelangganMirip(db, k4)).some((p) => p.kode === KODE_P1), "cariPelangganMirip: nama dirapikan dan telepon 62 = 0");
    pastikan((await cariPelangganMirip(db, { namaUsaha: "Tidak Mirip Apa Pun", telepon: "123", whatsapp: null, email: null })).length === 0, "telepon kurang dari 7 digit tidak dipakai");
    await harusDitolak("K3 mirip nama", () => konversi(k3.id), KODE_P1);
    await harusDitolak("K4 mirip telepon", () => konversi(k4.id), KODE_P1);
    const sebelumTaut = await jumlahPelanggan();
    await jalankan("tautkan K3 ke P1", () => sebagai("owner", () => tautkanLeadKePelanggan(k3.id, p1.id, formulir({}))));
    pastikan((await db.lead.findUniqueOrThrow({ where: { id: k3.id } })).pelangganId === p1.id && (await jumlahPelanggan()) === sebelumTaut, "K3 tertaut ke P1, jumlah pelanggan tetap");
    const aktTaut = await db.aktivitasLead.findFirstOrThrow({ where: { leadId: k3.id, jenis: "DIKONVERSI" } });
    pastikan((aktTaut.meta as { baru?: unknown }).baru === false && (await db.logAktivitas.count({ where: { modul: "crm", aksi: "TAUTKAN", entitasId: k3.id } })) === 1, "aktivitas DIKONVERSI baru: false dan log TAUTKAN");
    pastikan((await db.pelanggan.findUniqueOrThrow({ where: { id: p1.id } })).namaKontak === null, "data pelanggan yang ditautkan tidak diubah");
    await harusDitolak("tautkan ke pelanggan tidak ada", () => sebagai("owner", () => tautkanLeadKePelanggan(k5.id, "tidak-ada", formulir({}))), "Pelanggan tidak ditemukan");
    await jalankan("K4 tetap dibuat pelanggan baru (abaikanMirip)", () => konversi(k4.id, { abaikanMirip: "1" }));
    pastikan((await db.lead.findUniqueOrThrow({ where: { id: k4.id } })).pelangganId !== null && (await jumlahPelanggan()) === sebelumTaut + 1, "abaikanMirip membuat pelanggan baru");
    await harusDitolak("kode manual sudah dipakai", () => konversi(k5.id, { kode: KODE_P1 }), `Kode pelanggan ${KODE_P1} sudah dipakai PT Uji Mirip Sejahtera`);
    await harusDitolak("kode manual berspasi", () => konversi(k5.id, { kode: "ada spasi" }), "Kode pelanggan maksimal 30 karakter tanpa spasi");
    await jalankan("K5 dengan kode manual", () => konversi(k5.id, { kode: "UJICRM-K5" }));
    pastikan((await db.lead.findUniqueOrThrow({ where: { id: k5.id }, include: { pelanggan: true } })).pelanggan?.kode === "UJICRM-K5", "kode manual dipakai");
    await harusDitolak("konversi lead tidak ada", () => konversi("tidak-ada"), "Lead tidak ditemukan");
    process.env.UJI_PERAN = "ADMIN";
    try {
      // ADMIN memegang lead.ubah; konversi butuh juga data-induk.tulis (D4 §3.16)
      if (!punyaHak("ADMIN", "data-induk.tulis")) await harusDitolak("ADMIN tanpa data-induk.tulis", () => konversiLeadKePelanggan(leadC.id, formulir({})), "tidak punya hak");
      else console.log("[ok] ADMIN memegang data-induk.tulis, kasus tanpa hak tambahan dilewati");
    } finally {
      delete process.env.UJI_PERAN;
    }

    console.log("=== 12. Penawaran dari lead (pustaka; aksi di uji-penawaran-lead P23) ===");
    pastikan((await pastikanLeadUntukPenawaran(db, leadA.id, B)).id === leadA.id && (await pastikanLeadUntukPenawaran(db, leadA.id, null)).id === leadA.id, "lead aktif perusahaan sama diterima; perusahaan null dilewati");
    await harusDitolak("penawaran perusahaan lain", () => pastikanLeadUntukPenawaran(db, leadA.id, "utama"), "Lead milik PT Uji CRM B; penawaran harus atas nama perusahaan yang sama");
    await harusDitolak("penawaran lead tidak ada", () => pastikanLeadUntukPenawaran(db, "tidak-ada", B), "Lead tidak ditemukan atau sudah diarsipkan");

    console.log("=== 13. Arsip dan pulihkan ===");
    const tlArsip = await db.tindakLanjut.create({ data: { perusahaanId: B, leadId: leadA.id, judul: `${AWALAN}TL Arsip`, jatuhTempo: new Date(Date.now() - 3_600_000), ditugaskanKeId: admin.id, dibuatOlehNama: "Uji" } });
    const sekarang = new Date("2026-11-09T05:00:00Z");
    const totalBSebelum = (await statistikCrm(db, sekarang, B)).totalLead;
    const lingkupB = { perusahaanId: B, penggunaId: owner.id };
    await jalankan("arsipkan A", () => sebagai("owner", () => arsipkanLead(leadA.id)));
    const lArsip = await db.lead.findUniqueOrThrow({ where: { id: leadA.id } });
    pastikan(lArsip.dihapusPada !== null && lArsip.dihapusOlehId === owner.id && (await jumlahAktivitas(leadA.id, "DIARSIPKAN")) === 1, "arsip: dihapusPada, dihapusOleh, aktivitas DIARSIPKAN");
    pastikan((await db.logAktivitas.count({ where: { modul: "crm", aksi: "ARSIPKAN", entitasId: leadA.id, keterangan: "PT Uji Lead A; PT Uji CRM B" } })) === 1, "log ARSIPKAN dengan nama usaha dan perusahaan");
    pastikan((await db.lead.count({ where: { AND: [whereLead({}, lingkupB), { id: leadA.id }] } })) === 0 && (await db.lead.count({ where: { AND: [whereLead({ arsip: true }, lingkupB), { id: leadA.id }] } })) === 1, "lead terarsip hilang dari daftar, muncul di ?arsip=1");
    await harusDitolak("arsipkan lagi", () => sebagai("owner", () => arsipkanLead(leadA.id)), "Lead sudah diarsipkan");
    await harusDitolak("ubah lead terarsip", async () => sebagai("owner", async () => ubahLead(leadA.id, await formUbah(leadA.id, { industri: "Lain" }))), "Lead sudah diarsipkan; pulihkan dulu");
    await harusDitolak("pindah tahap lead terarsip", () => pindah(leadA.id, negosiasi.id), "Lead sudah diarsipkan; pulihkan dulu");
    await harusDitolak("catatan lead terarsip", () => sebagai("owner", () => tambahCatatanLead(leadA.id, formulir({ isi: "x" }))), "Lead sudah diarsipkan; pulihkan dulu");
    await harusDitolak("TL baru untuk lead terarsip", () => buatTL({ leadId: leadA.id, ditugaskanKeId: admin.id }), "Lead sudah diarsipkan; pulihkan dulu");
    await harusDitolak("status TL milik lead terarsip", () => statusTL(tl1.id, "SELESAI"), "Lead tindak lanjut ini sudah diarsipkan");
    await harusDitolak("konversi lead terarsip", () => konversi(leadA.id), "Lead sudah diarsipkan; pulihkan dulu");
    await harusDitolak("penawaran dari lead terarsip", () => pastikanLeadUntukPenawaran(db, leadA.id, B), "Lead tidak ditemukan atau sudah diarsipkan");
    await periksaPengingatTindakLanjut(admin.id, new Date(), { paksa: true });
    pastikan((await db.tindakLanjut.findUniqueOrThrow({ where: { id: tlArsip.id } })).diingatkanPada === null && (await jumlahNotif(admin.id, "Tindak lanjut jatuh tempo")) === 0, "pengingat tidak dikirim untuk TL milik lead terarsip");
    pastikan((await statistikCrm(db, sekarang, B)).totalLead === totalBSebelum - 1, "statistik B turun 1");
    pastikan((await cariLead(db, "Lead A", B)).every((l) => l.id !== leadA.id), "cariLead tidak memuat lead terarsip");
    await jalankan("pulihkan A", () => sebagai("owner", () => pulihkanLead(leadA.id)));
    const lPulih = await db.lead.findUniqueOrThrow({ where: { id: leadA.id } });
    pastikan(lPulih.dihapusPada === null && lPulih.dihapusOlehId === null && lPulih.dihapusOlehNama === null && (await jumlahAktivitas(leadA.id, "DIPULIHKAN")) === 1, "pulihkan mengosongkan arsip, aktivitas DIPULIHKAN");
    pastikan((await db.logAktivitas.count({ where: { modul: "crm", aksi: "PULIHKAN", entitasId: leadA.id } })) === 1 && (await statistikCrm(db, sekarang, B)).totalLead === totalBSebelum, "log PULIHKAN, statistik kembali");
    await harusDitolak("pulihkan lead aktif", () => sebagai("owner", () => pulihkanLead(leadA.id)), "Lead tidak sedang diarsipkan");
    pastikan((await cariLead(db, "uji lead a", B)).some((l) => l.id === leadA.id) && (await cariLead(db, "a", B)).length === 0 && (await cariLead(db, "Lead A", C)).length === 0, "cariLead: tanpa beda huruf besar, minimal 2 karakter, ikut lingkup");
    await db.tindakLanjut.delete({ where: { id: tlArsip.id } });

    console.log("=== 14. Pengaturan tahap (B) ===");
    const owner_ = <T>(fn: () => Promise<T>) => sebagai("owner", fn);
    const logTahapAwal = await db.logAktivitas.count({ where: { modul: "crm", jenis: "Tahap Pipeline" } });
    const urutanB = async () => (await db.tahapLead.findMany({ where: { perusahaanId: B }, orderBy: { urutan: "asc" } })).map((t) => `${t.urutan}:${t.nama}`).join(",");
    await jalankan("tambah Survei Lokasi (Berjalan)", () => owner_(() => tambahTahapLead(formulir({ perusahaanId: B, nama: " Survei   Lokasi ", jenis: "BERJALAN" }))));
    const survei = await tahapB("Survei Lokasi");
    pastikan(survei.urutan === 8 && (await tahapB("Menang")).urutan === 9 && (await tahapB("Kalah")).urutan === 10, "Berjalan disisipkan setelah Berjalan terakhir: urutan 8, Menang 9, Kalah 10");
    await harusDitolak("nama tahap ganda", () => owner_(() => tambahTahapLead(formulir({ perusahaanId: B, nama: "survei  lokasi", jenis: "BERJALAN" }))), 'Nama tahap "survei lokasi" sudah dipakai');
    await harusDitolak("jenis tahap salah", () => owner_(() => tambahTahapLead(formulir({ perusahaanId: B, nama: "X", jenis: "LAIN" }))), "Jenis tahap tidak dikenal");
    await harusDitolak("geser Lead Baru naik", async () => owner_(async () => geserTahapLead((await tahapB("Lead Baru")).id, "naik")), "Tahap sudah paling atas");
    await harusDitolak("geser Kalah turun", async () => owner_(async () => geserTahapLead((await tahapB("Kalah")).id, "turun")), "Tahap sudah paling bawah");
    await jalankan("geser Lead Baru turun", async () => owner_(async () => geserTahapLead((await tahapB("Lead Baru")).id, "turun")));
    pastikan((await urutanB()).startsWith("1:Terkualifikasi,2:Lead Baru,"), "Lead Baru turun ke urutan 2");
    await harusDitolak("tahap pertama jadi Menang", async () => owner_(async () => ubahTahapLead((await tahapB("Terkualifikasi")).id, formulir({ nama: "Terkualifikasi", jenis: "MENANG" }))), "Tahap pertama harus berjenis Berjalan");
    await harusDitolak("ubah jenis tahap terpakai", () => owner_(() => ubahTahapLead(dihubungi.id, formulir({ nama: "Dihubungi", jenis: "KALAH" }))), "Jenis tahap Dihubungi tidak bisa diubah karena masih dipakai 1 lead");
    await jalankan("ganti nama Pertemuan", () => owner_(() => ubahTahapLead(pertemuan.id, formulir({ nama: "Meeting Klien", jenis: "BERJALAN" }))));
    const aktPertemuan = await db.aktivitasLead.findFirstOrThrow({ where: { leadId: leadC.id, jenis: "TAHAP_DIUBAH" } });
    pastikan((aktPertemuan.meta as { keNama?: unknown }).keNama === "Pertemuan" && teksAktivitas(aktPertemuan).includes("Pertemuan"), "linimasa lama tetap memuat nama lama");
    await harusDitolak("hapus tahap dipakai lead aktif", () => owner_(() => hapusTahapLead(pertemuan.id)), "Tahap Meeting Klien masih dipakai 1 lead, tidak bisa dihapus");
    const leadD = await leadBernama("D");
    await jalankan("lead D ke Proposal", () => pindah(leadD.id, proposal.id));
    await jalankan("lead D diarsipkan", () => owner_(() => arsipkanLead(leadD.id)));
    await harusDitolak("hapus tahap yang hanya dipakai lead terarsip", () => owner_(() => hapusTahapLead(proposal.id)), "(1 terarsip)");
    await harusDitolak("hapus satu-satunya Kalah", () => owner_(() => hapusTahapLead(kalahB.id)), "Pipeline wajib punya minimal satu tahap Menang dan satu tahap Kalah");
    await jalankan("hapus Survei Lokasi", () => owner_(() => hapusTahapLead(survei.id)));
    const tahapAkhir = await db.tahapLead.findMany({ where: { perusahaanId: B }, orderBy: { urutan: "asc" } });
    pastikan(tahapAkhir.length === 9 && tahapAkhir.every((t, i) => t.urutan === i + 1), "urutan rapat 1..9 sesudah hapus");
    await harusDitolak("hapus tahap tidak ada", () => owner_(() => hapusTahapLead("tidak-ada")), "Tahap tidak ditemukan");
    process.env.UJI_PERAN = "ADMIN";
    try {
      await harusDitolak("ADMIN tambah tahap", () => tambahTahapLead(formulir({ perusahaanId: B, nama: "Tahap ADMIN", jenis: "BERJALAN" })), "tidak punya hak");
      await harusDitolak("ADMIN hapus sumber", () => hapusSumberLead("x"), "tidak punya hak");
    } finally {
      delete process.env.UJI_PERAN;
    }
    pastikan((await db.logAktivitas.count({ where: { modul: "crm", jenis: "Tahap Pipeline" } })) === logTahapAwal + 4, "log Tahap Pipeline = 4 aksi yang lolos (tambah, geser, ubah, hapus)");
    pastikan((await db.logAktivitas.count({ where: { modul: "crm", waktu: { gte: mulaiUji }, jenis: "Tahap Pipeline", aksi: "UBAH", keterangan: `${KODE_B}: nama "Pertemuan" → "Meeting Klien"; jenis Berjalan` } })) === 1, "keterangan log UBAH tahap menyebut kode perusahaan dan rincian");
    const tahapUtamaAkhir = await db.tahapLead.findMany({ where: { perusahaanId: "utama" }, orderBy: { urutan: "asc" }, select: { nama: true, urutan: true } });
    pastikan(JSON.stringify(tahapUtamaAkhir) === JSON.stringify(tahapUtamaAwal), "tahap utama tidak berubah");

    console.log("=== 15. Sumber (B) ===");
    await jalankan("tambah TikTok", () => owner_(() => tambahSumberLead(formulir({ perusahaanId: B, nama: "TikTok" }))));
    await harusDitolak("tambah tiktok lagi", () => owner_(() => tambahSumberLead(formulir({ perusahaanId: B, nama: "tiktok" }))), 'Sumber "tiktok" sudah ada');
    await harusDitolak("nama sumber kosong", () => owner_(() => tambahSumberLead(formulir({ perusahaanId: B, nama: "  " }))), "Nama sumber wajib diisi");
    const tiktok = await db.sumberLead.findFirstOrThrow({ where: { perusahaanId: B, nama: "TikTok" } });
    pastikan(tiktok.urutan === 8, "sumber baru di akhir (urutan maks + 1)");
    const website = await db.sumberLead.findFirstOrThrow({ where: { perusahaanId: B, nama: "Website" } });
    await jalankan("hapus Website (dipakai lead B)", () => owner_(() => hapusSumberLead(website.id)));
    pastikan((await db.lead.findUniqueOrThrow({ where: { id: leadB.id } })).sumber === "Website", "lead.sumber tidak berubah sesudah sumbernya dihapus");
    const sisaSumber = await db.sumberLead.findMany({ where: { perusahaanId: B }, orderBy: { urutan: "asc" } });
    for (const s of sisaSumber.slice(1)) await jalankan(`hapus sumber ${s.nama}`, () => owner_(() => hapusSumberLead(s.id)));
    pastikan((await db.sumberLead.count({ where: { perusahaanId: B } })) === 1, "tersisa satu sumber");
    await harusDitolak("hapus sumber terakhir", () => owner_(() => hapusSumberLead(sisaSumber[0].id)), "Minimal satu sumber lead");

    console.log("=== 16. Statistik (perusahaan C) ===");
    const tahapC = Object.fromEntries((await db.tahapLead.findMany({ where: { perusahaanId: C } })).map((t) => [t.nama, t.id]));
    const leadStat = async (nama: string, tahap: string, nilai: number, picId: string | null, sumber: string, dibuatPada: string, ditutupPada: string | null = null) =>
      db.lead.create({
        data: { perusahaanId: C, nama: AWALAN + nama, namaUsaha: `PT ${nama}`, telepon: "0811", whatsapp: "0811", sumber, picId, nilaiEstimasi: nilai, tahapId: tahapC[tahap], dibuatOlehNama: "Uji", dibuatPada: new Date(dibuatPada), ditutupPada: ditutupPada ? new Date(ditutupPada) : null },
      });
    const L1 = await leadStat("L1", "Lead Baru", 10_000_000, admin.id, "Instagram", "2026-10-31T22:00:00Z");
    await leadStat("L2", "Lead Baru", 5_000_000, admin.id, "Website", "2026-09-15T05:00:00Z");
    await leadStat("L3", "Menang", 20_000_000, admin.id, "Instagram", "2026-06-10T03:00:00Z", "2026-11-02T03:00:00Z");
    await leadStat("L4", "Menang", 30_000_000, owner2.id, "Referensi", "2026-05-20T03:00:00Z", "2026-09-30T18:00:00Z");
    await leadStat("L5", "Kalah", 7_000_000, null, "Instagram", "2026-11-05T03:00:00Z", "2026-11-06T03:00:00Z");
    const L6 = await leadStat("L6 arsip", "Lead Baru", 99_000_000, admin.id, "Instagram", "2026-11-01T03:00:00Z");
    await db.lead.update({ where: { id: L6.id }, data: { dihapusPada: new Date() } });
    const st = await statistikCrm(db, sekarang, C);
    pastikan(st.totalLead === 5 && st.leadBaru30Hari === 2 && st.nilaiPipeline.equals(15_000_000) && st.menang === 2 && st.kalah === 1 && st.nilaiMenang.equals(50_000_000), "total 5, baru 30 hari 2, pipeline 15 jt, menang 2, kalah 1, nilai menang 50 jt");
    pastikan(st.tingkatKonversi.equals(D("40.0")) && st.tingkatClosing.equals(D("66.7")), "tingkat konversi 40,0 dan closing 66,7");
    pastikan(st.kinerjaSales.map((k) => `${k.nama}:${k.lead}:${k.menang}:${k.nilaiMenang.toNumber()}`).join() === `${owner2.nama}:1:1:30000000,${admin.nama}:3:1:20000000,Belum ada PIC:1:0:0`, "kinerja sales urut nilai menang");
    pastikan(st.kinerjaSumber.map((k) => `${k.sumber}:${k.lead}:${k.menang}`).join() === "Instagram:3:1,Referensi:1:1,Website:1:0", "kinerja sumber urut lead");
    pastikan(st.corong.filter((c) => c.jumlah > 0).map((c) => `${c.nama}:${c.jumlah}`).join() === "Lead Baru:2,Menang:2,Kalah:1" && st.corong.length === 9, "corong C: Lead Baru 2, Menang 2, Kalah 1, tahap lain 0");
    pastikan(st.bulanan.map((b) => b.bulan).join() === "2026-06,2026-07,2026-08,2026-09,2026-10,2026-11" && st.bulanan.map((b) => b.dibuat).join() === "1,0,0,1,0,2" && st.bulanan.map((b) => b.menang).join() === "0,0,0,0,1,1", "bulanan Jun-Nov: dibuat 1,0,0,1,0,2; menang 0,0,0,0,1,1 (zona usaha)");
    pastikan(bulanTerakhir(6, new Date("2026-03-31T10:00:00Z")).map((b) => b.bulan).join() === "2025-10,2025-11,2025-12,2026-01,2026-02,2026-03" && bulanTerakhir(6, new Date("2026-01-31T18:00:00Z")).at(-1)?.bulan === "2026-02", "bulanTerakhir: Februari ada; 01.00 WIB 1 Feb masuk Februari");
    const daftarP = await db.perusahaan.findMany({ select: { id: true } });
    const perP = await Promise.all(daftarP.map((p) => statistikCrm(db, sekarang, p.id)));
    const gab = await statistikCrm(db, sekarang, null);
    pastikan(gab.totalLead === perP.reduce((s, x) => s + x.totalLead, 0), "gabungan = Σ per perusahaan");
    const pend = await db.fakturPenjualan.aggregate({ _sum: { dpp: true }, where: { status: "LUNAS", statusPersetujuan: "DISETUJUI" } });
    pastikan(gab.pendapatanLunas.equals(D(pend._sum.dpp ?? 0)) && st.pendapatanLunas.isZero(), "pendapatan lunas gabungan = Σ dpp faktur lunas disetujui; C = 0");
    await db.tindakLanjut.createMany({
      data: [
        { perusahaanId: C, leadId: L1.id, judul: `${AWALAN}TL kemarin`, jatuhTempo: new Date("2026-11-08T05:00:00Z"), ditugaskanKeId: admin.id, dibuatOlehNama: "Uji" },
        { perusahaanId: C, leadId: null, judul: `${AWALAN}TL 12 jam`, jatuhTempo: new Date("2026-11-09T17:00:00Z"), ditugaskanKeId: owner2.id, dibuatOlehNama: "Uji" },
        { perusahaanId: C, leadId: null, judul: `${AWALAN}TL 3 hari`, jatuhTempo: new Date("2026-11-12T05:00:00Z"), ditugaskanKeId: admin.id, dibuatOlehNama: "Uji" },
        { perusahaanId: C, leadId: L6.id, judul: `${AWALAN}TL arsip`, jatuhTempo: new Date("2026-11-08T05:00:00Z"), ditugaskanKeId: admin.id, dibuatOlehNama: "Uji" },
      ],
    });
    const jt = (await statistikCrm(db, sekarang, C)).tindakLanjutJatuhTempo;
    pastikan(jt.map((t) => `${t.judul}:${t.namaLead ?? "-"}:${t.namaPenerima}`).join() === `${AWALAN}TL kemarin:${AWALAN}L1:${admin.nama},${AWALAN}TL 12 jam:-:${owner2.nama}`, "tindak lanjut jatuh tempo: kemarin dan +12 jam urut naik, tanpa +3 hari dan tanpa milik lead terarsip");
    pastikan((await db.lead.findMany({ where: whereLead({ q: "l1" }, { perusahaanId: C, penggunaId: admin.id }) })).length === 1 && (await db.lead.count({ where: whereLead({ pic: "saya" }, { perusahaanId: C, penggunaId: admin.id }) })) === 3, "whereLead: cari teks dan PIC saya");
    pastikan((await db.lead.count({ where: whereLead({ status: "MENANG", sumber: "Instagram" }, { perusahaanId: C, penggunaId: null }) })) === 1 && (await db.lead.count({ where: whereLead({ pic: "tanpa", status: "BUKAN" }, { perusahaanId: C, penggunaId: null }) })) === 1, "whereLead: status, sumber, tanpa PIC; status tidak dikenal diabaikan");
    pastikan((await db.lead.count({ where: whereLead({ tag: " VIP " }, { perusahaanId: null, penggunaId: null }) })) >= 1 && JSON.stringify(urutanLead("nilai")[0]) === '{"nilaiEstimasi":"desc"}' && JSON.stringify(urutanLead("aneh")[0]) === '{"dibuatPada":"desc"}', "whereLead tag utuh; urutan nilai dan nilai lain = terbaru");

    console.log("=== 17. Teks linimasa ===");
    const metaLengkap: Record<JenisAktivitasLead, object> = {
      DIBUAT: { tahapId: "t", tahapNama: "Lead Baru" },
      DIUBAH: { bidang: ["telepon", "picId", "bidangLama"] },
      TAHAP_DIUBAH: { dariNama: "Lead Baru", keNama: "Dihubungi", alasan: "Sudah telepon" },
      MENANG: { dariNama: "Negosiasi", keNama: "Menang", alasan: null },
      KALAH: { dariNama: "Negosiasi", keNama: "Kalah", alasan: "Budget" },
      CATATAN: {},
      TINDAK_LANJUT_DIJADWALKAN: { tindakLanjutId: "x", judul: "Telepon ulang", jatuhTempo: "2026-11-09T07:30:00.000Z" },
      TINDAK_LANJUT_STATUS: { tindakLanjutId: "x", judul: "Telepon ulang", dari: "MENUNGGU", ke: "SELESAI" },
      DIKONVERSI: { pelangganId: "p", kode: "PLG-2026-0001", nama: "PT A", baru: true },
      PENAWARAN_DIBUAT: { penawaranId: "x", nomor: "PNW-2026-0001" },
      DIARSIPKAN: {},
      DIPULIHKAN: {},
    };
    const jenisSemua = Object.keys(LABEL_JENIS_AKTIVITAS) as JenisAktivitasLead[];
    pastikan(jenisSemua.length === 12, "12 jenis aktivitas berlabel");
    for (const jenis of jenisSemua) {
      for (const meta of [metaLengkap[jenis], {}, null, "rusak", [1, 2]]) {
        const t = teksAktivitas({ jenis, meta, isi: jenis === "CATATAN" ? "Isi catatan" : null });
        if (!t || /[\u2013\u2014]/.test(t)) pastikan(false, `teks ${jenis} kosong atau memuat tanda pisah: ${t}`);
      }
    }
    console.log("[ok] teksAktivitas 12 jenis dengan meta lengkap, kosong, dan rusak: tidak kosong, tidak melempar, tanpa em-dash atau en-dash");
    pastikan(teksAktivitas({ jenis: "TAHAP_DIUBAH", meta: metaLengkap.TAHAP_DIUBAH }) === "Tahap diubah: Lead Baru → Dihubungi (alasan: Sudah telepon)" && teksAktivitas({ jenis: "DIUBAH", meta: metaLengkap.DIUBAH }) === "Lead diubah: Telepon, PIC, bidangLama", "teks tahap dan bidang");
    pastikan(teksAktivitas({ jenis: "TINDAK_LANJUT_STATUS", meta: metaLengkap.TINDAK_LANJUT_STATUS }) === 'Tindak lanjut "Telepon ulang" ditandai selesai' && teksAktivitas({ jenis: "DIKONVERSI", meta: { ...metaLengkap.DIKONVERSI, baru: false } }) === "Ditautkan ke pelanggan PLG-2026-0001 PT A", "teks status tindak lanjut dan tautkan");
    pastikan(JSON.stringify(bacaTag(" A ,b, a,,")) === '["a","b"]' && JSON.stringify(bacaFieldTambahan("Nama: x\nnama: y\nLain:")) === '{"nama":"y","Lain":""}', "bacaTag dan bacaFieldTambahan: nama sama tanpa beda huruf besar, yang terakhir menimpa");
    await catatAktivitasLead(db, { leadId: leadB.id, jenis: "CATATAN", isi: "dari skrip", pengguna: { id: "skrip-uji", nama: "Skrip Uji" } });
    pastikan((await db.aktivitasLead.findFirstOrThrow({ where: { leadId: leadB.id, isi: "dari skrip" } })).penggunaId === null, "catatAktivitasLead: pengguna semu disimpan tanpa penggunaId");

    console.log("=== 17b. Perbaikan tinjauan P22 (S1, R1, R3, R4) ===");
    // S1: penerima berganti mengosongkan diingatkanPada, jadi penerima baru tetap diingatkan
    const notifPengingat = (penggunaId: string, judul: string) => db.notifikasi.count({ where: { penggunaId, judul: "Tindak lanjut jatuh tempo", isi: judul } });
    const judulS1 = `${AWALAN}TL S1`;
    const ubahS1 = (nama: string, penerimaId: string, jatuhTempo = "2026-01-05T09:00") =>
      sebagai(nama, () => ubahTindakLanjut(tlS1.id, formulir({ judul: judulS1, jatuhTempo, ditugaskanKeId: penerimaId })));
    await jalankan("TL lewat jatuh tempo untuk admin", () => buatTL({ judul: judulS1, perusahaanId: B, jatuhTempo: "2026-01-05T09:00", ditugaskanKeId: admin.id }));
    const tlS1 = await db.tindakLanjut.findFirstOrThrow({ where: { judul: judulS1 } });
    await periksaPengingatTindakLanjut(admin.id, new Date(), { paksa: true });
    pastikan((await notifPengingat(admin.id, judulS1)) === 1 && (await db.tindakLanjut.findUniqueOrThrow({ where: { id: tlS1.id } })).diingatkanPada !== null, "S1: admin diingatkan sekali, diingatkanPada terisi");
    await jalankan("alihkan TL ke owner2 tanpa mengubah jatuh tempo", () => ubahS1("owner", owner2.id));
    pastikan((await db.tindakLanjut.findUniqueOrThrow({ where: { id: tlS1.id } })).diingatkanPada === null, "S1: penerima berganti mengosongkan diingatkanPada walau jatuh tempo sama");
    await periksaPengingatTindakLanjut(owner2.id, new Date(), { paksa: true });
    pastikan((await notifPengingat(owner2.id, judulS1)) === 1 && (await notifPengingat(admin.id, judulS1)) === 1, "S1: owner2 (penerima baru) mendapat 1 pengingat, admin tetap 1");
    const dialihkanOwner = await jumlahNotif(owner.id, "Tindak lanjut dialihkan ke Anda");
    await jalankan("owner mengalihkan TL ke dirinya sendiri", () => ubahS1("owner", owner.id));
    await periksaPengingatTindakLanjut(owner.id, new Date(), { paksa: true });
    pastikan((await jumlahNotif(owner.id, "Tindak lanjut dialihkan ke Anda")) === dialihkanOwner && (await notifPengingat(owner.id, judulS1)) === 1, "S1: pelaku yang mengalihkan ke dirinya tidak mendapat notifikasi dialihkan, tetapi tetap mendapat pengingat");
    await jalankan("ubah TL tanpa mengganti penerima dan jatuh tempo", () => ubahS1("owner", owner.id));
    pastikan((await db.tindakLanjut.findUniqueOrThrow({ where: { id: tlS1.id } })).diingatkanPada !== null, "S1 kontrol: penerima dan jatuh tempo sama, diingatkanPada tetap");

    // R3: PIC dan penerima pengingat yang kehilangan lead.lihat tidak diberi tahu
    const kalahAwalAdmin = await jumlahNotif(admin.id, "Deal kalah: ");
    const menangAwalAdmin = await jumlahNotif(admin.id, "Deal menang: ");
    const judulR3 = `${AWALAN}TL R3`;
    await jalankan("TL lewat jatuh tempo untuk admin (R3)", () => buatTL({ judul: judulR3, perusahaanId: B, jatuhTempo: "2026-01-05T09:00", ditugaskanKeId: admin.id }));
    await db.hakAksesPeran.create({ data: { peran: "ADMIN", hak: "lead.lihat", boleh: false } });
    try {
      pastikan(k1.picId === admin.id, "lead K1 ber-PIC admin");
      await jalankan("K1 ke Kalah saat ADMIN tanpa lead.lihat", () => pindah(k1.id, kalahB.id, "Uji R3"));
      pastikan((await jumlahNotif(admin.id, "Deal kalah: ")) === kalahAwalAdmin && (await jumlahAktivitas(k1.id, "KALAH")) === 1, "R3: PIC tanpa lead.lihat tidak mendapat Deal kalah, pindah tahap tetap tercatat");
      pastikan((await periksaPengingatTindakLanjut(admin.id, new Date(), { paksa: true })) === 0, "R3: periksaPengingatTindakLanjut untuk penerima tanpa lead.lihat: 0");
      pastikan((await notifPengingat(admin.id, judulR3)) === 0 && (await db.tindakLanjut.findFirstOrThrow({ where: { judul: judulR3 } })).diingatkanPada === null, "R3: TL tidak diklaim, jadi bisa diingatkan bila hak kembali");
    } finally {
      await db.hakAksesPeran.deleteMany({ where: { peran: "ADMIN", hak: "lead.lihat" } });
    }
    await jalankan("K1 kembali ke Dihubungi", () => pindah(k1.id, dihubungi.id));
    await jalankan("K1 ke Menang (hak ADMIN pulih)", () => pindah(k1.id, menangB.id));
    pastikan((await jumlahNotif(admin.id, "Deal menang: ")) === menangAwalAdmin + 1, "R3 kontrol: PIC dengan lead.lihat mendapat Deal menang");
    await periksaPengingatTindakLanjut(admin.id, new Date(), { paksa: true });
    pastikan((await notifPengingat(admin.id, judulR3)) === 1, "R3 kontrol: sesudah hak pulih, pengingat TL R3 terkirim sekali");
    await db.tindakLanjut.create({ data: { perusahaanId: B, judul: `${AWALAN}TL R3 nonaktif`, jatuhTempo: new Date("2026-01-05T02:00:00Z"), ditugaskanKeId: nonaktif.id, dibuatOlehNama: "Uji" } });
    pastikan((await periksaPengingatTindakLanjut(nonaktif.id, new Date(), { paksa: true })) === 0 && (await db.tindakLanjut.findFirstOrThrow({ where: { judul: `${AWALAN}TL R3 nonaktif` } })).diingatkanPada === null, "R3: penerima nonaktif tidak diingatkan dan TL tidak diklaim");

    // R1: buatLead dan tambah tahap atau sumber serentak di perusahaan yang belum pernah membuka CRM
    for (let i = 1; i <= 4; i++) {
      const kode = `${AWALAN_KODE_R1}${i}`;
      const R = (await db.perusahaan.create({ data: { kode, nama: `PT Uji CRM R${i}`, urutan: 99 } })).id;
      const pengaturan = i % 2 ? () => tambahTahapLead(formulir({ perusahaanId: R, nama: "Survei", jenis: "BERJALAN" })) : () => tambahSumberLead(formulir({ perusahaanId: R, nama: "TikTok" }));
      const kerja = [() => buatLead(formLead({ perusahaanId: R, nama: `${AWALAN}R${i}`, namaUsaha: `PT Uji R${i}` })), pengaturan];
      if (i > 2) kerja.reverse();
      const hasil = await sebagai("owner", () =>
        Promise.allSettled(
          kerja.map(async (k) => {
            try {
              await k();
            } catch (e) {
              const digest = (e as { digest?: string })?.digest ?? "";
              if (!digest.startsWith("NEXT_REDIRECT") && !String((e as Error)?.message ?? "").includes("static generation store missing")) throw e;
            }
          }),
        ),
      );
      const galatR1 = hasil.filter((h): h is PromiseRejectedResult => h.status === "rejected").map((h) => (h.reason as Error).message);
      const tahapR = await db.tahapLead.count({ where: { perusahaanId: R } });
      const sumberR = await db.sumberLead.count({ where: { perusahaanId: R } });
      pastikan(
        galatR1.length === 0 && (await db.lead.count({ where: { perusahaanId: R } })) === 1 && tahapR === TAHAP_BAWAAN.length + (i % 2) && sumberR === SUMBER_BAWAAN.length + (1 - (i % 2)),
        `R1 putaran ${i}: buatLead dan ${i % 2 ? "tambah tahap" : "tambah sumber"} serentak keduanya berhasil tanpa deadlock (tahap ${tahapR}, sumber ${sumberR}) ${JSON.stringify(galatR1)}`,
      );
    }
    pastikan(process.env.UJI_PENGGUNA === undefined, "UJI_PENGGUNA dipulihkan sesudah uji serentak R1");

    // R4: kode manual berpola otomatis ditolak; nomor otomatis yang habis memberi pesan jelas
    await buatLeadK("K6", { namaUsaha: "CV Konversi Uji Enam", telepon: "0811 7777 6001", whatsapp: "0811 7777 6002", sumber: sisaSumber[0].nama });
    const k6 = await leadBernama("K6");
    const tahunUsaha = (await kodePelangganBerikutnya(db)).slice(4, 8);
    await harusDitolak("kode manual PLG-tahun-999999999", () => konversi(k6.id, { kode: `PLG-${tahunUsaha}-999999999` }), "Kode berpola PLG-tahun-nomor dipakai penomoran otomatis");
    await harusDitolak("kode manual PLG-tahun-0001", () => konversi(k6.id, { kode: "PLG-2020-0001" }), "Kode berpola PLG-tahun-nomor dipakai penomoran otomatis");
    pastikan((await db.lead.findUniqueOrThrow({ where: { id: k6.id } })).pelangganId === null, "R4: lead K6 belum dikonversi sesudah kode ditolak");
    // kode itu tetap bisa dibuat dari Data Induk (di luar CRM): nomor otomatis berikutnya ditolak dengan pesan jelas
    const plgMaks = await db.pelanggan.create({ data: { kode: `PLG-${tahunUsaha}-999999999`, nama: "Pelanggan Uji Kode Maks", namaKontak: `${AWALAN}Maks` } });
    try {
      await harusDitolak("kodePelangganBerikutnya sesudah 999999999", () => kodePelangganBerikutnya(db), `Nomor kode pelanggan otomatis PLG-${tahunUsaha}- sudah habis karena ada pelanggan berkode PLG-${tahunUsaha}-999999999`);
      await harusDitolak("konversi otomatis sesudah 999999999", () => konversi(k6.id), "sudah habis");
      await jalankan("konversi K6 dengan kode manual lain", () => konversi(k6.id, { kode: "UJICRM-K6" }));
      pastikan((await db.lead.findUniqueOrThrow({ where: { id: k6.id }, include: { pelanggan: true } })).pelanggan?.kode === "UJICRM-K6", "R4: kode manual lain tetap diterima");
    } finally {
      await db.pelanggan.delete({ where: { id: plgMaks.id } });
    }
    pastikan(/^PLG-\d{4}-\d{4,}$/.test(await kodePelangganBerikutnya(db)), "R4: sesudah kode maks dihapus, nomor otomatis kembali normal");

    console.log("=== 18. Akhir ===");
    const sinkronAkhir = await periksaSinkron(db);
    pastikan(sinkronAkhir.seimbang && JSON.stringify(sinkronAkhir) === JSON.stringify(sinkronAwal), "periksaSinkron seimbang dan sama dengan awal");
    pastikan((await db.jurnal.count()) === jurnalAwal, "CRM tidak membuat jurnal (jumlah jurnal sama)");
  } finally {
    console.log("=== 19. Bersih-bersih ===");
    await bersihkan(mulaiUji);
  }
  pastikan((await db.perusahaan.count({ where: { kode: { in: [KODE_B, KODE_C] } } })) === 0 && (await db.lead.count({ where: { nama: { startsWith: AWALAN } } })) === 0, "perusahaan dan lead uji terhapus");
  pastikan((await db.pelanggan.count({ where: { OR: [{ kode: KODE_P1 }, { namaKontak: { startsWith: AWALAN } }] } })) === 0 && (await db.tindakLanjut.count({ where: { judul: { startsWith: AWALAN } } })) === 0, "pelanggan dan tindak lanjut uji terhapus");
  pastikan((await db.pengguna.count({ where: { namaPengguna: NONAKTIF } })) === 0 && (await db.karyawan.count({ where: { kode: KODE_KARYAWAN } })) === 0 && (await db.hakAksesPeran.count()) === 0, "pengguna dan karyawan uji terhapus, HakAksesPeran kosong");
  console.log("=== DONE, all crm checks passed ===");
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
