import { describe, expect, it } from 'vitest';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  AI_RATE_LIMITED,
  RateLimitedError,
  enforceRateLimit,
  usageKey,
} from './rate-limiter';

/**
 * Pembatas pemakaian AI yang bertahan (Property 23, Requirement 16.3).
 *
 * `FakeUsageTable` meniru semantik `UpdateItem ADD` DynamoDB dengan
 * `ConditionExpression attribute_not_exists(#count) OR #count < :limit`:
 * hitungan dinaikkan satu per permintaan dan melempar
 * `ConditionalCheckFailedException` begitu batas tercapai.
 */
class FakeUsageTable {
  private readonly counts = new Map<string, number>();
  readonly sends: unknown[] = [];

  async send(command: unknown): Promise<{ Attributes?: Record<string, unknown> }> {
    this.sends.push(command);
    if (!(command instanceof UpdateCommand)) {
      throw new Error('Perintah tak terduga');
    }
    const input = command.input;
    const key = (input.Key as { id: string }).id;
    const limit = Number(input.ExpressionAttributeValues?.[':limit']);
    const current = this.counts.get(key) ?? 0;

    // Condition: attribute_not_exists(#count) OR #count < :limit
    if (current >= limit) {
      const err = new Error('The conditional request failed');
      err.name = 'ConditionalCheckFailedException';
      throw err;
    }

    const next = current + 1;
    this.counts.set(key, next);
    return { Attributes: { count: next } };
  }
}

const TABLE = 'AiUsage-test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake klien untuk uji
const asClient = (table: FakeUsageTable) => table as any;

describe('usageKey', () => {
  it('membentuk kunci USAGE#<sub>#<hourBucket>', () => {
    expect(usageKey('sub-1', new Date('2025-08-17T14:23:45.000Z'))).toBe(
      'USAGE#sub-1#2025-08-17T14',
    );
  });

  it('menolak identitas kosong', () => {
    expect(() => usageKey('   ', new Date())).toThrow();
  });
});

describe('enforceRateLimit - Property 23: Pembatas pemakaian AI', () => {
  it('mengizinkan tepat `limit` permintaan dalam satu jam lalu menolak sisanya', async () => {
    const table = new FakeUsageTable();
    const now = new Date('2025-08-17T14:10:00.000Z');
    const limit = 30;

    for (let i = 1; i <= limit; i++) {
      const result = await enforceRateLimit({ sub: 'sub-1', limit, now, client: asClient(table), tableName: TABLE });
      expect(result.count).toBe(i);
      expect(result.bucket).toBe('2025-08-17T14');
    }

    // Permintaan ke-(limit+1) ditolak dengan RATE_LIMITED, tanpa efek lain.
    await expect(
      enforceRateLimit({ sub: 'sub-1', limit, now, client: asClient(table), tableName: TABLE }),
    ).rejects.toMatchObject({ code: AI_RATE_LIMITED });
  });

  it('menghitung terpisah per Pengguna', async () => {
    const table = new FakeUsageTable();
    const now = new Date('2025-08-17T14:10:00.000Z');
    const limit = 2;

    await enforceRateLimit({ sub: 'a', limit, now, client: asClient(table), tableName: TABLE });
    await enforceRateLimit({ sub: 'a', limit, now, client: asClient(table), tableName: TABLE });
    await expect(
      enforceRateLimit({ sub: 'a', limit, now, client: asClient(table), tableName: TABLE }),
    ).rejects.toBeInstanceOf(RateLimitedError);

    // Pengguna lain tidak terpengaruh.
    const other = await enforceRateLimit({ sub: 'b', limit, now, client: asClient(table), tableName: TABLE });
    expect(other.count).toBe(1);
  });

  it('mengatur ulang hitungan pada jam UTC berikutnya', async () => {
    const table = new FakeUsageTable();
    const limit = 1;
    const hour1 = new Date('2025-08-17T14:59:00.000Z');
    const hour2 = new Date('2025-08-17T15:00:00.000Z');

    await enforceRateLimit({ sub: 'sub-1', limit, now: hour1, client: asClient(table), tableName: TABLE });
    await expect(
      enforceRateLimit({ sub: 'sub-1', limit, now: hour1, client: asClient(table), tableName: TABLE }),
    ).rejects.toBeInstanceOf(RateLimitedError);

    // Jam berikutnya: kunci berbeda, hitungan mulai dari 1 lagi.
    const next = await enforceRateLimit({ sub: 'sub-1', limit, now: hour2, client: asClient(table), tableName: TABLE });
    expect(next.count).toBe(1);
    expect(next.bucket).toBe('2025-08-17T15');
  });

  it('menyetel TTL dan ADD count pada perintah UpdateItem', async () => {
    const table = new FakeUsageTable();
    const now = new Date('2025-08-17T14:00:00.000Z');

    await enforceRateLimit({ sub: 'sub-1', limit: 30, now, client: asClient(table), tableName: TABLE, ttlSeconds: 7200 });

    const command = table.sends[0] as UpdateCommand;
    expect(command.input.TableName).toBe(TABLE);
    expect(command.input.Key).toEqual({ id: 'USAGE#sub-1#2025-08-17T14' });
    expect(command.input.UpdateExpression).toContain('ADD #count :one');
    expect(command.input.ConditionExpression).toContain('#count < :limit');
    expect(command.input.ExpressionAttributeValues?.[':ttl']).toBe(
      Math.floor(now.getTime() / 1000) + 7200,
    );
  });
});
