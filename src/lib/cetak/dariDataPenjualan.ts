import { Prisma } from "@/prisma-klien/browser";
import type { Desimal } from "@/lib/uang";
import type { BarisCetak, DokumenCetak, DokumenCetakPenjualan } from "@/lib/cetak/tipe";

/*
 * Pemetaan data cetak penjualan D2 (uang berupa string toFixed(2)) ke model cetak netral D3 §3.2 (uang berupa
 * Desimal). Satu-satu, tanpa hitung ulang: pembulatan tetap milik server. Hanya `import type` dari kontrak D2
 * (DESAIN.md L6), dan Decimal diambil dari klien Prisma versi peramban, jadi berkas ini tidak pernah memuat basis
 * data. Tata letak hanya menerima hasil fungsi ini.
 */

function D(nilai: string): Desimal {
  let d: Desimal;
  try {
    d = new Prisma.Decimal(nilai);
  } catch {
    throw new Error(`Angka tidak valid: ${nilai}`);
  }
  if (!d.isFinite()) throw new Error(`Angka tidak valid: ${nilai}`);
  return d;
}

function barisCetak(b: DokumenCetakPenjualan["baris"][number]): BarisCetak {
  return {
    no: b.no,
    nama: b.nama,
    deskripsi: b.deskripsi,
    bagian: b.bagian,
    keterangan: b.keterangan,
    jumlah: D(b.jumlah),
    satuan: b.satuan,
    frekuensi: D(b.frekuensi),
    satuanFrekuensi: b.satuanFrekuensi,
    harga: D(b.harga),
    nilai: D(b.subtotal),
  };
}

export function dariDataPenjualan(data: DokumenCetakPenjualan): DokumenCetak {
  const r = data.ringkasan;
  const baris = data.baris.map(barisCetak);
  const kt = data.konteksTermin;
  return {
    jenis: data.jenis,
    id: data.id,
    perusahaanId: data.perusahaanId,
    kopSuratId: data.kopSuratId,
    nomorTampil: data.nomorTampil,
    nomorInternal: data.nomorInternal,
    draf: data.draf,
    judul: data.judul,
    tanggal: data.tanggal,
    tanggalKedua: data.tanggalKedua,
    referensi: data.referensi,
    kepada: { ...data.kepada },
    surat: {
      ...data.surat,
      catatan: data.catatan,
      catatanKanan: data.catatanKanan,
      syaratPembayaran: data.syaratPembayaran,
      infoBank: data.infoBank,
    },
    event: { ...data.event },
    baris,
    ringkasan: {
      subtotal: D(r.subtotal),
      diskon: D(r.diskon),
      diskonPersen: r.jenisDiskon === "PERSEN" ? D(r.nilaiDiskon) : null,
      fee: D(r.fee),
      feePersen: r.jenisFee === "PERSEN" ? D(r.nilaiFee) : null,
      dpp: D(r.dpp),
      ppnPersen: D(r.ppnPersen),
      ppn: D(r.ppn),
      total: D(r.total),
      uangMuka: D(r.uangMuka),
      terbayar: D(r.terbayar),
      retur: D(r.retur),
      sisa: D(r.sisa),
      addOn: r.addOn ? { nilai: D(r.addOn.nilai), keterangan: r.addOn.keterangan } : null,
    },
    // jumlahBruto = termasuk PPN (D3 §3.2)
    skemaTermin: data.termin.map((t) => ({ no: t.no, label: t.label, persen: D(t.persen), jumlahBruto: D(t.jumlahBruto), jatuhTempo: t.jatuhTempo })),
    konteksTermin: kt
      ? {
          no: kt.no,
          jumlahButir: kt.jumlahButir,
          label: kt.label,
          persen: D(kt.persen),
          jumlah: D(kt.jumlah),
          jumlahBruto: D(kt.jumlahBruto),
          nilaiKontrakBruto: D(kt.nilaiKontrakBruto),
          dibayarSebelumnya: kt.dibayarSebelumnya === null ? null : D(kt.dibayarSebelumnya),
          sisaSetelahTermin: D(kt.sisaSetelahTermin),
          nomorPesanan: kt.nomorPesanan,
        }
      : null,
    uangMukaDipakai: data.uangMukaDipakai.map((u) => ({ nomor: u.nomor, labelTermin: u.labelTermin, jumlah: D(u.jumlah) })),
    kwitansi: data.kwitansi
      ? {
          terimaDari: data.kwitansi.terimaDari,
          jumlah: D(data.kwitansi.jumlah),
          potonganPajak: D(data.kwitansi.potonganPajak),
          keperluan: data.kwitansi.keperluan,
          metodeBayar: data.kwitansi.metodeBayar,
          untukDokumen: data.kwitansi.untukDokumen,
        }
      : null,
    // rincian kwitansi gaya Sahara dan kwitansi polos: baris faktur atau pesanan terkait (D3 §3.2)
    lampiranItem: data.jenis === "kwitansi" || data.jenis === "kwitansi-dp" ? baris.map((b) => ({ ...b })) : [],
  };
}
