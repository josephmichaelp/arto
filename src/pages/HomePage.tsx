/**
 * HomePage — Halaman Beranda Arto (Tugas 12.8).
 *
 * Menampilkan:
 * - Salam pengguna (nama/email) lewat LargeTitle.
 * - Total saldo seluruh Dompet.
 * - Ringkasan bulan berjalan (pemasukan, pengeluaran, selisih bersih).
 * - Daftar cepat 5 transaksi terbaru.
 * - Mini-kartu progres 3 anggaran terdekat batas.
 * - Tautan navigasi ke halaman lain (routing dikabel di tugas 12.14).
 *
 * Design System: LargeTitle, SoftCard, Skeleton, AmountDisplay, DateDisplay.
 * Requirements: 2.7, 4.2, 5.3, 10.1, 15.7, 17.1, 17.2, 17.7, 17.9, 17.10
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthenticator } from '@aws-amplify/ui-react';

import { LargeTitle } from '../components/LargeTitle';
import { SoftCard } from '../components/SoftCard';
import { Skeleton } from '../components/Skeleton';
import { AmountDisplay } from '../components/AmountDisplay';
import { DateDisplay } from '../components/DateDisplay';

import { useWallets, useTransactions, useBudgets, useCategories, useUserProfile } from '../hooks';
import type { TransactionItem } from '../hooks';

import { summarize } from 'shared/domain/report';
import { budgetStatus } from 'shared/domain/budget';
import { toJakartaMonth, daysInMonth } from 'shared/domain/dates';
import type { Txn, Budget } from 'shared/domain/types';

// ---------------------------------------------------------------------------
// Konstanta lokal
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<string, string> = {
  EXPENSE: 'Pengeluaran',
  INCOME: 'Pemasukan',
  TRANSFER_OUT: 'Transfer Keluar',
  TRANSFER_IN: 'Transfer Masuk',
  GOAL_DEPOSIT: 'Setoran Target',
};

const LEVEL_COLOR: Record<string, string> = {
  OK: 'var(--color-income, #1a7a4a)',
  WARN80: 'var(--color-warn, #d97706)',
  OVER100: 'var(--color-expense, #c0392b)',
};

const BULAN_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function formatMonthId(month: string): string {
  const parts = month.split('-');
  const year = Number(parts[0]);
  const m = Number(parts[1]);
  return `${BULAN_ID[m - 1] ?? ''} ${year}`;
}

/** Nama tampilan pengguna: nama depan dari email atau username. */
function displayName(loginId: string | undefined, username: string | undefined): string {
  const raw = loginId ?? username ?? '';
  // Ambil bagian sebelum '@' bila berupa email, lalu kapitalisasi
  const namePart = raw.split('@')[0] ?? raw;
  if (!namePart) return 'Pengguna';
  return namePart.charAt(0).toUpperCase() + namePart.slice(1);
}

