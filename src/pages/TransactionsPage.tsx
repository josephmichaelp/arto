/**
 * TransactionsPage — Halaman Transaksi (Tugas 12.5).
 *
 * Menampilkan daftar Transaksi Pengguna terurut dari tanggal terbaru,
 * dikelompokkan per hari pada SoftCard, dengan pemuatan bertahap 20 item
 * per halaman. Mendukung filter (kata kunci, jenis, kategori, dompet,
 * rentang tanggal) dan aksi tambah / ubah / hapus lewat BottomSheet.
 *
 * Design System: LargeTitle, SoftCard, Skeleton, EmptyState, AmountDisplay,
 * DateDisplay, BottomSheet, QuickAddFab.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 15.7, 17.1, 17.2, 17.3,
 *               17.4, 17.9, 17.10
 */

import { useEffect, useRef, useState } from 'react';
import { LargeTitle } from '../components/LargeTitle';
import { SoftCard } from '../components/SoftCard';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { AmountDisplay } from '../components/AmountDisplay';
import { DateDisplay } from '../components/DateDisplay';
import { BottomSheet } from '../components/BottomSheet';
import { QuickAddFab } from '../components/QuickAddFab';
import {
  useTransactionPage,
  useCategories,
  useWallets,
  useSaveTransaction,
  useDeleteTransaction,
} from '../hooks';
import type { TransactionItem, TransactionFilter } from '../hooks';

// ---------------------------------------------------------------------------
// Konstanta
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<string, string> = {
  EXPENSE: 'Pengeluaran',
  INCOME: 'Pemasukan',
  TRANSFER_OUT: 'Transfer Keluar',
  TRANSFER_IN: 'Transfer Masuk',
};

