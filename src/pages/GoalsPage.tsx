/**
 * GoalsPage — Halaman Target Tabungan (Tugas 12.7).
 *
 * Menampilkan seluruh Target_Tabungan milik Pengguna beserta progres nominal
 * terkumpul, persentase, dan setoran bulanan yang diperlukan. Menyediakan
 * aksi: buat, ubah, setoran, dan hapus target.
 *
 * Design System: LargeTitle, SoftCard, Skeleton, EmptyState, AmountDisplay,
 * BottomSheet, GlassBar (dari AuthenticatedLayout).
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 15.7, 17.3, 17.6, 17.9, 17.10
 */

import { useState } from 'react';
import { AmountInput } from '../components/AmountInput';
import { LargeTitle } from '../components/LargeTitle';
import { SoftCard } from '../components/SoftCard';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { AmountDisplay } from '../components/AmountDisplay';
import { BottomSheet } from '../components/BottomSheet';
import {
  useGoals,
  useWallets,
  useCreateGoal,
  useUpdateGoal,
  useDeleteGoal,
  useDepositToGoal,
} from '../hooks';
import type { GoalItem, WalletItem } from '../hooks';
import { goalProgress, monthlyNeeded } from '../../shared/domain/goals';

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

/** Tanggal hari ini dalam format YYYY-MM-DD (UTC). Dipakai untuk monthlyNeeded. */
function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Tipe state lokal
// ---------------------------------------------------------------------------

type ActiveSheet =
  | { type: 'tambah' }
  | { type: 'ubah'; goal: GoalItem }
  | { type: 'setor'; goal: GoalItem }
  | { type: 'hapus'; goal: GoalItem };

// ---------------------------------------------------------------------------
// Komponen pembantu: kartu satu Target Tabungan
// ---------------------------------------------------------------------------

interface GoalCardProps {
  goal: GoalItem;
  wallets: WalletItem[];
  onEdit: (goal: GoalItem) => void;
  onDeposit: (goal: GoalItem) => void;
  onDelete: (goal: GoalItem) => void;
}

function GoalCard({ goal, onEdit, onDeposit, onDelete }: GoalCardProps) {
  const saved = goal.saved ?? 0;
  const target = goal.target ?? 0;
  const today = todayString();

  // Hitung progres dengan domain function
  let percent = 0;
  let achieved = false;
  try {
    const prog = goalProgress(saved, target > 0 ? target : 1);
    percent = prog.percent;
    achieved = prog.achieved;
  } catch {
    /* target tidak valid, tampilkan 0 */
  }

  const percentDisplay = Math.min(100, Math.round(percent * 100));

  // Hitung setoran bulanan yang diperlukan
  let needed: number | null = null;
  if (!achieved && goal.deadline) {
    try {
      needed = monthlyNeeded(saved, target, goal.deadline, today);
    } catch {
      /* abaikan */
    }
  }

  // Warna progress bar
  const barColor = achieved
    ? 'var(--color-income, #1a7a4a)'
    : percentDisplay >= 80
      ? 'var(--color-brand-blue, #005DAC)'
      : 'var(--color-brand-blue, #005DAC)';

  return (
    <SoftCard
      style={{ marginBottom: 12, padding: '16px' }}
      aria-label={`Target tabungan ${goal.name ?? ''}`}
    >
      {/* Header: nama + aksi */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <p
              style={{
                margin: 0,
                fontWeight: 700,
                fontSize: 'var(--font-size-body, 16px)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {goal.name}
            </p>
            {achieved && (
              <span
                aria-label="Tercapai"
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 99,
                  background: '#e6f7ee',
                  color: 'var(--color-income, #1a7a4a)',
                  flexShrink: 0,
                }}
              >
                ✅ Tercapai
              </span>
            )}
          </div>
          {goal.deadline && (
            <p
              style={{
                margin: '2px 0 0',
                fontSize: 12,
                color: 'var(--color-ink-muted, #4A5160)',
              }}
            >
              Tenggat: {formatDateId(goal.deadline)}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <ActionButton onClick={() => onEdit(goal)} label="Ubah target" icon="✏️" />
          {!achieved && (
            <ActionButton onClick={() => onDeposit(goal)} label="Setor dana" icon="💰" />
          )}
          <ActionButton onClick={() => onDelete(goal)} label="Hapus target" icon="🗑" />
        </div>
      </div>

      {/* Nominal terkumpul / target */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
          marginBottom: 8,
        }}
      >
        <AmountDisplay
          amount={saved}
          variant="income"
          style={{ fontSize: 20, fontWeight: 700 }}
        />
        <span style={{ color: 'var(--color-ink-muted, #4A5160)', fontSize: 13 }}>
          dari
        </span>
        <AmountDisplay
          amount={target}
          style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-ink-muted, #4A5160)' }}
        />
      </div>

      {/* Progress bar */}
      <div
        role="progressbar"
        aria-valuenow={percentDisplay}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Progres ${percentDisplay}%`}
        style={{
          height: 8,
          background: 'var(--color-muted-bg, #f3f4f6)',
          borderRadius: 99,
          overflow: 'hidden',
          marginBottom: 6,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${percentDisplay}%`,
            background: barColor,
            borderRadius: 99,
            transform: 'scaleX(1)',
            transformOrigin: 'left',
            transition: 'width 0.3s ease',
          }}
        />
      </div>

      {/* Persentase + setoran bulanan */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 13,
          color: 'var(--color-ink-muted, #4A5160)',
        }}
      >
        <span>
          <strong style={{ color: barColor }}>{percentDisplay}%</strong> terkumpul
        </span>
        {needed !== null && (
          <span>
            Perlu{' '}
            <AmountDisplay
              amount={needed}
              style={{ fontSize: 13, fontWeight: 600 }}
            />
            /bulan
          </span>
        )}
      </div>
    </SoftCard>
  );
}

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
// Komponen utama
// ---------------------------------------------------------------------------

