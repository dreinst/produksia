"use server";

import { wajibHakAksi } from "@/lib/otentikasi";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { D, format, uang, kali, bacaUang, jumlahkan, type Desimal } from "@/lib/uang";
import { kurangiStok, tambahStok, labelBarang, jenisBarang, perbaruiHargaRata, sesuaikanHargaRata } from "@/lib/stok";
import {
  catatJurnalPenerimaanBarang,
  catatJurnalFakturPembelian,
  catatJurnalPembayaranPembelian,
  catatJurnalReturPembelian,
} from "@/lib/akuntansi";
import { tandaiProyek } from "@/lib/akuntansi";
import { bacaProyekId } from "@/lib/proyek";
import { ambilPengaturanPerusahaan, bacaTarifPpn, hitungPpn, tanggalJatuhTempo } from "@/lib/pengaturanPerusahaan";

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

function statusFaktur(total: Desimal, dibayar: Desimal, retur: Desimal): "DRAF" | "SEBAGIAN" | "LUNAS" {
  if (dibayar.plus(retur).gte(total)) return "LUNAS";
  return dibayar.gt(0) || retur.gt(0) ? "SEBAGIAN" : "DRAF";
}

// ---------- Pesanan Pembelian ----------

export async function buatPesananPembelian(dataFormulir: FormData) {
  await wajibHakAksi("pesanan-pembelian.buat");
  const pemasokId = String(dataFormulir.get("pemasokId") ?? "");
  if (!pemasokId) throw new Error("Pemasok wajib dipilih");
  const daftarBaris = bacaBaris(dataFormulir);
  const total = totalBaris(daftarBaris);

  const proyekId = await bacaProyekId(dataFormulir);
  const nomor = await nomorDokumenBerikutnya(db.pesananPembelian, "PSB");

  await db.pesananPembelian.create({
    data: {
      nomor,
      pemasokId,
      proyekId,
      total,
      baris: { create: daftarBaris.map((l) => ({ barangId: l.barangId, jumlah: l.jumlah, harga: l.harga })) },
    },
  });

  revalidatePath("/pembelian/pesanan");
  redirect("/pembelian/pesanan");
}

// ---------- Penerimaan Barang ----------

