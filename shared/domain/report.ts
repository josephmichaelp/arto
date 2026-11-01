/**
 * Fungsi domain murni untuk Laporan: ringkasan total, pembagian per
 * Kategori, dan tren per bucket (hari, minggu, bulan). Transfer
 * (`TRANSFER_OUT`, `TRANSFER_IN`) dan setoran Target (`GOAL_DEPOSIT`) tidak
 * ikut dihitung (K-3). Lihat design.md bagian "Modul domain murni" dan
 * Properti 6, 7.
 */
import { weekRangeEnding } from './dates';
import type { DateRange, Rupiah, Txn } from './types';

export interface Summary {
  income: Rupiah;
  expense: Rupiah;
  net: Rupiah;
}

/** Transaksi dalam rentang tanggal `range` (inklusif, YYYY-MM-DD, WIB). */
function inRange(txn: Txn, range: DateRange): boolean {
  return txn.date >= range.from && txn.date <= range.to;
}

/**
 * Menghitung total pemasukan, pengeluaran, dan selisihnya (`net`) dari
 * Transaksi `txns` dalam rentang `range`. Hanya Transaksi `INCOME` dan
 * `EXPENSE` yang dihitung; Transaksi pemindahan Dompet dan setoran Target
 * diabaikan (Req 4.6, 8.1, 8.2).
 */
export function summarize(txns: Txn[], range: DateRange): Summary {
  let income = 0;
  let expense = 0;
  for (const txn of txns) {
    if (!inRange(txn, range)) {
      continue;
    }
    if (txn.type === 'INCOME') {
      income += txn.amount;
    } else if (txn.type === 'EXPENSE') {
      expense += txn.amount;
    }
  }
  return { income, expense, net: income - expense };
}

/**
 * Menjumlahkan pengeluaran per Kategori dalam rentang `range`, diurutkan
 * dari total terbesar ke terkecil (seri diurutkan berdasarkan `categoryId`).
 * Jumlah seluruh `total` SHALL sama dengan `summarize(...).expense`
 * (Req 8.1, 8.2).
 */
export function byCategory(
  txns: Txn[],
  range: DateRange,
): { categoryId: string; total: Rupiah }[] {
  const totals = new Map<string, Rupiah>();
  for (const txn of txns) {
    if (!inRange(txn, range) || txn.type !== 'EXPENSE') {
      continue;
    }
    const categoryId = txn.categoryId ?? '';
    totals.set(categoryId, (totals.get(categoryId) ?? 0) + txn.amount);
  }
  return [...totals.entries()]
    .map(([categoryId, total]) => ({ categoryId, total }))
    .sort((a, b) => (b.total !== a.total ? b.total - a.total : a.categoryId.localeCompare(b.categoryId)));
}

/** Kunci bucket untuk sebuah tanggal, sesuai jenis `bucket`. */
function bucketKey(date: string, bucket: 'DAY' | 'WEEK' | 'MONTH'): string {
  if (bucket === 'DAY') {
    return date;
  }
  if (bucket === 'MONTH') {
    return date.slice(0, 7);
  }
  return weekRangeEnding(date).start;
}

/**
 * Mengelompokkan total pemasukan dan pengeluaran Transaksi dalam rentang
 * `range` ke dalam bucket harian, mingguan (kunci: Senin minggu tersebut),
 * atau bulanan, diurutkan menaik berdasarkan kunci bucket. Jumlah `income`
 * dan `expense` seluruh bucket SHALL sama dengan total `summarize` untuk
 * rentang yang sama (Req 8.3).
 */
export function trend(
  txns: Txn[],
  range: DateRange,
  bucket: 'DAY' | 'WEEK' | 'MONTH',
): { bucket: string; income: Rupiah; expense: Rupiah }[] {
  const totals = new Map<string, { income: Rupiah; expense: Rupiah }>();
  for (const txn of txns) {
    if (!inRange(txn, range) || (txn.type !== 'INCOME' && txn.type !== 'EXPENSE')) {
      continue;
    }
    const key = bucketKey(txn.date, bucket);
    const entry = totals.get(key) ?? { income: 0, expense: 0 };
    if (txn.type === 'INCOME') {
      entry.income += txn.amount;
    } else {
      entry.expense += txn.amount;
    }
    totals.set(key, entry);
  }
  return [...totals.entries()]
    .map(([key, v]) => ({ bucket: key, income: v.income, expense: v.expense }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}
