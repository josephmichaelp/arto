import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { formatRupiah, parseAmountShorthand, parseRupiah, validateAmount } from "./money";

/**
 * Bilangan bulat Rupiah yang aman (dalam rentang integer aman JavaScript,
 * jauh di bawah 2^53 - 1) dipakai sebagai domain uji properti.
 */
const rupiah = fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 });

describe("formatRupiah", () => {
  it("contoh: memformat nominal positif dengan pemisah ribuan titik", () => {
    expect(formatRupiah(1_000_000)).toBe("Rp 1.000.000");
    expect(formatRupiah(0)).toBe("Rp 0");
    expect(formatRupiah(999)).toBe("Rp 999");
  });

  it("contoh: memformat nominal negatif dengan awalan '-Rp '", () => {
    expect(formatRupiah(-1_000)).toBe("-Rp 1.000");
  });

  it("contoh: menolak nilai yang bukan bilangan bulat", () => {
    expect(() => formatRupiah(1.5)).toThrow();
    expect(() => formatRupiah(Number.NaN)).toThrow();
  });
});

describe("parseRupiah", () => {
  it("contoh: mengurai Format_Rupiah kembali ke bilangan bulat", () => {
    expect(parseRupiah("Rp 1.000.000")).toBe(1_000_000);
    expect(parseRupiah("-Rp 1.000")).toBe(-1_000);
  });

  it("contoh: mengembalikan null untuk bentuk yang tidak dikenali", () => {
    expect(parseRupiah("1.000.000")).toBeNull();
    expect(parseRupiah("Rp 1.0.00")).toBeNull();
    expect(parseRupiah("bukan nominal")).toBeNull();
  });
});

describe("Property 1: Format Rupiah round trip", () => {
  /**
   * Validates: Requirements 2.7, 2.8, 14.3
   */
  it("properti: parseRupiah(formatRupiah(n)) menghasilkan n kembali", () => {
    fc.assert(
      fc.property(rupiah, (n) => {
        expect(parseRupiah(formatRupiah(n))).toBe(n);
      }),
    );
  });

  /**
   * Validates: Requirements 2.7, 2.8, 14.3
   */
  it("properti: formatRupiah(n) berawalan 'Rp ' (atau '-Rp ' untuk negatif) dan memakai titik sebagai pemisah ribuan tanpa pecahan", () => {
    fc.assert(
      fc.property(rupiah, (n) => {
        const formatted = formatRupiah(n);
        expect(formatted).toMatch(/^-?Rp \d{1,3}(\.\d{3})*$/);
        expect(formatted.startsWith(n < 0 ? "-Rp " : "Rp ")).toBe(true);
      }),
    );
  });
});

describe("parseAmountShorthand", () => {
  it("contoh: menafsirkan singkatan 'rb'/'ribu' dan 'jt'/'juta'", () => {
    expect(parseAmountShorthand("35rb")).toBe(35_000);
    expect(parseAmountShorthand("35 ribu")).toBe(35_000);
    expect(parseAmountShorthand("1,5jt")).toBe(1_500_000);
    expect(parseAmountShorthand("2 juta")).toBe(2_000_000);
  });

  it("contoh: mengembalikan null untuk teks tanpa nominal yang dapat dikenali", () => {
    expect(parseAmountShorthand("bukan nominal")).toBeNull();
    expect(parseAmountShorthand("")).toBeNull();
    expect(parseAmountShorthand("rb")).toBeNull();
  });
});

describe("Property 2: Penafsiran nominal singkat", () => {
  /**
   * Validates: Requirements 10.2
   */
  it("properti: sufiks 'rb'/'ribu' mengalikan bilangan bulat dengan 1.000", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.constantFrom("rb", "ribu"),
        (x, suffix) => {
          expect(parseAmountShorthand(`${x}${suffix}`)).toBe(x * 1_000);
        },
      ),
    );
  });

  /**
   * Validates: Requirements 10.2
   */
  it("properti: sufiks 'jt'/'juta' mengalikan bilangan bulat dengan 1.000.000", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.constantFrom("jt", "juta"),
        (x, suffix) => {
          expect(parseAmountShorthand(`${x}${suffix}`)).toBe(x * 1_000_000);
        },
      ),
    );
  });

  /**
   * Validates: Requirements 10.2
   */
  it("properti: nominal berkoma (pecahan) dikali sufiks menghasilkan bilangan bulat yang sesuai", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 9 }),
        fc.constantFrom(
          { suffix: "rb", mult: 1_000 },
          { suffix: "ribu", mult: 1_000 },
          { suffix: "jt", mult: 1_000_000 },
          { suffix: "juta", mult: 1_000_000 },
        ),
        (intPart, decDigit, { suffix, mult }) => {
          const expected = Math.round(Number(`${intPart}.${decDigit}`) * mult);
          fc.pre(expected > 0);
          expect(parseAmountShorthand(`${intPart},${decDigit}${suffix}`)).toBe(expected);
        },
      ),
    );
  });

  /**
   * Validates: Requirements 10.2
   */
  it("properti: angka tanpa sufiks ditafsirkan sebagai nominal apa adanya", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000_000 }), (x) => {
        expect(parseAmountShorthand(String(x))).toBe(x);
      }),
    );
  });

  /**
   * Validates: Requirements 10.2
   */
  it("properti: teks tanpa digit sama sekali (tanpa nominal yang dapat dikenali) menghasilkan null", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !/[0-9]/.test(s)),
        (s) => {
          expect(parseAmountShorthand(s)).toBeNull();
        },
      ),
    );
  });
});

