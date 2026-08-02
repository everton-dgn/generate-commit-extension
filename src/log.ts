import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function initLog(): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel('Generate Commit');
  return channel;
}

type MetaValue = string | number | boolean | undefined;

/**
 * Metadata-only logging: provider, model, latency, sizes, counts. Never call
 * this with diff contents, API keys or generated messages.
 */
export function logMeta(event: string, meta: Record<string, MetaValue> = {}): void {
  const pairs = Object.entries(meta)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');
  initLog().appendLine(`[${new Date().toISOString()}] ${event}${pairs ? ` ${pairs}` : ''}`);
}
