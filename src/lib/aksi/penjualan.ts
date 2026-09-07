"use server";

import { wajibHakAksi } from "@/lib/otentikasi";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { D, format, uang, kali, bacaUang, jumlahkan, type Desimal } from "@/lib/uang";
import { kurangiStok, tambahStok, labelBarang } from "@/lib/stok";
import { catatJurnalFakturPenjualan, catatJurnalPenerimaanPenjualan, catatJurnalReturPenjualan } from "@/lib/akuntansi";

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

/** Baris barang dengan harga (penawaran, pesanan, faktur). */
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

/** Baris jumlah saja (pengiriman, retur). */
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

// ---------- Penawaran Penjualan ----------

export async function buatPenawaran(dataFormulir: FormData) {
  await wajibHakAksi("penjualan.tulis");
  const pelangganId = String(dataFormulir.get("pelangganId") ?? "");
  if (!pelangganId) throw new Error("Pelanggan wajib dipilih");
  const daftarBaris = bacaBaris(dataFormulir);
  const total = totalBaris(daftarBaris);

  const nomor = await nomorDokumenBerikutnya(db.penawaranPenjualan, "PNW");

  await db.penawaranPenjualan.create({
    data: {
      nomor,
      pelangganId,
      total,
      baris: {
        create: daftarBaris.map((l) => ({ barangId: l.barangId, jumlah: l.jumlah, harga: l.harga, subtotal: kali(l.jumlah, l.harga) })),
      },
    },
  });

  revalidatePath("/penjualan/penawaran");
  redirect("/penjualan/penawaran");
}

export async function konversiPenawaranKePesanan(penawaranId: string) {
  await wajibHakAksi("penjualan.tulis");
  const penawaran = await db.penawaranPenjualan.findUniqueOrThrow({
    where: { id: penawaranId },
    include: { baris: true },
  });
  if (penawaran.status === "DIKONVERSI") throw new Error("Penawaran sudah dikonversi");

  const nomor = await nomorDokumenBerikutnya(db.pesananPenjualan, "PSJ");

  await db.$transaction([
    db.pesananPenjualan.create({
      data: {
        nomor,
        pelangganId: penawaran.pelangganId,
        penawaranId: penawaran.id,
        total: penawaran.total,
        baris: { create: penawaran.baris.map((l) => ({ barangId: l.barangId, jumlah: l.jumlah, harga: l.harga })) },
      },
    }),
    db.penawaranPenjualan.update({ where: { id: penawaran.id }, data: { status: "DIKONVERSI" } }),
  ]);

  revalidatePath("/penjualan/penawaran");
  revalidatePath("/penjualan/pesanan");
  redirect("/penjualan/pesanan");
}

// ---------- Pesanan Penjualan ----------

export async function buatPesanan(dataFormulir: FormData) {
  await wajibHakAksi("penjualan.tulis");
  const pelangganId = String(dataFormulir.get("pelangganId") ?? "");
  if (!pelangganId) throw new Error("Pelanggan wajib dipilih");
  const daftarBaris = bacaBaris(dataFormulir);
  const total = totalBaris(daftarBaris);

  const nomor = await nomorDokumenBerikutnya(db.pesananPenjualan, "PSJ");

  await db.pesananPenjualan.create({
    data: {
      nomor,
      pelangganId,
      total,
      baris: { create: daftarBaris.map((l) => ({ barangId: l.barangId, jumlah: l.jumlah, harga: l.harga })) },
    },
  });

  revalidatePath("/penjualan/pesanan");
  redirect("/penjualan/pesanan");
}

// ---------- Pengiriman Pesanan ----------