// Tanggal hari ini dalam format YYYY-MM-DD (WIB +7).
function todayWib(): string {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Tipe state lokal
// ---------------------------------------------------------------------------

type ActiveSheet =
  | { type: 'tambah' }
  | { type: 'ubah'; tx: TransactionItem }
  | { type: 'hapus'; tx: TransactionItem }
  | { type: 'filter' };

// ---------------------------------------------------------------------------
// Komponen pembantu: tombol aksi kecil
// ---------------------------------------------------------------------------

function ActionButton({
  onClick,
  label,
  icon,
}: {
  onClick: () => void;
  label: string;
  icon: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        minWidth: 44,
        minHeight: 44,
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
      {icon}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Komponen pembantu: baris satu Transaksi
// ---------------------------------------------------------------------------

interface TxRowProps {
  tx: TransactionItem;
  categoryName: string | undefined;
  walletName: string | undefined;
  onEdit: (tx: TransactionItem) => void;
  onDelete: (tx: TransactionItem) => void;
}

function TxRow({ tx, categoryName, walletName, onEdit, onDelete }: TxRowProps) {
  const isIncome = tx.type === 'INCOME' || tx.type === 'TRANSFER_IN';
  const variant = isIncome ? 'income' : 'expense';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 0',
        borderBottom: '1px solid var(--color-border, rgba(0,0,0,0.06))',
      }}
    >
      {/* Info transaksi */}
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
          {categoryName ?? TYPE_LABELS[tx.type ?? ''] ?? tx.type ?? '—'}
        </p>
        <p
          style={{
            margin: '2px 0 0',
            fontSize: 'var(--font-size-caption, 13px)',
            color: 'var(--color-ink-muted, #6b7280)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {walletName ?? '—'}
          {tx.note ? ` · ${tx.note}` : ''}
        </p>
        <p
          style={{
            margin: '1px 0 0',
            fontSize: 'var(--font-size-caption, 12px)',
            color: 'var(--color-ink-muted, #6b7280)',
          }}
        >
          {TYPE_LABELS[tx.type ?? ''] ?? tx.type ?? '—'}
        </p>
      </div>

      {/* Nominal */}
      <AmountDisplay
        amount={tx.amount ?? 0}
        variant={variant}
        style={{ fontWeight: 700, fontSize: 'var(--font-size-body, 16px)', flexShrink: 0 }}
      />

      {/* Aksi — hanya untuk EXPENSE dan INCOME (manual) */}
      {(tx.type === 'EXPENSE' || tx.type === 'INCOME') && (
        <div style={{ display: 'flex', gap: 0, flexShrink: 0 }}>
          <ActionButton onClick={() => onEdit(tx)} label="Ubah transaksi" icon="✏️" />
          <ActionButton onClick={() => onDelete(tx)} label="Hapus transaksi" icon="🗑" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Komponen pembantu: label field formulir
// ---------------------------------------------------------------------------

function FormField({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label
        htmlFor={id}
        style={{
          display: 'block',
          marginBottom: 6,
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
        margin: '4px 0 0',
        fontSize: 'var(--font-size-caption, 13px)',
        color: 'var(--color-expense, #c0392b)',
      }}
    >
      {children}
    </p>
  );
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  border: '1.5px solid var(--color-border, rgba(0,0,0,0.15))',
  borderRadius: 12,
  fontSize: 'var(--font-size-body, 16px)',
  background: 'var(--color-card, #fff)',
  color: 'var(--color-ink, #1f2430)',
  minHeight: 44,
};

function SubmitButton({
  onClick,
  loading,
  label,
}: {
  onClick: () => void;
  loading: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      style={{
        width: '100%',
        minHeight: 48,
        padding: '12px 16px',
        background: 'var(--color-brand-blue, #005DAC)',
        color: '#fff',
        border: 'none',
        borderRadius: 'var(--radius-card, 20px)',
        fontWeight: 700,
        fontSize: 'var(--font-size-body, 16px)',
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.7 : 1,
        marginTop: 8,
      }}
    >
      {loading ? 'Menyimpan…' : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Komponen utama
// ---------------------------------------------------------------------------

export function TransactionsPage() {
  // Data hooks
  const { data: categories } = useCategories();
  const { data: wallets } = useWallets();

  const saveTx = useSaveTransaction();
  const deleteTx = useDeleteTransaction();

  // Filter state
  const [filter, setFilter] = useState<TransactionFilter>({});
  const [draftFilter, setDraftFilter] = useState<TransactionFilter>({});

  // Paginasi
  const txPage = useTransactionPage(filter, 20);

  // Sheet state
  const [activeSheet, setActiveSheet] = useState<ActiveSheet | null>(null);

  // Form state — tambah/ubah
  const [formType, setFormType] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  const [formAmount, setFormAmount] = useState('');
  const [formDate, setFormDate] = useState(todayWib());
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formWalletId, setFormWalletId] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Sentinel untuk infinite scroll
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Muat halaman pertama saat komponen mount atau filter berubah
  useEffect(() => {
    void txPage.loadFirst();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Intersection Observer untuk memuat lebih banyak saat sentinel terlihat
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && txPage.hasMore && !txPage.isFetching) {
          void txPage.loadMore();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txPage.hasMore, txPage.isFetching]);

  // ---------------------------------------------------------------------------
  // Helper lookup
  // ---------------------------------------------------------------------------

  const categoryMap = new Map((categories ?? []).map((c) => [c.id, c]));
  const walletMap = new Map((wallets ?? []).map((w) => [w.id, w]));

  // Kategori yang cocok dengan jenis transaksi di formulir
  const filteredCategories = (categories ?? []).filter((c) => c.type === formType);

  // ---------------------------------------------------------------------------
  // Buka sheet
  // ---------------------------------------------------------------------------

  const resetForm = () => {
    setFormType('EXPENSE');
    setFormAmount('');
    setFormDate(todayWib());
    setFormCategoryId('');
    setFormWalletId('');
    setFormNote('');
    setFormError(null);
  };

  const closeSheet = () => {
    setActiveSheet(null);
    resetForm();
  };

  const openAdd = () => {
    resetForm();
    setActiveSheet({ type: 'tambah' });
  };

  const openEdit = (tx: TransactionItem) => {
    setFormType(tx.type === 'INCOME' ? 'INCOME' : 'EXPENSE');
    setFormAmount(String(tx.amount ?? 0));
    setFormDate(tx.date ?? todayWib());
    setFormCategoryId(tx.categoryId ?? '');
    setFormWalletId(tx.walletId ?? '');
    setFormNote(tx.note ?? '');
    setFormError(null);
    setActiveSheet({ type: 'ubah', tx });
  };

  const openDelete = (tx: TransactionItem) => {
    setFormError(null);
    setActiveSheet({ type: 'hapus', tx });
  };

  const openFilter = () => {
    setDraftFilter({ ...filter });
    setActiveSheet({ type: 'filter' });
  };

  // ---------------------------------------------------------------------------
  // Submit aksi
  // ---------------------------------------------------------------------------

  const validateForm = (): boolean => {
    const amount = parseInt(formAmount, 10);
    if (!formAmount || isNaN(amount) || amount <= 0) {
      setFormError('Nominal harus berupa angka bulat lebih dari 0.');
      return false;
    }
    if (!formDate || !/^\d{4}-\d{2}-\d{2}$/.test(formDate)) {
      setFormError('Tanggal tidak valid. Gunakan format YYYY-MM-DD.');
      return false;
    }
    if (!formWalletId) {
      setFormError('Pilih dompet.');
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!validateForm()) return;
    const amount = parseInt(formAmount, 10);
    const month = formDate.slice(0, 7); // YYYY-MM

    const payload: Record<string, unknown> = {
      type: formType,
      amount,
      date: formDate,
      month,
      walletId: formWalletId,
      ...(formCategoryId ? { categoryId: formCategoryId } : {}),
      ...(formNote.trim() ? { note: formNote.trim() } : {}),
    };

    if (activeSheet?.type === 'ubah') {
      payload.id = activeSheet.tx.id;
    }

    setFormError(null);
    try {
      await saveTx.mutateAsync(payload);
      closeSheet();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Gagal menyimpan transaksi.');
    }
  };

  const handleDelete = async () => {
    if (activeSheet?.type !== 'hapus') return;
    setFormError(null);
    try {
      await deleteTx.mutateAsync({ id: activeSheet.tx.id });
      closeSheet();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Gagal menghapus transaksi.');
    }
  };

  const handleApplyFilter = () => {
    setFilter({ ...draftFilter });
    closeSheet();
  };

  const handleResetFilter = () => {
    setDraftFilter({});
    setFilter({});
    closeSheet();
  };

  // ---------------------------------------------------------------------------
  // Pengelompokan transaksi per hari
  // ---------------------------------------------------------------------------

  const groupedByDate = new Map<string, TransactionItem[]>();
  for (const tx of txPage.data) {
    const date = tx.date ?? '';
    if (!groupedByDate.has(date)) groupedByDate.set(date, []);
    groupedByDate.get(date)!.push(tx);
  }
  const sortedDates = Array.from(groupedByDate.keys()).sort((a, b) => b.localeCompare(a));

  // Hitung jumlah filter aktif
  const activeFilterCount = Object.values(filter).filter(
    (v) => v !== undefined && v !== '',
  ).length;

  const isLoading = txPage.isLoading || txPage.isFetching;
  const sheetOpen = activeSheet !== null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={{ paddingBottom: 120 }}>
      {/* Judul halaman */}
      <LargeTitle title="Transaksi" />

      {/* Bilah kontrol filter */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 16,
        }}
      >
        <button
          type="button"
          onClick={openFilter}
          style={{
            flex: 1,
            minHeight: 44,
            padding: '10px 16px',
            border: '1.5px solid var(--color-brand-blue, #005DAC)',
            borderRadius: 'var(--radius-card, 20px)',
            background: activeFilterCount > 0 ? 'var(--color-brand-blue, #005DAC)' : 'none',
            color: activeFilterCount > 0 ? '#fff' : 'var(--color-brand-blue, #005DAC)',
            fontWeight: 600,
            fontSize: 'var(--font-size-body, 16px)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <span>Filter</span>
          {activeFilterCount > 0 && (
            <span
              style={{
                background: 'rgba(255,255,255,0.3)',
                borderRadius: 999,
                padding: '0 6px',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {activeFilterCount}
            </span>
          )}
        </button>

        {activeFilterCount > 0 && (
          <button
            type="button"
            aria-label="Hapus semua filter"
            onClick={() => setFilter({})}
            style={{
              minWidth: 44,
              minHeight: 44,
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: 20,
              color: 'var(--color-ink-muted, #6b7280)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 12,
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Daftar transaksi */}
      {isLoading && txPage.data.length === 0 ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <SoftCard key={i}>
              <Skeleton height={20} width="40%" style={{ marginBottom: 12 }} />
              <Skeleton height={56} />
              <Skeleton height={56} style={{ marginTop: 8 }} />
            </SoftCard>
          ))}
        </div>
      ) : sortedDates.length === 0 ? (
        <EmptyState
          icon="💸"
          title="Belum ada transaksi"
          description={
            activeFilterCount > 0
              ? 'Tidak ada transaksi yang cocok dengan filter yang dipilih.'
              : 'Ketuk tombol + untuk mencatat transaksi pertama Anda.'
          }
        />
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {sortedDates.map((date) => {
            const txs = groupedByDate.get(date) ?? [];
            return (
              <SoftCard key={date} noPadding>
                {/* Header tanggal */}
                <div
                  style={{
                    padding: '12px 16px 4px',
                    borderBottom: '1px solid var(--color-border, rgba(0,0,0,0.06))',
                  }}
                >
                  <DateDisplay
                    date={date}
                    style={{
                      fontSize: 'var(--font-size-caption, 13px)',
                      fontWeight: 700,
                      color: 'var(--color-ink-muted, #6b7280)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  />
                </div>

                {/* Baris transaksi */}
                <div style={{ padding: '0 16px' }}>
                  {txs.map((tx, idx) => (
                    <div
                      key={tx.id}
                      style={idx === txs.length - 1 ? { borderBottom: 'none' } : undefined}
                    >
                      <TxRow
                        tx={tx}
                        categoryName={
                          tx.categoryId ? categoryMap.get(tx.categoryId)?.name : undefined
                        }
                        walletName={tx.walletId ? walletMap.get(tx.walletId)?.name : undefined}
                        onEdit={openEdit}
                        onDelete={openDelete}
                      />
                    </div>
                  ))}
                </div>
              </SoftCard>
            );
          })}

          {/* Sentinel: memicu loadMore lewat IntersectionObserver */}
          <div ref={sentinelRef} aria-hidden="true" />

          {/* Indikator memuat lebih */}
          {txPage.isFetching && txPage.data.length > 0 && (
            <SoftCard>
              <Skeleton height={56} lines={2} />
            </SoftCard>
          )}

          {!txPage.hasMore && txPage.data.length > 0 && (
            <p
              style={{
                textAlign: 'center',
                fontSize: 'var(--font-size-caption, 13px)',
                color: 'var(--color-ink-muted, #6b7280)',
                padding: '8px 0',
              }}
            >
              Semua transaksi sudah dimuat.
            </p>
          )}
        </div>
      )}

      {/* FAB Tambah Transaksi */}
      <QuickAddFab onActivate={openAdd} sheetOpen={sheetOpen} />

      {/* ===== BottomSheet: Tambah / Ubah Transaksi ===== */}
      <BottomSheet
        open={activeSheet?.type === 'tambah' || activeSheet?.type === 'ubah'}
        onClose={closeSheet}
        title={activeSheet?.type === 'ubah' ? 'Ubah Transaksi' : 'Tambah Transaksi'}
        sheetKey="tx-form"
      >
        <FormField id="tx-type" label="Jenis">
          <select
            id="tx-type"
            value={formType}
            onChange={(e) => {
              setFormType(e.target.value as 'EXPENSE' | 'INCOME');
              setFormCategoryId(''); // reset kategori saat jenis berubah
            }}
            style={INPUT_STYLE}
          >
            <option value="EXPENSE">Pengeluaran</option>
            <option value="INCOME">Pemasukan</option>
          </select>
        </FormField>

        <FormField id="tx-amount" label="Nominal (Rp)">
          <input
            id="tx-amount"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Contoh: 50000"
            value={formAmount}
            onChange={(e) => setFormAmount(e.target.value.replace(/\D/g, ''))}
            style={INPUT_STYLE}
          />
        </FormField>

        <FormField id="tx-date" label="Tanggal (YYYY-MM-DD)">
          <input
            id="tx-date"
            type="date"
            value={formDate}
            onChange={(e) => setFormDate(e.target.value)}
            style={INPUT_STYLE}
          />
        </FormField>

        <FormField id="tx-category" label="Kategori">
          <select
            id="tx-category"
            value={formCategoryId}
            onChange={(e) => setFormCategoryId(e.target.value)}
            style={INPUT_STYLE}
          >
            <option value="">— Tanpa kategori —</option>
            {filteredCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField id="tx-wallet" label="Dompet">
          <select
            id="tx-wallet"
            value={formWalletId}
            onChange={(e) => setFormWalletId(e.target.value)}
            style={INPUT_STYLE}
          >
            <option value="">— Pilih dompet —</option>
            {(wallets ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField id="tx-note" label="Catatan (opsional)">
          <textarea
            id="tx-note"
            value={formNote}
            onChange={(e) => setFormNote(e.target.value)}
            placeholder="Tambahkan catatan..."
            rows={2}
            style={{ ...INPUT_STYLE, resize: 'vertical' }}
          />
        </FormField>

        {formError && <ErrorMessage>{formError}</ErrorMessage>}

        <SubmitButton
          onClick={() => void handleSave()}
          loading={saveTx.isPending}
          label={activeSheet?.type === 'ubah' ? 'Simpan Perubahan' : 'Simpan Transaksi'}
        />
      </BottomSheet>

      {/* ===== BottomSheet: Konfirmasi Hapus ===== */}
      <BottomSheet
        open={activeSheet?.type === 'hapus'}
        onClose={closeSheet}
        title="Hapus Transaksi"
        sheetKey="tx-delete"
      >
        {activeSheet?.type === 'hapus' && (
          <div>
            <p
              style={{
                margin: '0 0 8px',
                fontSize: 'var(--font-size-body, 16px)',
                color: 'var(--color-ink, #1f2430)',
              }}
            >
              Hapus transaksi berikut?
            </p>
            <SoftCard style={{ marginBottom: 16 }}>
              <p style={{ margin: '0 0 4px', fontWeight: 600 }}>
                {activeSheet.tx.categoryId
                  ? (categoryMap.get(activeSheet.tx.categoryId)?.name ?? '—')
                  : (TYPE_LABELS[activeSheet.tx.type ?? ''] ?? '—')}
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: 'var(--font-size-caption, 13px)',
                  color: 'var(--color-ink-muted, #6b7280)',
                }}
              >
                {activeSheet.tx.date} ·{' '}
                {walletMap.get(activeSheet.tx.walletId ?? '')?.name ?? '—'}
              </p>
              <AmountDisplay
                amount={activeSheet.tx.amount ?? 0}
                variant={
                  activeSheet.tx.type === 'INCOME' || activeSheet.tx.type === 'TRANSFER_IN'
                    ? 'income'
                    : 'expense'
                }
                style={{ fontWeight: 700, display: 'block', marginTop: 4 }}
              />
            </SoftCard>

            <p
              style={{
                margin: '0 0 16px',
                fontSize: 'var(--font-size-caption, 13px)',
                color: 'var(--color-ink-muted, #6b7280)',
              }}
            >
              Saldo dompet akan dikembalikan. Tindakan ini tidak dapat dibatalkan.
            </p>

            {formError && <ErrorMessage>{formError}</ErrorMessage>}

            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleteTx.isPending}
              style={{
                width: '100%',
                minHeight: 48,
                padding: '12px 16px',
                background: 'var(--color-expense, #c0392b)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-card, 20px)',
                fontWeight: 700,
                fontSize: 'var(--font-size-body, 16px)',
                cursor: deleteTx.isPending ? 'not-allowed' : 'pointer',
                opacity: deleteTx.isPending ? 0.7 : 1,
                marginBottom: 8,
              }}
            >
              {deleteTx.isPending ? 'Menghapus…' : 'Ya, Hapus Transaksi'}
            </button>

            <button
              type="button"
              onClick={closeSheet}
              style={{
                width: '100%',
                minHeight: 48,
                padding: '12px 16px',
                background: 'none',
                color: 'var(--color-ink, #1f2430)',
                border: '1.5px solid var(--color-border, rgba(0,0,0,0.15))',
                borderRadius: 'var(--radius-card, 20px)',
                fontWeight: 600,
                fontSize: 'var(--font-size-body, 16px)',
                cursor: 'pointer',
              }}
            >
              Batal
            </button>
          </div>
        )}
      </BottomSheet>

      {/* ===== BottomSheet: Filter ===== */}
      <BottomSheet
        open={activeSheet?.type === 'filter'}
        onClose={closeSheet}
        title="Filter Transaksi"
        sheetKey="tx-filter"
      >
        <FormField id="filter-keyword" label="Kata Kunci">
          <input
            id="filter-keyword"
            type="search"
            placeholder="Cari transaksi..."
            value={draftFilter.keyword ?? ''}
            onChange={(e) =>
              setDraftFilter((f) => ({ ...f, keyword: e.target.value || undefined }))
            }
            style={INPUT_STYLE}
          />
        </FormField>

        <FormField id="filter-type" label="Jenis">
          <select
            id="filter-type"
            value={draftFilter.type ?? ''}
            onChange={(e) =>
              setDraftFilter((f) => ({
                ...f,
                type: (e.target.value as TransactionFilter['type']) || undefined,
              }))
            }
            style={INPUT_STYLE}
          >
            <option value="">Semua jenis</option>
            <option value="EXPENSE">Pengeluaran</option>
            <option value="INCOME">Pemasukan</option>
            <option value="TRANSFER_OUT">Transfer Keluar</option>
            <option value="TRANSFER_IN">Transfer Masuk</option>
          </select>
        </FormField>

        <FormField id="filter-category" label="Kategori">
          <select
            id="filter-category"
            value={draftFilter.categoryId ?? ''}
            onChange={(e) =>
              setDraftFilter((f) => ({ ...f, categoryId: e.target.value || undefined }))
            }
            style={INPUT_STYLE}
          >
            <option value="">Semua kategori</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.type === 'EXPENSE' ? 'Pengeluaran' : 'Pemasukan'})
              </option>
            ))}
          </select>
        </FormField>

        <FormField id="filter-wallet" label="Dompet">
          <select
            id="filter-wallet"
            value={draftFilter.walletId ?? ''}
            onChange={(e) =>
              setDraftFilter((f) => ({ ...f, walletId: e.target.value || undefined }))
            }
            style={INPUT_STYLE}
          >
            <option value="">Semua dompet</option>
            {(wallets ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField id="filter-date-from" label="Tanggal Mulai (YYYY-MM-DD)">
          <input
            id="filter-date-from"
            type="date"
            value={draftFilter.dateFrom ?? ''}
            onChange={(e) =>
              setDraftFilter((f) => ({ ...f, dateFrom: e.target.value || undefined }))
            }
            style={INPUT_STYLE}
          />
        </FormField>

        <FormField id="filter-date-to" label="Tanggal Akhir (YYYY-MM-DD)">
          <input
            id="filter-date-to"
            type="date"
            value={draftFilter.dateTo ?? ''}
            onChange={(e) =>
              setDraftFilter((f) => ({ ...f, dateTo: e.target.value || undefined }))
            }
            style={INPUT_STYLE}
          />
        </FormField>

        <button
          type="button"
          onClick={handleApplyFilter}
          style={{
            width: '100%',
            minHeight: 48,
            padding: '12px 16px',
            background: 'var(--color-brand-blue, #005DAC)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-card, 20px)',
            fontWeight: 700,
            fontSize: 'var(--font-size-body, 16px)',
            cursor: 'pointer',
            marginBottom: 8,
          }}
        >
          Terapkan Filter
        </button>

        <button
          type="button"
          onClick={handleResetFilter}
          style={{
            width: '100%',
            minHeight: 48,
            padding: '12px 16px',
            background: 'none',
            color: 'var(--color-ink, #1f2430)',
            border: '1.5px solid var(--color-border, rgba(0,0,0,0.15))',
            borderRadius: 'var(--radius-card, 20px)',
            fontWeight: 600,
            fontSize: 'var(--font-size-body, 16px)',
            cursor: 'pointer',
          }}
        >
          Hapus Semua Filter
        </button>
      </BottomSheet>
    </div>
  );
}

export default TransactionsPage;
