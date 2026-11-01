import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { MIN_TEXT_CONTRAST, contrastRatio } from "../../shared/domain/contrast";
import { TEXT_SURFACE_PAIRS } from "./tokens";

describe("TEXT_SURFACE_PAIRS - Property 28: Semua pasangan teks dan latar pada token memenuhi kontras", () => {
  it("contoh: daftar pasangan tidak kosong", () => {
    expect(TEXT_SURFACE_PAIRS.length).toBeGreaterThan(0);
  });

  /**
   * Validates: Requirements 17.13, 18.6, 18.9
   */
  it("properti: setiap pasangan dalam TEXT_SURFACE_PAIRS memenuhi kontras minimal 4,5:1", () => {
    fc.assert(
      fc.property(fc.constantFrom(...TEXT_SURFACE_PAIRS), (pair) => {
        const ratio = contrastRatio(pair.text, pair.surface);
        expect(ratio).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      }),
    );
  });

  it("contoh: setiap pasangan dilaporkan namanya saat gagal", () => {
    for (const pair of TEXT_SURFACE_PAIRS) {
      const ratio = contrastRatio(pair.text, pair.surface);
      expect(ratio, `pasangan "${pair.name}" kontras ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        MIN_TEXT_CONTRAST,
      );
    }
  });
});
