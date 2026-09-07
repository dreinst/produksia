"use client";

import { useRouter } from "next/navigation";

type OpsiAkun = { id: string; kode: string; nama: string };

export default function PilihAkun({
  daftarAkun,
  idTerpilih,
}: {
  daftarAkun: OpsiAkun[];
  idTerpilih?: string;
}) {
  const router = useRouter();

  return (
    <select
      id="akunId"
      name="akunId"
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
