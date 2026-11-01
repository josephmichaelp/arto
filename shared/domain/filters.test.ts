import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { applyFilters, paginate, sortByDateDesc } from "./filters";
import type { TxnFilter } from "./filters";
import type { Txn, TxnType } from "./types";

const txnTypes: TxnType[] = [
  "EXPENSE",
  "INCOME",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "GOAL_DEPOSIT",
];

/** Arbitrary string pendek untuk ID Kategori/Dompet (ruang kecil agar sering cocok). */
const smallId = fc.constantFrom("a", "b", "c");

/** Arbitrary tanggal YYYY-MM-DD dalam rentang kecil untuk sering tumpang tindih. */
const smallDate = fc
  .integer({ min: 1, max: 9 })
  .map((d) => `2024-01-0${d}`);

const keywordWord = fc.constantFrom("kopi", "makan", "gaji");

/** Arbitrary Transaksi dengan ruang nilai kecil agar filter sering cocok/tidak cocok. */
const txnArb: fc.Arbitrary<Txn> = fc.record({
  id: fc.uuid(),
  type: fc.constantFrom(...txnTypes),
  amount: fc.integer({ min: 1, max: 1_000_000 }),
  date: smallDate,
  categoryId: fc.option(smallId, { nil: undefined }),
  walletId: smallId,
  note: fc.option(
    fc
      .array(keywordWord, { minLength: 0, maxLength: 3 })
      .map((words) => words.join(" ")),
    { nil: undefined },
  ),
});

/** Arbitrary TxnFilter yang hanya mengisi sebagian field (sebagian undefined). */
const filterArb: fc.Arbitrary<TxnFilter> = fc.record(
  {
    keyword: keywordWord,
    categoryId: smallId,
    walletId: smallId,
    type: fc.constantFrom(...txnTypes),
    from: smallDate,
    to: smallDate,
  },
  { requiredKeys: [] },
);

/** Menormalkan field opsional string kosong menjadi undefined, meniru input UI nyata. */
function matchesFilter(txn: Txn, f: TxnFilter): boolean {
  const keyword = f.keyword?.trim().toLowerCase();
  if (keyword && !(txn.note ?? "").toLowerCase().includes(keyword)) {
    return false;
  }
  if (f.categoryId && txn.categoryId !== f.categoryId) {
    return false;
  }
  if (f.walletId && txn.walletId !== f.walletId) {
    return false;
  }
  if (f.type && txn.type !== f.type) {
    return false;
  }
  if (f.from && txn.date < f.from) {
    return false;
  }
  if (f.to && txn.date > f.to) {
    return false;
  }
  return true;
}

describe("applyFilters - Property 20: Filter transaksi bersifat konjungtif", () => {
  it("contoh: filter Kategori dan jenis sekaligus hanya menyisakan Transaksi yang cocok keduanya", () => {
    const txns: Txn[] = [
      { id: "1", type: "EXPENSE", amount: 1000, date: "2024-01-01", categoryId: "a", walletId: "w" },
      { id: "2", type: "INCOME", amount: 2000, date: "2024-01-02", categoryId: "a", walletId: "w" },
      { id: "3", type: "EXPENSE", amount: 3000, date: "2024-01-03", categoryId: "b", walletId: "w" },
    ];
    expect(applyFilters(txns, { categoryId: "a", type: "EXPENSE" })).toEqual([
      txns[0],
    ]);
  });

  it("contoh: filter kosong (semua undefined) mengembalikan seluruh Transaksi tanpa perubahan", () => {
    const txns: Txn[] = [
      { id: "1", type: "EXPENSE", amount: 1000, date: "2024-01-01", walletId: "w" },
      { id: "2", type: "INCOME", amount: 2000, date: "2024-01-02", walletId: "w" },
    ];
    expect(applyFilters(txns, {})).toEqual(txns);
  });

  /**
   * Validates: Requirements 2.6
   */
  it("properti: hasil tepat sama dengan Transaksi yang memenuhi seluruh filter aktif sekaligus", () => {
    fc.assert(
      fc.property(fc.array(txnArb, { maxLength: 30 }), filterArb, (txns, filter) => {
        const result = applyFilters(txns, filter);
        const expected = txns.filter((t) => matchesFilter(t, filter));
        expect(result).toEqual(expected);
      }),
    );
  });

  /**
   * Validates: Requirements 2.6
   */
  it("properti: menambah satu filter aktif tidak pernah memperbesar hasil", () => {
    fc.assert(
      fc.property(
        fc.array(txnArb, { maxLength: 30 }),
        filterArb,
        fc.constantFrom<keyof TxnFilter>(
          "keyword",
          "categoryId",
          "walletId",
          "type",
          "from",
          "to",
        ),
        (txns, rawBaseFilter, extraKey) => {
          // extraKey harus benar-benar baru (bukan menimpa filter yang sudah aktif),
          // agar perubahan ini murni "menambah filter", bukan mengubah nilainya.
          const baseFilter = { ...rawBaseFilter };
          delete baseFilter[extraKey];

          const before = applyFilters(txns, baseFilter);

          let extraValue: TxnFilter[keyof TxnFilter];
          switch (extraKey) {
            case "keyword":
              extraValue = "kopi";
              break;
            case "categoryId":
            case "walletId":
              extraValue = "a";
              break;
            case "type":
              extraValue = "EXPENSE";
              break;
            case "from":
            case "to":
              extraValue = "2024-01-05";
              break;
          }

          const after = applyFilters(txns, { ...baseFilter, [extraKey]: extraValue });
          const beforeIds = new Set(before.map((t) => t.id));
          const afterIds = new Set(after.map((t) => t.id));

          expect(after.length).toBeLessThanOrEqual(before.length);
          for (const id of afterIds) {
            expect(beforeIds.has(id)).toBe(true);
          }
        },
      ),
    );
  });

  /**
   * Validates: Requirements 2.6
   */
  it("properti: setiap Transaksi pada hasil lolos setiap filter aktif satu per satu", () => {
    fc.assert(
      fc.property(fc.array(txnArb, { maxLength: 30 }), filterArb, (txns, filter) => {
        const result = applyFilters(txns, filter);
        for (const txn of result) {
          if (filter.keyword?.trim()) {
            expect((txn.note ?? "").toLowerCase()).toContain(
              filter.keyword.trim().toLowerCase(),
            );
          }
          if (filter.categoryId) {
            expect(txn.categoryId).toBe(filter.categoryId);
          }
          if (filter.walletId) {
            expect(txn.walletId).toBe(filter.walletId);
          }
          if (filter.type) {
            expect(txn.type).toBe(filter.type);
          }
          if (filter.from) {
            expect(txn.date >= filter.from).toBe(true);
          }
          if (filter.to) {
            expect(txn.date <= filter.to).toBe(true);
          }
        }
      }),
    );
  });
});

