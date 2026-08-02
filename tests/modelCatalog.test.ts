import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../src/types';

const getJsonMock = vi.fn();

vi.mock('../src/http', () => ({
  getJson: (...args: unknown[]) => getJsonMock(...args),
  postJson: vi.fn(),
  mapHttpError: (status: number) => new ProviderError('unknown', String(status)),
}));

import {
  CLAUDE_CLI_MODELS,
  MODELS_TTL_MS,
  ModelCatalog,
  modelsEndpointFor,
  parseModelListResponse,
  shouldRefetch,
} from '../src/modelCatalog';

describe('modelsEndpointFor', () => {
  it('appends /models for openrouter', () => {
    expect(modelsEndpointFor('openrouter', 'https://openrouter.ai/api/v1/')).toBe(
      'https://openrouter.ai/api/v1/models',
    );
  });

  it('derives the OpenAI-compatible path for kimi, honoring the CN host', () => {
    expect(modelsEndpointFor('kimi', 'https://api.moonshot.ai/anthropic')).toBe(
      'https://api.moonshot.ai/v1/models',
    );
    expect(modelsEndpointFor('kimi', 'https://api.moonshot.cn/anthropic')).toBe(
      'https://api.moonshot.cn/v1/models',
    );
  });

  it('derives the paas path for glm', () => {
    expect(modelsEndpointFor('glm', 'https://api.z.ai/api/anthropic')).toBe(
      'https://api.z.ai/api/paas/v4/models',
    );
  });

  it('appends /v1/models for minimax and the custom endpoint', () => {
    expect(modelsEndpointFor('minimax', 'https://api.minimax.io/anthropic')).toBe(
      'https://api.minimax.io/anthropic/v1/models',
    );
    expect(modelsEndpointFor('anthropicCustom', 'https://api.anthropic.com')).toBe(
      'https://api.anthropic.com/v1/models',
    );
  });

  it('falls back to <base>/v1/models for edited bases', () => {
    expect(modelsEndpointFor('kimi', 'https://proxy.example.com')).toBe(
      'https://proxy.example.com/v1/models',
    );
  });

  it('returns null for CLI providers', () => {
    expect(modelsEndpointFor('claudeCli', '')).toBeNull();
    expect(modelsEndpointFor('codexCli', '')).toBeNull();
  });
});

describe('parseModelListResponse', () => {
  it('parses the {data:[{id}]} shape (OpenRouter/OpenAI-compatible)', () => {
    const json = { data: [{ id: 'a/1' }, { id: 'b/2' }, { nope: true }] };
    expect(parseModelListResponse(json)).toEqual(['a/1', 'b/2']);
  });

  it('parses the {models:[{name}]} and bare-array shapes', () => {
    expect(parseModelListResponse({ models: [{ name: 'x' }, { id: 'y' }] })).toEqual(['x', 'y']);
    expect(parseModelListResponse(['m1', 'm2'])).toEqual(['m1', 'm2']);
  });

  it('dedupes and ignores garbage', () => {
    expect(parseModelListResponse({ data: [{ id: 'a' }, { id: 'a' }, { id: ' ' }] })).toEqual([
      'a',
    ]);
    expect(parseModelListResponse(null)).toEqual([]);
    expect(parseModelListResponse({})).toEqual([]);
    expect(parseModelListResponse('nope')).toEqual([]);
  });
});

describe('shouldRefetch', () => {
  it('refetches when never fetched or past TTL', () => {
    expect(shouldRefetch(undefined, 1000, MODELS_TTL_MS)).toBe(true);
    expect(shouldRefetch(0, MODELS_TTL_MS + 1, MODELS_TTL_MS)).toBe(true);
    expect(shouldRefetch(0, MODELS_TTL_MS - 1, MODELS_TTL_MS)).toBe(false);
  });
});

describe('ModelCatalog', () => {
  const baseDeps = {
    getApiKey: async () => 'KEY',
    getConfig: () => ({ baseUrl: 'https://api.minimax.io/anthropic', auth: 'bearer' as const }),
    now: () => 1000,
    timeoutMs: 5000,
  };

  beforeEach(() => {
    getJsonMock.mockReset();
  });

  it('serves static aliases for claudeCli and nothing for codexCli', async () => {
    const catalog = new ModelCatalog(baseDeps);
    expect(catalog.modelsFor('claudeCli')).toEqual(CLAUDE_CLI_MODELS);
    expect(catalog.modelsFor('codexCli')).toEqual([]);
  });

  it('fetches, caches and serves models with the right auth headers', async () => {
    getJsonMock.mockResolvedValue({ data: [{ id: 'MiniMax-M3' }, { id: 'MiniMax-M2.5' }] });
    const catalog = new ModelCatalog(baseDeps);
    await expect(catalog.refresh('minimax')).resolves.toBe(true);
    expect(catalog.modelsFor('minimax')).toEqual(['MiniMax-M3', 'MiniMax-M2.5']);
    const [url, headers] = getJsonMock.mock.calls[0] as [string, Record<string, string>];
    expect(url).toBe('https://api.minimax.io/anthropic/v1/models');
    expect(headers.authorization).toBe('Bearer KEY');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('skips the network while the cache is fresh', async () => {
    getJsonMock.mockResolvedValue({ data: [{ id: 'm1' }] });
    const catalog = new ModelCatalog(baseDeps);
    await catalog.refresh('minimax');
    await expect(catalog.refresh('minimax')).resolves.toBe(false);
    expect(getJsonMock).toHaveBeenCalledTimes(1);
  });

  it('keeps previous suggestions when the refresh after TTL fails', async () => {
    let clock = 1000;
    getJsonMock.mockResolvedValueOnce({ data: [{ id: 'm1' }] });
    const catalog = new ModelCatalog({ ...baseDeps, now: () => clock });
    await catalog.refresh('minimax');
    expect(catalog.modelsFor('minimax')).toEqual(['m1']);
    clock += MODELS_TTL_MS + 1;
    getJsonMock.mockRejectedValue(new Error('down'));
    await expect(catalog.refresh('minimax')).resolves.toBe(false);
    expect(catalog.modelsFor('minimax')).toEqual(['m1']);
  });

  it('never throws on network errors and serves []', async () => {
    getJsonMock.mockRejectedValue(new Error('offline'));
    const catalog = new ModelCatalog(baseDeps);
    await expect(catalog.refresh('minimax')).resolves.toBe(false);
    expect(catalog.modelsFor('minimax')).toEqual([]);
  });
});
