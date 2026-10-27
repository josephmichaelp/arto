// Domain murni sistem gerak (Req 17.2, 17.4, 17.5, 17.6, 17.11).

export type MotionKind = 'micro' | 'page' | 'sheet-open' | 'sheet-close';

export interface MotionSpec {
  kind: MotionKind;
  durationMs: number;
  easing: string;
  transform: boolean;
}

export const DURATION_BOUNDS: Record<MotionKind, { min: number; max: number }> = {
  micro: { min: 0, max: 250 },
  page: { min: 150, max: 400 },
  'sheet-open': { min: 0, max: 300 },
  'sheet-close': { min: 0, max: 300 },
};

/** Durasi paling lama pada Gerak_Berkurang. */
export const REDUCED_MAX_MS = 100;

export const EASE_STANDARD = 'cubic-bezier(0.2, 0, 0, 1)';
export const EASE_ENTER = 'cubic-bezier(0, 0, 0, 1)';
export const EASE_EXIT = 'cubic-bezier(0.3, 0, 1, 1)';

export const MOTION_TOKENS = {
  micro: { kind: 'micro', durationMs: 180, easing: EASE_STANDARD, transform: true },
  pageEnter: { kind: 'page', durationMs: 300, easing: EASE_ENTER, transform: true },
  pageExit: { kind: 'page', durationMs: 200, easing: EASE_EXIT, transform: true },
  sheetOpen: { kind: 'sheet-open', durationMs: 280, easing: EASE_ENTER, transform: true },
  sheetClose: { kind: 'sheet-close', durationMs: 220, easing: EASE_EXIT, transform: true },
} as const satisfies Record<string, MotionSpec>;

/**
 * Tanpa pengurangan: mengembalikan spesifikasi yang sama.
 * Gerak_Berkurang: tanpa transformasi dan durasi paling lama REDUCED_MAX_MS.
 */
export function resolveMotion(spec: MotionSpec, reduced: boolean): MotionSpec {
  if (!reduced) return spec;
  return {
    ...spec,
    transform: false,
    durationMs: Math.min(spec.durationMs, REDUCED_MAX_MS),
  };
}
