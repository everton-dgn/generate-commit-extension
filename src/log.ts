import * as vscode from 'vscode';
import { redactSecrets } from './secretsScan';

let channel: vscode.OutputChannel | undefined;

export function initLog(): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel('Generate Commit');
  return channel;
}

type MetaValue = string | number | boolean | undefined;

/**
 * Log somente de metadados: provider, model, latência, tamanhos, contagens.
 * Nunca chame isto com conteúdo de diff, chaves de API ou mensagens geradas;
 * os valores ainda passam pela redação de segredos como defesa em profundidade.
 */
export function logMeta(event: string, meta: Record<string, MetaValue> = {}): void {
  const pairs = Object.entries(meta)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${redactSecrets(String(value))}`)
    .join(' ');
  initLog().appendLine(`[${new Date().toISOString()}] ${event}${pairs ? ` ${pairs}` : ''}`);
}
