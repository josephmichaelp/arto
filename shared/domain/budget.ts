/**
 * Fungsi domain murni untuk Perencanaan Anggaran: realisasi per bulan WIB,
 * status (sisa, persen, level), ambang peringatan/pelampauan, dan salin
 * Anggaran dari bulan sebelumnya. Lihat design.md bagian "Modul domain
 * murni" dan Properti 8, 9, 10.
 */
import type { Budget, Rupiah, Txn } from './types';

export interface BudgetStatus {
  spent: Rupiah;
  remaining: Rupiah;
  percent: number;
  level: 'OK' | 'WARN80' | 'OVER100';
}

/**
 * Menghitung realisasi (jumlah pengeluaran) Kategori `categoryId` pada
 * bulan `month` (`YYYY-MM`, WIB) dari daftar Transaksi. Hanya Transaksi
 * `EXPENSE` yang dihitung; pemindahan dan setoran Target tidak termasuk
 * (K-6, Req 5.2).
 */
export function monthlySpent(txns: Txn[], categoryId: string, month: string): Rupiah {
  return txns.reduce((total, txn) => {
    if (txn.type === 'EXPENSE' && txn.categoryId === categoryId && txn.date.slice(0, 7) === month) {
      return total + txn.amount;
    }
    return total;
  }, 0);
}

/**
 * Menghasilkan status realisasi Anggaran `b`: jumlah terpakai, sisa,
 * persentase terpakai, dan level (`OK`, `WARN80`, `OVER100`) berdasarkan
 * perbandingan bilangan bulat `thresholdCrossings` (Req 5.2, 5.3).
 */
export function budgetStatus(b: Budget, txns: Txn[]): BudgetStatus {
  const spent = monthlySpent(txns, b.categoryId, b.month);
  const remaining = b.amount - spent;
  const percent = b.amount > 0 ? Math.round((spent * 100) / b.amount) : spent > 0 ? 100 : 0;
  const { warn80, over100 } = thresholdCrossings(b, spent);
  const level: BudgetStatus['level'] = over100 ? 'OVER100' : warn80 ? 'WARN80' : 'OK';
  return { spent, remaining, percent, level };
}

/**
 * Menentukan apakah realisasi `spent` melintasi ambang 80 persen
 * (`warn80`) atau melampaui 100 persen (`over100`) dari nominal Anggaran
 * `b.amount`, memakai perbandingan bilangan bulat tanpa float:
 * `warn80: spent * 100 >= amount * 80` dan `over100: spent > amount`
 * (Req 5.4, 5.5).
 */
export function thresholdCrossings(b: Budget, spent: Rupiah): { warn80: boolean; over100: boolean } {
  return {
    warn80: spent * 100 >= b.amount * 80,
    over100: spent > b.amount,
  };
}

/**
 * Menyalin Anggaran dari `prev` ke bulan `toMonth`, menghasilkan hanya
 * Anggaran baru yang belum ada di `existing` untuk Kategori dan bulan
 * tersebut (tidak menimpa Anggaran yang sudah ada). ID Anggaran baru
 * berformat `<categoryId>#<toMonth>` (Req 5.6).
 */
export function copyBudgets(prev: Budget[], toMonth: string, existing: Budget[]): Budget[] {
  const existingCategoryIds = new Set(
    existing.filter((b) => b.month === toMonth).map((b) => b.categoryId),
  );
  const seen = new Set<string>();
  const result: Budget[] = [];
  for (const p of prev) {
    if (existingCategoryIds.has(p.categoryId) || seen.has(p.categoryId)) {
      continue;
    }
    seen.add(p.categoryId);
    result.push({
      id: `${p.categoryId}#${toMonth}`,
      categoryId: p.categoryId,
      month: toMonth,
      amount: p.amount,
    });
  }
  return result;
}
