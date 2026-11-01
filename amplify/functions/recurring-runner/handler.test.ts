import { describe, expect, it } from 'vitest';
import {
  processRule,
  recurringTxnId,
  runRecurringRules,
} from './handler';
import {
  InMemoryLedgerRepo,
  type ItemRecord,
  type RecurringRuleRecord,
} from '../ledger/repository';

const OWNER = 'sub-a::user-a';

function wallet(id: string, balance: number): ItemRecord {
  return { id, owner: OWNER, name: 'Tunai', nameKey: 'tunai', initialBalance: balance, balance };
}

function rule(extra: Partial<RecurringRuleRecord> = {}): RecurringRuleRecord {
  return {
    id: 'rule1',
    owner: OWNER,
    amount: 10_000,
    categoryId: 'cat',
    walletId: 'w1',
    type: 'EXPENSE',
    frequency: 'DAILY',
    startDate: '2025-01-10',
    nextIndex: 0,
    status: 'ACTIVE',
    ...extra,
  };
}

/** Repositori dengan Dompet dan aturan terpasang (aturan selalu ada di tabel saat diproses). */
function seed(r: RecurringRuleRecord, balance = 100_000, extra: Partial<Record<'Budget', ItemRecord[]>> = {}) {
  return new InMemoryLedgerRepo({
    Wallet: [wallet('w1', balance)],
    RecurringRule: [r as unknown as ItemRecord],
    ...extra,
  });
}

describe('processRule', () => {
  it('membuat Transaksi jatuh tempo dengan ID deterministik dan memajukan nextIndex', async () => {
    const r = rule();
    const repo = seed(r);

    const res = await processRule(repo, r, '2025-01-10');

    expect(res.created).toBe(1);
    expect(res.skipped).toBe(0);

    const txn = await repo.get('Transaction', OWNER, recurringTxnId('rule1', '2025-01-10'));
    expect(txn).not.toBeNull();
    expect(txn?.type).toBe('EXPENSE');
    expect(txn?.amount).toBe(10_000);
    expect(txn?.recurringRuleId).toBe('rule1');
    expect(txn?.month).toBe('2025-01');

    // Saldo berkurang untuk pengeluaran.
    const w = await repo.get('Wallet', OWNER, 'w1');
    expect(w?.balance).toBe(90_000);

    // nextIndex dan nextDueOn maju.
    const updated = await repo.get('RecurringRule', OWNER, 'rule1');
    expect(updated?.nextIndex).toBe(1);
    expect(updated?.nextDueOn).toBe('2025-01-11');
  });

  it('menambah saldo untuk pemasukan', async () => {
    const r = rule({ type: 'INCOME', amount: 25_000 });
    const repo = seed(r);
    await processRule(repo, r, '2025-01-10');
    const w = await repo.get('Wallet', OWNER, 'w1');
    expect(w?.balance).toBe(125_000);
  });

  it('membuat satu Transaksi per jatuh tempo yang tertunggak (batas WIB)', async () => {
    const r = rule({ startDate: '2025-01-08' });
    const repo = seed(r);

    const res = await processRule(repo, r, '2025-01-10');

    expect(res.created).toBe(3); // 08, 09, 10
    for (const date of ['2025-01-08', '2025-01-09', '2025-01-10']) {
      expect(await repo.get('Transaction', OWNER, recurringTxnId('rule1', date))).not.toBeNull();
    }
    const w = await repo.get('Wallet', OWNER, 'w1');
    expect(w?.balance).toBe(70_000);
    const updated = await repo.get('RecurringRule', OWNER, 'rule1');
    expect(updated?.nextIndex).toBe(3);
  });

  it('melewati aturan yang dijeda tanpa membuat Transaksi', async () => {
    const r = rule({ status: 'PAUSED' });
    const repo = seed(r);
    const res = await processRule(repo, r, '2025-01-10');
    expect(res.created).toBe(0);
    const w = await repo.get('Wallet', OWNER, 'w1');
    expect(w?.balance).toBe(100_000);
  });

  it('membuat Notifikasi pengingat H-3 untuk jatuh tempo berikutnya', async () => {
    const r = rule({ startDate: '2025-01-13' });
    const repo = seed(r);
    // startDate 3 hari ke depan: belum ada jatuh tempo, tetapi tepat H-3.
    const res = await processRule(repo, r, '2025-01-10');

    expect(res.created).toBe(0);
    expect(res.reminderCreated).toBe(true);
    const notif = await repo.get('Notification', OWNER, 'recrem:rule1:2025-01-13');
    expect(notif).not.toBeNull();
    expect(notif?.refId).toBe('rule1');
  });

  it('menghormati preferensi yang menonaktifkan pengingat berulang', async () => {
    const r = rule({ startDate: '2025-01-13' });
    const repo = seed(r);
    const res = await processRule(repo, r, '2025-01-10', { recurring: false });
    expect(res.reminderCreated).toBe(false);
    expect(await repo.get('Notification', OWNER, 'recrem:rule1:2025-01-13')).toBeNull();
  });

  it('mengevaluasi ambang Anggaran setelah pengeluaran berulang', async () => {
    const r = rule({ amount: 90_000 });
    const repo = seed(r, 100_000, {
      Budget: [{ id: 'b1', owner: OWNER, categoryId: 'cat', month: '2025-01', amount: 100_000 }],
    });

    await processRule(repo, r, '2025-01-10');

    // 90.000 dari 100.000 melewati ambang 80 persen.
    const notif = await repo.get('Notification', OWNER, 'budget80:b1');
    expect(notif).not.toBeNull();
  });
});

describe('idempotensi recurring-runner (Property 12)', () => {
  it('eksekusi ulang pada hari yang sama tidak menggandakan Transaksi atau saldo', async () => {
    const repo = seed(rule({ startDate: '2025-01-08' }));
    const today = '2025-01-10';

    // Jalankan dua kali, membaca ulang aturan dari repositori tiap kali.
    const run1 = await runRecurringRules(repo, [(await repo.get('RecurringRule', OWNER, 'rule1'))!], today);
    const run2 = await runRecurringRules(repo, [(await repo.get('RecurringRule', OWNER, 'rule1'))!], today);

    expect(run1.created).toBe(3);
    expect(run2.created).toBe(0);

    expect(repo.dump('Transaction')).toHaveLength(3);
    const w = await repo.get('Wallet', OWNER, 'w1');
    expect(w?.balance).toBe(70_000); // berubah tepat sekali per jatuh tempo
  });

  it('memakai objek aturan basi tetap aman berkat prasyarat attribute_not_exists', async () => {
    const stale = rule(); // nextIndex 0, dipakai dua kali
    const repo = seed(stale);

    const first = await processRule(repo, stale, '2025-01-10');
    const second = await processRule(repo, stale, '2025-01-10');

    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);

    expect(repo.dump('Transaction')).toHaveLength(1);
    const w = await repo.get('Wallet', OWNER, 'w1');
    expect(w?.balance).toBe(90_000);
  });
});
