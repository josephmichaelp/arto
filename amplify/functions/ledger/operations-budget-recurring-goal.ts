/**
 * Operasi Anggaran, Transaksi_Berulang, dan Target_Tabungan untuk Lambda
 * `ledger` (tugas 7.5). Lihat design.md bagian "Lambda `ledger`":
 *
 * | Operasi | Perilaku |
 * |---------|----------|
 * | `upsertBudget` | ID Anggaran `categoryId#month`; buat atau ubah nominal |
 * | `copyBudgetsFromPreviousMonth` | Salin Anggaran bulan sebelumnya memakai `copyBudgets` domain murni; tidak menimpa Anggaran yang sudah ada |
 * | CRUD aturan berulang | Buat, ubah, jeda, lanjutkan, hapus; `nextDueOn` dihitung dari `occurrence` |
 * | CRUD Target_Tabungan | Buat, ubah, hapus (setoran ditangani `depositToGoal` di operations-transaction) |
 *
 * Seluruh operasi dibatasi pemilik (`owner`): entitas yang bukan milik
 * pemilik diperlakukan seolah tidak ada (Property 18, Requirement 1.6, 1.8).
 * ID Anggaran deterministik `categoryId#month` membuat `upsertBudget`
 * idempoten terhadap pasangan Kategori/bulan, dan salin Anggaran memakai
 * prasyarat `attribute_not_exists` agar Anggaran yang sudah ada tidak tertimpa
 * (Requirement 5.6).
 *
 * Modul ini hanya menambah berkas baru; repositori, resource, dan helper
 * notifikasi tidak diubah.
 *
 * _Requirements: 5.1, 5.6, 6.1, 6.4, 7.1, 7.4_
 */
import { randomUUID } from 'node:crypto';
import { copyBudgets } from 'shared/domain/budget';
import { occurrence } from 'shared/domain/recurring';
import { goalProgress } from 'shared/domain/goals';
import { validateAmount } from 'shared/domain/money';
import type { Budget, Frequency, Rupiah } from 'shared/domain';
import {
  ConditionalCheckError,
  type BudgetRecord,
  type GoalRecord,
  type ItemRecord,
  type LedgerRepo,
  type RecurringRuleRecord,
} from './repository';

// --- Galat operasi --------------------------------------------------------

export type BudgetRecurringGoalErrorCode =
  | 'AMOUNT_INVALID'
  | 'MONTH_INVALID'
  | 'DATE_INVALID'
  | 'BUDGET_NOT_FOUND'
  | 'RULE_NOT_FOUND'
  | 'GOAL_NOT_FOUND';

/**
 * Galat operasi dengan pesan berbahasa Indonesia yang siap ditampilkan ke
 * Pengguna. Pemanggil (`handler.ts`) dapat meneruskan `message` apa adanya.
 */
export class BudgetRecurringGoalError extends Error {
  readonly code: BudgetRecurringGoalErrorCode;

  constructor(code: BudgetRecurringGoalErrorCode, message: string) {
    super(message);
    this.name = 'BudgetRecurringGoalError';
    this.code = code;
  }
}

// --- Opsi dan util bersama ------------------------------------------------

/** Pembuat ID (dapat disuntik pada uji agar deterministik). */
export type IdFactory = () => string;

export interface OperationOptions {
  /** Pembuat ID untuk catatan baru. Default `crypto.randomUUID`. */
  newId?: IdFactory;
}

const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Memvalidasi format bulan `YYYY-MM`, melempar `MONTH_INVALID` bila salah. */
function assertMonth(month: string): void {
  if (!MONTH_RE.test(month)) {
    throw new BudgetRecurringGoalError('MONTH_INVALID', 'Bulan harus berformat YYYY-MM');
  }
}

/** Memvalidasi format tanggal `YYYY-MM-DD`, melempar `DATE_INVALID` bila salah. */
function assertDate(date: string): void {
  if (!DATE_RE.test(date)) {
    throw new BudgetRecurringGoalError('DATE_INVALID', 'Tanggal harus berformat YYYY-MM-DD');
  }
}

/** Bulan kalender sebelum `month` (`YYYY-MM`). */
function previousMonth(month: string): string {
  assertMonth(month);
  let year = Number(month.slice(0, 4));
  let mon = Number(month.slice(5, 7)); // 1-12
  mon -= 1;
  if (mon === 0) {
    mon = 12;
    year -= 1;
  }
  return `${year}-${pad2(mon)}`;
}

