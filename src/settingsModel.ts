/** Parses a positive-integer setting; undefined when invalid or below the minimum. */
export function parseIntSetting(input: string, min: number): number | undefined {
  const value = Number(input.trim());
  if (!Number.isInteger(value) || value < min) return undefined;
  return value;
}

/** Empty restores the provider default; otherwise requires a valid HTTPS URL. */
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
  disableThinking: { kind: 'boolean' },
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
 * whitelist. Never trust webview messages: unknown keys and mismatched
 * types are rejected.
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
    case 'string': {
      if (typeof value !== 'string') return { ok: false };
      const trimmed = value.trim();
      // The Custom… sentinel is a UI control, never a persistable value:
      // as a model id it would become a nonexistent model, and as a language
      // it would duplicate the Custom… option's value in the select, making
      // free-text mode unreachable.
      if ((key.endsWith('.model') || key === 'language') && trimmed === CUSTOM_MODEL_VALUE) {
        return { ok: false };
      }
      return { ok: true, value: trimmed };
    }
  }
}

/** Narrows the provider ids that accept an API key (secret storage targets). */
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
 * Model dropdown options: first the empty provider-default option, the
 * current value when it is not in the catalog (so a custom model never
 * suddenly disappears), each catalog entry except any literal collision
 * with the sentinel, and the Custom… sentinel at the end.
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

/**
 * Claude Code CLI effort levels, checked against `claude --help`
 * (Claude Code 2.1.220) on 2026-08-02.
 */
export const CLAUDE_CLI_EFFORT_LEVELS: readonly string[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/**
 * Effort dropdown options: first the empty CLI-default option, the current
 * value when it is not in the list (so an unknown level never suddenly
 * disappears) and each supported level.
 */
export function buildEffortOptions(
  levels: readonly string[],
  current: string,
): { options: ModelOption[]; selected: string } {
  const options: ModelOption[] = [{ value: '', label: '(CLI default)' }];
  if (current && !levels.includes(current)) {
    options.push({ value: current, label: `${current} (current)` });
  }
  for (const level of levels) {
    options.push({ value: level, label: level });
  }
  return { options, selected: current };
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
