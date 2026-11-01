import type { AppConfig } from 'shared/config';
import { loadConfig } from 'shared/config';
import {
  ownerOf,
  toJakartaDate,
  type Budget,
  type Category,
  type Txn,
  type Wallet,
} from 'shared/domain';
import {
  createLedgerRepo,
  type BudgetRecord,
  type CategoryRecord,
  type LedgerRepo,
  type TransactionRecord,
  type WalletRecord,
} from '../ledger/repository';
import { AI_UNAVAILABLE, AiUnavailableError } from './bedrock-client';
import { AI_MODEL_UNAVAILABLE } from './model-resolver';
import {
  AI_RATE_LIMITED,
  enforceRateLimit,
  type EnforceRateLimitOptions,
  type RateLimitResult,
} from './rate-limiter';
import { parseNaturalInput } from './parse-natural-input';
import {
  ReceiptValidationError,
  createReceiptUpload,
  scanReceipt,
} from './receipt';
import { askAssistant, type AssistantFinanceData } from './assistant';

/**
 * Handler Lambda `ai-gateway` — resolver AppSync untuk empat operasi AI
 * (`parseNaturalInput`, `createReceiptUpload`, `scanReceipt`, `askAssistant`).
 * Lihat tugas 8.8 dan design.md bagian "Lambda `ai-gateway`"
 * (Requirement 16.2, 16.3).
 *
 * Tanggung jawab handler (dipisahkan dari modul operasi agar tiap modul tetap
 * murni dan mudah diuji tanpa AWS):
 *
 * 1. Verifikasi identitas Pengguna dari `event.identity` lewat `ownerOf`.
 *    Identitas kosong DITOLAK sebelum data dimuat atau Bedrock dipanggil
 *    (Req 16.2). Handler tidak pernah melempar untuk kondisi yang
 *    diharapkan; ia mengembalikan amplop galat berbahasa Indonesia.
 * 2. Memuat data Pengguna SECARA ber-scope pemilik dari DynamoDB (lewat
 *    {@link FinanceRepo}): hanya Kategori untuk `parseNaturalInput`/
 *    `scanReceipt`, dan data keuangan lengkap untuk `askAssistant`. Isolasi
 *    pemilik dijaga oleh `LedgerRepo.list`, sehingga konteks tidak pernah
 *    memuat data Pengguna lain (Property 18).
 * 3. Menerapkan pembatas pemakaian SATU KALI per permintaan AI sebelum
 *    memanggil Bedrock (Req 16.3). `createReceiptUpload` tidak memanggil
 *    Bedrock sehingga dikecualikan. Modul `parseNaturalInput` dan
 *    `askAssistant` juga mampu menegakkan pembatas sendiri, maka handler
 *    menyuntikkan penegak no-op ke keduanya agar hitungan tidak berganda.
 * 4. Mengarahkan ke modul operasi, lalu memetakan galat yang dikenal
 *    (`RATE_LIMITED`, `AI_UNAVAILABLE`, `AI_MODEL_UNAVAILABLE`, validasi) ke
 *    amplop respons yang ramah; galat tak terduga tidak membocorkan detail
 *    internal.
 */

// --- Amplop respons --------------------------------------------------------

export interface AiGatewaySuccess<T = unknown> {
  ok: true;
  data: T;
}

export interface AiGatewayFailure {
  ok: false;
  /** Kode stabil untuk frontend (mis. `RATE_LIMITED`, `AI_UNAVAILABLE`, `VALIDATION`). */
  code: string;
  /** Pesan berbahasa Indonesia yang aman ditampilkan ke Pengguna. */
  message: string;
}

export type AiGatewayResult<T = unknown> = AiGatewaySuccess<T> | AiGatewayFailure;

/** Kode galat autentikasi (identitas kosong). */
export const AI_UNAUTHENTICATED = 'UNAUTHENTICATED';
/** Kode galat validasi masukan operasi. */
export const AI_VALIDATION = 'VALIDATION';
/** Kode galat tak terduga. */
export const AI_INTERNAL = 'INTERNAL';

