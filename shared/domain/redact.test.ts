import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { safeLogPayload } from "./redact";

/** Daftar putih kunci yang boleh muncul pada hasil `safeLogPayload`. */
const ALLOWED_KEYS = [
  "name",
  "code",
  "httpStatus",
  "requestId",
  "candidate",
  "inputLength",
] as const;

/** Kunci acak yang mungkin memuat data keuangan atau data Pengguna lain. */
const arbitraryKeyArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((key) => !(ALLOWED_KEYS as readonly string[]).includes(key));

/** Nilai acak sederhana (termasuk nominal, catatan, dan teks Pengguna). */
const valueArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.string(), { maxLength: 3 }),
);

/** Arbitrary objek masukan dengan campuran kunci daftar putih dan kunci acak. */
const payloadArb = fc
  .array(
    fc.tuple(fc.oneof(fc.constantFrom(...ALLOWED_KEYS), arbitraryKeyArb), valueArb),
    { maxLength: 10 },
  )
  .map((entries) => Object.fromEntries(entries) as Record<string, unknown>);

describe("safeLogPayload - Property 24: Log tidak memuat data keuangan", () => {
  it("contoh: menyaring kunci di luar daftar putih (misalnya amount dan note)", () => {
    const result = safeLogPayload({
      name: "ValidationException",
      amount: 150000,
      note: "beli kopi di cafe",
    });

    expect(result).toEqual({ name: "ValidationException" });
  });

  it("contoh: objek kosong menghasilkan objek kosong", () => {
    expect(safeLogPayload({})).toEqual({});
  });

  it("contoh: input null atau bukan objek menghasilkan objek kosong", () => {
    expect(safeLogPayload(null as unknown as Record<string, unknown>)).toEqual({});
    expect(safeLogPayload(undefined as unknown as Record<string, unknown>)).toEqual({});
  });

  /**
   * Property 24: Log tidak memuat data keuangan
   * Validates: Requirements 16.4
   */
  it("properti: hasil hanya memuat kunci daftar putih, tidak pernah memuat nilai dari kunci lain", () => {
    fc.assert(
      fc.property(payloadArb, (payload) => {
        const result = safeLogPayload(payload);

        for (const key of Object.keys(result)) {
          expect(ALLOWED_KEYS as readonly string[]).toContain(key);
        }

        for (const key of Object.keys(payload)) {
          if (!(ALLOWED_KEYS as readonly string[]).includes(key)) {
            expect(Object.prototype.hasOwnProperty.call(result, key)).toBe(false);
          }
        }
      }),
    );
  });

  /**
   * Property 24: Log tidak memuat data keuangan
   * Validates: Requirements 16.4
   */
  it("properti: setiap kunci daftar putih yang ada pada masukan diteruskan dengan nilai yang sama", () => {
    fc.assert(
      fc.property(payloadArb, (payload) => {
        const result = safeLogPayload(payload);

        for (const key of ALLOWED_KEYS) {
          if (Object.prototype.hasOwnProperty.call(payload, key)) {
            expect(result[key]).toBe(payload[key]);
          } else {
            expect(Object.prototype.hasOwnProperty.call(result, key)).toBe(false);
          }
        }
      }),
    );
  });

  /**
   * Property 24: Log tidak memuat data keuangan
   * Validates: Requirements 16.4
   */
  it("properti: safeLogPayload idempoten (menyaring hasilnya sendiri tidak mengubah apa pun)", () => {
    fc.assert(
      fc.property(payloadArb, (payload) => {
        const once = safeLogPayload(payload);
        const twice = safeLogPayload(once);
        expect(twice).toEqual(once);
      }),
    );
  });
});
