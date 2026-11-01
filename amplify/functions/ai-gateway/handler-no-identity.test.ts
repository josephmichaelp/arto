import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from 'shared/config';
import type { Category } from 'shared/domain';
import {
  runAiGateway,
  AI_UNAUTHENTICATED,
  type AiGatewayEvent,
  type AiGatewayHandlerDeps,
  type AiOperation,
  type FinanceRepo,
} from './handler';
import type { AssistantFinanceData } from './assistant';

/**
 * Uji unit handler `ai-gateway` TANPA identitas (tugas 8.11; Requirement 16.2).
 *
 * Req 16.2 menuntut Layanan_AI hanya dipanggil dari fungsi backend yang
 * memverifikasi identitas Pengguna terautentikasi. Berkas ini membuktikan
 * sifat tersebut secara menyeluruh untuk SETIAP operasi AI:
 *
 *   Untuk setiap operasi × setiap bentuk identitas kosong/hilang,
 *   `runAiGateway` mengembalikan galat `UNAUTHENTICATED` SEBELUM
 *   - memuat data apa pun (repo tidak disentuh),
 *   - menegakkan pembatas pemakaian (enforceRateLimit tidak dipanggil), dan
 *   - memanggil Bedrock (tidak ada modul operasi yang dijalankan).
 *
 * Seluruh dependensi disuntik sebagai spy, sehingga uji berjalan tanpa
 * AWS/Bedrock dan setiap jalur yang menyentuh data Pengguna dapat diperiksa.
 * Berkas ini sengaja terpisah dari `handler.test.ts` dan hanya berfokus pada
 * kontrak identitas kosong.
 */

const categories: Category[] = [
  { id: 'c-makan', name: 'Makan', type: 'EXPENSE' },
  { id: 'c-gaji', name: 'Gaji', type: 'INCOME' },
];

const assistantData: AssistantFinanceData = {
  categories,
  wallets: [{ id: 'w-tunai', name: 'Tunai', initialBalance: 0, balance: 1_000_000 }],
  budgets: [],
  txns: [],
};

const config: AppConfig = {
  bedrockRegion: 'ap-southeast-3',
  modelCandidates: [{ modelId: 'amazon.nova-lite-v1:0', region: 'ap-southeast-3' }],
  allowCrossRegion: true,
  aiRateLimit: 30,
};

/** Masukan valid per operasi, agar satu-satunya alasan penolakan adalah identitas. */
const VALID_INPUT: Record<AiOperation, unknown> = {
  parseNaturalInput: { sentence: 'kopi 20rb' },
  createReceiptUpload: { contentType: 'image/jpeg', size: 1024 },
  scanReceipt: { key: 'receipts/sub-123/u1' },
  askAssistant: { question: 'berapa saldo saya?' },
};

const ALL_OPERATIONS: AiOperation[] = [
  'parseNaturalInput',
  'createReceiptUpload',
  'scanReceipt',
  'askAssistant',
];

/**
 * Bentuk-bentuk identitas yang HARUS ditolak. Mencakup identitas hilang
 * sepenuhnya, bagian kosong, dan hanya-spasi, baik di akar maupun di `claims`.
 */
const EMPTY_IDENTITIES: Array<{ label: string; identity: unknown }> = [
  { label: 'null', identity: null },
  { label: 'undefined', identity: undefined },
  { label: 'objek kosong', identity: {} },
  { label: 'sub dan username string kosong', identity: { sub: '', username: '' } },
  { label: 'sub kosong, username ada', identity: { sub: '', username: 'ana' } },
  { label: 'sub ada, username kosong', identity: { sub: 'sub-123', username: '' } },
  { label: 'sub hanya spasi', identity: { sub: '   ', username: 'ana' } },
  { label: 'username hanya spasi', identity: { sub: 'sub-123', username: '  ' } },
  { label: 'sub saja tanpa username', identity: { sub: 'sub-123' } },
  { label: 'username saja tanpa sub', identity: { username: 'ana' } },
  { label: 'sub/username null', identity: { sub: null, username: null } },
  { label: 'claims kosong', identity: { claims: {} } },
  { label: 'claims sub kosong', identity: { claims: { sub: '', 'cognito:username': '' } } },
  { label: 'claims sub saja tanpa username', identity: { claims: { sub: 'sub-9' } } },
];

