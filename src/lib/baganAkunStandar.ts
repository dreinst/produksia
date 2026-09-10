import type { JenisAkun } from "@/prisma-klien/enums";

/*
 * Bagan Akun Standar untuk usaha Event Organizer / Wedding Organizer (EO/WO).
 * Hasil kurasi dari catatan tangan pemilik (10 September 2026) — lihat BAGAN-AKUN.md untuk
 * keputusan tiap butir yang semula "pending".
 *
 * Penomoran ala Accurate: X-YZWW
 *   X  = jenis (1 Aset, 2 Kewajiban, 3 Ekuitas, 4 Pendapatan, 5 Beban)
 *   Y  = kelompok (akun induk, tidak bisa dijurnal)
 *   Z  = akun rinci di bawah kelompok; WW dipakai untuk anak tingkat ketiga
 * Celah nomor sengaja disisakan agar akun baru bisa disisipkan tanpa menomori ulang.
 *
 * asal:  ASLI      = persis dari catatan tangan
 *        USUL      = tambahan/perbaikan sesuai standar akuntansi (SAK EMKM)
 *        KEPUTUSAN = butir yang semula pending, diputuskan saat kurasi
 */
export type AsalAkun = "ASLI" | "USUL" | "KEPUTUSAN";

export type AkunStandar = {
  kode: string;
  nama: string;
  jenis: JenisAkun;
  /** kode akun induk; urutan daftar menjamin induk selalu didefinisikan lebih dulu */
  induk?: string;
  /** akun kelompok: hanya wadah, tidak menerima jurnal */
  kelompok?: boolean;
  /** tampil sebagai pilihan akun Kas/Bank */
  kasBank?: boolean;
  asal: AsalAkun;
  keterangan?: string;
};

const A = "ASET", K = "KEWAJIBAN", M = "MODAL", P = "PENDAPATAN", B = "BEBAN";