/** Nama field GraphQL yang didukung handler. */
export type AiOperation = 'parseNaturalInput' | 'createReceiptUpload' | 'scanReceipt' | 'askAssistant';

const SUPPORTED_OPERATIONS: ReadonlySet<string> = new Set<AiOperation>([
  'parseNaturalInput',
  'createReceiptUpload',
  'scanReceipt',
  'askAssistant',
]);

/** Galat validasi masukan handler (dipetakan ke kode `VALIDATION`). */
class HandlerValidationError extends Error {
  readonly code = AI_VALIDATION;

  constructor(message: string) {
    super(message);
    this.name = 'HandlerValidationError';
  }
}

// --- Bentuk event AppSync --------------------------------------------------

export interface AiGatewayIdentity {
  sub?: string | null;
  username?: string | null;
  claims?: Record<string, unknown> | null;
}

export interface AiGatewayEvent {
  /** AppSync menaruh nama field pada `info.fieldName`. */
  info?: { fieldName?: string | null } | null;
  /** Fallback bila runtime meneruskan `fieldName` di akar. */
  fieldName?: string | null;
  arguments?: { input?: unknown } | null;
  identity?: AiGatewayIdentity | null;
}

// --- Repositori data ber-scope pemilik -------------------------------------

/**
 * Pemuat data Pengguna yang dibutuhkan handler. Dipisahkan sebagai antarmuka
 * agar dapat disuntik pada pengujian tanpa menyentuh DynamoDB.
 */
export interface FinanceRepo {
  /** Kategori milik satu pemilik (untuk `parseNaturalInput`/`scanReceipt`). */
  listCategories(owner: string): Promise<Category[]>;
  /** Data keuangan lengkap satu pemilik (untuk `askAssistant`). */
  loadAssistantData(owner: string): Promise<AssistantFinanceData>;
}

function toCategory(record: CategoryRecord): Category {
  return { id: record.id, name: record.name, type: record.type, builtIn: record.builtIn };
}

function toWallet(record: WalletRecord): Wallet {
  return {
    id: record.id,
    name: record.name,
    initialBalance: record.initialBalance,
    balance: record.balance,
  };
}

function toBudget(record: BudgetRecord): Budget {
  return {
    id: record.id,
    categoryId: record.categoryId,
    month: record.month,
    amount: record.amount,
    warn80Sent: record.warn80Sent,
    over100Sent: record.over100Sent,
  };
}

function toTxn(record: TransactionRecord): Txn {
  return {
    id: record.id,
    type: record.type,
    amount: record.amount,
    date: record.date,
    categoryId: record.categoryId,
    walletId: record.walletId,
    note: record.note,
    receiptKey: record.receiptKey,
  };
}

/** {@link FinanceRepo} yang didukung {@link LedgerRepo} (baca ber-scope pemilik). */
export class LedgerBackedFinanceRepo implements FinanceRepo {
  constructor(private readonly repo: LedgerRepo) {}

  async listCategories(owner: string): Promise<Category[]> {
    const rows = await this.repo.list('Category', owner);
    return rows.map(toCategory);
  }

  async loadAssistantData(owner: string): Promise<AssistantFinanceData> {
    const [categories, wallets, budgets, txns] = await Promise.all([
      this.repo.list('Category', owner),
      this.repo.list('Wallet', owner),
      this.repo.list('Budget', owner),
      this.repo.list('Transaction', owner),
    ]);
    return {
      categories: categories.map(toCategory),
      wallets: wallets.map(toWallet),
      budgets: budgets.map(toBudget),
      txns: txns.map(toTxn),
    };
  }
}

let sharedFinanceRepo: FinanceRepo | undefined;

/** Membuat {@link FinanceRepo} default (lazy) agar impor modul tidak menyentuh AWS. */
function defaultFinanceRepo(): FinanceRepo {
  if (!sharedFinanceRepo) {
    sharedFinanceRepo = new LedgerBackedFinanceRepo(createLedgerRepo());
  }
  return sharedFinanceRepo;
}

