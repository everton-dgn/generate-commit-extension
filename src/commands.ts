import * as vscode from 'vscode';
import { type AppConfig, readAppConfig, readProviderConfig, secretKeyFor } from './config';
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
import { createAnthropicCompatibleProvider } from './providers/anthropic';
import { createClaudeCliProvider } from './providers/claudeCli';
import { createCodexCliProvider } from './providers/codexCli';
import { createOpenRouterProvider } from './providers/openrouter';
import { PROVIDERS, providerMeta, resolveProviderChoice } from './providers/registry';
import { type Finding, SECRET_TYPE_LABELS, scanDiff } from './secretsScan';
import { settingsCommand } from './settingsUi';
import { type GenerateRequest, type Provider, ProviderError, type ProviderId } from './types';
import type { Repository } from './typings/git';

export function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('generateCommit.generate', (arg?: unknown) =>
      generateCommand(context, arg),
    ),
    vscode.commands.registerCommand('generateCommit.switchProvider', () =>
      switchProviderCommand(context),
    ),
    vscode.commands.registerCommand('generateCommit.configure', () => configureCommand(context)),
    vscode.commands.registerCommand('generateCommit.settings', () => settingsCommand()),
  );
}

/**
 * One generation per repository: starting a new one aborts the previous and
 * only the latest run may write to the input box (slow responses from older
 * runs are discarded).
 */
const activeGenerations = new Map<string, { id: number; controller: AbortController }>();
let generationSeq = 0;

function onInvalidConfig(message: string): void {
  logMeta('config.invalid', { detail: message });
  void vscode.window.showWarningMessage(`Generate Commit: ${message}`);
}

function createProviders(context: vscode.ExtensionContext): Map<ProviderId, Provider> {
  const secrets = context.secrets;
  const getApiKey = (id: ProviderId) => async () => secrets.get(secretKeyFor(id));
  const cliLog = (line: string) => logMeta('cli', { detail: line });
  const anthropic = (id: ProviderId) =>
    createAnthropicCompatibleProvider(id, providerMeta(id).label, {
      getApiKey: getApiKey(id),
      getConfig: () => {
        const cfg = readProviderConfig(id, onInvalidConfig);
        return { baseUrl: cfg.baseUrl, model: cfg.model, auth: cfg.auth };
      },
    });
  return new Map<ProviderId, Provider>([
    [
      'openrouter',
      createOpenRouterProvider({
        getApiKey: getApiKey('openrouter'),
        getConfig: () => {
          const cfg = readProviderConfig('openrouter', onInvalidConfig);
          return { model: cfg.model, baseUrl: cfg.baseUrl };
        },
      }),
    ],
    ['kimi', anthropic('kimi')],
    ['glm', anthropic('glm')],
    ['minimax', anthropic('minimax')],
    ['anthropicCustom', anthropic('anthropicCustom')],
    [
      'claudeCli',
      createClaudeCliProvider({
        getConfig: () => {
          const cfg = readProviderConfig('claudeCli');
          return { model: cfg.model, effort: cfg.effort };
        },
        log: cliLog,
      }),
    ],
    [
      'codexCli',
      createCodexCliProvider({
        getConfig: () => {
          const cfg = readProviderConfig('codexCli');
          return { model: cfg.model, effort: cfg.effort };
        },
        log: cliLog,
      }),
    ],
  ]);
}

async function collectAvailability(
  providers: ReadonlyMap<ProviderId, Provider>,
): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    [...providers].map(async ([id, provider]) => [id, await provider.isAvailable()] as const),
  );
  return Object.fromEntries(entries);
}

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
        'Generate Commit: no provider is ready. Configure an API key or install a supported CLI (claude, codex).',
        'Configure API Key',
      );
      if (action) await configureCommand(context);
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
    const providerCfg = readProviderConfig(choice, onInvalidConfig);

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
    const actions: string[] = [];
    if (err.kind === 'auth') actions.push('Configure API Key');
    actions.push('Switch Provider');
    const text = err.action ? `${err.message} (${err.action})` : err.message;
    void vscode.window.showErrorMessage(`Generate Commit: ${text}`, ...actions).then((action) => {
      if (action === 'Configure API Key') {
        void vscode.commands.executeCommand('generateCommit.configure');
      } else if (action === 'Switch Provider') {
        void vscode.commands.executeCommand('generateCommit.switchProvider');
      }
    });
    return;
  }
  logMeta('generate.error', { kind: 'unexpected' });
  void vscode.window.showErrorMessage(
    `Generate Commit: ${err instanceof Error ? err.message : String(err)}`,
  );
}

