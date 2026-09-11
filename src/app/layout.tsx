import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Ikon Material Symbols (variable font) di-self-host dari src/app/fonts, tanpa request ke Google saat runtime
const materialSymbols = localFont({ src: "./fonts/material-symbols-outlined.woff2", variable: "--font-material", display: "block", weight: "100 700" });

export const metadata: Metadata = {
  title: "Produksia",
  applicationName: "Produksia",
  description: "Sistem informasi akuntansi untuk event & wedding organizer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b2141",
};

/** Tata letak akar: hanya font & kanvas. Kerangka aplikasi (sidebar/topbar) ada di (aplikasi)/layout.tsx. */
export default function TataLetakUtama({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="id"
      className={`${materialSymbols.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
