import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { MOTION_TOKENS, resolveMotion } from '../../shared/domain/motion';
import { shouldDismissSheet } from '../../shared/domain/sheet';
import { useReducedMotion } from '../motion/useReducedMotion';
import './components.css';

export interface BottomSheetProps {
  /** Apakah Lembar_Bawah terbuka (terkendali oleh induk). */
  open: boolean;
  /** Dipanggil saat lembar harus ditutup (scrim, tombol Tutup, Escape, atau geser). */
  onClose: () => void;
  /** Judul lembar; dipakai sebagai label aksesibilitas (`aria-labelledby`). */
  title: string;
  /**
   * Kunci status pada URL query `?sheet=`. Bila diberikan, lembar mendorong
   * entri riwayat `?sheet=<key>` saat terbuka dan menutup lewat tombol kembali
   * peramban. Kosongkan untuk melewati sinkronisasi URL (mis. pada uji murni).
   */
  sheetKey?: string;
  /** Label tombol Tutup untuk pembaca layar. Default "Tutup". */
  closeLabel?: string;
  children?: ReactNode;
}

/**
 * Jarak geser minimal (px) sebelum kecepatan boleh menutup lembar. Mencegah
 * sentuhan/nudge kecil yang cepat ikut menutup; lemparan nyata menempuh jauh
 * lebih dari ini. Keputusan rasio (`DISMISS_RATIO`) tidak terpengaruh.
 */
const MIN_FLICK_DISTANCE_PX = 48;

