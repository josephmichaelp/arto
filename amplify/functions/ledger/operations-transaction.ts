/**
 * Operasi Transaksi, transfer antar Dompet, dan setoran Target_Tabungan untuk
 * Lambda `ledger` (tugas 7.3). Lihat design.md bagian "Lambda `ledger`":
 *
 * | Operasi | Isi atomik (`TransactWriteItems`) |
 * |---------|-----------------------------------|
 * | `saveTransaction` | Put Transaksi + Update saldo Dompet (delta digabung bila Dompet sama pada ubah) |
 * | `deleteTransaction` | Delete + Update saldo kebalikan |
 * | `transferFunds` | Update Dompet asal (`balance >= :amt`) + Update Dompet tujuan + dua catatan transfer |
 * | `depositToGoal` | Update Dompet (kondisi saldo cukup) + Update progres goal + notifikasi `goal-done:<goalId>` |
 *
 * Seluruh perubahan saldo dijalankan lewat satu `TransactWriteItems` yang
 * atomik (Requirement 2.1, 2.2, 2.3, 4.3, 4.4, 7.6) sehingga saldo Dompet
 * selalu konsisten dengan riwayat operasi. Logika perubahan saldo memakai
 * semantik domain murni `applyEvents` dan `planTransfer` (`shared/domain/ledger`)
 * agar aturan tanda (EXPENSE/TRANSFER_OUT/GOAL_DEPOSIT mengurangi, INCOME/
 * TRANSFER_IN menambah) tidak diduplikasi di sini.
 *
 * Kegagalan prasyarat saldo (`ConditionalCheckError` dari repositori,
 * mis. `balance >= :amt`) dipetakan ke pesan berbahasa Indonesia
 * "Saldo dompet asal tidak cukup" (Requirement 4.4, 7.6). Setiap operasi
 * dibatasi pemilik (`owner`): entitas yang bukan milik pemilik diperlakukan
 * seolah tidak ada (Property 18, Requirement 1.6, 1.8).
 *
 * Modul ini hanya menambah berkas baru; repositori, resource, dan helper
 * notifikasi tidak diubah.
 */
import { randomUUID } from 'node:crypto';
import { applyEvents, planTransfer, type LedgerEvent } from 'shared/domain/ledger';
import { goalProgress } from 'shared/domain/goals';
import { validateAmount } from 'shared/domain/money';
import type { NotifPrefs, Rupiah, Txn, Wallet } from 'shared/domain';
import {
  ConditionalCheckError,
  type Condition,
  type ItemRecord,
  type LedgerRepo,
  type TransactionRecord,
  type WalletRecord,
  type WriteOp,
} from './repository';
import {
  createNotification,
  evaluateBudgetThresholds,
  type BudgetThresholdResult,
  type CreateNotificationResult,
} from './notifications';

// --- Galat operasi --------------------------------------------------------

const INSUFFICIENT_BALANCE_MESSAGE = 'Saldo dompet asal tidak cukup';

export type LedgerOperationCode =
  | 'AMOUNT_INVALID'
  | 'INSUFFICIENT_BALANCE'
  | 'SAME_WALLET'
  | 'WALLET_NOT_FOUND'
  | 'GOAL_NOT_FOUND'
  | 'TRANSACTION_NOT_FOUND';

/**
 * Galat operasi ledger dengan pesan berbahasa Indonesia yang siap ditampilkan
 * ke Pengguna. Pemanggil (`handler.ts`) dapat meneruskan `message` apa adanya.
 */
export class LedgerOperationError extends Error {
  readonly code: LedgerOperationCode;

  constructor(code: LedgerOperationCode, message: string) {
    super(message);
    this.name = 'LedgerOperationError';
    this.code = code;
  }
}

// --- Opsi dan util bersama ------------------------------------------------

/** Pembuat ID (dapat disuntik pada uji agar deterministik). */
export type IdFactory = () => string;

