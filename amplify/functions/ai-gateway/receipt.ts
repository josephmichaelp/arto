import { createHmac, randomUUID } from 'node:crypto';
import {
  GetObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import type { ImageFormat, Message } from '@aws-sdk/client-bedrock-runtime';
import { loadConfig, type AppConfig, type ModelCandidate } from 'shared/config';
import {
  validateReceiptResult,
  validateUpload,
  type Category,
  type NlResult,
} from 'shared/domain';
import {
  AiUnavailableError,
  extractConverseText,
  imageMessage,
  invokeConverse,
  toAiUnavailableError,
} from './bedrock-client';
import { resolveModel } from './model-resolver';
import { buildScanReceiptSystem, SCAN_RECEIPT_USER_TEXT } from './prompts';

/**
 * Operasi struk `ai-gateway`: `createReceiptUpload` dan `scanReceipt`
 * (Requirement 11.1, 11.2, 11.3, 11.4, 11.5; design.md bagian Lambda
 * `ai-gateway`).
 *
 * - `createReceiptUpload` membuat presigned POST S3 ke
 *   `receipts/<sub>/<uuid>`. Kebijakan POST mengunci `key`, `Content-Type`
 *   (JPEG/PNG), dan `content-length-range` 1..5 MB sehingga S3 sendiri yang
 *   menolak unggahan salah format atau ukuran (Req 11.1, 11.3, 11.5). Tipe
 *   dan ukuran yang dilaporkan klien tetap divalidasi lebih dulu lewat
 *   `validateUpload` (`shared/domain`) agar galat berbahasa Indonesia muncul
 *   sebelum menyentuh S3.
 * - `scanReceipt` memverifikasi bahwa kunci berawalan `receipts/<sub>/`
 *   (isolasi antar Pengguna), mengambil gambar dari bucket privat, lalu
 *   mengirimnya sebagai blok `image` pada Converse dengan prompt pemindaian.
 *   Keluaran model TIDAK dipercaya: divalidasi `validateReceiptResult`,
 *   sehingga total tak terbaca menghasilkan `needs_amount` (Req 11.2, 11.4).
 *
 * Tidak ada penegakan batas pemakaian di sini — itu dilakukan handler
 * `ai-gateway` sebelum memanggil operasi mana pun (Req 16.3, lihat
 * `rate-limiter.ts`). Modul ini juga tidak membaca region Bedrock secara
 * tertanam; region kandidat berasal dari `shared/config.ts` (Req 16.1).
 */

/** Nama variabel lingkungan untuk bucket struk privat. */
export const RECEIPT_BUCKET_ENV = 'RECEIPT_BUCKET_NAME';

/** Awalan kunci objek struk per Pengguna. */
export const RECEIPT_PREFIX = 'receipts/';

/** Batas ukuran unggahan (byte), sama dengan `validateUpload`. */
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

/** Masa berlaku presigned POST (detik). */
const DEFAULT_PRESIGN_EXPIRY_SECONDS = 300;

/** Pemetaan `Content-Type` ke format gambar Bedrock Converse. */
const CONTENT_TYPE_TO_FORMAT: Record<string, ImageFormat> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
};

/** Galat validasi masukan operasi struk (dipetakan ke pesan berbahasa Indonesia). */
export class ReceiptValidationError extends Error {
  readonly code = 'RECEIPT_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'ReceiptValidationError';
  }
}

// --- Kunci objek dan awalan -------------------------------------------------

function requireSub(sub: string): string {
  const trimmed = (sub ?? '').trim();
  if (!trimmed) {
    throw new ReceiptValidationError('Identitas Pengguna kosong');
  }
  return trimmed;
}

/** Awalan kunci milik satu Pengguna: `receipts/<sub>/`. */
export function receiptPrefixFor(sub: string): string {
  return `${RECEIPT_PREFIX}${requireSub(sub)}/`;
}

/** Membentuk kunci objek struk `receipts/<sub>/<uuid>`. */
export function buildReceiptKey(sub: string, uuid: string): string {
  return `${receiptPrefixFor(sub)}${uuid}`;
}

