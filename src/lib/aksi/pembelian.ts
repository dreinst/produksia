"use server";

import { wajibHakAksi } from "@/lib/otentikasi";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { D, format, uang, kali, bacaUang, jumlahkan, type Desimal } from "@/lib/uang";
import { kurangiStok, tambahStok, labelBarang } from "@/lib/stok";
import {
  catatJurnalFakturPembelian,
  catatJurnalPembayaranPembelian,
  catatJurnalReturPembelian,
} from "@/lib/akuntansi";

type BarisInput = { barangId: string; jumlah: Desimal; harga: Desimal };

function bacaJson(raw: FormDataEntryValue | null, pesanKosong: string): unknown[] {
  if (typeof raw !== "string" || !raw) throw new Error(pesanKosong);
  let hasilBaca: unknown;
  try {
    hasilBaca = JSON.parse(raw);
  } catch {
    throw new Error("Format baris barang tidak valid");
  }
  if (!Array.isArray(hasilBaca)) throw new Error(pesanKosong);
  return hasilBaca;
}

function bacaBaris(dataFormulir: FormData): BarisInput[] {
  const hasilBaca = bacaJson(dataFormulir.get("baris"), "Minimal 1 baris barang wajib diisi") as {
    barangId?: string;
    jumlah?: string | number;
    harga?: string | number;
  }[];
  const daftarBaris = hasilBaca
    .filter((l) => l.barangId)
    .map((l) => ({ barangId: String(l.barangId), jumlah: uang(l.jumlah), harga: uang(l.harga) }))
    .filter((l) => l.jumlah.gt(0));
  if (daftarBaris.length === 0) throw new Error("Minimal 1 baris barang dengan jumlah > 0 wajib diisi");
  if (daftarBaris.some((l) => l.harga.isNegative())) throw new Error("Harga tidak boleh negatif");
  return daftarBaris;
}

function bacaBarisJumlah<T extends { barangId?: string; jumlah?: string | number }>(
  dataFormulir: FormData,
  pesanKosong: string,
): (T & { jumlah: Desimal })[] {
  const hasilBaca = bacaJson(dataFormulir.get("baris"), pesanKosong) as T[];
  const daftarBaris = hasilBaca.filter((l) => l.barangId).map((l) => ({ ...l, jumlah: uang(l.jumlah) })).filter((l) => l.jumlah.gt(0));
  if (daftarBaris.length === 0) throw new Error(pesanKosong);
  return daftarBaris;
}

function totalBaris(daftarBaris: BarisInput[]): Desimal {
  return jumlahkan(daftarBaris.map((l) => kali(l.jumlah, l.harga)));
}

// ---------- Pesanan Pembelian ----------

export async function buatPesananPembelian(dataFormulir: FormData) {
  await wajibHakAksi("pembelian.tulis");
  const pemasokId = String(dataFormulir.get("pemasokId") ?? "");
  if (!pemasokId) throw new Error("Pemasok wajib dipilih");
  const daftarBaris = bacaBaris(dataFormulir);
  const total = totalBaris(daftarBaris);

  const nomor = await nomorDokumenBerikutnya(db.pesananPembelian, "PSB");

  await db.pesananPembelian.create({
    data: {
      nomor,
      pemasokId,
      total,
      baris: { create: daftarBaris.map((l) => ({ barangId: l.barangId, jumlah: l.jumlah, harga: l.harga })) },
    },
  });

  revalidatePath("/pembelian/pesanan");
  redirect("/pembelian/pesanan");
}

// ---------- Penerimaan Barang ----------

