// @vitest-environment jsdom
/**
 * Uji komponen lengkap (Task 20.5).
 *
 * Melengkapi uji smoke pada `components.test.tsx`, `BottomSheet.test.tsx`, dan
 * `QuickAddFab.test.tsx` dengan cakupan yang diminta tugas:
 *  - Lembar_Bawah menutup lewat scrim, tombol Tutup, `Escape`, dan geser
 *    melewati ambang; fokus kembali ke pemicu (Req 17.4).
 *  - `QuickAddFab` tampil hanya pada tiga halaman (Beranda, Transaksi, Laporan)
 *    dan menjaga target sentuh >= 44 px (Req 17.1, 15.4).
 *  - `Skeleton` mengumumkan keadaan memuat lewat `role="status"` (Req 17.10).
 *  - `SoftCard` berradius >= 16 px (Req 17.9).
 *  - `global.css` memuat blok `@supports` fallback `.glass` (Req 17.12).
 *  - `navigateWithTransition` memanggil `go()` langsung bila API tidak tersedia
 *    (Req 17.5).
 *  - Perilaku Gerak_Berkurang pada Lembar_Bawah dan Judul_Besar (Req 17.11).
 *
 * _Requirements: 17.1, 17.4, 17.5, 17.9, 17.10, 17.12_
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BottomSheet } from './BottomSheet';
import { QuickAddFab } from './QuickAddFab';
import { Skeleton } from './Skeleton';
import { SoftCard } from './SoftCard';
import { GlassBar } from './GlassBar';
import { LargeTitle } from './LargeTitle';
import { navigateWithTransition } from '../motion/navigateWithTransition';

// --- Berkas CSS dibaca mentah untuk pernyataan non-layout -------------------
// Vitest berjalan dari akar workspace, jadi jalur dibuat relatif terhadapnya.
const globalCss = readFileSync(resolve(process.cwd(), 'src/theme/global.css'), 'utf8');
const tokensCss = readFileSync(resolve(process.cwd(), 'src/theme/tokens.css'), 'utf8');
const componentsCss = readFileSync(
  resolve(process.cwd(), 'src/components/components.css'),
  'utf8',
);

type Listener = (event: MediaQueryListEvent) => void;

/** Pasang `matchMedia` palsu untuk mengendalikan Gerak_Berkurang di jsdom. */
function installMatchMediaStub(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<Listener>();
  const mql = {
    get matches() {
      return matches;
    },
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_: 'change', listener: Listener) => listeners.add(listener),
    removeEventListener: (_: 'change', listener: Listener) => listeners.delete(listener),
    addListener: (listener: Listener) => listeners.add(listener),
    removeListener: (listener: Listener) => listeners.delete(listener),
  } as unknown as MediaQueryList;
  window.matchMedia = vi.fn().mockReturnValue(mql);
  return {
    setMatches(next: boolean) {
      matches = next;
      listeners.forEach((l) => l({ matches: next } as MediaQueryListEvent));
    },
  };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-motion');
  // @ts-expect-error - bersihkan stub agar tidak bocor antar uji.
  delete window.matchMedia;
});

