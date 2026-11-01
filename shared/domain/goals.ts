/**
 * Fungsi domain murni untuk Target_Tabungan: progres terhadap target dan
 * setoran bulanan yang diperlukan untuk mencapai target tepat waktu.
 * Lihat design.md bagian "Modul domain murni" dan Properti 14.
 */
import type { Rupiah } from './types';

/** Parse `YYYY-MM-DD` menjadi `{ year, month0 }` (month0 berbasis 0). Melempar galat bila tidak valid. */
function parseYearMonth(date: string): { year: number; month0: number } {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (!m) {
    throw new Error('Tanggal harus berformat YYYY-MM-DD');
  }
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  if (month0 < 0 || month0 > 11) {
    throw new Error('Tanggal tidak valid');
  }
  return { year, month0 };
}

/**
 * Jumlah bulan kalender dari `from` sampai `to` (boleh negatif atau 0 bila
 * `to` sama dengan atau sebelum `from`).
 */
function monthsBetween(from: string, to: string): number {
  const a = parseYearMonth(from);
  const b = parseYearMonth(to);
  return (b.year - a.year) * 12 + (b.month0 - a.month0);
}

/**
 * Menghitung progres Target_Tabungan: persentase `saved / target` dan
 * status tercapai tepat saat `saved >= target`.
 *
 * Properti 14: untuk setiap nominal terkumpul dan target lebih dari 0,
 * `percent` SHALL sama dengan `saved / target` dan `achieved` SHALL benar
 * tepat saat `saved >= target`.
 * _Requirements: 7.3, 7.4_
 */
export function goalProgress(saved: Rupiah, target: Rupiah): { percent: number; achieved: boolean } {
  if (!Number.isFinite(target) || target <= 0) {
    throw new Error('Target harus berupa angka bulat lebih dari 0');
  }
  return {
    percent: saved / target,
    achieved: saved >= target,
  };
}

/**
 * Menghitung setoran bulanan yang diperlukan agar Target_Tabungan tercapai
 * tepat waktu: sisa target (`target - saved`, minimal 0) dibagi jumlah
 * bulan tersisa dari `today` sampai `deadline` (minimal 1 bulan),
 * dibulatkan ke atas. Mengembalikan `null` bila `deadline` tidak diisi.
 *
 * Properti 14: `monthlyNeeded` SHALL sama dengan sisa target dibagi jumlah
 * bulan tersisa (minimal 1) dibulatkan ke atas, dan `null` bila tanpa
 * tenggat.
 * _Requirements: 7.5_
 */
export function monthlyNeeded(
  saved: Rupiah,
  target: Rupiah,
  deadline: string | undefined,
  today: string,
): Rupiah | null {
  if (!deadline) {
    return null;
  }
  const remaining = Math.max(0, target - saved);
  const monthsRemaining = Math.max(1, monthsBetween(today, deadline));
  return Math.ceil(remaining / monthsRemaining);
}
