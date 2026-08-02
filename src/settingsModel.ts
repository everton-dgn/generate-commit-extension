import type { ProviderId } from './types';

/** Interpreta uma configuração de inteiro positivo; undefined quando inválida ou abaixo do mínimo. */
export function parseIntSetting(input: string, min: number): number | undefined {
  const value = Number(input.trim());
  if (!Number.isInteger(value) || value < min) return undefined;
  return value;
}

/** Vazio restaura o padrão do provider; caso contrário, exige uma URL HTTPS válida. */
export function isValidBaseUrl(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed === '') return true;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export interface LanguageOption {
  readonly code: string;
  readonly label: string;
}

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { code: 'en', label: 'English' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'ja', label: '日本語' },
  { code: 'zh-CN', label: '中文 (简体)' },
  { code: 'ko', label: '한국어' },
  { code: 'ru', label: 'Русский' },
];

export interface AdvancedItem {
  readonly key: 'model' | 'baseUrl' | 'authHeader' | 'effort';
  readonly label: string;
  readonly kind: 'text' | 'enum';
  readonly options?: readonly string[];
}

const TEXT_MODEL: AdvancedItem = { key: 'model', label: 'Model', kind: 'text' };
const TEXT_BASE_URL: AdvancedItem = {
  key: 'baseUrl',
  label: 'Base URL (HTTPS only)',
  kind: 'text',
};

/** Chaves avançadas editáveis por provider. */
export function advancedItemsFor(id: ProviderId): AdvancedItem[] {
  switch (id) {
    case 'openrouter':
    case 'kimi':
    case 'glm':
    case 'minimax':
      return [TEXT_MODEL, TEXT_BASE_URL];
    case 'anthropicCustom':
      return [
        TEXT_MODEL,
        TEXT_BASE_URL,
        {
          key: 'authHeader',
          label: 'Auth header style',
          kind: 'enum',
          options: ['x-api-key', 'bearer'],
        },
      ];
    case 'claudeCli':
      return [
        TEXT_MODEL,
        {
          key: 'effort',
          label: 'Effort',
          kind: 'enum',
          options: ['', 'low', 'medium', 'high', 'xhigh', 'max'],
        },
      ];
    case 'codexCli':
      return [TEXT_MODEL, { key: 'effort', label: 'Effort (model-dependent)', kind: 'text' }];
  }
}

// ---------- validação de mensagens do painel de configurações ----------

export type SettingKind = 'string' | 'integer' | 'boolean' | 'enum' | 'baseUrl';

export interface SettingSpec {
  readonly kind: SettingKind;
  readonly min?: number;
  readonly options?: readonly string[];
}

/**
 * Whitelist de todas as chaves que o painel de configurações pode gravar via
 * config.update. As chaves são relativas à seção generateCommit; chaves com
 * escopo de provider usam a forma "<id>.<campo>". Qualquer coisa fora deste
 * mapa é rejeitada.
 */
export const PANEL_SETTINGS: Readonly<Record<string, SettingSpec>> = {
  provider: {
    kind: 'enum',
    options: ['claudeCli', 'codexCli', 'openrouter', 'kimi', 'glm', 'minimax', 'anthropicCustom'],
  },
  language: { kind: 'string' },
  maxDiffChars: { kind: 'integer', min: 1000 },
  maxFileSizeKB: { kind: 'integer', min: 1 },
  includeRecentCommits: { kind: 'boolean' },
  customPrompt: { kind: 'string' },
  unstagedFallback: { kind: 'enum', options: ['ask', 'always', 'never'] },
  timeoutSeconds: { kind: 'integer', min: 5 },
  'openrouter.model': { kind: 'string' },
  'openrouter.baseUrl': { kind: 'baseUrl' },
  'kimi.model': { kind: 'string' },
  'kimi.baseUrl': { kind: 'baseUrl' },
  'glm.model': { kind: 'string' },
  'glm.baseUrl': { kind: 'baseUrl' },
  'minimax.model': { kind: 'string' },
  'minimax.baseUrl': { kind: 'baseUrl' },
  'anthropicCustom.model': { kind: 'string' },
  'anthropicCustom.baseUrl': { kind: 'baseUrl' },
  'anthropicCustom.authHeader': { kind: 'enum', options: ['x-api-key', 'bearer'] },
  'claudeCli.model': { kind: 'string' },
  'claudeCli.effort': { kind: 'enum', options: ['', 'low', 'medium', 'high', 'xhigh', 'max'] },
  'codexCli.model': { kind: 'string' },
  'codexCli.effort': { kind: 'string' },
};

