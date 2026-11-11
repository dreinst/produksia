import { db } from "@/lib/db";
import type { Prisma } from "@/prisma-klien/client";
import { hitungHakPengguna, punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { kirimNotifikasi } from "@/lib/notifikasi";
import { formatTanggal, tanggalIso } from "@/lib/waktu";

/*
 * Pengingat jatuh tempo tanpa cron (D7 §3.4.5, D4 §3.5): diperiksa malas saat lonceng memuat GET /api/notifikasi
 * dan saat halaman /notifikasi dirender. Pembatas 60 detik per pengguna disimpan di memori proses (server satu
 * proses); kebenaran tidak bergantung padanya karena faktur memakai kunci unik dan tindak lanjut memakai klaim
 * bersyarat per baris. Berkas ini membaca TindakLanjut langsung dan tidak mengimpor crm.ts (DESAIN L3).
 */

const ID_SKRIP_UJI = "skrip-uji";
export const JEDA_PENGINGAT_MS = 60_000;
/** Paling banyak sekian pengingat per jenis per pemeriksaan (DESAIN R-15: faktur lama tidak membanjiri lonceng). */
export const BATAS_PENGINGAT = 50;
export const AWALAN_KUNCI_FAKTUR = "jatuh-tempo:faktur:";

type OpsiPengingat = { paksa?: boolean; sekarang?: Date };

const terakhirPengingat = new Map<string, number>();
const terakhirTindakLanjut = new Map<string, number>();

/** true bila pemeriksaan boleh jalan sekarang; setiap pemeriksaan (termasuk paksa) mencatat waktunya. */
function lewatPembatas(peta: Map<string, number>, penggunaId: string, paksa: boolean): boolean {
  const kini = Date.now();
  const lalu = peta.get(penggunaId);
  if (!paksa && lalu !== undefined && kini - lalu < JEDA_PENGINGAT_MS) return false;
  peta.set(penggunaId, kini);
  return true;
}

/**
 * Notifikasi "Faktur jatuh tempo" untuk faktur yang diajukan pengguna, sekali per faktur. Faktur yang sudah
 * diingatkan disaring dengan NOT EXISTS di basis data, jadi ukuran kueri tidak tumbuh bersama riwayat notifikasi.
 */
async function pengingatFaktur(pengguna: PenggunaSesi, sekarang: Date): Promise<number> {
  if (!punyaHak(pengguna, "faktur.lihat")) return 0;
  const batasAtas = new Date(sekarang.getTime() + 86_400_000);
  const calon = await db.$queryRaw<{ id: string }[]>`
    SELECT f."id" FROM "FakturPenjualan" f
    WHERE f."diajukanOlehId" = ${pengguna.id}
      AND f."statusPersetujuan" = 'DISETUJUI'
      AND f."status" NOT IN ('LUNAS', 'DIBATALKAN')
      AND f."jatuhTempo" <= ${batasAtas}
      AND NOT EXISTS (SELECT 1 FROM "Notifikasi" n WHERE n."penggunaId" = ${pengguna.id} AND n."kunci" = ${AWALAN_KUNCI_FAKTUR} || f."id")
    ORDER BY f."jatuhTempo" ASC, f."id" ASC
    LIMIT ${BATAS_PENGINGAT}`;
  if (calon.length === 0) return 0;
  const daftar = await db.fakturPenjualan.findMany({
    where: { id: { in: calon.map((c) => c.id) } },
    select: { id: true, nomor: true, jatuhTempo: true, perusahaanId: true, pelanggan: { select: { nama: true } } },
    orderBy: [{ jatuhTempo: "asc" }, { id: "asc" }],
  });
  const hariIni = tanggalIso(sekarang);
  let jumlah = 0;
  for (const f of daftar) {
    if (!f.jatuhTempo || tanggalIso(f.jatuhTempo) > hariIni) continue;
    jumlah += await kirimNotifikasi(db, {
      penggunaIds: [pengguna.id],
      judul: "Faktur jatuh tempo",
      isi: `${f.nomor} · ${f.pelanggan.nama} · jatuh tempo ${formatTanggal(f.jatuhTempo)}`,
      tautan: "/penjualan/faktur",
      jenis: "JATUH_TEMPO",
      perusahaanId: f.perusahaanId,
      kunci: `${AWALAN_KUNCI_FAKTUR}${f.id}`,
    });
  }
  return jumlah;
}

/**
 * Penerima masih aktif dan memegang lead.lihat menurut data tersimpan (peran utama, peran tambahan, dan penyesuaian
 * Hak Akses). Peran bisa berganti sesudah tindak lanjut ditugaskan, jadi hak saat penugasan tidak cukup (tinjauan
 * P22 R3). Rumusnya sama dengan pastikanPenggunaCrm di crm.ts, ditulis ulang di sini karena berkas ini tidak
 * mengimpor crm.ts (DESAIN L3).
 */
async function penerimaBolehLihatLead(penggunaId: string): Promise<boolean> {
  const p = await db.pengguna.findUnique({ where: { id: penggunaId }, select: { aktif: true, peran: true, peranTambahan: true } });
  if (!p?.aktif) return false;
  const penyesuaian = await db.hakAksesPeran.findMany({ where: { peran: { in: [p.peran, ...p.peranTambahan] } }, select: { peran: true, hak: true, boleh: true } });
  return hitungHakPengguna(p.peran, p.peranTambahan, penyesuaian).includes("lead.lihat");
}

/**
 * Pengingat tindak lanjut CRM yang sudah jatuh tempo milik penerimanya (D4 §3.5), lintas perusahaan, tanpa
 * tindak lanjut milik lead terarsip. Tiap baris diklaim atomik (diingatkanPada diisi bersyarat) di transaksi yang
 * sama dengan notifikasinya, jadi dua permintaan serentak tidak menggandakan. Penerima yang nonaktif atau tidak lagi
 * memegang lead.lihat tidak diingatkan dan barisnya tidak diklaim, jadi pengingat tetap terkirim bila haknya kembali.
 * Mengembalikan jumlah notifikasi.
 */
export async function periksaPengingatTindakLanjut(penggunaId: string | null | undefined, sekarang = new Date(), opsi: { paksa?: boolean } = {}): Promise<number> {
  if (!penggunaId || penggunaId === ID_SKRIP_UJI) return 0;
  if (!lewatPembatas(terakhirTindakLanjut, penggunaId, !!opsi.paksa)) return 0;
  if (!(await penerimaBolehLihatLead(penggunaId))) return 0;
  // Syarat yang sama dipakai saat membaca dan saat mengklaim, supaya perubahan penerima, jatuh tempo, atau arsip
  // lead di antara keduanya tidak menghasilkan pengingat untuk keadaan lama.
  const syarat = {
    ditugaskanKeId: penggunaId,
    status: "MENUNGGU",
    diingatkanPada: null,
    jatuhTempo: { lte: sekarang },
    OR: [{ leadId: null }, { lead: { dihapusPada: null } }],
  } satisfies Prisma.TindakLanjutWhereInput;
  const daftar = await db.tindakLanjut.findMany({
    where: syarat,
    select: { id: true, judul: true, perusahaanId: true, lead: { select: { nama: true } } },
    orderBy: [{ jatuhTempo: "asc" }, { id: "asc" }],
    take: BATAS_PENGINGAT,
  });
  let jumlah = 0;
  for (const t of daftar) {
    jumlah += await db.$transaction(async (tx) => {
      const klaim = await tx.tindakLanjut.updateMany({ where: { id: t.id, ...syarat }, data: { diingatkanPada: sekarang } });
      if (klaim.count !== 1) return 0;
      return kirimNotifikasi(tx, {
        penggunaIds: [penggunaId],
        judul: "Tindak lanjut jatuh tempo",
        isi: t.lead ? `${t.judul} · ${t.lead.nama}` : t.judul,
        // Rute /crm baru lahir di P32; sampai itu tautan kosong sehingga notifikasi dibuka ke /notifikasi.
        // P32 mengisinya: t.leadId ? `/crm/lead/${t.leadId}` : "/crm/tindak-lanjut" (D4 §3.14).
        tautan: null,
        jenis: "TINDAK_LANJUT",
        perusahaanId: t.perusahaanId,
      });
    });
  }
  return jumlah;
}

/**
 * Semua pengingat untuk satu pengguna: faktur jatuh tempo dan tindak lanjut. Tiap penyedia dibungkus try/catch
 * supaya lonceng dan halaman notifikasi tidak pernah gagal karena pengingat. Mengembalikan jumlah notifikasi baru.
 */
export async function periksaPengingat(pengguna: PenggunaSesi, opsi: OpsiPengingat = {}): Promise<number> {
  if (!pengguna.id || pengguna.id === ID_SKRIP_UJI) return 0;
  const paksa = !!opsi.paksa;
  if (!lewatPembatas(terakhirPengingat, pengguna.id, paksa)) return 0;
  const sekarang = opsi.sekarang ?? new Date();
  let jumlah = 0;
  try {
    jumlah += await pengingatFaktur(pengguna, sekarang);
  } catch (galat) {
    console.error("[pengingat]", galat);
  }
  // Tindak lanjut memuat nama lead, jadi hanya untuk pemegang lead.lihat (D4 §3.5), sama seperti faktur.lihat di atas
  if (punyaHak(pengguna, "lead.lihat")) {
    try {
      jumlah += await periksaPengingatTindakLanjut(pengguna.id, sekarang, { paksa });
    } catch (galat) {
      console.error("[pengingat]", galat);
    }
  }
  return jumlah;
}
