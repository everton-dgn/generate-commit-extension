import * as vscode from 'vscode';
import type { API, GitExtension, Repository } from './typings/git';

/** Returns the built-in git extension API v1, activating the extension if needed. */
export async function getGitApi(): Promise<API> {
  const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!extension) {
    throw new Error('Built-in git extension (vscode.git) not found or disabled.');
  }
  const gitExtension = extension.isActive ? extension.exports : await extension.activate();
  return gitExtension.getAPI(1);
}

function extractRootUri(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) return arg;
  if (arg && typeof arg === 'object') {
    const rootUri = (arg as { rootUri?: unknown }).rootUri;
    if (rootUri instanceof vscode.Uri) return rootUri;
  }
  return undefined;
}

/**
 * Resolves the target repository: from the command argument (rootUri passed by
 * the scm/inputBox menu, or a SourceControl from scm/title), then the single
 * open repository, otherwise a QuickPick.
 */
export async function resolveRepository(api: API, arg: unknown): Promise<Repository | undefined> {
  const repositories = api.repositories;
  if (repositories.length === 0) {
    void vscode.window.showInformationMessage(
      'Generate Commit: no git repository found in this workspace.',
    );
    return undefined;
  }
  const uri = extractRootUri(arg);
  if (uri) {
    const match = repositories.find((repo) => repo.rootUri.toString() === uri.toString());
    if (match) return match;
  }
  const first = repositories[0];
  if (repositories.length === 1 && first) return first;
  interface Item extends vscode.QuickPickItem {
    repo: Repository;
  }
  const items: Item[] = repositories.map((repo) => ({
    label: repo.rootUri.path.split('/').pop() ?? repo.rootUri.toString(),
    description: repo.rootUri.fsPath,
    repo,
  }));
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select the repository to generate the commit message for',
  });
  return pick?.repo;
}

export async function getStagedDiff(repo: Repository): Promise<string> {
  return repo.diff(true);
}

export async function getUnstagedDiff(repo: Repository): Promise<string> {
  return repo.diff(false);
}

const RECENT_COMMITS_COUNT = 10;

/** Recent commit subjects as style context; empty on unborn HEAD or API errors. */
export async function getRecentCommitSubjects(repo: Repository): Promise<string[]> {
  try {
    const commits = await repo.log({ maxEntries: RECENT_COMMITS_COUNT });
    return commits
      .map((commit) => commit.message.split('\n')[0]?.trim() ?? '')
      .filter((subject) => subject.length > 0);
  } catch {
    return [];
  }
}
