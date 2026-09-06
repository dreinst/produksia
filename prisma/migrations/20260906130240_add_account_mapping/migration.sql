/*
  Warnings:

  - Added the required column `accountId` to the `PurchasePayment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `accountId` to the `SalesReceipt` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PurchasePayment" ADD COLUMN     "accountId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "SalesReceipt" ADD COLUMN     "accountId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "AccountMapping" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "piutangUsahaId" TEXT NOT NULL,
    "persediaanId" TEXT NOT NULL,
    "hppId" TEXT NOT NULL,
    "pendapatanPenjualanId" TEXT NOT NULL,
    "utangUsahaId" TEXT NOT NULL,

    CONSTRAINT "AccountMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountMapping_piutangUsahaId_key" ON "AccountMapping"("piutangUsahaId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountMapping_persediaanId_key" ON "AccountMapping"("persediaanId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountMapping_hppId_key" ON "AccountMapping"("hppId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountMapping_pendapatanPenjualanId_key" ON "AccountMapping"("pendapatanPenjualanId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountMapping_utangUsahaId_key" ON "AccountMapping"("utangUsahaId");

-- AddForeignKey
ALTER TABLE "SalesReceipt" ADD CONSTRAINT "SalesReceipt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasePayment" ADD CONSTRAINT "PurchasePayment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMapping" ADD CONSTRAINT "AccountMapping_piutangUsahaId_fkey" FOREIGN KEY ("piutangUsahaId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMapping" ADD CONSTRAINT "AccountMapping_persediaanId_fkey" FOREIGN KEY ("persediaanId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMapping" ADD CONSTRAINT "AccountMapping_hppId_fkey" FOREIGN KEY ("hppId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMapping" ADD CONSTRAINT "AccountMapping_pendapatanPenjualanId_fkey" FOREIGN KEY ("pendapatanPenjualanId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMapping" ADD CONSTRAINT "AccountMapping_utangUsahaId_fkey" FOREIGN KEY ("utangUsahaId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