describe("sortByDateDesc & paginate - Property 21: Urutan dan halaman daftar transaksi", () => {
  it("contoh: mengurutkan beberapa Transaksi dari tanggal terbaru", () => {
    const txns: Txn[] = [
      { id: "1", type: "EXPENSE", amount: 1000, date: "2024-01-01", walletId: "w" },
      { id: "2", type: "EXPENSE", amount: 2000, date: "2024-01-03", walletId: "w" },
      { id: "3", type: "EXPENSE", amount: 3000, date: "2024-01-02", walletId: "w" },
    ];
    expect(sortByDateDesc(txns).map((t) => t.id)).toEqual(["2", "3", "1"]);
  });

  it("contoh: paginate ukuran 20 membagi 45 item menjadi 3 halaman (20, 20, 5) dengan hasMore yang benar", () => {
    const items = Array.from({ length: 45 }, (_, i) => i);
    const page1 = paginate(items, 1);
    const page2 = paginate(items, 2);
    const page3 = paginate(items, 3);
    expect(page1).toEqual({ items: items.slice(0, 20), hasMore: true });
    expect(page2).toEqual({ items: items.slice(20, 40), hasMore: true });
    expect(page3).toEqual({ items: items.slice(40, 45), hasMore: false });
  });

  /**
   * Validates: Requirements 2.5
   */
  it("properti: sortByDateDesc menghasilkan urutan tanggal tak menaik", () => {
    fc.assert(
      fc.property(fc.array(txnArb, { maxLength: 30 }), (txns) => {
        const sorted = sortByDateDesc(txns);
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i - 1]!.date >= sorted[i]!.date).toBe(true);
        }
      }),
    );
  });

  /**
   * Validates: Requirements 2.5
   */
  it("properti: sortByDateDesc adalah permutasi dari daftar asal (tanpa duplikat atau kehilangan)", () => {
    fc.assert(
      fc.property(fc.array(txnArb, { maxLength: 30 }), (txns) => {
        const sorted = sortByDateDesc(txns);
        expect(sorted.map((t) => t.id).sort()).toEqual(
          txns.map((t) => t.id).sort(),
        );
        expect(sorted).toHaveLength(txns.length);
      }),
    );
  });

  /**
   * Validates: Requirements 2.5
   */
  it("properti: setiap halaman berisi paling banyak 20 item", () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { maxLength: 100 }),
        fc.integer({ min: 1, max: 10 }),
        (items, page) => {
          const result = paginate(items, page);
          expect(result.items.length).toBeLessThanOrEqual(20);
        },
      ),
    );
  });

  /**
   * Validates: Requirements 2.5
   */
  it("properti: menggabungkan seluruh halaman berurutan merekonstruksi daftar tanpa duplikat atau kehilangan", () => {
    fc.assert(
      fc.property(fc.array(fc.uuid(), { maxLength: 100 }), (items) => {
        const reconstructed: string[] = [];
        let page = 1;
        for (;;) {
          const result = paginate(items, page);
          reconstructed.push(...result.items);
          if (!result.hasMore) {
            break;
          }
          page += 1;
        }
        expect(reconstructed).toEqual(items);
      }),
    );
  });

  /**
   * Validates: Requirements 2.5
   */
  it("properti: hasMore benar hanya ketika masih ada item setelah halaman ini", () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { maxLength: 100 }),
        fc.integer({ min: 1, max: 10 }),
        (items, page) => {
          const result = paginate(items, page);
          const expectedHasMore = page * 20 < items.length;
          expect(result.hasMore).toBe(expectedHasMore);
        },
      ),
    );
  });
});
