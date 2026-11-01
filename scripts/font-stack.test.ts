/**
 * Uji tumpukan font --font-ui pada src/theme/global.css (Req 18.1, 18.2, 18.3).
 *
 * Memverifikasi bahwa:
 * - Tumpukan font `--font-ui` hadir dan tidak kosong.
 * - Inter muncul sebelum font generik sistem (system-ui, sans-serif) sehingga
 *   perangkat non-Apple mendapat Inter sebagai Font_Cadangan (Req 18.2).
 * - Keluarga SF (-apple-system, BlinkMacSystemFont, "SF Pro *") hadir sebelum
 *   Inter agar perangkat Apple tetap memakai SF secara native (Req 18.1).
 * - `global.css` tidak menyertakan blok `@font-face` apa pun (Req 18.3, 18.4):
 *   Inter dimuat secara terpisah lewat `@fontsource-variable/inter` di fonts.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractFontFaceFamilies, isForbiddenFontFamily } from './check-no-sf-fonts';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const GLOBAL_CSS_PATH = path.join(REPO_ROOT, 'src', 'theme', 'global.css');

/**
 * Mengambil nilai `--font-ui` dari teks CSS dan mengembalikan daftar entri
 * tumpukan font (tanpa tanda kutip, tanpa spasi berlebih).
 */
function parseFontUiStack(css: string): string[] {
  // Cocokkan --font-ui: ... ; termasuk nilai multi-baris.
  const match = /--font-ui\s*:\s*([\s\S]+?);/.exec(css);
  if (!match || !match[1]) return [];
  return match[1]
    .split(',')
    .map((entry) => entry.trim().replace(/\n\s*/g, ' ').replace(/^['"]|['"]$/g, '').trim())
    .filter(Boolean);
}

describe('global.css – tumpukan --font-ui (Req 18.1, 18.2)', () => {
  let css: string;
  let fontStack: string[];

  beforeAll(() => {
    css = readFileSync(GLOBAL_CSS_PATH, 'utf8');
    fontStack = parseFontUiStack(css);
  });

  it('--font-ui hadir dan tidak kosong', () => {
    expect(fontStack.length).toBeGreaterThan(0);
  });

  it('Inter hadir dalam tumpukan (Req 18.2 – Font_Cadangan non-Apple)', () => {
    expect(fontStack).toContain('Inter');
  });

  it('Inter muncul sebelum system-ui (Req 18.2)', () => {
    const interIdx = fontStack.indexOf('Inter');
    const sysIdx = fontStack.indexOf('system-ui');
    expect(interIdx, 'Inter harus ada di tumpukan').toBeGreaterThanOrEqual(0);
    expect(sysIdx, 'system-ui harus ada di tumpukan').toBeGreaterThanOrEqual(0);
    expect(interIdx).toBeLessThan(sysIdx);
  });

  it('Inter muncul sebelum sans-serif (Req 18.2)', () => {
    const interIdx = fontStack.indexOf('Inter');
    const sansIdx = fontStack.indexOf('sans-serif');
    expect(interIdx, 'Inter harus ada di tumpukan').toBeGreaterThanOrEqual(0);
    expect(sansIdx, 'sans-serif harus ada di tumpukan').toBeGreaterThanOrEqual(0);
    expect(interIdx).toBeLessThan(sansIdx);
  });

  it('-apple-system hadir sebelum Inter (Req 18.1 – SF native di Apple)', () => {
    const appleIdx = fontStack.indexOf('-apple-system');
    const interIdx = fontStack.indexOf('Inter');
    expect(appleIdx, '-apple-system harus ada di tumpukan').toBeGreaterThanOrEqual(0);
    expect(appleIdx).toBeLessThan(interIdx);
  });

  it('BlinkMacSystemFont hadir sebelum Inter (Req 18.1)', () => {
    const blinkIdx = fontStack.indexOf('BlinkMacSystemFont');
    const interIdx = fontStack.indexOf('Inter');
    expect(blinkIdx, 'BlinkMacSystemFont harus ada di tumpukan').toBeGreaterThanOrEqual(0);
    expect(blinkIdx).toBeLessThan(interIdx);
  });

  it('semua font SF Pro hadir sebelum Inter (Req 18.1)', () => {
    const sfFonts = fontStack.filter((f) => /^SF\s/i.test(f));
    expect(sfFonts.length, 'minimal satu entri "SF Pro *" harus ada').toBeGreaterThan(0);
    const interIdx = fontStack.indexOf('Inter');
    for (const sf of sfFonts) {
      const sfIdx = fontStack.indexOf(sf);
      expect(sfIdx, `"${sf}" harus muncul sebelum Inter`).toBeLessThan(interIdx);
    }
  });

  it('urutan lengkap: sistem Apple → SF Pro → Inter → generik', () => {
    const appleIdx = fontStack.indexOf('-apple-system');
    const firstSfIdx = fontStack.findIndex((f) => /^SF\s/i.test(f));
    const interIdx = fontStack.indexOf('Inter');
    const systemUiIdx = fontStack.indexOf('system-ui');

    expect(appleIdx).toBeLessThan(firstSfIdx);
    expect(firstSfIdx).toBeLessThan(interIdx);
    expect(interIdx).toBeLessThan(systemUiIdx);
  });
});

describe('global.css – tidak ada @font-face SF (Req 18.3, 18.4)', () => {
  let css: string;

  beforeAll(() => {
    css = readFileSync(GLOBAL_CSS_PATH, 'utf8');
  });

  it('global.css tidak mengandung @font-face apa pun (Req 18.3, 18.4)', () => {
    // Inter harus dimuat lewat @fontsource-variable/inter di src/theme/fonts.ts,
    // bukan lewat @font-face di global.css. Berkas font SF tidak boleh ada.
    const families = extractFontFaceFamilies(css);
    expect(families).toHaveLength(0);
  });

  it('tidak ada @font-face dengan keluarga SF di global.css (Req 18.3)', () => {
    const families = extractFontFaceFamilies(css);
    const sfViolations = families.filter(isForbiddenFontFamily);
    expect(sfViolations).toHaveLength(0);
  });
});
