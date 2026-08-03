/**
 * Verificação ao vivo dos catálogos de modelos (2026-08-02).
 * Roda os parsers REAIS da extensão contra as respostas REAIS dos endpoints.
 * Uso: pnpm dlx tsx scripts/verify-catalogs.ts
 */
import { execFile } from 'node:child_process';
import { parseCodexModelCatalog } from '../src/cliCatalog';
import { catalogAuthHeader, modelsEndpointFor, parseModelListResponse } from '../src/modelCatalog';
import type { ProviderId } from '../src/types';

const TIMEOUT_MS = 15_000;

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const body = await res.text();
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function runCodexDebugModels(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'codex',
      ['debug', 'models'],
      { timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

interface HttpCase {
  readonly id: ProviderId;
  readonly baseUrl: string;
  readonly auth: 'x-api-key' | 'bearer';
  readonly apiKey?: string;
  readonly extraHeaders?: Record<string, string>;
}

const cases: HttpCase[] = [
  {
    id: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    auth: 'bearer',
  },
  {
    id: 'kimi',
    baseUrl: 'https://api.moonshot.ai/anthropic',
    auth: 'bearer',
    apiKey: process.env.KIMI_API_KEY,
  },
  {
    id: 'glm',
    baseUrl: 'https://api.z.ai/api/anthropic',
    auth: 'bearer',
    apiKey: process.env.ZAI_API_KEY,
  },
  {
    id: 'minimax',
    baseUrl: 'https://api.minimax.io/anthropic',
    auth: 'bearer',
    apiKey: process.env.MINIMAX_API_KEY ?? process.env.MINIMAX_CODE_API_KEY,
    extraHeaders: { 'anthropic-version': '2023-06-01' },
  },
];

let failures = 0;

for (const c of cases) {
  const endpoint = modelsEndpointFor(c.id, c.baseUrl);
  if (!endpoint) {
    console.log(`SKIP ${c.id}: sem endpoint`);
    continue;
  }
  const headers: Record<string, string> = { ...c.extraHeaders };
  if (c.apiKey)
    Object.assign(headers, catalogAuthHeader(c.id, c.apiKey, { baseUrl: c.baseUrl, auth: c.auth }));
  try {
    const raw = (await getJson(endpoint, headers)) as { status: number; body: string };
    if (raw.status !== 200) {
      console.log(`FAIL ${c.id}: HTTP ${raw.status} em ${endpoint} — ${raw.body.slice(0, 120)}`);
      failures += 1;
      continue;
    }
    const models = parseModelListResponse(JSON.parse(raw.body));
    if (models.length === 0) {
      console.log(`FAIL ${c.id}: 200 mas parser retornou 0 modelos`);
      failures += 1;
      continue;
    }
    console.log(`OK   ${c.id}: ${models.length} modelos — ${models.slice(0, 3).join(', ')}…`);
  } catch (err) {
    console.log(`FAIL ${c.id}: ${err instanceof Error ? err.message : String(err)}`);
    failures += 1;
  }
}

// Codex CLI: catálogo vivo via `codex debug models` + parser real.
try {
  const stdout = await runCodexDebugModels();
  const snap = parseCodexModelCatalog(JSON.parse(stdout));
  if (snap.models.length === 0) {
    console.log('FAIL codexCli: parser retornou 0 modelos');
    failures += 1;
  } else {
    console.log(
      `OK   codexCli: ${snap.models.length} modelos — ${snap.models.join(', ')} | defaultEfforts=${snap.defaultEfforts.join(',')}`,
    );
  }
} catch (err) {
  console.log(`FAIL codexCli: ${err instanceof Error ? err.message : String(err)}`);
  failures += 1;
}

console.log(failures === 0 ? '\nTodos os catálogos OK' : `\n${failures} falha(s)`);
process.exit(failures === 0 ? 0 : 1);