export async function buatPengiriman(dataFormulir: FormData) {
  await wajibHakAksi("penjualan.kirim");
  const pesananId = String(dataFormulir.get("pesananId") ?? "");
  const gudangId = String(dataFormulir.get("gudangId") ?? "");
  if (!pesananId) throw new Error("Pesanan wajib dipilih");
  if (!gudangId) throw new Error("Gudang wajib dipilih");

  const daftarBaris = bacaBarisJumlah<{ barisPesananId: string; barangId: string; jumlah: string | number }>(
    dataFormulir,
    "Minimal 1 baris barang wajib dikirim",
  );

  const pesanan = await db.pesananPenjualan.findUniqueOrThrow({ where: { id: pesananId }, include: { baris: true } });

  // tidak boleh mengirim lebih dari sisa pesanan
  for (const l of daftarBaris) {
    const barisPesanan = pesanan.baris.find((ol) => ol.id === l.barisPesananId);
    if (!barisPesanan) throw new Error("Baris pesanan tidak ditemukan");
    const sisa = D(barisPesanan.jumlah).minus(barisPesanan.jumlahTerkirim);
    if (l.jumlah.gt(sisa)) {
      throw new Error(`Kuantitas kirim melebihi sisa pesanan (sisa ${format(sisa)}, diminta ${format(l.jumlah)})`);
    }
  }

  const nomor = await nomorDokumenBerikutnya(db.pengirimanPesanan, "SJ");

  await db.$transaction(async (tx) => {
    const daftarLabel = await labelBarang(tx, daftarBaris.map((l) => l.barangId));

    await tx.pengirimanPesanan.create({
      data: {
        nomor,
        pesananId,
        gudangId,
        status: "DIPROSES",
        baris: { create: daftarBaris.map((l) => ({ barisPesananId: l.barisPesananId, barangId: l.barangId, jumlah: l.jumlah })) },
      },
    });

    for (const baris of daftarBaris) {
      await kurangiStok(tx, baris.barangId, gudangId, baris.jumlah, daftarLabel.get(baris.barangId) ?? baris.barangId);
      await tx.barisPesananPenjualan.update({ where: { id: baris.barisPesananId }, data: { jumlahTerkirim: { increment: baris.jumlah } } });
    }

    const barisTerbaru = await tx.barisPesananPenjualan.findMany({ where: { pesananId } });
    const terkirimSemua = barisTerbaru.every((l) => D(l.jumlahTerkirim).gte(l.jumlah));
    await tx.pesananPenjualan.update({ where: { id: pesananId }, data: { status: terkirimSemua ? "DIPROSES" : "SEBAGIAN" } });
  });

  revalidatePath("/penjualan/pesanan");
  revalidatePath("/penjualan/pengiriman");
  redirect("/penjualan/pengiriman");
}

// ---------- Faktur Penjualan ----------

export async function buatFaktur(dataFormulir: FormData) {
  await wajibHakAksi("penjualan.tulis");
  const pesananId = String(dataFormulir.get("pesananId") ?? "");
  const pengirimanId = String(dataFormulir.get("pengirimanId") ?? "") || null;
  if (!pesananId) throw new Error("Pesanan wajib dipilih");
  const daftarBaris = bacaBaris(dataFormulir);
  const total = totalBaris(daftarBaris);

  const pesanan = await db.pesananPenjualan.findUniqueOrThrow({ where: { id: pesananId }, include: { baris: true } });

  // tidak boleh menagih lebih dari sisa jumlah pesanan (per barang)
  for (const l of daftarBaris) {
    const daftarBarisPesanan = pesanan.baris.filter((ol) => ol.barangId === l.barangId);
    if (daftarBarisPesanan.length === 0) throw new Error("Barang tidak ada di pesanan ini");
    const sisa = jumlahkan(daftarBarisPesanan.map((ol) => D(ol.jumlah).minus(ol.jumlahDifaktur)));
    if (l.jumlah.gt(sisa)) {
      throw new Error(`Kuantitas faktur melebihi sisa yang belum ditagih (sisa ${format(sisa)}, diminta ${format(l.jumlah)})`);
    }
  }

  const nomor = await nomorDokumenBerikutnya(db.fakturPenjualan, "FJ");

  await db.$transaction(async (tx) => {
    const faktur = await tx.fakturPenjualan.create({
      data: {
        nomor,
        pelangganId: pesanan.pelangganId,
        pesananId,
        pengirimanId,
        total,
        jatuhTempo: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        baris: {
          create: daftarBaris.map((l) => ({ barangId: l.barangId, jumlah: l.jumlah, harga: l.harga, subtotal: kali(l.jumlah, l.harga) })),
        },
      },
    });

    for (const l of daftarBaris) {
      const barisPesanan = await tx.barisPesananPenjualan.findFirst({ where: { pesananId, barangId: l.barangId } });
      if (barisPesanan) {
        await tx.barisPesananPenjualan.update({ where: { id: barisPesanan.id }, data: { jumlahDifaktur: { increment: l.jumlah } } });
      }
    }

    const daftarBarang = await tx.barang.findMany({ where: { id: { in: daftarBaris.map((l) => l.barangId) } } });
    const hargaPokok = jumlahkan(daftarBaris.map((l) => kali(l.jumlah, daftarBarang.find((i) => i.id === l.barangId)?.hargaBeli ?? 0)));
    await catatJurnalFakturPenjualan(tx, faktur, hargaPokok);
  });

  revalidatePath("/penjualan/faktur");
  redirect("/penjualan/faktur");
}

// ---------- Penerimaan Penjualan ----------