export type ValidatedValue = string | number | boolean;

export type ValidationResult = { ok: true; value: ValidatedValue } | { ok: false };

/**
 * Valida um valor vindo da webview do painel de configurações contra a
 * whitelist. Nunca confie em mensagens da webview: chaves desconhecidas e
 * tipos incompatíveis são rejeitados.
 */
export function validateSettingValue(key: string, value: unknown): ValidationResult {
  // Object.hasOwn bloqueia membros herdados (__proto__, constructor, ...),
  // que de outra forma passariam na verificação de verdade abaixo.
  const spec = Object.hasOwn(PANEL_SETTINGS, key) ? PANEL_SETTINGS[key] : undefined;
  if (!spec) return { ok: false };
  switch (spec.kind) {
    case 'boolean':
      return typeof value === 'boolean' ? { ok: true, value } : { ok: false };
    case 'integer': {
      const parsed = typeof value === 'number' ? value : Number(String(value).trim());
      const min = spec.min ?? 0;
      return Number.isInteger(parsed) && parsed >= min
        ? { ok: true, value: parsed }
        : { ok: false };
    }
    case 'enum':
      return typeof value === 'string' && spec.options?.includes(value)
        ? { ok: true, value }
        : { ok: false };
    case 'baseUrl':
      return typeof value === 'string' && isValidBaseUrl(value)
        ? { ok: true, value: value.trim() }
        : { ok: false };
    case 'string': {
      if (typeof value !== 'string') return { ok: false };
      const trimmed = value.trim();
      // A sentinela Custom… é um controle de UI, nunca um id de modelo persistível.
      if (key.endsWith('.model') && trimmed === CUSTOM_MODEL_VALUE) return { ok: false };
      return { ok: true, value: trimmed };
    }
  }
}

/** Restringe os ids de provider que aceitam API key (alvos do secret storage). */
export function isKeyBackedProvider(
  id: string,
): id is 'openrouter' | 'kimi' | 'glm' | 'minimax' | 'anthropicCustom' {
  return (
    id === 'openrouter' ||
    id === 'kimi' ||
    id === 'glm' ||
    id === 'minimax' ||
    id === 'anthropicCustom'
  );
}

// ---------- opções do dropdown de modelo ----------

/** Opção sentinela no select de modelo que alterna para o modo de texto livre. */
export const CUSTOM_MODEL_VALUE = '__custom';

export interface ModelOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Opções do dropdown de modelo: primeiro a opção vazia de padrão do provider,
 * o valor atual quando não está no catálogo (para um modelo customizado nunca
 * sumir de repente), cada entrada do catálogo exceto qualquer colisão literal
 * com a sentinela, e a sentinela Custom… no final.
 */
export function buildModelOptions(
  models: readonly string[],
  current: string,
): { options: ModelOption[]; selected: string } {
  const options: ModelOption[] = [{ value: '', label: '(provider default)' }];
  if (current && !models.includes(current)) {
    options.push({ value: current, label: `${current} (current)` });
  }
  for (const model of models) {
    if (model !== CUSTOM_MODEL_VALUE) options.push({ value: model, label: model });
  }
  options.push({ value: CUSTOM_MODEL_VALUE, label: 'Custom…' });
  return { options, selected: current };
}

// ---------- protocolo de mensagens do painel de configurações ----------

export type PanelMessage =
  | { type: 'ready' }
  | { type: 'update'; key: string; value: unknown }
  | { type: 'saveKey'; provider: string; value: string; force: boolean };

/** Interpreta e sanitiza um postMessage bruto vindo da webview do painel de configurações. */
export function parseMessage(raw: unknown): PanelMessage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const msg = raw as {
    type?: unknown;
    key?: unknown;
    value?: unknown;
    provider?: unknown;
    force?: unknown;
  };
  if (msg.type === 'ready') return { type: 'ready' };
  if (msg.type === 'update' && typeof msg.key === 'string') {
    return { type: 'update', key: msg.key, value: msg.value };
  }
  if (msg.type === 'saveKey' && typeof msg.provider === 'string' && typeof msg.value === 'string') {
    return { type: 'saveKey', provider: msg.provider, value: msg.value, force: msg.force === true };
  }
  return undefined;
}