/**
 * Memverifikasi bahwa kunci berada di bawah awalan milik Pengguna. Menolak
 * kunci milik Pengguna lain, kunci di luar `receipts/`, dan upaya path
 * traversal (`..`).
 */
export function assertKeyBelongsToSub(key: string, sub: string): void {
  const prefix = receiptPrefixFor(sub);
  if (typeof key !== 'string' || !key.startsWith(prefix)) {
    throw new ReceiptValidationError('Kunci struk tidak sah untuk Pengguna ini');
  }
  const rest = key.slice(prefix.length);
  if (!rest || rest.includes('/') || rest.includes('..')) {
    throw new ReceiptValidationError('Kunci struk tidak sah untuk Pengguna ini');
  }
}

// --- Presigned POST ---------------------------------------------------------

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface PresignedPost {
  /** Kunci objek final `receipts/<sub>/<uuid>`. */
  key: string;
  /** URL endpoint bucket untuk `multipart/form-data` POST. */
  url: string;
  /** Field form yang WAJIB disertakan klien (termasuk `policy` dan tanda tangan). */
  fields: Record<string, string>;
  /** Waktu kedaluwarsa presigned POST (ISO 8601). */
  expiresAt: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `YYYYMMDDTHHMMSSZ` dari instan UTC (format x-amz-date). */
function amzDate(now: Date): string {
  return (
    `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}` +
    `T${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}Z`
  );
}

/** `YYYYMMDD` dari instan UTC (date stamp SigV4). */
function dateStamp(now: Date): string {
  return `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}`;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** Turunkan signing key SigV4 (service `s3`). */
function signingKey(secret: string, date: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

export interface BuildPresignedPostOptions {
  sub: string;
  contentType: string;
  size: number;
  bucket: string;
  region: string;
  credentials: AwsCredentials;
  now: Date;
  uuid: string;
  expirySeconds?: number;
  /** Endpoint dasar bucket; default `https://<bucket>.s3.<region>.amazonaws.com`. */
  endpoint?: string;
}

/**
 * Membangun presigned POST S3 (SigV4) secara deterministik dari masukan.
 * Kebijakan mengunci `key`, `Content-Type`, dan `content-length-range`
 * 1..5 MB. Diekspor terpisah dari `createReceiptUpload` agar dapat diuji
 * tanpa menyentuh AWS.
 */
export function buildPresignedPost(options: BuildPresignedPostOptions): PresignedPost {
  const check = validateUpload({ type: options.contentType, size: options.size });
  if (!check.ok) {
    throw new ReceiptValidationError(check.message);
  }
  const sub = requireSub(options.sub);
  const key = buildReceiptKey(sub, options.uuid);

  const date = dateStamp(options.now);
  const stamp = amzDate(options.now);
  const credential = `${options.credentials.accessKeyId}/${date}/${options.region}/s3/aws4_request`;
  const expirySeconds = options.expirySeconds ?? DEFAULT_PRESIGN_EXPIRY_SECONDS;
  const expiresAt = new Date(options.now.getTime() + expirySeconds * 1000).toISOString();

  const conditions: Array<Record<string, string> | [string, string | number, (string | number)?]> = [
    { bucket: options.bucket },
    ['eq', '$key', key],
    ['eq', '$Content-Type', options.contentType],
    ['content-length-range', 1, MAX_RECEIPT_BYTES],
    { 'x-amz-algorithm': 'AWS4-HMAC-SHA256' },
    { 'x-amz-credential': credential },
    { 'x-amz-date': stamp },
  ];
  if (options.credentials.sessionToken) {
    conditions.push({ 'x-amz-security-token': options.credentials.sessionToken });
  }

  const policy = { expiration: expiresAt, conditions };
  const policyBase64 = Buffer.from(JSON.stringify(policy), 'utf8').toString('base64');
  const signature = hmac(
    signingKey(options.credentials.secretAccessKey, date, options.region),
    policyBase64,
  ).toString('hex');

  const fields: Record<string, string> = {
    key,
    'Content-Type': options.contentType,
    'x-amz-algorithm': 'AWS4-HMAC-SHA256',
    'x-amz-credential': credential,
    'x-amz-date': stamp,
    policy: policyBase64,
    'x-amz-signature': signature,
  };
  if (options.credentials.sessionToken) {
    fields['x-amz-security-token'] = options.credentials.sessionToken;
  }

  const url = options.endpoint ?? `https://${options.bucket}.s3.${options.region}.amazonaws.com`;
  return { key, url, fields, expiresAt };
}

// --- Dependensi runtime (dapat disuntik untuk pengujian) --------------------

export interface ReceiptDeps {
  /** Nama bucket struk; default dari `RECEIPT_BUCKET_NAME`. */
  bucket?: string;
  /** Region bucket; default dibaca dari konfigurasi klien S3. */
  region?: string;
  /** Klien S3; dibuat seperlunya bila tidak disuntik. */
  s3?: Pick<S3Client, 'send' | 'config'>;
  /** Penyedia kredensial; default memakai kredensial klien S3 (peran Lambda). */
  resolveCredentials?: () => Promise<AwsCredentials>;
  /** Sumber waktu (default `new Date()`), disuntik pengujian. */
  now?: () => Date;
  /** Pembuat UUID (default `crypto.randomUUID`), disuntik pengujian. */
  uuid?: () => string;
}

let sharedS3Client: S3Client | undefined;

function getS3Client(): S3Client {
  if (!sharedS3Client) {
    sharedS3Client = new S3Client({});
  }
  return sharedS3Client;
}

/** Mengosongkan klien S3 bersama. Dipakai pengujian. */
export function resetReceiptS3Client(): void {
  sharedS3Client = undefined;
}

function resolveBucket(explicit: string | undefined): string {
  const name = explicit ?? process.env[RECEIPT_BUCKET_ENV];
  if (!name) {
    throw new Error(`Variabel lingkungan nama bucket hilang: ${RECEIPT_BUCKET_ENV}`);
  }
  return name;
}

async function resolveRegion(
  explicit: string | undefined,
  client: Pick<S3Client, 'config'>,
): Promise<string> {
  if (explicit) return explicit;
  const region = client.config.region;
  return typeof region === 'function' ? await region() : String(region);
}

async function resolveCredentialsFrom(
  deps: ReceiptDeps,
  client: Pick<S3Client, 'config'>,
): Promise<AwsCredentials> {
  if (deps.resolveCredentials) return deps.resolveCredentials();
  const provider = client.config.credentials;
  if (typeof provider !== 'function') {
    throw new Error('Kredensial AWS tidak tersedia pada klien S3');
  }
  const creds = await provider();
  return {
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    sessionToken: creds.sessionToken,
  };
}

// --- createReceiptUpload ----------------------------------------------------

export interface CreateReceiptUploadInput {
  /** `sub` Pengguna terautentikasi. */
  sub: string;
  /** MIME type yang akan diunggah (`image/jpeg` atau `image/png`). */
  contentType: string;
  /** Ukuran berkas dalam byte (dari klien; dikunci ulang oleh kebijakan POST). */
  size: number;
}

/**
 * Membuat presigned POST S3 untuk mengunggah satu foto struk ke
 * `receipts/<sub>/<uuid>` (Req 11.1, 11.3, 11.5). Melempar
 * {@link ReceiptValidationError} bila tipe/ukuran tidak memenuhi syarat.
 */
export async function createReceiptUpload(
  input: CreateReceiptUploadInput,
  deps: ReceiptDeps = {},
): Promise<PresignedPost> {
  const check = validateUpload({ type: input.contentType, size: input.size });
  if (!check.ok) {
    throw new ReceiptValidationError(check.message);
  }
  const client = deps.s3 ?? getS3Client();
  const bucket = resolveBucket(deps.bucket);
  const region = await resolveRegion(deps.region, client);
  const credentials = await resolveCredentialsFrom(deps, client);
  const now = (deps.now ?? (() => new Date()))();
  const uuid = (deps.uuid ?? randomUUID)();

  return buildPresignedPost({
    sub: input.sub,
    contentType: input.contentType,
    size: input.size,
    bucket,
    region,
    credentials,
    now,
    uuid,
  });
}

// --- scanReceipt ------------------------------------------------------------

/** Memetakan `Content-Type` objek S3 ke format gambar Converse. */
export function imageFormatFromContentType(contentType: string | undefined): ImageFormat {
  const format = contentType ? CONTENT_TYPE_TO_FORMAT[contentType.toLowerCase()] : undefined;
  if (!format) {
    throw new ReceiptValidationError('Format gambar struk harus JPEG atau PNG');
  }
  return format;
}

async function collectBytes(output: GetObjectCommandOutput): Promise<Uint8Array> {
  const body = output.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!body?.transformToByteArray) {
    throw new AiUnavailableError('Gagal membaca gambar struk');
  }
  return body.transformToByteArray();
}

/**
 * Mengurai teks balasan model menjadi JSON, lalu memvalidasi lewat
 * `validateReceiptResult`. Model TIDAK dipercaya: JSON rusak atau tidak sesuai
 * menghasilkan `needs_amount` (bukan galat yang menyimpan data).
 */
export function parseReceiptModelOutput(
  text: string,
  ctx: { categories: Category[]; todayWib: string },
): NlResult & { merchant?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(text));
  } catch {
    parsed = undefined;
  }
  return validateReceiptResult(parsed, ctx);
}

