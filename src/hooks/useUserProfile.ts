/**
 * Hook TanStack Query untuk UserProfile (Req 3.1, 1.2).
 *
 * Nama tampilan sebelumnya tidak dapat diubah: Beranda hanya menurunkannya
 * dari bagian sebelum "@" pada email, dan tidak ada satu pun bagian frontend
 * yang membaca atau menulis `UserProfile.displayName`. Model itu sendiri sudah
 * mengizinkan pemilik melakukan `update`, dan `bootstrapUser` sudah membuat
 * barisnya, sehingga yang kurang hanya perangkaian ini.
 *
 * Hanya ada satu UserProfile per Pengguna (id = `sub`), dan otorisasi
 * berbasis pemilik sudah menyaring daftarnya, sehingga `list()` cukup dan
 * tidak perlu mengetahui `sub` di sisi klien.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Schema } from '../../amplify/data/resource';
import { loadAmplifyOutputs } from '../app/amplify';
import { getDataClient } from '../app/dataClient';

export type UserProfileItem = Schema['UserProfile']['type'];

export const USER_PROFILE_QUERY_KEY = ['user-profile'] as const;

export function useUserProfile() {
  return useQuery<UserProfileItem | null, Error>({
    queryKey: USER_PROFILE_QUERY_KEY,
    queryFn: async () => {
      if (!loadAmplifyOutputs()) return null;
      const client = getDataClient();
      const { data, errors } = await client.models.UserProfile.list();
      if (errors?.length) throw new Error(errors[0]?.message ?? 'Gagal memuat profil');
      return data?.[0] ?? null;
    },
  });
}

/**
 * Mengubah nama tampilan. Memerlukan `id` profil yang sudah ada; bila profil
 * belum terbentuk (penyiapan awal belum jalan), pemanggil sebaiknya
 * menonaktifkan kontrolnya.
 */
export function useUpdateDisplayName() {
  const qc = useQueryClient();
  return useMutation<UserProfileItem, Error, { id: string; displayName: string }>({
    mutationFn: async ({ id, displayName }) => {
      if (!loadAmplifyOutputs()) {
        throw new Error('Amplify belum dikonfigurasi. Hubungkan ke backend sebelum menyimpan.');
      }
      const client = getDataClient();
      const { data, errors } = await client.models.UserProfile.update({
        id,
        displayName: displayName.trim(),
      });
      if (errors?.length) throw new Error(errors[0]?.message ?? 'Gagal menyimpan nama');
      if (!data) throw new Error('Gagal menyimpan nama');
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: USER_PROFILE_QUERY_KEY });
    },
  });
}