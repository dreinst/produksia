import { redirect } from "next/navigation";
import { wajibHak } from "@/lib/otentikasi";

/** /crm mengalihkan ke dasbor CRM (DESAIN R2). */
export default async function HalamanCrm() {
  await wajibHak("lead.lihat");
  redirect("/crm/dasbor");
}
