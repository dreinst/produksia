export type KonfigurasiBidang = {
  nama: string;
  label: string;
  jenis: "text" | "number" | "select" | "boolean" | "date";
  wajib?: boolean;
  nilaiBawaan?: string;
  opsi?: { model: string; bidangNilai: string; bidangLabel: string; where?: Record<string, unknown> };
  opsiStatis?: string[];
};

export type KonfigurasiEntitas = {
  slug: string;
  label: string;
  model: string; // Prisma client delegasi nama
  bagian: "persediaan" | "daftar";
  bidang: KonfigurasiBidang[];
  kolom: { key: string; label: string }[];
};

export const entitasDataInduk: KonfigurasiEntitas[] = [
  {
    slug: "departemen",
    label: "Departemen",
    model: "departemen",
    bagian: "daftar",
    bidang: [{ nama: "nama", label: "Nama", jenis: "text", wajib: true }],
    kolom: [{ key: "nama", label: "Nama" }],
  },
  {
    slug: "karyawan",
    label: "Penjual / Karyawan",
    model: "karyawan",
    bagian: "daftar",
    bidang: [
      { nama: "kode", label: "Kode", jenis: "text", wajib: true },
      { nama: "nama", label: "Nama", jenis: "text", wajib: true },
      {
        nama: "departemenId",
        label: "Departemen",
        jenis: "select",
        opsi: { model: "departemen", bidangNilai: "id", bidangLabel: "nama" },
      },
    ],
    kolom: [
      { key: "kode", label: "Kode" },
      { key: "nama", label: "Nama" },
      { key: "departemen.nama", label: "Departemen" },
    ],
  },
  {
    slug: "pelanggan",
    label: "Pelanggan",
    model: "pelanggan",
    bagian: "daftar",
    bidang: [
      { nama: "kode", label: "Kode", jenis: "text", wajib: true },
      { nama: "nama", label: "Nama", jenis: "text", wajib: true },
      { nama: "alamat", label: "Alamat", jenis: "text" },
      { nama: "telepon", label: "Telepon", jenis: "text" },
      { nama: "npwp", label: "NPWP", jenis: "text" },
      {
        nama: "penjualId",
        label: "Sales",
        jenis: "select",
        opsi: { model: "karyawan", bidangNilai: "id", bidangLabel: "nama" },
      },
    ],
    kolom: [
      { key: "kode", label: "Kode" },
      { key: "nama", label: "Nama" },
      { key: "telepon", label: "Telepon" },
      { key: "penjual.nama", label: "Sales" },
    ],
  },
  {
    slug: "pemasok",
    label: "Pemasok",
    model: "pemasok",
    bagian: "daftar",
    bidang: [
      { nama: "kode", label: "Kode", jenis: "text", wajib: true },
      { nama: "nama", label: "Nama", jenis: "text", wajib: true },
      { nama: "alamat", label: "Alamat", jenis: "text" },
      { nama: "telepon", label: "Telepon", jenis: "text" },
    ],
    kolom: [
      { key: "kode", label: "Kode" },
      { key: "nama", label: "Nama" },
      { key: "telepon", label: "Telepon" },
    ],
  },
  {
    slug: "proyek",
    label: "Proyek",
    model: "proyek",
    bagian: "daftar",
    bidang: [
      { nama: "kode", label: "Kode", jenis: "text", wajib: true },
      { nama: "nama", label: "Nama", jenis: "text", wajib: true },
      {
        nama: "pelangganId",
        label: "Pelanggan",
        jenis: "select",
        opsi: { model: "pelanggan", bidangNilai: "id", bidangLabel: "nama" },
      },
      { nama: "status", label: "Status", jenis: "select", opsiStatis: ["BERJALAN", "SELESAI", "BATAL"], nilaiBawaan: "BERJALAN" },
      { nama: "nilaiKontrak", label: "Nilai kontrak / proposal disetujui", jenis: "number" },
      { nama: "anggaranBiaya", label: "Anggaran biaya event", jenis: "number" },
      { nama: "tanggalMulai", label: "Tanggal mulai", jenis: "date" },
      { nama: "tanggalSelesai", label: "Tanggal selesai", jenis: "date" },
      { nama: "keterangan", label: "Keterangan", jenis: "text" },
    ],
    kolom: [
      { key: "kode", label: "Kode" },
      { key: "nama", label: "Nama" },
      { key: "pelanggan.nama", label: "Pelanggan" },
      { key: "status", label: "Status" },
      { key: "nilaiKontrak", label: "Nilai kontrak" },
      { key: "anggaranBiaya", label: "Anggaran biaya" },
    ],
  },
  {
    slug: "gudang",
    label: "Gudang",
    model: "gudang",
    bagian: "persediaan",
    bidang: [
      { nama: "kode", label: "Kode", jenis: "text", wajib: true },
      { nama: "nama", label: "Nama", jenis: "text", wajib: true },
      { nama: "alamat", label: "Alamat", jenis: "text" },
    ],
    kolom: [
      { key: "kode", label: "Kode" },
      { key: "nama", label: "Nama" },
    ],
  },
  {
    slug: "kelompok-barang",
    label: "Kelompok Barang",
    model: "kelompokBarang",
    bagian: "persediaan",
    bidang: [
      { nama: "nama", label: "Nama", jenis: "text", wajib: true },
      {
        nama: "indukId",
        label: "Kelompok Induk",
        jenis: "select",
        opsi: { model: "kelompokBarang", bidangNilai: "id", bidangLabel: "nama" },
      },
    ],
    kolom: [
      { key: "nama", label: "Nama" },
      { key: "induk.nama", label: "Induk" },
    ],
  },
  {
    slug: "barang",
    label: "Barang & Jasa",
    model: "barang",
    bagian: "persediaan",
    bidang: [
      { nama: "kode", label: "Kode", jenis: "text", wajib: true },
      { nama: "nama", label: "Nama", jenis: "text", wajib: true },
      { nama: "jenis", label: "Tipe", jenis: "select", opsiStatis: ["BARANG", "JASA"], nilaiBawaan: "BARANG" },
      {
        nama: "kelompokId",
        label: "Kelompok",
        jenis: "select",
        opsi: { model: "kelompokBarang", bidangNilai: "id", bidangLabel: "nama" },
      },
      { nama: "satuan", label: "Satuan", jenis: "text", nilaiBawaan: "pcs" },
      { nama: "hargaBeli", label: "Harga Beli", jenis: "number", nilaiBawaan: "0" },
      { nama: "hargaJual", label: "Harga Jual", jenis: "number", nilaiBawaan: "0" },
      { nama: "hargaMinimum", label: "Harga Minimum (batas nego, 0 = tanpa batas)", jenis: "number", nilaiBawaan: "0" },
      { nama: "stokMinimum", label: "Stok Minimum", jenis: "number", nilaiBawaan: "0" },
      {
        nama: "akunPendapatanId",
        label: "Akun pendapatan khusus (kosong = pemetaan)",
        jenis: "select",
        opsi: { model: "akun", bidangNilai: "id", bidangLabel: "nama", where: { jenis: "PENDAPATAN", kelompok: false } },
      },
      {
        nama: "akunPersediaanId",
        label: "Akun persediaan khusus (BARANG)",
        jenis: "select",
        opsi: { model: "akun", bidangNilai: "id", bidangLabel: "nama", where: { jenis: "ASET", kelompok: false } },
      },
      {
        nama: "akunHppId",
        label: "Akun HPP khusus (BARANG)",
        jenis: "select",
        opsi: { model: "akun", bidangNilai: "id", bidangLabel: "nama", where: { jenis: "BEBAN", kelompok: false } },
      },
      {
        nama: "akunBebanId",
        label: "Akun beban saat dibeli (JASA)",
        jenis: "select",
        opsi: { model: "akun", bidangNilai: "id", bidangLabel: "nama", where: { jenis: "BEBAN", kelompok: false } },
      },
    ],
    kolom: [
      { key: "kode", label: "Kode" },
      { key: "nama", label: "Nama" },
      { key: "jenis", label: "Tipe" },
      { key: "satuan", label: "Satuan" },
      { key: "hargaJual", label: "Harga Jual" },
    ],
  },
  {
    slug: "akun",
    label: "Daftar Akun",
    model: "akun",
    bagian: "daftar",
    bidang: [
      { nama: "kode", label: "Kode Akun", jenis: "text", wajib: true },
      { nama: "nama", label: "Nama Akun", jenis: "text", wajib: true },
      {
        nama: "jenis",
        label: "Tipe",
        jenis: "select",
        opsiStatis: ["ASET", "KEWAJIBAN", "MODAL", "PENDAPATAN", "BEBAN"],
        wajib: true,
      },
      {
        nama: "indukId",
        label: "Induk Akun",
        jenis: "select",
        opsi: { model: "akun", bidangNilai: "id", bidangLabel: "nama" },
      },
      { nama: "kelompok", label: "Akun kelompok (induk; tidak bisa dijurnal)", jenis: "boolean" },
      { nama: "kasBank", label: "Akun Kas/Bank", jenis: "boolean" },
      { nama: "keterangan", label: "Keterangan", jenis: "text" },
    ],
    kolom: [
      { key: "kode", label: "Kode" },
      { key: "nama", label: "Nama" },
      { key: "jenis", label: "Tipe" },
      { key: "induk.nama", label: "Induk" },
      { key: "kelompok", label: "Kelompok" },
      { key: "kasBank", label: "Kas/Bank" },
    ],
  },
];

export function ambilKonfigurasiEntitas(slug: string) {
  return entitasDataInduk.find((e) => e.slug === slug);
}

export function ambilNilai(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}
