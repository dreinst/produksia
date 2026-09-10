"use server";

import { wajibHakAksi } from "@/lib/otentikasi";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { D, format, uang, kali, bacaUang, jumlahkan, terkecil, terbesar, type Desimal } from "@/lib/uang";
import { kurangiStok, tambahStok, labelBarang, jenisBarang } from "@/lib/stok";
import { catatJurnalPengiriman, catatJurnalFakturPenjualan, catatJurnalPenerimaanPenjualan, catatJurnalReturPenjualan, catatJurnalUangMuka } from "@/lib/akuntansi";

const NOL = D(0);
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

/** Status faktur dari total, penerimaan, dan retur: LUNAS bila (dibayar + retur) ≥ total. */
function statusFaktur(total: Desimal, dibayar: Desimal, retur: Desimal): "DRAF" | "SEBAGIAN" | "LUNAS" {
  if (dibayar.plus(retur).gte(total)) return "LUNAS";
  return dibayar.gt(0) || retur.gt(0) ? "SEBAGIAN" : "DRAF";
}

// ---------- Penawaran Penjualan ----------

export async function buatPenawaran(dataFormulir: FormData) {
  await wajibHakAksi("penawaran.buat");
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
  await wajibHakAksi("pesanan.buat");
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
  await wajibHakAksi("pesanan.buat");
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
  await wajibHakAksi("pengiriman.buat");
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
    const [daftarLabel, daftarJenis, daftarBarang] = await Promise.all([
      labelBarang(tx, daftarBaris.map((l) => l.barangId)),
      jenisBarang(tx, daftarBaris.map((l) => l.barangId)),
      tx.barang.findMany({ where: { id: { in: daftarBaris.map((l) => l.barangId) } }, select: { id: true, hargaBeli: true } }),
    ]);
    const hargaPokokBarang = new Map(daftarBarang.map((b) => [b.id, D(b.hargaBeli)]));

    // nilai barang keluar = harga pokok rata-rata saat ini; porsi yang sudah difaktur lebih dulu langsung jadi HPP
    const barisNilai = daftarBaris.map((l) => {
      const bp = pesanan.baris.find((ol) => ol.id === l.barisPesananId)!;
      const adalahBarang = daftarJenis.get(l.barangId) === "BARANG";
      const belumTerkirimTapiDifaktur = D(bp.jumlahDifaktur).minus(bp.jumlahTerkirim);
      const sudahDifaktur = adalahBarang ? terbesar(terkecil(l.jumlah, belumTerkirimTapiDifaktur), NOL) : NOL;
      return { ...l, hargaPokok: adalahBarang ? (hargaPokokBarang.get(l.barangId) ?? NOL) : NOL, sudahDifaktur };
    });

    const pengiriman = await tx.pengirimanPesanan.create({
      data: {
        nomor,
        pesananId,
        gudangId,
        status: "DIPROSES",
        baris: {
          create: barisNilai.map((l) => ({
            barisPesananId: l.barisPesananId,
            barangId: l.barangId,
            jumlah: l.jumlah,
            hargaPokok: l.hargaPokok,
            jumlahDifaktur: l.sudahDifaktur,
          })),
        },
      },
    });

    for (const baris of barisNilai) {
      // JASA tidak punya stok: surat jalan hanya mencatat bahwa jasanya sudah diserahkan
      if (daftarJenis.get(baris.barangId) === "BARANG") {
        await kurangiStok(tx, baris.barangId, gudangId, baris.jumlah, daftarLabel.get(baris.barangId) ?? baris.barangId);
      }
      await tx.barisPesananPenjualan.update({ where: { id: baris.barisPesananId }, data: { jumlahTerkirim: { increment: baris.jumlah } } });
    }

    const jurnal = await catatJurnalPengiriman(tx, pengiriman, barisNilai);
    if (jurnal) await tx.pengirimanPesanan.update({ where: { id: pengiriman.id }, data: { jurnalId: jurnal.id } });

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
  await wajibHakAksi("faktur.buat");
  const pesananId = String(dataFormulir.get("pesananId") ?? "");
  const pengirimanId = String(dataFormulir.get("pengirimanId") ?? "") || null;
  if (!pesananId) throw new Error("Pesanan wajib dipilih");
  const daftarBaris = bacaBaris(dataFormulir);
  const pengaturan = await ambilPengaturanPerusahaan(db);
  const ppnPersen = bacaTarifPpn(dataFormulir.get("ppnPersen"), pengaturan);
  const dpp = totalBaris(daftarBaris);
  const ppn = hitungPpn(dpp, ppnPersen);
  const total = dpp.plus(ppn);
  const uangMukaMentah = dataFormulir.get("uangMuka");
  const uangMuka = typeof uangMukaMentah === "string" && uangMukaMentah.trim() !== "" ? bacaUang(uangMukaMentah, "Uang muka dipakai", { allowZero: true }) : NOL;

  const pesanan = await db.pesananPenjualan.findUniqueOrThrow({ where: { id: pesananId }, include: { baris: true, uangMuka: true } });
  const uangMukaTersedia = jumlahkan(pesanan.uangMuka.map((u) => D(u.jumlah).minus(u.jumlahDipakai)));
  if (uangMuka.gt(uangMukaTersedia)) throw new Error(`Uang muka yang dipakai melebihi sisa uang muka pesanan (tersedia ${format(uangMukaTersedia)})`);
  if (uangMuka.gt(total)) throw new Error(`Uang muka yang dipakai melebihi total faktur (${format(total)})`);

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
        dpp,
        ppnPersen,
        ppn,
        uangMuka,
        status: statusFaktur(total, uangMuka, NOL),
        jatuhTempo: tanggalJatuhTempo(pengaturan.terminHari),
        baris: {
          create: daftarBaris.map((l) => ({ barangId: l.barangId, jumlah: l.jumlah, harga: l.harga, subtotal: kali(l.jumlah, l.harga) })),
        },
      },
    });

    const daftarJenis = await jenisBarang(tx, daftarBaris.map((l) => l.barangId));
    // HPP diakui untuk barang yang sudah dikirim: konsumsi baris SJ pesanan ini (urut tanggal) yang belum difaktur
    const konsumsiTransit: { barangId: string; jumlah: Desimal; hargaPokok: Desimal }[] = [];
    for (const l of daftarBaris) {
      const barisPesanan = await tx.barisPesananPenjualan.findFirst({ where: { pesananId, barangId: l.barangId } });
      if (barisPesanan) {
        await tx.barisPesananPenjualan.update({ where: { id: barisPesanan.id }, data: { jumlahDifaktur: { increment: l.jumlah } } });
      }
      if (daftarJenis.get(l.barangId) !== "BARANG") continue;
      let butuh = l.jumlah;
      const barisSj = await tx.barisPengiriman.findMany({
        where: { barangId: l.barangId, pengiriman: { pesananId } },
        orderBy: { pengiriman: { tanggal: "asc" } },
      });
      for (const sj of barisSj) {
        if (butuh.lte(0)) break;
        const sisa = D(sj.jumlah).minus(sj.jumlahDifaktur);
        if (sisa.lte(0)) continue;
        const ambil = terkecil(sisa, butuh);
        await tx.barisPengiriman.update({ where: { id: sj.id }, data: { jumlahDifaktur: { increment: ambil } } });
        konsumsiTransit.push({ barangId: l.barangId, jumlah: ambil, hargaPokok: D(sj.hargaPokok) });
        butuh = butuh.minus(ambil);
      }
    }

    // Uang muka pesanan dipakai urut tanggal (FIFO); dibaca ulang di dalam transaksi supaya dua faktur bersamaan tidak memakai DP yang sama
    let sisaUangMuka = uangMuka;
    if (sisaUangMuka.gt(0)) {
      const daftarUm = await tx.uangMukaPelanggan.findMany({ where: { pesananId }, orderBy: { tanggal: "asc" } });
      for (const um of daftarUm) {
        if (sisaUangMuka.lte(0)) break;
        const bisa = terkecil(D(um.jumlah).minus(um.jumlahDipakai), sisaUangMuka);
        if (bisa.lte(0)) continue;
        await tx.uangMukaPelanggan.update({ where: { id: um.id }, data: { jumlahDipakai: { increment: bisa } } });
        await tx.pemakaianUangMuka.create({ data: { uangMukaId: um.id, fakturId: faktur.id, jumlah: bisa } });
        sisaUangMuka = sisaUangMuka.minus(bisa);
      }
      if (sisaUangMuka.gt(0)) throw new Error("Sisa uang muka pesanan berubah; muat ulang halaman lalu coba lagi");
    }

    const jurnal = await catatJurnalFakturPenjualan(tx, faktur, daftarBaris, pengaturan.akunPpnKeluaranId, konsumsiTransit);
    if (jurnal) await tx.fakturPenjualan.update({ where: { id: faktur.id }, data: { jurnalId: jurnal.id } });
  });

  revalidatePath("/penjualan/faktur");
  redirect("/penjualan/faktur");
}

