/**
 * Skrip verifikasi ketersediaan dan akses Amazon Bedrock Nova Lite
 * (Requirement 16.1, 16.5; design.md bagian "Verifikasi Nova Lite" dan
 * "Skrip `scripts/verify-bedrock.ts`").
 *
 * Skrip ini TIDAK memanggil `shared/domain` yang murni; ia memanggil AWS
 * sungguhan dengan kredensial lokal (profil AWS CLI / variabel lingkungan
 * standar SDK). Jangan pernah menanamkan kredensial di berkas ini.
 *
 * Langkah:
 *   1. `GetFoundationModelAvailability` untuk `amazon.nova-lite-v1:0` di
 *      `BEDROCK_REGION` (status otorisasi, entitlement, region).
 *   2. `ListInferenceProfiles` di `BEDROCK_REGION`, cari
 *      `apac.amazon.nova-lite-v1:0`.
 *   3. Panggilan Converse nyata (prompt tetap, non-sensitif) untuk setiap
 *      kandidat pada rantai model (C1, C2, C3 secara bawaan; dapat ditimpa
 *      lewat `AI_MODEL_CANDIDATES`, lihat `shared/config.ts`).
 *   4. Cetak tabel hasil. Kode keluar 0 hanya bila minimal satu kandidat
 *      berhasil dipanggil lewat Converse.
 *
 * Penggunaan:
 *   npm run verify:bedrock
 */
import {
  BedrockClient,
  GetFoundationModelAvailabilityCommand,
  ListInferenceProfilesCommand,
} from '@aws-sdk/client-bedrock';
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';

import { loadConfig, type ModelCandidate } from '../shared/config';

const NOVA_LITE_MODEL_ID = 'amazon.nova-lite-v1:0';
const NOVA_LITE_INFERENCE_PROFILE_ID = 'apac.amazon.nova-lite-v1:0';

/** Prompt tetap, non-sensitif (tidak pernah memuat data Pengguna). */
const VERIFY_PROMPT = 'Balas hanya dengan kata "ok" tanpa penjelasan tambahan.';

interface FoundationModelCheck {
  checked: boolean;
  authorizationStatus?: string;
  entitlementAvailability?: string;
  regionAvailability?: string;
  agreementStatus?: string;
  error?: string;
}

interface InferenceProfileCheck {
  checked: boolean;
  found: boolean;
  status?: string;
  inferenceProfileArn?: string;
  error?: string;
}

interface CandidateResult {
  label: string;
  candidate: ModelCandidate;
  callable: boolean;
  errorName?: string;
  errorMessage?: string;
}

async function checkFoundationModelAvailability(region: string): Promise<FoundationModelCheck> {
  const client = new BedrockClient({ region });
  try {
    const res = await client.send(
      new GetFoundationModelAvailabilityCommand({ modelId: NOVA_LITE_MODEL_ID }),
    );
    return {
      checked: true,
      authorizationStatus: res.authorizationStatus,
      entitlementAvailability: res.entitlementAvailability,
      regionAvailability: res.regionAvailability,
      agreementStatus: res.agreementAvailability?.status,
    };
  } catch (err) {
    return { checked: true, error: describeError(err) };
  }
}

async function checkInferenceProfile(region: string): Promise<InferenceProfileCheck> {
  const client = new BedrockClient({ region });
  try {
    let nextToken: string | undefined;
    do {
      const res = await client.send(
        new ListInferenceProfilesCommand({ maxResults: 100, nextToken }),
      );
      const found = res.inferenceProfileSummaries?.find(
        (p) => p.inferenceProfileId === NOVA_LITE_INFERENCE_PROFILE_ID,
      );
      if (found) {
        return {
          checked: true,
          found: true,
          status: found.status,
          inferenceProfileArn: found.inferenceProfileArn,
        };
      }
      nextToken = res.nextToken;
    } while (nextToken);
    return { checked: true, found: false };
  } catch (err) {
    return { checked: true, found: false, error: describeError(err) };
  }
}

