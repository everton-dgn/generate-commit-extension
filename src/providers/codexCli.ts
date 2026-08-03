import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findBinary } from '../cliDetect';
import { classifyCliError, runCli } from '../cliRun';
import { type GenerateRequest, type Provider, ProviderError } from '../types';

export interface CodexCliConfig {
  readonly model: string;
  readonly effort: string;
  readonly disableThinking: boolean;
}

/**
 * Flags verificadas contra `codex exec --help` (codex-cli 0.146.0) e a
 * referência oficial de configuração (`model_reasoning_effort`: none, low,
 * medium, high, xhigh, max, ultra — níveis variam por modelo, lidos ao vivo
 * de `codex debug models`) em 2026-08-02. Nota: a flag `-a/--ask-for-approval`
 * sumiu do `--help` entre duas leituras no mesmo dia e versão (superfície de
 * CLI dinâmica), então a política de aprovação é fixada via chave de configuração.
 * `none` desliga o raciocínio (aceito mesmo não constando nos níveis por
 * modelo do catálogo; smoke test em 2026-08-02).
 */
export function buildCodexArgs(cfg: CodexCliConfig, outputFile: string): string[] {
  const args = [
    'exec',
    '--color',
    'never',
    '--sandbox',
    'read-only',
    '--config',
    'approval_policy="never"',
    '--skip-git-repo-check',
    '--ephemeral',
    '--output-last-message',
    outputFile,
  ];
  const model = cfg.model.trim();
  if (model) args.push('--model', model);
  const effort = cfg.disableThinking ? 'none' : cfg.effort.trim();
  if (effort) args.push('--config', `model_reasoning_effort="${effort}"`);
  return args;
}

export interface CodexCliDeps {
  readonly getConfig: () => CodexCliConfig;
  readonly findBinaryPath?: () => Promise<string | null>;
  readonly log?: (line: string) => void;
}

// Cache com escopo de sessão: createProviders recria as instâncias a cada
// comando, então o caminho resolvido do binário precisa viver no escopo do
// módulo para evitar nova detecção.
let cachedCodexPath: string | null | undefined;

export function createCodexCliProvider(deps: CodexCliDeps): Provider {
  const resolvePath = async (): Promise<string | null> => {
    if (cachedCodexPath === undefined) {
      cachedCodexPath = await (deps.findBinaryPath ?? (() => findBinary('codex')))();
    }
    return cachedCodexPath;
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
          const label = classifyCliError(result.stderr);
          deps.log?.(`codex failed: code=${result.code ?? '?'}${label ? ` ${label}` : ''}`);
          throw new ProviderError(
            'cli',
            `codex exited with code ${result.code ?? '?'}${label ? `: ${label}` : ''}`,
            label === 'not logged in' ? 'Authenticate the Codex CLI or switch provider' : undefined,
          );
        }
        let text = '';
        try {
          text = await readFile(outputFile, 'utf8');
        } catch {
          // recorre ao stdout abaixo como fallback
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