// ---------- Penerimaan Penjualan ----------

export async function buatPenerimaan(dataFormulir: FormData) {
  await wajibHakAksi("penerimaan.buat");
  const fakturId = String(dataFormulir.get("fakturId") ?? "");
  const akunId = String(dataFormulir.get("akunId") ?? "");
  const metodeBayar = String(dataFormulir.get("metodeBayar") ?? "TUNAI");
  if (!fakturId) throw new Error("Faktur wajib dipilih");
  if (!akunId) throw new Error("Akun Kas/Bank penerima wajib dipilih");
  const jumlah = bacaUang(dataFormulir.get("jumlah"), "Jumlah bayar");
  const potonganMentah = dataFormulir.get("potonganPajak");
  const potonganPajak = typeof potonganMentah === "string" && potonganMentah.trim() !== "" ? bacaUang(potonganMentah, "Potongan PPh 23", { allowZero: true }) : D(0);
  const pengaturan = await ambilPengaturanPerusahaan(db);
  if (potonganPajak.gt(0) && !pengaturan.akunPph23DimukaId) throw new Error("Akun Pajak Dibayar Dimuka (PPh 23) belum diatur di Pengaturan > Perusahaan & Pajak");

  const faktur = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: fakturId }, include: { penerimaan: true, retur: true } });
  if (faktur.status === "LUNAS") throw new Error("Faktur ini sudah lunas");

  const sudahDibayar = jumlahkan(faktur.penerimaan.map((r) => D(r.jumlah).plus(r.potonganPajak)));
  const sudahDiretur = jumlahkan(faktur.retur.map((r) => r.total));
  const sisa = D(faktur.total).minus(faktur.uangMuka).minus(sudahDibayar).minus(sudahDiretur);
  const bayarBruto = jumlah.plus(potonganPajak);
  if (bayarBruto.gt(sisa)) {
    throw new Error(`Jumlah bayar + potongan pajak melebihi sisa tagihan (sisa ${format(sisa)})`);
  }
  const status = statusFaktur(D(faktur.total), D(faktur.uangMuka).plus(sudahDibayar).plus(bayarBruto), sudahDiretur);

  const nomor = await nomorDokumenBerikutnya(db.penerimaanPenjualan, "TRM");

  await db.$transaction(async (tx) => {
    const penerimaan = await tx.penerimaanPenjualan.create({
      data: { nomor, pelangganId: faktur.pelangganId, fakturId, akunId, jumlah, potonganPajak, metodeBayar },
    });
    await tx.fakturPenjualan.update({ where: { id: fakturId }, data: { status } });
    const jurnal = await catatJurnalPenerimaanPenjualan(tx, penerimaan, faktur.nomor, pengaturan.akunPph23DimukaId);
    if (jurnal) await tx.penerimaanPenjualan.update({ where: { id: penerimaan.id }, data: { jurnalId: jurnal.id } });
  });

  revalidatePath("/penjualan/penerimaan");
  revalidatePath("/penjualan/faktur");
  redirect("/penjualan/penerimaan");
}

