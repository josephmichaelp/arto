/**
 * Property 18: Isolasi data antar pemilik — repositori `ledger`.
 *
 * **Validates: Requirements 1.6, 1.8**
 *
 * Untuk sembarang jumlah pemilik dan data masing-masing yang disimpan bersama
 * dalam satu `InMemoryLedgerRepo`, operasi `get` dan `list` TIDAK PERNAH
 * mengembalikan item milik pemilik lain.
 *
 * Properti yang diuji:
 *   P18-A  `get(entity, ownerX, itemId)` mengembalikan `null` bila item tersebut
 *          dimiliki oleh `ownerY ≠ ownerX`.
 *   P18-B  `get(entity, ownerX, itemId)` mengembalikan item yang benar bila item
 *          dimiliki oleh `ownerX`.
 *   P18-C  Setiap item yang dikembalikan oleh `list(entity, ownerX)` memiliki
 *          `owner === ownerX`; tidak ada item milik pemilik lain yang bocor.
 *   P18-D  `list(entity, ownerX)` mengembalikan semua (dan hanya) item milik
 *          `ownerX`; tidak ada item milik pemilik itu yang terlewat.
 *   P18-E  Penyaring kesetaraan pada `list` diterapkan hanya atas item milik
 *          pemilik yang diminta (penyaring tidak membuka data pemilik lain).
 */

import { describe, it } from 'vitest';
import { expect } from 'vitest';
import fc from 'fast-check';
import {
  ENTITY_NAMES,
  InMemoryLedgerRepo,
  type EntityName,
  type ItemRecord,
} from './repository';

// ---------------------------------------------------------------------------
// Generator pembantu
// ---------------------------------------------------------------------------

/**
 * Menghasilkan string `<sub>::<username>` unik per indeks pemilik, mirip
 * format `ownerOf` di `shared/domain/types.ts`.
 */
function ownerString(k: number): string {
  return `sub${k}::user${k}`;
}

/**
 * Menghasilkan rekaman minimal valid untuk setiap `EntityName`. Seluruh
 * rekaman menggunakan `id` berformat `<markerPrefix><entity>-<seq>` agar
 * mudah diidentifikasi dalam laporan kegagalan.
 */
function makeItem(entity: EntityName, owner: string, prefix: string, seq: number): ItemRecord {
  const id = `${prefix}${entity}-${seq}`;
  const base: ItemRecord = { id, owner };

  switch (entity) {
    case 'Wallet':
      return { ...base, name: `W-${id}`, nameKey: id.toLowerCase(), initialBalance: 0, balance: seq * 10 };
    case 'Category':
      return { ...base, name: `C-${id}`, nameKey: id.toLowerCase(), type: 'EXPENSE' };
    case 'Transaction':
      return {
        ...base,
        type: 'EXPENSE',
        amount: seq + 1,
        date: '2025-01-01',
        month: '2025-01',
        walletId: `${prefix}Wallet-0`,
      };
    case 'Budget':
      return { ...base, categoryId: `${prefix}Category-0`, month: '2025-01', amount: 100_000 + seq };
    case 'RecurringRule':
      return {
        ...base,
        amount: 5000,
        categoryId: `${prefix}Category-0`,
        walletId: `${prefix}Wallet-0`,
        type: 'EXPENSE',
        frequency: 'MONTHLY',
        startDate: '2025-01-01',
        nextIndex: 0,
        status: 'ACTIVE',
      };
    case 'Goal':
      return { ...base, name: `Goal-${id}`, target: 1_000_000, saved: seq * 1000 };
    case 'Notification':
      return { ...base, type: 'budget80', title: `Notif-${id}` };
  }
}

// ---------------------------------------------------------------------------
// Strategi fast-check
// ---------------------------------------------------------------------------

/**
 * Menghasilkan skenario multi-pemilik: setiap pemilik memiliki 1–5 item per
 * entitas. Jumlah pemilik antara 2–5 (selalu lebih dari satu agar isolasi
 * dapat diuji).
 */
const multiOwnerScenarioArb = fc
  .integer({ min: 2, max: 5 })
  .chain((numOwners) =>
    fc.tuple(
      ...Array.from({ length: numOwners }, (_, k) =>
        fc.record({
          ownerIndex: fc.constant(k),
          itemsPerEntity: fc.record(
            Object.fromEntries(ENTITY_NAMES.map((e) => [e, fc.integer({ min: 0, max: 5 })])) as {
              [K in EntityName]: fc.Arbitrary<number>;
            },
          ),
        }),
      ),
    ),
  );

