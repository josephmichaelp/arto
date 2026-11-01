/**
 * WalletsPage — Halaman Dompet (Tugas 12.4).
 *
 * Menampilkan seluruh Dompet Pengguna beserta saldo masing-masing, total saldo,
 * dan menyediakan aksi: buat, ubah nama, hapus (dengan reassign), serta
 * pindah dana antar Dompet.
 *
 * Design System: LargeTitle, SoftCard, Skeleton, EmptyState, AmountDisplay,
 * BottomSheet, GlassBar (dari AuthenticatedLayout).
 *
 * Requirements: 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5
 */

import { useState } from 'react';
import { LargeTitle } from '../components/LargeTitle';
import { SoftCard } from '../components/SoftCard';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { AmountDisplay } from '../components/AmountDisplay';
import { BottomSheet } from '../components/BottomSheet';
import {
  useWallets,
  useCreateWallet,
  useRenameWallet,
  useDeleteWalletWithReassign,
  useTransferFunds,
} from '../hooks';
import type { WalletItem } from '../hooks';

// ---------------------------------------------------------------------------
// Tipe state lokal
// ---------------------------------------------------------------------------

type ActiveSheet =
  | { type: 'tambah' }
  | { type: 'ubah'; wallet: WalletItem }
  | { type: 'hapus'; wallet: WalletItem }
  | { type: 'transfer'; fromWallet: WalletItem };

// ---------------------------------------------------------------------------
// Komponen pembantu: baris satu Dompet
// ---------------------------------------------------------------------------

interface WalletRowProps {
  wallet: WalletItem;
  onRename: (w: WalletItem) => void;
  onDelete: (w: WalletItem) => void;
  onTransfer: (w: WalletItem) => void;
}

