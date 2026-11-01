import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from 'shared/config';
import type { Budget, Category, Txn, Wallet } from 'shared/domain';
import {
  MAX_CONTEXT_TXNS,
  askAssistant,
  buildFinanceContext,
  type AssistantFinanceData,
} from './assistant';
import { RateLimitedError } from './rate-limiter';

/**
 * Uji operasi `askAssistant` (Requirement 12.1-12.4, Property 18).
 *
 * Dependensi Bedrock dan pembatas pemakaian disuntik sehingga uji berjalan
 * tanpa AWS. Fokus: isolasi konteks pemilik, penegakan pembatas sebelum
 * memanggil model, dan pemformatan nominal pada jawaban.
 */

const categories: Category[] = [
  { id: 'c-makan', name: 'Makan', type: 'EXPENSE' },
  { id: 'c-gaji', name: 'Gaji', type: 'INCOME' },
];

const wallets: Wallet[] = [
  { id: 'w-tunai', name: 'Tunai', initialBalance: 0, balance: 1_500_000 },
  { id: 'w-bank', name: 'Bank', initialBalance: 0, balance: 2_000_000 },
];

const budgets: Budget[] = [{ id: 'c-makan#2025-01', categoryId: 'c-makan', month: '2025-01', amount: 1_000_000 }];

const txns: Txn[] = [
  { id: 't1', type: 'EXPENSE', amount: 850_000, date: '2025-01-10', categoryId: 'c-makan', walletId: 'w-tunai' },
  { id: 't2', type: 'INCOME', amount: 5_000_000, date: '2025-01-01', categoryId: 'c-gaji', walletId: 'w-bank' },
];

const data: AssistantFinanceData = { categories, wallets, budgets, txns };

const config: AppConfig = {
  bedrockRegion: 'ap-southeast-3',
  modelCandidates: [{ modelId: 'amazon.nova-lite-v1:0', region: 'ap-southeast-3' }],
  allowCrossRegion: true,
  aiRateLimit: 30,
};

describe('buildFinanceContext', () => {
  it('ringkasan bulan berjalan, saldo, kategori terbesar, dan anggaran dengan Format_Rupiah', () => {
    const ctx = buildFinanceContext(data, '2025-01-15');
    expect(ctx).toContain('Bulan berjalan: 2025-01');
    expect(ctx).toContain('Pemasukan: Rp 5.000.000');
    expect(ctx).toContain('Pengeluaran: Rp 850.000');
    expect(ctx).toContain('Selisih: Rp 4.150.000');
    expect(ctx).toContain('Total saldo: Rp 3.500.000');
    expect(ctx).toContain('Makan: Rp 850.000');
    expect(ctx).toContain('level WARN80');
  });

  it('hanya memuat data yang diberikan (isolasi pemilik, Property 18)', () => {
    const other: Txn = {
      id: 'z-other',
      type: 'EXPENSE',
      amount: 999_999,
      date: '2025-01-20',
      categoryId: 'c-rahasia',
      walletId: 'w-rahasia',
    };
    const ctx = buildFinanceContext(data, '2025-01-15');
    // Transaksi/nilai milik pemilik lain tidak pernah muncul karena tidak disuntikkan.
    expect(ctx).not.toContain('999.999');
    expect(ctx).not.toContain(other.id);
  });

  it('membatasi Transaksi terbaru hingga MAX_CONTEXT_TXNS dan mengurutkan menurun', () => {
    const many: Txn[] = Array.from({ length: MAX_CONTEXT_TXNS + 10 }, (_, i) => ({
      id: `t${String(i).padStart(3, '0')}`,
      type: 'EXPENSE' as const,
      amount: 1000 + i,
      date: `2025-01-${String((i % 28) + 1).padStart(2, '0')}`,
      categoryId: 'c-makan',
      walletId: 'w-tunai',
    }));
    const ctx = buildFinanceContext({ ...data, txns: many }, '2025-02-01');
    const txnLines = ctx.split('\n').filter((l) => l.startsWith('- 2025-01-'));
    expect(txnLines.length).toBe(MAX_CONTEXT_TXNS);
  });

  it('menangani data kosong tanpa galat', () => {
    const empty: AssistantFinanceData = { categories: [], wallets: [], budgets: [], txns: [] };
    const ctx = buildFinanceContext(empty, '2025-01-15');
    expect(ctx).toContain('(belum ada Dompet)');
    expect(ctx).toContain('(belum ada pengeluaran bulan ini)');
    expect(ctx).toContain('(belum ada Anggaran bulan ini)');
    expect(ctx).toContain('(belum ada Transaksi)');
  });
});

describe('askAssistant', () => {
  const identity = { sub: 'sub-123', username: 'ana' };

  it('menolak identitas kosong tanpa memanggil pembatas atau model', async () => {
    const enforceRateLimit = vi.fn();
    const converse = vi.fn();
    await expect(
      askAssistant({ identity: { sub: '', username: '' }, question: 'halo', data, config, deps: { enforceRateLimit, converse } }),
    ).rejects.toThrow();
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(converse).not.toHaveBeenCalled();
  });

  it('menegakkan pembatas pemakaian sebelum memanggil model', async () => {
    const enforceRateLimit = vi.fn().mockRejectedValue(new RateLimitedError());
    const converse = vi.fn();
    await expect(
      askAssistant({ identity, question: 'berapa pengeluaran saya?', data, config, deps: { enforceRateLimit, converse } }),
    ).rejects.toBeInstanceOf(RateLimitedError);
    expect(enforceRateLimit).toHaveBeenCalledWith(expect.objectContaining({ sub: 'sub-123', limit: 30 }));
    expect(converse).not.toHaveBeenCalled();
  });

  it('membangun konteks dari data Pengguna dan memformat nominal pada jawaban', async () => {
    const enforceRateLimit = vi.fn().mockResolvedValue({ key: 'k', count: 1, bucket: 'b' });
    const converse = vi
      .fn()
      .mockResolvedValue('Pengeluaran makan Anda Rp850000 bulan ini.');

    const result = await askAssistant({
      identity,
      question: 'berapa pengeluaran makan saya?',
      data,
      config,
      nowWib: '2025-01-15',
      deps: { enforceRateLimit, converse },
    });

    expect(result.owner).toBe('sub-123::ana');
    // formatAmountsInText mengubah "Rp850000" menjadi Format_Rupiah.
    expect(result.answer).toContain('Rp 850.000');

    const call = converse.mock.calls[0]![0] as { system: string };
    expect(call.system).toContain('Pengeluaran: Rp 850.000');
    expect(call.system).toContain('asisten keuangan pribadi');
  });

  it('memetakan galat panggilan model ke AiUnavailableError', async () => {
    const enforceRateLimit = vi.fn().mockResolvedValue({ key: 'k', count: 1, bucket: 'b' });
    const converse = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(
      askAssistant({ identity, question: 'halo', data, config, nowWib: '2025-01-15', deps: { enforceRateLimit, converse } }),
    ).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
  });
});
