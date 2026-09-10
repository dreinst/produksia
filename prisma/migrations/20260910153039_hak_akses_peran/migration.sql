-- CreateTable
CREATE TABLE "HakAksesPeran" (
    "peran" "PeranPengguna" NOT NULL,
    "hak" TEXT NOT NULL,
    "boleh" BOOLEAN NOT NULL,

    CONSTRAINT "HakAksesPeran_pkey" PRIMARY KEY ("peran","hak")
);

