import { db } from "@/lib/db";

export async function GET() {
  const customerCount = await db.pelanggan.count();
  return Response.json({ ok: true, customerCount });
}
