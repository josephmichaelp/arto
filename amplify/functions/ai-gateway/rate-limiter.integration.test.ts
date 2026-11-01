import { describe, expect, it, vi } from 'vitest';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { AppConfig } from 'shared/config';
import type { Category } from 'shared/domain';
import {
  runAiGateway,
  type AiGatewayEvent,
  type AiGatewayHandlerDeps,
  type FinanceRepo,
} from './handler';
import { enforceRateLimit } from './rate-limiter';
import type { AssistantFinanceData } from './assistant';

/**
 * Uji pembatas pemakaian AI terintegrasi (tugas 8.9; Property 23,
 * Requirement 16.3).
 *
 * Berbeda dari `rate-limiter.test.ts` (yang menguji `enforceRateLimit` murni)
 * dan `handler.test.ts` (yang MENYUNTIK penegak tiruan), uji ini merangkai
 * penegak NYATA `enforceRateLimit` ke dalam `runAiGateway`, didukung sebuah
 * tabel DynamoDB palsu yang meniru semantik `UpdateItem ADD` kondisional
 * secara setia. Tujuannya membuktikan bahwa:
 *
 * - Memanggil operasi AI tepat `limit` kali dalam satu jam diizinkan,
 *   permintaan ke-(limit+1) pada jam yang sama DITOLAK dengan `RATE_LIMITED`,
 *   dan klien Bedrock palsu TIDAK dipanggil pada permintaan yang ditolak.
 * - Pembatas bersifat per Pengguna dan per jam UTC: jam berikutnya diizinkan
 *   lagi, dan Pengguna lain tidak terpengaruh.
 * - Semua operasi AI yang memanggil Bedrock (`parseNaturalInput`,
 *   `scanReceipt`, `askAssistant`) berbagi penghitung jam yang sama, sehingga
 *   batas ditegakkan lintas operasi.
 */

// --- Tabel pemakaian palsu (meniru UpdateItem ADD kondisional) -------------

/**
 * Meniru `UpdateItem` DynamoDB dengan:
 *   UpdateExpression: 'SET #ttl = if_not_exists(#ttl, :ttl) ADD #count :one'
 *   ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit'
 *   ReturnValues: 'ALL_NEW'
 *
 * Hitungan dinaikkan satu secara atomik per permintaan yang lolos kondisi;
 * begitu hitungan mencapai `:limit`, kondisi gagal dan
 * `ConditionalCheckFailedException` dilempar (persis seperti DynamoDB), yang
 * dipetakan `enforceRateLimit` menjadi galat `RATE_LIMITED`.
 */
interface UsageItem {
  count: number;
  ttl: number;
}

class FakeUsageTable {
  private readonly items = new Map<string, UsageItem>();
  /** Semua perintah yang diterima, untuk inspeksi uji. */
  readonly sends: UpdateCommand[] = [];

  async send(command: unknown): Promise<{ Attributes?: Record<string, unknown> }> {
    if (!(command instanceof UpdateCommand)) {
      throw new Error('Perintah tak terduga pada tabel pemakaian palsu');
    }
    this.sends.push(command);

    const input = command.input;
    const key = (input.Key as { id: string }).id;
    const values = input.ExpressionAttributeValues ?? {};
    const limit = Number(values[':limit']);
    const ttlCandidate = Number(values[':ttl']);
    const existing = this.items.get(key);
    const current = existing?.count ?? 0;

    // ConditionExpression: attribute_not_exists(#count) OR #count < :limit
    if (!(current < limit)) {
      const err = new Error('The conditional request failed');
      err.name = 'ConditionalCheckFailedException';
      throw err;
    }

    // SET #ttl = if_not_exists(#ttl, :ttl) ADD #count :one
    const ttl = existing?.ttl ?? ttlCandidate;
    const next: UsageItem = { count: current + 1, ttl };
    this.items.set(key, next);

    // ReturnValues: 'ALL_NEW'
    return { Attributes: { id: key, count: next.count, ttl: next.ttl } };
  }

  /** Hitungan tersimpan untuk sebuah kunci (untuk asersi). */
  countFor(key: string): number {
    return this.items.get(key)?.count ?? 0;
  }
}

const TABLE = 'AiUsage-integration-test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake klien untuk uji
const asClient = (table: FakeUsageTable) => table as any;

// --- Klien Bedrock palsu ---------------------------------------------------

/**
 * Perwakilan klien Bedrock. Setiap operasi AI yang memanggil model menaikkan
 * `invocations`. Pembatas pemakaian berada SEBELUM pemanggilan ini, sehingga
 * permintaan yang ditolak tidak boleh menambah `invocations`.
 */
