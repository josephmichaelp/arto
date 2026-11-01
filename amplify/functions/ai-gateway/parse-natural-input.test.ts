import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from 'shared/config';
import type { Category } from 'shared/domain';
import { RateLimitedError } from './rate-limiter';
import {
  parseNaturalInput,
  type ModelInvocationContext,
  type ParseNaturalInputDeps,
} from './parse-natural-input';

const CATEGORIES: Category[] = [
  { id: 'cat-makan', name: 'Makanan', type: 'EXPENSE' },
  { id: 'cat-gaji', name: 'Gaji', type: 'INCOME' },
];

const CONFIG: AppConfig = {
  bedrockRegion: 'ap-southeast-3',
  modelCandidates: [{ modelId: 'amazon.nova-lite-v1:0', region: 'ap-southeast-3' }],
  allowCrossRegion: true,
  aiRateLimit: 30,
};

/** Pembatas pemakaian tiruan yang selalu mengizinkan dan mencatat pemanggilan. */
function allowRateLimit() {
  const enforce = vi.fn(async (opts: { sub: string; limit?: number; now?: Date }) => ({
    key: `USAGE#${opts.sub}#x`,
    count: 1,
    bucket: 'x',
  }));
  return enforce as unknown as ParseNaturalInputDeps['enforceRateLimit'] & typeof enforce;
}

/** Membangun deps dengan model yang mengembalikan teks tetap per pemanggilan. */
function depsWithModelReplies(replies: string[]): {
  deps: ParseNaturalInputDeps;
  modelCalls: ModelInvocationContext[];
  enforce: ReturnType<typeof allowRateLimit>;
} {
  const modelCalls: ModelInvocationContext[] = [];
  let i = 0;
  const enforce = allowRateLimit();
  const invokeModel = vi.fn(async (ctx: ModelInvocationContext) => {
    modelCalls.push(ctx);
    const reply = replies[Math.min(i, replies.length - 1)] ?? '';
    i += 1;
    return reply;
  });
  return { deps: { config: CONFIG, enforceRateLimit: enforce, invokeModel }, modelCalls, enforce };
}

