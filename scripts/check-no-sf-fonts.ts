/**
 * Penjaga CI: menolak berkas font San Francisco (SF) di repositori (Req 18.3, 18.4).
 *
 * Lisensi Apple melarang pendistribusian ulang atau penyematan berkas font SF
 * (WOFF/WOFF2/TTF/OTF) di web. Perangkat Apple memakai SF secara native lewat
 * Tumpukan_Font_Sistem pada `--font-ui` (`-apple-system`, `BlinkMacSystemFont`,
 * `"SF Pro Text"`, dst. di `src/theme/global.css`); rujukan nama keluarga itu
 * SAH dan TIDAK boleh ditandai. Yang dilarang hanyalah MENYERTAKAN berkas font
 * SF, mendeklarasikan `@font-face` SF, atau memasang paket font SF.
 *
 * Penjaga ini gagal (exit code 1) bila menemukan salah satu dari:
 *   1. Berkas `*.woff|woff2|ttf|otf` yang namanya memuat "SF" atau "SFPro".
 *   2. Blok `@font-face` dengan `font-family` berawalan "SF" pada berkas CSS.
 *   3. Paket font SF pada dependencies/devDependencies di `package.json`.
 *
 * Fungsi pemeriksa diekspor murni (tanpa efek samping) agar dapat diuji.
 *
 * Penggunaan:
 *   npm run check:fonts   -> keluar 1 bila ada berkas/font SF terdeteksi
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Ekstensi berkas font yang dilarang bila bernama SF (Req 18.3). */
export const FONT_FILE_EXTENSIONS = ['.woff', '.woff2', '.ttf', '.otf'] as const;

/** Direktori yang tidak dipindai (dependensi, keluaran build, dan git internal). */
export const IGNORED_DIRECTORIES = new Set<string>([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.amplify',
  '.vite',
  '.cache',
]);

/** Jenis pelanggaran yang dapat ditemukan penjaga. */
export type SfFontViolationKind = 'font-file' | 'font-face' | 'package';

export interface SfFontViolation {
  kind: SfFontViolationKind;
  /** Lokasi relatif/berlabel sumber pelanggaran. */
  location: string;
  /** Penjelasan singkat berbahasa Indonesia. */
  detail: string;
}

/**
 * Apakah nama berkas menyiratkan font SF. Mencocokkan "SFPro"/"SF Pro"/"SF-Pro"
 * (tanpa peduli huruf besar/kecil) atau token "SF" berdiri sendiri (dibatasi
 * karakter non-huruf), sehingga kata seperti "transfer" tidak salah tertandai.
 */
export function fileNameSuggestsSfFont(fileName: string): boolean {
  const base = fileName.replace(/\.[^.]+$/, '').toLowerCase();
  if (/sf[-_\s]?pro/.test(base)) {
    return true;
  }
  // "sf" sebagai token tersendiri: diawali/diakhiri batas atau karakter non-huruf.
  return /(^|[^a-z])sf([^a-z]|$)/.test(base);
}

/** Apakah path berkas adalah berkas font SF yang dilarang (ekstensi font + nama SF). */
export function isForbiddenFontFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (!FONT_FILE_EXTENSIONS.includes(ext as (typeof FONT_FILE_EXTENSIONS)[number])) {
    return false;
  }
  return fileNameSuggestsSfFont(path.basename(filePath));
}

/** Membuang komentar `/* *\/` dari teks CSS agar tidak salah mendeteksi. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Mengambil daftar nilai `font-family` dari setiap blok `@font-face` pada CSS.
 * Hanya blok `@font-face { ... }` sungguhan yang diperiksa; penyebutan
 * `@font-face` di dalam komentar atau tumpukan `font-family` lain diabaikan.
 */
export function extractFontFaceFamilies(css: string): string[] {
  const withoutComments = stripCssComments(css);
  const families: string[] = [];
  const blockPattern = /@font-face\s*\{([^}]*)\}/gi;
  let block: RegExpExecArray | null;
  while ((block = blockPattern.exec(withoutComments)) !== null) {
    const body = block[1] ?? '';
    const familyMatch = body.match(/font-family\s*:\s*([^;]+)/i);
    if (familyMatch && familyMatch[1] !== undefined) {
      families.push(normalizeFamily(familyMatch[1]));
    }
  }
  return families;
}

/** Menormalkan nilai font-family: buang tanda kutip dan spasi berlebih. */
function normalizeFamily(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '').trim();
}

