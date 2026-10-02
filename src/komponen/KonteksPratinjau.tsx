"use client";

import React, { createContext, useContext, useState, type ReactNode } from "react";

export type ModePratinjau = "dokumen" | "jurnal" | "ringkasan";

export type DataPratinjauFormatur = {
  nomor?: string;
  tipe?: string;
  tanggal?: string;
  rekanan?: string;
  items?: { label: string; jumlah?: number; harga?: number; subtotal?: number }[];
  total?: number;
  catatan?: string;
  jurnal?: { akun: string; debit: number; kredit: number; catatan?: string }[];
  ringkasanStats?: { label: string; nilai: string | number; perubahan?: string; status?: "positif" | "negatif" | "netral" }[];
};

type TipeKonteksPratinjau = {
  terbuka: boolean;
  buka: () => void;
  tutup: () => void;
  toggle: () => void;
  mode: ModePratinjau;
  setMode: (mode: ModePratinjau) => void;
  kontenKustom: ReactNode | null;
  setKontenKustom: (konten: ReactNode | null) => void;
  judulPratinjau: string;
  setJudulPratinjau: (judul: string) => void;
  dataPratinjau: DataPratinjauFormatur | null;
  setDataPratinjau: (data: DataPratinjauFormatur | null) => void;
};

const KonteksPratinjau = createContext<TipeKonteksPratinjau | undefined>(undefined);

export function KonteksPratinjauProvider({ children }: { children: ReactNode }) {
  const [terbuka, setTerbuka] = useState(false);
  const [mode, setMode] = useState<ModePratinjau>("dokumen");
  const [kontenKustom, setKontenKustom] = useState<ReactNode | null>(null);
  const [judulPratinjau, setJudulPratinjau] = useState<string>("Live Preview");
  const [dataPratinjau, setDataPratinjau] = useState<DataPratinjauFormatur | null>(null);

  const buka = () => setTerbuka(true);
  const tutup = () => setTerbuka(false);
  const toggle = () => setTerbuka((v) => !v);

  return (
    <KonteksPratinjau.Provider
      value={{
        terbuka,
        buka,
        tutup,
        toggle,
        mode,
        setMode,
        kontenKustom,
        setKontenKustom,
        judulPratinjau,
        setJudulPratinjau,
        dataPratinjau,
        setDataPratinjau,
      }}
    >
      {children}
    </KonteksPratinjau.Provider>
  );
}

export function useKonteksPratinjau() {
  const konteks = useContext(KonteksPratinjau);
  if (!konteks) {
    throw new Error("useKonteksPratinjau harus digunakan dalam KonteksPratinjauProvider");
  }
  return konteks;
}
