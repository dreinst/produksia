"use client";

import { useRouter } from "next/navigation";

type AccountOption = { id: string; kode: string; nama: string };

export default function PilihAkun({
  daftarAkun,
  idTerpilih,
}: {
  daftarAkun: AccountOption[];
  idTerpilih?: string;
}) {
  const router = useRouter();

  return (
    <select
      defaultValue={idTerpilih ?? ""}
      className="isian isian-kecil w-auto"
      onChange={(e) => router.push(`/buku-besar/mutasi?akunId=${e.target.value}`)}
    >
      {daftarAkun.map((a) => (
        <option key={a.id} value={a.id}>
          {a.kode} - {a.nama}
        </option>
      ))}
    </select>
  );
}
