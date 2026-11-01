import { z } from 'zod';
import type { AppConfig } from 'shared/config';
import { loadConfig } from 'shared/config';
import {
  parseAmountShorthand,
  toJakartaDate,
  validateNlResult,
  type Category,
  type NlResult,
} from 'shared/domain';
import { extractConverseText, invokeConverse, textMessage } from './bedrock-client';
import { resolveModel } from './model-resolver';
import { buildParseNaturalSystem, buildParseNaturalUserText } from './prompts';
import { enforceRateLimit } from './rate-limiter';

/**
 * Operasi `parseNaturalInput` pada `ai-gateway` (Requirement 10.1, 10.2,
 * 10.3, 10.5, 10.6, 10.7; design.md bagian Lambda `ai-gateway`).
 *
 * Alur:
 * 1. Terapkan pembatas pemakaian per Pengguna sebelum memanggil Bedrock
 *    (lihat `rate-limiter.ts`). Bila batas terlampaui, galat `RATE_LIMITED`
 *    dilempar dan model tidak pernah dipanggil.
 * 2. Resolusikan kandidat model (lihat `model-resolver.ts`) dan panggil
 *    Bedrock Converse (lihat `bedrock-client.ts`) dengan prompt sistem
 *    berbahasa Indonesia dan pembatas data anti prompt injection
 *    (lihat `prompts.ts`).
 * 3. Keluaran model TIDAK dipercaya: JSON diparse dan divalidasi bentuknya
 *    dengan Zod (satu percobaan ulang bila gagal), nominal DIHITUNG ULANG
 *    lewat `parseAmountShorthand` (bukan dipercaya dari model), lalu
 *    `validateNlResult` memastikan `categoryId` hanya dari Kategori Pengguna
 *    dan tanggal kosong diganti `todayWib`.
 * 4. Hasilnya adalah PRATINJAU yang tidak disimpan. `status: 'ok'` hanya saat
 *    `type`, `amount`, dan `categoryId` seluruhnya valid; selain itu
 *    `status: 'needs_amount'` dengan draf, sehingga Transaksi tidak pernah
 *    disimpan otomatis dari data tidak valid (Property 15).
 */

/** Jumlah percobaan validasi keluaran model: satu percobaan awal + satu ulang. */
const MAX_MODEL_ATTEMPTS = 2;

/**
 * Skema longgar untuk bentuk JSON yang diminta dari model. Kebenaran nilai
 * TIDAK dipercaya di sini; `validateNlResult` di hilir yang memutuskan.
 * `amount` diterima sebagai angka atau string (singkatan seperti "35rb")
 * karena akan dihitung ulang lewat `parseAmountShorthand`.
 */
const modelOutputSchema = z.object({
  type: z.string().optional(),
  amount: z.union([z.number(), z.string()]).optional(),
  date: z.string().optional(),
  categoryId: z.string().optional(),
  note: z.string().optional(),
});

type ModelOutput = z.infer<typeof modelOutputSchema>;

export interface ParseNaturalInputRequest {
  /** `sub` Pengguna terautentikasi (dipakai pembatas pemakaian). */
  sub: string;
  /** Kalimat bahasa alami dari Pengguna. */
  sentence: string;
  /** Kategori milik Pengguna; `categoryId` hanya boleh dari daftar ini. */
  categories: Category[];
  /** Tanggal hari ini (WIB, `YYYY-MM-DD`); default dihitung dari `now`. */
  todayWib?: string;
  /** Instan permintaan; default `new Date()`. */
  now?: Date;
}

/** Konteks pemanggilan model yang diberikan ke `invokeModel`. */
export interface ModelInvocationContext {
  system: string;
  userText: string;
  config: AppConfig;
}

export interface ParseNaturalInputDeps {
  /**
   * Pemanggil model yang mengembalikan teks balasan mentah. Default memakai
   * `resolveModel` + `invokeConverse`. Dapat disuntik pada pengujian agar
   * tidak memanggil jaringan/AWS.
   */
  invokeModel?: (ctx: ModelInvocationContext) => Promise<string>;
  /** Penerap pembatas pemakaian; default `enforceRateLimit`. Disuntik pada pengujian. */
  enforceRateLimit?: typeof enforceRateLimit;
  /** Konfigurasi aplikasi; default `loadConfig()`. */
  config?: AppConfig;
}

