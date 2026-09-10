import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Produksia",
    short_name: "Produksia",
    description: "Sistem informasi akuntansi untuk event & wedding organizer",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#0b2141",
    icons: [
      { src: "/logo/produksia-192.png", sizes: "192x192", type: "image/png" },
      { src: "/logo/produksia-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
