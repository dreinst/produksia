import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `next build` juga menghasilkan .next/standalone (server.js + dependensi minimum) untuk Docker/VPS;
  // di Vercel tidak diperlukan (Vercel memakai keluaran bawaannya sendiri)
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
};

export default nextConfig;
