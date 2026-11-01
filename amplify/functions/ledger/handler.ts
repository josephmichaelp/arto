/**
 * Handler AppSync Lambda untuk Lambda `ledger` (tugas 7.6).
 *
 * Merangkai seluruh modul operasi (tugas 7.1 sampai 7.5) menjadi satu resolver
 * yang dipanggil dari custom mutation AppSync `allow.authenticated()`
 * (lihat `amplify/data/resource.ts`). Tanggung jawab handler:
 *
 * 1. Membaca identitas terautentikasi dari `event.identity` dan menurunkan
 *    `owner` (`<sub>::<username>`) lewat `ownerOf` domain murni. Identitas
 *    kosong ditolak dengan amplop galat `UNAUTHENTICATED` (Requirement 1.6,
 *    16.2); tidak ada operasi yang dijalankan.
 * 2. Memuat preferensi Notifikasi Pengguna (`NotifPrefs`, id = `sub`) sekali
 *    per pemanggilan untuk operasi yang dapat menghasilkan Notifikasi
 *    (ambang Anggaran dan Target tercapai). Pemuatan bersifat malas dan
 *    dipakai-ulang (memoized) agar operasi tanpa Notifikasi tidak menambah
 *    baca DynamoDB.
 * 3. Mengarahkan setiap field mutation (`event.info.fieldName`) ke operasi
 *    yang tepat pada modul `operations-*`.
 * 4. Memetakan galat operasi berbahasa Indonesia (`LedgerOperationError`,
 *    `WalletCategoryOperationError`, `BudgetRecurringGoalError`) menjadi amplop
 *    galat siap-tampil `{ ok: false, error: { code, message } }`. Galat tak
 *    terduga dipetakan ke `INTERNAL_ERROR` tanpa membocorkan detail internal.
 *
 * Amplop hasil konsisten: `{ ok: true, data }` pada sukses dan
 * `{ ok: false, error: { code, message } }` pada galat, sehingga hook data
 * frontend (tugas 12.3) dapat menampilkan pesan dan kode secara seragam.
 *
 * Modul ini hanya menambah `handler.ts`; repositori, resource, helper
 * notifikasi, dan modul operasi tidak diubah.
 *
 * _Requirements: 1.6, 16.2_
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ownerOf } from 'shared/domain';
import type { NotifPrefs } from 'shared/domain';
import { createLedgerRepo, type LedgerRepo } from './repository';
import {
  deleteTransaction,
  depositToGoal,
  LedgerOperationError,
  saveTransaction,
  transferFunds,
  type IdFactory,
} from './operations-transaction';
import {
  createCategory,
  createWallet,
  deleteCategoryWithReassign,
  deleteWalletWithReassign,
  renameCategory,
  renameWallet,
  WalletCategoryOperationError,
} from './operations-wallet-category';
import {
  BudgetRecurringGoalError,
  copyBudgetsFromPreviousMonth,
  createGoal,
  createRecurringRule,
  deleteGoal,
  deleteRecurringRule,
  updateGoal,
  updateRecurringRule,
  upsertBudget,
} from './operations-budget-recurring-goal';

// --- Bentuk event dan amplop hasil ---------------------------------------

/** Identitas Cognito User Pool yang relevan dari resolver AppSync. */
export interface LedgerIdentity {
  sub?: string | null;
  username?: string | null;
}

/**
 * Bentuk minimal event resolver AppSync yang dipakai handler. `info.fieldName`
 * menentukan operasi; `arguments.input` membawa payload JSON; `identity`
 * membawa klaim Pengguna terautentikasi.
 */
export interface LedgerResolverEvent {
  info?: { fieldName?: string | null } | null;
  /** Beberapa integrasi menaruh nama field langsung di akar. */
  fieldName?: string | null;
  arguments?: { input?: unknown } | null;
  identity?: LedgerIdentity | null;
}

export interface LedgerEnvelopeSuccess<T> {
  ok: true;
  data: T;
}

export interface LedgerEnvelopeError {
  ok: false;
  error: { code: string; message: string };
}

export type LedgerEnvelope<T = unknown> = LedgerEnvelopeSuccess<T> | LedgerEnvelopeError;

