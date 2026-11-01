/**
 * Hook TanStack Query untuk Transaksi (Req 2.5, 2.6).
 *
 * `useTransactions` mendukung filter opsional dan memuat semua Transaksi
 * milik Pengguna lewat `listTxByDate` (urutan menurun per DB), kemudian
 * menerapkan filter konjungtif di sisi klien (Req 2.6).
 *
 * `useTransactionPage` memakai paginasi 20 item per halaman dengan nextToken.
 *
 * Bila `amplify_outputs.json` belum ada, mengembalikan larik kosong.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCurrentUser } from 'aws-amplify/auth';
import type { Schema } from '../../amplify/data/resource';
import { loadAmplifyOutputs } from '../app/amplify';
import { getDataClient } from '../app/dataClient';

export type TransactionItem = Schema['Transaction']['type'];

/** Tipe halaman tunggal dari API Amplify (untuk anotasi eksplisit). */
interface TxPage {
  data: TransactionItem[];
  errors?: { message: string }[] | null;
  nextToken?: string | null;
}

export interface TransactionFilter {
  /** Kata kunci pencarian (cocok ke `searchText` atau `note`) */
  keyword?: string;
  /** Filter Kategori */
  categoryId?: string;
  /** Filter Dompet */
  walletId?: string;
  /** Filter jenis transaksi */
  type?: TransactionItem['type'];
  /** Rentang tanggal mulai (YYYY-MM-DD) */
  dateFrom?: string;
  /** Rentang tanggal akhir (YYYY-MM-DD) */
  dateTo?: string;
  /** Bulan tertentu (YYYY-MM) */
  month?: string;
}

/** Ambil satu halaman dari API, kembalikan sebagai TxPage bertipe eksplisit. */
async function fetchPage(
  owner: string,
  limit: number,
  token: string | undefined,
): Promise<TxPage> {
  const client = getDataClient();
  // Amplify secondary-index query; cast ke TxPage agar TypeScript tidak
  // menyimpulkan `any` pada iterasi berikutnya (TS7022).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await (client.models.Transaction as any).listTxByDate(
    { owner },
    { sortDirection: 'DESC', limit, nextToken: token },
  ) as TxPage;
  return raw;
}

// ---------------------------------------------------------------------------
// Hook: semua Transaksi dengan filter klien
// ---------------------------------------------------------------------------

/**
 * Mengambil semua Transaksi milik Pengguna lewat indeks sekunder `listTxByDate`
 * (Req 2.5). Hasil diurutkan dari tanggal terbaru. Filter diterapkan di sisi
 * klien karena AppSync indeks sekunder tidak mendukung filter konjungtif penuh.
 */
export function useTransactions(filter?: TransactionFilter) {
  return useQuery<TransactionItem[], Error>({
    queryKey: ['transactions', filter ?? {}],
    queryFn: async () => {
      if (!loadAmplifyOutputs()) return [];
      const { userId, username } = await getCurrentUser();
      const owner = `${userId}::${username}`;

      const allItems: TransactionItem[] = [];
      let token: string | undefined;
      let hasMore = true;

      while (hasMore) {
        // eslint-disable-next-line no-await-in-loop
        const page: TxPage = await fetchPage(owner, 200, token);
        if (page.errors?.length) {
          throw new Error(page.errors[0]?.message ?? 'Gagal memuat transaksi');
        }
        allItems.push(...page.data);
        token = page.nextToken ?? undefined;
        hasMore = !!token;
      }

      return applyClientFilter(allItems, filter);
    },
  });
}

// ---------------------------------------------------------------------------
// Hook: paginasi bertahap 20 item per halaman
// ---------------------------------------------------------------------------

/**
 * Paginasi bertahap: memuat 20 item per halaman. Mengelola state `nextToken`
 * secara internal dan mengekspos `loadMore` untuk pemuatan berikutnya.
 */
export function useTransactionPage(filter?: TransactionFilter, pageSize = 20) {
  const [pages, setPages] = useState<TransactionItem[][]>([]);
  const [curToken, setCurToken] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);

  const query = useQuery<{ items: TransactionItem[]; nextToken: string | null }, Error>({
    queryKey: ['transactions-page', filter ?? {}, pages.length],
    queryFn: async () => {
      if (!loadAmplifyOutputs()) return { items: [], nextToken: null };
      const { userId, username } = await getCurrentUser();
      const owner = `${userId}::${username}`;

      // Kumpulkan item hingga pageSize terpenuhi setelah filter klien.
      const collected: TransactionItem[] = [];
      let token: string | undefined = curToken;

      while (collected.length < pageSize) {
        // eslint-disable-next-line no-await-in-loop
        const page: TxPage = await fetchPage(owner, 50, token);
        if (page.errors?.length) {
          throw new Error(page.errors[0]?.message ?? 'Gagal memuat transaksi');
        }
        const filtered = applyClientFilter(page.data, filter);
        collected.push(...filtered);
        token = page.nextToken ?? undefined;
        if (!token) break;
      }

      return { items: collected.slice(0, pageSize), nextToken: token ?? null };
    },
    enabled: false, // dipanggil manual lewat `refetch`
  });

  /** Data gabungan dari semua halaman yang sudah dimuat. */
  const data = pages.flat();

  /** Muat halaman pertama atau muat ulang dari awal. */
  const loadFirst = async () => {
    setPages([]);
    setCurToken(undefined);
    setHasMore(true);
    const result = await query.refetch();
    if (result.data) {
      setPages([result.data.items]);
      setCurToken(result.data.nextToken ?? undefined);
      setHasMore(result.data.nextToken !== null);
    }
  };

  /** Muat halaman berikutnya. */
  const loadMore = async () => {
    if (!hasMore) return;
    const result = await query.refetch();
    if (result.data) {
      setPages((p) => [...p, result.data!.items]);
      setCurToken(result.data.nextToken ?? undefined);
      setHasMore(result.data.nextToken !== null);
    }
  };

  return {
    data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    hasMore,
    loadFirst,
    loadMore,
  };
}

// ---------------------------------------------------------------------------
// Helper: filter klien (Req 2.6)
// ---------------------------------------------------------------------------

function applyClientFilter(
  items: TransactionItem[],
  filter?: TransactionFilter,
): TransactionItem[] {
  if (!filter) return items;

  return items.filter((item) => {
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase();
      if (
        !(item.searchText ?? '').toLowerCase().includes(kw) &&
        !(item.note ?? '').toLowerCase().includes(kw)
      ) {
        return false;
      }
    }
    if (filter.categoryId && item.categoryId !== filter.categoryId) return false;
    if (filter.walletId && item.walletId !== filter.walletId) return false;
    if (filter.type && item.type !== filter.type) return false;
    if (filter.dateFrom && item.date < filter.dateFrom) return false;
    if (filter.dateTo && item.date > filter.dateTo) return false;
    if (filter.month && item.month !== filter.month) return false;
    return true;
  });
}
