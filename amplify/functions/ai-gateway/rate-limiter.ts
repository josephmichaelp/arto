import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { decideRate, hourBucket, DEFAULT_AI_RATE_LIMIT } from 'shared/domain';

/**
 * Pembatas pemakaian AI yang bertahan (Requirement 16.3, Property 23).
 *
 * Setiap permintaan AI dihitung per Pengguna (`sub`) per jam UTC. Jendela jam
 * dan keputusan izin/tolak diambil dari logika murni di
 * `shared/domain/rate-limit.ts` (`hourBucket` dan `decideRate`); modul ini
 * hanya menambahkan persistensi ke DynamoDB.
 *
 * Mekanisme:
 * - Kunci item tabel `AiUsage`: `USAGE#<sub>#<hourBucket>` (lihat
 *   dokumen desain). TTL diatur 2 jam agar item kedaluwarsa otomatis.
 * - `UpdateItem` dengan klausa `ADD #count :one` menaikkan hitungan secara
 *   atomik dan mengembalikan nilai baru (`ReturnValues: 'ALL_NEW'`).
 * - `ConditionExpression` menjaga batas: permintaan hanya diterima selama
 *   hitungan sebelum kenaikan masih di bawah `limit`
 *   (`attribute_not_exists(#count) OR #count < :limit`), sehingga hitungan
 *   setelah kenaikan tidak pernah melampaui `limit`. Bila kondisi gagal
 *   (`ConditionalCheckFailedException`), permintaan ditolak dengan galat
 *   `RATE_LIMITED` berbahasa Indonesia dan Bedrock tidak dipanggil.
 */

export const AI_RATE_LIMITED = 'RATE_LIMITED';

/** TTL default item pemakaian: 2 jam (detik). */
export const USAGE_TTL_SECONDS = 2 * 60 * 60;

/** Nama variabel lingkungan untuk tabel pemakaian AI. */
export const AI_USAGE_TABLE_ENV = 'AI_USAGE_TABLE_NAME';

/** Nama atribut kunci utama pada tabel `AiUsage`. */
const KEY_ATTR = 'id';
/** Nama atribut hitungan permintaan. */
const COUNT_ATTR = 'count';
/** Nama atribut TTL. */
const TTL_ATTR = 'ttl';

/** Galat saat batas pemakaian AI per jam terlampaui (Requirement 16.3). */
export class RateLimitedError extends Error {
  readonly code = AI_RATE_LIMITED;

  constructor(
    message = 'Batas pemakaian AI tercapai. Coba lagi pada jam berikutnya.',
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'RateLimitedError';
  }
}

/** Membentuk kunci item pemakaian `USAGE#<sub>#<hourBucket>`. */
export function usageKey(sub: string, instant: Date): string {
  const trimmed = sub.trim();
  if (!trimmed) {
    throw new Error('Identitas Pengguna kosong');
  }
  return `USAGE#${trimmed}#${hourBucket(instant)}`;
}

function isConditionalCheckFailure(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === 'ConditionalCheckFailedException';
}

let sharedDocClient: DynamoDBDocumentClient | undefined;

function getDocClient(): DynamoDBDocumentClient {
  if (!sharedDocClient) {
    sharedDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return sharedDocClient;
}

/** Mengosongkan klien dokumen bersama. Dipakai pengujian. */
export function resetUsageDocClient(): void {
  sharedDocClient = undefined;
}

export interface EnforceRateLimitOptions {
  /** `sub` Pengguna terautentikasi (bukan `owner` lengkap). */
  sub: string;
  /** Batas per jam (default 30, lihat `AI_RATE_LIMIT`). */
  limit?: number;
  /** Instan saat permintaan tiba (default `new Date()`). */
  now?: Date;
  /** Klien DynamoDB; disuntik pada pengujian. */
  client?: DynamoDBDocumentClient;
  /** Nama tabel; default dibaca dari variabel lingkungan `AI_USAGE_TABLE_NAME`. */
  tableName?: string;
  /** TTL item dalam detik (default 2 jam). */
  ttlSeconds?: number;
}

export interface RateLimitResult {
  /** Kunci item pemakaian yang dinaikkan. */
  key: string;
  /** Hitungan permintaan setelah kenaikan pada jendela jam ini. */
  count: number;
  /** Jendela jam UTC (`hourBucket`). */
  bucket: string;
}

function resolveTableName(explicit: string | undefined): string {
  const name = explicit ?? process.env[AI_USAGE_TABLE_ENV];
  if (!name) {
    throw new Error(`Variabel lingkungan nama tabel hilang: ${AI_USAGE_TABLE_ENV}`);
  }
  return name;
}

/**
 * Menaikkan hitungan pemakaian AI Pengguna untuk jam berjalan dan menegakkan
 * batas. Mengembalikan hitungan terkini bila diizinkan; melempar
 * {@link RateLimitedError} bila batas terlampaui (tanpa memanggil Bedrock).
 *
 * Harus dipanggil sebelum memanggil model di handler `ai-gateway`.
 */
export async function enforceRateLimit(options: EnforceRateLimitOptions): Promise<RateLimitResult> {
  const limit = options.limit ?? DEFAULT_AI_RATE_LIMIT;
  const now = options.now ?? new Date();
  const client = options.client ?? getDocClient();
  const tableName = resolveTableName(options.tableName);
  const ttlSeconds = options.ttlSeconds ?? USAGE_TTL_SECONDS;

  const bucket = hourBucket(now);
  const key = usageKey(options.sub, now);
  const ttl = Math.floor(now.getTime() / 1000) + ttlSeconds;

  try {
    const out = await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { [KEY_ATTR]: key },
        UpdateExpression: 'SET #ttl = if_not_exists(#ttl, :ttl) ADD #count :one',
        ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit',
        ExpressionAttributeNames: {
          '#count': COUNT_ATTR,
          '#ttl': TTL_ATTR,
        },
        ExpressionAttributeValues: {
          ':one': 1,
          ':limit': limit,
          ':ttl': ttl,
        },
        ReturnValues: 'ALL_NEW',
      }),
    );

    const count = Number(out.Attributes?.[COUNT_ATTR] ?? 0);
    // Pemeriksaan ulang lewat logika murni: hitungan setelah kenaikan tidak
    // boleh melampaui batas. Kondisi DynamoDB sudah menjamin hal ini, tetapi
    // `decideRate` menjaga sumber kebenaran keputusan tetap tunggal.
    const decision = decideRate(count, limit);
    if (!decision.allowed) {
      throw new RateLimitedError(decision.message);
    }
    return { key, count, bucket };
  } catch (err) {
    if (err instanceof RateLimitedError) throw err;
    if (isConditionalCheckFailure(err)) {
      // Hitungan sudah mencapai batas: permintaan ke-(limit+1) ditolak.
      const decision = decideRate(limit + 1, limit);
      throw new RateLimitedError(decision.message, { cause: err });
    }
    throw err;
  }
}
