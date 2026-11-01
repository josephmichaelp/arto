import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { dueOccurrences } from 'shared/domain';
import type { Frequency, RuleLike, RuleStatus, TxnType } from 'shared/domain';
import { processRule, recurringTxnId, runRecurringRules } from './handler';
import { InMemoryLedgerRepo, type ItemRecord, type RecurringRuleRecord } from '../ledger/repository';

/**
 * Property 12: Pembuatan transaksi berulang idempoten.
 *
 * Validates: Requirements 6.2, 6.4, 6.6, 13.3
 *
 * Untuk aturan berulang apa pun dan berapa pun jumlah eksekusi
 * `recurring-runner` pada hari yang sama — termasuk eksekusi yang memakai
 * cuplikan aturan basi (`nextIndex` lama) maupun aturan yang sudah dihapus —
 * jumlah Transaksi untuk tiap jatuh tempo SHALL tepat satu, saldo Dompet SHALL
 * berubah tepat satu kali per jatuh tempo, dan aturan yang dijeda atau dihapus
 * SHALL tidak menghasilkan Transaksi baru.
 *
 * Idempotensi dijamin oleh satu `TransactWriteItems` atomik per jatuh tempo
 * dengan prasyarat `attribute_not_exists(id)` pada Transaksi; eksekusi ulang
 * membatalkan seluruh perubahan sehingga saldo tidak pernah tergandakan.
 */

const OWNER = 'sub-idem::user-idem';
const WALLET_ID = 'w1';
const RULE_ID = 'rule1';
const FREQUENCIES: Frequency[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ymdUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Tambah `days` hari ke tanggal `YYYY-MM-DD` secara UTC. */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return ymdUtc(new Date(Date.UTC(y, m - 1, d + days)));
}

