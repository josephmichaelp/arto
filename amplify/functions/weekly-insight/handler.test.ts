import { describe, expect, it } from 'vitest';
import type { Category, DateRange, NotifPrefs, Txn } from 'shared/domain';
import {
  composeInsight,
  computeAggregate,
  defaultComposition,
  lastWeekRange,
  parseComposition,
  processUserInsight,
  runWeeklyInsights,
  transactionsInRange,
  type InsightComposer,
  type InsightDataSource,
  type InsightNotificationRecord,
  type InsightPromptInput,
  type WeeklyInsightRecord,
} from './handler';

const OWNER = 'sub-a::user-a';

// --- Sumber data in-memory untuk uji -------------------------------------

interface SeedData {
  owners?: string[];
  transactions?: Record<string, Txn[]>;
  categories?: Record<string, Category[]>;
  prefs?: Record<string, NotifPrefs | null>;
}

class FakeInsightDataSource implements InsightDataSource {
  readonly insights: WeeklyInsightRecord[] = [];
  readonly notifications: InsightNotificationRecord[] = [];

  constructor(private readonly seed: SeedData = {}) {}

  async listOwners(): Promise<string[]> {
    return this.seed.owners ?? Object.keys(this.seed.transactions ?? {});
  }

  async listTransactions(owner: string, range: DateRange): Promise<Txn[]> {
    const all = this.seed.transactions?.[owner] ?? [];
    return all.filter((t) => t.date >= range.from && t.date <= range.to);
  }

  async listCategories(owner: string): Promise<Category[]> {
    return this.seed.categories?.[owner] ?? [];
  }

  async getPrefs(owner: string): Promise<NotifPrefs | null> {
    return this.seed.prefs?.[owner] ?? null;
  }

  async hasInsight(owner: string, weekStart: string): Promise<boolean> {
    return this.insights.some((i) => i.owner === owner && i.weekStart === weekStart);
  }

  async putWeeklyInsight(record: WeeklyInsightRecord): Promise<boolean> {
    if (this.insights.some((i) => i.id === record.id)) return false;
    this.insights.push(record);
    return true;
  }

  async putNotification(record: InsightNotificationRecord): Promise<boolean> {
    if (this.notifications.some((n) => n.id === record.id)) return false;
    this.notifications.push(record);
    return true;
  }
}

function txn(extra: Partial<Txn> & Pick<Txn, 'amount' | 'date'>): Txn {
  return {
    id: `t-${Math.random().toString(36).slice(2)}`,
    type: 'EXPENSE',
    walletId: 'w1',
    ...extra,
  };
}

// --- Jendela pekan --------------------------------------------------------

describe('lastWeekRange', () => {
  it('menargetkan pekan Senin-Minggu penuh sebelumnya saat dijalankan Senin', () => {
    // 2025-01-13 adalah hari Senin.
    expect(lastWeekRange('2025-01-13')).toEqual({ from: '2025-01-06', to: '2025-01-12' });
  });

  it('selalu menghasilkan rentang tujuh hari yang berakhir Minggu', () => {
    const range = lastWeekRange('2025-03-03'); // Senin
    expect(range).toEqual({ from: '2025-02-24', to: '2025-03-02' });
  });
});

// --- Agregasi deterministik ----------------------------------------------

describe('computeAggregate', () => {
  const range: DateRange = { from: '2025-01-06', to: '2025-01-12' };

  it('menghitung total pengeluaran dan Kategori terbesar dari domain', () => {
    const txns: Txn[] = [
      txn({ amount: 50_000, date: '2025-01-07', categoryId: 'makan' }),
      txn({ amount: 30_000, date: '2025-01-08', categoryId: 'makan' }),
      txn({ amount: 20_000, date: '2025-01-09', categoryId: 'transport' }),
      txn({ type: 'INCOME', amount: 1_000_000, date: '2025-01-10', categoryId: 'gaji' }),
    ];
    const agg = computeAggregate(txns, range);
    expect(agg.totalExpense).toBe(100_000);
    expect(agg.topCategoryId).toBe('makan');
    expect(agg.byCategory[0]).toEqual({ categoryId: 'makan', total: 80_000 });
  });

  it('mengabaikan transfer dan setoran Target pada total', () => {
    const txns: Txn[] = [
      txn({ amount: 40_000, date: '2025-01-07', categoryId: 'makan' }),
      txn({ type: 'TRANSFER_OUT', amount: 500_000, date: '2025-01-08' }),
      txn({ type: 'TRANSFER_IN', amount: 500_000, date: '2025-01-08' }),
    ];
    expect(computeAggregate(txns, range).totalExpense).toBe(40_000);
  });

  it('tidak memiliki Kategori terbesar saat tidak ada pengeluaran', () => {
    const txns: Txn[] = [txn({ type: 'INCOME', amount: 10_000, date: '2025-01-07' })];
    expect(computeAggregate(txns, range).topCategoryId).toBeUndefined();
  });
});

