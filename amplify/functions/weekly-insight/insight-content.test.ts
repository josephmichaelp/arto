/**
 * Uji properti isi Wawasan_Mingguan (Property 27).
 *
 * **Property 27: Isi Wawasan_Mingguan berasal dari agregasi deterministik**
 * **Validates: Requirements 13.1, 13.2, 13.4**
 *
 * Untuk sembarang himpunan Transaksi pekan, nilai `totalExpense` dan
 * `topCategoryId` pada Wawasan_Mingguan yang disimpan SELALU sama dengan
 * hasil agregasi deterministik `shared/domain` (`summarize`, `byCategory`),
 * terlepas dari apa pun keluaran model (penyusun teks). Wawasan juga memuat
 * paling sedikit satu saran (bawaan bila model gagal), dan Pengguna tanpa
 * Transaksi pada pekan itu tidak menghasilkan Wawasan_Mingguan.
 *
 * Berkas ini terpisah dari `handler.test.ts` (uji contoh) dan hanya berisi
 * uji properti. Tidak ada jaringan/AWS: sumber data in-memory disuntik.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { byCategory, summarize } from 'shared/domain';
import type { Category, DateRange, Txn, TxnType } from 'shared/domain';
import {
  processUserInsight,
  type InsightComposer,
  type InsightDataSource,
  type InsightNotificationRecord,
  type WeeklyInsightRecord,
} from './handler';

const OWNER = 'sub-a::user-a';

// Pekan tetap Senin-Minggu (WIB) sebagai konteks agregasi.
const RANGE: DateRange = { from: '2025-01-06', to: '2025-01-12' };

// --- Sumber data in-memory (tanpa jaringan) ------------------------------

class MemoryInsightDataSource implements InsightDataSource {
  readonly insights: WeeklyInsightRecord[] = [];
  readonly notifications: InsightNotificationRecord[] = [];

  constructor(
    private readonly txns: Txn[],
    private readonly categories: Category[] = [],
  ) {}

  async listOwners(): Promise<string[]> {
    return [OWNER];
  }

  async listTransactions(_owner: string, range: DateRange): Promise<Txn[]> {
    return this.txns.filter((t) => t.date >= range.from && t.date <= range.to);
  }

  async listCategories(): Promise<Category[]> {
    return this.categories;
  }

  async getPrefs(): Promise<null> {
    return null;
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

// --- Generator ------------------------------------------------------------

const TXN_TYPES: TxnType[] = ['EXPENSE', 'INCOME', 'TRANSFER_OUT', 'TRANSFER_IN', 'GOAL_DEPOSIT'];

/** Kategori dari ruang kecil agar sering muncul "Kategori terbesar" yang bersaing. */
const categoryIdArb = fc.constantFrom('makan', 'transport', 'hiburan');

/** Tanggal di dalam pekan (06..12 Januari 2025). */
const inRangeDateArb = fc.integer({ min: 6, max: 12 }).map((d) => `2025-01-${String(d).padStart(2, '0')}`);

/** Tanggal di luar pekan (sebelum 06 atau sesudah 12). */
const outOfRangeDateArb = fc
  .constantFrom('2025-01-01', '2025-01-02', '2025-01-05', '2025-01-13', '2025-01-20', '2024-12-30')
  .map((d) => d);

function txnArb(dateArb: fc.Arbitrary<string>): fc.Arbitrary<Txn> {
  return fc.record({
    id: fc.uuid(),
    type: fc.constantFrom(...TXN_TYPES),
    amount: fc.integer({ min: 1, max: 5_000_000 }),
    date: dateArb,
    categoryId: fc.option(categoryIdArb, { nil: undefined }),
    walletId: fc.constantFrom('w1', 'w2'),
  });
}

/**
 * Penyusun teks yang bermusuhan: mencoba menyuntik total dan Kategori palsu
 * lewat `summary`/`tips`, melempar galat, atau mengembalikan saran kosong.
 * Tak satu pun boleh memengaruhi `totalExpense`/`topCategoryId` tersimpan.
 */
const composerArb: fc.Arbitrary<InsightComposer> = fc.oneof(
  // Keluaran "valid" dengan angka palsu di teks.
  fc.record({ summary: fc.string(), tips: fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 3 }) }).map(
    (out): InsightComposer =>
      async () => ({
        summary: `${out.summary} Rp 999.999.999 kategori PALSU`,
        tips: out.tips,
      }),
  ),
  // Melempar galat -> jatuh ke komposisi bawaan.
  fc.constant<InsightComposer>(async () => {
    throw new Error('model gagal');
  }),
  // Saran kosong -> komposeInsight memakai saran bawaan.
  fc.constant<InsightComposer>(async () => ({ summary: '', tips: [] })),
);

const categoriesArb: fc.Arbitrary<Category[]> = fc.constant([
  { id: 'makan', name: 'Makan', type: 'EXPENSE' },
  { id: 'transport', name: 'Transport', type: 'EXPENSE' },
  { id: 'hiburan', name: 'Hiburan', type: 'EXPENSE' },
]);

// --- Property 27 ----------------------------------------------------------

describe('Property 27: Isi Wawasan_Mingguan berasal dari agregasi deterministik', () => {
  it('totalExpense dan topCategoryId selalu sama dengan agregasi domain, apa pun keluaran model', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(txnArb(inRangeDateArb), { minLength: 1, maxLength: 30 }),
        composerArb,
        categoriesArb,
        async (txns, composer, categories) => {
          const source = new MemoryInsightDataSource(txns, categories);
          const res = await processUserInsight(OWNER, source, RANGE, composer);

          // Oracle: agregasi deterministik langsung dari shared/domain.
          const expectedTotal = summarize(txns, RANGE).expense;
          const expectedTop = byCategory(txns, RANGE)[0]?.categoryId || undefined;

          expect(res.skipped).toBe(false);
          expect(res.insightCreated).toBe(true);
          expect(source.insights).toHaveLength(1);

          const insight = source.insights[0]!;
          // Nilai numerik berasal dari domain, bukan dari model.
          expect(insight.totalExpense).toBe(expectedTotal);
          expect(insight.topCategoryId).toBe(expectedTop);
          // Paling sedikit satu saran (bawaan bila model gagal/kosong).
          expect(insight.tips.length).toBeGreaterThanOrEqual(1);
          // Ringkasan selalu terisi.
          expect(insight.summary.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('Pengguna tanpa Transaksi pada pekan itu tidak menghasilkan Wawasan_Mingguan (Req 13.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(txnArb(outOfRangeDateArb), { minLength: 0, maxLength: 20 }),
        composerArb,
        async (txns, composer) => {
          const source = new MemoryInsightDataSource(txns, []);
          const res = await processUserInsight(OWNER, source, RANGE, composer);

          expect(res.skipped).toBe(true);
          expect(res.reason).toBe('no-transactions');
          expect(source.insights).toHaveLength(0);
          expect(source.notifications).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
