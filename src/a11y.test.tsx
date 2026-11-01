// @vitest-environment jsdom
/**
 * Uji aksesibilitas dan tata letak (Tugas 12.16).
 *
 * Memeriksa ARIA semantik kunci dengan axe-core + @testing-library/react:
 * 1. Navigasi bawah AuthenticatedLayout memiliki role="navigation" dan aria-label.
 * 2. Bar progres anggaran memiliki role="progressbar" dengan aria-valuenow/min/max.
 * 3. EmptyState memiliki role="status".
 * 4. Pesan galat memiliki role="alert".
 * 5. Elemen interaktif memakai token --hit untuk target sentuh 44 px.
 *
 * Aturan axe yang dinonaktifkan di jsdom:
 * - color-contrast  : membutuhkan computed styles yang tidak tersedia di jsdom.
 * - scrollable-region-focusable: tidak relevan dengan layout pengujian.
 *
 * _Requirements: 15.4, 15.7, 17.1, 17.8, 17.12_
 */
import axe from 'axe-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthenticatedLayout } from './AuthenticatedLayout';
import { EmptyState } from './components/EmptyState';
import { ErrorBoundary } from './components/ErrorBoundary';

// ---------------------------------------------------------------------------
// Mock: @aws-amplify/ui-react (useAuthenticator)
// AuthenticatedLayout menggunakan hook ini untuk mendapatkan user dan signOut.
// ---------------------------------------------------------------------------
vi.mock('@aws-amplify/ui-react', () => ({
  useAuthenticator: () => ({
    user: { signInDetails: { loginId: 'test@example.com' } },
    signOut: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Berkas sumber dibaca sebagai teks untuk validasi token --hit di inline style
// ---------------------------------------------------------------------------
const componentsCss = readFileSync(
  resolve(process.cwd(), 'src/components/components.css'),
  'utf8',
);
const tokensCss = readFileSync(
  resolve(process.cwd(), 'src/theme/tokens.css'),
  'utf8',
);
const layoutSrc = readFileSync(
  resolve(process.cwd(), 'src/AuthenticatedLayout.tsx'),
  'utf8',
);

// ---------------------------------------------------------------------------
// Konfigurasi axe: nonaktifkan aturan yang tidak berjalan di jsdom
// ---------------------------------------------------------------------------
const AXE_OPTIONS = {
  rules: {
    'color-contrast': { enabled: false },
    'scrollable-region-focusable': { enabled: false },
  },
};

afterEach(cleanup);

// ===========================================================================
// 1. AuthenticatedLayout — navigasi bawah
// ===========================================================================
describe('AuthenticatedLayout – navigasi bawah', () => {
  it('memiliki role="navigation" (elemen <nav>) dengan aria-label "Navigasi utama"', () => {
    render(
      <MemoryRouter>
        <AuthenticatedLayout />
      </MemoryRouter>,
    );
    // GlassBar bawah di-render sebagai <nav aria-label="Navigasi utama">
    const nav = screen.getByRole('navigation', { name: 'Navigasi utama' });
    expect(nav).not.toBeNull();
  });

  it('setiap tab navigasi memiliki aria-label yang deskriptif', () => {
    render(
      <MemoryRouter>
        <AuthenticatedLayout />
      </MemoryRouter>,
    );
    const expectedLabels = ['Beranda', 'Transaksi', 'Laporan', 'Notifikasi', 'Pengaturan'];
    for (const label of expectedLabels) {
      expect(
        screen.getByRole('button', { name: label }),
        `Tombol tab "${label}" tidak ditemukan`,
      ).not.toBeNull();
    }
  });

  it('tab aktif memiliki aria-current="page"', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthenticatedLayout />
      </MemoryRouter>,
    );
    const berandaBtn = screen.getByRole('button', { name: 'Beranda' });
    expect(berandaBtn.getAttribute('aria-current')).toBe('page');
  });

  it('lolos pemeriksaan axe pada elemen navigasi bawah', async () => {
    render(
      <MemoryRouter>
        <AuthenticatedLayout />
      </MemoryRouter>,
    );
    // Jalankan axe hanya pada <nav> agar tidak terpengaruh elemen lain
    const nav = screen.getByRole('navigation', { name: 'Navigasi utama' });
    const results = await axe.run(nav, AXE_OPTIONS);
    expect(results.violations).toHaveLength(0);
  });
});

// ===========================================================================
// 2. Bar progres anggaran — role="progressbar"
// ===========================================================================
describe('Bar progres anggaran', () => {
  /**
   * Komponen miniatur yang mencerminkan pola yang dipakai di BudgetCard,
   * GoalsPage, dan HomePage.
   */
  function ProgressBar({ value, label }: { value: number; label: string }) {
    return (
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        style={{ width: '100%', height: 8, background: '#eee', borderRadius: 4 }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.min(value, 100)}%`,
            background: '#005DAC',
          }}
        />
      </div>
    );
  }

  it('memiliki aria-valuenow, aria-valuemin, dan aria-valuemax', () => {
    render(<ProgressBar value={60} label="Realisasi anggaran Makan: 60%" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('60');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
  });

  it('memiliki aria-label yang deskriptif', () => {
    render(<ProgressBar value={60} label="Realisasi anggaran Makan: 60%" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-label')).toBe('Realisasi anggaran Makan: 60%');
  });

  it('lolos pemeriksaan axe', async () => {
    const { container } = render(
      <ProgressBar value={75} label="Progres tabungan 75%" />,
    );
    const results = await axe.run(container, AXE_OPTIONS);
    expect(results.violations).toHaveLength(0);
  });
});

// ===========================================================================
// 3. EmptyState — role="status"
// ===========================================================================
describe('EmptyState – role="status"', () => {
  it('memiliki role="status" untuk pengumuman pembaca layar', () => {
    render(<EmptyState title="Belum ada data" />);
    const el = screen.getByRole('status');
    expect(el).not.toBeNull();
  });

  it('memiliki aria-live="polite"', () => {
    render(<EmptyState title="Belum ada data" />);
    const el = screen.getByRole('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
  });

  it('lolos pemeriksaan axe', async () => {
    const { container } = render(
      <EmptyState
        title="Belum ada transaksi"
        description="Mulai tambah transaksi untuk melihat data"
      />,
    );
    const results = await axe.run(container, AXE_OPTIONS);
    expect(results.violations).toHaveLength(0);
  });
});

// ===========================================================================
// 4. Pesan galat — role="alert"
// ===========================================================================
describe('Pesan galat – role="alert"', () => {
  /** Komponen yang melempar galat untuk memicu ErrorBoundary. */
  function ThrowOnMount(): never {
    throw new Error('Galat uji aksesibilitas');
  }

  it('ErrorBoundary menampilkan role="alert" saat terjadi galat', () => {
    // Sembunyikan console.error React agar output uji bersih
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowOnMount />
      </ErrorBoundary>,
    );
    spy.mockRestore();

    const alertEl = screen.getByRole('alert');
    expect(alertEl).not.toBeNull();
  });

  it('elemen role="alert" juga memiliki aria-live="assertive"', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowOnMount />
      </ErrorBoundary>,
    );
    spy.mockRestore();

    const alertEl = screen.getByRole('alert');
    expect(alertEl.getAttribute('aria-live')).toBe('assertive');
  });

  it('lolos pemeriksaan axe pada fallback galat ErrorBoundary', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <ErrorBoundary>
        <ThrowOnMount />
      </ErrorBoundary>,
    );
    spy.mockRestore();

    const results = await axe.run(container, AXE_OPTIONS);
    expect(results.violations).toHaveLength(0);
  });
});

// ===========================================================================
// 5. Target sentuh 44 px — token --hit
// ===========================================================================
describe('Target sentuh 44 px – token CSS --hit', () => {
  it('token --hit: 44px didefinisikan di src/theme/tokens.css', () => {
    expect(tokensCss).toMatch(/--hit:\s*44px/);
  });

  it('tombol Tutup BottomSheet memakai var(--hit) untuk min-width di components.css', () => {
    expect(componentsCss).toMatch(/\.arto-sheet__close[^}]*min-width:\s*var\(--hit/);
  });

  it('tombol Tutup BottomSheet memakai var(--hit) untuk min-height di components.css', () => {
    expect(componentsCss).toMatch(/\.arto-sheet__close[^}]*min-height:\s*var\(--hit/);
  });

  it('QuickAddFab memakai var(--hit) untuk min-width di components.css', () => {
    expect(componentsCss).toMatch(/\.arto-fab[^}]*min-width:\s*var\(--hit/);
  });

  it('QuickAddFab memakai var(--hit) untuk min-height di components.css', () => {
    expect(componentsCss).toMatch(/\.arto-fab[^}]*min-height:\s*var\(--hit/);
  });

  it('tab navigasi AuthenticatedLayout memakai var(--hit, 44px) untuk minHeight di inline style', () => {
    // NavTabButton: minHeight: 'var(--hit, 44px)'
    expect(layoutSrc).toMatch(/minHeight:\s*['"]var\(--hit/);
  });

  it('tab navigasi AuthenticatedLayout memakai var(--hit, 44px) untuk minWidth di inline style', () => {
    // NavTabButton: minWidth: 'var(--hit, 44px)'
    expect(layoutSrc).toMatch(/minWidth:\s*['"]var\(--hit/);
  });
});