export function GoalsPage() {
  const { data: goals, isPending: goalsLoading, error: goalsError } = useGoals();
  const { data: wallets = [] } = useWallets();

  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const deleteGoal = useDeleteGoal();
  const depositToGoal = useDepositToGoal();

  const [activeSheet, setActiveSheet] = useState<ActiveSheet | null>(null);

  // Form state — buat / ubah
  const [formName, setFormName] = useState('');
  const [formTarget, setFormTarget] = useState('');
  const [formDeadline, setFormDeadline] = useState('');

  // Form state — setor
  const [depositAmount, setDepositAmount] = useState('');
  const [depositWalletId, setDepositWalletId] = useState('');

  // Error operasi
  const [opError, setOpError] = useState<string | null>(null);

  const resetGoalForm = () => {
    setFormName('');
    setFormTarget('');
    setFormDeadline('');
    setOpError(null);
  };

  const resetDepositForm = () => {
    setDepositAmount('');
    setDepositWalletId('');
    setOpError(null);
  };

  const closeSheet = () => {
    setActiveSheet(null);
    resetGoalForm();
    resetDepositForm();
  };

  const openCreate = () => {
    resetGoalForm();
    setActiveSheet({ type: 'tambah' });
  };

  const openEdit = (goal: GoalItem) => {
    setFormName(goal.name ?? '');
    setFormTarget(String(goal.target ?? ''));
    setFormDeadline(goal.deadline ?? '');
    setOpError(null);
    setActiveSheet({ type: 'ubah', goal });
  };

  const openDeposit = (goal: GoalItem) => {
    resetDepositForm();
    setActiveSheet({ type: 'setor', goal });
  };

  const openDelete = (goal: GoalItem) => {
    setOpError(null);
    setActiveSheet({ type: 'hapus', goal });
  };

  // -------------------------------------------------------------------------
  // Aksi submit
  // -------------------------------------------------------------------------

  const handleCreate = async () => {
    const name = formName.trim();
    if (!name) { setOpError('Nama target tidak boleh kosong.'); return; }
    const target = parseInt(formTarget, 10);
    if (isNaN(target) || target <= 0) {
      setOpError('Nominal target harus berupa angka bulat lebih dari 0.');
      return;
    }
    setOpError(null);
    try {
      await createGoal.mutateAsync({
        name,
        target,
        ...(formDeadline ? { deadline: formDeadline } : {}),
      });
      closeSheet();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Gagal membuat target tabungan.');
    }
  };

  const handleUpdate = async () => {
    if (activeSheet?.type !== 'ubah') return;
    const name = formName.trim();
    if (!name) { setOpError('Nama target tidak boleh kosong.'); return; }
    const target = parseInt(formTarget, 10);
    if (isNaN(target) || target <= 0) {
      setOpError('Nominal target harus berupa angka bulat lebih dari 0.');
      return;
    }
    setOpError(null);
    try {
      await updateGoal.mutateAsync({
        goalId: activeSheet.goal.id,
        name,
        target,
        deadline: formDeadline || null,
      });
      closeSheet();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Gagal mengubah target tabungan.');
    }
  };

  const handleDelete = async () => {
    if (activeSheet?.type !== 'hapus') return;
    setOpError(null);
    try {
      await deleteGoal.mutateAsync({ goalId: activeSheet.goal.id });
      closeSheet();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Gagal menghapus target tabungan.');
    }
  };

  const handleDeposit = async () => {
    if (activeSheet?.type !== 'setor') return;
    const amount = parseInt(depositAmount, 10);
    if (isNaN(amount) || amount <= 0) {
      setOpError('Nominal setoran harus berupa angka bulat lebih dari 0.');
      return;
    }
    if (!depositWalletId) {
      setOpError('Pilih dompet sumber setoran.');
      return;
    }
    setOpError(null);
    try {
      await depositToGoal.mutateAsync({
        goalId: activeSheet.goal.id,
        walletId: depositWalletId,
        amount,
      });
      closeSheet();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Gagal menyetorkan dana. Pastikan saldo dompet mencukupi.');
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const achieved = goals?.filter((g) => g.achieved) ?? [];
  const active = goals?.filter((g) => !g.achieved) ?? [];

  return (
    <div style={{ paddingBottom: 96 }}>
      {/* Judul halaman */}
      <LargeTitle title="Target Tabungan" />

      {/* Tombol tambah target */}
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
        + Tambah Target Tabungan
      </button>

      {/* Galat muat */}
      {goalsError && (
        <SoftCard style={{ marginBottom: 12, color: 'var(--color-expense, #c0392b)' }}>
          {goalsError.message}
        </SoftCard>
      )}

      {/* Keadaan memuat */}
      {goalsLoading && (
        <>
          <Skeleton height={140} style={{ marginBottom: 12 }} />
          <Skeleton height={140} style={{ marginBottom: 12 }} />
          <Skeleton height={140} />
        </>
      )}

      {/* Keadaan kosong */}
      {!goalsLoading && !goalsError && (goals?.length ?? 0) === 0 && (
        <EmptyState
          icon="🎯"
          title="Belum ada target tabungan"
          description="Tambahkan target tabungan untuk mulai merencanakan tujuan finansial Anda."
        />
      )}

      {/* Daftar target aktif */}
      {!goalsLoading && active.length > 0 && (
        <>
          {active.length > 0 && achieved.length > 0 && (
            <SectionHeading label="Sedang Berjalan" count={active.length} />
          )}
          {active.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              wallets={wallets}
              onEdit={openEdit}
              onDeposit={openDeposit}
              onDelete={openDelete}
            />
          ))}
        </>
      )}

      {/* Daftar target tercapai */}
      {!goalsLoading && achieved.length > 0 && (
        <>
          <SectionHeading label="Tercapai" count={achieved.length} />
          {achieved.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              wallets={wallets}
              onEdit={openEdit}
              onDeposit={openDeposit}
              onDelete={openDelete}
            />
          ))}
        </>
      )}

      {/* BottomSheet: Tambah Target */}
      <BottomSheet
        open={activeSheet?.type === 'tambah'}
        onClose={closeSheet}
        title="Tambah Target Tabungan"
        sheetKey="tambah-target"
      >
        <GoalForm
          formName={formName}
          setFormName={setFormName}
          formTarget={formTarget}
          setFormTarget={setFormTarget}
          formDeadline={formDeadline}
          setFormDeadline={setFormDeadline}
          opError={opError}
          onSubmit={() => void handleCreate()}
          loading={createGoal.isPending}
          submitLabel="Simpan Target"
        />
      </BottomSheet>

      {/* BottomSheet: Ubah Target */}
      <BottomSheet
        open={activeSheet?.type === 'ubah'}
        onClose={closeSheet}
        title="Ubah Target Tabungan"
        sheetKey="ubah-target"
      >
        <GoalForm
          formName={formName}
          setFormName={setFormName}
          formTarget={formTarget}
          setFormTarget={setFormTarget}
          formDeadline={formDeadline}
          setFormDeadline={setFormDeadline}
          opError={opError}
          onSubmit={() => void handleUpdate()}
          loading={updateGoal.isPending}
          submitLabel="Perbarui Target"
        />
      </BottomSheet>

      {/* BottomSheet: Setor Dana */}
      <BottomSheet
        open={activeSheet?.type === 'setor'}
        onClose={closeSheet}
        title="Setor Dana ke Target"
        sheetKey="setor-target"
      >
        {activeSheet?.type === 'setor' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Ringkasan target */}
            <SoftCard style={{ background: '#f8f9fa', padding: '12px 14px' }}>
              <p style={{ margin: '0 0 4px', fontWeight: 700 }}>
                {activeSheet.goal.name}
              </p>
              <div style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--color-ink-muted, #4A5160)' }}>
                <span>
                  Terkumpul:{' '}
                  <AmountDisplay amount={activeSheet.goal.saved ?? 0} style={{ fontSize: 13 }} />
                </span>
                <span>
                  Target:{' '}
                  <AmountDisplay amount={activeSheet.goal.target ?? 0} style={{ fontSize: 13 }} />
                </span>
              </div>
            </SoftCard>

            <FormField label="Nominal Setoran (Rp)" htmlFor="deposit-amount">
              <AmountInput
                id="deposit-amount"                value={depositAmount}
                onChange={setDepositAmount}
                placeholder="Masukkan nominal setoran"
                style={inputStyle}
              />
            </FormField>

            <FormField label="Sumber Dana (Dompet)" htmlFor="deposit-wallet">
              <select
                id="deposit-wallet"
                value={depositWalletId}
                onChange={(e) => setDepositWalletId(e.target.value)}
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

            {opError && <ErrorMessage>{opError}</ErrorMessage>}

            <SubmitButton
              onClick={() => void handleDeposit()}
              loading={depositToGoal.isPending}
            >
              Setor Dana
            </SubmitButton>
          </div>
        )}
      </BottomSheet>

      {/* BottomSheet: Hapus Target */}
      <BottomSheet
        open={activeSheet?.type === 'hapus'}
        onClose={closeSheet}
        title="Hapus Target Tabungan"
        sheetKey="hapus-target"
      >
        {activeSheet?.type === 'hapus' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0 }}>
              Yakin ingin menghapus target tabungan{' '}
              <strong>{activeSheet.goal.name}</strong>?
              Dana yang sudah terkumpul tidak otomatis dikembalikan ke dompet.
            </p>
            {opError && <ErrorMessage>{opError}</ErrorMessage>}
            <SubmitButton
              onClick={() => void handleDelete()}
              loading={deleteGoal.isPending}
              variant="danger"
            >
              Hapus Target
            </SubmitButton>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-komponen: formulir target tabungan (dipakai untuk buat dan ubah)
