import { describe, expect, it } from 'vitest';
import { PROVIDERS } from '../src/providers/registry';
import {
  advancedItemsFor,
  isKeyBackedProvider,
  isValidBaseUrl,
  LANGUAGE_OPTIONS,
  PANEL_SETTINGS,
  parseIntSetting,
  validateSettingValue,
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
  it('accepts empty (reset to default) and valid HTTPS', () => {
    expect(isValidBaseUrl('')).toBe(true);
    expect(isValidBaseUrl('  ')).toBe(true);
    expect(isValidBaseUrl('https://api.example.com')).toBe(true);
    expect(isValidBaseUrl('https://api.example.com/path/v1')).toBe(true);
  });

  it('rejects plain HTTP, garbage and malformed HTTPS', () => {
    expect(isValidBaseUrl('http://api.example.com')).toBe(false);
    expect(isValidBaseUrl('api.example.com')).toBe(false);
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

describe('validateSettingValue', () => {
  it('rejects unknown keys (webview messages are never trusted)', () => {
    expect(validateSettingValue('__proto__', 'x').ok).toBe(false);
    expect(validateSettingValue('telemetry.level', 'all').ok).toBe(false);
  });

  it('validates enums strictly', () => {
    expect(validateSettingValue('provider', 'glm')).toEqual({ ok: true, value: 'glm' });
    expect(validateSettingValue('provider', 'bogus').ok).toBe(false);
    expect(validateSettingValue('unstagedFallback', 'always')).toEqual({
      ok: true,
      value: 'always',
    });
    expect(validateSettingValue('unstagedFallback', 'sometimes').ok).toBe(false);
    expect(validateSettingValue('anthropicCustom.authHeader', 'bearer')).toEqual({
      ok: true,
      value: 'bearer',
    });
  });

  it('validates booleans', () => {
    expect(validateSettingValue('includeRecentCommits', true)).toEqual({ ok: true, value: true });
    expect(validateSettingValue('includeRecentCommits', 'true').ok).toBe(false);
  });

  it('validates integers with minimum, accepting numeric strings', () => {
    expect(validateSettingValue('maxDiffChars', 50000)).toEqual({ ok: true, value: 50000 });
    expect(validateSettingValue('maxDiffChars', '50000')).toEqual({ ok: true, value: 50000 });
    expect(validateSettingValue('maxDiffChars', 999).ok).toBe(false);
    expect(validateSettingValue('timeoutSeconds', 4).ok).toBe(false);
    expect(validateSettingValue('timeoutSeconds', 5).ok).toBe(true);
  });

  it('validates baseUrl through the HTTPS rule', () => {
    expect(validateSettingValue('openrouter.baseUrl', 'https://openrouter.ai/api/v1')).toEqual({
      ok: true,
      value: 'https://openrouter.ai/api/v1',
    });
    expect(validateSettingValue('openrouter.baseUrl', 'http://openrouter.ai').ok).toBe(false);
    expect(validateSettingValue('kimi.baseUrl', '')).toEqual({ ok: true, value: '' });
  });

  it('trims free strings', () => {
    expect(validateSettingValue('customPrompt', '  be terse  ')).toEqual({
      ok: true,
      value: 'be terse',
    });
    expect(validateSettingValue('codexCli.effort', 'high')).toEqual({ ok: true, value: 'high' });
    expect(validateSettingValue('customPrompt', 42).ok).toBe(false);
  });

  it('covers every key the panel is allowed to write', () => {
    const expected = [
      'provider',
      'language',
      'maxDiffChars',
      'maxFileSizeKB',
      'includeRecentCommits',
      'customPrompt',
      'unstagedFallback',
      'timeoutSeconds',
    ];
    for (const key of expected) expect(PANEL_SETTINGS[key]).toBeDefined();
    for (const meta of PROVIDERS) {
      for (const item of advancedItemsFor(meta.id)) {
        expect(PANEL_SETTINGS[`${meta.id}.${item.key}`]).toBeDefined();
      }
    }
  });
});

describe('isKeyBackedProvider', () => {
  it('accepts the HTTP providers and rejects CLIs and garbage', () => {
    expect(isKeyBackedProvider('openrouter')).toBe(true);
    expect(isKeyBackedProvider('minimax')).toBe(true);
    expect(isKeyBackedProvider('claudeCli')).toBe(false);
    expect(isKeyBackedProvider('codexCli')).toBe(false);
    expect(isKeyBackedProvider('bogus')).toBe(false);
  });
});

describe('LANGUAGE_OPTIONS', () => {
  it('offers the documented defaults', () => {
    const codes = LANGUAGE_OPTIONS.map((l) => l.code);
    expect(codes).toContain('en');
    expect(codes).toContain('pt-BR');
  });
});

describe('parseMessage', () => {
  it('parses the three protocol shapes', async () => {
    const { parseMessage } = await import('../src/settingsModel');
    expect(parseMessage({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(parseMessage({ type: 'update', key: 'language', value: 'en' })).toEqual({
      type: 'update',
      key: 'language',
      value: 'en',
    });
    expect(parseMessage({ type: 'saveKey', provider: 'glm', value: 'k' })).toEqual({
      type: 'saveKey',
      provider: 'glm',
      value: 'k',
      force: false,
    });
    expect(parseMessage({ type: 'saveKey', provider: 'glm', value: 'k', force: true })).toEqual({
      type: 'saveKey',
      provider: 'glm',
      value: 'k',
      force: true,
    });
  });

  it('rejects malformed and hostile messages', async () => {
    const { parseMessage } = await import('../src/settingsModel');
    expect(parseMessage(null)).toBeUndefined();
    expect(parseMessage('update')).toBeUndefined();
    expect(parseMessage({ type: 'nope' })).toBeUndefined();
    expect(parseMessage({ type: 'update', value: 'x' })).toBeUndefined();
    expect(parseMessage({ type: 'update', key: 42, value: 'x' })).toBeUndefined();
    expect(parseMessage({ type: 'saveKey', provider: 'glm' })).toBeUndefined();
    expect(parseMessage({ type: 'saveKey', provider: 'glm', value: 'k', force: 'yes' })).toEqual({
      type: 'saveKey',
      provider: 'glm',
      value: 'k',
      force: false,
    });
  });
});
