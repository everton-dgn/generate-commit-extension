import { findBinary } from './cliDetect';
import { runCli } from './cliRun';
import { MODELS_TTL_MS, shouldRefetch } from './modelCatalog';

/**
 * Codex CLI model catalog: reads `codex debug models` (subcommand verified
 * on codex-cli 0.146.0 on 2026-08-02), which dumps the live catalog as JSON,
 * including the supported reasoning levels of each model. Caches for one
 * hour and degrades to static lists when the read fails.
 */

export interface CodexCatalogSnapshot {
  readonly models: readonly string[];
  readonly effortsByModel: Readonly<Record<string, readonly string[]>>;
  /** Levels of the catalog's top-priority model (the CLI default). */
  readonly defaultEfforts: readonly string[];
}

/** Canonical order of effort levels, from cheapest to most expensive. */
const EFFORT_ORDER: readonly string[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
];

/** Sorts levels by the canonical sequence; unknown levels go last, alphabetically. */
export function orderEffortLevels(levels: readonly string[]): string[] {
  const known = EFFORT_ORDER.filter((level) => levels.includes(level));
  const unknown = levels.filter((level) => !EFFORT_ORDER.includes(level)).sort();
  return [...known, ...unknown];
}

/**
 * Static fallback: union of the levels seen in the live catalog on
 * 2026-08-02. Used when the CLI is not installed or the read fails.
 */
export const CODEX_EFFORT_FALLBACK: readonly string[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
];

/**
 * Extracts slugs and effort levels from the `codex debug models` JSON. Only
 * entries with visibility "list" (those visible in the CLI picker) are kept;
 * duplicates are removed preserving the CLI priority order. The CLI default
 * is the model with the lowest numeric `priority` (a field present in the
 * codex-cli 0.146.0 catalog); without the field, the first listed wins.
 */
export function parseCodexModelCatalog(json: unknown): CodexCatalogSnapshot {
  const models: string[] = [];
  const effortsByModel: Record<string, readonly string[]> = {};
  let defaultEfforts: readonly string[] = [];
  let defaultPriority = Number.POSITIVE_INFINITY;
  const list =
    typeof json === 'object' &&
    json !== null &&
    Array.isArray((json as { models?: unknown }).models)
      ? (json as { models: unknown[] }).models
      : [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    if (record.visibility !== 'list') continue;
    const slug = typeof record.slug === 'string' ? record.slug.trim() : '';
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const rawLevels = Array.isArray(record.supported_reasoning_levels)
      ? record.supported_reasoning_levels
      : [];
    const efforts: string[] = [];
    for (const level of rawLevels) {
      if (typeof level !== 'object' || level === null) continue;
      const effort = (level as Record<string, unknown>).effort;
      if (typeof effort === 'string' && effort.trim() && !efforts.includes(effort.trim())) {
        efforts.push(effort.trim());
      }
    }
    const ordered = orderEffortLevels(efforts);
    models.push(slug);
    effortsByModel[slug] = ordered;
    const priority =
      typeof record.priority === 'number' && Number.isFinite(record.priority)
        ? record.priority
        : Number.POSITIVE_INFINITY;
    if (ordered.length > 0 && (defaultEfforts.length === 0 || priority < defaultPriority)) {
      defaultEfforts = ordered;
      defaultPriority = priority;
    }
  }
  return { models, effortsByModel, defaultEfforts };
}

export interface CodexCliCatalogDeps {
  readonly findBinaryPath?: () => Promise<string | null>;
  readonly run?: (
    bin: string,
    args: readonly string[],
    opts: { timeoutMs: number; signal: AbortSignal },
  ) => Promise<{ code: number | null; stdout: string }>;
  readonly now: () => number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export class CodexCliCatalog {
  private cache?: { at: number; snapshot: CodexCatalogSnapshot };

  constructor(private readonly deps: CodexCliCatalogDeps) {}

  /** Synchronous cache read; undefined until a fetch has succeeded. */
  snapshot(): CodexCatalogSnapshot | undefined {
    return this.cache?.snapshot;
  }

  /**
   * Effort levels for the selected model; with an empty model (the CLI
   * default) uses the levels of the catalog's top-priority model. A model
   * present but with no declared levels, or a missing catalog, falls back to
   * the static list.
   */
  effortsFor(model: string): readonly string[] {
    const snap = this.cache?.snapshot;
    if (!snap) return CODEX_EFFORT_FALLBACK;
    if (model && Object.hasOwn(snap.effortsByModel, model)) {
      const levels = snap.effortsByModel[model];
      return levels && levels.length > 0 ? levels : CODEX_EFFORT_FALLBACK;
    }
    return snap.defaultEfforts.length > 0 ? snap.defaultEfforts : CODEX_EFFORT_FALLBACK;
  }

  /** Reloads the catalog via `codex debug models`; failures keep the previous cache. */
  private inFlight: Promise<boolean> | undefined;

  refresh(force = false): Promise<boolean> {
    // Concurrent calls (TTL timer + config change + saveKey) share the same
    // run instead of spawning overlapping CLIs.
    if (!force && this.inFlight) return this.inFlight;
    this.inFlight = this.doRefresh(force).finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async doRefresh(force: boolean): Promise<boolean> {
    if (!force && this.cache && !shouldRefetch(this.cache.at, this.deps.now(), MODELS_TTL_MS)) {
      return false;
    }
    if (this.deps.signal.aborted) return false;
    const bin = await (this.deps.findBinaryPath ?? (() => findBinary('codex')))();
    if (!bin || this.deps.signal.aborted) return false;
    try {
      const run =
        this.deps.run ??
        ((b: string, args: readonly string[], opts: { timeoutMs: number; signal: AbortSignal }) =>
          runCli({ bin: b, args, stdin: '', timeoutMs: opts.timeoutMs, signal: opts.signal }));
      const result = await run(bin, ['debug', 'models'], {
        timeoutMs: this.deps.timeoutMs,
        signal: this.deps.signal,
      });
      if (result.code !== 0) return false;
      // Tolerates stray text before the JSON (banner, version notice).
      const start = result.stdout.indexOf('{');
      if (start < 0) return false;
      const snapshot = parseCodexModelCatalog(JSON.parse(result.stdout.slice(start)));
      if (snapshot.models.length === 0) return false;
      this.cache = { at: this.deps.now(), snapshot };
      return true;
    } catch {
      // Broken CLI, invalid JSON or aborted: keep the previous suggestions.
      return false;
    }
  }
}
