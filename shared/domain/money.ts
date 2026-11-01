/**
 * Fungsi domain murni untuk format, penafsiran, dan validasi nominal Rupiah.
 * Lihat design.md bagian "Modul domain murni" untuk kontrak setiap fungsi.
 */
import type { Rupiah } from './types';

const AMOUNT_ERROR_MESSAGE = 'Nominal harus berupa angka bulat lebih dari 0';

/** Mengelompokkan digit dengan titik setiap 3 digit dari kanan. */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Format_Rupiah: "Rp 1.000.000"; nominal negatif: "-Rp 1.000".
 * Melempar galat bila `n` bukan bilangan bulat (K-1).
 */
export function formatRupiah(n: Rupiah): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(AMOUNT_ERROR_MESSAGE);
  }
  const sign = n < 0 ? '-' : '';
  const digits = Math.abs(n).toString();
  return `${sign}Rp ${groupThousands(digits)}`;
}

/**
 * Kebalikan dari `formatRupiah`. Mengembalikan `null` bila `s` tidak
 * memenuhi pola "Rp <digit dikelompokkan>" dengan tanda minus opsional.
 */
export function parseRupiah(s: string): Rupiah | null {
  if (typeof s !== 'string') {
    return null;
  }
  const trimmed = s.trim();
  const match = trimmed.match(/^(-)?\s*Rp\s*(\d{1,3}(?:\.\d{3})*)$/i);
  if (!match) {
    return null;
  }
  const sign = match[1] ? -1 : 1;
  const digits = (match[2] ?? '').replace(/\./g, '');
  const value = Number(digits);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  return sign * value;
}

/**
 * Menafsirkan singkatan nominal seperti "35rb" -> 35000 dan "1,5jt" -> 1500000.
 * Juga menerima angka biasa (opsional berawalan "Rp" dan pemisah ribuan titik).
 * Mengembalikan `null` bila bentuknya tidak dikenali atau hasilnya bukan
 * bilangan bulat positif.
 */
export function parseAmountShorthand(s: string): Rupiah | null {
  if (typeof s !== 'string') {
    return null;
  }
  let str = s.trim().toLowerCase();
  if (!str) {
    return null;
  }
  str = str.replace(/^rp\.?\s*/, '').trim();

  const match = str.match(/^([0-9]+(?:[.,][0-9]+)*)\s*(ribu|rb|juta|jt)?$/);
  if (!match) {
    return null;
  }
  const numRaw = match[1] ?? '';
  const suffix = match[2];

  const multiplier =
    suffix === 'rb' || suffix === 'ribu'
      ? 1_000
      : suffix === 'jt' || suffix === 'juta'
        ? 1_000_000
        : 1;

  let normalized: string;
  if (multiplier !== 1) {
    // Bentuk singkatan: koma (atau titik tunggal) berperan sebagai pemisah desimal.
    const decimalCount = (numRaw.match(/[.,]/g) || []).length;
    if (decimalCount > 1) {
      return null;
    }
    normalized = numRaw.replace(',', '.');
  } else {
    // Angka biasa: titik adalah pemisah ribuan, koma adalah pemisah desimal.
    if (numRaw.includes(',')) {
      const [intPart, decPart] = numRaw.split(',');
      if (decPart && /[^0]/.test(decPart)) {
        // Rupiah tidak memiliki pecahan (K-1); desimal non-nol ditolak.
        return null;
      }
      normalized = (intPart ?? '').replace(/\./g, '');
    } else {
      normalized = numRaw.replace(/\./g, '');
    }
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return null;
  }
  const result = Math.round(value * multiplier);
  if (!Number.isInteger(result) || result <= 0) {
    return null;
  }
  return result;
}

/**
 * Memvalidasi nominal masukan (angka atau string dari formulir).
 * Hanya bilangan bulat lebih dari 0 yang dianggap valid.
 */
export function validateAmount(
  v: unknown,
): { ok: true; value: Rupiah } | { ok: false; message: string } {
  let num: number;

  if (typeof v === 'number') {
    num = v;
  } else if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed) {
      return { ok: false, message: AMOUNT_ERROR_MESSAGE };
    }
    const normalized = trimmed.replace(/\./g, '').replace(',', '.');
    num = Number(normalized);
  } else {
    return { ok: false, message: AMOUNT_ERROR_MESSAGE };
  }

  if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) {
    return { ok: false, message: AMOUNT_ERROR_MESSAGE };
  }

  return { ok: true, value: num };
}
