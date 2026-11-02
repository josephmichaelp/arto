/**
 * AmountInput — kolom nominal Rupiah dengan pemisah ribuan otomatis.
 *
 * Sebelumnya setiap kolom nominal menampilkan digit mentah ("1500000"),
 * sehingga nilai ratusan ribu ke atas sulit dibaca dan mudah salah ketik.
 * Komponen ini menampilkan "1.500.000" sambil tetap menyimpan digit mentah di
 * state pemanggil, jadi logika pengiriman data tidak berubah.
 *
 * Pengelompokan memakai `groupThousands` dari `shared/domain/money.ts` —
 * fungsi yang sama yang dipakai `formatRupiah`, sehingga tampilan saat mengetik
 * dan tampilan nominal tersimpan tidak mungkin berbeda aturan.
 *
 * Posisi kursor dipertahankan dengan menghitung jumlah digit di sebelah kiri
 * kursor, bukan jumlah karakter, supaya titik yang muncul atau hilang tidak
 * membuat kursor melompat saat menyunting di tengah angka.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { groupThousands } from '../../shared/domain/money';

/** Batas digit agar nilai tetap aman diubah menjadi Number oleh pemanggil. */
export const MAX_AMOUNT_DIGITS = 15;

/**
 * Menormalkan masukan menjadi digit saja: membuang non-digit, memangkas
 * panjang, dan menghapus nol di depan (kecuali nilainya memang "0").
 */
export function normalizeAmountDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, MAX_AMOUNT_DIGITS);
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  return trimmed;
}

/** Tampilan terformat dari digit mentah. String kosong tetap kosong. */
export function formatAmountDigits(digits: string): string {
  const clean = normalizeAmountDigits(digits);
  return clean === '' ? '' : groupThousands(clean);
}

export interface AmountInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'type' | 'inputMode'
  > {
  /** Nilai mentah berupa digit saja, mis. "1500000". */
  value: string;
  /** Dipanggil dengan digit saja (tanpa titik). */
  onChange: (digits: string) => void;
}

export function AmountInput({ value, onChange, ...rest }: AmountInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState<number | null>(null);

  const display = formatAmountDigits(value);

  // Kursor dipulihkan setelah React menulis nilai terformat ke DOM.
  useLayoutEffect(() => {
    if (caret === null) return;
    const el = ref.current;
    if (el) el.setSelectionRange(caret, caret);
    setCaret(null);
  }, [caret, display]);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const el = event.target;
    const selection = el.selectionStart ?? el.value.length;
    // Hitung digit (bukan karakter) di sebelah kiri kursor.
    const digitsBeforeCaret = el.value.slice(0, selection).replace(/\D/g, '').length;

    const digits = normalizeAmountDigits(el.value);
    const formatted = formatAmountDigits(digits);

    // Majukan posisi melewati titik sampai jumlah digit yang sama tercapai.
    let pos = 0;
    let seen = 0;
    while (pos < formatted.length && seen < digitsBeforeCaret) {
      if (/\d/.test(formatted[pos] ?? '')) seen += 1;
      pos += 1;
    }

    setCaret(pos);
    onChange(digits);
  }

  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={display}
      onChange={handleChange}
    />
  );
}

export default AmountInput;