/**
 * Hook penyiapan data awal akun (Req 3.1, 1.2).
 *
 * Memanggil mutation idempoten `bootstrapUser` pada Lambda `ledger` satu kali
 * setelah Pengguna masuk. Ini menggantikan trigger Cognito
 * `post-confirmation`, yang dilepas karena menimbulkan dependensi sirkular
 * antar nested stack (`auth` -> fungsi trigger -> `data` -> `auth`).
 *
 * Perilaku:
 * - Dijalankan hanya bila `sub` sudah diketahui dan Amplify terkonfigurasi.
 * - Setelah berhasil, keberhasilan ditandai di `localStorage` per `sub`
 *   sehingga pembukaan aplikasi berikutnya tidak memanggil ulang. Mutationnya
 *   sendiri idempoten, jadi kehilangan tanda ini tidak merusak apa pun.
 * - Bila gagal, `ready` tetap menjadi `true` agar aplikasi tidak terkunci;
 *   halaman akan menampilkan keadaan kosong dan galat dapat ditampilkan
 *   pemanggil.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { loadAmplifyOutputs } from '../app/amplify';
import { getDataClient } from '../app/dataClient';

const STORAGE_PREFIX = 'arto:bootstrap:';

/** Kunci `localStorage` penanda penyiapan selesai untuk sebuah `sub`. */
export function bootstrapDoneKey(sub: string): string {
  return `${STORAGE_PREFIX}${sub}`;
}

function hasBootstrapped(sub: string | undefined): boolean {
  if (!sub) return false;
  try {
    return window.localStorage.getItem(bootstrapDoneKey(sub)) === '1';
  } catch {
    // localStorage dapat dilarang (mode privat). Anggap belum disiapkan.
    return false;
  }
}

function markBootstrapped(sub: string): void {
  try {
    window.localStorage.setItem(bootstrapDoneKey(sub), '1');
  } catch {
    // Diabaikan: penanda hanya optimasi, mutationnya idempoten.
  }
}

export interface BootstrapSummary {
  categoriesCreated: number;
  categoriesAlreadyPresent: number;
  walletCreated: boolean;
}

interface LedgerEnvelope {
  ok: boolean;
  data?: BootstrapSummary;
  error?: { code?: string; message?: string };
}

export interface UseBootstrapUserResult {
  /** `true` bila aplikasi boleh merender konten halaman. */
  ready: boolean;
  /** Galat penyiapan, bila ada. Aplikasi tetap dapat dipakai. */
  error: Error | null;
  /** Ringkasan hasil penyiapan pada pemanggilan ini. */
  summary: BootstrapSummary | undefined;
}

export function useBootstrapUser(sub: string | undefined): UseBootstrapUserResult {
  const qc = useQueryClient();
  const configured = Boolean(loadAmplifyOutputs());
  const needed = Boolean(sub) && configured && !hasBootstrapped(sub);

  const query = useQuery<BootstrapSummary, Error>({
    queryKey: ['bootstrap', sub],
    enabled: needed,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    queryFn: async () => {
      const client = getDataClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fn = (client.mutations as any).bootstrapUser as
        | ((args: {
            input: unknown;
          }) => Promise<{ data: unknown; errors?: { message: string }[] }>)
        | undefined;
      if (!fn) throw new Error('Mutasi bootstrapUser tidak ditemukan pada klien');

      const { data, errors } = await fn({ input: {} });
      if (errors?.length) {
        throw new Error(errors[0]?.message ?? 'Gagal menyiapkan data awal akun');
      }

      // `a.json()` dapat diterima sebagai string JSON maupun nilai terurai.
      const envelope = (typeof data === 'string' ? JSON.parse(data) : data) as
        | LedgerEnvelope
        | null;
      if (!envelope?.ok) {
        throw new Error(envelope?.error?.message ?? 'Gagal menyiapkan data awal akun');
      }
      return (envelope.data ?? {
        categoriesCreated: 0,
        categoriesAlreadyPresent: 0,
        walletCreated: false,
      }) satisfies BootstrapSummary;
    },
  });

  useEffect(() => {
    if (!query.isSuccess || !sub) return;
    markBootstrapped(sub);
    // Data awal baru tersedia: muat ulang daftar yang terpengaruh.
    void qc.invalidateQueries({ queryKey: ['wallets'] });
    void qc.invalidateQueries({ queryKey: ['categories'] });
    void qc.invalidateQueries({ queryKey: ['notifPrefs'] });
  }, [query.isSuccess, sub, qc]);

  return {
    ready: !needed || query.isSuccess || query.isError,
    error: query.error ?? null,
    summary: query.data,
  };
}