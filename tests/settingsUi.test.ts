import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config';
import { PROVIDERS } from '../src/providers/registry';
import {
  advancedItemsFor,
  buildSettingsMenu,
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
