/**
 * Hook TanStack Query untuk Kategori (Req 3.2, 3.4, 3.5).
 *
 * Mengembalikan semua Kategori milik Pengguna (bawaan + kustom). Bila
 * `amplify_outputs.json` belum ada, mengembalikan larik kosong.
 */
import { useQuery } from '@tanstack/react-query';
import type { Schema } from '../../amplify/data/resource';
import { loadAmplifyOutputs } from '../app/amplify';
import { getDataClient } from '../app/dataClient';

export type CategoryItem = Schema['Category']['type'];

export function useCategories() {
  return useQuery<CategoryItem[], Error>({
    queryKey: ['categories'],
    queryFn: async () => {
      if (!loadAmplifyOutputs()) return [];
      const client = getDataClient();
      const { data, errors } = await client.models.Category.list();
      if (errors?.length) throw new Error(errors[0]?.message ?? 'Gagal memuat kategori');
      return data ?? [];
    },
  });
}
