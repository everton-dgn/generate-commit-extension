import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { initLog, logMeta } from './log';
import { SETTINGS_VIEW_ID, SettingsTreeProvider } from './settingsTree';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(initLog());
  registerCommands(context);
  const treeProvider = new SettingsTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(SETTINGS_VIEW_ID, treeProvider),
    treeProvider,
  );
  logMeta('extension.activated');
}

export function deactivate(): void {
  // nothing to dispose beyond subscriptions
}
