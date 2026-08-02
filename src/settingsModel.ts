import type * as vscode from 'vscode';
import type { AppConfig } from './config';
import { PROVIDERS } from './providers/registry';
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

interface ItemMeta {
  readonly id: SettingsItemId;
  readonly iconId: string;
  readonly label: string;
}

const ITEM_META: readonly ItemMeta[] = [
  { id: 'provider', iconId: 'hubot', label: 'Provider and model' },
  { id: 'apiKey', iconId: 'key', label: 'API key' },
  { id: 'language', iconId: 'globe', label: 'Message language' },
  { id: 'maxDiffChars', iconId: 'fold', label: 'Max diff characters' },
  { id: 'maxFileSizeKB', iconId: 'file', label: 'Max file size (KB)' },
  { id: 'includeRecentCommits', iconId: 'history', label: 'Recent commits as style context' },
  { id: 'customPrompt', iconId: 'edit', label: 'Custom prompt instructions' },
  { id: 'unstagedFallback', iconId: 'git-pull-request', label: 'When no staged changes' },
  { id: 'timeoutSeconds', iconId: 'watch', label: 'Timeout (seconds)' },
  { id: 'advanced', iconId: 'settings-gear', label: 'Advanced per provider' },
];

function descriptionFor(id: SettingsItemId, cfg: AppConfig): string {
  switch (id) {
    case 'provider':
      return cfg.provider;
    case 'apiKey':
      return 'configure or update';
    case 'language':
      return cfg.language;
    case 'maxDiffChars':
      return String(cfg.maxDiffChars);
    case 'maxFileSizeKB':
      return String(cfg.maxFileSizeKB);
    case 'includeRecentCommits':
      return cfg.includeRecentCommits ? 'on' : 'off';
    case 'customPrompt':
      return cfg.customPrompt.trim() ? 'set' : 'empty';
    case 'unstagedFallback':
      return cfg.unstagedFallback;
    case 'timeoutSeconds':
      return String(cfg.timeoutSeconds);
    case 'advanced':
      return 'baseUrl, authHeader, effort';
  }
}

/** Master menu: every user-facing setting, with its current value. */
export function buildSettingsMenu(cfg: AppConfig): SettingsItem[] {
  return ITEM_META.map((meta) => ({
    id: meta.id,
    label: `$(${meta.iconId}) ${meta.label}…`,
    description: descriptionFor(meta.id, cfg),
  }));
}

export interface SettingsTreeNode {
  readonly id: SettingsItemId;
  readonly label: string;
  readonly iconId: string;
  readonly description: string;
  readonly collapsible: boolean;
}

/** Sidebar tree rows: same settings, plain labels plus codicon ids. */
export function buildSettingsTree(cfg: AppConfig): SettingsTreeNode[] {
  return ITEM_META.map((meta) => ({
    id: meta.id,
    label: meta.label,
    iconId: meta.iconId,
    description: descriptionFor(meta.id, cfg),
    collapsible: meta.id === 'advanced',
  }));
}

export interface AdvancedTreeChild {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

/** Children of the "Advanced per provider" tree node. */
export function buildAdvancedChildren(
  models: Readonly<Record<ProviderId, string>>,
): AdvancedTreeChild[] {
  return PROVIDERS.map((meta) => ({
    id: `advancedProvider:${meta.id}`,
    label: meta.label,
    description: models[meta.id] || 'provider default',
  }));
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
