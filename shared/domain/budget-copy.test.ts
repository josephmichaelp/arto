import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { copyBudgets } from "./budget";
import type { Budget } from "./types";

/**
 * Property 10: Salin anggaran (Validates: Requirements 5.6).
 *
 * Untuk sembarang kumpulan Anggaran bulan sebelumnya (`prev`) dan Anggaran
 * yang sudah ada di bulan tujuan (`existing`), hasil `copyBudgets` SHALL
 * memuat Kategori dan nominal yang sama untuk setiap Anggaran `prev` yang
 * Kategorinya belum ada di bulan tujuan, dan SHALL tidak menimpa Anggaran
 * yang sudah ada.
 */

/** Bulan tujuan tetap yang dipakai generator. */
const TO_MONTH = "2025-02";

/** Daftar id Kategori tetap agar generator menghasilkan tumpang tindih. */
const CATEGORY_IDS = ["c1", "c2", "c3", "c4", "c5"] as const;

const categoryId = fc.constantFrom(...CATEGORY_IDS);

/** Arbitrary nominal Anggaran lebih dari 0 (K-1 bilangan bulat Rupiah). */
const amount = fc.integer({ min: 1, max: 100_000_000 });

/** Arbitrary bulan `YYYY-MM`; bisa bulan tujuan atau bulan lain. */
const month = fc.constantFrom("2025-01", TO_MONTH, "2025-03", "2024-12");

let budgetCounter = 0;
/** Arbitrary Budget dengan id unik, Kategori, bulan, dan nominal acak. */
const budgetArb: fc.Arbitrary<Budget> = fc
  .tuple(categoryId, month, amount)
  .map(([catId, m, amt]) => ({
    id: `seed-${budgetCounter++}`,
    categoryId: catId,
    month: m,
    amount: amt,
  }));

const budgetsArb = fc.array(budgetArb, { maxLength: 12 });

/** Kumpulan Kategori yang sudah punya Anggaran di bulan tujuan. */
function existingCategoriesAt(existing: Budget[], month: string): Set<string> {
  return new Set(existing.filter((b) => b.month === month).map((b) => b.categoryId));
}

/** Nominal `prev` berdasarkan Kategori, memakai kemunculan pertama (dedup). */
function firstPrevAmountByCategory(prev: Budget[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const b of prev) {
    if (!map.has(b.categoryId)) {
      map.set(b.categoryId, b.amount);
    }
  }
  return map;
}

describe("copyBudgets - Property 10: Salin anggaran", () => {
  it("contoh: menyalin Anggaran bulan lalu yang belum ada ke bulan tujuan", () => {
    const prev: Budget[] = [
      { id: "c1#2025-01", categoryId: "c1", month: "2025-01", amount: 500_000 },
      { id: "c2#2025-01", categoryId: "c2", month: "2025-01", amount: 750_000 },
    ];
    const result = copyBudgets(prev, TO_MONTH, []);

    expect(result).toEqual([
      { id: `c1#${TO_MONTH}`, categoryId: "c1", month: TO_MONTH, amount: 500_000 },
      { id: `c2#${TO_MONTH}`, categoryId: "c2", month: TO_MONTH, amount: 750_000 },
    ]);
  });

  it("contoh: tidak menyalin Kategori yang sudah punya Anggaran di bulan tujuan", () => {
    const prev: Budget[] = [
      { id: "c1#2025-01", categoryId: "c1", month: "2025-01", amount: 500_000 },
      { id: "c2#2025-01", categoryId: "c2", month: "2025-01", amount: 750_000 },
    ];
    const existing: Budget[] = [
      { id: `c1#${TO_MONTH}`, categoryId: "c1", month: TO_MONTH, amount: 999_999 },
    ];
    const result = copyBudgets(prev, TO_MONTH, existing);

    // Hanya c2 yang disalin; Anggaran c1 yang sudah ada tidak ikut dan tidak ditimpa.
    expect(result).toEqual([
      { id: `c2#${TO_MONTH}`, categoryId: "c2", month: TO_MONTH, amount: 750_000 },
    ]);
  });

  it("contoh: duplikat Kategori pada bulan lalu hanya disalin sekali (kemunculan pertama)", () => {
    const prev: Budget[] = [
      { id: "c1#2025-01-a", categoryId: "c1", month: "2025-01", amount: 100 },
      { id: "c1#2025-01-b", categoryId: "c1", month: "2025-01", amount: 200 },
    ];
    const result = copyBudgets(prev, TO_MONTH, []);

    expect(result).toEqual([
      { id: `c1#${TO_MONTH}`, categoryId: "c1", month: TO_MONTH, amount: 100 },
    ]);
  });

  /**
   * Validates: Requirements 5.6
   */
  it("properti: setiap salinan memakai bulan tujuan, id `categoryId#toMonth`, dan nominal dari prev", () => {
    fc.assert(
      fc.property(budgetsArb, budgetsArb, (prev, existing) => {
        const result = copyBudgets(prev, TO_MONTH, existing);
        const prevAmounts = firstPrevAmountByCategory(prev);

        for (const b of result) {
          expect(b.month).toBe(TO_MONTH);
          expect(b.id).toBe(`${b.categoryId}#${TO_MONTH}`);
          expect(b.amount).toBe(prevAmounts.get(b.categoryId));
        }
      }),
    );
  });

  /**
   * Validates: Requirements 5.6
   */
  it("properti: tidak menimpa — hasil tidak memuat Kategori yang sudah ada di bulan tujuan", () => {
    fc.assert(
      fc.property(budgetsArb, budgetsArb, (prev, existing) => {
        const result = copyBudgets(prev, TO_MONTH, existing);
        const existingCats = existingCategoriesAt(existing, TO_MONTH);

        for (const b of result) {
          expect(existingCats.has(b.categoryId)).toBe(false);
        }
      }),
    );
  });

  /**
   * Validates: Requirements 5.6
   */
  it("properti: setiap Kategori prev yang belum ada di bulan tujuan muncul tepat sekali dengan nominal sama", () => {
    fc.assert(
      fc.property(budgetsArb, budgetsArb, (prev, existing) => {
        const result = copyBudgets(prev, TO_MONTH, existing);
        const existingCats = existingCategoriesAt(existing, TO_MONTH);
        const prevAmounts = firstPrevAmountByCategory(prev);

        const expectedCats = [...prevAmounts.keys()].filter((c) => !existingCats.has(c));
        const resultCats = result.map((b) => b.categoryId);

        // Tidak ada Kategori ganda pada hasil.
        expect(new Set(resultCats).size).toBe(resultCats.length);
        // Himpunan Kategori hasil sama dengan Kategori prev yang belum ada.
        expect(new Set(resultCats)).toEqual(new Set(expectedCats));
        // Nominal tiap salinan mengikuti kemunculan pertama di prev.
        for (const b of result) {
          expect(b.amount).toBe(prevAmounts.get(b.categoryId));
        }
      }),
    );
  });

  /**
   * Validates: Requirements 5.6
   */
  it("properti: tanpa prev tidak ada yang disalin, apa pun isi existing", () => {
    fc.assert(
      fc.property(budgetsArb, (existing) => {
        expect(copyBudgets([], TO_MONTH, existing)).toEqual([]);
      }),
    );
  });
});
