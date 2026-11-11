"use client";

import { useState } from "react";
import Ikon from "@/komponen/ui/Ikon";
import { ringkasanDokumenKlien, type JenisNilaiKlien } from "@/lib/hitungDokumenKlien";
import EditorBarisPenjualan, { barisDipakai, barisKiriman, barisKosong, kunciBarisBaru, type BarisEditor, type OpsiBarangPenjualan } from "@/komponen/penjualan/EditorBarisPenjualan";
import EditorRencanaTermin, { type ButirTerminAwal } from "@/komponen/penjualan/EditorRencanaTermin";

/*
 * Penyusun isi penawaran dan pesanan penjualan (D2 §7.2, §7.4): mode, isian event, baris, diskon, management fee, PPN,
 * add on (penawaran), dan rencana termin. Angka pratinjau dari hitungDokumenKlien.ts (sen bulat, rumus sama dengan
 * server). Nama isian = yang dibaca buatPenawaran, buatPesanan, dan ubahPenawaran.
 */

export type NilaiAwalPenyusun = {
  mode?: "STANDAR" | "EVENT";
  tampilanEvent?: "RINCI" | "RINGKAS";
  namaEvent?: string | null;
  venue?: string | null;
  tanggalEvent?: string | null;
  baris?: Omit<BarisEditor, "kunci">[];
  jenisDiskon?: JenisNilaiKlien;
  nilaiDiskon?: string;
  jenisFee?: JenisNilaiKlien;
  nilaiFee?: string;
  ppnPersen?: number;
  nilaiAddOn?: string;
  keteranganAddOn?: string | null;
  rencanaTermin?: ButirTerminAwal[];
};

const rupiah = (n: number) => n.toLocaleString("id-ID");

