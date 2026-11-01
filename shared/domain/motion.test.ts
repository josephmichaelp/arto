import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DURATION_BOUNDS,
  EASE_ENTER,
  EASE_EXIT,
  EASE_STANDARD,
  MOTION_TOKENS,
  MotionKind,
  MotionSpec,
  REDUCED_MAX_MS,
  resolveMotion,
} from "./motion";

/** Arbitrary MotionKind. */
const motionKind: fc.Arbitrary<MotionKind> = fc.constantFrom(
  "micro",
  "page",
  "sheet-open",
  "sheet-close",
);

/** Arbitrary easing acak, termasuk nilai bawaan dan string sembarang. */
const easing = fc.oneof(
  fc.constantFrom(EASE_STANDARD, EASE_ENTER, EASE_EXIT),
  fc.string(),
);

/** Arbitrary MotionSpec dengan durasi dan transform sembarang. */
const motionSpec: fc.Arbitrary<MotionSpec> = fc.record({
  kind: motionKind,
  durationMs: fc.integer({ min: 0, max: 2000 }),
  easing,
  transform: fc.boolean(),
});

describe("resolveMotion - Property 32: Gerak_Berkurang menggantikan gerak dengan pudar atau instan", () => {
  /**
   * Validates: Requirements 17.11
   */
  it("properti: reduced=true menghasilkan transform=false dan durasi paling lama REDUCED_MAX_MS", () => {
    fc.assert(
      fc.property(motionSpec, (spec) => {
        const resolved = resolveMotion(spec, true);
        expect(resolved.transform).toBe(false);
        expect(resolved.durationMs).toBeLessThanOrEqual(REDUCED_MAX_MS);
        expect(resolved.durationMs).toBeGreaterThanOrEqual(0);
        expect(resolved.kind).toBe(spec.kind);
        expect(resolved.easing).toBe(spec.easing);
      }),
    );
  });

  /**
   * Validates: Requirements 17.11
   */
  it("properti: reduced=true tidak pernah menaikkan durasi di atas durasi asli", () => {
    fc.assert(
      fc.property(motionSpec, (spec) => {
        const resolved = resolveMotion(spec, true);
        expect(resolved.durationMs).toBeLessThanOrEqual(spec.durationMs);
      }),
    );
  });

  /**
   * Validates: Requirements 17.11
   */
  it("properti: reduced=false mengembalikan spesifikasi yang sama persis", () => {
    fc.assert(
      fc.property(motionSpec, (spec) => {
        expect(resolveMotion(spec, false)).toEqual(spec);
      }),
    );
  });

  it("contoh: spesifikasi lebih cepat dari REDUCED_MAX_MS tetap tanpa transform saat reduced", () => {
    const spec: MotionSpec = {
      kind: "micro",
      durationMs: 50,
      easing: EASE_STANDARD,
      transform: true,
    };
    const resolved = resolveMotion(spec, true);
    expect(resolved.durationMs).toBe(50);
    expect(resolved.transform).toBe(false);
  });

  it("contoh: spesifikasi lebih lambat dari REDUCED_MAX_MS dipotong ke REDUCED_MAX_MS", () => {
    const spec: MotionSpec = {
      kind: "page",
      durationMs: 300,
      easing: EASE_ENTER,
      transform: true,
    };
    const resolved = resolveMotion(spec, true);
    expect(resolved.durationMs).toBe(REDUCED_MAX_MS);
    expect(resolved.transform).toBe(false);
  });
});

describe("DURATION_BOUNDS - Property 31: Durasi gerak berada dalam batas kategori", () => {
  it("contoh: batas sesuai spesifikasi per kategori", () => {
    expect(DURATION_BOUNDS.micro).toEqual({ min: 0, max: 250 });
    expect(DURATION_BOUNDS.page).toEqual({ min: 150, max: 400 });
    expect(DURATION_BOUNDS["sheet-open"]).toEqual({ min: 0, max: 300 });
    expect(DURATION_BOUNDS["sheet-close"]).toEqual({ min: 0, max: 300 });
  });

  /**
   * Validates: Requirements 17.2, 17.4, 17.5, 17.6
   */
  it("properti: setiap kategori memiliki min <= max dan min >= 0", () => {
    fc.assert(
      fc.property(motionKind, (kind) => {
        const bounds = DURATION_BOUNDS[kind];
        expect(bounds.min).toBeGreaterThanOrEqual(0);
        expect(bounds.max).toBeGreaterThanOrEqual(bounds.min);
      }),
    );
  });

  /**
   * Validates: Requirements 17.2, 17.4, 17.5, 17.6
   */
  it("properti: durasi semua token gerak bawaan berada dalam batas kategorinya", () => {
    fc.assert(
      fc.property(fc.constantFrom(...Object.values(MOTION_TOKENS)), (spec) => {
        const bounds = DURATION_BOUNDS[spec.kind];
        expect(spec.durationMs).toBeGreaterThanOrEqual(bounds.min);
        expect(spec.durationMs).toBeLessThanOrEqual(bounds.max);
      }),
    );
  });

  /**
   * Validates: Requirements 17.2, 17.4, 17.5, 17.6
   */
  it("properti: transisi halaman berada pada 150 sampai 400 ms", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(MOTION_TOKENS.pageEnter, MOTION_TOKENS.pageExit),
        (spec) => {
          expect(spec.durationMs).toBeGreaterThanOrEqual(150);
          expect(spec.durationMs).toBeLessThanOrEqual(400);
        },
      ),
    );
  });

  /**
   * Validates: Requirements 17.2, 17.4, 17.5, 17.6
   */
  it("properti: umpan balik mikro paling lama 250 ms", () => {
    expect(MOTION_TOKENS.micro.durationMs).toBeLessThanOrEqual(250);
  });

  /**
   * Validates: Requirements 17.2, 17.4, 17.5, 17.6
   */
  it("properti: buka dan tutup Lembar_Bawah paling lama 300 ms", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(MOTION_TOKENS.sheetOpen, MOTION_TOKENS.sheetClose),
        (spec) => {
          expect(spec.durationMs).toBeLessThanOrEqual(300);
        },
      ),
    );
  });
});
