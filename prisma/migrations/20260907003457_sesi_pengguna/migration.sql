-- AlterTable
ALTER TABLE "Pengguna" ADD COLUMN     "aktif" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Sesi" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "penggunaId" TEXT NOT NULL,
    "kedaluwarsa" TIMESTAMP(3) NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sesi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sesi_tokenHash_key" ON "Sesi"("tokenHash");

-- CreateIndex
CREATE INDEX "Sesi_penggunaId_idx" ON "Sesi"("penggunaId");

-- AddForeignKey
ALTER TABLE "Sesi" ADD CONSTRAINT "Sesi_penggunaId_fkey" FOREIGN KEY ("penggunaId") REFERENCES "Pengguna"("id") ON DELETE CASCADE ON UPDATE CASCADE;
