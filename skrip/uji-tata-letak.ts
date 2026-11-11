import { readFileSync } from "node:fs";
import type { GayaAngka, GayaEntitas, UkuranKertas } from "../src/prisma-klien/enums";
import { asetBawaan } from "../src/lib/cetak/aset";
import { DATA_CONTOH, IDENTITAS_CONTOH, KWITANSI_CONTOH, WARNA_CONTOH, dokumenContoh, type NamaContoh } from "../src/lib/cetak/contoh";
import { dariDataPenjualan } from "../src/lib/cetak/dariDataPenjualan";
import { GalatIsiTerlaluTinggi, KERTAS, buatPerekam, type Perekam } from "../src/lib/cetak/mesin/kanvas";
import { petaAsetBawaan, tandaTanganDipakai, type MasukanTataLetak } from "../src/lib/cetak/tataLetak/blok";
import { renderDproInvoice } from "../src/lib/cetak/tataLetak/dproInvoice";
import { renderDproProposal } from "../src/lib/cetak/tataLetak/dproProposal";
import { PARAMETER_KWITANSI, renderKwitansiEntitas } from "../src/lib/cetak/tataLetak/kwitansiEntitas";
import { renderKwitansiPolos } from "../src/lib/cetak/tataLetak/kwitansiPolos";
import type { DokumenCetak } from "../src/lib/cetak/tipe";
import { Prisma } from "../src/prisma-klien/browser";
import { harusDitolak, pastikan } from "./bantuan";

/*
 * Uji tata letak D'Pro dan kwitansi per entitas (P29, D3 §3.6, §3.7, §9.1 bagian 2): setiap tata letak dirender
 * dari data contoh generator D'Pro (spec/10 §4.3) dengan aset bawaan repo, lalu diperiksa lewat perekam kanvas:
 * PDF sah, jumlah halaman, teks di dalam area isi, tanpa peringatan luapan, angka dan terbilang dengan gaya angka
 * yang benar, slot gambar, baris ringkasan tambahan, draf dan tanda tangan, isian kwitansi panjang (turun ukuran lalu
 * dipotong dengan peringatan), dan GalatIsiTerlaluTinggi untuk blok yang tidak bisa dipecah. Tanpa basis data.
 */

const D = (v: number | string) => new Prisma.Decimal(v);
const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");
const pdfSah = (b: Uint8Array) => latin1(b.subarray(0, 5)) === "%PDF-" && latin1(b.subarray(b.length - 8)).includes("%%EOF");
const halamanPdf = (b: Uint8Array) => (latin1(b).match(/\/Type \/Page\b(?!s)/g) ?? []).length;
const mediaBox = (b: Uint8Array) => [...latin1(b).matchAll(/\/MediaBox \[([^\]]+)\]/g)].map((m) => m[1].trim().split(/\s+/).map(Number));
const PT_PER_MM = 72 / 25.4;
const pxKePt = (px: number, s = 1) => ((px * 210) / 2480) * s * PT_PER_MM;

type Entitas = GayaEntitas | "SMARA";
type OpsiMasukan = { ukuran?: UkuranKertas; gayaAngka?: GayaAngka; judul?: string; tandaTangan?: boolean; ubah?: (d: DokumenCetak) => void; aset?: MasukanTataLetak["tema"]["aset"]; desimal?: 0 | 2 };

function masukan(nama: NamaContoh, ent: Entitas, o: OpsiMasukan = {}): MasukanTataLetak {
  const dok = dokumenContoh(nama);
  o.ubah?.(dok);
  const gaya = ent === "SMARA" ? null : ent;
  return {
    dok,
    identitas: IDENTITAS_CONTOH[ent],
    judul: o.judul ?? "INVOICE",
    ukuran: o.ukuran ?? "A4",
    tandaTangan: o.tandaTangan ?? false,
    perekam: buatPerekam(),
    tema: { ...WARNA_CONTOH[ent], gayaAngka: o.gayaAngka ?? "TITIK", desimal: o.desimal ?? 0, tampilLogo: true, tampilWatermark: false, gayaEntitas: gaya, aset: o.aset ?? petaAsetBawaan(gaya) },
  };
}

const teksHal = (r: Perekam, hal?: number) => r.teks.filter((t) => hal === undefined || t.halaman === hal).map((t) => t.teks);
const ada = (r: Perekam, cari: string, hal?: number) => teksHal(r, hal).some((t) => t.includes(cari));
const gabung = (r: Perekam, hal?: number) => teksHal(r, hal).join(" ");
const slot = (r: Perekam, nama: string, hal?: number) => r.gambar.some((g) => g.slot === nama && (hal === undefined || g.halaman === hal));

/** Semua teks (kecuali stempel) berakhir di atas margin bawah desain dan tidak melewati tepi kanan kertas. */
function dalamArea(r: Perekam, ukuran: UkuranKertas, bawahPt: number): boolean {
  const kertas = KERTAS[ukuran];
  const tinggi = kertas.tinggiMm * PT_PER_MM;
  const lebar = kertas.lebarMm * PT_PER_MM;
  return r.teks.filter((t) => t.teks !== "DRAF").every((t) => t.y + t.tinggi <= tinggi - bawahPt + 0.5 && t.x + t.lebar <= lebar + 0.5 && t.y >= 0);
}

