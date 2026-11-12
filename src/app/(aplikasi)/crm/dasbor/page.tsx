import { Suspense } from "react";
import { wajibHak } from "@/lib/otentikasi";
import { lingkupPerusahaan } from "@/lib/perusahaan";
import { periksaPengingatTindakLanjut } from "@/lib/crm";
import KerangkaPanel from "@/komponen/beranda/KerangkaPanel";
import PanelStatistikCrm from "@/komponen/crm/PanelStatistikCrm";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";

/** Dasbor CRM (D4 §7.2, §7.5): statistik lead menurut lingkup perusahaan (gabungan = penjumlahan). */
export default async function HalamanDasborCrm() {
  const pengguna = await wajibHak("lead.lihat");
  await periksaPengingatTindakLanjut(pengguna.id).catch(() => 0);
  const lingkup = await lingkupPerusahaan();
  return (
    <div className="space-y-6">
      <KepalaHalaman jejak={[{ label: "CRM" }, { label: "Dasbor CRM" }]} judul="Dasbor CRM" subjudul={lingkup.perusahaan ? lingkup.perusahaan.nama : "Semua perusahaan"} />
      <Suspense fallback={<KerangkaPanel />}>
        <PanelStatistikCrm perusahaanId={lingkup.perusahaanId} sekarang={new Date()} pengguna={pengguna} />
      </Suspense>
    </div>
  );
}
