// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

afterEach(cleanup);

// Komponen yang selalu throw untuk keperluan uji
function Bomb({ shouldExplode }: { shouldExplode: boolean }) {
  if (shouldExplode) throw new Error('Ledakan uji');
  return <p>Konten normal</p>;
}

describe('ErrorBoundary', () => {
  it('merender children bila tidak ada galat', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldExplode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Konten normal')).not.toBeNull();
  });

  it('menampilkan fallback berbahasa Indonesia saat galat tertangkap', () => {
    // Suppress console.error dari React
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb shouldExplode={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Terjadi kesalahan')).not.toBeNull();
    expect(screen.getByText(/Maaf, bagian ini tidak dapat dimuat/)).not.toBeNull();
    spy.mockRestore();
  });

  it('menampilkan tombol "Coba lagi" pada fallback bawaan', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb shouldExplode={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: 'Coba lagi' })).not.toBeNull();
    spy.mockRestore();
  });

  it('me-reset state boundary saat tombol Coba lagi diklik', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <ErrorBoundary>
        <Bomb shouldExplode={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Terjadi kesalahan')).not.toBeNull();

    // Perbarui children menjadi aman SEBELUM reset, agar setelah reset
    // children tidak langsung melempar galat lagi.
    rerender(
      <ErrorBoundary>
        <Bomb shouldExplode={false} />
      </ErrorBoundary>,
    );

    // Klik Coba lagi — boundary di-reset, children sekarang aman
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));

    expect(screen.getByText('Konten normal')).not.toBeNull();
    spy.mockRestore();
  });

  it('menampilkan fallback kustom bila disuplai', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={<p>Fallback kustom</p>}>
        <Bomb shouldExplode={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Fallback kustom')).not.toBeNull();
    spy.mockRestore();
  });

  it('memanggil fallback function dengan error dan reset bila disuplai', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary
        fallback={(err, reset) => (
          <button type="button" onClick={reset}>
            Galat: {err.message}
          </button>
        )}
      >
        <Bomb shouldExplode={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: 'Galat: Ledakan uji' })).not.toBeNull();
    spy.mockRestore();
  });

  it('memakai role alert untuk pengumuman pembaca layar', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb shouldExplode={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).not.toBeNull();
    spy.mockRestore();
  });
});
