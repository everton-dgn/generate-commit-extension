import type * as vscode from 'vscode';
import type { AppConfig } from './config';
import type { ProviderId } from './types';

/** Parses a positive integer setting; undefined when invalid or below min. */
export function parseIntSetting(input: string, min: number): number | undefined {
  const value = Number(input.trim());
  if (!Number.isInteger(value) || value < min) return undefined;
  return value;
}

/** Empty resets to the provider default; otherwise HTTPS is required. */
export function isValidBaseUrl(input: string): boolean {
  const trimmed = input.trim();
  return trimmed === '' || trimmed.startsWith('https://');
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

export type SettingsItemId =
  | 'provider'
  | 'apiKey'
  | 'language'
  | 'maxDiffChars'
  | 'maxFileSizeKB'
  | 'includeRecentCommits'
  | 'customPrompt'
  | 'unstagedFallback'
  | 'timeoutSeconds'
  | 'advanced';

export interface SettingsItem extends vscode.QuickPickItem {
  readonly id: SettingsItemId;
}

/** Master menu: every user-facing setting, with its current value. */
export function buildSettingsMenu(cfg: AppConfig): SettingsItem[] {
  return [
    { id: 'provider', label: '$(hubot) Provider and model…', description: cfg.provider },
    { id: 'apiKey', label: '$(key) API key…', description: 'configure or update' },
    { id: 'language', label: '$(globe) Message language…', description: cfg.language },
    {
      id: 'maxDiffChars',
      label: '$(fold) Max diff characters…',
      description: String(cfg.maxDiffChars),
    },
    {
      id: 'maxFileSizeKB',
      label: '$(file) Max file size (KB)…',
      description: String(cfg.maxFileSizeKB),
    },
    {
      id: 'includeRecentCommits',
      label: '$(history) Recent commits as style context…',
      description: cfg.includeRecentCommits ? 'on' : 'off',
    },
    {
      id: 'customPrompt',
      label: '$(edit) Custom prompt instructions…',
      description: cfg.customPrompt.trim() ? 'set' : 'empty',
    },
    {
      id: 'unstagedFallback',
      label: '$(git-pull-request) When no staged changes…',
      description: cfg.unstagedFallback,
    },
    {
      id: 'timeoutSeconds',
      label: '$(watch) Timeout (seconds)…',
      description: String(cfg.timeoutSeconds),
    },
    {
      id: 'advanced',
      label: '$(settings-gear) Advanced per provider…',
      description: 'baseUrl, authHeader, effort',
    },
  ];
}

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
