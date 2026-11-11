import type { NextConfig } from "next";

// Header keamanan untuk semua respons.
// HSTS: paksa HTTPS 1 tahun. nosniff: cegah MIME sniffing. frame DENY & frame-ancestors none: cegah clickjacking.
// Referrer & Permissions-Policy: batasi kebocoran & akses perangkat. Tanpa script-src CSP ketat agar Next tidak rusak.
const headerKeamanan = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `next build` juga menghasilkan .next/standalone (server.js + dependensi minimum) untuk Docker/VPS
  output: "standalone",
  // pdfkit membaca berkas data AFM/ICC relatif terhadap dirinya; harus dimuat dengan require Node, bukan dibundel.
  serverExternalPackages: ["pdfkit"],
  // Font Carlito dan PNG kop bawaan dibaca dari src/aset-cetak saat runtime (rute cetak D3/D5 dan aksi simpan PDF di
  // halaman penjualan/proyek). Prefiks halaman baru yang merender PDF WAJIB ditambahkan di sini; tanpa itu aset tidak
  // ikut .next/standalone dan PDF gagal hanya di produksi.
  outputFileTracingIncludes: {
    "/cetak/**": ["./src/aset-cetak/**/*"],
    "/api/cetak/**": ["./src/aset-cetak/**/*"],
    "/penjualan/**": ["./src/aset-cetak/**/*"],
    "/proyek/**": ["./src/aset-cetak/**/*"],
  },
  // Formulir Peminjaman Barang mengirim sampai 3 foto HP yang sudah dikompresi di klien (maks 1 MB per foto);
  // bawaan 1 MB terlalu kecil.
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  async headers() {
    return [{ source: "/:path*", headers: headerKeamanan }];
  },
};

export default nextConfig;
