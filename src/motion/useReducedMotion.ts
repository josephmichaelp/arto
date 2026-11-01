import { useEffect, useState } from 'react';
import { type MotionSpec, resolveMotion } from '../../shared/domain/motion';

const QUERY = '(prefers-reduced-motion: reduce)';

/** Mengambil status Gerak_Berkurang awal tanpa bergantung pada efek React. */
function readReduced(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

/**
 * Hook Gerak_Berkurang (Req 17.5, 17.6, 17.11).
 *
 * Membaca `matchMedia('(prefers-reduced-motion: reduce)')`, berlangganan
 * perubahan preferensi sistem saat berjalan, dan memasang/menghapus atribut
 * `data-motion="reduced"` pada `<html>` agar `src/theme/global.css` dan
 * `src/motion/motion.css` dapat memetakan variabel `--dur-*` ke pudar
 * instan tanpa bergantung pada state React di setiap komponen.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(readReduced);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mql = window.matchMedia(QUERY);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);

    // Sinkronkan ulang segera setelah mount (misalnya nilai berubah antara
    // render pertama dan efek ini pada lingkungan uji).
    setReduced(mql.matches);

    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }

    // Safari lama tidak mendukung addEventListener pada MediaQueryList.
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (reduced) {
      root.setAttribute('data-motion', 'reduced');
    } else {
      root.removeAttribute('data-motion');
    }
  }, [reduced]);

  return reduced;
}

/**
 * Menghubungkan status Gerak_Berkurang dengan `resolveMotion` dari
 * `shared/domain/motion.ts`, sehingga komponen cukup memanggil hook ini
 * untuk mendapatkan `MotionSpec` yang sudah disesuaikan tanpa mengulang
 * logika pemangkasan durasi/transformasi di setiap tempat.
 */
export function useResolvedMotion(spec: MotionSpec): MotionSpec {
  const reduced = useReducedMotion();
  return resolveMotion(spec, reduced);
}