export interface OperationOptions {
  /** Preferensi Notifikasi Pengguna; memengaruhi Notifikasi ambang Anggaran dan Target. */
  prefs?: NotifPrefs | null;
  /** Pembuat ID untuk catatan baru. Default `crypto.randomUUID`. */
  newId?: IdFactory;
}

function toTxn(record: {
  id: string;
  type: string;
  amount: number;
  date: string;
  categoryId?: string;
  walletId: string;
  note?: string;
  receiptKey?: string;
}): Txn {
  return {
    id: record.id,
    type: record.type as Txn['type'],
    amount: record.amount,
    date: record.date,
    categoryId: record.categoryId,
    walletId: record.walletId,
    note: record.note,
    receiptKey: record.receiptKey,
  };
}

function walletObj(record: WalletRecord): Wallet {
  return {
    id: record.id,
    name: record.name,
    initialBalance: record.initialBalance,
    balance: record.balance,
  };
}

/** `YYYY-MM` dari tanggal kalender `YYYY-MM-DD` (sudah dalam WIB). */
function monthOf(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new LedgerOperationError('AMOUNT_INVALID', 'Tanggal harus berformat YYYY-MM-DD');
  }
  return date.slice(0, 7);
}

/** Teks pencarian ternormalisasi (huruf kecil) dari catatan Transaksi. */
function buildSearchText(parts: Array<string | undefined>): string | undefined {
  const text = parts
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .join(' ')
    .trim()
    .toLowerCase();
  return text.length > 0 ? text : undefined;
}

/** Memuat Dompet milik pemilik atau melempar galat bila tidak ada. */
async function requireWallet(repo: LedgerRepo, owner: string, id: string): Promise<WalletRecord> {
  const record = await repo.get('Wallet', owner, id);
  if (!record) {
    throw new LedgerOperationError('WALLET_NOT_FOUND', 'Dompet tidak ditemukan');
  }
  return record;
}

/**
 * Menjalankan `TransactWriteItems` dan memetakan kegagalan prasyarat saldo
 * (`ConditionalCheckError`) ke pesan "Saldo dompet asal tidak cukup".
 */
async function runTransactWrite(repo: LedgerRepo, ops: readonly WriteOp[]): Promise<void> {
  try {
    await repo.transactWrite(ops);
  } catch (err) {
    if (err instanceof ConditionalCheckError) {
      throw new LedgerOperationError('INSUFFICIENT_BALANCE', INSUFFICIENT_BALANCE_MESSAGE);
    }
    throw err;
  }
}

/**
 * Menghitung delta saldo tiap Dompet akibat sebuah peristiwa ledger memakai
 * `applyEvents` domain murni, lalu menghasilkan operasi `update ADD balance`
 * untuk setiap Dompet yang saldonya berubah (delta 0 dilewati).
 */
function walletDeltaOps(wallets: WalletRecord[], event: LedgerEvent): WriteOp[] {
  const before = wallets.map(walletObj);
  const after = applyEvents(before, [event]);
  const ops: WriteOp[] = [];
  wallets.forEach((record, i) => {
    const delta = (after[i]?.balance ?? 0) - (before[i]?.balance ?? 0);
    if (delta !== 0) {
      ops.push({ op: 'update', entity: 'Wallet', id: record.id, add: { balance: delta } });
    }
  });
  return ops;
}

// --- saveTransaction ------------------------------------------------------

export interface SaveTransactionInput {
  /** ID Transaksi. Bila kosong, Transaksi baru dibuat. */
  id?: string;
  type: 'EXPENSE' | 'INCOME';
  amount: Rupiah;
  /** Tanggal kalender WIB `YYYY-MM-DD`. */
  date: string;
  categoryId?: string;
  walletId: string;
  note?: string;
  receiptKey?: string;
  recurringRuleId?: string;
}

export interface SaveTransactionResult {
  transaction: TransactionRecord;
  mode: 'create' | 'update';
  /** Hasil evaluasi ambang Anggaran untuk tiap Kategori/bulan pengeluaran terdampak. */
  budgets: BudgetThresholdResult[];
}

