import { defineStorage } from '@aws-amplify/backend';

/**
 * Bucket privat untuk foto struk.
 *
 * Setiap berkas disimpan di `receipts/<sub>/<uuid>`. Klien TIDAK diberi akses
 * langsung (tidak ada aturan `access` untuk `entity_id` atau Grup/Pengguna di
 * sini) — satu-satunya jalur unggah/baca adalah lewat presigned POST dan
 * pembacaan oleh Lambda `ai-gateway` (lihat Requirement 11.5 dan
 * `amplify/backend.ts` untuk kebijakan IAM `s3:GetObject`/`PutObject`
 * yang dibatasi awalan `receipts/`).
 */
export const storage = defineStorage({
  name: 'artoReceipts',
  isDefault: true,
});
