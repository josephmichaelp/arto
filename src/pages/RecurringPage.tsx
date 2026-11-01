/**
 * RecurringPage — Halaman Transaksi Berulang (Tugas 12.7).
 *
 * Menampilkan seluruh aturan Transaksi_Berulang milik Pengguna beserta
 * frekuensi, nominal, dan tanggal jatuh tempo berikutnya. Menyediakan aksi:
 * buat, jeda, lanjut, dan hapus aturan.
 *
 * Design System: LargeTitle, SoftCard, Skeleton, EmptyState, AmountDisplay,
 * BottomSheet, GlassBar (dari AuthenticatedLayout).
 *
 * Requirements: 6.1, 6.4, 15.7, 17.3, 17.6, 17.9, 17.10
 */

import { useState } from 'react';
import { LargeTitle } from '../components/LargeTitle';
import { SoftCard } from '../components/SoftCard';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { AmountDisplay } from '../components/AmountDisplay';
import { BottomSheet } from '../components/BottomSheet';
import {
  useRecurringRules,
  useCategories,
  useWallets,
  useCreateRecurringRule,
  useUpdateRecurringRule,
  useDeleteRecurringRule,
} from '../hooks';
import type { RecurringRuleItem, CategoryItem, WalletItem } from '../hooks';

// ---------------------------------------------------------------------------
// Konstanta label
// ---------------------------------------------------------------------------

const FREQUENCY_LABELS: Record<string, string> = {
  DAILY: 'Harian',
  WEEKLY: 'Mingguan',
  MONTHLY: 'Bulanan',
  YEARLY: 'Tahunan',
};

const TYPE_LABELS: Record<string, string> = {
  EXPENSE: 'Pengeluaran',
  INCOME: 'Pemasukan',
};

const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
type Frequency = (typeof FREQUENCIES)[number];

// ---------------------------------------------------------------------------
// Tipe state lokal
// ---------------------------------------------------------------------------

type ActiveSheet =
  | { type: 'tambah' }
  | { type: 'ubah'; rule: RecurringRuleItem }
  | { type: 'hapus'; rule: RecurringRuleItem };

// ---------------------------------------------------------------------------
// Utilitas
// ---------------------------------------------------------------------------

function formatDateId(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const MONTHS = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  const day = parseInt(m[3]!, 10);
  const month = parseInt(m[2]!, 10) - 1;
  const year = m[1]!;
  return `${day} ${MONTHS[month] ?? '?'} ${year}`;
}

function getCategoryName(
  categoryId: string | null | undefined,
  categories: CategoryItem[],
): string {
  if (!categoryId) return '—';
  return categories.find((c) => c.id === categoryId)?.name ?? categoryId;
}

function getWalletName(
  walletId: string | null | undefined,
  wallets: WalletItem[],
): string {
  if (!walletId) return '—';
  return wallets.find((w) => w.id === walletId)?.name ?? walletId;
}

// ---------------------------------------------------------------------------
// Komponen pembantu: baris satu aturan berulang
// ---------------------------------------------------------------------------

interface RuleRowProps {
  rule: RecurringRuleItem;
  categories: CategoryItem[];
  wallets: WalletItem[];
  onEdit: (rule: RecurringRuleItem) => void;
  onTogglePause: (rule: RecurringRuleItem) => void;
  onDelete: (rule: RecurringRuleItem) => void;
  pauseLoading: boolean;
}

