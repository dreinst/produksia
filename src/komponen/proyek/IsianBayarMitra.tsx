"use client";

import { useState } from "react";

/** Angka mitra untuk isian bayar (sudah Number). null bila pengguna tidak memegang bagi-hasil.lihat. */
export type AngkaBayarMitra = {
  modalKembali: number;
  dibayarModal: number;
  modalTerutang: number;
  sisaModal: number;
  bagianLaba: number;
  dibayarLaba: number;
  labaTerutang: number;
};
export type MitraIsianBayar = { id: string; nama: string; angka: AngkaBayarMitra | null };

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
const bawaanJenis = (m: MitraIsianBayar | undefined): "MODAL" | "LABA" => (m?.angka && m.angka.modalTerutang > 0 ? "MODAL" : "LABA");
const bawaanJumlah = (m: MitraIsianBayar | undefined, jenis: "MODAL" | "LABA"): string => {
  if (!m?.angka) return "";
  const n = jenis === "MODAL" ? m.angka.modalTerutang : m.angka.labaTerutang;
  return n > 0 ? String(n) : "";
};

/**
 * Isian mitra, jenis, dan jumlah Pembayaran ke Mitra (D5 §7.2). Jenis bawaan MODAL bila modal mitra masih terutang,
 * jumlah bawaan = terutang jenis itu, dan keduanya diisi ulang saat mitra atau jenis diganti. Tanpa angka (pengguna
 * tanpa hak lihat bagi hasil) isian tetap bisa dipakai tanpa nilai bawaan. Server tetap memvalidasi semuanya.
 */
export default function IsianBayarMitra({ mitra, mitraAwal }: { mitra: MitraIsianBayar[]; mitraAwal?: string }) {
  const awal = mitra.find((m) => m.id === mitraAwal) ?? mitra[0];
  const [mitraId, setMitraId] = useState(awal?.id ?? "");
  const [jenis, setJenis] = useState<"MODAL" | "LABA">(bawaanJenis(awal));
  const [jumlah, setJumlah] = useState(bawaanJumlah(awal, bawaanJenis(awal)));
  const terpilih = mitra.find((m) => m.id === mitraId);

  return (
    <>
      <div className="space-y-1 md:col-span-2">
        <label htmlFor="bayar-mitra" className="label">
          Mitra *
        </label>
        <select
          id="bayar-mitra"
          name="mitraId"
          required
          value={mitraId}
          onChange={(e) => {
            const m = mitra.find((x) => x.id === e.target.value);
            const j = bawaanJenis(m);
            setMitraId(e.target.value);
            setJenis(j);
            setJumlah(bawaanJumlah(m, j));
          }}
          className="isian"
        >
          {mitra.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nama}
            </option>
          ))}
        </select>
        {terpilih?.angka && (
          <p className="petunjuk">
            Modal kembali {rp(terpilih.angka.modalKembali)} (dibayar {rp(terpilih.angka.dibayarModal)}) · Bagian laba {rp(terpilih.angka.bagianLaba)} (dibayar {rp(terpilih.angka.dibayarLaba)}) · Sisa modal {rp(terpilih.angka.sisaModal)}
          </p>
        )}
      </div>
      <div className="space-y-1">
        <label htmlFor="bayar-jenis" className="label">
          Jenis *
        </label>
        <select
          id="bayar-jenis"
          name="jenis"
          required
          value={jenis}
          onChange={(e) => {
            const j = e.target.value === "MODAL" ? "MODAL" : "LABA";
            setJenis(j);
            setJumlah(bawaanJumlah(terpilih, j));
          }}
          className="isian"
        >
          <option value="MODAL">Pengembalian modal</option>
          <option value="LABA">Bagi laba</option>
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="bayar-jumlah" className="label">
          Jumlah (Rp) *
        </label>
        <input id="bayar-jumlah" name="jumlah" type="number" min="0.01" step="0.01" required value={jumlah} onChange={(e) => setJumlah(e.target.value)} className="isian angka" />
      </div>
    </>
  );
}
