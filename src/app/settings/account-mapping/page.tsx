import { db } from "@/lib/db";
import ActionForm from "@/components/ActionForm";
import { saveAccountMappingForm } from "@/lib/actions/settings";

const FIELDS = [
  { name: "piutangUsahaId", label: "Piutang Usaha (akun Aset)", filterType: "ASET" },
  { name: "persediaanId", label: "Persediaan Barang Dagang (akun Aset)", filterType: "ASET" },
  { name: "hppId", label: "Harga Pokok Penjualan / HPP (akun Beban)", filterType: "BEBAN" },
  { name: "pendapatanPenjualanId", label: "Pendapatan Penjualan (akun Pendapatan)", filterType: "PENDAPATAN" },
  { name: "utangUsahaId", label: "Utang Usaha (akun Kewajiban)", filterType: "KEWAJIBAN" },
] as const;

export default async function AccountMappingPage() {
  const [accounts, mapping] = await Promise.all([
    db.account.findMany({ orderBy: { code: "asc" } }),
    db.accountMapping.findUnique({ where: { id: "default" } }),
  ]);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold">Pemetaan Akun</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Menentukan akun mana yang dipakai saat sistem otomatis membuat jurnal dari transaksi Penjualan &
          Pembelian (Faktur, Penerimaan, Pembayaran, Retur). Wajib diisi sebelum transaksi tersebut bisa dibuat.
        </p>
      </div>

      <ActionForm
        action={saveAccountMappingForm}
        successMessage="Pemetaan akun tersimpan."
        className="flex flex-col gap-4 border rounded-lg p-4"
      >
        {FIELDS.map((field) => (
          <div key={field.name} className="flex flex-col gap-1">
            <label className="text-sm font-medium">{field.label} *</label>
            <select
              name={field.name}
              required
              defaultValue={(mapping as unknown as Record<string, string>)?.[field.name] ?? ""}
              className="border rounded px-2 py-1"
            >
              <option value="">-</option>
              {accounts
                .filter((a) => a.type === field.filterType)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} - {a.name}
                  </option>
                ))}
            </select>
          </div>
        ))}

        <button type="submit" className="bg-black text-white px-4 py-2 rounded text-sm w-fit">
          Simpan Pemetaan
        </button>
      </ActionForm>
    </div>
  );
}
