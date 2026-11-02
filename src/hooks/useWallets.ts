/**
 * Hook TanStack Query untuk Dompet (Req 3.2, 4.1, 4.2).
 *
 * Mengembalikan semua Dompet milik Pengguna yang terautentikasi. Bila
 * `amplify_outputs.json` belum ada (dev/CI), mengembalikan larik kosong
 * tanpa galat sehingga UI tetap dapat dirender.
 */
import { useQuery } from '@tanstack/react-query';
import type { Schema } from '../../amplify/data/resource';
import { loadAmplifyOutputs } from '../app/amplify';
import { getDataClient } from '../app/dataClient';

export type WalletItem = Schema['Wallet']['type'];

export function useWallets() {
  return useQuery<WalletItem[], Error>({
    queryKey: ['wallets'],
    queryFn: async () => {
      if (!loadAmplifyOutputs()) return [];
      const client = getDataClient();
      // Item penjaga keunikan (UNIQ#...) tinggal di tabel yang sama dengan
// rekaman nyata. Filter ttributeExists memastikannya tidak lolos ke
// GraphQL type-checker yang akan menolak item tanpa field required.
const { data, errors } = await client.models.Wallet.list({
  filter: { name: { attributeExists: true } },
});
      if (errors?.length) throw new Error(errors[0]?.message ?? 'Gagal memuat dompet');
      return data ?? [];
    },
  });
}
