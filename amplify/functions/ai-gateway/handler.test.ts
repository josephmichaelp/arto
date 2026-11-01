import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from 'shared/config';
import type { Category } from 'shared/domain';
import {
  runAiGateway,
  type AiGatewayEvent,
  type AiGatewayHandlerDeps,
  type FinanceRepo,
} from './handler';
import type { AssistantFinanceData } from './assistant';
import { RateLimitedError } from './rate-limiter';
import { AiUnavailableError } from './bedrock-client';

/**
 * Uji unit handler `ai-gateway` (tugas 8.8; Requirement 16.2, 16.3).
 *
 * Seluruh dependensi (repositori data, pembatas pemakaian, dan modul operasi)
 * disuntik sehingga uji berjalan tanpa AWS/Bedrock. Fokus: penolakan
 * identitas kosong, penegakan pembatas sekali sebelum Bedrock, perutean
 * operasi, dan pemetaan galat ke amplop respons.
 */

const categories: Category[] = [
  { id: 'c-makan', name: 'Makan', type: 'EXPENSE' },
  { id: 'c-gaji', name: 'Gaji', type: 'INCOME' },
];

const assistantData: AssistantFinanceData = {
  categories,
  wallets: [{ id: 'w-tunai', name: 'Tunai', initialBalance: 0, balance: 1_000_000 }],
  budgets: [],
  txns: [],
};

const config: AppConfig = {
  bedrockRegion: 'ap-southeast-3',
  modelCandidates: [{ modelId: 'amazon.nova-lite-v1:0', region: 'ap-southeast-3' }],
  allowCrossRegion: true,
  aiRateLimit: 30,
};

const identity = { sub: 'sub-123', username: 'ana' };

function makeRepo(overrides: Partial<FinanceRepo> = {}): FinanceRepo {
  return {
    listCategories: vi.fn().mockResolvedValue(categories),
    loadAssistantData: vi.fn().mockResolvedValue(assistantData),
    ...overrides,
  };
}

function baseDeps(overrides: Partial<AiGatewayHandlerDeps> = {}): AiGatewayHandlerDeps {
  return {
    config,
    now: () => new Date('2025-01-15T03:00:00Z'),
    repo: makeRepo(),
    enforceRateLimit: vi.fn().mockResolvedValue({ key: 'k', count: 1, bucket: 'b' }),
    ...overrides,
  };
}

function event(fieldName: string, input: unknown, id: unknown = identity): AiGatewayEvent {
  return { info: { fieldName }, arguments: { input }, identity: id as AiGatewayEvent['identity'] };
}

describe('runAiGateway identitas', () => {
  it('menolak identitas kosong tanpa memuat data atau memanggil pembatas', async () => {
    const enforceRateLimit = vi.fn();
    const repo = makeRepo();
    const res = await runAiGateway(
      event('parseNaturalInput', { sentence: 'kopi 20rb' }, { sub: '', username: '' }),
      baseDeps({ enforceRateLimit, repo }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('UNAUTHENTICATED');
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(repo.listCategories).not.toHaveBeenCalled();
  });

  it('menolak identitas yang hilang sepenuhnya', async () => {
    const res = await runAiGateway(event('askAssistant', { question: 'halo' }, null), baseDeps());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('UNAUTHENTICATED');
  });

  it('menurunkan identitas dari claims bila tidak ada di akar', async () => {
    const parseNaturalInput = vi.fn().mockResolvedValue({ status: 'needs_amount', draft: {} });
    const res = await runAiGateway(
      {
        info: { fieldName: 'parseNaturalInput' },
        arguments: { input: { sentence: 'kopi' } },
        identity: { claims: { sub: 'sub-9', 'cognito:username': 'budi' } },
      },
      baseDeps({ parseNaturalInput }),
    );
    expect(res.ok).toBe(true);
    expect(parseNaturalInput).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'sub-9' }),
      expect.anything(),
    );
  });
});

