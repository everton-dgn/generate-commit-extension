import { redactSecrets } from './secretsScan';
import { ProviderError } from './types';

export interface HttpOptions {
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

const MAX_ERROR_BODY_CHARS = 300;

/** Maps HTTP status codes to distinct, actionable provider errors. */
export function mapHttpError(
  status: number,
  detail: string,
  retryAfter: string | null,
): ProviderError {
  const suffix = detail ? `: ${detail}` : '';
  switch (status) {
    case 400:
      return new ProviderError('invalidResponse', `Provider rejected the request (400)${suffix}`);
    case 401:
    case 403:
      return new ProviderError(
        'auth',
        `Authentication failed (${status})${suffix}`,
        'Run "Generate Commit: Configure API Key" to update the key',
      );
    case 402:
      return new ProviderError(
        'billing',
        `Insufficient credits (402)${suffix}`,
        'Add credits to the provider account or switch provider',
      );
    case 408:
    case 504:
      return new ProviderError('timeout', `Provider timed out (${status})${suffix}`);
    case 413:
      return new ProviderError(
        'invalidResponse',
        `Request too large (413)${suffix}`,
        'Reduce generateCommit.maxDiffChars',
      );
    case 429:
      return new ProviderError(
        'rateLimit',
        `Rate limited (429)${retryAfter ? `, retry after ${retryAfter}s` : ''}${suffix}`,
        'Wait and try again, or switch provider',
      );
    default:
      if (status >= 500) {
        return new ProviderError(
          'server',
          `Provider error (${status})${suffix}`,
          'Try again later or switch provider',
        );
      }
      return new ProviderError('unknown', `Unexpected HTTP status ${status}${suffix}`);
  }
}

/**
 * Extracts a short, redacted detail from an error body. Anything matching the
 * known secret patterns is replaced before the text reaches UI or logs.
 */
async function readErrorDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    let detail = '';
    try {
      const json = JSON.parse(text) as {
        error?: { message?: unknown; type?: unknown };
        message?: unknown;
      };
      const message = json.error?.message ?? json.message;
      if (typeof message === 'string' && message.trim()) detail = message;
      else if (typeof json.error?.type === 'string') detail = json.error.type;
    } catch {
      detail = text.trim();
    }
    return redactSecrets(detail).slice(0, MAX_ERROR_BODY_CHARS);
  } catch {
    return '';
  }
}

/** POSTs JSON over HTTPS only, with timeout and external cancellation. */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  opts: HttpOptions,
): Promise<unknown> {
  if (!url.startsWith('https://')) {
    throw new ProviderError('network', `Refusing non-HTTPS URL: ${url}`);
  }
  return requestJson(url, { method: 'POST', headers, body }, opts);
}

/** GETs JSON over HTTPS only (model catalogs and similars). */
export async function getJson(
  url: string,
  headers: Record<string, string>,
  opts: HttpOptions,
): Promise<unknown> {
  if (!url.startsWith('https://')) {
    throw new ProviderError('network', `Refusing non-HTTPS URL: ${url}`);
  }
  return requestJson(url, { method: 'GET', headers }, opts);
}

interface RequestInit {
  readonly method: 'GET' | 'POST';
  readonly headers: Record<string, string>;
  readonly body?: unknown;
}

async function requestJson(url: string, init: RequestInit, opts: HttpOptions): Promise<unknown> {
  // Compose user cancellation and timeout manually instead of AbortSignal.any
  // (Node 20.3+), which older extension-host runtimes do not provide.
  const controller = new AbortController();
  let timedOut = false;
  const onUserAbort = (): void => controller.abort();
  if (opts.signal.aborted) controller.abort();
  else opts.signal.addEventListener('abort', onUserAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs);
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: { 'content-type': 'application/json', ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await readErrorDetail(res);
      throw mapHttpError(res.status, detail, res.headers.get('retry-after'));
    }
    try {
      return await res.json();
    } catch {
      throw new ProviderError(
        'invalidResponse',
        'Provider returned a non-JSON body',
        'Check the configured base URL',
      );
    }
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (opts.signal.aborted) throw new ProviderError('cancelled', 'Request cancelled');
    if (timedOut) {
      throw new ProviderError(
        'timeout',
        `Request timed out after ${Math.round(opts.timeoutMs / 1000)}s`,
        'Increase generateCommit.timeoutSeconds or try again',
      );
    }
    throw new ProviderError(
      'network',
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
      'Check your internet connection',
    );
  } finally {
    clearTimeout(timer);
    opts.signal.removeEventListener('abort', onUserAbort);
  }
}