export async function buatPenerimaan(dataFormulir: FormData) {
  await wajibHakAksi("penjualan.tulis");
  const fakturId = String(dataFormulir.get("fakturId") ?? "");
  const akunId = String(dataFormulir.get("akunId") ?? "");
  const metodeBayar = String(dataFormulir.get("metodeBayar") ?? "TUNAI");
  if (!fakturId) throw new Error("Faktur wajib dipilih");
  if (!akunId) throw new Error("Akun Kas/Bank penerima wajib dipilih");
  const jumlah = bacaUang(dataFormulir.get("jumlah"), "Jumlah bayar");

  const faktur = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fakturId }, include: { penerimaan: true } });
  if (faktur.status === "LUNAS") throw new Error("Faktur ini sudah lunas");

  const sudahDibayar = jumlahkan(faktur.penerimaan.map((r) => r.jumlah));
  const sisa = D(faktur.total).minus(sudahDibayar);
  if (jumlah.gt(sisa)) {
    throw new Error(`Jumlah bayar melebihi sisa tagihan (sisa ${format(sisa)})`);
  }
  const status = sudahDibayar.plus(jumlah).gte(faktur.total) ? "LUNAS" : "SEBAGIAN";

  const nomor = await nomorDokumenBerikutnya(db.penerimaanPenjualan, "TRM");

  await db.$transaction(async (tx) => {
    const penerimaan = await tx.penerimaanPenjualan.create({
      data: { nomor, pelangganId: faktur.pelangganId, fakturId, akunId, jumlah, metodeBayar },
    });
    await tx.fakturPenjualan.update({ where: { id: fakturId }, data: { status } });
    await catatJurnalPenerimaanPenjualan(tx, penerimaan);
  });

  revalidatePath("/penjualan/penerimaan");
  revalidatePath("/penjualan/faktur");
  redirect("/penjualan/penerimaan");
}

// ---------- Retur Penjualan ----------

export async function buatRetur(dataFormulir: FormData) {
  await wajibHakAksi("penjualan.tulis");
  const fakturId = String(dataFormulir.get("fakturId") ?? "");
  const gudangId = String(dataFormulir.get("gudangId") ?? "");
  const alasan = String(dataFormulir.get("alasan") ?? "").trim();
  if (!fakturId) throw new Error("Faktur wajib dipilih");
  if (!gudangId) throw new Error("Gudang wajib dipilih");

  const daftarBaris = bacaBarisJumlah<{ barangId: string; jumlah: string | number }>(dataFormulir, "Minimal 1 baris barang wajib diretur");

  const faktur = await db.fakturPenjualan.findUniqueOrThrow({
    where: { id: fakturId },
    include: { baris: true, retur: { include: { baris: true } } },
  });

  // tidak boleh meretur lebih dari jumlah yang pernah difakturkan (dikurangi retur sebelumnya)
  for (const l of daftarBaris) {
    const difaktur = jumlahkan(faktur.baris.filter((il) => il.barangId === l.barangId).map((il) => il.jumlah));
    if (difaktur.isZero()) throw new Error("Barang tidak ada di faktur ini");
    const diretur = jumlahkan(faktur.retur.flatMap((r) => r.baris.filter((rl) => rl.barangId === l.barangId).map((rl) => rl.jumlah)));
    const sisa = difaktur.minus(diretur);
    if (l.jumlah.gt(sisa)) {
      throw new Error(`Kuantitas retur melebihi yang bisa diretur (maks ${format(sisa)}, diminta ${format(l.jumlah)})`);
    }
  }

  const daftarBarang = await db.barang.findMany({ where: { id: { in: daftarBaris.map((l) => l.barangId) } } });
  const nilaiRetur = jumlahkan(daftarBaris.map((l) => kali(l.jumlah, faktur.baris.find((il) => il.barangId === l.barangId)?.harga ?? 0)));
  const hargaPokok = jumlahkan(daftarBaris.map((l) => kali(l.jumlah, daftarBarang.find((i) => i.id === l.barangId)?.hargaBeli ?? 0)));

  const nomor = await nomorDokumenBerikutnya(db.returPenjualan, "RJ");

  await db.$transaction(async (tx) => {
    await tx.returPenjualan.create({
      data: {
        nomor,
        fakturId,
        gudangId,
        alasan: alasan || null,
        baris: { create: daftarBaris.map((l) => ({ barangId: l.barangId, jumlah: l.jumlah })) },
      },
    });

    for (const l of daftarBaris) await tambahStok(tx, l.barangId, gudangId, l.jumlah);

    await catatJurnalReturPenjualan(tx, nilaiRetur, hargaPokok);
  });

  revalidatePath("/penjualan/retur");
  redirect("/penjualan/retur");
}

// ---------- Varian untuk <FormulirAksi> (mengembalikan pesan error, bukan throw) ----------

export async function buatPenawaranFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatPenawaran(dataFormulir));
}
// Dipakai lewat .bind(null, penawaranId); argumen (prevState, dataFormulir) dari useActionState sengaja diabaikan
export async function konversiPenawaranKePesananFormulir(penawaranId: string) {
  return jalankanFormulir(() => konversiPenawaranKePesanan(penawaranId));
}
export async function buatPesananFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatPesanan(dataFormulir));
}
export async function buatPengirimanFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatPengiriman(dataFormulir));
}
export async function buatFakturFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatFaktur(dataFormulir));
}
export async function buatPenerimaanFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatPenerimaan(dataFormulir));
}
export async function buatReturFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatRetur(dataFormulir));
}