/** Pemanggil model bawaan: resolusi kandidat lalu Converse, kembalikan teks. */
async function defaultInvokeModel(ctx: ModelInvocationContext): Promise<string> {
  const { result } = await resolveModel({
    candidates: ctx.config.modelCandidates,
    allowCrossRegion: ctx.config.allowCrossRegion,
    invoke: (candidate) =>
      invokeConverse({
        candidate,
        system: ctx.system,
        messages: [textMessage('user', ctx.userText)],
      }),
  });
  return extractConverseText(result);
}

/**
 * Mengekstrak satu objek JSON dari teks balasan model. Menoleransi blok kode
 * (```json ... ```) dan teks pembungkus dengan mengambil dari `{` pertama
 * sampai `}` terakhir. Mengembalikan `undefined` bila tidak ada JSON objek
 * valid.
 */
function extractJsonObject(text: string): unknown {
  if (typeof text !== 'string') return undefined;
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return undefined;
  const slice = stripped.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return undefined;
  }
}

/**
 * Menghitung ulang nominal dari keluaran model lewat `parseAmountShorthand`,
 * bukan mempercayai angka mentah. Menerima angka maupun string singkatan.
 */
function recomputeAmount(raw: ModelOutput['amount']): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const asString = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : '';
  if (!asString.trim()) return undefined;
  return parseAmountShorthand(asString) ?? undefined;
}

/**
 * Memvalidasi bentuk JSON dengan Zod lalu menghitung ulang nominal. Hasilnya
 * adalah objek siap diteruskan ke `validateNlResult`, atau `undefined` bila
 * JSON tidak dapat diparse/divalidasi (memicu percobaan ulang).
 */
function toValidatedRaw(text: string): Record<string, unknown> | undefined {
  const json = extractJsonObject(text);
  if (json === undefined) return undefined;
  const parsed = modelOutputSchema.safeParse(json);
  if (!parsed.success) return undefined;
  const data = parsed.data;
  return {
    type: data.type,
    amount: recomputeAmount(data.amount),
    date: data.date,
    categoryId: data.categoryId,
    note: data.note,
  };
}

/**
 * Menafsirkan satu kalimat bahasa alami menjadi pratinjau Transaksi yang
 * tidak disimpan. Lihat dokumentasi modul untuk alur lengkap.
 */
export async function parseNaturalInput(
  req: ParseNaturalInputRequest,
  deps: ParseNaturalInputDeps = {},
): Promise<NlResult> {
  const config = deps.config ?? loadConfig();
  const enforce = deps.enforceRateLimit ?? enforceRateLimit;
  const invokeModel = deps.invokeModel ?? defaultInvokeModel;

  const now = req.now ?? new Date();
  const todayWib = req.todayWib ?? toJakartaDate(now);
  const categories = req.categories ?? [];

  // 1. Pembatas pemakaian sebelum memanggil Bedrock (Req 16.3).
  await enforce({ sub: req.sub, limit: config.aiRateLimit, now });

  // 2. Prompt sistem + data Pengguna (dibungkus pembatas anti prompt injection).
  const system = buildParseNaturalSystem({ categories, todayWib });
  const userText = buildParseNaturalUserText(req.sentence);

  // 3. Panggil model; validasi Zod dengan satu percobaan ulang. Nominal
  //    dihitung ulang lewat `parseAmountShorthand` di `toValidatedRaw`.
  let validatedRaw: Record<string, unknown> = {};
  for (let attempt = 0; attempt < MAX_MODEL_ATTEMPTS; attempt++) {
    const text = await invokeModel({ system, userText, config });
    const candidate = toValidatedRaw(text);
    if (candidate) {
      validatedRaw = candidate;
      break;
    }
  }

  // 4. Validasi akhir (categoryId hanya dari Kategori Pengguna, tanggal kosong
  //    diganti todayWib). Hasil adalah pratinjau; tidak pernah disimpan di sini.
  return validateNlResult(validatedRaw, { categories, todayWib });
}
