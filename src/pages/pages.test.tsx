// @vitest-environment jsdom
/**
 * Uji UI halaman (Tugas 12.15).
 *
 * Menguji perilaku tiga halaman utama tanpa memanggil Amplify/AWS:
 * - HomePage: salam, skeleton saldo, konten kosong saat dompet kosong
 * - TransactionsPage: EmptyState dan tombol FAB saat data kosong
 * - BudgetPage: lencana WARN80 dan OVER100 berdasarkan data mock
 *
 * Semua hook dari `src/hooks` di-mock lewat vi.mock sehingga tidak ada
 * panggilan ke AppSync/DynamoDB. Bulan berjalan dikunci ke '2025-01'
 * agar data mock dan kalkulasi budgetStatus konsisten.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock: kunci bulan berjalan ke '2025-01' supaya data mock cocok
// ---------------------------------------------------------------------------
vi.mock('shared/domain/dates', async (importOriginal) => {
  const original = await importOriginal<typeof import('shared/domain/dates')>();
  return {
    ...original,
    toJakartaMonth: vi.fn(() => '2025-01'),
  };
});

// ---------------------------------------------------------------------------
// Mock: @aws-amplify/ui-react — sediakan pengguna simulasi
// ---------------------------------------------------------------------------
vi.mock('@aws-amplify/ui-react', () => ({
  useAuthenticator: () => ({
    user: {
      signInDetails: { loginId: 'budi@example.com' },
      username: 'budi',
    },
  }),
}));

// ---------------------------------------------------------------------------
// Mock: react-router-dom — cegah error "useNavigate outside Router"
// ---------------------------------------------------------------------------
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: seluruh hook data/mutasi dari src/hooks
// ---------------------------------------------------------------------------
vi.mock('../hooks', () => ({
  useWallets: vi.fn(),
  useTransactions: vi.fn(),
  useBudgets: vi.fn(),
  useCategories: vi.fn(),
  useUserProfile: vi.fn(),
  useTransactionPage: vi.fn(),
  useSaveTransaction: vi.fn(),
  useDeleteTransaction: vi.fn(),
  useUpsertBudget: vi.fn(),
  useCopyBudgetsFromPreviousMonth: vi.fn(),
}));

import {
  useWallets,
  useTransactions,
  useBudgets,
  useCategories,
  useUserProfile,
  useTransactionPage,
  useSaveTransaction,
  useDeleteTransaction,
  useUpsertBudget,
  useCopyBudgetsFromPreviousMonth,
} from '../hooks';

// Impor komponen halaman setelah semua mock terdaftar
import { HomePage } from './HomePage';
import { TransactionsPage } from './TransactionsPage';
import { BudgetPage } from './BudgetPage';

// ---------------------------------------------------------------------------
// Setup global: stub IntersectionObserver (tidak tersedia di jsdom)
// ---------------------------------------------------------------------------
beforeEach(() => {
  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    })),
  });
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helper: nilai return default untuk hook mutasi (tidak diuji langsung)
// ---------------------------------------------------------------------------
const defaultMutation = { isPending: false, mutateAsync: vi.fn() };

const defaultTxPage = {
  data: [],
  isLoading: false,
  isFetching: false,
  hasMore: false,
  error: null,
  loadFirst: vi.fn().mockResolvedValue(undefined),
  loadMore: vi.fn().mockResolvedValue(undefined),
};

// ===========================================================================
// 1. HomePage
// ===========================================================================
describe('HomePage', () => {
  beforeEach(() => {
    // Kategori dan anggaran kosong sebagai default untuk suite ini
    vi.mocked(useCategories).mockReturnValue({ data: [], isPending: false } as unknown as ReturnType<typeof useCategories>);
    vi.mocked(useBudgets).mockReturnValue({ data: [], isPending: false, error: null } as unknown as ReturnType<typeof useBudgets>);
    // Tanpa profil tersimpan, salam jatuh kembali ke turunan email.
    vi.mocked(useUserProfile).mockReturnValue({ data: null } as unknown as ReturnType<typeof useUserProfile>);
  });

  it('menampilkan salam dengan nama pengguna yang dimuat', () => {
    vi.mocked(useWallets).mockReturnValue({ data: [], isPending: false } as unknown as ReturnType<typeof useWallets>);
    vi.mocked(useTransactions).mockReturnValue({ data: [], isPending: false } as unknown as ReturnType<typeof useTransactions>);

    render(<HomePage />);

    // displayName('budi@example.com', 'budi') → ambil bagian sebelum '@' → 'Budi'
    expect(screen.getByText('Halo, Budi')).not.toBeNull();
  });

  it('mengutamakan nama tampilan tersimpan di atas turunan email', () => {
    vi.mocked(useWallets).mockReturnValue({ data: [], isPending: false } as unknown as ReturnType<typeof useWallets>);
    vi.mocked(useTransactions).mockReturnValue({ data: [], isPending: false } as unknown as ReturnType<typeof useTransactions>);
    vi.mocked(useUserProfile).mockReturnValue({
      data: { id: 'sub-1', displayName: 'Siti Rahma' },
    } as unknown as ReturnType<typeof useUserProfile>);

    render(<HomePage />);

    expect(screen.getByText('Halo, Siti Rahma')).not.toBeNull();
    expect(screen.queryByText('Halo, Budi')).toBeNull();
  });

  it('jatuh kembali ke turunan email bila nama tersimpan kosong', () => {
    vi.mocked(useWallets).mockReturnValue({ data: [], isPending: false } as unknown as ReturnType<typeof useWallets>);
    vi.mocked(useTransactions).mockReturnValue({ data: [], isPending: false } as unknown as ReturnType<typeof useTransactions>);
    vi.mocked(useUserProfile).mockReturnValue({
      data: { id: 'sub-1', displayName: '   ' },
    } as unknown as ReturnType<typeof useUserProfile>);

    render(<HomePage />);

    expect(screen.getByText('Halo, Budi')).not.toBeNull();
  });

  it('menampilkan Skeleton saldo saat dompet sedang dimuat', () => {
    vi.mocked(useWallets).mockReturnValue({ data: undefined, isPending: true } as unknown as ReturnType<typeof useWallets>);
    vi.mocked(useTransactions).mockReturnValue({ data: [], isPending: false } as unknown as ReturnType<typeof useTransactions>);

    render(<HomePage />);

    // Skeleton merender teks visually-hidden 'Memuat saldo' untuk screen reader
    // Req 17.10: skeleton muncul selama data dimuat
    expect(screen.getByText('Memuat saldo')).not.toBeNull();
  });

  it('menampilkan pesan kosong transaksi saat dompet dan transaksi kosong', () => {
    vi.mocked(useWallets).mockReturnValue({ data: [], isPending: false } as unknown as ReturnType<typeof useWallets>);
    vi.mocked(useTransactions).mockReturnValue({ data: [], isPending: false } as unknown as ReturnType<typeof useTransactions>);

    render(<HomePage />);

    // Saat wallets=[] dan transactions=[], bagian "Transaksi Terbaru" menampilkan pesan kosong
    expect(screen.getByText('Belum ada transaksi bulan ini.')).not.toBeNull();
  });
});

// ===========================================================================
// 2. TransactionsPage
// ===========================================================================
describe('TransactionsPage', () => {
  beforeEach(() => {
    vi.mocked(useCategories).mockReturnValue({ data: [], isPending: false } as unknown as ReturnType<typeof useCategories>);
    vi.mocked(useWallets).mockReturnValue({ data: [], isPending: false } as unknown as ReturnType<typeof useWallets>);
    vi.mocked(useSaveTransaction).mockReturnValue(defaultMutation as unknown as ReturnType<typeof useSaveTransaction>);
    vi.mocked(useDeleteTransaction).mockReturnValue(defaultMutation as unknown as ReturnType<typeof useDeleteTransaction>);
    vi.mocked(useTransactionPage).mockReturnValue(defaultTxPage as unknown as ReturnType<typeof useTransactionPage>);
  });

  it('menampilkan EmptyState saat tidak ada transaksi', () => {
    render(<TransactionsPage />);

    // EmptyState dengan role="status" dan judul "Belum ada transaksi"
    // Req 17.3: keadaan kosong ditampilkan dengan ikon dan deskripsi
    expect(screen.getByText('Belum ada transaksi')).not.toBeNull();
  });

  it('menampilkan tombol FAB Tambah transaksi', () => {
    render(<TransactionsPage />);

    // QuickAddFab merender <button aria-label="Tambah transaksi">
    // Req 17.1, 17.2: FAB tampil saat tidak ada sheet aktif
    const fab = screen.getByRole('button', { name: 'Tambah transaksi' });
    expect(fab).not.toBeNull();
  });
});

// ===========================================================================
// 3. BudgetPage — lencana WARN80 dan OVER100
// ===========================================================================
describe('BudgetPage', () => {
  beforeEach(() => {
    vi.mocked(useUpsertBudget).mockReturnValue(defaultMutation as unknown as ReturnType<typeof useUpsertBudget>);
    vi.mocked(useCopyBudgetsFromPreviousMonth).mockReturnValue(defaultMutation as unknown as ReturnType<typeof useCopyBudgetsFromPreviousMonth>);
  });

  it('menampilkan lencana "Mendekati batas" (WARN80) saat realisasi ≥ 80%', () => {
    // Anggaran: Rp 100.000 untuk kategori 'cat1' bulan 2025-01
    vi.mocked(useBudgets).mockReturnValue({
      data: [{ id: 'b1', categoryId: 'cat1', month: '2025-01', amount: 100_000 }],
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof useBudgets>);

    vi.mocked(useCategories).mockReturnValue({
      data: [{ id: 'cat1', name: 'Makan', type: 'EXPENSE' }],
      isPending: false,
    } as unknown as ReturnType<typeof useCategories>);

    // Transaksi Rp 85.000 → 85000 * 100 = 8.500.000 ≥ 100000 * 80 = 8.000.000 → WARN80
    vi.mocked(useTransactions).mockReturnValue({
      data: [
        {
          id: 't1',
          type: 'EXPENSE',
          categoryId: 'cat1',
          amount: 85_000,
          date: '2025-01-15',
          month: '2025-01',
          walletId: 'w1',
        },
      ],
      isPending: false,
    } as unknown as ReturnType<typeof useTransactions>);

    render(<BudgetPage />);

    // BudgetCard merender span dengan teks '⚠️ Mendekati batas' saat level WARN80
    // Req 5.4, 5.5: ambang 80% menampilkan peringatan
    expect(screen.getByText(/Mendekati batas/)).not.toBeNull();
  });

  it('menampilkan lencana "Melebihi batas" (OVER100) saat realisasi > 100%', () => {
    // Anggaran: Rp 100.000 untuk kategori 'cat2' bulan 2025-01
    vi.mocked(useBudgets).mockReturnValue({
      data: [{ id: 'b2', categoryId: 'cat2', month: '2025-01', amount: 100_000 }],
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof useBudgets>);

    vi.mocked(useCategories).mockReturnValue({
      data: [{ id: 'cat2', name: 'Hiburan', type: 'EXPENSE' }],
      isPending: false,
    } as unknown as ReturnType<typeof useCategories>);

    // Transaksi Rp 110.000 → 110000 > 100000 → OVER100
    vi.mocked(useTransactions).mockReturnValue({
      data: [
        {
          id: 't2',
          type: 'EXPENSE',
          categoryId: 'cat2',
          amount: 110_000,
          date: '2025-01-20',
          month: '2025-01',
          walletId: 'w1',
        },
      ],
      isPending: false,
    } as unknown as ReturnType<typeof useTransactions>);

    render(<BudgetPage />);

    // BudgetCard merender span dengan teks '🚨 Melebihi batas' saat level OVER100
    // Req 5.5: melebihi 100% menampilkan peringatan merah
    expect(screen.getByText(/Melebihi batas/)).not.toBeNull();
  });
});
