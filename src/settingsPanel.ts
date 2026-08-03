import * as vscode from 'vscode';
import { CodexCliCatalog } from './cliCatalog';
import { readAppConfig, readProviderConfig, secretKeyFor } from './config';
import { logMeta } from './log';
import { MODELS_TTL_MS, ModelCatalog } from './modelCatalog';
import { PROVIDERS } from './providers/registry';
import {
  collectAvailability,
  collectKeyStatus,
  createProviders,
  validateApiKey,
} from './providersRuntime';
import {
  buildEffortOptions,
  buildModelOptions,
  CLAUDE_CLI_EFFORT_LEVELS,
  CUSTOM_MODEL_VALUE,
  isKeyBackedProvider,
  LANGUAGE_OPTIONS,
  type ModelOption,
  parseMessage,
  validateSettingValue,
} from './settingsModel';
import type { ProviderId } from './types';

export const SETTINGS_VIEW_ID = 'generateCommit.settingsView';

const SECTION = 'generateCommit';
const MIN_KEY_LENGTH = 8;

interface PanelProviderState {
  readonly id: ProviderId;
  readonly label: string;
  readonly kind: 'http' | 'cli';
  readonly available: boolean;
  readonly availabilityNote: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly authHeader: string;
  readonly effort: string;
  readonly hasKey: boolean;
  readonly models: readonly string[];
  readonly modelOptions: readonly ModelOption[];
  readonly modelSelected: string;
  readonly effortOptions: readonly ModelOption[];
  readonly effortSelected: string;
}

interface PanelState {
  readonly provider: ProviderId;
  readonly language: string;
  readonly maxDiffChars: number;
  readonly maxFileSizeKB: number;
  readonly includeRecentCommits: boolean;
  readonly disableThinking: boolean;
  readonly customPrompt: string;
  readonly unstagedFallback: string;
  readonly timeoutSeconds: number;
  readonly providers: readonly PanelProviderState[];
  readonly languages: readonly { code: string; label: string }[];
  readonly customModelValue: string;
}

/**
 * Sidebar settings panel: a strictly sandboxed WebviewView (CSP default-src
 * 'none', only packaged local media, no remote content, no inline code).
 * Webview messages are validated against a whitelist before any
 * config.update, and secret values never flow back into the DOM.
 */
