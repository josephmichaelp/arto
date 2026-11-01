import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Penjaga kontras permukaan Kartu_Lembut (Req 17.13, 18.8, 18.9).
 *
 * Kartu_Lembut kini semi-opak agar Latar_Gradien terbaca di belakangnya.
 * Uji ini membaca `--card-alpha` langsung dari `global.css`, menyusun latar
 * terburuk dari token mesh (base + semua lapisan ditumpuk pada kekuatan
 * penuh), lalu memastikan teks di atas permukaan hasil komposit tetap
 * memenuhi kontras minimal.
 *
 * Dengan begitu, menurunkan opasitas kartu atau mengubah warna mesh/teks akan
 * menggagalkan uji ini, bukan lolos diam-diam.
 */
import { compositeOver, contrastRatio, MIN_TEXT_CONTRAST } from '../../shared/domain/contrast';
import { derived, mesh } from './tokens';

const globalCss = readFileSync(resolve(process.cwd(), 'src/theme/global.css'), 'utf8');

/** Membaca nilai `--card-alpha` dari `global.css`. */
function readCardAlpha(): number {
  const match = globalCss.match(/--card-alpha:\s*([0-9.]+)\s*;/);
  if (!match) throw new Error('--card-alpha tidak ditemukan di global.css');
  return Number(match[1]);
}

/** Latar paling gelap yang mungkin: base oat + semua lapisan mesh penuh. */
function worstCaseBackground(): string {
  let bg: string = mesh.base;
  for (const layer of mesh.layers) {
    bg = compositeOver(layer.color, layer.alpha, bg);
  }
  return bg;
}

describe('Permukaan Kartu_Lembut semi-opak', () => {
  it('memakai --card-alpha di bawah 1 sehingga latar gradien terlihat', () => {
    const alpha = readCardAlpha();
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
  });

  it('.soft-card memakai --card-alpha, bukan warna solid', () => {
    expect(globalCss).toMatch(/\.soft-card\s*\{[^}]*rgba\(255,\s*255,\s*255,\s*var\(--card-alpha\)\)/);
  });

  it('tidak memakai backdrop-filter pada .soft-card (batas 3 lapisan blur per layar)', () => {
    const rule = globalCss.match(/\.soft-card\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).not.toMatch(/backdrop-filter/);
  });

  it.each([
    ['ink', derived.ink],
    ['inkMuted', derived.inkMuted],
  ])('teks %s memenuhi kontras minimal di atas kartu pada latar terburuk', (_label, fg) => {
    const surface = compositeOver(derived.card, readCardAlpha(), worstCaseBackground());
    expect(contrastRatio(fg, surface)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it('tetap memenuhi kontras pada latar paling terang (base oat saja)', () => {
    const surface = compositeOver(derived.card, readCardAlpha(), mesh.base);
    expect(contrastRatio(derived.ink, surface)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrastRatio(derived.inkMuted, surface)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });
});