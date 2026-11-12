import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { penggunaDenganHak } from "../src/lib/notifikasi";
import { mintaAturUlang, mintaAturUlangFormulir } from "../src/lib/aksi/otentikasi";
import { buatTautanAturUlang, tolakPermintaanAturUlang } from "../src/lib/aksi/pengguna";
import { jalankan, formulir, pastikan } from "./bantuan";

/*
 * Notifikasi lonceng untuk permintaan lupa kata sandi: permintaan baru memberi tahu semua pengguna aktif pemegang
 * pengguna.kelola. Nama pengguna tidak dikenal, akun nonaktif, dan permintaan yang tidak digandakan tidak memicu
 * notifikasi, respons ke peminta selalu sama, dan galat notifikasi tidak menggagalkan permintaan.
 */

const AWALAN = "uji-lksn-";
const JUDUL = "Permintaan atur ulang kata sandi";
const TAUTAN = "/pengaturan/pengguna";

async function bersihkan(mulaiUji: Date) {
  const sementara = await db.pengguna.findMany({ where: { namaPengguna: { startsWith: AWALAN } }, select: { id: true } });
  const idSementara = sementara.map((p) => p.id);
  const permintaan = await db.permintaanAturUlang.findMany({ where: { penggunaId: { in: idSementara } }, select: { id: true } });
  await db.notifikasi.deleteMany({ where: { kunci: { in: permintaan.map((p) => `atur-ulang:${p.id}`) } } });
  await db.permintaanAturUlang.deleteMany({ where: { penggunaId: { in: idSementara } } });
  await db.pengguna.deleteMany({ where: { id: { in: idSementara } } });
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji }, jenis: "Kata Sandi" } });
}

async function notifikasiPermintaan(permintaanId: string) {
  return db.notifikasi.findMany({ where: { kunci: `atur-ulang:${permintaanId}` }, orderBy: { penggunaId: "asc" } });
}

