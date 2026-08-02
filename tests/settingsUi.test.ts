import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config';
import { PROVIDERS } from '../src/providers/registry';
import {
  advancedItemsFor,
  buildAdvancedChildren,
  buildSettingsMenu,
  buildSettingsTree,
  isValidBaseUrl,
  parseIntSetting,
} from '../src/settingsModel';

describe('parseIntSetting', () => {
  it('accepts integers at or above the minimum', () => {
    expect(parseIntSetting('5000', 1000)).toBe(5000);
    expect(parseIntSetting(' 100 ', 5)).toBe(100);
    expect(parseIntSetting('5', 5)).toBe(5);
  });

  it('rejects non-integers, below-minimum and garbage', () => {
    expect(parseIntSetting('3.5', 1)).toBeUndefined();
    expect(parseIntSetting('0', 1)).toBeUndefined();
    expect(parseIntSetting('abc', 1)).toBeUndefined();
    expect(parseIntSetting('', 1)).toBeUndefined();
  });
});

describe('isValidBaseUrl', () => {
  it('accepts empty (reset to default) and HTTPS', () => {
    expect(isValidBaseUrl('')).toBe(true);
    expect(isValidBaseUrl('  ')).toBe(true);
    expect(isValidBaseUrl('https://api.example.com')).toBe(true);
  });

  it('rejects plain HTTP and garbage', () => {
    expect(isValidBaseUrl('http://api.example.com')).toBe(false);
    expect(isValidBaseUrl('api.example.com')).toBe(false);
  });

  it('rejects malformed HTTPS values', () => {
    expect(isValidBaseUrl('https://')).toBe(false);
    expect(isValidBaseUrl('https://?x=1')).toBe(false);
    expect(isValidBaseUrl('https:// espaço')).toBe(false);
  });
});

describe('advancedItemsFor', () => {
  it('returns editable items for every declared provider', () => {
    for (const meta of PROVIDERS) {
      expect(advancedItemsFor(meta.id).length).toBeGreaterThan(0);
    }
  });

  it('exposes authHeader only for the custom endpoint', () => {
    expect(advancedItemsFor('anthropicCustom').map((i) => i.key)).toContain('authHeader');
    expect(advancedItemsFor('kimi').map((i) => i.key)).not.toContain('authHeader');
  });

  it('exposes effort as enum for claude and free text for codex', () => {
    const claude = advancedItemsFor('claudeCli').find((i) => i.key === 'effort');
    expect(claude?.kind).toBe('enum');
    expect(claude?.options).toContain('max');
    const codex = advancedItemsFor('codexCli').find((i) => i.key === 'effort');
    expect(codex?.kind).toBe('text');
  });
});

describe('buildSettingsMenu', () => {
  const cfg: AppConfig = {
    provider: 'glm',
    language: 'pt-BR',
    maxDiffChars: 50000,
    maxFileSizeKB: 50,
    includeRecentCommits: true,
    customPrompt: '',
    unstagedFallback: 'ask',
    timeoutSeconds: 60,
  };

  it('covers every user-facing setting', () => {
    const ids = buildSettingsMenu(cfg).map((item) => item.id);
    expect(ids).toEqual([
      'provider',
      'apiKey',
      'language',
      'maxDiffChars',
      'maxFileSizeKB',
      'includeRecentCommits',
      'customPrompt',
      'unstagedFallback',
      'timeoutSeconds',
      'advanced',
    ]);
  });

  it('shows the current values in descriptions', () => {
    const menu = buildSettingsMenu(cfg);
    expect(menu.find((i) => i.id === 'language')?.description).toBe('pt-BR');
    expect(menu.find((i) => i.id === 'timeoutSeconds')?.description).toBe('60');
    expect(menu.find((i) => i.id === 'provider')?.description).toBe('glm');
  });
});

describe('buildSettingsTree', () => {
  const cfg: AppConfig = {
    provider: 'claudeCli',
    language: 'en',
    maxDiffChars: 50000,
    maxFileSizeKB: 50,
    includeRecentCommits: false,
    customPrompt: 'be terse',
    unstagedFallback: 'never',
    timeoutSeconds: 30,
  };

  it('mirrors the settings menu with plain labels and codicon ids', () => {
    const tree = buildSettingsTree(cfg);
    expect(tree.map((n) => n.id)).toEqual(buildSettingsMenu(cfg).map((i) => i.id));
    const language = tree.find((n) => n.id === 'language');
    expect(language?.label).toBe('Message language');
    expect(language?.iconId).toBe('globe');
    expect(language?.description).toBe('en');
  });

  it('marks only the advanced node as collapsible', () => {
    const tree = buildSettingsTree(cfg);
    expect(tree.filter((n) => n.collapsible).map((n) => n.id)).toEqual(['advanced']);
  });

  it('reflects current values', () => {
    const tree = buildSettingsTree(cfg);
    expect(tree.find((n) => n.id === 'includeRecentCommits')?.description).toBe('off');
    expect(tree.find((n) => n.id === 'customPrompt')?.description).toBe('set');
    expect(tree.find((n) => n.id === 'unstagedFallback')?.description).toBe('never');
  });
});

describe('buildAdvancedChildren', () => {
  it('lists one child per provider with its model', () => {
    const models = {
      openrouter: 'google/gemini-2.5-flash-lite',
      kimi: 'kimi-k2.6',
      glm: 'glm-4.5-air',
      minimax: 'MiniMax-M2.5-highspeed',
      anthropicCustom: 'claude-haiku-4-5-20251001',
      claudeCli: '',
      codexCli: '',
    };
    const children = buildAdvancedChildren(models);
    expect(children).toHaveLength(PROVIDERS.length);
    expect(children.map((c) => c.id)).toContain('advancedProvider:glm');
    expect(children.find((c) => c.id === 'advancedProvider:kimi')?.description).toBe('kimi-k2.6');
    expect(children.find((c) => c.id === 'advancedProvider:claudeCli')?.description).toBe(
      'provider default',
    );
  });
});
