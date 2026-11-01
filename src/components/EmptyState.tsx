/**
 * EmptyState — menampilkan keadaan kosong berbahasa Indonesia (Req 8.4, 15.1).
 *
 * Dipakai saat daftar tidak memiliki data atau hasil filter kosong. Mendukung:
 * - `title`: judul singkat (wajib).
 * - `description`: deskripsi opsional untuk konteks tambahan.
 * - `action`: komponen tombol/tautan opsional (misalnya "Tambah Transaksi").
 * - `icon`: ikon atau ilustrasi opsional (string emoji atau ReactNode).
 */
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** Judul pesan keadaan kosong, wajib ada. */
  title: string;
  /** Deskripsi opsional yang menjelaskan mengapa kosong atau apa yang harus dilakukan. */
  description?: string;
  /** Komponen tombol atau tautan untuk aksi utama. */
  action?: ReactNode;
  /** Ikon atau ilustrasi; boleh emoji string atau elemen React. */
  icon?: ReactNode;
  /** Kelas CSS tambahan untuk kontainer terluar. */
  className?: string;
}

export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div
      className={['arto-empty-state', className].filter(Boolean).join(' ')}
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: '40px 24px',
        textAlign: 'center',
        color: 'var(--color-ink-muted, #6b7280)',
      }}
    >
      {icon !== undefined && (
        <span
          aria-hidden="true"
          style={{ fontSize: 48, lineHeight: 1, display: 'block' }}
        >
          {icon}
        </span>
      )}

      <p
        style={{
          margin: 0,
          fontSize: 'var(--font-size-body, 16px)',
          fontWeight: 600,
          color: 'var(--color-ink, #1f2430)',
        }}
      >
        {title}
      </p>

      {description && (
        <p
          style={{
            margin: 0,
            fontSize: 'var(--font-size-caption, 13px)',
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      )}

      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

export default EmptyState;
