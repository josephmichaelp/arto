import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { formatAmountsInText } from "./ai-validate";
import { formatRupiah } from "./money";

/**
 * Property 17: Nominal pada jawaban asisten berformat Rupiah
 *
 * For any teks jawaban yang memuat nominal, `formatAmountsInText` SHALL
 * menghasilkan teks yang semua nominalnya berformat Format_Rupiah, dan teks
 * tanpa nominal SHALL tidak berubah.
 *
 * Validates: Requirements 12.2
 */

/** Pola Format_Rupiah keluaran: "Rp 1.000.000" (atau "-Rp ..." untuk negatif). */
const FORMAT_RUPIAH_RE = /^-?Rp \d{1,3}(\.\d{3})*$/;

/** Bilangan bulat Rupiah positif dalam rentang integer aman JavaScript. */
const positiveAmount = fc.integer({ min: 1, max: 999_999_999_999 });

/** Mengelompokkan digit per 3 dari kanan memakai pemisah yang diberikan. */
function groupWith(digits: string, sep: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/**
 * Merender sebuah nominal menjadi salah satu bentuk masukan yang dikenali
 * `formatAmountsInText`: dengan/ tanpa spasi, dengan/ tanpa titik setelah "Rp",
 * dan bentuk polos maupun berkelompok ribuan (titik atau koma).
 */
function renderAmount(v: number, style: number, sep: "." | ","): string {
  const prefix = ["Rp", "Rp ", "Rp.", "Rp. "][style % 4] ?? "Rp ";
  const digits = String(v);
  const grouped = style >= 4; // separuh gaya memakai pengelompokan ribuan
  return prefix + (grouped ? groupWith(digits, sep) : digits);
}

/** Kata biasa tanpa digit sehingga tidak pernah cocok sebagai nominal. */
const letter = fc.constantFrom(
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
);
const plainWord = fc
  .array(letter, { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(""));

type Token =
  | { kind: "text"; text: string }
  | { kind: "amount"; text: string; value: number };

const tokenArb: fc.Arbitrary<Token> = fc.oneof(
  plainWord.map((w): Token => ({ kind: "text", text: w })),
  // "Rp" tanpa digit juga teks biasa (tidak dikenali sebagai nominal)
  fc.constant<Token>({ kind: "text", text: "Rp" }),
  fc
    .record({
      value: positiveAmount,
      style: fc.integer({ min: 0, max: 7 }),
      sep: fc.constantFrom<"." | ",">(".", ","),
    })
    .map(
      ({ value, style, sep }): Token => ({
        kind: "amount",
        text: renderAmount(value, style, sep),
        value,
      }),
    ),
);

describe("formatAmountsInText - contoh", () => {
  it("contoh: mengganti berbagai bentuk nominal dengan Format_Rupiah", () => {
    expect(formatAmountsInText("Totalnya Rp 12000 bulan ini")).toBe(
      "Totalnya Rp 12.000 bulan ini",
    );
    expect(formatAmountsInText("hemat Rp12000")).toBe("hemat Rp 12.000");
    expect(formatAmountsInText("sisa Rp 12.000")).toBe("sisa Rp 12.000");
    expect(formatAmountsInText("sisa Rp 12,000")).toBe("sisa Rp 12.000");
  });

  it("contoh: teks tanpa nominal tidak berubah", () => {
    expect(formatAmountsInText("Halo, bagaimana kabarmu?")).toBe(
      "Halo, bagaimana kabarmu?",
    );
    expect(formatAmountsInText("")).toBe("");
    expect(formatAmountsInText("Rp tanpa angka")).toBe("Rp tanpa angka");
  });
});

describe("Property 17: Nominal pada jawaban asisten berformat Rupiah", () => {
  /**
   * Validates: Requirements 12.2
   */
  it("properti: setiap bentuk nominal diganti menjadi Format_Rupiah persis", () => {
    fc.assert(
      fc.property(
        positiveAmount,
        fc.integer({ min: 0, max: 7 }),
        fc.constantFrom<"." | ",">(".", ","),
        (value, style, sep) => {
          const out = formatAmountsInText(renderAmount(value, style, sep));
          expect(out).toBe(formatRupiah(value));
          expect(out).toMatch(FORMAT_RUPIAH_RE);
        },
      ),
    );
  });

  /**
   * Validates: Requirements 12.2
   */
  it("properti: pada teks campuran, hanya nominal yang berubah menjadi Format_Rupiah", () => {
    fc.assert(
      fc.property(fc.array(tokenArb, { minLength: 1, maxLength: 6 }), (tokens) => {
        const input = tokens.map((t) => t.text).join(" ");
        const expected = tokens
          .map((t) => (t.kind === "amount" ? formatRupiah(t.value) : t.text))
          .join(" ");
        expect(formatAmountsInText(input)).toBe(expected);
      }),
    );
  });

  /**
   * Validates: Requirements 12.2
   */
  it("properti: teks tanpa nominal yang dapat dikenali tidak berubah", () => {
    const noAmountText = fc
      .array(fc.oneof(plainWord, fc.constant("Rp")), { minLength: 0, maxLength: 8 })
      .map((parts) => parts.join(" "));
    fc.assert(
      fc.property(noAmountText, (text) => {
        expect(formatAmountsInText(text)).toBe(text);
      }),
    );
  });

  /**
   * Validates: Requirements 12.2
   *
   * Keluaran selalu stabil: menjalankan ulang pada hasil tidak mengubah apa pun,
   * yang menandakan semua nominal sudah berformat Format_Rupiah.
   */
  it("properti: formatAmountsInText idempoten pada teks sembarang", () => {
    fc.assert(
      fc.property(fc.array(tokenArb, { minLength: 0, maxLength: 6 }), (tokens) => {
        const input = tokens.map((t) => t.text).join(" ");
        const once = formatAmountsInText(input);
        expect(formatAmountsInText(once)).toBe(once);
      }),
    );
  });
});
