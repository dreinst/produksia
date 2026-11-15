import "dotenv/config";
// Skrip ini memanggil halaman di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { existsSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { db } from "../src/lib/db";
import FormulirAksi from "../src/komponen/FormulirAksi";
import HalamanPajak from "../src/app/(aplikasi)/buku-besar/pajak/page";
import { pastikan } from "./bantuan";

/*
 * Bug lama B-36: halaman Pajak & SPT menaut ke /kas-bank/keluar/baru yang tidak ada (404). Tautan Kas Keluar kini ke
 * /kas-bank/keluar (halaman dengan formulir kas keluar) dan hanya tampil bagi pemegang kas-keluar.lihat dan
 * kas-keluar.buat. Diuji di lingkup satu perusahaan dan gabungan. Penyesuaian hak ADMIN sementara di HakAksesPeran
 * dikembalikan di finally.
 */

const RUTE_KAS_KELUAR = "/kas-bank/keluar";

async function dengan<T>(isian: { perusahaan: string; peran: string }, fn: () => Promise<T>): Promise<T> {
  const lama = { perusahaan: process.env.UJI_PERUSAHAAN, peran: process.env.UJI_PERAN };
  process.env.UJI_PERUSAHAAN = isian.perusahaan;
  process.env.UJI_PERAN = isian.peran;
  try {
    return await fn();
  } finally {
    for (const [k, v] of [["UJI_PERUSAHAAN", lama.perusahaan], ["UJI_PERAN", lama.peran]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Menjalankan komponen server secara rekursif dan mengumpulkan href semua Link serta tautan <a>. */
async function kumpulkanTautan(node: ReactNode | Promise<ReactNode>): Promise<{ href: string; teks: string }[]> {
  const hasil: { href: string; teks: string }[] = [];
  const jalan = async (n: ReactNode | Promise<ReactNode>): Promise<string> => {
    const v = await n;
    if (v === null || v === undefined || typeof v === "boolean") return "";
    if (typeof v === "string" || typeof v === "number") return String(v);
    if (Array.isArray(v)) return (await Promise.all(v.map((x) => jalan(x)))).join("");
    if (!isValidElement(v)) return "";
    const el = v as ReactElement<Record<string, unknown>>;
    const anak = async () => jalan(el.props.children as ReactNode);
    if (el.type === Link || el.type === "a") {
      const teks = await anak();
      hasil.push({ href: String(el.props.href), teks });
      return teks;
    }
    // komponen klien ber-hook tidak dijalankan: cukup anaknya
    if (el.type === FormulirAksi) return anak();
    if (typeof el.type === "function") return jalan((el.type as (p: unknown) => ReactNode | Promise<ReactNode>)(el.props));
    return anak();
  };
  await jalan(node);
  return hasil;
}

/** Rute /kas-bank/keluar/baru dan sejenisnya harus punya berkas halaman; pemeriksaan sederhana untuk rute statis. */
function adaHalaman(href: string): boolean {
  return existsSync(`src/app/(aplikasi)${href.split("?")[0]}/page.tsx`);
}

async function main() {
  const halaman = () => HalamanPajak({ searchParams: Promise.resolve({}) });
  const tautanKasKeluar = async (perusahaan: string, peran: string) =>
    (await dengan({ perusahaan, peran }, async () => kumpulkanTautan(await halaman()))).filter((t) => t.teks === "Kas Keluar");

  const awalAdmin = await db.hakAksesPeran.findUnique({ where: { peran_hak: { peran: "ADMIN", hak: "kas-keluar.buat" } } });
  try {
    console.log("=== Rute tujuan ada ===");
    pastikan(adaHalaman(RUTE_KAS_KELUAR), `${RUTE_KAS_KELUAR} punya halaman`);
    pastikan(!adaHalaman("/kas-bank/keluar/baru"), "/kas-bank/keluar/baru memang tidak ada, jadi tidak boleh ditaut");

    console.log("=== Berhak: tautan ke rute yang ada ===");
    for (const [perusahaan, label] of [["utama", "lingkup satu perusahaan"], ["semua", "gabungan"]] as const) {
      for (const peran of ["PEMILIK", "ADMIN"]) {
        const t = await tautanKasKeluar(perusahaan, peran);
        pastikan(t.length === 1 && t[0].href === RUTE_KAS_KELUAR && adaHalaman(t[0].href), `${peran}, ${label}: Kas Keluar menaut ke ${RUTE_KAS_KELUAR}`);
      }
    }
    const semuaTautan = await dengan({ perusahaan: "utama", peran: "PEMILIK" }, async () => kumpulkanTautan(await halaman()));
    pastikan(semuaTautan.every((t) => !t.href.includes("/keluar/baru")), "tidak ada tautan ke /keluar/baru di halaman");

    console.log("=== Tanpa kas-keluar.buat: teks biasa tanpa tautan ===");
    await db.hakAksesPeran.upsert({ where: { peran_hak: { peran: "ADMIN", hak: "kas-keluar.buat" } }, create: { peran: "ADMIN", hak: "kas-keluar.buat", boleh: false }, update: { boleh: false } });
    for (const [perusahaan, label] of [["utama", "lingkup satu perusahaan"], ["semua", "gabungan"]] as const) {
      const t = await tautanKasKeluar(perusahaan, "ADMIN");
      pastikan(t.length === 0, `ADMIN tanpa kas-keluar.buat, ${label}: tidak ada tautan Kas Keluar`);
      const teks = await dengan({ perusahaan, peran: "ADMIN" }, async () => (await kumpulkanTautan(await halaman())).length);
      pastikan(teks > 0, `ADMIN tanpa kas-keluar.buat, ${label}: halaman tetap tampil (tautan lain ada)`);
    }
    const pemilik = await tautanKasKeluar("utama", "PEMILIK");
    pastikan(pemilik.length === 1, "PEMILIK tidak terpengaruh penyesuaian hak ADMIN");
  } finally {
    if (awalAdmin) await db.hakAksesPeran.update({ where: { peran_hak: { peran: "ADMIN", hak: "kas-keluar.buat" } }, data: { boleh: awalAdmin.boleh } });
    else await db.hakAksesPeran.deleteMany({ where: { peran: "ADMIN", hak: "kas-keluar.buat" } });
  }
  const sesudah = await db.hakAksesPeran.findUnique({ where: { peran_hak: { peran: "ADMIN", hak: "kas-keluar.buat" } } });
  pastikan(awalAdmin ? sesudah?.boleh === awalAdmin.boleh : sesudah === null, "penyesuaian hak ADMIN sementara sudah dikembalikan");
  console.log("=== DONE, all pajak tautan checks passed ===");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