/** Tanggal valid 2020-2035 (hari <= 28 agar tak perlu clamp; clamp diuji Property 11). */
const dateArb = fc
  .record({
    y: fc.integer({ min: 2020, max: 2035 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ y, m, d }) => `${y}-${pad2(m)}-${pad2(d)}`);

interface RuleSpec {
  startDate: string;
  offsetDays: number;
  nextIndex: number;
  amount: number;
  type: Exclude<TxnType, 'TRANSFER_OUT' | 'TRANSFER_IN' | 'GOAL_DEPOSIT'>;
  frequency: Frequency;
  status: RuleStatus;
  initialBalance: number;
}

const ruleSpecArb: fc.Arbitrary<RuleSpec> = fc.record({
  startDate: dateArb,
  offsetDays: fc.integer({ min: 0, max: 60 }),
  nextIndex: fc.integer({ min: 0, max: 5 }),
  amount: fc.integer({ min: 1, max: 1_000_000 }),
  type: fc.constantFrom<'EXPENSE' | 'INCOME'>('EXPENSE', 'INCOME'),
  frequency: fc.constantFrom(...FREQUENCIES),
  status: fc.constantFrom<RuleStatus>('ACTIVE', 'PAUSED'),
  initialBalance: fc.integer({ min: 0, max: 10_000_000 }),
});

function makeRule(spec: RuleSpec): RecurringRuleRecord {
  return {
    id: RULE_ID,
    owner: OWNER,
    amount: spec.amount,
    categoryId: 'cat',
    walletId: WALLET_ID,
    type: spec.type,
    frequency: spec.frequency,
    startDate: spec.startDate,
    nextIndex: spec.nextIndex,
    status: spec.status,
  };
}

function toRuleLike(rule: RecurringRuleRecord): RuleLike {
  return {
    id: rule.id,
    frequency: rule.frequency,
    startDate: rule.startDate,
    nextIndex: rule.nextIndex,
    status: rule.status,
  };
}

function seedRepo(rule: RecurringRuleRecord, initialBalance: number): InMemoryLedgerRepo {
  return new InMemoryLedgerRepo({
    Wallet: [
      {
        id: WALLET_ID,
        owner: OWNER,
        name: 'Tunai',
        nameKey: 'tunai',
        initialBalance,
        balance: initialBalance,
      },
    ],
    RecurringRule: [rule as unknown as ItemRecord],
  });
}

/** Himpunan tanggal jatuh tempo yang diharapkan dari keadaan awal aturan. */
function expectedDueDates(rule: RecurringRuleRecord, today: string): string[] {
  return dueOccurrences(toRuleLike(rule), today).map((o) => o.date);
}

describe('Property 12: idempotensi pembuatan transaksi berulang', () => {
  it('eksekusi berulang (cuplikan basi / jumlah run sembarang) tak pernah menggandakan Transaksi atau saldo', async () => {
    await fc.assert(
      fc.asyncProperty(
        ruleSpecArb,
        // Tiap elemen = satu eksekusi runner; true berarti memakai cuplikan basi (nextIndex awal).
        fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }),
        async (spec, staleFlags) => {
          const original = makeRule(spec);
          const today = addDays(spec.startDate, spec.offsetDays);
          const repo = seedRepo(original, spec.initialBalance);

          const expected = spec.status === 'ACTIVE' ? expectedDueDates(original, today) : [];
          const delta = spec.type === 'EXPENSE' ? -spec.amount : spec.amount;

          for (const useStale of staleFlags) {
            const snapshot = useStale
              ? { ...original }
              : (await repo.get('RecurringRule', OWNER, RULE_ID))!;
            await processRule(repo, snapshot, today);
          }

          const txns = repo.dump('Transaction');

          // Tepat satu Transaksi per jatuh tempo, dengan ID deterministik.
          expect(txns).toHaveLength(expected.length);
          const ids = new Set(txns.map((t) => t.id));
          expect(ids.size).toBe(expected.length);
          for (const date of expected) {
            expect(ids.has(recurringTxnId(RULE_ID, date))).toBe(true);
          }

          // Saldo berubah tepat sekali per jatuh tempo (nol untuk aturan dijeda).
          const wallet = await repo.get('Wallet', OWNER, WALLET_ID);
          expect(wallet?.balance).toBe(spec.initialBalance + delta * expected.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('aturan yang dihapus di tengah eksekusi tak menambah Transaksi baru maupun saldo', async () => {
    await fc.assert(
      fc.asyncProperty(
        ruleSpecArb.filter((s) => s.status === 'ACTIVE'),
        fc.integer({ min: 1, max: 4 }),
        async (spec, extraRuns) => {
          const original = makeRule({ ...spec, status: 'ACTIVE' });
          const today = addDays(spec.startDate, spec.offsetDays);
          const repo = seedRepo(original, spec.initialBalance);

          const expected = expectedDueDates(original, today);
          const delta = spec.type === 'EXPENSE' ? -spec.amount : spec.amount;

          // Eksekusi pertama membuat seluruh jatuh tempo.
          await processRule(repo, { ...original }, today);
          const afterFirst = repo.dump('Transaction').length;
          expect(afterFirst).toBe(expected.length);

          // Hapus aturan, lalu jalankan lagi memakai cuplikan basi.
          await repo.delete('RecurringRule', RULE_ID);
          for (let i = 0; i < extraRuns; i += 1) {
            await processRule(repo, { ...original }, today);
          }

          const txns = repo.dump('Transaction');
          expect(txns).toHaveLength(expected.length);
          expect(new Set(txns.map((t) => t.id)).size).toBe(expected.length);

          const wallet = await repo.get('Wallet', OWNER, WALLET_ID);
          expect(wallet?.balance).toBe(spec.initialBalance + delta * expected.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('batch lintas pemilik lewat runRecurringRules tetap idempoten per aturan', async () => {
    // Satu aturan per pemilik, dengan `startDate = batchToday - backDays` agar
    // jumlah jatuh tempo kecil (jauh di bawah batas 366 per pemanggilan) sehingga
    // satu eksekusi membuat seluruh jatuh tempo dan eksekusi berikutnya idempoten.
    const batchRuleArb = fc.record({
      backDays: fc.integer({ min: 0, max: 40 }),
      amount: fc.integer({ min: 1, max: 1_000_000 }),
      type: fc.constantFrom<'EXPENSE' | 'INCOME'>('EXPENSE', 'INCOME'),
      frequency: fc.constantFrom(...FREQUENCIES),
      status: fc.constantFrom<RuleStatus>('ACTIVE', 'PAUSED'),
      initialBalance: fc.integer({ min: 0, max: 10_000_000 }),
    });

    await fc.assert(
      fc.asyncProperty(
        dateArb,
        fc.array(batchRuleArb, { minLength: 1, maxLength: 4 }),
        fc.integer({ min: 2, max: 4 }),
        async (batchToday, specs, runs) => {
          const rules: RecurringRuleRecord[] = specs.map((spec, i) => ({
            id: `rule${i}`,
            owner: `sub-${i}::user-${i}`,
            amount: spec.amount,
            categoryId: 'cat',
            walletId: `w${i}`,
            type: spec.type,
            frequency: spec.frequency,
            startDate: addDays(batchToday, -spec.backDays),
            nextIndex: 0,
            status: spec.status,
          }));

          const repo = new InMemoryLedgerRepo({
            Wallet: specs.map((spec, i) => ({
              id: `w${i}`,
              owner: `sub-${i}::user-${i}`,
              name: 'Tunai',
              nameKey: 'tunai',
              initialBalance: spec.initialBalance,
              balance: spec.initialBalance,
            })),
            RecurringRule: rules as unknown as ItemRecord[],
          });

          for (let r = 0; r < runs; r += 1) {
            const fresh = await Promise.all(
              rules.map((rule) => repo.get('RecurringRule', rule.owner, rule.id)),
            );
            await runRecurringRules(
              repo,
              fresh.filter((x): x is RecurringRuleRecord => x !== null),
              batchToday,
            );
          }

          for (let i = 0; i < rules.length; i += 1) {
            const spec = specs[i]!;
            const rule = rules[i]!;
            const expected = spec.status === 'ACTIVE' ? expectedDueDates(rule, batchToday) : [];
            const delta = spec.type === 'EXPENSE' ? -spec.amount : spec.amount;

            const txns = repo
              .dump('Transaction')
              .filter((t) => t.recurringRuleId === rule.id);
            expect(txns).toHaveLength(expected.length);
            expect(new Set(txns.map((t) => t.id)).size).toBe(expected.length);

            const wallet = await repo.get('Wallet', rule.owner, `w${i}`);
            expect(wallet?.balance).toBe(spec.initialBalance + delta * expected.length);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
