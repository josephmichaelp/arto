/**
 * Hook TanStack Query untuk Wawasan_Mingguan (Req 13.2, 13.5).
 *
 * Mengembalikan daftar wawasan mingguan terurut dari yang terbaru (berdasarkan
 * `weekStart`). Bila `amplify_outputs.json` belum ada, mengembalikan larik kosong.
 */
import { useQuery } from '@tanstack/react-query';
import type { Schema } from '../../amplify/data/resource';
import { loadAmplifyOutputs } from '../app/amplify';
import { getDataClient } from '../app/dataClient';

export type WeeklyInsightItem = Schema['WeeklyInsight']['type'];

export function useWeeklyInsights() {
  return useQuery<WeeklyInsightItem[], Error>({
    queryKey: ['weekly-insights'],
    queryFn: async () => {
      if (!loadAmplifyOutputs()) return [];
      const client = getDataClient();
      const { data, errors } = await client.models.WeeklyInsight.list();
      if (errors?.length) throw new Error(errors[0]?.message ?? 'Gagal memuat wawasan mingguan');
      const sorted = (data ?? []).slice().sort((a, b) => b.weekStart.localeCompare(a.weekStart));
      return sorted;
    },
  });
}
