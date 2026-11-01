import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import './components.css';

export interface SoftCardProps extends HTMLAttributes<HTMLElement> {
  /** Elemen HTML yang dirender. Default `div`. */
  as?: ElementType;
  /** Nonaktifkan padding bawaan bila kartu mengatur tata letak sendiri. */
  noPadding?: boolean;
  children?: ReactNode;
}

/**
 * SoftCard (Req 17.9): wadah konten Kartu_Lembut di atas Latar_Gradien.
 * Memakai kelas `.soft-card` dari `src/theme/global.css` yang menetapkan
 * latar solid opak dan `border-radius: var(--radius-card)` (20 px, memenuhi
 * syarat minimal 16 px). Karena permukaannya opak, teks di dalamnya selalu
 * memenuhi kontras minimal 4,5:1 (Req 17.13).
 */
export function SoftCard({
  as,
  noPadding = false,
  className,
  children,
  ...rest
}: SoftCardProps) {
  const Element = (as ?? 'div') as ElementType;
  const classes = ['soft-card', noPadding ? null : 'arto-soft-card', className]
    .filter(Boolean)
    .join(' ');

  return (
    <Element className={classes} {...rest}>
      {children}
    </Element>
  );
}

export default SoftCard;