/** Mengambil blok objek JSON pertama dari teks (model kadang menambah teks lain). */
function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return text;
  }
  return text.slice(start, end + 1);
}

export interface ScanReceiptInput {
  /** `sub` Pengguna terautentikasi. */
  sub: string;
  /** Kunci objek struk; harus berawalan `receipts/<sub>/`. */
  key: string;
  /** Kategori milik Pengguna (model hanya boleh memilih dari sini). */
  categories: Category[];
  /** Tanggal hari ini (WIB) untuk mengisi tanggal kosong. */
  todayWib: string;
}

export interface ScanReceiptDeps extends ReceiptDeps {
  /** Konfigurasi model; default `loadConfig()`. */
  config?: AppConfig;
  /** Pemanggil Converse untuk satu kandidat; default `invokeConverse`. */
  invoke?: (params: {
    candidate: ModelCandidate;
    system: string;
    messages: Message[];
  }) => Promise<string>;
}

/**
 * Memindai satu foto struk: verifikasi kepemilikan kunci, ambil gambar dari
 * bucket privat, kirim ke Converse sebagai blok `image`, lalu validasi hasil
 * (Req 11.2, 11.4, 11.5). Mengembalikan hasil `validateReceiptResult`
 * (`ok` atau `needs_amount`).
 */
