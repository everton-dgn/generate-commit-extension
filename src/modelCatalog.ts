import { getJson } from './http';
import type { ProviderId } from './types';

/**
 * Catálogo de modelos: busca a lista de modelos em tempo real no endpoint de
 * modelos de cada provider (verificado em 2026-08-02), mantém em cache por uma
 * hora e degrada para sugestões estáticas (ou nenhuma) quando a busca falha.
 * O campo Model continua aceitando texto livre; o catálogo só alimenta as
 * sugestões do datalist.
 */

export const MODELS_TTL_MS = 60 * 60 * 1000;

/** Sugestões estáticas para providers de CLI (aliases verificados via --help). */
export const CLAUDE_CLI_MODELS: readonly string[] = ['fable', 'opus', 'sonnet', 'haiku'];

/** Resolve o endpoint de modelos de um provider, respeitando base URLs editadas. */
export function modelsEndpointFor(id: ProviderId, baseUrl: string): string | null {
  const base = baseUrl.replace(/\/+$/, '');
  switch (id) {
    case 'openrouter':
      return `${base}/models`;
    case 'kimi':
      // A base compatível com Anthropic é <host>/anthropic; os modelos ficam
      // na API compatível com OpenAI em <host>/v1/models.
      return base.endsWith('/anthropic')
        ? `${base.slice(0, -'/anthropic'.length)}/v1/models`
        : `${base}/v1/models`;
    case 'glm':
      // <host>/api/anthropic → <host>/api/paas/v4/models.
      return base.endsWith('/api/anthropic')
        ? `${base.slice(0, -'/api/anthropic'.length)}/api/paas/v4/models`
        : `${base}/v1/models`;
    case 'minimax':
    case 'anthropicCustom':
      // MiniMax mantém /anthropic de propósito: sua especificação oficial
      // documenta GET <base>/anthropic/v1/models (auth X-Api-Key), ao contrário
      // de Kimi/GLM, cujos catálogos ficam no caminho compatível com OpenAI.
      return `${base}/v1/models`;
    case 'claudeCli':
    case 'codexCli':
      return null;
  }
}

/**
 * Extrai ids de modelo dos formatos comuns de lista: `{data:[{id}]}`,
 * `{models:[{id|name}]}` ou um array simples. Remove duplicatas e mantém a
 * ordem do provider.
 */
export function parseModelListResponse(json: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown): void => {
    if (typeof value !== 'string') return;
    const id = value.trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  const list = Array.isArray(json)
    ? json
    : typeof json === 'object' && json !== null
      ? Array.isArray((json as { data?: unknown }).data)
        ? ((json as { data: unknown[] }).data as unknown[])
        : Array.isArray((json as { models?: unknown }).models)
          ? ((json as { models: unknown[] }).models as unknown[])
          : []
      : [];
  for (const item of list) {
    if (typeof item === 'string') push(item);
    else if (item !== null && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      push(record.id || record.name || record.model);
    }
  }
  return out;
}

/** Verificação de TTL do cache do catálogo. */
export function shouldRefetch(fetchedAt: number | undefined, now: number, ttlMs: number): boolean {
  return fetchedAt === undefined || now - fetchedAt >= ttlMs;
}

export interface ModelCatalogConfig {
  readonly baseUrl: string;
  readonly auth: 'x-api-key' | 'bearer';
}

/**
 * Header de auth conforme o contrato do endpoint de CATÁLOGO de cada provider,
 * que pode diferir do endpoint de mensagens: o MiniMax lista modelos atrás de
 * X-Api-Key mesmo seu endpoint de mensagens aceitando Bearer (verificado em
 * 2026-08-02).
 */
export function catalogAuthHeader(
  id: ProviderId,
  apiKey: string,
  cfg: ModelCatalogConfig,
): Record<string, string> {
  if (id === 'minimax') return { 'x-api-key': apiKey };
  if (cfg.auth === 'bearer') return { authorization: `Bearer ${apiKey}` };
  return { 'x-api-key': apiKey };
}

/** Assinatura do cache: refaz a busca quando o endpoint ou o estilo de auth muda. */
export function catalogSignature(id: ProviderId, cfg: ModelCatalogConfig): string {
  return `${modelsEndpointFor(id, cfg.baseUrl) ?? ''}|${cfg.auth}`;
}

export interface ModelCatalogDeps {
  readonly getApiKey: (id: ProviderId) => Promise<string | undefined>;
  readonly getConfig: (id: ProviderId) => ModelCatalogConfig;
  readonly now: () => number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

interface CacheEntry {
  readonly at: number;
  readonly models: readonly string[];
  readonly signature: string;
}

export class ModelCatalog {
  private readonly cache = new Map<ProviderId, CacheEntry>();

  constructor(private readonly deps: ModelCatalogDeps) {}

  /** Leitura síncrona: modelos em cache para o endpoint/auth ATUAL, aliases estáticos de CLI ou []. */
  modelsFor(id: ProviderId): readonly string[] {
    if (id === 'claudeCli') return CLAUDE_CLI_MODELS;
    const signature = catalogSignature(id, this.deps.getConfig(id));
    const entry = this.cache.get(id);
    return entry && entry.signature === signature ? entry.models : [];
  }

  /** Atualiza um provider quando o cache está velho (ou quando forçado, ou quando o endpoint/auth mudou); falhas mantêm o cache anterior. */
  async refresh(id: ProviderId, force = false): Promise<boolean> {
    if (id === 'claudeCli' || id === 'codexCli') return false;
    const cfg = this.deps.getConfig(id);
    const signature = catalogSignature(id, cfg);
    const existing = this.cache.get(id);
    const fresh =
      existing?.signature === signature &&
      !shouldRefetch(existing.at, this.deps.now(), MODELS_TTL_MS);
    if (!force && fresh) return false;
    const endpoint = modelsEndpointFor(id, cfg.baseUrl);
    if (!endpoint) return false;
    try {
      const headers: Record<string, string> = {};
      const key = await this.deps.getApiKey(id);
      if (key) Object.assign(headers, catalogAuthHeader(id, key, cfg));
      if (id === 'minimax' || id === 'anthropicCustom') {
        headers['anthropic-version'] = '2023-06-01';
      }
      const json = await getJson(endpoint, headers, {
        timeoutMs: this.deps.timeoutMs,
        signal: this.deps.signal,
      });
      const models = parseModelListResponse(json);
      if (models.length > 0) {
        this.cache.set(id, { at: this.deps.now(), models, signature });
        return true;
      }
      return false;
    } catch {
      // Offline, chave ausente ou endpoint desatualizado: mantém as sugestões anteriores.
      return false;
    }
  }

  /** Atualiza todos os providers HTTP; true quando algum catálogo mudou. */
  async refreshAll(ids: readonly ProviderId[]): Promise<boolean> {
    const results = await Promise.all(ids.map((id) => this.refresh(id)));
    return results.some(Boolean);
  }
}