async function callConverse(candidate: ModelCandidate): Promise<CandidateResult> {
  const label = `${candidate.modelId}@${candidate.region}`;
  const client = new BedrockRuntimeClient({ region: candidate.region });
  try {
    await client.send(
      new ConverseCommand({
        modelId: candidate.modelId,
        messages: [{ role: 'user', content: [{ text: VERIFY_PROMPT }] }],
        inferenceConfig: { maxTokens: 16 },
      }),
    );
    return { label, candidate, callable: true };
  } catch (err) {
    const { name, message } = splitError(err);
    return { label, candidate, callable: false, errorName: name, errorMessage: message };
  }
}

function describeError(err: unknown): string {
  const { name, message } = splitError(err);
  return `${name}: ${message}`;
}

function splitError(err: unknown): { name: string; message: string } {
  if (err instanceof Error) {
    return { name: err.name || 'Error', message: err.message || '' };
  }
  return { name: 'UnknownError', message: String(err) };
}

function printFoundationModelTable(check: FoundationModelCheck): void {
  console.log('\n== GetFoundationModelAvailability (amazon.nova-lite-v1:0) ==');
  if (check.error) {
    console.log(`Galat: ${check.error}`);
    return;
  }
  console.log(`Status otorisasi:        ${check.authorizationStatus ?? '-'}`);
  console.log(`Entitlement tersedia:    ${check.entitlementAvailability ?? '-'}`);
  console.log(`Region tersedia:         ${check.regionAvailability ?? '-'}`);
  console.log(`Status perjanjian:       ${check.agreementStatus ?? '-'}`);
}

function printInferenceProfileTable(check: InferenceProfileCheck): void {
  console.log('\n== ListInferenceProfiles (apac.amazon.nova-lite-v1:0) ==');
  if (check.error) {
    console.log(`Galat: ${check.error}`);
    return;
  }
  console.log(`Ditemukan: ${check.found ? 'ya' : 'tidak'}`);
  if (check.found) {
    console.log(`Status:    ${check.status ?? '-'}`);
    console.log(`ARN:       ${check.inferenceProfileArn ?? '-'}`);
  }
}

function printCandidateTable(results: CandidateResult[]): void {
  console.log('\n== Panggilan Converse per kandidat ==');
  const header = ['Kandidat', 'Model ID', 'Region', 'Dapat dipanggil', 'Galat'];
  const rows = results.map((r, i) => [
    `C${i + 1}`,
    r.candidate.modelId,
    r.candidate.region,
    r.callable ? 'ya' : 'tidak',
    r.callable ? '-' : `${r.errorName ?? ''}: ${r.errorMessage ?? ''}`.trim(),
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i]?.length ?? 0)),
  );
  const formatRow = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i] ?? c.length)).join(' | ');
  console.log(formatRow(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('-|-'));
  for (const row of rows) {
    console.log(formatRow(row));
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const region = config.bedrockRegion;
  const candidates = config.modelCandidates;

  console.log('Verifikasi ketersediaan dan akses Bedrock Nova Lite (Requirement 16.1, 16.5)');
  console.log(`BEDROCK_REGION: ${region}`);
  console.log(`Kandidat: ${candidates.map((c) => `${c.modelId}@${c.region}`).join(', ')}`);

  const foundationModelCheck = await checkFoundationModelAvailability(region);
  printFoundationModelTable(foundationModelCheck);

  const inferenceProfileCheck = await checkInferenceProfile(region);
  printInferenceProfileTable(inferenceProfileCheck);

  const candidateResults: CandidateResult[] = [];
  for (const candidate of candidates) {
    // Dijalankan berurutan agar log mudah dibaca dan tidak membebani limit API.
    // eslint-disable-next-line no-await-in-loop
    candidateResults.push(await callConverse(candidate));
  }
  printCandidateTable(candidateResults);

  const anyCallable = candidateResults.some((r) => r.callable);
  console.log(
    `\nHasil akhir: ${anyCallable ? 'MINIMAL SATU KANDIDAT DAPAT DIPANGGIL' : 'TIDAK ADA KANDIDAT YANG DAPAT DIPANGGIL'}`,
  );
  console.log(
    'Catatan: isi tabel "Hasil verifikasi akun" pada design.md secara manual dari keluaran ini. Jangan diisi dari dugaan.',
  );

  process.exit(anyCallable ? 0 : 1);
}

main().catch((err) => {
  console.error('Galat tak terduga saat menjalankan verifikasi Bedrock:', err);
  process.exit(1);
});
