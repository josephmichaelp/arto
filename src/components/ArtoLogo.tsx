/**
 * Logo Arto sebagai komponen SVG inline.
 *
 * Dibangkitkan dari `brand/arto-logo.svg` (versi vektor resmi). Dua hal
 * disesuaikan dari berkas aslinya:
 *
 * 1. `fill` memakai `currentColor`, bukan hitam mati, sehingga logo ikut
 *    warna teks di sekitarnya (bilah atas, sidebar, halaman masuk) dan tetap
 *    kontras bila tema berubah.
 * 2. `viewBox` dirapatkan ke batas konten sebenarnya. Canvas asli
 *    1024x572 hanya terpakai sekitar seperempat lebarnya, sehingga logo akan
 *    tampak kecil dan tidak terpusat pada wadah sempit seperti bilah 44 px.
 *
 * Transform grup dari berkas asli dipertahankan karena koordinat path berada
 * di ruang terbalik (`scale(0.1,-0.1)`); viewBox di bawah sudah dihitung
 * dalam ruang setelah transform.
 *
 * SVG inline dipilih (bukan <img src>) agar `currentColor` bekerja, tidak
 * ada permintaan jaringan tambahan, dan logo tetap tampil saat offline.
 */

/** Jalur tanda "A". */
const MARK_PATH =
  'M5057 4141 c-15 -33 -142 -291 -282 -573 -140 -283 -255 -517 -255 -521 0 -4 19 -7 43 -7 l42 0 58 121 c47 98 69 131 121 183 89 89 173 129 275 129 144 1 205 -53 318 -279 l77 -154 133 0 c73 0 133 2 133 4 0 2 -114 235 -253 517 -139 283 -266 542 -283 576 -27 59 -31 63 -64 63 -34 0 -37 -3 -63 -59z m158 -243 c49 -101 151 -308 227 -462 75 -153 140 -287 143 -297 6 -17 1 -19 -39 -19 l-45 0 -70 138 c-78 153 -130 216 -214 259 -96 49 -237 42 -351 -17 -22 -11 -41 -19 -42 -17 -4 4 290 597 296 597 3 0 46 -82 95 -182z';

/** Jalur kata "Arto". */
const WORD_PATHS: readonly string[] = [
  'M4191 2938 c-78 -173 -185 -407 -241 -528 -71 -153 -150 -331 -150 -337 0 -2 19 -3 42 -1 l43 3 59 133 60 132 258 0 258 0 64 -135 65 -135 41 0 c48 0 48 1 -5 108 -30 63 -68 144 -216 465 -34 72 -83 179 -110 236 -27 57 -49 107 -49 112 0 5 -20 9 -45 9 l-46 0 -28 -62z m91 -76 c10 -20 31 -66 47 -102 16 -36 45 -101 66 -145 46 -99 85 -186 85 -191 0 -2 -99 -4 -220 -4 l-219 0 51 113 c27 61 76 169 107 239 31 70 58 128 61 128 3 0 13 -17 22 -38z',
  'M5388 2815 l-3 -100 -47 3 -48 4 0 -36 0 -36 50 0 50 0 0 -229 c0 -262 5 -284 71 -328 34 -22 51 -26 112 -26 91 0 117 12 117 57 l0 33 -45 -15 c-58 -19 -110 -9 -147 28 l-28 28 0 226 0 226 105 0 105 0 0 35 0 35 -105 0 -104 0 -3 98 -3 97 -37 0 -37 0 -3 -100z',
  'M5155 2720 c-91 -14 -156 -53 -201 -119 l-24 -36 0 72 0 71 -35 4 c-20 2 -38 2 -40 -1 -3 -2 -5 -148 -5 -323 l0 -318 39 0 40 0 3 188 c3 172 5 191 26 234 42 85 112 136 210 153 41 7 42 8 42 46 0 21 -1 38 -2 38 -2 -1 -25 -5 -53 -9z',
  'M6045 2720 c-71 -11 -120 -35 -172 -83 -54 -50 -87 -112 -103 -193 -16 -79 5 -164 58 -243 114 -168 378 -188 518 -41 76 79 88 112 89 230 0 95 -3 110 -27 156 -68 128 -212 198 -363 174z m163 -86 c158 -66 204 -302 81 -425 -52 -52 -92 -71 -165 -77 -51 -4 -71 0 -115 20 -65 30 -113 77 -140 137 -25 58 -25 161 0 216 20 44 79 104 126 128 40 21 163 22 213 1z',
];

const GROUP_TRANSFORM = 'translate(0,572) scale(0.1,-0.1)';

/** viewBox rapat: tanda "A" saja (rasio 1,034). */
const MARK_VIEW_BOX = '450 150 124 120';

/** viewBox rapat: tanda + kata (rasio 1,205). */
const LOGO_VIEW_BOX = '378 150 267.5 222.7';

const MARK_RATIO = 124 / 120;
const LOGO_RATIO = 267.5 / 222.7;

interface LogoProps {
  /**
   * Tinggi logo dalam piksel. Lebar dihitung dari rasio agar tidak gepeng.
   */
  height?: number;
  /**
   * Teks alternatif. Bila diberikan, logo diperlakukan sebagai gambar
   * bermakna (`role="img"`); bila dikosongkan, logo disembunyikan dari
   * pembaca layar karena hanya dekoratif (mis. saat berdampingan dengan
   * tulisan "Arto").
   */
  title?: string;
}

/** Tanda "A" saja. Dipakai pada wadah sempit seperti bilah atas. */
export function ArtoMark({ height = 24, title }: LogoProps) {
  return (
    <svg
      viewBox={MARK_VIEW_BOX}
      height={height}
      width={Math.round(height * MARK_RATIO)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <g transform={GROUP_TRANSFORM} fill="currentColor" stroke="none">
        <path d={MARK_PATH} />
      </g>
    </svg>
  );
}

/** Logo penuh: tanda "A" di atas kata "Arto". */
export function ArtoLogo({ height = 72, title = 'Arto' }: LogoProps) {
  return (
    <svg
      viewBox={LOGO_VIEW_BOX}
      height={height}
      width={Math.round(height * LOGO_RATIO)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <g transform={GROUP_TRANSFORM} fill="currentColor" stroke="none">
        <path d={MARK_PATH} />
        {WORD_PATHS.map((d) => (
          <path key={d.slice(0, 24)} d={d} />
        ))}
      </g>
    </svg>
  );
}
