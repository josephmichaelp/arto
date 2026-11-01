import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { budgetStatus, monthlySpent, thresholdCrossings } from "./budget";
import type { Budget, Rupiah, Txn, TxnType } from "./types";

/** Daftar id Kategori tetap yang dipakai generator. */
const CATEGORY_IDS = ["c1", "c2", "c3"] as const;

/** Daftar bulan tetap (YYYY-MM, WIB) yang dipakai generator. */
const MONTHS = ["2025-01", "2025-02", "2025-12"] as const;

/** Arbitrary id Kategori dari daftar tetap. */
const categoryId = fc.constantFrom(...CATEGORY_IDS);

/** Arbitrary bulan dari daftar tetap. */
const month = fc.constantFrom(...MONTHS);

/** Arbitrary jenis Transaksi dari seluruh jenis yang didukung. */
const txnType: fc.Arbitrary<TxnType> = fc.constantFrom(
  "EXPENSE",
  "INCOME",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "GOAL_DEPOSIT",
);

/** Arbitrary nominal Transaksi lebih dari 0 (K-1). */
const amount: fc.Arbitrary<Rupiah> = fc.integer({ min: 1, max: 1_000_000 });

/** Arbitrary tanggal (YYYY-MM-DD) pada salah satu bulan tetap. */
const date: fc.Arbitrary<string> = fc
  .tuple(month, fc.integer({ min: 1, max: 28 }))
  .map(([m, d]) => `${m}-${String(d).padStart(2, "0")}`);

/** Arbitrary Txn dengan Kategori, tanggal, dan jenis acak. */
let txnCounter = 0;
const txnArb: fc.Arbitrary<Txn> = fc
  .tuple(txnType, amount, date, categoryId)
  .map(([type, amt, d, cid]) => ({
    id: `t${txnCounter++}`,
    type,
    amount: amt,
    date: d,
    categoryId: cid,
    walletId: "w1",
  }));

/** Arbitrary Anggaran dengan nominal boleh 0 (untuk menguji cabang pembagi nol). */
const budgetArb: fc.Arbitrary<Budget> = fc
  .tuple(categoryId, month, fc.integer({ min: 0, max: 1_000_000 }))
  .map(([cid, m, amt]) => ({
    id: `${cid}#${m}`,
    categoryId: cid,
    month: m,
    amount: amt,
  }));

/**
 * Model acuan independen: jumlah pengeluaran pada Kategori `cid` dan bulan
 * `m` (WIB), dihitung ulang terpisah dari implementasi `budget.ts`.
 */
function modelSpent(txns: Txn[], cid: string, m: string): Rupiah {
  let total = 0;
  for (const txn of txns) {
    if (txn.type === "EXPENSE" && txn.categoryId === cid && txn.date.slice(0, 7) === m) {
      total += txn.amount;
    }
  }
  return total;
}

