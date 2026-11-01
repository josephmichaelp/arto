import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import './components.css';

export interface GlassBarProps extends HTMLAttributes<HTMLElement> {
  /** Posisi bilah: menempel di atas atau di bawah layar. Default `top`. */
  position?: 'top' | 'bottom';
  /** Elemen HTML yang dirender. Default menyesuaikan posisi (`header`/`nav`). */
  as?: ElementType;
  children?: ReactNode;
}

/**
 * GlassBar (Req 17.8, 17.12): bilah atas/bawah yang memakai Permukaan_Kaca
 * lewat kelas `.glass` dari `src/theme/global.css`. Kelas tersebut sudah
 * menyediakan fallback solid semi-opak lalu peningkatan `backdrop-filter`
 * via `@supports`, sehingga kontras teks tetap >= 4,5:1 pada peramban tanpa
 * dukungan blur.
 *
 * Catatan performa: maksimal tiga lapisan `.glass` per layar (lihat komentar
 * pada `global.css`). Batas ini dijaga di tingkat pemakaian komponen.
 */
export function GlassBar({
  position = 'top',
  as,
  className,
  children,
  ...rest
}: GlassBarProps) {
  const Element = (as ?? (position === 'bottom' ? 'nav' : 'header')) as ElementType;
  const classes = [
    'glass',
    'arto-glass-bar',
    position === 'bottom' ? 'arto-glass-bar--bottom' : 'arto-glass-bar--top',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Element className={classes} {...rest}>
      {children}
    </Element>
  );
}

export default GlassBar;