export const BAGAN_AKUN_STANDAR: readonly AkunStandar[] = [
  // ---------- 1. ASET ----------
  { kode: "1-1000", nama: "Aset Lancar", jenis: A, kelompok: true, asal: "ASLI" },
  { kode: "1-1100", nama: "Kas", jenis: A, induk: "1-1000", kasBank: true, asal: "ASLI", keterangan: "Uang tunai di brankas / kas kecil" },
  { kode: "1-1200", nama: "Bank", jenis: A, induk: "1-1000", kelompok: true, asal: "KEPUTUSAN", keterangan: "Coretan di bawah 'Kas' dibaca sebagai 'Bank'; dibuat kelompok agar tiap rekening jadi anak sendiri" },
  { kode: "1-1210", nama: "Bank – Rekening Operasional", jenis: A, induk: "1-1200", kasBank: true, asal: "USUL", keterangan: "Ganti nama sesuai bank & nomor rekening; tambah 1-1220 dst. untuk rekening lain" },
  { kode: "1-1300", nama: "Piutang Usaha", jenis: A, induk: "1-1000", asal: "USUL", keterangan: "Tagihan ke klien yang belum dibayar (dipakai otomatis oleh Faktur Penjualan)" },
  { kode: "1-1400", nama: "Uang Muka ke Vendor / Supplier", jenis: A, induk: "1-1000", asal: "USUL" },
  { kode: "1-1500", nama: "Biaya Dibayar Dimuka", jenis: A, induk: "1-1000", asal: "USUL", keterangan: "Sewa/asuransi yang dibayar di depan, dibebankan bertahap" },
  { kode: "1-1600", nama: "Persediaan", jenis: A, induk: "1-1000", asal: "USUL", keterangan: "Barang produksi & merchandise yang dijual (dipakai otomatis oleh modul stok)" },
  { kode: "1-1650", nama: "Barang Terkirim Belum Ditagih", jenis: A, induk: "1-1000", asal: "USUL", keterangan: "Aset sementara antara Surat Jalan (SJ) dan Faktur Penjualan (FJ); dipakai otomatis oleh sistem" },
  { kode: "1-1700", nama: "Piutang Lain-lain", jenis: A, induk: "1-1000", asal: "USUL", keterangan: "Kasbon karyawan/crew, piutang non-usaha" },
  { kode: "1-1800", nama: "PPN Masukan", jenis: A, induk: "1-1000", asal: "USUL", keterangan: "PPN yang dibayar ke vendor (hanya bila PKP); dipakai otomatis oleh Faktur Pembelian" },
  { kode: "1-1900", nama: "Pajak Dibayar Dimuka (PPh 23)", jenis: A, induk: "1-1000", asal: "USUL", keterangan: "PPh 23 yang dipotong klien dari pembayaran; dipakai otomatis oleh Penerimaan" },

  { kode: "1-2000", nama: "Aset Tetap", jenis: A, kelompok: true, asal: "ASLI" },
  { kode: "1-2100", nama: "Tanah", jenis: A, induk: "1-2000", asal: "ASLI" },
  { kode: "1-2200", nama: "Bangunan", jenis: A, induk: "1-2000", asal: "ASLI" },
  { kode: "1-2300", nama: "Kendaraan", jenis: A, induk: "1-2000", asal: "USUL" },
  { kode: "1-2400", nama: "Peralatan Event", jenis: A, induk: "1-2000", asal: "USUL", keterangan: "Sound system, lighting, tenda, panggung, genset" },
  { kode: "1-2500", nama: "Inventaris Kantor", jenis: A, induk: "1-2000", asal: "USUL", keterangan: "Komputer, mebel, AC" },
  { kode: "1-2900", nama: "Akumulasi Penyusutan", jenis: A, induk: "1-2000", kelompok: true, asal: "USUL", keterangan: "Saldo normal kredit (pengurang aset tetap)" },
  { kode: "1-2920", nama: "Akumulasi Penyusutan Bangunan", jenis: A, induk: "1-2900", asal: "USUL" },
  { kode: "1-2930", nama: "Akumulasi Penyusutan Kendaraan", jenis: A, induk: "1-2900", asal: "USUL" },
  { kode: "1-2940", nama: "Akumulasi Penyusutan Peralatan Event", jenis: A, induk: "1-2900", asal: "USUL" },
  { kode: "1-2950", nama: "Akumulasi Penyusutan Inventaris Kantor", jenis: A, induk: "1-2900", asal: "USUL" },

  { kode: "1-3000", nama: "Investasi Jangka Panjang", jenis: A, kelompok: true, asal: "USUL", keterangan: "Obligasi & investasi dipindah dari Aset Tetap — bukan aset operasional" },
  { kode: "1-3100", nama: "Obligasi", jenis: A, induk: "1-3000", asal: "ASLI" },
  { kode: "1-3200", nama: "Investasi Lainnya", jenis: A, induk: "1-3000", asal: "ASLI", keterangan: "Saham, reksa dana, deposito > 1 tahun" },

  // ---------- 2. KEWAJIBAN ----------
  { kode: "2-1000", nama: "Kewajiban Lancar", jenis: K, kelompok: true, asal: "ASLI" },
  { kode: "2-1100", nama: "Hutang Usaha", jenis: K, induk: "2-1000", asal: "ASLI", keterangan: "Tagihan vendor yang belum dibayar (dipakai otomatis oleh Faktur Pembelian)" },
  { kode: "2-1200", nama: "Uang Muka Pelanggan / DP Klien", jenis: K, induk: "2-1000", asal: "USUL", keterangan: "DP yang diterima sebelum event lewat menu Uang Muka (Penjualan); dipakai mengurangi piutang saat Faktur Penjualan" },
  { kode: "2-1300", nama: "Hutang Pajak", jenis: K, induk: "2-1000", kelompok: true, asal: "USUL" },
  { kode: "2-1310", nama: "Hutang PPh 21", jenis: K, induk: "2-1300", asal: "USUL", keterangan: "Potongan pajak gaji/honor yang belum disetor" },
  { kode: "2-1320", nama: "Hutang PPh 23 / Final", jenis: K, induk: "2-1300", asal: "USUL", keterangan: "PPh 23 yang kita potong dari vendor; dipakai otomatis oleh Pembayaran Pembelian" },
  { kode: "2-1330", nama: "Hutang PPN (Keluaran)", jenis: K, induk: "2-1300", asal: "USUL", keterangan: "PPN yang dipungut dari klien (hanya bila PKP); dipakai otomatis oleh Faktur Penjualan" },
  { kode: "2-1400", nama: "Beban yang Masih Harus Dibayar", jenis: K, induk: "2-1000", asal: "USUL", keterangan: "Gaji/listrik/vendor yang sudah jadi beban tapi belum ditagih" },
  { kode: "2-1500", nama: "Hutang Lain-lain", jenis: K, induk: "2-1000", asal: "USUL" },
  { kode: "2-1600", nama: "Barang Diterima Belum Ditagih", jenis: K, induk: "2-1000", asal: "USUL", keterangan: "Kewajiban sementara antara Terima Barang (TB) dan Faktur Pembelian (FB); dipakai otomatis oleh sistem" },

  { kode: "2-2000", nama: "Kewajiban Jangka Panjang", jenis: K, kelompok: true, asal: "USUL" },
  { kode: "2-2100", nama: "Hutang Bank", jenis: K, induk: "2-2000", asal: "USUL" },
  { kode: "2-2200", nama: "Hutang Pihak Berelasi", jenis: K, induk: "2-2000", asal: "USUL", keterangan: "Pinjaman dari pemilik/keluarga/afiliasi" },
  { kode: "2-2300", nama: "Hutang Leasing / Pembiayaan Kendaraan", jenis: K, induk: "2-2000", asal: "USUL" },

  // ---------- 3. EKUITAS ----------
  { kode: "3-1000", nama: "Modal Disetor / Modal Pemilik", jenis: M, asal: "USUL" },
  { kode: "3-2000", nama: "Laba Ditahan", jenis: M, asal: "USUL", keterangan: "Akumulasi laba tahun-tahun sebelumnya" },
  { kode: "3-3000", nama: "Laba / Rugi Tahun Berjalan", jenis: M, asal: "USUL" },
  { kode: "3-4000", nama: "Prive", jenis: M, asal: "USUL", keterangan: "Pengambilan pribadi pemilik (saldo normal debit)" },

  // ---------- 4. PENDAPATAN ----------
  { kode: "4-1000", nama: "Pendapatan Event", jenis: P, kelompok: true, asal: "KEPUTUSAN", keterangan: "Matriks catatan: Reguler/Flagship × Event/Produksi/Sewa → tiap jenis layanan punya anak Reguler & Flagship" },
  { kode: "4-1100", nama: "Pendapatan Event Reguler", jenis: P, induk: "4-1000", asal: "KEPUTUSAN", keterangan: "Event pesanan klien (wedding, gathering, launching). Akun bawaan Faktur Penjualan" },
  { kode: "4-1200", nama: "Pendapatan Event Flagship", jenis: P, induk: "4-1000", asal: "KEPUTUSAN", keterangan: "Program unggulan milik sendiri (festival/konser tahunan), pendapatan tiket & sponsor" },
  { kode: "4-2000", nama: "Pendapatan Produksi", jenis: P, kelompok: true, asal: "KEPUTUSAN", keterangan: "Dekorasi, dokumentasi, konten, cetak & merchandise" },
  { kode: "4-2100", nama: "Pendapatan Produksi Reguler", jenis: P, induk: "4-2000", asal: "KEPUTUSAN" },
  { kode: "4-2200", nama: "Pendapatan Produksi Flagship", jenis: P, induk: "4-2000", asal: "KEPUTUSAN" },
  { kode: "4-3000", nama: "Pendapatan Sewa", jenis: P, kelompok: true, asal: "KEPUTUSAN", keterangan: "Sewa peralatan event & venue" },
  { kode: "4-3100", nama: "Pendapatan Sewa Reguler", jenis: P, induk: "4-3000", asal: "KEPUTUSAN" },
  { kode: "4-3200", nama: "Pendapatan Sewa Flagship", jenis: P, induk: "4-3000", asal: "KEPUTUSAN" },
  { kode: "4-8000", nama: "Potongan Penjualan", jenis: P, kelompok: true, asal: "KEPUTUSAN", keterangan: "Kontra-pendapatan (saldo normal debit) — sesuai standar, diskon mengurangi pendapatan, bukan beban pemasaran" },
  { kode: "4-8100", nama: "Diskon Penjualan", jenis: P, induk: "4-8000", asal: "KEPUTUSAN", keterangan: "Dipindah dari Beban Pemasaran (catatan asli)" },
  { kode: "4-9000", nama: "Pendapatan Lain-lain", jenis: P, kelompok: true, asal: "USUL" },
  { kode: "4-9100", nama: "Pendapatan Bunga Bank", jenis: P, induk: "4-9000", asal: "USUL" },
  { kode: "4-9200", nama: "Pendapatan Lainnya", jenis: P, induk: "4-9000", asal: "USUL", keterangan: "Selisih kurs, penjualan aset, dll." },

  // ---------- 5. BEBAN ----------
  { kode: "5-1000", nama: "Beban Pokok Pendapatan", jenis: B, kelompok: true, asal: "USUL", keterangan: "Biaya yang melekat langsung pada pendapatan; menghasilkan laba kotor" },
  { kode: "5-1100", nama: "Harga Pokok Penjualan", jenis: B, induk: "5-1000", asal: "USUL", keterangan: "Nilai persediaan barang yang terjual (dipakai otomatis oleh modul stok)" },
  { kode: "5-1200", nama: "Biaya Langsung Event", jenis: B, induk: "5-1000", asal: "USUL", keterangan: "Vendor, crew lepas, sewa venue per event" },
  { kode: "5-1300", nama: "Biaya Langsung Produksi", jenis: B, induk: "5-1000", asal: "USUL", keterangan: "Bahan dekor, cetak, jasa dokumentasi per pesanan" },
  { kode: "5-1400", nama: "Selisih Persediaan", jenis: B, induk: "5-1000", asal: "USUL", keterangan: "Selisih opname/koreksi stok dan beda harga retur pembelian; dipakai otomatis oleh sistem" },

  { kode: "5-2000", nama: "Beban Gaji & Honor", jenis: B, kelompok: true, asal: "ASLI" },
  { kode: "5-2100", nama: "Gaji Pokok", jenis: B, induk: "5-2000", asal: "ASLI" },
  { kode: "5-2200", nama: "Upah Harian", jenis: B, induk: "5-2000", asal: "ASLI" },
  { kode: "5-2300", nama: "Honor Volunteer", jenis: B, induk: "5-2000", asal: "ASLI" },
  { kode: "5-2400", nama: "THR & Bonus", jenis: B, induk: "5-2000", asal: "USUL" },
  { kode: "5-2500", nama: "BPJS & Tunjangan", jenis: B, induk: "5-2000", asal: "USUL" },

  { kode: "5-3000", nama: "Beban Operasional", jenis: B, kelompok: true, asal: "ASLI" },
  { kode: "5-3100", nama: "Transport", jenis: B, induk: "5-3000", asal: "ASLI" },
  { kode: "5-3200", nama: "BBM", jenis: B, induk: "5-3000", asal: "ASLI" },
  { kode: "5-3300", nama: "E-Toll & Parkir", jenis: B, induk: "5-3000", asal: "ASLI" },
  { kode: "5-3400", nama: "Akomodasi", jenis: B, induk: "5-3000", asal: "ASLI" },
  { kode: "5-3500", nama: "Perjalanan Dinas", jenis: B, induk: "5-3000", asal: "ASLI" },
  { kode: "5-3600", nama: "Administrasi Perizinan (Permit)", jenis: B, induk: "5-3000", asal: "KEPUTUSAN", keterangan: "'Adm. Permit Udf.' dibaca sebagai biaya pengurusan izin keramaian/venue/kepolisian" },
  { kode: "5-3700", nama: "Konsumsi", jenis: B, induk: "5-3000", asal: "ASLI" },
  { kode: "5-3900", nama: "Operasional Lainnya", jenis: B, induk: "5-3000", asal: "ASLI" },

  { kode: "5-4000", nama: "Beban Utilitas & Kantor", jenis: B, kelompok: true, asal: "KEPUTUSAN", keterangan: "Nama baru untuk 'Beban Harian' agar isinya (PLN, air, internet, sewa kantor) tergambar" },
  { kode: "5-4100", nama: "Listrik (PLN)", jenis: B, induk: "5-4000", asal: "ASLI" },
  { kode: "5-4200", nama: "Air", jenis: B, induk: "5-4000", asal: "ASLI" },
  { kode: "5-4300", nama: "Internet / Wifi", jenis: B, induk: "5-4000", asal: "ASLI" },
  { kode: "5-4400", nama: "Paket Data", jenis: B, induk: "5-4000", asal: "ASLI" },
  { kode: "5-4500", nama: "Sewa Tempat / Kantor", jenis: B, induk: "5-4000", asal: "USUL" },
  { kode: "5-4600", nama: "Kebersihan & Sampah", jenis: B, induk: "5-4000", asal: "USUL" },
  { kode: "5-4700", nama: "ATK & Perlengkapan Kantor", jenis: B, induk: "5-4000", asal: "USUL" },

  { kode: "5-5000", nama: "Beban Entertainment", jenis: B, kelompok: true, asal: "ASLI" },
  { kode: "5-5100", nama: "Jamuan Klien & Relasi", jenis: B, induk: "5-5000", asal: "USUL", keterangan: "Catatan asli belum punya sub-item" },

  { kode: "5-6000", nama: "Beban Pemeliharaan", jenis: B, kelompok: true, asal: "ASLI" },
  { kode: "5-6100", nama: "Service Sound System", jenis: B, induk: "5-6000", asal: "ASLI" },
  { kode: "5-6200", nama: "Service Peralatan Event", jenis: B, induk: "5-6000", asal: "ASLI", keterangan: "'Service Persediaan Aset' pada catatan asli" },
  { kode: "5-6300", nama: "Renovasi", jenis: B, induk: "5-6000", asal: "ASLI" },
  { kode: "5-6400", nama: "Service Kendaraan", jenis: B, induk: "5-6000", asal: "ASLI" },
  { kode: "5-6900", nama: "Pemeliharaan Lainnya", jenis: B, induk: "5-6000", asal: "ASLI" },

  { kode: "5-7000", nama: "Beban Pemasaran", jenis: B, kelompok: true, asal: "ASLI" },
  { kode: "5-7100", nama: "Klaim & Gagal Produksi", jenis: B, induk: "5-7000", asal: "KEPUTUSAN", keterangan: "Ganti rugi/pengerjaan ulang karena komplain klien atau produksi gagal" },
  { kode: "5-7200", nama: "Cashback Pelanggan", jenis: B, induk: "5-7000", asal: "ASLI" },
  { kode: "5-7400", nama: "Iklan & Promosi", jenis: B, induk: "5-7000", asal: "USUL", keterangan: "Iklan media sosial, cetak brosur, endorsement" },

  { kode: "5-8000", nama: "Beban Sosial & Sponsorship", jenis: B, kelompok: true, asal: "KEPUTUSAN", keterangan: "'Beban Lain-lain (1)' — tetap dipisah dari (2), diberi nama sesuai isinya" },
  { kode: "5-8100", nama: "Sumbangan", jenis: B, induk: "5-8000", asal: "ASLI" },
  { kode: "5-8200", nama: "Keperluan Rumah Tangga Kantor", jenis: B, induk: "5-8000", asal: "ASLI" },
  { kode: "5-8300", nama: "Sponsorship (Diberikan)", jenis: B, induk: "5-8000", asal: "ASLI" },

  { kode: "5-8500", nama: "Beban Administrasi Bank", jenis: B, kelompok: true, asal: "KEPUTUSAN", keterangan: "'Beban Lain-lain (2)' — dipisah karena sifatnya biaya keuangan, bukan sosial" },
  { kode: "5-8510", nama: "Administrasi Bank – Rekening Operasional", jenis: B, induk: "5-8500", asal: "ASLI", keterangan: "Satu akun per rekening, sejajar dengan 1-12x0" },
  { kode: "5-8520", nama: "Pajak Bunga Bank", jenis: B, induk: "5-8500", asal: "ASLI" },

  { kode: "5-9000", nama: "Beban Pajak", jenis: B, kelompok: true, asal: "ASLI" },
  { kode: "5-9100", nama: "PPh Final UMKM (0,5%)", jenis: B, induk: "5-9000", asal: "USUL", keterangan: "Catatan asli belum punya sub-item" },
  { kode: "5-9200", nama: "PBB & Pajak Kendaraan", jenis: B, induk: "5-9000", asal: "USUL" },
  { kode: "5-9300", nama: "Denda & Bunga Pajak", jenis: B, induk: "5-9000", asal: "USUL" },

  { kode: "5-9500", nama: "Beban Penyusutan", jenis: B, kelompok: true, asal: "USUL", keterangan: "Dibutuhkan modul Aset Tetap; satu akun per kelas aset, sejajar dengan 1-29x0" },
  { kode: "5-9520", nama: "Penyusutan Bangunan", jenis: B, induk: "5-9500", asal: "USUL" },
  { kode: "5-9530", nama: "Penyusutan Kendaraan", jenis: B, induk: "5-9500", asal: "USUL" },
  { kode: "5-9540", nama: "Penyusutan Peralatan Event", jenis: B, induk: "5-9500", asal: "USUL" },
  { kode: "5-9550", nama: "Penyusutan Inventaris Kantor", jenis: B, induk: "5-9500", asal: "USUL" },
];

