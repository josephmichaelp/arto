/**
 * BudgetPage — Halaman Anggaran (Tugas 12.6).
 *
 * Menampilkan Anggaran bulan berjalan beserta bar progres realisasi,
 * sisa, persen terpakai, dan tombol salin dari bulan lalu. Setiap
 * Anggaran dapat ditambah atau diubah nominalnya lewat BottomSheet.
 *
 * Design System: LargeTitle, SoftCard, Skeleton, EmptyState,
 * AmountDisplay, BottomSheet.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.6, 15.7, 17.3, 17.9, 17.10, 17.14
 */

import React, { useState, useMemo } from 'react';
import { LargeTitle } from '../components/LargeTitle';
import { SoftCard } from '../components/SoftCard';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { AmountDisplay } from '../components/AmountDisplay';
import { BottomSheet } from '../components/BottomSheet';
import {
  useBudgets,
  useCategories,
  useTransactions,
  useUpsertBudget,
  useCopyBudgetsFromPreviousMonth,
} from '../hooks';
import type { BudgetItem, CategoryItem } from '../hooks';
import { budgetStatus } from 'shared/domain/budget';
import { toJakartaMonth } from 'shared/domain/dates';
import type { Budget, Txn } from 'shared/domain/types';

// ---------------------------------------------------------------------------
// Helper: bulan sebelumnya
// ---------------------------------------------------------------------------

function getPreviousMonth(month: string): string {
  const parts = month.split('-');
  const year = Number(parts[0]);
  const m = Number(parts[1]);
  if (m === 1) return `${year - 1}-12`;
  return `${year}-${String(m - 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Helper: nama bulan Indonesia
// ---------------------------------------------------------------------------

const BULAN_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function formatMonthId(month: string): string {
  const parts = month.split('-');
  const year = Number(parts[0]);
  const m = Number(parts[1]);
  return `${BULAN_ID[m - 1]} ${year}`;
}

// ---------------------------------------------------------------------------
// Warna level
// ---------------------------------------------------------------------------

const LEVEL_COLOR: Record<string, string> = {
  OK: 'var(--color-income, #1a7a4a)',
  WARN80: 'var(--color-warn, #d97706)',
  OVER100: 'var(--color-expense, #c0392b)',
};

const LEVEL_BG: Record<string, string> = {
  OK: 'rgba(26, 122, 74, 0.12)',
  WARN80: 'rgba(217, 119, 6, 0.12)',
  OVER100: 'rgba(192, 57, 43, 0.12)',
};

// ---------------------------------------------------------------------------
// Komponen: satu kartu anggaran
// ---------------------------------------------------------------------------

interface BudgetCardProps {
  budget: BudgetItem;
  categoryName: string;
  transactions: Txn[];
  onEdit: (b: BudgetItem) => void;
}

function BudgetCard({ budget, categoryName, transactions, onEdit }: BudgetCardProps) {
  // Cast BudgetItem ke Budget domain agar budgetStatus dapat menghitungnya
  const domainBudget: Budget = {
    id: budget.id,
    categoryId: budget.categoryId ?? '',
    month: budget.month ?? '',
    amount: budget.amount ?? 0,
  };

  const status = budgetStatus(domainBudget, transactions);
  const { spent, remaining, percent, level } = status;
  const clampedPercent = Math.min(percent, 100);
  const barColor = LEVEL_COLOR[level] ?? LEVEL_COLOR.OK;
  const badgeBg = LEVEL_BG[level] ?? LEVEL_BG.OK;
  const amount = budget.amount ?? 0;

  return (
    <SoftCard style={{ marginBottom: 12 }}>
      {/* Baris judul dan tombol ubah */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 8,
          gap: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
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
            {categoryName}
          </p>
          {/* Lencana level (teks, bukan hanya warna) */}
          {level !== 'OK' && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                marginTop: 4,
                padding: '2px 8px',
                borderRadius: 99,
                background: badgeBg,
                color: barColor,
                fontSize: 'var(--font-size-caption, 13px)',
                fontWeight: 600,
              }}
            >
              {level === 'WARN80' ? '⚠️ Mendekati batas' : '🚨 Melebihi batas'}
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label={`Ubah anggaran ${categoryName}`}
          onClick={() => onEdit(budget)}
          style={{
            minWidth: 44,
            minHeight: 44,
            flexShrink: 0,
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            fontSize: 18,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--radius-card, 20px)',
          }}
        >
          ✏️
        </button>
      </div>

      {/* Bar progres */}
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Realisasi anggaran ${categoryName}: ${percent}%`}
        style={{
          width: '100%',
          height: 8,
          background: 'rgba(31, 36, 48, 0.1)',
          borderRadius: 4,
          overflow: 'hidden',
          marginBottom: 10,
        }}
      >
        <div
          style={{
            height: '100%',
            width: '100%',
            transform: `scaleX(${clampedPercent / 100})`,
            transformOrigin: 'left',
            background: barColor,
            borderRadius: 4,
            transition: 'transform 0.35s cubic-bezier(.4,0,.2,1)',
          }}
        />
      </div>

      {/* Baris angka: terpakai / anggaran dan sisa */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
        }}
      >
        <div style={{ fontSize: 'var(--font-size-caption, 13px)', color: 'var(--color-ink-muted, #6b7280)' }}>
          Terpakai{' '}
          <AmountDisplay
            amount={spent}
            variant={level === 'OK' ? 'neutral' : 'expense'}
            style={{ fontWeight: 600, fontSize: 'inherit' }}
          />
          {' '}dari{' '}
          <AmountDisplay
            amount={amount}
            variant="neutral"
            style={{ fontWeight: 600, fontSize: 'inherit' }}
          />
          {' '}
          <span style={{ color: barColor, fontWeight: 600 }}>({percent}%)</span>
        </div>
        <div
          style={{
            fontSize: 'var(--font-size-caption, 13px)',
            textAlign: 'right',
            flexShrink: 0,
          }}
        >
          <span style={{ color: 'var(--color-ink-muted, #6b7280)' }}>Sisa </span>
          <AmountDisplay
            amount={remaining}
            variant={remaining < 0 ? 'expense' : 'income'}
            style={{ fontWeight: 600, fontSize: 'inherit' }}
          />
        </div>
      </div>
    </SoftCard>
  );
}

