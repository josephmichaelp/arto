import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  extractFontFaceFamilies,
  fileNameSuggestsSfFont,
  findPackageViolations,
  isForbiddenFontFamily,
  isForbiddenFontFile,
  isForbiddenFontPackage,
  scanDirectory,
} from './check-no-sf-fonts';

describe('check-no-sf-fonts - pemeriksa murni', () => {
  it('menandai berkas font bernama SF, bukan nama lain', () => {
    expect(isForbiddenFontFile('SFPro-Regular.woff2')).toBe(true);
    expect(isForbiddenFontFile('SF-Pro-Text.ttf')).toBe(true);
    expect(isForbiddenFontFile('fonts/sf_pro_display.otf')).toBe(true);
    expect(isForbiddenFontFile('My-SF.woff')).toBe(true);

    // Bukan font SF: Inter dan kata yang kebetulan memuat "sf".
    expect(isForbiddenFontFile('inter-latin-wght-normal.woff2')).toBe(false);
    expect(isForbiddenFontFile('transfer-icons.woff2')).toBe(false);
    // Nama SF tapi bukan berkas font (ekstensi non-font) tidak ditandai di sini.
    expect(isForbiddenFontFile('SFPro.txt')).toBe(false);
  });

  it('fileNameSuggestsSfFont membedakan token SF dari kata biasa', () => {
    expect(fileNameSuggestsSfFont('SFProText.woff2')).toBe(true);
    expect(fileNameSuggestsSfFont('SF.ttf')).toBe(true);
    expect(fileNameSuggestsSfFont('transfer.woff2')).toBe(false);
    expect(fileNameSuggestsSfFont('classified.woff2')).toBe(false);
  });

  it('menandai @font-face dengan family berawalan SF, bukan Inter', () => {
    expect(isForbiddenFontFamily('SF Pro Text')).toBe(true);
    expect(isForbiddenFontFamily("'SFPro'")).toBe(true);
    expect(isForbiddenFontFamily('"SF-Pro"')).toBe(true);
    expect(isForbiddenFontFamily('Inter')).toBe(false);
    expect(isForbiddenFontFamily('Safari Sans')).toBe(false);
  });

  it('extractFontFaceFamilies hanya membaca blok @font-face sungguhan', () => {
    const css = `
      /* komentar menyebut @font-face tapi bukan blok */
      :root { --font-ui: -apple-system, "SF Pro Text", Inter, sans-serif; }
      @font-face { font-family: 'Inter'; src: url(x.woff2); }
    `;
    // Tumpukan --font-ui dengan "SF Pro Text" TIDAK dianggap @font-face.
    expect(extractFontFaceFamilies(css)).toEqual(['Inter']);
  });

  it('menandai paket font SF, bukan @fontsource-variable/inter', () => {
    expect(isForbiddenFontPackage('apple-sf-pro')).toBe(true);
    expect(isForbiddenFontPackage('san-francisco-font')).toBe(true);
    expect(isForbiddenFontPackage('@fontsource-variable/inter')).toBe(false);
    expect(isForbiddenFontPackage('react')).toBe(false);
  });

  it('findPackageViolations memindai dependencies dan devDependencies', () => {
    const text = JSON.stringify({
      dependencies: { '@fontsource-variable/inter': '5.2.8' },
      devDependencies: { 'sf-pro-font': '1.0.0' },
    });
    const violations = findPackageViolations(text);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.detail).toContain('sf-pro-font');
  });
});

describe('check-no-sf-fonts - scanDirectory pada direktori sementara', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sf-font-guard-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('meloloskan repositori bersih (Inter saja)', () => {
    writeFileSync(
      path.join(root, 'global.css'),
      `:root { --font-ui: -apple-system, "SF Pro Text", Inter, sans-serif; }
       @font-face { font-family: 'Inter'; src: url(inter.woff2); }`,
    );
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ dependencies: { '@fontsource-variable/inter': '5.2.8' } }),
    );
    expect(scanDirectory(root)).toEqual([]);
  });

  it('menolak berkas font SF palsu dan @font-face SF', () => {
    mkdirSync(path.join(root, 'assets'));
    writeFileSync(path.join(root, 'assets', 'SFPro-Regular.woff2'), 'palsu');
    writeFileSync(
      path.join(root, 'bad.css'),
      `@font-face { font-family: 'SF Pro Display'; src: url(sf.woff2); }`,
    );

    const violations = scanDirectory(root);
    const kinds = violations.map((v) => v.kind).sort();
    expect(kinds).toContain('font-file');
    expect(kinds).toContain('font-face');
  });

  it('mengabaikan node_modules', () => {
    mkdirSync(path.join(root, 'node_modules'));
    writeFileSync(path.join(root, 'node_modules', 'SFPro.woff2'), 'palsu');
    expect(scanDirectory(root)).toEqual([]);
  });
});
