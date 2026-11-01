/**
 * Validasi murni untuk keluaran AI (input bahasa alami dan pemindaian
 * struk) serta unggahan struk dan format nominal pada jawaban asisten.
 * Lihat design.md bagian "Modul domain murni" untuk kontrak setiap fungsi.
 *
 * Keluaran model TIDAK PERNAH dipercaya secara langsung: `validateNlResult`
 * dan `validateReceiptResult` menerima `unknown` dan hanya menghasilkan
 * `status: 'ok'` bila `type`, `amount`, dan `categoryId` seluruhnya valid.
 * Selain itu (JSON rusak, nominal hilang/tidak valid, Kategori di luar
 * daftar Pengguna, atau bentuk acak) SHALL menghasilkan `needs_amount`
 * sehingga Transaksi tidak pernah disimpan otomatis dari data tidak valid.
 */
import { formatRupiah } from './money';
import type { Category, Rupiah, Txn } from './types';

export type NlResult =
  | { status: 'ok'; type: 'EXPENSE' | 'INCOME'; amount: Rupiah; date: string; categoryId: string }
  | { status: 'needs_amount'; draft: Partial<Txn> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function extractAmount(v: unknown): Rupiah | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v > 0) {
    return v;
  }
  return undefined;
}

function extractType(v: unknown): 'EXPENSE' | 'INCOME' | undefined {
  return v === 'EXPENSE' || v === 'INCOME' ? v : undefined;
}

function extractCategoryId(v: unknown, categories: Category[]): string | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  return categories.some((c) => c.id === v) ? v : undefined;
}

/** Tanggal kosong atau tidak berformat `YYYY-MM-DD` diganti `todayWib`. */
function extractDate(v: unknown, todayWib: string): string {
  return typeof v === 'string' && DATE_RE.test(v) ? v : todayWib;
}

function extractNonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/**
 * Memvalidasi keluaran AI untuk penafsiran input bahasa alami (Req 10.2,
 * 10.5, 10.6, 10.7). `categoryId` hanya diterima bila ada pada
 * `ctx.categories` milik Pengguna; selain itu dianggap tidak ada.
 */
export function validateNlResult(
  raw: unknown,
  ctx: { categories: Category[]; todayWib: string },
): NlResult {
  const obj = isPlainObject(raw) ? raw : {};

  const type = extractType(obj.type);
  const amount = extractAmount(obj.amount);
  const categoryId = extractCategoryId(obj.categoryId, ctx.categories);
  const date = extractDate(obj.date, ctx.todayWib);

  if (type && amount !== undefined && categoryId) {
    return { status: 'ok', type, amount, date, categoryId };
  }

  const draft: Partial<Txn> = { date };
  if (type) draft.type = type;
  if (amount !== undefined) draft.amount = amount;
  if (categoryId) draft.categoryId = categoryId;
  const walletId = extractNonEmptyString(obj.walletId);
  if (walletId) draft.walletId = walletId;
  const note = extractNonEmptyString(obj.note);
  if (note) draft.note = note;

  return { status: 'needs_amount', draft };
}

/**
 * Memvalidasi keluaran AI untuk pemindaian struk (Req 11.4). Aturan sama
 * dengan `validateNlResult`, ditambah `merchant` opsional bila terbaca pada
 * keluaran model.
 */
export function validateReceiptResult(
  raw: unknown,
  ctx: { categories: Category[]; todayWib: string },
): NlResult & { merchant?: string } {
  const base = validateNlResult(raw, ctx);
  const merchant = isPlainObject(raw) ? extractNonEmptyString(raw.merchant) : undefined;
  return merchant ? { ...base, merchant } : base;
}

const ALLOWED_UPLOAD_TYPES = new Set(['image/jpeg', 'image/png']);
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;

/**
 * Memvalidasi unggahan struk (Req 11.1, 11.3): tipe JPEG atau PNG, ukuran
 * lebih dari 0 dan paling besar 5 * 1024 * 1024 byte.
 */
export function validateUpload(file: {
  type: string;
  size: number;
}): { ok: true } | { ok: false; message: string } {
  if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
    return { ok: false, message: 'Berkas harus berformat JPEG atau PNG' };
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_UPLOAD_SIZE) {
    return { ok: false, message: 'Ukuran berkas harus lebih dari 0 dan paling besar 5 MB' };
  }
  return { ok: true };
}

/** Mengenali nominal Rupiah dalam teks, mis. "Rp 12.000", "Rp12000", "Rp 12,000". */
const RUPIAH_TEXT_RE = /\bRp\.?\s*(\d{1,3}(?:[.,]\d{3})+|\d+)\b/gi;

/**
 * Mengganti setiap nominal Rupiah pada teks jawaban asisten dengan
 * Format_Rupiah (Req 12.2). Teks tanpa nominal tidak berubah.
 */
export function formatAmountsInText(text: string): string {
  if (typeof text !== 'string' || !text) {
    return text;
  }
  return text.replace(RUPIAH_TEXT_RE, (match, digitsRaw: string) => {
    const digits = digitsRaw.replace(/[.,]/g, '');
    const value = Number(digits);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return match;
    }
    return formatRupiah(value);
  });
}