// ---------------------------------------------------------------------------
// Komponen utama
// ---------------------------------------------------------------------------

export function BudgetPage() {
  const currentMonth = useMemo(() => toJakartaMonth(new Date()), []);
  const prevMonth = useMemo(() => getPreviousMonth(currentMonth), [currentMonth]);

  const { data: budgets, isPending: budgetPending, error: budgetError } = useBudgets(currentMonth);
  const { data: categories, isPending: catPending } = useCategories();
  const { data: transactions, isPending: txPending } = useTransactions({ month: currentMonth });

  const upsertBudget = useUpsertBudget();
  const copyBudgets = useCopyBudgetsFromPreviousMonth();

  // BottomSheet state: 'upsert' (tambah/ubah) atau null
  type ActiveSheet = { type: 'upsert'; budget?: BudgetItem } | null;
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);

  // Form state — upsert
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [opError, setOpError] = useState<string | null>(null);

  const isPending = budgetPending || catPending || txPending;

  // Cast transaksi ke Txn[] domain
  const domainTxns: Txn[] = useMemo(
    () =>
      (transactions ?? []).map((t) => ({
        id: t.id,
        type: t.type as Txn['type'],
        amount: t.amount ?? 0,
        date: t.date ?? '',
        categoryId: t.categoryId ?? undefined,
        walletId: t.walletId ?? '',
        note: t.note ?? undefined,
      })),
    [transactions],
  );

  // Peta categoryId → nama
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    (categories ?? []).forEach((c) => map.set(c.id, c.name ?? c.id));
    return map;
  }, [categories]);

  // Kategori EXPENSE yang belum memiliki anggaran bulan ini (untuk tambah baru)
  const budgetedCategoryIds = useMemo(
    () => new Set((budgets ?? []).map((b) => b.categoryId)),
    [budgets],
  );
  const expenseCategories: CategoryItem[] = useMemo(
    () => (categories ?? []).filter((c) => c.type === 'EXPENSE'),
    [categories],
  );

  // -------------------------------------------------------------------------
  // Buka / tutup sheet
  // -------------------------------------------------------------------------

  const closeSheet = () => {
    setActiveSheet(null);
    setOpError(null);
    setFormCategoryId('');
    setFormAmount('');
  };

  const openAdd = () => {
    setFormCategoryId('');
    setFormAmount('');
    setOpError(null);
    setActiveSheet({ type: 'upsert' });
  };

  const openEdit = (budget: BudgetItem) => {
    setFormCategoryId(budget.categoryId ?? '');
    setFormAmount(String(budget.amount ?? ''));
    setOpError(null);
    setActiveSheet({ type: 'upsert', budget });
  };

  // -------------------------------------------------------------------------
  // Aksi submit
  // -------------------------------------------------------------------------

  const handleUpsert = async () => {
    const categoryId = activeSheet?.type === 'upsert' && activeSheet.budget
      ? activeSheet.budget.categoryId
      : formCategoryId;

    if (!categoryId) {
      setOpError('Pilih kategori terlebih dahulu.');
      return;
    }
    const amount = parseInt(formAmount, 10);
    if (isNaN(amount) || amount <= 0) {
      setOpError('Nominal harus bilangan bulat lebih dari 0.');
      return;
    }
    setOpError(null);
    try {
      await upsertBudget.mutateAsync({ categoryId, month: currentMonth, amount });
      closeSheet();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Gagal menyimpan anggaran.');
    }
  };

  const handleCopyFromPrev = async () => {
    setOpError(null);
    try {
      await copyBudgets.mutateAsync({ month: currentMonth });
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Gagal menyalin anggaran.');
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const isEditing = activeSheet?.type === 'upsert' && !!activeSheet.budget;
  const sheetTitle = isEditing ? 'Ubah Anggaran' : 'Tambah Anggaran';

  // Saat edit, gunakan categoryId dari budget (readonly); saat tambah, pilih dari select
  const editingBudget = activeSheet?.type === 'upsert' ? activeSheet.budget : undefined;
  const editingCategoryName = editingBudget
    ? (categoryMap.get(editingBudget.categoryId ?? '') ?? editingBudget.categoryId ?? '—')
    : null;

  // Pilihan kategori untuk tambah (hanya yang belum ada anggaran)
  const addableCategories = expenseCategories.filter(
    (c) => !budgetedCategoryIds.has(c.id),
  );

  return (
    <div style={{ paddingBottom: 96 }}>
      {/* Judul halaman */}
      <LargeTitle title="Anggaran" />

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

      {/* Tombol-tombol aksi */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          onClick={openAdd}
          style={{
            flex: 1,
            minHeight: 44,
            padding: '10px 16px',
            border: '2px dashed var(--color-brand-blue, #005DAC)',
            borderRadius: 'var(--radius-card, 20px)',
            background: 'none',
            color: 'var(--color-brand-blue, #005DAC)',
            fontWeight: 600,
            fontSize: 'var(--font-size-body, 16px)',
            cursor: 'pointer',
          }}
        >
          + Tambah Anggaran
        </button>
        <button
          type="button"
          onClick={() => void handleCopyFromPrev()}
          disabled={copyBudgets.isPending}
          title={`Salin anggaran dari ${formatMonthId(prevMonth)}`}
          aria-label={`Salin anggaran dari ${formatMonthId(prevMonth)}`}
          style={{
            minWidth: 44,
            minHeight: 44,
            padding: '10px 12px',
            border: '1.5px solid rgba(31,36,48,0.2)',
            borderRadius: 'var(--radius-card, 20px)',
            background: 'var(--color-card, #fff)',
            color: 'var(--color-ink, #1f2430)',
            fontWeight: 600,
            fontSize: 'var(--font-size-body, 16px)',
            cursor: copyBudgets.isPending ? 'not-allowed' : 'pointer',
            opacity: copyBudgets.isPending ? 0.6 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {copyBudgets.isPending ? 'Menyalin…' : '📋 Salin Bulan Lalu'}
        </button>
      </div>

      {/* Galat umum */}
      {opError && !activeSheet && (
        <SoftCard style={{ marginBottom: 12, color: 'var(--color-expense, #c0392b)' }}>
          {opError}
        </SoftCard>
      )}

      {/* Galat muat */}
      {budgetError && (
        <SoftCard style={{ marginBottom: 12, color: 'var(--color-expense, #c0392b)' }}>
          {budgetError.message}
        </SoftCard>
      )}

      {/* Keadaan memuat */}
      {isPending && (
        <>
          <Skeleton height={110} style={{ marginBottom: 12 }} />
          <Skeleton height={110} style={{ marginBottom: 12 }} />
          <Skeleton height={110} />
        </>
      )}

      {/* Keadaan kosong */}
      {!isPending && !budgetError && (budgets?.length ?? 0) === 0 && (
        <EmptyState
          icon="📊"
          title="Belum ada anggaran"
          description="Tambahkan anggaran untuk memantau pengeluaran bulanan Anda."
        />
      )}

      {/* Daftar anggaran */}
      {!isPending &&
        (budgets ?? []).map((budget) => (
          <BudgetCard
            key={budget.id}
            budget={budget}
            categoryName={categoryMap.get(budget.categoryId ?? '') ?? budget.categoryId ?? '—'}
            transactions={domainTxns}
            onEdit={openEdit}
          />
        ))}

      {/* BottomSheet: Tambah / Ubah Anggaran */}
      <BottomSheet
        open={activeSheet?.type === 'upsert'}
        onClose={closeSheet}
        title={sheetTitle}
        sheetKey="upsert-anggaran"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Saat ubah: tampilkan nama kategori (readonly) */}
          {isEditing && editingCategoryName ? (
            <div>
              <p
                style={{
                  margin: '0 0 4px',
                  fontSize: 'var(--font-size-caption, 13px)',
                  fontWeight: 600,
                  color: 'var(--color-ink, #1f2430)',
                }}
              >
                Kategori
              </p>
              <p
                style={{
                  margin: 0,
                  fontWeight: 500,
                  fontSize: 'var(--font-size-body, 16px)',
                  padding: '10px 12px',
                  border: '1.5px solid rgba(31, 36, 48, 0.12)',
                  borderRadius: 12,
                  background: 'rgba(31, 36, 48, 0.04)',
                  color: 'var(--color-ink, #1f2430)',
                }}
              >
                {editingCategoryName}
              </p>
            </div>
          ) : (
            /* Saat tambah: pilih kategori dari daftar */
            <FormField label="Kategori" htmlFor="budget-category">
              <select
                id="budget-category"
                value={formCategoryId}
                onChange={(e) => setFormCategoryId(e.target.value)}
                style={inputStyle}
              >
                <option value="">— Pilih kategori pengeluaran —</option>
                {addableCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                {addableCategories.length === 0 && (
                  <option value="" disabled>
                    Semua kategori sudah memiliki anggaran
                  </option>
                )}
              </select>
            </FormField>
          )}

          <FormField label="Nominal Anggaran (Rp)" htmlFor="budget-amount">
            <input
              id="budget-amount"
              type="text"
              inputMode="numeric"
              value={formAmount}
              onChange={(e) => setFormAmount(e.target.value.replace(/\D/g, ''))}
              placeholder="Contoh: 500000"
              style={inputStyle}
            />
          </FormField>

          {opError && <ErrorMessage>{opError}</ErrorMessage>}

          <SubmitButton
            onClick={() => void handleUpsert()}
            loading={upsertBudget.isPending}
          >
            Simpan Anggaran
          </SubmitButton>
        </div>
      </BottomSheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Komponen pembantu formulir
// ---------------------------------------------------------------------------

function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label
        htmlFor={htmlFor}
        style={{
          fontSize: 'var(--font-size-caption, 13px)',
          fontWeight: 600,
          color: 'var(--color-ink, #1f2430)',
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function ErrorMessage({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      style={{
        margin: 0,
        padding: '8px 12px',
        borderRadius: 8,
        background: 'rgba(192, 57, 43, 0.08)',
        color: 'var(--color-expense, #c0392b)',
        fontSize: 'var(--font-size-caption, 13px)',
      }}
    >
      {children}
    </p>
  );
}

function SubmitButton({
  onClick,
  loading,
  children,
}: {
  onClick: () => void;
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      style={{
        minHeight: 44,
        padding: '10px 16px',
        border: 'none',
        borderRadius: 'var(--radius-card, 20px)',
        background: 'var(--color-brand-blue, #005DAC)',
        color: '#ffffff',
        fontWeight: 600,
        fontSize: 'var(--font-size-body, 16px)',
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.6 : 1,
      }}
    >
      {loading ? 'Memproses…' : children}
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  minHeight: 44,
  padding: '10px 12px',
  border: '1.5px solid rgba(31, 36, 48, 0.2)',
  borderRadius: 12,
  fontSize: 'var(--font-size-body, 16px)',
  background: 'var(--color-card, #ffffff)',
  color: 'var(--color-ink, #1f2430)',
  outline: 'none',
};

export default BudgetPage;
