// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { navigateWithTransition } from './navigateWithTransition';

describe('navigateWithTransition', () => {
  it('memanggil go() langsung bila startViewTransition tidak tersedia', () => {
    const go = vi.fn();
    expect('startViewTransition' in document).toBe(false);

    navigateWithTransition(go, false);

    expect(go).toHaveBeenCalledTimes(1);
  });

  it('memanggil go() langsung saat Gerak_Berkurang aktif, meski startViewTransition tersedia', () => {
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

  it('memakai startViewTransition dan menjalankan go() di dalam callback saat tersedia dan gerak tidak dikurangi', () => {
    const go = vi.fn();
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
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
