import { describe, expect, it } from 'vitest';
import { mapHttpError } from '../src/http';
import { buildAnthropicRequest, parseAnthropicResponse } from '../src/providers/anthropic';
import { buildClaudeArgs } from '../src/providers/claudeCli';
import { buildCodexArgs } from '../src/providers/codexCli';
import { parseOpenAiChatResponse } from '../src/providers/openrouter';
import { type GenerateRequest, ProviderError } from '../src/types';

const req = (overrides: Partial<GenerateRequest> = {}): GenerateRequest => ({
  systemPrompt: 'SYS',
  userPrompt: 'USER',
  model: 'model-x',
  effort: '',
  timeoutMs: 1000,
  signal: new AbortController().signal,
  ...overrides,
});

describe('parseOpenAiChatResponse', () => {
  it('extracts string content', () => {
    const json = { choices: [{ message: { role: 'assistant', content: 'feat: x' } }] };
    expect(parseOpenAiChatResponse(json)).toBe('feat: x');
  });

  it('joins content parts', () => {
    const json = { choices: [{ message: { content: [{ text: 'feat:' }, { text: ' x' }] } }] };
    expect(parseOpenAiChatResponse(json)).toBe('feat: x');
  });

  it('rejects responses without choices', () => {
    expect(() => parseOpenAiChatResponse({})).toThrowError(ProviderError);
    expect(() => parseOpenAiChatResponse(null)).toThrowError(ProviderError);
  });

  it('rejects empty content', () => {
    expect(() =>
      parseOpenAiChatResponse({ choices: [{ message: { content: '  ' } }] }),
    ).toThrowError(ProviderError);
  });
});

describe('parseAnthropicResponse', () => {
  it('joins text blocks and ignores thinking blocks', () => {
    const json = {
      content: [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: 'feat: x' },
        { type: 'text', text: '\n\n- body' },
      ],
    };
    expect(parseAnthropicResponse(json)).toBe('feat: x\n\n- body');
  });

  it('rejects responses without content blocks', () => {
    expect(() => parseAnthropicResponse({})).toThrowError(ProviderError);
    expect(() => parseAnthropicResponse('nope')).toThrowError(ProviderError);
  });

  it('rejects responses without text', () => {
    expect(() =>
      parseAnthropicResponse({ content: [{ type: 'thinking', thinking: 'hmm' }] }),
    ).toThrowError(ProviderError);
  });
});

describe('buildAnthropicRequest', () => {
  it('posts to <baseUrl>/v1/messages and trims trailing slashes', () => {
    const built = buildAnthropicRequest(
      { baseUrl: 'https://api.minimax.io/anthropic/', model: 'm', auth: 'bearer' },
      'KEY',
      req(),
    );
    expect(built.url).toBe('https://api.minimax.io/anthropic/v1/messages');
  });

  it('uses bearer auth when configured', () => {
    const built = buildAnthropicRequest(
      { baseUrl: 'https://x', model: 'm', auth: 'bearer' },
      'KEY',
      req(),
    );
    expect(built.headers.authorization).toBe('Bearer KEY');
    expect(built.headers['x-api-key']).toBeUndefined();
    expect(built.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('uses x-api-key auth when configured', () => {
    const built = buildAnthropicRequest(
      { baseUrl: 'https://x', model: 'm', auth: 'x-api-key' },
      'KEY',
      req(),
    );
    expect(built.headers['x-api-key']).toBe('KEY');
    expect(built.headers.authorization).toBeUndefined();
  });

  it('builds the Messages API body with the system prompt at top level', () => {
    const built = buildAnthropicRequest(
      { baseUrl: 'https://x', model: 'm', auth: 'bearer' },
      'K',
      req(),
    );
    expect(built.body).toEqual({
      model: 'm',
      max_tokens: 512,
      system: 'SYS',
      messages: [{ role: 'user', content: 'USER' }],
      temperature: 0.3,
    });
  });

  it('honors maxTokens overrides (validation pings)', () => {
    const built = buildAnthropicRequest(
      { baseUrl: 'https://x', model: 'm', auth: 'bearer' },
      'K',
      req({ maxTokens: 8 }),
    );
    expect(built.body.max_tokens).toBe(8);
  });
});

describe('mapHttpError', () => {
  it('maps statuses to distinct actionable kinds', () => {
    expect(mapHttpError(401, 'bad key', null).kind).toBe('auth');
    expect(mapHttpError(403, '', null).kind).toBe('auth');
    expect(mapHttpError(402, '', null).kind).toBe('billing');
    expect(mapHttpError(429, '', null).kind).toBe('rateLimit');
    expect(mapHttpError(500, '', null).kind).toBe('server');
    expect(mapHttpError(529, 'overloaded', null).kind).toBe('server');
    expect(mapHttpError(408, '', null).kind).toBe('timeout');
    expect(mapHttpError(413, '', null).kind).toBe('invalidResponse');
    expect(mapHttpError(400, '', null).kind).toBe('invalidResponse');
    expect(mapHttpError(418, '', null).kind).toBe('unknown');
  });

  it('includes the retry-after hint for 429', () => {
    expect(mapHttpError(429, '', '30').message).toContain('retry after 30s');
  });

  it('carries the provider error detail without exposing bodies', () => {
    expect(mapHttpError(401, 'invalid api key', null).message).toContain('invalid api key');
  });
});

describe('buildClaudeArgs', () => {
  it('uses headless safe defaults', () => {
    const args = buildClaudeArgs({ model: '', effort: '' });
    expect(args).toEqual([
      '-p',
      '--tools',
      '',
      '--output-format',
      'text',
      '--no-session-persistence',
    ]);
  });

  it('appends model and effort only when set', () => {
    const args = buildClaudeArgs({ model: 'sonnet', effort: 'low' });
    expect(args).toContain('--model');
    expect(args).toContain('sonnet');
    expect(args).toContain('--effort');
    expect(args).toContain('low');
  });
});

describe('buildCodexArgs', () => {
  it('uses non-interactive read-only defaults with an output file', () => {
    const args = buildCodexArgs({ model: '', effort: '' }, '/tmp/out.md');
    expect(args).toContain('exec');
    expect(args).toContain('read-only');
    expect(args).toContain('never');
    expect(args).toContain('--skip-git-repo-check');
    expect(args).toContain('--ephemeral');
    expect(args).toContain('/tmp/out.md');
  });

  it('passes effort through the documented config key', () => {
    const args = buildCodexArgs({ model: 'gpt-x', effort: 'high' }, '/tmp/out.md');
    const idx = args.indexOf('--config');
    expect(args[idx + 1]).toBe('model_reasoning_effort="high"');
    expect(args).toContain('gpt-x');
  });
});