/**
 * Apakah nama keluarga font berawalan "SF" sebagai merek San Francisco
 * (misalnya "SF Pro", "SFPro", "SF-Pro", "SF Mono", atau tepat "SF").
 * Kata biasa yang kebetulan diawali "sf" lalu huruf kecil (misalnya "Sforza")
 * tidak ditandai, karena keluarga SF selalu diikuti spasi, tanda hubung,
 * huruf kapital, atau akhir string.
 */
export function isForbiddenFontFamily(family: string): boolean {
  const match = /^sf(.?)/i.exec(normalizeFamily(family));
  if (!match) {
    return false;
  }
  const charAfterSf = match[1] ?? '';
  if (charAfterSf === '') {
    return true;
  }
  return !/[a-z]/.test(charAfterSf);
}

/** Pelanggaran `@font-face` SF pada teks CSS tertentu. */
export function findFontFaceViolations(css: string, location: string): SfFontViolation[] {
  return extractFontFaceFamilies(css)
    .filter(isForbiddenFontFamily)
    .map((family) => ({
      kind: 'font-face' as const,
      location,
      detail: `@font-face dengan font-family "${family}" (keluarga SF dilarang, Req 18.3/18.4)`,
    }));
}

/** Apakah nama paket npm adalah paket font SF. Tidak menandai Inter dsb. */
export function isForbiddenFontPackage(name: string): boolean {
  const lower = name.toLowerCase();
  const patterns = [
    /sf[-_]?pro/,
    /san[-_]?francisco/,
    /apple[-_]?sf/,
    /(^|\/)sf[-_]?(font|pro)/,
    /fontsource.*[-/]sf(\b|[-_/])/,
  ];
  return patterns.some((re) => re.test(lower));
}

/** Pelanggaran paket font SF dari isi `package.json`. */
export function findPackageViolations(packageJsonText: string, location = 'package.json'): SfFontViolation[] {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(packageJsonText) as typeof pkg;
  } catch {
    return [];
  }
  const names = new Set<string>([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);
  const violations: SfFontViolation[] = [];
  for (const name of names) {
    if (isForbiddenFontPackage(name)) {
      violations.push({
        kind: 'package',
        location,
        detail: `Dependensi "${name}" tampak sebagai paket font SF (dilarang, Req 18.4)`,
      });
    }
  }
  return violations;
}

/** Mengumpulkan path berkas secara rekursif, melewati direktori yang diabaikan. */
export function collectFiles(root: string): string[] {
  const results: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (!IGNORED_DIRECTORIES.has(entry)) {
          walk(full);
        }
      } else {
        results.push(full);
      }
    }
  };
  walk(root);
  return results;
}

/**
 * Memindai sebuah direktori dan mengumpulkan seluruh pelanggaran font SF:
 * berkas font bernama SF, `@font-face` SF di CSS, dan paket font SF.
 * Fungsi ini membaca sistem berkas tetapi tidak menulis apa pun.
 */
export function scanDirectory(root: string): SfFontViolation[] {
  const violations: SfFontViolation[] = [];
  for (const file of collectFiles(root)) {
    const rel = path.relative(root, file) || path.basename(file);
    const ext = path.extname(file).toLowerCase();

    if (isForbiddenFontFile(file)) {
      violations.push({
        kind: 'font-file',
        location: rel,
        detail: 'Berkas font bernama SF (dilarang mendistribusikan ulang, Req 18.3)',
      });
      continue;
    }

    if (ext === '.css') {
      let css = '';
      try {
        css = readFileSync(file, 'utf8');
      } catch {
        css = '';
      }
      violations.push(...findFontFaceViolations(css, rel));
    }

    if (path.basename(file) === 'package.json') {
      let text = '';
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        text = '';
      }
      violations.push(...findPackageViolations(text, rel));
    }
  }
  return violations;
}

/** Memformat daftar pelanggaran menjadi pesan yang dapat dibaca untuk CI. */
export function formatViolations(violations: SfFontViolation[]): string {
  return violations.map((v) => `  [${v.kind}] ${v.location}: ${v.detail}`).join('\n');
}

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

function main(): void {
  const violations = scanDirectory(REPO_ROOT);
  if (violations.length > 0) {
    console.error('Penjaga font SF menemukan pelanggaran (Req 18.3, 18.4):');
    console.error(formatViolations(violations));
    console.error(
      '\nHapus berkas/paket/@font-face font SF di atas. Perangkat Apple tetap memakai SF ' +
        'secara native lewat Tumpukan_Font_Sistem pada --font-ui.',
    );
    process.exit(1);
  }
  console.log('Tidak ada berkas, @font-face, atau paket font SF yang terdeteksi.');
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
