/** Filter, pengurutan, dan pemisahan halaman Transaksi (fungsi domain murni). */

import type { Txn, TxnType } from './types';

export interface TxnFilter {
  keyword?: string;
  categoryId?: string;
  walletId?: string;
  type?: TxnType;
  /** YYYY-MM-DD (WIB), inklusif */
  from?: string;
  /** YYYY-MM-DD (WIB), inklusif */
  to?: string;
}

/**
 * Menyaring Transaksi secara konjungtif: hanya filter yang bernilai (bukan
 * undefined/string kosong) yang diterapkan, dan sebuah Transaksi harus lolos
 * semua filter aktif sekaligus.
 */
export function applyFilters(txns: Txn[], f: TxnFilter): Txn[] {
  const keyword = f.keyword?.trim().toLowerCase();
  return txns.filter((txn) => {
    if (keyword && !(txn.note ?? '').toLowerCase().includes(keyword)) {
      return false;
    }
    if (f.categoryId && txn.categoryId !== f.categoryId) {
      return false;
    }
    if (f.walletId && txn.walletId !== f.walletId) {
      return false;
    }
    if (f.type && txn.type !== f.type) {
      return false;
    }
    if (f.from && txn.date < f.from) {
      return false;
    }
    if (f.to && txn.date > f.to) {
      return false;
    }
    return true;
  });
}

/** Mengurutkan Transaksi dari tanggal terbaru (tak menaik). Stabil pada tanggal sama. */
export function sortByDateDesc(txns: Txn[]): Txn[] {
  return [...txns].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export interface Page<T> {
  items: T[];
  hasMore: boolean;
}

/**
 * Memisahkan daftar menjadi halaman ber-1-indeks dengan ukuran `size`
 * (default 20). Halaman di luar jangkauan menghasilkan daftar kosong dengan
 * `hasMore: false`.
 */
export function paginate<T>(items: T[], page: number, size = 20): Page<T> {
  const safePage = Math.max(1, Math.floor(page));
  const start = (safePage - 1) * size;
  const end = start + size;
  return {
    items: items.slice(start, end),
    hasMore: end < items.length,
  };
}
