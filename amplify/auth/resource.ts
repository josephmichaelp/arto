import { defineAuth } from '@aws-amplify/backend';
import { postConfirmation } from '../functions/post-confirmation/resource';

/**
 * Konfigurasi autentikasi Arto.
 *
 * - Login hanya dengan email (Cognito), sesuai Requirement 1.1-1.3.
 * - Kode verifikasi email dan pesan diatur dalam bahasa Indonesia.
 * - Trigger `postConfirmation` membuat profil, preferensi notifikasi,
 *   kategori bawaan, dan dompet "Tunai" (lihat amplify/functions/post-confirmation).
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
  triggers: {
    postConfirmation,
  },
});
