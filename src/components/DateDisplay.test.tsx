// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DateDisplay } from './DateDisplay';

afterEach(cleanup);

describe('DateDisplay', () => {
  it('memformat tanggal ke bahasa Indonesia', () => {
    render(<DateDisplay date="2025-08-17" />);
    expect(screen.getByText('17 Agustus 2025')).not.toBeNull();
  });

  it('menggunakan elemen <time> dengan atribut dateTime', () => {
    const { container } = render(<DateDisplay date="2025-01-01" />);
    const time = container.querySelector('time');
    expect(time).not.toBeNull();
    expect(time?.getAttribute('dateTime')).toBe('2025-01-01');
  });

  it('menampilkan bulan pertama dengan benar', () => {
    render(<DateDisplay date="2025-01-31" />);
    expect(screen.getByText('31 Januari 2025')).not.toBeNull();
  });

  it('menampilkan fallback untuk format tidak valid', () => {
    render(<DateDisplay date="tidak-valid" />);
    expect(screen.getByText('Tanggal tidak valid')).not.toBeNull();
  });

  it('menampilkan fallback kustom', () => {
    render(<DateDisplay date="invalid" fallback="—" />);
    expect(screen.getByText('—')).not.toBeNull();
  });

  it('meneruskan className tambahan', () => {
    const { container } = render(<DateDisplay date="2025-06-15" className="my-date" />);
    const time = container.querySelector('time');
    expect(time?.classList.contains('my-date')).toBe(true);
    expect(time?.classList.contains('arto-date')).toBe(true);
  });
});
