/**
 * Pembatas pemakaian AI (logika murni). Jendela dihitung per jam UTC tetap
 * (K-5): `hourBucket` menghasilkan kunci jendela yang sama untuk setiap
 * instan dalam jam UTC yang sama, terlepas dari zona waktu Pengguna.
 * Keputusan izin/tolak (`decideRate`) murni berdasarkan hitungan setelah
 * kenaikan (`countAfterIncrement`) dan batas (`limit`, default 30), tanpa
 * efek samping (Requirement 16.3).
 */

export const DEFAULT_AI_RATE_LIMIT = 30;

export interface RateDecision {
  allowed: boolean;
  message?: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Menghasilkan kunci jendela tetap per jam UTC, misalnya `2025-08-17T14`.
 * Dua instan yang berada pada jam UTC yang sama selalu menghasilkan kunci
 * yang sama.
 */
export function hourBucket(instant: Date): string {
  if (Number.isNaN(instant.getTime())) {
    throw new Error('Instan tidak valid');
  }
  const year = instant.getUTCFullYear();
  const month = pad2(instant.getUTCMonth() + 1);
  const day = pad2(instant.getUTCDate());
  const hour = pad2(instant.getUTCHours());
  return `${year}-${month}-${day}T${hour}`;
}

/**
 * Memutuskan apakah permintaan ke-`countAfterIncrement` dalam suatu
 * `hourBucket` diizinkan. `countAfterIncrement` adalah hitungan permintaan
 * SETELAH kenaikan (permintaan pertama bernilai 1). Permintaan diizinkan
 * selama hitungan tidak melebihi `limit` (default 30); selebihnya ditolak
 * dengan pesan batas pemakaian berbahasa Indonesia.
 */
export function decideRate(countAfterIncrement: number, limit: number = DEFAULT_AI_RATE_LIMIT): RateDecision {
  if (countAfterIncrement <= limit) {
    return { allowed: true };
  }
  return {
    allowed: false,
    message: `Batas pemakaian AI tercapai (${limit} permintaan per jam). Coba lagi pada jam berikutnya.`,
  };
}
