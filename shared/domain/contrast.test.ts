import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  MIN_TEXT_CONTRAST,
  compositeOver,
  contrastRatio,
  hexToRgb,
  meetsTextContrast,
  relativeLuminance,
} from "./contrast";

/** Arbitrary RGB byte 0..255. */
const byte = fc.integer({ min: 0, max: 255 });

/** Arbitrary warna hex "#rrggbb" valid dari komponen RGB acak. */
const hexColor = fc
  .tuple(byte, byte, byte)
  .map(
    ([r, g, b]) =>
      `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`,
  );

describe("hexToRgb", () => {
  it("contoh: mengurai bentuk panjang dan pendek ke nilai RGB yang sama", () => {
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(hexToRgb("abc")).toEqual(hexToRgb("#aabbcc"));
  });

  it("contoh: menolak hex yang tidak valid", () => {
    expect(() => hexToRgb("#12345")).toThrow();
    expect(() => hexToRgb("bukan-warna")).toThrow();
  });

  /**
   * Validates: Requirements 17.13, 18.9
   */
  it("properti: round trip rgb -> hex -> rgb menghasilkan komponen semula", () => {
    fc.assert(
      fc.property(fc.tuple(byte, byte, byte), ([r, g, b]) => {
        const hex = `#${[r, g, b]
          .map((c) => c.toString(16).padStart(2, "0"))
          .join("")}`;
        expect(hexToRgb(hex)).toEqual([r, g, b]);
      }),
    );
  });
});

describe("relativeLuminance", () => {
  it("contoh: hitam bernilai 0 dan putih bernilai 1", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 10);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 10);
  });

  /**
   * Validates: Requirements 17.13, 18.9
   */
  it("properti: luminans relatif selalu berada pada rentang 0 sampai 1", () => {
    fc.assert(
      fc.property(hexColor, (hex) => {
        const l = relativeLuminance(hex);
        expect(l).toBeGreaterThanOrEqual(0);
        expect(l).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe("contrastRatio - Property 29: Kebenaran helper rasio kontras", () => {
  it("contoh: hitam terhadap putih menghasilkan rasio 21", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 6);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 6);
  });

  it("contoh: warna yang sama menghasilkan rasio 1", () => {
    expect(contrastRatio("#336699", "#336699")).toBeCloseTo(1, 10);
  });

  /**
   * Validates: Requirements 17.13, 18.9
   */
  it("properti: contrastRatio simetris", () => {
    fc.assert(
      fc.property(hexColor, hexColor, (a, b) => {
        expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
      }),
    );
  });

  /**
   * Validates: Requirements 17.13, 18.9
   */
  it("properti: contrastRatio berada pada rentang 1 sampai 21", () => {
    fc.assert(
      fc.property(hexColor, hexColor, (a, b) => {
        const ratio = contrastRatio(a, b);
        expect(ratio).toBeGreaterThanOrEqual(1);
        expect(ratio).toBeLessThanOrEqual(21);
      }),
    );
  });

  /**
   * Validates: Requirements 17.13, 18.9
   */
  it("properti: contrastRatio bernilai 1 untuk warna yang sama", () => {
    fc.assert(
      fc.property(hexColor, (hex) => {
        expect(contrastRatio(hex, hex)).toBeCloseTo(1, 10);
      }),
    );
  });

  /**
   * Validates: Requirements 17.13, 18.9
   */
  it("properti: contrastRatio sama dengan (L1 + 0,05) / (L2 + 0,05) dengan L1 >= L2", () => {
    fc.assert(
      fc.property(hexColor, hexColor, (a, b) => {
        const la = relativeLuminance(a);
        const lb = relativeLuminance(b);
        const hi = Math.max(la, lb);
        const lo = Math.min(la, lb);
        const expected = (hi + 0.05) / (lo + 0.05);
        expect(contrastRatio(a, b)).toBeCloseTo(expected, 10);
      }),
    );
  });
});

describe("compositeOver", () => {
  it("contoh: alpha 1 menghasilkan warna depan, alpha 0 menghasilkan warna latar", () => {
    expect(compositeOver("#336699", 1, "#ffffff")).toBe("#336699");
    expect(compositeOver("#336699", 0, "#ffffff")).toBe("#ffffff");
  });

  /**
   * Validates: Requirements 17.12, 18.9
   */
  it("properti: hasil komposit selalu berupa hex 6 digit valid", () => {
    fc.assert(
      fc.property(
        hexColor,
        fc.float({ min: 0, max: 1, noNaN: true }),
        hexColor,
        (fg, alpha, bg) => {
          const result = compositeOver(fg, alpha, bg);
          expect(result).toMatch(/^#[0-9a-f]{6}$/);
          expect(() => hexToRgb(result)).not.toThrow();
        },
      ),
    );
  });
});

describe("meetsTextContrast", () => {
  /**
   * Validates: Requirements 17.13, 18.9
   */
  it("properti: sama dengan contrastRatio >= MIN_TEXT_CONTRAST", () => {
    fc.assert(
      fc.property(hexColor, hexColor, (a, b) => {
        expect(meetsTextContrast(a, b)).toBe(
          contrastRatio(a, b) >= MIN_TEXT_CONTRAST,
        );
      }),
    );
  });
});