// ---------- Retur Penjualan ----------

export async function buatRetur(dataFormulir: FormData) {
  await wajibHakAksi("retur-penjualan.buat");
  const fakturId = String(dataFormulir.get("fakturId") ?? "");
  const gudangId = String(dataFormulir.get("gudangId") ?? "");
  const alasan = String(dataFormulir.get("alasan") ?? "").trim();
  if (!fakturId) throw new Error("Faktur wajib dipilih");
  if (!gudangId) throw new Error("Gudang wajib dipilih");

  const daftarBaris = bacaBarisJumlah<{ barangId: string; jumlah: string | number }>(dataFormulir, "Minimal 1 baris barang wajib diretur");

  const faktur = await db.fakturPenjualan.findUniqueOrThrow({
    where: { id: fakturId },
    include: { baris: true, retur: { include: { baris: true } }, penerimaan: true },
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

  // nilai retur memakai harga di faktur
  const barisRetur = daftarBaris.map((l) => ({
    barangId: l.barangId,
    jumlah: l.jumlah,
    harga: D(faktur.baris.find((il) => il.barangId === l.barangId)?.harga ?? 0),
  }));
  const dpp = totalBaris(barisRetur);
  const ppn = hitungPpn(dpp, D(faktur.ppnPersen));
  const total = dpp.plus(ppn);
  const pengaturan = await ambilPengaturanPerusahaan(db);
  const sudahDibayar = jumlahkan(faktur.penerimaan.map((r) => D(r.jumlah).plus(r.potonganPajak)));
  const sudahDiretur = jumlahkan(faktur.retur.map((r) => r.total));
  const status = statusFaktur(D(faktur.total), D(faktur.uangMuka).plus(sudahDibayar), sudahDiretur.plus(total));

  const nomor = await nomorDokumenBerikutnya(db.returPenjualan, "RJ");

  await db.$transaction(async (tx) => {
    const [daftarJenis, daftarBarangRetur] = await Promise.all([
      jenisBarang(tx, daftarBaris.map((l) => l.barangId)),
      tx.barang.findMany({ where: { id: { in: daftarBaris.map((l) => l.barangId) } }, select: { id: true, hargaBeli: true } }),
    ]);
    const hargaPokokBarang = new Map(daftarBarangRetur.map((b) => [b.id, D(b.hargaBeli)]));
    const retur = await tx.returPenjualan.create({
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
            hargaPokok: daftarJenis.get(l.barangId) === "BARANG" ? (hargaPokokBarang.get(l.barangId) ?? NOL) : NOL,
          })),
        },
      },
    });

    for (const l of daftarBaris) {
      if (daftarJenis.get(l.barangId) === "BARANG") await tambahStok(tx, l.barangId, gudangId, l.jumlah);
    }
    await tx.fakturPenjualan.update({ where: { id: fakturId }, data: { status } });

    const jurnal = await catatJurnalReturPenjualan(tx, { nomor: retur.nomor, total, ppn }, barisRetur, pengaturan.akunPpnKeluaranId);
    if (jurnal) await tx.returPenjualan.update({ where: { id: retur.id }, data: { jurnalId: jurnal.id } });
  });

  revalidatePath("/penjualan/retur");
  revalidatePath("/penjualan/faktur");
  redirect("/penjualan/retur");
}

