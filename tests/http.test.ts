import { beforeEach, describe, expect, it, vi } from 'vitest';
import { postJson } from '../src/http';
import type { ProviderError } from '../src/types';

const OPTS = { timeoutMs: 200, signal: new AbortController().signal };

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('postJson', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses non-HTTPS URLs', async () => {
    await expect(postJson('http://example.com', {}, {}, OPTS)).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('parses a JSON 200 response', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(200, { ok: true }));
    await expect(postJson('https://x', {}, {}, OPTS)).resolves.toEqual({ ok: true });
  });

  it('maps a 200 with non-JSON body to invalidResponse', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>portal</html>', { status: 200 }));
    await expect(postJson('https://x', {}, {}, OPTS)).rejects.toMatchObject({
      kind: 'invalidResponse',
    });
  });

  it('maps 401 to auth and redacts secrets in the error body', async () => {
    const secret = 'sk-or-v1-0123456789abcdef';
    vi.stubGlobal('fetch', async () =>
      jsonResponse(401, { error: { message: `invalid key ${secret}` } }),
    );
    const err = await postJson('https://x', {}, {}, OPTS).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'auth' });
    expect((err as ProviderError).message).toContain('[redacted]');
    expect((err as ProviderError).message).not.toContain(secret);
  });

  it('maps 429 with retry-after to rateLimit with the hint', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(429, { error: {} }, { 'retry-after': '30' }));
    await expect(postJson('https://x', {}, {}, OPTS)).rejects.toMatchObject({
      kind: 'rateLimit',
    });
    const err = await postJson('https://x', {}, {}, OPTS).catch((e: unknown) => e);
    expect((err as ProviderError).message).toContain('retry after 30s');
  });

  it('maps 5xx to server', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(529, { error: { message: 'overloaded' } }));
    await expect(postJson('https://x', {}, {}, OPTS)).rejects.toMatchObject({ kind: 'server' });
  });

  it('maps network failures to network', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    await expect(postJson('https://x', {}, {}, OPTS)).rejects.toMatchObject({ kind: 'network' });
  });

  const hangingFetch = (_url: string, init: { signal: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      const aborted = () => reject(new DOMException('The operation was aborted', 'AbortError'));
      if (init.signal.aborted) {
        aborted();
        return;
      }
      init.signal.addEventListener('abort', aborted, { once: true });
    });

  it('times out when the response never settles', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    await expect(postJson('https://x', {}, {}, { ...OPTS, timeoutMs: 50 })).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('reports cancellation on a pre-aborted signal', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    const controller = new AbortController();
    controller.abort();
    await expect(
      postJson('https://x', {}, {}, { timeoutMs: 5000, signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'cancelled' });
  });
});
