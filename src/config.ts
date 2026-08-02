import * as vscode from 'vscode';
import type { AnthropicAuthStyle } from './providers/anthropic';
import { isProviderId } from './providers/registry';
import type { ProviderId } from './types';

export type UnstagedFallback = 'ask' | 'always' | 'never';

export interface AppConfig {
  readonly provider: ProviderId;
  readonly language: string;
  readonly maxDiffChars: number;
  readonly maxFileSizeKB: number;
  readonly includeRecentCommits: boolean;
  readonly customPrompt: string;
  readonly unstagedFallback: UnstagedFallback;
  readonly timeoutSeconds: number;
}

const SECTION = 'generateCommit';

function clampNumber(value: unknown, fallback: number, min: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min ? value : fallback;
}

export function readAppConfig(): AppConfig {
  const c = vscode.workspace.getConfiguration(SECTION);
  const provider = c.get<string>('provider', 'claudeCli');
  const unstaged = c.get<string>('unstagedFallback', 'ask');
  return {
    provider: isProviderId(provider) ? provider : 'claudeCli',
    language: c.get<string>('language', 'en'),
    maxDiffChars: clampNumber(c.get('maxDiffChars'), 50_000, 1000),
    maxFileSizeKB: clampNumber(c.get('maxFileSizeKB'), 50, 1),
    includeRecentCommits: c.get<boolean>('includeRecentCommits', true),
    customPrompt: c.get<string>('customPrompt', ''),
    unstagedFallback: unstaged === 'always' || unstaged === 'never' ? unstaged : 'ask',
    timeoutSeconds: clampNumber(c.get('timeoutSeconds'), 60, 5),
  };
}

export interface ProviderRuntimeConfig {
  readonly model: string;
  readonly baseUrl: string;
  readonly auth: AnthropicAuthStyle;
  readonly effort: string;
}

/** Mirrors the defaults declared in package.json. */
const DEFAULTS: Readonly<Record<ProviderId, ProviderRuntimeConfig>> = {
  openrouter: {
    model: 'google/gemini-2.5-flash-lite',
    baseUrl: 'https://openrouter.ai/api/v1',
    auth: 'bearer',
    effort: '',
  },
  kimi: {
    model: 'kimi-k2.6',
    baseUrl: 'https://api.moonshot.ai/anthropic',
    auth: 'bearer',
    effort: '',
  },
  glm: {
    model: 'glm-4.5-air',
    baseUrl: 'https://api.z.ai/api/anthropic',
    auth: 'bearer',
    effort: '',
  },
  minimax: {
    model: 'MiniMax-M2.5-highspeed',
    baseUrl: 'https://api.minimax.io/anthropic',
    auth: 'bearer',
    effort: '',
  },
  anthropicCustom: {
    model: 'claude-haiku-4-5-20251001',
    baseUrl: 'https://api.anthropic.com',
    auth: 'x-api-key',
    effort: '',
  },
  claudeCli: { model: '', baseUrl: '', auth: 'bearer', effort: 'low' },
  codexCli: { model: '', baseUrl: '', auth: 'bearer', effort: 'low' },
};

function httpsOnly(url: string, fallback: string, onInvalid: (message: string) => void): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (trimmed.startsWith('https://')) return trimmed;
  if (trimmed) onInvalid(`Ignoring non-HTTPS base URL "${url}" (HTTPS is required).`);
  return fallback;
}

export function readProviderConfig(
  id: ProviderId,
  onInvalid: (message: string) => void = () => {},
): ProviderRuntimeConfig {
  const c = vscode.workspace.getConfiguration(SECTION);
  const defaults = DEFAULTS[id];
  const model = c.get<string>(`${id}.model`, defaults.model).trim() || defaults.model;
  const effort = c.get<string>(`${id}.effort`, defaults.effort);
  const baseUrl = defaults.baseUrl
    ? httpsOnly(c.get<string>(`${id}.baseUrl`, defaults.baseUrl), defaults.baseUrl, onInvalid)
    : '';
  const authRaw =
    id === 'anthropicCustom' ? c.get<string>(`${id}.authHeader`, defaults.auth) : defaults.auth;
  const auth: AnthropicAuthStyle = authRaw === 'bearer' ? 'bearer' : 'x-api-key';
  return { model, baseUrl, auth, effort };
}

const SECRET_PREFIX = 'generateCommit.apiKey.';

export function secretKeyFor(id: ProviderId): string {
  return `${SECRET_PREFIX}${id}`;
}
