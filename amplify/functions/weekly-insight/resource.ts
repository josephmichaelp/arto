import { defineFunction } from '@aws-amplify/backend';

/**
 * Lambda `weekly-insight`.
 *
 * Dijalankan terjadwal setiap Senin 00:30 WIB (EventBridge Scheduler,
 * `scheduleExpressionTimezone: 'Asia/Jakarta'`, diatur di
 * `amplify/backend.ts`). Memindai `UserProfile`, menghitung total dan
 * Kategori terbesar secara deterministik, lalu memanggil Nova Lite hanya
 * untuk menyusun ringkasan dan saran (dengan saran bawaan bila gagal).
 *
 * Region Bedrock dan rantai kandidat model dibaca dari variabel lingkungan
 * agar tidak tertanam di kode (Requirement 16.1); lihat `shared/config.ts`.
 *
 * _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_
 */
export const weeklyInsight = defineFunction({
  name: 'weekly-insight',
  entry: './handler.ts',
  timeoutSeconds: 60,
  environment: {
    BEDROCK_REGION: 'ap-southeast-3',
    AI_MODEL_CANDIDATES: '',
    AI_ALLOW_CROSS_REGION: 'true',
  },
});