/** Konversi TransactionItem → Txn domain murni. */
function toTxn(t: TransactionItem): Txn {
  return {
    id: t.id,
    type: t.type as Txn['type'],
    amount: t.amount ?? 0,
    date: t.date ?? '',
    categoryId: t.categoryId ?? undefined,
    walletId: t.walletId ?? '',
    note: t.note ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Komponen: Baris transaksi tunggal
// ---------------------------------------------------------------------------

interface TxRowProps {
  tx: TransactionItem;
  categoryName: string;
}

function TxRow({ tx, categoryName }: TxRowProps) {
  const isIncome = tx.type === 'INCOME';
  const isExpense = tx.type === 'EXPENSE';
  const amountVariant = isIncome ? 'income' : isExpense ? 'expense' : 'neutral';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 0',
        borderBottom: '1px solid rgba(31,36,48,0.06)',
        gap: 8,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Nama kategori atau jenis */}
        <p
          style={{
            margin: 0,
            fontWeight: 600,
            fontSize: 'var(--font-size-body, 16px)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {categoryName || (tx.type ? (TYPE_LABELS[tx.type] ?? tx.type) : '—')}
        </p>
        {/* Tanggal */}
        <DateDisplay
          date={tx.date ?? ''}
          style={{
            fontSize: 'var(--font-size-caption, 13px)',
            color: 'var(--color-ink-muted, #6b7280)',
          }}
        />
      </div>
      <AmountDisplay
        amount={tx.amount ?? 0}
        variant={amountVariant}
        style={{ fontWeight: 700, fontSize: 'var(--font-size-body, 16px)', flexShrink: 0 }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Komponen: Mini-kartu anggaran
// ---------------------------------------------------------------------------

interface BudgetMiniCardProps {
  budget: Budget;
  categoryName: string;
  txns: Txn[];
}

function BudgetMiniCard({ budget, categoryName, txns }: BudgetMiniCardProps) {
  const status = budgetStatus(budget, txns);
  const { spent, remaining, percent, level } = status;
  const clampedPercent = Math.min(percent, 100);
  const barColor = LEVEL_COLOR[level] ?? LEVEL_COLOR.OK;

  return (
    <SoftCard style={{ marginBottom: 10, padding: 12 }}>
      {/* Nama kategori dan level */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
          gap: 8,
        }}
      >
        <p
          style={{
            margin: 0,
            fontWeight: 600,
            fontSize: 'var(--font-size-body, 16px)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {categoryName}
        </p>
        {level !== 'OK' && (
          <span
            style={{
              fontSize: 'var(--font-size-caption, 13px)',
              color: barColor,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {level === 'WARN80' ? '⚠️ Hampir batas' : '🚨 Melebihi'}
          </span>
        )}
      </div>

      {/* Bar progres */}
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Anggaran ${categoryName}: ${percent}% terpakai`}
        style={{
          width: '100%',
          height: 6,
          background: 'rgba(31,36,48,0.1)',
          borderRadius: 3,
          overflow: 'hidden',
          marginBottom: 8,
        }}
      >
        <div
          style={{
            height: '100%',
            width: '100%',
            transform: `scaleX(${clampedPercent / 100})`,
            transformOrigin: 'left',
            background: barColor,
            borderRadius: 3,
            transition: 'transform 0.35s cubic-bezier(.4,0,.2,1)',
          }}
        />
      </div>

      {/* Baris angka */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          fontSize: 'var(--font-size-caption, 13px)',
          color: 'var(--color-ink-muted, #6b7280)',
          gap: 8,
        }}
      >
        <span>
          Terpakai{' '}
          <AmountDisplay
            amount={spent}
            variant={level === 'OK' ? 'neutral' : 'expense'}
            style={{ fontWeight: 600, fontSize: 'inherit' }}
          />{' '}
          <span style={{ color: barColor, fontWeight: 600 }}>({percent}%)</span>
        </span>
        <span style={{ flexShrink: 0 }}>
          Sisa{' '}
          <AmountDisplay
            amount={remaining}
            variant={remaining < 0 ? 'expense' : 'income'}
            style={{ fontWeight: 600, fontSize: 'inherit' }}
          />
        </span>
      </div>
    </SoftCard>
  );
}

// ---------------------------------------------------------------------------
// Komponen utama
// ---------------------------------------------------------------------------

export function HomePage() {
  const { user } = useAuthenticator((ctx) => [ctx.user]);
  const navigate = useNavigate();

  // Bulan berjalan WIB
  const currentMonth = useMemo(() => toJakartaMonth(new Date()), []);

  // Rentang tanggal penuh bulan berjalan untuk summarize()
  const monthRange = useMemo(() => {
    const days = daysInMonth(currentMonth);
    return {
      from: `${currentMonth}-01`,
      to: `${currentMonth}-${String(days).padStart(2, '0')}`,
    };
  }, [currentMonth]);

  // Data
  const { data: wallets, isPending: walletPending } = useWallets();
  const { data: transactions, isPending: txPending } = useTransactions({ month: currentMonth });
  const { data: budgets, isPending: budgetPending } = useBudgets(currentMonth);
  const { data: categories, isPending: catPending } = useCategories();

  // ---------------------------------------------------------------------------
  // Turunan: Total saldo semua Dompet
  // ---------------------------------------------------------------------------
  const totalBalance = useMemo(
    () => (wallets ?? []).reduce((sum, w) => sum + (w.balance ?? 0), 0),
    [wallets],
  );

  // ---------------------------------------------------------------------------
  // Turunan: Ringkasan bulan berjalan
  // ---------------------------------------------------------------------------
  const domainTxns = useMemo<Txn[]>(
    () => (transactions ?? []).map(toTxn),
    [transactions],
  );

  const summary = useMemo(
    () => summarize(domainTxns, monthRange),
    [domainTxns, monthRange],
  );

  // ---------------------------------------------------------------------------
  // Turunan: 5 transaksi terbaru (sudah terurut descending dari hook)
  // ---------------------------------------------------------------------------
  const latestFive = useMemo(
    () => (transactions ?? []).slice(0, 5),
    [transactions],
  );

  // ---------------------------------------------------------------------------
  // Turunan: Peta categoryId → nama
  // ---------------------------------------------------------------------------
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    (categories ?? []).forEach((c) => map.set(c.id, c.name ?? c.id));
    return map;
  }, [categories]);

  // ---------------------------------------------------------------------------
  // Turunan: 3 anggaran terdekat batas (urutan: percent tertinggi)
  // ---------------------------------------------------------------------------
  const topBudgets = useMemo(() => {
    const budgetList: Budget[] = (budgets ?? []).map((b) => ({
      id: b.id,
      categoryId: b.categoryId ?? '',
      month: b.month ?? '',
      amount: b.amount ?? 0,
    }));
    return budgetList
      .map((b) => ({ budget: b, status: budgetStatus(b, domainTxns) }))
      .sort((a, b) => b.status.percent - a.status.percent)
      .slice(0, 3);
  }, [budgets, domainTxns]);

  const { data: profile } = useUserProfile();

  // ---------------------------------------------------------------------------
  // Nama pengguna
  // ---------------------------------------------------------------------------
  /**
   * Nama tampilan tersimpan diutamakan; bila belum diisi, turunkan dari email
   * seperti sebelumnya agar salam tidak pernah kosong.
   */
  const greetingName = useMemo(
    () =>
      profile?.displayName?.trim() ||
      displayName(user?.signInDetails?.loginId, user?.username),
    [profile?.displayName, user],
  );

  const isLoading = walletPending || txPending || budgetPending || catPending;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div style={{ paddingBottom: 96 }}>
      {/* Judul besar dengan salam — mengecil saat digulir (Req 17.7) */}
      <LargeTitle
        title={`Halo, ${greetingName}`}
        compact="Beranda"
      />

      {/* Sub-judul bulan berjalan */}
      <p
        style={{
          margin: '0 0 16px',
          fontSize: 'var(--font-size-caption, 13px)',
          color: 'var(--color-ink-muted, #6b7280)',
          fontWeight: 500,
        }}
      >
        {formatMonthId(currentMonth)}
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* Kartu: Total Saldo                                                  */}
      {/* ------------------------------------------------------------------ */}
      <SoftCard style={{ marginBottom: 12 }}>
        <p
          style={{
            margin: '0 0 4px',
            fontSize: 'var(--font-size-caption, 13px)',
            color: 'var(--color-ink-muted, #6b7280)',
            fontWeight: 500,
          }}
        >
          Total Saldo
        </p>
        {walletPending ? (
          <Skeleton height={36} width={180} label="Memuat saldo" />
        ) : (
          <AmountDisplay
            amount={totalBalance}
            variant="neutral"
            style={{ fontWeight: 800, fontSize: 28 }}
          />
        )}
        {!walletPending && (wallets?.length ?? 0) > 0 && (
          <p
            style={{
              margin: '6px 0 0',
              fontSize: 'var(--font-size-caption, 13px)',
              color: 'var(--color-ink-muted, #6b7280)',
            }}
          >
            {wallets!.length} dompet
          </p>
        )}
      </SoftCard>

      {/* ------------------------------------------------------------------ */}
      {/* Kartu: Ringkasan Bulan Berjalan                                     */}
      {/* ------------------------------------------------------------------ */}
      <SoftCard style={{ marginBottom: 12 }}>
        <p
          style={{
            margin: '0 0 12px',
            fontWeight: 700,
            fontSize: 'var(--font-size-body, 16px)',
          }}
        >
          Ringkasan Bulan Ini
        </p>
        {txPending ? (
          <Skeleton lines={3} height={18} label="Memuat ringkasan" />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div>
              <p
                style={{
                  margin: '0 0 2px',
                  fontSize: 'var(--font-size-caption, 13px)',
                  color: 'var(--color-ink-muted, #6b7280)',
                  fontWeight: 500,
                }}
              >
                Pemasukan
              </p>
              <AmountDisplay
                amount={summary.income}
                variant="income"
                style={{ fontWeight: 700, fontSize: 'var(--font-size-body, 16px)' }}
              />
            </div>
            <div>
              <p
                style={{
                  margin: '0 0 2px',
                  fontSize: 'var(--font-size-caption, 13px)',
                  color: 'var(--color-ink-muted, #6b7280)',
                  fontWeight: 500,
                }}
              >
                Pengeluaran
              </p>
              <AmountDisplay
                amount={summary.expense}
                variant="expense"
                style={{ fontWeight: 700, fontSize: 'var(--font-size-body, 16px)' }}
              />
            </div>
            <div>
              <p
                style={{
                  margin: '0 0 2px',
                  fontSize: 'var(--font-size-caption, 13px)',
                  color: 'var(--color-ink-muted, #6b7280)',
                  fontWeight: 500,
                }}
              >
                Selisih
              </p>
              <AmountDisplay
                amount={summary.net}
                variant={summary.net >= 0 ? 'income' : 'expense'}
                style={{ fontWeight: 700, fontSize: 'var(--font-size-body, 16px)' }}
              />
            </div>
          </div>
        )}
      </SoftCard>

      {/* ------------------------------------------------------------------ */}
      {/* Kartu: 5 Transaksi Terbaru                                          */}
      {/* ------------------------------------------------------------------ */}
      <SoftCard style={{ marginBottom: 12 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 4,
          }}
        >
          <p style={{ margin: 0, fontWeight: 700, fontSize: 'var(--font-size-body, 16px)' }}>
            Transaksi Terbaru
          </p>
          <button
            type="button"
            onClick={() => navigate('/transaksi')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-brand-blue, #005DAC)',
              fontWeight: 600,
              fontSize: 'var(--font-size-caption, 13px)',
              padding: '4px 0',
              minHeight: 44,
            }}
          >
            Lihat semua
          </button>
        </div>

        {txPending ? (
          <Skeleton lines={5} height={52} label="Memuat transaksi" style={{ gap: 2 }} />
        ) : latestFive.length === 0 ? (
          <p
            style={{
              margin: '12px 0',
              textAlign: 'center',
              color: 'var(--color-ink-muted, #6b7280)',
              fontSize: 'var(--font-size-caption, 13px)',
            }}
          >
            Belum ada transaksi bulan ini.
          </p>
        ) : (
          latestFive.map((tx, idx) => (
            <TxRow
              key={tx.id}
              tx={tx}
              categoryName={
                tx.categoryId ? (categoryMap.get(tx.categoryId) ?? '') : ''
              }
            />
          ))
        )}
      </SoftCard>

      {/* ------------------------------------------------------------------ */}
      {/* Kartu: Progres Anggaran (top 3)                                     */}
      {/* ------------------------------------------------------------------ */}
      <SoftCard style={{ marginBottom: 16 }} noPadding>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 16px 8px',
          }}
        >
          <p style={{ margin: 0, fontWeight: 700, fontSize: 'var(--font-size-body, 16px)' }}>
            Anggaran
          </p>
          <button
            type="button"
            onClick={() => navigate('/anggaran')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-brand-blue, #005DAC)',
              fontWeight: 600,
              fontSize: 'var(--font-size-caption, 13px)',
              padding: '4px 0',
              minHeight: 44,
            }}
          >
            Lihat semua
          </button>
        </div>

        <div style={{ padding: '0 12px 12px' }}>
          {(budgetPending || catPending || txPending) ? (
            <Skeleton lines={3} height={90} label="Memuat anggaran" />
          ) : topBudgets.length === 0 ? (
            <p
              style={{
                margin: '8px 0 4px',
                textAlign: 'center',
                color: 'var(--color-ink-muted, #6b7280)',
                fontSize: 'var(--font-size-caption, 13px)',
              }}
            >
              Belum ada anggaran bulan ini.
            </p>
          ) : (
            topBudgets.map(({ budget }) => (
              <BudgetMiniCard
                key={budget.id}
                budget={budget}
                categoryName={categoryMap.get(budget.categoryId) ?? budget.categoryId}
                txns={domainTxns}
              />
            ))
          )}
        </div>
      </SoftCard>

    </div>
  );
}

export default HomePage;
