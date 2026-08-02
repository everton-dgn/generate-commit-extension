import * as vscode from 'vscode';
import { type AppConfig, readAppConfig, readProviderConfig } from './config';
import { filterFileDiffs, splitDiffByFile, truncateToLimit } from './diffFilter';
import {
  getGitApi,
  getRecentCommitSubjects,
  getStagedDiff,
  getUnstagedDiff,
  resolveRepository,
} from './git';
import { logMeta } from './log';
import { buildSystemPrompt, buildUserPrompt, parseModelOutput } from './prompt';
import { providerMeta, resolveProviderChoice } from './providers/registry';
import { collectAvailability, createProviders } from './providersRuntime';
import { type Finding, SECRET_TYPE_LABELS, scanDiff } from './secretsScan';
import { SETTINGS_VIEW_ID } from './settingsPanel';
import { type GenerateRequest, ProviderError } from './types';
import type { Repository } from './typings/git';

export function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('generateCommit.generate', (arg?: unknown) =>
      generateCommand(context, arg),
    ),
    vscode.commands.registerCommand('generateCommit.settings', () =>
      vscode.commands.executeCommand(`${SETTINGS_VIEW_ID}.focus`),
    ),
  );
}

/** Direciona o usuário para o painel de configurações (barra lateral). */
async function openSettingsPanel(): Promise<void> {
  await vscode.commands.executeCommand(`${SETTINGS_VIEW_ID}.focus`);
}

/**
 * Uma geração por repositório: iniciar uma nova aborta a anterior e
 * somente a execução mais recente pode escrever na input box (respostas
 * lentas de execuções antigas são descartadas).
 */
const activeGenerations = new Map<string, { id: number; controller: AbortController }>();
let generationSeq = 0;

interface ResolvedDiff {
  readonly text: string;
  readonly staged: boolean;
}