function WalletRow({ wallet, onRename, onDelete, onTransfer }: WalletRowProps) {
  const balance = typeof wallet.balance === 'number' ? wallet.balance : 0;

  return (
    <SoftCard
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 8,
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
          {wallet.name}
        </p>
        <AmountDisplay
          amount={balance}
          variant={balance < 0 ? 'expense' : 'neutral'}
          style={{ fontSize: 'var(--font-size-caption, 13px)', marginTop: 2 }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <ActionButton onClick={() => onTransfer(wallet)} label="Pindah dana" icon="⇄" />
        <ActionButton onClick={() => onRename(wallet)} label="Ubah nama" icon="✏️" />
        <ActionButton onClick={() => onDelete(wallet)} label="Hapus" icon="🗑" />
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

export function WalletsPage() {
  const { data: wallets, isPending, error: loadError } = useWallets();

  const createWallet = useCreateWallet();
  const renameWallet = useRenameWallet();
  const deleteWallet = useDeleteWalletWithReassign();
  const transferFunds = useTransferFunds();

  const [activeSheet, setActiveSheet] = useState<ActiveSheet | null>(null);

  // Form state — buat
  const [newName, setNewName] = useState('');
  const [newInitialBalance, setNewInitialBalance] = useState('0');

  // Form state — ubah nama
  const [renameName, setRenameName] = useState('');

  // Form state — hapus
  const [deleteReplacementId, setDeleteReplacementId] = useState('');

  // Form state — transfer
  const [transferToId, setTransferToId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNote, setTransferNote] = useState('');

  // Error message dari operasi
  const [opError, setOpError] = useState<string | null>(null);

  const closeSheet = () => {
    setActiveSheet(null);
    setOpError(null);
    setNewName('');
    setNewInitialBalance('0');
    setRenameName('');
    setDeleteReplacementId('');
    setTransferToId('');
    setTransferAmount('');
    setTransferNote('');
  };

  const openRename = (w: WalletItem) => {
    setRenameName(w.name ?? '');
    setOpError(null);
    setActiveSheet({ type: 'ubah', wallet: w });
  };

  const openDelete = (w: WalletItem) => {
    setDeleteReplacementId('');
    setOpError(null);
    setActiveSheet({ type: 'hapus', wallet: w });
  };

  const openTransfer = (w: WalletItem) => {
    setTransferToId('');
    setTransferAmount('');
    setTransferNote('');
    setOpError(null);
    setActiveSheet({ type: 'transfer', fromWallet: w });
  };

  // -------------------------------------------------------------------------
  // Aksi submit
  // -------------------------------------------------------------------------

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      setOpError('Nama dompet tidak boleh kosong.');
      return;
    }
    const initial = parseInt(newInitialBalance, 10);
    if (isNaN(initial) || initial < 0) {
      setOpError('Saldo awal harus bilangan bulat tidak negatif.');
      return;
    }
    setOpError(null);
    try {
      await createWallet.mutateAsync({ name, initialBalance: initial });
      closeSheet();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Gagal membuat dompet.');
    }
  };

  const handleRename = async () => {
    if (activeSheet?.type !== 'ubah') return;
    const name = renameName.trim();
    if (!name) {
      setOpError('Nama dompet tidak boleh kosong.');
      return;
    }
    setOpError(null);
    try {
      await renameWallet.mutateAsync({ walletId: activeSheet.wallet.id, name });
      closeSheet();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Gagal mengubah nama dompet.');
    }
  };

  const handleDelete = async () => {
    if (activeSheet?.type !== 'hapus') return;
    setOpError(null);
    try {
      const payload: Record<string, unknown> = { walletId: activeSheet.wallet.id };
      if (deleteReplacementId) payload.replacementWalletId = deleteReplacementId;
      await deleteWallet.mutateAsync(payload);
      closeSheet();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Gagal menghapus dompet.');
    }
  };

  const handleTransfer = async () => {
    if (activeSheet?.type !== 'transfer') return;
    if (!transferToId) {
      setOpError('Pilih dompet tujuan.');
      return;
    }
    const amount = parseInt(transferAmount, 10);
    if (isNaN(amount) || amount <= 0) {
      setOpError('Nominal harus bilangan bulat lebih dari 0.');
      return;
    }
    setOpError(null);
    try {
      await transferFunds.mutateAsync({
        fromWalletId: activeSheet.fromWallet.id,
        toWalletId: transferToId,
        amount,
        ...(transferNote.trim() ? { note: transferNote.trim() } : {}),
      });
      closeSheet();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Gagal memindahkan dana.');
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const totalBalance = wallets?.reduce((sum, w) => sum + (w.balance ?? 0), 0) ?? 0;

  const otherWallets =
    activeSheet?.type === 'hapus'
      ? (wallets ?? []).filter((w) => w.id !== activeSheet.wallet.id)
      : activeSheet?.type === 'transfer'
        ? (wallets ?? []).filter((w) => w.id !== activeSheet.fromWallet.id)
        : [];

  return (
    <div style={{ paddingBottom: 96 }}>
      {/* Judul halaman */}
      <LargeTitle title="Dompet" />

      {/* Total saldo */}
      <SoftCard style={{ marginBottom: 16, textAlign: 'center' }}>
        <p
          style={{
            margin: '0 0 4px',
            fontSize: 'var(--font-size-caption, 13px)',
            color: 'var(--color-ink-muted, #6b7280)',
          }}
        >
          Total Saldo
        </p>
        <AmountDisplay
          amount={totalBalance}
          style={{ fontSize: 28, fontWeight: 700 }}
        />
      </SoftCard>

      {/* Tombol tambah dompet */}
      <button
        type="button"
        onClick={() => {
          setOpError(null);
          setActiveSheet({ type: 'tambah' });
        }}
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
        + Tambah Dompet
      </button>

      {/* Galat muat */}
      {loadError && (
        <SoftCard style={{ marginBottom: 12, color: 'var(--color-expense, #c0392b)' }}>
          {loadError.message}
        </SoftCard>
      )}

      {/* Keadaan memuat */}
      {isPending && (
        <>
          <Skeleton height={72} style={{ marginBottom: 8 }} />
          <Skeleton height={72} style={{ marginBottom: 8 }} />
          <Skeleton height={72} />
        </>
      )}

      {/* Keadaan kosong */}
      {!isPending && !loadError && wallets?.length === 0 && (
        <EmptyState
          icon="👛"
          title="Belum ada dompet"
          description="Tambahkan dompet pertama Anda untuk mulai mencatat keuangan."
        />
      )}

      {/* Daftar dompet */}
      {!isPending &&
        wallets?.map((wallet) => (
          <WalletRow
            key={wallet.id}
            wallet={wallet}
            onRename={openRename}
            onDelete={openDelete}
            onTransfer={openTransfer}
          />
        ))}

      {/* BottomSheet: Tambah Dompet */}
      <BottomSheet
        open={activeSheet?.type === 'tambah'}
        onClose={closeSheet}
        title="Tambah Dompet"
        sheetKey="tambah-dompet"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <FormField label="Nama Dompet" htmlFor="wallet-name">
            <input
              id="wallet-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Contoh: Tunai, BCA, GoPay"
              style={inputStyle}
            />
          </FormField>
          <FormField label="Saldo Awal (Rp)" htmlFor="wallet-initial-balance">
            <input
              id="wallet-initial-balance"
              type="text"
              inputMode="numeric"
              value={newInitialBalance}
              onChange={(e) => setNewInitialBalance(e.target.value.replace(/\D/g, ''))}
              placeholder="0"
              style={inputStyle}
            />
          </FormField>
          {opError && <ErrorMessage>{opError}</ErrorMessage>}
          <SubmitButton
            onClick={() => void handleCreate()}
            loading={createWallet.isPending}
          >
            Simpan
          </SubmitButton>
        </div>
      </BottomSheet>

      {/* BottomSheet: Ubah Nama Dompet */}
      <BottomSheet
        open={activeSheet?.type === 'ubah'}
        onClose={closeSheet}
        title="Ubah Nama Dompet"
        sheetKey="ubah-dompet"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <FormField label="Nama Baru" htmlFor="wallet-rename">
            <input
              id="wallet-rename"
              type="text"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              style={inputStyle}
            />
          </FormField>
          {opError && <ErrorMessage>{opError}</ErrorMessage>}
          <SubmitButton
            onClick={() => void handleRename()}
            loading={renameWallet.isPending}
          >
            Simpan
          </SubmitButton>
        </div>
      </BottomSheet>

      {/* BottomSheet: Hapus Dompet */}
      <BottomSheet
        open={activeSheet?.type === 'hapus'}
        onClose={closeSheet}
        title="Hapus Dompet"
        sheetKey="hapus-dompet"
      >
        {activeSheet?.type === 'hapus' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0 }}>
              Yakin ingin menghapus dompet{' '}
              <strong>{activeSheet.wallet.name}</strong>?
            </p>
            {otherWallets.length > 0 && (
              <FormField
                label="Pindahkan Transaksi ke (opsional)"
                htmlFor="wallet-replacement"
              >
                <select
                  id="wallet-replacement"
                  value={deleteReplacementId}
                  onChange={(e) => setDeleteReplacementId(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">— Tanpa pemindahan —</option>
                  {otherWallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </FormField>
            )}
            {opError && <ErrorMessage>{opError}</ErrorMessage>}
            <SubmitButton
              onClick={() => void handleDelete()}
              loading={deleteWallet.isPending}
              variant="danger"
            >
              Hapus Dompet
            </SubmitButton>
          </div>
        )}
      </BottomSheet>

      {/* BottomSheet: Pindah Dana */}
      <BottomSheet
        open={activeSheet?.type === 'transfer'}
        onClose={closeSheet}
        title="Pindah Dana"
        sheetKey="pindah-dana"
      >
        {activeSheet?.type === 'transfer' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0 }}>
              Dari: <strong>{activeSheet.fromWallet.name}</strong>
            </p>
            <FormField label="Dompet Tujuan" htmlFor="transfer-to">
              <select
                id="transfer-to"
                value={transferToId}
                onChange={(e) => setTransferToId(e.target.value)}
                style={inputStyle}
              >
                <option value="">— Pilih dompet —</option>
                {otherWallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Nominal (Rp)" htmlFor="transfer-amount">
              <input
                id="transfer-amount"
                type="text"
                inputMode="numeric"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value.replace(/\D/g, ''))}
                placeholder="Masukkan nominal"
                style={inputStyle}
              />
            </FormField>
            <FormField label="Catatan (opsional)" htmlFor="transfer-note">
              <input
                id="transfer-note"
                type="text"
                value={transferNote}
                onChange={(e) => setTransferNote(e.target.value)}
                placeholder="Contoh: top up"
                style={inputStyle}
              />
            </FormField>
            {opError && <ErrorMessage>{opError}</ErrorMessage>}
            <SubmitButton
              onClick={() => void handleTransfer()}
              loading={transferFunds.isPending}
            >
              Pindahkan Dana
            </SubmitButton>
          </div>
        )}
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
  variant = 'primary',
}: {
  onClick: () => void;
  loading: boolean;
  children: React.ReactNode;
  variant?: 'primary' | 'danger';
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
        background:
          variant === 'danger'
            ? 'var(--color-expense, #c0392b)'
            : 'var(--color-brand-blue, #005DAC)',
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

export default WalletsPage;