// ---------------------------------------------------------------------------
// Uji
// ---------------------------------------------------------------------------

describe('Property 18: Isolasi pemilik pada InMemoryLedgerRepo (get & list)', () => {
  it('P18-A: get mengembalikan null untuk item milik pemilik lain', async () => {
    await fc.assert(
      fc.asyncProperty(multiOwnerScenarioArb, async (ownerShapes) => {
        // Bangun semua rekaman dan seed repositori.
        const allItems: Partial<Record<EntityName, ItemRecord[]>> = {};
        const ownerItems: Array<{ owner: string; items: Partial<Record<EntityName, ItemRecord[]>> }> =
          ownerShapes.map((shape) => {
            const owner = ownerString(shape.ownerIndex);
            const prefix = `O${shape.ownerIndex}_`;
            const perOwner: Partial<Record<EntityName, ItemRecord[]>> = {};
            for (const entity of ENTITY_NAMES) {
              const count = shape.itemsPerEntity[entity];
              const records = Array.from({ length: count }, (_, seq) =>
                makeItem(entity, owner, prefix, seq),
              );
              perOwner[entity] = records;
              allItems[entity] = [...(allItems[entity] ?? []), ...records];
            }
            return { owner, items: perOwner };
          });

        const repo = new InMemoryLedgerRepo(allItems as Record<EntityName, ItemRecord[]>);

        // Untuk setiap pemilik, coba `get` dengan semua item milik pemilik LAIN.
        for (const { owner, items } of ownerItems) {
          for (const otherOwner of ownerItems) {
            if (otherOwner.owner === owner) continue;
            for (const entity of ENTITY_NAMES) {
              for (const item of otherOwner.items[entity] ?? []) {
                const result = await repo.get(entity, owner, item.id);
                // P18-A: harus null — tidak boleh mengembalikan item orang lain.
                expect(result, `get('${entity}', '${owner}', '${item.id}') seharusnya null`).toBeNull();
              }
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('P18-B: get mengembalikan item yang benar untuk pemilik yang sah', async () => {
    await fc.assert(
      fc.asyncProperty(multiOwnerScenarioArb, async (ownerShapes) => {
        const allItems: Partial<Record<EntityName, ItemRecord[]>> = {};
        const ownerItems: Array<{ owner: string; items: Partial<Record<EntityName, ItemRecord[]>> }> =
          ownerShapes.map((shape) => {
            const owner = ownerString(shape.ownerIndex);
            const prefix = `O${shape.ownerIndex}_`;
            const perOwner: Partial<Record<EntityName, ItemRecord[]>> = {};
            for (const entity of ENTITY_NAMES) {
              const count = shape.itemsPerEntity[entity];
              const records = Array.from({ length: count }, (_, seq) =>
                makeItem(entity, owner, prefix, seq),
              );
              perOwner[entity] = records;
              allItems[entity] = [...(allItems[entity] ?? []), ...records];
            }
            return { owner, items: perOwner };
          });

        const repo = new InMemoryLedgerRepo(allItems as Record<EntityName, ItemRecord[]>);

        for (const { owner, items } of ownerItems) {
          for (const entity of ENTITY_NAMES) {
            for (const item of items[entity] ?? []) {
              const result = await repo.get(entity, owner, item.id);
              // P18-B: item milik sendiri harus dikembalikan.
              expect(result, `get('${entity}', '${owner}', '${item.id}') seharusnya tidak null`).not.toBeNull();
              expect(result!.id).toBe(item.id);
              expect(result!.owner).toBe(owner);
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('P18-C: setiap item hasil list memiliki owner yang sesuai (tidak bocor ke pemilik lain)', async () => {
    await fc.assert(
      fc.asyncProperty(multiOwnerScenarioArb, async (ownerShapes) => {
        const allItems: Partial<Record<EntityName, ItemRecord[]>> = {};
        const ownerItems: Array<{ owner: string }> = ownerShapes.map((shape) => {
          const owner = ownerString(shape.ownerIndex);
          const prefix = `O${shape.ownerIndex}_`;
          for (const entity of ENTITY_NAMES) {
            const count = shape.itemsPerEntity[entity];
            const records = Array.from({ length: count }, (_, seq) =>
              makeItem(entity, owner, prefix, seq),
            );
            allItems[entity] = [...(allItems[entity] ?? []), ...records];
          }
          return { owner };
        });

        const repo = new InMemoryLedgerRepo(allItems as Record<EntityName, ItemRecord[]>);

        for (const { owner } of ownerItems) {
          for (const entity of ENTITY_NAMES) {
            const results = await repo.list(entity, owner);
            // P18-C: setiap hasil harus memiliki owner yang diminta.
            for (const item of results) {
              expect(
                item.owner,
                `list('${entity}', '${owner}') mengembalikan item milik '${item.owner}'`,
              ).toBe(owner);
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('P18-D: list mengembalikan tepat semua item milik pemilik (tidak ada yang terlewat)', async () => {
    await fc.assert(
      fc.asyncProperty(multiOwnerScenarioArb, async (ownerShapes) => {
        const allItems: Partial<Record<EntityName, ItemRecord[]>> = {};
        const ownerItems: Array<{ owner: string; items: Partial<Record<EntityName, ItemRecord[]>> }> =
          ownerShapes.map((shape) => {
            const owner = ownerString(shape.ownerIndex);
            const prefix = `O${shape.ownerIndex}_`;
            const perOwner: Partial<Record<EntityName, ItemRecord[]>> = {};
            for (const entity of ENTITY_NAMES) {
              const count = shape.itemsPerEntity[entity];
              const records = Array.from({ length: count }, (_, seq) =>
                makeItem(entity, owner, prefix, seq),
              );
              perOwner[entity] = records;
              allItems[entity] = [...(allItems[entity] ?? []), ...records];
            }
            return { owner, items: perOwner };
          });

        const repo = new InMemoryLedgerRepo(allItems as Record<EntityName, ItemRecord[]>);

        for (const { owner, items } of ownerItems) {
          for (const entity of ENTITY_NAMES) {
            const expected = new Set((items[entity] ?? []).map((r) => r.id));
            const results = await repo.list(entity, owner);
            const got = new Set(results.map((r) => r.id));
            // P18-D: himpunan id harus sama persis.
            expect(got).toEqual(expected);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('P18-E: penyaring kesetaraan pada list tidak membuka data pemilik lain', async () => {
    /**
     * Dua pemilik memiliki Transaction dengan `month` yang SAMA. Penyaring
     * `{ month }` pada list untuk pemilik A tidak boleh mengembalikan
     * Transaksi pemilik B, meski nilai `month`-nya cocok.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 4 }),
        fc.constantFrom('2025-01', '2025-02', '2025-03'),
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        async (numOwners, sharedMonth, countA, countB) => {
          const owners = Array.from({ length: numOwners }, (_, k) => ownerString(k));

          const allTxns: ItemRecord[] = [];
          const ownedCounts: number[] = [];

          owners.forEach((owner, k) => {
            const prefix = `O${k}_`;
            // Ogni proprietario ottiene un numero di transazioni con lo stesso mese.
            const count = k === 0 ? countA : k === 1 ? countB : Math.max(1, (k + 1) * 2);
            ownedCounts.push(count);
            for (let seq = 0; seq < count; seq++) {
              allTxns.push({
                id: `${prefix}Transaction-${seq}`,
                owner,
                type: 'EXPENSE',
                amount: seq + 1,
                date: `${sharedMonth}-01`,
                month: sharedMonth,
                walletId: `${prefix}Wallet-0`,
              });
            }
          });

          const repo = new InMemoryLedgerRepo({ Transaction: allTxns });

          for (let k = 0; k < owners.length; k++) {
            const owner = owners[k]!;
            const results = await repo.list('Transaction', owner, { month: sharedMonth });
            // Ogni risultato deve appartenere al proprietario richiesto.
            for (const item of results) {
              expect(
                item.owner,
                `list con filtro month='${sharedMonth}' per '${owner}' restituisce item di '${item.owner}'`,
              ).toBe(owner);
            }
            // Il numero di risultati deve corrispondere a quelli dell'owner k.
            expect(results.length).toBe(ownedCounts[k]);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
