-- Peran Superadmin (setara Pemilik) + masuk dengan nama pengguna, email jadi kontak opsional
ALTER TYPE "PeranPengguna" ADD VALUE 'SUPERADMIN' BEFORE 'PEMILIK';

ALTER TABLE "Pengguna" ADD COLUMN "namaPengguna" TEXT;
-- Akun lama: nama pengguna diambil dari bagian depan email; bila bentrok diberi akhiran id
UPDATE "Pengguna" SET "namaPengguna" = lower(split_part("email", '@', 1)) WHERE "namaPengguna" IS NULL;
UPDATE "Pengguna" p SET "namaPengguna" = p."namaPengguna" || '-' || substr(p.id, 1, 6)
WHERE EXISTS (SELECT 1 FROM "Pengguna" q WHERE q."namaPengguna" = p."namaPengguna" AND q.id < p.id);
ALTER TABLE "Pengguna" ALTER COLUMN "namaPengguna" SET NOT NULL;
ALTER TABLE "Pengguna" ALTER COLUMN "email" DROP NOT NULL;
CREATE UNIQUE INDEX "Pengguna_namaPengguna_key" ON "Pengguna"("namaPengguna");