describe('runAiGateway perutean', () => {
  it('parseNaturalInput: memuat Kategori, menegakkan pembatas sekali, dan mengembalikan hasil', async () => {
    const enforceRateLimit = vi.fn().mockResolvedValue({ key: 'k', count: 1, bucket: 'b' });
    const repo = makeRepo();
    const parseNaturalInput = vi
      .fn()
      .mockResolvedValue({ status: 'ok', type: 'EXPENSE', amount: 20_000, date: '2025-01-15', categoryId: 'c-makan' });

    const res = await runAiGateway(
      event('parseNaturalInput', { sentence: 'kopi 20rb' }),
      baseDeps({ enforceRateLimit, repo, parseNaturalInput }),
    );

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toMatchObject({ status: 'ok', amount: 20_000 });
    expect(repo.listCategories).toHaveBeenCalledWith('sub-123::ana');
    expect(enforceRateLimit).toHaveBeenCalledTimes(1);
    expect(enforceRateLimit).toHaveBeenCalledWith(expect.objectContaining({ sub: 'sub-123', limit: 30 }));
    // Modul menerima penegak no-op agar hitungan tidak berganda.
    const injected = parseNaturalInput.mock.calls[0]![1] as { enforceRateLimit?: unknown };
    expect(injected.enforceRateLimit).toBeTypeOf('function');
  });

  it('createReceiptUpload: TIDAK menegakkan pembatas (tidak memanggil Bedrock)', async () => {
    const enforceRateLimit = vi.fn();
    const createReceiptUpload = vi
      .fn()
      .mockResolvedValue({ key: 'receipts/sub-123/u1', url: 'https://x', fields: {}, expiresAt: 'z' });

    const res = await runAiGateway(
      event('createReceiptUpload', { contentType: 'image/jpeg', size: 1024 }),
      baseDeps({ enforceRateLimit, createReceiptUpload }),
    );

    expect(res.ok).toBe(true);
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(createReceiptUpload).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'sub-123', contentType: 'image/jpeg', size: 1024 }),
    );
  });

  it('scanReceipt: menegakkan pembatas lalu memindai', async () => {
    const enforceRateLimit = vi.fn().mockResolvedValue({ key: 'k', count: 2, bucket: 'b' });
    const scanReceipt = vi.fn().mockResolvedValue({ status: 'needs_amount', draft: {} });

    const res = await runAiGateway(
      event('scanReceipt', { key: 'receipts/sub-123/u1' }),
      baseDeps({ enforceRateLimit, scanReceipt }),
    );

    expect(res.ok).toBe(true);
    expect(enforceRateLimit).toHaveBeenCalledTimes(1);
    expect(scanReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'sub-123', key: 'receipts/sub-123/u1' }),
      expect.anything(),
    );
  });

  it('askAssistant: memuat data pemilik dan meneruskannya ke modul', async () => {
    const repo = makeRepo();
    const askAssistant = vi.fn().mockResolvedValue({ owner: 'sub-123::ana', answer: 'Rp 1.000.000' });

    const res = await runAiGateway(
      event('askAssistant', { question: 'berapa saldo saya?' }),
      baseDeps({ repo, askAssistant }),
    );

    expect(res.ok).toBe(true);
    expect(repo.loadAssistantData).toHaveBeenCalledWith('sub-123::ana');
    const arg = askAssistant.mock.calls[0]![0] as { data: AssistantFinanceData };
    expect(arg.data).toBe(assistantData);
  });

  it('operasi tidak dikenal mengembalikan galat VALIDATION', async () => {
    const res = await runAiGateway(event('unknownOp', {}), baseDeps());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('VALIDATION');
  });

  it('masukan tanpa field wajib mengembalikan galat VALIDATION', async () => {
    const res = await runAiGateway(event('parseNaturalInput', {}), baseDeps());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('VALIDATION');
  });
});

describe('runAiGateway pemetaan galat', () => {
  it('RateLimitedError dipetakan ke RATE_LIMITED tanpa memanggil modul Bedrock', async () => {
    const enforceRateLimit = vi.fn().mockRejectedValue(new RateLimitedError());
    const parseNaturalInput = vi.fn();

    const res = await runAiGateway(
      event('parseNaturalInput', { sentence: 'kopi 20rb' }),
      baseDeps({ enforceRateLimit, parseNaturalInput }),
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('RATE_LIMITED');
    expect(parseNaturalInput).not.toHaveBeenCalled();
  });

  it('AiUnavailableError dipetakan ke AI_UNAVAILABLE', async () => {
    const askAssistant = vi.fn().mockRejectedValue(new AiUnavailableError());
    const res = await runAiGateway(
      event('askAssistant', { question: 'halo' }),
      baseDeps({ askAssistant }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('AI_UNAVAILABLE');
  });

  it('galat tak terduga tidak membocorkan detail internal', async () => {
    const askAssistant = vi.fn().mockRejectedValue(new Error('rahasia stack trace'));
    const res = await runAiGateway(
      event('askAssistant', { question: 'halo' }),
      baseDeps({ askAssistant }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('INTERNAL');
      expect(res.message).not.toContain('rahasia');
    }
  });
});
