export interface FileDiff {
  readonly fileName: string;
  readonly chunk: string;
  readonly binary: boolean;
}

export type DropReason = 'lockfile' | 'minified' | 'binary' | 'tooLarge';

export interface DroppedFile {
  readonly fileName: string;
  readonly reason: DropReason;
}

export interface FilterResult {
  readonly kept: readonly FileDiff[];
  readonly dropped: readonly DroppedFile[];
}

export const LOCKFILE_NAMES: ReadonlySet<string> = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'deno.lock',
  'composer.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'go.sum',
  'poetry.lock',
  'uv.lock',
  'Pipfile.lock',
]);

const MINIFIED_PATTERN = /\.min\.(js|mjs|cjs|css)$/i;

function baseName(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function nameFromHeader(line: string): string {
  const quoted = line.match(/"b\/(.+)"$/);
  if (quoted?.[1]) return quoted[1];
  const idx = line.lastIndexOf(' b/');
  return idx >= 0 ? line.slice(idx + 3) : line;
}

/** Splits a unified diff into per-file chunks keyed by the post-image path. */
export function splitDiffByFile(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: string[] = [];
  let name = '';

  const flush = (): void => {
    if (current.length === 0) return;
    const chunk = current.join('\n');
    files.push({
      fileName: name,
      chunk,
      binary: /Binary files .+ differ|GIT binary patch/.test(chunk),
    });
  };

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      current = [line];
      name = nameFromHeader(line);
      continue;
    }
    const plusMatch = line.match(/^\+\+\+ (?:"b\/(.+)"|b\/(.+))$/);
    if (plusMatch) {
      name = plusMatch[1] ?? plusMatch[2] ?? name;
    }
    if (current.length > 0) current.push(line);
  }
  flush();
  return files;
}

export interface FilterOptions {
  readonly maxFileBytes: number;
}

/** Drops lockfiles, minified files, binaries and oversized chunks. */
export function filterFileDiffs(files: readonly FileDiff[], options: FilterOptions): FilterResult {
  const kept: FileDiff[] = [];
  const dropped: DroppedFile[] = [];
  for (const file of files) {
    const name = baseName(file.fileName);
    let reason: DropReason | undefined;
    if (LOCKFILE_NAMES.has(name)) reason = 'lockfile';
    else if (MINIFIED_PATTERN.test(name)) reason = 'minified';
    else if (file.binary) reason = 'binary';
    else if (Buffer.byteLength(file.chunk, 'utf8') > options.maxFileBytes) reason = 'tooLarge';
    if (reason) dropped.push({ fileName: file.fileName, reason });
    else kept.push(file);
  }
  return { kept, dropped };
}

export interface TruncateResult {
  readonly diff: string;
  readonly truncated: boolean;
  readonly includedFiles: number;
  readonly totalFiles: number;
}

/** Joins file chunks up to maxChars, cutting at file boundaries. */
export function truncateToLimit(files: readonly FileDiff[], maxChars: number): TruncateResult {
  const totalFiles = files.length;
  const full = files.map((f) => f.chunk).join('\n');
  if (full.length <= maxChars) {
    return { diff: full, truncated: false, includedFiles: totalFiles, totalFiles };
  }
  const parts: string[] = [];
  let used = 0;
  let included = 0;
  for (const file of files) {
    const next = used === 0 ? file.chunk.length : used + 1 + file.chunk.length;
    if (next > maxChars && parts.length > 0) break;
    if (next > maxChars) {
      // Even the first chunk exceeds the limit: hard-slice it (partial include).
      parts.push(file.chunk.slice(0, maxChars));
      included = 1;
      used = maxChars;
      break;
    }
    parts.push(file.chunk);
    used = next;
    included += 1;
  }
  return {
    diff: `${parts.join('\n')}\n\n[... diff truncated: included ${included} of ${totalFiles} files ...]`,
    truncated: true,
    includedFiles: included,
    totalFiles,
  };
}
