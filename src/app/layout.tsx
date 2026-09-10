import type { Metadata, Viewport } from "next";
import { Inter, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const hanken = Hanken_Grotesk({ variable: "--font-hanken", subsets: ["latin"], weight: ["600", "700"], display: "swap" });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], weight: ["500", "600"], display: "swap" });
// Ikon Material Symbols (variable font) di-self-host dari src/app/fonts, tanpa request ke Google saat runtime
const materialSymbols = localFont({ src: "./fonts/material-symbols-outlined.woff2", variable: "--font-material", display: "block", weight: "100 700" });

export const metadata: Metadata = {
  title: "Produksia",
  description: "Sistem penjualan, pembelian, persediaan & akuntansi internal",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f8fafc",
};

/** Tata letak akar: hanya font & kanvas. Kerangka aplikasi (sidebar/topbar) ada di (aplikasi)/layout.tsx. */
export default function TataLetakUtama({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="id"
      className={`${inter.variable} ${hanken.variable} ${jetbrains.variable} ${materialSymbols.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