// ---------------------------------------------------------------------------

interface GoalFormProps {
  formName: string;
  setFormName: (v: string) => void;
  formTarget: string;
  setFormTarget: (v: string) => void;
  formDeadline: string;
  setFormDeadline: (v: string) => void;
  opError: string | null;
  onSubmit: () => void;
  loading: boolean;
  submitLabel: string;
}

function GoalForm({
  formName,
  setFormName,
  formTarget,
  setFormTarget,
  formDeadline,
  setFormDeadline,
  opError,
  onSubmit,
  loading,
  submitLabel,
}: GoalFormProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <FormField label="Nama Target" htmlFor="goal-name">
        <input
          id="goal-name"
          type="text"
          value={formName}
          onChange={(e) => setFormName(e.target.value)}
          placeholder="Contoh: Dana Darurat, Liburan Bali"
          style={inputStyle}
        />
      </FormField>

      <FormField label="Nominal Target (Rp)" htmlFor="goal-target">
        <AmountInput
          id="goal-target"          value={formTarget}
          onChange={setFormTarget}
          placeholder="Masukkan nominal target"
          style={inputStyle}
        />
      </FormField>

      <FormField label="Tenggat (opsional)" htmlFor="goal-deadline">
        <input
          id="goal-deadline"
          type="date"
          value={formDeadline}
          onChange={(e) => setFormDeadline(e.target.value)}
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
// Komponen pembantu
// ---------------------------------------------------------------------------

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <div
      style={{
        padding: '12px 4px 6px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: 'var(--color-ink-muted, #4A5160)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--color-ink-muted, #4A5160)',
          background: 'var(--color-muted-bg, #f3f4f6)',
          borderRadius: 99,
          padding: '1px 7px',
        }}
      >
        {count}
      </span>
    </div>
  );
}

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
  const bgColor =
    variant === 'danger'
      ? 'var(--color-expense, #c0392b)'
      : 'var(--color-brand-blue, #005DAC)';
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

export default GoalsPage;
