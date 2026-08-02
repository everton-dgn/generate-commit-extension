import { describe, expect, it } from 'vitest';
import { candidatePaths, type ExecFn, findBinary, parseWhichOutput } from '../src/cliDetect';

describe('parseWhichOutput', () => {
  it('returns the first absolute path', () => {
    expect(parseWhichOutput('/opt/homebrew/bin/claude\n')).toBe('/opt/homebrew/bin/claude');
    expect(parseWhichOutput('noise\n/usr/local/bin/codex\nmore')).toBe('/usr/local/bin/codex');
  });

  it('returns null when there is no path', () => {
    expect(parseWhichOutput('not found')).toBeNull();
    expect(parseWhichOutput('')).toBeNull();
  });
});

describe('candidatePaths', () => {
  it('covers package-manager locations under home and system dirs', () => {
    const paths = candidatePaths('claude', '/home/u');
    expect(paths).toContain('/opt/homebrew/bin/claude');
    expect(paths).toContain('/usr/local/bin/claude');
    expect(paths).toContain('/home/u/.local/bin/claude');
  });

  it('honors extra dirs first', () => {
    const paths = candidatePaths('codex', '/home/u', ['/custom/bin']);
    expect(paths[0]).toBe('/custom/bin/codex');
  });
});

describe('findBinary', () => {
  const execReturns = (script: Record<string, { code: number; stdout: string }>): ExecFn => {
    return async (_file, args) => {
      const command = args.join(' ');
      for (const [match, result] of Object.entries(script)) {
        if (command.includes(match)) return { ...result, stderr: '' };
      }
      return { code: 1, stdout: '', stderr: '' };
    };
  };

  it('short-circuits when the binary is on PATH', async () => {
    let calls = 0;
    const exec: ExecFn = async () => {
      calls += 1;
      return { code: 0, stdout: '/usr/bin/claude\n', stderr: '' };
    };
    const found = await findBinary('claude', { exec, isExecutable: async () => false });
    expect(found).toBe('/usr/bin/claude');
    expect(calls).toBe(1);
  });

  it('falls back to the login shell (GUI PATH on macOS)', async () => {
    const exec = execReturns({ '-lic': { code: 0, stdout: '/opt/homebrew/bin/claude\n' } });
    const found = await findBinary('claude', { exec, isExecutable: async () => false });
    expect(found).toBe('/opt/homebrew/bin/claude');
  });

  it('falls back to common absolute paths', async () => {
    const exec: ExecFn = async () => ({ code: 1, stdout: '', stderr: '' });
    const found = await findBinary('codex', {
      exec,
      isExecutable: async (path) => path === '/opt/homebrew/bin/codex',
    });
    expect(found).toBe('/opt/homebrew/bin/codex');
  });

  it('returns null when nothing is found', async () => {
    const exec: ExecFn = async () => ({ code: 1, stdout: '', stderr: '' });
    const found = await findBinary('nope', { exec, isExecutable: async () => false });
    expect(found).toBeNull();
  });

  it('survives exec failures (missing /bin/sh)', async () => {
    const exec: ExecFn = async () => {
      throw new Error('spawn failed');
    };
    const found = await findBinary('claude', {
      exec,
      isExecutable: async (path) => path.endsWith('/.local/bin/claude'),
      home: '/home/u',
    });
    expect(found).toBe('/home/u/.local/bin/claude');
  });
});