async function main() {
  const mulaiUji = new Date();
  await bersihkan(mulaiUji);

  const buat = (namaPengguna: string, nama: string, peran: "KASIR" | "ADMIN", aktif = true) =>
    db.pengguna.create({ data: { namaPengguna: AWALAN + namaPengguna, nama, peran, aktif, kataSandiHash: "uji-bukan-hash" } });
  const peminta = await buat("peminta", "Peminta Uji Lupa", "KASIR");
  const peminta2 = await buat("peminta2", "Peminta Kedua Uji", "KASIR");
  const adminUji = await buat("admin", "Admin Uji Lupa", "ADMIN");
  await buat("nonaktif", "Nonaktif Uji Lupa", "KASIR", false);
  const seed = Object.fromEntries(
    (await db.pengguna.findMany({ where: { namaPengguna: { in: ["superadmin", "owner", "owner2", "admin", "kasir"] } } })).map((p) => [p.namaPengguna, p]),
  );

  try {
    console.log("=== 1. Tanpa notifikasi untuk akun tidak dikenal dan nonaktif ===");
    const sebelum = await db.notifikasi.count({ where: { judul: JUDUL, dibuatPada: { gte: mulaiUji } } });
    await jalankan("nama pengguna tidak dikenal", () => mintaAturUlang(formulir({ namaPengguna: AWALAN + "tidak-ada" })));
    await jalankan("akun nonaktif", () => mintaAturUlang(formulir({ namaPengguna: AWALAN + "nonaktif" })));
    pastikan((await db.notifikasi.count({ where: { judul: JUDUL, dibuatPada: { gte: mulaiUji } } })) === sebelum, "tidak ada notifikasi untuk akun tidak dikenal atau nonaktif");

    console.log("=== 2. Permintaan baru memberi tahu pemegang pengguna.kelola ===");
    await jalankan("peminta minta atur ulang", () => mintaAturUlang(formulir({ namaPengguna: (AWALAN + "PEMINTA").toUpperCase() })));
    const p = await db.permintaanAturUlang.findFirstOrThrow({ where: { penggunaId: peminta.id, status: "MENUNGGU" } });
    const notif = await notifikasiPermintaan(p.id);
    const penerima = new Set(notif.map((n) => n.penggunaId));
    const harapan = new Set((await penggunaDenganHak(db, "pengguna.kelola")).map((x) => x.id).filter((id) => id !== peminta.id));
    pastikan(harapan.size > 0 && penerima.size === harapan.size && [...harapan].every((id) => penerima.has(id)), `penerima = semua pemegang pengguna.kelola (${harapan.size})`);
    pastikan(notif.length === penerima.size, "satu notifikasi per penerima");
    for (const nama of ["superadmin", "owner", "owner2"]) pastikan(penerima.has(seed[nama].id), `${nama} menerima notifikasi`);
    pastikan(!penerima.has(seed.kasir.id), "KASIR seed tidak menerima notifikasi");
    pastikan(!penerima.has(peminta.id), "peminta (KASIR) tidak menerima notifikasi");
    // ADMIN tidak memegang pengguna.kelola secara bawaan; di basis data yang memberinya lewat Hak Akses, ADMIN ikut menerima
    const adminBerhak = harapan.has(adminUji.id);
    pastikan(penerima.has(seed.admin.id) === adminBerhak && penerima.has(adminUji.id) === adminBerhak, `ADMIN menerima hanya bila memegang pengguna.kelola (berhak: ${adminBerhak})`);
    const n0 = notif[0];
    pastikan(notif.every((n) => n.judul === JUDUL && n.tautan === TAUTAN && n.jenis === "PERSETUJUAN" && n.perusahaanId === null && !n.dibaca), "judul, tautan /pengaturan/pengguna, jenis PERSETUJUAN, tanpa perusahaan");
    pastikan(n0.isi?.includes("Peminta Uji Lupa") && n0.isi.includes(AWALAN + "peminta"), `isi memuat nama dan nama pengguna: "${n0.isi}"`);

    console.log("=== 3. Permintaan ganda tidak memicu notifikasi ===");
    await jalankan("peminta minta lagi", () => mintaAturUlang(formulir({ namaPengguna: AWALAN + "peminta" })));
    pastikan((await db.permintaanAturUlang.count({ where: { penggunaId: peminta.id } })) === 1, "permintaan tidak digandakan");
    pastikan((await db.notifikasi.count({ where: { judul: JUDUL, dibuatPada: { gte: mulaiUji } } })) === sebelum + notif.length, "tidak ada notifikasi tambahan untuk permintaan ganda");

    console.log("=== 4. Respons ke peminta selalu sama ===");
    const r = {
      tidakAda: await mintaAturUlangFormulir({ galat: null }, formulir({ namaPengguna: AWALAN + "tidak-ada" })),
      nonaktif: await mintaAturUlangFormulir({ galat: null }, formulir({ namaPengguna: AWALAN + "nonaktif" })),
      baru: await mintaAturUlangFormulir({ galat: null }, formulir({ namaPengguna: AWALAN + "peminta2" })),
      ganda: await mintaAturUlangFormulir({ galat: null }, formulir({ namaPengguna: AWALAN + "peminta2" })),
    };
    const teks = JSON.stringify(r.tidakAda);
    pastikan(Object.values(r).every((x) => JSON.stringify(x) === teks), `respons identik untuk akun tidak ada, nonaktif, baru, dan ganda: ${teks}`);
    const p2 = await db.permintaanAturUlang.findFirstOrThrow({ where: { penggunaId: peminta2.id, status: "MENUNGGU" } });
    pastikan((await notifikasiPermintaan(p2.id)).length === notif.length, "permintaan baru lewat formulir juga memberi tahu");

    console.log("=== 5. Tautan notifikasi tetap sah sesudah tautan dibuat atau permintaan ditolak ===");
    await jalankan("buat tautan", () => buatTautanAturUlang(p.id));
    await jalankan("tolak permintaan kedua", () => tolakPermintaanAturUlang(p2.id));
    const sesudah = [...(await notifikasiPermintaan(p.id)), ...(await notifikasiPermintaan(p2.id))];
    pastikan(sesudah.length === notif.length * 2 && sesudah.every((n) => n.tautan === TAUTAN), "notifikasi tetap ada dan menaut /pengaturan/pengguna");

    console.log("=== 6. Galat notifikasi tidak menggagalkan permintaan ===");
    await db.permintaanAturUlang.updateMany({ where: { penggunaId: peminta2.id, status: "MENUNGGU" }, data: { status: "DITOLAK" } });
    const delegasi = db.notifikasi as unknown as { createMany: unknown };
    const asli = delegasi.createMany;
    const errorAsli = console.error;
    const tercatat: unknown[][] = [];
    delegasi.createMany = async () => { throw new Error("galat notifikasi buatan uji"); };
    console.error = (...args: unknown[]) => { tercatat.push(args); };
    let respons: unknown;
    try {
      respons = await mintaAturUlangFormulir({ galat: null }, formulir({ namaPengguna: AWALAN + "peminta2" }));
    } finally {
      delegasi.createMany = asli;
      console.error = errorAsli;
    }
    pastikan(JSON.stringify(respons) === teks, "respons tetap sama walau notifikasi gagal");
    const p4 = await db.permintaanAturUlang.findFirst({ where: { penggunaId: peminta2.id, status: "MENUNGGU" } });
    pastikan(p4 !== null, "permintaan tetap tersimpan");
    pastikan((await notifikasiPermintaan(p4.id)).length === 0, "tidak ada notifikasi untuk permintaan itu");
    pastikan(tercatat.some((a) => a[0] === "[notifikasi atur ulang]"), "galat dicatat di log server");
  } finally {
    console.log("=== Bersih-bersih ===");
    await bersihkan(mulaiUji);
  }
  pastikan((await db.pengguna.count({ where: { namaPengguna: { startsWith: AWALAN } } })) === 0, "pengguna sementara terhapus");
  console.log("=== DONE, all lupa kata sandi notifikasi checks passed ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