/** Mengosongkan repositori data bersama. Dipakai pengujian. */
export function resetFinanceRepo(): void {
  sharedFinanceRepo = undefined;
}

// --- Dependensi handler (dapat disuntik) -----------------------------------

export interface AiGatewayHandlerDeps {
  config?: AppConfig;
  now?: () => Date;
  repo?: FinanceRepo;
  enforceRateLimit?: typeof enforceRateLimit;
  parseNaturalInput?: typeof parseNaturalInput;
  createReceiptUpload?: typeof createReceiptUpload;
  scanReceipt?: typeof scanReceipt;
  askAssistant?: typeof askAssistant;
}

/**
 * Penegak pembatas no-op yang disuntikkan ke modul yang sudah ditegakkan
 * handler, agar hitungan pemakaian tidak berganda dalam satu permintaan.
 */
const noopEnforce: typeof enforceRateLimit = async (
  _options: EnforceRateLimitOptions,
): Promise<RateLimitResult> => ({ key: 'noop', count: 0, bucket: '' });

// --- Ekstraksi identitas dan masukan ---------------------------------------

/**
 * Menurunkan `{ sub, username }` dari identitas AppSync Cognito. `sub` dan
 * `username` dapat berada di akar identitas atau di dalam `claims`.
 */
function extractIdentity(identity: AiGatewayIdentity | null | undefined): {
  sub?: string | null;
  username?: string | null;
} {
  const claims = (identity?.claims ?? {}) as Record<string, unknown>;
  const claimStr = (key: string): string | undefined =>
    typeof claims[key] === 'string' ? (claims[key] as string) : undefined;
  const sub = identity?.sub ?? claimStr('sub');
  const username =
    identity?.username ?? claimStr('cognito:username') ?? claimStr('username');
  return { sub, username };
}

/** Menormalkan `arguments.input` menjadi objek (menerima objek atau string JSON). */
function asInputRecord(raw: unknown): Record<string, unknown> {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new HandlerValidationError('Masukan tidak valid: JSON rusak');
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HandlerValidationError('Masukan operasi tidak valid');
  }
  return value as Record<string, unknown>;
}

function requireString(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new HandlerValidationError(`Kolom "${field}" wajib diisi`);
  }
  return value;
}

function requireNumber(input: Record<string, unknown>, field: string): number {
  const value = input[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HandlerValidationError(`Kolom "${field}" harus berupa angka`);
  }
  return value;
}

// --- Pemetaan galat --------------------------------------------------------

function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