export async function buatPenerimaanBarang(dataFormulir: FormData) {
  await wajibHakAksi("pembelian.terima");
  const pesananId = String(dataFormulir.get("pesananId") ?? "");
  const gudangId = String(dataFormulir.get("gudangId") ?? "");
  if (!pesananId) throw new Error("Pesanan wajib dipilih");
  if (!gudangId) throw new Error("Gudang wajib dipilih");

  const daftarBaris = bacaBarisJumlah<{ barisPesananId: string; barangId: string; jumlah: string | number }>(
    dataFormulir,
    "Minimal 1 baris barang wajib diterima",
  );

  const pesanan = await db.pesananPembelian.findUniqueOrThrow({ where: { id: pesananId }, include: { baris: true } });

  for (const l of daftarBaris) {
    const barisPesanan = pesanan.baris.find((ol) => ol.id === l.barisPesananId);
    if (!barisPesanan) throw new Error("Baris pesanan tidak ditemukan");
    const sisa = D(barisPesanan.jumlah).minus(barisPesanan.jumlahDiterima);
    if (l.jumlah.gt(sisa)) {
      throw new Error(`Kuantitas terima melebihi sisa pesanan (sisa ${format(sisa)}, diminta ${format(l.jumlah)})`);
    }
  }

  const nomor = await nomorDokumenBerikutnya(db.penerimaanBarang, "TB");

  await db.$transaction(async (tx) => {
    await tx.penerimaanBarang.create({
      data: {
        nomor,
        pesananId,
        gudangId,
        status: "DIPROSES",
        baris: { create: daftarBaris.map((l) => ({ barisPesananId: l.barisPesananId, barangId: l.barangId, jumlah: l.jumlah })) },
      },
    });

    for (const baris of daftarBaris) {
      await tambahStok(tx, baris.barangId, gudangId, baris.jumlah);
      await tx.barisPesananPembelian.update({ where: { id: baris.barisPesananId }, data: { jumlahDiterima: { increment: baris.jumlah } } });
    }

    const barisTerbaru = await tx.barisPesananPembelian.findMany({ where: { pesananId } });
    const diterimaSemua = barisTerbaru.every((l) => D(l.jumlahDiterima).gte(l.jumlah));
    await tx.pesananPembelian.update({ where: { id: pesananId }, data: { status: diterimaSemua ? "DIPROSES" : "SEBAGIAN" } });
  });

  revalidatePath("/pembelian/pesanan");
  revalidatePath("/pembelian/penerimaan-barang");
  redirect("/pembelian/penerimaan-barang");
}

// ---------- Faktur Pembelian ----------

export async function buatFakturPembelian(dataFormulir: FormData) {
  await wajibHakAksi("pembelian.tulis");
  const pesananId = String(dataFormulir.get("pesananId") ?? "");
  const penerimaanId = String(dataFormulir.get("penerimaanId") ?? "") || null;
  if (!pesananId) throw new Error("Pesanan wajib dipilih");
  const daftarBaris = bacaBaris(dataFormulir);
  const total = totalBaris(daftarBaris);

  const pesanan = await db.pesananPembelian.findUniqueOrThrow({ where: { id: pesananId }, include: { baris: true } });

  for (const l of daftarBaris) {
    const daftarBarisPesanan = pesanan.baris.filter((ol) => ol.barangId === l.barangId);
    if (daftarBarisPesanan.length === 0) throw new Error("Barang tidak ada di pesanan ini");
    const sisa = jumlahkan(daftarBarisPesanan.map((ol) => D(ol.jumlah).minus(ol.jumlahDifaktur)));
    if (l.jumlah.gt(sisa)) {
      throw new Error(`Kuantitas faktur melebihi sisa yang belum ditagih (sisa ${format(sisa)}, diminta ${format(l.jumlah)})`);
    }
  }

  const nomor = await nomorDokumenBerikutnya(db.fakturPembelian, "FB");

  await db.$transaction(async (tx) => {
    const faktur = await tx.fakturPembelian.create({
      data: {
        nomor,
        pemasokId: pesanan.pemasokId,
        pesananId,
        penerimaanId,
        total,
        jatuhTempo: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        baris: {
          create: daftarBaris.map((l) => ({ barangId: l.barangId, jumlah: l.jumlah, harga: l.harga, subtotal: kali(l.jumlah, l.harga) })),
        },
      },
    });

    for (const l of daftarBaris) {
      const barisPesanan = await tx.barisPesananPembelian.findFirst({ where: { pesananId, barangId: l.barangId } });
      if (barisPesanan) {
        await tx.barisPesananPembelian.update({ where: { id: barisPesanan.id }, data: { jumlahDifaktur: { increment: l.jumlah } } });
      }
    }

    await catatJurnalFakturPembelian(tx, faktur);
  });

  revalidatePath("/pembelian/faktur");
  redirect("/pembelian/faktur");
}

// ---------- Pembayaran Pembelian ----------

