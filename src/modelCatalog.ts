import { getJson } from './http';
import type { ProviderId } from './types';

/**
 * Model catalog: fetches the live model list from each provider's models
 * endpoint (verified 2026-08-02), caches it for an hour and degrades to
 * static suggestions (or none) when the fetch fails. The Model field keeps
 * accepting free text; the catalog only feeds the datalist suggestions.
 */

export const MODELS_TTL_MS = 60 * 60 * 1000;

/** Static suggestions for CLI providers (aliases verified via --help). */
export const CLAUDE_CLI_MODELS: readonly string[] = ['fable', 'opus', 'sonnet', 'haiku'];

/** Resolves the models endpoint for a provider, honoring edited base URLs. */
export function modelsEndpointFor(id: ProviderId, baseUrl: string): string | null {
  const base = baseUrl.replace(/\/+$/, '');
  switch (id) {
    case 'openrouter':
      return `${base}/models`;
    case 'kimi':
      // The Anthropic-compatible base is <host>/anthropic; models live on
      // the OpenAI-compatible API at <host>/v1/models.
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
      return `${base}/v1/models`;
    case 'claudeCli':
    case 'codexCli':
      return null;
  }
}

/**
 * Extracts model ids from the common list shapes: `{data:[{id}]}`,
 * `{models:[{id|name}]}`, or a bare array. Dedupes, keeps provider order.
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
      push(record.id ?? record.name ?? record.model);
    }
  }
  return out;
}

/** TTL check for the catalog cache. */
export function shouldRefetch(fetchedAt: number | undefined, now: number, ttlMs: number): boolean {
  return fetchedAt === undefined || now - fetchedAt >= ttlMs;
}

export interface ModelCatalogConfig {
  readonly baseUrl: string;
  readonly auth: 'x-api-key' | 'bearer';
}

export interface ModelCatalogDeps {
  readonly getApiKey: (id: ProviderId) => Promise<string | undefined>;
  readonly getConfig: (id: ProviderId) => ModelCatalogConfig;
  readonly now: () => number;
  readonly timeoutMs: number;
}

interface CacheEntry {
  readonly at: number;
  readonly models: readonly string[];
}

export class ModelCatalog {
  private readonly cache = new Map<ProviderId, CacheEntry>();

  constructor(private readonly deps: ModelCatalogDeps) {}

  /** Synchronous read: cached models, static CLI aliases, or []. */
  modelsFor(id: ProviderId): readonly string[] {
    if (id === 'claudeCli') return CLAUDE_CLI_MODELS;
    return this.cache.get(id)?.models ?? [];
  }

  /** Refreshes one provider when stale; failures keep the previous cache. */
  async refresh(id: ProviderId): Promise<boolean> {
    if (id === 'claudeCli' || id === 'codexCli') return false;
    const existing = this.cache.get(id);
    if (!shouldRefetch(existing?.at, this.deps.now(), MODELS_TTL_MS)) return false;
    const cfg = this.deps.getConfig(id);
    const endpoint = modelsEndpointFor(id, cfg.baseUrl);
    if (!endpoint) return false;
    try {
      const headers: Record<string, string> = {};
      const key = await this.deps.getApiKey(id);
      if (key) {
        if (cfg.auth === 'bearer') headers.authorization = `Bearer ${key}`;
        else headers['x-api-key'] = key;
      }
      if (id === 'minimax' || id === 'anthropicCustom') {
        headers['anthropic-version'] = '2023-06-01';
      }
      const json = await getJson(endpoint, headers, {
        timeoutMs: this.deps.timeoutMs,
        signal: new AbortController().signal,
      });
      const models = parseModelListResponse(json);
      if (models.length > 0) {
        this.cache.set(id, { at: this.deps.now(), models });
        return true;
      }
      return false;
    } catch {
      // Offline, missing key or endpoint drift: keep previous suggestions.
      return false;
    }
  }

  /** Refreshes every HTTP provider; true when any catalog changed. */
  async refreshAll(ids: readonly ProviderId[]): Promise<boolean> {
    const results = await Promise.all(ids.map((id) => this.refresh(id)));
    return results.some(Boolean);
  }
}