/** Selektor elemen yang dapat menerima fokus untuk kuncian fokus. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * BottomSheet / Lembar_Bawah (Req 17.2, 17.3, 17.4, 17.11, 15.4).
 *
 * Dialog modal yang muncul dari bawah layar. Memenuhi:
 * - `role="dialog"`, `aria-modal="true"`, dan `aria-labelledby` ke judul.
 * - Kuncian fokus di dalam lembar dan pengembalian fokus ke pemicu saat tutup.
 * - `Escape` menutup; latar di luar lembar diberi atribut `inert`.
 * - Status buka tercermin di URL query `?sheet=<sheetKey>` (opsional).
 * - Tutup lewat scrim, tombol Tutup (target >= 44 px), atau geser ke bawah
 *   (Pointer Events + `transform: translateY`) memakai `shouldDismissSheet`.
 * - Gerak buka 280 ms dan tutup 220 ms lewat `resolveMotion`; pada
 *   Gerak_Berkurang berubah menjadi pudar instan tanpa transformasi.
 * - Tinggi maksimal mengikuti `visualViewport` agar aman di atas papan ketik.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  sheetKey,
  closeLabel = 'Tutup',
  children,
}: BottomSheetProps) {
  const reduced = useReducedMotion();
  const titleId = useId();

  const rootRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Mount terpisah dari visibilitas agar animasi keluar sempat berjalan.
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(false);

  // Keadaan geser (drag-to-dismiss).
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ y: number; t: number } | null>(null);

  // Tinggi maksimal mengikuti visualViewport.
  const [maxHeight, setMaxHeight] = useState<string>('90vh');

  const openSpec = resolveMotion(MOTION_TOKENS.sheetOpen, reduced);
  const closeSpec = resolveMotion(MOTION_TOKENS.sheetClose, reduced);

  // --- Siklus mount/animasi buka-tutup -------------------------------------
  useEffect(() => {
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (open) {
      setRendered(true);
      // Pasang transform awal (tersembunyi) lalu animasikan ke tampak.
      raf = requestAnimationFrame(() => setVisible(true));
    } else if (rendered) {
      setVisible(false);
      timer = setTimeout(() => {
        setRendered(false);
        setDragY(0);
      }, closeSpec.durationMs);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
    // closeSpec.durationMs stabil untuk nilai `reduced` tertentu.
  }, [open, rendered, closeSpec.durationMs]);

  // --- Tinggi mengikuti visualViewport -------------------------------------
  useEffect(() => {
    if (!rendered || typeof window === 'undefined') return;
    const vv = window.visualViewport;
    const apply = () => {
      const h = vv?.height ?? window.innerHeight;
      if (h > 0) setMaxHeight(`${Math.round(h * 0.9)}px`);
    };
    apply();
    vv?.addEventListener('resize', apply);
    window.addEventListener('resize', apply);
    return () => {
      vv?.removeEventListener('resize', apply);
      window.removeEventListener('resize', apply);
    };
  }, [rendered]);

  // --- Kuncian & pengembalian fokus ----------------------------------------
  useEffect(() => {
    if (!open) return;
    if (typeof document === 'undefined') return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    // Fokus awal ke elemen fokusabel pertama di dalam lembar.
    const focusFirst = () => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      const focusable = getFocusable(sheet);
      (focusable[0] ?? sheet).focus();
    };
    const raf = requestAnimationFrame(focusFirst);

    return () => {
      cancelAnimationFrame(raf);
      // Kembalikan fokus ke pemicu.
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // --- Latar `inert` saat terbuka ------------------------------------------
  useEffect(() => {
    if (!rendered || typeof document === 'undefined') return;
    const root = rootRef.current;
    const marked: HTMLElement[] = [];
    for (const child of Array.from(document.body.children)) {
      const el = child as HTMLElement;
      if (root && el.contains(root)) continue;
      if (!el.hasAttribute('inert')) {
        el.setAttribute('inert', '');
        marked.push(el);
      }
    }
    return () => {
      for (const el of marked) el.removeAttribute('inert');
    };
  }, [rendered]);

  // --- Escape menutup -------------------------------------------------------
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      } else if (event.key === 'Tab') {
        const sheet = sheetRef.current;
        if (!sheet) return;
        const focusable = getFocusable(sheet);
        if (focusable.length === 0) {
          event.preventDefault();
          sheet.focus();
          return;
        }
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === sheet)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  // --- Sinkronisasi status buka ke URL query `?sheet=` ---------------------
  useEffect(() => {
    if (!open || !sheetKey || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('sheet', sheetKey);
    window.history.pushState({ artoSheet: sheetKey }, '', url);

    const onPopState = () => {
      const current = new URL(window.location.href).searchParams.get('sheet');
      if (current !== sheetKey) onClose();
    };
    window.addEventListener('popstate', onPopState);

    return () => {
      window.removeEventListener('popstate', onPopState);
      // Hapus parameter bila masih ada (tutup bukan lewat tombol kembali).
      const now = new URL(window.location.href);
      if (now.searchParams.get('sheet') === sheetKey) {
        now.searchParams.delete('sheet');
        window.history.replaceState({}, '', now);
      }
    };
  }, [open, sheetKey, onClose]);

  // --- Geser ke bawah untuk menutup ----------------------------------------
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    // Hanya mulai geser dari gagang/header, bukan dari konten yang bisa digulir.
    dragStart.current = { y: event.clientY, t: event.timeStamp };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const dy = event.clientY - dragStart.current.y;
    setDragY(dy > 0 ? dy : 0);
  }, []);

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragStart.current) return;
      const dy = event.clientY - dragStart.current.y;
      const dt = Math.max(1, event.timeStamp - dragStart.current.t);
      // Kecepatan hanya dihitung bila geser menempuh jarak berarti; nudge
      // kecil tak boleh menutup lewat jalur kecepatan.
      const velocity = dy >= MIN_FLICK_DISTANCE_PX ? dy / dt : 0;
      const height = sheetRef.current?.offsetHeight ?? 0;
      dragStart.current = null;
      setDragging(false);
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      if (shouldDismissSheet(dy, height, velocity)) {
        onClose();
      } else {
        setDragY(0);
      }
    },
    [onClose],
  );

  if (!rendered) return null;

  const activeSpec = visible ? openSpec : closeSpec;
  const sheetTransform =
    dragY > 0 ? `translateY(${dragY}px)` : undefined;

  return (
    <div className="arto-sheet-root" ref={rootRef}>
      <div
        className="arto-sheet-scrim"
        data-visible={visible}
        style={{ transitionDuration: `${activeSpec.durationMs}ms` }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="arto-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={sheetRef}
        data-visible={visible}
        data-dragging={dragging}
        data-motion={reduced ? 'reduced' : undefined}
        style={{
          maxHeight,
          transform: sheetTransform,
          transitionDuration: dragging ? '0ms' : `${activeSpec.durationMs}ms`,
          transitionTimingFunction: activeSpec.easing,
        }}
      >
        <div
          className="arto-sheet__handle-area"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className="arto-sheet__grabber" aria-hidden="true" />
        </div>
        <div className="arto-sheet__header">
          <h2 className="arto-sheet__title" id={titleId}>
            {title}
          </h2>
          <button
            type="button"
            className="arto-sheet__close"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
        <div className="arto-sheet__body">{children}</div>
      </div>
    </div>
  );
}

export default BottomSheet;
