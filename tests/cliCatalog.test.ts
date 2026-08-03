import { describe, expect, it } from 'vitest';
import {
  CODEX_EFFORT_FALLBACK,
  CodexCliCatalog,
  orderEffortLevels,
  parseCodexModelCatalog,
} from '../src/cliCatalog';

const CATALOG_FIXTURE = {
  models: [
    {
      slug: 'gpt-5.6-sol',
      visibility: 'list',
      supported_reasoning_levels: [
        { effort: 'low' },
        { effort: 'medium' },
        { effort: 'high' },
        { effort: 'xhigh' },
        { effort: 'max' },
        { effort: 'ultra' },
      ],
    },
    {
      slug: 'gpt-5.6-luna',
      visibility: 'list',
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }],
    },
    {
      slug: 'gpt-5.6-hidden',
      visibility: 'hide',
      supported_reasoning_levels: [{ effort: 'low' }],
    },
    {
      slug: 'gpt-5.4',
      visibility: 'list',
      supported_reasoning_levels: [{ effort: 'high' }, { effort: 'low' }],
    },
  ],
};

describe('orderEffortLevels', () => {
  it('orders by the canonical sequence, unknown levels last alphabetically', () => {
    expect(orderEffortLevels(['ultra', 'low', 'max'])).toEqual(['low', 'max', 'ultra']);
    expect(orderEffortLevels(['zzz', 'high', 'aaa'])).toEqual(['high', 'aaa', 'zzz']);
    expect(orderEffortLevels([])).toEqual([]);
  });
});

describe('parseCodexModelCatalog', () => {
  it('keeps only visibility "list" entries, in catalog order', () => {
    const snap = parseCodexModelCatalog(CATALOG_FIXTURE);
    expect(snap.models).toEqual(['gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.4']);
  });

  it('maps effort levels per model in canonical order', () => {
    const snap = parseCodexModelCatalog(CATALOG_FIXTURE);
    expect(snap.effortsByModel['gpt-5.4']).toEqual(['low', 'high']);
    expect(snap.effortsByModel['gpt-5.6-sol']).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra',
    ]);
  });

  it('exposes the first listed model levels as the default', () => {
    const snap = parseCodexModelCatalog(CATALOG_FIXTURE);
    expect(snap.defaultEfforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  });

  it('dedupes repeated slugs keeping the first occurrence', () => {
    const snap = parseCodexModelCatalog({
      models: [
        { slug: 'a', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }] },
        { slug: 'a', visibility: 'list', supported_reasoning_levels: [{ effort: 'max' }] },
      ],
    });
    expect(snap.models).toEqual(['a']);
    expect(snap.effortsByModel.a).toEqual(['low']);
  });

  it('tolerates garbage: non-object roots, missing fields, bad level entries', () => {
    expect(parseCodexModelCatalog(null).models).toEqual([]);
    expect(parseCodexModelCatalog({ models: 'nope' }).models).toEqual([]);
    const snap = parseCodexModelCatalog({
      models: [
        'string-entry',
        null,
        { visibility: 'list' },
        { slug: '', visibility: 'list' },
        { slug: 42, visibility: 'list' },
        {
          slug: 'ok',
          visibility: 'list',
          supported_reasoning_levels: [
            'low',
            null,
            { effort: 7 },
            { effort: '' },
            { effort: 'high' },
          ],
        },
      ],
    });
    expect(snap.models).toEqual(['ok']);
    expect(snap.effortsByModel.ok).toEqual(['high']);
  });

  it('returns empty defaultEfforts when no model lists levels', () => {
    const snap = parseCodexModelCatalog({
      models: [{ slug: 'a', visibility: 'list', supported_reasoning_levels: [] }],
    });
    expect(snap.defaultEfforts).toEqual([]);
  });
});

interface TestDeps {
  findBinaryPath: () => Promise<string | null>;
  run: (
    bin: string,
    args: readonly string[],
    opts: { timeoutMs: number; signal: AbortSignal },
  ) => Promise<{ code: number | null; stdout: string }>;
  now: () => number;
  advance: (ms: number) => void;
  timeoutMs: number;
  signal: AbortSignal;
}

