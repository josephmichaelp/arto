/**
 * Hook TanStack Query untuk Aturan Berulang / Transaksi_Berulang (Req 6.1, 6.4).
 *
 * Mengembalikan semua aturan milik Pengguna. Bila `amplify_outputs.json` belum ada,
 * mengembalikan larik kosong.
 */
import { useQuery } from '@tanstack/react-query';
import type { Schema } from '../../amplify/data/resource';
import { loadAmplifyOutputs } from '../app/amplify';
import { getDataClient } from '../app/dataClient';

export type RecurringRuleItem = Schema['RecurringRule']['type'];

export function useRecurringRules() {
  return useQuery<RecurringRuleItem[], Error>({
    queryKey: ['recurring-rules'],
    queryFn: async () => {
      if (!loadAmplifyOutputs()) return [];
      const client = getDataClient();
      const { data, errors } = await client.models.RecurringRule.list();
      if (errors?.length) throw new Error(errors[0]?.message ?? 'Gagal memuat aturan berulang');
      return data ?? [];
    },
  });
}
