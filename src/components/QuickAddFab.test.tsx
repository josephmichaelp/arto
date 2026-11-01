// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuickAddFab } from './QuickAddFab';

afterEach(cleanup);

describe('QuickAddFab', () => {
  it('merender tombol dengan label aksesibilitas bawaan', () => {
    render(<QuickAddFab onActivate={() => {}} />);
    const fab = screen.getByRole('button', { name: 'Tambah transaksi' });
    expect(fab.classList.contains('arto-fab')).toBe(true);
    expect(fab.getAttribute('type')).toBe('button');
  });

  it('memakai label kustom bila diberikan', () => {
    render(<QuickAddFab onActivate={() => {}} label="Tambah cepat" />);
    expect(screen.getByRole('button', { name: 'Tambah cepat' })).not.toBeNull();
  });

  it('memanggil onActivate saat ditekan', () => {
    const onActivate = vi.fn();
    render(<QuickAddFab onActivate={onActivate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tambah transaksi' }));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('tidak dirender saat Lembar_Bawah terbuka', () => {
    render(<QuickAddFab onActivate={() => {}} sheetOpen />);
    expect(screen.queryByRole('button', { name: 'Tambah transaksi' })).toBeNull();
  });

  it('menyembunyikan ikon dari pembaca layar', () => {
    const { container } = render(<QuickAddFab onActivate={() => {}} />);
    const icon = container.querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('memanggil prefetch saat idle setelah mount', () => {
    const prefetch = vi.fn();
    const win = window as unknown as Record<string, unknown>;
    const originalRic = win.requestIdleCallback;
    // Paksa jalur fallback setTimeout agar deterministik di jsdom.
    delete win.requestIdleCallback;
    vi.useFakeTimers();
    render(<QuickAddFab onActivate={() => {}} prefetch={prefetch} />);
    vi.advanceTimersByTime(250);
    expect(prefetch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    win.requestIdleCallback = originalRic;
  });
});
