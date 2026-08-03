export type ProviderId =
  | 'openrouter'
  | 'kimi'
  | 'glm'
  | 'minimax'
  | 'anthropicCustom'
  | 'claudeCli'
  | 'codexCli';

export type ProviderKind = 'http' | 'cli';

export interface GenerateRequest {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  /** Resolved model id; an empty string means "provider/CLI default". */
  readonly model: string;
  /** Reasoning effort for CLI providers; an empty string means "CLI default". */
  readonly effort: string;
  /** Output cap for HTTP providers; defaults to 512. */
  readonly maxTokens?: number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  /** Working directory for CLI providers (the repository root). */
  readonly cwd?: string;
}

export interface Provider {
  readonly id: ProviderId;
  readonly label: string;
  readonly kind: ProviderKind;
  isAvailable(): Promise<boolean>;
  generate(req: GenerateRequest): Promise<string>;
}

export type ProviderErrorKind =
  | 'auth'
  | 'billing'
  | 'rateLimit'
  | 'server'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'cli'
  | 'invalidResponse'
  | 'unknown';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    /** Actionable hint shown to the user alongside the message. */
    readonly action?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
