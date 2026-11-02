import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Lambda `group-manager`.
 *
 * Mengelola seluruh operasi Keuangan Bersama:
 * - Buat/bubarkan grup
 * - Undang anggota via Amazon SES
 * - Terima/tolak undangan (validasi token JWT)
 * - Kelola peran anggota (ubah peran, hapus anggota)
 *
 * Semua operasi tulis ke DynamoDB langsung via SDK (bukan AppSync)
 * sehingga validasi peran terpusat di Lambda ini, tidak di klien.
 *
 * Environment variables:
 * - SES_FROM_EMAIL  : alamat pengirim email undangan (terverifikasi di SES)
 * - INVITE_BASE_URL : URL dasar aplikasi untuk tautan undangan
 * - GROUP_INVITE_SECRET : secret HMAC untuk menandatangani token JWT undangan
 */
export const groupManager = defineFunction({
  name: 'group-manager',
  entry: './handler.ts',
  timeoutSeconds: 15,
  resourceGroupName: 'data',
  environment: {
    SES_FROM_EMAIL: 'josephmichaelp1@gmail.com',
    INVITE_BASE_URL: 'https://main.d1wjdyhn7f1szz.amplifyapp.com',
    GROUP_INVITE_SECRET: secret('GROUP_INVITE_SECRET'),
  },
});