/**
 * saveTransaction: menyimpan Transaksi baru atau mengubah Transaksi yang ada
 * sambil memperbarui saldo Dompet secara atomik (Requirement 2.1, 2.2, 2.4).
 *
 * - Nominal divalidasi (bilangan bulat lebih dari 0); bila tidak valid,
 *   penyimpanan ditolak dengan pesan berbahasa Indonesia.
 * - Pada ubah, delta saldo digabung bila Dompet sama dan terbagi ke dua Dompet
 *   bila Dompet berpindah (semantik `applyEvents` jenis `update`).
 * - Kolom `searchText` diisi dari catatan.
 * - Setelah perubahan pengeluaran (`EXPENSE`), evaluator ambang Anggaran
 *   dipanggil untuk Kategori/bulan terdampak (Requirement 5.4, 5.5).
 */
export async function saveTransaction(
  repo: LedgerRepo,
  owner: string,
  input: SaveTransactionInput,
  options: OperationOptions = {},
): Promise<SaveTransactionResult> {
  const amount = validateAmount(input.amount);
  if (!amount.ok) {
    throw new LedgerOperationError('AMOUNT_INVALID', amount.message);
  }

  const existing = input.id ? await repo.get('Transaction', owner, input.id) : null;
  const mode: 'create' | 'update' = existing ? 'update' : 'create';
  const id = existing?.id ?? input.id ?? (options.newId ?? randomUUID)();
  const month = monthOf(input.date);

  const record: TransactionRecord = {
    id,
    owner,
    type: input.type,
    amount: amount.value,
    date: input.date,
    month,
    categoryId: input.categoryId,
    walletId: input.walletId,
    note: input.note,
    searchText: buildSearchText([input.note]),
    receiptKey: input.receiptKey,
    recurringRuleId: input.recurringRuleId,
    createdAt: existing?.createdAt,
  };

  // Kumpulkan Dompet yang terdampak dan susun peristiwa ledger.
  const after = toTxn(record);
  let event: LedgerEvent;
  const walletIds = new Set<string>([input.walletId]);
  if (existing) {
    const before = toTxn(existing);
    walletIds.add(existing.walletId);
    event = { kind: 'update', before, after };
  } else {
    event = { kind: 'create', txn: after };
  }

  const wallets: WalletRecord[] = [];
  for (const walletId of walletIds) {
    wallets.push(await requireWallet(repo, owner, walletId));
  }

  const ops: WriteOp[] = [
    { op: 'put', entity: 'Transaction', item: record as unknown as ItemRecord },
    ...walletDeltaOps(wallets, event),
  ];

  await runTransactWrite(repo, ops);

  // Evaluasi ambang Anggaran untuk setiap Kategori/bulan pengeluaran terdampak.
  const budgetTargets = new Map<string, { categoryId: string; month: string }>();
  if (existing && existing.type === 'EXPENSE' && existing.categoryId) {
    budgetTargets.set(`${existing.categoryId}#${existing.month}`, {
      categoryId: existing.categoryId,
      month: existing.month,
    });
  }
  if (input.type === 'EXPENSE' && input.categoryId) {
    budgetTargets.set(`${input.categoryId}#${month}`, { categoryId: input.categoryId, month });
  }

  const budgets: BudgetThresholdResult[] = [];
  for (const target of budgetTargets.values()) {
    budgets.push(await evaluateBudgetThresholds(repo, owner, target, options.prefs));
  }

  return { transaction: record, mode, budgets };
}

// --- deleteTransaction ----------------------------------------------------

export interface DeleteTransactionResult {
  transaction: TransactionRecord;
  budgets: BudgetThresholdResult[];
}

/**
 * deleteTransaction: menghapus Transaksi dan mengembalikan saldo Dompet ke
 * nilai sebelum Transaksi dibuat secara atomik (Requirement 2.3). Transaksi
 * yang tidak ada atau bukan milik pemilik menghasilkan galat `TRANSACTION_NOT_FOUND`.
 */
