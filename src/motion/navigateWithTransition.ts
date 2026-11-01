/**
 * Transisi halaman (Req 17.5, 17.6, 17.11).
 *
 * Memakai `document.startViewTransition` bila tersedia dan Gerak_Berkurang
 * tidak aktif. Bila API tidak didukung peramban atau gerak dikurangi,
 * `go()` dipanggil langsung sehingga fallback CSS pada `motion.css`
 * (kelas `.arto-route-enter`, pudar 80 ms saat `data-motion="reduced"`)
 * yang menangani transisi.
 */

interface ViewTransition {
  finished: Promise<void>;
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition: () => void;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => ViewTransition;
};

/**
 * Jalankan navigasi `go` dengan transisi View Transitions API bila mungkin.
 *
 * @param go Fungsi yang benar-benar melakukan navigasi (misalnya
 * `navigate(to)` dari react-router). Harus sinkron atau mengembalikan
 * Promise yang diselesaikan setelah DOM baru ter-render.
 * @param reduced Status Gerak_Berkurang saat ini (dari `useReducedMotion`).
 */
export function navigateWithTransition(go: () => void | Promise<void>, reduced: boolean): void {
  const doc = typeof document !== 'undefined' ? (document as ViewTransitionDocument) : undefined;

  if (!reduced && doc && typeof doc.startViewTransition === 'function') {
    doc.startViewTransition(() => {
      void go();
    });
    return;
  }

  void go();
}
