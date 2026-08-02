import type * as vscode from 'vscode';
import { registerCommands } from './commands';
import { initLog, logMeta } from './log';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(initLog());
  registerCommands(context);
  logMeta('extension.activated');
}

export function deactivate(): void {
  // nothing to dispose beyond subscriptions
}
