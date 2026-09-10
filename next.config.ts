import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `next build` juga menghasilkan .next/standalone (server.js + dependensi minimum) untuk Docker/VPS
  output: "standalone",
};

export default nextConfig;
