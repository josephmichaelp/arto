import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  flattenTokensToCssVars,
  generateCssVariables,
  parseCssVariables,
  type CssVarEntry,
} from "./generate-theme-css";
import { tokens, type Tokens } from "../src/theme/tokens";

const TOKENS_CSS_PATH = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../src/theme/tokens.css",
);

/** Arbitrary nilai hex warna acak, cukup sederhana untuk diratakan ke string. */
const hexColorArb = fc
  .tuple(
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
  )
  .map(
    ([r, g, b]) =>
      `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase()}`,
  );

/** Arbitrary kumpulan token tema acak dengan bentuk sama dengan `Tokens`. */
const tokensArb: fc.Arbitrary<Tokens> = fc.record({
  brand: fc.record({
    oat: hexColorArb,
    blue: hexColorArb,
    pink: hexColorArb,
  }),
  derived: fc.record({
    ink: hexColorArb,
    inkMuted: hexColorArb,
    card: hexColorArb,
    onBlue: hexColorArb,
    pinkStrong: hexColorArb,
    blueDeep: hexColorArb,
  }),
  glass: fc.record({
    alpha: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
    alphaFallback: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
  }),
  radius: fc.record({
    card: fc.constantFrom("16px", "20px", "24px"),
  }),
  hit: fc.constantFrom("44px", "48px"),
  mesh: fc.constant(tokens.mesh),
}) as fc.Arbitrary<Tokens>;

describe("generate-theme-css - Property 33: Variabel CSS sama dengan token", () => {
  it("contoh: tokens.css yang dikomit sinkron dengan hasil generateCssVariables", () => {
    // Akhiran baris dinormalkan: `core.autocrlf` di Windows menulis CRLF ke
    // working tree, sedangkan generator selalu memakai LF. Yang diuji adalah
    // kesamaan isi, bukan akhiran barisnya.
    const committed = readFileSync(TOKENS_CSS_PATH, "utf8").replace(/\r\n/g, "\n");
    expect(committed).toBe(generateCssVariables(tokens).replace(/\r\n/g, "\n"));
  });

  it("contoh: flattenTokensToCssVars menghasilkan tepat satu variabel per Warna_Merek", () => {
    const entries = flattenTokensToCssVars(tokens);
    expect(entries.find((e) => e.name === "--color-brand-oat")?.value).toBe(tokens.brand.oat);
    expect(entries.find((e) => e.name === "--color-brand-blue")?.value).toBe(tokens.brand.blue);
    expect(entries.find((e) => e.name === "--color-brand-pink")?.value).toBe(tokens.brand.pink);
  });

  /**
   * Validates: Requirements 18.5, 18.6
   */
  it("properti: setiap token warna dan radius menghasilkan tepat satu variabel CSS dengan nilai identik", () => {
    fc.assert(
      fc.property(tokensArb, (t) => {
        const entries = flattenTokensToCssVars(t);
        const byName = new Map<string, CssVarEntry[]>();
        for (const entry of entries) {
          byName.set(entry.name, [...(byName.get(entry.name) ?? []), entry]);
        }

        // Tepat satu entri untuk setiap Warna_Merek, tanpa duplikat nama.
        for (const key of Object.keys(t.brand)) {
          const matches = byName.get(`--color-brand-${key}`);
          expect(matches).toHaveLength(1);
          expect(matches?.[0]?.value).toBe(String(t.brand[key as keyof typeof t.brand]));
        }

        // Tidak ada nama variabel yang dihasilkan lebih dari sekali.
        for (const matches of byName.values()) {
          expect(matches).toHaveLength(1);
        }

        // Setiap token derived, glass, dan radius punya variabel bernilai identik.
        for (const [key, value] of Object.entries(t.derived)) {
          expect(byName.get(`--color-${key}`)?.[0]?.value).toBe(String(value));
        }
        for (const [key, value] of Object.entries(t.glass)) {
          expect(byName.get(`--glass-${key}`)?.[0]?.value).toBe(String(value));
        }
        for (const [key, value] of Object.entries(t.radius)) {
          expect(byName.get(`--radius-${key}`)?.[0]?.value).toBe(String(value));
        }
        expect(byName.get("--hit")?.[0]?.value).toBe(String(t.hit));
      }),
    );
  });

  /**
   * Validates: Requirements 18.5, 18.6
   */
  it("properti: memparse hasil generateCssVariables mengembalikan nilai token semula (round trip)", () => {
    fc.assert(
      fc.property(tokensArb, (t) => {
        const css = generateCssVariables(t);
        const parsed = parseCssVariables(css);
        const expected = flattenTokensToCssVars(t);

        expect(Object.keys(parsed)).toHaveLength(expected.length);
        for (const entry of expected) {
          expect(parsed[entry.name]).toBe(entry.value);
        }
      }),
    );
  });

  /**
   * Validates: Requirements 18.5, 18.6
   */
  it("properti: generateCssVariables bersifat deterministik untuk token yang sama", () => {
    fc.assert(
      fc.property(tokensArb, (t) => {
        expect(generateCssVariables(t)).toBe(generateCssVariables(t));
      }),
    );
  });
});