class FakeBedrock {
  invocations = 0;
  invoke(): void {
    this.invocations++;
  }
}

// --- Data dan konfigurasi dasar --------------------------------------------

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

function makeConfig(limit: number): AppConfig {
  return {
    bedrockRegion: 'ap-southeast-3',
    modelCandidates: [{ modelId: 'amazon.nova-lite-v1:0', region: 'ap-southeast-3' }],
    allowCrossRegion: true,
    aiRateLimit: limit,
  };
}

const identity = { sub: 'sub-123', username: 'ana' };

function makeRepo(): FinanceRepo {
  return {
    listCategories: vi.fn().mockResolvedValue(categories),
    loadAssistantData: vi.fn().mockResolvedValue(assistantData),
  };
}

/**
 * Setiap operasi AI yang memanggil Bedrock, diwakili modul palsu yang
 * memanggil `bedrock.invoke()` lalu mengembalikan hasil dummy. Penegak NYATA
 * `enforceRateLimit` dirangkai ke handler dengan tabel dan nama tabel palsu.
 */
function makeBedrockDeps(
  bedrock: FakeBedrock,
  table: FakeUsageTable,
  config: AppConfig,
  clock: () => Date,
): AiGatewayHandlerDeps {
  return {
    config,
    now: clock,
    repo: makeRepo(),
    enforceRateLimit: (options) =>
      enforceRateLimit({ ...options, client: asClient(table), tableName: TABLE }),
    parseNaturalInput: vi.fn(async () => {
      bedrock.invoke();
      return { status: 'ok', type: 'EXPENSE', amount: 20_000, date: '2025-01-15', categoryId: 'c-makan' };
    }) as unknown as AiGatewayHandlerDeps['parseNaturalInput'],
    scanReceipt: vi.fn(async () => {
      bedrock.invoke();
      return { status: 'needs_amount', draft: {} };
    }) as unknown as AiGatewayHandlerDeps['scanReceipt'],
    askAssistant: vi.fn(async () => {
      bedrock.invoke();
      return { owner: 'sub-123::ana', answer: 'Rp 1.000.000' };
    }) as unknown as AiGatewayHandlerDeps['askAssistant'],
  };
}

interface OpCase {
  readonly name: string;
  readonly event: (id?: unknown) => AiGatewayEvent;
}

function event(fieldName: string, input: unknown, id: unknown = identity): AiGatewayEvent {
  return { info: { fieldName }, arguments: { input }, identity: id as AiGatewayEvent['identity'] };
}

const BEDROCK_OPERATIONS: OpCase[] = [
  { name: 'parseNaturalInput', event: (id) => event('parseNaturalInput', { sentence: 'kopi 20rb' }, id) },
  { name: 'scanReceipt', event: (id) => event('scanReceipt', { key: 'receipts/sub-123/u1' }, id) },
  { name: 'askAssistant', event: (id) => event('askAssistant', { question: 'berapa saldo saya?' }, id) },
];

