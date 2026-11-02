/**
 * Serialisasi untuk skalar GraphQL `AWSJSON`.
 *
 * `a.json()` pada skema Amplify dipetakan ke skalar `AWSJSON`, dan AppSync
 * mensyaratkan nilainya dikirim sebagai STRING JSON, bukan objek. Mengirim
 * objek biasa membuat AppSync menolak permintaan dengan:
 *
 *     Variable 'input' has an invalid value.
 *
 * Tipe TypeScript tidak menangkap kesalahan ini karena `a.json()` bertipe
 * permisif (`object | any[] | string | number | boolean | null`), dan uji unit
 * tidak menangkapnya karena klien data dimock. Karena itu kedua arah
 * konversi dipusatkan di sini dan dijaga uji.
 *
 * Pada arah balik, AppSync dapat mengembalikan `AWSJSON` sebagai string JSON
 * maupun nilai yang sudah terurai, tergantung jalur transport. `fromAwsJson`
 * menerima keduanya.
 */

/** Mengubah payload menjadi string JSON untuk argumen `AWSJSON`. */
export function toAwsJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

/**
 * Membaca nilai `AWSJSON` dari respons. String JSON diurai; nilai yang sudah
 * berupa objek diteruskan apa adanya.
 */
export function fromAwsJson<T>(value: unknown): T {
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    // Bukan JSON valid: kembalikan apa adanya agar pemanggil yang memutuskan.
    return value as unknown as T;
  }
}