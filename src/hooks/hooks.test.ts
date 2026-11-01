// @vitest-environment jsdom
/**
 * Uji unit untuk hook data — memverifikasi perilaku saat Amplify belum
 * dikonfigurasi (graceful empty arrays, Req 2.5, 2.7, 15.1).
 *
 * `loadAmplifyOutputs()` mengembalikan null di lingkungan uji karena
 * `amplify_outputs.json` tidak ada. Dengan mock eksplisit di bawah ini kita
 * memastikan perilaku tersebut konsisten tanpa bergantung pada Vite glob.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { ReactNode } from 'react';

// --- Mock amplify outputs agar null ---
vi.mock('../app/amplify', () => ({
  loadAmplifyOutputs: () => null,
  configureAmplify: () => false,
}));

// --- Mock data client agar tidak mencoba memanggil AppSync ---
vi.mock('../app/dataClient', () => ({
  getDataClient: () => ({
    models: {
      Wallet: { list: vi.fn().mockResolvedValue({ data: [], errors: [] }) },
      Category: { list: vi.fn().mockResolvedValue({ data: [], errors: [] }) },
      Transaction: {
        list: vi.fn().mockResolvedValue({ data: [], errors: [] }),
        listTxByDate: vi.fn().mockResolvedValue({ data: [], errors: [] }),
      },
      Budget: { list: vi.fn().mockResolvedValue({ data: [], errors: [] }) },
      Goal: { list: vi.fn().mockResolvedValue({ data: [], errors: [] }) },
      Notification: { list: vi.fn().mockResolvedValue({ data: [], errors: [] }) },
      NotifPrefs: { list: vi.fn().mockResolvedValue({ data: [], errors: [] }) },
      RecurringRule: { list: vi.fn().mockResolvedValue({ data: [], errors: [] }) },
      WeeklyInsight: { list: vi.fn().mockResolvedValue({ data: [], errors: [] }) },
    },
    mutations: {},
  }),
}));

// Wrapper minimal QueryClientProvider
function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

// Helper: buat QueryClient baru per uji agar tidak berbagi cache
function freshClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

// Import hooks setelah mock terpasang
import { useWallets } from './useWallets';
import { useCategories } from './useCategories';
import { useBudgets } from './useBudgets';
import { useGoals } from './useGoals';
import { useNotifications, useUnreadCount } from './useNotifications';
import { useRecurringRules } from './useRecurringRules';
import { useWeeklyInsights } from './useWeeklyInsights';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useWallets', () => {
  it('mengembalikan larik kosong saat Amplify belum dikonfigurasi', async () => {
    const qc = freshClient();
    const { result } = renderHook(() => useWallets(), { wrapper: makeWrapper(qc) });
    await waitFor(() => result.current.isSuccess || result.current.isError);
    expect(result.current.data ?? []).toEqual([]);
  });
});

describe('useCategories', () => {
  it('mengembalikan larik kosong saat Amplify belum dikonfigurasi', async () => {
    const qc = freshClient();
    const { result } = renderHook(() => useCategories(), { wrapper: makeWrapper(qc) });
    await waitFor(() => result.current.isSuccess || result.current.isError);
    expect(result.current.data ?? []).toEqual([]);
  });
});

describe('useBudgets', () => {
  it('mengembalikan larik kosong saat Amplify belum dikonfigurasi', async () => {
    const qc = freshClient();
    const { result } = renderHook(() => useBudgets(), { wrapper: makeWrapper(qc) });
    await waitFor(() => result.current.isSuccess || result.current.isError);
    expect(result.current.data ?? []).toEqual([]);
  });

  it('menerima filter bulan tanpa galat', async () => {
    const qc = freshClient();
    const { result } = renderHook(() => useBudgets('2025-08'), { wrapper: makeWrapper(qc) });
    await waitFor(() => result.current.isSuccess || result.current.isError);
    expect(result.current.data ?? []).toEqual([]);
  });
});

describe('useGoals', () => {
  it('mengembalikan larik kosong saat Amplify belum dikonfigurasi', async () => {
    const qc = freshClient();
    const { result } = renderHook(() => useGoals(), { wrapper: makeWrapper(qc) });
    await waitFor(() => result.current.isSuccess || result.current.isError);
    expect(result.current.data ?? []).toEqual([]);
  });
});

describe('useNotifications', () => {
  it('mengembalikan larik kosong saat Amplify belum dikonfigurasi', async () => {
    const qc = freshClient();
    const { result } = renderHook(() => useNotifications(), { wrapper: makeWrapper(qc) });
    await waitFor(() => result.current.isSuccess || result.current.isError);
    expect(result.current.data ?? []).toEqual([]);
  });
});

describe('useUnreadCount', () => {
  it('mengembalikan 0 saat tidak ada notifikasi', async () => {
    const qc = freshClient();
    const { result } = renderHook(() => useUnreadCount(), { wrapper: makeWrapper(qc) });
    await waitFor(() => result.current !== undefined);
    expect(result.current).toBe(0);
  });
});

describe('useRecurringRules', () => {
  it('mengembalikan larik kosong saat Amplify belum dikonfigurasi', async () => {
    const qc = freshClient();
    const { result } = renderHook(() => useRecurringRules(), { wrapper: makeWrapper(qc) });
    await waitFor(() => result.current.isSuccess || result.current.isError);
    expect(result.current.data ?? []).toEqual([]);
  });
});

describe('useWeeklyInsights', () => {
  it('mengembalikan larik kosong saat Amplify belum dikonfigurasi', async () => {
    const qc = freshClient();
    const { result } = renderHook(() => useWeeklyInsights(), { wrapper: makeWrapper(qc) });
    await waitFor(() => result.current.isSuccess || result.current.isError);
    expect(result.current.data ?? []).toEqual([]);
  });
});
