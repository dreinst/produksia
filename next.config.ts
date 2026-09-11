import type { NextConfig } from "next";

// Header keamanan untuk semua respons. Berlaku di Vercel maupun di balik Traefik/Caddy.
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
  // `next build` juga menghasilkan .next/standalone (server.js + dependensi minimum) untuk Docker/VPS;
  // di Vercel tidak diperlukan (Vercel memakai keluaran bawaannya sendiri)
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  async headers() {
    return [{ source: "/:path*", headers: headerKeamanan }];
  },
};

export default nextConfig;