async function switchProviderCommand(context: vscode.ExtensionContext): Promise<void> {
  const providers = createProviders(context);
  const availability = await collectAvailability(providers);
  const current = readAppConfig().provider;

  interface Item extends vscode.QuickPickItem {
    id?: ProviderId;
  }
  const items: Item[] = [{ label: 'Available', kind: vscode.QuickPickItemKind.Separator }];
  for (const meta of PROVIDERS) {
    if (availability[meta.id]) {
      const model = readProviderConfig(meta.id).model;
      items.push({
        label: `${meta.id === current ? '$(check) ' : ''}${meta.label}`,
        description: model || 'provider default',
        id: meta.id,
      });
    }
  }
  items.push({ label: 'Unavailable', kind: vscode.QuickPickItemKind.Separator });
  for (const meta of PROVIDERS) {
    if (!availability[meta.id]) {
      items.push({
        label: meta.label,
        description: meta.kind === 'cli' ? 'CLI not found' : 'no API key configured',
        id: meta.id,
      });
    }
  }

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select the provider used to generate commit messages',
  });
  if (!pick?.id) return;
  const meta = providerMeta(pick.id);
  if (!availability[pick.id]) {
    if (meta.kind === 'cli') {
      void vscode.window.showInformationMessage(
        `Generate Commit: ${meta.label} was not found on PATH.`,
      );
      return;
    }
    const action = await vscode.window.showInformationMessage(
      `Generate Commit: ${meta.label} has no API key configured.`,
      'Configure API Key',
    );
    if (action) await configureCommand(context);
    return;
  }

  const config = vscode.workspace.getConfiguration('generateCommit');
  await config.update('provider', pick.id, vscode.ConfigurationTarget.Global);
  const currentModel = readProviderConfig(pick.id).model;
  const model = await vscode.window.showInputBox({
    prompt: `Model for ${meta.label}. Leave empty to use the provider default.`,
    value: currentModel,
    ignoreFocusOut: true,
  });
  if (model !== undefined && model.trim() !== currentModel) {
    await config.update(`${pick.id}.model`, model.trim(), vscode.ConfigurationTarget.Global);
  }
  logMeta('provider.switched', {
    provider: pick.id,
    model: model?.trim() || currentModel || 'default',
  });
  void vscode.window.showInformationMessage(`Generate Commit: provider set to ${meta.label}.`);
}

async function validateApiKey(
  id: ProviderId,
  apiKey: string,
): Promise<{ ok: boolean; reason: string }> {
  try {
    const cfg = readProviderConfig(id, onInvalidConfig);
    const req: GenerateRequest = {
      systemPrompt: '',
      userPrompt: 'ping',
      model: cfg.model,
      effort: '',
      maxTokens: 8,
      timeoutMs: 15_000,
      signal: new AbortController().signal,
    };
    if (id === 'openrouter') {
      await createOpenRouterProvider({
        getApiKey: async () => apiKey,
        getConfig: () => ({ model: cfg.model, baseUrl: cfg.baseUrl }),
      }).generate(req);
    } else {
      await createAnthropicCompatibleProvider(id, providerMeta(id).label, {
        getApiKey: async () => apiKey,
        getConfig: () => ({ baseUrl: cfg.baseUrl, model: cfg.model, auth: cfg.auth }),
      }).generate(req);
    }
    return { ok: true, reason: '' };
  } catch (err) {
    if (err instanceof ProviderError) {
      if (err.kind === 'auth') return { ok: false, reason: 'authentication failed' };
      // Responses from the endpoint (billing, rate limit, server errors, even
      // a rejected payload) prove the key was accepted; connectivity errors
      // (network, timeout) prove nothing.
      const responded =
        err.kind === 'billing' ||
        err.kind === 'rateLimit' ||
        err.kind === 'server' ||
        err.kind === 'invalidResponse';
      return responded ? { ok: true, reason: '' } : { ok: false, reason: err.message };
    }
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

async function configureCommand(context: vscode.ExtensionContext): Promise<void> {
  interface Item extends vscode.QuickPickItem {
    id: ProviderId;
  }
  const items: Item[] = await Promise.all(
    PROVIDERS.filter((meta) => meta.needsApiKey).map(async (meta) => ({
      label: meta.label,
      description: (await context.secrets.get(secretKeyFor(meta.id)))
        ? '$(check) key configured'
        : '',
      detail: `Get a key at: ${meta.keyConsoleUrl ?? 'the provider console'}`,
      id: meta.id,
    })),
  );
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a provider to configure',
  });
  if (!pick) return;
  const meta = providerMeta(pick.id);

  const key = await vscode.window.showInputBox({
    prompt: `API key for ${meta.label}. Stored in VS Code Secret Storage, never in settings.json.`,
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim().length >= 8 ? undefined : 'The key looks too short'),
  });
  if (!key) return;

  const validation = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Validating ${meta.label} key...` },
    () => validateApiKey(pick.id, key.trim()),
  );
  if (validation.ok) {
    await context.secrets.store(secretKeyFor(pick.id), key.trim());
    logMeta('secrets.stored', { provider: pick.id });
    void vscode.window.showInformationMessage(`Generate Commit: ${meta.label} API key saved.`);
    return;
  }
  const action = await vscode.window.showErrorMessage(
    `Generate Commit: key validation failed for ${meta.label} (${validation.reason}).`,
    'Save Anyway',
    'Discard',
  );
  if (action === 'Save Anyway') {
    await context.secrets.store(secretKeyFor(pick.id), key.trim());
    logMeta('secrets.stored', { provider: pick.id, validated: false });
    void vscode.window.showInformationMessage(
      `Generate Commit: ${meta.label} API key saved (unverified).`,
    );
  }
}
