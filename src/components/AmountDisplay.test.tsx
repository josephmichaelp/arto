// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AmountDisplay } from './AmountDisplay';

afterEach(cleanup);

describe('AmountDisplay', () => {
  it('memformat nominal positif dalam Format_Rupiah', () => {
    render(<AmountDisplay amount={1500000} />);
    expect(screen.getByText('Rp 1.500.000')).not.toBeNull();
  });

  it('memformat nominal nol', () => {
    render(<AmountDisplay amount={0} />);
    expect(screen.getByText('Rp 0')).not.toBeNull();
  });

  it('memformat nominal negatif (saldo minus)', () => {
    render(<AmountDisplay amount={-50000} />);
    expect(screen.getByText('-Rp 50.000')).not.toBeNull();
  });

  it('memakai kelas arto-amount untuk digit tabular', () => {
    const { container } = render(<AmountDisplay amount={1000} />);
    const span = container.querySelector('span');
    expect(span?.classList.contains('arto-amount')).toBe(true);
  });

  it('menampilkan fallback bila nominal tidak valid (NaN)', () => {
    render(<AmountDisplay amount={NaN} />);
    expect(screen.getByText('Rp —')).not.toBeNull();
  });

  it('meneruskan className tambahan', () => {
    const { container } = render(<AmountDisplay amount={1000} className="custom" />);
    const span = container.querySelector('span');
    expect(span?.classList.contains('custom')).toBe(true);
    expect(span?.classList.contains('arto-amount')).toBe(true);
  });
});
