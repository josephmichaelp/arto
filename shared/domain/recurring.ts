/**
 * Logika domain murni untuk Transaksi_Berulang (Requirement 6).
 *
 * `occurrence` selalu dihitung dari tanggal mulai asli (`startDate`), bukan
 * dari kejadian sebelumnya, agar tidak terjadi akumulasi galat pembulatan
 * tanggal. Untuk frekuensi `MONTHLY` dan `YEARLY`, bila hari pada bulan
 * target tidak ada (misalnya 31 pada bulan dengan 30 hari, atau 29 Februari
 * pada tahun bukan kabisat), tanggal di-clamp ke hari terakhir bulan
 * tersebut (Requirement 6.3).
 */

import type { Frequency, RuleLike } from './types';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toUtcDateOnly(year: number, month0: number, day: number): Date {
  return new Date(Date.UTC(year, month0, day));
}

function formatYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Parse `YYYY-MM-DD` menjadi `{ year, month0, day }`. Melempar galat bila format tidak valid. */
function parseDateOnly(date: string): { year: number; month0: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) {
    throw new Error('Tanggal harus berformat YYYY-MM-DD');
  }
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = toUtcDateOnly(year, month0, day);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month0 || d.getUTCDate() !== day) {
    throw new Error('Tanggal tidak valid');
  }
  return { year, month0, day };
}

/** Jumlah hari pada bulan `month0` (berbasis 0) tahun `year`. */
function daysInMonth0(year: number, month0: number): number {
  return toUtcDateOnly(year, month0 + 1, 0).getUTCDate();
}

/**
 * Menghitung tanggal kejadian ke-`index` (berbasis 0) dari aturan berulang,
 * dihitung selalu dari `startDate` asli. Untuk `MONTHLY`/`YEARLY`, hari
 * di-clamp ke hari terakhir bulan target bila tidak ada (K-3).
 */
export function occurrence(startDate: string, frequency: Frequency, index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('Indeks kejadian harus bilangan bulat tidak negatif');
  }
  const { year, month0, day } = parseDateOnly(startDate);

  switch (frequency) {
    case 'DAILY':
      return formatYmd(toUtcDateOnly(year, month0, day + index));
    case 'WEEKLY':
      return formatYmd(toUtcDateOnly(year, month0, day + index * 7));
    case 'MONTHLY': {
      const totalMonth0 = month0 + index;
      const targetYear = year + Math.floor(totalMonth0 / 12);
      const targetMonth0 = ((totalMonth0 % 12) + 12) % 12;
      const clampedDay = Math.min(day, daysInMonth0(targetYear, targetMonth0));
      return formatYmd(toUtcDateOnly(targetYear, targetMonth0, clampedDay));
    }
    case 'YEARLY': {
      const targetYear = year + index;
      const clampedDay = Math.min(day, daysInMonth0(targetYear, month0));
      return formatYmd(toUtcDateOnly(targetYear, month0, clampedDay));
    }
    default:
      throw new Error('Frekuensi tidak dikenal');
  }
}

/**
 * Mengembalikan seluruh kejadian yang sudah jatuh tempo (tanggal kurang dari
 * atau sama dengan `today`), dimulai dari `rule.nextIndex`, paling banyak
 * `limit` kejadian (default 366) per pemanggilan (Requirement 6.2, 6.6).
 * Mengembalikan daftar kosong bila aturan dijeda (Requirement 6.4).
 */
export function dueOccurrences(
  rule: RuleLike,
  today: string,
  limit = 366,
): { index: number; date: string }[] {
  if (rule.status !== 'ACTIVE') {
    return [];
  }
  const result: { index: number; date: string }[] = [];
  let index = rule.nextIndex;
  while (result.length < limit) {
    const date = occurrence(rule.startDate, rule.frequency, index);
    if (date > today) {
      break;
    }
    result.push({ index, date });
    index += 1;
  }
  return result;
}

/**
 * Mengembalikan kejadian berikutnya (dari `rule.nextIndex`) bila jatuh tempo
 * tersebut tepat 3 hari dari `today` (H-3), untuk membuat Notifikasi
 * pengingat (Requirement 6.5). Mengembalikan `null` bila aturan dijeda atau
 * jatuh tempo berikutnya bukan H-3.
 */
export function reminderDue(rule: RuleLike, today: string): { index: number; date: string } | null {
  if (rule.status !== 'ACTIVE') {
    return null;
  }
  const { year, month0, day } = parseDateOnly(today);
  const reminderTarget = formatYmd(toUtcDateOnly(year, month0, day + 3));
  const next = occurrence(rule.startDate, rule.frequency, rule.nextIndex);
  if (next === reminderTarget) {
    return { index: rule.nextIndex, date: next };
  }
  return null;
}
