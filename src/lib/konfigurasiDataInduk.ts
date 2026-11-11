export type KonfigurasiBidang = {
  nama: string;
  label: string;
  jenis: "text" | "number" | "select" | "boolean" | "date";
  wajib?: boolean;
  nilaiBawaan?: string;
  opsi?: { model: string; bidangNilai: string; bidangLabel: string; where?: Record<string, unknown> };
  opsiStatis?: string[];
  /** Bukan kolom Prisma sungguhan pada model entitas ini; ditangani terpisah oleh aksi server (mis. jumlah awal stok Barang). */
  virtual?: boolean;
  /** Hanya tampil saat menambah data baru, disembunyikan saat mengubah data yang sudah ada. */
  hanyaTambah?: boolean;
  /** Label opsi bernilai NILAI_BERSAMA ("Bersama"); aksi server memetakannya ke null (D1 §3.5). Tanpa opsi "-". */
  pilihanBersama?: string;
  /** Saat menambah data baru, isian awalnya lingkup perusahaan aktif (diisi halaman). */
  bawaanLingkup?: boolean;
  /** Teks petunjuk kecil di bawah isian. */
  petunjuk?: string;
};

/**
 * Bidang pemilik perusahaan data induk (D1 §3.5). Isian yang tidak terkirim sama sekali dilewati (buat: bawaan basis
 * data, ubah: tidak diubah), supaya pemanggil lama tanpa isian ini tetap berjalan seperti sebelumnya.
 */
export const BIDANG_PERUSAHAAN = "perusahaanId";
const opsiPerusahaan = { model: "perusahaan", bidangNilai: "id", bidangLabel: "nama", where: { aktif: true } };
const kolomPerusahaan = { key: "perusahaan.kode", label: "Perusahaan" };