async function resolveDiff(repo: Repository, cfg: AppConfig): Promise<ResolvedDiff | undefined> {
  let staged = '';
  try {
    staged = await getStagedDiff(repo);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Generate Commit: failed to read the staged diff (${err instanceof Error ? err.message : String(err)}). An initial commit is required in this repository.`,
    );
    return undefined;
  }
  if (staged.trim()) return { text: staged, staged: true };
  if (cfg.unstagedFallback === 'never') {
    void vscode.window.showInformationMessage(
      'Generate Commit: no staged changes. Stage your changes first (or adjust generateCommit.unstagedFallback).',
    );
    return undefined;
  }
  if (cfg.unstagedFallback === 'ask') {
    const choice = await vscode.window.showInformationMessage(
      'Generate Commit: no staged changes. Use unstaged changes instead?',
      'Use Unstaged',
      'Cancel',
    );
    if (choice !== 'Use Unstaged') return undefined;
  }
  const unstaged = await getUnstagedDiff(repo);
  if (!unstaged.trim()) {
    void vscode.window.showInformationMessage(
      'Generate Commit: no changes detected (staged or unstaged).',
    );
    return undefined;
  }
  return { text: unstaged, staged: false };
}

const MAX_SECRET_ROWS = 8;

async function confirmSendWithSecrets(findings: readonly Finding[]): Promise<boolean> {
  const rows = findings
    .slice(0, MAX_SECRET_ROWS)
    .map((finding) => `• ${finding.fileName}: ${SECRET_TYPE_LABELS[finding.type]}`);
  const extra =
    findings.length > MAX_SECRET_ROWS ? `\n... and ${findings.length - MAX_SECRET_ROWS} more` : '';
  const choice = await vscode.window.showWarningMessage(
    `Possible secrets detected in the diff:\n${rows.join('\n')}${extra}`,
    {
      modal: true,
      detail:
        'Secret values are never displayed. Sending the diff may expose them to the selected provider.',
    },
    'Send Anyway',
  );
  return choice === 'Send Anyway';
}

async function generateCommand(context: vscode.ExtensionContext, arg: unknown): Promise<void> {
  const startedAt = Date.now();
  try {
    const api = await getGitApi();
    const repo = await resolveRepository(api, arg);
    if (!repo) return;
    const cfg = readAppConfig();

    const diff = await resolveDiff(repo, cfg);
    if (!diff) return;

    const files = splitDiffByFile(diff.text);
    const { kept, dropped } = filterFileDiffs(files, { maxFileBytes: cfg.maxFileSizeKB * 1024 });
    if (dropped.length > 0) {
      logMeta('diff.filtered', {
        files: dropped.length,
        reasons: [...new Set(dropped.map((d) => d.reason))].join(','),
      });
    }
    if (kept.length === 0) {
      const reasons = [...new Set(dropped.map((d) => d.reason))].join(', ');
      void vscode.window.showInformationMessage(
        `Generate Commit: nothing to summarize. All changed files were excluded (${reasons || 'empty diff'}).`,
      );
      return;
    }

    const findings = scanDiff(kept);
    if (findings.length > 0) {
      const approved = await confirmSendWithSecrets(findings);
      if (!approved) {
        logMeta('secrets.blocked', { findings: findings.length });
        return;
      }
      logMeta('secrets.override', { findings: findings.length });
    }

    const {
      diff: finalDiff,
      truncated,
      includedFiles,
      totalFiles,
    } = truncateToLimit(kept, cfg.maxDiffChars);
    const recentCommits = cfg.includeRecentCommits ? await getRecentCommitSubjects(repo) : [];
    const systemPrompt = buildSystemPrompt(cfg.language, cfg.customPrompt);
    const userPrompt = buildUserPrompt({ diff: finalDiff, truncated, recentCommits });

    const providers = createProviders(context);
    const availability = await collectAvailability(providers);
    const choice = resolveProviderChoice(cfg.provider, availability);
    if (!choice) {
      const action = await vscode.window.showInformationMessage(
        'Generate Commit: no provider is ready. Configure an API key or install a supported CLI (claude, codex) in the settings panel.',
        'Open Settings',
      );
      if (action) await openSettingsPanel();
      return;
    }
    if (choice !== cfg.provider) {
      logMeta('provider.fallback', { from: cfg.provider, to: choice });
      void vscode.window.showInformationMessage(
        `Generate Commit: provider "${cfg.provider}" is unavailable; using ${providerMeta(choice).label}.`,
      );
    }
    const provider = providers.get(choice);
    if (!provider) throw new Error(`Provider not registered: ${choice}`);
    const providerCfg = readProviderConfig(choice);

    const generationKey = repo.rootUri.toString();
    activeGenerations.get(generationKey)?.controller.abort();
    const generation = ++generationSeq;
    const controller = new AbortController();
    activeGenerations.set(generationKey, { id: generation, controller });
    try {
      const raw = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Generating commit message with ${provider.label}...`,
          cancellable: true,
        },
        async (_progress, token) => {
          token.onCancellationRequested(() => controller.abort());
          const req: GenerateRequest = {
            systemPrompt,
            userPrompt,
            model: providerCfg.model,
            effort: providerCfg.effort,
            timeoutMs: cfg.timeoutSeconds * 1000,
            signal: controller.signal,
            cwd: repo.rootUri.fsPath,
          };
          return provider.generate(req);
        },
      );

      if (activeGenerations.get(generationKey)?.id !== generation) {
        logMeta('generate.superseded', { provider: choice });
        return;
      }
      if (diff.staged) {
        const current = await getStagedDiff(repo).catch(() => diff.text);
        if (current !== diff.text) {
          logMeta('generate.staleDiff', { provider: choice });
          void vscode.window.showInformationMessage(
            'Generate Commit: the staged changes were modified during generation; the result was discarded. Run it again.',
          );
          return;
        }
      }

      const message = parseModelOutput(raw);
      if (!message) {
        throw new ProviderError('invalidResponse', `${provider.label} returned an empty message`);
      }
      repo.inputBox.value = message;
      logMeta('generate.success', {
        provider: choice,
        model: providerCfg.model || 'default',
        ms: Date.now() - startedAt,
        diffChars: finalDiff.length,
        truncated,
        staged: diff.staged,
        files: `${includedFiles}/${totalFiles}`,
      });
    } finally {
      if (activeGenerations.get(generationKey)?.id === generation) {
        activeGenerations.delete(generationKey);
      }
    }
  } catch (err) {
    handleGenerateError(err);
  }
}

function handleGenerateError(err: unknown): void {
  if (err instanceof ProviderError) {
    if (err.kind === 'cancelled') {
      logMeta('generate.cancelled');
      return;
    }
    logMeta('generate.error', { kind: err.kind });
    const text = err.action ? `${err.message} (${err.action})` : err.message;
    void vscode.window
      .showErrorMessage(`Generate Commit: ${text}`, 'Open Settings')
      .then((action) => {
        if (action === 'Open Settings') void openSettingsPanel();
      });
    return;
  }
  logMeta('generate.error', { kind: 'unexpected' });
  void vscode.window.showErrorMessage(
    `Generate Commit: ${err instanceof Error ? err.message : String(err)}`,
  );
}