export async function scanReceipt(
  input: ScanReceiptInput,
  deps: ScanReceiptDeps = {},
): Promise<NlResult & { merchant?: string }> {
  assertKeyBelongsToSub(input.key, input.sub);

  const client = deps.s3 ?? getS3Client();
  const bucket = resolveBucket(deps.bucket);

  let object: GetObjectCommandOutput;
  try {
    object = (await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: input.key }),
    )) as GetObjectCommandOutput;
  } catch (err) {
    throw toAiUnavailableError(err);
  }

  const format = imageFormatFromContentType(object.ContentType);
  const bytes = await collectBytes(object);

  const config = deps.config ?? loadConfig();
  const ctx = { categories: input.categories, todayWib: input.todayWib };
  const system = buildScanReceiptSystem(ctx);
  const message = imageMessage(SCAN_RECEIPT_USER_TEXT, { format, bytes });
  const invoke =
    deps.invoke ??
    (async ({ candidate, system: sys, messages }) =>
      extractConverseText(await invokeConverse({ candidate, system: sys, messages })));

  const { result: text } = await resolveModel<string>({
    candidates: config.modelCandidates,
    allowCrossRegion: config.allowCrossRegion,
    invoke: (candidate) => invoke({ candidate, system, messages: [message] }),
  });

  return parseReceiptModelOutput(text, ctx);
}
