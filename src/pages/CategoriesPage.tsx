/**
 * CategoriesPage — Halaman Kategori (Tugas 12.4).
 *
 * Menampilkan seluruh Kategori Pengguna (bawaan + kustom) dikelompokkan
 * berdasarkan jenis (EXPENSE / INCOME), dan menyediakan aksi: buat, ubah
 * nama, serta hapus dengan pemilih pengganti bila Kategori memiliki Transaksi.
 *
 * Design System: LargeTitle, SoftCard, Skeleton, EmptyState, BottomSheet.
 *
 * Requirements: 3.2, 3.3, 3.4, 3.5
 */

import React, { useState } from 'react';
import { LargeTitle } from '../components/LargeTitle';
import { SoftCard } from '../components/SoftCard';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { BottomSheet } from '../components/BottomSheet';
import {
  useCategories,
  useCreateCategory,
  useRenameCategory,
  useDeleteCategoryWithReassign,
} from '../hooks';
import type { CategoryItem } from '../hooks';

// ---------------------------------------------------------------------------
// Tipe state lokal
// ---------------------------------------------------------------------------

type ActiveSheet =
  | { type: 'tambah' }
  | { type: 'ubah'; category: CategoryItem }
  | { type: 'hapus'; category: CategoryItem };

// ---------------------------------------------------------------------------
// Komponen pembantu: baris satu Kategori
// ---------------------------------------------------------------------------

interface CategoryRowProps {
  category: CategoryItem;
  onRename: (c: CategoryItem) => void;
  onDelete: (c: CategoryItem) => void;
}