export async function buatPembayaranPembelian(dataFormulir: FormData) {
  await wajibHakAksi("pembelian.tulis");
  const fakturId = String(dataFormulir.get("fakturId") ?? "");
  const akunId = String(dataFormulir.get("akunId") ?? "");
  const metodeBayar = String(dataFormulir.get("metodeBayar") ?? "TRANSFER");
  if (!fakturId) throw new Error("Faktur wajib dipilih");
  if (!akunId) throw new Error("Akun Kas/Bank sumber wajib dipilih");
  const jumlah = bacaUang(dataFormulir.get("jumlah"), "Jumlah bayar");

  const faktur = await db.fakturPembelian.findUniqueOrThrow({ where: { id: fakturId }, include: { pembayaran: true } });
  if (faktur.status === "LUNAS") throw new Error("Faktur ini sudah lunas");

  const sudahDibayar = jumlahkan(faktur.pembayaran.map((p) => p.jumlah));
  const sisa = D(faktur.total).minus(sudahDibayar);
  if (jumlah.gt(sisa)) {
    throw new Error(`Jumlah bayar melebihi sisa utang (sisa ${format(sisa)})`);
  }
  const status = sudahDibayar.plus(jumlah).gte(faktur.total) ? "LUNAS" : "SEBAGIAN";

  const nomor = await nomorDokumenBerikutnya(db.pembayaranPembelian, "BYR");

  await db.$transaction(async (tx) => {
    const pembayaran = await tx.pembayaranPembelian.create({
      data: { nomor, pemasokId: faktur.pemasokId, fakturId, akunId, jumlah, metodeBayar },
    });
    await tx.fakturPembelian.update({ where: { id: fakturId }, data: { status } });
    await catatJurnalPembayaranPembelian(tx, pembayaran);
  });

  revalidatePath("/pembelian/pembayaran");
  revalidatePath("/pembelian/faktur");
  redirect("/pembelian/pembayaran");
}

// ---------- Retur Pembelian ----------

export async function buatReturPembelian(dataFormulir: FormData) {
  await wajibHakAksi("pembelian.tulis");
  const fakturId = String(dataFormulir.get("fakturId") ?? "");
  const gudangId = String(dataFormulir.get("gudangId") ?? "");
  const alasan = String(dataFormulir.get("alasan") ?? "").trim();
  if (!fakturId) throw new Error("Faktur wajib dipilih");
  if (!gudangId) throw new Error("Gudang wajib dipilih");

  const daftarBaris = bacaBarisJumlah<{ barangId: string; jumlah: string | number }>(dataFormulir, "Minimal 1 baris barang wajib diretur");

  const faktur = await db.fakturPembelian.findUniqueOrThrow({
    where: { id: fakturId },
    include: { baris: true, retur: { include: { baris: true } } },
  });

  for (const l of daftarBaris) {
    const difaktur = jumlahkan(faktur.baris.filter((il) => il.barangId === l.barangId).map((il) => il.jumlah));
    if (difaktur.isZero()) throw new Error("Barang tidak ada di faktur ini");
    const diretur = jumlahkan(faktur.retur.flatMap((r) => r.baris.filter((rl) => rl.barangId === l.barangId).map((rl) => rl.jumlah)));
    const sisa = difaktur.minus(diretur);
    if (l.jumlah.gt(sisa)) {
      throw new Error(`Kuantitas retur melebihi yang bisa diretur (maks ${format(sisa)}, diminta ${format(l.jumlah)})`);
    }
  }

  const nilaiRetur = jumlahkan(daftarBaris.map((l) => kali(l.jumlah, faktur.baris.find((il) => il.barangId === l.barangId)?.harga ?? 0)));

  const nomor = await nomorDokumenBerikutnya(db.returPembelian, "RB");

  await db.$transaction(async (tx) => {
    const daftarLabel = await labelBarang(tx, daftarBaris.map((l) => l.barangId));

    await tx.returPembelian.create({
      data: {
        nomor,
        fakturId,
        gudangId,
        alasan: alasan || null,
        baris: { create: daftarBaris.map((l) => ({ barangId: l.barangId, jumlah: l.jumlah })) },
      },
    });

    for (const l of daftarBaris) {
      await kurangiStok(tx, l.barangId, gudangId, l.jumlah, daftarLabel.get(l.barangId) ?? l.barangId);
    }

    await catatJurnalReturPembelian(tx, nilaiRetur);
  });

  revalidatePath("/pembelian/retur");
  redirect("/pembelian/retur");
}

// ---------- Varian untuk <FormulirAksi> (mengembalikan pesan error, bukan throw) ----------

export async function buatPesananPembelianFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatPesananPembelian(dataFormulir));
}
export async function buatPenerimaanBarangFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatPenerimaanBarang(dataFormulir));
}
export async function buatFakturPembelianFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatFakturPembelian(dataFormulir));
}
export async function buatPembayaranPembelianFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatPembayaranPembelian(dataFormulir));
}
export async function buatReturPembelianFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatReturPembelian(dataFormulir));
}
