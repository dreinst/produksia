import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { akunAntarPerusahaan, daftarPerusahaan, lingkupPerusahaan, perusahaanFormulir, type RingkasPerusahaan } from "@/lib/perusahaan";
import { tanggalIso } from "@/lib/waktu";
import { buatTransaksiAntarPerusahaanFormulir } from "@/lib/aksi/antarPerusahaan";
import FormulirAksi from "@/komponen/FormulirAksi";
import KolomPerusahaan from "@/komponen/KolomPerusahaan";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import Ikon from "@/komponen/ui/Ikon";

type Pilihan = { id: string; kode: string; nama: string; perusahaanId: string | null };

/** Pilihan dikelompokkan: "Bersama" (tanpa pemilik) lalu satu kelompok per perusahaan (kode). Kelompok kosong dibuang. */
function kelompokkan(daftar: Pilihan[], perusahaan: RingkasPerusahaan[]) {
  const kelompok = [{ label: "Bersama", isi: daftar.filter((x) => x.perusahaanId === null) }, ...perusahaan.map((p) => ({ label: p.kode, isi: daftar.filter((x) => x.perusahaanId === p.id) }))];
  return kelompok.filter((k) => k.isi.length > 0);
}

function PilihBerkelompok({ id, label, wajib, kosong, kelompok, petunjuk }: { id: string; label: string; wajib: boolean; kosong: string; kelompok: { label: string; isi: Pilihan[] }[]; petunjuk?: string }) {
  return (
    <div className="bidang">
      <label className="label" htmlFor={id}>
        {label}
        {wajib ? " *" : ""}
      </label>
      <select id={id} name={id} required={wajib} defaultValue="" className="isian">
        <option value="">{kosong}</option>
        {kelompok.map((k) => (
          <optgroup key={k.label} label={k.label}>
            {k.isi.map((x) => (
              <option key={x.id} value={x.id}>{`${x.kode} - ${x.nama}`}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {petunjuk && <span className="petunjuk">{petunjuk}</span>}
    </div>
  );
}

/**
 * Formulir Transaksi Antar Perusahaan (D1 §7.2). Pemberi mengikuti pola dokumen akar (KolomPerusahaan: baca saja di
 * lingkup satu perusahaan, pilihan wajib di gabungan). Penerima selalu pilihan wajib (KolomPerusahaan selaluPilih,
 * kontrak P24) tanpa bawaan, supaya tidak sama dengan pemberi. Akun dan event dikelompokkan per perusahaan; server
 * memeriksa pemiliknya terhadap perusahaan yang dipilih.
 */
export default async function HalamanAntarPerusahaanBaru() {
  const pengguna = await wajibHak("antar-perusahaan.buat");
  const lingkup = await lingkupPerusahaan();
  // lingkup perusahaan arsip diperlakukan seperti gabungan (tinjauan P17 butir 4)
  const pf = perusahaanFormulir(lingkup);
  const [semuaPerusahaan, akun, proyek, akunAp] = await Promise.all([
    daftarPerusahaan(true),
    db.akun.findMany({ where: { kelompok: false }, orderBy: { kode: "asc" }, select: { id: true, kode: true, nama: true, perusahaanId: true } }),
    db.proyek.findMany({ where: { status: { notIn: ["BATAL", "DIARSIP"] } }, orderBy: { kode: "asc" }, select: { id: true, kode: true, nama: true, perusahaanId: true } }),
    // akun yang ada tetapi tidak sah membuat aksi menolak dengan pesan yang sama; di sini ditampilkan sebagai peringatan
    akunAntarPerusahaan(db).then(
      (a) => ({ ...a, galat: null as string | null }),
      (e: Error) => ({ piutang: null, hutang: null, galat: e.message }),
    ),
  ]);
  const aktif = semuaPerusahaan.filter((p) => p.aktif);
  // akun antar perusahaan ditambahkan sistem, jadi tidak ditawarkan sebagai akun lawan
  const idAkunAp = new Set([akunAp.piutang?.id, akunAp.hutang?.id].filter((x): x is string => !!x));
  const akunLawan = akun.filter((a) => !idAkunAp.has(a.id));
  const akunPemberi = pf ? akunLawan.filter((a) => a.perusahaanId === null || a.perusahaanId === pf) : akunLawan;
  const akunBelumAda = !akunAp.galat && (!akunAp.piutang || !akunAp.hutang);
  const bolehBaganAkun = punyaHak(pengguna, "pengaturan.tulis");
  const proyekBerkelompok = kelompokkan(proyek, semuaPerusahaan);
  const hariIni = tanggalIso(new Date());

  return (
    <div className="space-y-6 max-w-3xl">
      <KepalaHalaman
        jejak={[{ label: "Buku Besar" }, { label: "Transaksi Antar Perusahaan", href: "/buku-besar/antar-perusahaan" }, { label: "Baru" }]}
        judul="Transaksi Antar Perusahaan Baru"
        subjudul="Sistem membuat dua jurnal sekaligus: Piutang Antar Perusahaan di buku pemberi dan Hutang Antar Perusahaan di buku penerima."
      />

      {(akunBelumAda || akunAp.galat) && (
        <div className="kartu flex gap-3 !py-4 text-sm text-rose-700" role="alert">
          <Ikon nama="error" className="!text-[20px] shrink-0 mt-0.5" />
          <div className="space-y-1">
            {akunBelumAda && (
              <p>
                Akun Piutang/Hutang Antar Perusahaan belum ada. Terapkan Bagan Akun Standar (akun 1-1750 dan 2-1550) lewat tombol &quot;Terapkan ke sistem&quot;, atau atur pemetaan tambahan di Pemetaan Akun.{" "}
                {bolehBaganAkun && (
                  <Link className="tombol-tautan" href="/pengaturan/bagan-akun">
                    Buka Bagan Akun Standar
                  </Link>
                )}
              </p>
            )}
            {akunAp.galat && <p>{akunAp.galat}</p>}
          </div>
        </div>
      )}

      <FormulirAksi aksi={buatTransaksiAntarPerusahaanFormulir} verifikasi={{ judul: "Periksa transaksi antar perusahaan" }} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        <fieldset className="bidang md:col-span-2">
          <legend className="label">Jenis *</legend>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="radio" name="jenis" value="TAGIH" defaultChecked required className="mt-1" />
            <span>Tagih: perusahaan pemberi membayarkan atau menanggung biaya untuk perusahaan penerima</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="radio" name="jenis" value="LUNAS" className="mt-1" />
            <span>Lunas: perusahaan penerima melunasi hutangnya ke perusahaan pemberi</span>
          </label>
          <span className="petunjuk">Sistem membuat dua jurnal sekaligus: Piutang Antar Perusahaan di buku pemberi dan Hutang Antar Perusahaan di buku penerima.</span>
        </fieldset>

        <KolomPerusahaan lingkup={lingkup} daftar={aktif} nama="pemberiId" label="Perusahaan pemberi" />
        {/* penerima tanpa bawaan (lingkup dikosongkan) supaya tidak otomatis sama dengan pemberi */}
        <KolomPerusahaan lingkup={{ perusahaanId: null, perusahaan: null, bolehGabungan: lingkup.bolehGabungan }} daftar={pf ? aktif.filter((p) => p.id !== pf) : aktif} nama="penerimaId" label="Perusahaan penerima" selaluPilih />

        <div className="bidang">
          <label className="label" htmlFor="tanggal">
            Tanggal *
          </label>
          <input id="tanggal" name="tanggal" type="date" defaultValue={hariIni} max={hariIni} required className="isian" />
        </div>
        <div className="bidang">
          <label className="label" htmlFor="jumlah">
            Jumlah *
          </label>
          <input id="jumlah" name="jumlah" type="number" step="0.01" min={0.01} required className="isian" />
        </div>
        <div className="bidang md:col-span-2">
          <label className="label" htmlFor="keterangan">
            Keterangan *
          </label>
          <input id="keterangan" name="keterangan" required minLength={3} maxLength={300} className="isian" placeholder="mis. talangan sewa sound event X" />
        </div>

        <PilihBerkelompok
          id="akunPemberiId"
          label="Akun lawan di buku pemberi"
          wajib
          kosong="Pilih akun…"
          kelompok={kelompokkan(akunPemberi, semuaPerusahaan)}
          petunjuk="Tagih: dikredit (mis. kas pemberi). Lunas: didebit (mis. kas pemberi). Harus akun bersama atau milik pemberi."
        />
        <PilihBerkelompok
          id="akunPenerimaId"
          label="Akun lawan di buku penerima"
          wajib
          kosong="Pilih akun…"
          kelompok={kelompokkan(akunLawan, semuaPerusahaan)}
          petunjuk="Tagih: didebit (mis. beban atau aset penerima). Lunas: dikredit (mis. kas penerima). Harus akun bersama atau milik penerima."
        />
        <PilihBerkelompok id="proyekPemberiId" label="Event pemberi" wajib={false} kosong="Tanpa event" kelompok={proyekBerkelompok} />
        <PilihBerkelompok id="proyekPenerimaId" label="Event penerima" wajib={false} kosong="Tanpa event" kelompok={proyekBerkelompok} />

        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama">
            Simpan Transaksi
          </button>
        </div>
      </FormulirAksi>
    </div>
  );
}
