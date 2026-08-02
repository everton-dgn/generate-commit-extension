import { postJson } from '../http';
import { type GenerateRequest, type Provider, ProviderError } from '../types';

/** Extracts the assistant text from an OpenAI-compatible chat completion. */
export function parseOpenAiChatResponse(json: unknown): string {
  if (typeof json !== 'object' || json === null) {
    throw new ProviderError('invalidResponse', 'Provider returned a non-JSON response');
  }
  const choices = (json as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ProviderError('invalidResponse', 'Provider response contains no choices');
  }
  const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
  if (typeof content === 'string' && content.trim()) return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) =>
        typeof part === 'object' && part !== null
          ? String((part as { text?: unknown }).text ?? '')
          : '',
      )
      .join('');
    if (text.trim()) return text;
  }
  throw new ProviderError('invalidResponse', 'Provider response message has no text content');
}

export interface OpenRouterConfig {
  readonly model: string;
  readonly baseUrl: string;
}

export interface OpenRouterDeps {
  readonly getApiKey: () => Promise<string | undefined>;
  readonly getConfig: () => OpenRouterConfig;
}

export function createOpenRouterProvider(deps: OpenRouterDeps): Provider {
  return {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'http',
    isAvailable: async () => Boolean(await deps.getApiKey()),
    generate: async (req: GenerateRequest) => {
      const apiKey = await deps.getApiKey();
      if (!apiKey) {
        throw new ProviderError(
          'auth',
          'No OpenRouter API key configured',
          'Run "Generate Commit: Configure API Key"',
        );
      }
      const { model, baseUrl } = deps.getConfig();
      const json = await postJson(
        `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
        {
          authorization: `Bearer ${apiKey}`,
          'x-openrouter-title': 'generate-commit-extension',
        },
        {
          model,
          messages: [
            { role: 'system', content: req.systemPrompt },
            { role: 'user', content: req.userPrompt },
          ],
          max_tokens: req.maxTokens ?? 512,
          temperature: 0.3,
        },
        { timeoutMs: req.timeoutMs, signal: req.signal },
      );
      return parseOpenAiChatResponse(json);
    },
  };
}
