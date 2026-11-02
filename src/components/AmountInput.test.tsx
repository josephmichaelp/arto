// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

/**
 * Uji AmountInput — pemisah ribuan otomatis pada kolom nominal.
 *
 * Nilai mentah yang disimpan pemanggil harus tetap digit saja, sementara yang
 * ditampilkan sudah dikelompokkan dengan titik.
 */
import {
  AmountInput,
  formatAmountDigits,
  MAX_AMOUNT_DIGITS,
  normalizeAmountDigits,
} from './AmountInput';

afterEach(cleanup);

describe('normalizeAmountDigits', () => {
  it('membuang semua karakter non-digit', () => {
    expect(normalizeAmountDigits('1.500.000')).toBe('1500000');
    expect(normalizeAmountDigits('Rp 25.000')).toBe('25000');
    expect(normalizeAmountDigits('abc')).toBe('');
  });

  it('menghapus nol di depan tetapi mempertahankan nol tunggal', () => {
    expect(normalizeAmountDigits('007')).toBe('7');
    expect(normalizeAmountDigits('0')).toBe('0');
    expect(normalizeAmountDigits('000')).toBe('0');
  });

  it('memangkas panjang agar nilai tetap aman menjadi Number', () => {
    const long = '9'.repeat(40);
    expect(normalizeAmountDigits(long)).toHaveLength(MAX_AMOUNT_DIGITS);
  });
});

describe('formatAmountDigits', () => {
  it('mengelompokkan ribuan dengan titik', () => {
    expect(formatAmountDigits('1000')).toBe('1.000');
    expect(formatAmountDigits('1500000')).toBe('1.500.000');
    expect(formatAmountDigits('123456789')).toBe('123.456.789');
  });

  it('tidak menambah titik di bawah seribu', () => {
    expect(formatAmountDigits('1')).toBe('1');
    expect(formatAmountDigits('999')).toBe('999');
  });

  it('string kosong tetap kosong, bukan nol', () => {
    expect(formatAmountDigits('')).toBe('');
  });

  it('sepadan dengan aturan formatRupiah pada nilai yang sama', async () => {
    const { formatRupiah } = await import('../../shared/domain/money');
    for (const n of [0, 5, 999, 1000, 1500000, 123456789]) {
      expect(`Rp ${formatAmountDigits(String(n))}`).toBe(formatRupiah(n));
    }
  });
});

describe('AmountInput', () => {
  it('menampilkan nilai mentah dalam bentuk terformat', () => {
    render(<AmountInput id="amt" value="1500000" onChange={() => {}} />);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('1.500.000');
  });

  it('melaporkan digit saja ke pemanggil, bukan teks terformat', () => {
    const onChange = vi.fn();
    render(<AmountInput id="amt" value="" onChange={onChange} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '1.500.000' } });

    expect(onChange).toHaveBeenCalledWith('1500000');
  });

  it('mengabaikan karakter non-digit yang diketik', () => {
    const onChange = vi.fn();
    render(<AmountInput id="amt" value="25" onChange={onChange} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '25abc!' } });

    expect(onChange).toHaveBeenCalledWith('25');
  });

  it('memakai papan tombol angka di perangkat sentuh', () => {
    render(<AmountInput id="amt" value="0" onChange={() => {}} />);
    expect(screen.getByRole('textbox').getAttribute('inputmode')).toBe('numeric');
  });

  it('meneruskan atribut lain seperti placeholder dan id', () => {
    render(<AmountInput id="saldo-awal" value="" placeholder="0" onChange={() => {}} />);
    const el = screen.getByRole('textbox');
    expect(el.getAttribute('id')).toBe('saldo-awal');
    expect(el.getAttribute('placeholder')).toBe('0');
  });
});