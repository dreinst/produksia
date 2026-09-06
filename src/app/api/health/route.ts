import { db } from "@/lib/db";

export async function GET() {
  const customerCount = await db.customer.count();
  return Response.json({ ok: true, customerCount });
}
