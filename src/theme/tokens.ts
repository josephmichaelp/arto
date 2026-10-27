/**
 * Token tema Arto: satu-satunya sumber nilai warna, radius, dan ukuran.
 * `tokens.css` dihasilkan dari berkas ini oleh `scripts/generate-theme-css.ts`.
 *
 * PERHATIAN, MENUNGGU KONFIRMASI PEMILIK:
 * Ketiga nilai Warna_Merek di bawah adalah PENDEKATAN layar, bukan nilai resmi
 * Pantone (Pantone tidak menerbitkan sRGB resmi).
 *  - oat  : pendekatan Pantone P 3-9 C
 *  - blue : pendekatan Pantone P 104-8 C (pendekatan varian uncoated)
 *  - pink : PLACEHOLDER Pantone P 73-7 C
 * Jangan dikunci sebelum pemilik mengonfirmasi. Bila berubah, jalankan
 * `generate:theme` dan sesuaikan warna turunan agar kontras tetap >= 4,5:1.
 */

export const brand = {
  oat: '#F1EEDB',
  blue: '#005DAC',
  pink: '#F2B8C6',
} as const;

export const derived = {
  /** Teks utama */
  ink: '#1F2430',
  /** Teks sekunder */
  inkMuted: '#4A5160',
  /** Latar Kartu_Lembut */
  card: '#FFFFFF',
  /** Teks di atas Biru */
  onBlue: '#FFFFFF',
  /** Aksen merah muda untuk teks/ikon */
  pinkStrong: '#B3375A',
  /** Biru gelap untuk teks kecil */
  blueDeep: '#003F7A',
} as const;

export const glass = {
  /** Opasitas Permukaan_Kaca dengan blur */
  alpha: 0.88,
  /** Opasitas tanpa dukungan blur */
  alphaFallback: 0.94,
} as const;

export const radius = {
  /** Minimal 16 px (Req 17.9) */
  card: '20px',
} as const;

/** Target sentuh minimum */
export const hit = '44px';

/**
 * Nilai mesh Latar_Gradien (radial-gradient Oat/Biru/Merah_Muda).
 * Pendekatan, MENUNGGU KONFIRMASI PEMILIK.
 */
export const mesh = {
  base: brand.oat,
  layers: [
    { color: brand.blue, alpha: 0.35, x: '12%', y: '8%', size: '55%' },
    { color: brand.pink, alpha: 0.55, x: '88%', y: '22%', size: '50%' },
    { color: brand.blue, alpha: 0.2, x: '70%', y: '88%', size: '60%' },
    { color: brand.pink, alpha: 0.4, x: '10%', y: '80%', size: '45%' },
  ],
} as const;

export interface TextSurfacePair {
  name: string;
  /** Warna teks (hex) */
  text: string;
  /** Warna latar (hex, sudah komposit bila Permukaan_Kaca) */
  surface: string;
}

/**
 * Pasangan teks/latar yang wajib memenuhi kontras >= 4,5:1 (Properti 28).
 * Komposit kaca: putih alpha 0,88 di atas biru muda = #E0ECF5, di atas hitam
 * (kasus terburuk) = #E0E0E0; alpha fallback 0,94 di atas hitam = #F0F0F0.
 */
export const TEXT_SURFACE_PAIRS: readonly TextSurfacePair[] = [
  { name: 'ink/card', text: derived.ink, surface: derived.card },
  { name: 'inkMuted/card', text: derived.inkMuted, surface: derived.card },
  { name: 'ink/oat', text: derived.ink, surface: brand.oat },
  { name: 'inkMuted/oat', text: derived.inkMuted, surface: brand.oat },
  { name: 'onBlue/blue', text: derived.onBlue, surface: brand.blue },
  { name: 'blue/card', text: brand.blue, surface: derived.card },
  { name: 'blue/oat', text: brand.blue, surface: brand.oat },
  { name: 'pinkStrong/card', text: derived.pinkStrong, surface: derived.card },
  { name: 'blueDeep/card', text: derived.blueDeep, surface: derived.card },
  { name: 'ink/pink', text: derived.ink, surface: brand.pink },
  { name: 'ink/glass-over-blue', text: derived.ink, surface: '#E0ECF5' },
  { name: 'ink/glass-over-black', text: derived.ink, surface: '#E0E0E0' },
  { name: 'inkMuted/glass-over-black', text: derived.inkMuted, surface: '#E0E0E0' },
  { name: 'inkMuted/glass-fallback-over-black', text: derived.inkMuted, surface: '#F0F0F0' },
];

export const tokens = { brand, derived, glass, radius, hit, mesh } as const;
export type Tokens = typeof tokens;
