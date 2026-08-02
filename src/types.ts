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
  /** Id do modelo resolvido; string vazia significa "padrão do provider/CLI". */
  readonly model: string;
  /** Esforço de raciocínio para providers CLI; string vazia significa "padrão do CLI". */
  readonly effort: string;
  /** Teto de saída para providers HTTP; padrão 512. */
  readonly maxTokens?: number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  /** Diretório de trabalho para providers CLI (raiz do repositório). */
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
    /** Dica acionável exibida ao usuário junto com a mensagem. */
    readonly action?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
