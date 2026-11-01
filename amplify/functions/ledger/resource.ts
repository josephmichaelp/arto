import { defineFunction } from '@aws-amplify/backend';

/**
 * Lambda `ledger`.
 *
 * Menangani seluruh mutasi yang memengaruhi saldo (Transaksi, Dompet,
 * Kategori, Anggaran, Transaksi_Berulang, Target_Tabungan) lewat DynamoDB
 * `TransactWriteItems` atomik. Dipanggil hanya lewat custom mutation/query
 * AppSync dengan `allow.authenticated()`; `owner` diambil dari
 * `event.identity` (Requirement 1.6, 16.2). Tidak memanggil Bedrock,
 * sehingga tidak perlu variabel lingkungan AI.
 *
 * _Requirements: 16.1_
 */
export const ledger = defineFunction({
  name: 'ledger',
  entry: './handler.ts',
});