/** Pemeriksaan umum satu hasil render. */
function periksaUmum(label: string, isi: Uint8Array, m: MasukanTataLetak, halaman: number, ukuran: UkuranKertas, bawahPt: number) {
  const r = m.perekam!;
  pastikan(pdfSah(isi), `${label}: PDF sah (%PDF- sampai %%EOF)`);
  pastikan(halamanPdf(isi) === halaman && r.halaman === halaman, `${label}: ${halaman} halaman (PDF ${halamanPdf(isi)}, perekam ${r.halaman})`);
  const kertas = KERTAS[ukuran];
  const kotak = mediaBox(isi)[0];
  pastikan(Math.abs(kotak[2] - kertas.lebarMm * PT_PER_MM) < 0.5 && Math.abs(kotak[3] - kertas.tinggiMm * PT_PER_MM) < 0.5, `${label}: kertas ${kertas.lebarMm} x ${kertas.tinggiMm} mm`);
  pastikan(r.peringatan.length === 0, `${label}: tanpa peringatan luapan (${r.peringatan.join(" | ")})`);
  pastikan(dalamArea(r, ukuran, bawahPt), `${label}: semua teks di dalam area isi, tidak menimpa kaki`);
}

async function ditolakGalatTinggi(label: string, fn: () => Promise<unknown>) {
  let galat: unknown = null;
  try {
    await fn();
  } catch (e) {
    galat = e;
  }
  pastikan(galat instanceof GalatIsiTerlaluTinggi && /terlalu tinggi/.test((galat as Error).message), `${label}: GalatIsiTerlaluTinggi ditangkap dengan pesan yang bisa ditampilkan`);
}

const TERBILANG_INVOICE = "DELAPAN PULUH JUTA EMPAT RATUS DELAPAN PULUH TIGA RIBU DUA RATUS ENAM PULUH RUPIAH";
const ttdUji = () => new Uint8Array(asetBawaan("BONANOVA", "LOGO")!); // gambar sah pengganti tanda tangan (bukan TTD asli)

