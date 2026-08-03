import { describe, expect, it } from 'vitest';
import { filterFileDiffs, splitDiffByFile, truncateToLimit } from '../src/diffFilter';

function chunk(name: string, added: readonly string[]): string {
  return [
    `diff --git a/${name} b/${name}`,
    'index 1234567..89abcde 100644',
    `--- a/${name}`,
    `+++ b/${name}`,
    '@@ -1,1 +1,2 @@',
    ' context line',
    ...added.map((line) => `+${line}`),
  ].join('\n');
}

describe('splitDiffByFile', () => {
  it('splits a multi-file diff preserving order and names', () => {
    const diff = `${chunk('src/a.ts', ['const a = 1;'])}\n${chunk('src/b.ts', ['const b = 2;'])}`;
    const files = splitDiffByFile(diff);
    expect(files).toHaveLength(2);
    expect(files[0]?.fileName).toBe('src/a.ts');
    expect(files[1]?.fileName).toBe('src/b.ts');
    expect(files[0]?.chunk).toContain('const a = 1;');
    expect(files[1]?.chunk).not.toContain('const a = 1;');
  });

  it('handles quoted paths with spaces', () => {
    const diff = [
      'diff --git "a/foo bar.ts" "b/foo bar.ts"',
      'index 1234567..89abcde 100644',
      '--- "a/foo bar.ts"',
      '+++ "b/foo bar.ts"',
      '@@ -0,0 +1,1 @@',
      '+x',
    ].join('\n');
    const files = splitDiffByFile(diff);
    expect(files[0]?.fileName).toBe('foo bar.ts');
  });

  it('flags binary chunks', () => {
    const diff = [
      'diff --git a/logo.png b/logo.png',
      'index 1234567..89abcde 100644',
      'Binary files a/logo.png and b/logo.png differ',
    ].join('\n');
    expect(splitDiffByFile(diff)[0]?.binary).toBe(true);
  });
});

describe('filterFileDiffs', () => {
  const opts = { maxFileBytes: 1000 };

  it('drops lockfiles by basename', () => {
    const { kept, dropped } = filterFileDiffs(
      splitDiffByFile(chunk('web/pnpm-lock.yaml', ['x'])),
      opts,
    );
    expect(kept).toHaveLength(0);
    expect(dropped[0]).toEqual({ fileName: 'web/pnpm-lock.yaml', reason: 'lockfile' });
  });

  it('drops minified assets', () => {
    const { dropped } = filterFileDiffs(splitDiffByFile(chunk('dist/app.min.js', ['x'])), opts);
    expect(dropped[0]?.reason).toBe('minified');
  });

  it('drops binary chunks', () => {
    const diff = [
      'diff --git a/logo.png b/logo.png',
      'Binary files a/logo.png and b/logo.png differ',
    ].join('\n');
    const { dropped } = filterFileDiffs(splitDiffByFile(diff), opts);
    expect(dropped[0]?.reason).toBe('binary');
  });

  it('drops oversized chunks', () => {
    const big = chunk('src/big.ts', ['y'.repeat(2000)]);
    const { dropped } = filterFileDiffs(splitDiffByFile(big), opts);
    expect(dropped[0]?.reason).toBe('tooLarge');
  });

  it('measures the limit in bytes, not UTF-16 units', () => {
    // 4-byte emoji: the chunk is short in .length but exceeds the limit in bytes.
    const emoji = chunk('src/emoji.ts', [`const s = "${'😀'.repeat(400)}";`]);
    const files = splitDiffByFile(emoji);
    const chunkLength = files[0]?.chunk.length ?? 0;
    const byteLength = Buffer.byteLength(files[0]?.chunk ?? '', 'utf8');
    expect(byteLength).toBeGreaterThan(chunkLength);
    const { dropped } = filterFileDiffs(files, {
      maxFileBytes: chunkLength + Math.floor((byteLength - chunkLength) / 2),
    });
    expect(dropped[0]?.reason).toBe('tooLarge');
  });

  it('drops non-JS lockfiles too', () => {
    const { dropped } = filterFileDiffs(splitDiffByFile(chunk('api/composer.lock', ['x'])), opts);
    expect(dropped[0]?.reason).toBe('lockfile');
  });

  it('keeps the header name for deleted files (+++ /dev/null)', () => {
    const diff = [
      'diff --git a/src/gone.ts b/src/gone.ts',
      'index 1234567..0000000 100644',
      '--- a/src/gone.ts',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-const x = 1;',
    ].join('\n');
    expect(splitDiffByFile(diff)[0]?.fileName).toBe('src/gone.ts');
  });

  it('uses the post-image name for renames', () => {
    const diff = [
      'diff --git a/src/old.ts b/src/new.ts',
      'similarity index 90%',
      'rename from src/old.ts',
      'rename to src/new.ts',
      '--- a/src/old.ts',
      '+++ b/src/new.ts',
      '@@ -1,1 +1,1 @@',
      '-const a = 1;',
      '+const a = 2;',
    ].join('\n');
    expect(splitDiffByFile(diff)[0]?.fileName).toBe('src/new.ts');
  });

  it('keeps regular source files', () => {
    const { kept, dropped } = filterFileDiffs(
      splitDiffByFile(chunk('src/a.ts', ['const a = 1;'])),
      opts,
    );
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });
});

describe('truncateToLimit', () => {
  it('returns the full diff under the limit', () => {
    const files = splitDiffByFile(chunk('src/a.ts', ['x']));
    const result = truncateToLimit(files, 10_000);
    expect(result.truncated).toBe(false);
    expect(result.includedFiles).toBe(1);
  });

  it('cuts at file boundaries and reports counts', () => {
    const diff = `${chunk('src/a.ts', ['a'.repeat(400)])}\n${chunk('src/b.ts', ['b'.repeat(400)])}`;
    const files = splitDiffByFile(diff);
    const firstLength = files[0]?.chunk.length ?? 0;
    const result = truncateToLimit(files, firstLength + 10);
    expect(result.truncated).toBe(true);
    expect(result.includedFiles).toBe(1);
    expect(result.totalFiles).toBe(2);
    expect(result.diff).toContain('src/a.ts');
    expect(result.diff).not.toContain('src/b.ts');
    expect(result.diff).toContain('included 1 of 2 files');
  });

  it('hard-slices when even the first chunk exceeds the limit', () => {
    const files = splitDiffByFile(chunk('src/a.ts', ['a'.repeat(500)]));
    const result = truncateToLimit(files, 100);
    expect(result.truncated).toBe(true);
    expect(result.includedFiles).toBe(1);
    expect(result.diff.length).toBeLessThan(200);
  });
});
