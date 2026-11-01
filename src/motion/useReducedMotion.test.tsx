// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useReducedMotion, useResolvedMotion } from './useReducedMotion';
import { MOTION_TOKENS } from '../../shared/domain/motion';

type Listener = (event: MediaQueryListEvent) => void;

/** Palsu `matchMedia` minimal yang cukup untuk hook ini. */
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
      listeners.forEach((listener) => listener({ matches: next } as MediaQueryListEvent));
    },
  };
}

function Probe() {
  const reduced = useReducedMotion();
  return <span data-testid="probe">{String(reduced)}</span>;
}

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-motion');
});

describe('useReducedMotion', () => {

  it('mengembalikan false dan tidak memasang data-motion saat preferensi sistem tidak aktif', () => {
    installMatchMediaStub(false);

    const { getByTestId } = render(<Probe />);

    expect(getByTestId('probe').textContent).toBe('false');
    expect(document.documentElement.getAttribute('data-motion')).toBeNull();
  });

  it('mengembalikan true dan memasang data-motion="reduced" saat preferensi sistem aktif', () => {
    installMatchMediaStub(true);

    const { getByTestId } = render(<Probe />);

    expect(getByTestId('probe').textContent).toBe('true');
    expect(document.documentElement.getAttribute('data-motion')).toBe('reduced');
  });

  it('memperbarui atribut data-motion saat preferensi sistem berubah', () => {
    const stub = installMatchMediaStub(false);
    const { getByTestId } = render(<Probe />);

    expect(getByTestId('probe').textContent).toBe('false');

    act(() => {
      stub.setMatches(true);
    });

    expect(getByTestId('probe').textContent).toBe('true');
    expect(document.documentElement.getAttribute('data-motion')).toBe('reduced');
  });
});

describe('useResolvedMotion', () => {
  function SpecProbe() {
    const spec = useResolvedMotion(MOTION_TOKENS.pageEnter);
    return (
      <span data-testid="spec">
        {spec.durationMs}:{String(spec.transform)}
      </span>
    );
  }

  it('mengembalikan spesifikasi asli saat Gerak_Berkurang tidak aktif', () => {
    installMatchMediaStub(false);
    const { getByTestId } = render(<SpecProbe />);
    expect(getByTestId('spec').textContent).toBe('300:true');
  });

  it('memangkas durasi dan menonaktifkan transform saat Gerak_Berkurang aktif', () => {
    installMatchMediaStub(true);
    const { getByTestId } = render(<SpecProbe />);
    expect(getByTestId('spec').textContent).toBe('100:false');
  });
});
