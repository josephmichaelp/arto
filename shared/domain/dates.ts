/**
 * Helper tanggal murni untuk domain Arto. Semua perhitungan hari dan bulan
 * mengikuti Zona_Waktu_Pengguna (Asia/Jakarta, WIB, UTC+7 tetap tanpa DST,
 * K-7). Tanggal kalender (`YYYY-MM-DD`) dan bulan (`YYYY-MM`) diperlakukan
 * sebagai nilai murni dan diarit menggunakan epoch UTC agar bebas dari efek
 * zona waktu lokal mesin yang menjalankan kode ini.
 */

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

const BULAN_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toUtcDateOnly(year: number, month0: number, day: number): Date {
  return new Date(Date.UTC(year, month0, day));
}

function formatYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Parse `YYYY-MM-DD` menjadi `Date` UTC tengah malam. Melempar galat bila format tidak valid. */
function parseDateOnly(date: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) {
    throw new Error('Tanggal harus berformat YYYY-MM-DD');
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = toUtcDateOnly(year, month - 1, day);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new Error('Tanggal tidak valid');
  }
  return d;
}

/** Parse `YYYY-MM` menjadi `{ year, month0 }` (month0 berbasis 0). Melempar galat bila tidak valid. */
function parseMonthOnly(month: string): { year: number; month0: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) {
    throw new Error('Bulan harus berformat YYYY-MM');
  }
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  if (month0 < 0 || month0 > 11) {
    throw new Error('Bulan tidak valid');
  }
  return { year, month0 };
}

/**
 * Mengonversi sebuah instan (Date atau string yang dapat diparse Date, mis.
 * ISO UTC) menjadi tanggal kalender `YYYY-MM-DD` menurut WIB (UTC+7).
 */
export function toJakartaDate(instant: Date | string): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) {
    throw new Error('Instan tidak valid');
  }
  const jakarta = new Date(d.getTime() + JAKARTA_OFFSET_MS);
  return formatYmd(jakarta);
}

/**
 * Mengonversi sebuah instan menjadi bulan kalender `YYYY-MM` menurut WIB.
 */
export function toJakartaMonth(instant: Date | string): string {
  return toJakartaDate(instant).slice(0, 7);
}

/**
 * Memformat tanggal `YYYY-MM-DD` menjadi "17 Agustus 2025" (nama bulan
 * bahasa Indonesia, tanpa angka nol di depan pada tanggal).
 */
export function formatDateId(date: string): string {
  const d = parseDateOnly(date);
  return `${d.getUTCDate()} ${BULAN_ID[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Menambah (atau mengurangi, bila `n` negatif) `n` hari pada tanggal
 * `YYYY-MM-DD` dan mengembalikan tanggal hasilnya dalam format yang sama.
 */
export function addDays(date: string, n: number): string {
  const d = parseDateOnly(date);
  d.setUTCDate(d.getUTCDate() + n);
  return formatYmd(d);
}

/**
 * Menghasilkan rentang minggu Senin-Minggu yang memuat `date`. `end` adalah
 * hari Minggu pada minggu tersebut (boleh sama dengan `date` bila `date`
 * sudah hari Minggu) dan `start` adalah Senin enam hari sebelumnya.
 */
export function weekRangeEnding(date: string): { start: string; end: string } {
  const d = parseDateOnly(date);
  const dayOfWeek = d.getUTCDay(); // 0 = Minggu, 1 = Senin, ..., 6 = Sabtu
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const start = addDays(date, -daysSinceMonday);
  const end = addDays(start, 6);
  return { start, end };
}

/** Jumlah hari dalam bulan `YYYY-MM`. */
export function daysInMonth(month: string): number {
  const { year, month0 } = parseMonthOnly(month);
  // Tanggal ke-0 bulan berikutnya = hari terakhir bulan ini.
  return toUtcDateOnly(year, month0 + 1, 0).getUTCDate();
}
