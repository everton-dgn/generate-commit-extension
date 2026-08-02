import * as vscode from 'vscode';
import { readProviderConfig, secretKeyFor } from './config';
import { logMeta } from './log';
import { createAnthropicCompatibleProvider } from './providers/anthropic';
import { createClaudeCliProvider } from './providers/claudeCli';
import { createCodexCliProvider } from './providers/codexCli';
import { createOpenRouterProvider } from './providers/openrouter';
import { PROVIDERS, providerMeta } from './providers/registry';
import { type GenerateRequest, type Provider, ProviderError, type ProviderId } from './types';

function onInvalidConfig(message: string): void {
  logMeta('config.invalid', { detail: message });
  void vscode.window.showWarningMessage(`Generate Commit: ${message}`);
}

/** Instantiates every provider with its live config/secrets accessors. */
export function createProviders(context: vscode.ExtensionContext): Map<ProviderId, Provider> {
  const secrets = context.secrets;
  const getApiKey = (id: ProviderId) => async () => secrets.get(secretKeyFor(id));
  const cliLog = (line: string) => logMeta('cli', { detail: line });
  const anthropic = (id: ProviderId) =>
    createAnthropicCompatibleProvider(id, providerMeta(id).label, {
      getApiKey: getApiKey(id),
      getConfig: () => {
        const cfg = readProviderConfig(id, onInvalidConfig);
        return { baseUrl: cfg.baseUrl, model: cfg.model, auth: cfg.auth };
      },
    });
  return new Map<ProviderId, Provider>([
    [
      'openrouter',
      createOpenRouterProvider({
        getApiKey: getApiKey('openrouter'),
        getConfig: () => {
          const cfg = readProviderConfig('openrouter', onInvalidConfig);
          return { model: cfg.model, baseUrl: cfg.baseUrl };
        },
      }),
    ],
    ['kimi', anthropic('kimi')],
    ['glm', anthropic('glm')],
    ['minimax', anthropic('minimax')],
    ['anthropicCustom', anthropic('anthropicCustom')],
    [
      'claudeCli',
      createClaudeCliProvider({
        getConfig: () => {
          const cfg = readProviderConfig('claudeCli');
          return { model: cfg.model, effort: cfg.effort };
        },
        log: cliLog,
      }),
    ],
    [
      'codexCli',
      createCodexCliProvider({
        getConfig: () => {
          const cfg = readProviderConfig('codexCli');
          return { model: cfg.model, effort: cfg.effort };
        },
        log: cliLog,
      }),
    ],
  ]);
}

export async function collectAvailability(
  providers: ReadonlyMap<ProviderId, Provider>,
): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    [...providers].map(async ([id, provider]) => [id, await provider.isAvailable()] as const),
  );
  return Object.fromEntries(entries);
}

export interface KeyStatus {
  readonly id: ProviderId;
  readonly hasKey: boolean;
}

/** Which key-backed providers have a key stored (never exposes values). */
export async function collectKeyStatus(context: vscode.ExtensionContext): Promise<KeyStatus[]> {
  const result: KeyStatus[] = [];
  for (const meta of PROVIDERS) {
    if (!meta.needsApiKey) continue;
    const key = await context.secrets.get(secretKeyFor(meta.id));
    result.push({ id: meta.id, hasKey: Boolean(key) });
  }
  return result;
}

export interface KeyValidation {
  readonly ok: boolean;
  readonly reason: string;
}

/**
 * Validates a candidate API key with a minimal request. Only authentication
 * failures reject the key: any response from the endpoint (billing, rate
 * limit, server error, even a rejected payload) proves the key was accepted,
 * while connectivity errors prove nothing.
 */
export async function validateApiKey(id: ProviderId, apiKey: string): Promise<KeyValidation> {
  try {
    const cfg = readProviderConfig(id, onInvalidConfig);
    const req: GenerateRequest = {
      systemPrompt: '',
      userPrompt: 'ping',
      model: cfg.model,
      effort: '',
      maxTokens: 8,
      timeoutMs: 15_000,
      signal: new AbortController().signal,
    };
    if (id === 'openrouter') {
      await createOpenRouterProvider({
        getApiKey: async () => apiKey,
        getConfig: () => ({ model: cfg.model, baseUrl: cfg.baseUrl }),
      }).generate(req);
    } else {
      await createAnthropicCompatibleProvider(id, providerMeta(id).label, {
        getApiKey: async () => apiKey,
        getConfig: () => ({ baseUrl: cfg.baseUrl, model: cfg.model, auth: cfg.auth }),
      }).generate(req);
    }
    return { ok: true, reason: '' };
  } catch (err) {
    if (err instanceof ProviderError) {
      if (err.kind === 'auth') return { ok: false, reason: 'authentication failed' };
      const responded =
        err.kind === 'billing' ||
        err.kind === 'rateLimit' ||
        err.kind === 'server' ||
        err.kind === 'invalidResponse';
      return responded ? { ok: true, reason: '' } : { ok: false, reason: err.message };
    }
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
