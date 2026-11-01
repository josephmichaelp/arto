/** Kontras WCAG 2.x untuk pasangan warna teks dan latar. */

export const MIN_TEXT_CONTRAST = 4.5;

/** Mengurai "#rgb" atau "#rrggbb" (tanpa/dengan '#') menjadi [r, g, b] 0..255. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(h)) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`Warna hex tidak valid: ${hex}`);
  }
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function channelToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Luminans relatif WCAG 2.x, rentang 0..1. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  );
}

/** Rasio kontras WCAG 2.x, rentang 1..21, simetris. */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Menumpuk warna fg dengan opasitas alpha (0..1) di atas bg; hasil "#rrggbb". */
export function compositeOver(
  fgHex: string,
  alpha: number,
  bgHex: string,
): string {
  const a = Math.min(1, Math.max(0, alpha));
  const fg = hexToRgb(fgHex);
  const bg = hexToRgb(bgHex);
  const out = fg.map((c, i) => {
    const v = Math.round(c * a + (bg[i] ?? 0) * (1 - a));
    return v.toString(16).padStart(2, "0");
  });
  return `#${out.join("")}`;
}

export function meetsTextContrast(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= MIN_TEXT_CONTRAST;
}
