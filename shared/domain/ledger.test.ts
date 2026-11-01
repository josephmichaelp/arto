import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { applyEvents, type LedgerEvent } from "./ledger";
import type { Rupiah, Txn, TxnType, Wallet } from "./types";

/** Daftar id Dompet tetap yang dipakai oleh generator peristiwa. */
const WALLET_IDS = ["w1", "w2", "w3"] as const;

/** Arbitrary id Dompet dari daftar tetap. */
const walletId = fc.constantFrom(...WALLET_IDS);

/** Arbitrary saldo awal Dompet (boleh negatif, lihat K-4). */
const balance = fc.integer({ min: -1_000_000, max: 1_000_000 });

/** Arbitrary kumpulan Dompet awal dengan id dari WALLET_IDS dan saldo acak. */
const walletsArb: fc.Arbitrary<Wallet[]> = fc
  .tuple(balance, balance, balance)
  .map(([b1, b2, b3]) => [
    { id: WALLET_IDS[0], name: WALLET_IDS[0], initialBalance: b1, balance: b1 },
    { id: WALLET_IDS[1], name: WALLET_IDS[1], initialBalance: b2, balance: b2 },
    { id: WALLET_IDS[2], name: WALLET_IDS[2], initialBalance: b3, balance: b3 },
  ]);

/** Arbitrary TxnType. */
const txnType: fc.Arbitrary<TxnType> = fc.constantFrom(
  "EXPENSE",
  "INCOME",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "GOAL_DEPOSIT",
);

/** Arbitrary nominal Transaksi lebih dari 0. */
const amount: fc.Arbitrary<Rupiah> = fc.integer({ min: 1, max: 1_000_000 });

/** Arbitrary Txn dengan walletId dari WALLET_IDS. */
let txnCounter = 0;
const txnArb: fc.Arbitrary<Txn> = fc
  .tuple(txnType, amount, walletId)
  .map(([type, amt, wid]) => ({
    id: `t${txnCounter++}`,
    type,
    amount: amt,
    date: "2025-01-01",
    walletId: wid,
  }));

/** Arbitrary LedgerEvent dari seluruh jenis peristiwa yang didukung. */
const ledgerEventArb: fc.Arbitrary<LedgerEvent> = fc.oneof(
  txnArb.map((txn): LedgerEvent => ({ kind: "create", txn })),
  txnArb.map((txn): LedgerEvent => ({ kind: "delete", txn })),
  fc
    .tuple(txnArb, txnArb)
    .map(([before, after]): LedgerEvent => ({ kind: "update", before, after })),
  fc
    .tuple(walletId, walletId, amount)
    .filter(([from, to]) => from !== to)
    .map(([from, to, amt]): LedgerEvent => ({ kind: "transfer", from, to, amount: amt })),
  fc
    .tuple(walletId, amount)
    .map(([wid, amt]): LedgerEvent => ({ kind: "goalDeposit", walletId: wid, amount: amt })),
);

/**
 * Tanda delta saldo per jenis Transaksi, dihitung ulang secara independen
 * dari implementasi `ledger.ts` sebagai model acuan untuk Properti 3.
 */
function modelSignedAmount(type: TxnType, amt: Rupiah): Rupiah {
  switch (type) {
    case "INCOME":
    case "TRANSFER_IN":
      return amt;
    case "EXPENSE":
    case "TRANSFER_OUT":
    case "GOAL_DEPOSIT":
      return -amt;
    default:
      return 0;
  }
}

/**
 * Menghitung peta delta saldo per id Dompet dari seluruh peristiwa,
 * mengikuti definisi Properti 3 pada design.md: saldo akhir SHALL sama
 * dengan saldo awal ditambah total pemasukan dikurangi total pengeluaran
 * dari Transaksi yang masih ada (termasuk efek transfer dan setoran).
 */
function modelDeltas(events: LedgerEvent[]): Record<string, number> {
  const deltas: Record<string, number> = {};
  const add = (id: string, d: number) => {
    deltas[id] = (deltas[id] ?? 0) + d;
  };
  for (const event of events) {
    switch (event.kind) {
      case "create":
        add(event.txn.walletId, modelSignedAmount(event.txn.type, event.txn.amount));
        break;
      case "delete":
        add(event.txn.walletId, -modelSignedAmount(event.txn.type, event.txn.amount));
        break;
      case "update":
        add(event.before.walletId, -modelSignedAmount(event.before.type, event.before.amount));
        add(event.after.walletId, modelSignedAmount(event.after.type, event.after.amount));
        break;
      case "transfer":
        add(event.from, -event.amount);
        add(event.to, event.amount);
        break;
      case "goalDeposit":
        add(event.walletId, -event.amount);
        break;
    }
  }
  return deltas;
}

