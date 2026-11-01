/**
 * Singleton klien data Amplify Gen2 (Tugas 12.3).
 *
 * `generateClient<Schema>()` bersifat lazy — objek klien dibuat segera tetapi
 * tidak mengakses jaringan hingga ada panggilan method. Bila `amplify_outputs.json`
 * belum tersedia (CI, typecheck, atau dev sebelum `npx ampx sandbox`), pemanggil
 * query-hook sudah mengembalikan `[]` lebih awal sehingga klien ini tidak pernah
 * dipakai secara aktual.
 */
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

export type DataClient = ReturnType<typeof generateClient<Schema>>;

let _client: DataClient | null = null;

/** Mengembalikan instance klien data bersama. Instance dibuat sekali dan di-cache. */
export function getDataClient(): DataClient {
  if (!_client) {
    _client = generateClient<Schema>();
  }
  return _client;
}
