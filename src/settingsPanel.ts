import * as vscode from 'vscode';
import { readAppConfig, readProviderConfig, secretKeyFor } from './config';
import { logMeta } from './log';
import { PROVIDERS } from './providers/registry';
import {
  collectAvailability,
  collectKeyStatus,
  createProviders,
  validateApiKey,
} from './providersRuntime';
import { isKeyBackedProvider, LANGUAGE_OPTIONS, validateSettingValue } from './settingsModel';
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
}

interface PanelState {
  readonly provider: ProviderId;
  readonly language: string;
  readonly maxDiffChars: number;
  readonly maxFileSizeKB: number;
  readonly includeRecentCommits: boolean;
  readonly customPrompt: string;
  readonly unstagedFallback: string;
  readonly timeoutSeconds: number;
  readonly providers: readonly PanelProviderState[];
  readonly languages: readonly { code: string; label: string }[];
}

type PanelMessage =
  | { type: 'ready' }
  | { type: 'update'; key: string; value: unknown }
  | { type: 'saveKey'; provider: string; value: string };

function parseMessage(raw: unknown): PanelMessage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const msg = raw as { type?: unknown; key?: unknown; value?: unknown; provider?: unknown };
  if (msg.type === 'ready') return { type: 'ready' };
  if (msg.type === 'update' && typeof msg.key === 'string') {
    return { type: 'update', key: msg.key, value: msg.value };
  }
  if (msg.type === 'saveKey' && typeof msg.provider === 'string' && typeof msg.value === 'string') {
    return { type: 'saveKey', provider: msg.provider, value: msg.value };
  }
  return undefined;
}

/**
 * Sidebar settings panel: a strictly sandboxed WebviewView (CSP default-src
 * 'none', only bundled local media, no remote content, no inline code).
 * Messages from the webview are validated against a whitelist before any
 * config.update, and secret values never flow back into the DOM.
 */
export class SettingsPanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private readonly listener: vscode.Disposable;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.listener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(SECTION)) void this.pushState();
    });
  }

  dispose(): void {
    this.listener.dispose();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    view.webview.html = this.renderHtml(view.webview);
    view.webview.onDidReceiveMessage(
      (message: unknown) => void this.handleMessage(message),
      undefined,
      this.context.subscriptions,
    );
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
      };
    });
    return {
      provider: cfg.provider,
      language: cfg.language,
      maxDiffChars: cfg.maxDiffChars,
      maxFileSizeKB: cfg.maxFileSizeKB,
      includeRecentCommits: cfg.includeRecentCommits,
      customPrompt: cfg.customPrompt,
      unstagedFallback: cfg.unstagedFallback,
      timeoutSeconds: cfg.timeoutSeconds,
      providers: providerStates,
      languages: LANGUAGE_OPTIONS,
    };
  }

  private async pushState(): Promise<void> {
    if (!this.view) return;
    const state = await this.buildState();
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
        return;
      }
      await vscode.workspace
        .getConfiguration(SECTION)
        .update(message.key, result.value, vscode.ConfigurationTarget.Global);
      logMeta('settings.updated', { key: message.key });
      return;
    }
    if (message.type === 'saveKey') {
      await this.handleSaveKey(message.provider, message.value);
    }
  }

  private async handleSaveKey(provider: string, value: string): Promise<void> {
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
    const validation = await validateApiKey(provider, key);
    if (validation.ok) {
      await this.context.secrets.store(secretKeyFor(provider), key);
      logMeta('secrets.stored', { provider });
      await this.pushState();
    } else {
      logMeta('secrets.rejected', { provider });
    }
    await this.view.webview.postMessage({
      type: 'keyResult',
      provider,
      ok: validation.ok,
      reason: validation.reason,
    });
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