function CategoryRow({ category, onRename, onDelete }: CategoryRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 0',
        borderBottom: '1px solid rgba(31,36,48,0.08)',
      }}
    >
      <span
        style={{
          flex: 1,
          fontWeight: 500,
          fontSize: 'var(--font-size-body, 16px)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {category.name}
      </span>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <ActionButton onClick={() => onRename(category)} label="Ubah nama" icon="✏️" />
        <ActionButton onClick={() => onDelete(category)} label="Hapus" icon="🗑" />
      </div>
    </div>
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

export function CategoriesPage() {
  const { data: categories, isPending, error: loadError } = useCategories();

  const createCategory = useCreateCategory();
  const renameCategory = useRenameCategory();
  const deleteCategory = useDeleteCategoryWithReassign();

  const [activeSheet, setActiveSheet] = useState<ActiveSheet | null>(null);

  // Form state — buat
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');

  // Form state — ubah nama
  const [renameName, setRenameName] = useState('');

  // Form state — hapus
  const [deleteReplacementId, setDeleteReplacementId] = useState('');

  // Error message dari operasi
  const [opError, setOpError] = useState<string | null>(null);

  const closeSheet = () => {
    setActiveSheet(null);
    setOpError(null);
    setNewName('');
    setNewType('EXPENSE');
    setRenameName('');
    setDeleteReplacementId('');
  };

  const openRename = (c: CategoryItem) => {
    setRenameName(c.name ?? '');
    setOpError(null);
    setActiveSheet({ type: 'ubah', category: c });
  };

  const openDelete = (c: CategoryItem) => {
    setDeleteReplacementId('');
    setOpError(null);
    setActiveSheet({ type: 'hapus', category: c });
  };

  // -------------------------------------------------------------------------
  // Aksi submit
  // -------------------------------------------------------------------------

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      setOpError('Nama kategori tidak boleh kosong.');
      return;
    }
    setOpError(null);
    try {
      await createCategory.mutateAsync({ name, type: newType });
      closeSheet();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Gagal membuat kategori.');
    }
  };

  const handleRename = async () => {
    if (activeSheet?.type !== 'ubah') return;
    const name = renameName.trim();
    if (!name) {
      setOpError('Nama kategori tidak boleh kosong.');
      return;
    }
    setOpError(null);
    try {
      await renameCategory.mutateAsync({ categoryId: activeSheet.category.id, name });
      closeSheet();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Gagal mengubah nama kategori.');
    }
  };

  const handleDelete = async () => {
    if (activeSheet?.type !== 'hapus') return;
    setOpError(null);
    try {
      const payload: Record<string, unknown> = { categoryId: activeSheet.category.id };
      if (deleteReplacementId) payload.replacementCategoryId = deleteReplacementId;
      await deleteCategory.mutateAsync(payload);
      closeSheet();
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Gagal menghapus kategori.');
    }
  };

  // -------------------------------------------------------------------------
  // Kelompokkan kategori berdasarkan jenis
  // -------------------------------------------------------------------------

  const expenseCategories = categories?.filter((c) => c.type === 'EXPENSE') ?? [];
  const incomeCategories = categories?.filter((c) => c.type === 'INCOME') ?? [];

  // Daftar pengganti untuk delete (jenis yang sama, bukan diri sendiri)
  const deletingCategory =
    activeSheet?.type === 'hapus' ? activeSheet.category : null;
  const replacementOptions = deletingCategory
    ? (categories ?? []).filter(
        (c) => c.id !== deletingCategory.id && c.type === deletingCategory.type
      )
    : [];

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div style={{ paddingBottom: 96 }}>
      {/* Judul halaman */}
      <LargeTitle title="Kategori" />

      {/* Tombol tambah kategori */}
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
        + Tambah Kategori
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
          <Skeleton height={200} style={{ marginBottom: 16 }} />
          <Skeleton height={200} />
        </>
      )}

      {/* Keadaan kosong */}
      {!isPending && !loadError && categories?.length === 0 && (
        <EmptyState
          icon="🏷️"
          title="Belum ada kategori"
          description="Tambahkan kategori untuk mulai mengelompokkan transaksi."
        />
      )}

      {/* Kelompok Pengeluaran */}
      {!isPending && expenseCategories.length > 0 && (
        <SoftCard style={{ marginBottom: 16 }}>
          <SectionHeading label="Pengeluaran" count={expenseCategories.length} />
          {expenseCategories.map((cat) => (
            <CategoryRow
              key={cat.id}
              category={cat}
              onRename={openRename}
              onDelete={openDelete}
            />
          ))}
        </SoftCard>
      )}

      {/* Kelompok Pemasukan */}
      {!isPending && incomeCategories.length > 0 && (
        <SoftCard style={{ marginBottom: 16 }}>
          <SectionHeading label="Pemasukan" count={incomeCategories.length} />
          {incomeCategories.map((cat) => (
            <CategoryRow
              key={cat.id}
              category={cat}
              onRename={openRename}
              onDelete={openDelete}
            />
          ))}
        </SoftCard>
      )}

      {/* BottomSheet: Tambah Kategori */}
      <BottomSheet
        open={activeSheet?.type === 'tambah'}
        onClose={closeSheet}
        title="Tambah Kategori"
        sheetKey="tambah-kategori"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <FormField label="Nama Kategori" htmlFor="cat-name">
            <input
              id="cat-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Contoh: Makanan, Transportasi"
              style={inputStyle}
            />
          </FormField>
          <FormField label="Jenis" htmlFor="cat-type">
            <select
              id="cat-type"
              value={newType}
              onChange={(e) => setNewType(e.target.value as 'EXPENSE' | 'INCOME')}
              style={inputStyle}
            >
              <option value="EXPENSE">Pengeluaran</option>
              <option value="INCOME">Pemasukan</option>
            </select>
          </FormField>
          {opError && <ErrorMessage>{opError}</ErrorMessage>}
          <SubmitButton
            onClick={() => void handleCreate()}
            loading={createCategory.isPending}
          >
            Simpan
          </SubmitButton>
        </div>
      </BottomSheet>

      {/* BottomSheet: Ubah Nama Kategori */}
      <BottomSheet
        open={activeSheet?.type === 'ubah'}
        onClose={closeSheet}
        title="Ubah Nama Kategori"
        sheetKey="ubah-kategori"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <FormField label="Nama Baru" htmlFor="cat-rename">
            <input
              id="cat-rename"
              type="text"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              style={inputStyle}
            />
          </FormField>
          {opError && <ErrorMessage>{opError}</ErrorMessage>}
          <SubmitButton
            onClick={() => void handleRename()}
            loading={renameCategory.isPending}
          >
            Simpan
          </SubmitButton>
        </div>
      </BottomSheet>

      {/* BottomSheet: Hapus Kategori */}
      <BottomSheet
        open={activeSheet?.type === 'hapus'}
        onClose={closeSheet}
        title="Hapus Kategori"
        sheetKey="hapus-kategori"
      >
        {activeSheet?.type === 'hapus' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0 }}>
              Yakin ingin menghapus kategori{' '}
              <strong>{activeSheet.category.name}</strong>?
            </p>
            {replacementOptions.length > 0 && (
              <FormField
                label="Pindahkan Transaksi ke (opsional)"
                htmlFor="cat-replacement"
              >
                <select
                  id="cat-replacement"
                  value={deleteReplacementId}
                  onChange={(e) => setDeleteReplacementId(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">— Tanpa pemindahan —</option>
                  {replacementOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </FormField>
            )}
            {opError && <ErrorMessage>{opError}</ErrorMessage>}
            <SubmitButton
              onClick={() => void handleDelete()}
              loading={deleteCategory.isPending}
              variant="danger"
            >
              Hapus Kategori
            </SubmitButton>
          </div>
        )}
      </BottomSheet>
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
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        marginBottom: 4,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 'var(--font-size-caption, 13px)',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-ink-muted, #6b7280)',
        }}
      >
        {label}
      </h2>
      <span
        style={{
          fontSize: 'var(--font-size-caption, 13px)',
          color: 'var(--color-ink-muted, #6b7280)',
        }}
      >
        {count}
      </span>
    </div>
  );
}

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

export default CategoriesPage;
