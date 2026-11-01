/**
 * Ekspor dan impor CSV untuk baris Transaksi (ExportRow).
 *
 * Format: UTF-8, header pada baris pertama, nominal ditulis sebagai bilangan
 * bulat tanpa pemisah ribuan, dan bidang yang memuat koma, tanda kutip, atau
 * baris baru di-escape dengan tanda kutip ganda (gaya RFC 4180).
 */

import type { ExportRow } from './types';

const HEADERS = ['date', 'type', 'category', 'wallet', 'amount', 'note'] as const;
const EOL = '\r\n';

/** Escape satu bidang CSV. Membungkus dengan kutip bila perlu. */
function escapeField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Mengubah daftar ExportRow menjadi teks CSV (UTF-8, tanpa BOM).
 * Nominal ditulis sebagai bilangan bulat tanpa pemisah.
 */
export function toCsv(rows: ExportRow[]): string {
  const lines = [HEADERS.join(',')];
  for (const row of rows) {
    const fields = [
      row.date,
      row.type,
      row.category,
      row.wallet,
      String(Math.trunc(row.amount)),
      row.note ?? '',
    ].map(escapeField);
    lines.push(fields.join(','));
  }
  return lines.join(EOL);
}

/** Mem-parse satu baris CSV (string tanpa pemisah baris akhir) menjadi bidang mentah. */
function parseLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Mem-parse teks CSV (hasil toCsv atau setara) menjadi daftar ExportRow.
 * Mendukung bidang yang berisi koma, tanda kutip, dan baris baru yang di-escape.
 */
export function fromCsv(csv: string): ExportRow[] {
  const text = csv.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let current = '';
  let inQuotes = false;
  const rawRecords: string[] = [];

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      current += ch;
      if (ch === '"') {
        if (text[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      }
    } else if (ch === '"') {
      inQuotes = true;
      current += ch;
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') {
        i += 1;
      }
      rawRecords.push(current);
      current = '';
    } else if (ch === '\n') {
      rawRecords.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length > 0 || rawRecords.length === 0) {
    rawRecords.push(current);
  }

  for (const rec of rawRecords) {
    if (rec.length === 0) continue;
    records.push(parseLine(rec));
  }

  if (records.length === 0) return [];
  const [, ...dataRecords] = records;

  return dataRecords.map((fields): ExportRow => ({
    date: fields[0] ?? '',
    type: fields[1] ?? '',
    category: fields[2] ?? '',
    wallet: fields[3] ?? '',
    amount: Math.trunc(Number(fields[4] ?? '0')),
    note: fields[5] ?? '',
  }));
}
