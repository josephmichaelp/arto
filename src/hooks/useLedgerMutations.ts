/**
 * Hook TanStack Query (useMutation) untuk semua operasi tulis lewat Lambda
 * `ledger` (Req 2.1-2.4, 3.2-3.5, 4.1-4.5, 5.1, 5.6, 6.1, 7.1-7.6).
 *
 * Setiap mutation memanggil custom mutation GraphQL di skema Amplify yang
 * diteruskan ke Lambda `ledger`. Setelah berhasil, queryKey terkait di-
 * invalidate agar UI memuat ulang data terbaru secara otomatis.
 *
 * Payload semua mutation bersifat JSON bebas karena skema mendefinisikan
 * argumen sebagai `a.json()`.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { loadAmplifyOutputs } from '../app/amplify';
import { getDataClient } from '../app/dataClient';

// ---------------------------------------------------------------------------
// Helper internal
// ---------------------------------------------------------------------------

async function callLedger<T>(mutationName: string, payload: Record<string, unknown>): Promise<T> {
  if (!loadAmplifyOutputs()) {
    throw new Error('Amplify belum dikonfigurasi. Hubungkan ke backend sebelum menyimpan data.');
  }
  const client = getDataClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = (client.mutations as any)[mutationName] as
    | ((args: { input: unknown }) => Promise<{ data: T | null; errors?: { message: string }[] }>)
    | undefined;
  if (!fn) throw new Error(`Mutasi ${mutationName} tidak ditemukan pada klien`);

  const { data, errors } = await fn({ input: payload });
  if (errors?.length) throw new Error(errors[0]?.message ?? `Gagal menjalankan ${mutationName}`);
  return data as T;
}

// ---------------------------------------------------------------------------
// Transaksi
// ---------------------------------------------------------------------------

/** Simpan Transaksi baru atau ubah Transaksi yang sudah ada. */
export function useSaveTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => callLedger('saveTransaction', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['transactions'] });
      void qc.invalidateQueries({ queryKey: ['wallets'] });
      void qc.invalidateQueries({ queryKey: ['budgets'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/** Hapus Transaksi setelah konfirmasi. */
export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => callLedger('deleteTransaction', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['transactions'] });
      void qc.invalidateQueries({ queryKey: ['wallets'] });
      void qc.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
}

/** Pindah dana antar dua Dompet berbeda. */
export function useTransferFunds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => callLedger('transferFunds', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wallets'] });
      void qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

/** Setor ke Target_Tabungan dari Dompet. */
export function useDepositToGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => callLedger('depositToGoal', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['goals'] });
      void qc.invalidateQueries({ queryKey: ['wallets'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Dompet
// ---------------------------------------------------------------------------

export function useCreateWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => callLedger('createWallet', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wallets'] });
    },
  });
}

export function useRenameWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => callLedger('renameWallet', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wallets'] });
    },
  });
}

export function useDeleteWalletWithReassign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => callLedger('deleteWalletWithReassign', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wallets'] });
      void qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Kategori
// ---------------------------------------------------------------------------

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => callLedger('createCategory', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

export function useRenameCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => callLedger('renameCategory', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

export function useDeleteCategoryWithReassign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => callLedger('deleteCategoryWithReassign', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['categories'] });
      void qc.invalidateQueries({ queryKey: ['transactions'] });
      void qc.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Anggaran
// ---------------------------------------------------------------------------

export function useUpsertBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => callLedger('upsertBudget', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
}

export function useCopyBudgetsFromPreviousMonth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      callLedger('copyBudgetsFromPreviousMonth', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Aturan Berulang
// ---------------------------------------------------------------------------

export function useCreateRecurringRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => callLedger('createRecurringRule', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['recurring-rules'] });
    },
  });
}

export function useUpdateRecurringRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => callLedger('updateRecurringRule', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['recurring-rules'] });
    },
  });
}

export function useDeleteRecurringRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => callLedger('deleteRecurringRule', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['recurring-rules'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Target Tabungan
// ---------------------------------------------------------------------------

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => callLedger('createGoal', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['goals'] });
    },
  });
}

export function useUpdateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => callLedger('updateGoal', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['goals'] });
    },
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => callLedger('deleteGoal', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['goals'] });
    },
  });
}