function RuleRow({
  rule,
  categories,
  wallets,
  onEdit,
  onTogglePause,
  onDelete,
  pauseLoading,
}: RuleRowProps) {
  const isPaused = rule.status === 'PAUSED';
  const amount = rule.amount ?? 0;
  const txType = rule.type ?? 'EXPENSE';
  const freq = rule.frequency ?? 'MONTHLY';

  return (
    <SoftCard
      style={{ marginBottom: 10, padding: '14px 16px' }}
      aria-label={`Aturan berulang ${rule.id ?? ''}`}
    >
      {/* Baris pertama: nama kategori + status */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 99,
              background: txType === 'INCOME'
                ? 'var(--color-income-bg, #e6f7ee)'
                : 'var(--color-expense-bg, #fef0ee)',
              color: txType === 'INCOME'
                ? 'var(--color-income, #1a7a4a)'
                : 'var(--color-expense, #c0392b)',
            }}
          >
            {TYPE_LABELS[txType] ?? txType}
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 99,
              background: 'var(--color-muted-bg, #f3f4f6)',
              color: 'var(--color-ink-muted, #4A5160)',
            }}
          >
            {FREQUENCY_LABELS[freq] ?? freq}
          </span>
          {isPaused && (
            <span
              aria-label="Dijeda"
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 99,
                background: '#fff3cd',
                color: '#856404',
              }}
            >
              ⏸ Dijeda
            </span>
          )}
        </div>
        {/* Tombol aksi */}
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <ActionButton
            onClick={() => onEdit(rule)}
            label="Ubah aturan"
            icon="✏️"
          />
          <ActionButton
            onClick={() => onTogglePause(rule)}
            label={isPaused ? 'Lanjutkan' : 'Jeda'}
            icon={isPaused ? '▶️' : '⏸'}
            disabled={pauseLoading}
          />
          <ActionButton
            onClick={() => onDelete(rule)}
            label="Hapus aturan"
            icon="🗑"
          />
        </div>
      </div>

      {/* Nominal */}
      <AmountDisplay
        amount={amount}
        variant={txType === 'INCOME' ? 'income' : 'expense'}
        style={{ fontSize: 20, fontWeight: 700, display: 'block', marginBottom: 6 }}
      />

      {/* Detail */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '4px 12px',
          fontSize: 13,
          color: 'var(--color-ink-muted, #4A5160)',
        }}
      >
        <span>Kategori: {getCategoryName(rule.categoryId, categories)}</span>
        <span>Dompet: {getWalletName(rule.walletId, wallets)}</span>
        <span>Mulai: {formatDateId(rule.startDate)}</span>
        <span>
          {isPaused ? 'Dijeda' : `Jatuh tempo: ${formatDateId(rule.nextDueOn)}`}
        </span>
      </div>
    </SoftCard>
  );
}