describe('parseNaturalInput', () => {
  it('menghasilkan pratinjau ok dari JSON model yang valid', async () => {
    const { deps } = depsWithModelReplies([
      JSON.stringify({ type: 'EXPENSE', amount: 35000, date: '2025-08-17', categoryId: 'cat-makan', note: 'nasi' }),
    ]);
    const result = await parseNaturalInput(
      { sub: 'u1', sentence: 'makan nasi 35rb', categories: CATEGORIES, todayWib: '2025-08-20' },
      deps,
    );
    expect(result).toEqual({
      status: 'ok',
      type: 'EXPENSE',
      amount: 35000,
      date: '2025-08-17',
      categoryId: 'cat-makan',
    });
  });

  it('menghitung ulang nominal lewat parseAmountShorthand dari string singkatan', async () => {
    const { deps } = depsWithModelReplies([
      JSON.stringify({ type: 'EXPENSE', amount: '1,5jt', categoryId: 'cat-makan' }),
    ]);
    const result = await parseNaturalInput(
      { sub: 'u1', sentence: 'belanja 1,5jt', categories: CATEGORIES, todayWib: '2025-08-20' },
      deps,
    );
    expect(result).toEqual({
      status: 'ok',
      type: 'EXPENSE',
      amount: 1_500_000,
      date: '2025-08-20',
      categoryId: 'cat-makan',
    });
  });

  it('mengganti tanggal kosong dengan todayWib', async () => {
    const { deps } = depsWithModelReplies([
      JSON.stringify({ type: 'INCOME', amount: 5000000, categoryId: 'cat-gaji' }),
    ]);
    const result = await parseNaturalInput(
      { sub: 'u1', sentence: 'gajian 5jt', categories: CATEGORIES, todayWib: '2025-09-01' },
      deps,
    );
    expect(result).toMatchObject({ status: 'ok', date: '2025-09-01' });
  });

  it('menolak categoryId di luar daftar Pengguna sehingga menjadi needs_amount', async () => {
    const { deps } = depsWithModelReplies([
      JSON.stringify({ type: 'EXPENSE', amount: 10000, categoryId: 'cat-palsu' }),
    ]);
    const result = await parseNaturalInput(
      { sub: 'u1', sentence: 'jajan 10rb', categories: CATEGORIES, todayWib: '2025-08-20' },
      deps,
    );
    expect(result.status).toBe('needs_amount');
    if (result.status === 'needs_amount') {
      expect(result.draft.categoryId).toBeUndefined();
      expect(result.draft.amount).toBe(10000);
    }
  });

  it('nominal tidak dikenali menghasilkan needs_amount tanpa menebak', async () => {
    const { deps } = depsWithModelReplies([
      JSON.stringify({ type: 'EXPENSE', categoryId: 'cat-makan' }),
    ]);
    const result = await parseNaturalInput(
      { sub: 'u1', sentence: 'makan di luar', categories: CATEGORIES, todayWib: '2025-08-20' },
      deps,
    );
    expect(result.status).toBe('needs_amount');
    if (result.status === 'needs_amount') {
      expect(result.draft.amount).toBeUndefined();
      expect(result.draft.type).toBe('EXPENSE');
    }
  });

  it('menoleransi JSON dalam blok kode', async () => {
    const { deps } = depsWithModelReplies([
      '```json\n{"type":"EXPENSE","amount":20000,"categoryId":"cat-makan"}\n```',
    ]);
    const result = await parseNaturalInput(
      { sub: 'u1', sentence: 'kopi 20rb', categories: CATEGORIES, todayWib: '2025-08-20' },
      deps,
    );
    expect(result).toMatchObject({ status: 'ok', amount: 20000 });
  });

  it('mencoba ulang sekali saat balasan pertama bukan JSON valid', async () => {
    const { deps, modelCalls } = depsWithModelReplies([
      'maaf saya tidak bisa',
      JSON.stringify({ type: 'EXPENSE', amount: 12000, categoryId: 'cat-makan' }),
    ]);
    const result = await parseNaturalInput(
      { sub: 'u1', sentence: 'parkir 12rb', categories: CATEGORIES, todayWib: '2025-08-20' },
      deps,
    );
    expect(modelCalls).toHaveLength(2);
    expect(result).toMatchObject({ status: 'ok', amount: 12000 });
  });

  it('dua balasan tidak valid menghasilkan needs_amount tanpa percobaan ketiga', async () => {
    const { deps, modelCalls } = depsWithModelReplies(['bukan json', 'tetap bukan json']);
    const result = await parseNaturalInput(
      { sub: 'u1', sentence: 'entah apa', categories: CATEGORIES, todayWib: '2025-08-20' },
      deps,
    );
    expect(modelCalls).toHaveLength(2);
    expect(result.status).toBe('needs_amount');
  });

  it('tidak memanggil model saat pembatas pemakaian menolak', async () => {
    const invokeModel = vi.fn(async () => '{}');
    const enforce = vi.fn(async () => {
      throw new RateLimitedError();
    });
    await expect(
      parseNaturalInput(
        { sub: 'u1', sentence: 'apa saja', categories: CATEGORIES, todayWib: '2025-08-20' },
        {
          config: CONFIG,
          enforceRateLimit: enforce as unknown as ParseNaturalInputDeps['enforceRateLimit'],
          invokeModel,
        },
      ),
    ).rejects.toBeInstanceOf(RateLimitedError);
    expect(invokeModel).not.toHaveBeenCalled();
  });

  it('meneruskan sub dan batas ke pembatas pemakaian', async () => {
    const { deps, enforce } = depsWithModelReplies([
      JSON.stringify({ type: 'EXPENSE', amount: 1000, categoryId: 'cat-makan' }),
    ]);
    await parseNaturalInput(
      { sub: 'user-xyz', sentence: 'permen 1rb', categories: CATEGORIES, todayWib: '2025-08-20' },
      deps,
    );
    expect(enforce).toHaveBeenCalledWith(expect.objectContaining({ sub: 'user-xyz', limit: 30 }));
  });
});
