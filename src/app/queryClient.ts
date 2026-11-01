/**
 * Instance QueryClient bersama (Tugas 12.1).
 *
 * Setelan default:
 * - `staleTime` 60 detik: data dianggap segar selama 1 menit, mengurangi
 *   refetch berlebih pada navigasi.
 * - `gcTime` 5 menit: cache dibersihkan 5 menit setelah komponen unmount.
 * - `retry` 1: gagal sekali lagi sebelum menyerah, cukup untuk transient error.
 * - `refetchOnWindowFocus` false: tidak refetch otomatis saat pengguna pindah
 *   tab — cocok untuk data keuangan yang dimutasi lewat Lambda.
 */
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,        // 60 detik
      gcTime: 5 * 60 * 1000,       // 5 menit
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
