/**
 * Fungsi domain murni untuk mencatat log yang aman (tidak memuat data keuangan
 * atau data Pengguna lainnya). Lihat design.md bagian "Modul domain murni"
 * untuk kontrak `safeLogPayload`.
 */

/** Daftar putih kunci yang boleh muncul pada log. */
const ALLOWED_LOG_KEYS = [
  'name',
  'code',
  'httpStatus',
  'requestId',
  'candidate',
  'inputLength',
] as const;

/**
 * safeLogPayload: menyaring objek masukan sehingga hanya kunci dalam daftar
 * putih (`name`, `code`, `httpStatus`, `requestId`, `candidate`,
 * `inputLength`) yang diteruskan ke log. Kunci lain (termasuk yang mungkin
 * memuat nominal, catatan, atau teks Pengguna) SHALL tidak pernah muncul
 * pada hasil, apa pun nilainya (K-4 / Requirement 16.4).
 */
export function safeLogPayload(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (input == null || typeof input !== 'object') {
    return result;
  }

  for (const key of ALLOWED_LOG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      result[key] = input[key];
    }
  }

  return result;
}
