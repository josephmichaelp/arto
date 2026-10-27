/**
 * Konfigurasi lingkungan bersama. Region Bedrock tidak tertanam di logika AI,
 * selalu dibaca dari variabel lingkungan (Requirement 16.1).
 */

export interface ModelCandidate {
  modelId: string;
  region: string;
}

export interface AppConfig {
  bedrockRegion: string;
  modelCandidates: ModelCandidate[];
  allowCrossRegion: boolean;
  aiRateLimit: number;
}

export const DEFAULT_BEDROCK_REGION = 'ap-southeast-3';
export const HOSTING_REGION = 'ap-southeast-1';
export const DEFAULT_AI_RATE_LIMIT = 30;

type Env = Record<string, string | undefined>;

/** Parse `modelId@region,modelId@region`. Entri tanpa region memakai region default. */
export function parseModelCandidates(raw: string | undefined, defaultRegion: string): ModelCandidate[] {
  if (!raw || !raw.trim()) return defaultCandidates(defaultRegion);
  const parsed = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const at = entry.lastIndexOf('@');
      if (at === -1) return { modelId: entry, region: defaultRegion };
      return { modelId: entry.slice(0, at).trim(), region: entry.slice(at + 1).trim() || defaultRegion };
    })
    .filter((c) => c.modelId.length > 0);
  return parsed.length > 0 ? parsed : defaultCandidates(defaultRegion);
}

export function defaultCandidates(bedrockRegion: string): ModelCandidate[] {
  return [
    { modelId: 'amazon.nova-lite-v1:0', region: bedrockRegion },
    { modelId: 'apac.amazon.nova-lite-v1:0', region: bedrockRegion },
    { modelId: 'apac.amazon.nova-lite-v1:0', region: HOSTING_REGION },
  ];
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'no') return false;
  if (v === 'true' || v === '1' || v === 'yes') return true;
  return fallback;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: Env = process.env): AppConfig {
  const bedrockRegion = env.BEDROCK_REGION?.trim() || DEFAULT_BEDROCK_REGION;
  return {
    bedrockRegion,
    modelCandidates: parseModelCandidates(env.AI_MODEL_CANDIDATES, bedrockRegion),
    allowCrossRegion: parseBool(env.AI_ALLOW_CROSS_REGION, true),
    aiRateLimit: parsePositiveInt(env.AI_RATE_LIMIT, DEFAULT_AI_RATE_LIMIT),
  };
}
