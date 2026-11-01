/**
 * Hook TanStack Query (useMutation) untuk operasi AI lewat Lambda `ai-gateway`
 * (Req 10.1-10.7, 11.1-11.5, 12.1-12.4, 16.1-16.3).
 *
 * Setiap mutation memanggil custom mutation GraphQL yang diteruskan ke Lambda
 * `ai-gateway`. Tidak ada invalidasi query karena operasi AI tidak mengubah
 * data DynamoDB secara langsung (perubahan data terjadi lewat `saveTransaction`
 * setelah Pengguna mengonfirmasi pratinjau).
 */
import { useMutation } from '@tanstack/react-query';
import { loadAmplifyOutputs } from '../app/amplify';
import { getDataClient } from '../app/dataClient';

// ---------------------------------------------------------------------------
// Helper internal
// ---------------------------------------------------------------------------

async function callAiGateway<T>(mutationName: string, payload: Record<string, unknown>): Promise<T> {
  if (!loadAmplifyOutputs()) {
    throw new Error('Amplify belum dikonfigurasi. Hubungkan ke backend sebelum menggunakan fitur AI.');
  }
  const client = getDataClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = (client.mutations as any)[mutationName] as
    | ((args: { input: unknown }) => Promise<{ data: T | null; errors?: { message: string }[] }>)
    | undefined;
  if (!fn) throw new Error(`Mutasi AI ${mutationName} tidak ditemukan pada klien`);

  const { data, errors } = await fn({ input: payload });
  if (errors?.length) throw new Error(errors[0]?.message ?? `Gagal menjalankan ${mutationName}`);
  return data as T;
}

// ---------------------------------------------------------------------------
// Tipe hasil AI
// ---------------------------------------------------------------------------

/** Hasil dari `parseNaturalInput` — pratinjau yang dapat diedit sebelum disimpan. */
export interface NaturalInputPreview {
  type?: string;
  amount?: number;
  date?: string;
  categoryId?: string;
  note?: string;
  needsAmount?: boolean;
}

/** Hasil dari `scanReceipt` — pratinjau dari struk. */
export interface ReceiptPreview {
  total?: number;
  date?: string;
  merchant?: string;
  categoryId?: string;
  needsAmount?: boolean;
}

/** Hasil dari `createReceiptUpload` — URL presigned POST untuk mengunggah struk. */
export interface ReceiptUploadUrl {
  url: string;
  fields: Record<string, string>;
  key: string;
}

/** Hasil dari `askAssistant` — jawaban teks berbahasa Indonesia. */
export interface AssistantAnswer {
  text: string;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Kirim kalimat bebas berbahasa Indonesia dan terima pratinjau Transaksi
 * yang dapat diedit (Req 10.1-10.7).
 */
export function useParseNaturalInput() {
  return useMutation<NaturalInputPreview, Error, { text: string }>({
    mutationFn: ({ text }) => callAiGateway('parseNaturalInput', { text }),
  });
}

/**
 * Minta presigned POST URL untuk mengunggah foto struk ke S3 (Req 11.1, 11.2).
 */
export function useCreateReceiptUpload() {
  return useMutation<ReceiptUploadUrl, Error, { contentType: string; fileSize: number }>({
    mutationFn: ({ contentType, fileSize }) =>
      callAiGateway('createReceiptUpload', { contentType, fileSize }),
  });
}

/**
 * Pindai struk yang sudah diunggah dan terima pratinjau Transaksi (Req 11.1-11.4).
 */
export function useScanReceipt() {
  return useMutation<ReceiptPreview, Error, { receiptKey: string }>({
    mutationFn: ({ receiptKey }) => callAiGateway('scanReceipt', { receiptKey }),
  });
}

/**
 * Tanya kepada Asisten_Keuangan AI berbasis data keuangan Pengguna (Req 12.1-12.4).
 */
export function useAskAssistant() {
  return useMutation<AssistantAnswer, Error, { question: string }>({
    mutationFn: ({ question }) => callAiGateway('askAssistant', { question }),
  });
}
