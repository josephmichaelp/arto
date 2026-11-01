import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  MIN_TEXT_CONTRAST,
  compositeOver,
  contrastRatio,
  hexToRgb,
} from "../../shared/domain/contrast";
import { derived, glass } from "./tokens";

/** Arbitrary RGB byte 0..255. */
const byte = fc.integer({ min: 0, max: 255 });

/** Arbitrary warna hex "#rrggbb" valid dari komponen RGB acak. */
const hexColor = fc
  .tuple(byte, byte, byte)
  .map(
    ([r, g, b]) =>
      `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`,
  );

const WHITE = "#ffffff";
const BLACK = "#000000";

describe("Permukaan_Kaca - Property 30: Permukaan_Kaca menjaga kontras pada latar apa pun", () => {
  it("contoh: komposit di atas hitam (kasus terburuk) sama dengan nilai terdokumentasi", () => {
    expect(compositeOver(WHITE, glass.alpha, BLACK)).toBe("#e0e0e0");
    expect(compositeOver(WHITE, glass.alphaFallback, BLACK)).toBe("#f0f0f0");
  });

  it("contoh: ink dan inkMuted lolos kontras di atas komposit kasus terburuk", () => {
    const worstBlur = compositeOver(WHITE, glass.alpha, BLACK);
    const worstFallback = compositeOver(WHITE, glass.alphaFallback, BLACK);

    expect(contrastRatio(derived.ink, worstBlur)).toBeGreaterThanOrEqual(
      MIN_TEXT_CONTRAST,
    );
    expect(contrastRatio(derived.inkMuted, worstBlur)).toBeGreaterThanOrEqual(
      MIN_TEXT_CONTRAST,
    );
    expect(contrastRatio(derived.ink, worstFallback)).toBeGreaterThanOrEqual(
      MIN_TEXT_CONTRAST,
    );
    expect(
      contrastRatio(derived.inkMuted, worstFallback),
    ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  /**
   * Validates: Requirements 17.12, 17.13, 18.8
   */
  it("properti: komposit Permukaan_Kaca (blur) di atas latar apa pun tetap memenuhi kontras minimal untuk ink dan inkMuted", () => {
    fc.assert(
      fc.property(hexColor, (bg) => {
        const surface = compositeOver(WHITE, glass.alpha, bg);
        expect(() => hexToRgb(surface)).not.toThrow();
        expect(contrastRatio(derived.ink, surface)).toBeGreaterThanOrEqual(
          MIN_TEXT_CONTRAST,
        );
        expect(
          contrastRatio(derived.inkMuted, surface),
        ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      }),
    );
  });

  /**
   * Validates: Requirements 17.12, 17.13, 18.8
   */
  it("properti: komposit Permukaan_Kaca (fallback tanpa blur) di atas latar apa pun tetap memenuhi kontras minimal untuk ink dan inkMuted", () => {
    fc.assert(
      fc.property(hexColor, (bg) => {
        const surface = compositeOver(WHITE, glass.alphaFallback, bg);
        expect(() => hexToRgb(surface)).not.toThrow();
        expect(contrastRatio(derived.ink, surface)).toBeGreaterThanOrEqual(
          MIN_TEXT_CONTRAST,
        );
        expect(
          contrastRatio(derived.inkMuted, surface),
        ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      }),
    );
  });

  /**
   * Validates: Requirements 17.12, 17.13, 18.8
   */
  it("properti: fallback (alpha lebih tinggi) tidak pernah memberi kontras lebih rendah daripada versi blur untuk latar yang sama", () => {
    fc.assert(
      fc.property(hexColor, (bg) => {
        const blurSurface = compositeOver(WHITE, glass.alpha, bg);
        const fallbackSurface = compositeOver(WHITE, glass.alphaFallback, bg);
        expect(
          contrastRatio(derived.ink, fallbackSurface),
        ).toBeGreaterThanOrEqual(contrastRatio(derived.ink, blurSurface) - 1e-9);
      }),
    );
  });
});
