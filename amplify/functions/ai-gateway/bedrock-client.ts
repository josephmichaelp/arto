import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type ConverseCommandInput,
  type ConverseCommandOutput,
  type ImageFormat,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import type { ModelCandidate } from 'shared/config';
import { safeLogPayload } from 'shared/domain';

/**
 * Pembungkus Amazon Bedrock Converse (Requirement 12.1, 16.1, 16.4).
 *
 * - Timeout klien 20 detik per panggilan (`AbortController`), terpisah dari
 *   timeout Lambda 25 detik dan timeout klien peramban 30 detik (Req 12.5).
 * - Setiap galat dicatat hanya lewat `safeLogPayload` (tanpa pernah
 *   mencantumkan isi data keuangan atau teks Pengguna pada log, Req 16.4).
 * - Galat karena timeout dipetakan ke nama `TimeoutError` agar
 *   `model-resolver.ts` memperlakukannya sebagai galat sementara (dicoba
 *   ulang sekali pada kandidat yang sama), sementara galat lain diteruskan
 *   dengan nama aslinya (mis. `AccessDeniedException`) agar resolver tetap
 *   dapat memutuskan pindah kandidat.
 * - `AiUnavailableError` (`AI_UNAVAILABLE`) adalah galat umum untuk
 *   dipakai pemanggil (mis. `ai-gateway/handler.ts`) saat memetakan
 *   kegagalan Bedrock menjadi respons akhir kepada Pengguna. Ini berbeda
 *   dari `AI_MODEL_UNAVAILABLE` milik `model-resolver.ts`, yang khusus
 *   menandai seluruh rantai kandidat gagal.
 */

const CONVERSE_TIMEOUT_MS = 20_000;

const clientsByRegion = new Map<string, BedrockRuntimeClient>();

function getClient(region: string): BedrockRuntimeClient {
  let client = clientsByRegion.get(region);
  if (!client) {
    client = new BedrockRuntimeClient({ region });
    clientsByRegion.set(region, client);
  }
  return client;
}

/** Mengosongkan cache klien per region. Dipakai oleh pengujian. */
export function resetBedrockClients(): void {
  clientsByRegion.clear();
}

export const AI_UNAVAILABLE = 'AI_UNAVAILABLE';

/** Galat umum saat Bedrock tidak dapat dipanggil sama sekali (Req 16.4). */
export class AiUnavailableError extends Error {
  readonly code = AI_UNAVAILABLE;

  constructor(message = 'Layanan AI tidak tersedia saat ini. Coba lagi nanti.', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AiUnavailableError';
  }
}

/** Memetakan sembarang galat menjadi `AiUnavailableError`, tanpa membungkus dua kali. */
export function toAiUnavailableError(err: unknown): AiUnavailableError {
  if (err instanceof AiUnavailableError) return err;
  return new AiUnavailableError(undefined, { cause: err });
}

export interface ConverseParams {
  /** Kandidat model terpilih (lihat `model-resolver.ts`), menentukan `modelId` dan region klien. */
  candidate: ModelCandidate;
  /** Prompt sistem berbahasa Indonesia, lihat `prompts.ts`. */
  system: string;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
}

function contentLength(message: Message): number {
  const content = message.content ?? [];
  return content.reduce((total: number, block: ContentBlock) => {
    const text = (block as { text?: unknown }).text;
    return total + (typeof text === 'string' ? text.length : 0);
  }, 0);
}

function timeoutError(cause: unknown): Error {
  const err = new Error('Permintaan ke Bedrock melewati batas waktu 20 detik');
  err.name = 'TimeoutError';
  (err as { cause?: unknown }).cause = cause;
  return err;
}

function isAbortError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError';
}

function toLogFields(err: unknown, candidate: ModelCandidate, inputLength: number): Record<string, unknown> {
  const e = err as {
    name?: unknown;
    message?: unknown;
    $metadata?: { httpStatusCode?: unknown; requestId?: unknown };
  } | null;
  return {
    name: e?.name,
    code: e?.name,
    httpStatus: e?.$metadata?.httpStatusCode,
    requestId: e?.$metadata?.requestId,
    candidate: `${candidate.modelId}@${candidate.region}`,
    inputLength,
  };
}

/**
 * Memanggil Bedrock Converse untuk satu kandidat, dengan timeout klien 20
 * detik. Melempar ulang galat asli (nama dipertahankan) kecuali saat
 * timeout, yang dipetakan ke `TimeoutError`. Dipakai sebagai `invoke` pada
 * `resolveModel` (`model-resolver.ts`).
 */
export async function invokeConverse(params: ConverseParams): Promise<ConverseCommandOutput> {
  const { candidate, system, messages, maxTokens = 1024, temperature = 0 } = params;
  const client = getClient(candidate.region);
  const input: ConverseCommandInput = {
    modelId: candidate.modelId,
    system: [{ text: system }],
    messages,
    inferenceConfig: { maxTokens, temperature },
  };
  const inputLength = messages.reduce((total, m) => total + contentLength(m), 0) + system.length;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONVERSE_TIMEOUT_MS);

  try {
    return await client.send(new ConverseCommand(input), { abortSignal: controller.signal });
  } catch (err) {
    const resolved = isAbortError(err) || controller.signal.aborted ? timeoutError(err) : err;
    // eslint-disable-next-line no-console -- log aman, lihat safeLogPayload
    console.error('bedrock-client: panggilan Converse gagal', safeLogPayload(toLogFields(resolved, candidate, inputLength)));
    throw resolved;
  } finally {
    clearTimeout(timer);
  }
}

/** Mengekstrak teks gabungan dari keluaran Converse (blok `text` pada pesan balasan). */
export function extractConverseText(output: ConverseCommandOutput): string {
  const content = output.output?.message?.content ?? [];
  return content
    .map((block) => (typeof (block as { text?: unknown }).text === 'string' ? (block as { text: string }).text : ''))
    .join('');
}

/** Membangun pesan teks sederhana untuk Converse. */
export function textMessage(role: 'user' | 'assistant', text: string): Message {
  return { role, content: [{ text }] };
}

/** Membangun pesan Pengguna berisi teks dan satu gambar (Req 11.2, untuk `scanReceipt`). */
export function imageMessage(text: string, image: { format: ImageFormat; bytes: Uint8Array }): Message {
  return {
    role: 'user',
    content: [{ text }, { image: { format: image.format, source: { bytes: image.bytes } } }],
  };
}
