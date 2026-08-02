import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PANEL_SETTINGS } from '../src/settingsModel';

interface Manifest {
  contributes: {
    commands: { command: string }[];
    menus: Record<string, { command: string }[]>;
    viewsContainers: { activitybar: { id: string; icon: string }[] };
    views: Record<string, { id: string; name: string; type?: string }[]>;
    configuration: { properties: Record<string, unknown> };
  };
}

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as Manifest;

const root = new URL('../', import.meta.url);

describe('package.json manifest consistency', () => {
  it('declares the settings view as a webview (required by registerWebviewViewProvider)', () => {
    const views = pkg.contributes.views.generateCommit ?? [];
    const settingsView = views.find((v) => v.id === 'generateCommit.settingsView');
    expect(settingsView?.type).toBe('webview');
  });

  it('registers every menu entry against a declared command', () => {
    const declared = new Set(pkg.contributes.commands.map((c) => c.command));
    for (const entries of Object.values(pkg.contributes.menus)) {
      for (const entry of entries) {
        expect(declared.has(entry.command)).toBe(true);
      }
    }
  });

  it('has every panel-writable key declared as a configuration property', () => {
    const declared = pkg.contributes.configuration.properties;
    for (const key of Object.keys(PANEL_SETTINGS)) {
      expect(declared[`generateCommit.${key}`]).toBeDefined();
    }
  });

  it('ships the icon files referenced by the manifest', () => {
    for (const container of pkg.contributes.viewsContainers.activitybar) {
      expect(existsSync(new URL(`${container.icon}`, root))).toBe(true);
    }
    for (const command of pkg.contributes.commands) {
      const icon = (command as unknown as { icon?: unknown }).icon;
      if (typeof icon === 'string' && icon.startsWith('images/')) {
        expect(existsSync(new URL(icon, root))).toBe(true);
      }
      if (icon && typeof icon === 'object') {
        for (const path of Object.values(icon as Record<string, string>)) {
          expect(existsSync(new URL(path, root))).toBe(true);
        }
      }
    }
  });
});
