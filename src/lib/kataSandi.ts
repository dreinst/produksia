import { randomBytes, scrypt as scryptDenganCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/*
 * Hash kata sandi memakai scrypt bawaan Node (tanpa pustaka luar), garam acak 16 byte per pengguna.
 * Dipisah dari otentikasi.ts supaya bisa dipakai skrip seed tanpa menyeret modul Next.js.
 */
const scrypt = promisify(scryptDenganCallback) as (kataSandi: string, garam: Buffer, panjang: number) => Promise<Buffer>;

export const PANJANG_KATA_SANDI_MINIMUM = 8;

export async function hashKataSandi(kataSandi: string): Promise<string> {
  const garam = randomBytes(16);
  const hash = await scrypt(kataSandi, garam, 64);
  return `scrypt$${garam.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifikasiKataSandi(kataSandi: string, tersimpan: string): Promise<boolean> {
  const [algoritma, garamB64, hashB64] = tersimpan.split("$");
  if (algoritma !== "scrypt" || !garamB64 || !hashB64) return false;
  const hash = await scrypt(kataSandi, Buffer.from(garamB64, "base64url"), 64);
  const target = Buffer.from(hashB64, "base64url");
  return hash.length === target.length && timingSafeEqual(hash, target);
}

export function periksaKekuatanKataSandi(kataSandi: string): string | null {
  if (kataSandi.length < PANJANG_KATA_SANDI_MINIMUM) return `Kata sandi minimal ${PANJANG_KATA_SANDI_MINIMUM} karakter`;
  if (!/[a-zA-Z]/.test(kataSandi) || !/[0-9]/.test(kataSandi)) return "Kata sandi harus memuat huruf dan angka";
  return null;
}
