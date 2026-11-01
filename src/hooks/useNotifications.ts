/**
 * Hook TanStack Query untuk Notifikasi (Req 9.1, 9.2, 9.3).
 *
 * Mengembalikan daftar Notifikasi milik Pengguna, diurutkan dari yang terbaru
 * (berdasarkan `createdAt`). Juga mengekspos jumlah notifikasi belum dibaca
 * untuk penanda pada navigasi.
 *
 * Bila `amplify_outputs.json` belum ada, mengembalikan larik kosong.
 */
import { useQuery } from '@tanstack/react-query';
import type { Schema } from '../../amplify/data/resource';
import { loadAmplifyOutputs } from '../app/amplify';
import { getDataClient } from '../app/dataClient';

export type NotificationItem = Schema['Notification']['type'];

export function useNotifications() {
  return useQuery<NotificationItem[], Error>({
    queryKey: ['notifications'],
    queryFn: async () => {
      if (!loadAmplifyOutputs()) return [];
      const client = getDataClient();
      const { data, errors } = await client.models.Notification.list();
      if (errors?.length) throw new Error(errors[0]?.message ?? 'Gagal memuat notifikasi');
      const sorted = (data ?? []).slice().sort((a, b) => {
        const ta = a.createdAt ?? '';
        const tb = b.createdAt ?? '';
        return tb.localeCompare(ta);
      });
      return sorted;
    },
    // Refresh lebih sering agar penanda belum-baca tetap akurat.
    staleTime: 30 * 1000,
  });
}

/** Mengembalikan jumlah Notifikasi yang belum dibaca dari cache. */
export function useUnreadCount(): number {
  const { data } = useNotifications();
  return (data ?? []).filter((n) => !n.read).length;
}

/**
 * Hook untuk Preferensi Notifikasi (Req 9.5).
 */
export type NotifPrefsItem = Schema['NotifPrefs']['type'];

export function useNotifPrefs() {
  return useQuery<NotifPrefsItem | null, Error>({
    queryKey: ['notif-prefs'],
    queryFn: async () => {
      if (!loadAmplifyOutputs()) return null;
      const client = getDataClient();
      const { data, errors } = await client.models.NotifPrefs.list();
      if (errors?.length) throw new Error(errors[0]?.message ?? 'Gagal memuat preferensi notifikasi');
      return data?.[0] ?? null;
    },
  });
}
