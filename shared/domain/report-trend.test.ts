import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { summarize, trend } from "./report";
import { weekRangeEnding } from "./dates";
import type { DateRange, Rupiah, Txn, TxnType } from "./types";

/**
 * Property 7: Bucket tren menjumlahkan total.
 *
 * Untuk setiap daftar Transaksi, rentang, dan jenis bucket (hari, minggu,
 * bulan), jumlah `income` dan jumlah `expense` seluruh bucket SHALL sama
 * dengan total pada `summarize` untuk rentang yang sama. Transfer dan setoran
 * Target tidak ikut dihitung. Bucket minggu dikunci pada Senin dan seluruh
 * bucket diurutkan menaik berdasarkan kunci. Lihat design.md Properti 7.
 *
 * Validates: Requirements 8.3
 */

const BUCKETS = ["DAY", "WEEK", "MONTH"] as const;

/** Arbitrary jenis Transaksi dari seluruh jenis yang didukung domain. */
const txnType: fc.Arbitrary<TxnType> = fc.constantFrom(
  "EXPENSE",
  "INCOME",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "GOAL_DEPOSIT",
);

/** Arbitrary nominal Transaksi lebih dari 0 (K-1: bilangan bulat Rupiah). */
const amount: fc.Arbitrary<Rupiah> = fc.integer({ min: 1, max: 1_000_000 });

/**
 * Arbitrary tanggal kalender `YYYY-MM-DD` (WIB) dalam rentang beberapa tahun,
 * dibangun dari epoch hari agar selalu valid dan menyebar lintas minggu/bulan.
 */
const dateArb: fc.Arbitrary<string> = fc
  .integer({ min: Date.UTC(2023, 0, 1), max: Date.UTC(2027, 11, 31) })
  .map((ms) => new Date(ms).toISOString().slice(0, 10));

let txnCounter = 0;
/** Arbitrary Txn dengan tanggal, jenis, dan nominal acak. */
const txnArb: fc.Arbitrary<Txn> = fc
  .tuple(txnType, amount, dateArb)
  .map(([type, amt, date]) => ({
    id: `t${txnCounter++}`,
    type,
    amount: amt,
    date,
    walletId: "w1",
  }));

/** Arbitrary rentang tanggal `{ from, to }` dengan `from <= to`. */
const rangeArb: fc.Arbitrary<DateRange> = fc
  .tuple(dateArb, dateArb)
  .map(([a, b]) => (a <= b ? { from: a, to: b } : { from: b, to: a }));

const bucketArb = fc.constantFrom(...BUCKETS);

