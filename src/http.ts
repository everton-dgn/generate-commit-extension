import { ProviderError } from './types';

export interface HttpOptions {
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

const MAX_ERROR_BODY_CHARS = 500;

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

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as {
        error?: { message?: unknown; type?: unknown; code?: unknown };
        message?: unknown;
      };
      const message = json.error?.message ?? json.message;
      if (typeof message === 'string' && message.trim())
        return message.slice(0, MAX_ERROR_BODY_CHARS);
      if (typeof json.error?.type === 'string') return json.error.type;
    } catch {
      // not JSON: fall through to the clipped body
    }
    return text.slice(0, MAX_ERROR_BODY_CHARS).trim();
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
  const timeout = AbortSignal.timeout(opts.timeoutMs);
  const signal = AbortSignal.any([opts.signal, timeout]);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (opts.signal.aborted) throw new ProviderError('cancelled', 'Request cancelled');
    if (timeout.aborted) {
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
  }
  if (!res.ok) {
    const detail = await readErrorDetail(res);
    throw mapHttpError(res.status, detail, res.headers.get('retry-after'));
  }
  return res.json();
}
