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
 * Executa uma CLI com o prompt no stdin. Cancelamento e timeout encerram o
 * grupo de processos inteiro (SIGTERM, depois SIGKILL após um período de
 * tolerância), para que subprocessos criados pela CLI não sobrevivam à
 * requisição.
 */
export async function runCli(opts: RunCliOptions): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const key of opts.envRemove ?? []) delete env[key];
    const detached = process.platform !== 'win32';
    const child = spawn(opts.bin, [...opts.args], {
      cwd: opts.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const kill = (signal: NodeJS.Signals): void => {
      try {
        if (detached && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // já terminou
        }
      }
    };
    const terminate = (): void => {
      kill('SIGTERM');
      setTimeout(() => kill('SIGKILL'), 2000).unref();
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
      // EPIPE: o filho saiu antes de consumir o prompt; tratado pelo close.
    });
    // end() enfileira o payload inteiro e deixa o stream drená-lo, então
    // prompts grandes são entregues sem tratamento manual de backpressure.
    child.stdin.end(opts.stdin, 'utf8');
  });
}

const KNOWN_CLI_ERRORS: readonly { pattern: RegExp; label: string }[] = [
  {
    pattern: /not logged in|please log in|login required|not authenticated/i,
    label: 'not logged in',
  },
  {
    pattern:
      /invalid (api )?key|incorrect api key|invalid x-api-key|authentication failed|unauthorized/i,
    label: 'authentication failed',
  },
  {
    pattern: /rate.?limit|usage limit|quota|too many requests|429/i,
    label: 'rate limited',
  },
  { pattern: /overloaded|capacity|503/i, label: 'provider overloaded' },
  {
    pattern: /model .*not found|unknown model|invalid model|does not exist|unsupported value/i,
    label: 'model or parameter not supported',
  },
  { pattern: /credit|billing|payment|insufficient/i, label: 'billing issue' },
];

/**
 * Mapeia o stderr bruto da CLI para um rótulo curto e seguro de uma lista
 * fechada. O stderr bruto nunca chega aos logs nem à UI: pode ecoar o prompt
 * (o diff) ou segredos.
 */
export function classifyCliError(stderr: string): string | undefined {
  for (const { pattern, label } of KNOWN_CLI_ERRORS) {
    if (pattern.test(stderr)) return label;
  }
  return undefined;
}
