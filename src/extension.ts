import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { initLog, logMeta } from './log';
import { SETTINGS_VIEW_ID, SettingsPanelProvider } from './settingsPanel';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(initLog());
  registerCommands(context);
  const panelProvider = new SettingsPanelProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SETTINGS_VIEW_ID, panelProvider),
    panelProvider,
  );
  logMeta('extension.activated');
}

export function deactivate(): void {
  // nothing to dispose beyond the subscriptions
}