/** Kode akun yang dipakai pemetaan otomatis Penjualan/Pembelian bila pemetaan belum diatur. */
export const PEMETAAN_STANDAR = {
  piutangUsaha: "1-1300",
  persediaan: "1-1600",
  hpp: "5-1100",
  pendapatanPenjualan: "4-1100",
  utangUsaha: "2-1100",
  bebanJasa: "5-1200",
  barangBelumDitagih: "2-1600",
  selisihPersediaan: "5-1400",
  barangTerkirim: "1-1650",
  uangMukaPelanggan: "2-1200",
  labaDitahan: "3-2000",
} as const;

/** Butir yang semula "pending" di catatan, beserta keputusan kurasinya (ditampilkan di halaman Bagan Akun). */
export const KEPUTUSAN_KURASI: readonly { butir: string; keputusan: string }[] = [
  { butir: "Struktur Pendapatan (Reguler/Flagship × Event/Produksi/Sewa)", keputusan: "Dibaca sebagai matriks: tiga kelompok layanan (Event 4-1000, Produksi 4-2000, Sewa 4-3000), masing-masing punya anak Reguler dan Flagship. Reguler = pesanan klien; Flagship = program unggulan milik sendiri. Faktur Penjualan memakai 4-1100 sebagai bawaan." },
  { butir: "Arti \"Adm. Permit Udf.\"", keputusan: "Administrasi Perizinan (5-3600): biaya pengurusan izin keramaian, izin venue, kepolisian, dan surat-surat event." },
  { butir: "Arti \"TOP\"", keputusan: "Term of Payment — di sistem ini terwujud sebagai tanggal jatuh tempo Faktur Penjualan (bawaan 14 hari) dan status Sebagian/Lunas dari Penerimaan." },
  { butir: "Coretan di bawah \"Kas\"", keputusan: "Dibaca 'Bank' (1-1200), dibuat sebagai kelompok dengan satu rekening contoh (1-1210) supaya tiap rekening bank bisa punya akun sendiri." },
  { butir: "Redaksi \"Claim/Gagal Produksi\"", keputusan: "Klaim & Gagal Produksi (5-7100): ganti rugi atau pengerjaan ulang akibat komplain klien / produksi gagal. Tetap di Beban Pemasaran sesuai catatan." },
  { butir: "Diskon & Cashback", keputusan: "Diskon Penjualan dipindah ke 4-8100 (kontra-pendapatan, mengurangi pendapatan bersih) sesuai standar; Cashback tetap di Beban Pemasaran karena sifatnya promosi." },
  { butir: "Beban Lain-lain (1) & (2)", keputusan: "Tetap dipisah, diberi nama tegas: Beban Sosial & Sponsorship (5-8000) dan Beban Administrasi Bank (5-8500)." },
  { butir: "Penomoran kode akun", keputusan: "Format Accurate X-YZWW: digit pertama jenis, ratusan kelompok, puluhan akun rinci; celah nomor disisakan untuk penambahan." },
  { butir: "Obligasi & Investasi", keputusan: "Dipindah ke kelompok baru Investasi Jangka Panjang (1-3000) sesuai usulan draft." },
];

export function kedalamanAkun(kode: string, peta: Map<string, AkunStandar>): number {
  let d = 0;
  let a = peta.get(kode);
  while (a?.induk) {
    d++;
    a = peta.get(a.induk);
  }
  return d;
}
