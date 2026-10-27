/** Tipe bersama dan helper pemilik untuk domain Arto. */

/** K-1: nominal adalah bilangan bulat Rupiah. */
export type Rupiah = number;

export type TxnType = 'EXPENSE' | 'INCOME' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'GOAL_DEPOSIT';
export type CategoryType = 'EXPENSE' | 'INCOME';

export interface Txn {
  id: string;
  type: TxnType;
  amount: Rupiah;
  /** YYYY-MM-DD (WIB) */
  date: string;
  categoryId?: string;
  walletId: string;
  note?: string;
  receiptKey?: string;
}

export interface Wallet {
  id: string;
  name: string;
  initialBalance: Rupiah;
  balance: Rupiah;
}

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  builtIn?: boolean;
}

export interface Budget {
  id: string;
  categoryId: string;
  /** YYYY-MM (WIB) */
  month: string;
  amount: Rupiah;
  warn80Sent?: boolean;
  over100Sent?: boolean;
}

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type RuleStatus = 'ACTIVE' | 'PAUSED';

export interface RuleLike {
  id: string;
  frequency: Frequency;
  startDate: string;
  nextIndex: number;
  status: RuleStatus;
}

export interface RecurringRule extends RuleLike {
  amount: Rupiah;
  categoryId: string;
  walletId: string;
  type: CategoryType;
  nextDueOn?: string;
}

export interface Goal {
  id: string;
  name: string;
  target: Rupiah;
  saved: Rupiah;
  deadline?: string;
  achieved?: boolean;
}

export interface Notification {
  id: string;
  type: string;
  refId?: string;
  title: string;
  body?: string;
  read?: boolean;
  createdAt?: string;
}

export interface NotifPrefs {
  budget?: boolean;
  recurring?: boolean;
  goal?: boolean;
  insight?: boolean;
}

export interface WeeklyInsight {
  weekStart: string;
  totalExpense?: Rupiah;
  topCategoryId?: string;
  summary?: string;
  tips?: string[];
}

export interface ExportRow {
  date: string;
  type: string;
  category: string;
  wallet: string;
  amount: Rupiah;
  note: string;
}

export interface DateRange {
  from: string;
  to: string;
}

/**
 * Menghasilkan pemilik "<sub>::<username>". Melempar galat bila identitas
 * kosong atau salah satu bagiannya kosong.
 */
export function ownerOf(
  identity: { sub?: string | null; username?: string | null } | null | undefined,
): string {
  const sub = identity?.sub?.trim();
  const username = identity?.username?.trim();
  if (!sub || !username) {
    throw new Error('Identitas pengguna tidak valid');
  }
  return `${sub}::${username}`;
}
