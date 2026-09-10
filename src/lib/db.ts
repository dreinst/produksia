import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/prisma-klien/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Pool koneksi pg: bawaan 10; naikkan lewat DB_POOL_MAX bila satu proses melayani banyak pengguna serentak
// (batas atas PostgreSQL max_connections dikurangi cadangan; tiap proses Next punya pool sendiri).
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX ?? 10) });

export const db = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
