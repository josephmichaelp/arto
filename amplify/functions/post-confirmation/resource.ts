import { defineFunction } from '@aws-amplify/backend';

/**
 * Trigger Cognito `postConfirmation`.
 *
 * Dipanggil sekali setiap akun diaktifkan. Membuat `UserProfile`,
 * `NotifPrefs`, Kategori bawaan berbahasa Indonesia, dan Dompet "Tunai"
 * saldo 0 lewat `attribute_not_exists` (idempoten bila trigger terulang).
 * Lihat `amplify/functions/post-confirmation/handler.ts`.
 *
 * _Requirements: 3.1, 1.2_
 */
export const postConfirmation = defineFunction({
  name: 'post-confirmation',
  entry: './handler.ts',
});