// ---------------------------------------------------------------------------
// BottomSheet / Lembar_Bawah
// ---------------------------------------------------------------------------
describe('BottomSheet - aksesibilitas dan cara menutup (Req 17.3, 17.4)', () => {
  function renderSheet(
    props: Partial<Parameters<typeof BottomSheet>[0]> = {},
  ) {
    const onClose = vi.fn();
    const utils = render(
      <BottomSheet open title="Tambah Transaksi" onClose={onClose} {...props}>
        <button type="button">Simpan</button>
      </BottomSheet>,
    );
    return { onClose, ...utils };
  }

  it('merender dialog modal berlabel judul', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)?.textContent).toBe(
      'Tambah Transaksi',
    );
  });

  it('menutup lewat scrim', () => {
    const { onClose, container } = renderSheet();
    fireEvent.click(container.querySelector('.arto-sheet-scrim') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('menutup lewat tombol Tutup', () => {
    const { onClose } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('memakai label Tutup kustom', () => {
    renderSheet({ closeLabel: 'Batal' });
    expect(screen.getByRole('button', { name: 'Batal' })).not.toBeNull();
  });

  it('menutup lewat Escape', () => {
    const { onClose } = renderSheet();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('menutup saat geser melewati ambang', () => {
    const { onClose, container } = renderSheet();
    const handle = container.querySelector('.arto-sheet__handle-area') as HTMLElement;
    const sheet = container.querySelector('.arto-sheet') as HTMLElement;
    Object.defineProperty(sheet, 'offsetHeight', { value: 400, configurable: true });

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 0, timeStamp: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 300, timeStamp: 100 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 300, timeStamp: 100 });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tidak menutup saat geser kecil di bawah ambang', () => {
    const { onClose, container } = renderSheet();
    const handle = container.querySelector('.arto-sheet__handle-area') as HTMLElement;
    const sheet = container.querySelector('.arto-sheet') as HTMLElement;
    Object.defineProperty(sheet, 'offsetHeight', { value: 400, configurable: true });

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 0, timeStamp: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 20, timeStamp: 400 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 20, timeStamp: 400 });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('mengunci fokus ke dalam lembar lalu mengembalikannya ke pemicu', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Buka';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <BottomSheet open title="Tambah" onClose={() => {}}>
        <button type="button">Simpan</button>
      </BottomSheet>,
    );
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(document.activeElement).not.toBe(trigger);

    rerender(
      <BottomSheet open={false} title="Tambah" onClose={() => {}}>
        <button type="button">Simpan</button>
      </BottomSheet>,
    );
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('menandai saudara di luar lembar sebagai inert', () => {
    const sibling = document.createElement('div');
    document.body.appendChild(sibling);
    renderSheet();
    expect(sibling.hasAttribute('inert')).toBe(true);
    sibling.remove();
  });

  it('tombol Tutup menjaga target sentuh minimal 44 px lewat token --hit', () => {
    expect(componentsCss).toMatch(/\.arto-sheet__close[^}]*min-width:\s*var\(--hit/);
    expect(componentsCss).toMatch(/\.arto-sheet__close[^}]*min-height:\s*var\(--hit/);
    expect(tokensCss).toMatch(/--hit:\s*44px/);
  });
});

describe('BottomSheet - Gerak_Berkurang (Req 17.11)', () => {
  it('menandai lembar dengan data-motion="reduced" saat preferensi aktif', () => {
    installMatchMediaStub(true);
    const { container } = render(
      <BottomSheet open title="Tambah" onClose={() => {}}>
        <button type="button">Simpan</button>
      </BottomSheet>,
    );
    const sheet = container.querySelector('.arto-sheet') as HTMLElement;
    expect(sheet.getAttribute('data-motion')).toBe('reduced');
  });

  it('tidak menandai data-motion saat preferensi tidak aktif', () => {
    installMatchMediaStub(false);
    const { container } = render(
      <BottomSheet open title="Tambah" onClose={() => {}}>
        <button type="button">Simpan</button>
      </BottomSheet>,
    );
    const sheet = container.querySelector('.arto-sheet') as HTMLElement;
    expect(sheet.getAttribute('data-motion')).toBeNull();
  });

  it('CSS memetakan Gerak_Berkurang ke pudar tanpa transform pada lembar', () => {
    expect(componentsCss).toMatch(
      /\[data-motion='reduced'\] \.arto-sheet[^{]*\{[^}]*transform:\s*none/,
    );
  });
});

// ---------------------------------------------------------------------------
// QuickAddFab / Aksi_Cepat_Tambah
// ---------------------------------------------------------------------------
describe('QuickAddFab - visibilitas per halaman (Req 17.1)', () => {
  // Kontrak pemakaian: FAB hanya dirender pada Beranda, Transaksi, dan Laporan.
  const FAB_ROUTES = ['/', '/transaksi', '/laporan'];
  function FabForRoute({ path, sheetOpen }: { path: string; sheetOpen?: boolean }) {
    if (!FAB_ROUTES.includes(path)) return null;
    return <QuickAddFab onActivate={() => {}} sheetOpen={sheetOpen} />;
  }

  it.each(FAB_ROUTES)('tampil pada halaman %s', (path) => {
    render(<FabForRoute path={path} />);
    expect(screen.getByRole('button', { name: 'Tambah transaksi' })).not.toBeNull();
  });

  it.each(['/anggaran', '/asisten', '/wawasan', '/notifikasi', '/dompet'])(
    'tidak tampil pada halaman %s',
    (path) => {
      render(<FabForRoute path={path} />);
      expect(screen.queryByRole('button', { name: 'Tambah transaksi' })).toBeNull();
    },
  );

  it('disembunyikan saat Lembar_Bawah terbuka meski di halaman yang diizinkan', () => {
    render(<FabForRoute path="/" sheetOpen />);
    expect(screen.queryByRole('button', { name: 'Tambah transaksi' })).toBeNull();
  });

  it('memicu onActivate saat ditekan', () => {
    const onActivate = vi.fn();
    render(<QuickAddFab onActivate={onActivate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tambah transaksi' }));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('ikon disembunyikan dari pembaca layar karena label tombol sudah jelas', () => {
    const { container } = render(<QuickAddFab onActivate={() => {}} />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('CSS menjaga ukuran 56 px dan target sentuh minimal 44 px', () => {
    expect(componentsCss).toMatch(/\.arto-fab\s*\{[^}]*width:\s*56px/);
    expect(componentsCss).toMatch(/\.arto-fab\s*\{[^}]*min-width:\s*var\(--hit/);
    expect(componentsCss).toMatch(/\.arto-fab\s*\{[^}]*min-height:\s*var\(--hit/);
  });
});

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------
describe('Skeleton - status memuat (Req 17.10)', () => {
  it('mengumumkan keadaan memuat lewat role="status" dan teks tersembunyi', () => {
    render(<Skeleton lines={3} />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('Memuat data')).not.toBeNull();
    expect(status.querySelectorAll('.arto-skeleton').length).toBe(3);
  });

  it('memakai label kustom untuk pembaca layar', () => {
    render(<Skeleton label="Memuat transaksi" />);
    expect(screen.getByText('Memuat transaksi')).not.toBeNull();
  });

  it('menerapkan radius final lewat inline style (menyamai kartu)', () => {
    const { container } = render(<Skeleton radius={20} />);
    const bar = container.querySelector('.arto-skeleton') as HTMLElement;
    expect(bar.style.borderRadius).toBe('20px');
  });

  it('CSS menghentikan kilau pada Gerak_Berkurang', () => {
    expect(componentsCss).toMatch(
      /\[data-motion='reduced'\] \.arto-skeleton\s*\{[^}]*animation:\s*none/,
    );
  });
});

// ---------------------------------------------------------------------------
// SoftCard
// ---------------------------------------------------------------------------
describe('SoftCard - radius dan elemen (Req 17.9)', () => {
  it('memakai kelas Kartu_Lembut', () => {
    const { container } = render(<SoftCard>Isi</SoftCard>);
    const card = container.querySelector('div');
    expect(card?.classList.contains('soft-card')).toBe(true);
    expect(card?.classList.contains('arto-soft-card')).toBe(true);
  });

  it('dapat dirender sebagai elemen lain lewat prop `as`', () => {
    const { container } = render(<SoftCard as="section">Isi</SoftCard>);
    expect(container.querySelector('section')?.classList.contains('soft-card')).toBe(true);
  });

  it('menghilangkan padding bawaan saat noPadding', () => {
    const { container } = render(<SoftCard noPadding>Isi</SoftCard>);
    const card = container.querySelector('div');
    expect(card?.classList.contains('arto-soft-card')).toBe(false);
    expect(card?.classList.contains('soft-card')).toBe(true);
  });

  it('token --radius-card bernilai >= 16 px', () => {
    const match = tokensCss.match(/--radius-card:\s*(\d+)px/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(16);
  });

  it('`.soft-card` di global.css mengambil radius dari token', () => {
    expect(globalCss).toMatch(/\.soft-card\s*\{[^}]*border-radius:\s*var\(--radius-card/);
  });
});

// ---------------------------------------------------------------------------
// GlassBar + fallback Permukaan_Kaca
// ---------------------------------------------------------------------------
describe('GlassBar - Permukaan_Kaca dan fallback (Req 17.8, 17.12)', () => {
  it('merender header di atas dengan kelas .glass secara default', () => {
    const { container } = render(<GlassBar>Beranda</GlassBar>);
    const bar = container.querySelector('header');
    expect(bar?.classList.contains('glass')).toBe(true);
    expect(bar?.classList.contains('arto-glass-bar--top')).toBe(true);
  });

  it('merender nav untuk bilah bawah dan meneruskan atribut aria', () => {
    const { container } = render(
      <GlassBar position="bottom" aria-label="Navigasi utama">
        Nav
      </GlassBar>,
    );
    const bar = container.querySelector('nav');
    expect(bar?.classList.contains('arto-glass-bar--bottom')).toBe(true);
    expect(bar?.getAttribute('aria-label')).toBe('Navigasi utama');
  });

  it('global.css menyediakan fallback solid lalu @supports backdrop-filter untuk .glass', () => {
    // Fallback solid lebih dulu (aman tanpa dukungan blur).
    expect(globalCss).toMatch(/\.glass\s*\{[^}]*background:\s*rgba\(255, 255, 255, var\(--glass-alphaFallback/);
    // Peningkatan lewat @supports bila backdrop-filter tersedia.
    expect(globalCss).toContain('@supports');
    expect(globalCss).toMatch(/@supports[^{]*backdrop-filter/);
    expect(globalCss).toMatch(/-webkit-backdrop-filter/);
  });
});

// ---------------------------------------------------------------------------
// LargeTitle
// ---------------------------------------------------------------------------
describe('LargeTitle - judul besar dan ringkas (Req 17.7)', () => {
  it('menampilkan Judul_Besar dan judul ringkas', () => {
    render(<LargeTitle title="Halo, Budi" compact="Beranda" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Halo, Budi');
    expect(screen.getByText('Beranda')).not.toBeNull();
  });

  it('memperbarui progres mengecil saat jendela digulir', () => {
    const { container } = render(<LargeTitle title="Halo, Budi" />);
    const header = container.querySelector('.arto-large-title') as HTMLElement;
    expect(header.getAttribute('data-progress')).toBe('0.00');

    Object.defineProperty(window, 'scrollY', { value: 56, configurable: true });
    act(() => {
      fireEvent.scroll(window);
    });
    // clamp(56 / 56, 0, 1) === 1
    expect(header.getAttribute('data-progress')).toBe('1.00');
  });

  it('beralih instan (p = 0 atau 1) pada Gerak_Berkurang', () => {
    installMatchMediaStub(true);
    const { container } = render(<LargeTitle title="Halo, Budi" />);
    const header = container.querySelector('.arto-large-title') as HTMLElement;

    // Gulir separuh ambang; pada Gerak_Berkurang dibulatkan ke 0 (p < 0.5).
    Object.defineProperty(window, 'scrollY', { value: 20, configurable: true });
    act(() => {
      fireEvent.scroll(window);
    });
    expect(header.getAttribute('data-progress')).toBe('0.00');

    // Gulir melewati setengah ambang; dibulatkan instan ke 1.
    Object.defineProperty(window, 'scrollY', { value: 40, configurable: true });
    act(() => {
      fireEvent.scroll(window);
    });
    expect(header.getAttribute('data-progress')).toBe('1.00');
  });
});

// ---------------------------------------------------------------------------
// navigateWithTransition
// ---------------------------------------------------------------------------
describe('navigateWithTransition - fallback (Req 17.5)', () => {
  it('memanggil go() langsung bila startViewTransition tidak tersedia', () => {
    const go = vi.fn();
    expect('startViewTransition' in document).toBe(false);
    navigateWithTransition(go, false);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('memanggil go() langsung saat Gerak_Berkurang aktif', () => {
    const go = vi.fn();
    const startViewTransition = vi.fn();
    Object.defineProperty(document, 'startViewTransition', {
      value: startViewTransition,
      configurable: true,
    });
    try {
      navigateWithTransition(go, true);
      expect(go).toHaveBeenCalledTimes(1);
      expect(startViewTransition).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(document, 'startViewTransition');
    }
  });

  it('memakai startViewTransition saat tersedia dan gerak tidak dikurangi', () => {
    const go = vi.fn();
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, 'startViewTransition', {
      value: startViewTransition,
      configurable: true,
    });
    try {
      navigateWithTransition(go, false);
      expect(startViewTransition).toHaveBeenCalledTimes(1);
      expect(go).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(document, 'startViewTransition');
    }
  });
});
