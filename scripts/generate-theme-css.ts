/**
 * Pembuat `src/theme/tokens.css` dari `src/theme/tokens.ts`.
 *
 * `tokens.ts` adalah satu-satunya sumber nilai tema. Skrip ini meratakan
 * token warna (Warna_Merek dan turunan), opasitas Permukaan_Kaca, radius,
 * dan target sentuh menjadi variabel CSS di dalam `:root`.
 *
 * Penggunaan:
 *   npm run generate:theme   -> menulis src/theme/tokens.css
 *   npm run check:theme      -> keluar dengan kode 1 bila berkas tidak sinkron
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { tokens, type Tokens } from '../src/theme/tokens';

export interface CssVarEntry {
  name: string;
  value: string;
}

/**
 * Meratakan token warna (Warna_Merek dan turunan), opasitas Permukaan_Kaca,
 * radius, dan target sentuh menjadi pasangan nama/nilai variabel CSS.
 * `mesh` dan `TEXT_SURFACE_PAIRS` sengaja tidak disertakan karena bukan
 * token warna/radius tunggal (dipakai langsung dari TypeScript).
 */
export function flattenTokensToCssVars(t: Tokens): CssVarEntry[] {
  const entries: CssVarEntry[] = [];

  for (const [key, value] of Object.entries(t.brand)) {
    entries.push({ name: `--color-brand-${key}`, value: String(value) });
  }
  for (const [key, value] of Object.entries(t.derived)) {
    entries.push({ name: `--color-${key}`, value: String(value) });
  }
  for (const [key, value] of Object.entries(t.glass)) {
    entries.push({ name: `--glass-${key}`, value: String(value) });
  }
  for (const [key, value] of Object.entries(t.radius)) {
    entries.push({ name: `--radius-${key}`, value: String(value) });
  }
  entries.push({ name: '--hit', value: String(t.hit) });

  return entries;
}

const HEADER = `/**
 * BERKAS HASIL GENERATE. Jangan sunting manual.
 * Dihasilkan dari src/theme/tokens.ts oleh scripts/generate-theme-css.ts.
 * Jalankan \`npm run generate:theme\` untuk memperbarui, dan
 * \`npm run check:theme\` untuk memverifikasi berkas ini sinkron.
 */
`;

/** Menghasilkan teks CSS lengkap (termasuk header) berisi blok `:root` dengan variabel tema. */
export function generateCssVariables(t: Tokens = tokens): string {
  const lines = flattenTokensToCssVars(t).map((entry) => `  ${entry.name}: ${entry.value};`);
  return `${HEADER}:root {\n${lines.join('\n')}\n}\n`;
}

/**
 * Pem-parse sederhana untuk uji: mengambil pasangan nama/nilai variabel CSS
 * dari blok `:root` pertama pada teks CSS yang diberikan.
 */
export function parseCssVariables(css: string): Record<string, string> {
  const result: Record<string, string> = {};
  const rootMatch = css.match(/:root\s*{([^}]*)}/);
  if (!rootMatch || rootMatch[1] === undefined) {
    return result;
  }
  const declarationPattern = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = declarationPattern.exec(rootMatch[1])) !== null) {
    const name = match[1];
    const value = match[2];
    if (name && value !== undefined) {
      result[name] = value.trim();
    }
  }
  return result;
}

const OUTPUT_PATH = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../src/theme/tokens.css');

function main(): void {
  const checkMode = process.argv.includes('--check');
  const generated = generateCssVariables(tokens);

  if (checkMode) {
    const existing = existsSync(OUTPUT_PATH) ? readFileSync(OUTPUT_PATH, 'utf8') : null;
    if (existing !== generated) {
      console.error(
        'src/theme/tokens.css tidak sinkron dengan src/theme/tokens.ts. Jalankan `npm run generate:theme`.',
      );
      process.exit(1);
    }
    console.log('src/theme/tokens.css sinkron dengan src/theme/tokens.ts.');
    return;
  }

  writeFileSync(OUTPUT_PATH, generated, 'utf8');
  console.log(`Menulis ${OUTPUT_PATH}`);
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
