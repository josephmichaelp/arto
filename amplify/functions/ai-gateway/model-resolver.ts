import type { ModelCandidate } from 'shared/config';

/**
 * Resolver model Bedrock (Requirement 16.1, Property 25).
 *
 * Memilih kandidat tersedia pertama dari rantai C1..C3 (lihat
 * `shared/config.ts`). Hanya berpindah ke kandidat berikutnya untuk galat
 * yang menunjukkan kandidat tidak dapat dipakai sama sekali:
 * `AccessDeniedException`, `ResourceNotFoundException`, dan
 * `ValidationException` yang menyatakan model/profil tidak valid.
 *
 * Galat sementara (`ThrottlingException`, `ServiceUnavailableException`,
 * timeout) dicoba ulang sekali pada kandidat yang sama, tanpa pindah. Galat
 * lain (termasuk galat sementara yang gagal lagi setelah dicoba ulang)
 * langsung menghentikan rantai dengan `AI_MODEL_UNAVAILABLE`, tanpa mencoba
 * kandidat berikutnya.
 *
 * Indeks kandidat yang terakhir berhasil disimpan di memori modul (per
 * kontainer Lambda) sehingga permintaan berikutnya mulai dari kandidat yang
 * terbukti bekerja, bukan selalu dari awal rantai.
 *
 * `AI_ALLOW_CROSS_REGION=false` memaksa hanya kandidat pertama (C1); C3
 * (fallback lintas region) ikut dinonaktifkan karena berada di luar
 * kandidat pertama.
 *
 * Region panggilan untuk setiap kandidat berasal dari konfigurasi
 * (`shared/config.ts`, yang membaca `BEDROCK_REGION`), tidak tertanam di
 * modul ini.
 */

export const AI_MODEL_UNAVAILABLE = 'AI_MODEL_UNAVAILABLE';

/** Dilempar ketika seluruh kandidat dalam rantai gagal dipakai. */
export class ModelUnavailableError extends Error {
  readonly code = AI_MODEL_UNAVAILABLE;

  constructor(message = 'Model AI tidak tersedia saat ini. Coba lagi nanti.', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ModelUnavailableError';
  }
}

/** Bentuk minimal galat yang perlu diklasifikasikan oleh resolver. */
export interface ResolverError {
  name?: string;
  message?: string;
}

/** Nama galat yang memicu pindah langsung ke kandidat berikutnya. */
const SWITCH_ERROR_NAMES = new Set(['AccessDeniedException', 'ResourceNotFoundException']);

/** Nama galat sementara: dicoba ulang sekali pada kandidat yang sama. */
const TRANSIENT_ERROR_NAMES = new Set(['ThrottlingException', 'ServiceUnavailableException', 'TimeoutError']);

/** Pola pesan `ValidationException` yang menyatakan model/profil tidak valid (bukan validasi input lain). */
const INVALID_MODEL_MESSAGE_PATTERN = /model|inference.?profile|on-demand throughput/i;

function toResolverError(err: unknown): ResolverError {
  if (err && typeof err === 'object') {
    const candidate = err as { name?: unknown; message?: unknown };
    return {
      name: typeof candidate.name === 'string' ? candidate.name : undefined,
      message: typeof candidate.message === 'string' ? candidate.message : undefined,
    };
  }
  return {};
}

/**
 * Menentukan apakah galat memicu pindah ke kandidat berikutnya.
 * `ValidationException` hanya memicu pindah bila pesannya menyatakan
 * model/profil tidak valid, bukan validasi lain (misalnya payload Zod).
 */
export function isSwitchError(err: unknown): boolean {
  const resolved = toResolverError(err);
  if (!resolved.name) return false;
  if (SWITCH_ERROR_NAMES.has(resolved.name)) return true;
  if (resolved.name === 'ValidationException') {
    return INVALID_MODEL_MESSAGE_PATTERN.test(resolved.message ?? '');
  }
  return false;
}

/** Menentukan apakah galat bersifat sementara dan layak dicoba ulang sekali. */
export function isTransientError(err: unknown): boolean {
  const resolved = toResolverError(err);
  return !!resolved.name && TRANSIENT_ERROR_NAMES.has(resolved.name);
}

/** Indeks kandidat terakhir yang berhasil, disimpan di memori modul (per kontainer Lambda). */
let lastWorkingIndex = 0;

/** Mengembalikan state resolver ke awal. Dipakai oleh pengujian. */
export function resetResolverState(): void {
  lastWorkingIndex = 0;
}

/**
 * Menghasilkan rantai kandidat efektif: seluruh rantai, atau hanya kandidat
 * pertama bila `allowCrossRegion` bernilai `false`.
 */
export function effectiveCandidates(candidates: ModelCandidate[], allowCrossRegion: boolean): ModelCandidate[] {
  if (!allowCrossRegion) return candidates.slice(0, 1);
  return candidates;
}

export interface ResolveModelOptions<T> {
  /** Rantai kandidat (C1..C3), biasanya dari `loadConfig().modelCandidates`. */
  candidates: ModelCandidate[];
  /** `AI_ALLOW_CROSS_REGION`; `false` memaksa hanya kandidat pertama. */
  allowCrossRegion: boolean;
  /** Pemanggil model untuk satu kandidat; melempar untuk mensimulasikan galat panggilan. */
  invoke: (candidate: ModelCandidate) => Promise<T>;
}

export interface ResolveModelResult<T> {
  result: T;
  candidate: ModelCandidate;
  candidateIndex: number;
}

async function invokeWithRetry<T>(
  candidate: ModelCandidate,
  invoke: (candidate: ModelCandidate) => Promise<T>,
): Promise<T> {
  try {
    return await invoke(candidate);
  } catch (err) {
    if (isTransientError(err)) {
      return await invoke(candidate);
    }
    throw err;
  }
}

/**
 * Memilih dan memanggil kandidat tersedia pertama dalam rantai, mulai dari
 * kandidat terakhir yang terbukti bekerja (bila masih ada dalam rantai
 * efektif). Lihat dokumentasi modul untuk aturan pindah kandidat dan
 * percobaan ulang.
 */
export async function resolveModel<T>(options: ResolveModelOptions<T>): Promise<ResolveModelResult<T>> {
  const pool = effectiveCandidates(options.candidates, options.allowCrossRegion);
  if (pool.length === 0) {
    throw new ModelUnavailableError();
  }

  const startIndex = lastWorkingIndex < pool.length ? lastWorkingIndex : 0;
  let lastError: unknown;

  for (let offset = 0; offset < pool.length; offset++) {
    const index = (startIndex + offset) % pool.length;
    const candidate = pool[index]!;
    try {
      const result = await invokeWithRetry(candidate, options.invoke);
      lastWorkingIndex = index;
      return { result, candidate, candidateIndex: index };
    } catch (err) {
      lastError = err;
      if (!isSwitchError(err)) {
        throw new ModelUnavailableError(undefined, { cause: lastError });
      }
      // Galat memicu pindah: lanjut ke kandidat berikutnya dalam rantai.
    }
  }

  throw new ModelUnavailableError(undefined, { cause: lastError });
}
