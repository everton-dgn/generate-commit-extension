import { findBinary } from './cliDetect';
import { runCli } from './cliRun';
import { MODELS_TTL_MS, shouldRefetch } from './modelCatalog';

/**
 * Catálogo de modelos do Codex CLI: lê `codex debug models` (subcomando
 * verificado na codex-cli 0.146.0 em 2026-08-02), que despeja o catálogo vivo
 * em JSON — incluindo, por modelo, os níveis de reasoning suportados. Mantém
 * cache por uma hora e degrada para listas estáticas quando a leitura falha.
 */

export interface CodexCatalogSnapshot {
  readonly models: readonly string[];
  readonly effortsByModel: Readonly<Record<string, readonly string[]>>;
  /** Níveis do modelo prioritário do catálogo (o default do CLI). */
  readonly defaultEfforts: readonly string[];
}

/** Ordem canônica dos níveis de esforço, do mais barato ao mais caro. */
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

/** Ordena níveis pela sequência canônica; níveis desconhecidos vão ao final, em ordem alfabética. */
export function orderEffortLevels(levels: readonly string[]): string[] {
  const known = EFFORT_ORDER.filter((level) => levels.includes(level));
  const unknown = levels.filter((level) => !EFFORT_ORDER.includes(level)).sort();
  return [...known, ...unknown];
}

/**
 * Fallback estático: união dos níveis vistos no catálogo vivo em 2026-08-02.
 * Usado quando o CLI não está instalado ou a leitura falha.
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
 * Extrai os slugs e níveis de esforço do JSON de `codex debug models`.
 * Apenas entradas com visibility "list" (as visíveis no seletor do CLI)
 * entram; duplicatas são removidas mantendo a ordem de prioridade do CLI.
 * O default do CLI é o modelo de menor `priority` numérica (campo presente
 * no catálogo da codex-cli 0.146.0); sem o campo, vale o primeiro listado.
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

  /** Leitura síncrona do cache; undefined quando ainda não houve busca bem-sucedida. */
  snapshot(): CodexCatalogSnapshot | undefined {
    return this.cache?.snapshot;
  }

  /**
   * Níveis de esforço para o modelo selecionado; com o modelo vazio (default
   * do CLI) usa os níveis do modelo prioritário do catálogo. Um modelo
   * presente mas sem níveis declarados, ou a ausência de catálogo, cai no
   * fallback estático.
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

  /** Recarrega o catálogo via `codex debug models`; falhas mantêm o cache anterior. */
  private inFlight: Promise<boolean> | undefined;

  refresh(force = false): Promise<boolean> {
    // Chamadas concorrentes (timer de TTL + config change + saveKey) dividem a
    // mesma execução em vez de spawnar CLIs sobrepostos.
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
      // Tolera texto acidental antes do JSON (banner, aviso de versão).
      const start = result.stdout.indexOf('{');
      if (start < 0) return false;
      const snapshot = parseCodexModelCatalog(JSON.parse(result.stdout.slice(start)));
      if (snapshot.models.length === 0) return false;
      this.cache = { at: this.deps.now(), snapshot };
      return true;
    } catch {
      // CLI quebrado, JSON inválido ou abortado: mantém as sugestões anteriores.
      return false;
    }
  }
}
