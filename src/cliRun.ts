import { spawn } from 'node:child_process';
import { ProviderError } from './types';

export interface CliResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
}

export interface RunCliOptions {
  readonly bin: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly cwd?: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly envRemove?: readonly string[];
}

const MAX_STDOUT_CHARS = 2_000_000;
const MAX_STDERR_CHARS = 200_000;

/**
 * Runs a CLI with the prompt on stdin. Cancellation and timeout terminate the
 * child (SIGTERM, then SIGKILL after a grace period).
 */
export async function runCli(opts: RunCliOptions): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const key of opts.envRemove ?? []) delete env[key];
    const child = spawn(opts.bin, [...opts.args], {
      cwd: opts.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const forceKill = (): void => {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
    };
    const terminate = (): void => {
      try {
        child.kill('SIGTERM');
      } catch {
        // already gone
      }
      setTimeout(forceKill, 2000).unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, opts.timeoutMs);
    const onAbort = (): void => {
      cancelled = true;
      terminate();
    };
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });

    const finish = (done: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal.removeEventListener('abort', onAbort);
      done();
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > MAX_STDOUT_CHARS) stdout = stdout.slice(-MAX_STDOUT_CHARS / 2);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > MAX_STDERR_CHARS) stderr = stderr.slice(-MAX_STDERR_CHARS / 2);
    });
    child.on('error', (err) => {
      finish(() =>
        reject(new ProviderError('cli', `Failed to start "${opts.bin}": ${err.message}`)),
      );
    });
    child.on('close', (code) => {
      finish(() => resolve({ code, stdout, stderr, timedOut, cancelled }));
    });
    child.stdin.on('error', () => {
      // EPIPE: the child exited before consuming the prompt; handled by close.
    });
    child.stdin.write(opts.stdin, 'utf8');
    child.stdin.end();
  });
}

/** Collapses stderr into a single redacted line for the metadata-only log. */
export function sanitizeCliErrorOutput(text: string, maxLen = 400): string {
  const redacted = text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/((?:Bearer|x-api-key)\s*:?\s*)[A-Za-z0-9_.-]{8,}/gi, '$1[redacted]')
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[redacted]');
  const oneLine = redacted
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' | ');
  return oneLine.length > maxLen ? `${oneLine.slice(0, maxLen)}...` : oneLine;
}
