-- CreateTable
CREATE TABLE "PercobaanMasuk" (
    "id" TEXT NOT NULL,
    "namaPengguna" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "waktu" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PercobaanMasuk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PercobaanMasuk_namaPengguna_waktu_idx" ON "PercobaanMasuk"("namaPengguna", "waktu");

-- CreateIndex
CREATE INDEX "PercobaanMasuk_ip_waktu_idx" ON "PercobaanMasuk"("ip", "waktu");