export async function deleteTransaction(
  repo: LedgerRepo,
  owner: string,
  id: string,
  options: OperationOptions = {},
): Promise<DeleteTransactionResult> {
  const existing = await repo.get('Transaction', owner, id);
  if (!existing) {
    throw new LedgerOperationError('TRANSACTION_NOT_FOUND', 'Transaksi tidak ditemukan');
  }

  const wallet = await requireWallet(repo, owner, existing.walletId);
  const event: LedgerEvent = { kind: 'delete', txn: toTxn(existing) };

  const ops: WriteOp[] = [
    { op: 'delete', entity: 'Transaction', id },
    ...walletDeltaOps([wallet], event),
  ];

  await runTransactWrite(repo, ops);

  const budgets: BudgetThresholdResult[] = [];
  if (existing.type === 'EXPENSE' && existing.categoryId) {
    budgets.push(
      await evaluateBudgetThresholds(
        repo,
        owner,
        { categoryId: existing.categoryId, month: existing.month },
        options.prefs,
      ),
    );
  }

  return { transaction: existing, budgets };
}

// --- transferFunds --------------------------------------------------------

export interface TransferFundsInput {
  fromWalletId: string;
  toWalletId: string;
  amount: Rupiah;
  /** Tanggal kalender WIB `YYYY-MM-DD`. */
  date: string;
  note?: string;
}

export interface TransferFundsResult {
  /** Catatan Transaksi `TRANSFER_OUT` pada Dompet asal. */
  transferOut: TransactionRecord;
  /** Catatan Transaksi `TRANSFER_IN` pada Dompet tujuan. */
  transferIn: TransactionRecord;
}

/**
 * transferFunds: memindahkan dana antar dua Dompet berbeda (Requirement 4.3,
 * 4.4). Saldo Dompet asal dikurangi dengan prasyarat `balance >= :amt`
 * sehingga transfer yang melebihi saldo ditolak secara atomik dengan pesan
 * "Saldo dompet asal tidak cukup". Dua catatan Transaksi (`TRANSFER_OUT` dan
 * `TRANSFER_IN`) ditulis dalam transaksi yang sama; keduanya dikecualikan dari
 * total Laporan (Requirement 4.6).
 */
export async function transferFunds(
  repo: LedgerRepo,
  owner: string,
  input: TransferFundsInput,
  options: OperationOptions = {},
): Promise<TransferFundsResult> {
  const src = await requireWallet(repo, owner, input.fromWalletId);
  const dst = await requireWallet(repo, owner, input.toWalletId);

  // Validasi domain murni (nominal, Dompet berbeda, saldo cukup).
  const plan = planTransfer(walletObj(src), walletObj(dst), input.amount);
  if (!plan.ok) {
    const code: LedgerOperationCode =
      plan.code === 'AMOUNT_INVALID'
        ? 'AMOUNT_INVALID'
        : plan.code === 'SAME_WALLET'
          ? 'SAME_WALLET'
          : 'INSUFFICIENT_BALANCE';
    throw new LedgerOperationError(code, plan.message);
  }

  const amount = plan.src.balance === src.balance ? input.amount : src.balance - plan.src.balance;
  const month = monthOf(input.date);
  const newId = options.newId ?? randomUUID;
  const searchText = buildSearchText([input.note, 'transfer']);

  const transferOut: TransactionRecord = {
    id: newId(),
    owner,
    type: 'TRANSFER_OUT',
    amount,
    date: input.date,
    month,
    walletId: src.id,
    note: input.note,
    searchText,
  };
  const transferIn: TransactionRecord = {
    id: newId(),
    owner,
    type: 'TRANSFER_IN',
    amount,
    date: input.date,
    month,
    walletId: dst.id,
    note: input.note,
    searchText,
  };

  const balanceGte: Condition = { kind: 'numberGte', attribute: 'balance', value: amount };
  const ops: WriteOp[] = [
    { op: 'update', entity: 'Wallet', id: src.id, add: { balance: -amount }, condition: balanceGte },
    { op: 'update', entity: 'Wallet', id: dst.id, add: { balance: amount } },
    { op: 'put', entity: 'Transaction', item: transferOut as unknown as ItemRecord },
    { op: 'put', entity: 'Transaction', item: transferIn as unknown as ItemRecord },
  ];

  await runTransactWrite(repo, ops);

  return { transferOut, transferIn };
}