function errorMessage(err: unknown, fallback: string): string {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

/** Memetakan galat menjadi amplop {@link AiGatewayFailure} yang aman ditampilkan. */
function toFailure(err: unknown): AiGatewayFailure {
  if (err instanceof HandlerValidationError) {
    return { ok: false, code: AI_VALIDATION, message: err.message };
  }
  if (err instanceof ReceiptValidationError) {
    return { ok: false, code: AI_VALIDATION, message: err.message };
  }

  const code = errorCode(err);
  switch (code) {
    case AI_RATE_LIMITED:
      return {
        ok: false,
        code: AI_RATE_LIMITED,
        message: errorMessage(err, 'Batas pemakaian AI tercapai. Coba lagi pada jam berikutnya.'),
      };
    case AI_UNAVAILABLE:
    case AI_MODEL_UNAVAILABLE:
      // Keduanya adalah "AI tidak tersedia" dari sudut pandang Pengguna.
      return {
        ok: false,
        code: AI_UNAVAILABLE,
        message: errorMessage(err, 'Layanan AI tidak tersedia saat ini. Coba lagi nanti.'),
      };
    default:
      // Jangan bocorkan detail internal galat tak terduga.
      return {
        ok: false,
        code: AI_INTERNAL,
        message: 'Terjadi kesalahan tak terduga. Coba lagi nanti.',
      };
  }
}

// --- Router operasi --------------------------------------------------------

function resolveFieldName(event: AiGatewayEvent): string | undefined {
  return event.info?.fieldName ?? event.fieldName ?? undefined;
}

/**
 * Menjalankan satu permintaan `ai-gateway`. Dipisahkan dari {@link handler}
 * agar dapat diuji dengan dependensi yang disuntik. Selalu mengembalikan
 * amplop {@link AiGatewayResult}; tidak pernah melempar untuk kondisi yang
 * diharapkan.
 */
export async function runAiGateway(
  event: AiGatewayEvent,
  deps: AiGatewayHandlerDeps = {},
): Promise<AiGatewayResult> {
  const fieldName = resolveFieldName(event);
  if (!fieldName || !SUPPORTED_OPERATIONS.has(fieldName)) {
    return {
      ok: false,
      code: AI_VALIDATION,
      message: `Operasi tidak dikenal: ${fieldName ?? '(kosong)'}`,
    };
  }

  // 1. Verifikasi identitas sebelum apa pun (Req 16.2). Identitas kosong
  //    ditolak tanpa memuat data atau memanggil Bedrock.
  const identity = extractIdentity(event.identity);
  let owner: string;
  let sub: string;
  try {
    owner = ownerOf(identity);
    sub = identity.sub!.trim();
  } catch {
    return {
      ok: false,
      code: AI_UNAUTHENTICATED,
      message: 'Sesi tidak valid. Silakan masuk kembali.',
    };
  }

  const config = deps.config ?? loadConfig();
  const now = (deps.now ?? (() => new Date()))();
  const todayWib = toJakartaDate(now);
  const repo = deps.repo ?? defaultFinanceRepo();
  const enforce = deps.enforceRateLimit ?? enforceRateLimit;

  try {
    const input = asInputRecord(event.arguments?.input);

    switch (fieldName as AiOperation) {
      case 'parseNaturalInput': {
        const sentence = requireString(input, 'sentence');
        const categories = await repo.listCategories(owner);
        // Pembatas ditegakkan di sini (Req 16.3); modul memakai no-op.
        await enforce({ sub, limit: config.aiRateLimit, now });
        const run = deps.parseNaturalInput ?? parseNaturalInput;
        const data = await run(
          { sub, sentence, categories, todayWib, now },
          { config, enforceRateLimit: noopEnforce },
        );
        return { ok: true, data };
      }

      case 'createReceiptUpload': {
        // Tidak memanggil Bedrock, jadi tidak dihitung pembatas pemakaian.
        const contentType = requireString(input, 'contentType');
        const size = requireNumber(input, 'size');
        const run = deps.createReceiptUpload ?? createReceiptUpload;
        const data = await run({ sub, contentType, size });
        return { ok: true, data };
      }

      case 'scanReceipt': {
        const key = requireString(input, 'key');
        const categories = await repo.listCategories(owner);
        await enforce({ sub, limit: config.aiRateLimit, now });
        const run = deps.scanReceipt ?? scanReceipt;
        const data = await run({ sub, key, categories, todayWib }, { config });
        return { ok: true, data };
      }

      case 'askAssistant': {
        const question = requireString(input, 'question');
        const data = await repo.loadAssistantData(owner);
        await enforce({ sub, limit: config.aiRateLimit, now });
        const run = deps.askAssistant ?? askAssistant;
        const result = await run({
          identity,
          question,
          data,
          config,
          now,
          nowWib: todayWib,
          deps: { enforceRateLimit: noopEnforce },
        });
        return { ok: true, data: result };
      }

      default: {
        return {
          ok: false,
          code: AI_VALIDATION,
          message: `Operasi tidak dikenal: ${fieldName}`,
        };
      }
    }
  } catch (err) {
    return toFailure(err);
  }
}

/** Titik masuk Lambda `ai-gateway` untuk AppSync. */
export const handler = async (event: AiGatewayEvent): Promise<AiGatewayResult> =>
  runAiGateway(event);