// ---------- Uang Muka Pelanggan (DP pesanan) ----------

/** DP diterima di muka atas sebuah pesanan: Dr Kas/Bank / Cr Uang Muka Pelanggan; dipakai mengurangi piutang saat faktur dibuat. */
export async function buatUangMuka(dataFormulir: FormData) {
  await wajibHakAksi("uang-muka.buat");
  const pesananId = String(dataFormulir.get("pesananId") ?? "");
  const akunId = String(dataFormulir.get("akunId") ?? "");
  const metodeBayar = String(dataFormulir.get("metodeBayar") ?? "TRANSFER");
  const keterangan = String(dataFormulir.get("keterangan") ?? "").trim() || null;
  if (!pesananId) throw new Error("Pesanan wajib dipilih");
  if (!akunId) throw new Error("Akun Kas/Bank penerima wajib dipilih");
  const jumlah = bacaUang(dataFormulir.get("jumlah"), "Jumlah uang muka");

  const pesanan = await db.pesananPenjualan.findUniqueOrThrow({ where: { id: pesananId }, include: { baris: true, uangMuka: true } });
  if (pesanan.baris.every((b) => D(b.jumlahDifaktur).gte(b.jumlah))) throw new Error(`${pesanan.nomor} sudah difaktur seluruhnya; uang muka tidak lagi bisa ditambahkan`);
  const pengaturan = await ambilPengaturanPerusahaan(db);
  // Batas wajar: seluruh DP ≤ nilai pesanan (termasuk PPN bila PKP)
  const nilaiBruto = D(pesanan.total).plus(pengaturan.pkp ? hitungPpn(D(pesanan.total), pengaturan.tarifPpnPersen) : NOL);
  const batas = nilaiBruto.minus(jumlahkan(pesanan.uangMuka.map((u) => u.jumlah)));
  if (jumlah.gt(batas)) throw new Error(`Uang muka melebihi nilai pesanan yang belum tertutup DP (maks ${format(terbesar(batas, NOL))})`);

  const nomor = await nomorDokumenBerikutnya(db.uangMukaPelanggan, "UM");
  await db.$transaction(async (tx) => {
    const uangMuka = await tx.uangMukaPelanggan.create({
      data: { nomor, pelangganId: pesanan.pelangganId, pesananId, akunId, jumlah, metodeBayar, keterangan },
    });
    const jurnal = await catatJurnalUangMuka(tx, uangMuka, pesanan.nomor);
    if (jurnal) await tx.uangMukaPelanggan.update({ where: { id: uangMuka.id }, data: { jurnalId: jurnal.id } });
  });

  revalidatePath("/penjualan/uang-muka");
  revalidatePath("/penjualan/pesanan");
  redirect("/penjualan/uang-muka");
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
export async function buatUangMukaFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatUangMuka(dataFormulir));
}
