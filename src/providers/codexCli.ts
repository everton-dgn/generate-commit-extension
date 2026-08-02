import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findBinary } from '../cliDetect';
import { runCli, sanitizeCliErrorOutput } from '../cliRun';
import { type GenerateRequest, type Provider, ProviderError } from '../types';

export interface CodexCliConfig {
  readonly model: string;
  readonly effort: string;
}

/**
 * Flags verified against `codex exec --help` (codex-cli 0.146.0) and the
 * official config reference (`model_reasoning_effort`: minimal, low, medium,
 * high, xhigh) at 2026-08-02.
 */
export function buildCodexArgs(cfg: CodexCliConfig, outputFile: string): string[] {
  const args = [
    'exec',
    '--color',
    'never',
    '--sandbox',
    'read-only',
    '--ask-for-approval',
    'never',
    '--skip-git-repo-check',
    '--ephemeral',
    '--output-last-message',
    outputFile,
  ];
  const model = cfg.model.trim();
  if (model) args.push('--model', model);
  const effort = cfg.effort.trim();
  if (effort) args.push('--config', `model_reasoning_effort="${effort}"`);
  return args;
}

export interface CodexCliDeps {
  readonly getConfig: () => CodexCliConfig;
  readonly findBinaryPath?: () => Promise<string | null>;
  readonly log?: (line: string) => void;
}

export function createCodexCliProvider(deps: CodexCliDeps): Provider {
  let cachedPath: string | null | undefined;
  const resolvePath = (): Promise<string | null> => {
    if (cachedPath === undefined) {
      cachedPath = null;
      return (deps.findBinaryPath ?? (() => findBinary('codex')))().then((path) => {
        cachedPath = path;
        return path;
      });
    }
    return Promise.resolve(cachedPath);
  };
  return {
    id: 'codexCli',
    label: 'Codex CLI',
    kind: 'cli',
    isAvailable: async () => (await resolvePath()) !== null,
    generate: async (req: GenerateRequest) => {
      const bin = await resolvePath();
      if (!bin) {
        throw new ProviderError(
          'cli',
          'Codex CLI ("codex") not found on PATH',
          'Install it or switch provider',
        );
      }
      const dir = await mkdtemp(join(tmpdir(), 'generate-commit-'));
      const outputFile = join(dir, 'last-message.md');
      try {
        const result = await runCli({
          bin,
          args: buildCodexArgs(deps.getConfig(), outputFile),
          stdin: `${req.systemPrompt}\n\n${req.userPrompt}`,
          cwd: req.cwd,
          timeoutMs: req.timeoutMs,
          signal: req.signal,
        });
        if (result.cancelled) throw new ProviderError('cancelled', 'Cancelled');
        if (result.timedOut) {
          throw new ProviderError(
            'timeout',
            `codex timed out after ${Math.round(req.timeoutMs / 1000)}s`,
            'Increase generateCommit.timeoutSeconds',
          );
        }
        if (result.code !== 0) {
          const detail = sanitizeCliErrorOutput(result.stderr);
          if (detail) deps.log?.(`codex stderr: ${detail}`);
          throw new ProviderError(
            'cli',
            `codex exited with code ${result.code ?? '?'}${detail ? `: ${detail}` : ''}`,
          );
        }
        let text = '';
        try {
          text = await readFile(outputFile, 'utf8');
        } catch {
          // fall back to stdout below
        }
        if (!text.trim()) text = result.stdout;
        if (!text.trim()) {
          throw new ProviderError('invalidResponse', 'codex returned an empty response');
        }
        return text;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
