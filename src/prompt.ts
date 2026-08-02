const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  en: 'English',
  'pt-BR': 'Brazilian Portuguese',
  pt: 'Portuguese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  ja: 'Japanese',
  'zh-CN': 'Simplified Chinese',
  ko: 'Korean',
  ru: 'Russian',
};

export function resolveLanguage(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) return 'English';
  return LANGUAGE_NAMES[trimmed] ?? trimmed;
}

export function buildSystemPrompt(language: string, customInstructions: string): string {
  const lines = [
    'You write git commit messages in the Conventional Commits format.',
    `Write the commit message in ${resolveLanguage(language)}.`,
    'Rules:',
    '- First line: "<type>(<optional scope>): <summary>", at most 72 characters, imperative mood.',
    '- Valid types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.',
    '- Add a body with at most 3 short bullet points only when the change truly needs explanation; otherwise output only the first line.',
    '- Base the message strictly on the provided diff. Do not invent changes.',
    '- Output ONLY the commit message text: no markdown code fences, no quotes, no explanations, no preamble.',
  ];
  const custom = customInstructions.trim();
  if (custom) lines.push(`Additional instructions from the user: ${custom}`);
  return lines.join('\n');
}

export interface UserPromptInput {
  readonly diff: string;
  readonly truncated: boolean;
  readonly recentCommits: readonly string[];
}

export function buildUserPrompt(input: UserPromptInput): string {
  const parts: string[] = [];
  if (input.recentCommits.length > 0) {
    parts.push(
      [
        'Recent commit messages in this repository (style reference only, do not summarize them):',
        ...input.recentCommits.map((message) => `- ${message}`),
      ].join('\n'),
    );
  }
  if (input.truncated) {
    parts.push(
      'Note: the diff below was truncated to fit size limits; base the message only on what is visible.',
    );
  }
  parts.push(`Diff:\n${input.diff}`);
  parts.push('Write the commit message now.');
  return parts.join('\n\n');
}

/**
 * Normalizes raw model output into a plain commit message: extracts the
 * first fenced code block when present (models often wrap the answer even
 * with preamble around it), then strips a leading label and wrapping quotes.
 */
export function parseModelOutput(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/```[a-zA-Z]*\s*\n([\s\S]*?)\n?```/);
  if (fenced?.[1]) text = fenced[1].trim();
  text = text.replace(/^(commit message|mensagem de commit)\s*:\s*/i, '');
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      text = text.slice(1, -1).trim();
    }
  }
  return text;
}
