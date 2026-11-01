import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DISMISS_RATIO, DISMISS_VELOCITY, shouldDismissSheet } from "./sheet";

/** Arbitrary tinggi lembar positif yang wajar (px). */
const sheetHeightArb = fc.double({
  min: 1,
  max: 4000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Arbitrary kecepatan geser (px/ms), termasuk negatif (ke atas). */
const velocityArb = fc.double({
  min: -10,
  max: 10,
  noNaN: true,
  noDefaultInfinity: true,
});

describe("shouldDismissSheet - Property 34: Keputusan menutup Lembar_Bawah", () => {
  it("contoh: geser ke bawah melewati rasio menutup lembar", () => {
    expect(shouldDismissSheet(200, 400, 0)).toBe(true);
  });

  it("contoh: geser ke bawah di bawah rasio dan kecepatan rendah tidak menutup", () => {
    expect(shouldDismissSheet(10, 400, 0)).toBe(false);
  });

  it("contoh: kecepatan ke bawah tinggi menutup walau geser kecil", () => {
    expect(shouldDismissSheet(1, 400, 1)).toBe(true);
  });

  it("contoh: geser ke atas tidak pernah menutup, meski kecepatan tinggi", () => {
    expect(shouldDismissSheet(-200, 400, 5)).toBe(false);
    expect(shouldDismissSheet(0, 400, 5)).toBe(false);
  });

  /**
   * Validates: Requirements 17.4
   */
  it("properti: bernilai benar tepat saat dragY/sheetHeight >= DISMISS_RATIO atau kecepatan >= DISMISS_VELOCITY, untuk geser ke bawah", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.0001, max: 4000, noNaN: true, noDefaultInfinity: true }),
        sheetHeightArb,
        velocityArb,
        (dragY, sheetHeight, velocity) => {
          const byRatio = dragY / sheetHeight >= DISMISS_RATIO;
          const byVelocity = velocity >= DISMISS_VELOCITY;
          expect(shouldDismissSheet(dragY, sheetHeight, velocity)).toBe(
            byRatio || byVelocity,
          );
        },
      ),
    );
  });

  /**
   * Validates: Requirements 17.4
   */
  it("properti: geser ke atas atau tanpa geser (dragY <= 0) tidak pernah menutup", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -4000, max: 0, noNaN: true, noDefaultInfinity: true }),
        sheetHeightArb,
        fc.double({ min: -10, max: 1000, noNaN: true, noDefaultInfinity: true }),
        (dragY, sheetHeight, velocity) => {
          expect(shouldDismissSheet(dragY, sheetHeight, velocity)).toBe(false);
        },
      ),
    );
  });

  /**
   * Validates: Requirements 17.4
   */
  it("properti: monoton terhadap dragY (geser lebih jauh ke bawah tidak pernah mengubah hasil dari tutup ke tidak tutup)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 4000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 4000, noNaN: true, noDefaultInfinity: true }),
        sheetHeightArb,
        velocityArb,
        (a, b, sheetHeight, velocity) => {
          const small = Math.min(a, b);
          const large = Math.max(a, b);
          const dismissedAtSmall = shouldDismissSheet(small, sheetHeight, velocity);
          const dismissedAtLarge = shouldDismissSheet(large, sheetHeight, velocity);
          // Jika sudah menutup pada geser lebih kecil, geser lebih besar (dengan
          // kecepatan sama) harus tetap menutup.
          if (dismissedAtSmall) {
            expect(dismissedAtLarge).toBe(true);
          }
        },
      ),
    );
  });
});
