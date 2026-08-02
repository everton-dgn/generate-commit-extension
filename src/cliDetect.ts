import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';

export interface ExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type ExecFn = (
  file: string,
  args: readonly string[],
  opts: { readonly timeoutMs: number },
) => Promise<ExecResult>;

const defaultExec: ExecFn = (file, args, { timeoutMs }) =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === 'number'
            ? (error as unknown as { code: number }).code
            : error
              ? 1
              : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });

const defaultIsExecutable = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export interface FindBinaryDeps {
  readonly exec: ExecFn;
  readonly isExecutable: (path: string) => Promise<boolean>;
  readonly shell: string;
  readonly home: string;
  readonly extraDirs?: readonly string[];
}

/** Parses the output of `command -v <name>` into an absolute path, if any. */
export function parseWhichOutput(stdout: string): string | null {
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('/')) return trimmed;
  }
  return null;
}

/** Common install locations for CLI tools on macOS/Linux (GUI apps get a minimal PATH). */
export function candidatePaths(
  name: string,
  home: string,
  extraDirs: readonly string[] = [],
): string[] {
  const dirs = [
    ...extraDirs,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    `${home}/.local/bin`,
    `${home}/.bun/bin`,
    `${home}/.volta/bin`,
    `${home}/.deno/bin`,
  ];
  return dirs.map((dir) => `${dir}/${name}`);
}

const PATH_LOOKUP_TIMEOUT_MS = 5000;
const LOGIN_SHELL_TIMEOUT_MS = 8000;

/**
 * Resolves a CLI binary: first via the inherited PATH, then via the user's
 * login shell (fixes GUI launches on macOS), then via common absolute paths.
 */
export async function findBinary(
  name: string,
  deps?: Partial<FindBinaryDeps>,
): Promise<string | null> {
  // Name is passed to a shell below; reject anything beyond a plain binary name.
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null;
  const d: FindBinaryDeps = {
    exec: defaultExec,
    isExecutable: defaultIsExecutable,
    shell: process.env.SHELL ?? '/bin/zsh',
    home: homedir(),
    ...deps,
  };
  try {
    const r = await d.exec('/bin/sh', ['-c', 'command -v "$1"', 'sh', name], {
      timeoutMs: PATH_LOOKUP_TIMEOUT_MS,
    });
    const path = parseWhichOutput(r.stdout);
    if (r.code === 0 && path) return path;
  } catch {
    // keep trying other strategies
  }
  try {
    const r = await d.exec(d.shell, ['-lic', 'command -v "$1"', 'sh', name], {
      timeoutMs: LOGIN_SHELL_TIMEOUT_MS,
    });
    const path = parseWhichOutput(r.stdout);
    if (r.code === 0 && path) return path;
  } catch {
    // keep trying other strategies
  }
  for (const path of candidatePaths(name, d.home, d.extraDirs ?? [])) {
    if (await d.isExecutable(path)) return path;
  }
  return null;
}
