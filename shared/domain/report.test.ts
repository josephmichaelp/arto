import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { byCategory, summarize } from "./report";
import type { DateRange, Rupiah, Txn, TxnType } from "./types";

/**
 * Uji properti untuk Property 6: Total laporan mengabaikan transfer.
 * Memverifikasi `summarize` dan `byCategory` pada `report.ts`:
 * - `net = income - expense` dan hanya menghitung Transaksi dalam rentang.
 * - Hasil tidak berubah bila Transaksi transfer (`TRANSFER_OUT`,
 *   `TRANSFER_IN`) serta setoran Target (`GOAL_DEPOSIT`) ditambahkan.
 * - Jumlah seluruh `total` pada `byCategory` sama dengan `summarize(...).expense`.
 */

/** Jenis Transaksi yang tidak ikut dihitung di laporan (K-3). */
const EXCLUDED_TYPES: TxnType[] = ["TRANSFER_OUT", "TRANSFER_IN", "GOAL_DEPOSIT"];

/** Arbitrary tanggal YYYY-MM-DD dalam rentang luas sekitar 2024-2025. */
const dateArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom("2024", "2025"),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(
    ([y, m, d]) =>
      `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
  );

/** Arbitrary TxnType dari seluruh jenis. */
const txnType: fc.Arbitrary<TxnType> = fc.constantFrom(
  "EXPENSE",
  "INCOME",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "GOAL_DEPOSIT",
);

/** Daftar id Kategori tetap yang dipakai generator. */
const CATEGORY_IDS = ["c1", "c2", "c3"] as const;

/** Arbitrary nominal Transaksi lebih dari 0. */
const amount: fc.Arbitrary<Rupiah> = fc.integer({ min: 1, max: 1_000_000 });

let txnCounter = 0;
/** Arbitrary Txn dengan tanggal, jenis, nominal, dan Kategori acak. */
const txnArb: fc.Arbitrary<Txn> = fc
  .tuple(txnType, amount, dateArb, fc.constantFrom(...CATEGORY_IDS))
  .map(([type, amt, date, categoryId]) => ({
    id: `t${txnCounter++}`,
    type,
    amount: amt,
    date,
    categoryId,
    walletId: "w1",
  }));

/** Arbitrary Transaksi yang pasti transfer atau setoran Target. */
const excludedTxnArb: fc.Arbitrary<Txn> = fc
  .tuple(fc.constantFrom(...EXCLUDED_TYPES), amount, dateArb, fc.constantFrom(...CATEGORY_IDS))
  .map(([type, amt, date, categoryId]) => ({
    id: `x${txnCounter++}`,
    type,
    amount: amt,
    date,
    categoryId,
    walletId: "w1",
  }));

/** Arbitrary rentang tanggal valid (from <= to). */
const rangeArb: fc.Arbitrary<DateRange> = fc
  .tuple(dateArb, dateArb)
  .map(([a, b]) => (a <= b ? { from: a, to: b } : { from: b, to: a }));

/** Model acuan independen untuk total pemasukan/pengeluaran dalam rentang. */
function modelTotals(txns: Txn[], range: DateRange): { income: number; expense: number } {
  let income = 0;
  let expense = 0;
  for (const txn of txns) {
    if (txn.date < range.from || txn.date > range.to) {
      continue;
    }
    if (txn.type === "INCOME") {
      income += txn.amount;
    } else if (txn.type === "EXPENSE") {
      expense += txn.amount;
    }
  }
  return { income, expense };
}

describe("summarize/byCategory - Property 6: Total laporan mengabaikan transfer", () => {
  it("contoh: hanya INCOME dan EXPENSE yang dihitung, transfer dan setoran diabaikan", () => {
    const range: DateRange = { from: "2025-01-01", to: "2025-01-31" };
    const txns: Txn[] = [
      { id: "t1", type: "INCOME", amount: 1000, date: "2025-01-05", walletId: "w1" },
      { id: "t2", type: "EXPENSE", amount: 300, date: "2025-01-10", categoryId: "c1", walletId: "w1" },
      { id: "t3", type: "TRANSFER_OUT", amount: 500, date: "2025-01-12", walletId: "w1" },
      { id: "t4", type: "TRANSFER_IN", amount: 500, date: "2025-01-12", walletId: "w2" },
      { id: "t5", type: "GOAL_DEPOSIT", amount: 200, date: "2025-01-15", walletId: "w1" },
    ];

    expect(summarize(txns, range)).toEqual({ income: 1000, expense: 300, net: 700 });
  });

  it("contoh: Transaksi di luar rentang tidak dihitung", () => {
    const range: DateRange = { from: "2025-01-01", to: "2025-01-31" };
    const txns: Txn[] = [
      { id: "t1", type: "INCOME", amount: 1000, date: "2024-12-31", walletId: "w1" },
      { id: "t2", type: "EXPENSE", amount: 300, date: "2025-02-01", categoryId: "c1", walletId: "w1" },
      { id: "t3", type: "EXPENSE", amount: 150, date: "2025-01-10", categoryId: "c1", walletId: "w1" },
    ];

    expect(summarize(txns, range)).toEqual({ income: 0, expense: 150, net: -150 });
  });

  it("contoh: jumlah byCategory sama dengan expense", () => {
    const range: DateRange = { from: "2025-01-01", to: "2025-01-31" };
    const txns: Txn[] = [
      { id: "t1", type: "EXPENSE", amount: 300, date: "2025-01-10", categoryId: "c1", walletId: "w1" },
      { id: "t2", type: "EXPENSE", amount: 200, date: "2025-01-11", categoryId: "c2", walletId: "w1" },
      { id: "t3", type: "EXPENSE", amount: 100, date: "2025-01-12", categoryId: "c1", walletId: "w1" },
    ];

    const sum = byCategory(txns, range).reduce((acc, c) => acc + c.total, 0);
    expect(sum).toBe(summarize(txns, range).expense);
  });

  /**
   * Validates: Requirements 8.1, 8.2
   */
  it("properti: summarize memenuhi net = income - expense dan hanya menghitung Transaksi dalam rentang", () => {
    fc.assert(
      fc.property(fc.array(txnArb, { maxLength: 30 }), rangeArb, (txns, range) => {
        const result = summarize(txns, range);
        const model = modelTotals(txns, range);

        expect(result.income).toBe(model.income);
        expect(result.expense).toBe(model.expense);
        expect(result.net).toBe(result.income - result.expense);
      }),
    );
  });

  /**
   * Validates: Requirements 4.6, 8.1, 8.2
   */
  it("properti: menambah Transaksi transfer dan setoran Target tidak mengubah hasil summarize", () => {
    fc.assert(
      fc.property(
        fc.array(txnArb, { maxLength: 30 }),
        fc.array(excludedTxnArb, { maxLength: 15 }),
        rangeArb,
        (base, excluded, range) => {
          const before = summarize(base, range);
          const after = summarize([...base, ...excluded], range);

          expect(after).toEqual(before);
        },
      ),
    );
  });

  /**
   * Validates: Requirements 4.6, 8.1, 8.2
   */
  it("properti: menambah Transaksi transfer dan setoran Target tidak mengubah hasil byCategory", () => {
    fc.assert(
      fc.property(
        fc.array(txnArb, { maxLength: 30 }),
        fc.array(excludedTxnArb, { maxLength: 15 }),
        rangeArb,
        (base, excluded, range) => {
          const before = byCategory(base, range);
          const after = byCategory([...base, ...excluded], range);

          expect(after).toEqual(before);
        },
      ),
    );
  });

  /**
   * Validates: Requirements 8.1, 8.2
   */
  it("properti: jumlah seluruh total byCategory sama dengan summarize(...).expense", () => {
    fc.assert(
      fc.property(fc.array(txnArb, { maxLength: 30 }), rangeArb, (txns, range) => {
        const totalByCategory = byCategory(txns, range).reduce((acc, c) => acc + c.total, 0);

        expect(totalByCategory).toBe(summarize(txns, range).expense);
      }),
    );
  });
});
