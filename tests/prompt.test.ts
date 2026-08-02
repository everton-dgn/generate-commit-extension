import { describe, expect, it } from 'vitest';
import {
  buildSystemPrompt,
  buildUserPrompt,
  parseModelOutput,
  resolveLanguage,
} from '../src/prompt';

describe('resolveLanguage', () => {
  it('maps known codes to full names', () => {
    expect(resolveLanguage('en')).toBe('English');
    expect(resolveLanguage('pt-BR')).toBe('Brazilian Portuguese');
  });

  it('passes unknown codes through', () => {
    expect(resolveLanguage('tlh')).toBe('tlh');
  });

  it('falls back to English for empty input', () => {
    expect(resolveLanguage('  ')).toBe('English');
  });
});

describe('buildSystemPrompt', () => {
  it('includes the language and Conventional Commits rules', () => {
    const prompt = buildSystemPrompt('pt-BR', '');
    expect(prompt).toContain('Brazilian Portuguese');
    expect(prompt).toContain('Conventional Commits');
    expect(prompt).toContain('feat, fix, docs');
  });

  it('appends custom instructions when provided', () => {
    const prompt = buildSystemPrompt('en', 'Always use the api scope');
    expect(prompt).toContain('Always use the api scope');
  });

  it('omits the custom section for blank input', () => {
    const prompt = buildSystemPrompt('en', '   ');
    expect(prompt).not.toContain('Additional instructions');
  });
});

describe('buildUserPrompt', () => {
  it('includes recent commits as style context', () => {
    const prompt = buildUserPrompt({
      diff: 'DIFF',
      truncated: false,
      recentCommits: ['feat: a', 'fix: b'],
    });
    expect(prompt).toContain('style reference only');
    expect(prompt).toContain('- feat: a');
    expect(prompt).toContain('DIFF');
  });

  it('flags truncation when present', () => {
    const prompt = buildUserPrompt({ diff: 'DIFF', truncated: true, recentCommits: [] });
    expect(prompt).toContain('truncated');
    expect(prompt).not.toContain('style reference');
  });
});

describe('parseModelOutput', () => {
  it('passes plain text through', () => {
    expect(parseModelOutput('feat: add button')).toBe('feat: add button');
  });

  it('strips markdown code fences', () => {
    expect(parseModelOutput('```\nfeat: add button\n```')).toBe('feat: add button');
    expect(parseModelOutput('```text\nfeat: add button\n```')).toBe('feat: add button');
  });

  it('strips a leading label', () => {
    expect(parseModelOutput('Commit message: feat: add button')).toBe('feat: add button');
  });

  it('strips wrapping quotes', () => {
    expect(parseModelOutput('"feat: add button"')).toBe('feat: add button');
  });

  it('preserves multi-line bodies', () => {
    const raw = 'feat: add button\n\n- wire the command\n- add tests';
    expect(parseModelOutput(raw)).toBe(raw);
  });
});