async function main() {
  console.log("=== 1. Data contoh dan dariDataPenjualan ===");
  {
    const inv = dokumenContoh("invoiceDpro");
    pastikan(inv.ringkasan.total.equals(D("80483260")) && inv.ringkasan.subtotal.equals(D("73166600")) && inv.ringkasan.fee.equals(D("7316660")), "invoice contoh: total 73.166.600 + fee 7.316.660 = 80.483.260 (Desimal)");
    pastikan(inv.baris.reduce((n, b) => n.plus(b.nilai), D(0)).equals(inv.ringkasan.subtotal), "invoice contoh: jumlah nilai baris = total");
    pastikan(inv.ringkasan.feePersen?.equals(D(10)) === true && inv.ringkasan.diskonPersen === null, "fee PERSEN 10 menjadi feePersen 10, diskon NOMINAL menjadi diskonPersen null");
    const prop = dokumenContoh("proposalDpro");
    pastikan(prop.baris.length === 12 && prop.ringkasan.subtotal.equals(D("159515000")) && prop.ringkasan.total.equals(D("158625000")) && prop.ringkasan.addOn?.nilai.equals(D("3625000")) === true, "proposal contoh: 12 baris, 159.515.000, 158.625.000, add on 3.625.000");
    pastikan(prop.baris.reduce((n, b) => n.plus(b.nilai), D(0)).equals(D("159515000")) && prop.baris[2].frekuensi.equals(D(5)), "proposal contoh: nilai baris dari rumus (baris 3 freq 5 seperti data asli)");
    pastikan(dokumenContoh("kwitansiSahara").lampiranItem.length === 2 && dokumenContoh("invoiceDpro").lampiranItem.length === 0, "lampiranItem hanya untuk kwitansi (Sahara 2 item), faktur kosong");
    const h = dokumenContoh("hkaNawasena");
    pastikan(h.ringkasan.total.equals(D("79975500")) && dokumenContoh("hkaStandar").ringkasan.total.equals(D("1898100")) && dokumenContoh("hkaEvoked").ringkasan.sisa.equals(D("6648500")), "contoh HKA: 79.975.500, 1.898.100, sisa Evoked 6.648.500");
    pastikan(dokumenContoh("invoiceDpro") !== dokumenContoh("invoiceDpro"), "dokumenContoh mengembalikan salinan baru");
    const rusak = { ...DATA_CONTOH.invoiceDpro, ringkasan: { ...DATA_CONTOH.invoiceDpro.ringkasan, total: "abc" } };
    await harusDitolak("uang bukan angka ditolak", async () => dariDataPenjualan(rusak), "Angka tidak valid");
    const termin = dariDataPenjualan({
      ...DATA_CONTOH.invoiceDpro,
      jenis: "tagihan-termin",
      termin: [{ no: 1, label: "DP", persen: "30.00", jumlah: "1000.00", jumlahBruto: "1110.00", jatuhTempo: null, status: "DITAGIH" }],
      konteksTermin: { no: 2, jumlahButir: 3, label: "Termin 2", persen: "40.00", jumlah: "4000000.00", jumlahBruto: "4440000.00", nilaiKontrakBruto: "11100000.00", dibayarSebelumnya: "3330000.00", sisaSetelahTermin: "3330000.00", nomorPesanan: "SO-0001" },
    });
    pastikan(termin.skemaTermin[0].jumlahBruto.equals(D(1110)) && termin.konteksTermin?.jumlahBruto.equals(D(4440000)) === true && termin.lampiranItem.length === 0, "skema termin dan konteks termin dipetakan ke Desimal");
  }

  console.log("=== 2. Invoice D'Pro A4, A5, A5 landscape ===");
  for (const [ukuran, bawahPx, s] of [["A4", 300, 1], ["A5", 300, 1748 / 2480], ["A5_LANDSCAPE", 255, 1]] as const) {
    const m = masukan("invoiceDpro", "DPRO", { ukuran, gayaAngka: "KOMA" });
    const t0 = Date.now();
    const isi = await renderDproInvoice(m);
    const lama = Date.now() - t0;
    const r = m.perekam!;
    periksaUmum(`invoice ${ukuran}`, isi, m, 1, ukuran, pxKePt(bawahPx, s));
    for (const t of ["73,166,600", "7,316,660", "80,483,260", "Invoice No. 071/DPRO-INV2/IX/2026", "21 September 2026", "BANK CENTRAL ASIA", "440.008.0033", "AN. DONATUS PURBANDONO", "Donatus Purbandono", "ISSUED TO:", "Kantor Perwakilan Bank Indonesia Malang", "TERBILANG:"]) pastikan(ada(r, t), `invoice ${ukuran}: memuat "${t}"`);
    pastikan(gabung(r).includes(TERBILANG_INVOICE), `invoice ${ukuran}: terbilang KAPITAL 80.483.260`);
    pastikan(["Total", "Management Fee", "Grand Total"].every((t) => teksHal(r).includes(t)) && ["Discount", "PPN", "Uang Muka", "Sisa Tagihan", "Pembayaran Diterima", "Retur"].every((t) => !ada(r, t)), `invoice ${ukuran}: tepat tiga baris ringkasan Figma (tanpa Discount, PPN, Uang Muka)`);
    pastikan(["KOP", "KAKI", "WATERMARK", "JUDUL_INVOICE", "LABEL_PEMBAYARAN", "LABEL_SALAM"].every((n) => slot(r, n)) && !slot(r, "TANDA_TANGAN"), `invoice ${ukuran}: slot kop, kaki, watermark, judul, label pembayaran, label salam; tanpa tanda tangan`);
    pastikan(teksHal(r).filter((t) => t === "Rp").length === 8, `invoice ${ukuran}: "Rp" kiri di 5 baris rincian dan 3 baris ringkasan`);
    const label = r.teks.find((t) => t.teks === "ISSUED TO:")!;
    pastikan(label.ukuran === (ukuran === "A5" ? 6.5 : 9), `invoice ${ukuran}: ukuran huruf ISSUED TO ${label.ukuran} pt (37 px × skala)`);
    pastikan(lama < 1000, `invoice ${ukuran}: render ${lama} ms (< 1 detik)`);
  }
  {
    const m = masukan("invoiceDpro", "DPRO", { gayaAngka: "TITIK" });
    await renderDproInvoice(m);
    pastikan(ada(m.perekam!, "80.483.260") && !ada(m.perekam!, "80,483,260"), "invoice gaya TITIK: 80.483.260");
    const kop = m.perekam!.gambar.find((g) => g.slot === "KOP")!;
    pastikan(Math.abs(kop.w - 210 * PT_PER_MM) < 0.1 && Math.abs(kop.h - pxKePt(415)) < 0.1 && kop.y === 0, "kop selebar kertas setinggi 415 px menempel tepi atas");
  }

  console.log("=== 3. Invoice dengan PPN, uang muka, pembayaran, retur ===");
  {
    const m = masukan("invoiceDpro", "DPRO", {
      gayaAngka: "KOMA",
      ubah: (d) => {
        d.ringkasan = { ...d.ringkasan, ppnPersen: D(11), ppn: D(8_853_159), total: D(89_336_419), uangMuka: D(20_000_000), terbayar: D(50_000_000), retur: D(1_000_000), sisa: D(38_336_419) };
        d.uangMukaDipakai = [{ nomor: "UM-0001", labelTermin: "Termin 1", jumlah: D(20_000_000) }];
        d.surat.syaratPembayaran = "- Transfer paling lambat 14 hari\n-- termasuk **PPN**";
      },
    });
    const isi = await renderDproInvoice(m);
    const r = m.perekam!;
    periksaUmum("invoice berpotongan", isi, m, 1, "A4", pxKePt(300));
    for (const t of ["PPN 11%", "8,853,159", "Uang Muka", "20,000,000", "Pembayaran Diterima", "30,000,000", "Retur", "1,000,000", "Sisa Tagihan", "38,336,419", "Uang muka yang dipotong:", "UM-0001 (Termin 1): Rp 20,000,000", "Transfer paling lambat 14 hari"]) pastikan(ada(r, t), `invoice berpotongan: memuat "${t}"`);
    const urut = ["Grand Total", "Uang Muka", "Pembayaran Diterima", "Retur", "Sisa Tagihan"].map((t) => r.teks.find((x) => x.teks === t)!.y);
    pastikan(urut.every((y, i) => i === 0 || y > urut[i - 1]), "invoice berpotongan: Uang Muka, Pembayaran Diterima, Retur, Sisa Tagihan di bawah Grand Total berurutan");
    pastikan(gabung(r).includes("DELAPAN PULUH SEMBILAN JUTA TIGA RATUS TIGA PULUH ENAM RIBU EMPAT RATUS SEMBILAN BELAS RUPIAH"), "invoice berpotongan: terbilang tetap dari total");
  }

  console.log("=== 4. Tagihan termin tanpa baris ===");
  {
    const ubah = (d: DokumenCetak) => {
      d.jenis = "tagihan-termin";
      d.baris = [];
      d.ringkasan = { ...d.ringkasan, subtotal: D(4_000_000), fee: D(0), dpp: D(4_000_000), ppnPersen: D(11), ppn: D(440_000), total: D(4_440_000), sisa: D(4_440_000) };
      d.konteksTermin = { no: 2, jumlahButir: 3, label: "Termin 2", persen: D(40), jumlah: D(4_000_000), jumlahBruto: D(4_440_000), nilaiKontrakBruto: D(11_100_000), dibayarSebelumnya: D(3_330_000), sisaSetelahTermin: D(3_330_000), nomorPesanan: "SO-0001" };
    };
    const m = masukan("invoiceDpro", "DPRO", { gayaAngka: "KOMA", ubah });
    await renderDproInvoice(m);
    const r = m.perekam!;
    pastikan(ada(r, "Termin 2 - Kantor Perwakilan Bank Indonesia Malang") && ada(r, "Termin 2 dari 3 (40% dari nilai kontrak)") && ada(r, "Ref. pesanan SO-0001") && ada(r, "Sisa tagihan setelah termin ini: Rp 3,330,000"), "tagihan termin: satu baris dibangun dari konteksTermin dengan butir posisi kontrak");
    pastikan(ada(r, "Invoice No. 071/DPRO-INV2/IX/2026") && slot(r, "JUDUL_INVOICE"), "tagihan termin berjudul INVOICE: label Invoice No. dan gambar judul");
    const m2 = masukan("invoiceDpro", "DPRO", { gayaAngka: "KOMA", ubah, judul: "TAGIHAN TERMIN" });
    await renderDproInvoice(m2);
    pastikan(ada(m2.perekam!, "No. Tagihan Termin 071/DPRO-INV2/IX/2026") && ada(m2.perekam!, "TAGIHAN TERMIN") && !slot(m2.perekam!, "JUDUL_INVOICE"), "judul TAGIHAN TERMIN: teks judul, label No. Tagihan Termin, tanpa gambar INVOICE");
  }

  console.log("=== 5. Proposal D'Pro A4 ===");
  {
    const m = masukan("proposalDpro", "DPRO", { gayaAngka: "KOMA", judul: "PENAWARAN" });
    const isi = await renderDproProposal(m);
    const r = m.perekam!;
    periksaUmum("proposal", isi, m, 2, "A4", pxKePt(300));
    for (const t of ["159,515,000", "890,000", "158,625,000", "3,625,000", "TOTAL BIAYA LANGSUNG (NETT)", "DISCOUNT", "GRAND TOTAL BIAYA", "ADD ON", "Diajukan Oleh", "Disetujui Oleh", "NO: 064/DPRO/P1/VIII/2026", "Malang, 26 Agustus 2026", "Kepada Yth :", "PPK Balai BPHL Wilayah IX Mataram", ": Kunjungan Lapangan BPHL Wilayah IX Mataram", ": 27-30 Agustus 2026", "Dengan hormat,", "48,750,000", "650,000", "D'Production"])
      pastikan(ada(r, t, 1), `proposal halaman 1: memuat "${t}"`);
    pastikan(!teksHal(r, 1).some((t) => /^Rp\b/.test(t)), "proposal: tidak ada teks Rp di tabel (angka tanpa Rp)");
    pastikan(["MANAGEMENT FEE", "PPN"].every((t) => !ada(r, t)), "proposal contoh: tanpa baris MANAGEMENT FEE dan PPN (persis empat baris Figma)");
    for (const t of ["Nb.", "Donny", "081.938.938.800", "Demikian pengajuan anggaran"]) pastikan(ada(r, t, 2), `proposal halaman 2: memuat "${t}"`);
    pastikan(gabung(r, 2).includes("BCA an. Donatus Purbandono ac. 440.008.0033"), "proposal halaman 2: rekening BCA an. Donatus Purbandono ac. 440.008.0033");
    pastikan(slot(r, "LABEL_SALAM", 2) && slot(r, "KOP", 1) && slot(r, "KOP", 2) && slot(r, "WATERMARK", 2), "proposal: label salam di halaman 2, kop dan watermark di kedua halaman");
    const nomor = r.teks.filter((t) => t.halaman === 1 && /^\d+$/.test(t.teks) && t.x + t.lebar < pxKePt(261 + 70)).map((t) => t.teks);
    pastikan(nomor.join() === "1,2,3,4,5,6,7,8,9,10,11,12", `proposal: 12 baris anggaran (nomor ${nomor.join(",")})`);

    const panjang = masukan("proposalDpro", "DPRO", {
      gayaAngka: "KOMA",
      judul: "PENAWARAN",
      ubah: (d) => {
        d.baris = Array.from({ length: 40 }, (_, i) => ({ ...d.baris[i % 12], no: i + 1 }));
      },
    });
    const isi2 = await renderDproProposal(panjang);
    const r2 = panjang.perekam!;
    const hTabelAkhir = r2.teks.find((t) => t.teks === "Diajukan Oleh")!.halaman;
    pastikan(pdfSah(isi2) && r2.halaman === hTabelAkhir + 1 && r2.teks.filter((t) => t.teks === "Uraian").length === hTabelAkhir && ada(r2, "Demikian pengajuan", hTabelAkhir + 1), `proposal 40 baris: kepala tabel diulang di ${hTabelAkhir} halaman, tanda tangan di halaman tabel selesai, penutup di halaman berikutnya`);
    pastikan(dalamArea(r2, "A4", pxKePt(300)) && r2.peringatan.length === 0, "proposal 40 baris: tidak menimpa kaki, tanpa peringatan");
  }

  console.log("=== 6. Kwitansi per entitas, A5 landscape dan A4 ===");
  const harapan: Record<GayaEntitas, { teks: string[]; slot: string[]; halaman: number; judul: string }> = {
    DPRO: { judul: "KWITANSI", halaman: 1, slot: ["KOP", "KAKI", "WATERMARK"], teks: ["069/DPRO-INV2/IX/2026", "Telah Terima Dari", "Hendy Pratama, PT. Tamapro", "Rp 44.340.000", "# Empat Puluh Empat Juta Tiga Ratus Empat Puluh Ribu Rupiah #", "Malang, 26 September 2026", "Donatus Purbandono", "NB : Transfer BCA Malang Cab. Galunggung", "440.008.0033 an Donatus Purbandono", "Pembayaran Termin 2 Event BamBimBoom Fest, Utama Raya, 27 September 2026"] },
    TAPUSSA: { judul: "KWITANSI", halaman: 1, slot: ["KOP", "LOGO", "JUDUL_KWITANSI", "KAKI"], teks: ["014/TB/INV3/VII/2026", "20 Agustus 2026", "KPw Bank Indonesia Malang", "Rp 12.650.000", "# Dua Belas Juta Enam Ratus Lima Puluh Ribu Rupiah #", "Hormat Kami", "Nadia Yuliana", "NB : Transfer BCA Malang Cab. Kawi", "385.199.9921 TAPUSSA BHALLIKA CV"] },
    BONANOVA: { judul: "KWITANSI", halaman: 1, slot: ["WATERMARK", "LOGO"], teks: ["055/BONA-INV2/VIII/2026", "Terima dari", "Cansa", "Rp 500.000,-", "# Lima Ratus Ribu Rupiah #", "Malang, 31 Agustus 2026", "Bintang Wahyu", "Manager", "Payment :", "Account No", ": 3851999921", ": CV Tapussa Bhallika", "DP Pembayaran Bonanova Ruby (Keyboard dan Vocal)", "11 Oktober 2026"] },
    SAHARA: { judul: "KWITANSI", halaman: 2, slot: ["LOGO"], teks: ["KWITANSI", "NO : 311/KWI-SHR/IX/2026", "PT. Bentoel Prima Tbk., Karanglo", "Rp 531.000", "# Lima Ratus Tiga Puluh Satu Ribu Rupiah #", "Malang, 4 September 2026", "PAYMENT :", "REK BCA an BINA KARISMA NEGARA", "No 3850972931", "BINA KARISMA NEGARA"] },
    NAWASENA: { judul: "KUITANSI", halaman: 1, slot: ["KOP", "JUDUL_KWITANSI"], teks: ["NO", ": 012/NAWA-KWI/X/2026", "24 Oktober 2026", "Telah Diterima Dari", "Baam Entertainment", "Rp 2.500.000", "# Dua Juta Lima Ratus Ribu Rupiah #", "Hormat Kami,", "Firdaus Romanda Lumban Toruan", "816-178-8228 An DPRODUCTION NAWASENA CV"] },
  };
  for (const gaya of Object.keys(harapan) as GayaEntitas[]) {
    const h = harapan[gaya];
    for (const ukuran of ["A5_LANDSCAPE", "A4"] as const) {
      const m = masukan(KWITANSI_CONTOH[gaya], gaya, { ukuran, judul: h.judul });
      const t0 = Date.now();
      const isi = await renderKwitansiEntitas(m, gaya);
      const lama = Date.now() - t0;
      const r = m.perekam!;
      const label = `kwitansi ${gaya} ${ukuran}`;
      periksaUmum(label, isi, m, h.halaman, ukuran, pxKePt(150));
      for (const t of h.teks) pastikan(ada(r, t, 1), `${label}: memuat "${t}"`);
      pastikan(h.slot.every((s) => slot(r, s, 1)) && !slot(r, "TANDA_TANGAN"), `${label}: slot ${h.slot.join(", ")}; tanpa tanda tangan`);
      pastikan(lama < 1000, `${label}: render ${lama} ms (< 1 detik)`);
      // isian baris rata bawah: teks nilai TERIMA_DARI berakhir 1,25 × ukuran di atas y baris
      const rw = PARAMETER_KWITANSI[gaya].baris;
      const terima = r.teks.find((t) => t.x > pxKePt(rw.nilaiX) - 1 && Math.abs(t.y - (pxKePt(rw.daftar[0].y) - 1.25 * t.ukuran)) < 0.01);
      pastikan(!!terima, `${label}: nilai baris pertama di x ${rw.nilaiX} px, rata bawah y ${rw.daftar[0].y} px`);
    }
  }
  {
    const m = masukan("kwitansiSahara", "SAHARA", { ukuran: "A5_LANDSCAPE", judul: "KWITANSI" });
    await renderKwitansiEntitas(m, "SAHARA");
    const r = m.perekam!;
    for (const t of ["LAMPIRAN", "No.", "ITEM", "QTY", "UNIT COST", "JUMLAH", "Nasi Kotak Spesial", "Rp 50.000", "Rp 300.000", "Rp 38.500", "Rp 231.000", "TOTAL", "Rp 531.000", "Pax"]) pastikan(ada(r, t, 2), `Sahara halaman 2: memuat "${t}"`);
    pastikan(!ada(r, "LAMPIRAN", 1) && slot(r, "LOGO", 2), "Sahara: lampiran hanya di halaman 2, logo diulang");
    const m4 = masukan("kwitansiBonanova", "BONANOVA", { ukuran: "A4", judul: "KWITANSI" });
    await renderKwitansiEntitas(m4, "BONANOVA");
    const wm = m4.perekam!.gambar.find((g) => g.slot === "WATERMARK")!;
    pastikan(Math.abs(wm.x - pxKePt(1925)) < 0.01 && Math.abs(wm.y - pxKePt(3508 - 2450)) < 0.01 && Math.abs(wm.w - pxKePt(555)) < 0.01, "Bonanova A4: watermark di posisi khusus A4 (1925, H - 2450, 555 x 2450)");
    const mt = masukan("kwitansiTapussa", "TAPUSSA", { ukuran: "A4", judul: "KWITANSI" });
    await renderKwitansiEntitas(mt, "TAPUSSA");
    const kaki = mt.perekam!.gambar.find((g) => g.slot === "KAKI")!;
    pastikan(Math.abs(kaki.y - pxKePt(3508 - 204)) < 0.01, "Tapussa A4: kaki menempel tepi bawah (H - 204)");
  }

  console.log("=== 7. Invoice tulisan ===");
  {
    const m = masukan("invoiceTulisanDpro", "DPRO", { ukuran: "A5_LANDSCAPE" });
    const isi = await renderKwitansiEntitas(m, "DPRO");
    const r = m.perekam!;
    periksaUmum("invoice tulisan DPRO", isi, m, 1, "A5_LANDSCAPE", pxKePt(150));
    pastikan(ada(r, "Kepada") && !ada(r, "Telah Terima Dari") && ada(r, "Baam Entertainment") && ada(r, "Rp 8.261.539") && ada(r, "# Delapan Juta Dua Ratus Enam Puluh Satu Ribu Lima Ratus Tiga Puluh Sembilan Rupiah #") && ada(r, "Pembayaran Talent Azalia"), "invoice tulisan DPRO: Kepada, Rp 8.261.539, terbilang JUDUL, keperluan dari nama baris");
    const n = masukan("invoiceTulisanNawasena", "NAWASENA", { ukuran: "A5_LANDSCAPE" });
    await renderKwitansiEntitas(n, "NAWASENA");
    pastikan(slot(n.perekam!, "JUDUL_INVOICE") && !slot(n.perekam!, "JUDUL_KWITANSI") && ada(n.perekam!, "Kepada") && ada(n.perekam!, "Pelunasan Talent Azalia, 24 Oktober 2026"), "invoice tulisan Nawasena: gambar JUDUL_INVOICE, label Kepada, keperluan dari perihal");
    const t = masukan("invoiceTulisanDpro", "TAPUSSA", { ukuran: "A5_LANDSCAPE" });
    await renderKwitansiEntitas(t, "TAPUSSA");
    pastikan(slot(t.perekam!, "JUDUL_INVOICE") && !slot(t.perekam!, "JUDUL_KWITANSI"), "invoice tulisan Tapussa: gambar JUDUL_INVOICE");
    const lain = masukan("invoiceTulisanDpro", "TAPUSSA", { ukuran: "A5_LANDSCAPE", judul: "PROFORMA INVOICE" });
    await renderKwitansiEntitas(lain, "TAPUSSA");
    pastikan(!slot(lain.perekam!, "JUDUL_INVOICE") && ada(lain.perekam!, "PROFORMA INVOICE"), "judul selain INVOICE ditulis sebagai teks, bukan gambar");
    const nk = masukan("kwitansiNawasena", "NAWASENA", { ukuran: "A5_LANDSCAPE", judul: "KWITANSI" });
    await renderKwitansiEntitas(nk, "NAWASENA");
    pastikan(slot(nk.perekam!, "JUDUL_KWITANSI"), "Nawasena judul KWITANSI juga memakai gambar KUITANSI (judul bawaan gambar)");
  }

  console.log("=== 8. Isian kwitansi: potongan pajak, info bank, teks panjang ===");
  {
    const m = masukan("kwitansiDpro", "DPRO", {
      ukuran: "A5_LANDSCAPE",
      judul: "KWITANSI",
      ubah: (d) => {
        d.kwitansi = { ...d.kwitansi!, potonganPajak: D(500_000) };
        d.surat.infoBank = "Transfer Mandiri 123-456 an Contoh";
      },
    });
    const isi = await renderKwitansiEntitas(m, "DPRO");
    const r = m.perekam!;
    periksaUmum("kwitansi potongan", isi, m, 1, "A5_LANDSCAPE", pxKePt(150));
    pastikan(ada(r, "Termasuk PPh 23 dipotong pelanggan: Rp 500.000") && ada(r, "Rp 44.340.000"), "kwitansi: catatan PPh 23 di bawah nominal, nominal tetap");
    pastikan(ada(r, "Transfer Mandiri 123-456 an Contoh") && !ada(r, "NB : Transfer"), "kwitansi: info bank dokumen menggantikan baris rekening");

    const empatBaris = "Pembayaran Termin 2 Event BamBimBoom Fest, Utama Raya, 27 September 2026, termasuk sewa panggung, tata suara, tata cahaya, dokumentasi, konsumsi kru, transportasi, dan perlengkapan pendukung lain selama tiga hari acara di Malang";
    const turun = masukan("kwitansiDpro", "DPRO", { ukuran: "A5_LANDSCAPE", judul: "KWITANSI", ubah: (d) => (d.kwitansi = { ...d.kwitansi!, keperluan: `${empatBaris}, dengan pembayaran sisa setelah acara selesai sesuai kesepakatan kedua pihak dan rincian di surat penawaran` }) });
    await renderKwitansiEntitas(turun, "DPRO");
    const rt = turun.perekam!;
    const baris = rt.teks.filter((t) => t.x > pxKePt(744) - 1 && t.y > pxKePt(800) && t.y < pxKePt(1030));
    pastikan(rt.peringatan.length === 0 && baris.length === 3 && baris.every((t) => t.ukuran < 8 && t.ukuran >= 6), `keperluan lebih dari 3 baris di 8 pt: ukuran turun ke ${baris[0]?.ukuran} pt, tiga baris, tanpa peringatan`);
    pastikan(gabung(rt).replace(/\s+/g, " ").includes("rincian di surat penawaran"), "keperluan yang turun ukuran tetap utuh");

    const sangat = masukan("kwitansiDpro", "DPRO", { ukuran: "A5_LANDSCAPE", judul: "KWITANSI", ubah: (d) => (d.kwitansi = { ...d.kwitansi!, keperluan: Array(12).fill(empatBaris).join(" ") }) });
    const isi3 = await renderKwitansiEntitas(sangat, "DPRO");
    const rs = sangat.perekam!;
    const potong = rs.teks.filter((t) => t.x > pxKePt(744) - 1 && t.y > pxKePt(800) && t.y < pxKePt(1030));
    pastikan(pdfSah(isi3) && rs.peringatan.some((p) => p.startsWith("teks terpotong")) && potong.length === 3 && potong[2].teks.endsWith("…") && potong.every((t) => t.ukuran === 6), "keperluan sangat panjang: ukuran 6 pt, tiga baris, baris terakhir diakhiri … dan peringatan teks terpotong");
    pastikan(dalamArea(rs, "A5_LANDSCAPE", pxKePt(150)), "keperluan sangat panjang: tidak menimpa blok bawah atau kaki");
    const nomorPanjang = masukan("kwitansiDpro", "DPRO", { ukuran: "A5_LANDSCAPE", judul: "KWITANSI", ubah: (d) => (d.nomorTampil = "069/DPRO-INV2/IX/2026/REVISI-KEDUA/LAMPIRAN-TAMBAHAN-PANJANG") });
    await renderKwitansiEntitas(nomorPanjang, "DPRO");
    const kotakNomor = nomorPanjang.perekam!.teks.find((t) => t.teks.startsWith("069/DPRO"))!;
    pastikan(kotakNomor.x >= pxKePt(216) && kotakNomor.x + kotakNomor.lebar <= pxKePt(216 + 560) + 0.5, "nomor panjang tetap di dalam kotak nomor");
  }

  console.log("=== 9. Kwitansi polos SMARA ===");
  {
    const m = masukan("kwitansiSmara", "SMARA", { ukuran: "A4", judul: "KWITANSI" });
    const isi = await renderKwitansiPolos(m);
    const r = m.perekam!;
    periksaUmum("kwitansi polos", isi, m, 1, "A4", 19.05 * PT_PER_MM);
    for (const t of ["SMARA", "KWITANSI", "No: 001/SMARA-KWI/IX/2026", "Telah Terima Dari", "Contoh Pelanggan", "# Dua Juta Rupiah #", "Rp 2.000.000", "LAMPIRAN", "Harga Satuan", "Sewa Perlengkapan Panggung", "Rp 1.500.000", "TOTAL", "Payment:", "BCA 385.199.9921 an TAPUSSA BHALLIKA CV", "Malang, 10 September 2026", "Nadia Yuliana"]) pastikan(ada(r, t), `kwitansi polos: memuat "${t}"`);
    pastikan(r.gambar.length === 0, "kwitansi polos: tanpa gambar dekorasi");
    const tanpa = masukan("kwitansiDpro", "SMARA", { ukuran: "A5_LANDSCAPE", judul: "KWITANSI" });
    const isi2 = await renderKwitansiPolos(tanpa);
    pastikan(halamanPdf(isi2) === 1 && mediaBox(isi2)[0][3] > 800 && !ada(tanpa.perekam!, "LAMPIRAN"), "kwitansi polos: selalu A4, tanpa lampiran bila tidak ada item");
  }

  console.log("=== 10. Draf, stempel, dan tanda tangan ===");
  {
    const aset = { ...petaAsetBawaan("DPRO"), TANDA_TANGAN: ttdUji() };
    const sah = masukan("invoiceDpro", "DPRO", { gayaAngka: "KOMA", tandaTangan: true, aset });
    await renderDproInvoice(sah);
    pastikan(slot(sah.perekam!, "TANDA_TANGAN") && tandaTanganDipakai(sah) !== null && !ada(sah.perekam!, "DRAF"), "invoice bukan draf dengan tanda tangan: gambar TANDA_TANGAN dibubuhkan, tanpa stempel");
    const tidakDiminta = masukan("invoiceDpro", "DPRO", { gayaAngka: "KOMA", tandaTangan: false, aset });
    await renderDproInvoice(tidakDiminta);
    pastikan(!slot(tidakDiminta.perekam!, "TANDA_TANGAN"), "tanda tangan tidak diminta: tidak dibubuhkan walau asetnya ada");
    const draf = masukan("proposalDpro", "DPRO", { gayaAngka: "KOMA", judul: "PENAWARAN", tandaTangan: true, aset, ubah: (d) => (d.draf = true) });
    await renderDproProposal(draf);
    const rd = draf.perekam!;
    pastikan(!slot(rd, "TANDA_TANGAN") && tandaTanganDipakai(draf) === null, "draf: tanda tangan tidak dibubuhkan walau diminta");
    pastikan(rd.teks.filter((t) => t.teks === "DRAF").map((t) => t.halaman).join() === "1,2", "draf: stempel DRAF di setiap halaman");
    const kw = masukan("kwitansiDpro", "DPRO", { ukuran: "A5_LANDSCAPE", judul: "KWITANSI", tandaTangan: true, aset });
    await renderKwitansiEntitas(kw, "DPRO");
    const g = kw.perekam!.gambar.find((x) => x.slot === "TANDA_TANGAN")!;
    pastikan(!!g && g.h <= pxKePt(302) + 0.01 && g.x >= pxKePt(1700) - 0.01 && g.x + g.w <= pxKePt(2300) + 0.01, "kwitansi: tanda tangan di kolom kanan setinggi paling banyak 302 px");
    const polos = masukan("kwitansiSmara", "SMARA", { judul: "KWITANSI", tandaTangan: true, aset: { TANDA_TANGAN: ttdUji() } });
    await renderKwitansiPolos(polos);
    pastikan(slot(polos.perekam!, "TANDA_TANGAN"), "kwitansi polos: tanda tangan dari unggahan kop");
    const tanpaAset = masukan("invoiceDpro", "DPRO", { gayaAngka: "KOMA", aset: {} });
    const isiTanpa = await renderDproInvoice(tanpaAset);
    pastikan(pdfSah(isiTanpa) && tanpaAset.perekam!.gambar.length === 0 && ada(tanpaAset.perekam!, "PAYMENT METHOD") && ada(tanpaAset.perekam!, "Hormat kami,") && ada(tanpaAset.perekam!, "INVOICE"), "kop tanpa aset: judul dan label ditulis sebagai teks, PDF tetap jadi");
  }

  console.log("=== 11. GalatIsiTerlaluTinggi ===");
  {
    const panjang = Array.from({ length: 400 }, (_, i) => `Baris info bank ${i + 1}`).join("\n");
    await ditolakGalatTinggi("invoice dengan info bank 400 baris", () => renderDproInvoice(masukan("invoiceDpro", "DPRO", { ubah: (d) => (d.surat.infoBank = panjang) })));
    await ditolakGalatTinggi("kwitansi polos dengan info bank 400 baris", () => renderKwitansiPolos(masukan("kwitansiSmara", "SMARA", { judul: "KWITANSI", ubah: (d) => (d.surat.infoBank = panjang) })));
    const tinggiBaris = masukan("invoiceDpro", "DPRO", { ubah: (d) => (d.baris[0].deskripsi = Array.from({ length: 200 }, (_, i) => `- rincian ${i + 1}`).join("\n")) });
    const isi = await renderDproInvoice(tinggiBaris);
    const r = tinggiBaris.perekam!;
    pastikan(pdfSah(isi) && r.halaman >= 3 && ada(r, "rincian 200") && r.peringatan.some((p) => p.includes("dipecah")) && dalamArea(r, "A4", pxKePt(300)), `baris dengan deskripsi 200 butir: dipecah ke ${r.halaman} halaman tanpa menimpa kaki`);
    const penutup = masukan("proposalDpro", "DPRO", { judul: "PENAWARAN", ubah: (d) => (d.surat.teksPenutup = Array(120).fill("Demikian pengajuan anggaran dari kami.").join(" ")) });
    const isi2 = await renderDproProposal(penutup);
    pastikan(pdfSah(isi2) && penutup.perekam!.halaman >= 3 && dalamArea(penutup.perekam!, "A4", pxKePt(300)), "paragraf penutup panjang mengalir ke halaman berikutnya tanpa galat");
  }

  console.log("=== 12. Impor ===");
  {
    const murni = ["src/lib/cetak/dariDataPenjualan.ts", "src/lib/cetak/contoh.ts"].map((f) => readFileSync(f, "utf8"));
    pastikan(murni.every((s) => !/from "(pdfkit|node:[^"]+|@\/lib\/db|@\/prisma-klien\/client|@\/lib\/cetak\/(aset|mesin\/[^"]+)|@\/lib\/dataCetakPenjualan)"/.test(s)), "dariDataPenjualan dan contoh tanpa basis data, pdfkit, berkas, atau mesin");
    pastikan(/import type \{[^}]*DokumenCetakPenjualan[^}]*\} from "@\/lib\/cetak\/tipe"/.test(murni[0]) && !/import \{[^}]*\} from "@\/lib\/uang"/.test(murni[0]), "dariDataPenjualan: kontrak D2 dan Desimal hanya import type");
    const tataLetak = ["blok", "dproInvoice", "dproProposal", "kwitansiEntitas", "kwitansiPolos"].map((f) => readFileSync(`src/lib/cetak/tataLetak/${f}.ts`, "utf8"));
    pastikan(tataLetak.every((s) => !s.includes("@/lib/db") && !s.includes("@/prisma-klien/client") && !s.includes('"use client"') && !s.includes("@/lib/dataCetakPenjualan")), "tata letak tidak membaca basis data dan bukan komponen klien");
  }

  console.log("=== DONE, all tata-letak checks passed ===");
}

main().catch((galat) => {
  console.error(galat);
  process.exit(1);
});