function depsWith(overrides: Partial<TestDeps>): TestDeps {
  let now = 1000;
  return {
    findBinaryPath: async () => '/usr/local/bin/codex',
    run: async () => ({ code: 0, stdout: JSON.stringify(CATALOG_FIXTURE) }),
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    timeoutMs: 5000,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('CodexCliCatalog', () => {
  it('starts empty and falls back to the static effort list', () => {
    const catalog = new CodexCliCatalog(depsWith({}));
    expect(catalog.snapshot()).toBeUndefined();
    expect(catalog.effortsFor('anything')).toEqual(CODEX_EFFORT_FALLBACK);
  });

  it('refresh populates models and per-model efforts', async () => {
    const catalog = new CodexCliCatalog(depsWith({}));
    expect(await catalog.refresh()).toBe(true);
    expect(catalog.snapshot()?.models).toEqual(['gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.4']);
    expect(catalog.effortsFor('gpt-5.4')).toEqual(['low', 'high']);
    expect(catalog.effortsFor('unknown-model')).toEqual(catalog.snapshot()?.defaultEfforts);
    expect(catalog.effortsFor('')).toEqual(catalog.snapshot()?.defaultEfforts);
  });

  it('skips refetch inside the TTL window unless forced', async () => {
    let calls = 0;
    const deps = depsWith({
      run: async () => {
        calls += 1;
        return { code: 0, stdout: JSON.stringify(CATALOG_FIXTURE) };
      },
    });
    const catalog = new CodexCliCatalog(deps);
    await catalog.refresh();
    expect(await catalog.refresh()).toBe(false);
    expect(calls).toBe(1);
    expect(await catalog.refresh(true)).toBe(true);
    expect(calls).toBe(2);
  });

  it('refetches after the TTL expires', async () => {
    let calls = 0;
    const deps = depsWith({
      run: async () => {
        calls += 1;
        return { code: 0, stdout: JSON.stringify(CATALOG_FIXTURE) };
      },
    });
    const catalog = new CodexCliCatalog(deps);
    await catalog.refresh();
    deps.advance(60 * 60 * 1000 + 1);
    expect(await catalog.refresh()).toBe(true);
    expect(calls).toBe(2);
  });

  it('keeps the previous cache when the CLI is missing, fails or returns garbage', async () => {
    const deps = depsWith({});
    const catalog = new CodexCliCatalog(deps);
    await catalog.refresh();
    const before = catalog.snapshot();

    deps.findBinaryPath = async () => null;
    deps.advance(60 * 60 * 1000 + 1);
    expect(await catalog.refresh(true)).toBe(false);
    expect(catalog.snapshot()).toBe(before);

    deps.findBinaryPath = async () => '/usr/local/bin/codex';
    deps.run = async () => ({ code: 1, stdout: 'boom' });
    expect(await catalog.refresh(true)).toBe(false);
    expect(catalog.snapshot()).toBe(before);

    deps.run = async () => ({ code: 0, stdout: 'not json' });
    expect(await catalog.refresh(true)).toBe(false);
    expect(catalog.snapshot()).toBe(before);

    deps.run = async () => ({ code: 0, stdout: '{"models":[]}' });
    expect(await catalog.refresh(true)).toBe(false);
    expect(catalog.snapshot()).toBe(before);
  });

  it('passes the debug models args and timeout to the runner', async () => {
    const seen: { bin?: string; args?: readonly string[]; timeoutMs?: number } = {};
    const deps = depsWith({
      run: async (bin, args, opts) => {
        seen.bin = bin;
        seen.args = args;
        seen.timeoutMs = opts.timeoutMs;
        return { code: 0, stdout: JSON.stringify(CATALOG_FIXTURE) };
      },
    });
    const catalog = new CodexCliCatalog(deps);
    await catalog.refresh();
    expect(seen.bin).toBe('/usr/local/bin/codex');
    expect(seen.args).toEqual(['debug', 'models']);
    expect(seen.timeoutMs).toBe(5000);
  });
});
