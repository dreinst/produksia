import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { buatPenyesuaianPersediaanFormulir } from "@/lib/aksi/persediaan";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import EditorBarisPenyesuaian from "@/komponen/persediaan/EditorBarisPenyesuaian";

export default async function HalamanPenyesuaianBaru({ searchParams }: { searchParams: Promise<{ gudangId?: string }> }) {
  await wajibHak("persediaan.tulis");
  const { gudangId } = await searchParams;
  const [daftarGudang, daftarBarang, daftarStok, daftarAkun, pemetaan] = await Promise.all([
    db.gudang.findMany({ orderBy: { kode: "asc" } }),
    db.barang.findMany({ where: { jenis: "BARANG" }, orderBy: { kode: "asc" } }),
    db.stokBarang.findMany(),
    db.akun.findMany({ where: { kelompok: false, jenis: { in: ["MODAL", "BEBAN", "PENDAPATAN"] } }, orderBy: { kode: "asc" } }),
    db.pemetaanAkun.findUnique({ where: { id: "default" } }),
  ]);
  const gudangTerpilih = daftarGudang.find((g) => g.id === gudangId) ?? daftarGudang[0];
  const petaStok: Record<string, Record<string, number>> = {};
  for (const s of daftarStok) (petaStok[s.gudangId] ??= {})[s.barangId] = Number(s.jumlah);
  const akunModal = daftarAkun.find((a) => a.jenis === "MODAL");
  const akunLawanBawaan = pemetaan?.selisihPersediaanId ?? akunModal?.id ?? "";

  return (
    <div className="space-y-6 max-w-4xl">
      <KepalaHalaman
        jejak={[{ label: "Persediaan" }, { label: "Penyesuaian Stok", href: "/persediaan/penyesuaian" }]}
        judul="Penyesuaian Stok Baru"
        subjudul="Isi jumlah sesudah penyesuaian; selisihnya dinilai dengan harga pokok dan dijurnal ke akun lawan."
      />

      {!gudangTerpilih ? (
        <div className="kartu">
          <p className="redup">Belum ada gudang. Buat gudang dulu di Data Induk → Gudang.</p>
        </div>
      ) : (
        <FormulirAksi aksi={buatPenyesuaianPersediaanFormulir} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bidang">
            <label className="label" htmlFor="gudangId">Gudang *</label>
            {/* ganti gudang = muat ulang halaman agar stok sekarang ikut berubah */}
            <select id="gudangId" name="gudangId" required className="isian" defaultValue={gudangTerpilih.id} key={gudangTerpilih.id}>
              {daftarGudang.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.kode} - {g.nama}
                </option>
              ))}
            </select>
            {daftarGudang.length > 1 && (
              <span className="petunjuk">
                Stok sekarang mengikuti gudang {gudangTerpilih.nama}; untuk gudang lain buka{" "}
                {daftarGudang.filter((g) => g.id !== gudangTerpilih.id).map((g, i) => (
                  <span key={g.id}>
                    {i > 0 && ", "}
                    <a className="text-blue-600 hover:underline" href={`/persediaan/penyesuaian/baru?gudangId=${g.id}`}>{g.nama}</a>
                  </span>
                ))}
              </span>
            )}
          </div>

          <div className="bidang">
            <label className="label" htmlFor="akunLawanId">Akun lawan *</label>
            <select id="akunLawanId" name="akunLawanId" required className="isian" defaultValue={akunLawanBawaan}>
              <option value="">-</option>
              {daftarAkun.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.kode} - {a.nama}
                </option>
              ))}
            </select>
            <span className="petunjuk">Saldo awal → Modal (3-1000); opname/koreksi → Selisih Persediaan (5-1400)</span>
          </div>

          <div className="bidang md:col-span-2">
            <label className="label" htmlFor="keterangan">Keterangan</label>
            <input id="keterangan" name="keterangan" className="isian" placeholder="mis. Saldo awal persediaan / Opname September" />
          </div>

          <EditorBarisPenyesuaian
            gudangId={gudangTerpilih.id}
            petaStok={petaStok}
            daftarBarang={daftarBarang.map((b) => ({ id: b.id, kode: b.kode, nama: b.nama, satuan: b.satuan, hargaBeli: Number(b.hargaBeli) }))}
          />

          <div className="md:col-span-2">
            <button type="submit" className="tombol tombol-utama">
              Simpan Penyesuaian
            </button>
          </div>
        </FormulirAksi>
      )}
    </div>
  );
}
