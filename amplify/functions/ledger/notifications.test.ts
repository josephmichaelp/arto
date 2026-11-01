import { describe, expect, it, vi } from 'vitest';
import {
  BUDGET_OVER_TYPE,
  BUDGET_WARN_TYPE,
  createNotification,
  evaluateBudgetThresholds,
  isExpiredPushStatus,
  sendWebPush,
  type PushClient,
  type StoredPushSubscription,
} from './notifications';
import { InMemoryLedgerRepo, type ItemRecord } from './repository';

const OWNER = 'sub-a::user-a';

function budget(id: string, owner: string, extra: Partial<ItemRecord> = {}): ItemRecord {
  return { id, owner, categoryId: 'cat', month: '2025-01', amount: 100_000, ...extra };
}

function expense(id: string, owner: string, amount: number): ItemRecord {
  return {
    id,
    owner,
    type: 'EXPENSE',
    amount,
    date: '2025-01-10',
    month: '2025-01',
    categoryId: 'cat',
    walletId: 'w1',
  };
}

describe('createNotification', () => {
  it('menulis Notifikasi baru dengan ID deterministik', async () => {
    const repo = new InMemoryLedgerRepo();
    const res = await createNotification(repo, OWNER, BUDGET_WARN_TYPE, 'b1', { title: 'Hai' }, null);
    expect(res.created).toBe(true);
    expect(res.id).toBe('budget80:b1');
    const stored = await repo.get('Notification', OWNER, 'budget80:b1');
    expect(stored?.title).toBe('Hai');
    expect(stored?.read).toBe(false);
  });

  it('tidak menggandakan Notifikasi untuk ID yang sama', async () => {
    const repo = new InMemoryLedgerRepo();
    await createNotification(repo, OWNER, BUDGET_WARN_TYPE, 'b1', { title: 'satu' }, null);
    const second = await createNotification(repo, OWNER, BUDGET_WARN_TYPE, 'b1', { title: 'dua' }, null);
    expect(second.created).toBe(false);
    expect(second.reason).toBe('already-exists');
    const stored = await repo.get('Notification', OWNER, 'budget80:b1');
    expect(stored?.title).toBe('satu');
  });

  it('melewati pembuatan bila preferensi menonaktifkan jenisnya', async () => {
    const repo = new InMemoryLedgerRepo();
    const res = await createNotification(repo, OWNER, BUDGET_WARN_TYPE, 'b1', { title: 'Hai' }, { budget: false });
    expect(res.created).toBe(false);
    expect(res.reason).toBe('prefs-disabled');
    expect(await repo.get('Notification', OWNER, 'budget80:b1')).toBeNull();
  });
});

