import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type GenerateRequest, ProviderError } from '../src/types';

const postJsonMock = vi.fn();
const runCliMock = vi.fn();
const findBinaryMock = vi.fn();

vi.mock('../src/http', () => ({
  postJson: (...args: unknown[]) => postJsonMock(...args),
  mapHttpError: (status: number, detail: string) =>
    new ProviderError('unknown', `${status}:${detail}`),
}));

vi.mock('../src/cliRun', () => ({
  runCli: (...args: unknown[]) => runCliMock(...args),
  classifyCliError: () => undefined,
}));

vi.mock('../src/cliDetect', () => ({
  findBinary: (...args: unknown[]) => findBinaryMock(...args),
}));

const REQ: GenerateRequest = {
  systemPrompt: 'SYS',
  userPrompt: 'USER',
  model: 'model-x',
  effort: '',
  timeoutMs: 1000,
  signal: new AbortController().signal,
};

describe('provider generate/isAvailable', () => {
  beforeEach(() => {
    vi.resetModules();
    postJsonMock.mockReset();
    runCliMock.mockReset();
    findBinaryMock.mockReset();
  });

  it('openrouter: auth error without a key, available check reflects it', async () => {
    const { createOpenRouterProvider } = await import('../src/providers/openrouter');
    const provider = createOpenRouterProvider({
      getApiKey: async () => undefined,
      getConfig: () => ({ model: 'm', baseUrl: 'https://openrouter.ai/api/v1' }),
    });
    await expect(provider.isAvailable()).resolves.toBe(false);
    await expect(provider.generate(REQ)).rejects.toMatchObject({ kind: 'auth' });
    expect(postJsonMock).not.toHaveBeenCalled();
  });

  it('openrouter: posts to the chat completions endpoint with bearer auth', async () => {
    postJsonMock.mockResolvedValue({ choices: [{ message: { content: 'feat: x' } }] });
    const { createOpenRouterProvider } = await import('../src/providers/openrouter');
    const provider = createOpenRouterProvider({
      getApiKey: async () => 'KEY',
      getConfig: () => ({ model: 'm', baseUrl: 'https://openrouter.ai/api/v1/' }),
    });
    await expect(provider.isAvailable()).resolves.toBe(true);
    await expect(provider.generate(REQ)).resolves.toBe('feat: x');
    const [url, headers] = postJsonMock.mock.calls[0] as [string, Record<string, string>];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(headers.authorization).toBe('Bearer KEY');
  });

  it('anthropic-compatible: bearer preset posts to <baseUrl>/v1/messages', async () => {
    postJsonMock.mockResolvedValue({ content: [{ type: 'text', text: 'fix: y' }] });
    const { createAnthropicCompatibleProvider } = await import('../src/providers/anthropic');
    const provider = createAnthropicCompatibleProvider('kimi', 'Kimi', {
      getApiKey: async () => 'KEY',
      getConfig: () => ({
        baseUrl: 'https://api.moonshot.ai/anthropic',
        model: 'kimi-k2.6',
        auth: 'bearer',
      }),
    });
    await expect(provider.generate(REQ)).resolves.toBe('fix: y');
    const [url, headers] = postJsonMock.mock.calls[0] as [string, Record<string, string>];
    expect(url).toBe('https://api.moonshot.ai/anthropic/v1/messages');
    expect(headers.authorization).toBe('Bearer KEY');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('anthropic-compatible: x-api-key style sends the key header', async () => {
    postJsonMock.mockResolvedValue({ content: [{ type: 'text', text: 'docs: z' }] });
    const { createAnthropicCompatibleProvider } = await import('../src/providers/anthropic');
    const provider = createAnthropicCompatibleProvider('anthropicCustom', 'Custom', {
      getApiKey: async () => 'KEY',
      getConfig: () => ({ baseUrl: 'https://api.anthropic.com', model: 'm', auth: 'x-api-key' }),
    });
    await expect(provider.generate(REQ)).resolves.toBe('docs: z');
    const [, headers] = postJsonMock.mock.calls[0] as [string, Record<string, string>];
    expect(headers['x-api-key']).toBe('KEY');
    expect(headers.authorization).toBeUndefined();
  });

  it('claudeCli: unavailable without the binary, generate returns stdout', async () => {
    findBinaryMock.mockResolvedValue(null);
    const { createClaudeCliProvider } = await import('../src/providers/claudeCli');
    const provider = createClaudeCliProvider({ getConfig: () => ({ model: '', effort: 'low' }) });
    await expect(provider.isAvailable()).resolves.toBe(false);
    await expect(provider.generate(REQ)).rejects.toMatchObject({ kind: 'cli' });
    expect(runCliMock).not.toHaveBeenCalled();
  });

  it('claudeCli: runs the binary and returns stdout', async () => {
    vi.resetModules();
    findBinaryMock.mockResolvedValue('/fake/claude');
    runCliMock.mockResolvedValue({
      code: 0,
      stdout: 'feat: z\n',
      stderr: '',
      timedOut: false,
      cancelled: false,
    });
    const { createClaudeCliProvider } = await import('../src/providers/claudeCli');
    const provider = createClaudeCliProvider({
      getConfig: () => ({ model: 'sonnet', effort: 'low' }),
    });
    await expect(provider.isAvailable()).resolves.toBe(true);
    await expect(provider.generate(REQ)).resolves.toBe('feat: z\n');
    const call = runCliMock.mock.calls[0]?.[0] as { bin: string; args: string[]; stdin: string };
    expect(call.bin).toBe('/fake/claude');
    expect(call.args).toContain('--model');
    expect(call.stdin).toContain('SYS');
    expect(call.stdin).toContain('USER');
  });

  it('claudeCli: non-zero exit never leaks raw stderr into the error', async () => {
    vi.resetModules();
    findBinaryMock.mockResolvedValue('/fake/claude');
    const secret = 'sk-ant-api03-0123456789abcdef';
    runCliMock.mockResolvedValue({
      code: 1,
      stdout: '',
      stderr: `boom ${secret}`,
      timedOut: false,
      cancelled: false,
    });
    const { createClaudeCliProvider } = await import('../src/providers/claudeCli');
    const provider = createClaudeCliProvider({ getConfig: () => ({ model: '', effort: '' }) });
    const err = await provider.generate(REQ).catch((e: unknown) => e);
    // vi.resetModules() breaks cross-registry instanceof; assert structurally.
    expect((err as Error).name).toBe('ProviderError');
    expect((err as ProviderError).kind).toBe('cli');
    expect((err as ProviderError).message).not.toContain(secret);
    expect((err as ProviderError).message).toContain('code 1');
  });

  it('codexCli: falls back to stdout when the output file is missing', async () => {
    findBinaryMock.mockResolvedValue('/fake/codex');
    runCliMock.mockResolvedValue({
      code: 0,
      stdout: 'fix: from stdout',
      stderr: '',
      timedOut: false,
      cancelled: false,
    });
    const { createCodexCliProvider } = await import('../src/providers/codexCli');
    const provider = createCodexCliProvider({ getConfig: () => ({ model: '', effort: 'low' }) });
    await expect(provider.generate(REQ)).resolves.toBe('fix: from stdout');
    const call = runCliMock.mock.calls[0]?.[0] as { args: string[] };
    expect(call.args).toContain('approval_policy="never"');
  });

  it('codexCli: maps cancellation', async () => {
    findBinaryMock.mockResolvedValue('/fake/codex');
    runCliMock.mockResolvedValue({
      code: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      cancelled: true,
    });
    const { createCodexCliProvider } = await import('../src/providers/codexCli');
    const provider = createCodexCliProvider({ getConfig: () => ({ model: '', effort: '' }) });
    await expect(provider.generate(REQ)).rejects.toMatchObject({ kind: 'cancelled' });
  });
});
