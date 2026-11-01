/**
 * AmountDisplay — menampilkan nominal Rupiah dalam Format_Rupiah (Req 2.7, 17.9).
 *
 * Fitur:
 * - Memakai `formatRupiah` dari domain murni agar formatnya konsisten.
 * - Menambah kelas CSS `arto-amount` yang menetapkan `font-variant-numeric: tabular-nums`
 *   sehingga digit sejajar secara tabular (Req 17.9).
 * - Warna opsional: "income" (hijau), "expense" (merah/muted), atau "neutral" (default).
 * - Mendukung `aria-label` kustom; bila tidak disuplai, label a11y dibuat otomatis
 *   ("Rp 1.000.000" sudah terbaca pembaca layar).
 */
import type { HTMLAttributes } from 'react';
import { formatRupiah } from 'shared/domain/money';

export interface AmountDisplayProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Nominal bilangan bulat Rupiah. */
  amount: number;
  /**
   * Warna semantis:
   * - `"income"` → warna positif (hijau/biru)
   * - `"expense"` → warna negatif (merah muda/merah)
   * - `"neutral"` → warna teks bawaan (default)
   */
  variant?: 'income' | 'expense' | 'neutral';
}

const VARIANT_COLOR: Record<string, string> = {
  income: 'var(--color-income, #1a7a4a)',
  expense: 'var(--color-expense, #c0392b)',
  neutral: 'inherit',
};

export function AmountDisplay({ amount, variant = 'neutral', className, style, ...rest }: AmountDisplayProps) {
  let formatted: string;
  try {
    formatted = formatRupiah(amount);
  } catch {
    formatted = 'Rp —';
  }

  const color = VARIANT_COLOR[variant] ?? 'inherit';

  return (
    <span
      className={['arto-amount', className].filter(Boolean).join(' ')}
      style={{ fontVariantNumeric: 'tabular-nums', color, ...style }}
      {...rest}
    >
      {formatted}
    </span>
  );
}

export default AmountDisplay;
