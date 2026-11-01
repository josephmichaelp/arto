import { defineFunction } from '@aws-amplify/backend';

/**
 * Lambda `ai-gateway`.
 *
 * Satu-satunya jalur ke Amazon Bedrock Nova Lite untuk `parseNaturalInput`,
 * `createReceiptUpload`, `scanReceipt`, dan `askAssistant`. Identitas
 * Pengguna diverifikasi sebelum pembatas pemakaian (30/jam) dan panggilan
 * model dijalankan (Requirement 16.2, 16.3).
 *
 * Timeout Lambda diatur 25 detik: klien Bedrock (Converse) memakai timeout
 * 20 detik di dalamnya, sedangkan klien peramban membatalkan permintaan
 * setelah 30 detik (Requirement 12.5).
 *
 * Region Bedrock dan rantai kandidat model dibaca dari variabel lingkungan
 * agar tidak tertanam di kode (Requirement 16.1); lihat `shared/config.ts`.
 */
export const aiGateway = defineFunction({
  name: 'ai-gateway',
  entry: './handler.ts',
  timeoutSeconds: 25,
  environment: {
    BEDROCK_REGION: 'ap-southeast-3',
    AI_MODEL_CANDIDATES: '',
    AI_ALLOW_CROSS_REGION: 'true',
    AI_RATE_LIMIT: '30',
  },
});