export default function PenyusunDokumenPenjualan({
  jenis,
  daftarBarang,
  daftarSeksi,
  bolehNego,
  bolehBawahMinimum,
  pajak,
  tampilanEventBawaan,
  nilaiAwal = {},
}: {
  jenis: "penawaran" | "pesanan";
  daftarBarang: OpsiBarangPenjualan[];
  daftarSeksi: string[];
  bolehNego: boolean;
  bolehBawahMinimum: boolean;
  /** status PKP dan tarif perusahaan dokumen; non-PKP selalu 0% */
  pajak: { pkp: boolean; tarif: number };
  tampilanEventBawaan: "RINCI" | "RINGKAS";
  nilaiAwal?: NilaiAwalPenyusun;
}) {
  const [mode, setMode] = useState<"STANDAR" | "EVENT">(nilaiAwal.mode ?? "STANDAR");
  const [baris, setBaris] = useState<BarisEditor[]>(() => (nilaiAwal.baris?.length ? nilaiAwal.baris.map((b) => ({ ...b, kunci: kunciBarisBaru() })) : [barisKosong()]));
  const [jenisDiskon, setJenisDiskon] = useState<JenisNilaiKlien>(nilaiAwal.jenisDiskon ?? "NOMINAL");
  const [nilaiDiskon, setNilaiDiskon] = useState(nilaiAwal.nilaiDiskon ?? "");
  const [jenisFee, setJenisFee] = useState<JenisNilaiKlien>(nilaiAwal.jenisFee ?? "PERSEN");
  const [nilaiFee, setNilaiFee] = useState(nilaiAwal.nilaiFee ?? "");
  const [ppnPersen, setPpnPersen] = useState(nilaiAwal.ppnPersen ?? (pajak.pkp ? pajak.tarif : 0));
  const event = mode === "EVENT";

  const dipakai = baris.filter(barisDipakai).map((b) => ({ jumlah: b.jumlah, harga: b.harga, frekuensi: event ? b.frekuensi : undefined }));
  const r = ringkasanDokumenKlien({ baris: dipakai, jenisDiskon, nilaiDiskon, jenisFee, nilaiFee, ppnPersen, dokumen: jenis });

  return (
    <>
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="baris" value={JSON.stringify(barisKiriman(baris, event))} />

      <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bidang md:col-span-2">
          <span className="label">Mode dokumen</span>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={!event} onChange={() => setMode("STANDAR")} /> Standar
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={event} onChange={() => setMode("EVENT")} />
              <Ikon nama="event" className="!text-[16px] text-blue-600" /> Event (Qty × Freq, seksi)
            </label>
          </div>
        </div>
        {event && (
          <>
            <div className="bidang">
              <label className="label" htmlFor="tampilanEvent">
                Tampilan cetak event
              </label>
              <select id="tampilanEvent" name="tampilanEvent" defaultValue={nilaiAwal.tampilanEvent ?? tampilanEventBawaan} className="isian">
                <option value="RINCI">Rinci: satu halaman</option>
                <option value="RINGKAS">Ringkas: ringkasan + lampiran RAB</option>
              </select>
            </div>
            <div className="bidang">
              <label className="label" htmlFor="namaEvent">
                Nama event
              </label>
              <input id="namaEvent" name="namaEvent" maxLength={160} defaultValue={nilaiAwal.namaEvent ?? ""} className="isian" />
            </div>
            <div className="bidang">
              <label className="label" htmlFor="venue">
                Venue
              </label>
              <input id="venue" name="venue" maxLength={160} defaultValue={nilaiAwal.venue ?? ""} className="isian" />
            </div>
            <div className="bidang">
              <label className="label" htmlFor="tanggalEvent">
                Tanggal event (teks)
              </label>
              <input id="tanggalEvent" name="tanggalEvent" maxLength={80} defaultValue={nilaiAwal.tanggalEvent ?? ""} placeholder="mis. 12 - 14 Desember 2026" className="isian" />
              <span className="petunjuk">Kosong = rentang tanggal proyek</span>
            </div>
          </>
        )}
      </div>

      <EditorBarisPenjualan baris={baris} ubahSemua={setBaris} event={event} daftarBarang={daftarBarang} daftarSeksi={daftarSeksi} bolehNego={bolehNego} bolehBawahMinimum={bolehBawahMinimum} />

      <section className="md:col-span-2 grid grid-cols-1 gap-4">
        <div className="ubin space-y-2 text-sm max-w-xl">
          <h3 className="judul-kartu">Ringkasan</h3>
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span className="angka">{rupiah(r.subtotal)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="nilaiDiskon">Diskon</label>
            <span className="flex items-center gap-2">
              <label htmlFor="jenisDiskon" className="sr-only">Jenis diskon</label>
              <select id="jenisDiskon" name="jenisDiskon" value={jenisDiskon} onChange={(e) => setJenisDiskon(e.target.value as JenisNilaiKlien)} className="isian isian-kecil w-auto" aria-label="Jenis diskon">
                <option value="NOMINAL">Rp</option>
                <option value="PERSEN">%</option>
              </select>
              <input id="nilaiDiskon" name="nilaiDiskon" type="number" min={0} step="0.01" value={nilaiDiskon} onChange={(e) => setNilaiDiskon(e.target.value)} className="isian isian-kecil w-32 text-right" />
              <span className="angka w-28 text-right">{r.diskon ? `- ${rupiah(r.diskon)}` : "-"}</span>
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="nilaiFee">Management fee</label>
            <span className="flex items-center gap-2">
              <label htmlFor="jenisFee" className="sr-only">Jenis management fee</label>
              <select id="jenisFee" name="jenisFee" value={jenisFee} onChange={(e) => setJenisFee(e.target.value as JenisNilaiKlien)} className="isian isian-kecil w-auto" aria-label="Jenis management fee">
                <option value="PERSEN">%</option>
                <option value="NOMINAL">Rp</option>
              </select>
              <input id="nilaiFee" name="nilaiFee" type="number" min={0} step="0.01" value={nilaiFee} onChange={(e) => setNilaiFee(e.target.value)} className="isian isian-kecil w-32 text-right" />
              <span className="angka w-28 text-right">{r.fee ? rupiah(r.fee) : "-"}</span>
            </span>
          </div>
          <p className="petunjuk">Management fee masuk DPP, dihitung dari subtotal setelah diskon.</p>
          <div className="flex justify-between font-semibold border-t border-dashed border-slate-200 pt-1">
            <span>Total sebelum PPN</span>
            <span className="angka">{rupiah(r.total)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="ppnPersen">PPN</label>
            {pajak.pkp ? (
              <span className="flex items-center gap-2">
                <select id="ppnPersen" name="ppnPersen" value={ppnPersen} onChange={(e) => setPpnPersen(Number(e.target.value))} className="isian isian-kecil w-auto" aria-label="Tarif PPN">
                  <option value={0}>0%</option>
                  <option value={pajak.tarif}>{pajak.tarif}%</option>
                </select>
                <span className="angka w-28 text-right">{rupiah(r.ppn)}</span>
              </span>
            ) : (
              <span className="angka text-slate-400">non-PKP</span>
            )}
          </div>
          <div className="flex justify-between font-semibold">
            <span>Total termasuk PPN</span>
            <span className="angka">{rupiah(r.totalDenganPpn)}</span>
          </div>
          {r.galat && (
            <p role="alert" className="text-sm text-rose-600">
              {r.galat}
            </p>
          )}
          {jenis === "penawaran" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-dashed border-slate-200 pt-2">
              <div className="bidang">
                <label className="label" htmlFor="nilaiAddOn">
                  Add on
                </label>
                <input id="nilaiAddOn" name="nilaiAddOn" type="number" min={0} step="0.01" defaultValue={nilaiAwal.nilaiAddOn ?? ""} className="isian isian-kecil" />
              </div>
              <div className="bidang">
                <label className="label" htmlFor="keteranganAddOn">
                  Keterangan add on
                </label>
                <input id="keteranganAddOn" name="keteranganAddOn" maxLength={200} defaultValue={nilaiAwal.keteranganAddOn ?? ""} className="isian isian-kecil" />
              </div>
              <p className="petunjuk sm:col-span-2">Add on ditampilkan di bawah grand total, tidak dijumlahkan</p>
            </div>
          )}
        </div>

        <div className="ubin space-y-2">
          <h3 className="judul-kartu">Termin pembayaran</h3>
          <EditorRencanaTermin basis={r.total} ppnPersen={ppnPersen} nilaiAwal={nilaiAwal.rencanaTermin} />
        </div>
      </section>
    </>
  );
}