describe("validateAmount", () => {
  it("contoh: menerima bilangan bulat positif", () => {
    expect(validateAmount(1)).toEqual({ ok: true, value: 1 });
    expect(validateAmount(1_000_000)).toEqual({ ok: true, value: 1_000_000 });
    expect(validateAmount("1.000.000")).toEqual({ ok: true, value: 1_000_000 });
  });

  it("contoh: menolak kosong, nol, negatif, pecahan, dan bukan angka dengan pesan baku", () => {
    const message = "Nominal harus berupa angka bulat lebih dari 0";
    expect(validateAmount("")).toEqual({ ok: false, message });
    expect(validateAmount("   ")).toEqual({ ok: false, message });
    expect(validateAmount(0)).toEqual({ ok: false, message });
    expect(validateAmount(-5)).toEqual({ ok: false, message });
    expect(validateAmount(1.5)).toEqual({ ok: false, message });
    expect(validateAmount("bukan nominal")).toEqual({ ok: false, message });
    expect(validateAmount(null)).toEqual({ ok: false, message });
    expect(validateAmount(undefined)).toEqual({ ok: false, message });
  });
});

describe("Property 5: Validasi nominal", () => {
  const AMOUNT_ERROR_MESSAGE = "Nominal harus berupa angka bulat lebih dari 0";

  /**
   * Validates: Requirements 2.4, 5.1, 7.1
   */
  it("properti: bilangan bulat positif (sebagai number atau string) selalu diterima apa adanya", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000_000 }),
        fc.boolean(),
        (n, asString) => {
          const input = asString ? String(n) : n;
          expect(validateAmount(input)).toEqual({ ok: true, value: n });
        },
      ),
    );
  });

  /**
   * Validates: Requirements 2.4, 5.1, 7.1
   */
  it("properti: nol atau negatif (number maupun string) selalu ditolak dengan pesan baku tanpa mengubah masukan", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000_000, max: 0 }),
        fc.boolean(),
        (n, asString) => {
          const input = asString ? String(n) : n;
          const before = asString ? `${input}` : input;
          const result = validateAmount(input);
          expect(result).toEqual({ ok: false, message: AMOUNT_ERROR_MESSAGE });
          // Masukan tidak diubah oleh validasi (tidak ada state yang berubah).
          expect(asString ? input : input).toBe(before);
        },
      ),
    );
  });

  /**
   * Validates: Requirements 2.4, 5.1, 7.1
   */
  it("properti: nilai pecahan (bukan bilangan bulat) selalu ditolak dengan pesan baku", () => {
    fc.assert(
      fc.property(
        fc
          .float({ min: -1_000_000, max: 1_000_000, noNaN: true })
          .filter((x) => !Number.isInteger(x)),
        (x) => {
          expect(validateAmount(x)).toEqual({
            ok: false,
            message: AMOUNT_ERROR_MESSAGE,
          });
        },
      ),
    );
  });

  /**
   * Validates: Requirements 2.4, 5.1, 7.1
   */
  it("properti: string kosong/spasi, teks bukan angka, dan nilai bukan number/string selalu ditolak", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom("", "   ", "abc", "Rp", "sepuluh ribu", "-", ","),
          fc.string().filter((s) => s.trim() !== "" && !/^-?[\d.,]+$/.test(s.trim())),
          fc.constantFrom<unknown>(null, undefined, true, false, {}, [], NaN, Infinity, -Infinity),
        ),
        (v) => {
          expect(validateAmount(v)).toEqual({
            ok: false,
            message: AMOUNT_ERROR_MESSAGE,
          });
        },
      ),
    );
  });
});
