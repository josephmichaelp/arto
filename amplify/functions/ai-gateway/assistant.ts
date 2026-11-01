import type { Message } from '@aws-sdk/client-bedrock-runtime';
import { loadConfig, type AppConfig } from 'shared/config';
import {
  budgetStatus,
  byCategory,
  daysInMonth,
  formatAmountsInText,
  formatRupiah,
  ownerOf,
  summarize,
  toJakartaDate,
  type Budget,
  type Category,
  type DateRange,
  type Txn,
  type Wallet,
} from 'shared/domain';
import {
  extractConverseText,
  invokeConverse,
  textMessage,
  toAiUnavailableError,
} from './bedrock-client';
import { resolveModel } from './model-resolver';
import { buildAssistantSystem, buildAssistantUserText } from './prompts';
import { enforceRateLimit, type EnforceRateLimitOptions } from './rate-limiter';

/**
 * Operasi `askAssistant` untuk Lambda `ai-gateway` (Requirement 12.1-12.4,
 * Property 18 untuk isolasi konteks).
 *
 * Alur:
 * 1. Tolak identitas kosong lewat `ownerOf` (Req 16.2).
 * 2. Terapkan pembatas pemakaian AI per Pengguna sebelum memanggil Bedrock
 *    (Req 16.3) — bila batas terlampaui, Bedrock tidak dipanggil.
 * 3. Bangun KONTEKS keuangan HANYA dari data Pengguna terautentikasi yang
 *    disuntikkan pemanggil (`buildFinanceContext`): ringkasan bulan berjalan,
 *    5 Kategori pengeluaran terbesar, status Anggaran bulan ini, saldo
 *    Dompet, dan hingga 50 Transaksi terbaru. Pembangun konteks tidak pernah
 *    memuat data di luar yang diberikan (isolasi pemilik, Req 12.3).
 * 4. Pilih model (resolver C1..C3) lalu panggil Bedrock Converse dengan
 *    prompt sistem Asisten (`prompts.ts`). Prompt itu sendiri menolak secara
 *    sopan pertanyaan di luar keuangan pribadi Pengguna (Req 12.4) dan
 *    menegaskan jawaban bersifat informasi umum.
 * 5. Lewatkan jawaban mentah ke `formatAmountsInText` agar setiap nominal
 *    tampil dalam Format_Rupiah (Req 12.2).
 *
 * Pemuatan data Pengguna (repositori ber-scope pemilik) dilakukan di luar
 * modul ini oleh handler `ai-gateway` (tugas 8.8); modul ini hanya menerima
 * `AssistantFinanceData` milik satu Pengguna sehingga mudah diuji tanpa AWS.
 */

/** Batas Transaksi terbaru yang dimuat ke konteks (Req 12.3). */
export const MAX_CONTEXT_TXNS = 50;

/** Batas jumlah Kategori pengeluaran terbesar pada konteks. */
export const MAX_TOP_CATEGORIES = 5;

/** Data keuangan satu Pengguna (sudah ber-scope pemilik) untuk membangun konteks. */
export interface AssistantFinanceData {
  categories: Category[];
  wallets: Wallet[];
  budgets: Budget[];
  /** Transaksi Pengguna; urutan tidak harus terurut, modul yang mengurutkan. */
  txns: Txn[];
}

const TYPE_LABEL: Record<Txn['type'], string> = {
  EXPENSE: 'Pengeluaran',
  INCOME: 'Pemasukan',
  TRANSFER_OUT: 'Transfer keluar',
  TRANSFER_IN: 'Transfer masuk',
  GOAL_DEPOSIT: 'Setoran target',
};

function monthRange(month: string): DateRange {
  return { from: `${month}-01`, to: `${month}-${String(daysInMonth(month)).padStart(2, '0')}` };
}

function nameLookup<T extends { id: string; name: string }>(items: T[]): (id: string | undefined) => string {
  const byId = new Map(items.map((i) => [i.id, i.name]));
  return (id) => (id && byId.get(id)) || '(tanpa kategori)';
}

/**
 * Membangun teks KONTEKS keuangan HANYA dari `data` Pengguna yang diberikan.
 * `nowWib` adalah tanggal hari ini (`YYYY-MM-DD`, WIB); bulan berjalan
 * diturunkan darinya. Fungsi ini murni dan tidak mengakses sumber data lain,
 * sehingga konteks tidak pernah memuat data Pengguna lain (Property 18).
 */
