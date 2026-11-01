/**
 * Pemetaan galat masuk ke pesan berbahasa Indonesia (Req 1.4).
 *
 * Kredensial salah dan email tidak terdaftar HARUS menghasilkan satu pesan
 * seragam agar tidak membocorkan keberadaan akun (`preventUserExistenceErrors`
 * di sisi Cognito juga menegakkan hal ini). `NotAuthorizedException` dan
 * `UserNotFoundException` karena itu dipetakan ke pesan yang sama.
 */

/** Pesan seragam untuk kredensial salah / email tidak terdaftar (Req 1.4). */
export const LOGIN_ERROR_GENERIC = 'Email atau kata sandi salah';

/** Pesan umum bila terjadi galat tak terduga saat masuk. */
export const LOGIN_ERROR_FALLBACK = 'Terjadi kesalahan. Coba lagi.';

/**
 * Nama galat Cognito/Amplify yang harus dipetakan ke pesan seragam Req 1.4.
 */
const UNIFORM_ERROR_NAMES = new Set<string>([
  'NotAuthorizedException',
  'UserNotFoundException',
]);

/**
 * String pesan mentah dari Cognito/Amplify UI yang juga dipetakan ke pesan
 * seragam. Dipakai sebagai kamus I18n agar label Authenticator ikut berubah.
 */
const UNIFORM_ERROR_MESSAGES = new Set<string>([
  'Incorrect username or password.',
  'User does not exist.',
  'Username/client id combination not found.',
]);

function readErrorName(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return undefined;
}

function readErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return undefined;
}

/**
 * Memetakan galat masuk (Error, objek berisi `name`/`message`, atau string
 * pesan mentah) ke pesan berbahasa Indonesia yang ramah pengguna.
 */
export function mapLoginError(error: unknown): string {
  const name = readErrorName(error);
  if (name && UNIFORM_ERROR_NAMES.has(name)) {
    return LOGIN_ERROR_GENERIC;
  }

  const message = readErrorMessage(error);
  if (message && UNIFORM_ERROR_MESSAGES.has(message)) {
    return LOGIN_ERROR_GENERIC;
  }

  return message ?? LOGIN_ERROR_FALLBACK;
}

/**
 * Daftar pasangan string galat mentah -> pesan seragam untuk dimasukkan ke
 * kamus I18n `id` (lihat `src/auth/i18n.ts`). Dengan ini Authenticator bawaan
 * Amplify UI menampilkan pesan Req 1.4 tanpa membedakan kedua kasus.
 */
export const LOGIN_ERROR_VOCABULARY: Record<string, string> = Object.fromEntries(
  [...UNIFORM_ERROR_MESSAGES].map((raw) => [raw, LOGIN_ERROR_GENERIC]),
);
