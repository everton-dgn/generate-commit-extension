import * as vscode from 'vscode';
import { readAppConfig, readProviderConfig } from './config';
import { PROVIDERS } from './providers/registry';
import { buildAdvancedChildren, buildSettingsTree, type SettingsTreeNode } from './settingsModel';
import type { ProviderId } from './types';

export const SETTINGS_VIEW_ID = 'generateCommit.settingsView';

class SettingsTreeItem extends vscode.TreeItem {
  constructor(readonly node: SettingsTreeNode) {
    super(
      node.label,
      node.collapsible
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.description = node.description;
    this.iconPath = new vscode.ThemeIcon(node.iconId);
    if (!node.collapsible) {
      this.command = {
        command: 'generateCommit.editSetting',
        title: 'Edit Setting',
        arguments: [node.id],
      };
    }
  }
}

class AdvancedProviderTreeItem extends vscode.TreeItem {
  constructor(id: string, label: string, description: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon('hubot');
    this.command = {
      command: 'generateCommit.editSetting',
      title: 'Edit Provider Settings',
      arguments: [id],
    };
  }
}

/** Sidebar tree with every setting and its current value. */
export class SettingsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly listener: vscode.Disposable;

  constructor() {
    this.listener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('generateCommit')) this.refresh();
    });
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  dispose(): void {
    this.listener.dispose();
    this.emitter.dispose();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      return buildSettingsTree(readAppConfig()).map((node) => new SettingsTreeItem(node));
    }
    if (element instanceof SettingsTreeItem && element.node.id === 'advanced') {
      const models = Object.fromEntries(
        PROVIDERS.map((meta) => [meta.id, readProviderConfig(meta.id).model]),
      ) as Record<ProviderId, string>;
      return buildAdvancedChildren(models).map(
        (child) => new AdvancedProviderTreeItem(child.id, child.label, child.description),
      );
    }
    return [];
  }
}
