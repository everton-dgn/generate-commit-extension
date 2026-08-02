import type { ProviderId } from './types';

/** Parses a positive integer setting; undefined when invalid or below min. */
export function parseIntSetting(input: string, min: number): number | undefined {
  const value = Number(input.trim());
  if (!Number.isInteger(value) || value < min) return undefined;
  return value;
}

/** Empty resets to the provider default; otherwise a valid HTTPS URL is required. */
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

/** Editable advanced keys per provider. */
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

// ---------- settings panel message validation ----------

export type SettingKind = 'string' | 'integer' | 'boolean' | 'enum' | 'baseUrl';

export interface SettingSpec {
  readonly kind: SettingKind;
  readonly min?: number;
  readonly options?: readonly string[];
}

/**
 * Whitelist of every key the settings panel may write via config.update.
 * Keys are relative to the generateCommit section; provider-scoped keys use
 * the "<id>.<field>" form. Anything outside this map is rejected.
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
 * Validates a value coming from the settings panel webview against the
 * whitelist. Never trust webview messages: unknown keys and type mismatches
 * are rejected.
 */
export function validateSettingValue(key: string, value: unknown): ValidationResult {
  // Object.hasOwn blocks inherited members (__proto__, constructor, ...),
  // which would otherwise pass the truthiness check below.
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
    case 'string':
      return typeof value === 'string' ? { ok: true, value: value.trim() } : { ok: false };
  }
}

/** Narrows provider ids that accept an API key (secret storage targets). */
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

// ---------- model dropdown options ----------

/** Sentinel option in the model select that switches to free-text mode. */
export const CUSTOM_MODEL_VALUE = '__custom';

export interface ModelOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Options for the model dropdown: every catalog entry, the current value
 * prepended when it is not in the catalog (so a custom model never snaps
 * away), the provider-default empty option when nothing is set, and the
 * Custom… sentinel at the end.
 */
export function buildModelOptions(
  models: readonly string[],
  current: string,
): { options: ModelOption[]; selected: string } {
  const options: ModelOption[] = models.map((model) => ({ value: model, label: model }));
  let selected = current;
  if (current && !models.includes(current)) {
    options.unshift({ value: current, label: `${current} (current)` });
  } else if (!current) {
    options.unshift({ value: '', label: '(provider default)' });
    selected = '';
  }
  options.push({ value: CUSTOM_MODEL_VALUE, label: 'Custom…' });
  return { options, selected };
}

// ---------- settings panel message protocol ----------

export type PanelMessage =
  | { type: 'ready' }
  | { type: 'update'; key: string; value: unknown }
  | { type: 'saveKey'; provider: string; value: string; force: boolean };

/** Parses and sanitizes a raw postMessage from the settings panel webview. */
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
