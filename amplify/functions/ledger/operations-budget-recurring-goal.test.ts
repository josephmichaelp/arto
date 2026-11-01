import { describe, expect, it } from 'vitest';
import { InMemoryLedgerRepo, type ItemRecord } from './repository';
import {
  BudgetRecurringGoalError,
  copyBudgetsFromPreviousMonth,
  createGoal,
  createRecurringRule,
  deleteGoal,
  deleteRecurringRule,
  pauseRecurringRule,
  resumeRecurringRule,
  updateGoal,
  updateRecurringRule,
  upsertBudget,
} from './operations-budget-recurring-goal';

const OWNER = 'sub-a::user-a';
const OTHER = 'sub-b::user-b';

function budget(id: string, owner: string, categoryId: string, month: string, amount: number): ItemRecord {
  return { id, owner, categoryId, month, amount };
}

/** Pembuat ID deterministik untuk uji. */
function sequentialIds(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

// --- upsertBudget ---------------------------------------------------------

describe('upsertBudget', () => {
  it('membuat Anggaran baru dengan ID categoryId#month', async () => {
    const repo = new InMemoryLedgerRepo();
    const result = await upsertBudget(repo, OWNER, { categoryId: 'c1', month: '2025-01', amount: 500000 });

    expect(result.mode).toBe('create');
    expect(result.budget.id).toBe('c1#2025-01');
    expect(result.budget.amount).toBe(500000);
    expect(result.budget.warn80Sent).toBe(false);
    expect((await repo.get('Budget', OWNER, 'c1#2025-01'))?.amount).toBe(500000);
  });

  it('mengubah nominal Anggaran yang sudah ada dan mempertahankan penanda ambang', async () => {
    const repo = new InMemoryLedgerRepo({
      Budget: [{ ...budget('c1#2025-01', OWNER, 'c1', '2025-01', 500000), warn80Sent: true }],
    });
    const result = await upsertBudget(repo, OWNER, { categoryId: 'c1', month: '2025-01', amount: 750000 });

    expect(result.mode).toBe('update');
    const stored = await repo.get('Budget', OWNER, 'c1#2025-01');
    expect(stored?.amount).toBe(750000);
    expect(stored?.warn80Sent).toBe(true);
  });

  it('menolak nominal tidak valid', async () => {
    const repo = new InMemoryLedgerRepo();
    await expect(
      upsertBudget(repo, OWNER, { categoryId: 'c1', month: '2025-01', amount: 0 }),
    ).rejects.toMatchObject({ code: 'AMOUNT_INVALID' });
  });

  it('menolak format bulan yang salah', async () => {
    const repo = new InMemoryLedgerRepo();
    await expect(
      upsertBudget(repo, OWNER, { categoryId: 'c1', month: '2025-1', amount: 1000 }),
    ).rejects.toBeInstanceOf(BudgetRecurringGoalError);
  });

  it('tidak mengubah Anggaran milik pemilik lain (membuat baru untuk pemilik ini)', async () => {
    const repo = new InMemoryLedgerRepo({ Budget: [budget('c1#2025-01', OTHER, 'c1', '2025-01', 999)] });
    const result = await upsertBudget(repo, OWNER, { categoryId: 'c1', month: '2025-01', amount: 1000 });
    // ID sama tetapi karena bukan milik OWNER, repo.get mengembalikan null → mode create.
    expect(result.mode).toBe('create');
  });
});

// --- copyBudgetsFromPreviousMonth -----------------------------------------

describe('copyBudgetsFromPreviousMonth', () => {
  it('menyalin Anggaran bulan sebelumnya yang belum ada di bulan tujuan', async () => {
    const repo = new InMemoryLedgerRepo({
      Budget: [
        budget('c1#2024-12', OWNER, 'c1', '2024-12', 100),
        budget('c2#2024-12', OWNER, 'c2', '2024-12', 200),
      ],
    });
    const result = await copyBudgetsFromPreviousMonth(repo, OWNER, { toMonth: '2025-01' });

    expect(result.fromMonth).toBe('2024-12');
    expect(result.created.map((b) => b.id).sort()).toEqual(['c1#2025-01', 'c2#2025-01']);
    expect(result.skipped).toBe(0);
    expect((await repo.get('Budget', OWNER, 'c1#2025-01'))?.amount).toBe(100);
  });

  it('tidak menimpa Anggaran yang sudah ada di bulan tujuan', async () => {
    const repo = new InMemoryLedgerRepo({
      Budget: [
        budget('c1#2024-12', OWNER, 'c1', '2024-12', 100),
        budget('c1#2025-01', OWNER, 'c1', '2025-01', 999),
      ],
    });
    const result = await copyBudgetsFromPreviousMonth(repo, OWNER, { toMonth: '2025-01' });

    expect(result.created).toHaveLength(0);
    // Nominal yang sudah ada tetap.
    expect((await repo.get('Budget', OWNER, 'c1#2025-01'))?.amount).toBe(999);
  });

  it('tidak menyalin Anggaran milik pemilik lain', async () => {
    const repo = new InMemoryLedgerRepo({
      Budget: [budget('c1#2024-12', OTHER, 'c1', '2024-12', 100)],
    });
    const result = await copyBudgetsFromPreviousMonth(repo, OWNER, { toMonth: '2025-01' });
    expect(result.created).toHaveLength(0);
  });
});

// --- CRUD aturan berulang -------------------------------------------------

describe('CRUD aturan berulang', () => {
  it('membuat aturan dengan nextIndex 0 dan nextDueOn dari occurrence', async () => {
    const repo = new InMemoryLedgerRepo();
    const rule = await createRecurringRule(
      repo,
      OWNER,
      { amount: 50000, categoryId: 'c1', walletId: 'w1', type: 'EXPENSE', frequency: 'MONTHLY', startDate: '2025-01-31' },
      { newId: sequentialIds('r') },
    );

    expect(rule.id).toBe('r-1');
    expect(rule.nextIndex).toBe(0);
    expect(rule.status).toBe('ACTIVE');
    expect(rule.nextDueOn).toBe('2025-01-31');
  });

  it('menolak nominal tidak valid dan tanggal salah', async () => {
    const repo = new InMemoryLedgerRepo();
    await expect(
      createRecurringRule(repo, OWNER, {
        amount: -1,
        categoryId: 'c1',
        walletId: 'w1',
        type: 'EXPENSE',
        frequency: 'DAILY',
        startDate: '2025-01-01',
      }),
    ).rejects.toMatchObject({ code: 'AMOUNT_INVALID' });

    await expect(
      createRecurringRule(repo, OWNER, {
        amount: 10,
        categoryId: 'c1',
        walletId: 'w1',
        type: 'EXPENSE',
        frequency: 'DAILY',
        startDate: '2025/01/01',
      }),
    ).rejects.toMatchObject({ code: 'DATE_INVALID' });
  });

  it('menghitung ulang nextDueOn saat jadwal diubah', async () => {
    const repo = new InMemoryLedgerRepo();
    const rule = await createRecurringRule(
      repo,
      OWNER,
      { amount: 50000, categoryId: 'c1', walletId: 'w1', type: 'EXPENSE', frequency: 'DAILY', startDate: '2025-01-01' },
      { newId: sequentialIds('r') },
    );
    const updated = await updateRecurringRule(repo, OWNER, rule.id, { nextIndex: 5 });
    expect(updated.nextIndex).toBe(5);
    expect(updated.nextDueOn).toBe('2025-01-06');
  });

  it('menjeda menghapus nextDueOn dan melanjutkan menghitungnya kembali', async () => {
    const repo = new InMemoryLedgerRepo();
    const rule = await createRecurringRule(
      repo,
      OWNER,
      { amount: 50000, categoryId: 'c1', walletId: 'w1', type: 'EXPENSE', frequency: 'DAILY', startDate: '2025-01-01' },
      { newId: sequentialIds('r') },
    );

    const paused = await pauseRecurringRule(repo, OWNER, rule.id);
    expect(paused.status).toBe('PAUSED');
    expect(paused.nextDueOn).toBeUndefined();
    expect((await repo.get('RecurringRule', OWNER, rule.id))?.nextDueOn).toBeUndefined();

    const resumed = await resumeRecurringRule(repo, OWNER, rule.id);
    expect(resumed.status).toBe('ACTIVE');
    expect(resumed.nextDueOn).toBe('2025-01-01');
  });

  it('menghapus aturan', async () => {
    const repo = new InMemoryLedgerRepo();
    const rule = await createRecurringRule(
      repo,
      OWNER,
      { amount: 50000, categoryId: 'c1', walletId: 'w1', type: 'EXPENSE', frequency: 'DAILY', startDate: '2025-01-01' },
      { newId: sequentialIds('r') },
    );
    await deleteRecurringRule(repo, OWNER, rule.id);
    expect(await repo.get('RecurringRule', OWNER, rule.id)).toBeNull();
  });

  it('menolak operasi pada aturan milik pemilik lain', async () => {
    const repo = new InMemoryLedgerRepo();
    const rule = await createRecurringRule(
      repo,
      OWNER,
      { amount: 50000, categoryId: 'c1', walletId: 'w1', type: 'EXPENSE', frequency: 'DAILY', startDate: '2025-01-01' },
      { newId: sequentialIds('r') },
    );
    await expect(pauseRecurringRule(repo, OTHER, rule.id)).rejects.toMatchObject({ code: 'RULE_NOT_FOUND' });
    await expect(deleteRecurringRule(repo, OTHER, rule.id)).rejects.toMatchObject({ code: 'RULE_NOT_FOUND' });
  });
});

// --- CRUD Target_Tabungan -------------------------------------------------

describe('CRUD Target_Tabungan', () => {
  it('membuat Target dengan progres 0 dan belum tercapai', async () => {
    const repo = new InMemoryLedgerRepo();
    const goal = await createGoal(
      repo,
      OWNER,
      { name: 'Liburan', target: 1000000, deadline: '2025-12-31' },
      { newId: sequentialIds('g') },
    );
    expect(goal.id).toBe('g-1');
    expect(goal.saved).toBe(0);
    expect(goal.achieved).toBe(false);
    expect(goal.deadline).toBe('2025-12-31');
  });

  it('menolak target tidak valid', async () => {
    const repo = new InMemoryLedgerRepo();
    await expect(createGoal(repo, OWNER, { name: 'X', target: 0 })).rejects.toMatchObject({
      code: 'AMOUNT_INVALID',
    });
  });

  it('mengubah target dan menghitung ulang achieved dari progres saat ini', async () => {
    const repo = new InMemoryLedgerRepo({
      Goal: [{ id: 'g1', owner: OWNER, name: 'Dana', target: 1000000, saved: 800000, achieved: false }],
    });
    const updated = await updateGoal(repo, OWNER, 'g1', { target: 500000 });
    expect(updated.target).toBe(500000);
    expect(updated.achieved).toBe(true);
    expect((await repo.get('Goal', OWNER, 'g1'))?.achieved).toBe(true);
  });

  it('menghapus tenggat dengan null', async () => {
    const repo = new InMemoryLedgerRepo({
      Goal: [{ id: 'g1', owner: OWNER, name: 'Dana', target: 100, saved: 0, deadline: '2025-12-31' }],
    });
    const updated = await updateGoal(repo, OWNER, 'g1', { deadline: null });
    expect(updated.deadline).toBeUndefined();
    expect((await repo.get('Goal', OWNER, 'g1'))?.deadline).toBeUndefined();
  });

  it('menghapus Target', async () => {
    const repo = new InMemoryLedgerRepo({
      Goal: [{ id: 'g1', owner: OWNER, name: 'Dana', target: 100, saved: 0 }],
    });
    await deleteGoal(repo, OWNER, 'g1');
    expect(await repo.get('Goal', OWNER, 'g1')).toBeNull();
  });

  it('menolak operasi pada Target milik pemilik lain', async () => {
    const repo = new InMemoryLedgerRepo({
      Goal: [{ id: 'g1', owner: OWNER, name: 'Dana', target: 100, saved: 0 }],
    });
    await expect(updateGoal(repo, OTHER, 'g1', { name: 'Z' })).rejects.toMatchObject({ code: 'GOAL_NOT_FOUND' });
    await expect(deleteGoal(repo, OTHER, 'g1')).rejects.toMatchObject({ code: 'GOAL_NOT_FOUND' });
  });
});