describe("monthlySpent - Property 8: Realisasi mengikuti bulan WIB", () => {
  it("contoh: hanya EXPENSE pada Kategori dan bulan yang cocok yang dihitung", () => {
    const txns: Txn[] = [
      { id: "t1", type: "EXPENSE", amount: 100, date: "2025-01-10", categoryId: "c1", walletId: "w1" },
      { id: "t2", type: "EXPENSE", amount: 50, date: "2025-01-20", categoryId: "c1", walletId: "w1" },
      // Bulan berbeda -> tidak dihitung.
      { id: "t3", type: "EXPENSE", amount: 999, date: "2025-02-01", categoryId: "c1", walletId: "w1" },
      // Kategori berbeda -> tidak dihitung.
      { id: "t4", type: "EXPENSE", amount: 999, date: "2025-01-05", categoryId: "c2", walletId: "w1" },
      // Bukan EXPENSE -> tidak dihitung.
      { id: "t5", type: "INCOME", amount: 999, date: "2025-01-05", categoryId: "c1", walletId: "w1" },
      { id: "t6", type: "TRANSFER_OUT", amount: 999, date: "2025-01-05", categoryId: "c1", walletId: "w1" },
      { id: "t7", type: "GOAL_DEPOSIT", amount: 999, date: "2025-01-05", categoryId: "c1", walletId: "w1" },
    ];

    expect(monthlySpent(txns, "c1", "2025-01")).toBe(150);
  });

  it("contoh: tanpa Transaksi cocok, realisasi nol", () => {
    expect(monthlySpent([], "c1", "2025-01")).toBe(0);
  });

  /**
   * Validates: Requirements 5.2
   */
  it("properti: realisasi sama dengan jumlah pengeluaran pada Kategori dan bulan Anggaran (WIB)", () => {
    fc.assert(
      fc.property(fc.array(txnArb, { maxLength: 20 }), categoryId, month, (txns, cid, m) => {
        expect(monthlySpent(txns, cid, m)).toBe(modelSpent(txns, cid, m));
      }),
    );
  });

  /**
   * Validates: Requirements 5.2
   */
  it("properti: Transaksi pada bulan lain tidak memengaruhi realisasi bulan Anggaran", () => {
    fc.assert(
      fc.property(
        fc.array(txnArb, { maxLength: 20 }),
        categoryId,
        (txns, cid) => {
          // Pisahkan Transaksi bulan target (2025-01) dari bulan lain.
          const target = "2025-01";
          const sameMonth = txns.filter((t) => t.date.slice(0, 7) === target);
          const spentAll = monthlySpent(txns, cid, target);
          const spentSameMonthOnly = monthlySpent(sameMonth, cid, target);
          expect(spentAll).toBe(spentSameMonthOnly);
        },
      ),
    );
  });

  /**
   * Validates: Requirements 5.2
   */
  it("properti: realisasi tidak pernah negatif karena nominal selalu lebih dari 0", () => {
    fc.assert(
      fc.property(fc.array(txnArb, { maxLength: 20 }), categoryId, month, (txns, cid, m) => {
        expect(monthlySpent(txns, cid, m)).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});

describe("budgetStatus - Property 8: Sisa dan persen konsisten", () => {
  it("contoh: sisa dan persen untuk Anggaran terpakai sebagian", () => {
    const b: Budget = { id: "c1#2025-01", categoryId: "c1", month: "2025-01", amount: 1000 };
    const txns: Txn[] = [
      { id: "t1", type: "EXPENSE", amount: 250, date: "2025-01-10", categoryId: "c1", walletId: "w1" },
    ];

    const status = budgetStatus(b, txns);
    expect(status.spent).toBe(250);
    expect(status.remaining).toBe(750);
    expect(status.percent).toBe(25);
    expect(status.level).toBe("OK");
  });

  it("contoh: Anggaran nominal 0 dengan pengeluaran menghasilkan persen 100 dan level OVER100", () => {
    const b: Budget = { id: "c1#2025-01", categoryId: "c1", month: "2025-01", amount: 0 };
    const txns: Txn[] = [
      { id: "t1", type: "EXPENSE", amount: 1, date: "2025-01-10", categoryId: "c1", walletId: "w1" },
    ];

    const status = budgetStatus(b, txns);
    expect(status.spent).toBe(1);
    expect(status.remaining).toBe(-1);
    expect(status.percent).toBe(100);
    expect(status.level).toBe("OVER100");
  });

  /**
   * Validates: Requirements 5.2, 5.3
   */
  it("properti: spent sama dengan monthlySpent dan remaining = amount - spent", () => {
    fc.assert(
      fc.property(budgetArb, fc.array(txnArb, { maxLength: 20 }), (b, txns) => {
        const status = budgetStatus(b, txns);
        const spent = monthlySpent(txns, b.categoryId, b.month);
        expect(status.spent).toBe(spent);
        expect(status.remaining).toBe(b.amount - spent);
      }),
    );
  });

  /**
   * Validates: Requirements 5.3
   */
  it("properti: percent konsisten dengan spent dan amount", () => {
    fc.assert(
      fc.property(budgetArb, fc.array(txnArb, { maxLength: 20 }), (b, txns) => {
        const status = budgetStatus(b, txns);
        const expected =
          b.amount > 0
            ? Math.round((status.spent * 100) / b.amount)
            : status.spent > 0
              ? 100
              : 0;
        expect(status.percent).toBe(expected);
      }),
    );
  });

  /**
   * Validates: Requirements 5.3
   */
  it("properti: level mengikuti ambang thresholdCrossings", () => {
    fc.assert(
      fc.property(budgetArb, fc.array(txnArb, { maxLength: 20 }), (b, txns) => {
        const status = budgetStatus(b, txns);
        const { warn80, over100 } = thresholdCrossings(b, status.spent);
        const expectedLevel = over100 ? "OVER100" : warn80 ? "WARN80" : "OK";
        expect(status.level).toBe(expectedLevel);
      }),
    );
  });

  /**
   * Validates: Requirements 5.2
   */
  it("properti: Transaksi pada bulan lain tidak mengubah status Anggaran", () => {
    fc.assert(
      fc.property(budgetArb, fc.array(txnArb, { maxLength: 20 }), (b, txns) => {
        const sameMonth = txns.filter((t) => t.date.slice(0, 7) === b.month);
        expect(budgetStatus(b, txns)).toEqual(budgetStatus(b, sameMonth));
      }),
    );
  });
});

describe("thresholdCrossings - perbandingan bilangan bulat", () => {
  it("contoh: ambang 80 persen memakai spent * 100 >= amount * 80", () => {
    const b: Budget = { id: "c1#2025-01", categoryId: "c1", month: "2025-01", amount: 1000 };
    // 79% -> belum warn
    expect(thresholdCrossings(b, 790)).toEqual({ warn80: false, over100: false });
    // tepat 80% -> warn
    expect(thresholdCrossings(b, 800)).toEqual({ warn80: true, over100: false });
    // tepat 100% -> warn tapi belum over (spent > amount)
    expect(thresholdCrossings(b, 1000)).toEqual({ warn80: true, over100: false });
    // di atas 100% -> over
    expect(thresholdCrossings(b, 1001)).toEqual({ warn80: true, over100: true });
  });

  /**
   * Validates: Requirements 5.3
   */
  it("properti: over100 mengimplikasikan warn80 untuk nominal Anggaran tidak negatif", () => {
    fc.assert(
      fc.property(budgetArb, fc.integer({ min: 0, max: 2_000_000 }), (b, spent) => {
        const { warn80, over100 } = thresholdCrossings(b, spent);
        if (over100) {
          expect(warn80).toBe(true);
        }
      }),
    );
  });

  /**
   * Validates: Requirements 5.3
   */
  it("properti: ambang cocok dengan definisi bilangan bulat tanpa float", () => {
    fc.assert(
      fc.property(budgetArb, fc.integer({ min: 0, max: 2_000_000 }), (b, spent) => {
        const { warn80, over100 } = thresholdCrossings(b, spent);
        expect(warn80).toBe(spent * 100 >= b.amount * 80);
        expect(over100).toBe(spent > b.amount);
      }),
    );
  });
});
