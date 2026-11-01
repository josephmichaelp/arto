import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { TxnType } from 'shared/domain';
import {
  InMemoryLedgerRepo,
  type BudgetRecord,
  type CategoryRecord,
  type ItemRecord,
  type TransactionRecord,
  type WalletRecord,
  type BaseRecord,
} from '../ledger/repository';
import { buildFinanceContext } from './assistant';
import { LedgerBackedFinanceRepo } from './handler';

/**
 * Property 18: Isolasi data antar pemilik — pembangun konteks `askAssistant`.
 *
 * **Validates: Requirements 12.3, 16.2**
 *
 * Untuk sembarang kumpulan data multi-pemilik yang disimpan bersama dalam satu
 * repositori, konteks keuangan yang dibangun untuk satu pemilik (lewat jalur
 * nyata `LedgerBackedFinanceRepo.loadAssistantData` -> `buildFinanceContext`)
 * TIDAK PERNAH memuat data pemilik lain. Pengujian memakai repositori in-memory
 * yang meniru isolasi pemilik DynamoDB, sehingga berjalan tanpa AWS.
 *
 * Strategi: setiap pemilik mendapat penanda unik (`OWN_<k>_`) yang disematkan
 * pada nama Kategori, nama Dompet, dan catatan Transaksi. Karena id global unik
 * per pemilik, repositori tidak saling menimpa. Properti memverifikasi:
 *   1. `loadAssistantData(owner)` mengembalikan TEPAT himpunan id milik pemilik
 *      itu (tidak kurang, tidak bocor milik pemilik lain).
 *   2. Teks konteks memuat penanda pemilik target namun tidak satu pun penanda
 *      pemilik lain.
 */

/** Tanggal "hari ini" tetap (WIB) agar Anggaran bulan ini ikut dirender. */
const NOW_WIB = '2025-01-15';
const MONTH = '2025-01';

const TXN_TYPES: readonly TxnType[] = [
  'EXPENSE',
  'INCOME',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'GOAL_DEPOSIT',
];

interface OwnerData {
  owner: string;
  marker: string;
  categories: CategoryRecord[];
  wallets: WalletRecord[];
  budgets: BudgetRecord[];
  txns: TransactionRecord[];
}

/** Bentuk (jumlah dan nilai acak) satu pemilik, belum terikat indeks/id global. */
const ownerShapeArb = fc.record({
  nCategories: fc.integer({ min: 1, max: 4 }),
  nWallets: fc.integer({ min: 1, max: 3 }),
  nBudgets: fc.integer({ min: 0, max: 3 }),
  txns: fc.array(
    fc.record({
      type: fc.constantFrom(...TXN_TYPES),
      amount: fc.integer({ min: 1, max: 9_999_999 }),
      day: fc.integer({ min: 1, max: 28 }),
      catIdx: fc.integer({ min: 0, max: 3 }),
      walletIdx: fc.integer({ min: 0, max: 2 }),
      // Sebagian Transaksi di bulan lain, untuk menguji bulan berjalan.
      month: fc.constantFrom('2025-01', '2024-12'),
    }),
    { minLength: 0, maxLength: 40 },
  ),
});

type OwnerShape = typeof ownerShapeArb extends fc.Arbitrary<infer T> ? T : never;

/** Membangun rekaman konkret pemilik ke-`k` dengan id dan penanda global unik. */
function buildOwner(k: number, shape: OwnerShape): OwnerData {
  const marker = `OWN_${k}_`;
  const owner = `sub-${k}::user${k}`;

  const categories: CategoryRecord[] = Array.from({ length: shape.nCategories }, (_, i) => ({
    id: `${marker}cat-${i}`,
    owner,
    name: `Kat-${marker}${i}`,
    nameKey: `kat-${marker}${i}`,
    type: i % 2 === 0 ? 'EXPENSE' : 'INCOME',
  }));

  const wallets: WalletRecord[] = Array.from({ length: shape.nWallets }, (_, i) => ({
    id: `${marker}wal-${i}`,
    owner,
    name: `Dmp-${marker}${i}`,
    nameKey: `dmp-${marker}${i}`,
    initialBalance: 0,
    balance: (i + 1) * 100_000,
  }));

  const budgets: BudgetRecord[] = Array.from({ length: shape.nBudgets }, (_, i) => ({
    id: `${marker}bud-${i}`,
    owner,
    categoryId: categories[i % categories.length]!.id,
    month: MONTH,
    amount: 500_000 + i,
  }));

  const txns: TransactionRecord[] = shape.txns.map((t, i) => {
    const cat = categories[t.catIdx % categories.length]!;
    const wal = wallets[t.walletIdx % wallets.length]!;
    return {
      id: `${marker}txn-${i}`,
      owner,
      type: t.type,
      amount: t.amount,
      date: `${t.month}-${String(t.day).padStart(2, '0')}`,
      month: t.month,
      categoryId: cat.id,
      walletId: wal.id,
      note: `Note-${marker}${i}`,
    };
  });

  return { owner, marker, categories, wallets, budgets, txns };
}

