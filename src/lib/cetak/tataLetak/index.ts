import type { TataLetakCetak } from "@/prisma-klien/enums";
import type { TampilanEventCetak } from "@/lib/cetak/tipe";
import type { MasukanTataLetak } from "@/lib/cetak/tataLetak/blok";
import { renderDproInvoice } from "@/lib/cetak/tataLetak/dproInvoice";
import { renderDproProposal } from "@/lib/cetak/tataLetak/dproProposal";
import { renderHkaBermerek } from "@/lib/cetak/tataLetak/hkaBermerek";
import { renderHkaEvent } from "@/lib/cetak/tataLetak/hkaEvent";
import { renderHkaMinimal } from "@/lib/cetak/tataLetak/hkaMinimal";
import { renderHkaStandar } from "@/lib/cetak/tataLetak/hkaStandar";
import { renderHkaSurat } from "@/lib/cetak/tataLetak/hkaSurat";
import { renderKwitansiEntitas } from "@/lib/cetak/tataLetak/kwitansiEntitas";
import { renderKwitansiPolos } from "@/lib/cetak/tataLetak/kwitansiPolos";

/*
 * Dispatcher tata letak (D3 §1.6): memilih fungsi tata letak dari pilihan kop dan template. Tidak membaca basis
 * data; penyaji (src/lib/cetak/index.ts) atau uji menyiapkan MasukanTataLetak lengkap.
 */

export type PilihanTataLetak = {
  tataLetak: TataLetakCetak;
  /** tampilan event HKA untuk penawaran dan faktur mode event bertata letak HKA_*; null = tata letak biasa */
  tampilanEvent: TampilanEventCetak | null;
  /** judul berkas untuk metadata PDF tata letak HKA ("Penawaran", "Invoice", ...) */
  judulBerkas: string;
};

export async function renderDokumen(m: MasukanTataLetak, p: PilihanTataLetak): Promise<Uint8Array> {
  if (p.tampilanEvent && p.tataLetak.startsWith("HKA_")) return renderHkaEvent(m, p.judulBerkas, p.tampilanEvent, p.tataLetak);
  switch (p.tataLetak) {
    case "HKA_STANDAR":
      return renderHkaStandar(m, p.judulBerkas);
    case "HKA_BERMEREK":
      return renderHkaBermerek(m, p.judulBerkas);
    case "HKA_SURAT":
      return renderHkaSurat(m, p.judulBerkas);
    case "HKA_MINIMAL":
      return renderHkaMinimal(m, p.judulBerkas);
    case "DPRO_INVOICE":
      return renderDproInvoice(m);
    case "DPRO_PROPOSAL":
      return renderDproProposal(m);
    case "KWITANSI_ENTITAS":
      if (!m.tema.gayaEntitas) throw new Error("Kwitansi entitas butuh gaya entitas di kop ini");
      return renderKwitansiEntitas(m, m.tema.gayaEntitas);
    case "KWITANSI_POLOS":
      return renderKwitansiPolos(m);
  }
}