/** Pemuat preferensi Notifikasi; dapat disuntik pada uji. */
export type PrefsLoader = (sub: string | undefined, owner: string) => Promise<NotifPrefs | null>;

/** Dependensi handler, disuntikkan untuk pengujian tanpa jaringan. */
export interface LedgerHandlerDeps {
  repo: LedgerRepo;
  /** Pemuat `NotifPrefs`. Default membaca dari tabel `NOTIFPREFS_TABLE_NAME`. */
  loadPrefs?: PrefsLoader;
  /** Pembuat ID untuk entitas baru (deterministik pada uji). */
  newId?: IdFactory;
}

// --- Util -----------------------------------------------------------------

function fieldNameOf(event: LedgerResolverEvent): string | undefined {
  const name = event.info?.fieldName ?? event.fieldName ?? undefined;
  return name ? String(name) : undefined;
}

/**
 * Menormalkan `arguments.input` menjadi objek. AppSync meneruskan `a.json()`
 * sebagai nilai terurai, tetapi beberapa jalur dapat mengirim string JSON.
 */
function parseInput(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return {};
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

function errorEnvelope(code: string, message: string): LedgerEnvelopeError {
  return { ok: false, error: { code, message } };
}

function successEnvelope<T>(data: T): LedgerEnvelopeSuccess<T> {
  return { ok: true, data };
}

/** `true` bila galat adalah salah satu galat operasi berbahasa Indonesia. */
function isOperationError(
  err: unknown,
): err is LedgerOperationError | WalletCategoryOperationError | BudgetRecurringGoalError {
  return (
    err instanceof LedgerOperationError ||
    err instanceof WalletCategoryOperationError ||
    err instanceof BudgetRecurringGoalError
  );
}

// --- Pemuat NotifPrefs default -------------------------------------------

let sharedPrefsClient: DynamoDBDocumentClient | undefined;

function getPrefsClient(): DynamoDBDocumentClient {
  if (!sharedPrefsClient) {
    sharedPrefsClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return sharedPrefsClient;
}

/** Mengosongkan klien `NotifPrefs` bersama. Dipakai pengujian. */
export function resetLedgerPrefsClient(): void {
  sharedPrefsClient = undefined;
}

/**
 * Pemuat `NotifPrefs` bawaan: membaca item dengan id = `sub` dari tabel
 * `NOTIFPREFS_TABLE_NAME` dan memverifikasi kepemilikan. Mengembalikan `null`
 * bila tabel belum dirangkai, `sub` kosong, atau item bukan milik pemilik,
 * sehingga operasi tetap berjalan dengan preferensi bawaan (semua aktif).
 */
export const defaultPrefsLoader: PrefsLoader = async (sub, owner) => {
  const table = process.env.NOTIFPREFS_TABLE_NAME;
  if (!table || !sub) return null;
  const out = await getPrefsClient().send(new GetCommand({ TableName: table, Key: { id: sub } }));
  const item = out.Item as (NotifPrefs & { owner?: string }) | undefined;
  if (!item || item.owner !== owner) return null;
  return {
    budget: item.budget,
    recurring: item.recurring,
    goal: item.goal,
    insight: item.insight,
  };
};

// --- Router operasi -------------------------------------------------------

/**
 * Mengeksekusi satu operasi ledger berdasarkan `fieldName` dan mengembalikan
 * amplop hasil. Identitas kosong ditolak lebih dulu; galat operasi dipetakan
 * ke amplop galat berbahasa Indonesia. Fungsi ini tidak pernah melempar untuk
 * galat yang diketahui agar resolver selalu mengembalikan amplop yang seragam.
 */
export async function dispatchLedgerOperation(
  deps: LedgerHandlerDeps,
  event: LedgerResolverEvent,
): Promise<LedgerEnvelope> {
  // 1. Identitas dan owner.
  let owner: string;
  const identity = event.identity ?? undefined;
  try {
    owner = ownerOf({ sub: identity?.sub, username: identity?.username });
  } catch {
    return errorEnvelope('UNAUTHENTICATED', 'Identitas pengguna tidak valid');
  }

  const field = fieldNameOf(event);
  if (!field) {
    return errorEnvelope('UNKNOWN_OPERATION', 'Operasi tidak dikenal');
  }

  const { repo, newId } = deps;
  const loadPrefs = deps.loadPrefs ?? defaultPrefsLoader;
  const input = parseInput(event.arguments?.input);

  // Pemuatan NotifPrefs malas + dipakai-ulang (hanya operasi ber-Notifikasi).
  let prefsLoaded = false;
  let cachedPrefs: NotifPrefs | null = null;
  const getPrefs = async (): Promise<NotifPrefs | null> => {
    if (!prefsLoaded) {
      cachedPrefs = await loadPrefs(identity?.sub ?? undefined, owner);
      prefsLoaded = true;
    }
    return cachedPrefs;
  };

  try {
    switch (field) {
      // --- Transaksi, transfer, dan setoran Target ---
      case 'saveTransaction':
        return successEnvelope(
          await saveTransaction(repo, owner, input as never, { prefs: await getPrefs(), newId }),
        );
      case 'deleteTransaction':
        return successEnvelope(
          await deleteTransaction(repo, owner, String(input.id ?? ''), { prefs: await getPrefs() }),
        );
      case 'transferFunds':
        return successEnvelope(await transferFunds(repo, owner, input as never, { newId }));
      case 'depositToGoal':
        return successEnvelope(
          await depositToGoal(repo, owner, input as never, { prefs: await getPrefs(), newId }),
        );

      // --- Dompet ---
      case 'createWallet':
        return successEnvelope(await createWallet(repo, owner, input as never, { newId }));
      case 'renameWallet':
        return successEnvelope(await renameWallet(repo, owner, input as never, { newId }));
      case 'deleteWalletWithReassign':
        return successEnvelope(await deleteWalletWithReassign(repo, owner, input as never));

      // --- Kategori ---
      case 'createCategory':
        return successEnvelope(await createCategory(repo, owner, input as never, { newId }));
      case 'renameCategory':
        return successEnvelope(await renameCategory(repo, owner, input as never, { newId }));
      case 'deleteCategoryWithReassign':
        return successEnvelope(await deleteCategoryWithReassign(repo, owner, input as never));

      // --- Anggaran ---
      case 'upsertBudget':
        return successEnvelope(await upsertBudget(repo, owner, input as never));
      case 'copyBudgetsFromPreviousMonth':
        return successEnvelope(await copyBudgetsFromPreviousMonth(repo, owner, input as never));

      // --- Aturan berulang ---
      case 'createRecurringRule':
        return successEnvelope(await createRecurringRule(repo, owner, input as never, { newId }));
      case 'updateRecurringRule':
        return successEnvelope(await updateRecurringRule(repo, owner, String(input.id ?? ''), input as never));
      case 'deleteRecurringRule':
        return successEnvelope(await deleteRecurringRule(repo, owner, String(input.id ?? '')));

      // --- Target_Tabungan ---
      case 'createGoal':
        return successEnvelope(await createGoal(repo, owner, input as never, { newId }));
      case 'updateGoal':
        return successEnvelope(await updateGoal(repo, owner, String(input.id ?? ''), input as never));
      case 'deleteGoal':
        return successEnvelope(await deleteGoal(repo, owner, String(input.id ?? '')));

      default:
        return errorEnvelope('UNKNOWN_OPERATION', `Operasi tidak dikenal: ${field}`);
    }
  } catch (err) {
    if (isOperationError(err)) {
      return errorEnvelope(err.code, err.message);
    }
    // Galat tak terduga: catat nama galat saja (tanpa data keuangan).
    console.error('Galat ledger tak terduga', {
      field,
      name: (err as { name?: string })?.name,
    });
    return errorEnvelope('INTERNAL_ERROR', 'Terjadi kesalahan saat memproses permintaan');
  }
}

// --- Entry point Lambda ---------------------------------------------------

/**
 * Handler Lambda produksi. Merangkai repositori DynamoDB dan pemuat `NotifPrefs`
 * bawaan, lalu mendelegasikan ke {@link dispatchLedgerOperation}.
 */
export const handler = async (event: LedgerResolverEvent): Promise<LedgerEnvelope> => {
  return dispatchLedgerOperation({ repo: createLedgerRepo() }, event);
};