describe('transactionsInRange', () => {
  it('menyaring Transaksi di luar rentang pekan', () => {
    const range: DateRange = { from: '2025-01-06', to: '2025-01-12' };
    const txns: Txn[] = [
      txn({ amount: 1, date: '2025-01-05' }),
      txn({ amount: 1, date: '2025-01-06' }),
      txn({ amount: 1, date: '2025-01-12' }),
      txn({ amount: 1, date: '2025-01-13' }),
    ];
    expect(transactionsInRange(txns, range).map((t) => t.date)).toEqual(['2025-01-06', '2025-01-12']);
  });
});

// --- Penyusunan teks ------------------------------------------------------

const PROMPT_INPUT: InsightPromptInput = {
  weekStart: '2025-01-06',
  weekEnd: '2025-01-12',
  totalExpense: 100_000,
  topCategoryName: 'Makan',
  topCategories: [{ name: 'Makan', total: 80_000 }],
};

describe('defaultComposition', () => {
  it('menyusun ringkasan dengan total dan Kategori terbesar plus saran bawaan', () => {
    const comp = defaultComposition(PROMPT_INPUT);
    expect(comp.summary).toContain('Rp 100.000');
    expect(comp.summary).toContain('Makan');
    expect(comp.tips.length).toBeGreaterThanOrEqual(1);
  });

  it('menghilangkan sebutan Kategori saat tidak ada Kategori terbesar', () => {
    const comp = defaultComposition({ ...PROMPT_INPUT, topCategoryName: undefined });
    expect(comp.summary).toContain('Rp 100.000');
    expect(comp.summary).not.toContain('kategori');
  });
});

describe('parseComposition', () => {
  it('mem-parsing JSON valid menjadi summary dan tips', () => {
    const parsed = parseComposition('{"summary":"Ringkas","tips":["a","b"]}');
    expect(parsed).toEqual({ summary: 'Ringkas', tips: ['a', 'b'] });
  });

  it('mengabaikan teks di sekitar objek JSON', () => {
    const parsed = parseComposition('Berikut hasilnya: {"summary":"Ok","tips":["x"]} selesai');
    expect(parsed?.summary).toBe('Ok');
  });

  it('mengembalikan null untuk keluaran tidak valid', () => {
    expect(parseComposition('bukan json')).toBeNull();
    expect(parseComposition('{"summary":""}')).toBeNull();
    expect(parseComposition('{"summary":"ada","tips":[]}')).toBeNull();
  });
});

describe('composeInsight', () => {
  it('memakai komposisi bawaan bila tidak ada penyusun', async () => {
    const comp = await composeInsight(PROMPT_INPUT);
    expect(comp.source).toBe('default');
    expect(comp.summary).toContain('Makan');
  });

  it('memakai keluaran penyusun bila berhasil', async () => {
    const composer: InsightComposer = async () => ({ summary: 'Dari AI', tips: ['hemat'] });
    const comp = await composeInsight(PROMPT_INPUT, composer);
    expect(comp.source).toBe('ai');
    expect(comp.summary).toBe('Dari AI');
    expect(comp.tips).toEqual(['hemat']);
  });

  it('jatuh ke bawaan bila penyusun melempar galat', async () => {
    const composer: InsightComposer = async () => {
      throw new Error('Bedrock gagal');
    };
    const comp = await composeInsight(PROMPT_INPUT, composer);
    expect(comp.source).toBe('default');
    expect(comp.tips.length).toBeGreaterThanOrEqual(1);
  });
});

// --- Pemrosesan satu Pengguna --------------------------------------------

const RANGE: DateRange = { from: '2025-01-06', to: '2025-01-12' };

