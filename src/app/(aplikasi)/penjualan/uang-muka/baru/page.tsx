import Link from "next/link";
import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import { daftarAkunKasBank } from "@/lib/baganAkun";
import { ambilPengaturanPerusahaan, hitungPpn } from "@/lib/pengaturanPerusahaan";
import { D } from "@/lib/uang";
import FormulirAksi from "@/komponen/FormulirAksi";
import { buatUangMukaFormulir } from "@/lib/aksi/penjualan";
import { NomorDokumen } from "@/komponen/ui/Lencana";
import IsianKwitansi from "@/komponen/penjualan/IsianKwitansi";
import { PERUSAHAAN_UTAMA } from "@/lib/perusahaan";
import { nilaiBrutoKontrak, progresTermin } from "@/lib/rencanaTermin";

export default async function HalamanUangMukaBaru({ searchParams }: { searchParams: Promise<{ pesananId?: string; rencanaTerminId?: string }> }) {
  await wajibHak("uang-muka.buat");
  const { pesananId, rencanaTerminId } = await searchParams;
  const pesanan = pesananId
    ? await db.pesananPenjualan.findUnique({ where: { id: pesananId }, include: { pelanggan: true, baris: true, uangMuka: { orderBy: { tanggal: "asc" } }, rencanaTermin: { select: { id: true } } } })
    : null;
  // dokumen anak (D1 §8.4): kas milik perusahaan pesanan atau bersama, pajak dan kop dari perusahaan pesanan
  const perusahaanId = pesanan?.perusahaanId ?? PERUSAHAAN_UTAMA;
  const [daftarAkun, pengaturan, daftarKop, formatNomor, progres] = await Promise.all([
    daftarAkunKasBank(db, pesanan?.perusahaanId),
    ambilPengaturanPerusahaan(db, perusahaanId),
    db.kopSurat.findMany({ where: { perusahaanId, dihapusPada: null }, orderBy: [{ bawaan: "desc" }, { nama: "asc" }], select: { id: true, nama: true, bawaan: true } }),
    db.formatNomor.findUnique({ where: { perusahaanId_jenis: { perusahaanId, jenis: "kwitansi-dp" } }, select: { aktif: true } }),
    pesanan?.rencanaTermin.length ? progresTermin(db, pesanan.id) : null,
  ]);

  if (!pesananId || !pesanan) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="judul-halaman">Uang Muka Pelanggan Baru</h1>
        <p className="redup">
          Uang muka dicatat atas sebuah pesanan. Buka{" "}
          <Link href="/penjualan/pesanan" className="font-semibold text-blue-600 hover:underline">Pesanan Penjualan</Link>{" "}
          lalu klik <strong>Uang Muka</strong> pada pesanan yang dimaksud.
        </p>
      </div>
    );
  }

  const rp = (n: number) => n.toLocaleString("id-ID");
  // batas sama dengan buatUangMuka: pesanan bertermin memakai PPN pesanan dan nilai kontrak termin, tanpa termin rumus lama
  const nilaiBruto = progres
    ? Number(nilaiBrutoKontrak(pesanan.total, pesanan.ppnPersen))
    : Number(pesanan.total) + (pengaturan.pkp ? Number(hitungPpn(D(pesanan.total), pengaturan.tarifPpnPersen)) : 0);
  const sudahDp = pesanan.uangMuka.reduce((s, u) => s + Number(u.jumlah), 0);
  const dipakai = pesanan.uangMuka.reduce((s, u) => s + Number(u.jumlahDipakai), 0);
  const batas = Math.max(Math.round((nilaiBruto - sudahDp) * 100) / 100, 0);
  // butir termin terpilih (?rencanaTerminId): jumlah bawaan = sisa butir, dibatasi batas pesanan
  const butirTerpilih = progres?.butir.find((b) => b.id === rencanaTerminId) ?? null;
  const maks = butirTerpilih ? Math.min(Number(butirTerpilih.sisa), batas) : batas;
  const difakturSemua = pesanan.baris.every((b) => Number(b.jumlahDifaktur) >= Number(b.jumlah));

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="judul-halaman">Uang Muka untuk Pesanan {pesanan.nomor}</h1>
        <p className="redup">
          Pelanggan: {pesanan.pelanggan.nama} &middot; Nilai pesanan {rp(Number(pesanan.total))}
          {progres ? (
            Number(pesanan.ppnPersen) > 0 && <> (+ PPN {Number(pesanan.ppnPersen).toLocaleString("id-ID")}% = {rp(nilaiBruto)})</>
          ) : (
            pengaturan.pkp && <> (+ PPN {pengaturan.tarifPpnPersen.toString()}% = {rp(nilaiBruto)})</>
          )}
          {sudahDp > 0 && <> &middot; DP sudah diterima {rp(sudahDp)} (dipakai faktur {rp(dipakai)})</>}
        </p>
      </div>

      {pesanan.uangMuka.length > 0 && (
        <div className="kartu space-y-2">
          <h2 className="judul-kartu">Uang muka sebelumnya</h2>
          <ul className="text-sm space-y-1">
            {pesanan.uangMuka.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3">
                <NomorDokumen nomor={u.nomor} />
                <span className="angka">{rp(Number(u.jumlah))}<span className="text-slate-400"> · sisa {rp(Number(u.jumlah) - Number(u.jumlahDipakai))}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {difakturSemua ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Pesanan ini sudah difaktur seluruhnya; uang muka tidak lagi bisa ditambahkan. Catat pembayaran lewat Penerimaan pada fakturnya.</div>
      ) : (
        <FormulirAksi aksi={buatUangMukaFormulir} className="kartu flex flex-col gap-4">
          <input type="hidden" name="pesananId" value={pesanan.id} />
          {progres && (
            <div className="bidang">
              <label className="label" htmlFor="rencanaTerminId">Untuk termin</label>
              <select id="rencanaTerminId" name="rencanaTerminId" defaultValue={butirTerpilih?.id ?? ""} className="isian">
                <option value="">Tanpa termin</option>
                {progres.butir.map((b) => (
                  <option key={b.id} value={b.id} disabled={b.sisa.lte(0)}>
                    {b.label} · sisa Rp {rp(Number(b.sisa))}
                  </option>
                ))}
              </select>
              <span className="petunjuk">Pembayaran termin dibatasi nilai termin itu termasuk PPN.</span>
            </div>
          )}
          <div className="bidang">
            <label className="label" htmlFor="akunId">Akun Kas/Bank Penerima *</label>
            <select id="akunId" name="akunId" required className="isian">
              <option value="">-</option>
              {daftarAkun.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.kode} - {a.nama}
                </option>
              ))}
            </select>
          </div>
          <div className="bidang">
            <label className="label" htmlFor="jumlah">Jumlah Uang Muka *</label>
            <input id="jumlah" type="number" name="jumlah" step="0.01" min={0} max={maks} defaultValue={maks} required className="isian" />
            <span className="petunjuk">Maksimal {rp(maks)}.</span>
          </div>
          <div className="bidang">
            <label className="label" htmlFor="metodeBayar">Metode Pembayaran</label>
            <select id="metodeBayar" name="metodeBayar" defaultValue="TRANSFER" className="isian">
              <option value="TRANSFER">Transfer</option>
              <option value="TUNAI">Tunai</option>
              <option value="KARTU">Kartu</option>
            </select>
          </div>
          <div className="bidang">
            <label className="label" htmlFor="keterangan">Keterangan</label>
            <input id="keterangan" name="keterangan" placeholder="mis. DP 30% sesuai kontrak" className="isian" />
          </div>
          <details className="ubin">
            <summary className="cursor-pointer font-semibold text-sm">Detail kuitansi</summary>
            <div className="mt-3">
              <IsianKwitansi daftarKop={daftarKop} nomorOtomatis={!!formatNomor?.aktif} namaPelanggan={pesanan.pelanggan.nama} />
            </div>
          </details>
          <button type="submit" className="tombol tombol-utama">
            Catat Uang Muka
          </button>
        </FormulirAksi>
      )}
    </div>
  );
}
