// @vitest-environment jsdom
/**
 * Uji Gerak_Berkurang (Task 20.6).
 *
 * Menggantikan skrip Playwright dengan uji Vitest jsdom karena Playwright
 * tidak terpasang di proyek ini. Mencakup:
 * 1. Perilaku `useReducedMotion` pada kedua skenario `prefers-reduced-motion`.
 * 2. Aturan CSS animation:none untuk `.arto-skeleton` di bawah `[data-motion='reduced']`.
 * 3. Atribut `data-motion="reduced"` pada elemen `.arto-sheet` di BottomSheet.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BottomSheet } from '../components/BottomSheet';
import { useReducedMotion } from './useReducedMotion';

// Baca CSS sebagai teks mentah untuk memverifikasi aturan gerak berkurang.
// Memakai fs.readFileSync karena import CSS dikosongkan di lingkungan uji.
const cssText = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../components/components.css'),
  'utf-8',
);

// ---------------------------------------------------------------------------
// Stub matchMedia — pola yang sama dengan useReducedMotion.test.tsx
// ---------------------------------------------------------------------------

type Listener = (event: MediaQueryListEvent) => void;

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
  } as unknown as MediaQueryList;

  window.matchMedia = vi.fn().mockReturnValue(mql);

  return {
    setMatches(next: boolean) {
      matches = next;
      listeners.forEach((listener) =>
        listener({ matches: next } as MediaQueryListEvent),
      );
    },
  };
}

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-motion');
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// 1. Perilaku useReducedMotion pada kedua skenario
// ---------------------------------------------------------------------------

function MotionProbe() {
  const reduced = useReducedMotion();
  return <span data-testid="probe">{String(reduced)}</span>;
}

describe('useReducedMotion — skenario reduce dan tidak-reduce', () => {
  it('mengembalikan false dan tidak menyetel data-motion saat prefers-reduced-motion tidak aktif', () => {
    installMatchMediaStub(false);

    const { getByTestId } = render(<MotionProbe />);

    expect(getByTestId('probe').textContent).toBe('false');
    expect(document.documentElement.getAttribute('data-motion')).toBeNull();
  });

  it('mengembalikan true dan menyetel data-motion="reduced" saat prefers-reduced-motion: reduce aktif', () => {
    installMatchMediaStub(true);

    const { getByTestId } = render(<MotionProbe />);

    expect(getByTestId('probe').textContent).toBe('true');
    expect(document.documentElement.getAttribute('data-motion')).toBe('reduced');
  });
});

// ---------------------------------------------------------------------------
// 2. Aturan CSS: animation:none untuk .arto-skeleton di bawah [data-motion='reduced']
// ---------------------------------------------------------------------------

describe('CSS komponen — Skeleton tidak beranimi saat data-motion="reduced"', () => {
  it('komponen.css mengandung selector [data-motion=\'reduced\'] .arto-skeleton', () => {
    expect(cssText).toContain("[data-motion='reduced'] .arto-skeleton");
  });

  it('blok CSS untuk [data-motion=\'reduced\'] .arto-skeleton menyetel animation: none', () => {
    const selectorMarker = "[data-motion='reduced'] .arto-skeleton";
    const selectorIdx = cssText.indexOf(selectorMarker);
    expect(selectorIdx).toBeGreaterThanOrEqual(0);

    // Ambil blok deklarasi { ... } pertama setelah selektor.
    const blockStart = cssText.indexOf('{', selectorIdx);
    const blockEnd = cssText.indexOf('}', blockStart);
    const block = cssText.slice(blockStart, blockEnd + 1);

    // Harus mengandung "animation: none" (dengan atau tanpa spasi di sekitar titik dua).
    expect(block).toMatch(/animation\s*:\s*none/);
  });
});

// ---------------------------------------------------------------------------
// 3. BottomSheet membawa data-motion="reduced" saat Gerak_Berkurang aktif
// ---------------------------------------------------------------------------

describe('BottomSheet — atribut data-motion', () => {
  it('memasang data-motion="reduced" pada .arto-sheet saat Gerak_Berkurang aktif', () => {
    installMatchMediaStub(true);

    const { container } = render(
      <BottomSheet open title="Tes" onClose={() => {}}>
        <p>Konten tes</p>
      </BottomSheet>,
    );

    const sheet = container.querySelector('.arto-sheet');
    expect(sheet).not.toBeNull();
    expect(sheet?.getAttribute('data-motion')).toBe('reduced');
  });

  it('tidak memasang data-motion pada .arto-sheet saat Gerak_Berkurang tidak aktif', () => {
    installMatchMediaStub(false);

    const { container } = render(
      <BottomSheet open title="Tes" onClose={() => {}}>
        <p>Konten tes</p>
      </BottomSheet>,
    );

    const sheet = container.querySelector('.arto-sheet');
    expect(sheet).not.toBeNull();
    expect(sheet?.getAttribute('data-motion')).toBeNull();
  });
});