function ids(records: readonly { id: string }[]): Set<string> {
  return new Set(records.map((r) => r.id));
}

/** Rekaman entitas konkret -> `ItemRecord` (tidak memiliki index signature). */
function asItems(records: readonly BaseRecord[]): ItemRecord[] {
  return records as unknown as ItemRecord[];
}

describe('isolasi konteks AI antar pemilik (Property 18)', () => {
  it('loadAssistantData + buildFinanceContext hanya memuat data pemilik target', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(ownerShapeArb, { minLength: 2, maxLength: 4 }),
        fc.integer({ min: 0, max: 3 }),
        async (shapes, rawTarget) => {
          const owners = shapes.map((shape, k) => buildOwner(k, shape));
          const target = owners[rawTarget % owners.length]!;

          // Semua pemilik disimpan bersama dalam satu repositori (meniru satu
          // tabel per entitas yang dibagi seluruh Pengguna).
          const repo = new InMemoryLedgerRepo({
            Category: owners.flatMap((o) => asItems(o.categories)),
            Wallet: owners.flatMap((o) => asItems(o.wallets)),
            Budget: owners.flatMap((o) => asItems(o.budgets)),
            Transaction: owners.flatMap((o) => asItems(o.txns)),
          });

          const finance = new LedgerBackedFinanceRepo(repo);
          const data = await finance.loadAssistantData(target.owner);

          // 1. Pemuatan ber-scope: tepat himpunan id milik pemilik target.
          expect(ids(data.categories)).toEqual(ids(target.categories));
          expect(ids(data.wallets)).toEqual(ids(target.wallets));
          expect(ids(data.budgets)).toEqual(ids(target.budgets));
          expect(ids(data.txns)).toEqual(ids(target.txns));

          // 2. Konteks tidak memuat penanda pemilik lain, namun memuat milik target.
          const ctx = buildFinanceContext(data, NOW_WIB);
          // Pemilik selalu punya minimal satu Dompet, yang selalu dirender.
          expect(ctx).toContain(target.marker);
          for (const other of owners) {
            if (other.owner === target.owner) continue;
            expect(ctx).not.toContain(other.marker);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('konteks bergantung hanya pada data yang diberikan (pemilik lain tidak berpengaruh)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(ownerShapeArb, { minLength: 2, maxLength: 4 }),
        fc.integer({ min: 0, max: 3 }),
        async (shapes, rawTarget) => {
          const owners = shapes.map((shape, k) => buildOwner(k, shape));
          const target = owners[rawTarget % owners.length]!;

          // Repositori hanya pemilik target.
          const soloRepo = new InMemoryLedgerRepo({
            Category: asItems(target.categories),
            Wallet: asItems(target.wallets),
            Budget: asItems(target.budgets),
            Transaction: asItems(target.txns),
          });
          // Repositori seluruh pemilik.
          const sharedRepo = new InMemoryLedgerRepo({
            Category: owners.flatMap((o) => asItems(o.categories)),
            Wallet: owners.flatMap((o) => asItems(o.wallets)),
            Budget: owners.flatMap((o) => asItems(o.budgets)),
            Transaction: owners.flatMap((o) => asItems(o.txns)),
          });

          const solo = await new LedgerBackedFinanceRepo(soloRepo).loadAssistantData(target.owner);
          const shared = await new LedgerBackedFinanceRepo(sharedRepo).loadAssistantData(target.owner);

          // Konteks identik: kehadiran data pemilik lain tidak mengubah apa pun.
          expect(buildFinanceContext(shared, NOW_WIB)).toBe(buildFinanceContext(solo, NOW_WIB));
        },
      ),
      { numRuns: 200 },
    );
  });
});
