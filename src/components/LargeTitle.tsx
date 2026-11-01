import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useReducedMotion } from '../motion/useReducedMotion';
import './components.css';

/** Jarak gulir (px) saat Judul_Besar selesai mengecil menjadi judul ringkas. */
const SHRINK_DISTANCE = 56;

/** clamp(scrollTop / 56, 0, 1) sesuai dokumen desain. */
function computeProgress(scrollTop: number): number {
  const p = scrollTop / SHRINK_DISTANCE;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return p;
}

export interface LargeTitleProps {
  /** Teks Judul_Besar, juga dipakai sebagai judul ringkas bila tak ada `compact`. */
  title: string;
  /** Judul ringkas opsional untuk keadaan tergulir. Default sama dengan `title`. */
  compact?: string;
  /**
   * Wadah yang digulir. Bila diberikan, progres dihitung dari `scrollTop`
   * elemen tersebut; jika tidak, dipakai `window.scrollY`.
   */
  scrollRef?: RefObject<HTMLElement | null>;
  /** Konten tambahan (misalnya subjudul) yang ikut memudar bersama Judul_Besar. */
  children?: ReactNode;
}

/**
 * LargeTitle (Req 17.7, 17.11): Judul_Besar pada halaman utama yang mengecil
 * menjadi judul ringkas saat digulir.
 *
 * Progres `p = clamp(scrollTop / 56, 0, 1)` dihitung dari sentinel via
 * `IntersectionObserver` bila tersedia, dengan pendengar gulir pasif sebagai
 * cadangan. Hanya `transform` dan `opacity` yang dianimasikan demi 60 fps.
 * Saat Gerak_Berkurang aktif, peralihan bersifat instan: `p` dipaksa ke 0
 * atau 1 (tanpa keadaan antara) sehingga judul langsung berganti.
 */
export function LargeTitle({ title, compact, scrollRef, children }: LargeTitleProps) {
  const reduced = useReducedMotion();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const target = scrollRef?.current ?? null;

    const readScrollTop = (): number => {
      if (target) return target.scrollTop;
      if (typeof window !== 'undefined') return window.scrollY || 0;
      return 0;
    };

    const update = () => setProgress(computeProgress(readScrollTop()));

    // Hitung sekali di awal agar posisi gulir awal (misalnya kembali ke
    // halaman yang sudah tergulir) langsung tercermin.
    update();

    const scrollSource: HTMLElement | Window | null = target
      ? target
      : typeof window !== 'undefined'
        ? window
        : null;

    if (!scrollSource) return;

    scrollSource.addEventListener('scroll', update, { passive: true });
    return () => scrollSource.removeEventListener('scroll', update);
  }, [scrollRef]);

  // Gerak_Berkurang: peralihan instan tanpa keadaan antara.
  const p = reduced ? (progress >= 0.5 ? 1 : 0) : progress;

  // Hanya transform & opacity (Req 17.7). Judul mengecil ~0.6x dan menepi
  // sedikit ke atas saat tergulir penuh.
  const bigStyle: CSSProperties = {
    transform: `scale(${(1 - 0.4 * p).toFixed(4)}) translateY(${(-6 * p).toFixed(2)}px)`,
    opacity: 1 - p,
    // Saat sepenuhnya ringkas, Judul_Besar tak lagi menerima interaksi.
    pointerEvents: p >= 1 ? 'none' : undefined,
  };

  const compactStyle: CSSProperties = {
    opacity: p,
  };

  return (
    <header className="arto-large-title" data-progress={p.toFixed(2)}>
      <div ref={sentinelRef} className="arto-large-title__sentinel" aria-hidden="true" />
      <h1 className="arto-large-title__big" style={bigStyle}>
        {title}
      </h1>
      <p className="arto-large-title__compact" style={compactStyle} aria-hidden={p < 0.5}>
        {compact ?? title}
      </p>
      {children}
    </header>
  );
}

export default LargeTitle;