describe("applyEvents - Property 3: Saldo Dompet konsisten dengan riwayat operasi", () => {
  it("contoh: create menambah saldo, delete mengembalikan ke semula", () => {
    const wallets: Wallet[] = [{ id: "w1", name: "Tunai", initialBalance: 1000, balance: 1000 }];
    const txn: Txn = { id: "t1", type: "EXPENSE", amount: 200, date: "2025-01-01", walletId: "w1" };

    const afterCreate = applyEvents(wallets, [{ kind: "create", txn }]);
    expect(afterCreate[0]?.balance).toBe(800);

    const afterDelete = applyEvents(afterCreate, [{ kind: "delete", txn }]);
    expect(afterDelete[0]?.balance).toBe(1000);
  });

  it("contoh: update menghitung ulang saldo Dompet yang terdampak", () => {
    const wallets: Wallet[] = [
      { id: "w1", name: "Tunai", initialBalance: 1000, balance: 1000 },
      { id: "w2", name: "Bank", initialBalance: 500, balance: 500 },
    ];
    const before: Txn = { id: "t1", type: "EXPENSE", amount: 200, date: "2025-01-01", walletId: "w1" };
    const after: Txn = { id: "t1", type: "EXPENSE", amount: 300, date: "2025-01-01", walletId: "w2" };

    const result = applyEvents(wallets, [{ kind: "update", before, after }]);
    // Membalik delta "before" (expense 200 di w1) dan menerapkan delta "after" (expense 300 di w2).
    expect(result.find((w) => w.id === "w1")?.balance).toBe(1200);
    expect(result.find((w) => w.id === "w2")?.balance).toBe(200);
  });

  /**
   * Validates: Requirements 2.1, 2.2, 2.3, 4.1, 4.2
   */
  it("properti: saldo akhir setiap Dompet sama dengan saldo awal ditambah total delta dari seluruh peristiwa", () => {
    fc.assert(
      fc.property(walletsArb, fc.array(ledgerEventArb, { maxLength: 15 }), (wallets, events) => {
        const result = applyEvents(wallets, events);
        const deltas = modelDeltas(events);

        for (const initial of wallets) {
          const expected = initial.balance + (deltas[initial.id] ?? 0);
          const actual = result.find((w) => w.id === initial.id)?.balance;
          expect(actual).toBe(expected);
        }
      }),
    );
  });

  /**
   * Validates: Requirements 2.1, 2.2, 2.3
   */
  it("properti: menghapus Transaksi mengembalikan saldo ke nilai sebelum Transaksi dibuat", () => {
    fc.assert(
      fc.property(walletsArb, txnArb, (wallets, txn) => {
        const afterCreate = applyEvents(wallets, [{ kind: "create", txn }]);
        const afterDelete = applyEvents(afterCreate, [{ kind: "delete", txn }]);

        expect(afterDelete).toEqual(wallets);
      }),
    );
  });

  /**
   * Validates: Requirements 4.1, 4.2
   */
  it("properti: Dompet yang tidak disentuh peristiwa apa pun tetap bersaldo semula", () => {
    fc.assert(
      fc.property(walletsArb, fc.array(ledgerEventArb, { maxLength: 15 }), (wallets, events) => {
        const result = applyEvents(wallets, events);
        const touchedIds = new Set(Object.keys(modelDeltas(events)));

        for (const initial of wallets) {
          if (!touchedIds.has(initial.id)) {
            expect(result.find((w) => w.id === initial.id)?.balance).toBe(initial.balance);
          }
        }
      }),
    );
  });
});

import { planTransfer } from "./ledger";

/** Arbitrary dua Dompet berbeda dengan saldo acak (boleh negatif, lihat K-4). */
const twoDistinctWalletsArb: fc.Arbitrary<[Wallet, Wallet]> = fc
  .tuple(
    fc.constantFrom(...WALLET_IDS),
    fc.constantFrom(...WALLET_IDS),
    balance,
    balance,
  )
  .filter(([id1, id2]) => id1 !== id2)
  .map(([id1, id2, b1, b2]) => [
    { id: id1, name: id1, initialBalance: b1, balance: b1 },
    { id: id2, name: id2, initialBalance: b2, balance: b2 },
  ]);