describe('processUserInsight', () => {
  const composer: InsightComposer = async () => ({ summary: 'Ringkasan AI', tips: ['Tip AI'] });

  it('menyimpan Wawasan dengan agregasi deterministik dan Notifikasi', async () => {
    const source = new FakeInsightDataSource({
      transactions: {
        [OWNER]: [
          txn({ amount: 50_000, date: '2025-01-07', categoryId: 'makan' }),
          txn({ amount: 30_000, date: '2025-01-08', categoryId: 'makan' }),
          txn({ amount: 20_000, date: '2025-01-09', categoryId: 'transport' }),
        ],
      },
      categories: { [OWNER]: [{ id: 'makan', name: 'Makan', type: 'EXPENSE' }] },
    });

    const res = await processUserInsight(OWNER, source, RANGE, composer);

    expect(res.skipped).toBe(false);
    expect(res.insightCreated).toBe(true);
    expect(res.notificationCreated).toBe(true);

    const insight = source.insights[0]!;
    expect(insight.id).toBe('2025-01-06');
    expect(insight.weekStart).toBe('2025-01-06');
    expect(insight.totalExpense).toBe(100_000);
    expect(insight.topCategoryId).toBe('makan');
    expect(insight.summary).toBe('Ringkasan AI');
    expect(insight.tips).toEqual(['Tip AI']);

    const notif = source.notifications[0]!;
    expect(notif.id).toBe('insight:2025-01-06');
    expect(notif.type).toBe('insight');
    expect(notif.refId).toBe('2025-01-06');
  });

  it('melewati Pengguna tanpa Transaksi pada pekan tersebut (Req 13.4)', async () => {
    const source = new FakeInsightDataSource({
      transactions: { [OWNER]: [txn({ amount: 10_000, date: '2025-01-01' })] },
    });
    const res = await processUserInsight(OWNER, source, RANGE, composer);
    expect(res).toEqual({ owner: OWNER, skipped: true, reason: 'no-transactions' });
    expect(source.insights).toHaveLength(0);
    expect(source.notifications).toHaveLength(0);
  });

  it('idempoten: tidak membuat ulang Wawasan yang sudah ada', async () => {
    const source = new FakeInsightDataSource({
      transactions: { [OWNER]: [txn({ amount: 10_000, date: '2025-01-07', categoryId: 'makan' })] },
      categories: { [OWNER]: [{ id: 'makan', name: 'Makan', type: 'EXPENSE' }] },
    });

    const first = await processUserInsight(OWNER, source, RANGE, composer);
    const second = await processUserInsight(OWNER, source, RANGE, composer);

    expect(first.skipped).toBe(false);
    expect(second).toEqual({ owner: OWNER, skipped: true, reason: 'already-exists' });
    expect(source.insights).toHaveLength(1);
    expect(source.notifications).toHaveLength(1);
  });

  it('tetap menyimpan Wawasan tetapi tidak membuat Notifikasi saat prefs.insight dimatikan (Req 9.5)', async () => {
    const source = new FakeInsightDataSource({
      transactions: { [OWNER]: [txn({ amount: 10_000, date: '2025-01-07', categoryId: 'makan' })] },
      categories: { [OWNER]: [{ id: 'makan', name: 'Makan', type: 'EXPENSE' }] },
      prefs: { [OWNER]: { insight: false } },
    });

    const res = await processUserInsight(OWNER, source, RANGE, composer);
    expect(res.insightCreated).toBe(true);
    expect(res.notificationCreated).toBe(false);
    expect(source.insights).toHaveLength(1);
    expect(source.notifications).toHaveLength(0);
  });

  it('memakai saran bawaan bila penyusun AI gagal', async () => {
    const failing: InsightComposer = async () => {
      throw new Error('AI tidak tersedia');
    };
    const source = new FakeInsightDataSource({
      transactions: { [OWNER]: [txn({ amount: 25_000, date: '2025-01-07', categoryId: 'makan' })] },
      categories: { [OWNER]: [{ id: 'makan', name: 'Makan', type: 'EXPENSE' }] },
    });

    const res = await processUserInsight(OWNER, source, RANGE, failing);
    expect(res.source).toBe('default');
    expect(source.insights[0]!.tips.length).toBeGreaterThanOrEqual(1);
    expect(source.insights[0]!.summary).toContain('Makan');
  });
});

// --- Eksekusi penuh -------------------------------------------------------

describe('runWeeklyInsights', () => {
  it('memproses setiap pemilik dan merangkum hasilnya', async () => {
    const other = 'sub-b::user-b';
    const source = new FakeInsightDataSource({
      owners: [OWNER, other],
      transactions: {
        [OWNER]: [txn({ amount: 10_000, date: '2025-01-07', categoryId: 'makan' })],
        [other]: [txn({ amount: 10_000, date: '2025-01-01' })], // di luar pekan
      },
      categories: { [OWNER]: [{ id: 'makan', name: 'Makan', type: 'EXPENSE' }] },
    });

    const summary = await runWeeklyInsights(source, RANGE, async () => ({ summary: 's', tips: ['t'] }));

    expect(summary.usersScanned).toBe(2);
    expect(summary.usersSkipped).toBe(1); // `other` tidak punya Transaksi pekan itu
    expect(summary.insightsCreated).toBe(1);
    expect(summary.notificationsCreated).toBe(1);
  });
});
