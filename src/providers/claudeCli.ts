import { findBinary } from '../cliDetect';
import { classifyCliError, runCli } from '../cliRun';
import { type GenerateRequest, type Provider, ProviderError } from '../types';

export interface ClaudeCliConfig {
  readonly model: string;
  readonly effort: string;
  readonly disableThinking: boolean;
}

/**
 * Flags verificadas contra `claude --help` (Claude Code 2.1.220) em 2026-08-02:
 * -p, --tools "", --model, --effort, --output-format, --no-session-persistence.
 * Não existe flag --fast nesta versão (o modo fast é exclusivo do modo interativo).
 * Thinking desligado via MAX_THINKING_TOKENS=0 (env documentada do Claude Code;
 * smoke test em 2026-08-02).
 */
export function buildClaudeArgs(cfg: ClaudeCliConfig): string[] {
  const args = ['-p', '--tools', '', '--output-format', 'text', '--no-session-persistence'];
  const model = cfg.model.trim();
  if (model) args.push('--model', model);
  // Com thinking desligado, --effort é irrelevante (não há blocos de raciocínio).
  const effort = cfg.disableThinking ? '' : cfg.effort.trim();
  if (effort) args.push('--effort', effort);
  return args;
}

export interface ClaudeCliDeps {
  readonly getConfig: () => ClaudeCliConfig;
  readonly findBinaryPath?: () => Promise<string | null>;
  readonly log?: (line: string) => void;
}

// Cache com escopo de sessão: createProviders recria as instâncias a cada
// comando, então o caminho resolvido do binário precisa viver no escopo do
// módulo para evitar nova detecção.
let cachedClaudePath: string | null | undefined;

export function createClaudeCliProvider(deps: ClaudeCliDeps): Provider {
  const resolvePath = async (): Promise<string | null> => {
    if (cachedClaudePath === undefined) {
      cachedClaudePath = await (deps.findBinaryPath ?? (() => findBinary('claude')))();
    }
    return cachedClaudePath;
  };
  return {
    id: 'claudeCli',
    label: 'Claude Code CLI',
    kind: 'cli',
    isAvailable: async () => (await resolvePath()) !== null,
    generate: async (req: GenerateRequest) => {
      const bin = await resolvePath();
      if (!bin) {
        throw new ProviderError(
          'cli',
          'Claude Code CLI ("claude") not found on PATH',
          'Install it or switch provider',
        );
      }
      const cfg = deps.getConfig();
      const result = await runCli({
        bin,
        args: buildClaudeArgs(cfg),
        stdin: `${req.systemPrompt}\n\n${req.userPrompt}`,
        cwd: req.cwd,
        timeoutMs: req.timeoutMs,
        signal: req.signal,
        envRemove: ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'],
        env: cfg.disableThinking ? { MAX_THINKING_TOKENS: '0' } : undefined,
      });
      if (result.cancelled) throw new ProviderError('cancelled', 'Cancelled');
      if (result.timedOut) {
        throw new ProviderError(
          'timeout',
          `claude timed out after ${Math.round(req.timeoutMs / 1000)}s`,
          'Increase generateCommit.timeoutSeconds',
        );
      }
      if (result.code !== 0) {
        const label = classifyCliError(result.stderr);
        deps.log?.(`claude failed: code=${result.code ?? '?'}${label ? ` ${label}` : ''}`);
        throw new ProviderError(
          'cli',
          `claude exited with code ${result.code ?? '?'}${label ? `: ${label}` : ''}`,
          label === 'not logged in'
            ? 'Authenticate the Claude Code CLI or switch provider'
            : undefined,
        );
      }
      if (!result.stdout.trim()) {
        throw new ProviderError('invalidResponse', 'claude returned an empty response');
      }
      return result.stdout;
    },
  };
}
