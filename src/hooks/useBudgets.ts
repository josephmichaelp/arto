/**
 * Hook TanStack Query untuk Anggaran (Req 5.1, 5.2, 5.3, 5.6).
 *
 * Mendukung filter opsional berdasarkan bulan (YYYY-MM). Bila
 * `amplify_outputs.json` belum ada, mengembalikan larik kosong.
 */
import { useQuery } from '@tanstack/react-query';
import type { Schema } from '../../amplify/data/resource';
import { loadAmplifyOutputs } from '../app/amplify';
import { getDataClient } from '../app/dataClient';

export type BudgetItem = Schema['Budget']['type'];

export function useBudgets(month?: string) {
  return useQuery<BudgetItem[], Error>({
    queryKey: ['budgets', month ?? 'all'],
    queryFn: async () => {
      if (!loadAmplifyOutputs()) return [];
      const client = getDataClient();
      const { data, errors } = await client.models.Budget.list();
      if (errors?.length) throw new Error(errors[0]?.message ?? 'Gagal memuat anggaran');
      const all = data ?? [];
      return month ? all.filter((b) => b.month === month) : all;
    },
  });
}
