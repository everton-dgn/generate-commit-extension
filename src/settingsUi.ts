import * as vscode from 'vscode';
import { readAppConfig, readProviderConfig } from './config';
import { logMeta } from './log';
import { isProviderId, PROVIDERS, providerMeta } from './providers/registry';
import {
  type AdvancedItem,
  advancedItemsFor,
  buildSettingsMenu,
  isValidBaseUrl,
  LANGUAGE_OPTIONS,
  parseIntSetting,
  type SettingsItemId,
} from './settingsModel';
import type { ProviderId } from './types';

const SECTION = 'generateCommit';

async function update(key: string, value: unknown): Promise<void> {
  await vscode.workspace
    .getConfiguration(SECTION)
    .update(key, value, vscode.ConfigurationTarget.Global);
  logMeta('settings.updated', { key });
}

async function editLanguage(current: string): Promise<void> {
  interface Item extends vscode.QuickPickItem {
    code: string;
  }
  const items: Item[] = LANGUAGE_OPTIONS.map((option) => ({
    label: option.label,
    description: option.code === current ? '$(check) current' : option.code,
    code: option.code,
  }));
  items.push({ label: 'Other…', description: 'enter a language name or code', code: '__custom' });
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `Commit message language (current: ${current})`,
  });
  if (!pick) return;
  let code = pick.code;
  if (code === '__custom') {
    const input = await vscode.window.showInputBox({
      prompt: 'Language name or code (e.g. pt-BR, English)',
      value: current,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : 'Enter a language'),
    });
    if (input === undefined) return;
    code = input.trim();
  }
  await update('language', code);
}

async function editNumber(
  key: 'maxDiffChars' | 'maxFileSizeKB' | 'timeoutSeconds',
  title: string,
  current: number,
  min: number,
): Promise<void> {
  const input = await vscode.window.showInputBox({
    prompt: `${title} (integer, minimum ${min})`,
    value: String(current),
    ignoreFocusOut: true,
    validateInput: (value) =>
      parseIntSetting(value, min) === undefined ? `Enter an integer >= ${min}` : undefined,
  });
  if (input === undefined) return;
  const value = parseIntSetting(input, min);
  if (value !== undefined) await update(key, value);
}

async function editRecentCommits(current: boolean): Promise<void> {
  interface Item extends vscode.QuickPickItem {
    value: boolean;
  }
  const pick = await vscode.window.showQuickPick<Item>(
    [
      { label: 'Enabled', value: true, description: current ? '$(check) current' : '' },
      { label: 'Disabled', value: false, description: current ? '' : '$(check) current' },
    ],
    { placeHolder: 'Include the 10 most recent commit subjects as style context' },
  );
  if (pick) await update('includeRecentCommits', pick.value);
}

async function editCustomPrompt(current: string): Promise<void> {
  const input = await vscode.window.showInputBox({
    prompt: 'Extra instructions appended to the system prompt (empty to clear)',
    value: current,
    ignoreFocusOut: true,
  });
  if (input === undefined) return;
  await update('customPrompt', input.trim());
}

async function editUnstagedFallback(current: string): Promise<void> {
  interface Item extends vscode.QuickPickItem {
    value: 'ask' | 'always' | 'never';
  }
  const items: Item[] = [
    { label: 'ask', description: 'Offer to use unstaged changes each time', value: 'ask' },
    { label: 'always', description: 'Always use unstaged changes', value: 'always' },
    { label: 'never', description: 'Require staged changes', value: 'never' },
  ];
  for (const item of items) {
    if (item.value === current) item.description = `$(check) ${item.description}`;
  }
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'Behavior when the staged diff is empty',
  });
  if (pick) await update('unstagedFallback', pick.value);
}