export class SettingsPanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private readonly listener: vscode.Disposable;
  private readonly catalog: ModelCatalog;
  private readonly codexCatalog: CodexCliCatalog;
  private readonly catalogAbort = new AbortController();
  private refreshTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.catalog = new ModelCatalog({
      getApiKey: async (id) => context.secrets.get(secretKeyFor(id)),
      getConfig: (id) => {
        const cfg = readProviderConfig(id);
        return { baseUrl: cfg.baseUrl, auth: cfg.auth };
      },
      now: () => Date.now(),
      timeoutMs: 10_000,
      signal: this.catalogAbort.signal,
    });
    this.codexCatalog = new CodexCliCatalog({
      now: () => Date.now(),
      timeoutMs: 10_000,
      signal: this.catalogAbort.signal,
    });
    this.listener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(SECTION)) {
        this.pushState().catch((err: unknown) => {
          logMeta('panel.stateError', { detail: err instanceof Error ? err.name : 'unknown' });
        });
      }
    });
  }

  dispose(): void {
    this.listener.dispose();
    this.catalogAbort.abort();
    if (this.refreshTimer !== undefined) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    view.webview.html = this.renderHtml(view.webview);
    view.onDidDispose(
      () => {
        this.view = undefined;
        // The view can be reopened later: without clearing here, each reopen
        // would stack a new interval and old ticks would keep spawning
        // catalog fetches (including CLI processes) with the panel closed.
        if (this.refreshTimer !== undefined) {
          clearInterval(this.refreshTimer);
          this.refreshTimer = undefined;
        }
      },
      undefined,
      this.context.subscriptions,
    );
    view.webview.onDidReceiveMessage(
      (message: unknown) => {
        this.handleMessage(message).catch((err: unknown) => {
          // Never leave the form stuck: report unexpected failures back.
          logMeta('panel.messageError', { detail: err instanceof Error ? err.name : 'unknown' });
          const msg = (typeof message === 'object' && message !== null ? message : {}) as {
            type?: unknown;
            provider?: unknown;
            key?: unknown;
          };
          if (msg.type === 'saveKey' && typeof msg.provider === 'string' && this.view) {
            void this.view.webview.postMessage({
              type: 'keyResult',
              provider: msg.provider,
              ok: false,
              reason: 'unexpected error',
            });
          }
          if (msg.type === 'update' && typeof msg.key === 'string' && this.view) {
            void this.view.webview.postMessage({
              type: 'updateResult',
              key: msg.key,
              ok: false,
              reason: 'failed to apply the setting',
            });
          }
        });
      },
      undefined,
      this.context.subscriptions,
    );
    // Fetches the live model catalogs in the background; the form re-renders
    // with suggestions when they arrive (failures keep the fields
    // free-text only).
    this.refreshCatalogs();
    // Keeps the catalogs fresh while the panel is open; the TTL gate in
    // refresh() makes this a no-op until an entry actually expires.
    if (this.refreshTimer !== undefined) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => this.refreshCatalogs(), MODELS_TTL_MS);
  }

  private refreshCatalogs(): void {
    const httpRefresh = this.catalog.refreshAll(PROVIDERS.map((meta) => meta.id));
    const codexRefresh = this.codexCatalog.refresh();
    Promise.all([httpRefresh, codexRefresh])
      .then(([httpChanged, codexChanged]) => {
        if (httpChanged || codexChanged) return this.pushState();
        return undefined;
      })
      .catch((err: unknown) => {
        logMeta('catalog.error', { detail: err instanceof Error ? err.name : 'unknown' });
      });
  }

  private async buildState(): Promise<PanelState> {
    const cfg = readAppConfig();
    const providers = createProviders(this.context);
    const availability = await collectAvailability(providers);
    const keyStatus = new Map(
      (await collectKeyStatus(this.context)).map((status) => [status.id, status.hasKey]),
    );
    const providerStates: PanelProviderState[] = PROVIDERS.map((meta) => {
      const runtime = readProviderConfig(meta.id);
      const available = Boolean(availability[meta.id]);
      const models =
        meta.id === 'codexCli'
          ? (this.codexCatalog.snapshot()?.models ?? [])
          : this.catalog.modelsFor(meta.id);
      const { options, selected } = buildModelOptions(models, runtime.model);
      const effortLevels =
        meta.id === 'claudeCli'
          ? CLAUDE_CLI_EFFORT_LEVELS
          : meta.id === 'codexCli'
            ? this.codexCatalog.effortsFor(runtime.model)
            : [];
      const effort = buildEffortOptions(effortLevels, runtime.effort);
      return {
        id: meta.id,
        label: meta.label,
        kind: meta.kind,
        available,
        availabilityNote: available
          ? 'ready'
          : meta.kind === 'cli'
            ? 'CLI not found'
            : 'no API key configured',
        model: runtime.model,
        baseUrl: runtime.baseUrl,
        authHeader: runtime.auth,
        effort: runtime.effort,
        hasKey: Boolean(keyStatus.get(meta.id)),
        models,
        modelOptions: options,
        modelSelected: selected,
        effortOptions: effort.options,
        effortSelected: effort.selected,
      };
    });
    return {
      provider: cfg.provider,
      language: cfg.language,
      maxDiffChars: cfg.maxDiffChars,
      maxFileSizeKB: cfg.maxFileSizeKB,
      includeRecentCommits: cfg.includeRecentCommits,
      disableThinking: cfg.disableThinking,
      customPrompt: cfg.customPrompt,
      unstagedFallback: cfg.unstagedFallback,
      timeoutSeconds: cfg.timeoutSeconds,
      providers: providerStates,
      languages: LANGUAGE_OPTIONS,
      customModelValue: CUSTOM_MODEL_VALUE,
    };
  }

  private stateSeq = 0;

  private async pushState(): Promise<void> {
    if (!this.view) return;
    // buildState is slow (availability probing): only the latest call may
    // publish, so rapid config changes never render a stale snapshot.
    const seq = ++this.stateSeq;
    const state = await this.buildState();
    if (!this.view || seq !== this.stateSeq) return;
    await this.view.webview.postMessage({ type: 'state', state });
  }

  private async handleMessage(raw: unknown): Promise<void> {
    const message = parseMessage(raw);
    if (!message) return;
    if (message.type === 'ready') {
      await this.pushState();
      return;
    }
    if (message.type === 'update') {
      const result = validateSettingValue(message.key, message.value);
      if (!result.ok) {
        logMeta('settings.rejected', { key: message.key });
        // Notify the form so the field reverts instead of silently diverging.
        if (this.view) {
          await this.view.webview.postMessage({
            type: 'updateResult',
            key: message.key,
            ok: false,
            reason: 'invalid value',
          });
        }
        return;
      }
      await vscode.workspace
        .getConfiguration(SECTION)
        .update(message.key, result.value, vscode.ConfigurationTarget.Global);
      logMeta('settings.updated', { key: message.key });
      return;
    }
    if (message.type === 'saveKey') {
      await this.handleSaveKey(message.provider, message.value, message.force);
    }
  }

  private async handleSaveKey(provider: string, value: string, force: boolean): Promise<void> {
    if (!this.view || !isKeyBackedProvider(provider)) return;
    const key = value.trim();
    if (key.length < MIN_KEY_LENGTH) {
      await this.view.webview.postMessage({
        type: 'keyResult',
        provider,
        ok: false,
        reason: 'the key looks too short',
      });
      return;
    }
    // Force = explicit user override after a failed validation (flaky
    // network or a down endpoint must not fully block saving).
    if (force) {
      await this.context.secrets.store(secretKeyFor(provider), key);
      logMeta('secrets.stored', { provider, validated: false });
      await this.view.webview.postMessage({
        type: 'keyResult',
        provider,
        ok: true,
        reason: 'saved without verification',
      });
      await this.pushState();
      return;
    }
    const validation = await validateApiKey(provider, key);
    if (validation.ok) {
      await this.context.secrets.store(secretKeyFor(provider), key);
      logMeta('secrets.stored', { provider });
    } else {
      logMeta('secrets.rejected', { provider });
    }
    await this.view.webview.postMessage({
      type: 'keyResult',
      provider,
      ok: validation.ok,
      reason: validation.reason,
      allowForce: !validation.ok,
    });
    if (validation.ok) {
      await this.pushState();
      // A new key may unlock the provider's model catalog: fetch it now
      // (forced, ignoring the TTL) instead of waiting for the next open.
      this.catalog
        .refresh(provider, true)
        .then((changed) => {
          if (changed) return this.pushState();
          return undefined;
        })
        .catch((err: unknown) => {
          logMeta('catalog.error', { detail: err instanceof Error ? err.name : 'unknown' });
        });
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'settingsPanel.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'settingsPanel.css'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'none'; font-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${styleUri}">
<title>Generate Commit Settings</title>
</head>
<body>
<div id="app"><p class="loading">Loading...</p></div>
<script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