/** Arbitrary nominal lebih dari 0 yang boleh melebihi batas saldo acak. */
const transferAmountArb: fc.Arbitrary<Rupiah> = fc.integer({ min: 1, max: 2_000_000 });

describe("planTransfer - Property 4: Transfer dan setoran menjaga total dan menolak saldo kurang", () => {
  it("contoh: transfer yang cukup saldo mengurangi asal dan menambah tujuan dengan nominal sama", () => {
    const src: Wallet = { id: "w1", name: "Tunai", initialBalance: 1000, balance: 1000 };
    const dst: Wallet = { id: "w2", name: "Bank", initialBalance: 200, balance: 200 };

    const result = planTransfer(src, dst, 300);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.src.balance).toBe(700);
      expect(result.dst.balance).toBe(500);
    }
  });

  it("contoh: transfer yang melebihi saldo asal ditolak dengan INSUFFICIENT_BALANCE", () => {
    const src: Wallet = { id: "w1", name: "Tunai", initialBalance: 100, balance: 100 };
    const dst: Wallet = { id: "w2", name: "Bank", initialBalance: 0, balance: 0 };

    const result = planTransfer(src, dst, 101);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INSUFFICIENT_BALANCE");
    }
  });

  it("contoh: nominal nol atau negatif ditolak dengan AMOUNT_INVALID", () => {
    const src: Wallet = { id: "w1", name: "Tunai", initialBalance: 1000, balance: 1000 };
    const dst: Wallet = { id: "w2", name: "Bank", initialBalance: 0, balance: 0 };

    expect(planTransfer(src, dst, 0).ok).toBe(false);
    expect(planTransfer(src, dst, -50).ok).toBe(false);
  });

  /**
   * Validates: Requirements 4.3, 7.2
   */
  it("properti: transfer yang berhasil mengurangi asal dan menambah tujuan dengan nominal sama sehingga total tidak berubah", () => {
    fc.assert(
      fc.property(twoDistinctWalletsArb, transferAmountArb, ([src, dst], amount) => {
        fc.pre(amount <= src.balance);

        const result = planTransfer(src, dst, amount);
        const totalBefore = src.balance + dst.balance;

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.src.balance).toBe(src.balance - amount);
          expect(result.dst.balance).toBe(dst.balance + amount);
          expect(result.src.balance + result.dst.balance).toBe(totalBefore);
        }
      }),
    );
  });

  /**
   * Validates: Requirements 4.4, 7.6
   */
  it("properti: transfer dengan nominal melebihi saldo asal ditolak dan tidak mengubah saldo Dompet masukan", () => {
    fc.assert(
      fc.property(twoDistinctWalletsArb, transferAmountArb, ([src, dst], amount) => {
        fc.pre(amount > src.balance);

        const srcBefore = { ...src };
        const dstBefore = { ...dst };
        const result = planTransfer(src, dst, amount);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe("INSUFFICIENT_BALANCE");
        }
        // planTransfer murni: Dompet masukan tidak boleh dimutasi.
        expect(src).toEqual(srcBefore);
        expect(dst).toEqual(dstBefore);
      }),
    );
  });

  /**
   * Validates: Requirements 4.3, 4.4, 7.2, 7.6
   */
  it("properti: nominal tidak lebih dari 0 selalu ditolak dengan AMOUNT_INVALID, apa pun saldonya", () => {
    fc.assert(
      fc.property(
        twoDistinctWalletsArb,
        fc.integer({ min: -1_000_000, max: 0 }),
        ([src, dst], amount) => {
          const result = planTransfer(src, dst, amount);

          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.code).toBe("AMOUNT_INVALID");
          }
        },
      ),
    );
  });

  /**
   * Validates: Requirements 4.3, 7.2
   */
  it("properti: Dompet asal dan tujuan yang sama selalu ditolak dengan SAME_WALLET", () => {
    fc.assert(
      fc.property(walletsArb, amount, (wallets, amt) => {
        const wallet = wallets[0]!;
        const result = planTransfer(wallet, wallet, amt);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe("SAME_WALLET");
        }
      }),
    );
  });
});