export type KonfigurasiEntitas = {
  slug: string;
  label: string;
  model: string; // Prisma client delegasi nama
  bagian: "persediaan" | "daftar";
  /**
   * Saringan daftar menurut lingkup perusahaan aktif: "perusahaan" = milik perusahaan itu saja (karyawan, proyek),
   * "milikAtauBersama" = milik perusahaan itu atau bersama (akun, gudang, barang). Gabungan tidak disaring.
   */
  saringLingkup?: "perusahaan" | "milikAtauBersama";
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
    label: "Karyawan / Penjual",
    model: "karyawan",
    bagian: "daftar",
    saringLingkup: "perusahaan",
    bidang: [
      { nama: "kode", label: "Kode", jenis: "text", wajib: true },
      { nama: "nama", label: "Nama", jenis: "text", wajib: true },
      { nama: BIDANG_PERUSAHAAN, label: "Perusahaan pemberi kerja", jenis: "select", wajib: true, opsi: opsiPerusahaan, bawaanLingkup: true },
      { nama: "jabatan", label: "Jabatan", jenis: "text" },
      {
        nama: "departemenId",
        label: "Departemen",
        jenis: "select",
        opsi: { model: "departemen", bidangNilai: "id", bidangLabel: "nama" },
      },
      { nama: "tanggalBergabung", label: "Tanggal bergabung", jenis: "date" },
      { nama: "status", label: "Status", jenis: "select", opsiStatis: ["AKTIF", "NONAKTIF"], nilaiBawaan: "AKTIF" },
      { nama: "gajiPokok", label: "Gaji pokok/bulan", jenis: "number" },
      { nama: "tunjangan", label: "Tunjangan/bulan", jenis: "number" },
      {
        nama: "akunBebanId",
        label: "Akun beban khusus",
        jenis: "select",
        opsi: { model: "akun", bidangNilai: "id", bidangLabel: "nama", where: { jenis: "BEBAN", kelompok: false } },
      },
    ],
    kolom: [
      { key: "kode", label: "Kode" },
      { key: "nama", label: "Nama" },
      kolomPerusahaan,
      { key: "jabatan", label: "Jabatan" },
      { key: "departemen.nama", label: "Departemen" },
      { key: "status", label: "Status" },
      { key: "gajiPokok", label: "Gaji pokok" },
      { key: "tunjangan", label: "Tunjangan" },
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
      {
        nama: "mataUangId",
        label: "Mata uang bawaan",
        jenis: "select",
        opsi: { model: "mataUang", bidangNilai: "id", bidangLabel: "kode", where: { aktif: true } },
      },
    ],
    kolom: [
      { key: "kode", label: "Kode" },
      { key: "nama", label: "Nama" },
      { key: "telepon", label: "Telepon" },
      { key: "penjual.nama", label: "Sales" },
      { key: "mataUang.kode", label: "Mata uang" },
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
      {
        nama: "mataUangId",
        label: "Mata uang bawaan",
        jenis: "select",
        opsi: { model: "mataUang", bidangNilai: "id", bidangLabel: "kode", where: { aktif: true } },
      },
    ],
    kolom: [
      { key: "kode", label: "Kode" },
      { key: "nama", label: "Nama" },
      { key: "telepon", label: "Telepon" },
      { key: "mataUang.kode", label: "Mata uang" },
    ],
  },
  {
    slug: "proyek",
    label: "Proyek",
    model: "proyek",
    bagian: "daftar",
    saringLingkup: "perusahaan",
    bidang: [
      { nama: "kode", label: "Kode", jenis: "text", wajib: true },
      { nama: "nama", label: "Nama", jenis: "text", wajib: true },
      { nama: BIDANG_PERUSAHAAN, label: "Perusahaan pemilik event", jenis: "select", wajib: true, opsi: opsiPerusahaan, bawaanLingkup: true },
      {
        nama: "pelangganId",
        label: "Pelanggan",
        jenis: "select",
        opsi: { model: "pelanggan", bidangNilai: "id", bidangLabel: "nama" },
      },
      { nama: "namaKlien", label: "Nama klien (bila belum ada di data Pelanggan)", jenis: "text" },
      // nilai sah divalidasi server lewat validasiProyek (D5 §3.1, bug B-22 untuk Proyek.status)
      { nama: "status", label: "Status", jenis: "select", opsiStatis: ["BERJALAN", "DITUNDA", "SELESAI", "DIARSIP", "BATAL"], nilaiBawaan: "BERJALAN" },
      { nama: "nilaiKontrak", label: "Nilai kontrak / proposal disetujui", jenis: "number" },
      { nama: "anggaranBiaya", label: "Anggaran biaya event", jenis: "number" },
      { nama: "tanggalMulai", label: "Tanggal mulai", jenis: "date" },
      { nama: "tanggalSelesai", label: "Tanggal selesai", jenis: "date" },
      { nama: "keterangan", label: "Keterangan", jenis: "text" },
    ],
    kolom: [
      { key: "kode", label: "Kode" },
      { key: "nama", label: "Nama" },
      kolomPerusahaan,
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
    saringLingkup: "milikAtauBersama",
    bidang: [
      { nama: "kode", label: "Kode", jenis: "text", wajib: true },
      { nama: "nama", label: "Nama", jenis: "text", wajib: true },
      { nama: "alamat", label: "Alamat", jenis: "text" },
      { nama: BIDANG_PERUSAHAAN, label: "Milik perusahaan", jenis: "select", opsi: opsiPerusahaan, petunjuk: "Kosongkan untuk gudang bersama yang boleh dipakai semua perusahaan." },
    ],
    kolom: [
      { key: "kode", label: "Kode" },
      { key: "nama", label: "Nama" },
      kolomPerusahaan,
    ],
  },
  {
    slug: "kelompok-barang",
    label: "Kategori Barang",
    model: "kelompokBarang",
    bagian: "persediaan",
    bidang: [
      { nama: "nama", label: "Nama", jenis: "text", wajib: true },
      {
        nama: "indukId",
        label: "Kategori Induk",
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
    saringLingkup: "milikAtauBersama",
    bidang: [
      { nama: "kode", label: "Nama Barang", jenis: "text", wajib: true },
      { nama: "nama", label: "Keterangan", jenis: "text", wajib: true },
      { nama: "deskripsi", label: "Deskripsi katalog (isian awal baris penjualan)", jenis: "text" },
      { nama: "jenis", label: "Tipe", jenis: "select", opsiStatis: ["BARANG", "JASA"], nilaiBawaan: "BARANG" },
      {
        nama: BIDANG_PERUSAHAAN,
        label: "Milik perusahaan",
        jenis: "select",
        opsi: opsiPerusahaan,
        nilaiBawaan: "utama",
        bawaanLingkup: true,
        pilihanBersama: "Bersama (khusus Jasa)",
        petunjuk: "Barang stok selalu milik satu perusahaan. Jasa boleh dipakai bersama semua perusahaan.",
      },
      {
        nama: "kelompokId",
        label: "Kategori",
        jenis: "select",
        opsi: { model: "kelompokBarang", bidangNilai: "id", bidangLabel: "nama" },
      },
      { nama: "satuan", label: "Satuan", jenis: "text", nilaiBawaan: "pcs" },
      { nama: "warna", label: "Warna", jenis: "text" },
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
      // Bukan kolom Barang sungguhan: ditangani khusus di buatDataInduk() (src/lib/aksi/dataInduk.ts),
      // yang membuat Penyesuaian Stok berjurnal di baliknya, supaya barang baru bisa langsung punya
      // stok tanpa membuka formulir Penyesuaian Stok terpisah, TANPA memutus jejak audit (tetap
      // berjurnal, tetap ikut alur persetujuan bila alur itu menyala).
      { nama: "jumlahAwal", label: "Jumlah Awal (opsional, stok masuk pertama)", jenis: "number", virtual: true, hanyaTambah: true },
      {
        nama: "gudangAwalId",
        label: "Gudang untuk Jumlah Awal",
        jenis: "select",
        opsi: { model: "gudang", bidangNilai: "id", bidangLabel: "nama" },
        virtual: true,
        hanyaTambah: true,
      },
      {
        nama: "akunLawanAwalId",
        label: "Akun Lawan Jumlah Awal (mis. Modal)",
        jenis: "select",
        opsi: { model: "akun", bidangNilai: "id", bidangLabel: "nama", where: { kelompok: false } },
        virtual: true,
        hanyaTambah: true,
      },
    ],
    kolom: [
      { key: "kode", label: "Nama Barang" },
      { key: "nama", label: "Keterangan" },
      { key: "jenis", label: "Tipe" },
      kolomPerusahaan,
      { key: "satuan", label: "Satuan" },
      { key: "warna", label: "Warna" },
      { key: "hargaJual", label: "Harga Jual" },
    ],
  },
  {
    slug: "akun",
    label: "Daftar Akun",
    model: "akun",
    bagian: "daftar",
    saringLingkup: "milikAtauBersama",
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
      {
        nama: BIDANG_PERUSAHAAN,
        label: "Milik perusahaan",
        jenis: "select",
        opsi: opsiPerusahaan,
        petunjuk: "Kosong = akun bersama. Rekening yang dipakai satu perusahaan sebaiknya diberi pemilik supaya pilihan kas dan rekonsiliasi tersaring.",
      },
      { nama: "keterangan", label: "Keterangan", jenis: "text" },
    ],
    kolom: [
      { key: "kode", label: "Kode" },
      { key: "nama", label: "Nama" },
      { key: "jenis", label: "Tipe" },
      kolomPerusahaan,
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