type TrackedDeps = AiGatewayHandlerDeps & {
  repo: FinanceRepo;
  enforceRateLimit: ReturnType<typeof vi.fn>;
  parseNaturalInput: ReturnType<typeof vi.fn>;
  createReceiptUpload: ReturnType<typeof vi.fn>;
  scanReceipt: ReturnType<typeof vi.fn>;
  askAssistant: ReturnType<typeof vi.fn>;
};

/**
 * Membuat dependensi handler yang seluruhnya di-spy. Setiap spy yang menyentuh
 * data Pengguna atau Bedrock di-resolve dengan nilai yang masuk akal, agar bila
 * (dan hanya bila) handler keliru memanggilnya, uji tetap dapat memverifikasi
 * pelanggaran lewat jumlah panggilan — bukan lewat galat tak terkait.
 */
function trackedDeps(): TrackedDeps {
  const repo: FinanceRepo = {
    listCategories: vi.fn().mockResolvedValue(categories),
    loadAssistantData: vi.fn().mockResolvedValue(assistantData),
  };
  return {
    config,
    now: () => new Date('2025-01-15T03:00:00Z'),
    repo,
    enforceRateLimit: vi.fn().mockResolvedValue({ key: 'k', count: 1, bucket: 'b' }),
    parseNaturalInput: vi.fn().mockResolvedValue({ status: 'ok' }),
    createReceiptUpload: vi.fn().mockResolvedValue({ key: 'receipts/x', url: 'https://x', fields: {}, expiresAt: 'z' }),
    scanReceipt: vi.fn().mockResolvedValue({ status: 'needs_amount', draft: {} }),
    askAssistant: vi.fn().mockResolvedValue({ answer: 'Rp 0' }),
  };
}

function event(fieldName: string, input: unknown, identity: unknown): AiGatewayEvent {
  return {
    info: { fieldName },
    arguments: { input },
    identity: identity as AiGatewayEvent['identity'],
  };
}

/** Semua spy "berbahaya" (data load, pembatas, dan modul Bedrock). */
function sideEffectSpies(deps: TrackedDeps): ReturnType<typeof vi.fn>[] {
  return [
    deps.repo.listCategories as ReturnType<typeof vi.fn>,
    deps.repo.loadAssistantData as ReturnType<typeof vi.fn>,
    deps.enforceRateLimit,
    deps.parseNaturalInput,
    deps.createReceiptUpload,
    deps.scanReceipt,
    deps.askAssistant,
  ];
}

describe('runAiGateway menolak identitas kosong untuk setiap operasi (Req 16.2)', () => {
  for (const op of ALL_OPERATIONS) {
    describe(`operasi ${op}`, () => {
      for (const { label, identity } of EMPTY_IDENTITIES) {
        it(`menolak identitas "${label}" dengan UNAUTHENTICATED`, async () => {
          const deps = trackedDeps();
          const res = await runAiGateway(event(op, VALID_INPUT[op], identity), deps);

          expect(res.ok).toBe(false);
          if (!res.ok) {
            expect(res.code).toBe(AI_UNAUTHENTICATED);
            // Pesan ramah berbahasa Indonesia, tanpa detail internal.
            expect(res.message).toMatch(/masuk kembali/i);
          }
        });

        it(`tidak memuat data, tidak menegakkan pembatas, tidak memanggil Bedrock untuk "${label}"`, async () => {
          const deps = trackedDeps();
          await runAiGateway(event(op, VALID_INPUT[op], identity), deps);

          for (const spy of sideEffectSpies(deps)) {
            expect(spy).not.toHaveBeenCalled();
          }
        });
      }
    });
  }
});

describe('runAiGateway memproses identitas valid (kontras positif)', () => {
  it('identitas lengkap melewati penjaga identitas dan menjalankan operasi', async () => {
    const deps = trackedDeps();
    const res = await runAiGateway(
      event('parseNaturalInput', VALID_INPUT.parseNaturalInput, { sub: 'sub-123', username: 'ana' }),
      deps,
    );

    expect(res.ok).toBe(true);
    // Membuktikan bahwa penolakan di atas memang karena identitas kosong,
    // bukan karena konfigurasi uji yang menghalangi semua jalur.
    expect(deps.repo.listCategories).toHaveBeenCalledWith('sub-123::ana');
    expect(deps.enforceRateLimit).toHaveBeenCalledTimes(1);
    expect(deps.parseNaturalInput).toHaveBeenCalledTimes(1);
  });
});