/** Memvalidasi nominal (bilangan bulat lebih dari 0) atau melempar galat. */
function requireAmount(amount: Rupiah): number {
  const checked = validateAmount(amount);
  if (!checked.ok) {
    throw new BudgetRecurringGoalError('AMOUNT_INVALID', checked.message);
  }
  return checked.value;
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

// --- upsertBudget ---------------------------------------------------------

export interface UpsertBudgetInput {
  categoryId: string;
  /** Bulan WIB `YYYY-MM`. */
  month: string;
  amount: Rupiah;
}

export interface UpsertBudgetResult {
  budget: BudgetRecord;
  mode: 'create' | 'update';
}

/**
 * upsertBudget: membuat atau mengubah Anggaran Kategori `categoryId` pada bulan
 * `month` (Requirement 5.1). ID Anggaran deterministik `categoryId#month`
 * membuat operasi idempoten terhadap pasangan Kategori/bulan. Nominal
 * divalidasi (bilangan bulat lebih dari 0). Penanda ambang (`warn80Sent`,
 * `over100Sent`) dipertahankan saat mengubah nominal.
 */
export async function upsertBudget(
  repo: LedgerRepo,
  owner: string,
  input: UpsertBudgetInput,
): Promise<UpsertBudgetResult> {
  assertMonth(input.month);
  const amount = requireAmount(input.amount);
  const id = `${input.categoryId}#${input.month}`;

  const existing = await repo.get('Budget', owner, id);
  if (existing) {
    await repo.update('Budget', id, { set: { amount } });
    return { budget: { ...existing, amount }, mode: 'update' };
  }

  const record: BudgetRecord = {
    id,
    owner,
    categoryId: input.categoryId,
    month: input.month,
    amount,
    warn80Sent: false,
    over100Sent: false,
  };
  await repo.put('Budget', record as unknown as ItemRecord);
  return { budget: record, mode: 'create' };
}

// --- copyBudgetsFromPreviousMonth -----------------------------------------

export interface CopyBudgetsInput {
  /** Bulan tujuan WIB `YYYY-MM`. */
  toMonth: string;
  /** Bulan sumber `YYYY-MM`. Default bulan kalender sebelum `toMonth`. */
  fromMonth?: string;
}

export interface CopyBudgetsResult {
  fromMonth: string;
  toMonth: string;
  /** Anggaran baru yang berhasil ditulis. */
  created: BudgetRecord[];
  /** Jumlah Anggaran sumber yang dilewati karena bulan tujuan sudah punya Kategori itu. */
  skipped: number;
}

/**
 * copyBudgetsFromPreviousMonth: menyalin Anggaran dari bulan sebelumnya ke
 * `toMonth` (Requirement 5.6). Memakai `copyBudgets` domain murni untuk
 * menentukan Anggaran yang belum ada pada bulan tujuan, lalu menulis tiap
 * Anggaran baru dengan prasyarat `attribute_not_exists` sehingga Anggaran yang
 * sudah ada tidak pernah tertimpa (ID `categoryId#toMonth`).
 */
export async function copyBudgetsFromPreviousMonth(
  repo: LedgerRepo,
  owner: string,
  input: CopyBudgetsInput,
): Promise<CopyBudgetsResult> {
  assertMonth(input.toMonth);
  const fromMonth = input.fromMonth ?? previousMonth(input.toMonth);
  assertMonth(fromMonth);

  const prev = await repo.list('Budget', owner, { month: fromMonth });
  const existing = await repo.list('Budget', owner, { month: input.toMonth });

  const toCreate = copyBudgets(prev.map(toBudget), input.toMonth, existing.map(toBudget));

  const created: BudgetRecord[] = [];
  let skipped = 0;
  for (const b of toCreate) {
    const record: BudgetRecord = {
      id: b.id,
      owner,
      categoryId: b.categoryId,
      month: b.month,
      amount: b.amount,
      warn80Sent: false,
      over100Sent: false,
    };
    try {
      await repo.put('Budget', record as unknown as ItemRecord, { kind: 'notExists' });
      created.push(record);
    } catch (err) {
      if (err instanceof ConditionalCheckError) {
        skipped += 1;
        continue;
      }
      throw err;
    }
  }

  return { fromMonth, toMonth: input.toMonth, created, skipped };
}

// --- CRUD Transaksi_Berulang ----------------------------------------------

export interface CreateRecurringRuleInput {
  amount: Rupiah;
  categoryId: string;
  walletId: string;
  type: 'EXPENSE' | 'INCOME';
  frequency: Frequency;
  /** Tanggal mulai WIB `YYYY-MM-DD`. */
  startDate: string;
}

export interface UpdateRecurringRuleInput {
  amount?: Rupiah;
  categoryId?: string;
  walletId?: string;
  type?: 'EXPENSE' | 'INCOME';
  frequency?: Frequency;
  startDate?: string;
  /** Indeks kejadian berikutnya (mis. setelah setel ulang). */
  nextIndex?: number;
}

/** Menghitung `nextDueOn` dari jadwal aturan (tanggal kejadian `nextIndex`). */
function computeNextDueOn(startDate: string, frequency: Frequency, nextIndex: number): string {
  return occurrence(startDate, frequency, nextIndex);
}

/**
 * createRecurringRule: membuat aturan berulang baru berstatus `ACTIVE`
 * (Requirement 6.1). `nextIndex` dimulai dari 0 dan `nextDueOn` dihitung dari
 * `occurrence(startDate, frequency, 0)` (clamp akhir bulan untuk MONTHLY/
 * YEARLY). Nominal divalidasi.
 */
export async function createRecurringRule(
  repo: LedgerRepo,
  owner: string,
  input: CreateRecurringRuleInput,
  options: OperationOptions = {},
): Promise<RecurringRuleRecord> {
  const amount = requireAmount(input.amount);
  assertDate(input.startDate);
  const id = (options.newId ?? randomUUID)();
  const nextIndex = 0;
  const record: RecurringRuleRecord = {
    id,
    owner,
    amount,
    categoryId: input.categoryId,
    walletId: input.walletId,
    type: input.type,
    frequency: input.frequency,
    startDate: input.startDate,
    nextIndex,
    nextDueOn: computeNextDueOn(input.startDate, input.frequency, nextIndex),
    status: 'ACTIVE',
  };
  await repo.put('RecurringRule', record as unknown as ItemRecord);
  return record;
}

/** Memuat aturan berulang milik pemilik atau melempar `RULE_NOT_FOUND`. */
async function requireRule(repo: LedgerRepo, owner: string, id: string): Promise<RecurringRuleRecord> {
  const record = await repo.get('RecurringRule', owner, id);
  if (!record) {
    throw new BudgetRecurringGoalError('RULE_NOT_FOUND', 'Aturan berulang tidak ditemukan');
  }
  return record;
}

/**
 * updateRecurringRule: mengubah aturan berulang (Requirement 6.1). Bila
 * `startDate`, `frequency`, atau `nextIndex` berubah, `nextDueOn` dihitung
 * ulang agar tetap konsisten dengan jadwal. Nominal divalidasi bila diberikan.
 */
export async function updateRecurringRule(
  repo: LedgerRepo,
  owner: string,
  id: string,
  input: UpdateRecurringRuleInput,
): Promise<RecurringRuleRecord> {
  const existing = await requireRule(repo, owner, id);

  const set: Record<string, unknown> = {};
  if (input.amount !== undefined) set.amount = requireAmount(input.amount);
  if (input.categoryId !== undefined) set.categoryId = input.categoryId;
  if (input.walletId !== undefined) set.walletId = input.walletId;
  if (input.type !== undefined) set.type = input.type;
  if (input.frequency !== undefined) set.frequency = input.frequency;
  if (input.startDate !== undefined) {
    assertDate(input.startDate);
    set.startDate = input.startDate;
  }
  if (input.nextIndex !== undefined) {
    if (!Number.isInteger(input.nextIndex) || input.nextIndex < 0) {
      throw new BudgetRecurringGoalError('DATE_INVALID', 'Indeks kejadian harus bilangan bulat tidak negatif');
    }
    set.nextIndex = input.nextIndex;
  }

  const startDate = (set.startDate as string | undefined) ?? existing.startDate;
  const frequency = (set.frequency as Frequency | undefined) ?? existing.frequency;
  const nextIndex = (set.nextIndex as number | undefined) ?? existing.nextIndex;
  // Hitung ulang nextDueOn bila jadwal berubah (hanya saat aturan aktif).
  if (
    (input.startDate !== undefined || input.frequency !== undefined || input.nextIndex !== undefined) &&
    existing.status === 'ACTIVE'
  ) {
    set.nextDueOn = computeNextDueOn(startDate, frequency, nextIndex);
  }

  await repo.update('RecurringRule', id, { set });
  return { ...existing, ...(set as Partial<RecurringRuleRecord>) };
}

/**
 * pauseRecurringRule: menjeda aturan berulang sehingga tidak menghasilkan
 * Transaksi baru (Requirement 6.4). `nextDueOn` dihapus agar indeks
 * `listRulesDue` tidak lagi menjaringnya.
 */
export async function pauseRecurringRule(
  repo: LedgerRepo,
  owner: string,
  id: string,
): Promise<RecurringRuleRecord> {
  const existing = await requireRule(repo, owner, id);
  await repo.update('RecurringRule', id, { set: { status: 'PAUSED' }, remove: ['nextDueOn'] });
  const next = { ...existing, status: 'PAUSED' as const };
  delete next.nextDueOn;
  return next;
}

/**
 * resumeRecurringRule: melanjutkan aturan yang dijeda (Requirement 6.4). Status
 * kembali `ACTIVE` dan `nextDueOn` dihitung ulang dari jadwal saat ini.
 */
export async function resumeRecurringRule(
  repo: LedgerRepo,
  owner: string,
  id: string,
): Promise<RecurringRuleRecord> {
  const existing = await requireRule(repo, owner, id);
  const nextDueOn = computeNextDueOn(existing.startDate, existing.frequency, existing.nextIndex);
  await repo.update('RecurringRule', id, { set: { status: 'ACTIVE', nextDueOn } });
  return { ...existing, status: 'ACTIVE', nextDueOn };
}

/** deleteRecurringRule: menghapus aturan berulang (Requirement 6.4). */
export async function deleteRecurringRule(
  repo: LedgerRepo,
  owner: string,
  id: string,
): Promise<RecurringRuleRecord> {
  const existing = await requireRule(repo, owner, id);
  await repo.delete('RecurringRule', id);
  return existing;
}

// --- CRUD Target_Tabungan -------------------------------------------------

export interface CreateGoalInput {
  name: string;
  target: Rupiah;
  /** Tenggat WIB `YYYY-MM-DD` (opsional). */
  deadline?: string;
}

export interface UpdateGoalInput {
  name?: string;
  target?: Rupiah;
  deadline?: string | null;
}

/**
 * createGoal: membuat Target_Tabungan baru dengan progres 0 (Requirement 7.1).
 * Target divalidasi (bilangan bulat lebih dari 0). Setoran ditangani terpisah
 * oleh `depositToGoal` (operations-transaction).
 */
export async function createGoal(
  repo: LedgerRepo,
  owner: string,
  input: CreateGoalInput,
  options: OperationOptions = {},
): Promise<GoalRecord> {
  const target = requireAmount(input.target);
  if (input.deadline !== undefined) assertDate(input.deadline);
  const id = (options.newId ?? randomUUID)();
  const record: GoalRecord = {
    id,
    owner,
    name: input.name,
    target,
    saved: 0,
    deadline: input.deadline,
    achieved: false,
  };
  await repo.put('Goal', record as unknown as ItemRecord);
  return record;
}

/** Memuat Target milik pemilik atau melempar `GOAL_NOT_FOUND`. */
async function requireGoal(repo: LedgerRepo, owner: string, id: string): Promise<GoalRecord> {
  const record = await repo.get('Goal', owner, id);
  if (!record) {
    throw new BudgetRecurringGoalError('GOAL_NOT_FOUND', 'Target tabungan tidak ditemukan');
  }
  return record;
}

/**
 * updateGoal: mengubah nama, target, atau tenggat Target_Tabungan
 * (Requirement 7.1). Progres (`saved`) tidak diubah di sini. Bila target
 * berubah, status `achieved` dihitung ulang terhadap progres saat ini
 * (`saved >= target`). Tenggat dapat dihapus dengan mengirim `null`.
 */
export async function updateGoal(
  repo: LedgerRepo,
  owner: string,
  id: string,
  input: UpdateGoalInput,
): Promise<GoalRecord> {
  const existing = await requireGoal(repo, owner, id);

  const set: Record<string, unknown> = {};
  const remove: string[] = [];
  if (input.name !== undefined) set.name = input.name;
  if (input.target !== undefined) set.target = requireAmount(input.target);
  if (input.deadline !== undefined) {
    if (input.deadline === null) {
      remove.push('deadline');
    } else {
      assertDate(input.deadline);
      set.deadline = input.deadline;
    }
  }

  const target = (set.target as number | undefined) ?? existing.target;
  const achieved = goalProgress(existing.saved, target).achieved;
  set.achieved = achieved;

  await repo.update('Goal', id, {
    set,
    remove: remove.length > 0 ? remove : undefined,
  });

  const next: GoalRecord = { ...existing, ...(set as Partial<GoalRecord>), achieved };
  if (remove.includes('deadline')) delete next.deadline;
  return next;
}

/** deleteGoal: menghapus Target_Tabungan (Requirement 7.1). */
export async function deleteGoal(
  repo: LedgerRepo,
  owner: string,
  id: string,
): Promise<GoalRecord> {
  const existing = await requireGoal(repo, owner, id);
  await repo.delete('Goal', id);
  return existing;
}
