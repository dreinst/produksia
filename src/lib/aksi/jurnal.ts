"use server";

import { wajibHakAksi } from "@/lib/otentikasi";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { jalankanFormulir, type StatusFormulir } from "@/lib/statusFormulir";
import { D, format, uang, bacaUang, jumlahkan, type Desimal } from "@/lib/uang";
import { pastikanAkunRinci } from "@/lib/baganAkun";
import { pastikanTahunTerbuka } from "@/lib/tutupBuku";
import type { SumberJurnal } from "@/prisma-klien/enums";

type InputBarisJurnal = { akunId: string; debit: Desimal; kredit: Desimal; keterangan?: string };

function bacaBarisJurnal(raw: FormDataEntryValue | null): InputBarisJurnal[] {
  if (typeof raw !== "string" || !raw) throw new Error("Minimal 2 baris jurnal wajib diisi");
  let hasilBaca: unknown;
  try {
    hasilBaca = JSON.parse(raw);
  } catch {
    throw new Error("Format baris jurnal tidak valid");
  }
  if (!Array.isArray(hasilBaca)) throw new Error("Minimal 2 baris jurnal wajib diisi");
  return (hasilBaca as { akunId?: string; debit?: unknown; kredit?: unknown; keterangan?: string }[])
    .map((l) => ({
      akunId: String(l.akunId ?? ""),
      debit: uang(l.debit as string | number | undefined),
      kredit: uang(l.kredit as string | number | undefined),
      keterangan: l.keterangan ? String(l.keterangan) : undefined,
    }))
    .filter((l) => l.debit.gt(0) || l.kredit.gt(0));
}

async function buatJurnalSeimbang(keterangan: string, daftarBaris: InputBarisJurnal[], sumber: SumberJurnal, prefix: string) {
  if (daftarBaris.length < 2) throw new Error("Jurnal minimal punya 2 baris (debit & kredit) dengan nominal > 0");
  if (daftarBaris.some((l) => !l.akunId)) throw new Error("Setiap baris jurnal harus memilih akun");
  if (daftarBaris.some((l) => l.debit.isNegative() || l.kredit.isNegative())) throw new Error("Nominal tidak boleh negatif");
  if (daftarBaris.some((l) => l.debit.gt(0) && l.kredit.gt(0))) {
    throw new Error("Satu baris hanya boleh debit ATAU kredit, bukan keduanya");
  }

  const totalDebit = jumlahkan(daftarBaris.map((l) => l.debit));
  const totalKredit = jumlahkan(daftarBaris.map((l) => l.kredit));
  if (!totalDebit.equals(totalKredit)) {
    throw new Error(`Jurnal tidak seimbang: total debit ${format(totalDebit)} vs kredit ${format(totalKredit)}`);
  }
  if (totalDebit.isZero()) throw new Error("Jumlah jurnal tidak boleh nol");
  await pastikanAkunRinci(db, daftarBaris.map((l) => l.akunId));
  await pastikanTahunTerbuka(db, new Date());

  const nomor = await nomorDokumenBerikutnya(db.jurnal, prefix);

  await db.jurnal.create({
    data: {
      nomor,
      keterangan,
      sumber,
      baris: {
        create: daftarBaris.map((l) => ({
          akunId: l.akunId,
          debit: l.debit,
          kredit: l.kredit,
          keterangan: l.keterangan || null,
        })),
      },
    },
  });

  return nomor;
}

// ---------- Jurnal Umum (manual) ----------

export async function buatJurnalManual(dataFormulir: FormData) {
  await wajibHakAksi("jurnal.buat");
  const keterangan = String(dataFormulir.get("keterangan") ?? "");
  const daftarBaris = bacaBarisJurnal(dataFormulir.get("baris"));

  await buatJurnalSeimbang(keterangan, daftarBaris, "MANUAL", "JU");

  revalidatePath("/buku-besar/jurnal");
  redirect("/buku-besar/jurnal");
}

// ---------- Kas Masuk / Kas Keluar ----------

function bacaFormulirKas(dataFormulir: FormData) {
  const akunKasId = String(dataFormulir.get("akunKasId") ?? "");
  const akunLawanId = String(dataFormulir.get("akunLawanId") ?? "");
  const keterangan = String(dataFormulir.get("keterangan") ?? "").trim();
  if (!akunKasId) throw new Error("Akun Kas/Bank wajib dipilih");
  if (!akunLawanId) throw new Error("Akun lawan wajib dipilih");
  if (akunKasId === akunLawanId) throw new Error("Akun Kas/Bank dan akun lawan tidak boleh sama");
  const jumlah = bacaUang(dataFormulir.get("jumlah"), "Jumlah");
  return { akunKasId, akunLawanId, keterangan, jumlah };
}

export async function buatKasMasuk(dataFormulir: FormData) {
  await wajibHakAksi("kas-masuk.buat");
  const { akunKasId, akunLawanId, keterangan, jumlah } = bacaFormulirKas(dataFormulir);
  const zero = D(0);

  await buatJurnalSeimbang(
    keterangan || "Kas Masuk",
    [
      { akunId: akunKasId, debit: jumlah, kredit: zero, keterangan },
      { akunId: akunLawanId, debit: zero, kredit: jumlah, keterangan },
    ],
    "KAS_MASUK",
    "KM",
  );

  revalidatePath("/kas-bank/masuk");
  redirect("/kas-bank/masuk");
}

export async function buatKasKeluar(dataFormulir: FormData) {
  await wajibHakAksi("kas-keluar.buat");
  const { akunKasId, akunLawanId, keterangan, jumlah } = bacaFormulirKas(dataFormulir);
  const zero = D(0);

  await buatJurnalSeimbang(
    keterangan || "Kas Keluar",
    [
      { akunId: akunLawanId, debit: jumlah, kredit: zero, keterangan },
      { akunId: akunKasId, debit: zero, kredit: jumlah, keterangan },
    ],
    "KAS_KELUAR",
    "KK",
  );

  revalidatePath("/kas-bank/keluar");
  redirect("/kas-bank/keluar");
}

// ---------- Varian untuk <FormulirAksi> (mengembalikan pesan error, bukan throw) ----------

export async function buatJurnalManualFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatJurnalManual(dataFormulir));
}
export async function buatKasMasukFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatKasMasuk(dataFormulir));
}
export async function buatKasKeluarFormulir(_sebelumnya: StatusFormulir, dataFormulir: FormData) {
  return jalankanFormulir(() => buatKasKeluar(dataFormulir));
}