describe('sendWebPush', () => {
  const subs: StoredPushSubscription[] = [
    { id: 's1', endpoint: 'https://push/1', keys: { p256dh: 'a', auth: 'b' } },
    { id: 's2', endpoint: 'https://push/2', keys: { p256dh: 'c', auth: 'd' } },
  ];

  it('mengirim ke setiap langganan dengan kunci lengkap', async () => {
    const client: PushClient = { sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }) };
    const res = await sendWebPush(subs, { title: 'Halo' }, { client });
    expect(res.sent).toEqual(['https://push/1', 'https://push/2']);
    expect(res.expired).toEqual([]);
    expect(client.sendNotification).toHaveBeenCalledTimes(2);
  });

  it('menandai langganan 404/410 sebagai kedaluwarsa dan tidak menghentikan sisanya', async () => {
    const client: PushClient = {
      sendNotification: vi
        .fn()
        .mockRejectedValueOnce({ statusCode: 410 })
        .mockResolvedValueOnce({ statusCode: 201 }),
    };
    const res = await sendWebPush(subs, { title: 'Halo' }, { client });
    expect(res.expired).toEqual(['https://push/1']);
    expect(res.sent).toEqual(['https://push/2']);
  });

  it('mencatat galat non-kedaluwarsa pada failed', async () => {
    const client: PushClient = { sendNotification: vi.fn().mockRejectedValue({ statusCode: 500 }) };
    const res = await sendWebPush(subs, { title: 'Halo' }, { client });
    expect(res.failed).toEqual([
      { endpoint: 'https://push/1', statusCode: 500 },
      { endpoint: 'https://push/2', statusCode: 500 },
    ]);
  });

  it('melewati langganan tanpa kunci lengkap', async () => {
    const client: PushClient = { sendNotification: vi.fn().mockResolvedValue({}) };
    const res = await sendWebPush([{ endpoint: 'https://push/x', keys: null }], { title: 'Halo' }, { client });
    expect(res.sent).toEqual([]);
    expect(res.failed).toEqual([{ endpoint: 'https://push/x' }]);
    expect(client.sendNotification).not.toHaveBeenCalled();
  });

  it('isExpiredPushStatus hanya benar untuk 404 dan 410', () => {
    expect(isExpiredPushStatus(404)).toBe(true);
    expect(isExpiredPushStatus(410)).toBe(true);
    expect(isExpiredPushStatus(500)).toBe(false);
    expect(isExpiredPushStatus(undefined)).toBe(false);
  });
});

describe('evaluateBudgetThresholds', () => {
  it('tidak melakukan apa-apa bila tidak ada Anggaran', async () => {
    const repo = new InMemoryLedgerRepo();
    const res = await evaluateBudgetThresholds(repo, OWNER, { categoryId: 'cat', month: '2025-01' }, null);
    expect(res.evaluated).toBe(false);
    expect(res.notifications).toEqual([]);
  });

  it('membuat Notifikasi 80 persen dan menandai warn80Sent', async () => {
    const repo = new InMemoryLedgerRepo({
      Budget: [budget('b1', OWNER)],
      Transaction: [expense('t1', OWNER, 80_000)],
    });
    const res = await evaluateBudgetThresholds(repo, OWNER, { categoryId: 'cat', month: '2025-01' }, null);
    expect(res.warn80).toBe(true);
    expect(res.over100).toBe(false);
    expect(res.flagsSet).toEqual(['warn80Sent']);
    expect(res.notifications[0]?.type).toBe(BUDGET_WARN_TYPE);
    expect(res.notifications[0]?.result.created).toBe(true);
    const stored = await repo.get('Budget', OWNER, 'b1');
    expect(stored?.warn80Sent).toBe(true);
  });

  it('membuat Notifikasi 80 dan 100 persen saat pengeluaran melampaui anggaran', async () => {
    const repo = new InMemoryLedgerRepo({
      Budget: [budget('b1', OWNER)],
      Transaction: [expense('t1', OWNER, 120_000)],
    });
    const res = await evaluateBudgetThresholds(repo, OWNER, { categoryId: 'cat', month: '2025-01' }, null);
    expect(res.flagsSet).toEqual(['warn80Sent', 'over100Sent']);
    expect(res.notifications.map((n) => n.type)).toEqual([BUDGET_WARN_TYPE, BUDGET_OVER_TYPE]);
    const stored = await repo.get('Budget', OWNER, 'b1');
    expect(stored?.warn80Sent).toBe(true);
    expect(stored?.over100Sent).toBe(true);
  });

  it('tidak membuat Notifikasi ulang bila penanda sudah diset (sekali per bulan)', async () => {
    const repo = new InMemoryLedgerRepo({
      Budget: [budget('b1', OWNER, { warn80Sent: true })],
      Transaction: [expense('t1', OWNER, 90_000)],
    });
    const res = await evaluateBudgetThresholds(repo, OWNER, { categoryId: 'cat', month: '2025-01' }, null);
    expect(res.warn80).toBe(true);
    expect(res.flagsSet).toEqual([]);
    expect(res.notifications).toEqual([]);
  });
});
