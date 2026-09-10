-- CreateTable
CREATE TABLE "PermintaanAturUlang" (
    "id" TEXT NOT NULL,
    "penggunaId" TEXT NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'MENUNGGU',
    "token" TEXT,
    "kedaluwarsa" TIMESTAMP(3),
    "ditanganiOleh" TEXT,
    "ditanganiPada" TIMESTAMP(3),
    "selesaiPada" TIMESTAMP(3),

    CONSTRAINT "PermintaanAturUlang_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PermintaanAturUlang_token_key" ON "PermintaanAturUlang"("token");

-- CreateIndex
CREATE INDEX "PermintaanAturUlang_status_idx" ON "PermintaanAturUlang"("status");

-- AddForeignKey
ALTER TABLE "PermintaanAturUlang" ADD CONSTRAINT "PermintaanAturUlang_penggunaId_fkey" FOREIGN KEY ("penggunaId") REFERENCES "Pengguna"("id") ON DELETE CASCADE ON UPDATE CASCADE;

