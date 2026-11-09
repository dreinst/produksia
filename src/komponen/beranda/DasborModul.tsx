import { Suspense } from "react";
import type { PenggunaSesi } from "@/lib/hakAkses";
import type { TabBeranda as KodeTab } from "@/lib/beranda";
import { lingkupPerusahaan } from "@/lib/perusahaan";
import { ZONA_WAKTU } from "@/lib/laporan";
import TabBeranda from "@/komponen/beranda/TabBeranda";
import KerangkaPanel from "@/komponen/beranda/KerangkaPanel";
import PanelSaya from "@/komponen/beranda/PanelSaya";
import PanelCrmBeranda from "@/komponen/beranda/PanelCrmBeranda";
import PanelPenjualanDokumen from "@/komponen/beranda/PanelPenjualanDokumen";
import PanelSistem from "@/komponen/beranda/PanelSistem";
import PanelPemasaran from "@/komponen/beranda/PanelPemasaran";
import PanelProyek from "@/komponen/beranda/PanelProyek";

/**
 * Beranda untuk tab selain keuangan (D7 §7.4). Kepala sapaan, lingkup perusahaan, dan tanggal; baris tab bila
 * lebih dari satu; panel tab sebagai komponen server async di dalam Suspense. Semua angka panel mengikuti
 * lingkupPerusahaan() (null = gabungan).
 */
export default async function DasborModul({ tab, daftarTab, pengguna }: { tab: KodeTab; daftarTab: readonly KodeTab[]; pengguna: PenggunaSesi }) {
  const lingkup = await lingkupPerusahaan();
  const perusahaanId = lingkup.perusahaanId;
  const namaDepan = pengguna.nama.trim().split(/\s+/)[0] || pengguna.nama;
  const tanggal = new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: ZONA_WAKTU });
  const namaLingkup = lingkup.perusahaan?.nama ?? "Semua perusahaan";

  return (
    <div className="space-y-7">
      {daftarTab.length > 1 && <TabBeranda daftar={daftarTab} aktif={tab} />}
      <div>
        <h1 className="judul-halaman">Halo, {namaDepan}</h1>
        <p className="subjudul-halaman">{namaLingkup} · {tanggal}</p>
      </div>
      <Suspense key={`${tab}-${perusahaanId ?? "semua"}`} fallback={<KerangkaPanel />}>
        <IsiTab tab={tab} pengguna={pengguna} perusahaanId={perusahaanId} />
      </Suspense>
    </div>
  );
}

/** Panel per tab; tiap panel async punya Suspense sendiri (D7 §3.5 no. 6). */
function IsiTab({ tab, pengguna, perusahaanId }: { tab: KodeTab; pengguna: PenggunaSesi; perusahaanId: string | null }) {
  switch (tab) {
    case "saya":
      return <PanelSaya pengguna={pengguna} perusahaanId={perusahaanId} />;
    case "penjualan":
      return (
        <div className="space-y-7">
          <Suspense fallback={<KerangkaPanel />}>
            <PanelCrmBeranda pengguna={pengguna} perusahaanId={perusahaanId} />
          </Suspense>
          <Suspense fallback={<KerangkaPanel />}>
            <PanelPenjualanDokumen pengguna={pengguna} perusahaanId={perusahaanId} />
          </Suspense>
        </div>
      );
    case "pemasaran":
      return <PanelPemasaran pengguna={pengguna} perusahaanId={perusahaanId} />;
    case "proyek":
      return <PanelProyek pengguna={pengguna} perusahaanId={perusahaanId} />;
    case "sistem":
      return <PanelSistem pengguna={pengguna} perusahaanId={perusahaanId} />;
    default:
      return null;
  }
}
