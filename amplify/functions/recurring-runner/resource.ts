import { defineFunction } from '@aws-amplify/backend';

/**
 * Lambda `recurring-runner`.
 *
 * Dijalankan terjadwal setiap hari 00:05 WIB (EventBridge Scheduler,
 * `scheduleExpressionTimezone: 'Asia/Jakarta'`, diatur di
 * `amplify/backend.ts`). Membuat Transaksi dari Transaksi_Berulang yang
 * jatuh tempo secara idempoten, lalu notifikasi pengingat H-3. Logika
 * sepenuhnya deterministik dan tidak memanggil Bedrock.
 *
 * _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6_
 */
export const recurringRunner = defineFunction({
  name: 'recurring-runner',
  entry: './handler.ts',
  timeoutSeconds: 60,
});
