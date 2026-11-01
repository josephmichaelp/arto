/**
 * Barrel ekspor untuk semua hook data dan mutation Arto.
 *
 * Impor dari `@/hooks` atau `src/hooks` memberikan akses ke semua hook
 * sekaligus.
 */

// Penyiapan data awal akun
export { useBootstrapUser, bootstrapDoneKey } from './useBootstrapUser';
export type { BootstrapSummary, UseBootstrapUserResult } from './useBootstrapUser';

// Query hooks — data
export { useUserProfile, useUpdateDisplayName, USER_PROFILE_QUERY_KEY } from './useUserProfile';
export type { UserProfileItem } from './useUserProfile';

export { useWallets } from './useWallets';
export type { WalletItem } from './useWallets';

export { useCategories } from './useCategories';
export type { CategoryItem } from './useCategories';

export { useTransactions, useTransactionPage } from './useTransactions';
export type { TransactionItem, TransactionFilter } from './useTransactions';

export { useBudgets } from './useBudgets';
export type { BudgetItem } from './useBudgets';

export { useGoals } from './useGoals';
export type { GoalItem } from './useGoals';

export { useNotifications, useUnreadCount, useNotifPrefs } from './useNotifications';
export type { NotificationItem, NotifPrefsItem } from './useNotifications';

export { useRecurringRules } from './useRecurringRules';
export type { RecurringRuleItem } from './useRecurringRules';

export { useWeeklyInsights } from './useWeeklyInsights';
export type { WeeklyInsightItem } from './useWeeklyInsights';

// Mutation hooks — ledger Lambda
export {
  useSaveTransaction,
  useDeleteTransaction,
  useTransferFunds,
  useDepositToGoal,
  useCreateWallet,
  useRenameWallet,
  useDeleteWalletWithReassign,
  useCreateCategory,
  useRenameCategory,
  useDeleteCategoryWithReassign,
  useUpsertBudget,
  useCopyBudgetsFromPreviousMonth,
  useCreateRecurringRule,
  useUpdateRecurringRule,
  useDeleteRecurringRule,
  useCreateGoal,
  useUpdateGoal,
  useDeleteGoal,
} from './useLedgerMutations';

// Mutation hooks — ai-gateway Lambda
export {
  useParseNaturalInput,
  useCreateReceiptUpload,
  useScanReceipt,
  useAskAssistant,
} from './useAiMutations';
export type {
  NaturalInputPreview,
  ReceiptPreview,
  ReceiptUploadUrl,
  AssistantAnswer,
} from './useAiMutations';
