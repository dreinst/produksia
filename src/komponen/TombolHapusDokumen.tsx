import FormulirAksi from "@/komponen/FormulirAksi";
import { hapusDokumenFormulir, type JenisDokumen } from "@/lib/aksi/hapusDokumen";

/** Tombol "Hapus" untuk dokumen transaksi: membalik stok, jurnal, dan status dokumen induk dalam satu transaksi. */
export default function TombolHapusDokumen({ jenis, id, nomor, boleh }: { jenis: JenisDokumen; id: string; nomor: string; boleh: boolean }) {
  if (!boleh) return null;
  return (
    <FormulirAksi
      aksi={hapusDokumenFormulir.bind(null, jenis, id)}
      pesanKonfirmasi={`Hapus ${nomor}? Stok, jurnal, dan status dokumen terkait akan dibalik. Tindakan ini dicatat di log aktivitas.`}
      className="inline"
    >
      <button type="submit" className="tombol-tautan-bahaya">
        Hapus
      </button>
    </FormulirAksi>
  );
}
