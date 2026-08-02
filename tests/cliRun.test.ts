import { describe, expect, it } from 'vitest';
import { sanitizeCliErrorOutput } from '../src/cliRun';

describe('sanitizeCliErrorOutput', () => {
  it('redacts API keys and bearer tokens', () => {
    expect(sanitizeCliErrorOutput('auth failed for sk-ant-api03-0123456789abcdef')).toContain(
      '[redacted]',
    );
    expect(sanitizeCliErrorOutput('auth failed for sk-ant-api03-0123456789abcdef')).not.toContain(
      'sk-ant',
    );
    expect(sanitizeCliErrorOutput('Authorization: Bearer abcdef123456789')).not.toContain(
      'abcdef123456789',
    );
    expect(sanitizeCliErrorOutput('aws AKIAIOSFODNN7EXAMPLE rejected')).not.toContain(
      'AKIAIOSFODNN7EXAMPLE',
    );
  });

  it('collapses multi-line stderr into one line', () => {
    const out = sanitizeCliErrorOutput('line one\n\n  line two  \nline three');
    expect(out).toBe('line one | line two | line three');
  });

  it('caps the output length', () => {
    const out = sanitizeCliErrorOutput('x'.repeat(1000), 100);
    expect(out.length).toBeLessThanOrEqual(103);
  });
});