async function editAdvanced(preselected?: ProviderId): Promise<void> {
  let id = preselected;
  if (!id) {
    interface ProviderItem extends vscode.QuickPickItem {
      id: ProviderId;
    }
    const providerPick = await vscode.window.showQuickPick<ProviderItem>(
      PROVIDERS.map((meta) => ({
        label: meta.label,
        description: readProviderConfig(meta.id).model || 'provider default',
        id: meta.id,
      })),
      { placeHolder: 'Select the provider to configure' },
    );
    if (!providerPick) return;
    id = providerPick.id;
  }
  const meta = providerMeta(id);
  const items = advancedItemsFor(id);
  interface AdvItem extends vscode.QuickPickItem {
    item: AdvancedItem;
  }
  const current = readProviderConfig(id);
  const currentValueOf = (item: AdvancedItem): string => {
    if (item.key === 'model') return current.model;
    if (item.key === 'baseUrl') return current.baseUrl;
    if (item.key === 'authHeader') return current.auth;
    return current.effort;
  };
  const itemPick = await vscode.window.showQuickPick<AdvItem>(
    items.map((item) => ({
      label: item.label,
      description: currentValueOf(item) || '(provider default)',
      item,
    })),
    { placeHolder: `${meta.label}: select the setting to edit` },
  );
  if (!itemPick) return;
  const { item } = itemPick;
  const key = `${id}.${item.key}`;
  if (item.kind === 'enum' && item.options) {
    interface OptItem extends vscode.QuickPickItem {
      value: string;
    }
    const pick = await vscode.window.showQuickPick<OptItem>(
      item.options.map((option) => ({
        label: option || '(provider default)',
        value: option,
        description: option === currentValueOf(item) ? '$(check) current' : '',
      })),
      { placeHolder: item.label },
    );
    if (pick) await update(key, pick.value);
    return;
  }
  const input = await vscode.window.showInputBox({
    prompt: `${item.label} for ${meta.label}. Leave empty to use the provider default.`,
    value: currentValueOf(item),
    ignoreFocusOut: true,
    validateInput: (value) =>
      item.key === 'baseUrl' && !isValidBaseUrl(value) ? 'HTTPS URL or empty' : undefined,
  });
  if (input === undefined) return;
  await update(key, input.trim());
}

export async function handleSettingsItem(id: SettingsItemId): Promise<void> {
  const cfg = readAppConfig();
  switch (id) {
    case 'provider':
      await vscode.commands.executeCommand('generateCommit.switchProvider');
      return;
    case 'apiKey':
      await vscode.commands.executeCommand('generateCommit.configure');
      return;
    case 'language':
      return editLanguage(cfg.language);
    case 'maxDiffChars':
      return editNumber('maxDiffChars', 'Max diff characters', cfg.maxDiffChars, 1000);
    case 'maxFileSizeKB':
      return editNumber('maxFileSizeKB', 'Max file size (KB)', cfg.maxFileSizeKB, 1);
    case 'includeRecentCommits':
      return editRecentCommits(cfg.includeRecentCommits);
    case 'customPrompt':
      return editCustomPrompt(cfg.customPrompt);
    case 'unstagedFallback':
      return editUnstagedFallback(cfg.unstagedFallback);
    case 'timeoutSeconds':
      return editNumber('timeoutSeconds', 'Timeout (seconds)', cfg.timeoutSeconds, 5);
    case 'advanced':
      return editAdvanced();
  }
}

const ADVANCED_PROVIDER_PREFIX = 'advancedProvider:';

/**
 * Runs one settings edit with error resilience. Entry points: the settings
 * QuickPick loop and the sidebar tree (generateCommit.editSetting).
 */
export async function runSettingsEdit(arg: string): Promise<void> {
  try {
    if (arg.startsWith(ADVANCED_PROVIDER_PREFIX)) {
      const id = arg.slice(ADVANCED_PROVIDER_PREFIX.length);
      if (isProviderId(id)) return await editAdvanced(id);
      return;
    }
    await handleSettingsItem(arg as SettingsItemId);
  } catch (err) {
    // config.update can reject (policy-locked or invalid values): keep the
    // menu usable and surface the failure instead of crashing the command.
    logMeta('settings.error', { detail: err instanceof Error ? err.name : 'unknown' });
    void vscode.window.showErrorMessage(
      `Generate Commit: failed to apply the setting (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

/** Master settings menu: loops until the user dismisses it. */
export async function settingsCommand(): Promise<void> {
  for (;;) {
    const pick = await vscode.window.showQuickPick(buildSettingsMenu(readAppConfig()), {
      placeHolder: 'Generate Commit settings (Esc to close)',
    });
    if (!pick) return;
    await runSettingsEdit(pick.id);
  }
}
