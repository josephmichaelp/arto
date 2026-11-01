import { defineAuth } from '@aws-amplify/backend';

/**
 * Konfigurasi autentikasi Arto.
 *
 * - Login hanya dengan email (Cognito), sesuai Requirement 1.1-1.3.
 * - Kode verifikasi email dan pesan diatur dalam bahasa Indonesia.
 * - Penyiapan data awal akun (profil, preferensi notifikasi, kategori
 *   bawaan, dompet "Tunai") TIDAK memakai trigger Cognito. Trigger tersebut
 *   dilepas karena menimbulkan dependensi sirkular antar nested stack:
 *   `data` butuh user pool dari `auth`, `auth` butuh ARN fungsi trigger, dan
 *   fungsi trigger butuh referensi tabel `data`. Penyiapan kini dijalankan
 *   mutation idempoten `bootstrapUser` pada Lambda `ledger` (yang sudah
 *   berada di stack `data`), dipanggil frontend sekali setelah masuk. Lihat
 *   `amplify/functions/ledger/operations-bootstrap.ts`.
 * - `preventUserExistenceErrors` diaktifkan pada app client di amplify/backend.ts
 *   agar pesan galat login tidak mengungkap apakah email terdaftar (Requirement 1.4).
 */
export const auth = defineAuth({
  loginWith: {
    email: {
      verificationEmailStyle: 'CODE',
      verificationEmailSubject: 'Kode verifikasi akun Arto',
      verificationEmailBody: (createCode) =>
        `Kode verifikasi akun Arto Anda adalah ${createCode()}. ` +
        'Masukkan kode ini untuk mengaktifkan akun Anda. Jangan bagikan kode ini kepada siapa pun.',
    },
  },
});
