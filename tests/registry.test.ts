import { describe, expect, it } from 'vitest';
import { PROVIDERS, resolveProviderChoice } from '../src/providers/registry';

describe('resolveProviderChoice', () => {
  it('keeps the configured provider when available', () => {
    expect(resolveProviderChoice('glm', { glm: true, claudeCli: true })).toBe('glm');
  });

  it('falls back to the first available provider in display order', () => {
    expect(resolveProviderChoice('glm', { glm: false, openrouter: true, claudeCli: true })).toBe(
      'claudeCli',
    );
  });

  it('tolerates an unknown configured value', () => {
    expect(resolveProviderChoice('bogus', { minimax: true })).toBe('minimax');
  });

  it('returns null when nothing is available', () => {
    expect(resolveProviderChoice('glm', {})).toBeNull();
    expect(resolveProviderChoice('glm', { glm: false, kimi: false })).toBeNull();
  });

  it('covers every declared provider id in the registry order', () => {
    const only = (id: string) => ({ [id]: true });
    for (const meta of PROVIDERS) {
      expect(resolveProviderChoice('bogus', only(meta.id))).toBe(meta.id);
    }
  });
});
