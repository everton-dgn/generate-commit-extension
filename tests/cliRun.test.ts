import { describe, expect, it } from 'vitest';
import { classifyCliError, runCli } from '../src/cliRun';
import { ProviderError } from '../src/types';

describe('classifyCliError', () => {
  it('maps known error signatures to safe labels', () => {
    expect(classifyCliError('Error: not logged in, run claude auth login')).toBe('not logged in');
    expect(classifyCliError('Invalid API key provided')).toBe('authentication failed');
    expect(classifyCliError('Rate limit reached, try again later')).toBe('rate limited');
    expect(classifyCliError('model gpt-x not found')).toBe('model or parameter not supported');
  });

  it('returns undefined for unknown output instead of leaking it', () => {
    const secret = 'sk-ant-api03-0123456789abcdef';
    expect(classifyCliError(`random failure mentioning ${secret}`)).toBeUndefined();
  });
});

describe('runCli', () => {
  const opts = {
    bin: process.execPath,
    timeoutMs: 5000,
    signal: new AbortController().signal,
  };

  it('captures stdout and exit code', async () => {
    const result = await runCli({
      ...opts,
      args: [
        '-e',
        'process.stdin.resume(); let d=""; process.stdin.on("data", c => d += c).on("end", () => { console.log("got:" + d.trim()) })',
      ],
      stdin: 'hello',
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('got:hello');
    expect(result.cancelled).toBe(false);
    expect(result.timedOut).toBe(false);
  });

  it('delivers large stdin payloads intact (drain via end())', async () => {
    const payload = 'x'.repeat(2 * 1024 * 1024);
    const result = await runCli({
      ...opts,
      timeoutMs: 15000,
      args: [
        '-e',
        'let n=0; process.stdin.on("data", c => n += c.length).on("end", () => console.log("len:" + n))',
      ],
      stdin: payload,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`len:${payload.length}`);
  });

  it('kills the process on cancellation and reports cancelled', async () => {
    const controller = new AbortController();
    const pending = runCli({
      ...opts,
      signal: controller.signal,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      stdin: '',
    });
    setTimeout(() => controller.abort(), 100);
    const started = Date.now();
    const result = await pending;
    expect(result.cancelled).toBe(true);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it('kills the process on timeout and reports timedOut', async () => {
    const result = await runCli({
      ...opts,
      timeoutMs: 200,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      stdin: '',
    });
    expect(result.timedOut).toBe(true);
  });

  it('rejects with a cli ProviderError when the binary does not exist', async () => {
    await expect(
      runCli({ ...opts, bin: '/nonexistent/binary-xyz', args: [], stdin: '' }),
    ).rejects.toBeInstanceOf(ProviderError);
    await expect(
      runCli({ ...opts, bin: '/nonexistent/binary-xyz', args: [], stdin: '' }),
    ).rejects.toMatchObject({ kind: 'cli' });
  });

  it('merges extra env vars and honors envRemove', async () => {
    const result = await runCli({
      ...opts,
      args: ['-e', 'console.log(process.env.GC_TEST_SET + "|" + process.env.GC_TEST_REMOVED)'],
      stdin: '',
      env: { GC_TEST_SET: 'yes', GC_TEST_REMOVED: 'present' },
      envRemove: ['GC_TEST_REMOVED'],
    });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('yes|undefined');
  });
});