describe('ai-gateway rate limit terintegrasi - Property 23 / Requirement 16.3', () => {
  it.each(BEDROCK_OPERATIONS)(
    'operasi $name: mengizinkan tepat N permintaan/jam lalu menolak ke-(N+1) tanpa memanggil Bedrock',
    async ({ event: makeEvent }) => {
      const limit = 5;
      const bedrock = new FakeBedrock();
      const table = new FakeUsageTable();
      const config = makeConfig(limit);
      const now = new Date('2025-01-15T03:10:00.000Z');
      const deps = makeBedrockDeps(bedrock, table, config, () => now);

      // N permintaan pertama diizinkan dan masing-masing memanggil Bedrock.
      for (let i = 1; i <= limit; i++) {
        const res = await runAiGateway(makeEvent(), deps);
        expect(res.ok).toBe(true);
        expect(bedrock.invocations).toBe(i);
      }

      // Permintaan ke-(N+1) pada jam yang sama DITOLAK dengan RATE_LIMITED,
      // dan Bedrock TIDAK dipanggil lagi.
      const rejected = await runAiGateway(makeEvent(), deps);
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) expect(rejected.code).toBe('RATE_LIMITED');
      expect(bedrock.invocations).toBe(limit);

      // Hitungan tersimpan tepat `limit` (kenaikan tidak pernah melampaui batas).
      expect(table.countFor('USAGE#sub-123#2025-01-15T03')).toBe(limit);
    },
  );

  it('jam UTC berikutnya mengizinkan permintaan lagi', async () => {
    const limit = 2;
    const bedrock = new FakeBedrock();
    const table = new FakeUsageTable();
    const config = makeConfig(limit);

    let clock = new Date('2025-01-15T03:59:00.000Z');
    const deps = makeBedrockDeps(bedrock, table, config, () => clock);
    const ev = () => event('parseNaturalInput', { sentence: 'kopi 20rb' });

    // Habiskan kuota jam 03.
    await runAiGateway(ev(), deps);
    await runAiGateway(ev(), deps);
    const blocked = await runAiGateway(ev(), deps);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe('RATE_LIMITED');
    expect(bedrock.invocations).toBe(limit);

    // Masuk jam 04 UTC: kunci berbeda, kuota pulih.
    clock = new Date('2025-01-15T04:00:00.000Z');
    const allowed = await runAiGateway(ev(), deps);
    expect(allowed.ok).toBe(true);
    expect(bedrock.invocations).toBe(limit + 1);
    expect(table.countFor('USAGE#sub-123#2025-01-15T04')).toBe(1);
  });

  it('semua operasi AI berbagi penghitung per jam yang sama', async () => {
    const limit = 3;
    const bedrock = new FakeBedrock();
    const table = new FakeUsageTable();
    const config = makeConfig(limit);
    const now = new Date('2025-01-15T03:10:00.000Z');
    const deps = makeBedrockDeps(bedrock, table, config, () => now);

    // Tiga operasi berbeda menghabiskan satu kuota bersama (limit = 3).
    expect((await runAiGateway(event('parseNaturalInput', { sentence: 'kopi 20rb' }), deps)).ok).toBe(true);
    expect((await runAiGateway(event('scanReceipt', { key: 'receipts/sub-123/u1' }), deps)).ok).toBe(true);
    expect((await runAiGateway(event('askAssistant', { question: 'halo?' }), deps)).ok).toBe(true);
    expect(bedrock.invocations).toBe(3);

    // Operasi apa pun berikutnya pada jam yang sama ditolak.
    const rejected = await runAiGateway(event('askAssistant', { question: 'lagi?' }), deps);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.code).toBe('RATE_LIMITED');
    expect(bedrock.invocations).toBe(3);
    expect(table.countFor('USAGE#sub-123#2025-01-15T03')).toBe(limit);
  });

  it('pembatas dihitung terpisah per Pengguna', async () => {
    const limit = 1;
    const bedrock = new FakeBedrock();
    const table = new FakeUsageTable();
    const config = makeConfig(limit);
    const now = new Date('2025-01-15T03:10:00.000Z');
    const deps = makeBedrockDeps(bedrock, table, config, () => now);
    const other = { sub: 'sub-999', username: 'budi' };

    // Pengguna A menghabiskan kuotanya.
    expect((await runAiGateway(event('parseNaturalInput', { sentence: 'kopi' }), deps)).ok).toBe(true);
    const blockedA = await runAiGateway(event('parseNaturalInput', { sentence: 'kopi' }), deps);
    expect(blockedA.ok).toBe(false);
    if (!blockedA.ok) expect(blockedA.code).toBe('RATE_LIMITED');

    // Pengguna B tidak terpengaruh.
    const allowedB = await runAiGateway(event('parseNaturalInput', { sentence: 'teh' }, other), deps);
    expect(allowedB.ok).toBe(true);
    expect(table.countFor('USAGE#sub-999#2025-01-15T03')).toBe(1);
  });

  it('createReceiptUpload tidak dihitung pembatas (tidak memanggil Bedrock)', async () => {
    const limit = 1;
    const bedrock = new FakeBedrock();
    const table = new FakeUsageTable();
    const config = makeConfig(limit);
    const now = new Date('2025-01-15T03:10:00.000Z');
    const deps: AiGatewayHandlerDeps = {
      ...makeBedrockDeps(bedrock, table, config, () => now),
      createReceiptUpload: vi.fn(async () => ({
        key: 'receipts/sub-123/u1',
        url: 'https://example.invalid',
        fields: {},
        expiresAt: '2025-01-15T03:20:00.000Z',
      })) as unknown as AiGatewayHandlerDeps['createReceiptUpload'],
    };

    // Beberapa kali presign tidak menyentuh penghitung jam maupun Bedrock.
    for (let i = 0; i < 3; i++) {
      const res = await runAiGateway(
        event('createReceiptUpload', { contentType: 'image/jpeg', size: 1024 }),
        deps,
      );
      expect(res.ok).toBe(true);
    }
    expect(table.countFor('USAGE#sub-123#2025-01-15T03')).toBe(0);
    expect(bedrock.invocations).toBe(0);

    // Kuota AI masih utuh untuk operasi yang memanggil Bedrock.
    const parsed = await runAiGateway(event('parseNaturalInput', { sentence: 'kopi 20rb' }), deps);
    expect(parsed.ok).toBe(true);
    expect(bedrock.invocations).toBe(1);
  });
});
