/**
 * Fungsi domain murni untuk membangun ID Notifikasi deterministik dan
 * memutuskan apakah suatu Notifikasi harus dibuat, berdasarkan preferensi
 * Pengguna (`NotifPrefs`) dan Notifikasi yang sudah ada (Requirement 9.1,
 * 9.5). Lihat design.md bagian "Modul domain murni" untuk kontrak
 * `notificationId` dan `shouldCreate`.
 */

import type { NotifPrefs } from './types';

/**
 * Memetakan awalan jenis Notifikasi ke kunci preferensi (`NotifPrefs`) yang
 * mengendalikannya. Jenis yang tidak terdaftar dianggap selalu diizinkan
 * (tidak ada preferensi untuk menonaktifkannya).
 */
const NOTIF_TYPE_PREF_KEY: Record<string, keyof NotifPrefs> = {
  budget80: 'budget',
  over100: 'budget',
  recrem: 'recurring',
  'goal-done': 'goal',
  insight: 'insight',
};

/**
 * notificationId: menghasilkan ID Notifikasi deterministik dari `type` dan
 * `ref`, misalnya `notificationId('budget80', budgetId)` menghasilkan
 * `"budget80:<budgetId>"`. ID yang sama untuk `type` dan `ref` yang sama
 * dipakai sebagai kunci `attribute_not_exists` agar Notifikasi tidak pernah
 * dibuat dua kali untuk rujukan yang sama (Requirement 5.4, 5.5, 6.5, 7.4,
 * 13.3).
 */
export function notificationId(type: string, ref: string): string {
  return `${type}:${ref}`;
}

/**
 * shouldCreate: memutuskan apakah Notifikasi dengan `id` (hasil
 * `notificationId`) dan `type` boleh dibuat.
 *
 * Menolak (false) bila:
 * - `id` sudah ada pada `existingIds` (Notifikasi tersebut sudah pernah
 *   dibuat sebelumnya, menjaga "satu Notifikasi" per rujukan).
 * - Pengguna menonaktifkan jenis Notifikasi terkait pada `prefs`
 *   (Requirement 9.5). Preferensi yang tidak diset (`undefined`) dianggap
 *   diizinkan (bawaan aktif).
 *
 * Mengizinkan (true) sebaliknya.
 */
export function shouldCreate(
  type: string,
  prefs: NotifPrefs | null | undefined,
  existingIds: Set<string>,
  id: string,
): boolean {
  if (existingIds.has(id)) {
    return false;
  }

  const prefKey = NOTIF_TYPE_PREF_KEY[type];
  if (prefKey != null) {
    const allowed = prefs?.[prefKey];
    if (allowed === false) {
      return false;
    }
  }

  return true;
}