describe("trend - Property 7: Bucket tren menjumlahkan total", () => {
  it("contoh: bucket harian menjumlahkan income dan expense sesuai summarize", () => {
    const txns: Txn[] = [
      { id: "a", type: "INCOME", amount: 1000, date: "2025-01-06", walletId: "w1" },
      { id: "b", type: "EXPENSE", amount: 400, date: "2025-01-06", walletId: "w1" },
      { id: "c", type: "EXPENSE", amount: 250, date: "2025-01-07", walletId: "w1" },
      // Transfer dan setoran Target diabaikan.
      { id: "d", type: "TRANSFER_OUT", amount: 999, date: "2025-01-06", walletId: "w1" },
      { id: "e", type: "GOAL_DEPOSIT", amount: 500, date: "2025-01-07", walletId: "w1" },
    ];
    const range: DateRange = { from: "2025-01-01", to: "2025-01-31" };

    const result = trend(txns, range, "DAY");
    expect(result).toEqual([
      { bucket: "2025-01-06", income: 1000, expense: 400 },
      { bucket: "2025-01-07", income: 0, expense: 250 },
    ]);
  });

  it("contoh: bucket mingguan dikunci pada Senin minggu tersebut", () => {
    // 2025-01-08 adalah Rabu; Senin minggu itu adalah 2025-01-06.
    const txns: Txn[] = [
      { id: "a", type: "EXPENSE", amount: 300, date: "2025-01-08", walletId: "w1" },
      { id: "b", type: "INCOME", amount: 700, date: "2025-01-10", walletId: "w1" },
    ];
    const range: DateRange = { from: "2025-01-01", to: "2025-01-31" };

    const result = trend(txns, range, "WEEK");
    expect(result).toEqual([{ bucket: "2025-01-06", income: 700, expense: 300 }]);
  });

  it("contoh: bucket bulanan memakai prefiks YYYY-MM", () => {
    const txns: Txn[] = [
      { id: "a", type: "EXPENSE", amount: 300, date: "2025-01-20", walletId: "w1" },
      { id: "b", type: "EXPENSE", amount: 150, date: "2025-02-03", walletId: "w1" },
    ];
    const range: DateRange = { from: "2025-01-01", to: "2025-12-31" };

    const result = trend(txns, range, "MONTH");
    expect(result).toEqual([
      { bucket: "2025-01", income: 0, expense: 300 },
      { bucket: "2025-02", income: 0, expense: 150 },
    ]);
  });

  /**
   * Validates: Requirements 8.3
   */
  it("properti: jumlah income dan expense seluruh bucket sama dengan summarize untuk tiap jenis bucket", () => {
    fc.assert(
      fc.property(
        fc.array(txnArb, { maxLength: 40 }),
        rangeArb,
        bucketArb,
        (txns, range, bucket) => {
          const buckets = trend(txns, range, bucket);
          const totals = summarize(txns, range);

          const incomeSum = buckets.reduce((acc, b) => acc + b.income, 0);
          const expenseSum = buckets.reduce((acc, b) => acc + b.expense, 0);

          expect(incomeSum).toBe(totals.income);
          expect(expenseSum).toBe(totals.expense);
        },
      ),
    );
  });

  /**
   * Validates: Requirements 8.3
   */
  it("properti: kunci bucket diurutkan menaik dan unik", () => {
    fc.assert(
      fc.property(
        fc.array(txnArb, { maxLength: 40 }),
        rangeArb,
        bucketArb,
        (txns, range, bucket) => {
          const keys = trend(txns, range, bucket).map((b) => b.bucket);
          const sorted = [...keys].sort((a, b) => a.localeCompare(b));
          expect(keys).toEqual(sorted);
          expect(new Set(keys).size).toBe(keys.length);
        },
      ),
    );
  });

  /**
   * Validates: Requirements 8.3
   */
  it("properti: bucket mingguan selalu dikunci pada Senin (weekRangeEnding.start)", () => {
    fc.assert(
      fc.property(fc.array(txnArb, { maxLength: 40 }), rangeArb, (txns, range) => {
        for (const b of trend(txns, range, "WEEK")) {
          // Kunci bucket adalah hari Senin: weekRangeEnding atas kunci itu
          // sendiri mengembalikan start yang sama (idempoten).
          expect(weekRangeEnding(b.bucket).start).toBe(b.bucket);
        }
      }),
    );
  });

  /**
   * Validates: Requirements 8.3
   */
  it("properti: tiap bucket hanya memuat total dari Transaksi dalam rentang dan abaikan transfer/setoran", () => {
    fc.assert(
      fc.property(fc.array(txnArb, { maxLength: 40 }), rangeArb, bucketArb, (txns, range, bucket) => {
        const relevant = txns.filter(
          (t) =>
            t.date >= range.from &&
            t.date <= range.to &&
            (t.type === "INCOME" || t.type === "EXPENSE"),
        );
        const buckets = trend(txns, range, bucket);
        const bucketTotal = buckets.reduce((acc, b) => acc + b.income + b.expense, 0);
        const relevantTotal = relevant.reduce((acc, t) => acc + t.amount, 0);
        expect(bucketTotal).toBe(relevantTotal);
      }),
    );
  });
});
