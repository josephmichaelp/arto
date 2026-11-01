/**
 * Hook TanStack Query untuk Target_Tabungan (Req 7.1, 7.3, 7.4, 7.5).
 *
 * Mengembalikan semua Target_Tabungan milik Pengguna. Bila
 * `amplify_outputs.json` belum ada, mengembalikan larik kosong.
 */
import { useQuery } from '@tanstack/react-query';
import type { Schema } from '../../amplify/data/resource';
import { loadAmplifyOutputs } from '../app/amplify';
import { getDataClient } from '../app/dataClient';

export type GoalItem = Schema['Goal']['type'];

export function useGoals() {
  return useQuery<GoalItem[], Error>({
    queryKey: ['goals'],
    queryFn: async () => {
      if (!loadAmplifyOutputs()) return [];
      const client = getDataClient();
      const { data, errors } = await client.models.Goal.list();
      if (errors?.length) throw new Error(errors[0]?.message ?? 'Gagal memuat target tabungan');
      return data ?? [];
    },
  });
}