export async function buatPenerimaanBarang(dataFormulir: FormData) {
  await wajibHakAksi("penerimaan-barang.buat");
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
    const daftarJenis = await jenisBarang(tx, daftarBaris.map((l) => l.barangId));
    // nilai persediaan yang masuk = harga di pesanan pembelian
    const barisNilai = daftarBaris.map((l) => ({
      barangId: l.barangId,
      jumlah: l.jumlah,
      harga: D(pesanan.baris.find((ol) => ol.id === l.barisPesananId)?.harga ?? 0),
    }));

    const penerimaan = await tx.penerimaanBarang.create({
      data: {
        nomor,
        pesananId,
        gudangId,
        status: "DIPROSES",
        baris: {
          create: barisNilai.map((l, i) => ({
            barisPesananId: daftarBaris[i].barisPesananId,
            barangId: l.barangId,
            jumlah: l.jumlah,
            hargaSatuan: daftarJenis.get(l.barangId) === "BARANG" ? l.harga : D(0),
          })),
        },
      },
    });

    for (const baris of barisNilai) {
      if (daftarJenis.get(baris.barangId) === "BARANG") {
        await tambahStok(tx, baris.barangId, gudangId, baris.jumlah);
        await perbaruiHargaRata(tx, baris.barangId, baris.jumlah, baris.harga, true);
      }
    }
    for (const l of daftarBaris) {
      await tx.barisPesananPembelian.update({ where: { id: l.barisPesananId }, data: { jumlahDiterima: { increment: l.jumlah } } });
    }

    const jurnal = await catatJurnalPenerimaanBarang(tx, penerimaan, barisNilai);
    if (jurnal) await tx.penerimaanBarang.update({ where: { id: penerimaan.id }, data: { jurnalId: jurnal.id } });
    await tandaiProyek(tx, jurnal, pesanan.proyekId);

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
  await wajibHakAksi("faktur-pembelian.buat");
  const pesananId = String(dataFormulir.get("pesananId") ?? "");
  const penerimaanId = String(dataFormulir.get("penerimaanId") ?? "") || null;
  if (!pesananId) throw new Error("Pesanan wajib dipilih");
  const daftarBaris = bacaBaris(dataFormulir);
  const pengaturan = await ambilPengaturanPerusahaan(db);
  const ppnPersen = bacaTarifPpn(dataFormulir.get("ppnPersen"), pengaturan);
  const dpp = totalBaris(daftarBaris);
  const ppn = hitungPpn(dpp, ppnPersen);
  const total = dpp.plus(ppn);

  const pesanan = await db.pesananPembelian.findUniqueOrThrow({ where: { id: pesananId }, include: { baris: true } });

  for (const l of daftarBaris) {
    const daftarBarisPesanan = pesanan.baris.filter((ol) => ol.barangId === l.barangId);
    if (daftarBarisPesanan.length === 0) throw new Error("Barang tidak ada di pesanan ini");
    const sisa = jumlahkan(daftarBarisPesanan.map((ol) => D(ol.jumlah).minus(ol.jumlahDifaktur)));
    if (l.jumlah.gt(sisa)) {
      throw new Error(`Kuantitas faktur melebihi sisa yang belum ditagih (sisa ${format(sisa)}, diminta ${format(l.jumlah)})`);
    }
  }
  const hargaPesanan = new Map(pesanan.baris.map((ol) => [ol.barangId, D(ol.harga)]));

  const nomor = await nomorDokumenBerikutnya(db.fakturPembelian, "FB");

  await db.$transaction(async (tx) => {
    const daftarJenis = await jenisBarang(tx, daftarBaris.map((l) => l.barangId));
    const faktur = await tx.fakturPembelian.create({
      data: {
        nomor,
        pemasokId: pesanan.pemasokId,
        pesananId,
        penerimaanId,
        total,
        dpp,
        ppnPersen,
        ppn,
        jatuhTempo: tanggalJatuhTempo(pengaturan.terminHari),
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
      // harga faktur beda dari pesanan → selisihnya menyesuaikan harga pokok rata-rata stok
      if (daftarJenis.get(l.barangId) === "BARANG") {
        const dasar = hargaPesanan.get(l.barangId) ?? l.harga;
        await sesuaikanHargaRata(tx, l.barangId, kali(l.jumlah, l.harga.minus(dasar)));
      }
    }

    const jurnal = await catatJurnalFakturPembelian(tx, faktur, daftarBaris, hargaPesanan, pengaturan.akunPpnMasukanId);
    if (jurnal) await tx.fakturPembelian.update({ where: { id: faktur.id }, data: { jurnalId: jurnal.id } });
    await tandaiProyek(tx, jurnal, pesanan.proyekId);
  });

  revalidatePath("/pembelian/faktur");
  redirect("/pembelian/faktur");
}

// ---------- Pembayaran Pembelian ----------

export async function buatPembayaranPembelian(dataFormulir: FormData) {
  await wajibHakAksi("pembayaran.buat");
  const fakturId = String(dataFormulir.get("fakturId") ?? "");
  const akunId = String(dataFormulir.get("akunId") ?? "");
  const metodeBayar = String(dataFormulir.get("metodeBayar") ?? "TRANSFER");
  if (!fakturId) throw new Error("Faktur wajib dipilih");
  if (!akunId) throw new Error("Akun Kas/Bank sumber wajib dipilih");
  const jumlah = bacaUang(dataFormulir.get("jumlah"), "Jumlah bayar");
  const potonganMentah = dataFormulir.get("potonganPajak");
  const potonganPajak = typeof potonganMentah === "string" && potonganMentah.trim() !== "" ? bacaUang(potonganMentah, "Potongan PPh 23", { allowZero: true }) : D(0);
  const pengaturan = await ambilPengaturanPerusahaan(db);
  if (potonganPajak.gt(0) && !pengaturan.akunPph23DipotongId) throw new Error("Akun Hutang PPh 23 belum diatur di Pengaturan > Perusahaan & Pajak");

  const faktur = await db.fakturPembelian.findUniqueOrThrow({ where: { id: fakturId }, include: { pembayaran: true, retur: true, pesanan: { select: { proyekId: true } } } });
  if (faktur.status === "LUNAS") throw new Error("Faktur ini sudah lunas");

  const sudahDibayar = jumlahkan(faktur.pembayaran.map((p) => D(p.jumlah).plus(p.potonganPajak)));
  const sudahDiretur = jumlahkan(faktur.retur.map((r) => r.total));
  const sisa = D(faktur.total).minus(sudahDibayar).minus(sudahDiretur);
  const bayarBruto = jumlah.plus(potonganPajak);
  if (bayarBruto.gt(sisa)) {
    throw new Error(`Jumlah bayar + potongan pajak melebihi sisa utang (sisa ${format(sisa)})`);
  }
  const status = statusFaktur(D(faktur.total), sudahDibayar.plus(bayarBruto), sudahDiretur);

  const nomor = await nomorDokumenBerikutnya(db.pembayaranPembelian, "BYR");

  await db.$transaction(async (tx) => {
    const pembayaran = await tx.pembayaranPembelian.create({
      data: { nomor, pemasokId: faktur.pemasokId, fakturId, akunId, jumlah, potonganPajak, metodeBayar },
    });
    await tx.fakturPembelian.update({ where: { id: fakturId }, data: { status } });
    const jurnal = await catatJurnalPembayaranPembelian(tx, pembayaran, faktur.nomor, pengaturan.akunPph23DipotongId);
    if (jurnal) await tx.pembayaranPembelian.update({ where: { id: pembayaran.id }, data: { jurnalId: jurnal.id } });
    await tandaiProyek(tx, jurnal, faktur.pesanan?.proyekId);
  });

  revalidatePath("/pembelian/pembayaran");
  revalidatePath("/pembelian/faktur");
  redirect("/pembelian/pembayaran");
}

// ---------- Retur Pembelian ----------

export async function buatReturPembelian(dataFormulir: FormData) {
  await wajibHakAksi("retur-pembelian.buat");
  const fakturId = String(dataFormulir.get("fakturId") ?? "");
  const gudangId = String(dataFormulir.get("gudangId") ?? "");
  const alasan = String(dataFormulir.get("alasan") ?? "").trim();
  if (!fakturId) throw new Error("Faktur wajib dipilih");
  if (!gudangId) throw new Error("Gudang wajib dipilih");

  const daftarBaris = bacaBarisJumlah<{ barangId: string; jumlah: string | number }>(dataFormulir, "Minimal 1 baris barang wajib diretur");

  const faktur = await db.fakturPembelian.findUniqueOrThrow({
    where: { id: fakturId },
    include: { baris: true, retur: { include: { baris: true } }, pembayaran: true, pesanan: { select: { proyekId: true } } },
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

  const barisRetur = daftarBaris.map((l) => ({
    barangId: l.barangId,
    jumlah: l.jumlah,
    harga: D(faktur.baris.find((il) => il.barangId === l.barangId)?.harga ?? 0),
  }));
  const dpp = totalBaris(barisRetur);
  const ppn = hitungPpn(dpp, D(faktur.ppnPersen));
  const total = dpp.plus(ppn);
  const pengaturan = await ambilPengaturanPerusahaan(db);
  const sudahDibayar = jumlahkan(faktur.pembayaran.map((p) => D(p.jumlah).plus(p.potonganPajak)));
  const sudahDiretur = jumlahkan(faktur.retur.map((r) => r.total));
  const status = statusFaktur(D(faktur.total), sudahDibayar, sudahDiretur.plus(total));

  const nomor = await nomorDokumenBerikutnya(db.returPembelian, "RB");

  await db.$transaction(async (tx) => {
    const [daftarLabel, daftarJenis, daftarBarangRetur] = await Promise.all([
      labelBarang(tx, daftarBaris.map((l) => l.barangId)),
      jenisBarang(tx, daftarBaris.map((l) => l.barangId)),
      tx.barang.findMany({ where: { id: { in: daftarBaris.map((l) => l.barangId) } }, select: { id: true, hargaBeli: true } }),
    ]);
    const hargaPokokBarang = new Map(daftarBarangRetur.map((b) => [b.id, D(b.hargaBeli)]));

    const retur = await tx.returPembelian.create({
      data: {
        nomor,
        fakturId,
        gudangId,
        alasan: alasan || null,
        total,
        dpp,
        ppn,
        baris: {
          create: daftarBaris.map((l) => ({
            barangId: l.barangId,
            jumlah: l.jumlah,
            hargaPokok: daftarJenis.get(l.barangId) === "BARANG" ? (hargaPokokBarang.get(l.barangId) ?? D(0)) : D(0),
          })),
        },
      },
    });

    for (const l of daftarBaris) {
      if (daftarJenis.get(l.barangId) === "BARANG") {
        await kurangiStok(tx, l.barangId, gudangId, l.jumlah, daftarLabel.get(l.barangId) ?? l.barangId);
      }
    }
    await tx.fakturPembelian.update({ where: { id: fakturId }, data: { status } });

    // harga pokok rata-rata tidak berubah saat barang keluar, jadi jurnal aman dihitung setelah stok berkurang
    const jurnal = await catatJurnalReturPembelian(tx, { nomor: retur.nomor, total, ppn }, barisRetur, pengaturan.akunPpnMasukanId);
    if (jurnal) await tx.returPembelian.update({ where: { id: retur.id }, data: { jurnalId: jurnal.id } });
    await tandaiProyek(tx, jurnal, faktur.pesanan?.proyekId);
  });

  revalidatePath("/pembelian/retur");
  revalidatePath("/pembelian/faktur");
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