function ActionButton({
  onClick,
  label,
  icon,
  disabled,
}: {
  onClick: () => void;
  label: string;
  icon: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        minWidth: 44,
        minHeight: 44,
        border: 'none',
        background: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 18,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'var(--radius-card, 20px)',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Komponen utama
// ---------------------------------------------------------------------------

export function RecurringPage() {
  const { data: rules, isPending: rulesLoading, error: rulesError } = useRecurringRules();
  const { data: categories = [] } = useCategories();
  const { data: wallets = [] } = useWallets();

  const createRule = useCreateRecurringRule();
  const updateRule = useUpdateRecurringRule();
  const deleteRule = useDeleteRecurringRule();

  const [activeSheet, setActiveSheet] = useState<ActiveSheet | null>(null);

  // Form state — buat / ubah
  const [formAmount, setFormAmount] = useState('');
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formWalletId, setFormWalletId] = useState('');
  const [formType, setFormType] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  const [formFrequency, setFormFrequency] = useState<Frequency>('MONTHLY');
  const [formStartDate, setFormStartDate] = useState(() => {
    const now = new Date();
    return now.toISOString().slice(0, 10);
  });

  // Error operasi
  const [opError, setOpError] = useState<string | null>(null);

  // Loading untuk pause/resume agar tombol tak bisa diklik ganda
  const [pausingId, setPausingId] = useState<string | null>(null);

  const resetForm = () => {
    setFormAmount('');
    setFormCategoryId('');
    setFormWalletId('');
    setFormType('EXPENSE');
    setFormFrequency('MONTHLY');
    setFormStartDate(new Date().toISOString().slice(0, 10));
    setOpError(null);
  };

  const closeSheet = () => {
    setActiveSheet(null);
    resetForm();
  };

  const openCreate = () => {
    resetForm();
    setActiveSheet({ type: 'tambah' });
  };

  const openEdit = (rule: RecurringRuleItem) => {
    setFormAmount(String(rule.amount ?? ''));
    setFormCategoryId(rule.categoryId ?? '');
    setFormWalletId(rule.walletId ?? '');
    setFormType((rule.type as 'EXPENSE' | 'INCOME') ?? 'EXPENSE');
    setFormFrequency((rule.frequency as Frequency) ?? 'MONTHLY');
    setFormStartDate(rule.startDate ?? new Date().toISOString().slice(0, 10));
    setOpError(null);
    setActiveSheet({ type: 'ubah', rule });
  };

  const openDelete = (rule: RecurringRuleItem) => {
    setOpError(null);
    setActiveSheet({ type: 'hapus', rule });
  };

  // -------------------------------------------------------------------------
  // Validasi form
  // -------------------------------------------------------------------------

  const validateForm = (): string | null => {
    const amount = parseInt(formAmount, 10);
    if (isNaN(amount) || amount <= 0) {
      return 'Nominal harus berupa angka bulat lebih dari 0.';
    }
    if (!formCategoryId) return 'Pilih kategori.';
    if (!formWalletId) return 'Pilih dompet.';
    if (!formStartDate) return 'Tentukan tanggal mulai.';
    return null;
  };

  // -------------------------------------------------------------------------
  // Aksi submit
  // -------------------------------------------------------------------------

  const handleCreate = async () => {
    const err = validateForm();
    if (err) { setOpError(err); return; }
    setOpError(null);
    try {
      await createRule.mutateAsync({
        amount: parseInt(formAmount, 10),
        categoryId: formCategoryId,
        walletId: formWalletId,
        type: formType,
        frequency: formFrequency,
        startDate: formStartDate,
      });
      closeSheet();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Gagal membuat aturan berulang.');
    }
  };

  const handleUpdate = async () => {
    if (activeSheet?.type !== 'ubah') return;
    const err = validateForm();
    if (err) { setOpError(err); return; }
    setOpError(null);
    try {
      await updateRule.mutateAsync({
        ruleId: activeSheet.rule.id,
        amount: parseInt(formAmount, 10),
        categoryId: formCategoryId,
        walletId: formWalletId,
        type: formType,
        frequency: formFrequency,
        startDate: formStartDate,
      });
      closeSheet();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Gagal mengubah aturan berulang.');
    }
  };

  const handleDelete = async () => {
    if (activeSheet?.type !== 'hapus') return;
    setOpError(null);
    try {
      await deleteRule.mutateAsync({ ruleId: activeSheet.rule.id });
      closeSheet();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Gagal menghapus aturan berulang.');
    }
  };

  const handleTogglePause = async (rule: RecurringRuleItem) => {
    if (!rule.id) return;
    setPausingId(rule.id);
    try {
      const newStatus = rule.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED';
      await updateRule.mutateAsync({ ruleId: rule.id, status: newStatus });
    } catch {
      // Abaikan — akan terupdate setelah invalidate query
    } finally {
      setPausingId(null);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // Filter kategori sesuai jenis transaksi di formulir
  const filteredCategories = categories.filter((c) => c.type === formType);

  return (
    <div style={{ paddingBottom: 96 }}>
      {/* Judul halaman */}
      <LargeTitle title="Transaksi Berulang" />

      {/* Tombol tambah aturan */}
      <button
        type="button"
        onClick={openCreate}
        style={{
          width: '100%',
          minHeight: 44,
          marginBottom: 16,
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
        + Tambah Aturan Berulang
      </button>

      {/* Galat muat */}
      {rulesError && (
        <SoftCard style={{ marginBottom: 12, color: 'var(--color-expense, #c0392b)' }}>
          {rulesError.message}
        </SoftCard>
      )}

      {/* Keadaan memuat */}
      {rulesLoading && (
        <>
          <Skeleton height={110} style={{ marginBottom: 10 }} />
          <Skeleton height={110} style={{ marginBottom: 10 }} />
          <Skeleton height={110} />
        </>
      )}

      {/* Keadaan kosong */}
      {!rulesLoading && !rulesError && (rules?.length ?? 0) === 0 && (
        <EmptyState
          icon="🔄"
          title="Belum ada transaksi berulang"
          description="Tambahkan aturan berulang untuk mencatat tagihan atau langganan otomatis."
        />
      )}

      {/* Daftar aturan */}
      {!rulesLoading &&
        rules?.map((rule) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            categories={categories}
            wallets={wallets}
            onEdit={openEdit}
            onTogglePause={handleTogglePause}
            onDelete={openDelete}
            pauseLoading={pausingId === rule.id}
          />
        ))}

      {/* BottomSheet: Tambah Aturan */}
      <BottomSheet
        open={activeSheet?.type === 'tambah'}
        onClose={closeSheet}
        title="Tambah Aturan Berulang"
        sheetKey="tambah-berulang"
      >
        <RuleForm
          formAmount={formAmount}
          setFormAmount={setFormAmount}
          formCategoryId={formCategoryId}
          setFormCategoryId={setFormCategoryId}
          formWalletId={formWalletId}
          setFormWalletId={setFormWalletId}
          formType={formType}
          setFormType={setFormType}
          formFrequency={formFrequency}
          setFormFrequency={setFormFrequency}
          formStartDate={formStartDate}
          setFormStartDate={setFormStartDate}
          filteredCategories={filteredCategories}
          wallets={wallets}
          opError={opError}
          onSubmit={() => void handleCreate()}
          loading={createRule.isPending}
          submitLabel="Simpan Aturan"
        />
      </BottomSheet>

      {/* BottomSheet: Ubah Aturan */}
      <BottomSheet
        open={activeSheet?.type === 'ubah'}
        onClose={closeSheet}
        title="Ubah Aturan Berulang"
        sheetKey="ubah-berulang"
      >
        <RuleForm
          formAmount={formAmount}
          setFormAmount={setFormAmount}
          formCategoryId={formCategoryId}
          setFormCategoryId={setFormCategoryId}
          formWalletId={formWalletId}
          setFormWalletId={setFormWalletId}
          formType={formType}
          setFormType={setFormType}
          formFrequency={formFrequency}
          setFormFrequency={setFormFrequency}
          formStartDate={formStartDate}
          setFormStartDate={setFormStartDate}
          filteredCategories={filteredCategories}
          wallets={wallets}
          opError={opError}
          onSubmit={() => void handleUpdate()}
          loading={updateRule.isPending}
          submitLabel="Perbarui Aturan"
        />
      </BottomSheet>

      {/* BottomSheet: Hapus Aturan */}
      <BottomSheet
        open={activeSheet?.type === 'hapus'}
        onClose={closeSheet}
        title="Hapus Aturan Berulang"
        sheetKey="hapus-berulang"
      >
        {activeSheet?.type === 'hapus' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0 }}>
              Yakin ingin menghapus aturan berulang{' '}
              <strong>
                {getCategoryName(activeSheet.rule.categoryId, categories)}
              </strong>{' '}
              sebesar <AmountDisplay amount={activeSheet.rule.amount ?? 0} />?
              Transaksi yang sudah dibuat tidak akan dihapus.
            </p>
            {opError && <ErrorMessage>{opError}</ErrorMessage>}
            <SubmitButton
              onClick={() => void handleDelete()}
              loading={deleteRule.isPending}
              variant="danger"
            >
              Hapus Aturan
            </SubmitButton>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-komponen: formulir aturan berulang (dipakai untuk buat dan ubah)
// ---------------------------------------------------------------------------

interface RuleFormProps {
  formAmount: string;
  setFormAmount: (v: string) => void;
  formCategoryId: string;
  setFormCategoryId: (v: string) => void;
  formWalletId: string;
  setFormWalletId: (v: string) => void;
  formType: 'EXPENSE' | 'INCOME';
  setFormType: (v: 'EXPENSE' | 'INCOME') => void;
  formFrequency: Frequency;
  setFormFrequency: (v: Frequency) => void;
  formStartDate: string;
  setFormStartDate: (v: string) => void;
  filteredCategories: CategoryItem[];
  wallets: WalletItem[];
  opError: string | null;
  onSubmit: () => void;
  loading: boolean;
  submitLabel: string;
}

function RuleForm({
  formAmount,
  setFormAmount,
  formCategoryId,
  setFormCategoryId,
  formWalletId,
  setFormWalletId,
  formType,
  setFormType,
  formFrequency,
  setFormFrequency,
  formStartDate,
  setFormStartDate,
  filteredCategories,
  wallets,
  opError,
  onSubmit,
  loading,
  submitLabel,
}: RuleFormProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Jenis transaksi */}
      <FormField label="Jenis" htmlFor="rule-type">
        <select
          id="rule-type"
          value={formType}
          onChange={(e) => {
            setFormType(e.target.value as 'EXPENSE' | 'INCOME');
            setFormCategoryId(''); // reset kategori saat jenis berubah
          }}
          style={inputStyle}
        >
          <option value="EXPENSE">Pengeluaran</option>
          <option value="INCOME">Pemasukan</option>
        </select>
      </FormField>

      {/* Nominal */}
      <FormField label="Nominal (Rp)" htmlFor="rule-amount">
        <input
          id="rule-amount"
          type="text"
          inputMode="numeric"
          value={formAmount}
          onChange={(e) => setFormAmount(e.target.value.replace(/\D/g, ''))}
          placeholder="Masukkan nominal"
          style={inputStyle}
        />
      </FormField>

      {/* Kategori */}
      <FormField label="Kategori" htmlFor="rule-category">
        <select
          id="rule-category"
          value={formCategoryId}
          onChange={(e) => setFormCategoryId(e.target.value)}
          style={inputStyle}
        >
          <option value="">— Pilih kategori —</option>
          {filteredCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </FormField>

      {/* Dompet */}
      <FormField label="Dompet" htmlFor="rule-wallet">
        <select
          id="rule-wallet"
          value={formWalletId}
          onChange={(e) => setFormWalletId(e.target.value)}
          style={inputStyle}
        >
          <option value="">— Pilih dompet —</option>
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </FormField>

      {/* Frekuensi */}
      <FormField label="Frekuensi" htmlFor="rule-frequency">
        <select
          id="rule-frequency"
          value={formFrequency}
          onChange={(e) => setFormFrequency(e.target.value as Frequency)}
          style={inputStyle}
        >
          {FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {FREQUENCY_LABELS[f]}
            </option>
          ))}
        </select>
      </FormField>

      {/* Tanggal mulai */}
      <FormField label="Tanggal Mulai" htmlFor="rule-start-date">
        <input
          id="rule-start-date"
          type="date"
          value={formStartDate}
          onChange={(e) => setFormStartDate(e.target.value)}
          style={inputStyle}
        />
      </FormField>

      {opError && <ErrorMessage>{opError}</ErrorMessage>}

      <SubmitButton onClick={onSubmit} loading={loading}>
        {submitLabel}
      </SubmitButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Komponen pembantu formulir
// ---------------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 44,
  padding: '10px 12px',
  border: '1.5px solid var(--color-border, #d1d5db)',
  borderRadius: 12,
  fontSize: 'var(--font-size-body, 16px)',
  background: '#fff',
  color: 'var(--color-ink, #1F2430)',
  boxSizing: 'border-box',
};

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
          color: 'var(--color-ink-muted, #4A5160)',
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
        borderRadius: 10,
        background: '#fef0ee',
        color: 'var(--color-expense, #c0392b)',
        fontSize: 'var(--font-size-caption, 13px)',
        fontWeight: 500,
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
  variant = 'primary',
}: {
  onClick: () => void;
  loading: boolean;
  children: React.ReactNode;
  variant?: 'primary' | 'danger';
}) {
  const bgColor = variant === 'danger' ? 'var(--color-expense, #c0392b)' : 'var(--color-brand-blue, #005DAC)';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      style={{
        width: '100%',
        minHeight: 44,
        padding: '10px 16px',
        border: 'none',
        borderRadius: 12,
        background: bgColor,
        color: '#fff',
        fontWeight: 700,
        fontSize: 'var(--font-size-body, 16px)',
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.7 : 1,
      }}
    >
      {loading ? 'Memproses…' : children}
    </button>
  );
}

export default RecurringPage;
