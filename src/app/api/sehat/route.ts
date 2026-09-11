import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Cek kesehatan untuk deploy & pemantauan: aplikasi hidup dan basis data menjawab. Publik, tanpa detail apa pun. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
