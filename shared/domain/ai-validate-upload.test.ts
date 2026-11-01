import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { validateUpload } from "./ai-validate";

/**
 * Property 16: Validasi unggahan struk
 *
 * `validateUpload` SHALL menerima tepat bila tipe JPEG atau PNG dan ukuran
 * lebih dari 0 serta paling besar 5 * 1024 * 1024 byte, dan selain itu SHALL
 * menolak dengan pesan berbahasa Indonesia.
 *
 * Validates: Requirements 11.1, 11.3
 */

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png"] as const;

/** Tipe MIME acak yang bukan JPEG/PNG. */
const disallowedTypeArb = fc
  .oneof(
    fc.constantFrom(
      "image/gif",
      "image/webp",
      "image/heic",
      "application/pdf",
      "text/plain",
      "",
      "image/jpg",
      "IMAGE/JPEG",
    ),
    fc.string(),
  )
  .filter((t) => !(ALLOWED_TYPES as readonly string[]).includes(t));

describe("validateUpload - Property 16: Validasi unggahan struk", () => {
  it("contoh: JPEG berukuran 1 byte diterima", () => {
    expect(validateUpload({ type: "image/jpeg", size: 1 })).toEqual({ ok: true });
  });

  it("contoh: PNG tepat 5 MB diterima (batas inklusif)", () => {
    expect(validateUpload({ type: "image/png", size: MAX_UPLOAD_SIZE })).toEqual({
      ok: true,
    });
  });

  it("contoh: ukuran 0 ditolak dengan pesan berbahasa Indonesia", () => {
    const result = validateUpload({ type: "image/png", size: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe(
        "Ukuran berkas harus lebih dari 0 dan paling besar 5 MB",
      );
    }
  });

  it("contoh: ukuran melebihi 5 MB ditolak", () => {
    const result = validateUpload({ type: "image/jpeg", size: MAX_UPLOAD_SIZE + 1 });
    expect(result.ok).toBe(false);
  });

  it("contoh: tipe GIF ditolak dengan pesan format", () => {
    const result = validateUpload({ type: "image/gif", size: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("Berkas harus berformat JPEG atau PNG");
    }
  });

  /**
   * Property 16: menerima tepat JPEG/PNG dengan ukuran dalam (0, 5MB].
   * Validates: Requirements 11.1, 11.3
   */
  it("properti: menerima tepat bila tipe JPEG/PNG dan 0 < ukuran <= 5 MB", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALLOWED_TYPES),
        fc.integer({ min: 1, max: MAX_UPLOAD_SIZE }),
        (type, size) => {
          expect(validateUpload({ type, size })).toEqual({ ok: true });
        },
      ),
    );
  });

  /**
   * Property 16: menolak tipe di luar JPEG/PNG apa pun ukurannya.
   * Validates: Requirements 11.1, 11.3
   */
  it("properti: menolak tipe selain JPEG/PNG dengan pesan format berbahasa Indonesia", () => {
    fc.assert(
      fc.property(
        disallowedTypeArb,
        fc.integer({ min: 1, max: MAX_UPLOAD_SIZE }),
        (type, size) => {
          const result = validateUpload({ type, size });
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.message).toBe("Berkas harus berformat JPEG atau PNG");
          }
        },
      ),
    );
  });

  /**
   * Property 16: menolak ukuran <= 0 atau > 5 MB meski tipe valid.
   * Validates: Requirements 11.1, 11.3
   */
  it("properti: menolak ukuran tidak valid (<= 0 atau > 5 MB) walau tipe JPEG/PNG", () => {
    const invalidSizeArb = fc.oneof(
      fc.integer({ min: -1_000_000, max: 0 }),
      fc.integer({ min: MAX_UPLOAD_SIZE + 1, max: MAX_UPLOAD_SIZE * 4 }),
      fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
    );
    fc.assert(
      fc.property(fc.constantFrom(...ALLOWED_TYPES), invalidSizeArb, (type, size) => {
        const result = validateUpload({ type, size });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.message).toBe(
            "Ukuran berkas harus lebih dari 0 dan paling besar 5 MB",
          );
        }
      }),
    );
  });

  /**
   * Property 16: hasil selalu berupa diskriminasi ok true/false yang konsisten
   * dengan kombinasi tipe dan ukuran.
   * Validates: Requirements 11.1, 11.3
   */
  it("properti: ok true jika dan hanya jika tipe valid dan ukuran dalam (0, 5 MB]", () => {
    const anyTypeArb = fc.oneof(fc.constantFrom(...ALLOWED_TYPES), disallowedTypeArb);
    const anySizeArb = fc.oneof(
      fc.integer({ min: -1000, max: MAX_UPLOAD_SIZE * 2 }),
      fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY),
    );
    fc.assert(
      fc.property(anyTypeArb, anySizeArb, (type, size) => {
        const expected =
          (ALLOWED_TYPES as readonly string[]).includes(type) &&
          Number.isFinite(size) &&
          size > 0 &&
          size <= MAX_UPLOAD_SIZE;
        expect(validateUpload({ type, size }).ok).toBe(expected);
      }),
    );
  });
});
