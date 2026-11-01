/**
 * Bootstrap konfigurasi Amplify (Tugas 12.1).
 *
 * `amplify_outputs.json` dihasilkan oleh `npx ampx sandbox`/pipeline dan TIDAK
 * ikut di-commit (lihat `.gitignore`). Agar `typecheck`, `vitest`, dan
 * `vite build` tetap jalan tanpa berkas itu, kita TIDAK meng-impor statik
 * JSON-nya. Sebagai gantinya `import.meta.glob` dipakai: bila berkas ada ia
 * dimuat eager, bila tidak ada hasilnya objek kosong (tanpa galat resolusi).
 */
import { Amplify } from 'aws-amplify';

type AmplifyOutputs = Parameters<typeof Amplify.configure>[0];

/**
 * Muat `amplify_outputs.json` dari root proyek bila tersedia. Mengembalikan
 * `null` pada lingkungan lokal/CI yang belum punya berkas (typecheck & build
 * tidak boleh bergantung padanya).
 */
export function loadAmplifyOutputs(): AmplifyOutputs | null {
  const modules = import.meta.glob('/amplify_outputs.json', {
    eager: true,
    import: 'default',
  }) as Record<string, AmplifyOutputs>;

  const first = Object.values(modules)[0];
  return first ?? null;
}

/**
 * Konfigurasikan Amplify sekali saat aplikasi dimuat. Aman dipanggil tanpa
 * `amplify_outputs.json`: bila belum ada, fungsi tidak melakukan apa-apa dan
 * mengembalikan `false` sehingga aplikasi tetap dapat di-render (misalnya saat
 * uji atau build pratinjau).
 *
 * @returns `true` bila Amplify berhasil dikonfigurasi dari outputs.
 */
export function configureAmplify(): boolean {
  const outputs = loadAmplifyOutputs();
  if (!outputs) {
    return false;
  }
  Amplify.configure(outputs);
  return true;
}
