import type { CSSProperties, HTMLAttributes } from 'react';
import './components.css';

export interface SkeletonProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Lebar placeholder (angka dianggap px). Default mengisi penuh lebar induk. */
  width?: number | string;
  /** Tinggi placeholder (angka dianggap px). Default 16 px (sebaris teks). */
  height?: number | string;
  /**
   * Radius sudut agar sama dengan kartu final (Req 17.10). Default mengikuti
   * `--radius-card` dari token tema. Beri nilai sendiri untuk bentuk lain
   * (misalnya `9999px` untuk avatar bundar).
   */
  radius?: number | string;
  /** Jumlah baris placeholder identik. Default 1. */
  lines?: number;
  /** Teks status untuk pembaca layar. Default "Memuat data". */
  label?: string;
}

function toCssSize(value: number | string | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  return typeof value === 'number' ? `${value}px` : value;
}

/**
 * Skeleton (Req 17.10, 17.11): placeholder yang tampil selama data dimuat.
 *
 * Wadah memakai `aria-busy="true"` dan `role="status"` dengan teks tersembunyi
 * "Memuat data" agar pembaca layar mengumumkan keadaan memuat. Radius sudut
 * mengikuti kartu final (default `--radius-card`). Efek kilau berdurasi
 * 1400 ms dan otomatis berhenti saat Gerak_Berkurang aktif (diatur di
 * `components.css` lewat `[data-motion='reduced']` dan media query).
 */
export function Skeleton({
  width,
  height,
  radius,
  lines = 1,
  label = 'Memuat data',
  className,
  style,
  ...rest
}: SkeletonProps) {
  const count = Math.max(1, Math.floor(lines));
  const barStyle: CSSProperties = {
    width: toCssSize(width, '100%'),
    height: toCssSize(height, '16px'),
    borderRadius: toCssSize(radius, 'var(--radius-card)'),
  };

  const containerClasses = ['arto-skeleton-group', className].filter(Boolean).join(' ');

  return (
    <div
      role="status"
      aria-busy="true"
      className={containerClasses}
      style={{ display: 'grid', gap: '8px', ...style }}
      {...rest}
    >
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="arto-skeleton" style={barStyle} aria-hidden="true" />
      ))}
      <span className="arto-visually-hidden">{label}</span>
    </div>
  );
}

export default Skeleton;
