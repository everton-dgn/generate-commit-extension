import { describe, expect, it } from 'vitest';
import { splitDiffByFile } from '../src/diffFilter';
import { type SecretType, scanDiff } from '../src/secretsScan';

function diffWith(fileName: string, lines: readonly string[]): string {
  return [
    `diff --git a/${fileName} b/${fileName}`,
    'index 1234567..89abcde 100644',
    `--- a/${fileName}`,
    `+++ b/${fileName}`,
    '@@ -0,0 +1,N @@',
    ...lines.map((line) => `+${line}`),
  ].join('\n');
}

function scan(fileName: string, lines: readonly string[]): SecretType[] {
  return scanDiff(splitDiffByFile(diffWith(fileName, lines))).map((finding) => finding.type);
}

describe('scanDiff positives', () => {
  const cases: readonly { name: string; line: string; type: SecretType }[] = [
    {
      name: 'openrouter key',
      line: 'const k = "sk-or-v1-0123456789abcdef"',
      type: 'openrouter-key',
    },
    {
      name: 'anthropic key',
      line: 'const k = "sk-ant-api03-0123456789abcdef"',
      type: 'anthropic-key',
    },
    {
      name: 'generic sk key',
      line: 'const k = "sk-proj-0123456789abcdefghij"',
      type: 'api-key-sk',
    },
    { name: 'github pat', line: 'token = ghp_0123456789abcdefghijklmn', type: 'github-token' },
    { name: 'github fine-grained', line: `t = github_pat_${'A'.repeat(30)}`, type: 'github-token' },
    { name: 'aws access key', line: 'aws: AKIAIOSFODNN7EXAMPLE', type: 'aws-access-key' },
    { name: 'slack token', line: 'xoxb-1234567890-abcdefghijkl', type: 'slack-token' },
    { name: 'gcp key', line: `key = "AIza${'A'.repeat(35)}"`, type: 'gcp-api-key' },
    {
      name: 'jwt',
      line: `Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.${'a'.repeat(12)}.${'b'.repeat(12)}`,
      type: 'jwt',
    },
    { name: 'pem openssh', line: '-----BEGIN OPENSSH PRIVATE KEY-----', type: 'private-key' },
    { name: 'pem rsa', line: '-----BEGIN RSA PRIVATE KEY-----', type: 'private-key' },
    {
      name: 'url credentials',
      line: 'const url = "https://user:supersecret@db.internal/app"',
      type: 'url-credentials',
    },
  ];

  for (const { name, line, type } of cases) {
    it(`detects ${name}`, () => {
      expect(scan('src/config.ts', [line])).toContain(type);
    });
  }

  it('detects .env files by name', () => {
    expect(scan('.env', ['FOO=bar'])).toContain('env-file');
    expect(scan('config/.env.production', ['FOO=bar'])).toContain('env-file');
  });

  it('detects keystore bundles by name', () => {
    expect(scan('certs/server.p12', ['binary'])).toContain('keystore-file');
    expect(scan('certs/app.jks', ['binary'])).toContain('keystore-file');
  });

  it('attributes findings to the right file in multi-file diffs', () => {
    const diff = `${diffWith('src/a.ts', ['const k = "sk-or-v1-0123456789abcdef"'])}\n${diffWith('src/b.ts', ['const x = 1'])}`;
    const findings = scanDiff(splitDiffByFile(diff));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.fileName).toBe('src/a.ts');
  });

  it('dedupes repeated findings of the same type per file', () => {
    const findings = scanDiff(
      splitDiffByFile(diffWith('a.ts', ['AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLF'])),
    );
    expect(findings).toHaveLength(1);
  });

  it('does not double-flag sk-or- or sk-ant- as generic sk- keys', () => {
    expect(scan('a.ts', ['k = "sk-or-v1-0123456789abcdef"'])).toEqual(['openrouter-key']);
    expect(scan('a.ts', ['k = "sk-ant-api03-0123456789abcdef"'])).toEqual(['anthropic-key']);
  });

  it('never includes the secret value in findings', () => {
    const secret = 'sk-or-v1-0123456789abcdef';
    const findings = scanDiff(splitDiffByFile(diffWith('a.ts', [`key = "${secret}"`])));
    expect(JSON.stringify(findings)).not.toContain(secret);
  });
});

describe('scanDiff negatives', () => {
  const cleanLines: readonly string[] = [
    'const apiKey = process.env.API_KEY',
    'sk-short',
    'const url = "https://example.com/path"',
    'git remote: git@github.com:org/repo.git',
    '-----BEGIN PUBLIC KEY-----',
    'eyJhbGciOiJIUzI1NiJ9 (a prefix without full JWT shape)',
    'export function render() { return null }',
  ];

  it('flags nothing in ordinary source changes', () => {
    expect(scan('src/app.ts', cleanLines)).toHaveLength(0);
  });
});

describe('redactSecrets', () => {
  it('redacts every known pattern and leaves ordinary text alone', async () => {
    const { redactSecrets } = await import('../src/secretsScan');
    const out = redactSecrets(
      'keys: sk-or-v1-0123456789abcdef and AKIAIOSFODNN7EXAMPLE and ghp_0123456789abcdefghijklmn',
    );
    expect(out).not.toContain('sk-or-v1');
    expect(out).not.toContain('AKIA');
    expect(out).not.toContain('ghp_');
    expect(out.match(/\[redacted\]/g)).toHaveLength(3);
    expect(redactSecrets('plain log line')).toBe('plain log line');
  });
});