// --- depositToGoal --------------------------------------------------------

export interface DepositToGoalInput {
  goalId: string;
  walletId: string;
  amount: Rupiah;
}

export interface DepositToGoalResult {
  goalId: string;
  /** Progres terkumpul setelah setoran. */
  saved: Rupiah;
  /** `true` bila Target sudah tercapai (progres >= target). */
  achieved: boolean;
  /** `true` bila setoran ini yang membuat Target tercapai untuk pertama kali. */
  newlyAchieved: boolean;
  /** Hasil Notifikasi `goal-done:<goalId>` bila Target baru tercapai. */
  notification?: CreateNotificationResult;
}

/**
 * depositToGoal: menambah setoran ke Target_Tabungan dari suatu Dompet
 * (Requirement 7.2, 7.4, 7.6). Saldo Dompet dikurangi dengan prasyarat saldo
 * cukup (`balance >= :amt`) dan progres Target ditambah dalam satu transaksi
 * atomik. Setoran yang melebihi saldo Dompet ditolak dengan pesan
 * "Saldo dompet asal tidak cukup". Saat progres mencapai 100 persen, Target
 * ditandai tercapai dan satu Notifikasi `goal-done:<goalId>` dibuat.
 */
export async function depositToGoal(
  repo: LedgerRepo,
  owner: string,
  input: DepositToGoalInput,
  options: OperationOptions = {},
): Promise<DepositToGoalResult> {
  const amount = validateAmount(input.amount);
  if (!amount.ok) {
    throw new LedgerOperationError('AMOUNT_INVALID', amount.message);
  }

  const goal = await repo.get('Goal', owner, input.goalId);
  if (!goal) {
    throw new LedgerOperationError('GOAL_NOT_FOUND', 'Target tabungan tidak ditemukan');
  }
  const wallet = await requireWallet(repo, owner, input.walletId);

  // Tolak lebih awal bila saldo jelas kurang (penjaga atomik tetap dipasang di DB).
  if (amount.value > wallet.balance) {
    throw new LedgerOperationError('INSUFFICIENT_BALANCE', INSUFFICIENT_BALANCE_MESSAGE);
  }

  const newSaved = goal.saved + amount.value;
  const { achieved } = goalProgress(newSaved, goal.target);
  const newlyAchieved = achieved && !goal.achieved;

  // Perubahan saldo Dompet mengikuti semantik GOAL_DEPOSIT (mengurangi saldo).
  const [updatedWallet] = applyEvents([walletObj(wallet)], [
    { kind: 'goalDeposit', walletId: wallet.id, amount: amount.value },
  ]);
  const walletDelta = (updatedWallet?.balance ?? wallet.balance) - wallet.balance;

  const goalSet: Record<string, unknown> | undefined = newlyAchieved ? { achieved: true } : undefined;
  const balanceGte: Condition = { kind: 'numberGte', attribute: 'balance', value: amount.value };

  const ops: WriteOp[] = [
    { op: 'update', entity: 'Wallet', id: wallet.id, add: { balance: walletDelta }, condition: balanceGte },
    { op: 'update', entity: 'Goal', id: goal.id, add: { saved: amount.value }, set: goalSet },
  ];

  await runTransactWrite(repo, ops);

  let notification: CreateNotificationResult | undefined;
  if (newlyAchieved) {
    notification = await createNotification(
      repo,
      owner,
      'goal-done',
      goal.id,
      {
        title: 'Target tabungan tercapai',
        body: `Selamat, Target "${goal.name}" sudah tercapai.`,
        refId: goal.id,
      },
      options.prefs,
    );
  }

  return { goalId: goal.id, saved: newSaved, achieved, newlyAchieved, notification };
}