export function buildFinanceContext(data: AssistantFinanceData, nowWib: string): string {
  const month = nowWib.slice(0, 7);
  const range = monthRange(month);
  const categoryName = nameLookup(data.categories);
  const walletName = nameLookup(data.wallets);

  const summary = summarize(data.txns, range);

  const lines: string[] = [];

  lines.push(`Bulan berjalan: ${month} (WIB). Hari ini: ${nowWib}.`);
  lines.push('');
  lines.push('RINGKASAN BULAN BERJALAN:');
  lines.push(`- Pemasukan: ${formatRupiah(summary.income)}`);
  lines.push(`- Pengeluaran: ${formatRupiah(summary.expense)}`);
  lines.push(`- Selisih: ${formatRupiah(summary.net)}`);

  lines.push('');
  lines.push('SALDO DOMPET:');
  if (data.wallets.length === 0) {
    lines.push('- (belum ada Dompet)');
  } else {
    for (const w of data.wallets) {
      lines.push(`- ${w.name}: ${formatRupiah(w.balance)}`);
    }
    const totalBalance = data.wallets.reduce((t, w) => t + w.balance, 0);
    lines.push(`- Total saldo: ${formatRupiah(totalBalance)}`);
  }

  lines.push('');
  lines.push('5 KATEGORI PENGELUARAN TERBESAR BULAN INI:');
  const topCategories = byCategory(data.txns, range).slice(0, MAX_TOP_CATEGORIES);
  if (topCategories.length === 0) {
    lines.push('- (belum ada pengeluaran bulan ini)');
  } else {
    for (const c of topCategories) {
      lines.push(`- ${categoryName(c.categoryId)}: ${formatRupiah(c.total)}`);
    }
  }

  lines.push('');
  lines.push('STATUS ANGGARAN BULAN INI:');
  const monthBudgets = data.budgets.filter((b) => b.month === month);
  if (monthBudgets.length === 0) {
    lines.push('- (belum ada Anggaran bulan ini)');
  } else {
    for (const b of monthBudgets) {
      const status = budgetStatus(b, data.txns);
      lines.push(
        `- ${categoryName(b.categoryId)}: terpakai ${formatRupiah(status.spent)} dari ${formatRupiah(
          b.amount,
        )} (${status.percent}%, sisa ${formatRupiah(status.remaining)}, level ${status.level})`,
      );
    }
  }

  lines.push('');
  lines.push(`TRANSAKSI TERBARU (maksimal ${MAX_CONTEXT_TXNS}):`);
  const recent = [...data.txns]
    .sort((a, b) => (a.date !== b.date ? b.date.localeCompare(a.date) : b.id.localeCompare(a.id)))
    .slice(0, MAX_CONTEXT_TXNS);
  if (recent.length === 0) {
    lines.push('- (belum ada Transaksi)');
  } else {
    for (const t of recent) {
      const note = t.note ? ` — ${t.note}` : '';
      lines.push(
        `- ${t.date} ${TYPE_LABEL[t.type]} ${categoryName(t.categoryId)} [${walletName(
          t.walletId,
        )}] ${formatRupiah(t.amount)}${note}`,
      );
    }
  }

  return lines.join('\n');
}

/** Fungsi Converse yang disuntik: menerima prompt dan pesan, mengembalikan teks jawaban. */
export type ConverseFn = (args: { system: string; messages: Message[] }) => Promise<string>;

export interface AskAssistantParams {
  /** Identitas Cognito Pengguna; `ownerOf` menolak identitas kosong (Req 16.2). */
  identity: { sub?: string | null; username?: string | null } | null | undefined;
  /** Pertanyaan Pengguna (teks DATA; dibungkus pembatas anti prompt injection). */
  question: string;
  /** Data keuangan milik Pengguna terautentikasi (sudah ber-scope pemilik). */
  data: AssistantFinanceData;
  /** Konfigurasi aplikasi; default dari variabel lingkungan. */
  config?: AppConfig;
  /** Instan permintaan; default `new Date()`. */
  now?: Date;
  /** Tanggal hari ini (WIB, `YYYY-MM-DD`); default diturunkan dari `now`. */
  nowWib?: string;
  /** Opsi tambahan pembatas pemakaian (mis. `tableName`, `client`) untuk pengujian. */
  rateLimit?: Partial<Omit<EnforceRateLimitOptions, 'sub' | 'limit' | 'now'>>;
  /** Override dependensi untuk pengujian tanpa AWS. */
  deps?: {
    enforceRateLimit?: typeof enforceRateLimit;
    converse?: ConverseFn;
  };
}

export interface AskAssistantResult {
  /** Pemilik terautentikasi (`<sub>::<username>`). */
  owner: string;
  /** Jawaban asisten dengan nominal sudah berformat Rupiah. */
  answer: string;
}

async function defaultConverse(
  { system, messages }: { system: string; messages: Message[] },
  config: AppConfig,
): Promise<string> {
  const { result } = await resolveModel({
    candidates: config.modelCandidates,
    allowCrossRegion: config.allowCrossRegion,
    invoke: (candidate) => invokeConverse({ candidate, system, messages }),
  });
  return extractConverseText(result);
}

/**
 * Menjawab pertanyaan keuangan Pengguna memakai Bedrock, dengan konteks
 * terbatas pada data Pengguna terautentikasi. Lihat dokumentasi modul untuk
 * urutan langkah dan jaminan (isolasi pemilik, pembatas pemakaian, format
 * nominal).
 */
export async function askAssistant(params: AskAssistantParams): Promise<AskAssistantResult> {
  // 1. Validasi identitas (menolak identitas kosong) dan tentukan pemilik.
  const owner = ownerOf(params.identity);
  const sub = params.identity!.sub!.trim();

  const config = params.config ?? loadConfig();
  const now = params.now ?? new Date();

  // 2. Pembatas pemakaian sebelum memanggil Bedrock.
  const enforce = params.deps?.enforceRateLimit ?? enforceRateLimit;
  await enforce({ sub, limit: config.aiRateLimit, now, ...params.rateLimit });

  // 3. Konteks hanya dari data Pengguna terautentikasi.
  const nowWib = params.nowWib ?? toJakartaDate(now);
  const context = buildFinanceContext(params.data, nowWib);

  // 4. Panggil model dengan prompt Asisten.
  const system = buildAssistantSystem(context);
  const messages: Message[] = [textMessage('user', buildAssistantUserText(params.question))];
  const converse = params.deps?.converse ?? ((args) => defaultConverse(args, config));

  let rawAnswer: string;
  try {
    rawAnswer = await converse({ system, messages });
  } catch (err) {
    throw toAiUnavailableError(err);
  }

  // 5. Format nominal pada jawaban menjadi Format_Rupiah.
  return { owner, answer: formatAmountsInText(rawAnswer) };
}
