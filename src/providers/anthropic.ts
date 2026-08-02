import { postJson } from '../http';
import { type GenerateRequest, type Provider, ProviderError, type ProviderId } from '../types';

export type AnthropicAuthStyle = 'x-api-key' | 'bearer';

export interface AnthropicCompatibleConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly auth: AnthropicAuthStyle;
}

export interface BuiltAnthropicRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: {
    readonly model: string;
    readonly max_tokens: number;
    readonly system: string;
    readonly messages: readonly { role: 'user'; content: string }[];
    readonly temperature: number;
  };
}

/**
 * Builds an Anthropic Messages API request. Verified against the official
 * docs (platform.claude.com/docs/en/api/messages) at 2026-08-02; the same
 * shape is used by the Kimi, GLM and MiniMax Anthropic-compatible endpoints.
 */
export function buildAnthropicRequest(
  cfg: AnthropicCompatibleConfig,
  apiKey: string,
  req: GenerateRequest,
): BuiltAnthropicRequest {
  const headers: Record<string, string> = { 'anthropic-version': '2023-06-01' };
  if (cfg.auth === 'bearer') headers.authorization = `Bearer ${apiKey}`;
  else headers['x-api-key'] = apiKey;
  return {
    url: `${cfg.baseUrl.replace(/\/+$/, '')}/v1/messages`,
    headers,
    body: {
      model: cfg.model,
      max_tokens: req.maxTokens ?? 512,
      system: req.systemPrompt,
      messages: [{ role: 'user', content: req.userPrompt }],
      temperature: 0.3,
    },
  };
}

/** Extracts and joins the text blocks of an Anthropic Messages API response. */
export function parseAnthropicResponse(json: unknown): string {
  if (typeof json !== 'object' || json === null) {
    throw new ProviderError('invalidResponse', 'Provider returned a non-JSON response');
  }
  const content = (json as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new ProviderError('invalidResponse', 'Provider response has no content blocks');
  }
  const text = content
    .filter((block) => (block as { type?: unknown }).type === 'text')
    .map((block) => String((block as { text?: unknown }).text ?? ''))
    .join('');
  if (!text.trim()) {
    throw new ProviderError('invalidResponse', 'Provider response has no text blocks');
  }
  return text;
}

export interface AnthropicProviderDeps {
  readonly getApiKey: () => Promise<string | undefined>;
  readonly getConfig: () => AnthropicCompatibleConfig;
}

/** Generic Anthropic Messages API client; presets (Kimi/GLM/MiniMax) differ only in config. */
export function createAnthropicCompatibleProvider(
  id: ProviderId,
  label: string,
  deps: AnthropicProviderDeps,
): Provider {
  return {
    id,
    label,
    kind: 'http',
    isAvailable: async () => Boolean(await deps.getApiKey()),
    generate: async (req: GenerateRequest) => {
      const apiKey = await deps.getApiKey();
      if (!apiKey) {
        throw new ProviderError(
          'auth',
          `No API key configured for ${label}`,
          'Run "Generate Commit: Configure API Key"',
        );
      }
      const { url, headers, body } = buildAnthropicRequest(deps.getConfig(), apiKey, req);
      const json = await postJson(url, headers, body, {
        timeoutMs: req.timeoutMs,
        signal: req.signal,
      });
      return parseAnthropicResponse(json);
    },
  };
}
