import { type ButtonHTMLAttributes, useEffect } from 'react';
import './components.css';

export interface QuickAddFabProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /**
   * Dipanggil saat tombol ditekan; pemakai membuka `BottomSheet` formulir
   * ringkas Aksi_Cepat_Tambah di sini. Chunk lembar sebaiknya sudah di-prefetch
   * saat idle (lihat `prefetch`) agar terbuka dalam 300 ms.
   */
  onActivate: () => void;
  /**
   * Sembunyikan FAB saat Lembar_Bawah terbuka. Default `false`. Saat `true`,
   * tombol dikeluarkan dari pohon aksesibilitas (tidak ter-render) sehingga
   * tidak menimpa konten lembar.
   */
  sheetOpen?: boolean;
  /**
   * Label aksesibilitas tombol. Default "Tambah transaksi".
   */
  label?: string;
  /**
   * Dipanggil sekali saat peramban idle untuk memuat lebih awal chunk formulir
   * (misalnya `import('...')`). Opsional; bila tidak diberikan, prefetch tidak
   * dilakukan. Dibungkus `requestIdleCallback` bila tersedia.
   */
  prefetch?: () => void;
}

/**
 * QuickAddFab / Aksi_Cepat_Tambah (Req 17.1, 17.2, 17.6, 15.4).
 *
 * Tombol aksi mengambang bulat 56 px yang menempel di kanan bawah
 * (`position: fixed`, `bottom: calc(env(safe-area-inset-bottom) + 72px)`),
 * memakai Warna_Merek Biru dengan ikon `onBlue`. Target sentuh 56 px memenuhi
 * minimal 44 x 44 px (Req 15.4) dan `aria-label` default "Tambah transaksi".
 *
 * Visibilitas per halaman (hanya Beranda, Transaksi, dan Laporan) ditentukan
 * pemakai: FAB cukup tidak dirender pada halaman lain. Saat Lembar_Bawah
 * terbuka, berikan `sheetOpen` agar FAB disembunyikan (Req 17.1).
 *
 * Umpan balik tekan menyusut ke skala 0,96 selama 120 ms lewat kelas CSS
 * `.arto-fab:active` tanpa haptik (Req 17.2, 17.6), dan dinonaktifkan otomatis
 * pada Gerak_Berkurang melalui `[data-motion='reduced']` dan media query.
 *
 * Prefetch chunk formulir dilakukan saat idle (`prefetch`) supaya `BottomSheet`
 * terbuka dalam 300 ms (Req 17.2).
 */
export function QuickAddFab({
  onActivate,
  sheetOpen = false,
  label = 'Tambah transaksi',
  prefetch,
  className,
  type,
  ...rest
}: QuickAddFabProps) {
  useEffect(() => {
    if (!prefetch || typeof window === 'undefined') return;

    const ric = (
      window as typeof window & {
        requestIdleCallback?: (cb: () => void) => number;
        cancelIdleCallback?: (handle: number) => void;
      }
    ).requestIdleCallback;
    const cic = (
      window as typeof window & {
        cancelIdleCallback?: (handle: number) => void;
      }
    ).cancelIdleCallback;

    if (typeof ric === 'function') {
      const handle = ric(() => prefetch());
      return () => {
        if (typeof cic === 'function') cic(handle);
      };
    }

    const timer = setTimeout(() => prefetch(), 200);
    return () => clearTimeout(timer);
  }, [prefetch]);

  // Saat lembar terbuka, FAB tidak dirender agar tidak menumpuk di atas lembar
  // dan tidak ikut dalam urutan fokus/pembaca layar (Req 17.1).
  if (sheetOpen) return null;

  const classes = ['arto-fab', className].filter(Boolean).join(' ');

  return (
    <button
      type={type ?? 'button'}
      className={classes}
      aria-label={label}
      onClick={onActivate}
      {...rest}
    >
      {/* Ikon tambah dalam Warna_onBlue; disembunyikan dari pembaca layar
          karena label tombol sudah menjelaskan aksi. */}
      <svg
        className="arto-fab__icon"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M12 5v14M5 12h14"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

export default QuickAddFab;
