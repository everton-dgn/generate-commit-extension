import type { ProviderId } from '../types';

export interface ProviderMeta {
  readonly id: ProviderId;
  readonly label: string;
  readonly kind: 'http' | 'cli';
  readonly needsApiKey: boolean;
  readonly defaultModel: string;
  /** Where the user creates an API key (verified on 2026-08-02). */
  readonly keyConsoleUrl?: string;
}

/** Display/fallback order: zero-config CLIs first, then the HTTP providers. */
export const PROVIDERS: readonly ProviderMeta[] = [
  { id: 'claudeCli', label: 'Claude Code CLI', kind: 'cli', needsApiKey: false, defaultModel: '' },
  { id: 'codexCli', label: 'Codex CLI', kind: 'cli', needsApiKey: false, defaultModel: '' },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'http',
    needsApiKey: true,
    defaultModel: 'google/gemini-2.5-flash-lite',
    keyConsoleUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'kimi',
    label: 'Kimi (Moonshot AI)',
    kind: 'http',
    needsApiKey: true,
    defaultModel: 'kimi-k2.6',
    keyConsoleUrl: 'https://platform.kimi.ai/console/api-keys',
  },
  {
    id: 'glm',
    label: 'GLM (z.ai)',
    kind: 'http',
    needsApiKey: true,
    defaultModel: 'glm-4.5-air',
    keyConsoleUrl: 'https://z.ai/manage-apikey/apikey-list',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    kind: 'http',
    needsApiKey: true,
    defaultModel: 'MiniMax-M2.5-highspeed',
    keyConsoleUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
  },
  {
    id: 'anthropicCustom',
    label: 'Anthropic-compatible (custom)',
    kind: 'http',
    needsApiKey: true,
    defaultModel: 'claude-haiku-4-5-20251001',
    keyConsoleUrl: 'https://console.anthropic.com/settings/keys',
  },
];

export type Availability = Readonly<Partial<Record<ProviderId, boolean>>>;

const PROVIDER_IDS = new Set<ProviderId>(PROVIDERS.map((p) => p.id));

export function isProviderId(value: string): value is ProviderId {
  return PROVIDER_IDS.has(value as ProviderId);
}

/**
 * Picks the provider to use: the configured one when available, otherwise
 * the first available provider in display order; null when none is available.
 */
export function resolveProviderChoice(
  configured: string,
  availability: Availability,
): ProviderId | null {
  if (isProviderId(configured) && availability[configured]) return configured;
  for (const provider of PROVIDERS) {
    if (availability[provider.id]) return provider.id;
  }
  return null;
}

export function providerMeta(id: ProviderId): ProviderMeta {
  const meta = PROVIDERS.find((p) => p.id === id);
  if (!meta) throw new Error(`Unknown provider id: ${id}`);
  return meta;
}
